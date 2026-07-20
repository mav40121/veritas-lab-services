/**
 * VeritaBench routes - Productivity Tracker + Staffing Analyzer
 */
import type { Express } from "express";
import crypto from "crypto";
import { db } from "./db";
import { logAudit } from "./audit";
import { logConsumption } from "./consumptionLedger";
import { addLot, reconcileLots } from "./inventoryLots";
import { resolveLegacyLabId } from "./labAccessGuard";
import { DEMO_USER_EMAIL } from "./constants";
import { applyLicenseToExcelJS } from "./licenseStamp";
import type { LicenseContext } from "@shared/licenseText";
import { generateReorderListPDF, generateReorderListExcel, generateSnapOrderPDF, type ReorderItem, type SnapOrderItem, type VendorRecordForPdf } from "./orderDocument";
import { generateBarcodeLabelSheetPdf, type BarcodeLabelInput } from "./barcodeLabelPdf";
import { generateInventoryCountExcel, type InventoryCountItem } from "./inventoryCountExcel";
import { buildCountHistory } from "./countHistoryReport";
import { generateCountHistoryExcel } from "./countHistoryExcel";
import { storePdfToken } from "./pdfTokens";
import { buildIntacctCSV, preflightIntacct, type IntacctExportConfig, type VendorIdMap } from "./intacctExport";
import { forecastFromGoal, chainGap, staffingGridFte, DEFAULT_HOURS_PER_FTE_YEAR } from "@shared/operationsForecast";
import { generateLeverageReportPDF, type LeverageReportData } from "./leverageReport";

// PR 4 helper: builds a lower-cased-name keyed map of VendorRecordForPdf
// from the lab's stock_vendors directory. The PDF renderer uses this to
// auto-fill the per-vendor "Send to" panel on the Order PDF cover. Empty
// map (or null labId) is the conditional fallback path: PDF renders
// today's behavior without any panel, no regression for labs that
// haven't populated their vendor directory.
function buildVendorRecordMap(labId: number | null): Map<string, VendorRecordForPdf> | undefined {
  if (!labId) return undefined;
  const sqlite = (db as any).$client;
  const vendors = sqlite.prepare(
    "SELECT id, name, account_number, ordering_email, ordering_phone, ordering_fax, ordering_portal_url, po_number FROM stock_vendors WHERE lab_id = ? AND status = 'active'"
  ).all(labId) as any[];
  if (vendors.length === 0) return undefined;
  const primaryContact = new Map<number, { contact_name: string; contact_role: string | null }>();
  const contacts = sqlite.prepare(
    "SELECT vendor_id, contact_name, contact_role FROM stock_vendor_contacts WHERE lab_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(labId) as Array<{ vendor_id: number; contact_name: string; contact_role: string | null }>;
  for (const c of contacts) {
    if (!primaryContact.has(c.vendor_id)) {
      primaryContact.set(c.vendor_id, { contact_name: c.contact_name, contact_role: c.contact_role });
    }
  }
  const map = new Map<string, VendorRecordForPdf>();
  for (const v of vendors) {
    const pc = primaryContact.get(v.id) || null;
    map.set(String(v.name).toLowerCase().trim(), {
      name: v.name,
      account_number: v.account_number,
      ordering_email: v.ordering_email,
      ordering_phone: v.ordering_phone,
      ordering_fax: v.ordering_fax,
      ordering_portal_url: v.ordering_portal_url,
      po_number: v.po_number,
      primary_contact_name: pc?.contact_name || null,
      primary_contact_role: pc?.contact_role || null,
    });
  }
  return map;
}

// ── Sage Intacct export helpers ──────────────────────────────────────────────
// Per-location (lab) Intacct export config, persisted as a JSON blob so a
// template-version change is a config edit, not a code change. Empty object when
// the lab has not configured the export (UI shows the "set up" empty state).
function readIntacctConfig(labId: number): IntacctExportConfig {
  const sqlite = (db as any).$client;
  const row = sqlite.prepare("SELECT config_json FROM intacct_export_config WHERE lab_id = ?").get(labId) as any;
  if (!row || !row.config_json) return {};
  try { return JSON.parse(row.config_json) as IntacctExportConfig; } catch { return {}; }
}

// lower-cased vendor name -> the customer's Intacct Vendor ID (null when unset),
// for resolving each reorder line's vendor to its exact Intacct ID.
function buildIntacctVendorIdMap(labId: number): VendorIdMap {
  const sqlite = (db as any).$client;
  const rows = sqlite.prepare(
    "SELECT name, intacct_vendor_id FROM stock_vendors WHERE lab_id = ? AND status = 'active'"
  ).all(labId) as any[];
  const map: VendorIdMap = new Map();
  for (const r of rows) {
    const raw = r.intacct_vendor_id;
    const id = raw != null && String(raw).trim() !== "" ? String(raw) : null;
    map.set(String(r.name).toLowerCase().trim(), id);
  }
  return map;
}

// Whitelist incoming config keys so a stray field can't be persisted. Values are
// kept verbatim (Intacct master-data IDs are case-sensitive).
function sanitizeIntacctConfig(input: any): IntacctExportConfig {
  const i = input || {};
  const out: IntacctExportConfig = {};
  if (typeof i.transaction_definition === "string") out.transaction_definition = i.transaction_definition;
  if (typeof i.gl_account === "string") out.gl_account = i.gl_account;
  if (typeof i.date_format === "string") out.date_format = i.date_format;
  if (i.dimensions && typeof i.dimensions === "object" && !Array.isArray(i.dimensions)) {
    out.dimensions = {};
    for (const [k, v] of Object.entries(i.dimensions)) {
      if (typeof k === "string") out.dimensions[k] = v == null ? "" : String(v);
    }
  }
  if (Array.isArray(i.template_columns)) {
    out.template_columns = i.template_columns
      .filter((c: any) => c && typeof c.header === "string" && typeof c.source === "string")
      .map((c: any) => ({ header: c.header, source: c.source, ...(typeof c.placement === "string" ? { placement: c.placement } : {}) }));
  }
  return out;
}

function bencheLicenseCtx(req: any): LicenseContext {
  const u = req?.user || null;
  const sqlite = (db as any).$client;
  const ownerId = req?.ownerUserId ?? req?.userId;
  const row = ownerId
    ? (sqlite.prepare("SELECT clia_lab_name, clia_number, email, name, plan FROM users WHERE id = ?").get(ownerId) as any)
    : null;
  if (u?.email) {
    return {
      licensee: row?.clia_lab_name || u.name || u.email,
      email: u.email,
      plan: u.plan,
      issueDate: new Date().toISOString().slice(0, 10),
    };
  }
  const ipRaw = (req?.ip || req?.headers?.["x-forwarded-for"] || "").toString();
  const ipHash = ipRaw
    ? "ip-" + crypto.createHash("sha256").update(ipRaw).digest("hex").slice(0, 8)
    : "anonymous";
  return {
    licensee: "Demo Preview",
    email: ipHash,
    plan: "demo",
    issueDate: new Date().toISOString().slice(0, 10),
  };
}

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "clinic", "community", "hospital", "large_hospital", "enterprise"];

function hasOpsAccess(user: any, lab?: any) {
  const plan = lab?.plan ?? user?.plan;
  return SUITE_PLANS.includes(plan);
}

