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
    min_samples: "20 reference subjects if adopting manufacturer range; 120 if establishing de novo",
    rationale:
      "CLSI EP28-A3c allows adoption of a manufacturer's reference range with verification using a minimum of 20 reference subjects. De novo establishment requires at least 120 subjects.",
  },
  method_comparison: {
    protocol: "CLSI EP09-A3",
    min_samples: "20 paired patient specimens spanning the reportable range",
    rationale:
      "CLSI EP09-A3 recommends a minimum of 20 paired patient specimens compared between the new method and an established or reference method. Specimens should span the clinically relevant range to evaluate slope, intercept, and correlation.",
  },
  carryover: {
    protocol: "CLSI EP10-A3",
    min_samples: "21 alternating Low/High specimens in a defined sequence (e.g. L,L,H,H,L,L,H,L,H,H,L,L,L,L,H,H,L,L,H,L,L)",
    rationale:
      "CLSI EP10-A3 evaluates carryover by running Low and High specimens in a defined alternating pattern and comparing the SD of Low-after-High readings to an Error Limit derived from 3x the Low-after-Low SD. Carryover passes when Low-High SD does not exceed the Error Limit. Most modern closed-tube analyzers achieve this without intervention; many labs document Carryover as Not Performed with manufacturer carryover claim citation when the analyzer is new and unmodified.",
  },
};

