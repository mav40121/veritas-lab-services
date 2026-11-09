// server/tissue.ts
//
// VeritaStock tissue sub-module (Heywood, parking lot #105, REQ-106; Michael Q152 = 1: NO PHI).
// One row per graft, keyed on the supplier's distinct identification code: receipt in Materials Management, receipt and
// storage in the blood bank, issue, then implant or another final disposition, with a perpetual log, lookup by tissue ID and
// a recall match (server/stockRecalls.ts findLotMatches).
//
// No recipient field exists anywhere. A record carries the tissue ID, the implant date and time, the surgeon, the requesting
// physician and where the unit was delivered. The patient link stays in the hospital's chart: a lookback runs tissue ID, then
// this record, then the chart. Every write refuses text that looks like patient information (shared/tissueRules.ts); the
// platform's guard only warns, and these are the fields most likely to attract a name.
//
// Access: recording a step is record work, open to anyone in the lab who can write, the same split as temperature readings.
// The catalog, corrections and undo need VeritaStock edit. Plans follow hasOpsAccess.
//
// veritastock.com (the VeritaStock Railway service, VITE_STOCK_DEPLOYMENT=true, its own database): tissue tracking is for labs
// and doesn't exist there. Every route answers 404, the page redirects, and the tables stay empty.

import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { hasOpsAccess } from "./veritabench";
import { labToday } from "./dateLocal";
import { storePdfToken } from "./pdfTokens";
import { generateTissueLogExcel, generateTissueLogPDF } from "./tissueLogExport";
import {
  ISSUE_ROW_FIELDS, OTHER_DISPOSITIONS, TISSUE_STATE_LABELS, correctableFields, findTissuePhi, isBefore, isFinalState, isHhMm, isYmd,
  issueRefusals, lastLiveReturn, liveSteps, returnUnusedRefusal, tissueFlags, tissueIdKey, tissuePhiMessage, yesNo, type TissueState,
} from "../shared/tissueRules";

const sqliteOf = () => (db as any).$client;
export const isStockDeployment = () => process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";
const BASE = "/api/labs/:labId/veritastock/tissue";

const cleanStr = (v: unknown, max = 200): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const userName = (sqlite: any, id: number): string | null => {
  const u = sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(id) as any;
  return u ? u.name || u.email || null : null;
};

export function decorateTissueUnit(u: any, today: string) {
  return { ...u, state_label: TISSUE_STATE_LABELS[u.state as TissueState] || u.state, flags: tissueFlags(u, today) };
}

function addEvent(sqlite: any, req: any, unitId: number, labId: number, type: string, e: { date?: string | null; time?: string | null; by?: string | null; checks?: unknown; detail?: unknown }) {
  sqlite.prepare(
    `INSERT INTO tissue_unit_events (unit_id, lab_id, event_type, event_date, event_time, performed_by, checks_json, detail_json, recorded_by_user_id, recorded_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(unitId, labId, type, e.date ?? null, e.time ?? null, e.by ?? null, e.checks == null ? null : JSON.stringify(e.checks), e.detail == null ? null : JSON.stringify(e.detail),
    req.userId ?? null, req.userId ? userName(sqlite, req.userId) : null, new Date().toISOString());
}

function applySet(sqlite: any, id: number, set: Record<string, unknown>) {
  const keys = Object.keys(set);
  sqlite.prepare(`UPDATE tissue_units SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...keys.map((k) => set[k]), new Date().toISOString(), id);
}

const audit = (req: any, id: number, label: string, after?: unknown, before?: unknown) => {
  try {
    logAudit({
      userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.userId, module: "veritastock", action: "update",
      entityType: "tissue_unit", entityId: id, entityLabel: label, before, after, ipAddress: req.ip,
    });
  } catch { /* best-effort: the unit's own event chain is the record */ }
};

/** A required date and time for a step, on or before the lab's today. Null when fine. */
function stepTimeError(date: unknown, time: unknown, label: string, today: string): string | null {
  if (!isYmd(date)) return `${label}: enter the date.`;
  if (!isHhMm(time)) return `${label}: enter the time.`;
  if ((date as string) > today) return `${label}: the date can't be in the future.`;
  return null;
}

function storageFields(sqlite: any, labId: number, b: any): { error?: string; set?: Record<string, unknown> } {
  const location = cleanStr(b.storage_location);
  let unitId: number | null = null;
  if (b.storage_unit_id != null && b.storage_unit_id !== "") {
    unitId = Number(b.storage_unit_id);
    const u = sqlite.prepare("SELECT id FROM temp_log_units WHERE id = ? AND lab_id = ?").get(unitId, labId);
    if (!u) return { error: "That storage unit isn't in this lab." };
  }
  if (!unitId && !location) return { error: "Say where the unit is stored: pick a storage unit or enter a location." };
  return { set: { storage_unit_id: unitId, storage_location: location } };
}

/** The blood bank receipt, from the form: date, time, who, transport temperature with the action taken, package integrity, and where it's stored. */
function blockBbFields(sqlite: any, labId: number, b: any, unit: any, today: string): { error?: string; set?: Record<string, unknown>; checks?: unknown } {
  const timeErr = stepTimeError(b.received_bb_date, b.received_bb_time, "Received in blood bank", today);
  if (timeErr) return { error: timeErr };
  const by = cleanStr(b.received_bb_by);
  if (!by) return { error: "Received in blood bank: enter who received it." };
  if (isBefore(b.received_bb_date, b.received_bb_time, unit.received_mm_date, unit.received_mm_time)) return { error: "The blood bank receipt can't be earlier than the Materials Management receipt." };
  const temp = yesNo(b.transport_temp_ok);
  const pack = yesNo(b.package_ok);
  if (temp === null) return { error: "Transport temperature acceptable: answer yes or no." };
  if (pack === null) return { error: "Package integrity acceptable: answer yes or no." };
  const action = cleanStr(b.transport_action, 1000);
  if ((temp === 0 || pack === 0) && !action) return { error: "A no at receipt needs the action taken." };
  const storage = storageFields(sqlite, labId, b);
  if (storage.error) return { error: storage.error };
  return {
    set: {
      received_bb_date: b.received_bb_date, received_bb_time: b.received_bb_time, received_bb_by: by,
      transport_temp_ok: temp, transport_action: action, package_ok: pack, ...storage.set, state: "stored",
    },
    checks: { transport_temp_ok: temp, package_ok: pack },
  };
}

