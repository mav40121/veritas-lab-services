// server/veritaqaPi.ts
//
// VeritaQA: departments, indicators, monthly entries, the quality plan with its priorities and leadership reviews, and the
// dashboard (moved out of server/veritabench.ts in B15, where they belonged to the owner's account). They belong to a
// laboratory now (lab_id; server/veritaqaLabColumn.ts). A row with lab_id NULL is account-wide: it shows in every laboratory of
// the account it belongs to, labelled so, until someone assigns it to one (POST .../metrics/:id/assign).
//
// Two sets of routes over the same handlers:
//   /api/labs/:labId/veritaqa/pi/*   what the screen calls. A member of the laboratory reads it (a view-only seat or a Staff
//                                    login is refused, as VeritaQA always has); writes need VeritaQA edit in that laboratory.
//   /api/pi/*                        for someone with no laboratory to work in (a seat with no membership), as before: the
//                                    account's rows, cut to the laboratories the person reaches.
// A sister laboratory's rows are never in either (server/labAccessGuard.ts ownerRowInReach, Q191).
//
// A laboratory's own row always sits in one of its own departments, so a laboratory that changes hands keeps all of it.

import type { Express } from "express";
import { db } from "./db";
import { logAudit, type AuditAction } from "./audit";
import { hasOpsAccess } from "./veritabench";
import { blockNonOperatorSeat } from "./seatAccess";
import { ownerRowInReach } from "./labAccessGuard";
import { editSeatInLab } from "./seatContext";
import { staffOwnScope } from "./competencySelfEntry";
import { effectiveSeatPermission } from "@shared/seatEditRule";
import { storePdfToken } from "./pdfTokens";
import { generatePiReportPDF } from "./piReport";
import { labToday } from "./dateLocal";
import { onlyLabOfAccount } from "./veritaqaLabColumn";
import { orgEntryOf, orgMetricStates, withOrgDefinition } from "./orgQualityStore";
import { registerLabQualityReportRoutes } from "./labQualityReport";
import { registerQualityFindingRoutes } from "./qualityFindings";
import { ACCOUNT_WIDE_LABEL, entryMonths, indicatorStatus, monthKey, orgValue, rollPeriod, targetMet, versionForMonth, orgUnit, type OrgIndicatorKind } from "@shared/qualityIndicators";

export const QA_LAB_BASE = "/api/labs/:labId/veritaqa/pi";
const sqliteOf = () => (db as any).$client;

// ── Whose rows a request reads ──────────────────────────────────────────────

export type QaView =
  | { kind: "account"; userId: number; accountId: number }
  | { kind: "lab"; userId: number; labId: number; ownerId: number; wide: number[] };
export type QaLabView = Extract<QaView, { kind: "lab" }>;

/** The older routes: the account today's rule gives (the seat's owner, else the person). */
export const accountView = (req: any): QaView => ({ kind: "account", userId: Number(req.userId), accountId: Number(req.ownerUserId ?? req.userId) });
/** The laboratory in the path (set by the route's own gate, setLabView). */
export const labView = (req: any): QaLabView => req.qaLabView;

/**
 * `wide` is the accounts whose account-wide rows show in a laboratory to this person: the account they read before rows carried
 * a laboratory (their own, or their active seat's owner's; a Staff or view-only seat never opened it), and the laboratory's
 * owner's when they can edit VeritaQA here, since they may assign one of them to this laboratory. Nobody else gains them.
 */
function makeLabView(req: any, canEdit: boolean): QaLabView {
  const userId = Number(req.userId), ownerId = Number(req.scope.lab?.owner_user_id ?? req.userId);
  const before = !req.isSeatUser || String(req.seatType || "active") === "active" ? Number(req.ownerUserId ?? req.userId) : userId;
  return { kind: "lab", userId, labId: Number(req.scope.labId), ownerId, wide: [...new Set(canEdit ? [before, ownerId] : [before])] };
}

/** Account routes: may this person read rows of this laboratory, given that the account matched. */
function accountReachesLab(sqlite: any, v: Extract<QaView, { kind: "account" }>, labId: number): boolean {
  if (v.userId === v.accountId) {
    return !!sqlite.prepare("SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ? UNION SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1").get(labId, v.userId, labId, v.userId);
  }
  if (ownerRowInReach(sqlite, v.userId, v.accountId, labId)) return true;
  // A seat with no lab on it, under an owner whose only laboratory this is: there is no sister laboratory to cross into.
  const labs = sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ? LIMIT 2").all(v.accountId) as { id: number }[];
  return labs.length === 1 && Number(labs[0].id) === labId
    && !!sqlite.prepare("SELECT 1 FROM user_seats WHERE seat_user_id = ? AND owner_user_id = ? AND status = 'active' AND lab_id IS NULL LIMIT 1").get(v.userId, v.accountId);
}

function reachFilter(sqlite: any, v: QaView): (row: any) => boolean {
  if (v.kind === "lab") return (r) => (r.lab_id != null ? Number(r.lab_id) === v.labId : v.wide.includes(Number(r.account_id)));
  const known = new Map<number, boolean>();
  return (r) => {
    if (Number(r.account_id) !== v.accountId) return false;
    if (r.lab_id == null) return true;
    const lab = Number(r.lab_id);
    if (!known.has(lab)) known.set(lab, accountReachesLab(sqlite, v, lab));
    return known.get(lab)!;
  };
}

/** A WHERE for the rows a view can hold; reachFilter has the last word. */
function viewWhere(v: QaView, alias: string): { sql: string; params: any[] } {
  if (v.kind === "account") return { sql: `${alias}.account_id = ?`, params: [v.accountId] };
  return { sql: `(${alias}.lab_id = ? OR (${alias}.lab_id IS NULL AND ${alias}.account_id IN (SELECT value FROM json_each(?))))`, params: [v.labId, JSON.stringify(v.wide)] };
}