export function registerVeritaBenchRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
) {
  const sqlite = (db as any).$client;

  // ═══════════════════════════════════════════════════════════════════════
  // PRODUCTIVITY TRACKER
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/productivity - list all months for authenticated user's account
  // Resolve the active lab for the ops routes (which have no labScopeMiddleware):
  // from req.scope.labId if a lab-scoped path set it, else ?labId from the client
  // (the VeritaBench pages send the active lab). null = no lab context (legacy /
  // account-level view), which falls back to account-only scoping.
  const resolveOpsLabId = (req: any): number | null => {
    if (req.scope?.labId) return Number(req.scope.labId);
    const q = req.query?.labId;
    if (q == null || q === "") return null;
    const n = Number(q);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Audit #5 (2026-07-12): these routes have no labScopeMiddleware, so the raw
    // client ?labId must be membership-validated before it is trusted (mirrors
    // resolveLegacyLabId's header check). Without this, a user can pass a foreign
    // lab's id to stamp its name + CLIA onto the leverage PDF (#23) and to scope
    // ops reads/writes to a sibling lab. An unowned labId falls back to
    // account-only scoping (null).
    const userId = req.user?.userId ?? req.userId;
    const ownerId = req.ownerUserId ?? userId;
    try {
      const ok = sqlite.prepare(
        `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id IN (?, ?)
         UNION
         SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`
      ).get(n, userId, ownerId, n, userId);
      if (ok) return n;
    } catch { /* fall through to account-only scoping */ }
    return null;
  };

  app.get("/api/productivity", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const rows = labId != null
      ? sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? AND (lab_id = ? OR lab_id IS NULL) ORDER BY year DESC, month DESC").all(accountId, labId)
      : sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year DESC, month DESC").all(accountId);
    res.json(rows);
  });

  // POST /api/productivity - upsert a month
  app.post("/api/productivity", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const { year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes } = req.body;
    if (!year || !month) return res.status(400).json({ error: "year and month are required" });
    const now = new Date().toISOString();
    try {
      // Upsert keyed on (account, lab, year, month). When lab-scoped, claim a
      // legacy null-lab row for the same month if one exists (lazy migration) so a
      // single-lab owner's history is not duplicated when first re-saved under a lab.
      let target = labId != null
        ? sqlite.prepare("SELECT id FROM productivity_months WHERE account_id = ? AND lab_id = ? AND year = ? AND month = ?").get(accountId, labId, year, month) as any
        : sqlite.prepare("SELECT id FROM productivity_months WHERE account_id = ? AND lab_id IS NULL AND year = ? AND month = ?").get(accountId, year, month) as any;
      if (!target && labId != null) {
        target = sqlite.prepare("SELECT id FROM productivity_months WHERE account_id = ? AND lab_id IS NULL AND year = ? AND month = ?").get(accountId, year, month) as any;
      }
      if (target) {
        sqlite.prepare(`UPDATE productivity_months SET lab_id = ?, billable_tests = ?, productive_hours = ?, non_productive_hours = ?, overtime_hours = ?, total_ftes = ?, facility_type = ?, notes = ?, updated_at = ? WHERE id = ?`)
          .run(labId, billable_tests ?? null, productive_hours ?? null, non_productive_hours ?? null, overtime_hours ?? null, total_ftes ?? null, facility_type ?? 'community', notes ?? null, now, target.id);
      } else {
        sqlite.prepare(`INSERT INTO productivity_months (account_id, lab_id, year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(accountId, labId, year, month, billable_tests ?? null, productive_hours ?? null, non_productive_hours ?? null, overtime_hours ?? null, total_ftes ?? null, facility_type ?? 'community', notes ?? null, now, now);
      }
      const row = labId != null
        ? sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? AND lab_id = ? AND year = ? AND month = ?").get(accountId, labId, year, month)
        : sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? AND lab_id IS NULL AND year = ? AND month = ?").get(accountId, year, month);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/productivity/:id - delete a month entry
  app.delete("/api/productivity/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM productivity_months WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM productivity_months WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // ── VeritaPace forecast from goal (operations leverage chain, Phase 2) ──────────
  const computeTrailingAnnualVolume = (accountId: number, labId: number | null): number => {
    const row: any = labId != null
      ? sqlite.prepare("SELECT COALESCE(SUM(billable_tests),0) AS v FROM (SELECT billable_tests FROM productivity_months WHERE account_id = ? AND (lab_id = ? OR lab_id IS NULL) ORDER BY year DESC, month DESC LIMIT 12)").get(accountId, labId)
      : sqlite.prepare("SELECT COALESCE(SUM(billable_tests),0) AS v FROM (SELECT billable_tests FROM productivity_months WHERE account_id = ? ORDER BY year DESC, month DESC LIMIT 12)").get(accountId);
    return Number(row?.v ?? 0);
  };
  const buildForecastResponse = (accountId: number, labId: number | null) => {
    const saved: any = labId != null
      ? sqlite.prepare("SELECT * FROM productivity_forecasts WHERE account_id = ? AND lab_id = ?").get(accountId, labId)
      : sqlite.prepare("SELECT * FROM productivity_forecasts WHERE account_id = ? AND lab_id IS NULL").get(accountId);
    const trailingAnnualVolume = computeTrailingAnnualVolume(accountId, labId);
    const hoursPerFteYear = saved?.hours_per_fte ?? DEFAULT_HOURS_PER_FTE_YEAR;
    const annualVolume = saved?.forecast_annual_volume ?? trailingAnnualVolume;
    const computed = saved?.goal_ratio != null
      ? forecastFromGoal({ goalRatio: saved.goal_ratio, annualVolume, hoursPerFteYear })
      : null;
    // Staffing-grid FTE (Phase 3): when the lab has a shift grid, it drives the gap;
    // otherwise fall back to the manually-entered staffing_model_fte.
    const gridLines: any[] = labId != null
      ? sqlite.prepare("SELECT hours_per_shift, days_per_week, over_under FROM staffing_grid_lines WHERE account_id = ? AND lab_id = ?").all(accountId, labId)
      : sqlite.prepare("SELECT hours_per_shift, days_per_week, over_under FROM staffing_grid_lines WHERE account_id = ? AND lab_id IS NULL").all(accountId);
    const grid = staffingGridFte(gridLines.map((l) => ({ hoursPerShift: l.hours_per_shift, daysPerWeek: l.days_per_week, overUnder: l.over_under })), hoursPerFteYear);
    const staffingFte = gridLines.length > 0 ? grid.fteNeed : (saved?.staffing_model_fte ?? null);
    const staffingSource = gridLines.length > 0 ? "grid" : (saved?.staffing_model_fte != null ? "manual" : "none");
    const gap = computed && staffingFte != null
      ? chainGap({ annualVolume, fteBudget: computed.fteBudget, staffingModelFte: staffingFte, hoursPerFteYear })
      : null;
    return { saved: saved ?? null, trailingAnnualVolume, computed, gap, staffingGrid: { weeklyHours: grid.weeklyHours, fteNeed: grid.fteNeed, lineCount: gridLines.length, source: staffingSource } };
  };

  app.get("/api/productivity/forecast", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    res.json(buildForecastResponse(accountId, resolveOpsLabId(req)));
  });

  app.post("/api/productivity/forecast", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const { goal_ratio, forecast_annual_volume, hours_per_fte, staffing_model_fte, notes } = req.body;
    const now = new Date().toISOString();
    try {
      const existing: any = labId != null
        ? sqlite.prepare("SELECT id FROM productivity_forecasts WHERE account_id = ? AND lab_id = ?").get(accountId, labId)
        : sqlite.prepare("SELECT id FROM productivity_forecasts WHERE account_id = ? AND lab_id IS NULL").get(accountId);
      const hpf = hours_per_fte ?? DEFAULT_HOURS_PER_FTE_YEAR;
      if (existing) {
        sqlite.prepare("UPDATE productivity_forecasts SET goal_ratio = ?, forecast_annual_volume = ?, hours_per_fte = ?, staffing_model_fte = ?, notes = ?, updated_at = ? WHERE id = ?")
          .run(goal_ratio ?? null, forecast_annual_volume ?? null, hpf, staffing_model_fte ?? null, notes ?? null, now, existing.id);
      } else {
        sqlite.prepare("INSERT INTO productivity_forecasts (account_id, lab_id, goal_ratio, forecast_annual_volume, hours_per_fte, staffing_model_fte, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(accountId, labId, goal_ratio ?? null, forecast_annual_volume ?? null, hpf, staffing_model_fte ?? null, notes ?? null, now, now);
      }
      res.json(buildForecastResponse(accountId, labId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── VeritaShift staffing grid (leverage chain, Phase 3) ─────────────────────────
  const buildGridResponse = (accountId: number, labId: number | null) => {
    const lines: any[] = labId != null
      ? sqlite.prepare("SELECT * FROM staffing_grid_lines WHERE account_id = ? AND lab_id = ? ORDER BY sort_order, id").all(accountId, labId)
      : sqlite.prepare("SELECT * FROM staffing_grid_lines WHERE account_id = ? AND lab_id IS NULL ORDER BY sort_order, id").all(accountId);
    const fc: any = labId != null
      ? sqlite.prepare("SELECT hours_per_fte FROM productivity_forecasts WHERE account_id = ? AND lab_id = ?").get(accountId, labId)
      : sqlite.prepare("SELECT hours_per_fte FROM productivity_forecasts WHERE account_id = ? AND lab_id IS NULL").get(accountId);
    const hoursPerFteYear = fc?.hours_per_fte ?? DEFAULT_HOURS_PER_FTE_YEAR;
    const grid = staffingGridFte(lines.map((l) => ({ hoursPerShift: l.hours_per_shift, daysPerWeek: l.days_per_week, overUnder: l.over_under })), hoursPerFteYear);
    return { lines, weeklyHours: grid.weeklyHours, fteNeed: grid.fteNeed, hoursPerFteYear };
  };

  app.get("/api/staffing-grid", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    res.json(buildGridResponse(accountId, resolveOpsLabId(req)));
  });

  app.post("/api/staffing-grid", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const lines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const now = new Date().toISOString();
    try {
      const tx = sqlite.transaction(() => {
        if (labId != null) sqlite.prepare("DELETE FROM staffing_grid_lines WHERE account_id = ? AND lab_id = ?").run(accountId, labId);
        else sqlite.prepare("DELETE FROM staffing_grid_lines WHERE account_id = ? AND lab_id IS NULL").run(accountId);
        const ins = sqlite.prepare("INSERT INTO staffing_grid_lines (account_id, lab_id, label, role, hours_per_shift, days_per_week, over_under, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        lines.forEach((l, i) => ins.run(accountId, labId, l.label ?? null, l.role ?? null, Number(l.hours_per_shift) || 0, Number(l.days_per_week) || 0, Number(l.over_under) || 0, i, now, now));
      });
      tx();
      res.json(buildGridResponse(accountId, labId));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── VeritaPace leverage report PDF (leverage chain, Phase 4) ────────────────────
  // Reuses buildForecastResponse for every number (no new math), pulls lab identity,
  // renders the one-page director-to-CFO report, and returns a one-time token the
  // client GETs at /api/pdf/:token (same flow as the reorder PDF).
  app.post("/api/productivity/leverage-report", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    try {
      const fc: any = buildForecastResponse(accountId, labId);
      const userRow: any = sqlite.prepare("SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?").get(accountId);
      let labName: string | null = userRow?.clia_lab_name ?? null;
      let cliaNumber: string | null = userRow?.clia_number ?? null;
      const preparedBy: string | null = userRow?.name || userRow?.email || null;
      const labRow: any = labId != null
        ? sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId)
        : sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1").get(accountId);
      if (labRow) { labName = labRow.lab_name || labName; cliaNumber = labRow.clia_number || cliaNumber; }
      const data: LeverageReportData = {
        goalRatio: fc.saved?.goal_ratio ?? null,
        annualVolume: fc.computed?.annualVolume ?? fc.trailingAnnualVolume ?? null,
        hoursPerFte: fc.saved?.hours_per_fte ?? DEFAULT_HOURS_PER_FTE_YEAR,
        annualHourAllowance: fc.computed?.annualHourAllowance ?? null,
        weeklyHourAllowance: fc.computed?.weeklyHourAllowance ?? null,
        fteBudget: fc.computed?.fteBudget ?? null,
        staffingFte: fc.staffingGrid?.source === "grid" ? fc.staffingGrid.fteNeed : (fc.saved?.staffing_model_fte ?? null),
        staffingSource: fc.staffingGrid?.source ?? "none",
        staffingWeeklyHours: fc.staffingGrid?.weeklyHours ?? null,
        fteGap: fc.gap?.fteGap ?? null,
        projectedProductivity: fc.gap?.projectedProductivity ?? null,
      };
      const pdfBuffer = await generateLeverageReportPDF(data, { labName, cliaNumber, preparedBy, date: new Date().toISOString().slice(0, 10) });
      const filename = `VeritaPace_Leverage_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token });
    } catch (err: any) {
      console.error("Leverage report PDF error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/productivity/export - Excel export
  app.get("/api/productivity/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const rows = (labId != null
      ? sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? AND (lab_id = ? OR lab_id IS NULL) ORDER BY year ASC, month ASC").all(accountId, labId)
      : sqlite.prepare("SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC").all(accountId)) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Perplexity Computer";
      wb.created = new Date();

      // ===== Lab identity (Excel Export Standard) =====
      // Audit #9 (2026-07-12): resolve identity from the SELECTED lab (labs table),
      // like the Leverage PDF, so a multi-lab export prints the correct lab header
      // and never falls back to the logged-in person's name.
      const idLabId = resolveOpsLabId(req);
      const idLabRow = idLabId != null
        ? sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(idLabId) as any
        : null;
      const ownerRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      const labName = idLabRow?.lab_name || ownerRow?.clia_lab_name || "Laboratory";
      const cliaNumber = idLabRow?.clia_number || ownerRow?.clia_number || "Not on file";
      const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

      // ===== About sheet (sheet 1) =====
      const aboutBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
      const about = wb.addWorksheet("About");
      about.getColumn(1).width = 110;
      const aboutTitle = about.getCell("A1");
      aboutTitle.value = "VeritaBench Productivity Tracker";
      aboutTitle.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      aboutTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      aboutTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      about.getRow(1).height = 30;
      const aboutIdentity = about.getCell("A2");
      aboutIdentity.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
      aboutIdentity.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
      aboutIdentity.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
      aboutIdentity.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      aboutIdentity.border = aboutBorder;
      about.getRow(2).height = 24;
      let aboutRow = 3;
      const aboutSection = (text: string) => {
        const c = about.getCell(`A${aboutRow}`);
        c.value = text;
        c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
        c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
        c.border = aboutBorder;
        about.getRow(aboutRow).height = 22; aboutRow += 1;
      };
      const aboutBody = (text: string) => {
        const c = about.getCell(`A${aboutRow}`);
        c.value = text;
        c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
        c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
        c.border = aboutBorder;
        const estLines = Math.max(1, Math.floor(text.length / 100) + 1);
        about.getRow(aboutRow).height = Math.max(20, estLines * 16); aboutRow += 1;
      };
      const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };
      aboutSection("About this product");
      aboutBody("This workbook is a month-by-month export of the productivity data the laboratory has entered into VeritaBench. Each row represents a single calendar month and shows billable test volume, productive and non-productive hours, overtime, total FTEs, and three derived metrics (Productivity Ratio, Overtime Percentage, Productive Percentage). It is intended for internal trending, board reporting, and benchmarking conversations, not as a personnel evaluation instrument and not as a substitute for a formal time-and-motion study.");
      aboutBlank();
      aboutSection("How to use this workbook");
      aboutBody("The Productivity Data tab is sorted oldest-to-newest so a quick glance shows the trend line for each metric. Productivity Ratio is productive hours divided by billable tests (lower is leaner). OT % is overtime hours as a share of productive hours. Productive % is productive hours divided by total worked hours (productive plus non-productive). Use the auto-filter on row 1 to isolate a year, a facility type, or a month range. Notes capture context the lab director recorded at the time, staffing changes, instrument downtime, holiday weeks, and should be read alongside the numeric columns.");
      aboutBlank();
      aboutSection("Disclaimer");
      aboutBody("This workbook is an internal management report, not an audit-grade productivity assessment, not a regulatory submission, and not a substitute for a formal staffing or time-and-motion study. The numbers reflect what the laboratory entered into VeritaBench; VeritaAssure does not validate the underlying timecards, LIS billable-test counts, or FTE allocations. Productivity Ratio, OT %, and Productive % are mechanical formulas applied to the entered values, they are not benchmarks against an external standard, and a 'good' or 'bad' ratio depends on the lab's test mix, automation level, complexity, and union or contractual rules. This workbook is not a personnel evaluation tool and must not be used to discipline, terminate, or compensate individual employees. The lab director and senior leadership are responsible for staffing decisions, productivity targets, and any operational action taken on the basis of these numbers. VeritaAssure does not certify staffing levels, does not advise on labor law compliance, and does not represent these figures to any accrediting or regulatory body.");
      aboutBlank();
      aboutSection("Lab identity");
      aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
      aboutBlank();
      aboutSection("Coverage gaps");
      aboutBody("If your laboratory needs a productivity metric or column not represented here, for example, test-mix-weighted CAP workload units, send-out volume, or department-level breakouts, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
      about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Productivity Tracker&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
      await about.protect(exportPwd, {
        selectLockedCells: false, selectUnlockedCells: false,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: false, pivotTables: false,
      });

      const ws = wb.addWorksheet("Productivity Data");

      const headers = [
        "Year", "Month", "Billable Tests", "Productive Hours",
        "Non-Productive Hours", "Overtime Hours", "Total FTEs",
        "Productivity Ratio", "OT %", "Productive %", "Facility Type", "Notes",
      ];
      const colWidths = [10, 10, 18, 18, 22, 18, 14, 20, 12, 14, 22, 30];
      ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: colWidths[i] ?? 18 }));

      const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const dataRows = rows.map((r: any) => {
        const prodRatio = r.productive_hours && r.billable_tests ? (r.productive_hours / r.billable_tests).toFixed(4) : "";
        const otPct = r.overtime_hours && r.productive_hours ? ((r.overtime_hours / r.productive_hours) * 100).toFixed(1) + "%" : "";
        const prodPct = r.productive_hours && r.non_productive_hours != null ? ((r.productive_hours / (r.productive_hours + r.non_productive_hours)) * 100).toFixed(1) + "%" : "";
        return [
          r.year, monthNames[r.month] || r.month, r.billable_tests ?? "",
          r.productive_hours ?? "", r.non_productive_hours ?? "",
          r.overtime_hours ?? "", r.total_ftes ?? "",
          prodRatio, otPct, prodPct,
          r.facility_type ?? "", r.notes ?? "",
        ];
      });
      ws.addRows(dataRows);

      // Styling: teal headers
      const tealFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      const headerFont: any = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      const headerRow = ws.getRow(1);
      headerRow.height = 20;
      headerRow.eachCell((cell: any) => {
        cell.fill = tealFill;
        cell.font = headerFont;
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
      });

      // Freeze pane B2, auto-filter, alternating rows
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      ws.autoFilter = { from: "A1", to: `L${dataRows.length + 1}` };
      for (let i = 2; i <= dataRows.length + 1; i++) {
        const row = ws.getRow(i);
        row.height = 20;
        const bgColor = i % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
        row.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
      }

      // Page-setup header/footer carry lab identity on every printed page.
      ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Productivity Tracker&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

      await ws.protect(exportPwd, {
        selectLockedCells: true, selectUnlockedCells: true,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: true, pivotTables: false,
      });

      // Workbook opens to the About sheet (sheet 1, activeTab 0).
      wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                    firstSheet: 0, activeTab: 0, visibility: "visible" }];

      applyLicenseToExcelJS(wb, bencheLicenseCtx(req));
      const buffer = await wb.xlsx.writeBuffer();
      res.set("Content-Disposition", `attachment; filename="VeritaBench-Productivity_${new Date().toISOString().split("T")[0]}.xlsx"`);
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: "Export failed: " + err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAFFING ANALYZER
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/staffing-studies - list studies for account
  app.get("/api/staffing-studies", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const labId = resolveOpsLabId(req);
    const rows = labId != null
      ? sqlite.prepare("SELECT * FROM staffing_studies WHERE account_id = ? AND (lab_id = ? OR lab_id IS NULL) ORDER BY created_at DESC").all(accountId, labId)
      : sqlite.prepare("SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at DESC").all(accountId);
    res.json(rows);
  });

  // POST /api/staffing-studies - create study
  app.post("/api/staffing-studies", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { name, department, start_date } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const now = new Date().toISOString();
    try {
      const labId = resolveOpsLabId(req);
      const result = sqlite.prepare(
        "INSERT INTO staffing_studies (account_id, lab_id, name, department, start_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
      ).run(accountId, labId, name, department ?? "Core Lab", start_date ?? null, now, now);
      const row = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/staffing-studies/:id - get study with all data
  app.get("/api/staffing-studies/:id", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot").all(id);
    res.json({ study, data });
  });

  // Wave D3 (2026-06-12): POST staffing-adequacy determination. The director
  // (or designee) attests, on top of the workload analysis, that staffing is
  // adequate for the volume and complexity, or records a gap and the plan to
  // close it. Cites 42 CFR 493.1445(e)(5). An empty determination clears the
  // attestation (re-open for re-review).
  app.post("/api/staffing-studies/:id/attest-adequacy", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    const { determination, note, attested_by, attested_title, clear } = req.body || {};
    const now = new Date().toISOString();
    if (clear) {
      sqlite.prepare(
        "UPDATE staffing_studies SET adequacy_determination = NULL, adequacy_note = NULL, adequacy_attested_at = NULL, adequacy_attested_by = NULL, adequacy_attested_title = NULL, updated_at = ? WHERE id = ?"
      ).run(now, id);
      return res.json(sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ?").get(id));
    }
    if (!["adequate", "gap_identified"].includes(determination)) {
      return res.status(400).json({ error: "determination must be 'adequate' or 'gap_identified'" });
    }
    if (!attested_by || !String(attested_by).trim()) {
      return res.status(400).json({ error: "attested_by (director or designee name) is required" });
    }
    if (determination === "gap_identified" && (!note || !String(note).trim())) {
      return res.status(400).json({ error: "A gap determination requires a note describing the gap and the plan to close it." });
    }
    sqlite.prepare(
      "UPDATE staffing_studies SET adequacy_determination = ?, adequacy_note = ?, adequacy_attested_at = ?, adequacy_attested_by = ?, adequacy_attested_title = ?, updated_at = ? WHERE id = ?"
    ).run(determination, note ?? null, now, String(attested_by).trim(), attested_title ?? null, now, id);
    res.json(sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ?").get(id));
  });

  // POST /api/staffing-studies/:id/data - batch upsert hourly data
  app.post("/api/staffing-studies/:id/data", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });

    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: "Expected array of data items" });

    const now = new Date().toISOString();
    const upsert = sqlite.prepare(`
      INSERT INTO staffing_hourly_data (study_id, week_number, day_of_week, hour_slot, metric_type, value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(study_id, week_number, day_of_week, hour_slot, metric_type) DO UPDATE SET
        value = excluded.value
    `);

    const batchUpsert = sqlite.transaction(() => {
      for (const item of items) {
        upsert.run(id, item.week_number, item.day_of_week, item.hour_slot, item.metric_type, item.value ?? 0, now);
      }
    });

    try {
      batchUpsert();
      res.json({ success: true, count: items.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/staffing-studies/:id - delete study and cascade data
  app.delete("/api/staffing-studies/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!study) return res.status(404).json({ error: "Study not found" });
    sqlite.prepare("DELETE FROM staffing_hourly_data WHERE study_id = ?").run(id);
    sqlite.prepare("DELETE FROM staffing_studies WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC DEMO ENDPOINTS (no auth - demo data only)
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/demo/productivity-months - returns demo account productivity data only
  app.get("/api/demo/productivity-months", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const rows = sqlite.prepare(
      "SELECT * FROM productivity_months WHERE account_id = ? ORDER BY year ASC, month ASC"
    ).all(demoUser.id);
    res.json(rows);
  });

  // GET /api/demo/inventory - returns demo account inventory items only
  app.get("/api/demo/inventory", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    ).all(demoUser.id);
    const items = rows.map((item: any) => {
      const burnRate = item.burn_rate || 0;
      const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
      const orderToQty = burnRate * (item.desired_days_of_stock || 0);
      const daysRemaining = burnRate > 0 ? Math.round(item.quantity_on_hand / burnRate) : null;
      const needsReorder = item.quantity_on_hand <= reorderPoint;
      return {
        ...item,
        reorder_point: Math.round(reorderPoint),
        order_to_qty: Math.round(orderToQty),
        days_remaining: daysRemaining,
        needs_reorder: needsReorder,
      };
    });
    res.json(items);
  });

  // GET /api/demo/staffing-study - returns demo account first staffing study with data
  app.get("/api/demo/staffing-study", (_req: any, res) => {
    const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
    if (!demoUser) return res.status(404).json({ error: "Demo data not available" });
    const study = sqlite.prepare(
      "SELECT * FROM staffing_studies WHERE account_id = ? ORDER BY created_at ASC LIMIT 1"
    ).get(demoUser.id) as any;
    if (!study) return res.status(404).json({ error: "No demo staffing study found" });
    const data = sqlite.prepare(
      "SELECT * FROM staffing_hourly_data WHERE study_id = ? ORDER BY week_number, day_of_week, hour_slot"
    ).all(study.id);
    res.json({ study, data });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // INVENTORY MANAGER
  // ═══════════════════════════════════════════════════════════════════════

  // Per-item decoration shared by the legacy and lab-scoped list/reorder
  // routes. Single source of truth for ALL inventory math so the list view,
  // reorder PDF, and reorder Excel can never disagree.
  //
  // Math definitions (so future readers don't have to re-derive them):
  //   reorder_point     burn_rate * (lead_time_days + safety_stock_days)
  //                     the threshold at which we flag the item for reorder
  //   order_to_qty      burn_rate * desired_days_of_stock
  //                     the TARGET INVENTORY LEVEL (not "amount to order")
  //   days_remaining    floor(quantity_on_hand / burn_rate)
  //                     days of supply at current burn before stockout.
  //                     Use floor not round so "5d" never means "actually
  //                     4.5d remaining"
  //   shortfall         max(0, order_to_qty - quantity_on_hand)
  //                     how many additional eachs we need to hit target
  //   suggested_order_packs   ceil(shortfall / units_per_order_unit)
  //                     can't order half a box; round UP
  //   delivered_qty           suggested_order_packs * units_per_order_unit
  //                     what we'll ACTUALLY receive. Always >= shortfall;
  //                     overshoot is unavoidable with case-pack packaging
  //   ending_qty              quantity_on_hand + delivered_qty
  //                     inventory level after the order arrives
  //   ending_days             floor(ending_qty / burn_rate)
  //                     days of supply after delivery; sanity check that
  //                     ending_days >= desired_days_of_stock
  function decorateInventoryItem(item: any) {
    const burnRate = item.burn_rate || 0;
    const onHand = item.quantity_on_hand || 0;
    const onOrder = item.on_order_qty || 0;
    // Inventory position = what's on the shelf plus what's already on a PO but
    // not yet received. The reorder decision and the suggested order quantity
    // both work off position, not on-hand, so an item already inbound does not
    // re-trigger Reorder Now and the buyer does not double-order what's coming.
    const inventoryPosition = onHand + onOrder;
    const upu = item.units_per_order_unit || 1;
    const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
    const orderToQty = burnRate * (item.desired_days_of_stock || 0);
    const daysRemaining = burnRate > 0 ? Math.floor(onHand / burnRate) : null;

    // Expiry-aware reordering. You can only count stock you will actually use
    // before it expires: the usable portion of the on-hand lot is capped at
    // burn_rate * days_until_expiry. On-order stock is a fresh lot, so it is
    // not capped. effective_position is the real available supply, and the
    // reorder decision plus the suggested order size both work off it. An item
    // with plenty on the shelf but a short-dated lot therefore flags for
    // reorder ("Expiring lot") even when raw quantity is above par. Items with
    // no expiration date are unchanged (usableOnHand === onHand), so this is
    // backward compatible with every existing item.
    let daysUntilExpiry: number | null = null;
    if (item.expiration_date) {
      const expMs = Date.parse(item.expiration_date);
      if (!Number.isNaN(expMs)) {
        daysUntilExpiry = Math.floor((expMs - Date.now()) / 86400000);
      }
    }
    const usableOnHand = (burnRate > 0 && daysUntilExpiry !== null)
      ? Math.max(0, Math.min(onHand, burnRate * daysUntilExpiry))
      : onHand;
    const effectivePosition = usableOnHand + onOrder;

    const belowPar = inventoryPosition <= reorderPoint;
    const needsReorder = effectivePosition <= reorderPoint;
    // Expiry-driven = flagged for reorder by the expiry cap, not by raw quantity.
    const expiryDrivenReorder = needsReorder && !belowPar;
    const reorderReason = !needsReorder
      ? null
      : belowPar
      ? "Below reorder point"
      : "Expiring lot";

    const shortfall = Math.max(0, Math.round(orderToQty) - effectivePosition);
    const suggestedOrderPacks = upu > 1
      ? Math.ceil(shortfall / upu)
      : shortfall;
    const deliveredQty = upu > 1
      ? suggestedOrderPacks * upu
      : shortfall;
    const endingQty = onHand + deliveredQty;
    const endingDays = burnRate > 0 ? Math.floor(endingQty / burnRate) : null;

    return {
      ...item,
      reorder_point: Math.round(reorderPoint),
      order_to_qty: Math.round(orderToQty),
      days_remaining: daysRemaining,
      needs_reorder: needsReorder,
      inventory_position: inventoryPosition,
      days_until_expiry: daysUntilExpiry,
      usable_on_hand: Math.round(usableOnHand),
      effective_position: Math.round(effectivePosition),
      reorder_reason: reorderReason,
      expiry_driven_reorder: expiryDrivenReorder,
      suggested_order_packs: suggestedOrderPacks,
      delivered_qty: deliveredQty,
      ending_qty: endingQty,
      ending_days: endingDays,
    };
  }

  // Apply optional client-side filters to a decorated reorder list.
  // Filters accepted as query params on the reorder-list endpoints (PDF
  // + Excel + JSON). When provided, the generated document is scoped to
  // matching items only. This is what powers "Order PDF (Fisher)" -- the
  // John (San Carlos) ask from 2026-05-21 where the lab wants to print
  // a vendor-specific list to hand to the rep.
  //
  // Status filter is intentionally not supported -- the reorder endpoint
  // already filters to needs_reorder=true.
  function applyReorderFilters(items: any[], query: any): any[] {
    const department = (query.department || "").trim();
    const category = (query.category || "").trim();
    const vendor = (query.vendor || "").trim();
    return items.filter(it => {
      if (department && it.department !== department) return false;
      if (category && it.category !== category) return false;
      if (vendor && (it.vendor || "") !== vendor) return false;
      return true;
    });
  }

  // Build the filter-context object passed into the PDF/XLSX generators so
  // they can render the FILTERED VIEW banner + reflect scope in the
  // filename. Mirrors applyReorderFilters' inputs.
  function reorderFilterContext(query: any) {
    return {
      filterDepartment: (query.department || "").trim() || null,
      filterCategory: (query.category || "").trim() || null,
      filterVendor: (query.vendor || "").trim() || null,
    };
  }

  // Filename suffix when filters are active. Sanitizes the same way the
  // lab name is sanitized so the output is a safe Windows/Mac filename.
  function reorderFilenameSuffix(query: any): string {
    const vendor = (query.vendor || "").trim();
    const department = (query.department || "").trim();
    const category = (query.category || "").trim();
    const parts: string[] = [];
    if (vendor) parts.push(vendor);
    if (department) parts.push(department);
    if (category) parts.push(category);
    if (parts.length === 0) return "";
    const joined = parts.join("_").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 60);
    return joined ? `_${joined}` : "";
  }

  // GET /api/inventory - list inventory items for the user's active lab.
  // Shape A broader sweep (2026-06-09): account_id scope leaked across labs
  // for multi-lab owners. Lab-scope via resolveLegacyLabId.
  app.get("/api/inventory", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const labId = resolveLegacyLabId((db as any).$client, req);
    if (!labId) return res.json([]);
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
    ).all(labId);
    const items = (rows as any[]).map(decorateInventoryItem);
    res.json(items);
  });

  // GET /api/inventory/reorder-list - items currently flagged needs_reorder,
  // grouped by vendor server-side so the client can either render a table
  // or hand the payload straight to the PDF/Excel generator unchanged.
  // The trigger formula lives in decorateInventoryItem above; we filter
  // here rather than recomputing.
  app.get("/api/inventory/reorder-list", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const labId = resolveLegacyLabId((db as any).$client, req);
    if (!labId) return res.json({ items: [], totalCount: 0, generatedAt: new Date().toISOString() });
    const rows = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
    ).all(labId);
    const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
    const items = applyReorderFilters(decorated, req.query);
    res.json({ items, totalCount: items.length, generatedAt: new Date().toISOString() });
  });

  // POST /api/inventory/reorder-list/pdf - generate a reorder document PDF
  // grouped by vendor with a director signature block. Returns a one-time
  // token the client GETs at /api/pdf/:token (same pattern as the studies
  // PDF flow in routes.ts). The lab identity stamped on the PDF is read
  // fresh from the labs table when the requester has a lab, falling back
  // to the user's clia_lab_name / clia_number for legacy single-lab users.
  app.post("/api/inventory/reorder-list/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

      // Pull lab identity for the header. labs table first, user row fallback.
      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      let labIdForVendors: number | null = null;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }
      // PR 4 auto-fill: pull stock_vendors records for this lab and pass
      // them into the PDF generator. The renderer looks each vendor
      // section up by name (case-insensitive, single-match substring
      // fallback) and renders a "Send to" panel under the vendor header
      // when a record exists. Labs that haven't populated their vendor
      // directory get the prior behavior (no panel, no regression).
      const userLabRow = sqlite.prepare(
        "SELECT lab_id FROM users WHERE id = ?"
      ).get(accountId) as any;
      labIdForVendors = userLabRow?.lab_id || null;
      const vendorRecords = buildVendorRecordMap(labIdForVendors);

      const pdfBuffer = await generateReorderListPDF(items, { labName, cliaNumber, preparedBy, vendorRecords, ...reorderFilterContext(req.query) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Reorder${reorderFilenameSuffix(req.query)}_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: items.length });
    } catch (err: any) {
      console.error("Reorder PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // GET /api/inventory/count-history - per-item physical count history (from the
  // inventory_count_events ledger) plus a recount-reconciled true burn rate.
  // Scoped to the active lab the same way the inventory list is.
  app.get("/api/inventory/count-history", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const labId = resolveLegacyLabId((db as any).$client, req);
    if (!labId) return res.json({ generatedAt: new Date().toISOString(), windowDays: 0, items: [] });
    const days = Number(req.query.days) || 365;
    const itemId = req.query.item_id ? Number(req.query.item_id) : null;
    try {
      res.json(buildCountHistory(sqlite, labId, { days, itemId }));
    } catch (err: any) {
      console.error("Count history error:", err.message);
      res.status(500).json({ error: "count_history_failed", detail: err.message });
    }
  });

  // POST /api/inventory/count-history/xlsx - the same report as a workbook.
  // Returns a one-time token the client GETs at /api/pdf/:token (reorder pattern).
  app.post("/api/inventory/count-history/xlsx", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const labId = resolveLegacyLabId((db as any).$client, req);
    if (!labId) return res.status(400).json({ error: "No active lab" });
    const days = Number(req.body?.days) || Number(req.query?.days) || 365;
    try {
      const report = buildCountHistory(sqlite, labId, { days });
      const labRow = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
      const buffer = await generateCountHistoryExcel(report, { labName: labRow?.lab_name ?? null, cliaNumber: labRow?.clia_number ?? null });
      const filename = `VeritaStock_Count_History_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const token = storePdfToken(buffer, filename);
      res.json({ token, itemCount: report.items.length });
    } catch (err: any) {
      console.error("Count history xlsx error:", err.message);
      res.status(500).json({ error: "count_history_xlsx_failed", detail: err.message });
    }
  });

  // POST /api/inventory/reorder-list/excel - same payload as the PDF route
  // but streams an .xlsx directly. Excel is the format purchasing actually
  // edits before sending to a vendor (Confirmed Qty + Notes columns are the
  // only two left unlocked), so this route does not go through the PDF
  // token store - we return the buffer inline with Content-Disposition.
  app.post("/api/inventory/reorder-list/excel", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const xlsxBuffer = await generateReorderListExcel(items, { labName, cliaNumber, preparedBy, ...reorderFilterContext(req.query) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Reorder${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.send(xlsxBuffer);
    } catch (err: any) {
      console.error("Reorder Excel generation error:", err.message);
      res.status(500).json({ error: "Excel generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/snap-order/pdf - emergency manual-order PDF.
  //
  // Use case: surge events (respiratory outbreak, supply-chain shock) where
  // the lab wants to order quantities that intentionally bypass the
  // calculated reorder thresholds. User enters quantities by hand on the
  // Snap Order screen; this endpoint generates a vendor-grouped PDF with
  // a director signature block, clearly framed as a MANUAL order so the
  // rep doesn't confuse it with the auto-calculated reorder document.
  //
  // Body shape: { items: [{ id: number, snap_qty: number, snap_unit?: string }] }
  // Server fetches each item by id (scoped to account), validates ownership,
  // composes SnapOrderItem rows, and generates the PDF.
  app.post("/api/inventory/snap-order/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const valid = requestedItems
      .filter((r: any) => typeof r?.id === "number" && typeof r?.snap_qty === "number" && r.snap_qty > 0)
      .map((r: any) => ({ id: Number(r.id), snap_qty: Number(r.snap_qty), snap_unit: typeof r.snap_unit === "string" ? r.snap_unit : null }));
    if (valid.length === 0) {
      return res.status(400).json({ error: "No items with snap_qty > 0 submitted." });
    }
    try {
      const placeholders = valid.map(() => "?").join(",");
      const rows = sqlite.prepare(
        `SELECT * FROM inventory_items WHERE account_id = ? AND id IN (${placeholders})`
      ).all(accountId, ...valid.map((v: any) => v.id)) as any[];

      const byId = new Map<number, any>();
      for (const r of rows) byId.set(r.id, r);

      const items: SnapOrderItem[] = valid
        .map((v: any) => {
          const row = byId.get(v.id);
          if (!row) return null;
          return {
            id: row.id,
            item_name: row.item_name,
            catalog_number: row.catalog_number,
            lot_number: row.lot_number,
            vendor: row.vendor,
            department: row.department,
            unit: row.unit,
            order_unit: row.order_unit,
            quantity_on_hand: row.quantity_on_hand || 0,
            snap_qty: v.snap_qty,
            snap_unit: v.snap_unit || row.order_unit || row.unit || "each",
          } as SnapOrderItem;
        })
        .filter((x: any): x is SnapOrderItem => x !== null);

      if (items.length === 0) {
        return res.status(404).json({ error: "None of the submitted items found for this account." });
      }

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const snapLabRow = sqlite.prepare("SELECT lab_id FROM users WHERE id = ?").get(accountId) as any;
      const pdfBuffer = await generateSnapOrderPDF(items, { labName, cliaNumber, preparedBy, vendorRecords: buildVendorRecordMap(snapLabRow?.lab_id || null) });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_SnapOrder_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: items.length });
    } catch (err: any) {
      console.error("Snap order PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/labels/pdf - parking-lot #29 Phase 1.
  //
  // Generate an Avery 5160 sheet of Code 128 barcode labels for inventory
  // items. Two modes:
  //   - body.itemIds: number[]  →  labels for those specific items only
  //   - body.itemIds omitted    →  one label for EVERY item in the account
  //                                (no barcode_value filter; see 2026-05-29 note below)
  //
  // Every item prints a barcode. If an item does not yet have a bound
  // barcode_value, we synthesize a stable VLS- prefix code from the item id
  // so it still renders a scannable label. The synthesized value is NOT
  // persisted - this endpoint is print-only.
  app.post("/api/inventory/labels/pdf", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const requestedIds = Array.isArray(req.body?.itemIds)
      ? req.body.itemIds.filter((x: any) => typeof x === "number" && Number.isFinite(x))
      : null;
    try {
      let rows: any[];
      if (requestedIds && requestedIds.length > 0) {
        const placeholders = requestedIds.map(() => "?").join(",");
        rows = sqlite.prepare(
          `SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE account_id = ? AND id IN (${placeholders}) ORDER BY item_name ASC`
        ).all(accountId, ...requestedIds) as any[];
      } else {
        // Print labels for every item in the account. Items without a
        // bound barcode_value get a synthesized VLS-<id> placeholder
        // below (see labels.map). The whole point of the placeholder
        // is to let the lab print labels BEFORE assigning barcodes,
        // so the previous "WHERE barcode_value IS NOT NULL" filter
        // was directly contradicting that path; dropped 2026-05-29.
        rows = sqlite.prepare(
          "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
        ).all(accountId) as any[];
      }
      if (rows.length === 0) {
        return res.status(404).json({ error: "No inventory items found in this account. Add at least one item before printing labels." });
      }

      const labels: BarcodeLabelInput[] = rows.map((r) => ({
        barcodeValue: (r.barcode_value && String(r.barcode_value).trim().length > 0)
          ? String(r.barcode_value)
          : `VLS-${String(r.id).padStart(8, "0")}`,
        itemName: r.item_name || "(unnamed)",
        catalogNumber: r.catalog_number,
        lotNumber: r.lot_number,
        storageLocation: r.storage_location,
      }));

      // Lab identity (footer text on the sheet).
      let labName: string | null = null;
      let cliaNumber: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const pdfBuffer = await generateBarcodeLabelSheetPdf(labels, { labName, cliaNumber });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Labels_${datestamp}.pdf`;
      const token = storePdfToken(pdfBuffer, filename);
      res.json({ token, totalCount: labels.length });
    } catch (err: any) {
      console.error("Barcode label PDF generation error:", err.message);
      res.status(500).json({ error: "PDF generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/count-sheet/excel - Inventory Count workbook.
  //
  // Designed for the periodic physical inventory: counter walks the
  // shelves with the printed workbook (or a tablet open to it),
  // writing counted quantities next to system quantities. Sheet is
  // protected so identity / system columns cannot be edited; only
  // the counter-input columns (Counted Qty, Counted By, Count Date,
  // Notes) are unlocked. Discrepancy is an in-cell formula that
  // populates when Counted Qty is entered.
  //
  // Filters: department / category / vendor, same query-param
  // shape as the reorder routes, so the user can produce a
  // Chemistry-only or a Bio-Rad-only count sheet.
  //
  // Streamed inline (no PDF token store) because the workbook is
  // edited by the counter; the binary is the deliverable.
  app.post("/api/inventory/count-sheet/excel", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    try {
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
      ).all(accountId);
      const filtered = applyReorderFilters(rows as any[], req.query);
      if (filtered.length === 0) {
        return res.status(404).json({ error: "No inventory items in the current scope. Clear filters or add items before generating a count sheet." });
      }
      const items: InventoryCountItem[] = filtered.map((r: any) => ({
        storage_location: r.storage_location,
        department: r.department,
        item_name: r.item_name,
        category: r.category,
        catalog_number: r.catalog_number,
        lot_number: r.lot_number,
        expiration_date: r.expiration_date,
        vendor: r.vendor,
        quantity_on_hand: Number(r.quantity_on_hand ?? 0),
        unit: r.unit ?? r.usage_unit ?? null,
      }));

      let labName: string | null = null;
      let cliaNumber: string | null = null;
      let preparedBy: string | null = null;
      const userRow = sqlite.prepare(
        "SELECT name, email, clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      if (userRow) {
        preparedBy = userRow.name || userRow.email || null;
        labName = userRow.clia_lab_name || null;
        cliaNumber = userRow.clia_number || null;
      }
      const labRow = sqlite.prepare(
        "SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1"
      ).get(accountId) as any;
      if (labRow) {
        labName = labRow.lab_name || labName;
        cliaNumber = labRow.clia_number || cliaNumber;
      }

      const ctxFilters = reorderFilterContext(req.query);
      const filterLabelParts: string[] = [];
      if (ctxFilters.filterDepartment) filterLabelParts.push(ctxFilters.filterDepartment);
      if (ctxFilters.filterCategory) filterLabelParts.push(ctxFilters.filterCategory);
      if (ctxFilters.filterVendor) filterLabelParts.push(ctxFilters.filterVendor);
      const filterLabel = filterLabelParts.length > 0 ? filterLabelParts.join(" / ") : null;

      const xlsxBuffer = await generateInventoryCountExcel(items, { labName, cliaNumber, preparedBy, filterLabel });
      const datestamp = new Date().toISOString().slice(0, 10);
      const filename = `VeritaStock_Count${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", xlsxBuffer.length);
      res.send(xlsxBuffer);
    } catch (err: any) {
      console.error("Inventory count workbook generation error:", err.message);
      res.status(500).json({ error: "Workbook generation failed", detail: err.message });
    }
  });

  // POST /api/inventory/scan - parking-lot #29 Phase 2.
  //
  // Record a barcode scan event and (optionally) adjust the bound
  // inventory item's quantity_on_hand. All scans are logged to
  // scan_events for audit, including unknown-barcode misses.
  //
  // Body:
  //   { barcode_value: string (required, trimmed),
  //     action?: "decrement" | "increment" | "lookup_only" | "correction",
  //     quantity_delta?: number  (only honored for action="correction";
  //                               must be a finite integer, signed),
  //     notes?: string }
  //
  // Defaults: action="decrement", quantity_delta=-1 for decrement,
  // +1 for increment, 0 for lookup_only.
  //
  // Response on hit:
  //   { ok: true, action, item, scan_event_id, quantity_before,
  //     quantity_after, needs_reorder, reorder_point, order_to_qty }
  // Response on miss (404, but scan still logged):
  //   { ok: false, action: "unknown_barcode", scan_event_id, barcode_value }
  //
  // The whole SELECT-UPDATE-INSERT runs in a sqlite transaction so two
  // concurrent scans of the same barcode can't read stale quantities.
  app.post("/api/inventory/scan", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rawBarcode = req.body?.barcode_value;
    const requestedAction = req.body?.action ?? "decrement";
    const correctionDelta = Number(req.body?.quantity_delta);
    const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
    if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
      return res.status(400).json({ error: "barcode_value is required and must be a non-empty string." });
    }
    const ALLOWED_ACTIONS = ["decrement", "increment", "lookup_only", "correction"] as const;
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(requestedAction)) {
      return res.status(400).json({ error: `action must be one of ${ALLOWED_ACTIONS.join(", ")}` });
    }
    if (requestedAction === "correction" && !Number.isFinite(correctionDelta)) {
      return res.status(400).json({ error: "action=correction requires a finite quantity_delta number." });
    }
    const barcode = rawBarcode.trim();
    const ipRaw = (req?.ip || req?.headers?.["x-forwarded-for"] || "").toString();
    const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
    const ua = typeof req?.headers?.["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 500) : null;
    const userId = req.userId;
    // Shape A class sweep (2026-06-09): the lookup needs to find items in
    // ANY lab the user is a member of, not just rows where account_id matches
    // the user. Pre-fix, a multi-lab user scanning a seeded item got an
    // "unknown_barcode" 404 even though /api/labs/:labId/inventory listed
    // the same row. We resolve via lab_members AND the user's own owned rows.
    const labIds = sqlite.prepare(
      "SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active'"
    ).all(userId).map((r: any) => r.lab_id);
    try {
      const txn = sqlite.transaction(() => {
        // Try owned rows first (fast path), then any row in a lab the user is
        // a member of. Both paths require a non-null barcode_value match.
        let row = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE account_id = ? AND barcode_value IS NOT NULL AND barcode_value = ?"
        ).get(accountId, barcode) as any;
        if (!row && labIds.length > 0) {
          const placeholders = labIds.map(() => "?").join(",");
          row = sqlite.prepare(
            `SELECT * FROM inventory_items WHERE lab_id IN (${placeholders}) AND barcode_value IS NOT NULL AND barcode_value = ?`
          ).get(...labIds, barcode) as any;
        }
        if (!row) {
          const ins = sqlite.prepare(`
            INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
            VALUES (?, NULL, ?, 'unknown_barcode', NULL, NULL, NULL, ?, ?, ?, ?)
          `).run(accountId, userId, barcode, notes, ip, ua);
          return { hit: false as const, scanEventId: Number(ins.lastInsertRowid) };
        }
        const qtyBefore = Number(row.quantity_on_hand ?? 0);
        let delta = 0;
        if (requestedAction === "decrement") delta = -1;
        else if (requestedAction === "increment") delta = 1;
        else if (requestedAction === "lookup_only") delta = 0;
        else if (requestedAction === "correction") delta = Math.trunc(correctionDelta);
        const qtyAfter = Math.max(0, qtyBefore + delta);
        // Recompute the actual signed delta we'll record (zero-clamp can
        // make the stored delta smaller in magnitude than the requested
        // delta on a decrement past zero).
        const actualDelta = qtyAfter - qtyBefore;
        if (requestedAction !== "lookup_only" && actualDelta !== 0) {
          const now = new Date().toISOString();
          // Access already verified at the row lookup above (either account_id
          // match or lab_members membership of row.lab_id). UPDATE by id alone.
          sqlite.prepare(
            "UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?"
          ).run(qtyAfter, now, row.id);
        }
        const ins = sqlite.prepare(`
          INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(accountId, row.id, userId, requestedAction, actualDelta, qtyBefore, qtyAfter, barcode, notes, ip, ua);
        return { hit: true as const, scanEventId: Number(ins.lastInsertRowid), itemId: row.id, qtyBefore, qtyAfter };
      });
      const result = txn();
      if (!result.hit) {
        return res.status(404).json({ ok: false, action: "unknown_barcode", scan_event_id: result.scanEventId, barcode_value: barcode });
      }
      const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(result.itemId) as any;
      const decorated = decorateInventoryItem(fresh);
      return res.json({
        ok: true,
        action: requestedAction,
        item: decorated,
        scan_event_id: result.scanEventId,
        quantity_before: result.qtyBefore,
        quantity_after: result.qtyAfter,
        needs_reorder: !!decorated.needs_reorder,
        reorder_point: decorated.reorder_point ?? null,
        order_to_qty: decorated.order_to_qty ?? null,
      });
    } catch (err: any) {
      console.error("Scan endpoint error:", err.message);
      return res.status(500).json({ error: "Scan failed", detail: err.message });
    }
  });

  // POST /api/labs/:labId/inventory/scan
  //
  // 2026-06-08 lab-scoping fix. The legacy /api/inventory/scan endpoint
  // above keys its inventory_items lookup off account_id, which is the
  // pre-multi-lab ownership column. The list endpoint at /api/labs/:labId/
  // inventory has been migrated to query WHERE lab_id, so the table
  // page renders items correctly while scans against those same items
  // return 404 unknown_barcode because account_id != req.userId.
  //
  // This new endpoint mirrors the legacy handler exactly except the
  // inventory_items lookup and UPDATE use lab_id from the URL. scan_events
  // continues to record account_id (we resolve it from labs.owner_user_id)
  // so existing scan-history queries keep working.
  const scanLabScopeMW = (app as any).locals?.labScopeMiddleware;
  if (scanLabScopeMW) {
    app.post("/api/labs/:labId/inventory/scan", authMiddleware, scanLabScopeMW, requireWriteAccess, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const labId = req.scope.labId;
      const rawBarcode = req.body?.barcode_value;
      const requestedAction = req.body?.action ?? "decrement";
      const correctionDelta = Number(req.body?.quantity_delta);
      // 2026-06-08: set_qty is the primary action for the count-workflow
      // UI (task #129). The client sends the new absolute qty in
      // quantity_new; the server computes delta = new - current_qty and
      // applies it as a correction. Validated separately from
      // correction so the client can stay simple and not have to know
      // the current qty before submitting.
      const quantityNew = Number(req.body?.quantity_new);
      const notes = typeof req.body?.notes === "string" ? req.body.notes : null;
      if (typeof rawBarcode !== "string" || rawBarcode.trim() === "") {
        return res.status(400).json({ error: "barcode_value is required and must be a non-empty string." });
      }
      const ALLOWED_ACTIONS = ["decrement", "increment", "lookup_only", "correction", "set_qty"] as const;
      if (!(ALLOWED_ACTIONS as readonly string[]).includes(requestedAction)) {
        return res.status(400).json({ error: `action must be one of ${ALLOWED_ACTIONS.join(", ")}` });
      }
      if (requestedAction === "correction" && !Number.isFinite(correctionDelta)) {
        return res.status(400).json({ error: "action=correction requires a finite quantity_delta number." });
      }
      if (requestedAction === "set_qty" && (!Number.isFinite(quantityNew) || quantityNew < 0)) {
        return res.status(400).json({ error: "action=set_qty requires a finite non-negative quantity_new number." });
      }
      const barcode = rawBarcode.trim();
      const ipRaw = (req?.ip || req?.headers?.["x-forwarded-for"] || "").toString();
      const ip = ipRaw ? ipRaw.split(",")[0].trim() : null;
      const ua = typeof req?.headers?.["user-agent"] === "string" ? (req.headers["user-agent"] as string).slice(0, 500) : null;
      const userId = req.userId;
      // Resolve the lab's owner so scan_events still carries an account_id
      // for the legacy owner-rollup queries elsewhere in the codebase.
      const labRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as { owner_user_id: number } | undefined;
      const accountId = labRow?.owner_user_id ?? userId;
      try {
        const txn = sqlite.transaction(() => {
          const row = sqlite.prepare(
            "SELECT * FROM inventory_items WHERE lab_id = ? AND barcode_value IS NOT NULL AND barcode_value = ?"
          ).get(labId, barcode) as any;
          if (!row) {
            const ins = sqlite.prepare(`
              INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
              VALUES (?, NULL, ?, 'unknown_barcode', NULL, NULL, NULL, ?, ?, ?, ?)
            `).run(accountId, userId, barcode, notes, ip, ua);
            return { hit: false as const, scanEventId: Number(ins.lastInsertRowid) };
          }
          const qtyBefore = Number(row.quantity_on_hand ?? 0);
          let delta = 0;
          if (requestedAction === "decrement") delta = -1;
          else if (requestedAction === "increment") delta = 1;
          else if (requestedAction === "lookup_only") delta = 0;
          else if (requestedAction === "correction") delta = Math.trunc(correctionDelta);
          else if (requestedAction === "set_qty") delta = Math.trunc(quantityNew) - qtyBefore;
          const qtyAfter = Math.max(0, qtyBefore + delta);
          const actualDelta = qtyAfter - qtyBefore;
          if (requestedAction !== "lookup_only" && actualDelta !== 0) {
            const now = new Date().toISOString();
            sqlite.prepare(
              "UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ? AND lab_id = ?"
            ).run(qtyAfter, now, row.id, labId);
          }
          const ins = sqlite.prepare(`
            INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(accountId, row.id, userId, requestedAction, actualDelta, qtyBefore, qtyAfter, barcode, notes, ip, ua);
          return { hit: true as const, scanEventId: Number(ins.lastInsertRowid), itemId: row.id, qtyBefore, qtyAfter };
        });
        const result = txn();
        if (!result.hit) {
          return res.status(404).json({ ok: false, action: "unknown_barcode", scan_event_id: result.scanEventId, barcode_value: barcode });
        }
        const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(result.itemId) as any;
        const decorated = decorateInventoryItem(fresh);
        return res.json({
          ok: true,
          action: requestedAction,
          item: decorated,
          scan_event_id: result.scanEventId,
          quantity_before: result.qtyBefore,
          quantity_after: result.qtyAfter,
          needs_reorder: !!decorated.needs_reorder,
          reorder_point: decorated.reorder_point ?? null,
          order_to_qty: decorated.order_to_qty ?? null,
        });
      } catch (err: any) {
        console.error("Lab-scoped scan endpoint error:", err.message);
        return res.status(500).json({ error: "Scan failed", detail: err.message });
      }
    });
  }

  // GET /api/inventory/valuation-trend - 6-month inventory valuation history
  // across every location in the requester's network (owned labs + active
  // memberships). Returns, per location, the monthly average value on hand and
  // the dollars written off to expiry that month. Powers the Valuation Trends
  // view. Read-only; no lab scope param because it is a cross-location rollup.
  app.get("/api/inventory/valuation-trend", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const userId = req.userId;
    const ownerId = req.ownerUserId ?? req.userId;
    // Labs the user owns plus labs they are an active member of.
    const owned = sqlite.prepare("SELECT id, lab_name FROM labs WHERE owner_user_id = ?").all(ownerId) as any[];
    const member = sqlite.prepare(
      "SELECT l.id, l.lab_name FROM labs l JOIN lab_members m ON m.lab_id = l.id WHERE m.user_id = ? AND m.status = 'active'"
    ).all(userId) as any[];
    const labMap = new Map<number, string>();
    for (const l of [...owned, ...member]) labMap.set(l.id, l.lab_name || `Location ${l.id}`);
    const labIds = Array.from(labMap.keys());
    if (labIds.length === 0) return res.json({ months: [], locations: [] });

    const placeholders = labIds.map(() => "?").join(",");
    const rows = sqlite.prepare(
      `SELECT lab_id, year_month, avg_value_on_hand, waste_value, waste_note
       FROM inventory_monthly_snapshots WHERE lab_id IN (${placeholders}) ORDER BY year_month ASC`
    ).all(...labIds) as any[];

    // Distinct months in order.
    const months = Array.from(new Set(rows.map((r) => r.year_month))).sort();
    const byLab = new Map<number, any[]>();
    for (const r of rows) {
      if (!byLab.has(r.lab_id)) byLab.set(r.lab_id, []);
      byLab.get(r.lab_id)!.push(r);
    }
    const locations = Array.from(byLab.entries()).map(([labId, lrows]) => {
      const monthly = months.map((m) => {
        const row = lrows.find((x) => x.year_month === m);
        return {
          month: m,
          avg_value_on_hand: row ? Number(row.avg_value_on_hand) || 0 : 0,
          waste_value: row ? Number(row.waste_value) || 0 : 0,
          waste_note: row?.waste_note || null,
        };
      });
      return { lab_id: labId, lab_name: labMap.get(labId), monthly };
    });
    res.json({ months, locations });
  });

  // POST /api/inventory - create new inventory item
  app.post("/api/inventory", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, count_unit, units_per_count_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, unit_cost, on_order_qty, on_order_expected_date, on_order_placed_date } = req.body;
    if (!item_name) return res.status(400).json({ error: "item_name is required" });
    // 2026-06-09: count_unit defaults to order_unit (most labs count in
    // the same unit they order in); pack_size defaults to 1 (count by
    // each). Both validated to keep storage usage-unit math intact.
    const resolvedCountUnit = (typeof count_unit === "string" && count_unit.trim()) || order_unit || 'each';
    const resolvedPackSize = Number.isFinite(units_per_count_unit) && Number(units_per_count_unit) > 0
      ? Math.trunc(Number(units_per_count_unit))
      : 1;
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(`
        INSERT INTO inventory_items (account_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, count_unit, units_per_count_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, unit_cost, on_order_qty, on_order_expected_date, on_order_placed_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(accountId, item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, resolvedCountUnit, resolvedPackSize, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, Number(unit_cost ?? 0), Number(on_order_qty ?? 0), on_order_expected_date ?? null, on_order_placed_date ?? null, now, now);
      // write-path Shape A (resolver unification PR B): tag via the SAME shared
      // resolveLegacyLabId the /api/inventory list read uses, so a new item
      // always appears in the lab the user is working in.
      try {
        sqlite.prepare("UPDATE inventory_items SET lab_id = ? WHERE id = ?").run(resolveLegacyLabId(sqlite, req) ?? null, result.lastInsertRowid);
      } catch {}
      // Persist canonical barcode_value (VLS-<padded id>) at creation so
      // the label code never changes across runtime/algorithm shifts. Gated
      // by the WHERE clause so a user-supplied value (added via a future
      // edit endpoint) is preserved.
      try {
        sqlite.prepare("UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE id = ? AND (barcode_value IS NULL OR barcode_value = '')").run(result.lastInsertRowid);
      } catch {}
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // resolveInventoryItemForMutation, fix for "Item not found" 2026-06-09.
  //
  // Items created by the seed script (or by a different user in the same lab)
  // have account_id != the current requester's user_id. The list endpoint
  // scopes by lab_id so the items appear, but PUT/DELETE under the legacy
  // account_id WHERE clause 404. This helper resolves an item by id alone,
  // then verifies the requester has lab access (owner / active lab_member).
  // Foreign-lab items return 403 to avoid leaking existence.
  function resolveInventoryItemForMutation(id: number | string, req: any): { item: any; status: number } {
    const item = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as any;
    if (!item) return { item: null, status: 404 };
    const userId = req.userId;
    const ownerId = req.ownerUserId ?? req.userId;
    // Legacy account_id direct match (single-tenant case)
    if (item.account_id === ownerId) return { item, status: 200 };
    // Multi-lab: any active member of the item's lab can mutate
    if (item.lab_id) {
      const membership = sqlite.prepare(
        "SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
      ).get(item.lab_id, userId);
      if (membership) return { item, status: 200 };
    }
    return { item: null, status: 403 };
  }

  // PUT /api/inventory/:id - update an inventory item
  app.put("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const { item: existing, status: resolveStatus } = resolveInventoryItemForMutation(id, req);
    if (!existing) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }
    const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, count_unit, units_per_count_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, barcode_value, unit_cost, on_order_qty, on_order_expected_date, on_order_placed_date, intacct_item_id } = req.body;
    // Sage Intacct item id: preserve on omit (partial edit shouldn't wipe it);
    // blank string clears it (back to account-based). Verbatim, no casing change.
    const resolvedIntacctItemId = (intacct_item_id === undefined)
      ? ((existing as any).intacct_item_id ?? null)
      : (intacct_item_id === null || (typeof intacct_item_id === "string" && intacct_item_id.trim() === "") ? null : String(intacct_item_id));
    // unit_cost: when omitted/blank on a partial update, preserve the existing
    // price rather than zeroing it (zeroing would silently break valuation, ABC,
    // turns, and order-cost math for every edited item).
    const resolvedUnitCost = (unit_cost === undefined || unit_cost === null || unit_cost === "")
      ? ((existing as any).unit_cost ?? 0)
      : (Number(unit_cost) || 0);
    // on_order_qty / expected_date: preserve existing on omit so a partial edit
    // (e.g. just renaming the item) does not wipe what's already on a PO.
    const resolvedOnOrderQty = (on_order_qty === undefined || on_order_qty === null || on_order_qty === "")
      ? ((existing as any).on_order_qty ?? 0)
      : (Number(on_order_qty) || 0);
    const resolvedOnOrderExpected = (on_order_expected_date === undefined)
      ? ((existing as any).on_order_expected_date ?? null)
      : (on_order_expected_date === null || (typeof on_order_expected_date === "string" && on_order_expected_date.trim() === "") ? null : on_order_expected_date);
    // Order-placed date: same omit-preserve / blank-clears semantics as expected.
    const resolvedOnOrderPlaced = (on_order_placed_date === undefined)
      ? ((existing as any).on_order_placed_date ?? null)
      : (on_order_placed_date === null || (typeof on_order_placed_date === "string" && on_order_placed_date.trim() === "") ? null : on_order_placed_date);
    // 2026-06-09: count_unit defaults to existing value or order_unit;
    // pack_size defaults to existing or 1.
    const resolvedCountUnit = (typeof count_unit === "string" && count_unit.trim())
      || (existing as any).count_unit
      || order_unit
      || 'each';
    const resolvedPackSize = Number.isFinite(units_per_count_unit) && Number(units_per_count_unit) > 0
      ? Math.trunc(Number(units_per_count_unit))
      : ((existing as any).units_per_count_unit > 0 ? (existing as any).units_per_count_unit : 1);
    const now = new Date().toISOString();
    // parking-lot #29 Phase 2: normalize the incoming barcode_value.
    // "" or whitespace -> NULL (clears the binding). Anything else is
    // trimmed and account-scope-uniqueness-checked before write.
    let normalizedBarcode: string | null;
    if (barcode_value === undefined) {
      normalizedBarcode = (existing as any).barcode_value ?? null;
    } else if (barcode_value === null || (typeof barcode_value === "string" && barcode_value.trim() === "")) {
      normalizedBarcode = null;
    } else {
      normalizedBarcode = String(barcode_value).trim();
      // Barcode uniqueness scoped to the item's lab (not account_id) so a
      // user editing a seeded item doesn't false-collide on a different
      // account's barcode in a different lab.
      const collision = sqlite.prepare(
        "SELECT id FROM inventory_items WHERE lab_id = ? AND barcode_value = ? AND id <> ?"
      ).get((existing as any).lab_id, normalizedBarcode, id) as any;
      if (collision) {
        return res.status(409).json({ error: `Barcode "${normalizedBarcode}" is already bound to a different item in this lab.` });
      }
    }
    try {
      // UPDATE WHERE id = ? alone: the access check happened in
      // resolveInventoryItemForMutation above, so the legacy `AND account_id = ?`
      // clause is no longer required and would mis-target seeded items.
      sqlite.prepare(`
        UPDATE inventory_items SET item_name = ?, catalog_number = ?, lot_number = ?, department = ?, category = ?, quantity_on_hand = ?, unit = ?, expiration_date = ?, vendor = ?, storage_location = ?, notes = ?, status = ?, burn_rate = ?, order_unit = ?, usage_unit = ?, units_per_order_unit = ?, count_unit = ?, units_per_count_unit = ?, lead_time_days = ?, safety_stock_days = ?, desired_days_of_stock = ?, standing_order = ?, standing_order_review_date = ?, barcode_value = ?, unit_cost = ?, on_order_qty = ?, on_order_expected_date = ?, on_order_placed_date = ?, intacct_item_id = ?, updated_at = ?
        WHERE id = ?
      `).run(item_name ?? (existing as any).item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, resolvedCountUnit, resolvedPackSize, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, normalizedBarcode, resolvedUnitCost, resolvedOnOrderQty, resolvedOnOrderExpected, resolvedOnOrderPlaced, resolvedIntacctItemId, now, id);
      const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/inventory/items/by-barcode?barcode=XYZ
  // Director-side counterpart of the kiosk + staff portal lookup endpoints
  // (task #129 ext, 2026-06-09). Lab-scoped via the user's active lab so
  // VeritaStockPage's new "Scan to count" workflow returns the right item.
  app.get("/api/inventory/items/by-barcode", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const barcode = String(req.query.barcode || "").trim();
    if (!barcode) return res.status(400).json({ error: "barcode required" });
    const labId = resolveLegacyLabId(sqlite, req);
    if (!labId) return res.status(404).json({ error: "unknown_barcode", barcode });
    const row = sqlite.prepare(
      "SELECT * FROM inventory_items WHERE lab_id = ? AND barcode_value = ? LIMIT 1"
    ).get(labId, barcode) as any;
    if (!row) return res.status(404).json({ error: "unknown_barcode", barcode });
    res.json({ item: decorateInventoryItem(row) });
  });

  // POST /api/inventory/:id/adjust
  //   body: { new_count?, new_quantity?, reason? }
  // Director-side counterpart of the kiosk + staff portal adjust endpoints.
  // Same count_unit -> usage_unit conversion. Access via Shape A guard.
  app.post("/api/inventory/:id/adjust", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const { id } = req.params;
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid item id" });
    const { new_count, new_quantity, reason } = req.body || {};
    const hasCount = typeof new_count === "number" && Number.isFinite(new_count);
    const hasQty = typeof new_quantity === "number" && Number.isFinite(new_quantity);
    if (!hasCount && !hasQty) {
      return res.status(400).json({ error: "new_count (in count_unit) or new_quantity (in usage_unit) required" });
    }

    const { item: existing, status: resolveStatus } = resolveInventoryItemForMutation(itemId, req);
    if (!existing) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }

    const packSize = Number.isFinite((existing as any).units_per_count_unit) && (existing as any).units_per_count_unit > 0
      ? (existing as any).units_per_count_unit
      : 1;
    let usageQty: number;
    let countEntered: number | null = null;
    if (hasCount) {
      if (!Number.isInteger(new_count) || new_count < 0) return res.status(400).json({ error: "new_count must be a non-negative integer" });
      countEntered = new_count;
      usageQty = new_count * packSize;
    } else {
      if (!Number.isInteger(new_quantity) || new_quantity < 0) return res.status(400).json({ error: "new_quantity must be a non-negative integer" });
      usageQty = new_quantity;
    }

    const beforeQty = (existing as any).quantity_on_hand;
    const nowIso = new Date().toISOString();
    sqlite.prepare(
      "UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?"
    ).run(usageQty, nowIso, itemId);

    try {
      logAudit({
        userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritastock", action: "adjust",
        entityType: "inventory_item", entityId: itemId,
        entityLabel: `${(existing as any).item_name}: count adjusted ${beforeQty} to ${usageQty}${reason ? ` (${reason})` : ""}`,
        before: { quantity_on_hand: beforeQty },
        after: { quantity_on_hand: usageQty, reason: reason || null },
        ipAddress: req.ip,
      });
    } catch { /* audit is best-effort */ }

    // Consumption ledger: a DOWNWARD cycle-count correction is a depletion. The
    // helper skips qty <= 0, so an upward / no-change adjustment records nothing.
    // Side-effect only, on_hand was already set above; the ledger never touches it.
    logConsumption({
      itemId: Number(itemId), labId: (existing as any).lab_id, accountId: req.ownerUserId ?? req.userId,
      qty: beforeQty - usageQty, unitCostAtEvent: (existing as any).unit_cost ?? null,
      reason: "adjust_down", sourceEventRef: `adjust:${reason || "cycle_count"}`, occurredAt: nowIso,
    });

    const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId);
    res.json({
      item: decorateInventoryItem(fresh),
      adjustment: {
        before_qty: beforeQty,
        after_qty: usageQty,
        delta: usageQty - beforeQty,
        count_entered: countEntered,
        count_unit: (existing as any).count_unit || "each",
        units_per_count_unit: packSize,
        reason: reason || null,
        at: nowIso,
      },
    });
  });

  // POST /api/inventory/:id/receive
  //   body: { received_qty?, reason? }
  // Receive inbound stock against an open PO: move received_qty (defaults to the
  // full on_order_qty) from on-order into quantity_on_hand, decrement on_order_qty
  // (floored at 0), and clear the expected-arrival date once nothing remains on
  // order. This is a DEDICATED endpoint on purpose: PUT /api/inventory/:id is a
  // full-replace that would zero on-hand/burn on a partial body, so receiving
  // must never go through it. Access via the same Shape A guard as /adjust.
  app.post("/api/inventory/:id/receive", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const { id } = req.params;
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid item id" });
    const { item: existing, status: resolveStatus } = resolveInventoryItemForMutation(itemId, req);
    if (!existing) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }
    const onOrder = (existing as any).on_order_qty || 0;
    if (onOrder <= 0) return res.status(400).json({ error: "Nothing on order to receive" });
    const { received_qty, note, document_url, document_label } = req.body || {};
    // Optional free-text note: partial shipment, damaged, received out of temp, etc.
    const noteStr = (typeof note === "string" && note.trim()) ? note.trim().slice(0, 500) : null;
    // Optional document attachment: a URL pointer to the PO, packing slip, or
    // invoice for this delivery. URL pointer only (no binary upload), mirroring
    // the VeritaScan evidence model, so VeritaStock never stores file content.
    let docUrl: string | null = null;
    if (typeof document_url === "string" && document_url.trim()) {
      const u = document_url.trim().slice(0, 1000);
      if (/^https?:\/\//i.test(u)) docUrl = u;
    }
    const docLabel = (typeof document_label === "string" && document_label.trim())
      ? document_label.trim().slice(0, 120)
      : (docUrl ? "Attached document" : null);
    // Lot + expiry of the arriving stock (multi-lot support). When provided and
    // different from the item's current lot/expiry, the received quantity lands
    // in a separate lot-row instead of being lumped under the old expiry.
    const recvLot = (typeof (req.body || {}).received_lot_number === "string" && req.body.received_lot_number.trim())
      ? req.body.received_lot_number.trim().slice(0, 80) : null;
    const recvExp = (typeof (req.body || {}).received_expiration_date === "string" && req.body.received_expiration_date.trim())
      ? req.body.received_expiration_date.trim().slice(0, 10) : null;
    // Default to receiving the full open PO; clamp to (0, onOrder].
    let recv = (received_qty === undefined || received_qty === null || received_qty === "")
      ? onOrder
      : Number(received_qty);
    if (!Number.isFinite(recv) || recv <= 0) return res.status(400).json({ error: "received_qty must be a positive number" });
    if (recv > onOrder) recv = onOrder;
    const newOnOrder = Math.max(0, onOrder - recv);
    const placedDate = (existing as any).on_order_placed_date ?? null;
    const expectedDate = (existing as any).on_order_expected_date ?? null;
    // Once the PO is fully received, clear the open-PO dates so the next order
    // starts a fresh placed/expected cycle. Partial receipts keep them.
    const newExpected = newOnOrder > 0 ? expectedDate : null;
    const newPlaced = newOnOrder > 0 ? placedDate : null;
    const nowIso = new Date().toISOString();
    const receivedDate = nowIso.slice(0, 10);
    const programmedLead = Number.isFinite((existing as any).lead_time_days) ? (existing as any).lead_time_days : null;
    // actual lead time = received - placed (days). Null when no placed date was
    // on file (legacy PO entered before placed-date tracking).
    let actualLead: number | null = null;
    if (placedDate) {
      const p = Date.parse(placedDate);
      const r = Date.parse(receivedDate);
      if (!Number.isNaN(p) && !Number.isNaN(r)) actualLead = Math.round((r - p) / 86400000);
    }

    // Multi-lot routing: the PO (on_order) is always fulfilled on the existing
    // row, but the received on-hand lands in the row for the RECEIVED lot/expiry.
    // - No lot/expiry given, or it matches the existing row, or the existing row
    //   is empty + unlotted -> lump onto the existing row (adopt lot/expiry if it
    //   was blank). Backward compatible with receives that send no lot info.
    // - A different lot/expiry -> land in an existing sibling lot-row for that
    //   exact lot+expiry, or create a new lot-row carrying the product's settings.
    const e = existing as any;
    const existingOnHand = e.quantity_on_hand || 0;
    // Nested lots (Phase 2): the received stock always lands on THIS item (no
    // sibling rows). quantity_on_hand grows by recv and stays authoritative; the
    // arriving lot is credited as a child lot (a new row only if its lot/expiry is
    // new). The lot defaults to the item's current lot/expiry when none is given.
    // reconcileLots then syncs the item's headline expiry to the earliest lot.
    const lotForReceipt = recvLot ?? (e.lot_number ?? null);
    const expForReceipt = recvExp ?? (e.expiration_date ?? null);
    const targetId = itemId;
    const targetBefore = existingOnHand;
    const targetAfter = existingOnHand + recv;
    let newLot = false;
    const tx = sqlite.transaction(() => {
      sqlite.prepare(
        "UPDATE inventory_items SET quantity_on_hand = ?, on_order_qty = ?, on_order_expected_date = ?, on_order_placed_date = ?, updated_at = ? WHERE id = ?"
      ).run(targetAfter, newOnOrder, newExpected, newPlaced, nowIso, itemId);
      const had = sqlite.prepare(
        "SELECT 1 FROM inventory_lots WHERE item_id = ? AND COALESCE(lot_number,'') = ? AND COALESCE(expiration_date,'') = ? LIMIT 1"
      ).get(itemId, lotForReceipt ?? "", expForReceipt ?? "");
      newLot = !had;
      addLot(sqlite, { id: itemId, lab_id: e.lab_id, account_id: e.account_id }, lotForReceipt, expForReceipt, recv, nowIso);
      reconcileLots(sqlite, itemId, nowIso);
    });
    tx();

    // Log a permanent receipt for lead-time verification, recording the lot +
    // expiry that arrived. Never let a logging failure roll back the receive.
    try {
      sqlite.prepare(
        `INSERT INTO inventory_receipts (lab_id, item_id, account_id, item_name, vendor, qty_received, usage_unit, order_placed_date, expected_date, received_date, programmed_lead_time_days, actual_lead_time_days, received_by, document_url, document_label, received_lot_number, received_expiration_date, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        e.lab_id ?? null,
        itemId,
        e.account_id ?? null,
        e.item_name ?? null,
        e.vendor ?? null,
        recv,
        e.usage_unit ?? null,
        placedDate,
        expectedDate,
        receivedDate,
        programmedLead,
        actualLead,
        req.userId ?? null,
        docUrl,
        docLabel,
        recvLot,
        recvExp,
        noteStr,
        nowIso,
      );
    } catch (err) { /* receipt logging is best-effort; receive already succeeded */ }
    try {
      const lotStr = recvLot || recvExp ? ` [lot ${recvLot || "n/a"}${recvExp ? ` exp ${recvExp}` : ""}${newLot ? ", new lot" : ""}]` : "";
      logAudit({
        userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritastock", action: "receive",
        entityType: "inventory_item", entityId: targetId,
        entityLabel: `${e.item_name}: received ${recv} ${e.usage_unit || "unit"} (on hand ${targetBefore} to ${targetAfter})${lotStr}${noteStr ? ` - ${noteStr}` : ""}`,
        before: { quantity_on_hand: targetBefore, on_order_qty: onOrder },
        after: { quantity_on_hand: targetAfter, on_order_qty: newOnOrder },
        ipAddress: req.ip,
      });
    } catch { /* audit is best-effort */ }
    const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(targetId);
    res.json({
      item: decorateInventoryItem(fresh),
      split_lot: newLot,
      target_item_id: targetId,
      receipt: {
        received_qty: recv,
        before_on_hand: targetBefore,
        after_on_hand: targetAfter,
        before_on_order: onOrder,
        after_on_order: newOnOrder,
        order_placed_date: placedDate,
        expected_date: expectedDate,
        received_date: receivedDate,
        programmed_lead_time_days: programmedLead,
        actual_lead_time_days: actualLead,
        received_lot_number: recvLot,
        received_expiration_date: recvExp,
        note: noteStr,
        at: nowIso,
      },
    });
  });

  // POST /api/inventory/:id/lead-time
  //   body: { lead_time_days }
  // Apply an observed lead time to the item's PROGRAMMED lead time (which feeds
  // the reorder point). This is the one-click "update to actual" behind the
  // lead-time drift flag: the materials manager owns the parameter, so it is
  // never auto-changed, only applied on their action. Dedicated endpoint so a
  // partial PUT cannot full-replace and zero other fields.
  app.post("/api/inventory/:id/lead-time", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const itemId = Number(req.params.id);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid item id" });
    const days = Number(req.body?.lead_time_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) return res.status(400).json({ error: "lead_time_days must be an integer between 1 and 365" });
    const { item: existing, status: resolveStatus } = resolveInventoryItemForMutation(itemId, req);
    if (!existing) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }
    const nowIso = new Date().toISOString();
    sqlite.prepare("UPDATE inventory_items SET lead_time_days = ?, updated_at = ? WHERE id = ?").run(days, nowIso, itemId);
    const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId);
    res.json({ item: decorateInventoryItem(fresh) });
  });

  // POST /api/inventory/:id/write-off
  //   body: { qty, reason_code, note? }   reason_code: expired|damaged|recalled|lost
  // Capture wastage as a byproduct of the disposal a tech already does, never a
  // separate form. Decrements on-hand, prices the loss (qty x unit_cost), logs
  // an itemized waste event (who/when/why), and rolls the dollar value into the
  // current month's snapshot so the trend reflects it. Dedicated endpoint (not a
  // partial PUT, which would full-replace and zero on-hand).
  const WASTE_REASONS = new Set(["expired", "damaged", "recalled", "lost"]);
  app.post("/api/inventory/:id/write-off", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const { id } = req.params;
    const itemId = Number(id);
    if (!Number.isFinite(itemId) || itemId <= 0) return res.status(400).json({ error: "Invalid item id" });
    const { item: existing, status: resolveStatus } = resolveInventoryItemForMutation(itemId, req);
    if (!existing) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }
    const reasonCode = String(req.body?.reason_code || "expired").toLowerCase();
    if (!WASTE_REASONS.has(reasonCode)) return res.status(400).json({ error: "reason_code must be one of expired, damaged, recalled, lost" });
    const onHand = (existing as any).quantity_on_hand || 0;
    let qty = Number(req.body?.qty);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "qty must be a positive number" });
    if (qty > onHand) qty = onHand; // cannot write off more than is on hand
    if (qty <= 0) return res.status(400).json({ error: "Nothing on hand to write off" });
    const unitCost = (existing as any).unit_cost || 0;
    const wasteValue = qty * unitCost;
    const newOnHand = onHand - qty;
    const labId = (existing as any).lab_id;
    const nowIso = new Date().toISOString();
    const eventDate = nowIso.slice(0, 10);
    const yearMonth = nowIso.slice(0, 7);

    const tx = sqlite.transaction(() => {
      sqlite.prepare("UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?").run(newOnHand, nowIso, itemId);
      sqlite.prepare(`
        INSERT INTO inventory_waste_events
          (lab_id, item_id, item_name, qty, unit_cost, waste_value, reason_code, note, event_date, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(labId, itemId, (existing as any).item_name, qty, unitCost, wasteValue, reasonCode, req.body?.note || null, eventDate, req.userId, nowIso);
      // Roll into the current month's snapshot. Increment waste_value and refresh
      // closing_value to the lab's current inventory value; preserve a seeded
      // avg_value_on_hand if the month row already exists.
      const curVal = (sqlite.prepare(
        "SELECT COALESCE(SUM(quantity_on_hand * unit_cost), 0) AS v FROM inventory_items WHERE lab_id = ?"
      ).get(labId) as any)?.v || 0;
      sqlite.prepare(`
        INSERT INTO inventory_monthly_snapshots
          (lab_id, year_month, avg_value_on_hand, opening_value, closing_value, waste_value, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?)
        ON CONFLICT(lab_id, year_month) DO UPDATE SET
          waste_value = waste_value + excluded.waste_value,
          closing_value = excluded.closing_value,
          updated_at = excluded.updated_at
      `).run(labId, yearMonth, curVal, curVal, wasteValue, nowIso, nowIso);
    });
    tx();

    try {
      logAudit({
        userId: req.userId, ownerUserId: req.ownerUserId ?? req.userId, module: "veritastock", action: "write_off",
        entityType: "inventory_item", entityId: itemId,
        entityLabel: `${(existing as any).item_name}: wrote off ${qty} ${(existing as any).usage_unit || "unit"} (${reasonCode}), $${wasteValue.toFixed(2)} loss`,
        before: { quantity_on_hand: onHand },
        after: { quantity_on_hand: newOnHand, reason_code: reasonCode, waste_value: wasteValue },
        ipAddress: req.ip,
      });
    } catch { /* audit is best-effort */ }

    // Consumption ledger: a write-off is a depletion. Side-effect only, on_hand
    // was already moved in the transaction above; the ledger never touches it.
    logConsumption({
      itemId: Number(itemId), labId, accountId: req.ownerUserId ?? req.userId,
      qty, unitCostAtEvent: unitCost, reason: "write_off",
      sourceEventRef: `write_off:${reasonCode}`, occurredAt: nowIso,
    });

    const fresh = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId);
    res.json({
      item: decorateInventoryItem(fresh),
      write_off: {
        qty, unit_cost: unitCost, waste_value: wasteValue,
        reason_code: reasonCode, event_date: eventDate,
        before_on_hand: onHand, after_on_hand: newOnHand,
      },
    });
  });

  // DELETE /api/inventory/:id - delete an inventory item
  app.delete("/api/inventory/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const { id } = req.params;
    const { item: row, status: resolveStatus } = resolveInventoryItemForMutation(id, req);
    if (!row) {
      if (resolveStatus === 403) return res.status(403).json({ error: "You don't have access to this item's lab" });
      return res.status(404).json({ error: "Item not found" });
    }
    sqlite.prepare("DELETE FROM inventory_items WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/staffing-studies/:id/export - Excel export of analysis
  app.get("/api/staffing-studies/:id/export", authMiddleware, async (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const study = sqlite.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!study) return res.status(404).json({ error: "Study not found" });
    const data = sqlite.prepare("SELECT * FROM staffing_hourly_data WHERE study_id = ?").all(id) as any[];

    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      wb.creator = "Perplexity Computer";
      wb.created = new Date();

      // ===== Lab identity (Excel Export Standard) =====
      // Audit #9 (2026-07-12): resolve identity from the SELECTED lab (labs table),
      // like the Leverage PDF, so a multi-lab export prints the correct lab header
      // and never falls back to the logged-in person's name.
      const idLabId = resolveOpsLabId(req);
      const idLabRow = idLabId != null
        ? sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(idLabId) as any
        : null;
      const ownerRow = sqlite.prepare(
        "SELECT clia_lab_name, clia_number FROM users WHERE id = ?"
      ).get(accountId) as any;
      const labName = idLabRow?.lab_name || ownerRow?.clia_lab_name || "Laboratory";
      const cliaNumber = idLabRow?.clia_number || ownerRow?.clia_number || "Not on file";
      const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

      // ===== About sheet (sheet 1) =====
      const aboutBorder: any = {
        top: { style: "thin", color: { argb: "FFD0D0D0" } },
        bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
        left: { style: "thin", color: { argb: "FFD0D0D0" } },
        right: { style: "thin", color: { argb: "FFD0D0D0" } },
      };
      const about = wb.addWorksheet("About");
      about.getColumn(1).width = 110;
      const aboutTitle = about.getCell("A1");
      aboutTitle.value = `VeritaBench Staffing Analyzer, ${study.name}`;
      aboutTitle.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      aboutTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      aboutTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      about.getRow(1).height = 30;
      const aboutIdentity = about.getCell("A2");
      aboutIdentity.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
      aboutIdentity.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
      aboutIdentity.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
      aboutIdentity.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      aboutIdentity.border = aboutBorder;
      about.getRow(2).height = 24;
      let aboutRow = 3;
      const aboutSection = (text: string) => {
        const c = about.getCell(`A${aboutRow}`);
        c.value = text;
        c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
        c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
        c.border = aboutBorder;
        about.getRow(aboutRow).height = 22; aboutRow += 1;
      };
      const aboutBody = (text: string) => {
        const c = about.getCell(`A${aboutRow}`);
        c.value = text;
        c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
        c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
        c.border = aboutBorder;
        const estLines = Math.max(1, Math.floor(text.length / 100) + 1);
        about.getRow(aboutRow).height = Math.max(20, estLines * 16); aboutRow += 1;
      };
      const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };
      aboutSection("About this product");
      aboutBody("This workbook is the analysis output of a VeritaBench Staffing Analyzer study. The lab recorded specimen-receipt and result-verification volumes hour-by-hour and day-by-day; the Averages tab shows the mean specimens received and results verified for each of the 168 hour-of-week slots (24 hours \u00d7 7 days), averaged across every observation week the study contains. It is a workload-shape report intended to inform shift design, bench coverage, and break scheduling, not an FTE entitlement calculation, not a CAP workload-unit study, and not a personnel evaluation tool.");
      aboutBlank();
      aboutSection("How to use this workbook");
      aboutBody("The Averages tab is laid out with 24 rows (one per hour slot, midnight at the top) and 14 day columns: the first 7 are average specimens Received per hour, the second 7 are average results Verified per hour. Read across a row to see how a single hour-of-day compares Monday-through-Sunday; read down a column to see how a single weekday's volume curve looks. Pair the Received and Verified columns to identify lag (high receipt volume followed by delayed verification) or pile-up risk. The freeze pane keeps the Hour Slot column visible while you scroll across the 14 day columns.");
      aboutBlank();
      aboutSection("Disclaimer");
      aboutBody("This workbook is an internal staffing-shape analysis, not an audit-grade staffing study, not a CAP/CLIA-required workload assessment, and not a substitute for a formal time-and-motion or productivity engineering study. The averages reflect only the hours and days the lab entered into VeritaBench for this study; gaps, holiday weeks, instrument outages, and short-staffed weeks are baked into the averages and are not corrected for. Specimen-receipt and result-verification counts are not equivalent to actual hands-on work time, they are volume proxies. This workbook is not a personnel evaluation tool and must not be used to discipline, terminate, or compensate individual employees, nor to justify reductions in force. The lab director and senior leadership are responsible for shift design, FTE allocation, and any operational action taken on the basis of these numbers. VeritaAssure does not certify staffing levels, does not advise on labor or scheduling law, and does not represent these figures to any accrediting or regulatory body.");
      aboutBlank();
      aboutSection("Lab identity");
      aboutBody(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
      aboutBlank();
      aboutSection("Coverage gaps");
      aboutBody("If your laboratory needs additional metrics in this analysis, for example, send-out volumes, STAT vs routine separation, instrument-level breakouts, or 15-minute granularity, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
      about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Staffing Analyzer&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
      await about.protect(exportPwd, {
        selectLockedCells: false, selectUnlockedCells: false,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: false, pivotTables: false,
      });

      const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      const hourLabels: string[] = [];
      for (let h = 0; h < 24; h++) {
        const start = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
        const end = (h + 1) === 24 ? "12 AM" : (h + 1) < 12 ? `${h + 1} AM` : (h + 1) === 12 ? "12 PM" : `${h + 1 - 12} PM`;
        hourLabels.push(`${start}-${end}`);
      }

      // Averages sheet
      const wsAvg = wb.addWorksheet("Averages");
      const avgHeaders = ["Hour Slot", ...dayNames.map(d => `${d} Received`), ...dayNames.map(d => `${d} Verified`)];
      wsAvg.columns = avgHeaders.map((h, i) => ({ header: h, key: `col${i}`, width: i === 0 ? 16 : 14 }));

      // Compute averages
      for (let h = 0; h < 24; h++) {
        const rowData: (string | number)[] = [hourLabels[h]];
        for (const metricType of ["received", "verified"]) {
          for (let d = 0; d < 7; d++) {
            const vals = data.filter((r: any) => r.hour_slot === h && r.day_of_week === d && r.metric_type === metricType);
            const avg = vals.length > 0 ? vals.reduce((s: number, r: any) => s + (r.value || 0), 0) / vals.length : 0;
            rowData.push(Math.round(avg * 10) / 10);
          }
        }
        wsAvg.addRow(rowData);
      }

      // Audit #21 (2026-07-12): a real auto-filter on the Averages sheet (Sec 6);
      // 15 columns (Hour Slot + 7 Received + 7 Verified) x header + 24 hour rows.
      wsAvg.autoFilter = { from: "A1", to: "O25" };

      // Style headers
      const tealFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      const headerFont: any = { bold: true, color: { argb: "FFFFFFFF" }, name: "Calibri", size: 11 };
      for (const sheet of [wsAvg]) {
        const hRow = sheet.getRow(1);
        hRow.height = 20;
        hRow.eachCell((cell: any) => {
          cell.fill = tealFill;
          cell.font = headerFont;
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
        sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
      }

      // Data row styling
      for (let i = 2; i <= 25; i++) {
        const row = wsAvg.getRow(i);
        row.height = 20;
        const bgColor = i % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
        row.eachCell((cell: any) => {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
          cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
          cell.alignment = { vertical: "middle", wrapText: true };
          cell.border = { top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } }, left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } } };
        });
      }

      // Page-setup header/footer carry lab identity on every printed page.
      wsAvg.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaBench Staffing Analyzer, ${study.name}&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
      wsAvg.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

      await wsAvg.protect(exportPwd, {
        selectLockedCells: true, selectUnlockedCells: true,
        formatCells: false, formatColumns: false, formatRows: false,
        insertRows: false, insertColumns: false, insertHyperlinks: false,
        deleteRows: false, deleteColumns: false,
        sort: false, autoFilter: true, pivotTables: false,
      });

      // Workbook opens to the About sheet (sheet 1, activeTab 0).
      wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                    firstSheet: 0, activeTab: 0, visibility: "visible" }];

      applyLicenseToExcelJS(wb, bencheLicenseCtx(req));
      const buffer = await wb.xlsx.writeBuffer();
      res.set("Content-Disposition", `attachment; filename="Staffing-Analysis_${study.name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx"`);
      res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (err: any) {
      res.status(500).json({ error: "Export failed: " + err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PI DASHBOARD - Performance Improvement quality metrics
  // ═══════════════════════════════════════════════════════════════════════

  // GET /api/pi/departments - list departments (returns empty array if none exist)
  app.get("/api/pi/departments", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const rows = sqlite.prepare(
      "SELECT * FROM pi_departments WHERE account_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(accountId);
    res.json(rows);
  });

  // POST /api/pi/departments - create department
  app.post("/api/pi/departments", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { name, sort_order } = req.body;
    if (!name) return res.status(400).json({ error: "name is required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(
        "INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)"
      ).run(accountId, name, sort_order ?? 0, now);
      const row = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pi/departments/:id - update department
  app.put("/api/pi/departments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const { name, sort_order, active } = req.body;
    try {
      sqlite.prepare(
        "UPDATE pi_departments SET name = ?, sort_order = ?, active = ? WHERE id = ? AND account_id = ?"
      ).run(name ?? (existing as any).name, sort_order ?? (existing as any).sort_order, active ?? (existing as any).active, id, accountId);
      const row = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pi/departments/:id - delete department (cascade metrics + entries)
  app.delete("/api/pi/departments/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Department not found" });
    const metricIds = sqlite.prepare("SELECT id FROM pi_metrics WHERE department_id = ?").all(id) as any[];
    for (const m of metricIds) {
      sqlite.prepare("DELETE FROM pi_entries WHERE metric_id = ?").run(m.id);
    }
    sqlite.prepare("DELETE FROM pi_metrics WHERE department_id = ?").run(id);
    sqlite.prepare("DELETE FROM pi_departments WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/metrics - list metrics for a department
  app.get("/api/pi/metrics", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const departmentId = req.query.department_id;
    if (!departmentId) return res.status(400).json({ error: "department_id is required" });
    const rows = sqlite.prepare(
      "SELECT * FROM pi_metrics WHERE department_id = ? AND account_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(departmentId, accountId);
    res.json(rows);
  });

  // POST /api/pi/metrics - create metric
  app.post("/api/pi/metrics", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { department_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order,
            measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes } = req.body;
    if (!department_id || !name) return res.status(400).json({ error: "department_id and name are required" });
    const now = new Date().toISOString();
    try {
      const result = sqlite.prepare(
        "INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active, created_at, measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)"
      ).run(department_id, accountId, name, unit ?? "%", direction ?? "lower_is_better", benchmark_green ?? null, benchmark_yellow ?? null, benchmark_red ?? null, sort_order ?? 0, now,
            measurement_methodology ?? null, is_tat ? 1 : 0, tat_start_event ?? null, tat_end_event ?? null, tat_threshold_minutes ?? null);
      const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(Number(result.lastInsertRowid));
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /api/pi/metrics/:id - update metric (including benchmark thresholds)
  app.put("/api/pi/metrics/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!existing) return res.status(404).json({ error: "Metric not found" });
    const { name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active,
            measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes } = req.body;
    try {
      sqlite.prepare(
        "UPDATE pi_metrics SET name = ?, unit = ?, direction = ?, benchmark_green = ?, benchmark_yellow = ?, benchmark_red = ?, sort_order = ?, active = ?, measurement_methodology = ?, is_tat = ?, tat_start_event = ?, tat_end_event = ?, tat_threshold_minutes = ? WHERE id = ? AND account_id = ?"
      ).run(
        name ?? existing.name, unit ?? existing.unit, direction ?? existing.direction,
        benchmark_green !== undefined ? benchmark_green : existing.benchmark_green,
        benchmark_yellow !== undefined ? benchmark_yellow : existing.benchmark_yellow,
        benchmark_red !== undefined ? benchmark_red : existing.benchmark_red,
        sort_order ?? existing.sort_order, active ?? existing.active,
        measurement_methodology !== undefined ? measurement_methodology : existing.measurement_methodology,
        is_tat !== undefined ? (is_tat ? 1 : 0) : existing.is_tat,
        tat_start_event !== undefined ? tat_start_event : existing.tat_start_event,
        tat_end_event !== undefined ? tat_end_event : existing.tat_end_event,
        tat_threshold_minutes !== undefined ? tat_threshold_minutes : existing.tat_threshold_minutes,
        id, accountId
      );
      const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(id);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/pi/metrics/:id - delete metric (cascade entries)
  app.delete("/api/pi/metrics/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const existing = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!existing) return res.status(404).json({ error: "Metric not found" });
    sqlite.prepare("DELETE FROM pi_entries WHERE metric_id = ?").run(id);
    sqlite.prepare("DELETE FROM pi_metrics WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/entries - get all entries for a year/department
  app.get("/api/pi/entries", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { year, department_id } = req.query;
    if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
    const metricIds = sqlite.prepare("SELECT id FROM pi_metrics WHERE department_id = ? AND account_id = ?").all(department_id, accountId) as any[];
    if (metricIds.length === 0) return res.json([]);
    const ids = metricIds.map((m: any) => m.id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? AND account_id = ? ORDER BY month ASC`
    ).all(...ids, year, accountId);
    res.json(rows);
  });

  // POST /api/pi/entries - upsert entry (metric_id + year + month unique)
  app.post("/api/pi/entries", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { metric_id, year, month, value, volume, notes } = req.body;
    if (!metric_id || !year || !month) return res.status(400).json({ error: "metric_id, year, and month are required" });
    // Audit #1 (2026-07-12) SECURITY: validate the metric belongs to THIS account
    // before the upsert. Without it, a foreign metric_id combined with the global
    // UNIQUE(metric_id, year, month) let any suite user overwrite (and read back)
    // another account's PI entry. pi_metrics is account-scoped, so this is the
    // tenant boundary; the read-back is also account-filtered as defense in depth.
    const owns = sqlite.prepare("SELECT 1 FROM pi_metrics WHERE id = ? AND account_id = ?").get(metric_id, accountId);
    if (!owns) return res.status(404).json({ error: "Metric not found" });
    const now = new Date().toISOString();
    try {
      sqlite.prepare(`
        INSERT INTO pi_entries (metric_id, account_id, year, month, value, volume, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(metric_id, year, month) DO UPDATE SET
          value = excluded.value,
          volume = excluded.volume,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `).run(metric_id, accountId, year, month, value ?? null, volume ?? null, notes ?? null, now, now);
      const row = sqlite.prepare(
        "SELECT * FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ? AND account_id = ?"
      ).get(metric_id, year, month, accountId);
      res.json(row);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Wave D4 (2026-06-12): POST root-cause documentation for a QA entry. When a
  // quality indicator misses its benchmark (a red month), the QA loop expects
  // the lab to document the root cause and corrective action. Operates on an
  // existing entry, account-scoped. An empty body clears the RCA.
  app.post("/api/pi/entries/:id/rca", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const entry = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ? AND account_id = ?").get(id, accountId) as any;
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    const { root_cause, corrective_action, reviewed_by, clear } = req.body || {};
    const now = new Date().toISOString();
    if (clear) {
      sqlite.prepare(
        "UPDATE pi_entries SET root_cause = NULL, corrective_action = NULL, rca_reviewed_by = NULL, rca_reviewed_at = NULL, updated_at = ? WHERE id = ?"
      ).run(now, id);
      return res.json(sqlite.prepare("SELECT * FROM pi_entries WHERE id = ?").get(id));
    }
    if ((!root_cause || !String(root_cause).trim()) && (!corrective_action || !String(corrective_action).trim())) {
      return res.status(400).json({ error: "Provide a root cause or a corrective action." });
    }
    sqlite.prepare(
      "UPDATE pi_entries SET root_cause = ?, corrective_action = ?, rca_reviewed_by = ?, rca_reviewed_at = ?, updated_at = ? WHERE id = ?"
    ).run(root_cause ?? null, corrective_action ?? null, reviewed_by ?? null, now, now, id);
    res.json(sqlite.prepare("SELECT * FROM pi_entries WHERE id = ?").get(id));
  });

  // DELETE /api/pi/entries/:id - delete entry
  app.delete("/api/pi/entries/:id", authMiddleware, requireWriteAccess, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { id } = req.params;
    const row = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!row) return res.status(404).json({ error: "Entry not found" });
    sqlite.prepare("DELETE FROM pi_entries WHERE id = ?").run(id);
    res.json({ success: true });
  });

  // GET /api/pi/dashboard - computed dashboard data
  app.get("/api/pi/dashboard", authMiddleware, (req: any, res) => {
    if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
    const accountId = req.ownerUserId ?? req.userId;
    const { year, department_id } = req.query;
    if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
    const yr = parseInt(year as string);

    const metrics = sqlite.prepare(
      "SELECT * FROM pi_metrics WHERE department_id = ? AND account_id = ? AND active = 1 ORDER BY sort_order ASC, id ASC"
    ).all(department_id, accountId) as any[];

    if (metrics.length === 0) return res.json({ metrics: [] });

    const metricIds = metrics.map((m: any) => m.id);
    const placeholders = metricIds.map(() => "?").join(",");

    // Current year entries
    const currentEntries = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? ORDER BY month ASC`
    ).all(...metricIds, yr) as any[];

    // Prior year entries
    const priorEntries = sqlite.prepare(
      `SELECT * FROM pi_entries WHERE metric_id IN (${placeholders}) AND year = ? ORDER BY month ASC`
    ).all(...metricIds, yr - 1) as any[];

    function getBenchmarkStatus(value: number | null, metric: any): string | null {
      if (value == null) return null;
      if (metric.benchmark_green == null && metric.benchmark_yellow == null) return null;
      if (metric.direction === "lower_is_better") {
        if (metric.benchmark_green != null && value <= metric.benchmark_green) return "green";
        if (metric.benchmark_yellow != null && value <= metric.benchmark_yellow) return "yellow";
        return "red";
      } else {
        if (metric.benchmark_green != null && value >= metric.benchmark_green) return "green";
        if (metric.benchmark_yellow != null && value >= metric.benchmark_yellow) return "yellow";
        return "red";
      }
    }

    const result = metrics.map((metric: any) => {
      const entries = currentEntries.filter((e: any) => e.metric_id === metric.id);
      const priorYearEntries = priorEntries.filter((e: any) => e.metric_id === metric.id);

      const monthlyValues: Record<number, { value: number | null; volume: number | null; status: string | null }> = {};
      for (let m = 1; m <= 12; m++) {
        const entry = entries.find((e: any) => e.month === m);
        const val = entry?.value ?? null;
        monthlyValues[m] = {
          value: val,
          volume: entry?.volume ?? null,
          status: getBenchmarkStatus(val, metric),
        };
      }

      // Quarterly averages
      const quarters: Record<string, number | null> = {};
      for (const [qLabel, months] of [["Q1", [1,2,3]], ["Q2", [4,5,6]], ["Q3", [7,8,9]], ["Q4", [10,11,12]]] as [string, number[]][]) {
        const vals = months.map(m => monthlyValues[m]?.value).filter((v): v is number => v != null);
        quarters[qLabel] = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      }

      // YTD average
      const allVals = entries.map((e: any) => e.value).filter((v: any): v is number => v != null);
      const ytdAvg = allVals.length > 0 ? allVals.reduce((s: number, v: number) => s + v, 0) / allVals.length : null;

      // Prior year average
      const pyVals = priorYearEntries.map((e: any) => e.value).filter((v: any): v is number => v != null);
      const pyAvg = pyVals.length > 0 ? pyVals.reduce((s: number, v: number) => s + v, 0) / pyVals.length : null;

      // Current month value (latest entry)
      const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;

      return {
        metric,
        monthlyValues,
        quarters,
        ytdAvg,
        ytdStatus: getBenchmarkStatus(ytdAvg, metric),
        pyAvg,
        pyStatus: getBenchmarkStatus(pyAvg, metric),
        currentValue: latestEntry?.value ?? null,
        currentMonth: latestEntry?.month ?? null,
        currentStatus: getBenchmarkStatus(latestEntry?.value ?? null, metric),
        dataPointCount: allVals.length,
      };
    });

    res.json({ metrics: result });
  });

  // ── MULTI-LAB Tier 2, Phase 3.11b: lab-scoped VeritaStock endpoints ───────
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (labScopeMiddleware) {
    app.get("/api/labs/:labId/inventory", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
      ).all(req.scope.labId);
      const items = (rows as any[]).map(decorateInventoryItem);
      res.json(items);
    });

    // GET /api/labs/:labId/inventory/reorder-list, lab-scoped reorder list.
    // Same shape as the legacy /api/inventory/reorder-list above; gated on
    // the active lab membership rather than account_id.
    app.get("/api/labs/:labId/inventory/reorder-list", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const rows = sqlite.prepare(
        "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
      ).all(req.scope.labId);
      const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
      const items = applyReorderFilters(decorated, req.query);
      res.json({ items, totalCount: items.length, generatedAt: new Date().toISOString() });
    });

    // GET /api/labs/:labId/inventory/count-history, lab-scoped count history +
    // true burn. Same report as the legacy path; scoped on active-lab membership.
    app.get("/api/labs/:labId/inventory/count-history", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const days = Number(req.query.days) || 365;
      const itemId = req.query.item_id ? Number(req.query.item_id) : null;
      try {
        res.json(buildCountHistory(sqlite, req.scope.labId, { days, itemId }));
      } catch (err: any) {
        console.error("Count history error (lab-scoped):", err.message);
        res.status(500).json({ error: "count_history_failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/count-history/xlsx, lab-scoped workbook.
    app.post("/api/labs/:labId/inventory/count-history/xlsx", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const days = Number(req.body?.days) || Number(req.query?.days) || 365;
      try {
        const report = buildCountHistory(sqlite, req.scope.labId, { days });
        const labRow = sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
        const buffer = await generateCountHistoryExcel(report, { labName: labRow?.lab_name ?? null, cliaNumber: labRow?.clia_number ?? null });
        const filename = `VeritaStock_Count_History_${new Date().toISOString().slice(0, 10)}.xlsx`;
        const token = storePdfToken(buffer, filename);
        res.json({ token, itemCount: report.items.length });
      } catch (err: any) {
        console.error("Count history xlsx error (lab-scoped):", err.message);
        res.status(500).json({ error: "count_history_xlsx_failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/reorder-list/pdf, lab-scoped reorder
    // document PDF. Lab identity comes from the labs table for THIS labId
    // (not the requester's default lab), so a user with memberships on
    // multiple labs gets a correctly stamped header per lab.
    app.post("/api/labs/:labId/inventory/reorder-list/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
        const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const pdfBuffer = await generateReorderListPDF(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          vendorRecords: buildVendorRecordMap(req.scope.labId),
          ...reorderFilterContext(req.query),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Reorder_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: items.length });
      } catch (err: any) {
        console.error("Reorder PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/reorder-list/excel, lab-scoped Excel
    // variant. Same shape as the legacy /api/inventory/reorder-list/excel
    // above; differs only in how the lab identity for the header is read
    // (this labId, not the requester's default lab).
    app.post("/api/labs/:labId/inventory/reorder-list/excel", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
        const items = applyReorderFilters(decorated, req.query) as ReorderItem[];

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const xlsxBuffer = await generateReorderListExcel(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          ...reorderFilterContext(req.query),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Reorder_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.send(xlsxBuffer);
      } catch (err: any) {
        console.error("Reorder Excel generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "Excel generation failed", detail: err.message });
      }
    });

    // GET /api/labs/:labId/veritastock/intacct-config, the saved Sage Intacct
    // export config for this location, plus the vendors' Intacct-ID status the UI
    // uses to show the "set up" empty state and a missing-ID list.
    app.get("/api/labs/:labId/veritastock/intacct-config", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const labId = req.scope.labId;
      const config = readIntacctConfig(labId);
      const configured = !!(config.template_columns && config.template_columns.length > 0);
      const vendors = sqlite.prepare(
        "SELECT id, name, intacct_vendor_id FROM stock_vendors WHERE lab_id = ? AND status = 'active' ORDER BY name ASC"
      ).all(labId);
      res.json({ config, configured, vendors });
    });

    // PUT /api/labs/:labId/veritastock/intacct-config, save the export config
    // (transaction definition, GL account, dimensions, date format, and the
    // editable Intacct-header -> source column mapping). Config edit, not code.
    app.put("/api/labs/:labId/veritastock/intacct-config", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const labId = req.scope.labId;
      const config = sanitizeIntacctConfig(req.body?.config ?? req.body);
      sqlite.prepare(`
        INSERT INTO intacct_export_config (lab_id, config_json, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(lab_id) DO UPDATE SET config_json = excluded.config_json, updated_at = datetime('now')
      `).run(labId, JSON.stringify(config));
      // Optional same-call per-vendor Intacct Vendor ID updates so all Sage
      // Intacct setup saves from one dialog. Column-only update (NOT the full
      // vendorBody full-replace), lab-scoped so a cross-lab vendor can't be touched.
      const vendorIds = req.body?.vendor_ids;
      if (vendorIds && typeof vendorIds === "object" && !Array.isArray(vendorIds)) {
        const upd = sqlite.prepare("UPDATE stock_vendors SET intacct_vendor_id = ?, updated_at = datetime('now') WHERE id = ? AND lab_id = ?");
        for (const [vid, raw] of Object.entries(vendorIds)) {
          const id = Number(vid);
          if (!Number.isFinite(id)) continue;
          const val = (raw == null || String(raw).trim() === "") ? null : String(raw);
          upd.run(val, id, labId);
        }
      }
      res.json({ ok: true, config });
    });

    // POST /api/labs/:labId/inventory/reorder-list/intacct-csv, config-driven
    // Sage Intacct purchasing CSV off the CURRENT reorder list (same decorated
    // items the Order PDF/XLSX use), through the account's template_columns
    // mapping so headers match the customer's import template exactly. Preflight
    // blocks an incomplete file (missing Vendor IDs / transaction definition /
    // dimensions) with a NAMED 409 rather than emitting something Intacct rejects.
    app.post("/api/labs/:labId/inventory/reorder-list/intacct-csv", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const labId = req.scope.labId;
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(labId);
        const decorated = (rows as any[]).map(decorateInventoryItem).filter(it => it.needs_reorder);
        const items = applyReorderFilters(decorated, req.query) as any[];
        const config = readIntacctConfig(labId);
        const vendorMap = buildIntacctVendorIdMap(labId);
        const lines = items.map((it) => ({
          item_name: it.item_name,
          catalog_number: it.catalog_number ?? null,
          vendor: it.vendor ?? null,
          unit_cost: it.unit_cost ?? null,
          suggested_order_packs: it.suggested_order_packs ?? 0,
          delivered_qty: it.delivered_qty ?? 0,
          order_unit: it.order_unit ?? null,
          usage_unit: it.usage_unit ?? null,
          intacct_item_id: it.intacct_item_id ?? null,
        }));
        const pf = preflightIntacct(lines, config, vendorMap);
        if (!pf.ok) return res.status(409).json({ error: "intacct_preflight_failed", missing: pf.missing });
        const csv = buildIntacctCSV(lines, config, vendorMap);
        const labRow = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(labId) as any;
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Location").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `SageIntacct_Purchasing_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.csv`;
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", Buffer.byteLength(csv));
        res.send(csv);
      } catch (err: any) {
        console.error("Intacct CSV export error (lab-scoped):", err.message);
        res.status(500).json({ error: "Intacct CSV export failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/count-sheet/excel, lab-scoped
    // Inventory Count workbook. Same shape as the legacy
    // /api/inventory/count-sheet/excel above; differs only in how items
    // are scoped (lab_id, not account_id) and where lab identity is read
    // (the labs row for this labId, not the requester's default lab).
    app.post("/api/labs/:labId/inventory/count-sheet/excel", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          "SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
        ).all(req.scope.labId);
        const filtered = applyReorderFilters(rows as any[], req.query);
        if (filtered.length === 0) {
          return res.status(404).json({ error: "No inventory items in the current scope. Clear filters or add items before generating a count sheet." });
        }
        const items: InventoryCountItem[] = filtered.map((r: any) => ({
          storage_location: r.storage_location,
          department: r.department,
          item_name: r.item_name,
          category: r.category,
          catalog_number: r.catalog_number,
          lot_number: r.lot_number,
          expiration_date: r.expiration_date,
          vendor: r.vendor,
          quantity_on_hand: Number(r.quantity_on_hand ?? 0),
          unit: r.unit ?? r.usage_unit ?? null,
        }));

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const ctxFilters = reorderFilterContext(req.query);
        const filterLabelParts: string[] = [];
        if (ctxFilters.filterDepartment) filterLabelParts.push(ctxFilters.filterDepartment);
        if (ctxFilters.filterCategory) filterLabelParts.push(ctxFilters.filterCategory);
        if (ctxFilters.filterVendor) filterLabelParts.push(ctxFilters.filterVendor);
        const filterLabel = filterLabelParts.length > 0 ? filterLabelParts.join(" / ") : null;

        const xlsxBuffer = await generateInventoryCountExcel(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          filterLabel,
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_Count_${safeLab}${reorderFilenameSuffix(req.query)}_${datestamp}.xlsx`;
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", xlsxBuffer.length);
        res.send(xlsxBuffer);
      } catch (err: any) {
        console.error("Inventory count workbook generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "Workbook generation failed", detail: err.message });
      }
    });

    // GET /api/labs/:labId/veritastock/receipts, receipt history for lead-time
    // verification. Returns recent receive events (placed/expected/received
    // dates plus programmed vs actual lead time), newest first, so the facility
    // can document every received order and check it against programmed lead time.
    app.get("/api/labs/:labId/veritastock/receipts", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      try {
        const rows = sqlite.prepare(
          `SELECT id, item_id, item_name, vendor, qty_received, usage_unit, order_placed_date, expected_date, received_date, programmed_lead_time_days, actual_lead_time_days, document_url, document_label, received_lot_number, received_expiration_date, note, created_at
           FROM inventory_receipts WHERE lab_id = ? ORDER BY received_date DESC, id DESC LIMIT 250`
        ).all(req.scope.labId);
        res.json(rows);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // GET /api/labs/:labId/veritastock/lead-time-flags, lead-time drift.
    // For each item with at least MIN_SAMPLE received POs (placed + received on
    // file), compare the trailing-average actual lead time to the item's CURRENT
    // programmed lead time. Flag only when the average deviates by more than
    // max(3 days, 25%) so a single late shipment does not trigger it. Direction:
    // "slower" = actual longer than programmed (stockout risk), "faster" = actual
    // shorter (over-buffered safety stock). The materials manager applies the
    // suggested value via POST /api/inventory/:id/lead-time; nothing auto-changes.
    app.get("/api/labs/:labId/veritastock/lead-time-flags", authMiddleware, labScopeMiddleware, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const MIN_SAMPLE = 3, WINDOW = 6;
      try {
        const rows = sqlite.prepare(
          `SELECT item_id, item_name, vendor, actual_lead_time_days, received_date
           FROM inventory_receipts
           WHERE lab_id = ? AND actual_lead_time_days IS NOT NULL
           ORDER BY received_date DESC, id DESC`
        ).all(req.scope.labId) as any[];
        // Group newest-first per item.
        const byItem = new Map<number, { item_name: string; vendor: string | null; actuals: number[] }>();
        for (const r of rows) {
          let g = byItem.get(r.item_id);
          if (!g) { g = { item_name: r.item_name, vendor: r.vendor, actuals: [] }; byItem.set(r.item_id, g); }
          if (g.actuals.length < WINDOW) g.actuals.push(r.actual_lead_time_days);
        }
        const flags: any[] = [];
        for (const [itemId, g] of byItem) {
          if (g.actuals.length < MIN_SAMPLE) continue;
          const itemRow = sqlite.prepare("SELECT lead_time_days FROM inventory_items WHERE id = ? AND lab_id = ?").get(itemId, req.scope.labId) as any;
          const programmed = itemRow?.lead_time_days;
          if (!Number.isFinite(programmed) || programmed <= 0) continue;
          const avg = g.actuals.reduce((a, b) => a + b, 0) / g.actuals.length;
          const tol = Math.max(3, programmed * 0.25);
          const delta = avg - programmed;
          if (Math.abs(delta) < tol) continue;
          flags.push({
            item_id: itemId,
            item_name: g.item_name,
            vendor: g.vendor,
            programmed_lead_time_days: programmed,
            avg_actual_lead_time_days: Math.round(avg),
            suggested_lead_time_days: Math.round(avg),
            sample_size: g.actuals.length,
            direction: delta > 0 ? "slower" : "faster",
            delta_days: Math.round(delta),
          });
        }
        // Biggest exposure first.
        flags.sort((a, b) => Math.abs(b.delta_days) - Math.abs(a.delta_days));
        res.json(flags);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/labels/pdf, lab-scoped barcode label
    // sheet. Same shape as the legacy /api/inventory/labels/pdf above; differs
    // only in how items are scoped (lab_id, not account_id) and where lab
    // identity is read (the labs row for THIS labId). Fixes the cross-lab
    // bleed where items added under a seat user (account_id != owner.id) were
    // invisible to the legacy endpoint's account-scoped query, producing a
    // partial label sheet that looked like "only one label printed when the
    // lab has many items." Same bug class as the count-sheet lab-scoping fix
    // above. (2026-06-04, customer report on Michaels Lab.)
    app.post("/api/labs/:labId/inventory/labels/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const requestedIds = Array.isArray(req.body?.itemIds)
        ? req.body.itemIds.filter((x: any) => typeof x === "number" && Number.isFinite(x))
        : null;
      try {
        let rows: any[];
        if (requestedIds && requestedIds.length > 0) {
          const placeholders = requestedIds.map(() => "?").join(",");
          rows = sqlite.prepare(
            `SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE lab_id = ? AND id IN (${placeholders}) ORDER BY item_name ASC`
          ).all(req.scope.labId, ...requestedIds) as any[];
        } else {
          rows = sqlite.prepare(
            "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
          ).all(req.scope.labId) as any[];
        }
        if (rows.length === 0) {
          return res.status(404).json({ error: "No inventory items in this lab. Add at least one item before printing labels." });
        }

        const labels: BarcodeLabelInput[] = rows.map((r) => ({
          barcodeValue: (r.barcode_value && String(r.barcode_value).trim().length > 0)
            ? String(r.barcode_value)
            : `VLS-${String(r.id).padStart(8, "0")}`,
          itemName: r.item_name || "(unnamed)",
          catalogNumber: r.catalog_number,
          lotNumber: r.lot_number,
          storageLocation: r.storage_location,
        }));

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const labName: string | null = labRow?.lab_name || null;
        const cliaNumber: string | null = labRow?.clia_number || null;

        const pdfBuffer = await generateBarcodeLabelSheetPdf(labels, { labName, cliaNumber });
        const datestamp = new Date().toISOString().slice(0, 10);
        const filename = `VeritaStock_Labels_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: labels.length });
      } catch (err: any) {
        console.error("Barcode label PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    // POST /api/labs/:labId/inventory/snap-order/pdf, lab-scoped snap order
    // PDF. Same shape as the legacy variant; differs only in how items are
    // scoped (by lab_id rather than account_id) and where the lab identity
    // header comes from (the labs row for THIS labId).
    app.post("/api/labs/:labId/inventory/snap-order/pdf", authMiddleware, labScopeMiddleware, async (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const requestedItems = Array.isArray(req.body?.items) ? req.body.items : [];
      const valid = requestedItems
        .filter((r: any) => typeof r?.id === "number" && typeof r?.snap_qty === "number" && r.snap_qty > 0)
        .map((r: any) => ({ id: Number(r.id), snap_qty: Number(r.snap_qty), snap_unit: typeof r.snap_unit === "string" ? r.snap_unit : null }));
      if (valid.length === 0) {
        return res.status(400).json({ error: "No items with snap_qty > 0 submitted." });
      }
      try {
        const placeholders = valid.map(() => "?").join(",");
        const rows = sqlite.prepare(
          `SELECT * FROM inventory_items WHERE lab_id = ? AND id IN (${placeholders})`
        ).all(req.scope.labId, ...valid.map((v: any) => v.id)) as any[];

        const byId = new Map<number, any>();
        for (const r of rows) byId.set(r.id, r);

        const items: SnapOrderItem[] = valid
          .map((v: any) => {
            const row = byId.get(v.id);
            if (!row) return null;
            return {
              id: row.id,
              item_name: row.item_name,
              catalog_number: row.catalog_number,
              lot_number: row.lot_number,
              vendor: row.vendor,
              department: row.department,
              unit: row.unit,
              order_unit: row.order_unit,
              quantity_on_hand: row.quantity_on_hand || 0,
              snap_qty: v.snap_qty,
              snap_unit: v.snap_unit || row.order_unit || row.unit || "each",
            } as SnapOrderItem;
          })
          .filter((x: any): x is SnapOrderItem => x !== null);

        if (items.length === 0) {
          return res.status(404).json({ error: "None of the submitted items found in this lab." });
        }

        const labRow = sqlite.prepare(
          "SELECT lab_name, clia_number FROM labs WHERE id = ?"
        ).get(req.scope.labId) as any;
        const userRow = sqlite.prepare(
          "SELECT name, email FROM users WHERE id = ?"
        ).get(req.userId) as any;

        const pdfBuffer = await generateSnapOrderPDF(items, {
          labName: labRow?.lab_name || null,
          cliaNumber: labRow?.clia_number || null,
          preparedBy: userRow?.name || userRow?.email || null,
          vendorRecords: buildVendorRecordMap(req.scope.labId),
        });
        const datestamp = new Date().toISOString().slice(0, 10);
        const safeLab = (labRow?.lab_name || "Lab").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        const filename = `VeritaStock_SnapOrder_${safeLab}_${datestamp}.pdf`;
        const token = storePdfToken(pdfBuffer, filename);
        res.json({ token, totalCount: items.length });
      } catch (err: any) {
        console.error("Snap order PDF generation error (lab-scoped):", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    app.post("/api/labs/:labId/inventory", authMiddleware, labScopeMiddleware, requireWriteAccess, (req: any, res) => {
      if (!hasOpsAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaBench™ requires a suite subscription" });
      const { item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, unit_cost, on_order_qty, on_order_expected_date, on_order_placed_date } = req.body;
      if (!item_name) return res.status(400).json({ error: "item_name is required" });
      const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(req.scope.labId) as any;
      const accountId = ownerRow?.owner_user_id ?? req.userId;
      const now = new Date().toISOString();
      try {
        const result = sqlite.prepare(`
          INSERT INTO inventory_items (account_id, lab_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status, burn_rate, order_unit, usage_unit, units_per_order_unit, lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, standing_order_review_date, unit_cost, on_order_qty, on_order_expected_date, on_order_placed_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(accountId, req.scope.labId, item_name, catalog_number ?? null, lot_number ?? null, department ?? 'Core Lab', category ?? 'Reagent', quantity_on_hand ?? 0, unit ?? 'each', expiration_date ?? null, vendor ?? null, storage_location ?? null, notes ?? null, status ?? 'active', burn_rate ?? 0, order_unit ?? 'each', usage_unit ?? 'each', units_per_order_unit ?? 1, lead_time_days ?? 5, safety_stock_days ?? 3, desired_days_of_stock ?? 30, standing_order ?? 0, standing_order_review_date ?? null, Number(unit_cost ?? 0), Number(on_order_qty ?? 0), on_order_expected_date ?? null, on_order_placed_date ?? null, now, now);
        // Persist canonical barcode_value (VLS-<padded id>) at creation so
        // the label code never changes across runtime/algorithm shifts.
        try {
          sqlite.prepare("UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE id = ? AND (barcode_value IS NULL OR barcode_value = '')").run(result.lastInsertRowid);
        } catch {}
        const row = sqlite.prepare("SELECT * FROM inventory_items WHERE id = ?").get(Number(result.lastInsertRowid));
        res.json(row);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  }
}
