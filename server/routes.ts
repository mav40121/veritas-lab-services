import type { Express, Request, Response } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { stripe, PRICES, WEBHOOK_SECRET, FRONTEND_URL } from "./stripe";
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
    // Support optional userId filter via auth header (optional auth)
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        return res.json(storage.getStudiesByUser(payload.userId));
      } catch {}
    }
    // Guest: return all studies with no userId (session-scoped — in production would use session)
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

  // ── CONTACT ───────────────────────────────────────────────────────────────
  app.post("/api/contact", (req, res) => {
    const parsed = insertContactSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    storage.createContactMessage(parsed.data);
    res.json({ success: true });
  });

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // Create a checkout session for per-study ($9) or annual ($149/yr)
  app.post("/api/stripe/checkout", authMiddleware, async (req: any, res) => {
    if (!stripe) return res.status(503).json({ error: "Payments not configured" });
    const { priceType } = req.body; // "perStudy" | "annual"
    if (!priceType || !PRICES[priceType as keyof typeof PRICES]) {
      return res.status(400).json({ error: "Invalid price type" });
    }
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const priceId = PRICES[priceType as keyof typeof PRICES];
    const isSubscription = priceType === "annual";
    const successUrl = `${FRONTEND_URL}/#/veritacheck?payment=success&type=${priceType}`;
    const cancelUrl = `${FRONTEND_URL}/#/veritacheck?payment=cancelled`;

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

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: isSubscription ? "subscription" : "payment",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: String(user.id), priceType },
      });

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
          } else if (priceType === "annual" && session.subscription) {
            // Activate annual plan
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: "annual",
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