/** One row by id, when the view reaches it. */
export function qaRow(sqlite: any, v: QaView, table: "pi_departments" | "pi_metrics" | "pi_entries" | "pi_plan" | "pi_plan_priority", id: unknown): any | null {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  // An entry, a priority and a review go by what they hang on, never by their own column.
  if (table === "pi_entries") {
    const e = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ?").get(n) as any;
    return e && qaRow(sqlite, v, "pi_metrics", e.metric_id) ? e : null;
  }
  if (table === "pi_plan_priority") {
    const p = sqlite.prepare("SELECT * FROM pi_plan_priority WHERE id = ?").get(n) as any;
    return p && qaRow(sqlite, v, "pi_plan", p.plan_id) ? p : null;
  }
  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(n) as any;
  return row && reachFilter(sqlite, v)(row) ? row : null;
}

export function qaDepartments(sqlite: any, v: QaView): any[] {
  const w = viewWhere(v, "d");
  return (sqlite.prepare(`SELECT d.* FROM pi_departments d WHERE ${w.sql} ORDER BY d.sort_order ASC, d.id ASC`).all(...w.params) as any[]).filter(reachFilter(sqlite, v));
}

/**
 * The metrics a read covers: one department, or department_id=all (Michael 2026-11-12, "we need an option to see all instead of
 * only by department"): every department the view holds, in the department list's order, so "all" is exactly each department's
 * own list put together. A metric whose department isn't one of them isn't in any department's list, so it isn't in "all" either.
 */
export function qaMetrics(sqlite: any, v: QaView, departmentId: string, activeOnly: boolean): any[] {
  const active = activeOnly ? " AND m.active = 1" : "";
  const w = viewWhere(v, "m");
  let rows: any[];
  if (departmentId === "all") {
    const d = v.kind === "account" ? { sql: "d.account_id = m.account_id", params: [] as any[] }
      : { sql: `${viewWhere(v, "d").sql} AND ((m.lab_id IS NOT NULL AND d.lab_id = m.lab_id) OR d.account_id = m.account_id)`, params: viewWhere(v, "d").params };
    rows = sqlite.prepare(
      `SELECT m.* FROM pi_metrics m JOIN pi_departments d ON d.id = m.department_id AND ${d.sql}
        WHERE ${w.sql}${active} ORDER BY d.sort_order ASC, d.id ASC, m.sort_order ASC, m.id ASC`
    ).all(...d.params, ...w.params) as any[];
  } else {
    rows = sqlite.prepare(`SELECT m.* FROM pi_metrics m WHERE m.department_id = ? AND ${w.sql}${active} ORDER BY m.sort_order ASC, m.id ASC`).all(departmentId, ...w.params) as any[];
  }
  rows = rows.filter(reachFilter(sqlite, v));
  const states = orgMetricStates(sqlite, rows);
  const ym = labToday().slice(0, 7);
  return rows.map((m) => withOrgDefinition(m, states.get(Number(m.id)), ym));
}

/** In a laboratory's view a row says whether it is the laboratory's or account-wide. */
const scoped = (v: QaView, row: any) => (v.kind === "lab" ? { ...row, scope: row.lab_id == null ? "account" : "lab" } : row);

/** How an entry reads against the target: an organization's against the target kept with the entry, a lab's own against its thresholds. */
export function entryStatus(metric: any, entry: any): "green" | "yellow" | "red" | null {
  if (metric.org_indicator_id != null) {
    const met = targetMet(entry?.value ?? null, entry?.target_value ?? null, entry?.target_direction ?? null);
    return met == null ? null : met ? "green" : "red";
  }
  return indicatorStatus(entry?.value ?? null, metric);
}

// ── The dashboard ───────────────────────────────────────────────────────────

function dashboardMetric(metric: any, entries: any[], priorYearEntries: any[]) {
  const isOrg = metric.org_indicator_id != null;
  const roll = (es: any[]) => rollPeriod(es.map(orgEntryOf), 0);
  const monthlyValues: Record<number, any> = {};
  for (let m = 1; m <= 12; m++) {
    const entry = entries.find((e: any) => e.month === m);
    monthlyValues[m] = { value: entry?.value ?? null, volume: entry?.volume ?? null, status: entryStatus(metric, entry) };
  }
  // Quarterly averages; an organization's indicator adds up its numerators and denominators instead.
  const quarters: Record<string, number | null> = {};
  for (const [qLabel, months] of [["Q1", [1, 2, 3]], ["Q2", [4, 5, 6]], ["Q3", [7, 8, 9]], ["Q4", [10, 11, 12]]] as [string, number[]][]) {
    if (isOrg) { quarters[qLabel] = roll(entries.filter((e) => months.includes(e.month))).value; continue; }
    const vals = months.map((m) => monthlyValues[m]?.value).filter((x): x is number => x != null);
    quarters[qLabel] = vals.length > 0 ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  }
  const allVals = entries.map((e: any) => e.value).filter((x: any): x is number => x != null);
  const pyVals = priorYearEntries.map((e: any) => e.value).filter((x: any): x is number => x != null);
  const avg = (vals: number[]) => (vals.length > 0 ? vals.reduce((s, x) => s + x, 0) / vals.length : null);
  const orgYear = (es: any[]) => { const r = roll(es); return { value: r.value, status: r.met == null ? null : r.met ? "green" : "red" }; };
  const ytd = isOrg ? orgYear(entries) : { value: avg(allVals), status: indicatorStatus(avg(allVals), metric) };
  const py = isOrg ? orgYear(priorYearEntries) : { value: avg(pyVals), status: indicatorStatus(avg(pyVals), metric) };
  const latestEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  return {
    metric, monthlyValues, quarters,
    ytdAvg: ytd.value, ytdStatus: ytd.status, pyAvg: py.value, pyStatus: py.status,
    currentValue: latestEntry?.value ?? null, currentMonth: latestEntry?.month ?? null, currentStatus: entryStatus(metric, latestEntry),
    dataPointCount: allVals.length,
  };
}

// ── Writes the routes share ─────────────────────────────────────────────────

/** A department of this laboratory for one of its rows: the given one when it is the laboratory's, else its own of the same name. */
export function labDepartmentFor(sqlite: any, labId: number, ownerId: number, dept: { id: number; lab_id: number | null; name: string; sort_order: number | null }): number {
  if (dept.lab_id != null && Number(dept.lab_id) === labId) return Number(dept.id);
  return labDepartmentNamed(sqlite, labId, ownerId, dept.name, dept.sort_order ?? 0);
}

