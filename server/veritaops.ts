// VeritaOps cost-per-reportable-test (CPRT) studies.
// PARKING_LOT #10. Conceptual basis: CLSI GP11-A "Basic Cost Accounting
// for Clinical Services". v1 ships L1 (reagents + supplies) and L2
// (+ direct labor) as defaults-on; L3 (capital) and L4 (overhead) are
// schema-present and computed but their UI surfaces ship in a later PR.
import type { Express } from "express";
import { db } from "./db";
import { storePdfToken } from "./pdfTokens";
import { generateCprtPdf } from "./veritaopsPdf";

// Plain-language tier labels. Used by the client to show what is in the
// final CPRT number for a given study.
export const CPRT_LAYER_LABELS = {
  l1: "Reagents and supplies",
  l2: "+ Staff time",
  l3: "+ Equipment depreciation",
  l4: "+ Overhead",
} as const;

interface CprtInputs {
  annual_volume?: number | null;
  reagent_cost_per_test?: number | null;
  calibrator_kit_cost?: number | null;
  cals_per_year?: number | null;
  qc_cost_per_run?: number | null;
  qc_runs_per_year?: number | null;
  other_supplies_per_test?: number | null;
  tech_minutes_per_test?: number | null;
  tech_loaded_hourly_rate?: number | null;
  include_capital?: number | null;
  instrument_purchase_cost?: number | null;
  instrument_useful_life_years?: number | null;
  annual_maintenance_cost?: number | null;
  include_overhead?: number | null;
  overhead_method?: string | null;
  overhead_value?: number | null;
}

interface CprtOutputs {
  cprt_l1: number;
  cprt_l2: number;
  cprt_l3: number;
  cprt_l4: number;
}

// Compute the four CPRT layers from the inputs. Layer outputs always
// contain a number; when an opt-in toggle is off, that layer mirrors the
// layer below it (so L3 == L2 when include_capital == 0, etc.). UI uses
// the toggle state to know whether to show L3/L4 separately from L2.
export function computeCprt(input: CprtInputs): CprtOutputs {
  const v = Number(input.annual_volume || 0);
  const safeAmortize = (numerator: number) => v > 0 ? numerator / v : 0;

  const l1 =
    Number(input.reagent_cost_per_test || 0) +
    safeAmortize(Number(input.calibrator_kit_cost || 0) * Number(input.cals_per_year || 0)) +
    safeAmortize(Number(input.qc_cost_per_run || 0) * Number(input.qc_runs_per_year || 0)) +
    Number(input.other_supplies_per_test || 0);

  const laborPerTest =
    (Number(input.tech_minutes_per_test || 0) / 60) *
    Number(input.tech_loaded_hourly_rate || 0);
  const l2 = l1 + laborPerTest;

  let l3 = l2;
  if (Number(input.include_capital || 0) === 1) {
    const lifeYears = Math.max(1, Number(input.instrument_useful_life_years || 1));
    const annualDepreciation = Number(input.instrument_purchase_cost || 0) / lifeYears;
    const capitalPerTest = safeAmortize(annualDepreciation + Number(input.annual_maintenance_cost || 0));
    l3 = l2 + capitalPerTest;
  }

  let l4 = l3;
  if (Number(input.include_overhead || 0) === 1) {
    const base = Number(input.include_capital || 0) === 1 ? l3 : l2;
    if ((input.overhead_method || "flat") === "markup") {
      l4 = base + base * Number(input.overhead_value || 0);
    } else {
      l4 = base + Number(input.overhead_value || 0);
    }
  }

  return { cprt_l1: l1, cprt_l2: l2, cprt_l3: l3, cprt_l4: l4 };
}

// Pluck the subset of req.body that corresponds to study columns. Strict
// allowlist so a typo or unknown key cannot smuggle in.
const INPUT_KEYS = [
  "test_name", "loinc", "department", "annual_volume",
  "reagent_cost_per_test", "calibrator_kit_cost", "cals_per_year",
  "qc_cost_per_run", "qc_runs_per_year", "other_supplies_per_test",
  "tech_minutes_per_test", "tech_loaded_hourly_rate",
  "include_capital", "instrument_purchase_cost",
  "instrument_useful_life_years", "annual_maintenance_cost",
  "include_overhead", "overhead_method", "overhead_value",
  "notes",
] as const;

function pickInputs(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of INPUT_KEYS) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) {
      out[k] = body[k];
    }
  }
  return out;
}

function hasOpsAccess(user: any, lab?: any): boolean {
  const plan = lab?.plan ?? user?.plan;
  return [
    "annual", "professional", "lab", "complete",
    "waived", "clinic", "community", "hospital", "large_hospital", "enterprise",
  ].includes(plan);
}

