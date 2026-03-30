import type { Express, Request, Response } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { db } from "./db";
import { stripe, PRICES, SEAT_PRICES, WEBHOOK_SECRET, FRONTEND_URL, PLAN_LIMITS, SEAT_PRICING, getSeatPrice } from "./stripe";
import crypto from "crypto";
import { Resend } from "resend";
import { generatePDFBuffer, generateCumsumPDF, generateVeritaScanPDF, generateCompetencyPDF, generateCMS209PDF } from "./pdfReport";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Safe JSON parse helper — handles already-parsed values and plain strings
function safeJsonParse(value: any, fallback: any = []): any {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return [value];
  }
}
import { insertStudySchema, insertContactSchema, registerSchema, loginSchema } from "@shared/schema";
import { autoCompleteVeritaScanItems } from "./integrations";
import {
  MAYO_CRITICAL_VALUES, UNITS_LOOKUP, REFERENCE_RANGES, AMR_LOOKUP,
  CFR_MAP as VERITAMAP_CFR_MAP, getComplianceStatus, lookupAnalyte, INSTRUCTIONS_CONTENT,
} from "./veritamapData";

const JWT_SECRET = process.env.JWT_SECRET || "veritas-lab-services-secret-2026";

function signToken(userId: number) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" });
}

// ── SUBSCRIPTION ACCESS LEVEL ──────────────────────────────────────────
function getAccessLevel(user: any): 'full' | 'read_only' | 'locked' | 'free' {
  if (!user.subscription_expires_at && !user.subscriptionExpiresAt) return 'free';

  const now = new Date();
  const expiry = new Date(user.subscription_expires_at || user.subscriptionExpiresAt);
  const twoYearsAfterExpiry = new Date(expiry);
  twoYearsAfterExpiry.setFullYear(twoYearsAfterExpiry.getFullYear() + 2);

  if (now < expiry) return 'full'; // active subscription
  if (now < twoYearsAfterExpiry) return 'read_only'; // within 2-year retention
  return 'locked'; // beyond 2-year retention
}

function requireWriteAccess(req: any, res: any, next: any) {
  const fullUser = storage.getUserById(req.userId);
  if (!fullUser) return res.status(401).json({ error: "User not found" });

  const accessLevel = getAccessLevel(fullUser);
  if (accessLevel === 'read_only') {
    const expiry = new Date(fullUser.subscriptionExpiresAt!);
    const retentionEnd = new Date(expiry);
    retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
    return res.status(403).json({
      error: "Your subscription has expired. Your data is available in read-only mode for 2 years. Resubscribe to add new records.",
      code: "SUBSCRIPTION_EXPIRED_READ_ONLY",
      retentionEndsAt: retentionEnd.toISOString(),
    });
  }
  if (accessLevel === 'locked') {
    return res.status(403).json({
      error: "Your data retention period has ended. Please resubscribe to regain access to your account.",
      code: "DATA_RETENTION_EXPIRED",
    });
  }
  next();
}

function authMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
    const user = storage.getUserById(payload.userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.userId = user.id;
    req.user = { userId: user.id, plan: user.plan, email: user.email, name: user.name, studyCredits: user.studyCredits };
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
    const planCredits = ["annual", "starter", "professional", "lab", "complete", "waived", "community", "hospital", "large_hospital", "veritacheck_only"].includes(plan) ? 99999 : (credits ?? 0);
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

    // Check if this user was invited as a seat
    const seatInvite = (db as any).$client.prepare(
      "SELECT id, owner_user_id FROM user_seats WHERE seat_email = ? AND status = 'pending'"
    ).get(email.toLowerCase()) as any;
    if (seatInvite) {
      (db as any).$client.prepare(
        "UPDATE user_seats SET seat_user_id = ?, status = 'active', accepted_at = ? WHERE id = ?"
      ).run(user.id, new Date().toISOString(), seatInvite.id);
    }

    const token = signToken(user.id);

    // Create session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(user.id, sessionToken, req.headers["user-agent"] || "Unknown", now, now);

    res.json({ token, session_token: sessionToken, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits, hasCompletedOnboarding: false, subscriptionExpiresAt: null, subscriptionStatus: 'free', accessLevel: 'free', cliaNumber: null, cliaLabName: null, cliaTier: null, seatCount: 1 } });
  });

  app.post("/api/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;
    const user = storage.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password" });

    const userRow = (db as any).$client.prepare("SELECT has_completed_onboarding, subscription_expires_at, subscription_status, clia_number, clia_lab_name, clia_tier, seat_count FROM users WHERE id = ?").get(user.id) as any;
    const hasCompletedOnboarding = userRow?.has_completed_onboarding ?? 1;

    // Check for seat access: user must be an account owner or have an active seat
    const isOwner = true; // The user logging in owns their own account
    const hasSeat = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE seat_email = ? AND status = 'active'"
    ).get(email.toLowerCase());

    // Session conflict check
    const activeSession = (db as any).$client.prepare(
      "SELECT id, device_info, last_active FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY last_active DESC LIMIT 1"
    ).get(user.id) as any;

    const deviceInfo = req.headers["user-agent"] || "Unknown";

    if (activeSession) {
      // Return session conflict - let frontend handle the force-logout choice
      const token = signToken(user.id);
      return res.json({
        session_conflict: true,
        active_device: activeSession.device_info || "Unknown device",
        last_active: activeSession.last_active,
        message: "Another session is active on another device. Log out that device to continue.",
        token,
        user: {
          id: user.id, email: user.email, name: user.name, plan: user.plan,
          studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
          subscriptionExpiresAt: userRow?.subscription_expires_at || null,
          subscriptionStatus: userRow?.subscription_status || 'free',
          accessLevel: getAccessLevel({ subscription_expires_at: userRow?.subscription_expires_at }),
          cliaNumber: userRow?.clia_number || null,
          cliaLabName: userRow?.clia_lab_name || null,
          cliaTier: userRow?.clia_tier || null,
          seatCount: userRow?.seat_count || 1,
        },
      });
    }

    // No conflict - create new session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(user.id, sessionToken, deviceInfo, now, now);

    const token = signToken(user.id);
    res.json({
      token, session_token: sessionToken,
      user: {
        id: user.id, email: user.email, name: user.name, plan: user.plan,
        studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
        subscriptionExpiresAt: userRow?.subscription_expires_at || null,
        subscriptionStatus: userRow?.subscription_status || 'free',
        accessLevel: getAccessLevel({ subscription_expires_at: userRow?.subscription_expires_at }),
        cliaNumber: userRow?.clia_number || null,
        cliaLabName: userRow?.clia_lab_name || null,
        cliaTier: userRow?.clia_tier || null,
        seatCount: userRow?.seat_count || 1,
      },
    });
  });

  app.get("/api/auth/me", authMiddleware, (req: any, res) => {
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const userRow = (db as any).$client.prepare("SELECT has_completed_onboarding, subscription_expires_at, subscription_status, clia_number, clia_lab_name, clia_tier, seat_count FROM users WHERE id = ?").get(user.id) as any;
    const hasCompletedOnboarding = userRow?.has_completed_onboarding ?? 1;

    // Update session last_active
    const sessionToken = req.headers["x-session-token"];
    if (sessionToken) {
      (db as any).$client.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ? AND is_active = 1").run(new Date().toISOString(), sessionToken);
    }

    res.json({
      id: user.id, email: user.email, name: user.name, plan: user.plan,
      studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding,
      subscriptionExpiresAt: userRow?.subscription_expires_at || null,
      subscriptionStatus: userRow?.subscription_status || 'free',
      accessLevel: getAccessLevel({ subscription_expires_at: userRow?.subscription_expires_at }),
      cliaNumber: userRow?.clia_number || null,
      cliaLabName: userRow?.clia_lab_name || null,
      cliaTier: userRow?.clia_tier || null,
      seatCount: userRow?.seat_count || 1,
    });
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

    // If study belongs to a user, verify the requester is that user
    if (study.userId) {
      const auth = req.headers.authorization;
      if (!auth?.startsWith("Bearer ")) {
        return res.status(403).json({ error: "This study requires authentication" });
      }
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        if (payload.userId !== study.userId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } catch {
        return res.status(403).json({ error: "Invalid or expired session" });
      }
    }

    res.json(study);
  });

  app.post("/api/studies", (req, res) => {
    const parsed = insertStudySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    // Gate: PT/Coag New Lot Validation is Coming Soon — pending regulatory review
    if (parsed.data.studyType === "pt_coag") return res.status(403).json({ error: "PT/Coag New Lot Validation is not yet available" });

    // Attach userId if authenticated
    let userId: number | null = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
        userId = payload.userId;
        // Check subscription write access for authenticated users
        const fullUser = storage.getUserById(payload.userId);
        if (fullUser) {
          const accessLevel = getAccessLevel(fullUser);
          if (accessLevel === 'read_only') {
            const expiry = new Date(fullUser.subscriptionExpiresAt!);
            const retentionEnd = new Date(expiry);
            retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
            return res.status(403).json({ error: "Your subscription has expired. Your data is available in read-only mode for 2 years. Resubscribe to add new records.", code: "SUBSCRIPTION_EXPIRED_READ_ONLY", retentionEndsAt: retentionEnd.toISOString() });
          }
          if (accessLevel === 'locked') {
            return res.status(403).json({ error: "Your data retention period has ended. Please resubscribe to regain access to your account.", code: "DATA_RETENTION_EXPIRED" });
          }
        }
      } catch {}
    }

    const study = storage.createStudy({ ...parsed.data, userId });

    // VeritaCheck → VeritaScan integration bridge
    try {
      autoCompleteVeritaScanItems({
        id: study.id,
        userId: study.userId,
        testName: study.testName,
        studyType: study.studyType,
        instruments: study.instruments,
      });
    } catch (err: any) {
      console.error("[integration] VeritaScan auto-complete error:", err.message);
    }

    res.status(201).json(study);
  });

  app.delete("/api/studies/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
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
      // Gate: PT/Coag New Lot Validation is Coming Soon — pending regulatory review
      if (study.studyType === "pt_coag") return res.status(403).json({ error: "PT/Coag New Lot Validation is not yet available" });

      // Fetch CLIA number from user record if authenticated
      let cliaNumber: string | undefined;
      const auth = req.headers.authorization;
      if (auth?.startsWith("Bearer ")) {
        try {
          const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { userId: number };
          const userRow = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(payload.userId) as any;
          cliaNumber = userRow?.clia_number || undefined;
        } catch {}
      }

      const pdfBuffer = await generatePDFBuffer(study, results, cliaNumber);
      const typeMap: Record<string, string> = { cal_ver: "CalVer", precision: "Precision", method_comparison: "MethodComp", lot_to_lot: "LotToLot", pt_coag: "PTCoag" };
      const filename = `VeritaCheck_${typeMap[study.studyType] || "Study"}_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
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

  // ── VERITAMAP ───────────────────────────────────────────────────────────

  function hasMapAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "waived", "community", "hospital", "large_hospital"].includes(user?.plan);
  }

  // List maps
  app.get("/api/veritamap/maps", authMiddleware, (req: any, res) => {
    const maps = (db as any).$client.prepare(
      "SELECT id, name, instruments, created_at, updated_at FROM veritamap_maps WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(req.user.userId);
    const result = maps.map((m: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT active, last_cal_ver, last_method_comp, complexity FROM veritamap_tests WHERE map_id = ?"
      ).all(m.id);
      const activeTests = tests.filter((t: any) => t.active);
      const gaps = activeTests.filter((t: any) =>
        (t.complexity === 'MODERATE' || t.complexity === 'HIGH') &&
        (!t.last_cal_ver || !t.last_method_comp)
      ).length;
      return { ...m, totalTests: activeTests.length, gaps };
    });
    res.json(result);
  });

  // Create map
  app.post("/api/veritamap/maps", authMiddleware, requireWriteAccess, (req: any, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Map name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)"
    ).run(req.user.userId, name.trim(), now, now);
    res.json({ id: Number(result.lastInsertRowid), name: name.trim(), created_at: now, updated_at: now });
  });

  // Delete map
  app.delete("/api/veritamap/maps/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    (db as any).$client.prepare("DELETE FROM veritamap_tests WHERE map_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM veritamap_maps WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get map with all tests
  app.get("/api/veritamap/maps/:id", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    // Fetch tests with per-analyte instrument list (needed for intelligence/correlation)
    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? ORDER BY specialty, analyte").all(req.params.id);
    // For each test, attach the list of instruments running it
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push({ id: row.id, instrument_name: row.instrument_name, role: row.role, category: row.category });
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));
    res.json({ ...map, tests });
  });

  // Bulk upsert tests (used when building from instrument or updating)
  app.put("/api/veritamap/maps/:id/tests", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { tests } = req.body;
    if (!Array.isArray(tests)) return res.status(400).json({ error: "tests array required" });
    const now = new Date().toISOString();
    const stmt = (db as any).$client.prepare(`
      INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source,
        last_cal_ver, last_method_comp, last_precision, last_sop_review, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(map_id, analyte) DO UPDATE SET
        specialty=excluded.specialty, complexity=excluded.complexity, active=excluded.active,
        instrument_source=excluded.instrument_source, last_cal_ver=excluded.last_cal_ver,
        last_method_comp=excluded.last_method_comp, last_precision=excluded.last_precision,
        last_sop_review=excluded.last_sop_review, notes=excluded.notes, updated_at=excluded.updated_at
    `);
    const bulk = (db as any).$client.transaction((tests: any[]) => {
      for (const t of tests) {
        const active = typeof t.active === 'boolean' ? (t.active ? 1 : 0) : (t.active ?? 1);
        stmt.run(req.params.id, t.analyte, t.specialty, t.complexity,
          active, t.instrument_source ?? null,
          t.last_cal_ver ?? null, t.last_method_comp ?? null,
          t.last_precision ?? null, t.last_sop_review ?? null,
          t.notes ?? null, now);
      }
    });
    bulk(tests);
    (db as any).$client.prepare("UPDATE veritamap_maps SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true, count: tests.length });
  });

  // ── INSTRUMENTS ───────────────────────────────────────────────

  // Get all instruments for a map
  app.get("/api/veritamap/maps/:id/instruments", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const instruments = (db as any).$client.prepare(
      "SELECT * FROM veritamap_instruments WHERE map_id = ? ORDER BY role, instrument_name"
    ).all(req.params.id);
    // For each instrument, get its tests
    const result = instruments.map((inst: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity, active FROM veritamap_instrument_tests WHERE instrument_id = ?"
      ).all(inst.id);
      return { ...inst, tests };
    });
    res.json(result);
  });

  // Add instrument to map
  app.post("/api/veritamap/maps/:id/instruments", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    // Freemium limit: 4 instruments per map for free users
    if (!hasMapAccess(req.user)) {
      const count = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(req.params.id).cnt;
      if (count >= 4) return res.status(403).json({ error: "Free plan limit: upgrade to add more than 4 instruments", limitReached: true, limit: 4, type: "instruments" });
    }
    const { instrument_name, role, category } = req.body;
    if (!instrument_name?.trim()) return res.status(400).json({ error: "Instrument name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(req.params.id, instrument_name.trim(), role || 'Primary', category || 'Chemistry', now);
    res.json({ id: Number(result.lastInsertRowid), instrument_name: instrument_name.trim(), role: role || 'Primary', category: category || 'Chemistry', tests: [] });
  });

  // Update instrument role/name
  app.put("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { instrument_name, role, category } = req.body;
    (db as any).$client.prepare(
      "UPDATE veritamap_instruments SET instrument_name=?, role=?, category=? WHERE id=? AND map_id=?"
    ).run(instrument_name, role, category, req.params.instId, req.params.id);
    res.json({ ok: true });
  });

  // Delete instrument (cascades to its tests)
  app.delete("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    (db as any).$client.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id = ?").run(req.params.instId);
    (db as any).$client.prepare("DELETE FROM veritamap_instruments WHERE id = ? AND map_id = ?").run(req.params.instId, req.params.id);
    res.json({ ok: true });
  });

  // Set tests for an instrument (replaces all)
  app.put("/api/veritamap/maps/:id/instruments/:instId/tests", authMiddleware, requireWriteAccess, (req: any, res) => {
    try {
      const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
      if (!map) return res.status(404).json({ error: "Map not found" });
      const { tests } = req.body; // [{ analyte, specialty, complexity, active }]
      if (!Array.isArray(tests)) return res.status(400).json({ error: "tests array required" });
      console.log(`[VeritaMap] Saving ${tests.length} tests for instrument ${req.params.instId} on map ${req.params.id}`);
      // Freemium limit: 10 total analytes across all instruments for free users
      if (!hasMapAccess(req.user)) {
        // Count active analytes from OTHER instruments (not the one being replaced)
        const otherCount = (db as any).$client.prepare(
          "SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE map_id = ? AND instrument_id != ? AND active = 1"
        ).get(req.params.id, req.params.instId).cnt;
        const newActive = tests.filter((t: any) => t.active !== 0 && t.active !== false).length;
        if (otherCount + newActive > 10) return res.status(403).json({ error: "Free plan limit: upgrade to add more than 10 analytes", limitReached: true, limit: 10, type: "analytes", current: otherCount + newActive });
      }
      // Replace all tests for this instrument
      (db as any).$client.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id = ?").run(req.params.instId);
      const stmt = (db as any).$client.prepare(
        "INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, ?)"
      );
      const bulk = (db as any).$client.transaction((tests: any[]) => {
        for (const t of tests) {
          const active = typeof t.active === 'boolean' ? (t.active ? 1 : 0) : (t.active ?? 1);
          stmt.run(req.params.instId, req.params.id, String(t.analyte || ''), String(t.specialty || ''), String(t.complexity || ''), active);
        }
      });
      bulk(tests);
      // Rebuild the merged veritamap_tests from all instruments
      rebuildMapTests(req.params.id);
      const savedCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE instrument_id = ? AND map_id = ?").get(req.params.instId, req.params.id).cnt;
      console.log(`[VeritaMap] Saved ${savedCount} instrument tests, rebuilding map tests`);
      const mapTestCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_tests WHERE map_id = ?").get(req.params.id).cnt;
      console.log(`[VeritaMap] Map ${req.params.id} now has ${mapTestCount} total tests in veritamap_tests`);
      res.json({ ok: true, count: tests.length });
    } catch (err: any) {
      console.error(`[VeritaMap] Error saving instrument tests:`, err);
      res.status(500).json({ error: err.message || "Failed to save tests" });
    }
  });

  // Intelligence endpoint: compute correlation + cal ver requirements
  app.get("/api/veritamap/maps/:id/intelligence", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });

    // Get all active instrument-test pairs
    const rows = (db as any).$client.prepare(`
      SELECT it.analyte, it.specialty, it.complexity,
             i.instrument_name, i.role, i.id as instrument_id
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);

    // Group by analyte
    const byAnalyte: Record<string, any[]> = {};
    for (const row of rows) {
      if (!byAnalyte[row.analyte]) byAnalyte[row.analyte] = [];
      byAnalyte[row.analyte].push(row);
    }

    const intelligence: Record<string, any> = {};
    for (const [analyte, instruments] of Object.entries(byAnalyte)) {
      const complexity = instruments[0].complexity;
      const isWaived = complexity === 'WAIVED';
      const correlationRequired = instruments.length >= 2;
      const calVerRequired = !isWaived;

      intelligence[analyte] = {
        complexity,
        isWaived,
        calVerRequired,
        calVerFrequency: calVerRequired ? 'Every 6 months (42 CFR §493.1255)' : 'Exempt — waived test',
        correlationRequired,
        correlationReason: correlationRequired
          ? `${instruments.length} instruments performing this test (${instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join(', ')}) — 42 CFR §493.1213, TJC QSA.04.05.01`
          : null,
        instruments: instruments.map((i: any) => ({ name: i.instrument_name, role: i.role, id: i.instrument_id })),
      };
    }

    // Summary counts
    const correlationCount = Object.values(intelligence).filter((i: any) => i.correlationRequired).length;
    const calVerCount = Object.values(intelligence).filter((i: any) => i.calVerRequired).length;

    res.json({ intelligence, correlationCount, calVerCount, totalAnalytes: Object.keys(intelligence).length });
  });

  // Freemium limits info for a map
  app.get("/api/veritamap/maps/:id/limits", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const isFree = !hasMapAccess(req.user);
    const instrumentCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(req.params.id).cnt;
    const analyteCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instrument_tests WHERE map_id = ? AND active = 1").get(req.params.id).cnt;
    res.json({
      isFree,
      instrumentCount,
      analyteCount,
      instrumentLimit: isFree ? 4 : null,
      analyteLimit: isFree ? 10 : null,
    });
  });

  // Helper: rebuild merged map tests from instrument tests
  function rebuildMapTests(mapId: string | number) {
    const rows = (db as any).$client.prepare(`
      SELECT DISTINCT it.analyte, it.specialty, it.complexity, i.instrument_name
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(mapId);
    const now = new Date().toISOString();
    // Keep existing date/notes data, just ensure all analytes exist
    const stmt = (db as any).$client.prepare(`
      INSERT OR IGNORE INTO veritamap_tests
        (map_id, analyte, specialty, complexity, active, instrument_source, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `);
    const bulk = (db as any).$client.transaction((rows: any[]) => {
      for (const r of rows) {
        stmt.run(mapId, r.analyte, r.specialty, r.complexity, r.instrument_name, now);
      }
    });
    bulk(rows);
  }

  // Update single test
  app.put("/api/veritamap/maps/:id/tests/:analyte", authMiddleware, requireWriteAccess, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { active: rawActive, last_cal_ver, last_method_comp, last_precision, last_sop_review, notes } = req.body;
    const active = typeof rawActive === 'boolean' ? (rawActive ? 1 : 0) : rawActive;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      UPDATE veritamap_tests SET active=?, last_cal_ver=?, last_method_comp=?,
        last_precision=?, last_sop_review=?, notes=?, updated_at=?
      WHERE map_id=? AND analyte=?
    `).run(active, last_cal_ver ?? null, last_method_comp ?? null,
      last_precision ?? null, last_sop_review ?? null, notes ?? null, now,
      req.params.id, decodeURIComponent(req.params.analyte));
    (db as any).$client.prepare("UPDATE veritamap_maps SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // ── VERITAMAP EXCEL EXPORT ────────────────────────────────────────────────
  app.post("/api/veritamap/maps/:id/excel", authMiddleware, async (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    if (!hasMapAccess(req.user)) return res.status(403).json({ error: "VeritaMap subscription required" });

    // Fetch tests (same as map detail endpoint)
    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1 ORDER BY specialty, analyte").all(req.params.id);
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(req.params.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push(row);
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));

    // Sort by Department → Specialty → Analyte (A-Z)
    tests.sort((a: any, b: any) => {
      const catA = (a.instruments[0]?.category || "").toLowerCase();
      const catB = (b.instruments[0]?.category || "").toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const specA = (a.specialty || "").toLowerCase();
      const specB = (b.specialty || "").toLowerCase();
      if (specA !== specB) return specA.localeCompare(specB);
      return (a.analyte || "").toLowerCase().localeCompare((b.analyte || "").toLowerCase());
    });

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();

      // ── Sheet 1: Compliance Map ──
      const ws = wb.addWorksheet("Compliance Map");

      const headers = [
        "Analyte", "Instruments", "Department", "Specialty", "Complexity",
        "Number of Instruments", "CFR Section", "Correlation Required",
        "Typical Unit of Measure", "Typical Adult Reference Range", "Typical AMR",
        "Critical Low (Mayo Clinic Laboratories)", "Critical High (Mayo Clinic Laboratories)", "Critical Value Units (Mayo Clinic Laboratories)",
        "Lab Critical Low", "Lab Critical High", "Lab AMR Low", "Lab AMR High",
        "Last Cal Ver Date", "Cal Ver Status", "Last Method Comp Date", "Method Comp Status",
        "Last Precision Date", "Precision Status", "Last SOP Review Date", "SOP Review Status",
        "Notes",
      ];

      // Column widths
      const colWidths = [
        20, 55, 18, 20, 14, 22, 14, 20, 22, 22, 25, 14, 14, 18, 14, 14, 12, 12,
        18, 18, 18, 18, 18, 18, 18, 18, 18,
      ];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      // Build data rows
      const rows = tests.map((t: any) => {
        const instruments = t.instruments || [];
        const instrList = instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join("; ");
        const instrCount = instruments.length;
        const department = instruments[0]?.category || t.specialty || "";
        const isWaived = t.complexity === "WAIVED";
        const correlReq = !isWaived && instrCount >= 2 ? "Yes" : "No";
        const cfr = VERITAMAP_CFR_MAP[t.specialty] ?? "§493.945";
        const mayo = lookupAnalyte(MAYO_CRITICAL_VALUES, t.analyte);
        const unit = lookupAnalyte(UNITS_LOOKUP, t.analyte) || "";
        const refRange = lookupAnalyte(REFERENCE_RANGES, t.analyte) || "";
        const amr = lookupAnalyte(AMR_LOOKUP, t.analyte) || "";
        const calVerStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_cal_ver, 6);
        const mcStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_method_comp, 6);
        const precStatus = isWaived ? "N/A (Waived)" : getComplianceStatus(t.last_precision, 6);
        const sopStatus = getComplianceStatus(t.last_sop_review, 24);

        return [
          t.analyte,
          instrList,
          department,
          t.specialty,
          t.complexity,
          instrCount,
          cfr,
          correlReq,
          unit ? `${unit}` : "",
          refRange ? `${refRange} — Typical (verify w/ package insert)` : "",
          amr ? `${amr} — Typical (verify w/ package insert)` : "",
          mayo?.low || "",
          mayo?.high || "",
          mayo?.units || "",
          "", // Lab Critical Low (blank for lab to fill)
          "", // Lab Critical High (blank for lab to fill)
          "", // Lab AMR Low (blank for lab to fill)
          "", // Lab AMR High (blank for lab to fill)
          t.last_cal_ver || "",
          calVerStatus,
          t.last_method_comp || "",
          mcStatus,
          t.last_precision || "",
          precStatus,
          t.last_sop_review || "",
          sopStatus,
          t.notes || "",
        ];
      });

      // Add data rows
      for (const row of rows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      const statusCols = [20, 22, 24, 26]; // 1-indexed: Cal Ver Status, Method Comp Status, Precision Status, SOP Status
      const dateCols = [19, 21, 23, 25];   // 1-indexed: date columns
      const numCol = 6; // 1-indexed: Number of Instruments
      for (let r = 2; r <= rows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0; // row 2=even, row 3=odd, ...
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          // Alternating row background
          let fillColor = bgColor;

          // Lab fill-in columns (15-18, 1-indexed = Lab Critical Low/High, Lab AMR Low/High)
          if (colNumber >= 15 && colNumber <= 18) {
            fillColor = "FFDDEEFF";
          }

          // Status columns: color-code based on value
          if (statusCols.includes(colNumber)) {
            const val = String(cell.value || "");
            if (/Overdue|Expired/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Compliant|Current|Pass/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/N\/A|Not Required/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            } else if (val === "Missing") {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };

          // Date columns — center align
          if (dateCols.includes(colNumber)) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          // Number of Instruments — right align
          if (colNumber === numCol) {
            cell.alignment = { horizontal: "right", vertical: "middle" };
          }
        });
      }

      // ── Add notes to critical-value header cells (columns L, M, N = 12, 13, 14) ──
      const critNote = "Source: Mayo Clinic Laboratories Critical Values / Critical Results List. These are Mayo Clinic's published critical thresholds, provided as a reference. Each laboratory must establish and approve its own critical value policy.";
      for (const col of [12, 13, 14]) {
        headerRow.getCell(col).note = critNote;
      }

      // Freeze pane at C2: cols A-B frozen + header row frozen
      ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];

      // Auto-filter on all columns
      // Convert column number to Excel letter(s) (1=A, 27=AA, etc.)
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      // ── Sheet 2: Instructions ──
      const ws2 = wb.addWorksheet("Instructions");
      ws2.getColumn(1).width = 100;
      for (const instrRow of INSTRUCTIONS_CONTENT) {
        ws2.addRow(instrRow);
      }
      // Style the title row
      const titleCell = ws2.getCell("A1");
      titleCell.font = { bold: true, size: 14, color: { argb: "FF01696F" } };

      // Write to buffer
      const buffer = await wb.xlsx.writeBuffer();
      const safeName = (map.name || "Map").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const filename = `VeritaMap_${safeName}_${date}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("VeritaMap Excel generation error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── VERITASCAN ───────────────────────────────────────────────────────────

  // Check access: annual, lab, or veritascan plan
  function hasScanAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritascan", "waived", "community", "hospital", "large_hospital"].includes(user?.plan);
  }

  // List scans for current user
  app.get("/api/veritascan/scans", authMiddleware, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scans = (db as any).$client.prepare(
      "SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(req.user.userId);
    // For each scan, add completion stats
    const result = scans.map((s: any) => {
      const items = (db as any).$client.prepare(
        "SELECT status FROM veritascan_items WHERE scan_id = ?"
      ).all(s.id);
      const total = 168;
      const assessed = items.filter((i: any) => i.status !== 'Not Assessed').length;
      const compliant = items.filter((i: any) => i.status === 'Compliant').length;
      const issues = items.filter((i: any) => ['Needs Attention','Immediate Action'].includes(i.status)).length;
      return { ...s, total, assessed, compliant, issues };
    });
    res.json(result);
  });

  // Create new scan
  app.post("/api/veritascan/scans", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Scan name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO veritascan_scans (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
    ).run(req.user.userId, name.trim(), now, now);
    res.json({ id: Number(result.lastInsertRowid), name: name.trim(), created_at: now, updated_at: now });
  });

  // Delete scan
  app.delete("/api/veritascan/scans/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    (db as any).$client.prepare("DELETE FROM veritascan_items WHERE scan_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM veritascan_scans WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get all items for a scan
  app.get("/api/veritascan/scans/:id/items", authMiddleware, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const items = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
    ).all(req.params.id);
    res.json(items);
  });

  // Upsert item status/notes/owner/due_date
  app.put("/api/veritascan/scans/:id/items/:itemId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const { status, notes, owner, due_date } = req.body;
    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        owner = excluded.owner,
        due_date = excluded.due_date,
        updated_at = excluded.updated_at
    `).run(req.params.id, req.params.itemId, status || 'Not Assessed', notes || null, owner || null, due_date || null, now);
    // Update scan updated_at
    (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // Bulk update items (for efficient auto-save)
  app.put("/api/veritascan/scans/:id/items", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });
    const { items } = req.body; // Array of { item_id, status, notes, owner, due_date }
    if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
    const now = new Date().toISOString();
    const stmt = (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = excluded.status, notes = excluded.notes,
        owner = excluded.owner, due_date = excluded.due_date,
        updated_at = excluded.updated_at
    `);
    const bulkUpdate = (db as any).$client.transaction((items: any[]) => {
      for (const item of items) {
        stmt.run(req.params.id, item.item_id, item.status || 'Not Assessed', item.notes || null, item.owner || null, item.due_date || null, now);
      }
    });
    bulkUpdate(items);
    (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true, count: items.length });
  });

  // ── VERITASCAN EXCEL EXPORT ──────────────────────────────────────────────
  app.post("/api/veritascan/excel/:scanId", authMiddleware, async (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const scanId = req.params.scanId;
    const scan = (db as any).$client.prepare("SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE id = ? AND user_id = ?").get(scanId, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });

    // Get saved items from DB
    const dbItems = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date FROM veritascan_items WHERE scan_id = ?"
    ).all(scanId);
    const itemMap: Record<number, any> = {};
    for (const row of dbItems) {
      itemMap[row.item_id] = row;
    }

    // Client sends the reference data (questions, citations) so server doesn't need to duplicate it
    const { referenceItems } = req.body; // Array of { id, domain, question, tjc, cap, cfr }
    if (!Array.isArray(referenceItems) || referenceItems.length === 0) {
      return res.status(400).json({ error: "referenceItems array required" });
    }

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("VeritaScan");

      const headers = [
        "Item #", "Domain", "Compliance Question", "TJC Standard",
        "CAP Requirement", "42 CFR Citation", "Status", "Owner", "Due Date", "Notes"
      ];

      // Column widths
      const colWidths = [10, 28, 80, 22, 18, 24, 18, 20, 16, 40];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] }));

      // Build data rows
      const dataRows = referenceItems.map((ref: any) => {
        const saved = itemMap[ref.id] || {};
        return [
          ref.id,
          ref.domain,
          ref.question,
          ref.tjc || "",
          ref.cap || "",
          ref.cfr || "",
          saved.status || "Not Assessed",
          saved.owner || "",
          saved.due_date || "",
          saved.notes || "",
        ];
      });
      for (const row of dataRows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      const statusCol = 7; // 1-indexed: Status
      const dateCol = 9;   // 1-indexed: Due Date
      for (let r = 2; r <= dataRows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          let fillColor = bgColor;

          // Status column — color-code based on value
          if (colNumber === statusCol) {
            const val = String(cell.value || "");
            if (/Fail|Overdue|Expired|Non-[Cc]ompliant/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Pass|Compliant|Current|Active|^Yes$/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/N\/A|Not Required|Not Assessed/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          // Date column — center align
          if (colNumber === dateCol) {
            cell.alignment = { horizontal: "center", vertical: "middle" };
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
        });
      }

      // Freeze pane at C2: cols A-B frozen + header row frozen (Item # + Domain stay visible)
      ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];

      // Auto-filter on all columns
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const safeName = (scan.name || "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const filename = `VeritaScan_${safeName}_${date}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("Excel generation error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── VERITASCAN PDF EXPORT ─────────────────────────────────────────────────
  app.post("/api/veritascan/pdf/:scanId/:type", authMiddleware, async (req: any, res) => {
    if (!hasScanAccess(req.user)) return res.status(403).json({ error: "VeritaScan subscription required" });
    const { scanId, type } = req.params;
    if (type !== "executive" && type !== "full") return res.status(400).json({ error: "type must be 'executive' or 'full'" });

    const scan = (db as any).$client.prepare(
      "SELECT id, name, created_at, updated_at FROM veritascan_scans WHERE id = ? AND user_id = ?"
    ).get(scanId, req.user.userId);
    if (!scan) return res.status(404).json({ error: "Scan not found" });

    // Get saved items from DB
    const dbItems = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date FROM veritascan_items WHERE scan_id = ?"
    ).all(scanId);
    const itemMap: Record<number, any> = {};
    for (const row of dbItems) {
      itemMap[row.item_id] = row;
    }

    // Client sends the reference data (questions, citations) so server doesn't need to duplicate it
    const { referenceItems } = req.body || {};
    if (!Array.isArray(referenceItems) || referenceItems.length === 0) {
      return res.status(400).json({ error: "referenceItems array required" });
    }

    // Merge reference data with DB statuses
    const mergedItems = referenceItems.map((ref: any) => {
      const saved = itemMap[ref.id] || {};
      return {
        id: ref.id,
        domain: ref.domain,
        question: ref.question,
        tjc: ref.tjc || "",
        cap: ref.cap || "",
        cfr: ref.cfr || "",
        status: saved.status || "Not Assessed",
        notes: saved.notes || "",
        owner: saved.owner || "",
        due_date: saved.due_date || "",
      };
    });

    // Fetch CLIA number
    const scanUserRow = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(req.userId) as any;

    try {
      const pdfBuffer = await generateVeritaScanPDF(
        {
          scanName: scan.name,
          createdAt: scan.created_at,
          updatedAt: scan.updated_at,
          items: mergedItems,
          cliaNumber: scanUserRow?.clia_number || undefined,
        },
        type as "executive" | "full"
      );

      if (!pdfBuffer || pdfBuffer.length === 0) {
        console.error("VeritaScan PDF generation returned empty buffer");
        return res.status(500).json({ error: "PDF generation failed — empty output" });
      }

      const safeName = (scan.name || "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const label = type === "executive" ? "Executive" : "Full";
      const filename = `VeritaScan_${label}_${safeName}_${date}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("VeritaScan PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── NEWSLETTER ────────────────────────────────────────────────────────────
  app.post("/api/newsletter/subscribe", async (req, res) => {
    const { email, name, source } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

    const sqlite = (db as any).session?.client || require("better-sqlite3");
    try {
      // Check for existing subscriber
      const existing = (db as any).$client.prepare(
        "SELECT id, active FROM newsletter_subscribers WHERE email = ?"
      ).get(email.toLowerCase().trim());

      if (existing) {
        if (existing.active) return res.json({ success: true, message: "already_subscribed" });
        // Re-subscribe if they previously unsubscribed
        (db as any).$client.prepare(
          "UPDATE newsletter_subscribers SET active = 1, unsubscribed_at = NULL, subscribed_at = ? WHERE email = ?"
        ).run(new Date().toISOString(), email.toLowerCase().trim());
      } else {
        (db as any).$client.prepare(
          "INSERT INTO newsletter_subscribers (email, name, source, subscribed_at) VALUES (?, ?, ?, ?)"
        ).run(email.toLowerCase().trim(), name || null, source || "website", new Date().toISOString());
      }

      // Send welcome email via Resend
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Michael Veri <info@veritaslabservices.com>",
            to: email.toLowerCase().trim(),
            subject: "Welcome to The Lab Director's Briefing",
            html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: Georgia, serif; color: #28251D; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6; }
  h1 { font-size: 22px; color: #01696F; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: normal; color: #7A7974; margin-top: 0; }
  .divider { border: none; border-top: 1px solid #D4D1CA; margin: 24px 0; }
  .cta { display: inline-block; background: #01696F; color: white; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-family: sans-serif; font-size: 14px; font-weight: 600; margin: 8px 4px 8px 0; }
  .cta-outline { display: inline-block; border: 1.5px solid #01696F; color: #01696F; padding: 10px 22px; border-radius: 6px; text-decoration: none; font-family: sans-serif; font-size: 14px; font-weight: 600; margin: 8px 4px; }
  .sig { font-size: 13px; color: #7A7974; }
  p { font-size: 15px; }
</style></head>
<body>
  <h1>The Lab Director's Briefing</h1>
  <h2>From Veritas Lab Services</h2>
  <hr class="divider">
  <p>${name ? `${name},` : "Hello,"}</p>
  <p>You're in. Welcome to <strong>The Lab Director's Briefing</strong> — practical, regulation-backed guidance for clinical laboratory leaders, written by a former Joint Commission surveyor with 200+ facility inspections.</p>
  <p>Here's what you can expect:</p>
  <ul>
    <li><strong>Regulatory clarity</strong> — What CLIA, TJC, and CAP actually require, in plain language</li>
    <li><strong>Surveyor callouts</strong> — What I actually looked for across 200+ inspections</li>
    <li><strong>Tools and resources</strong> — Free guides, lookup tools, and study aids for your lab</li>
  </ul>
  <p>While you're here, two free resources worth bookmarking:</p>
  <a href="https://www.veritaslabservices.com/#/resources/clia-tea-lookup" class="cta">CLIA TEa Lookup Tool</a>
  <a href="https://www.veritaslabservices.com/#/resources/clia-calibration-verification-method-comparison" class="cta-outline">Cal Ver Guide</a>
  <hr class="divider">
  <p class="sig">
    Michael Veri, MS, MBA, MLS(ASCP), CPHQ<br>
    Owner, Veritas Lab Services, LLC<br>
    Former Joint Commission Laboratory Surveyor<br>
    <a href="https://www.veritaslabservices.com" style="color: #01696F;">veritaslabservices.com</a>
  </p>
  <p style="font-size: 11px; color: #BAB9B4;">You're receiving this because you subscribed at veritaslabservices.com. To unsubscribe, reply with "unsubscribe" in the subject line.</p>
</body>
</html>
            `,
          }),
        });
      } catch (emailErr) {
        console.error("[newsletter] Welcome email failed:", emailErr);
        // Don't fail the subscription if email fails
      }

      res.json({ success: true, message: "subscribed" });
    } catch (err: any) {
      console.error("[newsletter] Subscribe error:", err);
      res.status(500).json({ error: "Subscription failed. Please try again." });
    }
  });

  // Admin — view subscribers
  app.get("/api/admin/newsletter", (req, res) => {
    const { secret } = req.query;
    if (secret !== process.env.ADMIN_SECRET && secret !== "veritas-admin-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      const subscribers = (db as any).$client.prepare(
        "SELECT id, email, name, source, subscribed_at, active FROM newsletter_subscribers ORDER BY subscribed_at DESC"
      ).all();
      res.json({ count: subscribers.filter((s: any) => s.active).length, subscribers });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch subscribers" });
    }
  });

  // ── STRIPE ────────────────────────────────────────────────────────────────
  // Create a checkout session for per-study ($25) or subscription plans
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
    const { priceType, discountCode, additionalSeats } = req.body;
    // priceType: "perStudy" | "waived" | "community" | "hospital" | "large_hospital" | "veritacheck_only"
    if (!priceType || !PRICES[priceType as keyof typeof PRICES]) {
      return res.status(400).json({ error: "Invalid price type" });
    }
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const priceId = PRICES[priceType as keyof typeof PRICES];
    const isSubscription = priceType !== "perStudy";
    const successUrl = `${FRONTEND_URL}/#/veritacheck?payment=success&type=${priceType}`;
    const cancelUrl = `${FRONTEND_URL}/#/veritacheck?payment=cancelled`;

    // Validate discount code if provided
    let couponId: string | undefined;
    let discountRow: any = null;
    if (discountCode) {
      discountRow = db.$client.prepare("SELECT * FROM discount_codes WHERE UPPER(code) = UPPER(?)").get(discountCode.trim()) as any;
      if (discountRow && discountRow.active && (discountRow.max_uses === null || discountRow.uses < discountRow.max_uses) && (discountRow.applies_to === "all" || discountRow.applies_to === priceType || discountRow.applies_to === "annual" || discountRow.applies_to === "all")) {
        try {
          const coupon = await stripe.coupons.create({
            percent_off: discountRow.discount_pct,
            duration: "once",
            name: `${discountRow.partner_name} - ${discountRow.discount_pct}% off`,
          });
          couponId = coupon.id;
        } catch (err: any) {
          console.error("Stripe coupon creation error:", err.message);
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

      // Build line items: base plan + optional additional seats
      const lineItems: any[] = [{ price: priceId, quantity: 1 }];
      const totalSeats = 1 + (additionalSeats || 0);
      if (additionalSeats && additionalSeats > 0 && priceType !== "veritacheck_only") {
        const seatTier = getSeatPrice(totalSeats);
        if (seatTier) {
          lineItems.push({ price: seatTier.priceId, quantity: additionalSeats });
        }
      }

      const sessionParams: any = {
        customer: customerId,
        mode: isSubscription ? "subscription" : "payment",
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { userId: String(user.id), priceType, totalSeats: String(totalSeats) },
      };
      if (couponId) {
        sessionParams.discounts = [{ coupon: couponId }];
      }

      const session = await stripe.checkout.sessions.create(sessionParams);

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
        const totalSeats = parseInt(session.metadata?.totalSeats || "1");
        if (userId) {
          // Calculate subscription expiry (1 year from now for annual plans)
          const expiresAt = new Date();
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          const expiresAtISO = expiresAt.toISOString();

          if (priceType === "perStudy") {
            storage.addStudyCredits(userId, 1);
          } else if (["waived", "community", "hospital", "large_hospital", "veritacheck_only"].includes(priceType) && session.subscription) {
            // New tiered plans
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType,
            });
            (db as any).$client.prepare(
              "UPDATE users SET subscription_expires_at = ?, subscription_status = 'active', plan_expires_at = ?, seat_count = ? WHERE id = ?"
            ).run(expiresAtISO, expiresAtISO, totalSeats, userId);
          } else if (["starter", "professional", "lab", "complete", "annual"].includes(priceType) && session.subscription) {
            // Backward compatibility for legacy plans
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType === "complete" ? "lab" : priceType,
            });
            (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'active' WHERE id = ?").run(expiresAtISO, userId);
          }
        }
      } else if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as any;
        const user = storage.getUserByStripeCustomerId(sub.customer);
        if (user) {
          storage.updateUserStripe(user.id, { stripeSubscriptionId: null, plan: "free" });
          // Set expiry to now and status to expired for data retention policy
          const nowISO = new Date().toISOString();
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'expired' WHERE id = ?").run(nowISO, user.id);
        }
      } else if (event.type === "customer.subscription.updated") {
        // Subscription renewed — update expiry
        const sub = event.data.object as any;
        const user = storage.getUserByStripeCustomerId(sub.customer);
        if (user && sub.current_period_end) {
          const newExpiry = new Date(sub.current_period_end * 1000).toISOString();
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'active' WHERE id = ?").run(newExpiry, user.id);
        }
      } else if (event.type === "invoice.payment_failed") {
        // Set payment_failed status — grace period of 7 days, then read_only
        const invoice = event.data.object as any;
        console.warn("Payment failed for customer:", invoice.customer);
        const user = storage.getUserByStripeCustomerId(invoice.customer);
        if (user) {
          // Set expiry to 7 days from now (grace period)
          const gracePeriod = new Date();
          gracePeriod.setDate(gracePeriod.getDate() + 7);
          (db as any).$client.prepare("UPDATE users SET subscription_expires_at = ?, subscription_status = 'payment_failed' WHERE id = ?").run(gracePeriod.toISOString(), user.id);
        }
      }
    } catch (err: any) {
      console.error("Webhook processing error:", err.message);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    res.json({ received: true });
  });

  // ── CUMSUM TRACKER ──────────────────────────────────────────────────────
  function hasCheckAccess(user: any) {
    return ["annual", "starter", "professional", "lab", "complete", "per_study", "waived", "community", "hospital", "large_hospital", "veritacheck_only"].includes(user?.plan) || (user?.userId && user.userId <= 11);
  }

  // List trackers for user
  app.get("/api/cumsum/trackers", authMiddleware, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const trackers = (db as any).$client.prepare(
      "SELECT * FROM cumsum_trackers WHERE user_id = ? ORDER BY created_at DESC"
    ).all(req.user.userId);
    // Attach last entry info to each tracker
    const result = trackers.map((t: any) => {
      const lastEntry = (db as any).$client.prepare(
        "SELECT cumsum, verdict, created_at FROM cumsum_entries WHERE tracker_id = ? ORDER BY id DESC LIMIT 1"
      ).get(t.id);
      return { ...t, lastCumsum: lastEntry?.cumsum ?? 0, lastVerdict: lastEntry?.verdict ?? "N/A", lastEntryDate: lastEntry?.created_at ?? null };
    });
    res.json(result);
  });

  // Create tracker
  app.post("/api/cumsum/trackers", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const { instrumentName, analyte } = req.body;
    if (!instrumentName?.trim()) return res.status(400).json({ error: "Instrument name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO cumsum_trackers (user_id, instrument_name, analyte, created_at) VALUES (?, ?, ?, ?)"
    ).run(req.user.userId, instrumentName.trim(), analyte || "PTT", now);
    res.json({ id: Number(result.lastInsertRowid), user_id: req.user.userId, instrument_name: instrumentName.trim(), analyte: analyte || "PTT", created_at: now });
  });

  // Delete tracker
  app.delete("/api/cumsum/trackers/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    const tracker = (db as any).$client.prepare("SELECT id FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    (db as any).$client.prepare("DELETE FROM cumsum_entries WHERE tracker_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM cumsum_trackers WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Get tracker with all entries
  app.get("/api/cumsum/trackers/:id", authMiddleware, (req: any, res) => {
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare(
      "SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC"
    ).all(req.params.id);
    res.json({ ...tracker, entries });
  });

  // Add entry to tracker
  app.post("/api/cumsum/trackers/:id/entries", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const { year, lotLabel, oldLotNumber, newLotNumber, oldLotGeomean, newLotGeomean, difference, cumsum, verdict, specimenData, notes } = req.body;
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      `INSERT INTO cumsum_entries (tracker_id, year, lot_label, old_lot_number, new_lot_number, old_lot_geomean, new_lot_geomean, difference, cumsum, verdict, specimen_data, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, year, lotLabel, oldLotNumber || null, newLotNumber || null, oldLotGeomean ?? null, newLotGeomean ?? null, difference ?? null, cumsum ?? null, verdict || null, specimenData ? JSON.stringify(specimenData) : null, notes || null, now);
    res.json({ id: Number(result.lastInsertRowid), tracker_id: parseInt(req.params.id), year, lot_label: lotLabel, old_lot_number: oldLotNumber, new_lot_number: newLotNumber, old_lot_geomean: oldLotGeomean, new_lot_geomean: newLotGeomean, difference, cumsum, verdict, specimen_data: specimenData, notes, created_at: now });
  });

  // Delete entry
  app.delete("/api/cumsum/entries/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    const entry = (db as any).$client.prepare(
      "SELECT e.id, t.user_id FROM cumsum_entries e JOIN cumsum_trackers t ON e.tracker_id = t.id WHERE e.id = ?"
    ).get(req.params.id);
    if (!entry || entry.user_id !== req.user.userId) return res.status(404).json({ error: "Entry not found" });
    (db as any).$client.prepare("DELETE FROM cumsum_entries WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // CUMSUM Excel export
  app.get("/api/cumsum/trackers/:id/excel", authMiddleware, async (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(req.params.id);
    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("CUMSUM");

      const headers = [
        "Year", "Lot Label", "Old Lot #", "New Lot #",
        "Old GeoMean (sec)", "New GeoMean (sec)", "Difference (sec)",
        "CumSum (sec)", "Verdict", "Notes"
      ];

      // Column widths
      const colWidths = [10, 20, 16, 16, 18, 18, 18, 16, 18, 35];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] }));

      // Build data rows
      const dataRows = entries.map((e: any) => [
        e.year,
        e.lot_label,
        e.old_lot_number || "",
        e.new_lot_number || "",
        e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : "",
        e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : "",
        e.difference != null ? Number(e.difference).toFixed(1) : "",
        e.cumsum != null ? Number(e.cumsum).toFixed(1) : "",
        e.verdict || "",
        e.notes || "",
      ]);
      for (const row of dataRows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // ── Header row (row 1) ──
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // ── Data rows (row 2 onward) ──
      const verdictCol = 9; // 1-indexed: Verdict
      for (let r = 2; r <= dataRows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // Base styling
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;

          let fillColor = bgColor;

          // Verdict column — color-code based on value
          if (colNumber === verdictCol) {
            const val = String(cell.value || "");
            if (/Pass|Compliant|Current|Active|^Yes$|Accept/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            } else if (/Fail|Overdue|Expired|Non-[Cc]ompliant|Reject/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Due Soon|Pending|In Progress/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/N\/A|Not Required/i.test(val)) {
              cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
            }
          }

          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
        });
      }

      // Freeze pane at B2: col A frozen + header row frozen (Year stays visible)
      ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 1, topLeftCell: "B2" }];

      // Auto-filter on all columns
      const lastColNum = headers.length;
      const lastColLetter = lastColNum <= 26
        ? String.fromCharCode(64 + lastColNum)
        : String.fromCharCode(64 + Math.floor((lastColNum - 1) / 26)) + String.fromCharCode(65 + ((lastColNum - 1) % 26));
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const safeName = tracker.instrument_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `CUMSUM_${safeName}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (e: any) {
      console.error("CUMSUM Excel error:", e);
      res.status(500).json({ error: "Excel generation failed" });
    }
  });

  // ── ONBOARDING ──────────────────────────────────────────────────────────
  app.post("/api/auth/complete-onboarding", authMiddleware, (req: any, res) => {
    (db as any).$client.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(req.userId);
    res.json({ ok: true });
  });

  // ── DEMO DATA APIs (all public, NO auth middleware) ─────────────────────

  function getDemoUserId(): number | null {
    const demoUser = (db as any).$client.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get();
    return demoUser ? demoUser.id : null;
  }

  // Legacy endpoint - kept for backwards compatibility
  app.get("/api/demo/data", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.json({ maps: [], scans: [], studies: [], cumsumTrackers: [] });

    const maps = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").all(userId);
    const mapsWithData = maps.map((m: any) => {
      const instruments = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(m.id);
      const instrumentsWithTests = instruments.map((inst: any) => {
        const tests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(inst.id);
        return { ...inst, tests };
      });
      const mapTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ?").all(m.id);

      const rows = (db as any).$client.prepare(`
        SELECT it.analyte, it.specialty, it.complexity,
               i.instrument_name, i.role, i.id as instrument_id
        FROM veritamap_instrument_tests it
        JOIN veritamap_instruments i ON i.id = it.instrument_id
        WHERE it.map_id = ? AND it.active = 1
      `).all(m.id);

      const byAnalyte: Record<string, any[]> = {};
      for (const row of rows) {
        if (!byAnalyte[row.analyte]) byAnalyte[row.analyte] = [];
        byAnalyte[row.analyte].push(row);
      }
      const intelligence: Record<string, any> = {};
      for (const [analyte, insts] of Object.entries(byAnalyte)) {
        const complexity = insts[0].complexity;
        const isWaived = complexity === 'WAIVED';
        intelligence[analyte] = {
          complexity,
          isWaived,
          calVerRequired: !isWaived,
          correlationRequired: insts.length >= 2,
          instruments: insts.map((i: any) => ({ name: i.instrument_name, role: i.role, id: i.instrument_id })),
        };
      }

      return { ...m, instruments: instrumentsWithTests, tests: mapTests, intelligence };
    });

    const scans = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE user_id = ?").all(userId);
    const scansWithItems = scans.map((s: any) => {
      const items = (db as any).$client.prepare(
        "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
      ).all(s.id);
      const total = 168;
      const assessed = items.filter((i: any) => i.status !== 'Not Assessed').length;
      const compliant = items.filter((i: any) => i.status === 'Compliant').length;
      return { ...s, items, total, assessed, compliant };
    });

    const studies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id DESC").all(userId);

    const trackers = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE user_id = ?").all(userId);
    const trackersWithEntries = trackers.map((t: any) => {
      const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(t.id);
      return { ...t, entries };
    });

    res.json({
      maps: mapsWithData,
      scans: scansWithItems,
      studies,
      cumsumTrackers: trackersWithEntries,
    });
  });

  // GET /api/demo/overview - lab summary stats
  app.get("/api/demo/overview", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const studyCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM studies WHERE user_id = ?").get(userId)?.cnt || 0;
    const scan = (db as any).$client.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").get(userId);
    let scanPct = 0;
    if (scan) {
      const items = (db as any).$client.prepare("SELECT status FROM veritascan_items WHERE scan_id = ?").all(scan.id);
      const assessed = items.filter((i: any) => i.status !== "Not Assessed").length;
      scanPct = Math.round((assessed / 168) * 100);
    }
    const employeeCount = (db as any).$client.prepare("SELECT COUNT(*) as cnt FROM competency_employees WHERE user_id = ?").get(userId)?.cnt || 0;
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE user_id = ?").get(userId);
    const instrumentCount = map ? ((db as any).$client.prepare("SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ?").get(map.id)?.cnt || 0) : 0;

    res.json({
      labName: "Riverside Regional Medical Center",
      cliaNumber: "22D0099999",
      address: "1200 Medical Center Drive, Richmond, VA 23298",
      stats: {
        studyCount,
        scanCompletionPct: scanPct,
        employeeCount,
        instrumentCount,
      },
    });
  });

  // GET /api/demo/studies - list all demo studies with full data
  app.get("/api/demo/studies", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.json([]);

    const studies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id DESC").all(userId);
    res.json(studies);
  });

  // GET /api/demo/studies/:id - single study with full data
  app.get("/api/demo/studies/:id", (req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const study = (db as any).$client.prepare("SELECT * FROM studies WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    // Parse JSON fields so frontend and PDF generator receive consistent data
    if (study.instruments) study.instruments = safeJsonParse(study.instruments);
    if (study.data_points) study.data_points = safeJsonParse(study.data_points);
    res.json(study);
  });

  // GET /api/demo/studies/:id/pdf - generate PDF for a demo study
  app.get("/api/demo/studies/:id/pdf", async (req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const studyRow = (db as any).$client.prepare("SELECT * FROM studies WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!studyRow) return res.status(404).json({ error: "Study not found" });

    try {
      const study = {
        testName: studyRow.test_name,
        instrument: studyRow.instrument,
        analyst: studyRow.analyst,
        date: studyRow.date,
        studyType: studyRow.study_type,
        cliaAllowableError: studyRow.clia_allowable_error,
        dataPoints: safeJsonParse(studyRow.data_points),
        instruments: safeJsonParse(studyRow.instruments),
        status: studyRow.status,
      };

      // Compute results based on study type (method_comparison)
      const dp = study.dataPoints;
      const instNames = study.instruments;
      const primary = instNames[0];
      const comparison = instNames[1];

      const xs = dp.map((p: any) => p.instrumentValues?.[primary] ?? 0);
      const ys = dp.map((p: any) => p.instrumentValues?.[comparison] ?? 0);

      const n = xs.length;
      const xMean = xs.reduce((a: number, b: number) => a + b, 0) / n;
      const yMean = ys.reduce((a: number, b: number) => a + b, 0) / n;
      const sxx = xs.reduce((s: number, x: number) => s + (x - xMean) ** 2, 0);
      const syy = ys.reduce((s: number, y: number) => s + (y - yMean) ** 2, 0);
      const sxy = xs.reduce((s: number, x: number, i: number) => s + (x - xMean) * (ys[i] - yMean), 0);
      const slope = sxx === 0 ? 1 : sxy / sxx;
      const intercept = yMean - slope * xMean;
      const rSquared = sxx === 0 || syy === 0 ? 1 : (sxy ** 2) / (sxx * syy);

      const biases = xs.map((x: number, i: number) => ys[i] - x);
      const meanBias = biases.reduce((a: number, b: number) => a + b, 0) / n;

      const results = {
        type: "method_comparison",
        n,
        slope,
        intercept,
        rSquared,
        meanBias,
        pass: true,
        instrumentResults: {
          [comparison]: {
            slope, intercept, rSquared, meanBias, pass: true,
          },
        },
        blandAltman: {},
      };

      const pdfBuffer = await generatePDFBuffer(study as any, results, "22D0099999");
      const filename = `VeritaCheck_MethodComp_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("Demo PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/demo/map - demo VeritaMap data
  app.get("/api/demo/map", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.json({ instruments: [], tests: [] });

    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").get(userId);
    if (!map) return res.json({ instruments: [], tests: [] });

    const instruments = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(map.id);
    const instrumentsWithTests = instruments.map((inst: any) => {
      const tests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(inst.id);
      return { ...inst, tests };
    });
    const mapTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ?").all(map.id);

    res.json({ ...map, instruments: instrumentsWithTests, tests: mapTests });
  });

  // GET /api/demo/map/excel - demo map Excel export
  app.get("/api/demo/map/excel", async (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const map = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").get(userId);
    if (!map) return res.status(404).json({ error: "No demo map" });

    const rawTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1 ORDER BY specialty, analyte").all(map.id);
    const instrByAnalyte = (db as any).$client.prepare(`
      SELECT it.analyte, i.id, i.instrument_name, i.role, i.category
      FROM veritamap_instrument_tests it
      JOIN veritamap_instruments i ON i.id = it.instrument_id
      WHERE it.map_id = ? AND it.active = 1
    `).all(map.id);
    const instrMap: Record<string, any[]> = {};
    for (const row of instrByAnalyte) {
      if (!instrMap[row.analyte]) instrMap[row.analyte] = [];
      instrMap[row.analyte].push(row);
    }
    const tests = rawTests.map((t: any) => ({ ...t, instruments: instrMap[t.analyte] ?? [] }));

    tests.sort((a: any, b: any) => {
      const catA = (a.instruments[0]?.category || "").toLowerCase();
      const catB = (b.instruments[0]?.category || "").toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const specA = (a.specialty || "").toLowerCase();
      const specB = (b.specialty || "").toLowerCase();
      if (specA !== specB) return specA.localeCompare(specB);
      return (a.analyte || "").toLowerCase().localeCompare((b.analyte || "").toLowerCase());
    });

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Compliance Map");

      const headers = [
        "Analyte", "Instruments", "Department", "Specialty", "Complexity",
        "Number of Instruments", "Correlation Required",
        "Last Cal Ver Date", "Last Method Comp Date", "Last Precision Date", "Notes",
      ];
      ws.columns = headers.map((h) => ({ header: h, key: h, width: 22 }));

      for (const t of tests) {
        const instruments = t.instruments || [];
        const instrList = instruments.map((i: any) => `${i.instrument_name} [${i.role}]`).join("; ");
        const isWaived = t.complexity === "WAIVED";
        ws.addRow([
          t.analyte, instrList, instruments[0]?.category || "", t.specialty, t.complexity,
          instruments.length, !isWaived && instruments.length >= 2 ? "Yes" : "No",
          t.last_cal_ver || "", t.last_method_comp || "", t.last_precision || "", t.notes || "",
        ]);
      }

      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } } as any;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      const buffer = await wb.xlsx.writeBuffer();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaMap_Demo_Riverside_Regional.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("Demo Excel error:", err);
      res.status(500).json({ error: "Excel export failed" });
    }
  });

  // GET /api/demo/scan - demo VeritaScan checklist
  app.get("/api/demo/scan", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.json({ items: [], total: 168 });

    const scan = (db as any).$client.prepare("SELECT * FROM veritascan_scans WHERE user_id = ?").get(userId);
    if (!scan) return res.json({ items: [], total: 168 });

    const items = (db as any).$client.prepare(
      "SELECT item_id, status, notes, owner, due_date, completion_source, completion_link, completion_note FROM veritascan_items WHERE scan_id = ?"
    ).all(scan.id);
    const total = 168;
    const assessed = items.filter((i: any) => i.status !== "Not Assessed").length;
    const compliant = items.filter((i: any) => i.status === "Compliant").length;
    res.json({ ...scan, items, total, assessed, compliant });
  });

  // GET /api/demo/competency - demo competency assessment data
  app.get("/api/demo/competency", (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.json({ programs: [], employees: [], assessments: [] });

    const programs = (db as any).$client.prepare("SELECT * FROM competency_programs WHERE user_id = ?").all(userId);
    const employees = (db as any).$client.prepare("SELECT * FROM competency_employees WHERE user_id = ?").all(userId);

    const assessments: any[] = [];
    for (const prog of programs) {
      const progAssessments = (db as any).$client.prepare(
        `SELECT a.*, e.name as employee_name, e.title as employee_title
         FROM competency_assessments a
         JOIN competency_employees e ON a.employee_id = e.id
         WHERE a.program_id = ?`
      ).all(prog.id);

      for (const assessment of progAssessments) {
        const items = (db as any).$client.prepare(
          "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
        ).all(assessment.id);
        const methodGroups = (db as any).$client.prepare(
          "SELECT * FROM competency_method_groups WHERE program_id = ?"
        ).all(prog.id);
        assessments.push({ ...assessment, program_name: prog.name, items, methodGroups });
      }
    }

    res.json({ programs, employees, assessments });
  });

  // GET /api/demo/competency/pdf - generate competency PDF for demo
  app.get("/api/demo/competency/pdf", async (_req, res) => {
    const userId = getDemoUserId();
    if (!userId) return res.status(404).json({ error: "Demo data not found" });

    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE p.user_id = ?
       LIMIT 1`
    ).get(userId);
    if (!assessment) return res.status(404).json({ error: "No demo assessment" });

    const items = (db as any).$client.prepare(
      "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
    ).all(assessment.id);

    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(assessment.program_id);

    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(assessment.program_id);

    let quizResults: any[] = [];
    try {
      quizResults = (db as any).$client.prepare(
        `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
         FROM competency_quiz_results qr
         JOIN competency_quizzes q ON qr.quiz_id = q.id
         WHERE qr.assessment_id = ?`
      ).all(assessment.id);
    } catch { /* quiz tables may not have data */ }

    try {
      const pdfBuffer = await generateCompetencyPDF({
        assessment,
        items,
        methodGroups,
        checklistItems,
        labName: "Riverside Regional Medical Center",
        quizResults,
        cliaNumber: "22D0099999",
      });

      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `VeritaComp_Technical_${safeName}_Demo.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("Demo competency PDF error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── VERITACOMP ─────────────────────────────────────────────────────────

  function hasCompetencyAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital"].includes(user?.plan);
  }

  // List programs
  app.get("/api/competency/programs", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const programs = (db as any).$client.prepare(
      "SELECT * FROM competency_programs WHERE user_id = ? ORDER BY updated_at DESC"
    ).all(req.user.userId);
    const result = programs.map((p: any) => {
      const employeeCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM competency_employees WHERE user_id = ? AND status = 'active'"
      ).get(req.user.userId)?.cnt || 0;
      const assessmentCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM competency_assessments WHERE program_id = ?"
      ).get(p.id)?.cnt || 0;
      const methodGroups = (db as any).$client.prepare(
        "SELECT * FROM competency_method_groups WHERE program_id = ?"
      ).all(p.id);
      const checklistItems = (db as any).$client.prepare(
        "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
      ).all(p.id);
      return { ...p, employeeCount, assessmentCount, methodGroups, checklistItems };
    });
    res.json(result);
  });

  // Create program
  app.post("/api/competency/programs", authMiddleware, requireWriteAccess, (req: any, res) => {
    try {
      if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
      const { name, department, type, mapId, methodGroups, checklistItems } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Program name required" });
      if (!["technical", "waived", "nontechnical"].includes(type)) return res.status(400).json({ error: "Invalid type" });
      const now = new Date().toISOString();
      const result = (db as any).$client.prepare(
        "INSERT INTO competency_programs (user_id, name, department, type, map_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(req.user.userId, name.trim(), department || "Chemistry", type, mapId || null, now, now);
      const programId = Number(result.lastInsertRowid);

      // Insert method groups for technical type
      if (type === "technical" && Array.isArray(methodGroups)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
        );
        for (const g of methodGroups) {
          stmt.run(programId, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
        }
      }

      // Insert checklist items for nontechnical type
      if (type === "nontechnical" && Array.isArray(checklistItems)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
        );
        checklistItems.forEach((item: any, idx: number) => {
          stmt.run(programId, item.label || String.fromCharCode(65 + idx), item.description, idx);
        });
      }

      res.json({ id: programId, name: name.trim(), department: department || "Chemistry", type, map_id: mapId || null, created_at: now, updated_at: now });
    } catch (e: any) {
      console.error("Error creating competency program:", e);
      res.status(500).json({ error: "Failed to create program", details: e.message });
    }
  });

  // Alias: /api/veritacomp/programs → /api/competency/programs
  app.post("/api/veritacomp/programs", authMiddleware, requireWriteAccess, (req: any, res) => {
    try {
      if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
      const { name, department, type, mapId, methodGroups, checklistItems } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Program name required" });
      if (!["technical", "waived", "nontechnical"].includes(type)) return res.status(400).json({ error: "Invalid type" });
      const now = new Date().toISOString();
      const result = (db as any).$client.prepare(
        "INSERT INTO competency_programs (user_id, name, department, type, map_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(req.user.userId, name.trim(), department || "Chemistry", type, mapId || null, now, now);
      const programId = Number(result.lastInsertRowid);

      if (type === "technical" && Array.isArray(methodGroups)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
        );
        for (const g of methodGroups) {
          stmt.run(programId, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
        }
      }

      if (type === "nontechnical" && Array.isArray(checklistItems)) {
        const stmt = (db as any).$client.prepare(
          "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
        );
        checklistItems.forEach((item: any, idx: number) => {
          stmt.run(programId, item.label || String.fromCharCode(65 + idx), item.description, idx);
        });
      }

      res.json({ id: programId, name: name.trim(), department: department || "Chemistry", type, map_id: mapId || null, created_at: now, updated_at: now });
    } catch (e: any) {
      console.error("Error creating competency program:", e);
      res.status(500).json({ error: "Failed to create program", details: e.message });
    }
  });

  // Get single program with full data
  app.get("/api/competency/programs/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare(
      "SELECT * FROM competency_programs WHERE id = ? AND user_id = ?"
    ).get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(program.id);
    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(program.id);
    const employees = (db as any).$client.prepare(
      "SELECT * FROM competency_employees WHERE user_id = ? ORDER BY name"
    ).all(req.user.userId);
    const assessments = (db as any).$client.prepare(
      `SELECT a.*, e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.program_id = ?
       ORDER BY a.created_at DESC`
    ).all(program.id);
    // Attach items to each assessment
    const assessmentsWithItems = assessments.map((a: any) => {
      const items = (db as any).$client.prepare(
        "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
      ).all(a.id);
      return { ...a, items };
    });
    res.json({ ...program, methodGroups, checklistItems, employees, assessments: assessmentsWithItems });
  });

  // Delete program
  app.delete("/api/competency/programs/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    // Cascade delete
    const assessments = (db as any).$client.prepare("SELECT id FROM competency_assessments WHERE program_id = ?").all(req.params.id);
    for (const a of assessments) {
      (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(a.id);
    }
    (db as any).$client.prepare("DELETE FROM competency_assessments WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_method_groups WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_checklist_items WHERE program_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_programs WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // Update program settings (method groups, checklist items, name)
  app.put("/api/competency/programs/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare("SELECT * FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const { name, department, methodGroups, checklistItems } = req.body;
    const now = new Date().toISOString();
    if (name) (db as any).$client.prepare("UPDATE competency_programs SET name = ?, updated_at = ? WHERE id = ?").run(name.trim(), now, req.params.id);
    if (department) (db as any).$client.prepare("UPDATE competency_programs SET department = ?, updated_at = ? WHERE id = ?").run(department, now, req.params.id);
    // Replace method groups
    if (Array.isArray(methodGroups)) {
      (db as any).$client.prepare("DELETE FROM competency_method_groups WHERE program_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
      );
      for (const g of methodGroups) {
        stmt.run(req.params.id, g.name, JSON.stringify(g.instruments || []), JSON.stringify(g.analytes || []), g.notes || null);
      }
    }
    // Replace checklist items
    if (Array.isArray(checklistItems)) {
      (db as any).$client.prepare("DELETE FROM competency_checklist_items WHERE program_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
      );
      checklistItems.forEach((item: any, idx: number) => {
        stmt.run(req.params.id, item.label || String.fromCharCode(65 + idx), item.description, idx);
      });
    }
    (db as any).$client.prepare("UPDATE competency_programs SET updated_at = ? WHERE id = ?").run(now, req.params.id);
    res.json({ ok: true });
  });

  // ── EMPLOYEES ─────────────────────────────────────────────────────────────

  app.get("/api/competency/employees", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const employees = (db as any).$client.prepare(
      "SELECT * FROM competency_employees WHERE user_id = ? ORDER BY name"
    ).all(req.user.userId);
    res.json(employees);
  });

  app.post("/api/competency/employees", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const { name, title, hireDate, lisInitials } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Employee name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
    ).run(req.user.userId, name.trim(), title || "", hireDate || null, lisInitials || null, now);
    res.json({ id: Number(result.lastInsertRowid), user_id: req.user.userId, name: name.trim(), title: title || "", hire_date: hireDate || null, lis_initials: lisInitials || null, status: "active", created_at: now });
  });

  app.put("/api/competency/employees/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const { name, title, hireDate, lisInitials, status } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    if (name !== undefined) { sets.push("name = ?"); vals.push(name.trim()); }
    if (title !== undefined) { sets.push("title = ?"); vals.push(title); }
    if (hireDate !== undefined) { sets.push("hire_date = ?"); vals.push(hireDate); }
    if (lisInitials !== undefined) { sets.push("lis_initials = ?"); vals.push(lisInitials); }
    if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
    if (sets.length) {
      vals.push(req.params.id);
      (db as any).$client.prepare(`UPDATE competency_employees SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
    res.json({ ok: true });
  });

  app.delete("/api/competency/employees/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    (db as any).$client.prepare("UPDATE competency_employees SET status = 'inactive' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── ASSESSMENTS ───────────────────────────────────────────────────────────

  app.post("/api/competency/assessments", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const { programId, employeeId, assessmentType, assessmentDate, evaluatorName, evaluatorTitle, evaluatorInitials, competencyType, status, remediationPlan, employeeAcknowledged, supervisorAcknowledged, items } = req.body;
    // Verify program and employee belong to user
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(programId, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(employeeId, req.user.userId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      `INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(programId, employeeId, assessmentType || "initial", assessmentDate || now.split("T")[0], evaluatorName || null, evaluatorTitle || null, evaluatorInitials || null, competencyType || "technical", status || "pass", remediationPlan || null, employeeAcknowledged ? 1 : 0, supervisorAcknowledged ? 1 : 0, now);
    const assessmentId = Number(result.lastInsertRowid);

    // Insert assessment items (with new element-specific columns)
    if (Array.isArray(items)) {
      const stmt = (db as any).$client.prepare(
        `INSERT INTO competency_assessment_items (
          assessment_id, method_number, method_group_id, item_label, item_description,
          evidence, date_met, employee_initials, supervisor_initials, passed, specimen_info,
          element_number, method_group_name,
          el1_specimen_id, el1_observer_initials,
          el2_evidence, el2_date,
          el3_qc_date,
          el4_date_observed, el4_observer_initials,
          el5_sample_type, el5_sample_id, el5_acceptable,
          el6_quiz_id, el6_score, el6_date_taken,
          waived_instrument, waived_test, waived_method_number, waived_evidence, waived_date, waived_initials,
          nt_item_label, nt_item_description, nt_date_met, nt_employee_initials, nt_supervisor_initials
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(
          assessmentId,
          item.methodNumber ?? null, item.methodGroupId ?? null,
          item.itemLabel ?? null, item.itemDescription ?? null,
          item.evidence ?? null, item.dateMet ?? null,
          item.employeeInitials ?? null, item.supervisorInitials ?? null,
          item.passed ? 1 : 0, item.specimenInfo ?? null,
          item.elementNumber ?? null, item.methodGroupName ?? null,
          item.el1SpecimenId ?? null, item.el1ObserverInitials ?? null,
          item.el2Evidence ?? null, item.el2Date ?? null,
          item.el3QcDate ?? null,
          item.el4DateObserved ?? null, item.el4ObserverInitials ?? null,
          item.el5SampleType ?? null, item.el5SampleId ?? null,
          item.el5Acceptable != null ? (item.el5Acceptable ? 1 : 0) : null,
          item.el6QuizId ?? null, item.el6Score ?? null, item.el6DateTaken ?? null,
          item.waivedInstrument ?? null, item.waivedTest ?? null,
          item.waivedMethodNumber ?? null, item.waivedEvidence ?? null,
          item.waivedDate ?? null, item.waivedInitials ?? null,
          item.ntItemLabel ?? null, item.ntItemDescription ?? null,
          item.ntDateMet ?? null, item.ntEmployeeInitials ?? null, item.ntSupervisorInitials ?? null
        );
      }
    }

    // Update program updated_at
    (db as any).$client.prepare("UPDATE competency_programs SET updated_at = ? WHERE id = ?").run(now, programId);

    // VeritaScan integration: auto-complete competency items
    if (status === "pass") {
      autoCompleteCompetencyScanItems(req.user.userId, competencyType || "technical");
    }

    res.json({ id: assessmentId, program_id: programId, employee_id: employeeId, status: status || "pass", created_at: now });
  });

  // Update assessment
  app.put("/api/competency/assessments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.id, p.user_id FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       WHERE a.id = ?`
    ).get(req.params.id);
    if (!assessment || assessment.user_id !== req.user.userId) return res.status(404).json({ error: "Assessment not found" });
    const { status, evaluatorName, evaluatorTitle, evaluatorInitials, remediationPlan, employeeAcknowledged, supervisorAcknowledged, items } = req.body;
    const sets: string[] = [];
    const vals: any[] = [];
    if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
    if (evaluatorName !== undefined) { sets.push("evaluator_name = ?"); vals.push(evaluatorName); }
    if (evaluatorTitle !== undefined) { sets.push("evaluator_title = ?"); vals.push(evaluatorTitle); }
    if (evaluatorInitials !== undefined) { sets.push("evaluator_initials = ?"); vals.push(evaluatorInitials); }
    if (remediationPlan !== undefined) { sets.push("remediation_plan = ?"); vals.push(remediationPlan); }
    if (employeeAcknowledged !== undefined) { sets.push("employee_acknowledged = ?"); vals.push(employeeAcknowledged ? 1 : 0); }
    if (supervisorAcknowledged !== undefined) { sets.push("supervisor_acknowledged = ?"); vals.push(supervisorAcknowledged ? 1 : 0); }
    if (sets.length) {
      vals.push(req.params.id);
      (db as any).$client.prepare(`UPDATE competency_assessments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    }
    // Replace items if provided
    if (Array.isArray(items)) {
      (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(req.params.id);
      const stmt = (db as any).$client.prepare(
        `INSERT INTO competency_assessment_items (
          assessment_id, method_number, method_group_id, item_label, item_description,
          evidence, date_met, employee_initials, supervisor_initials, passed, specimen_info,
          element_number, method_group_name,
          el1_specimen_id, el1_observer_initials,
          el2_evidence, el2_date,
          el3_qc_date,
          el4_date_observed, el4_observer_initials,
          el5_sample_type, el5_sample_id, el5_acceptable,
          el6_quiz_id, el6_score, el6_date_taken,
          waived_instrument, waived_test, waived_method_number, waived_evidence, waived_date, waived_initials,
          nt_item_label, nt_item_description, nt_date_met, nt_employee_initials, nt_supervisor_initials
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(
          req.params.id,
          item.methodNumber ?? null, item.methodGroupId ?? null,
          item.itemLabel ?? null, item.itemDescription ?? null,
          item.evidence ?? null, item.dateMet ?? null,
          item.employeeInitials ?? null, item.supervisorInitials ?? null,
          item.passed ? 1 : 0, item.specimenInfo ?? null,
          item.elementNumber ?? null, item.methodGroupName ?? null,
          item.el1SpecimenId ?? null, item.el1ObserverInitials ?? null,
          item.el2Evidence ?? null, item.el2Date ?? null,
          item.el3QcDate ?? null,
          item.el4DateObserved ?? null, item.el4ObserverInitials ?? null,
          item.el5SampleType ?? null, item.el5SampleId ?? null,
          item.el5Acceptable != null ? (item.el5Acceptable ? 1 : 0) : null,
          item.el6QuizId ?? null, item.el6Score ?? null, item.el6DateTaken ?? null,
          item.waivedInstrument ?? null, item.waivedTest ?? null,
          item.waivedMethodNumber ?? null, item.waivedEvidence ?? null,
          item.waivedDate ?? null, item.waivedInitials ?? null,
          item.ntItemLabel ?? null, item.ntItemDescription ?? null,
          item.ntDateMet ?? null, item.ntEmployeeInitials ?? null, item.ntSupervisorInitials ?? null
        );
      }
    }
    res.json({ ok: true });
  });

  // Delete assessment
  app.delete("/api/competency/assessments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.id, p.user_id FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       WHERE a.id = ?`
    ).get(req.params.id);
    if (!assessment || assessment.user_id !== req.user.userId) return res.status(404).json({ error: "Assessment not found" });
    (db as any).$client.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM competency_assessments WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── VERITACOMP ALIASED ROUTES ──────────────────────────────────────────

  // GET /api/veritacomp/assessments/:id
  app.get("/api/veritacomp/assessments/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.id, req.user.userId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    const items = (db as any).$client.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessment.id);
    const methodGroups = (db as any).$client.prepare("SELECT * FROM competency_method_groups WHERE program_id = ?").all(assessment.program_id);
    res.json({ ...assessment, items, methodGroups });
  });

  // GET /api/veritacomp/programs/:id/assessments
  app.get("/api/veritacomp/programs/:id/assessments", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const assessments = (db as any).$client.prepare(
      `SELECT a.*, e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date
       FROM competency_assessments a
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.program_id = ?
       ORDER BY a.created_at DESC`
    ).all(req.params.id);
    res.json(assessments);
  });

  // ── QUIZ ENDPOINTS ──────────────────────────────────────────────────────

  // GET /api/veritacomp/programs/:id/quizzes
  app.get("/api/veritacomp/programs/:id/quizzes", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    // Get user quizzes for this program + system quizzes (user_id = 0)
    const quizzes = (db as any).$client.prepare(
      "SELECT id, user_id, program_id, method_group_id, method_group_name, created_at FROM competency_quizzes WHERE program_id = ? OR user_id = 0 OR user_id = ?"
    ).all(req.params.id, req.user.userId);
    res.json(quizzes);
  });

  // POST /api/veritacomp/programs/:id/quizzes
  app.post("/api/veritacomp/programs/:id/quizzes", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const program = (db as any).$client.prepare("SELECT id FROM competency_programs WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!program) return res.status(404).json({ error: "Program not found" });
    const { methodGroupId, methodGroupName, questions } = req.body;
    if (!questions || !Array.isArray(questions)) return res.status(400).json({ error: "questions array required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, method_group_id, method_group_name, questions, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(req.user.userId, parseInt(req.params.id), methodGroupId || null, methodGroupName || null, JSON.stringify(questions), now);
    res.json({ id: Number(result.lastInsertRowid), program_id: parseInt(req.params.id), method_group_id: methodGroupId, method_group_name: methodGroupName, created_at: now });
  });

  // GET /api/veritacomp/quizzes/:id (without revealing correct answers)
  app.get("/api/veritacomp/quizzes/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const quiz = (db as any).$client.prepare("SELECT * FROM competency_quizzes WHERE id = ?").get(req.params.id) as any;
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    // Strip correct_answer and explanation from questions
    const questions = JSON.parse(quiz.questions || "[]").map((q: any) => ({
      id: q.id,
      question: q.question,
      type: q.type,
      options: q.options,
    }));
    res.json({ ...quiz, questions });
  });

  // POST /api/veritacomp/quiz-results - submit quiz, auto-score
  app.post("/api/veritacomp/quiz-results", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const { quizId, assessmentId, employeeId, answers } = req.body;
    if (!quizId || !employeeId || !Array.isArray(answers)) return res.status(400).json({ error: "quizId, employeeId, and answers array required" });
    const quiz = (db as any).$client.prepare("SELECT * FROM competency_quizzes WHERE id = ?").get(quizId) as any;
    if (!quiz) return res.status(404).json({ error: "Quiz not found" });
    const questions = JSON.parse(quiz.questions || "[]");
    // Score
    let correct = 0;
    const gradedAnswers = answers.map((a: any) => {
      const q = questions.find((qq: any) => qq.id === a.question_id);
      const isCorrect = q && a.selected_answer === q.correct_answer;
      if (isCorrect) correct++;
      return { question_id: a.question_id, selected_answer: a.selected_answer, correct: !!isCorrect };
    });
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const passed = score === 100;
    const now = new Date().toISOString();
    const dateTaken = now.split("T")[0];
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_quiz_results (assessment_id, quiz_id, employee_id, answers, score, passed, date_taken, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(assessmentId || null, quizId, employeeId, JSON.stringify(gradedAnswers), score, passed ? 1 : 0, dateTaken, now);
    // Return full result including correct answers + explanations for review
    const fullQuestions = questions.map((q: any) => {
      const ga = gradedAnswers.find((a: any) => a.question_id === q.id);
      return { ...q, selected_answer: ga?.selected_answer, was_correct: ga?.correct };
    });
    res.json({
      id: Number(result.lastInsertRowid),
      quiz_id: quizId,
      employee_id: employeeId,
      score,
      passed,
      date_taken: dateTaken,
      answers: gradedAnswers,
      questions: fullQuestions,
    });
  });

  // GET /api/veritacomp/assessments/:id/quiz-results
  app.get("/api/veritacomp/assessments/:id/quiz-results", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const results = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?
       ORDER BY qr.created_at DESC`
    ).all(req.params.id);
    res.json(results);
  });

  // GET /api/veritacomp/assessments/:id/pdf
  app.get("/api/veritacomp/assessments/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.id, req.user.userId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });
    const items = (db as any).$client.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessment.id);
    const methodGroups = (db as any).$client.prepare("SELECT * FROM competency_method_groups WHERE program_id = ?").all(assessment.program_id);
    const checklistItems = (db as any).$client.prepare("SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(assessment.program_id);
    const quizResults = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?`
    ).all(assessment.id);
    const labUser = storage.getUserById(req.user.userId);
    const labName = labUser?.name || "Clinical Laboratory";
    const compUserRow = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(req.userId) as any;
    try {
      const pdfBuffer = await generateCompetencyPDF({ assessment, items, methodGroups, checklistItems, labName, quizResults, cliaNumber: compUserRow?.clia_number || undefined });
      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const typeLabel = assessment.program_type === "technical" ? "Technical" : assessment.program_type === "waived" ? "Waived" : "NonTechnical";
      const filename = `VeritaComp_${typeLabel}_${safeName}_${date}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("Competency PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // VeritaMap integration — get instruments from a map for method group suggestions
  app.get("/api/competency/map-instruments/:mapId", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.mapId, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const instruments = (db as any).$client.prepare(
      "SELECT id, instrument_name, role, category FROM veritamap_instruments WHERE map_id = ?"
    ).all(req.params.mapId);
    const instrumentsWithTests = instruments.map((inst: any) => {
      const tests = (db as any).$client.prepare(
        "SELECT analyte, specialty, complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND active = 1"
      ).all(inst.id);
      return { ...inst, tests };
    });
    res.json(instrumentsWithTests);
  });

  // PDF generation for competency assessments
  app.post("/api/competency/pdf/:assessmentId", authMiddleware, async (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaComp subscription required" });
    const assessment = (db as any).$client.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type,
              e.name as employee_name, e.title as employee_title, e.hire_date as employee_hire_date, e.lis_initials as employee_lis_initials
       FROM competency_assessments a
       JOIN competency_programs p ON a.program_id = p.id
       JOIN competency_employees e ON a.employee_id = e.id
       WHERE a.id = ? AND p.user_id = ?`
    ).get(req.params.assessmentId, req.user.userId);
    if (!assessment) return res.status(404).json({ error: "Assessment not found" });

    const items = (db as any).$client.prepare(
      "SELECT * FROM competency_assessment_items WHERE assessment_id = ?"
    ).all(assessment.id);

    const methodGroups = (db as any).$client.prepare(
      "SELECT * FROM competency_method_groups WHERE program_id = ?"
    ).all(assessment.program_id);

    const checklistItems = (db as any).$client.prepare(
      "SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order"
    ).all(assessment.program_id);

    const quizResults = (db as any).$client.prepare(
      `SELECT qr.*, q.method_group_name, q.questions as quiz_questions
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON qr.quiz_id = q.id
       WHERE qr.assessment_id = ?`
    ).all(assessment.id);

    // Get user info for lab name
    const labUser = storage.getUserById(req.user.userId);
    const labName = labUser?.name || "Clinical Laboratory";
    const compUserRow2 = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(req.userId) as any;

    try {
      const pdfBuffer = await generateCompetencyPDF({
        assessment,
        items,
        methodGroups,
        checklistItems,
        labName,
        quizResults,
        cliaNumber: compUserRow2?.clia_number || undefined,
      });

      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const typeLabel = assessment.program_type === "technical" ? "Technical" : assessment.program_type === "waived" ? "Waived" : "NonTechnical";
      const filename = `VeritaComp_${typeLabel}_${safeName}_${date}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("Competency PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // VeritaScan integration for competency
  function autoCompleteCompetencyScanItems(userId: number, competencyType: string) {
    const scans = (db as any).$client.prepare(
      "SELECT id FROM veritascan_scans WHERE user_id = ?"
    ).all(userId) as { id: number }[];
    if (scans.length === 0) return;

    const now = new Date().toISOString();
    // Domain IX (Personnel & Competency) items: 54-72
    // Map competency type to specific items
    const itemIds: number[] = [];
    if (competencyType === "technical") {
      itemIds.push(60, 61, 62, 63); // 6 CLIA methods, semiannual, annual, documentation
    } else if (competencyType === "waived") {
      itemIds.push(64, 65); // waived testing competency
    } else if (competencyType === "nontechnical") {
      itemIds.push(66, 67); // nontechnical competency
    }
    if (itemIds.length === 0) return;

    const completionNote = `Auto-completed by VeritaComp\u2122: ${competencyType} assessment on ${now.split("T")[0]}`;
    const upsertStmt = (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
      VALUES (?, ?, 'Compliant', ?, 'veritacomp_auto', '/veritacomp-app', ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = 'Compliant',
        completion_source = 'veritacomp_auto',
        completion_link = '/veritacomp-app',
        completion_note = excluded.completion_note,
        updated_at = excluded.updated_at
      WHERE status != 'Compliant' OR completion_source != 'veritacomp_auto'
    `);

    const bulkUpdate = (db as any).$client.transaction(() => {
      for (const scan of scans) {
        for (const itemId of itemIds) {
          upsertStmt.run(scan.id, itemId, completionNote, completionNote, now);
        }
      }
    });
    bulkUpdate();

    for (const scan of scans) {
      (db as any).$client.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(now, scan.id);
    }
  }

  // CUMSUM PDF export
  app.post("/api/cumsum/trackers/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasCheckAccess(req.user)) return res.status(403).json({ error: "Subscription required" });
    const tracker = (db as any).$client.prepare("SELECT * FROM cumsum_trackers WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!tracker) return res.status(404).json({ error: "Tracker not found" });
    const entries = (db as any).$client.prepare("SELECT * FROM cumsum_entries WHERE tracker_id = ? ORDER BY id ASC").all(req.params.id);
    const { currentSpecimens } = req.body || {};
    const cumsumUserRow = (db as any).$client.prepare("SELECT clia_number FROM users WHERE id = ?").get(req.userId) as any;
    try {
      const pdfBuffer = await generateCumsumPDF(tracker, entries, currentSpecimens, cumsumUserRow?.clia_number || undefined);
      const safeName = tracker.instrument_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = `CUMSUM_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (e: any) {
      console.error("CUMSUM PDF error:", e);
      res.status(500).json({ error: "PDF generation failed" });
    }
  });

  // ── VERITASTAFF ──────────────────────────────────────────────────────────

  function hasStaffAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital"].includes(user?.plan);
  }

  // CMS specialty list (for validation and labels)
  const CMS_SPECIALTIES: Record<number, string> = {
    1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology",
    5: "Virology", 6: "Diagnostic Immunology", 7: "Chemistry", 8: "Hematology",
    9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
    13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology",
    16: "Histocompatibility", 17: "Clinical Cytogenetics",
  };

  // VeritaMap department to CMS specialty mapping
  const VERITAMAP_DEPT_TO_CMS: Record<string, number[]> = {
    "Chemistry": [7], "Hematology": [8], "Blood Bank": [9], "Coagulation": [7],
    "Microbiology": [1], "Urinalysis": [7], "Molecular": [1, 6],
    "Immunology / Protein": [6], "Blood Gas": [7], "Point of Care": [7],
    "Histology / Pathology": [12], "Cytology": [11],
  };

  // Get or create staff lab
  app.get("/api/staff/lab", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(req.user.userId);
    res.json(lab || null);
  });

  app.post("/api/staff/lab", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const { labName, cliaNumber, street, city, state, zip, phone, certificateType, accreditationBody, accreditationBodyOther, includesNys, complexity } = req.body;
    if (!labName?.trim() || !cliaNumber?.trim()) return res.status(400).json({ error: "Lab name and CLIA number required" });
    const now = new Date().toISOString();

    const existing = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(req.user.userId);
    if (existing) {
      (db as any).$client.prepare(
        "UPDATE staff_labs SET lab_name=?, clia_number=?, lab_address_street=?, lab_address_city=?, lab_address_state=?, lab_address_zip=?, lab_phone=?, certificate_type=?, accreditation_body=?, accreditation_body_other=?, includes_nys=?, complexity=?, updated_at=? WHERE id=?"
      ).run(labName.trim(), cliaNumber.trim(), street || '', city || '', state || '', zip || '', phone || '', certificateType || 'compliance', accreditationBody || 'CLIA_ONLY', accreditationBodyOther || '', includesNys ? 1 : 0, complexity || 'high', now, existing.id);
      const updated = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE id = ?").get(existing.id);
      return res.json(updated);
    }

    const result = (db as any).$client.prepare(
      "INSERT INTO staff_labs (user_id, lab_name, clia_number, lab_address_street, lab_address_city, lab_address_state, lab_address_zip, lab_phone, certificate_type, accreditation_body, accreditation_body_other, includes_nys, complexity, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(req.user.userId, labName.trim(), cliaNumber.trim(), street || '', city || '', state || '', zip || '', phone || '', certificateType || 'compliance', accreditationBody || 'CLIA_ONLY', accreditationBodyOther || '', includesNys ? 1 : 0, complexity || 'high', now, now);
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE id = ?").get(result.lastInsertRowid);
    res.json(lab);
  });

  // Get VeritaMap department suggestions
  app.get("/api/staff/veritamap-suggestions", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const maps = (db as any).$client.prepare("SELECT id, name FROM veritamap_maps WHERE user_id = ?").all(req.user.userId) as any[];
    const suggestions: { department: string; specialties: { number: number; name: string }[] }[] = [];
    const seenDepts = new Set<string>();

    for (const map of maps) {
      const instruments = (db as any).$client.prepare("SELECT id, category FROM veritamap_instruments WHERE map_id = ?").all(map.id) as any[];
      for (const inst of instruments) {
        const dept = inst.category;
        if (seenDepts.has(dept)) continue;
        seenDepts.add(dept);
        const cmsNums = VERITAMAP_DEPT_TO_CMS[dept];
        if (cmsNums) {
          suggestions.push({
            department: dept,
            specialties: cmsNums.map(n => ({ number: n, name: CMS_SPECIALTIES[n] })),
          });
        }
      }
    }
    res.json(suggestions);
  });

  // List employees for a lab
  app.get("/api/staff/employees", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.json([]);

    const employees = (db as any).$client.prepare(
      "SELECT * FROM staff_employees WHERE lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
    ).all(lab.id) as any[];

    const result = employees.map((emp: any) => {
      const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
      const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(emp.id);
      return { ...emp, roles, competencySchedule: schedule || null };
    });
    res.json(result);
  });

  // Get single employee
  app.get("/api/staff/employees/:id", authMiddleware, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(404).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(emp.id);
    res.json({ ...emp, roles, competencySchedule: schedule || null });
  });

  // Create employee
  app.post("/api/staff/employees", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(400).json({ error: "Set up your lab first" });

    const { lastName, firstName, middleInitial, title, hireDate, qualificationsText, highestComplexity, performsTesting, roles } = req.body;
    if (!lastName?.trim() || !firstName?.trim()) return res.status(400).json({ error: "Name required" });

    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).run(lab.id, req.user.userId, lastName.trim(), firstName.trim(), middleInitial || null, title || null, hireDate || null, qualificationsText || null, highestComplexity || 'H', performsTesting ? 1 : 0, 'active', now, now);
    const empId = result.lastInsertRowid;

    // Insert roles
    if (roles && Array.isArray(roles)) {
      const roleStmt = (db as any).$client.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?,?,?,?)");
      for (const r of roles) {
        roleStmt.run(empId, lab.id, r.role, r.specialtyNumber || null);
      }
    }

    // Create competency schedule if performs testing
    if (performsTesting) {
      const accreditor = lab.accreditation_body;
      const includesTJCorCAP = ["TJC", "CAP"].includes(accreditor);
      const includesNYS = lab.includes_nys === 1;
      const hire = hireDate ? new Date(hireDate) : new Date();

      let sixMonthDue: string | null = null;
      let nysSixMonthDue: string | null = null;

      if (includesTJCorCAP && !includesNYS) {
        // 6-month due from initial completion (set later), leave null for now
        sixMonthDue = null;
      } else {
        // CLIA only or NYS: 6 months from hire
        const sixFromHire = new Date(hire);
        sixFromHire.setMonth(sixFromHire.getMonth() + 6);
        sixMonthDue = sixFromHire.toISOString().split('T')[0];
      }

      if (includesNYS) {
        const nysSix = new Date(hire);
        nysSix.setMonth(nysSix.getMonth() + 6);
        nysSixMonthDue = nysSix.toISOString().split('T')[0];
      }

      if (includesTJCorCAP && includesNYS) {
        // TJC/CAP + NYS: 6 months from hire satisfies both
        const sixFromHire = new Date(hire);
        sixFromHire.setMonth(sixFromHire.getMonth() + 6);
        sixMonthDue = sixFromHire.toISOString().split('T')[0];
      }

      (db as any).$client.prepare(
        "INSERT INTO staff_competency_schedules (employee_id, lab_id, six_month_due_at, nys_six_month_due_at) VALUES (?,?,?,?)"
      ).run(empId, lab.id, sixMonthDue, nysSixMonthDue);
    }

    // Return the created employee with roles
    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ?").get(empId);
    const empRoles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(empId);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(empId);
    res.json({ ...emp, roles: empRoles, competencySchedule: schedule || null });
  });

  // Update employee
  app.put("/api/staff/employees/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const { lastName, firstName, middleInitial, title, hireDate, qualificationsText, highestComplexity, performsTesting, roles } = req.body;
    const now = new Date().toISOString();

    (db as any).$client.prepare(
      "UPDATE staff_employees SET last_name=?, first_name=?, middle_initial=?, title=?, hire_date=?, qualifications_text=?, highest_complexity=?, performs_testing=?, updated_at=? WHERE id=?"
    ).run(
      lastName?.trim() || emp.last_name, firstName?.trim() || emp.first_name,
      middleInitial !== undefined ? middleInitial : emp.middle_initial,
      title !== undefined ? title : emp.title,
      hireDate !== undefined ? hireDate : emp.hire_date,
      qualificationsText !== undefined ? qualificationsText : emp.qualifications_text,
      highestComplexity || emp.highest_complexity,
      performsTesting !== undefined ? (performsTesting ? 1 : 0) : emp.performs_testing,
      now, req.params.id
    );

    // Replace roles
    if (roles && Array.isArray(roles)) {
      (db as any).$client.prepare("DELETE FROM staff_roles WHERE employee_id = ?").run(req.params.id);
      const roleStmt = (db as any).$client.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?,?,?,?)");
      for (const r of roles) {
        roleStmt.run(req.params.id, lab.id, r.role, r.specialtyNumber || null);
      }
    }

    const updated = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ?").get(req.params.id);
    const updRoles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(req.params.id);
    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.id);
    res.json({ ...updated, roles: updRoles, competencySchedule: schedule || null });
  });

  // Delete employee (hard delete — removes employee and associated roles/schedules)
  app.delete("/api/staff/employees/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT id FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });
    const emp = (db as any).$client.prepare("SELECT id FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.id, lab.id);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    (db as any).$client.prepare("DELETE FROM staff_competency_schedules WHERE employee_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM staff_roles WHERE employee_id = ?").run(req.params.id);
    (db as any).$client.prepare("DELETE FROM staff_employees WHERE id = ?").run(req.params.id);
    res.json({ ok: true, deleted: req.params.id });
  });

  // Update competency schedule
  app.put("/api/staff/competency/:employeeId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not found" });

    const emp = (db as any).$client.prepare("SELECT * FROM staff_employees WHERE id = ? AND lab_id = ?").get(req.params.employeeId, lab.id) as any;
    if (!emp) return res.status(404).json({ error: "Employee not found" });

    const { initialCompletedAt, initialSignedBy, sixMonthCompletedAt, sixMonthSignedBy, firstAnnualCompletedAt, firstAnnualSignedBy, lastAnnualCompletedAt, lastAnnualSignedBy, notes } = req.body;

    const accreditor = lab.accreditation_body;
    const includesTJCorCAP = ["TJC", "CAP"].includes(accreditor);

    // Recalculate due dates based on completions
    let sixMonthDue: string | null = null;
    let firstAnnualDue: string | null = null;
    let annualDue: string | null = null;

    if (includesTJCorCAP && initialCompletedAt) {
      // 6-month due = 6 months from initial completion
      const d = new Date(initialCompletedAt);
      d.setMonth(d.getMonth() + 6);
      sixMonthDue = d.toISOString().split('T')[0];
    } else if (emp.hire_date) {
      const d = new Date(emp.hire_date);
      d.setMonth(d.getMonth() + 6);
      sixMonthDue = d.toISOString().split('T')[0];
    }

    const actualSixMonth = sixMonthCompletedAt;
    if (actualSixMonth) {
      if (includesTJCorCAP) {
        // 1st annual = 6 months after 6-month completion
        const d = new Date(actualSixMonth);
        d.setMonth(d.getMonth() + 6);
        firstAnnualDue = d.toISOString().split('T')[0];
      } else {
        // CLIA only: annual = 12 months after 6-month completion
        const d = new Date(actualSixMonth);
        d.setMonth(d.getMonth() + 12);
        annualDue = d.toISOString().split('T')[0];
      }
    }

    if (firstAnnualCompletedAt) {
      const d = new Date(firstAnnualCompletedAt);
      d.setMonth(d.getMonth() + 12);
      annualDue = d.toISOString().split('T')[0];
    }

    if (lastAnnualCompletedAt) {
      const d = new Date(lastAnnualCompletedAt);
      d.setMonth(d.getMonth() + 12);
      annualDue = d.toISOString().split('T')[0];
    }

    // NYS six-month due
    let nysSixMonthDue: string | null = null;
    if (lab.includes_nys === 1 && emp.hire_date) {
      const d = new Date(emp.hire_date);
      d.setMonth(d.getMonth() + 6);
      nysSixMonthDue = d.toISOString().split('T')[0];
    }

    const existing = (db as any).$client.prepare("SELECT id FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.employeeId) as any;
    if (existing) {
      (db as any).$client.prepare(
        `UPDATE staff_competency_schedules SET initial_completed_at=?, initial_signed_by=?, six_month_due_at=?, six_month_completed_at=?, six_month_signed_by=?, first_annual_due_at=?, first_annual_completed_at=?, first_annual_signed_by=?, annual_due_at=?, last_annual_completed_at=?, last_annual_signed_by=?, nys_six_month_due_at=?, notes=? WHERE employee_id=?`
      ).run(
        initialCompletedAt || null, initialSignedBy || null,
        sixMonthDue, actualSixMonth || null, sixMonthSignedBy || null,
        firstAnnualDue, firstAnnualCompletedAt || null, firstAnnualSignedBy || null,
        annualDue, lastAnnualCompletedAt || null, lastAnnualSignedBy || null,
        nysSixMonthDue, notes || null, req.params.employeeId
      );
    } else {
      (db as any).$client.prepare(
        "INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, initial_signed_by, six_month_due_at, six_month_completed_at, six_month_signed_by, first_annual_due_at, first_annual_completed_at, first_annual_signed_by, annual_due_at, last_annual_completed_at, last_annual_signed_by, nys_six_month_due_at, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        req.params.employeeId, lab.id,
        initialCompletedAt || null, initialSignedBy || null,
        sixMonthDue, actualSixMonth || null, sixMonthSignedBy || null,
        firstAnnualDue, firstAnnualCompletedAt || null, firstAnnualSignedBy || null,
        annualDue, lastAnnualCompletedAt || null, lastAnnualSignedBy || null,
        nysSixMonthDue, notes || null
      );
    }

    const schedule = (db as any).$client.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(req.params.employeeId);
    res.json(schedule);
  });

  // Generate CMS 209 PDF
  app.post("/api/staff/cms209", authMiddleware, async (req: any, res) => {
    if (!hasStaffAccess(req.user)) return res.status(403).json({ error: "VeritaStaff subscription required" });
    const lab = (db as any).$client.prepare("SELECT * FROM staff_labs WHERE user_id = ?").get(req.user.userId) as any;
    if (!lab) return res.status(400).json({ error: "Lab not set up" });

    const employees = (db as any).$client.prepare(
      "SELECT * FROM staff_employees WHERE lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
    ).all(lab.id) as any[];

    const employeesWithRoles = employees.map((emp: any) => {
      const roles = (db as any).$client.prepare("SELECT * FROM staff_roles WHERE employee_id = ?").all(emp.id);
      return { ...emp, roles };
    });

    try {
      const pdfBuffer = await generateCMS209PDF({
        lab,
        employees: employeesWithRoles,
        specialties: CMS_SPECIALTIES,
      });
      const date = new Date().toISOString().split("T")[0];
      const filename = `CMS_209_${lab.clia_number}_${date}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      res.send(pdfBuffer);
    } catch (err: any) {
      console.error("CMS 209 PDF generation error:", err);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // Get CMS specialties reference
  app.get("/api/staff/specialties", (_req: any, res) => {
    res.json(CMS_SPECIALTIES);
  });

  // ── CLIA LOOKUP ───────────────────────────────────────────────────────────

  app.post("/api/clia/lookup", async (req, res) => {
    const { clia_number } = req.body;
    if (!clia_number || typeof clia_number !== "string" || clia_number.trim().length < 5) {
      return res.status(400).json({ error: "Valid CLIA number required" });
    }
    const cliaNum = clia_number.trim().toUpperCase();

    let labData: any = null;

    // Try CMS Data API first
    try {
      const query = encodeURIComponent(`SELECT * FROM 4pq5-ikyk WHERE provider_number = '${cliaNum}' LIMIT 1`);
      const cmsUrl = `https://data.cms.gov/provider-data/api/1/datastore/sql?query=[${query}]`;
      const cmsRes = await fetch(cmsUrl, { signal: AbortSignal.timeout(10000) });
      if (cmsRes.ok) {
        const cmsData = await cmsRes.json();
        const rows = Array.isArray(cmsData) ? cmsData : (cmsData?.results || []);
        if (rows.length > 0) {
          const row = rows[0];
          labData = {
            facility_name: row.facility_name || row.prvdr_ctgry_desc || row.name || "",
            address: [row.street_address || row.st_adr, row.city, row.state, row.zip_code || row.zip].filter(Boolean).join(", "),
            city: row.city || "",
            state: row.state || "",
            zip: row.zip_code || row.zip || "",
            lab_director: [row.first_name || row.drctrs_first_nm, row.last_name || row.drctrs_last_nm].filter(Boolean).join(" "),
            certificate_type: row.certificate_type || row.crtfct_type_cd || "",
            specialty_count: 0,
            specialties: [],
            valid_through: row.expiration_date || row.exprtn_dt || null,
          };
          // Count specialties from CMS data columns
          const specCols = Object.keys(row).filter(k => /specialty|spclty/i.test(k) && row[k]);
          labData.specialty_count = specCols.length || 1;
          labData.specialties = specCols.map((k: string) => row[k]);
        }
      }
    } catch (err: any) {
      console.log("[CLIA] CMS Data API failed, trying QCOR:", err.message);
    }

    // Fallback: try QCOR API
    if (!labData) {
      try {
        const qcorUrl = `https://qcor.cms.gov/api/public/clia/lab?clia_id=${cliaNum}`;
        const qcorRes = await fetch(qcorUrl, { signal: AbortSignal.timeout(10000) });
        if (qcorRes.ok) {
          const qcorData = await qcorRes.json();
          if (qcorData && (qcorData.facility_name || qcorData.name)) {
            labData = {
              facility_name: qcorData.facility_name || qcorData.name || "",
              address: [qcorData.address, qcorData.city, qcorData.state, qcorData.zip].filter(Boolean).join(", "),
              city: qcorData.city || "",
              state: qcorData.state || "",
              zip: qcorData.zip || "",
              lab_director: qcorData.lab_director || qcorData.director || "",
              certificate_type: qcorData.certificate_type || "",
              specialty_count: qcorData.specialties?.length || qcorData.specialty_count || 1,
              specialties: qcorData.specialties || [],
              valid_through: qcorData.expiration_date || null,
            };
          }
        }
      } catch (err: any) {
        console.log("[CLIA] QCOR API also failed:", err.message);
      }
    }

    if (!labData) {
      return res.status(404).json({ error: "CLIA number not found. Please verify and try again." });
    }

    // Determine tier from certificate type and specialty count
    const certType = (labData.certificate_type || "").toLowerCase();
    let tier: string;
    let base_price: number;

    if (certType.includes("waiv")) {
      tier = "waived";
      base_price = 499;
    } else if (labData.specialty_count >= 16) {
      tier = "large_hospital";
      base_price = 1999;
    } else if (labData.specialty_count >= 9) {
      tier = "hospital";
      base_price = 1299;
    } else {
      tier = "community";
      base_price = 799;
    }

    res.json({
      clia_number: cliaNum,
      facility_name: labData.facility_name,
      address: labData.address,
      city: labData.city,
      state: labData.state,
      zip: labData.zip,
      lab_director: labData.lab_director,
      certificate_type: labData.certificate_type,
      specialty_count: labData.specialty_count,
      specialties: labData.specialties,
      valid_through: labData.valid_through,
      tier,
      base_price,
    });
  });

  app.post("/api/clia/confirm", authMiddleware, (req: any, res) => {
    const { clia_number, facility_name, address, lab_director, specialty_count, certificate_type, tier } = req.body;
    if (!clia_number) return res.status(400).json({ error: "CLIA number required" });

    const now = new Date().toISOString();
    (db as any).$client.prepare(`
      UPDATE users SET
        clia_number = ?, clia_lab_name = ?, clia_address = ?, clia_director = ?,
        clia_specialty_count = ?, clia_certificate_type = ?, clia_tier = ?, clia_verified_at = ?
      WHERE id = ?
    `).run(clia_number, facility_name || null, address || null, lab_director || null,
      specialty_count || null, certificate_type || null, tier || null, now, req.userId);

    res.json({ ok: true, tier });
  });

  // ── NAMED SEAT MANAGEMENT ────────────────────────────────────────────────

  // List seats for current account owner
  app.get("/api/account/seats", authMiddleware, (req: any, res) => {
    const seats = (db as any).$client.prepare(
      "SELECT * FROM user_seats WHERE owner_user_id = ? ORDER BY id"
    ).all(req.userId);
    const userRow = (db as any).$client.prepare("SELECT seat_count FROM users WHERE id = ?").get(req.userId);
    res.json({ seats, seat_count: userRow?.seat_count || 1 });
  });

  // Add a seat (invite)
  app.post("/api/account/seats", authMiddleware, async (req: any, res) => {
    const { email } = req.body;
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email required" });

    const userRow = (db as any).$client.prepare("SELECT seat_count FROM users WHERE id = ?").get(req.userId) as any;
    const maxSeats = userRow?.seat_count || 1;
    const currentSeats = (db as any).$client.prepare(
      "SELECT COUNT(*) as cnt FROM user_seats WHERE owner_user_id = ? AND status != 'deactivated'"
    ).get(req.userId) as any;

    // +1 for the owner seat
    if ((currentSeats?.cnt || 0) + 1 >= maxSeats) {
      return res.status(403).json({ error: "Seat limit reached. Purchase additional seats to add more users." });
    }

    const now = new Date().toISOString();
    const existing = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE owner_user_id = ? AND seat_email = ?"
    ).get(req.userId, email.toLowerCase());
    if (existing) return res.status(409).json({ error: "This email already has a seat assigned" });

    // Check if invited user already has an account
    const existingUser = storage.getUserByEmail(email.toLowerCase());
    const seatUserId = existingUser ? existingUser.id : null;

    (db as any).$client.prepare(
      "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, status) VALUES (?, ?, ?, ?, ?)"
    ).run(req.userId, email.toLowerCase(), seatUserId, now, seatUserId ? "active" : "pending");

    // Send invite email via Resend
    const owner = storage.getUserById(req.userId);
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.RESEND_API_KEY || "re_iuVZocND_7KCES3ak8QYN4funPUF3oF1z"}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "VeritaAssure <noreply@veritaslabservices.com>",
          to: email.toLowerCase(),
          subject: `You've been invited to ${owner?.name || "a lab"}'s VeritaAssure account`,
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
              <h2 style="color:#01696F">VeritaAssure\u2122 Seat Invitation</h2>
              <p>${owner?.name || "Your lab administrator"} has assigned you a seat on their VeritaAssure account.</p>
              <p>Create your account using this email address (${email}) to get started:</p>
              <a href="${FRONTEND_URL}/#/login" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">Create Account</a>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
              <p style="color:#999;font-size:12px">Veritas Lab Services, LLC</p>
            </div>
          `,
        }),
      });
    } catch (emailErr) {
      console.error("[seats] Invite email failed:", emailErr);
    }

    res.json({ ok: true, status: seatUserId ? "active" : "pending" });
  });

  // Deactivate a seat
  app.delete("/api/account/seats/:seatId", authMiddleware, (req: any, res) => {
    const seat = (db as any).$client.prepare(
      "SELECT id FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(req.params.seatId, req.userId);
    if (!seat) return res.status(404).json({ error: "Seat not found" });

    (db as any).$client.prepare("UPDATE user_seats SET status = 'deactivated' WHERE id = ?").run(req.params.seatId);
    res.json({ ok: true });
  });

  // ── SESSION MANAGEMENT ───────────────────────────────────────────────────

  app.post("/api/auth/force-logout", authMiddleware, (req: any, res) => {
    // Deactivate all sessions for this user
    (db as any).$client.prepare(
      "UPDATE user_sessions SET is_active = 0 WHERE user_id = ?"
    ).run(req.userId);

    // Create new session
    const sessionToken = crypto.randomUUID();
    const now = new Date().toISOString();
    const deviceInfo = req.headers["user-agent"] || "Unknown";
    (db as any).$client.prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active) VALUES (?, ?, ?, ?, ?, 1)"
    ).run(req.userId, sessionToken, deviceInfo, now, now);

    res.json({ ok: true, session_token: sessionToken });
  });

  // Force logout a specific seat's sessions (for account owner)
  app.post("/api/account/seats/:seatId/force-logout", authMiddleware, (req: any, res) => {
    const seat = (db as any).$client.prepare(
      "SELECT seat_user_id FROM user_seats WHERE id = ? AND owner_user_id = ?"
    ).get(req.params.seatId, req.userId) as any;
    if (!seat || !seat.seat_user_id) return res.status(404).json({ error: "Seat not found or user not registered" });

    (db as any).$client.prepare(
      "UPDATE user_sessions SET is_active = 0 WHERE user_id = ?"
    ).run(seat.seat_user_id);

    res.json({ ok: true });
  });

  // Logout (mark session inactive)
  app.post("/api/auth/logout", authMiddleware, (req: any, res) => {
    const { session_token } = req.body;
    if (session_token) {
      (db as any).$client.prepare(
        "UPDATE user_sessions SET is_active = 0 WHERE session_token = ?"
      ).run(session_token);
    }
    res.json({ ok: true });
  });

  // ── VERITALAB ──────────────────────────────────────────────────────────

  function hasLabCertAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital"].includes(user?.plan);
  }

  function scheduleReminders(certId: number, userId: number, expirationDate: string) {
    // Delete existing reminders for this certificate
    (db as any).$client.prepare("DELETE FROM lab_certificate_reminders WHERE certificate_id = ?").run(certId);

    if (!expirationDate) return;

    const exp = new Date(expirationDate);
    if (isNaN(exp.getTime())) return;

    const reminders: { type: string; months?: number; days?: number }[] = [
      { type: "9month", months: 9 },
      { type: "6month", months: 6 },
      { type: "3month", months: 3 },
      { type: "30day", days: 30 },
      { type: "expired" },
    ];

    const stmt = (db as any).$client.prepare(
      "INSERT INTO lab_certificate_reminders (certificate_id, user_id, reminder_type, scheduled_date, is_sent) VALUES (?, ?, ?, ?, 0)"
    );

    for (const r of reminders) {
      let scheduledDate: Date;
      if (r.type === "expired") {
        scheduledDate = new Date(exp);
      } else if (r.months) {
        scheduledDate = new Date(exp);
        scheduledDate.setMonth(scheduledDate.getMonth() - r.months);
      } else if (r.days) {
        scheduledDate = new Date(exp);
        scheduledDate.setDate(scheduledDate.getDate() - r.days);
      } else {
        continue;
      }
      stmt.run(certId, userId, r.type, scheduledDate.toISOString().split("T")[0]);
    }
  }

  // GET /api/veritalab/certificates - list all certificates for user
  app.get("/api/veritalab/certificates", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });

    // Auto-populate CLIA certificate if user has clia_number but no CLIA cert yet
    const userRow = (db as any).$client.prepare("SELECT * FROM users WHERE id = ?").get(req.userId) as any;
    if (userRow?.clia_number) {
      const existingClia = (db as any).$client.prepare(
        "SELECT id FROM lab_certificates WHERE user_id = ? AND cert_type = 'clia' AND is_active = 1"
      ).get(req.userId);
      if (!existingClia) {
        const now = new Date().toISOString();
        (db as any).$client.prepare(
          "INSERT INTO lab_certificates (user_id, cert_type, cert_name, cert_number, issuing_body, lab_director, is_auto_populated, notes, created_at, updated_at) VALUES (?, 'clia', 'CLIA Certificate', ?, 'Centers for Medicare and Medicaid Services (CMS)', ?, 1, 'Auto-populated from CLIA lookup. Please enter your expiration date.', ?, ?)"
        ).run(req.userId, userRow.clia_number, userRow.clia_director || null, now, now);
      }
    }

    const certs = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC"
    ).all(req.userId) as any[];

    // Attach document count for each certificate
    const result = certs.map((cert: any) => {
      const docCount = (db as any).$client.prepare(
        "SELECT COUNT(*) as cnt FROM lab_certificate_documents WHERE certificate_id = ? AND user_id = ?"
      ).get(cert.id, req.userId) as any;
      return { ...cert, document_count: docCount?.cnt || 0 };
    });

    res.json(result);
  });

  // POST /api/veritalab/certificates - create a new certificate
  app.post("/api/veritalab/certificates", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const { cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes } = req.body;
    if (!cert_name?.trim()) return res.status(400).json({ error: "Certificate name required" });

    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO lab_certificates (user_id, cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes, is_auto_populated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
    ).run(req.userId, cert_type || "other", cert_name.trim(), cert_number || null, issuing_body || null, issued_date || null, expiration_date || null, lab_director || null, notes || null, now, now);

    const certId = Number(result.lastInsertRowid);
    if (expiration_date) {
      scheduleReminders(certId, req.userId, expiration_date);
    }

    const cert = (db as any).$client.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(certId);
    res.status(201).json(cert);
  });

  // PUT /api/veritalab/certificates/:id - update a certificate
  app.put("/api/veritalab/certificates/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });

    const existing = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId) as any;
    if (!existing) return res.status(404).json({ error: "Certificate not found" });

    const { cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes } = req.body;
    const now = new Date().toISOString();

    (db as any).$client.prepare(
      "UPDATE lab_certificates SET cert_type=?, cert_name=?, cert_number=?, issuing_body=?, issued_date=?, expiration_date=?, lab_director=?, notes=?, updated_at=? WHERE id=?"
    ).run(
      cert_type ?? existing.cert_type,
      cert_name?.trim() ?? existing.cert_name,
      cert_number ?? existing.cert_number,
      issuing_body ?? existing.issuing_body,
      issued_date ?? existing.issued_date,
      expiration_date ?? existing.expiration_date,
      lab_director ?? existing.lab_director,
      notes ?? existing.notes,
      now,
      req.params.id
    );

    // Reschedule reminders if expiration_date changed
    const newExp = expiration_date ?? existing.expiration_date;
    if (newExp) {
      scheduleReminders(Number(req.params.id), req.userId, newExp);
    }

    const cert = (db as any).$client.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(req.params.id);
    res.json(cert);
  });

  // DELETE /api/veritalab/certificates/:id - soft delete
  app.delete("/api/veritalab/certificates/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const existing = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!existing) return res.status(404).json({ error: "Certificate not found" });

    const now = new Date().toISOString();
    (db as any).$client.prepare("UPDATE lab_certificates SET is_active = 0, updated_at = ? WHERE id = ?").run(now, req.params.id);
    // Remove pending reminders
    (db as any).$client.prepare("DELETE FROM lab_certificate_reminders WHERE certificate_id = ? AND is_sent = 0").run(req.params.id);
    res.json({ success: true });
  });

  // POST /api/veritalab/certificates/:id/documents - upload document
  const multer = require("multer");
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max

  app.post("/api/veritalab/certificates/:id/documents", authMiddleware, requireWriteAccess, upload.single("file"), (req: any, res: any) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const cert = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });

    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const now = new Date().toISOString();
    const filename = `${Date.now()}_${req.file.originalname}`;
    const result = (db as any).$client.prepare(
      "INSERT INTO lab_certificate_documents (certificate_id, user_id, filename, original_filename, file_size, mime_type, file_data, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(req.params.id, req.userId, filename, req.file.originalname, req.file.size, req.file.mimetype, req.file.buffer, now);

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      certificate_id: Number(req.params.id),
      filename,
      original_filename: req.file.originalname,
      file_size: req.file.size,
      mime_type: req.file.mimetype,
      uploaded_at: now,
    });
  });

  // GET /api/veritalab/certificates/:id/documents - list documents
  app.get("/api/veritalab/certificates/:id/documents", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const cert = (db as any).$client.prepare(
      "SELECT id FROM lab_certificates WHERE id = ? AND user_id = ? AND is_active = 1"
    ).get(req.params.id, req.userId);
    if (!cert) return res.status(404).json({ error: "Certificate not found" });

    const docs = (db as any).$client.prepare(
      "SELECT id, certificate_id, filename, original_filename, file_size, mime_type, uploaded_at FROM lab_certificate_documents WHERE certificate_id = ? AND user_id = ? ORDER BY uploaded_at DESC"
    ).all(req.params.id, req.userId);
    res.json(docs);
  });

  // GET /api/veritalab/certificates/:id/documents/:docId - download document
  app.get("/api/veritalab/certificates/:id/documents/:docId", authMiddleware, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const doc = (db as any).$client.prepare(
      "SELECT * FROM lab_certificate_documents WHERE id = ? AND certificate_id = ? AND user_id = ?"
    ).get(req.params.docId, req.params.id, req.userId) as any;
    if (!doc) return res.status(404).json({ error: "Document not found" });

    res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${doc.original_filename}"`);
    res.setHeader("Content-Length", doc.file_size);
    res.send(doc.file_data);
  });

  // DELETE /api/veritalab/certificates/:id/documents/:docId - delete document
  app.delete("/api/veritalab/certificates/:id/documents/:docId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });
    const doc = (db as any).$client.prepare(
      "SELECT id FROM lab_certificate_documents WHERE id = ? AND certificate_id = ? AND user_id = ?"
    ).get(req.params.docId, req.params.id, req.userId);
    if (!doc) return res.status(404).json({ error: "Document not found" });

    (db as any).$client.prepare("DELETE FROM lab_certificate_documents WHERE id = ?").run(req.params.docId);
    res.json({ success: true });
  });

  // POST /api/veritalab/check-reminders - check and send due reminders
  app.post("/api/veritalab/check-reminders", (req: any, res) => {
    const adminSecret = req.headers["x-admin-secret"];
    if (adminSecret !== (process.env.ADMIN_SECRET || "veritas-admin-2026")) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const today = new Date().toISOString().split("T")[0];
    const dueReminders = (db as any).$client.prepare(
      "SELECT r.*, c.cert_name, c.cert_number, c.expiration_date FROM lab_certificate_reminders r JOIN lab_certificates c ON c.id = r.certificate_id WHERE r.scheduled_date <= ? AND r.is_sent = 0 AND c.is_active = 1"
    ).all(today) as any[];

    let sent = 0;
    let errors = 0;

    const reminderLabels: Record<string, string> = {
      "9month": "9-Month Reminder",
      "6month": "6-Month Reminder",
      "3month": "3-Month Reminder",
      "30day": "30-Day Reminder",
      "expired": "Expiration Notice",
    };

    for (const reminder of dueReminders) {
      const user = (db as any).$client.prepare("SELECT email, clia_lab_name FROM users WHERE id = ?").get(reminder.user_id) as any;
      if (!user?.email) continue;

      const label = reminderLabels[reminder.reminder_type] || reminder.reminder_type;
      const expDate = reminder.expiration_date ? new Date(reminder.expiration_date).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" }) : "Unknown";
      const subject = `${label} - ${reminder.cert_name} expires ${expDate}`;

      const htmlBody = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
          <h2 style="color:#01696F;margin-bottom:16px">Your ${reminder.cert_name} is expiring soon.</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
            <tr><td style="padding:6px 0;color:#666">Certificate:</td><td style="padding:6px 0;font-weight:600">${reminder.cert_name}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Number:</td><td style="padding:6px 0">${reminder.cert_number || "N/A"}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Expiration:</td><td style="padding:6px 0;font-weight:600;color:#c53030">${expDate}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Lab:</td><td style="padding:6px 0">${user.clia_lab_name || "Your laboratory"}</td></tr>
          </table>
          <p style="margin-bottom:20px">Log in to VeritaAssure to view your certificate details and upload renewal documentation.</p>
          <a href="https://www.veritaslabservices.com/#/veritalab-app" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Open VeritaLab\u2122</a>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="color:#999;font-size:12px">VeritaAssure\u2122 | Veritas Lab Services, LLC</p>
        </div>
      `;

      try {
        if (resend) {
          resend.emails.send({
            from: "VeritaAssure <info@veritaslabservices.com>",
            to: user.email,
            subject,
            html: htmlBody,
          });
        }
        (db as any).$client.prepare(
          "UPDATE lab_certificate_reminders SET is_sent = 1, sent_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), reminder.id);
        sent++;
      } catch (err) {
        console.error("[VeritaLab] Reminder email failed:", err);
        errors++;
      }
    }

    res.json({ processed: dueReminders.length, sent, errors });
  });

  // POST /api/veritalab/certificates/excel - export certificates to Excel
  app.post("/api/veritalab/certificates/excel", authMiddleware, async (req: any, res) => {
    if (!hasLabCertAccess(req.user)) return res.status(403).json({ error: "VeritaLab subscription required" });

    const certs = (db as any).$client.prepare(
      "SELECT * FROM lab_certificates WHERE user_id = ? AND is_active = 1 ORDER BY expiration_date ASC"
    ).all(req.userId) as any[];

    try {
      const ExcelJS = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Certificates");

      const headers = [
        "Certificate Name", "Type", "Number", "Issuing Body", "Issued Date",
        "Expiration Date", "Days Until Expiration", "Status", "Lab Director",
        "Documents Count", "Notes",
      ];

      const colWidths = [28, 18, 20, 35, 16, 16, 22, 16, 22, 18, 30];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const today = new Date();
      const rows = certs.map((c: any) => {
        const docCount = (db as any).$client.prepare(
          "SELECT COUNT(*) as cnt FROM lab_certificate_documents WHERE certificate_id = ?"
        ).get(c.id) as any;

        let daysUntil = "";
        let status = "No expiration date";
        if (c.expiration_date) {
          const exp = new Date(c.expiration_date);
          const diffMs = exp.getTime() - today.getTime();
          const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          daysUntil = String(diffDays);
          if (diffDays < 0) status = "Expired";
          else if (diffDays <= 30) status = "Expires Soon";
          else if (diffDays <= 90) status = "Expiring";
          else status = "Current";
        }

        const typeLabels: Record<string, string> = {
          clia: "CLIA", cap: "CAP", tjc: "TJC", state_license: "State License",
          lab_director_license: "Lab Director License", other: "Other",
        };

        return [
          c.cert_name, typeLabels[c.cert_type] || c.cert_type, c.cert_number || "",
          c.issuing_body || "", c.issued_date || "", c.expiration_date || "",
          daysUntil, status, c.lab_director || "", docCount?.cnt || 0, c.notes || "",
        ];
      });

      for (const row of rows) {
        ws.addRow(row);
      }

      // Shared border style
      const thinBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };

      // Header row styling
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        cell.border = thinBorder;
      });

      // Data rows
      const statusCol = 8; // 1-indexed
      for (let r = 2; r <= rows.length + 1; r++) {
        const row = ws.getRow(r);
        const isEvenRow = r % 2 === 0;
        const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = thinBorder;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };

          if (colNumber === statusCol) {
            const val = String(cell.value || "");
            if (/Expired/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
            } else if (/Expires Soon|Expiring/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
            } else if (/Current/i.test(val)) {
              cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
            }
          }
        });
      }

      // Freeze pane at B2
      ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 1, topLeftCell: "B2" }];

      // Auto-filter
      const lastColLetter = String.fromCharCode(64 + headers.length);
      ws.autoFilter = { from: "A1", to: `${lastColLetter}1` };

      const buffer = await wb.xlsx.writeBuffer();
      const date = new Date().toISOString().split("T")[0];
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaLab_Certificates_${date}.xlsx"`);
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      console.error("[VeritaLab] Excel export error:", err);
      res.status(500).json({ error: "Excel export failed" });
    }
  });

  return httpServer;
}
