import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

// Force non-www → www with 301 permanent redirect (fixes Google Search Console "Page with redirect")
app.use((req, res, next) => {
  const host = req.headers.host;
  if (host && !host.startsWith('www.') && !host.includes('localhost') && !host.includes('railway')) {
    return res.redirect(301, `https://www.${host}${req.url}`);
  }
  next();
});

// CORS — allow requests from the deployed frontend and localhost
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://www.perplexity.ai",
    "https://sites.pplx.app",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "https://veritaslabservices.com",
    "https://www.veritaslabservices.com",
    "https://www.veritaslabservices.com",
    process.env.FRONTEND_URL || "",
  ].filter(Boolean);
  const origin = req.headers.origin || "";
  if (allowedOrigins.some(o => origin.startsWith(o))) {
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

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // 301 redirects for old URLs found in Google Search Console
  app.get('/m/create-account', (_req, res) => res.redirect(301, '/'));
  app.get('/meet-our-team', (_req, res) => res.redirect(301, '/'));
  app.get('/m/reset', (_req, res) => res.redirect(301, '/'));

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