export function labDepartmentNamed(sqlite: any, labId: number, ownerId: number, name: string, sortOrder: number): number {
  const own = sqlite.prepare("SELECT id FROM pi_departments WHERE lab_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1").get(labId, name) as any;
  if (own) return Number(own.id);
  return Number(sqlite.prepare("INSERT INTO pi_departments (account_id, lab_id, name, sort_order, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(ownerId, labId, name, sortOrder, new Date().toISOString()).lastInsertRowid);
}

const ORG_DEFINED = { error: "This indicator is defined by your organization. Its owner or an admin changes the definition or turns it off.", code: "ORG_DEFINED" };

export function registerVeritaQaPiRoutes(app: Express, deps: {
  authMiddleware: any; requireWriteAccess: any; requireModuleEdit: (mod: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
}) {
  const { authMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess } = deps;
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerVeritaQaPiRoutes: labScopeMiddleware not registered");
  const planGate = (req: any, res: any, next: any) => (hasOpsAccess(req.user, req.scope?.lab) ? next() : res.status(403).json({ error: "VeritaBench™ requires a suite subscription" }));
  const accountOperator = (req: any, res: any, next: any) => (blockNonOperatorSeat(req, res) ? undefined : next());
  // In a laboratory: the person's seat in THIS laboratory decides, not the first seat they hold anywhere.
  const labOperator = (req: any, res: any, next: any) => {
    if (req.scope.role === "owner" || req.scope.role === "admin") return next();
    const seat = editSeatInLab(sqliteOf(), req.userId, req.scope.labId, "seat_type");
    const type = seat ? String(seat.seat_type || "active") : "active";
    if (type !== "active" || staffOwnScope(sqliteOf(), req.userId, req.scope.labId, "veritabench")) {
      return res.status(403).json({ error: "seat_not_authorized", message: "This management view is available to the account owner, admins, and active seats only." });
    }
    next();
  };

  const setLabView = (req: any, _res: any, next: any) => { req.qaLabView = makeLabView(req, hasModuleEditAccess(Number(req.scope.labId), Number(req.userId), "veritabench")); next(); };

  /** The gate on the route is for the laboratory being worked in; a row of another laboratory, or account-wide, is checked here. */
  function mayEdit(req: any, v: QaView, row: any): boolean {
    const seatEdits = () => !!req.isSeatUser && effectiveSeatPermission(req.seatType, req.seatPermissions, "veritabench") === "edit";
    if (v.kind === "lab") {
      if (row.lab_id != null) return true; // the route's own laboratory
      return Number(row.account_id) === v.ownerId || Number(row.account_id) === v.userId || seatEdits();
    }
    if (row.lab_id == null) return true;
    if (hasModuleEditAccess(Number(row.lab_id), v.userId, "veritabench")) return true;
    const member = sqliteOf().prepare("SELECT 1 FROM lab_members WHERE user_id = ? AND status = 'active' LIMIT 1").get(v.userId);
    return !member && seatEdits();
  }
  const editRefused = (res: any) => res.status(403).json({ error: "You have view-only access to VeritaQA™ in that laboratory. Ask the account owner to grant edit access." });

  const audit = (req: any, v: QaView, action: AuditAction, entityType: string, id: number, label: string, before: unknown, after: unknown) => logAudit({
    userId: req.userId, ownerUserId: v.kind === "lab" ? v.ownerId : v.accountId, module: "veritaqa", action, entityType, entityId: id, entityLabel: label, before, after, ipAddress: req.ip,
  });
  const changed = (a: any, b: any, keys: string[]) => keys.some((k) => (a?.[k] ?? null) !== (b?.[k] ?? null));
  const fail = (res: any, err: any) => res.status(500).json({ error: err.message });

  /** Where a new row goes: the laboratory in the path; on the older routes the account's one laboratory, else account-wide. */
  const newRowPlace = (v: QaView) => (v.kind === "lab" ? { labId: v.labId as number | null, accountId: v.ownerId } : { labId: onlyLabOfAccount(sqliteOf(), v.accountId), accountId: v.accountId });

  function register(base: string, read: any[], edit: any[], viewOf: (req: any) => QaView) {
    // GET departments (an empty array when none exist)
    app.get(`${base}/departments`, ...read, (req: any, res: any) => {
      const v = viewOf(req);
      res.json(qaDepartments(sqliteOf(), v).map((d) => scoped(v, d)));
    });

    app.post(`${base}/departments`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const { name, sort_order } = req.body || {};
      if (!name) return res.status(400).json({ error: "name is required" });
      const place = newRowPlace(v);
      try {
        const id = Number(sqlite.prepare("INSERT INTO pi_departments (account_id, lab_id, name, sort_order, active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
          .run(place.accountId, place.labId, name, sort_order ?? 0, new Date().toISOString()).lastInsertRowid);
        const row = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(id);
        audit(req, v, "create", "pi_department", id, String(name), null, row);
        res.json(scoped(v, row));
      } catch (err: any) { fail(res, err); }
    });

    // GET metrics: a department, or department_id=all
    app.get(`${base}/metrics`, ...read, (req: any, res: any) => {
      const v = viewOf(req);
      if (!req.query.department_id) return res.status(400).json({ error: "department_id is required" });
      res.json(qaMetrics(sqliteOf(), v, String(req.query.department_id), false).map((m) => scoped(v, m)));
    });

    app.post(`${base}/metrics`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      if (!b.department_id || !b.name) return res.status(400).json({ error: "department_id and name are required" });
      const dept = qaRow(sqlite, v, "pi_departments", b.department_id);
      if (!dept) return res.status(404).json({ error: "Department not found" });
      if (!mayEdit(req, v, dept)) return editRefused(res);
      const place = newRowPlace(v);
      const labId = v.kind === "lab" ? place.labId : (dept.lab_id ?? place.labId);
      try {
        const id = sqlite.transaction(() => {
          const departmentId = labId != null ? labDepartmentFor(sqlite, labId, place.accountId, dept) : Number(dept.id);
          return Number(sqlite.prepare(
            "INSERT INTO pi_metrics (department_id, account_id, lab_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active, created_at, measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)"
          ).run(departmentId, place.accountId, labId, b.name, b.unit ?? "%", b.direction ?? "lower_is_better", b.benchmark_green ?? null, b.benchmark_yellow ?? null, b.benchmark_red ?? null, b.sort_order ?? 0, new Date().toISOString(),
            b.measurement_methodology ?? null, b.is_tat ? 1 : 0, b.tat_start_event ?? null, b.tat_end_event ?? null, b.tat_threshold_minutes ?? null).lastInsertRowid);
        })();
        const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(id);
        audit(req, v, "create", "pi_metric", id, String(b.name), null, row);
        res.json(scoped(v, row));
      } catch (err: any) { fail(res, err); }
    });

    const METRIC_FIELDS = ["name", "unit", "direction", "benchmark_green", "benchmark_yellow", "benchmark_red", "sort_order", "active", "measurement_methodology", "is_tat", "tat_start_event", "tat_end_event", "tat_threshold_minutes"];
    app.put(`${base}/metrics/:id`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      const existing = qaRow(sqlite, v, "pi_metrics", req.params.id);
      if (!existing) return res.status(404).json({ error: "Metric not found" });
      if (!mayEdit(req, v, existing)) return editRefused(res);
      if (existing.org_indicator_id != null) return res.status(409).json(ORG_DEFINED);
      const keep = (k: string) => (b[k] !== undefined ? b[k] : existing[k]);
      try {
        sqlite.prepare(
          "UPDATE pi_metrics SET name = ?, unit = ?, direction = ?, benchmark_green = ?, benchmark_yellow = ?, benchmark_red = ?, sort_order = ?, active = ?, measurement_methodology = ?, is_tat = ?, tat_start_event = ?, tat_end_event = ?, tat_threshold_minutes = ? WHERE id = ?"
        ).run(b.name ?? existing.name, b.unit ?? existing.unit, b.direction ?? existing.direction, keep("benchmark_green"), keep("benchmark_yellow"), keep("benchmark_red"),
          b.sort_order ?? existing.sort_order, b.active ?? existing.active, keep("measurement_methodology"), b.is_tat !== undefined ? (b.is_tat ? 1 : 0) : existing.is_tat,
          keep("tat_start_event"), keep("tat_end_event"), keep("tat_threshold_minutes"), existing.id);
        const row = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(existing.id) as any;
        if (changed(existing, row, METRIC_FIELDS)) audit(req, v, "update", "pi_metric", existing.id, row.name, existing, row);
        res.json(scoped(v, row));
      } catch (err: any) { fail(res, err); }
    });

    // DELETE a metric and its entries
    app.delete(`${base}/metrics/:id`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const existing = qaRow(sqlite, v, "pi_metrics", req.params.id);
      if (!existing) return res.status(404).json({ error: "Metric not found" });
      if (!mayEdit(req, v, existing)) return editRefused(res);
      if (existing.org_indicator_id != null) return res.status(409).json(ORG_DEFINED);
      const entries = sqlite.prepare("SELECT * FROM pi_entries WHERE metric_id = ?").all(existing.id) as any[];
      const links = sqlite.prepare("SELECT * FROM pi_finding_links WHERE metric_id = ?").all(existing.id) as any[];
      audit(req, v, "delete", "pi_metric", existing.id, existing.name, { metric: existing, entries, finding_links: links }, null);
      sqlite.transaction(() => {
        const history = sqlite.prepare("INSERT INTO finding_history (finding_id, event, by_user_id, payload) VALUES (?, 'indicator_unlinked', ?, ?)");
        for (const l of links) {
          const e = entries.find((x) => x.id === l.entry_id);
          history.run(l.finding_id, req.userId, JSON.stringify({ metric_id: existing.id, name: existing.name, year: e?.year ?? null, month: e?.month ?? null, reason: "The indicator was deleted" }));
        }
        sqlite.prepare("DELETE FROM pi_finding_links WHERE metric_id = ?").run(existing.id);
        sqlite.prepare("DELETE FROM pi_entries WHERE metric_id = ?").run(existing.id);
        sqlite.prepare("DELETE FROM pi_metrics WHERE id = ?").run(existing.id);
      })();
      res.json({ success: true });
    });

    // GET entries for a year and a department (or department_id=all)
    app.get(`${base}/entries`, ...read, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const { year, department_id } = req.query;
      if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
      const metrics = qaMetrics(sqlite, v, String(department_id), false);
      if (!metrics.length) return res.json([]);
      // An entry saved under another account than its indicator's isn't listed, as before.
      res.json(sqlite.prepare(
        "SELECT e.* FROM pi_entries e JOIN pi_metrics m ON m.id = e.metric_id AND m.account_id = e.account_id WHERE e.metric_id IN (SELECT value FROM json_each(?)) AND e.year = ? ORDER BY e.month ASC"
      ).all(JSON.stringify(metrics.map((m) => m.id)), year));
    });

    // POST a one-page PDF of one indicator's year. Lab identity comes from the labs row.
    app.post(`${base}/metrics/:metricId/report`, ...read, async (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const year = Number(req.query.year) || new Date().getFullYear();
      const row = qaRow(sqlite, v, "pi_metrics", req.params.metricId);
      if (!row) return res.status(404).json({ error: "Metric not found" });
      try {
        const metric = withOrgDefinition(row, orgMetricStates(sqlite, [row]).get(Number(row.id)), labToday().slice(0, 7));
        const entries = sqlite.prepare("SELECT year, month, value, volume, notes, numerator, denominator, entry_kind, entry_unit, target_value, target_direction FROM pi_entries WHERE metric_id = ? AND year = ? ORDER BY month ASC").all(row.id, year) as any[];
        const dept = sqlite.prepare("SELECT name FROM pi_departments WHERE id = ?").get(row.department_id) as any;
        const labId = req.scope?.labId ? Number(req.scope.labId) : null;
        const labRow: any = labId != null
          ? sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(labId)
          : sqlite.prepare("SELECT lab_name, clia_number FROM labs WHERE owner_user_id = ? LIMIT 1").get(row.account_id);
        const userRow: any = sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(req.userId);
        const pdfBuffer = await generatePiReportPDF(
          {
            name: metric.name, unit: metric.unit, direction: metric.direction, benchmark_green: metric.benchmark_green, benchmark_yellow: metric.benchmark_yellow,
            benchmark_red: metric.benchmark_red, department: dept?.name ?? null, fromCounts: metric.org_indicator_id != null,
          },
          entries,
          { labName: labRow?.lab_name ?? null, cliaNumber: labRow?.clia_number ?? null, preparedBy: userRow?.name || userRow?.email || null, year, scopeNote: v.kind === "lab" && row.lab_id == null ? ACCOUNT_WIDE_LABEL : null }
        );
        const safe = String(metric.name || "PI").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 40);
        res.json({ token: storePdfToken(pdfBuffer, `PI_Report_${safe}_${year}.pdf`) });
      } catch (err: any) {
        console.error("PI report PDF error:", err.message);
        res.status(500).json({ error: "PDF generation failed", detail: err.message });
      }
    });

    // POST an entry (metric_id + year + month unique). The metric must be one this person reaches before anything is written
    // (audit #1, 2026-07-12; tests/integration/veritaqa-by-lab.test.ts section 4).
    const ENTRY_FIELDS = ["value", "volume", "notes", "numerator", "denominator"];
    app.post(`${base}/entries`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      if (!b.metric_id || !b.year || !b.month) return res.status(400).json({ error: "metric_id, year, and month are required" });
      const metric = qaRow(sqlite, v, "pi_metrics", b.metric_id);
      if (!metric) return res.status(404).json({ error: "Metric not found" });
      if (!mayEdit(req, v, metric)) return editRefused(res);
      const before = sqlite.prepare("SELECT * FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ?").get(metric.id, b.year, b.month) as any;
      const row: any = { value: b.value ?? null, volume: b.volume ?? null, notes: b.notes ?? null, numerator: null, denominator: null, entry_kind: null, entry_unit: null, target_value: null, target_direction: null, org_version: null };
      if (metric.org_indicator_id != null) {
        const refused = orgEntry(sqlite, metric, before, b, row);
        if (refused) return res.status(refused.status).json({ error: refused.error, code: refused.code });
      }
      const now = new Date().toISOString();
      try {
        sqlite.prepare(`
          INSERT INTO pi_entries (metric_id, account_id, lab_id, year, month, value, volume, notes, numerator, denominator, entry_kind, entry_unit, target_value, target_direction, org_version, created_at, updated_at)
          VALUES (@metric_id, @account_id, @lab_id, @year, @month, @value, @volume, @notes, @numerator, @denominator, @entry_kind, @entry_unit, @target_value, @target_direction, @org_version, @now, @now)
          ON CONFLICT(metric_id, year, month) DO UPDATE SET
            value = excluded.value, volume = excluded.volume, notes = excluded.notes, numerator = excluded.numerator, denominator = excluded.denominator,
            entry_kind = excluded.entry_kind, entry_unit = excluded.entry_unit, target_value = excluded.target_value, target_direction = excluded.target_direction, org_version = excluded.org_version,
            updated_at = excluded.updated_at
        `).run({ ...row, metric_id: metric.id, account_id: metric.account_id, lab_id: metric.lab_id ?? null, year: b.year, month: b.month, now });
        const after = sqlite.prepare("SELECT * FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ?").get(metric.id, b.year, b.month) as any;
        if (!before || changed(before, after, ENTRY_FIELDS)) {
          audit(req, v, before ? "update" : "create", "pi_entry", after.id, `${metric.name}, ${monthKey(after.year, after.month)}`, before ?? null, after);
        }
        res.json(after);
      } catch (err: any) { fail(res, err); }
    });

    // Wave D4 (2026-06-12): root-cause documentation for an entry. When an indicator misses its benchmark the QA loop expects the
    // lab to document the root cause and corrective action. Operates on an existing entry; an empty body clears it.
    app.post(`${base}/entries/:id/rca`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const entry = qaRow(sqlite, v, "pi_entries", req.params.id);
      if (!entry) return res.status(404).json({ error: "Entry not found" });
      const metric = qaRow(sqlite, v, "pi_metrics", entry.metric_id);
      if (!mayEdit(req, v, metric)) return editRefused(res);
      const { root_cause, corrective_action, reviewed_by, clear } = req.body || {};
      const now = new Date().toISOString();
      if (!clear && (!root_cause || !String(root_cause).trim()) && (!corrective_action || !String(corrective_action).trim())) {
        return res.status(400).json({ error: "Provide a root cause or a corrective action." });
      }
      if (clear) sqlite.prepare("UPDATE pi_entries SET root_cause = NULL, corrective_action = NULL, rca_reviewed_by = NULL, rca_reviewed_at = NULL, updated_at = ? WHERE id = ?").run(now, entry.id);
      else sqlite.prepare("UPDATE pi_entries SET root_cause = ?, corrective_action = ?, rca_reviewed_by = ?, rca_reviewed_at = ?, updated_at = ? WHERE id = ?").run(root_cause ?? null, corrective_action ?? null, reviewed_by ?? null, now, now, entry.id);
      const after = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ?").get(entry.id) as any;
      audit(req, v, "update", "pi_entry_root_cause", entry.id, `${metric.name}, ${monthKey(entry.year, entry.month)}${clear ? " (cleared)" : ""}`, entry, after);
      res.json(after);
    });

    // GET dashboard: computed values for a department, or department_id=all
    app.get(`${base}/dashboard`, ...read, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const { year, department_id } = req.query;
      if (!year || !department_id) return res.status(400).json({ error: "year and department_id are required" });
      const yr = parseInt(year as string);
      const metrics = qaMetrics(sqlite, v, String(department_id), true);
      if (!metrics.length) return res.json({ metrics: [] });
      const ids = JSON.stringify(metrics.map((m: any) => m.id));
      const of = (y: number) => sqlite.prepare("SELECT * FROM pi_entries WHERE metric_id IN (SELECT value FROM json_each(?)) AND year = ? ORDER BY month ASC").all(ids, y) as any[];
      const current = of(yr), prior = of(yr - 1);
      res.json({ metrics: metrics.map((m: any) => dashboardMetric(scoped(v, m), current.filter((e) => e.metric_id === m.id), prior.filter((e) => e.metric_id === m.id))) });
    });

    // ── The written plan, its priorities and the leadership review log (TJC PI.02.01.01) ──
    // EP1 = the four method narratives + the improvement priorities; EP2 = the leadership review log, where next_review_due is
    // stamped review_date + 12 months so "overdue" is computed, never silent. A laboratory has one active plan of its own; until
    // it starts one, the account-wide plan (if any) is its plan, and stays account-wide: a plan written for every laboratory of
    // an account isn't handed to one of them.
    const PLAN_FIELDS = ["title", "effective_year", "program_scope", "measurement_methods", "analysis_methods", "remediation_methods", "monitor_sustain_methods"];

    app.get(`${base}/plan`, ...read, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const plans = plansFor(sqlite, v);
      const plan = pickPlan(plans, req.query.scope);
      const about = v.kind === "lab" ? { plans: plans.map((p) => ({ id: p.id, title: p.title, scope: p.lab_id == null ? "account" : "lab" })), can_start_lab_plan: !plans.some((p) => p.lab_id != null) && plans.length > 0 } : {};
      if (!plan) return res.json({ plan: null, priorities: [], reviews: [], review_status: null, completeness: null, ...about });
      const priorities = sqlite.prepare("SELECT * FROM pi_plan_priority WHERE plan_id = ? ORDER BY sort_order ASC, id ASC").all(plan.id) as any[];
      const reviews = sqlite.prepare("SELECT * FROM pi_plan_review WHERE plan_id = ? ORDER BY review_date DESC, id DESC").all(plan.id) as any[];
      const last = reviews[0] || null;
      const today = labToday();
      const filled = (x: any) => !!(x && String(x).trim());
      res.json({
        plan: scoped(v, plan), priorities, reviews,
        review_status: { never_reviewed: !last, last_review_date: last?.review_date || null, next_review_due: last?.next_review_due || null, overdue: !last || (last.next_review_due != null && last.next_review_due < today) },
        completeness: {
          measurement_methods: filled(plan.measurement_methods), analysis_methods: filled(plan.analysis_methods), remediation_methods: filled(plan.remediation_methods),
          monitor_sustain_methods: filled(plan.monitor_sustain_methods), priorities_count: priorities.length, reviewed: !!last,
        },
        ...about,
      });
    });

    // PUT plan - upsert the single active plan (create if none exists).
    app.put(`${base}/plan`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      const existing = pickPlan(plansFor(sqlite, v), req.query.scope);
      if (existing && !mayEdit(req, v, existing)) return editRefused(res);
      if (!existing && req.query.scope === "account") return res.status(404).json({ error: "There is no account-wide plan." });
      const now = new Date().toISOString();
      const pick = (k: string) => (b[k] !== undefined ? b[k] : existing ? existing[k] : null);
      try {
        if (existing) {
          sqlite.prepare(`UPDATE pi_plan SET ${PLAN_FIELDS.map((f) => `${f} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...PLAN_FIELDS.map(pick), now, existing.id);
          const row = sqlite.prepare("SELECT * FROM pi_plan WHERE id = ?").get(existing.id) as any;
          if (changed(existing, row, PLAN_FIELDS)) audit(req, v, "update", "pi_plan", existing.id, row.title || "Quality plan", existing, row);
          return res.json(scoped(v, row));
        }
        const row = insertPlan(sqlite, newRowPlace(v), b, now);
        audit(req, v, "create", "pi_plan", row.id, row.title || "Quality plan", null, row);
        res.json(scoped(v, row));
      } catch (err: any) { fail(res, err); }
    });

    const insertPlan = (sqlite: any, place: { labId: number | null; accountId: number }, b: any, now: string) => {
      const id = Number(sqlite.prepare(
        `INSERT INTO pi_plan (account_id, lab_id, status, ${PLAN_FIELDS.join(", ")}, created_at, updated_at) VALUES (?, ?, 'active', ${PLAN_FIELDS.map(() => "?").join(", ")}, ?, ?)`
      ).run(place.accountId, place.labId, ...PLAN_FIELDS.map((f) => b[f] ?? null), now, now).lastInsertRowid);
      return sqlite.prepare("SELECT * FROM pi_plan WHERE id = ?").get(id) as any;
    };

    // A laboratory that has been reading the account-wide plan starts its own: blank, nothing copied, the account-wide one untouched.
    if (base === QA_LAB_BASE) {
      app.post(`${base}/plan/start`, ...edit, (req: any, res: any) => {
        const sqlite = sqliteOf(), v = viewOf(req) as QaLabView;
        if (plansFor(sqlite, v).some((p) => p.lab_id != null)) return res.status(409).json({ error: "This laboratory already has its own plan.", code: "LAB_HAS_PLAN" });
        const row = insertPlan(sqlite, { labId: v.labId, accountId: v.ownerId }, { title: req.body?.title ?? null, effective_year: req.body?.effective_year ?? null }, new Date().toISOString());
        audit(req, v, "create", "pi_plan", row.id, row.title || "Quality plan", null, row);
        res.status(201).json(scoped(v, row));
      });
    }

    const PRIORITY_FIELDS = ["process_name", "stakeholder_requirements", "goal", "improvement_activities", "linked_metric_id", "linked_department_id", "sort_order"];
    app.post(`${base}/plan/priorities`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      if (!b.plan_id || !b.process_name || !String(b.process_name).trim()) return res.status(400).json({ error: "plan_id and process_name are required" });
      const plan = qaRow(sqlite, v, "pi_plan", b.plan_id);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (!mayEdit(req, v, plan)) return editRefused(res);
      try {
        const id = Number(sqlite.prepare(
          "INSERT INTO pi_plan_priority (plan_id, account_id, lab_id, process_name, stakeholder_requirements, goal, improvement_activities, linked_metric_id, linked_department_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(plan.id, plan.account_id, plan.lab_id ?? null, b.process_name, b.stakeholder_requirements ?? null, b.goal ?? null, b.improvement_activities ?? null, b.linked_metric_id ?? null, b.linked_department_id ?? null, b.sort_order ?? 0, new Date().toISOString()).lastInsertRowid);
        const row = sqlite.prepare("SELECT * FROM pi_plan_priority WHERE id = ?").get(id);
        audit(req, v, "create", "pi_plan_priority", id, String(b.process_name), null, row);
        res.json(row);
      } catch (err: any) { fail(res, err); }
    });

    app.put(`${base}/plan/priorities/:id`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req), b = req.body || {};
      const existing = qaRow(sqlite, v, "pi_plan_priority", req.params.id);
      if (!existing) return res.status(404).json({ error: "Priority not found" });
      if (!mayEdit(req, v, qaRow(sqlite, v, "pi_plan", existing.plan_id))) return editRefused(res);
      try {
        sqlite.prepare(`UPDATE pi_plan_priority SET ${PRIORITY_FIELDS.map((f) => `${f} = ?`).join(", ")} WHERE id = ?`).run(...PRIORITY_FIELDS.map((k) => (b[k] !== undefined ? b[k] : existing[k])), existing.id);
        const row = sqlite.prepare("SELECT * FROM pi_plan_priority WHERE id = ?").get(existing.id) as any;
        if (changed(existing, row, PRIORITY_FIELDS)) audit(req, v, "update", "pi_plan_priority", existing.id, row.process_name, existing, row);
        res.json(row);
      } catch (err: any) { fail(res, err); }
    });

    app.delete(`${base}/plan/priorities/:id`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const existing = qaRow(sqlite, v, "pi_plan_priority", req.params.id);
      if (!existing) return res.status(404).json({ error: "Priority not found" });
      if (!mayEdit(req, v, qaRow(sqlite, v, "pi_plan", existing.plan_id))) return editRefused(res);
      audit(req, v, "delete", "pi_plan_priority", existing.id, existing.process_name, existing, null);
      sqlite.prepare("DELETE FROM pi_plan_priority WHERE id = ?").run(existing.id);
      res.json({ success: true });
    });

    // Record an annual leadership review (EP2). Append-only; next_review_due is stamped 12 months out.
    app.post(`${base}/plan/reviews`, ...edit, (req: any, res: any) => {
      const sqlite = sqliteOf(), v = viewOf(req);
      const { plan_id, reviewed_by, reviewer_title, review_date, changes_summary } = req.body || {};
      if (!plan_id || !reviewed_by || !String(reviewed_by).trim() || !review_date) return res.status(400).json({ error: "plan_id, reviewed_by, and review_date are required" });
      const plan = qaRow(sqlite, v, "pi_plan", plan_id);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      if (!mayEdit(req, v, plan)) return editRefused(res);
      const rd = String(review_date).slice(0, 10);
      const next = addMonthsIso(rd, 12);
      if (!next) return res.status(400).json({ error: "review_date must be a valid YYYY-MM-DD date" });
      try {
        const id = Number(sqlite.prepare(
          "INSERT INTO pi_plan_review (plan_id, account_id, lab_id, reviewed_by, reviewer_title, review_date, changes_summary, next_review_due, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(plan.id, plan.account_id, plan.lab_id ?? null, reviewed_by, reviewer_title ?? null, rd, changes_summary ?? null, next, new Date().toISOString()).lastInsertRowid);
        const row = sqlite.prepare("SELECT * FROM pi_plan_review WHERE id = ?").get(id);
        audit(req, v, "create", "pi_plan_review", id, `Leadership review ${rd}`, null, row);
        res.json(row);
      } catch (err: any) { fail(res, err); }
    });
  }

  // Assigning an account-wide indicator to the laboratory in the path: its entries go with it. The preview names what moves; the
  // write must name the same count.
  const labRead = [authMiddleware, labScopeMiddleware, labOperator, planGate, setLabView];
  const labEdit = [authMiddleware, labScopeMiddleware, labOperator, requireWriteAccess, requireModuleEdit("veritabench"), planGate, setLabView];
  const assignable = (req: any, res: any): { v: QaLabView; metric: any; entries: number } | null => {
    const sqlite = sqliteOf(), v = labView(req);
    const metric = qaRow(sqlite, v, "pi_metrics", req.params.id);
    if (!metric) { res.status(404).json({ error: "Metric not found" }); return null; }
    if (metric.lab_id != null) { res.status(409).json({ error: "This indicator already belongs to a laboratory.", code: "ALREADY_ASSIGNED" }); return null; }
    if (!mayEdit(req, v, metric)) { editRefused(res); return null; }
    // Only to a laboratory of the account it belongs to; an account that owns none is a person's own rows, and they may place them.
    const owned = sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ?").all(metric.account_id) as { id: number }[];
    const ok = owned.length ? owned.some((l) => Number(l.id) === v.labId) : Number(metric.account_id) === v.userId;
    if (!ok) { res.status(409).json({ error: "This indicator belongs to another account, so it can't be assigned to this laboratory.", code: "OTHER_ACCOUNT" }); return null; }
    const entries = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = ?").get(metric.id) as any).n);
    return { v, metric, entries };
  };
  app.get(`${QA_LAB_BASE}/metrics/:id/assign`, ...labRead, requireModuleEdit("veritabench"), (req: any, res: any) => {
    const a = assignable(req, res);
    if (!a) return;
    const others = Number((sqliteOf().prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ? AND id <> ? AND retired_at IS NULL AND COALESCE(is_repository, 0) = 0").get(a.metric.account_id, a.v.labId) as any).n);
    const span = sqliteOf().prepare("SELECT MIN(year * 100 + month) AS first, MAX(year * 100 + month) AS last FROM pi_entries WHERE metric_id = ?").get(a.metric.id) as any;
    const ym = (n: any) => (n == null ? null : monthKey(Math.floor(n / 100), n % 100));
    res.json({ metric_id: a.metric.id, name: a.metric.name, lab_name: req.scope.lab?.lab_name ?? null, entries: a.entries, first: ym(span.first), last: ym(span.last), other_labs: others });
  });
  app.post(`${QA_LAB_BASE}/metrics/:id/assign`, ...labEdit, (req: any, res: any) => {
    const a = assignable(req, res);
    if (!a) return;
    if (Number(req.body?.expected_entries) !== a.entries) return res.status(409).json({ error: `This indicator now has ${a.entries} entries. Look again before assigning it.`, code: "COUNT_CHANGED", entries: a.entries });
    const sqlite = sqliteOf(), { v, metric } = a;
    sqlite.transaction(() => {
      const dept = sqlite.prepare("SELECT * FROM pi_departments WHERE id = ?").get(metric.department_id) as any;
      const departmentId = dept ? labDepartmentFor(sqlite, v.labId, v.ownerId, dept) : labDepartmentNamed(sqlite, v.labId, v.ownerId, "General", 0);
      sqlite.prepare("UPDATE pi_metrics SET lab_id = ?, account_id = ?, department_id = ? WHERE id = ?").run(v.labId, v.ownerId, departmentId, metric.id);
      sqlite.prepare("UPDATE pi_entries SET lab_id = ?, account_id = ? WHERE metric_id = ?").run(v.labId, v.ownerId, metric.id);
      audit(req, v, "update", "pi_metric_assign", metric.id, `${metric.name}: assigned to a laboratory with ${a.entries} entries`,
        { lab_id: null, account_id: metric.account_id, department_id: metric.department_id }, { lab_id: v.labId, account_id: v.ownerId, department_id: departmentId, entries: a.entries });
    })();
    res.json({ ...scoped(v, sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(metric.id)), entries: a.entries });
  });

  // The order of the gates is the one these routes had: sign-in, then the seat and the plan on a read; write access and the
  // module gate on a write.
  register("/api/pi", [authMiddleware, accountOperator, planGate], [authMiddleware, requireWriteAccess, requireModuleEdit("veritabench"), planGate], accountView);
  register(QA_LAB_BASE, labRead, labEdit, labView);
  registerLabQualityReportRoutes(app, { base: QA_LAB_BASE, read: labRead });
  registerQualityFindingRoutes(app, { base: QA_LAB_BASE, read: labRead, edit: labEdit, findingRead: labRead });
}

const addMonthsIso = (dateStr: string, months: number): string | null => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** The active plans a view reaches: the laboratory's own first, then the account-wide one. On the older routes, account-wide first. */
function plansFor(sqlite: any, v: QaView): any[] {
  const w = viewWhere(v, "p");
  const rows = (sqlite.prepare(`SELECT p.* FROM pi_plan p WHERE ${w.sql} AND p.status = 'active' ORDER BY p.id DESC`).all(...w.params) as any[]).filter(reachFilter(sqlite, v));
  if (v.kind === "account") { const wide = rows.filter((p) => p.lab_id == null); return wide.length ? [...wide, ...rows.filter((p) => p.lab_id != null)] : rows; }
  const own = rows.filter((p) => p.lab_id != null).slice(0, 1);
  const wide = [...rows.filter((p) => p.lab_id == null && Number(p.account_id) === v.ownerId), ...rows.filter((p) => p.lab_id == null && Number(p.account_id) !== v.ownerId)].slice(0, 1);
  return [...own, ...wide];
}
const pickPlan = (plans: any[], scope: unknown): any | null =>
  (scope === "account" ? plans.find((p) => p.lab_id == null) : scope === "lab" ? plans.find((p) => p.lab_id != null) : plans[0]) ?? null;

/**
 * An organization's indicator takes a numerator and a denominator (a count takes only its count), and keeps the kind and target
 * in force when it was entered: the version for the entry's own month, taken once. A later correction keeps them.
 */
function orgEntry(sqlite: any, metric: any, before: any, b: any, row: any): { status: number; code: string; error: string } | null {
  const state = orgMetricStates(sqlite, [metric]).get(Number(metric.id));
  if (!state || !state.on) return { status: 409, code: "INDICATOR_OFF", error: "Your organization has turned this indicator off for this laboratory. Its entries are kept." };
  const year = Number(b.year), month = Number(b.month);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return { status: 400, code: "BAD_PERIOD", error: "Pick a year and a month." };
  const v = versionForMonth(state.versions, monthKey(year, month));
  if (!v) return { status: 409, code: "INDICATOR_OFF", error: "This indicator has no definition." };
  const kind = (before?.entry_kind ?? v.kind) as OrgIndicatorKind;
  if (!before && !entryMonths(v.frequency).includes(month)) return { status: 400, code: "WRONG_MONTH", error: v.frequency === "yearly" ? "This indicator is entered once a year, in December." : "This indicator is entered once a quarter, in March, June, September and December." };
  const num = (x: unknown) => (x == null || x === "" ? null : Number(x));
  const numerator = num(b.numerator), denominator = num(b.denominator);
  if (numerator == null || !Number.isFinite(numerator) || numerator < 0) return { status: 400, code: "NUMERATOR_REQUIRED", error: kind === "count" ? "Enter the count, 0 or more." : "Enter the numerator, 0 or more." };
  if (kind !== "count" && (denominator == null || !Number.isFinite(denominator) || denominator <= 0)) return { status: 400, code: "DENOMINATOR_REQUIRED", error: "Enter a denominator above 0, or leave the month with no entry." };
  if (kind === "percent" && numerator > (denominator as number)) return { status: 400, code: "NUMERATOR_TOO_LARGE", error: "The numerator can't be larger than the denominator." };
  row.numerator = numerator;
  row.denominator = kind === "count" ? null : denominator;
  row.value = orgValue(kind, numerator, denominator);
  row.volume = row.denominator != null && Number.isInteger(row.denominator) ? row.denominator : null;
  row.entry_kind = kind;
  row.entry_unit = before?.entry_kind ? before.entry_unit : orgUnit(v.kind, v.unit);
  row.target_value = before?.entry_kind ? before.target_value : v.target;
  row.target_direction = before?.entry_kind ? before.target_direction : v.direction;
  row.org_version = before?.entry_kind ? before.org_version : v.version;
  return null;
}
