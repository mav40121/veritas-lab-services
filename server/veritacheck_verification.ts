import type { Express } from "express";
import { db } from "./db";

const sqlite = db.$client;

// ── Plan gate ─────────────────────────────────────────────────────────────────
const ALLOWED_PLANS = [
  "annual", "professional", "lab", "complete", "waived",
  "community", "hospital", "large_hospital", "enterprise",
];

function hasVeritaCheckAccess(user: any): boolean {
  return ALLOWED_PLANS.includes(user?.plan);
}

// ── CLSI guidance text per element ────────────────────────────────────────────
export const CLSI_GUIDANCE: Record<string, { protocol: string; min_samples: string; rationale: string }> = {
  accuracy: {
    protocol: "CLSI EP15-A3",
    min_samples: "20 patient samples across the reportable range",
    rationale:
      "CLSI EP15-A3 recommends a minimum of 20 samples spanning the full reportable range for accuracy/bias assessment. Samples should include low, mid, and high concentrations.",
  },
  precision: {
    protocol: "CLSI EP15-A3",
    min_samples: "20 replicates within-run; 5 days x 4 replicates for between-run",
    rationale:
      "CLSI EP15-A3 recommends 20 within-run replicates to estimate repeatability, and at least 5 days of 4 replicates each to estimate intermediate precision.",
  },
  reportable_range: {
    protocol: "CLSI EP06",
    min_samples: "5-7 calibrator or linearity material levels spanning low to high",
    rationale:
      "CLSI EP06 recommends a minimum of 5 data points (low, high, and at least 3 evenly spaced mid-range concentrations) to verify the manufacturer's stated analytical measurement range.",
  },
  reference_interval: {
    protocol: "CLSI EP28-A3c",
    min_samples: "20 reference subjects if adopting manufacturer interval; 120 if establishing de novo",
    rationale:
      "CLSI EP28-A3c allows adoption of a manufacturer's reference interval with verification using a minimum of 20 reference subjects. De novo establishment requires at least 120 subjects.",
  },
};