function reconstitutionFields(b: any): { error?: string; set?: Record<string, unknown> } {
  const f = {
    reconstituted_time: cleanStr(b.reconstituted_time, 5), reconstituted_by: cleanStr(b.reconstituted_by),
    reconstitution_solution: cleanStr(b.reconstitution_solution), reconstitution_lot: cleanStr(b.reconstitution_lot, 120),
    reconstitution_expiration: cleanStr(b.reconstitution_expiration, 10),
  };
  if (Object.values(f).every((v) => v === null)) return { set: f };
  if (!isHhMm(f.reconstituted_time)) return { error: "Reconstituted: enter the time." };
  if (!f.reconstituted_by) return { error: "Reconstituted: enter who did it." };
  if (!f.reconstitution_solution) return { error: "Reconstituted: enter the solution used." };
  if (!f.reconstitution_lot) return { error: "Reconstituted: enter the solution's lot." };
  if (!isYmd(f.reconstitution_expiration)) return { error: "Reconstituted: enter the solution's expiration date." };
  return { set: f };
}

function usageCardFields(b: any, implantedDate: string | null, today: string): { error?: string; set?: Record<string, unknown> } {
  const returned = yesNo(b.usage_card_returned);
  if (returned === null) return { error: "Tissue usage card completed and returned: answer yes or no." };
  if (returned === 0) return { set: { usage_card_returned: 0, usage_card_returned_on: null } };
  if (!isYmd(b.usage_card_returned_on)) return { error: "Tissue usage card: enter the date it was returned." };
  if (b.usage_card_returned_on > today) return { error: "Tissue usage card: the date returned can't be in the future." };
  if (implantedDate && b.usage_card_returned_on < implantedDate) return { error: "Tissue usage card: the date returned can't be before the implant." };
  return { set: { usage_card_returned: 1, usage_card_returned_on: b.usage_card_returned_on } };
}

const fetchUnit = (sqlite: any, id: number, labId: number) => sqlite.prepare("SELECT * FROM tissue_units WHERE id = ? AND lab_id = ?").get(id, labId) as any;
/** A unit's event chain, oldest first: what liveSteps reads to know which steps still stand. */
const unitEvents = (sqlite: any, unitId: number) =>
  sqlite.prepare("SELECT id, event_type, event_date, event_time, performed_by, detail_json FROM tissue_unit_events WHERE unit_id = ? ORDER BY id ASC").all(unitId) as any[];
const parseDetail = (e: any): any => { try { return JSON.parse(e?.detail_json || "{}") || {}; } catch { return {}; } };

/** Every return to storage still standing on each unit, oldest first, for the log's workbook and PDF. Only units that have one. */
export function returnsUnusedByUnit(sqlite: any, labId: number): Map<number, any[]> {
  const rows = sqlite.prepare(
    `SELECT id, unit_id, event_type, event_date, event_time, performed_by, detail_json FROM tissue_unit_events
      WHERE unit_id IN (SELECT DISTINCT unit_id FROM tissue_unit_events WHERE lab_id = ? AND event_type = 'returned_unused') ORDER BY id ASC`
  ).all(labId) as any[];
  const byUnit = new Map<number, any[]>();
  for (const r of rows) { const list = byUnit.get(r.unit_id) || []; list.push(r); byUnit.set(r.unit_id, list); }
  const out = new Map<number, any[]>();
  for (const [unitId, events] of Array.from(byUnit.entries())) {
    const returns = liveSteps(events).filter((e) => e.event_type === "returned_unused").map((e) => {
      const d = parseDetail(e);
      return {
        returned_date: e.event_date, returned_time: e.event_time, returned_by: d.returned_by ?? null, received_back_by: d.received_back_by ?? e.performed_by ?? null,
        storage_ok: d.storage_ok ?? null, package_ok_on_return: d.package_ok_on_return ?? null,
        issued_date: d.cleared_issue?.issued_date ?? null, issued_time: d.cleared_issue?.issued_time ?? null, delivered_to: d.cleared_issue?.delivered_to ?? null,
      };
    });
    if (returns.length) out.set(unitId, returns);
  }
  return out;
}
const finalRefusal = (u: any) => `This unit already has its final disposition (${TISSUE_STATE_LABELS[u.state as TissueState] || u.state}). Use Undo last step if that was a mistake.`;

/** Find this lab's vendor by name, ignoring case and outer spaces, or add it. Runs inside the caller's transaction when there is one. */
function ensureVendor(sqlite: any, labId: number, name: string): number {
  const row = sqlite.prepare("SELECT id FROM stock_vendors WHERE lab_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))").get(labId, name) as any;
  if (row) return Number(row.id);
  return Number(sqlite.prepare("INSERT INTO stock_vendors (lab_id, name, status, created_at, updated_at) VALUES (?, ?, 'active', datetime('now'), datetime('now'))").run(labId, name).lastInsertRowid);
}

// ── Catalog load (the form's data source tab, driven by vls-ops/prod_heywood_tissue_catalog_load.mjs) ─────────────
export interface CatalogLoadRow { tissue_type: unknown; supplier: unknown }

/** Plans a load and, when apply is set, writes it in one transaction. A rerun recognizes what's already there. */
export function loadTissueCatalog(sqlite: any, labId: number, rows: CatalogLoadRow[], apply: boolean) {
  const seen = new Set<string>();
  const plan: { tissue_type: string; supplier: string; on_file: boolean }[] = [];
  let duplicatesInFile = 0;
  let blank = 0;
  const existsCat = sqlite.prepare(
    `SELECT c.id FROM tissue_catalog c JOIN stock_vendors v ON v.id = c.vendor_id
      WHERE c.lab_id = ? AND LOWER(TRIM(c.tissue_type)) = LOWER(TRIM(?)) AND LOWER(TRIM(v.name)) = LOWER(TRIM(?))`
  );
  for (const r of rows) {
    const tissue_type = cleanStr(r?.tissue_type);
    const supplier = cleanStr(r?.supplier);
    if (!tissue_type || !supplier) { blank++; continue; }
    const key = `${tissue_type.toLowerCase()}|${supplier.toLowerCase()}`;
    if (seen.has(key)) { duplicatesInFile++; continue; }
    seen.add(key);
    plan.push({ tissue_type, supplier, on_file: !!existsCat.get(labId, tissue_type, supplier) });
  }
  const vendorExists = sqlite.prepare("SELECT 1 FROM stock_vendors WHERE lab_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))");
  const suppliers = Array.from(new Set(plan.map((p) => p.supplier.toLowerCase())));
  const newSuppliers = suppliers.filter((s) => !vendorExists.get(labId, s));
  const toAdd = plan.filter((p) => !p.on_file);
  if (apply) {
    sqlite.transaction(() => {
      const ins = sqlite.prepare("INSERT INTO tissue_catalog (lab_id, tissue_type, vendor_id, active, created_at, updated_at) VALUES (?, ?, ?, 1, datetime('now'), datetime('now'))");
      for (const p of toAdd) ins.run(labId, p.tissue_type, ensureVendor(sqlite, labId, p.supplier));
    })();
  }
  return {
    rows_received: rows.length, blank_rows: blank, duplicates_in_file: duplicatesInFile,
    to_add: toAdd.length, already_on_file: plan.length - toAdd.length,
    supplier_count: suppliers.length, new_suppliers: newSuppliers.length,
    products_to_add: toAdd.map((p) => p.tissue_type),
  };
}

