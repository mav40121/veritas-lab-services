import type { Express, Request, Response } from "express";
import type { Server } from "http";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import { db } from "./db";
import { stripe, PRICES, WEBHOOK_SECRET, FRONTEND_URL } from "./stripe";
import crypto from "crypto";
import { Resend } from "resend";
import { generatePDFBuffer, generateCumsumPDF, generateVeritaScanPDF, generateCompetencyPDF } from "./pdfReport";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
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
    const planCredits = ["annual", "starter", "professional", "lab", "complete"].includes(plan) ? 99999 : (credits ?? 0);
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
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits, hasCompletedOnboarding: false } });
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
    const hasCompletedOnboarding = (db as any).$client.prepare("SELECT has_completed_onboarding FROM users WHERE id = ?").get(user.id)?.has_completed_onboarding ?? 1;
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding } });
  });

  app.get("/api/auth/me", authMiddleware, (req: any, res) => {
    const user = storage.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    const hasCompletedOnboarding = (db as any).$client.prepare("SELECT has_completed_onboarding FROM users WHERE id = ?").get(user.id)?.has_completed_onboarding ?? 1;
    res.json({ id: user.id, email: user.email, name: user.name, plan: user.plan, studyCredits: user.studyCredits, hasCompletedOnboarding: !!hasCompletedOnboarding });
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
      // Gate: PT/Coag New Lot Validation is Coming Soon — pending regulatory review
      if (study.studyType === "pt_coag") return res.status(403).json({ error: "PT/Coag New Lot Validation is not yet available" });
      const pdfBuffer = await generatePDFBuffer(study, results);
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
    return ["annual", "professional", "lab", "complete", "veritamap"].includes(user?.plan);
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
  app.post("/api/veritamap/maps", authMiddleware, (req: any, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Map name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)"
    ).run(req.user.userId, name.trim(), now, now);
    res.json({ id: Number(result.lastInsertRowid), name: name.trim(), created_at: now, updated_at: now });
  });

  // Delete map
  app.delete("/api/veritamap/maps/:id", authMiddleware, (req: any, res) => {
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
  app.put("/api/veritamap/maps/:id/tests", authMiddleware, (req: any, res) => {
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
  app.post("/api/veritamap/maps/:id/instruments", authMiddleware, (req: any, res) => {
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
  app.put("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    const { instrument_name, role, category } = req.body;
    (db as any).$client.prepare(
      "UPDATE veritamap_instruments SET instrument_name=?, role=?, category=? WHERE id=? AND map_id=?"
    ).run(instrument_name, role, category, req.params.instId, req.params.id);
    res.json({ ok: true });
  });

  // Delete instrument (cascades to its tests)
  app.delete("/api/veritamap/maps/:id/instruments/:instId", authMiddleware, (req: any, res) => {
    const map = (db as any).$client.prepare("SELECT id FROM veritamap_maps WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!map) return res.status(404).json({ error: "Map not found" });
    (db as any).$client.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id = ?").run(req.params.instId);
    (db as any).$client.prepare("DELETE FROM veritamap_instruments WHERE id = ? AND map_id = ?").run(req.params.instId, req.params.id);
    res.json({ ok: true });
  });

  // Set tests for an instrument (replaces all)
  app.put("/api/veritamap/maps/:id/instruments/:instId/tests", authMiddleware, (req: any, res) => {
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
  app.put("/api/veritamap/maps/:id/tests/:analyte", authMiddleware, (req: any, res) => {
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
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // ── Sheet 1: Compliance Map ──
      const headers = [
        "Analyte", "Instruments", "Department", "Specialty", "Complexity",
        "Number of Instruments", "CFR Section", "Correlation Required",
        "Typical Unit of Measure", "Typical Adult Reference Range", "Typical AMR",
        "Mayo Recommended Critical Low", "Mayo Recommended Critical High", "Mayo Critical Value Units",
        "Lab Critical Low", "Lab Critical High", "Lab AMR Low", "Lab AMR High",
        "Last Cal Ver Date", "Cal Ver Status", "Last Method Comp Date", "Method Comp Status",
        "Last Precision Date", "Precision Status", "Last SOP Review Date", "SOP Review Status",
        "Notes",
      ];

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

      const sheetData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Column widths
      ws["!cols"] = [
        { wch: 25 },  // Analyte
        { wch: 18 },  // Department
        { wch: 18 },  // Specialty
        { wch: 12 },  // Complexity
        { wch: 40 },  // Instruments
        { wch: 10 },  // # of Instruments
        { wch: 16 },  // CFR Section
        { wch: 14 },  // Correlation Required
        { wch: 16 },  // Unit of Measure
        { wch: 36 },  // Reference Range
        { wch: 32 },  // AMR
        { wch: 20 },  // Mayo Critical Low
        { wch: 20 },  // Mayo Critical High
        { wch: 16 },  // Mayo Critical Units
        { wch: 14 },  // Lab Critical Low
        { wch: 14 },  // Lab Critical High
        { wch: 14 },  // Lab AMR Low
        { wch: 14 },  // Lab AMR High
        { wch: 14 },  // Last Cal Ver Date
        { wch: 14 },  // Cal Ver Status
        { wch: 16 },  // Last Method Comp Date
        { wch: 16 },  // Method Comp Status
        { wch: 14 },  // Last Precision Date
        { wch: 14 },  // Precision Status
        { wch: 16 },  // Last SOP Review Date
        { wch: 16 },  // SOP Review Status
        { wch: 30 },  // Notes
      ];

      // Freeze at C2: columns A (Analyte) and B (Instruments) stay pinned, plus header row
      ws["!freeze"] = { xSplit: 2, ySplit: 1 };

      // Apply cell styles (xlsx community edition has limited style support, but we set what we can)
      // Header row styling
      for (let c = 0; c < headers.length; c++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c });
        if (!ws[cellRef]) continue;
        ws[cellRef].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "006064" } },
          alignment: { horizontal: "center", vertical: "center", wrapText: true },
          border: {
            top: { style: "thin", color: { rgb: "000000" } },
            bottom: { style: "thin", color: { rgb: "000000" } },
            left: { style: "thin", color: { rgb: "000000" } },
            right: { style: "thin", color: { rgb: "000000" } },
          },
        };
      }

      // Data row styling
      for (let r = 1; r <= rows.length; r++) {
        const isOddRow = r % 2 === 1;
        for (let c = 0; c < headers.length; c++) {
          const cellRef = XLSX.utils.encode_cell({ r, c });
          if (!ws[cellRef]) {
            ws[cellRef] = { v: "", t: "s" };
          }
          const style: any = {
            border: {
              top: { style: "thin", color: { rgb: "D0D0D0" } },
              bottom: { style: "thin", color: { rgb: "D0D0D0" } },
              left: { style: "thin", color: { rgb: "D0D0D0" } },
              right: { style: "thin", color: { rgb: "D0D0D0" } },
            },
            alignment: { vertical: "center", wrapText: true },
          };

          // Alternating row shading
          if (isOddRow) {
            style.fill = { fgColor: { rgb: "F9F9F9" } };
          }

          // Lab fill-in columns (14-17, 0-indexed = columns O-R) — light blue
          if (c >= 14 && c <= 17) {
            style.fill = { fgColor: { rgb: "E3F2FD" } };
          }

          // Status columns: color-code based on value
          const statusCols = [19, 21, 23, 25]; // Cal Ver Status, Method Comp Status, Precision Status, SOP Status
          if (statusCols.includes(c)) {
            const val = String(ws[cellRef].v || "");
            if (val === "Overdue") {
              style.fill = { fgColor: { rgb: "FFCCCC" } };
            } else if (val === "Due Soon") {
              style.fill = { fgColor: { rgb: "FFF3CD" } };
            } else if (val === "Missing") {
              style.fill = { fgColor: { rgb: "F5F5F5" } };
            }
          }

          ws[cellRef].s = style;
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, "Compliance Map");

      // ── Sheet 2: Instructions ──
      const ws2 = XLSX.utils.aoa_to_sheet(INSTRUCTIONS_CONTENT);
      ws2["!cols"] = [{ wch: 100 }];
      // Style the title row
      const titleRef = XLSX.utils.encode_cell({ r: 0, c: 0 });
      if (ws2[titleRef]) {
        ws2[titleRef].s = {
          font: { bold: true, sz: 14, color: { rgb: "006064" } },
        };
      }
      XLSX.utils.book_append_sheet(wb, ws2, "Instructions");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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
    return ["annual", "professional", "lab", "complete", "veritascan"].includes(user?.plan);
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
  app.post("/api/veritascan/scans", authMiddleware, (req: any, res) => {
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
  app.delete("/api/veritascan/scans/:id", authMiddleware, (req: any, res) => {
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
  app.put("/api/veritascan/scans/:id/items/:itemId", authMiddleware, (req: any, res) => {
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
  app.put("/api/veritascan/scans/:id/items", authMiddleware, (req: any, res) => {
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
      const XLSX = await import("xlsx");
      const rows = referenceItems.map((ref: any) => {
        const saved = itemMap[ref.id] || {};
        return {
          "Item #": ref.id,
          "Domain": ref.domain,
          "Compliance Question": ref.question,
          "TJC Standard": ref.tjc || "",
          "CAP Requirement": ref.cap || "",
          "42 CFR Citation": ref.cfr || "",
          "Status": saved.status || "Not Assessed",
          "Owner": saved.owner || "",
          "Due Date": saved.due_date || "",
          "Notes": saved.notes || "",
        };
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      // Set column widths
      ws["!cols"] = [
        { wch: 8 },   // Item #
        { wch: 28 },  // Domain
        { wch: 80 },  // Question
        { wch: 22 },  // TJC
        { wch: 16 },  // CAP
        { wch: 24 },  // CFR
        { wch: 18 },  // Status
        { wch: 20 },  // Owner
        { wch: 14 },  // Due Date
        { wch: 40 },  // Notes
      ];

      XLSX.utils.book_append_sheet(wb, ws, "VeritaScan");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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

    try {
      const pdfBuffer = await generateVeritaScanPDF(
        {
          scanName: scan.name,
          createdAt: scan.created_at,
          updatedAt: scan.updated_at,
          items: mergedItems,
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
    const { priceType, discountCode } = req.body; // "perStudy" | "starter" | "professional" | "lab" | "complete"
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
          } else if (priceType === "starter" && session.subscription) {
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: "starter",
            });
          } else if (priceType === "professional" && session.subscription) {
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: "professional",
            });
          } else if ((priceType === "lab" || priceType === "complete") && session.subscription) {
            storage.updateUserStripe(userId, {
              stripeSubscriptionId: session.subscription,
              plan: priceType === "complete" ? "lab" : "lab",
            });
          } else if (priceType === "annual" && session.subscription) {
            // Backward compatibility for existing annual subscribers
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

  // ── CUMSUM TRACKER ──────────────────────────────────────────────────────
  function hasCheckAccess(user: any) {
    return ["annual", "starter", "professional", "lab", "complete", "per_study"].includes(user?.plan) || (user?.userId && user.userId <= 11);
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
  app.post("/api/cumsum/trackers", authMiddleware, (req: any, res) => {
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
  app.delete("/api/cumsum/trackers/:id", authMiddleware, (req: any, res) => {
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
  app.post("/api/cumsum/trackers/:id/entries", authMiddleware, (req: any, res) => {
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
  app.delete("/api/cumsum/entries/:id", authMiddleware, (req: any, res) => {
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
      const XLSX = await import("xlsx");
      const rows = entries.map((e: any) => ({
        "Year": e.year,
        "Lot Label": e.lot_label,
        "Old Lot #": e.old_lot_number || "",
        "New Lot #": e.new_lot_number || "",
        "Old GeoMean (sec)": e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : "",
        "New GeoMean (sec)": e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : "",
        "Difference (sec)": e.difference != null ? Number(e.difference).toFixed(1) : "",
        "CumSum (sec)": e.cumsum != null ? Number(e.cumsum).toFixed(1) : "",
        "Verdict": e.verdict || "",
        "Notes": e.notes || "",
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      ws["!cols"] = [{ wch: 8 }, { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, "CUMSUM");
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
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

  // ── DEMO DATA API (public, read-only) ──────────────────────────────────
  app.get("/api/demo/data", (_req, res) => {
    // Find the demo user
    const demoUser = (db as any).$client.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get();
    if (!demoUser) return res.json({ maps: [], scans: [], studies: [], cumsumTrackers: [] });

    const userId = demoUser.id;

    // VeritaMap maps
    const maps = (db as any).$client.prepare("SELECT * FROM veritamap_maps WHERE user_id = ?").all(userId);
    const mapsWithData = maps.map((m: any) => {
      const instruments = (db as any).$client.prepare("SELECT * FROM veritamap_instruments WHERE map_id = ?").all(m.id);
      const instrumentsWithTests = instruments.map((inst: any) => {
        const tests = (db as any).$client.prepare("SELECT * FROM veritamap_instrument_tests WHERE instrument_id = ?").all(inst.id);
        return { ...inst, tests };
      });
      const mapTests = (db as any).$client.prepare("SELECT * FROM veritamap_tests WHERE map_id = ?").all(m.id);

      // Compute intelligence
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

    // VeritaScan scans
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

    // Studies
    const studies = (db as any).$client.prepare("SELECT * FROM studies WHERE user_id = ? ORDER BY id DESC").all(userId);

    // CUMSUM trackers
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

  // ── VERITACOMPETENCY ───────────────────────────────────────────────────

  function hasCompetencyAccess(user: any) {
    return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacompetency"].includes(user?.plan);
  }

  // List programs
  app.get("/api/competency/programs", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
  app.post("/api/competency/programs", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
  });

  // Get single program with full data
  app.get("/api/competency/programs/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
  app.delete("/api/competency/programs/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
  app.put("/api/competency/programs/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
    const employees = (db as any).$client.prepare(
      "SELECT * FROM competency_employees WHERE user_id = ? ORDER BY name"
    ).all(req.user.userId);
    res.json(employees);
  });

  app.post("/api/competency/employees", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
    const { name, title, hireDate, lisInitials } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Employee name required" });
    const now = new Date().toISOString();
    const result = (db as any).$client.prepare(
      "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
    ).run(req.user.userId, name.trim(), title || "", hireDate || null, lisInitials || null, now);
    res.json({ id: Number(result.lastInsertRowid), user_id: req.user.userId, name: name.trim(), title: title || "", hire_date: hireDate || null, lis_initials: lisInitials || null, status: "active", created_at: now });
  });

  app.put("/api/competency/employees/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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

  app.delete("/api/competency/employees/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
    const emp = (db as any).$client.prepare("SELECT id FROM competency_employees WHERE id = ? AND user_id = ?").get(req.params.id, req.user.userId);
    if (!emp) return res.status(404).json({ error: "Employee not found" });
    (db as any).$client.prepare("UPDATE competency_employees SET status = 'inactive' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── ASSESSMENTS ───────────────────────────────────────────────────────────

  app.post("/api/competency/assessments", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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

    // Insert assessment items
    if (Array.isArray(items)) {
      const stmt = (db as any).$client.prepare(
        `INSERT INTO competency_assessment_items (assessment_id, method_number, method_group_id, item_label, item_description, evidence, date_met, employee_initials, supervisor_initials, passed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(assessmentId, item.methodNumber ?? null, item.methodGroupId ?? null, item.itemLabel ?? null, item.itemDescription ?? null, item.evidence ?? null, item.dateMet ?? null, item.employeeInitials ?? null, item.supervisorInitials ?? null, item.passed ? 1 : 0);
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
  app.put("/api/competency/assessments/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
        `INSERT INTO competency_assessment_items (assessment_id, method_number, method_group_id, item_label, item_description, evidence, date_met, employee_initials, supervisor_initials, passed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of items) {
        stmt.run(req.params.id, item.methodNumber ?? null, item.methodGroupId ?? null, item.itemLabel ?? null, item.itemDescription ?? null, item.evidence ?? null, item.dateMet ?? null, item.employeeInitials ?? null, item.supervisorInitials ?? null, item.passed ? 1 : 0);
      }
    }
    res.json({ ok: true });
  });

  // Delete assessment
  app.delete("/api/competency/assessments/:id", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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

  // VeritaMap integration — get instruments from a map for method group suggestions
  app.get("/api/competency/map-instruments/:mapId", authMiddleware, (req: any, res) => {
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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
    if (!hasCompetencyAccess(req.user)) return res.status(403).json({ error: "VeritaCompetency subscription required" });
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

    // Get user info for lab name
    const labUser = storage.getUserById(req.user.userId);
    const labName = labUser?.name || "Clinical Laboratory";

    try {
      const pdfBuffer = await generateCompetencyPDF({
        assessment,
        items,
        methodGroups,
        checklistItems,
        labName,
      });

      const safeName = assessment.employee_name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const date = new Date().toISOString().split("T")[0];
      const typeLabel = assessment.program_type === "technical" ? "Technical" : assessment.program_type === "waived" ? "Waived" : "NonTechnical";
      const filename = `VeritaCompetency_${typeLabel}_${safeName}_${date}.pdf`;

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

    const completionNote = `Auto-completed by VeritaCompetency\u2122: ${competencyType} assessment on ${now.split("T")[0]}`;
    const upsertStmt = (db as any).$client.prepare(`
      INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at)
      VALUES (?, ?, 'Compliant', ?, 'veritacompetency_auto', '/veritacompetency-app', ?, ?)
      ON CONFLICT(scan_id, item_id) DO UPDATE SET
        status = 'Compliant',
        completion_source = 'veritacompetency_auto',
        completion_link = '/veritacompetency-app',
        completion_note = excluded.completion_note,
        updated_at = excluded.updated_at
      WHERE status != 'Compliant' OR completion_source != 'veritacompetency_auto'
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
    try {
      const pdfBuffer = await generateCumsumPDF(tracker, entries, currentSpecimens);
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

  return httpServer;
}