// ── Auth middleware reference (imported from routes context) ──────────────────
export function registerVeritaCheckVerificationRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any
) {

  // GET all verifications for the user
  app.get("/api/veritacheck/verifications", authMiddleware, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const verifications = sqlite.prepare(`
      SELECT v.*,
        (SELECT COUNT(*) FROM veritacheck_verification_instruments WHERE verification_id = v.id) as unit_count,
        (SELECT COUNT(*) FROM veritacheck_verification_studies WHERE verification_id = v.id AND passed = 1) as passed_count,
        (SELECT COUNT(*) FROM veritacheck_verification_studies WHERE verification_id = v.id AND passed = 0) as failed_count
      FROM veritacheck_verifications v
      WHERE v.user_id = ?
      ORDER BY v.created_at DESC
    `).all(userId);
    res.json(verifications);
  });

  // GET single verification with full detail
  app.get("/api/veritacheck/verifications/:id", authMiddleware, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!v) return res.status(404).json({ error: "Not found" });
    const instruments = sqlite.prepare("SELECT * FROM veritacheck_verification_instruments WHERE verification_id = ? ORDER BY id").all(req.params.id);
    const studies = sqlite.prepare(`
      SELECT vs.*, s.testName, s.studyType
      FROM veritacheck_verification_studies vs
      LEFT JOIN studies s ON s.id = vs.study_id
      WHERE vs.verification_id = ?
      ORDER BY vs.element
    `).all(req.params.id);
    res.json({ ...v as object, instruments, studies });
  });

  // POST create new verification
  app.post("/api/veritacheck/verifications", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const {
      instrument_name, manufacturer, trigger_type,
      map_instrument_id, elements, element_reasons,
    } = req.body;
    if (!instrument_name || !trigger_type) {
      return res.status(400).json({ error: "instrument_name and trigger_type are required" });
    }
    const now = new Date().toISOString();
    const elemArr = elements || ["accuracy", "precision", "reportable_range", "reference_interval"];
    const result = sqlite.prepare(`
      INSERT INTO veritacheck_verifications
        (user_id, instrument_name, manufacturer, trigger_type, map_instrument_id,
         elements, element_reasons, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      userId, instrument_name, manufacturer || null, trigger_type,
      map_instrument_id || null,
      JSON.stringify(elemArr),
      JSON.stringify(element_reasons || {}),
      now, now
    );
    const id = (result as any).lastInsertRowid;
    // Auto-create study slots for each selected element
    for (const element of elemArr) {
      const guidance = CLSI_GUIDANCE[element];
      sqlite.prepare(`
        INSERT INTO veritacheck_verification_studies
          (verification_id, element, clsi_protocol, created_at, updated_at)
        VALUES (?,?,?,?,?)
      `).run(id, element, guidance?.protocol || null, now, now);
    }
    res.json({ id, ok: true });
  });

  // PATCH update verification header (director info, status, remediation, etc.)
  app.patch("/api/veritacheck/verifications/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const existing = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: "Not found" });
    const allowed = ["instrument_name","manufacturer","trigger_type","status","director_name","director_title","approved_date","remediation_notes","elements","element_reasons"];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(typeof req.body[key] === "object" ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });
    sets.push("updated_at = ?");
    vals.push(new Date().toISOString());
    vals.push(req.params.id);
    sqlite.prepare(`UPDATE veritacheck_verifications SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  // DELETE verification
  app.delete("/api/veritacheck/verifications/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const existing = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("DELETE FROM veritacheck_verification_studies WHERE verification_id = ?").run(req.params.id);
    sqlite.prepare("DELETE FROM veritacheck_verification_instruments WHERE verification_id = ?").run(req.params.id);
    sqlite.prepare("DELETE FROM veritacheck_verifications WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
  });

  // ── Instruments (serial numbers) ──────────────────────────────────────────

  // POST add serial number unit
  app.post("/api/veritacheck/verifications/:id/instruments", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const parent = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!parent) return res.status(404).json({ error: "Not found" });
    const { serial_number, model, location, director_name, director_title, approved_date } = req.body;
    if (!serial_number) return res.status(400).json({ error: "serial_number required" });
    const r = sqlite.prepare(`
      INSERT INTO veritacheck_verification_instruments
        (verification_id, serial_number, model, location, director_name, director_title, approved_date, created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(req.params.id, serial_number, model || null, location || null, director_name || null, director_title || null, approved_date || null, new Date().toISOString());
    res.json({ id: (r as any).lastInsertRowid, ok: true });
  });

  // PATCH update instrument unit
  app.patch("/api/veritacheck/verifications/:id/instruments/:unitId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const parent = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!parent) return res.status(404).json({ error: "Not found" });
    const allowed = ["serial_number","model","location","director_name","director_title","approved_date"];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) { sets.push(`${key} = ?`); vals.push(req.body[key]); }
    }
    if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });
    vals.push(req.params.unitId);
    sqlite.prepare(`UPDATE veritacheck_verification_instruments SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  // DELETE instrument unit
  app.delete("/api/veritacheck/verifications/:id/instruments/:unitId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const parent = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!parent) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("DELETE FROM veritacheck_verification_instruments WHERE id = ?").run(req.params.unitId);
    res.json({ ok: true });
  });

  // ── Element studies ───────────────────────────────────────────────────────

  // PATCH update an element study slot (link study, set rationale, mark pass/fail)
  app.patch("/api/veritacheck/verifications/:id/studies/:studySlotId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const parent = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!parent) return res.status(404).json({ error: "Not found" });
    const allowed = ["study_id","analyte","sample_count","clsi_protocol","design_rationale","result_summary","passed"];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key} = ?`);
        vals.push(typeof req.body[key] === "object" ? JSON.stringify(req.body[key]) : req.body[key]);
      }
    }
    if (sets.length === 0) return res.status(400).json({ error: "No valid fields" });
    sets.push("updated_at = ?");
    vals.push(new Date().toISOString());
    vals.push(req.params.studySlotId);
    sqlite.prepare(`UPDATE veritacheck_verification_studies SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    res.json({ ok: true });
  });

  // GET suggested existing studies for a verification (match by instrument name)
  app.get("/api/veritacheck/verifications/:id/suggest-studies", authMiddleware, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
    if (!v) return res.status(404).json({ error: "Not found" });
    // Find studies where testName or instrument contains the instrument name (case-insensitive)
    const keyword = `%${v.instrument_name}%`;
    const matches = sqlite.prepare(`
      SELECT id, testName, studyType, createdAt
      FROM studies
      WHERE userId = ? AND (testName LIKE ? OR instrument LIKE ?)
      ORDER BY createdAt DESC
      LIMIT 20
    `).all(userId, keyword, keyword);
    res.json(matches);
  });

  // GET CLSI guidance for all elements
  app.get("/api/veritacheck/verifications/clsi-guidance", authMiddleware, (req: any, res) => {
    res.json(CLSI_GUIDANCE);
  });
}
