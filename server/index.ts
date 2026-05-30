// Sentry must be initialized BEFORE any other imports that might throw at
// load time so it can capture early-startup errors. Guarded by env var so
// the app boots without Sentry when SENTRY_DSN is unset (e.g. local dev).
import * as Sentry from "@sentry/node";
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "production",
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// Fail loud if required secrets are missing - catches Railway env var misconfigurations at deploy time
const REQUIRED_SECRETS = ["JWT_SECRET", "ADMIN_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"] as const;
const missingSecrets = REQUIRED_SECRETS.filter((key) => !process.env[key]);
if (missingSecrets.length > 0) {
  console.error(`[startup] FATAL: missing required environment variables: ${missingSecrets.join(", ")}`);
  process.exit(1);
}

const app = express();
app.set("trust proxy", true);
const httpServer = createServer(app);

// 301-redirect apex domain to www (fixes Google Search Console HTTP 405 on apex)
app.use((req, res, next) => {
  const host = req.hostname;
  if (host === 'veritaslabservices.com') {
    return res.redirect(301, `https://www.veritaslabservices.com${req.originalUrl}`);
  }
  next();
});

// Security response headers. Improves trust signals for corporate URL reputation
// crawlers (Microsoft SmartScreen, Cisco Umbrella, Forcepoint, McAfee TrustedSource).
// Intentionally omits Content-Security-Policy: a wrong CSP can silently break the
// React app, fonts, GA4, and Stripe Checkout. Add CSP later as a separate scoped
// task with explicit testing.
app.use((req, res, next) => {
  // HSTS: force HTTPS for one year, including subdomains. Cert is Let's Encrypt
  // and we are 100% HTTPS today, so this is safe to commit to.
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  // Prevent MIME-sniffing.
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Block external sites from iframing us (clickjacking defense). SAMEORIGIN
  // keeps same-origin embeds working.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Limit referrer leakage on cross-origin navigations.
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Explicitly deny powerful browser features the app does not use,
  // except camera which is needed by VeritaStock barcode scanning
  // (parking-lot #29 Phase 3). camera=(self) lets our own origin
  // request camera access; third-party iframes embedded on our pages
  // still cannot.
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=()",
  );
  next();
});

