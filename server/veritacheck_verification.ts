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

  // POST generate PDF package
  app.post("/api/veritacheck/verifications/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;

    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
    if (!v) return res.status(404).json({ error: "Not found" });

    const instruments = sqlite.prepare("SELECT * FROM veritacheck_verification_instruments WHERE verification_id = ? ORDER BY id").all(req.params.id) as any[];
    const studies = sqlite.prepare(`
      SELECT vs.*, s.testName, s.studyType
      FROM veritacheck_verification_studies vs
      LEFT JOIN studies s ON s.id = vs.study_id
      WHERE vs.verification_id = ?
      ORDER BY vs.element
    `).all(req.params.id) as any[];

    const elements: string[] = JSON.parse(v.elements || "[]");
    const elementReasons: Record<string, string> = JSON.parse(v.element_reasons || "{}");

    const allElements = [
      { key: "accuracy",           label: "Accuracy / Bias",    protocol: "CLSI EP15-A3" },
      { key: "precision",          label: "Precision",          protocol: "CLSI EP15-A3" },
      { key: "reportable_range",   label: "Reportable Range",   protocol: "CLSI EP06" },
      { key: "reference_interval", label: "Reference Interval", protocol: "CLSI EP28-A3c" },
    ];

    const triggerLabels: Record<string, string> = {
      new_instrument: "New instrument (first of this type in lab)",
      new_analyte:    "New analyte added to existing instrument",
      second_unit:    "Second unit of same make/model",
      replacement:    "Replacement instrument (same make/model)",
    };

    const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const teal = "#01696F";

    // ── Element rows for the summary table ──────────────────────────────────
    const elementRows = allElements.map(el => {
      const slot = studies.find((s: any) => s.element === el.key);
      const included = elements.includes(el.key);
      if (!included) {
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${el.label}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-style:italic">Excluded - see justification below</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">N/A</td>
          <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${el.protocol}</td>
        </tr>`;
      }
      const passLabel = slot?.passed === 1 ? "<span style='color:#059669;font-weight:600'>PASS</span>" : slot?.passed === 0 ? "<span style='color:#dc2626;font-weight:600'>FAIL</span>" : "<span style='color:#d97706'>Pending</span>";
      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600">${el.label}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${slot?.analyte || ""} ${slot?.sample_count ? `(n=${slot.sample_count})` : ""}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center">${passLabel}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${el.protocol}</td>
      </tr>`;
    }).join("");

    // ── Instrument units sign-off blocks ────────────────────────────────────
    const unitBlocks = instruments.length > 0 ? instruments.map((u: any) => `
      <div style="margin-top:24px;padding:16px;border:1px solid #e5e7eb;border-radius:6px;background:#fafafa">
        <div style="font-weight:600;font-size:13px;margin-bottom:8px;color:${teal}">Unit: S/N ${u.serial_number}${u.model ? " - " + u.model : ""}${u.location ? " (" + u.location + ")" : ""}</div>
        <table style="width:100%;font-size:12px">
          <tr>
            <td style="width:40%;padding:6px 0"><strong>I approve this instrument/test for patient testing.</strong></td>
          </tr>
          <tr>
            <td style="padding:6px 0">
              Signature: <span style="display:inline-block;width:200px;border-bottom:1px solid #000;">&nbsp;</span>
            </td>
            <td style="padding:6px 0">
              Date: <span style="display:inline-block;width:120px;border-bottom:1px solid #000;">${u.approved_date || "&nbsp;"}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:6px 0">Printed Name: <strong>${u.director_name || "_________________________"}</strong></td>
            <td style="padding:6px 0">Title: ${u.director_title || "_________________________"}</td>
          </tr>
        </table>
      </div>`).join("") : "";

    // ── Element detail sections ─────────────────────────────────────────────
    const elementDetails = allElements.map(el => {
      const slot = studies.find((s: any) => s.element === el.key);
      const included = elements.includes(el.key);
      if (!included) {
        return `<div style="margin-bottom:20px;padding:16px;border-left:3px solid #d1d5db;background:#f9fafb">
          <div style="font-weight:600;font-size:13px;color:#374151">${el.label} - EXCLUDED</div>
          <div style="font-size:12px;color:#6b7280;margin-top:6px">Justification: ${elementReasons[el.key] || "Not documented"}</div>
        </div>`;
      }
      return `<div style="margin-bottom:28px">
        <div style="font-weight:700;font-size:14px;color:${teal};border-bottom:2px solid ${teal};padding-bottom:4px;margin-bottom:12px">${el.label} (${el.protocol})</div>
        ${slot?.analyte ? `<div style="font-size:12px;margin-bottom:6px"><strong>Analyte:</strong> ${slot.analyte}</div>` : ""}
        ${slot?.sample_count ? `<div style="font-size:12px;margin-bottom:6px"><strong>Samples Run:</strong> ${slot.sample_count}</div>` : ""}
        ${slot?.clsi_protocol ? `<div style="font-size:12px;margin-bottom:6px"><strong>CLSI Protocol:</strong> ${slot.clsi_protocol}</div>` : ""}
        ${slot?.design_rationale ? `<div style="font-size:12px;margin-bottom:6px"><strong>Study Design Rationale:</strong><br><span style="color:#374151">${slot.design_rationale}</span></div>` : ""}
        ${slot?.testName ? `<div style="font-size:12px;margin-bottom:6px"><strong>Linked Study:</strong> ${slot.testName}</div>` : ""}
        <div style="font-size:12px;margin-top:8px">
          <strong>Result:</strong>
          ${slot?.passed === 1 ? "<span style='color:#059669;font-weight:700'>PASS</span>" : slot?.passed === 0 ? "<span style='color:#dc2626;font-weight:700'>FAIL</span>" : "<span style='color:#d97706'>Pending evaluation</span>"}
        </div>
      </div>`;
    }).join("");

    // ── Remediation section ─────────────────────────────────────────────────
    const remediationSection = v.remediation_notes ? `
      <div style="margin-top:32px;padding:16px;border:1px solid #fca5a5;border-radius:6px;background:#fff5f5">
        <div style="font-weight:700;font-size:14px;color:#dc2626;margin-bottom:10px">Remediation Log</div>
        <div style="font-size:12px;white-space:pre-wrap;color:#374151">${v.remediation_notes}</div>
      </div>` : "";

    // ── Excluded element justifications ─────────────────────────────────────
    const excludedJustifications = allElements
      .filter(el => !elements.includes(el.key))
      .map(el => `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px">${el.label}</div>
        <div style="font-size:12px;color:#374151">${elementReasons[el.key] || "Not documented"}</div>
      </div>`).join("");

    // ── Full HTML ───────────────────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: white; }
    .page { padding: 48px 56px; max-width: 900px; margin: 0 auto; }
    table { border-collapse: collapse; width: 100%; }
    @page { margin: 0.5in; }
    @media print { .page { padding: 0; } }
  </style>
</head>
<body>
<div class="page">

  <!-- COVER PAGE -->
  <!-- Header bar -->
  <div style="background:${teal};color:white;padding:20px 24px;border-radius:6px;margin-bottom:24px">
    <div style="font-size:9px;letter-spacing:1px;text-transform:uppercase;opacity:0.8;margin-bottom:4px">Veritas Lab Services - VeritaCheck&trade; Verification Package</div>
    <div style="font-size:20px;font-weight:700">Instrument/Test Performance Verification</div>
    <div style="font-size:13px;opacity:0.9;margin-top:4px">${v.instrument_name}${v.manufacturer ? " - " + v.manufacturer : ""}</div>
  </div>

  <!-- Package info -->
  <table style="margin-bottom:24px;font-size:12px">
    <tr>
      <td style="width:50%;padding:4px 0;color:#6b7280">Verification Trigger</td>
      <td style="padding:4px 0;font-weight:500">${triggerLabels[v.trigger_type] || v.trigger_type}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280">Package Created</td>
      <td style="padding:4px 0">${new Date(v.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280">Package Status</td>
      <td style="padding:4px 0">${v.status === "complete" ? "<strong style='color:#059669'>Complete</strong>" : "In Progress"}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280">Units / Serial Numbers</td>
      <td style="padding:4px 0">${instruments.length > 0 ? instruments.map((u: any) => u.serial_number).join(", ") : "Not specified"}</td>
    </tr>
    <tr>
      <td style="padding:4px 0;color:#6b7280">Report Generated</td>
      <td style="padding:4px 0">${today}</td>
    </tr>
  </table>

  <!-- Results summary table -->
  <div style="font-weight:700;font-size:14px;color:${teal};margin-bottom:10px">Performance Summary</div>
  <table style="font-size:12px;margin-bottom:28px;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden">
    <thead>
      <tr style="background:${teal};color:white">
        <th style="padding:10px 12px;text-align:left">Element</th>
        <th style="padding:10px 12px;text-align:left">Analyte / Samples</th>
        <th style="padding:10px 12px;text-align:center">Result</th>
        <th style="padding:10px 12px;text-align:left">CLSI Standard</th>
      </tr>
    </thead>
    <tbody>${elementRows}</tbody>
  </table>

  <!-- Director approval signature block - PAGE 1 -->
  <div style="border:2px solid ${teal};border-radius:6px;padding:20px;margin-bottom:28px">
    <div style="font-weight:700;font-size:13px;color:${teal};margin-bottom:8px;letter-spacing:0.3px">LABORATORY DIRECTOR OR DESIGNEE REVIEW</div>
    <div style="font-size:12px;color:#374151;margin-bottom:12px;line-height:1.6">
      I have reviewed the verification study results for the instrument/test identified above and find that the performance specifications have been adequately verified.
    </div>
    <div style="font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:20px">
      I approve this instrument/test for patient testing.
    </div>
    <table style="font-size:12px;width:100%">
      <tr>
        <td style="width:50%;padding-bottom:16px">
          Signature: <span style="display:inline-block;width:200px;border-bottom:1px solid #000">&nbsp;</span>
        </td>
        <td style="padding-bottom:16px">
          Date: <span style="display:inline-block;width:120px;border-bottom:1px solid #000">${v.approved_date || "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;"}</span>
        </td>
      </tr>
      <tr>
        <td>Printed Name: <strong>${v.director_name || "_________________________"}</strong></td>
        <td>Title: ${v.director_title || "_________________________"}</td>
      </tr>
    </table>
  </div>

  <!-- Per-unit sign-off blocks (multi-instrument) -->
  ${unitBlocks}

  <!-- Page break before details -->
  <div style="page-break-before:always"></div>

  <!-- ELEMENT DETAIL SECTIONS -->
  <div style="font-weight:700;font-size:16px;color:${teal};border-bottom:2px solid ${teal};padding-bottom:6px;margin-bottom:24px">Performance Study Details</div>
  ${elementDetails}

  <!-- Excluded element justifications -->
  ${excludedJustifications ? `
  <div style="margin-top:28px;padding:16px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb">
    <div style="font-weight:700;font-size:14px;margin-bottom:12px">Element Exclusion Justifications</div>
    ${excludedJustifications}
  </div>` : ""}

  <!-- Remediation log -->
  ${remediationSection}

  <!-- Footer -->
  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:center">
    Generated by VeritaCheck&trade; - Veritas Lab Services, LLC | For internal laboratory use | Medical director or designee review required before patient testing
  </div>

</div>
</body>
</html>`;

    try {
      const puppeteer = await import("puppeteer");
      const browser = await puppeteer.default.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "Letter", printBackground: true, margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" } });
      await browser.close();
      const filename = `VeritaCheck_Verification_${v.instrument_name.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`;
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"` });
      res.send(Buffer.from(pdf));
    } catch (err: any) {
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });
}
