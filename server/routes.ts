import type { Express, Request, Response } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { db } from "./db";
import { stripe, PRICES, WEBHOOK_SECRET, FRONTEND_URL } from "./stripe";
import crypto from "crypto";
import { Resend } from "resend";
import { generatePDFBuffer } from "./pdfReport";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
import { insertStudySchema, insertContactSchema, registerSchema, loginSchema } from "@shared/schema";

const JWT_SECRET = process.env.JWT_SECRET || "veritas-lab-services-secret-2026";

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ── ADMIN ────────────────────────────────────────────────────────────────
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "veritas-admin-2026";
  app.post("/api/admin/users", (req, res) => {
    const { secret } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const allStudies = storage.getAllStudies();
    const userList = [];
    for (let i = 1; i <= 20; i++) {
      const u = storage.getUserById(i);
      if (u) userList.push({ id: u.id, email: u.email, name: u.name, plan: u.plan, studyCount: allStudies.filter(s => s.userId === i).length });
    }
    res.json(userList);
  });

  app.post("/api/admin/set-plan", (req, res) => {
    const { secret, userId, plan, credits } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const planCredits = plan === "annual" ? 99999 : (credits ?? 0);
    storage.updateUserPlan(Number(userId), plan, planCredits);
    const user = storage.getUserById(Number(userId));
    res.json({ ok: true, user: { id: user?.id, email: user?.email, plan: user?.plan, studyCredits: user?.studyCredits } });
  });

  // ── DISCOUNT CODES (admin) ───────────────────────────────────────────────
  app.get("/api/admin/discount-codes", (req, res) => {
    const { secret } = req.query as any;
    if (secret !== ADMIN_SECRET) {
      const body = req.body;
      if (body?.secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    }
    const codes = db.$client.prepare("SELECT * FROM discount_codes ORDER BY id DESC").all();
    res.json(codes);
  });

  app.post("/api/admin/discount-codes", (req, res) => {
    const { secret, code, partnerName, discountPct, appliesTo, maxUses } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    if (!code || !partnerName) return res.status(400).json({ error: "code and partnerName required" });
    try {
      db.$client.prepare(
        "INSERT INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)"
      ).run(code.toUpperCase(), partnerName, discountPct || 10, appliesTo || "annual", maxUses ?? null, new Date().toISOString());
      res.json({ ok: true });
    } catch (err: any) {
      res.status(409).json({ error: "Code already exists" });
    }
  });

  app.patch("/api/admin/discount-codes/:id", (req, res) => {
    const { secret, active, discountPct, appliesTo, maxUses } = req.body;
    if (secret !== ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const id = parseInt(req.params.id);
    const sets: string[] = [];
    const vals: any[] = [];
    if (active !== undefined) { sets.push("active = ?"); vals.push(active ? 1 : 0); }
    if (discountPct !== undefined) { sets.push("discount_pct = ?"); vals.push(discountPct); }
    if (appliesTo !== undefined) { sets.push("applies_to = ?"); vals.push(appliesTo); }
    if (maxUses !== undefined) { sets.push("max_uses = ?"); vals.push(maxUses); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(id);
    db.$client.prepare(`UPDATE discount_codes SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    const updated = db.$client.prepare("SELECT * FROM discount_codes WHERE id = ?").get(id);
    res.json(updated);
  });

  // ── DISCOUNT CODE VALIDATION (public) ──────────────────────────────────
  app.post("/api/discount/validate", (req, res) => {
    const { code, priceType } = req.body;
    if (!code) return res.json({ valid: false, message: "No code provided" });

    const row = db.$client.prepare("SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?)").get(code.trim()) as any;
    if (!row) return res.json({ valid: false, message: "Invalid discount code" });
    if (!row.active) return res.json({ valid: false, message: "This code is no longer active" });
    if (row.max_uses !== null && row.uses >= row.max_uses) return res.json({ valid: false, message: "This code has reached its usage limit" });
    if (row.applies_to !== "all" && row.applies_to !== priceType) {
      return res.json({ valid: false, message: `This code applies to ${row.applies_to} plans only` });
    }

    res.json({ valid: true, discountPct: row.discount_pct, partnerName: row.partner_name, message: `${row.discount_pct}% discount applied` });
  });

  // ── HEALTH CHECK ──────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "veritas-lab-services", timestamp: new Date().toISOString() });
  });

  // ── AUTH ──────────────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password, name } = parsed.data;
    if (storage.getUserByEmail(email)) return res.status(409).json({ error: "Email already registered" });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = storage.createUser(email.toLowerCase(), passwordHash, name);
    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits } });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;
    const user = storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });
    const token = signToken(user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits } });
  });

  app.get("/api/auth/me", authMiddleware, (req: any, res) => {
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits });
  });

  // ── STUDIES ───────────────────────────────────────────────────────────────
  app.get("/api/studies", (req, res) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        // Return studies owned by this user + shared guest studies (userId=null)
        const userStudies = storage.getStudiesByUser(payload.userId);
        const guestStudies = storage.getAllStudies().filter(s => !s.userId);
        // Merge, deduplicate by id, sort by id desc
        const all = [...userStudies, ...guestStudies];
        const seen = new Set<number>();
        const merged = all.filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });
        merged.sort((a, b) => b.id - a.id);
        return res.json(merged);
      } catch {}
    }
    // Guest: return studies with no userId
    res.json(storage.getAllStudies().filter(s => !s.userId));
  });

  app.get("/api/studies/:id", (req, res) => {
    const study = storage.getStudy(parseInt(req.params.id));
    if (!study) return res.status(404).json({ error: "Study not found" });
    res.json(study);
  });

  app.post("/api/studies", (req, res) => {
    const parsed = insertStudySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    // Attach userId if authenticated
    let userId: number | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        userId = payload.userId;
      } catch {}
    }

    const study = storage.createStudy({ ...parsed.data, userId });
    res.status(201).json(study);
  });

  app.delete("/api/studies/:id", (req, res) => {
    storage.deleteStudy(parseInt(req.params.id));
    res.json({ success: true });
  });

  // ── PDF GENERATION ────────────────────────────────────────────────────────
  // Accepts { study, results } JSON, returns a PDF binary.
  // Auth optional — guests can generate PDFs for studies they can view.
  app.post("/api/generate-pdf", async (req: any, res) => {
    try {
      const { study, results } = req.body;
      if (!study || !results) return res.status(400).json({ error: "study and results required" });
      const pdfBuffer = await generatePDFBuffer(study, results);
      const filename = `VeritaCheck_${study.studyType === "cal_ver" ? "CalVer" : study.studyType === "precision" ? "Precision" : "MethodComp"}_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── CONTACT ───────────────────────────────────────────────────────────────
  app.post("/api/contact", (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    storage.createContactMessage(parsed.data);
    res.json({ success: true });
  });

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // Create a checkout session for per-study ($9) or annual ($149/yr)
  // ── PASSWORD RESET ────────────────────────────────────────────────────────
  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email required" });
    const user = storage.getUserByEmail(email.toLowerCase());
    // Always return 200 to prevent user enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.$client.prepare("INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(user.id, token, expiresAt);

    const resetUrl = `${FRONTEND_URL}/#/reset-password?token=${token}`;

    if (resend) {
      await resend.emails.send({
        from: "VeritaCheck <noreply@veritaslabservices.com>",
        to: user.email,
        subject: "Reset your VeritaCheck password",
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
            <h2 style="color:#0e8a82">VeritaCheck Password Reset</h2>
            <p>Hi ${user.name},</p>
            <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
            <a href="${resetUrl}" style="display:inline-block;background:#0e8a82;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Reset Password</a>
            <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
            <p style="color:#999;font-size:12px">Veritas Lab Services, LLC · veritaslabservices.com</p>
          </div>
        `,
      });
    } else {
      console.log(`[password-reset] Token for ${email}: ${token} (Resend not configured)`);
    }
    res.json({ ok: true });
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password || password.length < 6) return res.status(400).json({ error: "Token and password (min 6 chars) required" });

    const row = db.$client.prepare("SELECT * FROM reset_tokens WHERE token = ? AND used_at IS NULL").get(token) as any;
    if (!row) return res.status(400).json({ error: "Invalid or expired reset link" });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: "Reset link has expired. Please request a new one." });

    const passwordHash = await bcrypt.hash(password, 10);
    db.$client.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, row.user_id);
    db.$client.prepare("UPDATE reset_tokens SET used_at = ? WHERE token = ?").run(new Date().toISOString(), token);

    const user = storage.getUserById(row.user_id);
    if (!user) return res.status(404).json({ error: "User not found" });
    const newToken = signToken(user.id);
    res.json({ ok: true, token: newToken, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits } });
  });

  app.post("/api/stripe/checkout", authMiddleware, async (req: any, res) => {
    if (!stripe) return res.status(503).json({ error: "Payments not configured" });
    const { priceType, discountCode } = req.body; // "perStudy" | "annual" | "lab"
    if (!priceType || !PRICES[priceType as keyof typeof PRICES]) {
      return res.status(400).json({ error: "Invalid price type" });
    }
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const priceId = PRICES[priceType as keyof typeof PRICES];
    const isSubscription = priceType === "annual" || priceType === "lab";
    const successUrl = `${FRONTEND_URL}/#/veritacheck?payment=success&type=${priceType}`;
    const cancelUrl = `${FRONTEND_URL}/#/veritacheck?payment=cancelled`;

    // Validate discount code if provided
    let couponId: string | undefined;
    let discountRow: any = null;
    if (discountCode) {
      discountRow = db.$client.prepare("SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?)").get(discountCode.trim()) as any;
      if (discountRow && discountRow.active && (discountRow.max_uses === null || discountRow.uses < discountRow.max_uses) && (discountRow.applies_to === "all" || discountRow.applies_to === priceType)) {
        try {
          const coupon = await stripe.coupons.create({
            percent_off: discountRow.discount_pct,
            duration: "once",
            name: `${discountRow.partner_name} - ${discountRow.discount_pct}% off`,
          });
          couponId = coupon.id;
        } catch (err: any) {
          console.error("Stripe coupon creation error:", err.message);
          // Continue without discount if coupon creation fails
        }
      }
    }

    try {
      // Reuse or create Stripe customer
      let customerId = user.stripeCustomerId || undefined;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
          metadata: { userId: String(user.id) },
        });
        customerId = customer.id;
        storage.updateUserStripe(user.id, { stripeCustomerId: customerId });
      }

      const sessionParams: any = {
        customer: customerId,
        mode: isSubscription ? "subscription" : "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: String(user.id), priceType },
      };
      if (couponId) {
        sessionParams.discounts = [{ coupon: couponId }];
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

      // Increment discount code usage after successful session creation
      if (couponId && discountRow) {
        db.$client.prepare("UPDATE discount_codes SET uses = uses + 1 WHERE id = ?").run(discountRow.id);
      }

      res.json({ url: session.url });
    } catch (err: any) {
      console.error("Stripe checkout error:", err.message);
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  });

  // Stripe webhook — handle checkout.session.completed, subscription events
  app.post("/api/stripe/webhook", async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "Payments not configured" });
    const sig = req.headers["stripe-signature"] as string;
    let event: any;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).json({ error: "Invalid signature" });
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const userId = parseInt(session.metadata?.userId || "0");
        const priceType = session.metadata?.priceType;
        if (userId) {
          if (priceType === "perStudy") {
            // Add 1 study credit
            storage.addStudyCredits(userId, 1);
          } else if ((priceType === "annual" || priceType === "lab") && session.subscription) {
            // Activate annual or lab plan
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType, // "annual" or "lab"
            });
          }
        }
      } else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as any;
        const user = storage.getUserByStripeCustomerId(sub.customer);
        if (user) {
          storage.updateUserStripe(user.id, { stripeSubscriptionId: null, plan: "free" });
        }
      } else if (event.type === "invoice.payment_failed") {
        // Log but don't downgrade immediately — Stripe will retry
        const invoice = event.data.object as any;
        console.warn("Payment failed for customer:", invoice.customer);
      }
    } catch (err: any) {
      console.error("Webhook processing error:", err.message);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    res.json({ received: true });
  });

  return httpServer;
}
