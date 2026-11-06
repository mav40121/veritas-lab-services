// server/stainLog.ts
//
// VeritaMaintain stain log (Michael Q178 = 1, 2026-11-06). Two records on the existing module, reusing what's there:
//   - A month grid per instrument. An instrument is a lab_equipment row. The lab sets its own rows on it (stains, rinses, checks), and each
//     day's cell holds codes: D dumped, C changed or re-filled, F filtered, TO topped off, R rotated, or Acceptable / Problem on a check. A
//     change to a stain carries its lot and expiration.
//   - A list-style manual stain log, one line per stain, with no specimen number (shared/stainLogRules.ts has why).
// Entries are never edited: a mistake is voided with a reason and stays on the record, and a void after a review shows as added after it.
// The monthly review stays server/maintainRecordReview.ts: this file feeds it what the month shows (instrumentStainMonth, manualStainMonth),
// so there's one review, one signature and one report. The rules live in shared/stainLogRules.ts.
//
// Access is the temperature logs' split: setup needs VeritaMaintain edit; recording is open to every active member, Staff logins included.
// Every read and write is scoped to req.scope.labId. A limited Staff login reads initials, as on the paper form, but not a coworker's name.
import type { Express } from "express";
import { db } from "./db";
import { labLocalDate } from "./dateLocal";
import { logAudit } from "./audit";
import { exportAllPlanBypass } from "./exportAllContext";
import { staffOwnScope } from "./competencySelfEntry";
import {
  cleanInitials, cleanManualEntry, cleanRow, findStainPhi, isYmd, lastOfMonth, manualMonthFindings, planRowEntries, rowShownInMonth, stainMonthFindings, stainPhiMessage,
  type FindingEntry, type FindingRow, type PlannedEntry,
} from "../shared/stainLogRules";

export const MANUAL_ITEM_TYPE = "stain_manual";

const isMonth = (v: any): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const labToday = () => labLocalDate(new Date().toISOString());