export function registerVeritaOpsRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: any,
) {
  const sqlite = (db as any).$client;

  // ── ACCOUNT-SCOPED ROUTES (legacy / single-lab users) ──────────────

  // LIST account-scoped
  app.get("/api/veritaops/studies", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const ownerId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM veritaops_test_cost_studies WHERE account_id = ? ORDER BY updated_at DESC"
    ).all(ownerId);
    res.json(rows);
  });

  // GET by id, account-scoped
  app.get("/api/veritaops/studies/:id", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const ownerId = req.ownerUserId ?? req.userId;
    const row = sqlite.prepare(
      "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND account_id = ?"
    ).get(Number(req.params.id), ownerId);
    if (!row) return res.status(404).json({ error: "Study not found" });
    res.json(row);
  });

  // CREATE account-scoped
  app.post("/api/veritaops/studies", authMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const inputs = pickInputs(req.body);
    if (!inputs.test_name) return res.status(400).json({ error: "test_name is required" });
    const outputs = computeCprt(inputs as CprtInputs);
    const ownerId = req.ownerUserId ?? req.userId;
    const now = new Date().toISOString();
    const result = sqlite.prepare(`
      INSERT INTO veritaops_test_cost_studies (
        account_id, test_name, loinc, department, annual_volume,
        reagent_cost_per_test, calibrator_kit_cost, cals_per_year,
        qc_cost_per_run, qc_runs_per_year, other_supplies_per_test,
        tech_minutes_per_test, tech_loaded_hourly_rate,
        include_capital, instrument_purchase_cost,
        instrument_useful_life_years, annual_maintenance_cost,
        include_overhead, overhead_method, overhead_value,
        cprt_l1, cprt_l2, cprt_l3, cprt_l4,
        notes, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
    `).run(
      ownerId, inputs.test_name, inputs.loinc ?? null, inputs.department ?? 'Core Lab', inputs.annual_volume ?? 0,
      inputs.reagent_cost_per_test ?? 0, inputs.calibrator_kit_cost ?? 0, inputs.cals_per_year ?? 0,
      inputs.qc_cost_per_run ?? 0, inputs.qc_runs_per_year ?? 0, inputs.other_supplies_per_test ?? 0,
      inputs.tech_minutes_per_test ?? 0, inputs.tech_loaded_hourly_rate ?? 0,
      inputs.include_capital ?? 0, inputs.instrument_purchase_cost ?? 0,
      inputs.instrument_useful_life_years ?? 7, inputs.annual_maintenance_cost ?? 0,
      inputs.include_overhead ?? 0, inputs.overhead_method ?? 'flat', inputs.overhead_value ?? 0,
      outputs.cprt_l1, outputs.cprt_l2, outputs.cprt_l3, outputs.cprt_l4,
      inputs.notes ?? null, now, now,
    );
    const row = sqlite.prepare("SELECT * FROM veritaops_test_cost_studies WHERE id = ?").get(Number(result.lastInsertRowid));
    res.json(row);
  });

  // UPDATE account-scoped
  app.put("/api/veritaops/studies/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const ownerId = req.ownerUserId ?? req.userId;
    const existing = sqlite.prepare(
      "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND account_id = ?"
    ).get(Number(req.params.id), ownerId) as any;
    if (!existing) return res.status(404).json({ error: "Study not found" });
    const merged = { ...existing, ...pickInputs(req.body) };
    const outputs = computeCprt(merged);
    const now = new Date().toISOString();
    sqlite.prepare(`
      UPDATE veritaops_test_cost_studies SET
        test_name = ?, loinc = ?, department = ?, annual_volume = ?,
        reagent_cost_per_test = ?, calibrator_kit_cost = ?, cals_per_year = ?,
        qc_cost_per_run = ?, qc_runs_per_year = ?, other_supplies_per_test = ?,
        tech_minutes_per_test = ?, tech_loaded_hourly_rate = ?,
        include_capital = ?, instrument_purchase_cost = ?,
        instrument_useful_life_years = ?, annual_maintenance_cost = ?,
        include_overhead = ?, overhead_method = ?, overhead_value = ?,
        cprt_l1 = ?, cprt_l2 = ?, cprt_l3 = ?, cprt_l4 = ?,
        notes = ?, updated_at = ?
      WHERE id = ? AND account_id = ?
    `).run(
      merged.test_name, merged.loinc, merged.department, merged.annual_volume,
      merged.reagent_cost_per_test, merged.calibrator_kit_cost, merged.cals_per_year,
      merged.qc_cost_per_run, merged.qc_runs_per_year, merged.other_supplies_per_test,
      merged.tech_minutes_per_test, merged.tech_loaded_hourly_rate,
      merged.include_capital, merged.instrument_purchase_cost,
      merged.instrument_useful_life_years, merged.annual_maintenance_cost,
      merged.include_overhead, merged.overhead_method, merged.overhead_value,
      outputs.cprt_l1, outputs.cprt_l2, outputs.cprt_l3, outputs.cprt_l4,
      merged.notes, now,
      Number(req.params.id), ownerId,
    );
    const row = sqlite.prepare("SELECT * FROM veritaops_test_cost_studies WHERE id = ?").get(Number(req.params.id));
    res.json(row);
  });

  // DELETE account-scoped
  app.delete("/api/veritaops/studies/:id", authMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const ownerId = req.ownerUserId ?? req.userId;
    const result = sqlite.prepare(
      "DELETE FROM veritaops_test_cost_studies WHERE id = ? AND account_id = ?"
    ).run(Number(req.params.id), ownerId);
    if (result.changes === 0) return res.status(404).json({ error: "Study not found" });
    res.json({ ok: true });
  });

  // PDF account-scoped. Returns a one-time token the browser GETs at
  // /api/pdf/:token so Adobe Acrobat's extension doesn't hijack a blob URL.
  app.post("/api/veritaops/studies/:id/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) {
      return res.status(403).json({ error: "VeritaOps subscription required" });
    }
    const ownerId = req.ownerUserId ?? req.userId;
    const study = sqlite.prepare(
      "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND account_id = ?"
    ).get(Number(req.params.id), ownerId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    const ownerRow = sqlite.prepare(
      "SELECT clia_lab_name, clia_number, name, email FROM users WHERE id = ?"
    ).get(ownerId) as any;
    try {
      const pdfBuffer = await generateCprtPdf(study, {
        labName: ownerRow?.clia_lab_name || ownerRow?.name || "Laboratory",
        cliaNumber: ownerRow?.clia_number || "Not on file",
        preparedBy: ownerRow?.name || ownerRow?.email || null,
      });
      const safeName = String(study.test_name || "Study").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaOps_CPRT_${safeName}_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, filename });
    } catch (err: any) {
      console.error("VeritaOps PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // ── LAB-SCOPED ROUTES (Multi-Lab Tier 2) ────────────────────────────
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (labScopeMiddleware) {
    app.get("/api/labs/:labId/veritaops/studies", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const rows = sqlite.prepare(
        "SELECT * FROM veritaops_test_cost_studies WHERE lab_id = ? ORDER BY updated_at DESC"
      ).all(req.scope.labId);
      res.json(rows);
    });

    app.get("/api/labs/:labId/veritaops/studies/:id", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const row = sqlite.prepare(
        "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND lab_id = ?"
      ).get(Number(req.params.id), req.scope.labId);
      if (!row) return res.status(404).json({ error: "Study not found" });
      res.json(row);
    });

    app.post("/api/labs/:labId/veritaops/studies", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const inputs = pickInputs(req.body);
      if (!inputs.test_name) return res.status(400).json({ error: "test_name is required" });
      const outputs = computeCprt(inputs as CprtInputs);
      const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
      const accountId = ownerRow?.owner_user_id ?? req.userId;
      const now = new Date().toISOString();
      const result = sqlite.prepare(`
        INSERT INTO veritaops_test_cost_studies (
          account_id, lab_id, test_name, loinc, department, annual_volume,
          reagent_cost_per_test, calibrator_kit_cost, cals_per_year,
          qc_cost_per_run, qc_runs_per_year, other_supplies_per_test,
          tech_minutes_per_test, tech_loaded_hourly_rate,
          include_capital, instrument_purchase_cost,
          instrument_useful_life_years, annual_maintenance_cost,
          include_overhead, overhead_method, overhead_value,
          cprt_l1, cprt_l2, cprt_l3, cprt_l4,
          notes, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?
        )
      `).run(
        accountId, req.scope.labId, inputs.test_name, inputs.loinc ?? null, inputs.department ?? 'Core Lab', inputs.annual_volume ?? 0,
        inputs.reagent_cost_per_test ?? 0, inputs.calibrator_kit_cost ?? 0, inputs.cals_per_year ?? 0,
        inputs.qc_cost_per_run ?? 0, inputs.qc_runs_per_year ?? 0, inputs.other_supplies_per_test ?? 0,
        inputs.tech_minutes_per_test ?? 0, inputs.tech_loaded_hourly_rate ?? 0,
        inputs.include_capital ?? 0, inputs.instrument_purchase_cost ?? 0,
        inputs.instrument_useful_life_years ?? 7, inputs.annual_maintenance_cost ?? 0,
        inputs.include_overhead ?? 0, inputs.overhead_method ?? 'flat', inputs.overhead_value ?? 0,
        outputs.cprt_l1, outputs.cprt_l2, outputs.cprt_l3, outputs.cprt_l4,
        inputs.notes ?? null, now, now,
      );
      const row = sqlite.prepare("SELECT * FROM veritaops_test_cost_studies WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    });

    app.put("/api/labs/:labId/veritaops/studies/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const existing = sqlite.prepare(
        "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND lab_id = ?"
      ).get(Number(req.params.id), req.scope.labId) as any;
      if (!existing) return res.status(404).json({ error: "Study not found" });
      const merged = { ...existing, ...pickInputs(req.body) };
      const outputs = computeCprt(merged);
      const now = new Date().toISOString();
      sqlite.prepare(`
        UPDATE veritaops_test_cost_studies SET
          test_name = ?, loinc = ?, department = ?, annual_volume = ?,
          reagent_cost_per_test = ?, calibrator_kit_cost = ?, cals_per_year = ?,
          qc_cost_per_run = ?, qc_runs_per_year = ?, other_supplies_per_test = ?,
          tech_minutes_per_test = ?, tech_loaded_hourly_rate = ?,
          include_capital = ?, instrument_purchase_cost = ?,
          instrument_useful_life_years = ?, annual_maintenance_cost = ?,
          include_overhead = ?, overhead_method = ?, overhead_value = ?,
          cprt_l1 = ?, cprt_l2 = ?, cprt_l3 = ?, cprt_l4 = ?,
          notes = ?, updated_at = ?
        WHERE id = ? AND lab_id = ?
      `).run(
        merged.test_name, merged.loinc, merged.department, merged.annual_volume,
        merged.reagent_cost_per_test, merged.calibrator_kit_cost, merged.cals_per_year,
        merged.qc_cost_per_run, merged.qc_runs_per_year, merged.other_supplies_per_test,
        merged.tech_minutes_per_test, merged.tech_loaded_hourly_rate,
        merged.include_capital, merged.instrument_purchase_cost,
        merged.instrument_useful_life_years, merged.annual_maintenance_cost,
        merged.include_overhead, merged.overhead_method, merged.overhead_value,
        outputs.cprt_l1, outputs.cprt_l2, outputs.cprt_l3, outputs.cprt_l4,
        merged.notes, now,
        Number(req.params.id), req.scope.labId,
      );
      const row = sqlite.prepare("SELECT * FROM veritaops_test_cost_studies WHERE id = ?").get(Number(req.params.id));
      res.json(row);
    });

    app.delete("/api/labs/:labId/veritaops/studies/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit('veritaops'), (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const result = sqlite.prepare(
        "DELETE FROM veritaops_test_cost_studies WHERE id = ? AND lab_id = ?"
      ).run(Number(req.params.id), req.scope.labId);
      if (result.changes === 0) return res.status(404).json({ error: "Study not found" });
      res.json({ ok: true });
    });

    // PDF lab-scoped. Pulls lab identity from the labs row directly so
    // multi-lab users get the correct CLIA / lab name in the PDF header.
    app.post("/api/labs/:labId/veritaops/studies/:id/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) {
        return res.status(403).json({ error: "VeritaOps subscription required" });
      }
      const study = sqlite.prepare(
        "SELECT * FROM veritaops_test_cost_studies WHERE id = ? AND lab_id = ?"
      ).get(Number(req.params.id), req.scope.labId) as any;
      if (!study) return res.status(404).json({ error: "Study not found" });
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE id = ?"
      ).get(req.scope.labId) as any;
      const userRow = sqlite.prepare(
        "SELECT name, email FROM users WHERE id = ?"
      ).get(req.userId) as any;
      try {
        const pdfBuffer = await generateCprtPdf(study, {
          labName: labRow?.lab_name || "Laboratory",
          cliaNumber: labRow?.clia_number || "Not on file",
          preparedBy: userRow?.name || userRow?.email || null,
        });
        const safeLab = String(labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 24);
        const safeName = String(study.test_name || "Study").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const datestamp = new Date().toISOString().slice(0, 10);
        const filename = `VeritaOps_CPRT_${safeLab}_${safeName}_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, filename });
      } catch (err: any) {
        console.error("VeritaOps PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });
  }
}