export function tissueCatalogStatus(sqlite: any, labId: number) {
  const lab = sqlite.prepare("SELECT id, lab_name FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const products = (sqlite.prepare("SELECT tissue_type FROM tissue_catalog WHERE lab_id = ? ORDER BY id").all(labId) as any[]).map((r) => r.tissue_type);
  const n = (q: string) => Number((sqlite.prepare(q).get(labId) as any)?.n || 0);
  return {
    lab: { id: lab.id, lab_name: lab.lab_name },
    catalog_count: products.length,
    active_count: n("SELECT COUNT(*) AS n FROM tissue_catalog WHERE lab_id = ? AND active = 1"),
    supplier_count: n("SELECT COUNT(DISTINCT vendor_id) AS n FROM tissue_catalog WHERE lab_id = ?"),
    unit_count: n("SELECT COUNT(*) AS n FROM tissue_units WHERE lab_id = ?"),
    products,
  };
}

export function registerTissueRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
  adminSecret: string,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerTissueRoutes: labScopeMiddleware not registered");

  const notOnStock = (_req: any, res: any, next: any) => (isStockDeployment() ? res.status(404).json({ error: "Not found" }) : next());
  const planGate = (req: any, res: any, next: any) => (hasOpsAccess(req.user, req.scope?.lab) ? next() : res.status(403).json({ error: "VeritaStock™ requires a suite subscription" }));
  // Refused on the server with the reason. The platform-wide guard in the browser only warns.
  const noPhi = (req: any, res: any, next: any) => {
    const hit = findTissuePhi(req.body);
    if (hit) return res.status(400).json({ error: tissuePhiMessage(hit.labels), code: "PHI_REFUSED", field: hit.field, labels: hit.labels });
    next();
  };
  const read = [notOnStock, authMiddleware, labScopeMiddleware, planGate];
  const record = [notOnStock, authMiddleware, labScopeMiddleware, requireWriteAccess, planGate, noPhi];
  const edit = [notOnStock, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritastock"), planGate, noPhi];

  // ── Catalog: the lab's own list ───────────────────────────────────────
  app.get(`${BASE}/catalog`, ...read, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const items = sqlite.prepare(
      `SELECT c.id, c.tissue_type, c.vendor_id, v.name AS supplier_name, c.active,
              (SELECT COUNT(*) FROM tissue_units u WHERE u.catalog_id = c.id) AS unit_count
         FROM tissue_catalog c JOIN stock_vendors v ON v.id = c.vendor_id
        WHERE c.lab_id = ? ORDER BY c.active DESC, c.tissue_type COLLATE NOCASE ASC, c.id ASC`
    ).all(req.scope.labId);
    const vendors = sqlite.prepare("SELECT id, name FROM stock_vendors WHERE lab_id = ? ORDER BY name COLLATE NOCASE").all(req.scope.labId);
    res.json({ items, vendors });
  });

  app.post(`${BASE}/catalog`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const tissueType = cleanStr(req.body?.tissue_type);
    const supplier = cleanStr(req.body?.supplier_name);
    if (!tissueType) return res.status(400).json({ error: "Enter the type of tissue." });
    if (!supplier) return res.status(400).json({ error: "Enter the supplier." });
    try {
      const id = sqlite.transaction(() => {
        const vendorId = ensureVendor(sqlite, req.scope.labId, supplier);
        return Number(sqlite.prepare("INSERT INTO tissue_catalog (lab_id, tissue_type, vendor_id, active, created_by, created_at, updated_at) VALUES (?, ?, ?, 1, ?, datetime('now'), datetime('now'))")
          .run(req.scope.labId, tissueType, vendorId, req.userId).lastInsertRowid);
      })();
      res.status(201).json({ id });
    } catch (err: any) {
      if (String(err?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "That tissue type and supplier is already on your catalog." });
      throw err;
    }
  });

  app.put(`${BASE}/catalog/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const row = sqlite.prepare("SELECT * FROM tissue_catalog WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "Not on this lab's catalog" });
    const b = req.body || {};
    const tissueType = b.tissue_type !== undefined ? cleanStr(b.tissue_type) : row.tissue_type;
    if (!tissueType) return res.status(400).json({ error: "Enter the type of tissue." });
    let vendorId = row.vendor_id;
    if (b.supplier_name !== undefined) {
      const supplier = cleanStr(b.supplier_name);
      if (!supplier) return res.status(400).json({ error: "Enter the supplier." });
      vendorId = ensureVendor(sqlite, req.scope.labId, supplier);
    }
    const active = b.active !== undefined ? (yesNo(b.active) === 1 ? 1 : 0) : row.active;
    try {
      sqlite.prepare("UPDATE tissue_catalog SET tissue_type = ?, vendor_id = ?, active = ?, updated_at = datetime('now') WHERE id = ?").run(tissueType, vendorId, active, row.id);
    } catch (err: any) {
      if (String(err?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "That tissue type and supplier is already on your catalog." });
      throw err;
    }
    res.json({ ok: true });
  });

  // Only a row no unit ever used. A row in use is retired instead, so the records it named keep their catalog row.
  app.delete(`${BASE}/catalog/:id`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const row = sqlite.prepare("SELECT id FROM tissue_catalog WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "Not on this lab's catalog" });
    const used = sqlite.prepare("SELECT 1 FROM tissue_units WHERE catalog_id = ? LIMIT 1").get(row.id);
    if (used) return res.status(409).json({ error: "Tissue has been received under this entry, so it can't be deleted. Retire it instead.", code: "CATALOG_IN_USE" });
    sqlite.prepare("DELETE FROM tissue_catalog WHERE id = ?").run(row.id);
    res.json({ ok: true });
  });

  // ── The perpetual log and lookup ──────────────────────────────────────
  const listUnits = (labId: number, filter: string) => {
    const sqlite = sqliteOf();
    const rows = sqlite.prepare(
      `SELECT u.*, t.name AS storage_unit_name FROM tissue_units u LEFT JOIN temp_log_units t ON t.id = u.storage_unit_id AND t.lab_id = u.lab_id
        WHERE u.lab_id = ? ORDER BY u.received_mm_date DESC, u.id DESC`
    ).all(labId) as any[];
    const today = labToday();
    const all = rows.map((u) => decorateTissueUnit(u, today));
    const counts = {
      all: all.length,
      open: all.filter((u) => u.flags.open).length,
      card_pending: all.filter((u) => u.flags.card_pending).length,
    };
    const shown = filter === "all" ? all : filter === "card_pending" ? all.filter((u) => u.flags.card_pending) : all.filter((u) => u.flags.open);
    return { today, counts, rows: shown, filter: filter === "all" || filter === "card_pending" ? filter : "open" };
  };

  app.get(`${BASE}/units`, ...read, (req: any, res: any) => {
    res.json(listUnits(req.scope.labId, String(req.query.filter || "open")));
  });

  // A lookback starts here: tissue ID, then this record, then the chart. The ID is unique per supplier, so more than one can match.
  app.get(`${BASE}/lookup`, ...read, (req: any, res: any) => {
    const key = tissueIdKey(req.query.id);
    if (!key) return res.status(400).json({ error: "Enter a tissue ID." });
    const today = labToday();
    const rows = sqliteOf().prepare("SELECT * FROM tissue_units WHERE lab_id = ? AND source_id_key = ? ORDER BY id").all(req.scope.labId, key) as any[];
    res.json({ matches: rows.map((u) => decorateTissueUnit(u, today)) });
  });

  app.get(`${BASE}/units/:id`, ...read, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = fetchUnit(sqlite, Number(req.params.id), req.scope.labId);
    if (!u) return res.status(404).json({ error: "That unit isn't on this lab's log" });
    const today = labToday();
    const events = sqlite.prepare("SELECT id, event_type, event_date, event_time, performed_by, checks_json, detail_json, recorded_by_name, created_at FROM tissue_unit_events WHERE unit_id = ? ORDER BY id ASC").all(u.id);
    // The storage link: this unit's temperature log, with any out-of-range readings while the tissue sat in it.
    let storage: any = null;
    if (u.storage_unit_id) {
      const s = sqlite.prepare("SELECT id, name, unit_type, location, min_value, max_value, scale, active FROM temp_log_units WHERE id = ? AND lab_id = ?").get(u.storage_unit_id, u.lab_id) as any;
      if (s) {
        const from = u.received_bb_date || u.received_mm_date;
        const to = u.issued_date || u.disposition_date || today;
        const last = sqlite.prepare("SELECT reading_date, reading_time, value, in_range FROM temp_log_readings WHERE unit_id = ? ORDER BY reading_date DESC, COALESCE(reading_time, '') DESC, id DESC LIMIT 1").get(s.id);
        const out = sqlite.prepare("SELECT COUNT(*) AS n FROM temp_log_readings WHERE unit_id = ? AND in_range = 0 AND reading_date >= ? AND reading_date <= ?").get(s.id, from, to) as any;
        storage = { ...s, last_reading: last || null, out_of_range_while_stored: Number(out?.n || 0) };
      }
    }
    res.json({ ...decorateTissueUnit(u, today), events, storage, correctable_fields: correctableFields(u) });
  });

  // ── Exports. A token the page downloads at /api/pdf/:token, like every other VeritaStock document. ────────────
  const logContext = (req: any, filter: string) => {
    const lab = sqliteOf().prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    const data = listUnits(req.scope.labId, filter);
    // A return to storage moves the issue off the row, so the log names it from the unit's history.
    const returns = returnsUnusedByUnit(sqliteOf(), req.scope.labId);
    data.rows = data.rows.map((u: any) => (returns.has(u.id) ? { ...u, returns_unused: returns.get(u.id) } : u));
    return { data, ctx: { labName: lab?.lab_name ?? null, cliaNumber: lab?.clia_number ?? null, today: data.today, filter: data.filter } };
  };

  app.post(`${BASE}/log/xlsx`, ...read, async (req: any, res: any) => {
    try {
      const { data, ctx } = logContext(req, String(req.body?.filter || "all"));
      const buf = await generateTissueLogExcel(data.rows, ctx);
      res.json({ token: storePdfToken(buf, `VeritaStock_Tissue_Log_${data.today}.xlsx`), filename: `VeritaStock_Tissue_Log_${data.today}.xlsx`, unit_count: data.rows.length });
    } catch (err: any) {
      console.error("[tissue] log workbook failed:", err?.message || err);
      res.status(500).json({ error: "The workbook could not be built." });
    }
  });

  app.post(`${BASE}/log/pdf`, ...read, async (req: any, res: any) => {
    try {
      const { data, ctx } = logContext(req, String(req.body?.filter || "all"));
      const buf = await generateTissueLogPDF(data.rows, ctx);
      res.json({ token: storePdfToken(buf, `VeritaStock_Tissue_Log_${data.today}.pdf`), filename: `VeritaStock_Tissue_Log_${data.today}.pdf`, unit_count: data.rows.length });
    } catch (err: any) {
      console.error("[tissue] log PDF failed:", err?.message || err);
      res.status(500).json({ error: "The PDF could not be built." });
    }
  });

  // ── Receipt ───────────────────────────────────────────────────────────
  app.post(`${BASE}/units`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const labId = req.scope.labId;
    const b = req.body || {};
    const today = labToday();
    const cat = sqlite.prepare("SELECT c.id, c.tissue_type, c.vendor_id, c.active, v.name AS supplier_name FROM tissue_catalog c JOIN stock_vendors v ON v.id = c.vendor_id WHERE c.id = ? AND c.lab_id = ?").get(Number(b.catalog_id), labId) as any;
    if (!cat) return res.status(400).json({ error: "Choose the type of tissue and supplier from your catalog." });
    if (!cat.active) return res.status(400).json({ error: "That tissue type is retired on your catalog." });
    const sourceId = cleanStr(b.source_id, 120);
    const key = tissueIdKey(sourceId);
    if (!sourceId || !key) return res.status(400).json({ error: "Enter the tissue ID from the supplier's label." });
    if (!isYmd(b.expiration_date)) return res.status(400).json({ error: "Enter the expiration date." });
    const timeErr = stepTimeError(b.received_mm_date, b.received_mm_time, "Received in Materials Management", today);
    if (timeErr) return res.status(400).json({ error: timeErr });
    const mmBy = cleanStr(b.received_mm_by);
    if (!mmBy) return res.status(400).json({ error: "Received in Materials Management: enter who received it." });
    const existing = sqlite.prepare("SELECT id FROM tissue_units WHERE lab_id = ? AND vendor_id = ? AND source_id_key = ?").get(labId, cat.vendor_id, key) as any;
    if (existing) return res.status(409).json({ error: `Tissue ID ${sourceId} from ${cat.supplier_name} is already on this log.`, code: "DUPLICATE_TISSUE_ID", unit_id: existing.id });
    const mm = { received_mm_date: b.received_mm_date, received_mm_time: b.received_mm_time };
    let bb: { error?: string; set?: Record<string, unknown>; checks?: unknown } | null = null;
    if (b.receive_bb && typeof b.receive_bb === "object") {
      bb = blockBbFields(sqlite, labId, b.receive_bb, mm, today);
      if (bb.error) return res.status(400).json({ error: bb.error });
    }
    const nowIso = new Date().toISOString();
    const id = sqlite.transaction(() => {
      const newId = Number(sqlite.prepare(
        `INSERT INTO tissue_units (lab_id, catalog_id, vendor_id, tissue_type, supplier_name, source_id, source_id_key, quantity_or_size, expiration_date, state,
           received_mm_date, received_mm_time, received_mm_by, notes, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received_mm', ?, ?, ?, ?, ?, ?, ?)`
      ).run(labId, cat.id, cat.vendor_id, cat.tissue_type, cat.supplier_name, sourceId, key, cleanStr(b.quantity_or_size), b.expiration_date,
        b.received_mm_date, b.received_mm_time, mmBy, cleanStr(b.notes, 2000), req.userId, nowIso, nowIso).lastInsertRowid);
      addEvent(sqlite, req, newId, labId, "received_mm", { date: b.received_mm_date, time: b.received_mm_time, by: mmBy });
      if (bb?.set) {
        applySet(sqlite, newId, bb.set);
        addEvent(sqlite, req, newId, labId, "received_bb", { date: b.receive_bb.received_bb_date, time: b.receive_bb.received_bb_time, by: bb.set.received_bb_by as string, checks: bb.checks });
      }
      return newId;
    })();
    audit(req, id, `Tissue received: ${cat.tissue_type}, ID ${sourceId}`, { source_id: sourceId });
    res.status(201).json(decorateTissueUnit(fetchUnit(sqlite, id, labId), today));
  });

  // A loaded unit in this lab that isn't final yet, or the refusal already sent.
  const openUnit = (req: any, res: any) => {
    const u = fetchUnit(sqliteOf(), Number(req.params.id), req.scope.labId);
    if (!u) { res.status(404).json({ error: "That unit isn't on this lab's log" }); return null; }
    if (isFinalState(u.state)) { res.status(409).json({ error: finalRefusal(u), code: "UNIT_FINAL" }); return null; }
    return u;
  };

  app.post(`${BASE}/units/:id/receive-bb`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = openUnit(req, res);
    if (!u) return;
    if (u.state !== "received_mm") return res.status(409).json({ error: "The blood bank receipt is already recorded." });
    const today = labToday();
    const b = req.body || {};
    const bb = blockBbFields(sqlite, u.lab_id, b, u, today);
    if (bb.error) return res.status(400).json({ error: bb.error });
    sqlite.transaction(() => {
      applySet(sqlite, u.id, bb.set!);
      addEvent(sqlite, req, u.id, u.lab_id, "received_bb", { date: b.received_bb_date, time: b.received_bb_time, by: bb.set!.received_bb_by as string, checks: bb.checks });
    })();
    audit(req, u.id, `Tissue received in blood bank: ID ${u.source_id}`);
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Issue from storage: refused with the reason on an expired unit or any read-back that isn't yes ─────────────
  app.post(`${BASE}/units/:id/issue`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = openUnit(req, res);
    if (!u) return;
    const b = req.body || {};
    const today = labToday();
    if (b.issued_date != null && b.issued_date !== "" && !isYmd(b.issued_date)) return res.status(400).json({ error: "Issued: enter the date." });
    const reasons = issueRefusals(u, { issued_date: b.issued_date || null, readback_id: b.readback_id, readback_expiration: b.readback_expiration, readback_integrity: b.readback_integrity }, today);
    if (reasons.length) return res.status(409).json({ error: reasons.join(" "), code: "ISSUE_REFUSED", reasons });
    const timeErr = stepTimeError(b.issued_date, b.issued_time, "Issued", today);
    if (timeErr) return res.status(400).json({ error: timeErr });
    const physician = cleanStr(b.requesting_physician);
    const issuedTo = cleanStr(b.issued_to);
    const tech = cleanStr(b.issued_by_tech);
    const deliveredTo = cleanStr(b.delivered_to);
    if (!physician) return res.status(400).json({ error: "Enter the requesting physician." });
    if (!issuedTo) return res.status(400).json({ error: "Enter who it was issued to (the courier)." });
    if (!tech) return res.status(400).json({ error: "Enter the tech issuing." });
    if (!deliveredTo) return res.status(400).json({ error: "Enter where it was delivered: the room or department." });
    if (isBefore(b.issued_date, b.issued_time, u.received_bb_date, u.received_bb_time)) return res.status(400).json({ error: "The issue can't be earlier than the blood bank receipt." });
    // Issued again after a return to storage: not before it came back.
    const back = lastLiveReturn(unitEvents(sqlite, u.id));
    if (back && isBefore(b.issued_date, b.issued_time, back.event_date, back.event_time)) return res.status(400).json({ error: "The issue can't be earlier than the unit's return to blood bank storage." });
    sqlite.transaction(() => {
      applySet(sqlite, u.id, {
        issued_date: b.issued_date, issued_time: b.issued_time, requesting_physician: physician, issued_to: issuedTo, issued_by_tech: tech, delivered_to: deliveredTo,
        readback_id_ok: 1, readback_expiration_ok: 1, readback_integrity_ok: 1, state: "issued",
      });
      addEvent(sqlite, req, u.id, u.lab_id, "issued", { date: b.issued_date, time: b.issued_time, by: tech, checks: { readback_id: 1, readback_expiration: 1, readback_integrity: 1 }, detail: { requesting_physician: physician, issued_to: issuedTo, delivered_to: deliveredTo } });
    })();
    audit(req, u.id, `Tissue issued: ID ${u.source_id}`);
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Implant ───────────────────────────────────────────────────────────
  app.post(`${BASE}/units/:id/implant`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = openUnit(req, res);
    if (!u) return;
    if (u.state !== "issued") return res.status(409).json({ error: "Only an issued unit can be implanted. Issue it from storage first." });
    const b = req.body || {};
    const today = labToday();
    const timeErr = stepTimeError(b.implanted_date, b.implanted_time, "Implanted", today);
    if (timeErr) return res.status(400).json({ error: timeErr });
    const by = cleanStr(b.implanted_by);
    if (!by) return res.status(400).json({ error: "Enter who implanted it." });
    if (isBefore(b.implanted_date, b.implanted_time, u.issued_date, u.issued_time)) return res.status(400).json({ error: "The implant can't be earlier than the issue." });
    const recon = reconstitutionFields(b);
    if (recon.error) return res.status(400).json({ error: recon.error });
    let card: { error?: string; set?: Record<string, unknown> } = { set: {} };
    if (b.usage_card_returned !== undefined && b.usage_card_returned !== null && b.usage_card_returned !== "") {
      card = usageCardFields(b, b.implanted_date, today);
      if (card.error) return res.status(400).json({ error: card.error });
    }
    sqlite.transaction(() => {
      applySet(sqlite, u.id, { implanted_date: b.implanted_date, implanted_time: b.implanted_time, implanted_by: by, ...recon.set, ...card.set, state: "implanted" });
      addEvent(sqlite, req, u.id, u.lab_id, "implanted", { date: b.implanted_date, time: b.implanted_time, by, detail: { ...recon.set, ...card.set } });
    })();
    audit(req, u.id, `Tissue implanted: ID ${u.source_id}`);
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // The tissue usage card: filled in on paper by the hospital. We record only that it went back, and when.
  app.post(`${BASE}/units/:id/usage-card`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = fetchUnit(sqlite, Number(req.params.id), req.scope.labId);
    if (!u) return res.status(404).json({ error: "That unit isn't on this lab's log" });
    if (u.state !== "implanted") return res.status(409).json({ error: "The tissue usage card is recorded after the implant." });
    const today = labToday();
    const card = usageCardFields(req.body || {}, u.implanted_date, today);
    if (card.error) return res.status(400).json({ error: card.error });
    sqlite.transaction(() => {
      applySet(sqlite, u.id, card.set!);
      addEvent(sqlite, req, u.id, u.lab_id, "usage_card", { date: (card.set!.usage_card_returned_on as string) ?? null, checks: { usage_card_returned: card.set!.usage_card_returned } });
    })();
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Returned unused (Michael 2026-11-09): issued, not implanted, and back in blood bank storage, so it can be issued again. ──
  // Both checks must be yes; a no is a unit that can't go back on the shelf, recorded as an Other disposition instead. The issue
  // fields move off the row into the event (the issue route and issueRefusals then take a second issue), and the receipt stays.
  // A unit past its expiration can still be returned: that's a fact, and the issue route then refuses to issue it again.
  app.post(`${BASE}/units/:id/return-unused`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = openUnit(req, res);
    if (!u) return;
    if (u.state !== "issued") return res.status(409).json({ error: "Only an issued unit can be returned to storage unused. This unit isn't out on issue.", code: "NOT_ISSUED" });
    const b = req.body || {};
    const today = labToday();
    const storageOk = yesNo(b.storage_ok);
    const packageOk = yesNo(b.package_ok_on_return);
    if (storageOk === null) return res.status(400).json({ error: "Storage conditions maintained while out of blood bank: answer yes or no." });
    if (packageOk === null) return res.status(400).json({ error: "Package integrity acceptable on return: answer yes or no." });
    const refusal = returnUnusedRefusal(storageOk, packageOk);
    if (refusal) return res.status(400).json({ error: refusal, code: "RETURN_NOT_ACCEPTABLE" });
    const timeErr = stepTimeError(b.returned_date, b.returned_time, "Returned to blood bank", today);
    if (timeErr) return res.status(400).json({ error: timeErr });
    const returnedBy = cleanStr(b.returned_by);
    const receivedBackBy = cleanStr(b.received_back_by);
    if (!returnedBy) return res.status(400).json({ error: "Enter who brought it back." });
    if (!receivedBackBy) return res.status(400).json({ error: "Enter who received it back in the blood bank." });
    if (isBefore(b.returned_date, b.returned_time, u.issued_date, u.issued_time)) return res.status(400).json({ error: "The return can't be earlier than the issue." });
    const storage = storageFields(sqlite, u.lab_id, b);
    if (storage.error) return res.status(400).json({ error: storage.error });
    const note = cleanStr(b.note, 1000);
    const clearedIssue = Object.fromEntries(ISSUE_ROW_FIELDS.map((f) => [f, u[f] ?? null]));
    const storageBefore = { storage_unit_id: u.storage_unit_id ?? null, storage_location: u.storage_location ?? null };
    sqlite.transaction(() => {
      applySet(sqlite, u.id, { ...Object.fromEntries(ISSUE_ROW_FIELDS.map((f) => [f, null])), ...storage.set, state: "stored" });
      addEvent(sqlite, req, u.id, u.lab_id, "returned_unused", {
        date: b.returned_date, time: b.returned_time, by: receivedBackBy, checks: { storage_ok: storageOk, package_ok_on_return: packageOk },
        detail: {
          cleared_issue: clearedIssue, storage_before: storageBefore,
          returned_date: b.returned_date, returned_time: b.returned_time, returned_by: returnedBy, received_back_by: receivedBackBy,
          storage_ok: storageOk, package_ok_on_return: packageOk, ...storage.set, note,
        },
      });
    })();
    audit(req, u.id, `Tissue returned unused to blood bank: ID ${u.source_id}`, { returned_date: b.returned_date, returned_time: b.returned_time, ...storage.set }, { state: "issued", ...clearedIssue });
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Other disposition: wasted, returned to supplier or expired ─────────
  app.post(`${BASE}/units/:id/dispose`, ...record, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = openUnit(req, res);
    if (!u) return;
    const b = req.body || {};
    if (!(OTHER_DISPOSITIONS as readonly string[]).includes(b.kind)) return res.status(400).json({ error: "Choose wasted, returned to supplier or expired." });
    const today = labToday();
    const timeErr = stepTimeError(b.disposition_date, b.disposition_time, "Disposition", today);
    if (timeErr) return res.status(400).json({ error: timeErr });
    const description = cleanStr(b.disposition_description, 1000);
    const by = cleanStr(b.disposition_by);
    if (!description) return res.status(400).json({ error: "Describe the disposition." });
    if (!by) return res.status(400).json({ error: "Enter who performed it." });
    // Back in storage after a return: the return is the step before this one.
    const back = u.issued_date ? null : lastLiveReturn(unitEvents(sqlite, u.id));
    const lastDate = u.issued_date || back?.event_date || u.received_bb_date || u.received_mm_date;
    const lastTime = u.issued_date ? u.issued_time : back ? back.event_time : u.received_bb_date ? u.received_bb_time : u.received_mm_time;
    if (isBefore(b.disposition_date, b.disposition_time, lastDate, lastTime)) return res.status(400).json({ error: "The disposition can't be earlier than the step before it." });
    sqlite.transaction(() => {
      applySet(sqlite, u.id, { disposition_date: b.disposition_date, disposition_time: b.disposition_time, disposition_description: description, disposition_by: by, state: b.kind });
      addEvent(sqlite, req, u.id, u.lab_id, "other_disposition", { date: b.disposition_date, time: b.disposition_time, by, detail: { kind: b.kind, description, from_state: u.state } });
    })();
    audit(req, u.id, `Tissue disposition (${b.kind}): ID ${u.source_id}`);
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Correction: changes a recorded value, with a required reason. The history keeps both values. ───────────────
  const REQUIRED_TEXT = new Set(["source_id", "received_mm_by", "received_bb_by", "requesting_physician", "issued_to", "issued_by_tech", "delivered_to", "implanted_by", "disposition_description", "disposition_by"]);
  const DATE_FIELDS = new Set(["received_mm_date", "received_bb_date", "issued_date", "implanted_date", "disposition_date"]);
  const TIME_FIELDS = new Set(["received_mm_time", "received_bb_time", "issued_time", "implanted_time", "disposition_time"]);

  app.post(`${BASE}/units/:id/correct`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = fetchUnit(sqlite, Number(req.params.id), req.scope.labId);
    if (!u) return res.status(404).json({ error: "That unit isn't on this lab's log" });
    const reason = cleanStr(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: "A correction needs a reason." });
    const changes = req.body?.changes;
    if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) return res.status(400).json({ error: "Nothing to correct." });
    const allowed = new Set(correctableFields(u));
    const today = labToday();
    const set: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(changes as Record<string, unknown>)) {
      if (!allowed.has(field)) return res.status(400).json({ error: `${field} can't be corrected on this unit.` });
      if (field === "transport_temp_ok" || field === "package_ok") {
        const v = yesNo(raw);
        if (v === null) return res.status(400).json({ error: "Answer yes or no." });
        set[field] = v;
      } else if (DATE_FIELDS.has(field) || field === "expiration_date") {
        if (!isYmd(raw)) return res.status(400).json({ error: "Enter a date." });
        if (DATE_FIELDS.has(field) && raw > today) return res.status(400).json({ error: "The date can't be in the future." });
        set[field] = raw;
      } else if (TIME_FIELDS.has(field)) {
        if (!isHhMm(raw)) return res.status(400).json({ error: "Enter a time." });
        set[field] = raw;
      } else if (field === "storage_unit_id") {
        if (raw == null || raw === "") set[field] = null;
        else {
          if (!sqlite.prepare("SELECT id FROM temp_log_units WHERE id = ? AND lab_id = ?").get(Number(raw), u.lab_id)) return res.status(400).json({ error: "That storage unit isn't in this lab." });
          set[field] = Number(raw);
        }
      } else {
        const v = cleanStr(raw, field === "notes" ? 2000 : field === "transport_action" || field === "disposition_description" ? 1000 : 200);
        if (!v && REQUIRED_TEXT.has(field)) return res.status(400).json({ error: "That field can't be blank." });
        set[field] = v;
      }
    }
    const merged = { ...u, ...set };
    if ("source_id" in set) {
      merged.source_id_key = tissueIdKey(merged.source_id);
      set.source_id_key = merged.source_id_key;
      if (!merged.source_id_key) return res.status(400).json({ error: "Enter the tissue ID from the supplier's label." });
      const clash = sqlite.prepare("SELECT id FROM tissue_units WHERE lab_id = ? AND vendor_id = ? AND source_id_key = ? AND id <> ?").get(u.lab_id, u.vendor_id, merged.source_id_key, u.id);
      if (clash) return res.status(409).json({ error: `Tissue ID ${merged.source_id} from ${u.supplier_name} is already on this log.`, code: "DUPLICATE_TISSUE_ID" });
    }
    // What the record becomes has to hold, the same as if it had been entered that way.
    if (merged.issued_date && merged.issued_date > merged.expiration_date) return res.status(409).json({ error: `That would put the issue after the unit's expiration on ${merged.expiration_date}. An expired unit can't be issued.`, code: "ISSUE_REFUSED" });
    if ((merged.transport_temp_ok === 0 || merged.package_ok === 0) && !merged.transport_action) return res.status(400).json({ error: "A no at receipt needs the action taken." });
    if (merged.received_bb_date && !merged.storage_unit_id && !merged.storage_location) return res.status(400).json({ error: "Say where the unit is stored: pick a storage unit or enter a location." });
    // A return to storage that still stands sits between the blood bank receipt and any issue after it.
    const back = lastLiveReturn(unitEvents(sqlite, u.id));
    const order: [string | null, string | null][] = [
      [merged.received_mm_date, merged.received_mm_time], [merged.received_bb_date, merged.received_bb_time], [back?.event_date ?? null, back?.event_time ?? null],
      [merged.issued_date, merged.issued_time], [merged.implanted_date ?? merged.disposition_date, merged.implanted_date ? merged.implanted_time : merged.disposition_time],
    ];
    const steps = order.filter(([d]) => !!d);
    for (let i = 1; i < steps.length; i++) {
      if (isBefore(steps[i][0], steps[i][1], steps[i - 1][0], steps[i - 1][1])) return res.status(400).json({ error: "That would put a step before the one it follows." });
    }
    const recorded = Object.keys(set).filter((k) => k !== "source_id_key");
    const diff = recorded.filter((k) => String(set[k] ?? "") !== String(u[k] ?? "")).map((field) => ({ field, from: u[field] ?? null, to: set[field] ?? null }));
    if (diff.length === 0) return res.status(400).json({ error: "Nothing changed." });
    sqlite.transaction(() => {
      applySet(sqlite, u.id, set);
      addEvent(sqlite, req, u.id, u.lab_id, "corrected", { detail: { reason, changes: diff } });
    })();
    audit(req, u.id, `Tissue record corrected: ID ${merged.source_id}`, { reason, fields: diff.map((d) => d.field) });
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Undo last step: a step recorded by mistake, with a required reason. The history keeps what was cleared. ──────
  const UNDO: Record<string, string[]> = {
    stored: ["received_bb_date", "received_bb_time", "received_bb_by", "transport_temp_ok", "transport_action", "package_ok", "storage_unit_id", "storage_location"],
    issued: [...ISSUE_ROW_FIELDS],
    implanted: ["implanted_date", "implanted_time", "implanted_by", "reconstituted_time", "reconstituted_by", "reconstitution_solution", "reconstitution_lot", "reconstitution_expiration", "usage_card_returned", "usage_card_returned_on"],
    disposition: ["disposition_date", "disposition_time", "disposition_description", "disposition_by"],
  };

  app.post(`${BASE}/units/:id/undo`, ...edit, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const u = fetchUnit(sqlite, Number(req.params.id), req.scope.labId);
    if (!u) return res.status(404).json({ error: "That unit isn't on this lab's log" });
    const reason = cleanStr(req.body?.reason, 500);
    if (!reason) return res.status(400).json({ error: "Undoing a step needs a reason." });
    if (u.state === "received_mm") return res.status(409).json({ error: "The first receipt can't be undone. Correct it, or record what happened to the unit as another disposition.", code: "NOTHING_TO_UNDO" });
    const today = labToday();
    // The step being taken back is the latest one still standing in the event chain (an undone step is gone).
    const steps = liveSteps(unitEvents(sqlite, u.id));
    const top = steps[steps.length - 1] || null;
    // A return to storage: back out on issue, with the issue fields and the storage it had before, from the return's own event.
    // Without this, undo on a stored unit would clear its blood bank receipt.
    if (u.state === "stored" && top?.event_type === "returned_unused") {
      const d = parseDetail(top);
      if (!d.cleared_issue?.issued_date) return res.status(409).json({ error: "This return's record doesn't hold the issue it came back from, so it can't be undone here. Correct the record instead.", code: "RETURN_DETAIL_MISSING" });
      const restored: Record<string, unknown> = Object.fromEntries(ISSUE_ROW_FIELDS.map((f) => [f, d.cleared_issue[f] ?? null]));
      if (d.storage_before) Object.assign(restored, { storage_unit_id: d.storage_before.storage_unit_id ?? null, storage_location: d.storage_before.storage_location ?? null });
      const cleared = { storage_unit_id: u.storage_unit_id ?? null, storage_location: u.storage_location ?? null };
      sqlite.transaction(() => {
        applySet(sqlite, u.id, { ...restored, state: "issued" });
        addEvent(sqlite, req, u.id, u.lab_id, "undone", { detail: { reason, from_state: u.state, to_state: "issued", undid_event_id: top.id, undid: "returned_unused", cleared, restored } });
      })();
      audit(req, u.id, `Tissue step undone: ID ${u.source_id}`, { reason, from_state: u.state, to_state: "issued", undid: "returned_unused" });
      return res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
    }
    const isOther = u.state === "wasted" || u.state === "returned" || u.state === "expired";
    const fields = isOther ? UNDO.disposition : UNDO[u.state];
    const back = u.state === "stored" ? "received_mm" : u.state === "issued" ? "stored" : u.state === "implanted" ? "issued" : u.issued_date ? "issued" : u.received_bb_date ? "stored" : "received_mm";
    const cleared = Object.fromEntries(fields.map((f) => [f, u[f] ?? null]));
    sqlite.transaction(() => {
      applySet(sqlite, u.id, { ...Object.fromEntries(fields.map((f) => [f, null])), state: back });
      addEvent(sqlite, req, u.id, u.lab_id, "undone", { detail: { reason, from_state: u.state, to_state: back, cleared, undid_event_id: top?.id ?? null } });
    })();
    audit(req, u.id, `Tissue step undone: ID ${u.source_id}`, { reason, from_state: u.state, to_state: back });
    res.json(decorateTissueUnit(fetchUnit(sqlite, u.id, u.lab_id), today));
  });

  // ── Veritas admin: the catalog load. x-admin-secret only. Dry run unless apply is true and go says who and when. ─
  const adminOnly = (req: any, res: any, next: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!adminSecret || !secret || secret !== adminSecret) return res.status(403).json({ error: "Forbidden" });
    next();
  };

  // Counts and product names, nothing else. No unit, surgeon or location ever comes out of this.
  app.get("/api/admin/veritastock/tissue/catalog-status", notOnStock, adminOnly, (req: any, res: any) => {
    const labId = Number(req.query.labId);
    if (!Number.isInteger(labId) || labId <= 0) return res.status(400).json({ error: "labId required" });
    const out = tissueCatalogStatus(sqliteOf(), labId);
    if (!out) return res.status(404).json({ error: "Lab not found" });
    res.json(out);
  });

  app.post("/api/admin/veritastock/tissue/catalog-load", notOnStock, adminOnly, noPhi, (req: any, res: any) => {
    const sqlite = sqliteOf();
    const b = req.body || {};
    const labId = Number(b.labId);
    if (!Number.isInteger(labId) || labId <= 0) return res.status(400).json({ error: "labId required" });
    const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
    if (!lab) return res.status(404).json({ error: "Lab not found" });
    if (!Array.isArray(b.rows) || b.rows.length === 0 || b.rows.length > 1000) return res.status(400).json({ error: "rows required: 1 to 1000 of { tissue_type, supplier }" });
    const go = cleanStr(b.go, 200);
    const apply = b.apply === true;
    if (apply && !go) return res.status(400).json({ error: "apply needs go: who said so, and when" });
    const result = loadTissueCatalog(sqlite, labId, b.rows, apply);
    if (apply) {
      try {
        logAudit({ userId: lab.owner_user_id, ownerUserId: lab.owner_user_id, module: "veritastock", action: "create", entityType: "tissue_catalog", entityId: labId,
          entityLabel: `Tissue catalog load: ${result.to_add} added, ${result.already_on_file} already on file`, after: { go, to_add: result.to_add, new_suppliers: result.new_suppliers } });
      } catch { /* best-effort */ }
    }
    res.json({ ok: true, dry_run: !apply, lab: { id: lab.id, lab_name: lab.lab_name }, ...result });
  });
}