// ── Per-study statistical appendix renderer ──────────────────────────────────
// Renders the actual numbers from a linked study's stored data_points blob as
// an inline appendix block under the per-element summary. Keeps the bundled
// verification deliverable as one PDF rather than relying on separately
// downloaded per-study reports.
// Defensive: any malformed or unknown data falls back to a brief note so the
// cover page always renders.
function renderStudyAppendix(slot: any, teal: string): string {
  if (!slot?.study_id || !slot?.studyType) return "";
  let dp: any;
  try {
    dp = slot.studyDataPoints ? JSON.parse(slot.studyDataPoints) : null;
  } catch { return ""; }
  if (!dp) return "";

  let instNames: string[] = [];
  try {
    instNames = slot.studyInstrumentsJson ? JSON.parse(slot.studyInstrumentsJson) : [];
  } catch {}

  const meta = `
    <div style="font-size:11px;color:#374151;margin-bottom:8px">
      Instrument: <strong>${slot.studyInstrument || "Not recorded"}</strong>
      &nbsp;&nbsp;Analyst: <strong>${slot.studyAnalyst || "Not recorded"}</strong>
      &nbsp;&nbsp;Date: <strong>${slot.studyDate || ""}</strong>
    </div>`;

  const wrap = (title: string, inner: string) => `
    <div style="margin-top:10px;padding:12px;border:1px solid #e5e7eb;border-radius:4px;background:#fafafa">
      <div style="font-size:12px;font-weight:600;color:${teal};margin-bottom:6px">${title}</div>
      ${meta}
      ${inner}
    </div>`;

  try {
    if (slot.studyType === "precision") {
      // dp = [{ level, levelName, values?, days? }]
      if (!Array.isArray(dp)) return "";
      const rows = dp.map((p: any) => {
        const vals: number[] = (p.days ? p.days.flat() : p.values || [])
          .filter((v: any) => v !== null && v !== undefined && !isNaN(v));
        const n = vals.length;
        if (n < 2) return `<tr><td>${p.levelName || p.level}</td><td>${n}</td><td colspan="3" style="color:#6b7280">Insufficient data</td></tr>`;
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
        const sd = Math.sqrt(variance);
        const cv = mean !== 0 ? (sd / mean) * 100 : 0;
        return `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${p.levelName || p.level}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center">${n}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${mean.toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${sd.toFixed(3)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${cv.toFixed(2)}%</td>
        </tr>`;
      }).join("");
      const inner = `
        <table style="font-size:11px;width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Level</th>
            <th style="padding:4px 8px;text-align:center">N</th>
            <th style="padding:4px 8px;text-align:right">Mean</th>
            <th style="padding:4px 8px;text-align:right">SD</th>
            <th style="padding:4px 8px;text-align:right">CV%</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      return wrap(`Statistical Detail (CLSI EP15-A3 Precision)`, inner);
    }

    if (slot.studyType === "cal_ver") {
      // dp = [{ level, assignedValue?, expectedValue?, instrumentValues: {name: value} }]
      if (!Array.isArray(dp)) return "";
      const teaPct = (slot.studyTea ?? 0) * 100;
      const rows = dp.map((p: any) => {
        const assigned = p.assignedValue ?? p.expectedValue ?? 0;
        const vals = instNames.length > 0
          ? instNames.map(n => p.instrumentValues?.[n]).filter((v: any) => v !== null && v !== undefined && !isNaN(v))
          : Object.values(p.instrumentValues || {}).filter((v: any) => v !== null && v !== undefined && !isNaN(v));
        if (vals.length === 0) return `<tr><td>${p.level}</td><td>${assigned}</td><td colspan="3" style="color:#6b7280">No values</td></tr>`;
        const mean = (vals as number[]).reduce((a, b) => a + b, 0) / vals.length;
        const pctRecovery = assigned !== 0 ? (mean / assigned) * 100 : 100;
        const pctDiff = Math.abs(pctRecovery - 100);
        const pass = teaPct > 0 ? pctDiff <= teaPct : true;
        return `<tr>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${p.level}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${assigned}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${mean.toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${pctRecovery.toFixed(1)}%</td>
          <td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:center;color:${pass ? "#059669" : "#dc2626"}">${pass ? "Pass" : "Fail"}</td>
        </tr>`;
      }).join("");
      const inner = `
        <table style="font-size:11px;width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Level</th>
            <th style="padding:4px 8px;text-align:right">Assigned</th>
            <th style="padding:4px 8px;text-align:right">Mean Measured</th>
            <th style="padding:4px 8px;text-align:right">% Recovery</th>
            <th style="padding:4px 8px;text-align:center">Verdict (TEa +/-${teaPct.toFixed(1)}%)</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      return wrap(`Statistical Detail (CLSI EP06 Calibration Verification / Linearity)`, inner);
    }

    if (slot.studyType === "method_comparison" || slot.studyType === "correlation") {
      // dp = [{ expectedValue, instrumentValues: {name: value} }]
      if (!Array.isArray(dp)) return "";
      const comparisonNames = instNames.slice(1).length > 0 ? instNames.slice(1) : instNames;
      const compName = comparisonNames[0] || "Comparison";
      const xs: number[] = [];
      const ys: number[] = [];
      for (const p of dp) {
        const x = p.expectedValue;
        const y = p.instrumentValues?.[compName];
        if (x !== null && x !== undefined && !isNaN(x) && y !== null && y !== undefined && !isNaN(y)) {
          xs.push(x); ys.push(y);
        }
      }
      const n = xs.length;
      if (n < 2) return wrap(`Statistical Detail (CLSI EP09-A3 Method Comparison)`, `<div style="font-size:11px;color:#6b7280">Insufficient paired data (n=${n}).</div>`);
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const xm = mean(xs), ym = mean(ys);
      const sxx = xs.reduce((s, x) => s + (x - xm) ** 2, 0);
      const sxy = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0);
      const syy = ys.reduce((s, y) => s + (y - ym) ** 2, 0);
      const slope = sxx === 0 ? 1 : sxy / sxx;
      const intercept = ym - slope * xm;
      const r2 = sxx === 0 || syy === 0 ? 1 : (sxy ** 2) / (sxx * syy);
      const r = Math.sqrt(Math.max(0, r2));
      const inner = `
        <table style="font-size:11px;width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:4px 8px;text-align:left">Metric</th>
            <th style="padding:4px 8px;text-align:right">Value</th>
          </tr></thead>
          <tbody>
            <tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">N (paired specimens)</td><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${n}</td></tr>
            <tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">Slope</td><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${slope.toFixed(4)}</td></tr>
            <tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">Intercept</td><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${intercept.toFixed(3)}</td></tr>
            <tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">Correlation r</td><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0;text-align:right">${r.toFixed(4)}</td></tr>
            <tr><td style="padding:4px 8px">r-squared</td><td style="padding:4px 8px;text-align:right">${r2.toFixed(4)}</td></tr>
          </tbody>
        </table>`;
      return wrap(`Statistical Detail (CLSI EP09-A3 Method Comparison)`, inner);
    }

    if (slot.studyType === "ref_interval") {
      // dp = { specimens: [{specimenId, value}], refLow, refHigh, analyte, units }
      const specimens = Array.isArray((dp as any).specimens) ? (dp as any).specimens : [];
      const refLow = (dp as any).refLow ?? 0;
      const refHigh = (dp as any).refHigh ?? 0;
      const units = (dp as any).units || "";
      const valid = specimens.filter((s: any) => s.value !== null && s.value !== undefined && !isNaN(s.value));
      const n = valid.length;
      const outsideCount = valid.filter((s: any) => s.value < refLow || s.value > refHigh).length;
      const outsidePct = n > 0 ? (outsideCount / n) * 100 : 0;
      const inner = `
        <div style="font-size:11px;margin-bottom:8px">
          Reference Range: <strong>${refLow} to ${refHigh} ${units}</strong> &nbsp;
          N=<strong>${n}</strong> &nbsp;
          Outside Range: <strong>${outsideCount}</strong> (${outsidePct.toFixed(1)}%) &nbsp;
          CLSI EP28-A3c criterion: &le;10% outside permitted &nbsp;
          Verdict: <strong style="color:${outsidePct <= 10 && n >= 20 ? "#059669" : "#dc2626"}">${outsidePct <= 10 && n >= 20 ? "Pass" : "Fail"}</strong>
        </div>
        <table style="font-size:10px;width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:3px 6px;text-align:left">Specimen ID</th>
            <th style="padding:3px 6px;text-align:right">Value</th>
            <th style="padding:3px 6px;text-align:center">In Range</th>
          </tr></thead>
          <tbody>${valid.slice(0, 30).map((s: any) => {
            const inRange = s.value >= refLow && s.value <= refHigh;
            return `<tr>
              <td style="padding:3px 6px;border-bottom:1px solid #f0f0f0">${s.specimenId ?? ""}</td>
              <td style="padding:3px 6px;border-bottom:1px solid #f0f0f0;text-align:right">${s.value}</td>
              <td style="padding:3px 6px;border-bottom:1px solid #f0f0f0;text-align:center;color:${inRange ? "#059669" : "#dc2626"}">${inRange ? "Yes" : "No"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
        ${valid.length > 30 ? `<div style="font-size:10px;color:#6b7280;margin-top:4px">(Showing first 30 of ${valid.length} specimens; full list in the underlying study report.)</div>` : ""}`;
      return wrap(`Statistical Detail (CLSI EP28-A3c Reference Interval Verification)`, inner);
    }
  } catch (err) {
    console.error("[verification-pdf] renderStudyAppendix error:", err);
    return "";
  }
  return "";
}

// ── Auth middleware reference (imported from routes context) ──────────────────
export function registerVeritaCheckVerificationRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any
) {

  // GET CLSI guidance for all elements (must be before /:id routes)
  app.get("/api/veritacheck/verifications/clsi-guidance", authMiddleware, (_req: any, res) => {
    res.json(CLSI_GUIDANCE);
  });

  // GET all verifications for the user (legacy, user-scoped — leaks across
  // labs for multi-lab owners; preserved for legacy unprefixed callers).
  app.get("/api/veritacheck/verifications", authMiddleware, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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

  // Lab-scoped variant (cross-lab leak fix 2026-05-20). Scopes by lab_id so
  // the verifications list at /labs/:labId/dashboard/verifications only
  // returns rows for that active lab. lab_id column was added in db.ts.
  const verifLabScopeMW = (app as any).locals.labScopeMiddleware;
  app.get("/api/labs/:labId/veritacheck/verifications", authMiddleware, verifLabScopeMW, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const verifications = sqlite.prepare(`
      SELECT v.*,
        (SELECT COUNT(*) FROM veritacheck_verification_instruments WHERE verification_id = v.id) as unit_count,
        (SELECT COUNT(*) FROM veritacheck_verification_studies WHERE verification_id = v.id AND passed = 1) as passed_count,
        (SELECT COUNT(*) FROM veritacheck_verification_studies WHERE verification_id = v.id AND passed = 0) as failed_count
      FROM veritacheck_verifications v
      WHERE v.lab_id = ?
      ORDER BY v.created_at DESC
    `).all(req.scope.labId);
    res.json(verifications);
  });

  // GET single verification with full detail
  app.get("/api/veritacheck/verifications/:id", authMiddleware, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!v) return res.status(404).json({ error: "Not found" });
    const instruments = sqlite.prepare("SELECT * FROM veritacheck_verification_instruments WHERE verification_id = ? ORDER BY id").all(req.params.id);
    const studies = sqlite.prepare(`
      SELECT vs.*, s.test_name AS testName, s.study_type AS studyType
      FROM veritacheck_verification_studies vs
      LEFT JOIN studies s ON s.id = vs.study_id
      WHERE vs.verification_id = ?
      ORDER BY vs.element
    `).all(req.params.id);
    res.json({ ...v as object, instruments, studies });
  });

  // Shared verification-create body builder. Used by both legacy and
  // lab-scoped POST routes so the slot-creation logic doesn't drift.
  function createVerificationRow(req: any, res: any, labIdOrNull: number | null) {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const { instrument_name, manufacturer, trigger_type, map_instrument_id, elements, element_reasons } = req.body;
    if (!instrument_name || !trigger_type) {
      return res.status(400).json({ error: "instrument_name and trigger_type are required" });
    }
    const now = new Date().toISOString();
    const elemArr = (Array.isArray(elements) && elements.length > 0)
      ? elements
      : ["accuracy", "precision", "reportable_range", "reference_interval", "method_comparison", "carryover"];
    const result = sqlite.prepare(`
      INSERT INTO veritacheck_verifications
        (user_id, lab_id, instrument_name, manufacturer, trigger_type, map_instrument_id,
         elements, element_reasons, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId, labIdOrNull, instrument_name, manufacturer || null, trigger_type,
      map_instrument_id || null,
      JSON.stringify(elemArr),
      JSON.stringify(element_reasons || {}),
      now, now
    );
    const id = (result as any).lastInsertRowid;
    for (const element of elemArr) {
      const guidance = CLSI_GUIDANCE[element];
      sqlite.prepare(`
        INSERT INTO veritacheck_verification_studies
          (verification_id, element, clsi_protocol, created_at, updated_at)
        VALUES (?,?,?,?,?)
      `).run(id, element, guidance?.protocol || null, now, now);
    }
    res.json({ id, ok: true });
  }

  // POST create new verification (legacy — falls back to users.lab_id for
  // backward compatibility with unprefixed callers).
  app.post("/api/veritacheck/verifications", authMiddleware, requireWriteAccess, (req: any, res) => {
    const userId = req.ownerUserId ?? req.user.userId;
    const fallbackRow = sqlite.prepare("SELECT lab_id FROM users WHERE id = ?").get(userId) as any;
    return createVerificationRow(req, res, fallbackRow?.lab_id ?? null);
  });

  // Lab-scoped POST — stamps lab_id from the URL-validated scope so new
  // verifications land in the right lab even when users.lab_id is stale.
  app.post("/api/labs/:labId/veritacheck/verifications", authMiddleware, verifLabScopeMW, requireWriteAccess, (req: any, res) => {
    return createVerificationRow(req, res, req.scope.labId);
  });

  // PATCH update verification header (director info, status, remediation, etc.)
  app.patch("/api/veritacheck/verifications/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const parent = sqlite.prepare("SELECT id FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId);
    if (!parent) return res.status(404).json({ error: "Not found" });
    sqlite.prepare("DELETE FROM veritacheck_verification_instruments WHERE id = ?").run(req.params.unitId);
    res.json({ ok: true });
  });

  // ── Element studies ───────────────────────────────────────────────────────

  // PATCH update an element study slot (link study, set rationale, mark pass/fail)
  app.patch("/api/veritacheck/verifications/:id/studies/:studySlotId", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
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
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;
    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
    if (!v) return res.status(404).json({ error: "Not found" });
    // Return all studies for this user so any can be linked
    const matches = sqlite.prepare(`
      SELECT id, test_name AS testName, study_type AS studyType, created_at AS createdAt
      FROM studies
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(userId);
    res.json(matches);
  });

  // POST generate PDF package
  app.post("/api/veritacheck/verifications/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasVeritaCheckAccess(req.user)) return res.status(403).json({ error: "VeritaCheck™ subscription required" });
    const userId = req.ownerUserId ?? req.user.userId;

    const v = sqlite.prepare("SELECT * FROM veritacheck_verifications WHERE id = ? AND user_id = ?").get(req.params.id, userId) as any;
    if (!v) return res.status(404).json({ error: "Not found" });

    const instruments = sqlite.prepare("SELECT * FROM veritacheck_verification_instruments WHERE verification_id = ? ORDER BY id").all(req.params.id) as any[];
    const studies = sqlite.prepare(`
      SELECT vs.*,
        s.test_name AS testName, s.study_type AS studyType,
        s.instrument AS studyInstrument, s.analyst AS studyAnalyst, s.date AS studyDate,
        s.data_points AS studyDataPoints, s.instruments AS studyInstrumentsJson,
        s.clia_allowable_error AS studyTea,
        s.tea_is_percentage AS studyTeaIsPct, s.tea_unit AS studyTeaUnit,
        s.clia_absolute_floor AS studyAbsFloor
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
      { key: "reference_interval", label: "Reference Range",    protocol: "CLSI EP28-A3c" },
      { key: "method_comparison",  label: "Method Comparison",  protocol: "CLSI EP09-A3" },
      { key: "carryover",          label: "Carryover",          protocol: "CLSI EP10-A3" },
    ];

    const triggerLabels: Record<string, string> = {
      new_instrument: "New instrument (first of this type in lab)",
      new_analyte:    "New analyte added to existing instrument",
      second_unit:    "Second unit of same make/model",
      replacement:    "Replacement instrument (same make/model)",
    };

    // Fetch CLIA number and lab name from user record
    const verifUserRow = sqlite.prepare("SELECT clia_number, clia_lab_name FROM users WHERE id = ?").get(userId) as any;
    const verifCliaNumber: string | undefined = verifUserRow?.clia_number || undefined;
    const verifLabName: string | undefined = verifUserRow?.clia_lab_name || undefined;

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
      const appendix = slot ? renderStudyAppendix(slot, teal) : "";
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
        ${appendix}
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

  <!-- Lab identity header -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
    <div>
      <div style="font-size:14px;font-weight:700;color:${teal};letter-spacing:0.3px">VeritaAssure&trade;</div>
      <div style="font-size:8px;color:#6b7280">by Veritas Lab Services - veritaslabservices.com</div>
      ${verifLabName ? `<div style="font-size:9px;font-weight:600;color:#28251D;margin-top:2px">${verifLabName}</div>` : ""}
      <div style="font-size:8px;color:${verifCliaNumber ? '#555' : '#999'};margin-top:1px">CLIA: ${verifCliaNumber || 'Not on file - enter your CLIA number in account settings'}</div>
    </div>
  </div>

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