// CORS - allow requests from the deployed frontend and localhost
app.use((req, res, next) => {
  const allowedOrigins = new Set([
    "https://www.perplexity.ai",
    "https://sites.pplx.app",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "https://veritaslabservices.com",
    "https://www.veritaslabservices.com",
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ]);
  const origin = req.headers.origin || "";
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Stripe webhook needs raw body — must be registered BEFORE express.json()
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Seed demo data
  try {
    const { seedDemoData } = await import("./seedDemo");
    await seedDemoData();
  } catch (err: any) {
    console.error("[seed] Demo data seed error:", err.message);
  }

  // Verify demo data integrity -- restores any accidentally deleted demo studies
  try {
    const { verifyDemoIntegrity } = await import("./demoGuard");
    await verifyDemoIntegrity();
  } catch (err: any) {
    console.error("[demoGuard] Integrity check error:", err.message);
  }

  // Backfill clia_absolute_floor for studies missing it (must run before recompute)
  try {
    const { backfillAbsoluteFloorOnStartup } = await import("./backfillAbsoluteFloor");
    backfillAbsoluteFloorOnStartup();
  } catch (err: any) {
    console.error("[backfill] Startup backfill import error:", err.message);
  }

  // Re-key VeritaPolicy seat-user rows to owner. Required because the routes
  // previously scoped data by req.userId (seat's own id) instead of
  // req.ownerUserId (the owner's id). After the route fix, any rows still
  // keyed by seat-user-id become unreachable. This backfill moves them to
  // owner-keyed rows; owner wins on conflict.
  try {
    const { backfillVeritapolicySeatsOnStartup } = await import("./backfillVeritapolicySeats");
    backfillVeritapolicySeatsOnStartup();
  } catch (err: any) {
    console.error("[backfill-veritapolicy] Startup backfill import error:", err.message);
  }

  // Recompute pass/fail status for all existing studies to fix any stale values
  try {
    const { recomputeAllStudyStatuses } = await import("./routes");
    recomputeAllStudyStatuses();
  } catch (err: any) {
    console.error("[migration] Study status recompute error:", err.message);
  }

  // Schedule nightly snapshot at midnight UTC
  // Runs once at startup to catch any missed snapshot, then schedules daily
  try {
    const { runNightlySnapshots } = await import("./audit");
    const scheduleNightlySnapshot = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const msUntilMidnight = midnight.getTime() - now.getTime();
      setTimeout(() => {
        console.log("[snapshot] Running nightly snapshot...");
        runNightlySnapshots();
        // Schedule again for next midnight
        setInterval(() => {
          console.log("[snapshot] Running nightly snapshot...");
          runNightlySnapshots();
        }, 24 * 60 * 60 * 1000);
      }, msUntilMidnight);
      console.log(`[snapshot] Nightly snapshot scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`);
    };
    scheduleNightlySnapshot();
  } catch (err: any) {
    console.error("[snapshot] Scheduler setup error:", err.message);
  }

  // Schedule VeritaResponse due-date reminder dispatch at midnight UTC.
  // Mirrors the snapshot scheduler shape so both daily jobs share their
  // failure semantics. Reminder dispatch is idempotent (UNIQUE constraint
  // on finding_reminder_log) so multiple invocations are safe.
  try {
    const { runFindingReminders } = await import("./audit");
    const scheduleFindingReminders = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const msUntilMidnight = midnight.getTime() - now.getTime();
      setTimeout(() => {
        console.log("[finding-reminder] Running due-date reminder dispatch...");
        runFindingReminders().catch((err) => console.error("[finding-reminder] Run failed:", err?.message || err));
        setInterval(() => {
          console.log("[finding-reminder] Running due-date reminder dispatch...");
          runFindingReminders().catch((err) => console.error("[finding-reminder] Run failed:", err?.message || err));
        }, 24 * 60 * 60 * 1000);
      }, msUntilMidnight);
      console.log(`[finding-reminder] Due-date reminder dispatch scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`);
    };
    scheduleFindingReminders();
  } catch (err: any) {
    console.error("[finding-reminder] Scheduler setup error:", err.message);
  }

  // Schedule daily VeritaPolicy review-reminder dispatch at midnight UTC.
  // Mirrors the finding-reminder scheduler. Idempotent via
  // policy_review_reminders UNIQUE constraint on (document_id, version_id,
  // reminder_type) at the application level; safe to re-run.
  try {
    const { runPolicyReviewReminders } = await import("./veritapolicyReminders");
    const schedulePolicyReminders = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      const msUntilMidnight = midnight.getTime() - now.getTime();
      setTimeout(() => {
        console.log("[policy-reminders] Running review-reminder dispatch...");
        runPolicyReviewReminders().catch((err) =>
          console.error("[policy-reminders] Run failed:", err?.message || err)
        );
        setInterval(() => {
          console.log("[policy-reminders] Running review-reminder dispatch...");
          runPolicyReviewReminders().catch((err) =>
            console.error("[policy-reminders] Run failed:", err?.message || err)
          );
        }, 24 * 60 * 60 * 1000);
      }, msUntilMidnight);
      console.log(
        `[policy-reminders] Review-reminder dispatch scheduled in ${Math.round(msUntilMidnight / 60000)} minutes`
      );
    };
    schedulePolicyReminders();
  } catch (err: any) {
    console.error("[policy-reminders] Scheduler setup error:", err.message);
  }

  // Schedule nightly off-site database backup at 04:00 UTC. Env-gated:
  // if GOOGLE_DRIVE_SA_JSON or GOOGLE_DRIVE_BACKUP_FOLDER_ID is unset
  // the run is a no-op. 04:00 chosen to clear the midnight UTC snapshot
  // and reminder jobs above.
  try {
    const { runNightlyBackup } = await import("./backup");
    const scheduleNightlyBackup = () => {
      const now = new Date();
      const next = new Date(now);
      next.setUTCHours(4, 0, 0, 0);
      if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
      const msUntil = next.getTime() - now.getTime();
      setTimeout(() => {
        console.log("[backup] Running nightly off-site backup...");
        runNightlyBackup().catch((err) => console.error("[backup] Run failed:", err?.message || err));
        setInterval(() => {
          console.log("[backup] Running nightly off-site backup...");
          runNightlyBackup().catch((err) => console.error("[backup] Run failed:", err?.message || err));
        }, 24 * 60 * 60 * 1000);
      }, msUntil);
      console.log(`[backup] Nightly off-site backup scheduled in ${Math.round(msUntil / 60000)} minutes`);
    };
    scheduleNightlyBackup();
  } catch (err: any) {
    console.error("[backup] Scheduler setup error:", err.message);
  }

  try {
    await registerRoutes(httpServer, app);
    console.log('[startup] registerRoutes completed successfully');
  } catch (err: any) {
    console.error('[startup] CRITICAL: registerRoutes FAILED:', err.message, err.stack);
  }

  // Sentry's Express error handler must run BEFORE our own error responder
  // so it can capture the error before we serialize it to JSON.
  if (process.env.SENTRY_DSN) {
    Sentry.setupExpressErrorHandler(app);
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Old /m/* URLs from a previous site version. Paths with current
  // canonical equivalents 301-redirect (preserves SEO link equity);
  // anything else under /m/* 410s so Google deindexes it. Order matters:
  // specific app.get(...) registrations win over the catch-all below.
  app.get('/m/login', (_req, res) => res.redirect(301, '/login'));
  app.get('/m/create-account', (_req, res) => res.redirect(301, '/register'));
  app.get('/m/reset', (_req, res) => res.redirect(301, '/reset-password'));
  app.get('/m', (_req, res) => res.status(410).send('Gone'));
  app.use('/m/{*path}', (_req, res) => res.status(410).send('Gone'));

  // /meet-our-team -> /team (sitemap canonical); was redirecting to / which is a soft-404 risk
  app.get('/meet-our-team', (_req, res) => res.redirect(301, '/team'));

  // /our-services -> /services (legacy marketing URL; SPA catch-all was returning soft-404)
  app.get('/our-services', (_req, res) => res.redirect(301, '/services'));

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