// Same explicit plan allowlist as VeritaMaintain equipment and temperature logs.
function hasStainLogAccess(user: any, lab?: any): boolean {
  if (exportAllPlanBypass(lab)) return true;
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

function rowsOf(sqlite: any, labId: number, equipmentId: number): FindingRow[] {
  return sqlite.prepare(
    `SELECT r.*, (SELECT MIN(log_date) FROM stain_log_entries e WHERE e.row_id = r.id AND e.lab_id = r.lab_id AND e.voided_at IS NULL) AS first_entry_day,
            (SELECT COUNT(*) FROM stain_log_entries e WHERE e.row_id = r.id AND e.lab_id = r.lab_id) AS entry_count
       FROM stain_log_rows r WHERE r.lab_id = ? AND r.equipment_id = ? ORDER BY r.sort_order, r.id`
  ).all(labId, equipmentId) as any[];
}

function monthEntries(sqlite: any, labId: number, equipmentId: number, month: string): any[] {
  return sqlite.prepare(
    "SELECT * FROM stain_log_entries WHERE lab_id = ? AND equipment_id = ? AND substr(log_date, 1, 7) = ? ORDER BY log_date, id"
  ).all(labId, equipmentId, month) as any[];
}

/** Per row, the last live change before the month, so a lot put in last month and expiring this month is still seen. */
function priorChangesOf(sqlite: any, labId: number, equipmentId: number, month: string): FindingEntry[] {
  const first = `${month}-01`;
  return sqlite.prepare(
    `SELECT e.* FROM stain_log_entries e
      WHERE e.lab_id = ? AND e.equipment_id = ? AND e.code = 'C' AND e.voided_at IS NULL AND e.log_date < ?
        AND e.id = (SELECT x.id FROM stain_log_entries x
                     WHERE x.row_id = e.row_id AND x.lab_id = e.lab_id AND x.code = 'C' AND x.voided_at IS NULL AND x.log_date < ?
                     ORDER BY x.log_date DESC, x.id DESC LIMIT 1)`
  ).all(labId, equipmentId, first, first) as any[];
}

/** One instrument's stain log for a month, for the grid and for the monthly review. Empty for an instrument with no stain log. */
export function instrumentStainMonth(sqlite: any, labId: number, equipmentId: number, month: string, today: string) {
  const rows = rowsOf(sqlite, labId, equipmentId);
  const all = monthEntries(sqlite, labId, equipmentId, month);
  const live = all.filter((e) => !e.voided_at);
  const voided = all.filter((e) => e.voided_at);
  const withEntries = new Set(all.map((e) => e.row_id));
  const shown = rows.filter((r) => rowShownInMonth(r, month, withEntries.has(r.id)));
  const findings = stainMonthFindings({ rows: shown, entries: live, priorChanges: priorChangesOf(sqlite, labId, equipmentId, month), voided: voided.length, month, today });
  return {
    rows: shown, all_rows: rows, entries: live, voided, findings,
    has_log: rows.length > 0 || all.length > 0,
    // When anything was added or voided, so a change after signing shows as added after the review.
    entry_times: [...all.map((e) => e.created_at), ...voided.map((e) => e.voided_at)],
  };
}

/** The lab's manual stain log for a month, for its page and for the monthly review. */
export function manualStainMonth(sqlite: any, labId: number, month: string) {
  const all = sqlite.prepare("SELECT * FROM stain_manual_entries WHERE lab_id = ? AND substr(log_date, 1, 7) = ? ORDER BY log_date, id").all(labId, month) as any[];
  const live = all.filter((e) => !e.voided_at);
  const voided = all.filter((e) => e.voided_at);
  const findings = manualMonthFindings(live, voided.length);
  return { entries: live, voided, notes: findings.notes, summary: findings.summary, has_entries: all.length > 0, entry_times: [...all.map((e) => e.created_at), ...voided.map((e) => e.voided_at)] };
}

export function registerStainLogRoutes(
  app: Express,
  authMiddleware: any,
  requireWriteAccess: any,
  requireModuleEdit: (mod: string) => any,
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean,
) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerStainLogRoutes: labScopeMiddleware not registered");
  const sqlite = () => (db as any).$client;
  const planGate = (req: any, res: any, next: any) => {
    if (hasStainLogAccess(req.user, req.scope?.lab)) return next();
    res.status(403).json({ error: "The stain log requires a suite subscription" });
  };
  // Every write refuses what looks like patient information, where the platform guard only warns: these fields never hold a patient.
  const noPhi = (req: any, res: any, next: any) => {
    const hit = findStainPhi(req.body);
    if (hit) return res.status(400).json({ error: stainPhiMessage(hit.labels), code: "PHI_REFUSED", field: hit.field, labels: hit.labels });
    next();
  };
  const read = [authMiddleware, labScopeMiddleware, planGate];
  const record = [authMiddleware, labScopeMiddleware, requireWriteAccess, planGate, noPhi];
  const setup = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritamaintain"), planGate, noPhi];

  const userName = (userId: number): string | null => {
    const u = sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any;
    return u ? (u.name || u.email || null) : null;
  };
  const equipmentIn = (labId: number, raw: unknown) => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? (sqlite().prepare("SELECT * FROM lab_equipment WHERE id = ? AND lab_id = ?").get(id, labId) as any) : null;
  };
  const rowIn = (labId: number, equipmentId: number, raw: unknown) => {
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? (sqlite().prepare("SELECT * FROM stain_log_rows WHERE id = ? AND lab_id = ? AND equipment_id = ?").get(id, labId, equipmentId) as any) : null;
  };
  const monthFrom = (req: any, res: any): string | null => {
    const today = labToday();
    const month = isMonth(req.query.month) ? req.query.month : today.slice(0, 7);
    if (month > today.slice(0, 7)) { res.status(400).json({ error: "That month hasn't started" }); return null; }
    return month;
  };
  const dateProblem = (date: string, today: string): string | null => {
    if (!isYmd(date)) return "Pick the date";
    if (date > today) return "The date can't be in the future";
    return null;
  };
  // A limited Staff login reads the initials, as on the paper form, and only its own name. Everyone else with access reads the names.
  const namesFor = (req: any) => {
    const limited = staffOwnScope(sqlite(), req.userId, req.scope.labId, "veritamaintain");
    return <T extends Record<string, any>>(e: T): T => {
      if (!limited) return e;
      return {
        ...e,
        recorded_by_name: e.recorded_by_user_id === req.userId ? e.recorded_by_name : null,
        voided_by_name: e.voided_by_user_id === req.userId ? e.voided_by_name : null,
      };
    };
  };
  const auditOf = (req: any, action: string, entityType: string, entityId: number, label: string, detail: any) => logAudit({
    userId: req.userId,
    ownerUserId: req.scope?.lab?.owner_user_id,
    module: "veritamaintain",
    action,
    entityType,
    entityId,
    entityLabel: label,
    after: { ...detail, lab_id: req.scope.labId },
  } as any);

  // The instruments, with how much of a stain log each has.
  app.get("/api/labs/:labId/stain-log", ...read, (req: any, res: any) => {
    const labId = req.scope.labId;
    const today = labToday();
    const db0 = sqlite();
    const counts = new Map((db0.prepare("SELECT equipment_id, COUNT(*) AS n FROM stain_log_rows WHERE lab_id = ? AND active = 1 GROUP BY equipment_id").all(labId) as any[]).map((r) => [r.equipment_id, r.n]));
    const todays = new Map((db0.prepare("SELECT equipment_id, COUNT(*) AS n FROM stain_log_entries WHERE lab_id = ? AND log_date = ? AND voided_at IS NULL GROUP BY equipment_id").all(labId, today) as any[]).map((r) => [r.equipment_id, r.n]));
    const equipment = db0.prepare("SELECT id, instrument_name, location, status FROM lab_equipment WHERE lab_id = ? ORDER BY instrument_name").all(labId) as any[];
    const manual = db0.prepare("SELECT COUNT(*) AS n FROM stain_manual_entries WHERE lab_id = ? AND substr(log_date, 1, 7) = ? AND voided_at IS NULL").get(labId, today.slice(0, 7)) as any;
    res.json({
      today,
      can_setup: hasModuleEditAccess(labId, req.userId, "veritamaintain"),
      manual_this_month: manual?.n ?? 0,
      instruments: equipment
        .map((e) => ({ id: e.id, name: e.instrument_name, location: e.location, status: e.status, rows: counts.get(e.id) ?? 0, entries_today: todays.get(e.id) ?? 0 }))
        .filter((e) => e.status === "active" || e.rows > 0),
    });
  });

  // ── Manual stain log (registered before /:equipmentId so "manual" isn't read as an instrument) ──
  app.get("/api/labs/:labId/stain-log/manual", ...read, (req: any, res: any) => {
    const month = monthFrom(req, res);
    if (!month) return;
    const labId = req.scope.labId;
    const m = manualStainMonth(sqlite(), labId, month);
    const lab = sqlite().prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
    const r = sqlite().prepare("SELECT typed_signature, capacity_label, signed_at, corrective_action FROM maintain_record_reviews WHERE lab_id = ? AND period = ? AND item_type = ? AND item_id = ?").get(labId, month, MANUAL_ITEM_TYPE, labId) as any;
    const names = namesFor(req);
    res.json({ month, today: labToday(), lab: { name: lab?.lab_name ?? null, clia: lab?.clia_number ?? null }, entries: m.entries.map(names), voided: m.voided.map(names), notes: m.notes, review: r ?? null });
  });

  app.post("/api/labs/:labId/stain-log/manual", ...record, (req: any, res: any) => {
    const b = req.body || {};
    const clean = cleanManualEntry(b);
    if (clean.error) return res.status(400).json({ error: clean.error, code: clean.code });
    const entry = clean.entry!;
    const problem = dateProblem(entry.log_date, labToday());
    if (problem) return res.status(400).json({ error: problem, code: "BAD_DATE" });
    const initials = cleanInitials(b.initials);
    if (initials.error) return res.status(400).json({ error: initials.error, code: "INITIALS_REQUIRED" });
    const info = sqlite().prepare(
      `INSERT INTO stain_manual_entries (lab_id, log_date, specimen_type, result, test_slide, initials, comments, recorded_by_user_id, recorded_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.scope.labId, entry.log_date, entry.specimen_type, entry.result, entry.test_slide, initials.initials, entry.comments, req.userId, userName(req.userId), new Date().toISOString());
    res.status(201).json(sqlite().prepare("SELECT * FROM stain_manual_entries WHERE id = ?").get(info.lastInsertRowid));
  });

  // Their own entry, or anyone's with VeritaMaintain edit. The entry stays, marked voided, with the reason.
  const voidRoute = (table: "stain_log_entries" | "stain_manual_entries", entityType: string, find: (req: any) => any) => (req: any, res: any) => {
    const e = find(req);
    if (!e) return res.status(404).json({ error: "That entry isn't in this lab" });
    if (e.voided_at) return res.status(409).json({ error: "That entry is already voided", code: "ALREADY_VOIDED" });
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Enter why this entry is being voided", code: "REASON_REQUIRED" });
    if (reason.length > 500) return res.status(400).json({ error: "The reason is too long", code: "TOO_LONG" });
    if (e.recorded_by_user_id !== req.userId && !hasModuleEditAccess(req.scope.labId, req.userId, "veritamaintain")) {
      return res.status(403).json({ error: "Only the person who recorded it, or someone who can edit VeritaMaintain, can void an entry.", code: "NOT_YOUR_ENTRY" });
    }
    sqlite().prepare(`UPDATE ${table} SET voided_at = ?, voided_by_user_id = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND lab_id = ?`)
      .run(new Date().toISOString(), req.userId, userName(req.userId), reason, e.id, req.scope.labId);
    auditOf(req, "update", entityType, e.id, `Voided ${e.log_date}`, { voided: true, reason, log_date: e.log_date });
    res.json(sqlite().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(e.id));
  };
  app.post("/api/labs/:labId/stain-log/manual/:id/void", ...record, voidRoute("stain_manual_entries", "stain_manual_entry", (req) =>
    sqlite().prepare("SELECT * FROM stain_manual_entries WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId)));

  // ── One instrument's month grid ──
  app.get("/api/labs/:labId/stain-log/:equipmentId", ...read, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    const month = monthFrom(req, res);
    if (!month) return;
    const today = labToday();
    const db0 = sqlite();
    const m = instrumentStainMonth(db0, labId, eq.id, month, today);
    const lab = db0.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId) as any;
    const r = db0.prepare("SELECT typed_signature, capacity_label, signed_at, corrective_action FROM maintain_record_reviews WHERE lab_id = ? AND period = ? AND item_type = 'equipment' AND item_id = ?").get(labId, month, eq.id) as any;
    // Solution changes logged on the instrument's history before it had a stain log, or since: shown read-only so nothing is hidden.
    const history = db0.prepare("SELECT event_date, performed_by, notes FROM equipment_maintenance_events WHERE lab_id = ? AND equipment_id = ? AND event_type = 'solution_change' AND substr(event_date, 1, 7) = ? ORDER BY event_date, id").all(labId, eq.id, month);
    const lots = db0.prepare(
      `SELECT e.row_id, e.lot_number, e.expiration_date, e.log_date FROM stain_log_entries e
        WHERE e.lab_id = ? AND e.equipment_id = ? AND e.code = 'C' AND e.voided_at IS NULL AND e.lot_number IS NOT NULL AND e.log_date <= ?
        ORDER BY e.log_date, e.id`
    ).all(labId, eq.id, month < today.slice(0, 7) ? lastOfMonth(month) : today) as any[];
    const currentLot = new Map(lots.map((l) => [l.row_id, l]));
    const names = namesFor(req);
    res.json({
      month, today,
      lab: { name: lab?.lab_name ?? null, clia: lab?.clia_number ?? null },
      equipment: { id: eq.id, name: eq.instrument_name, location: eq.location, model: eq.model, serial_number: eq.serial_number, status: eq.status },
      rows: m.rows.map((row: any) => ({ ...row, current_lot: currentLot.get(row.id) ?? null })),
      all_rows: m.all_rows,
      entries: m.entries.map(names),
      voided: m.voided.map(names),
      problems: m.findings.problems,
      notes: m.findings.notes,
      used_days: m.findings.used_days,
      solution_events: history,
      review: r ?? null,
      can_setup: hasModuleEditAccess(labId, req.userId, "veritamaintain"),
    });
  });

  // ── Setup ──
  app.post("/api/labs/:labId/stain-log/:equipmentId/rows", ...setup, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    if (eq.status !== "active") return res.status(400).json({ error: "This instrument is retired" });
    const clean = cleanRow(req.body);
    if (clean.error) return res.status(400).json({ error: clean.error, code: "BAD_ROW" });
    const row = clean.row!;
    const next = (sqlite().prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM stain_log_rows WHERE lab_id = ? AND equipment_id = ?").get(labId, eq.id) as any).n;
    const now = new Date().toISOString();
    const info = sqlite().prepare(
      `INSERT INTO stain_log_rows (lab_id, equipment_id, name, row_kind, frequency, required_code, sort_order, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(labId, eq.id, row.name, row.row_kind, row.frequency, row.required_code, next, now, now);
    auditOf(req, "create", "stain_log_row", Number(info.lastInsertRowid), row.name, { equipment_id: eq.id, ...row });
    res.status(201).json(sqlite().prepare("SELECT * FROM stain_log_rows WHERE id = ?").get(info.lastInsertRowid));
  });

  // Put the rows in the lab's order. Registered before /rows/:rowId. The list must be exactly this instrument's rows.
  app.post("/api/labs/:labId/stain-log/:equipmentId/rows/order", ...setup, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    const have = (sqlite().prepare("SELECT id FROM stain_log_rows WHERE lab_id = ? AND equipment_id = ?").all(labId, eq.id) as any[]).map((r) => r.id);
    if (ids.length !== have.length || new Set(ids).size !== ids.length || ids.some((id: number) => !have.includes(id))) {
      return res.status(400).json({ error: "The list must hold each of this instrument's rows once", code: "BAD_ORDER" });
    }
    const set = sqlite().prepare("UPDATE stain_log_rows SET sort_order = ?, updated_at = ? WHERE id = ? AND lab_id = ?");
    const now = new Date().toISOString();
    sqlite().transaction(() => { ids.forEach((id: number, i: number) => set.run(i + 1, now, id, labId)); })();
    res.json({ ok: true });
  });

  app.put("/api/labs/:labId/stain-log/:equipmentId/rows/:rowId", ...setup, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    const row = rowIn(labId, eq.id, req.params.rowId);
    if (!row) return res.status(404).json({ error: "That row isn't on this instrument" });
    const b = req.body || {};
    const clean = cleanRow({ name: b.name ?? row.name, row_kind: b.row_kind ?? row.row_kind, frequency: b.frequency ?? row.frequency, required_code: b.required_code !== undefined ? b.required_code : row.required_code });
    if (clean.error) return res.status(400).json({ error: clean.error, code: "BAD_ROW" });
    const next = clean.row!;
    const held = (sqlite().prepare("SELECT COUNT(*) AS n FROM stain_log_entries WHERE row_id = ? AND lab_id = ?").get(row.id, labId) as any).n;
    // What a row is decides what its entries mean, so it stays what it was once anything is recorded on it.
    if (next.row_kind !== row.row_kind && held > 0) return res.status(409).json({ error: "This row has entries, so its type can't change. Retire it and add a new one.", code: "ROW_HAS_ENTRIES" });
    const active = b.active !== undefined ? (b.active ? 1 : 0) : row.active;
    const today = labToday();
    const retiredAt = active ? null : row.active ? today : row.retired_at;
    sqlite().prepare("UPDATE stain_log_rows SET name = ?, row_kind = ?, frequency = ?, required_code = ?, active = ?, retired_at = ?, updated_at = ? WHERE id = ? AND lab_id = ?")
      .run(next.name, next.row_kind, next.frequency, next.required_code, active, retiredAt, new Date().toISOString(), row.id, labId);
    auditOf(req, "update", "stain_log_row", row.id, next.name, { from: { name: row.name, frequency: row.frequency, required_code: row.required_code, active: row.active }, to: { ...next, active } });
    res.json(sqlite().prepare("SELECT * FROM stain_log_rows WHERE id = ?").get(row.id));
  });

  // A row nothing was recorded on can go. One with entries is retired instead: its records stay.
  app.delete("/api/labs/:labId/stain-log/:equipmentId/rows/:rowId", ...setup, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    const row = rowIn(labId, eq.id, req.params.rowId);
    if (!row) return res.status(404).json({ error: "That row isn't on this instrument" });
    const held = (sqlite().prepare("SELECT COUNT(*) AS n FROM stain_log_entries WHERE row_id = ? AND lab_id = ?").get(row.id, labId) as any).n;
    if (held > 0) return res.status(409).json({ error: `This row holds ${held} ${held === 1 ? "entry" : "entries"}, so it can't be removed. Retire it instead.`, code: "ROW_HAS_ENTRIES", entry_count: held });
    sqlite().prepare("DELETE FROM stain_log_rows WHERE id = ? AND lab_id = ?").run(row.id, labId);
    auditOf(req, "delete", "stain_log_row", row.id, row.name, { equipment_id: eq.id });
    res.json({ ok: true });
  });

  // ── Recording: one day, any number of rows, all or nothing ──
  app.post("/api/labs/:labId/stain-log/:equipmentId/entries", ...record, (req: any, res: any) => {
    const labId = req.scope.labId;
    const eq = equipmentIn(labId, req.params.equipmentId);
    if (!eq) return res.status(404).json({ error: "Instrument not found in this lab" });
    if (eq.status !== "active") return res.status(400).json({ error: "This instrument is retired" });
    const b = req.body || {};
    const logDate = String(b.log_date ?? "");
    const problem = dateProblem(logDate, labToday());
    if (problem) return res.status(400).json({ error: problem, code: "BAD_DATE" });
    const initials = cleanInitials(b.initials);
    if (initials.error) return res.status(400).json({ error: initials.error, code: "INITIALS_REQUIRED" });
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) return res.status(400).json({ error: "Mark at least one row", code: "NO_ITEMS" });
    const planned: { rowId: number; entry: PlannedEntry }[] = [];
    for (const item of items) {
      const row = rowIn(labId, eq.id, item?.row_id);
      if (!row) return res.status(404).json({ error: "One of those rows isn't on this instrument", code: "ROW_NOT_FOUND" });
      if (!row.active) return res.status(400).json({ error: `${row.name} is retired`, code: "ROW_RETIRED" });
      const plan = planRowEntries(row, item, logDate);
      if (plan.error) return res.status(400).json({ error: `${row.name}: ${plan.error}`, code: plan.code, row_id: row.id });
      for (const entry of plan.entries!) planned.push({ rowId: row.id, entry });
    }
    const insert = sqlite().prepare(
      `INSERT INTO stain_log_entries (lab_id, equipment_id, row_id, log_date, code, lot_number, expiration_date, lot_expired, initials, corrective_action, recorded_by_user_id, recorded_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    const name = userName(req.userId);
    sqlite().transaction(() => {
      for (const { rowId, entry } of planned) {
        insert.run(labId, eq.id, rowId, logDate, entry.code, entry.lot_number, entry.expiration_date, entry.lot_expired, initials.initials, entry.corrective_action, req.userId, name, now);
      }
    })();
    res.status(201).json({ ok: true, created: planned.length, log_date: logDate });
  });

  app.post("/api/labs/:labId/stain-log/:equipmentId/entries/:id/void", ...record, voidRoute("stain_log_entries", "stain_log_entry", (req) =>
    sqlite().prepare("SELECT * FROM stain_log_entries WHERE id = ? AND lab_id = ? AND equipment_id = ?").get(Number(req.params.id), req.scope.labId, Number(req.params.equipmentId))));
}
