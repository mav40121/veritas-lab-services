// server/ptEvents.ts
//
// VeritaPT events (B11, 2026-11-24): every event of every enrolled program of one lab in one list, with its Excel export, and
// the write behind the Record / Edit PT result form. shared/ptEvents.ts says what an event is and filters and sorts the list.
//
// Program. pt_events.enrollment_id holds the id of a pt_enrollments_v2 row (what the screen records) or of an older
// pt_enrollments row (the analyte-level store the first demo data used), and nothing says which. A pt_enrollments row of this
// lab with that id AND the same analyte is the older one's mark; otherwise the pt_enrollments_v2 row of this lab with that id;
// otherwise "Program not on file". Never another lab's row.
// Department. An event has none of its own: it is the department of the VeritaMap analyzers of this lab that run the analyte
// (veritamap_instruments.category, the Department / Section on the map).
//
// Who reads it: any member, as GET /api/veritapt/events. A limited Staff login (staffOwnScope) gets the results it already
// reads there, with no coworker's name beside one, and none of the lab's other records. Recording needs VeritaPT edit.
import type { Express } from "express";
import { logAudit } from "./audit";
import { staffOwnScope } from "./competencySelfEntry";
import { cliaAnalytes } from "./cliaAnalytes";
import { createAnalyteMatcher, nzKey } from "./ptAnalyteMatcher";
import { labTimeZoneById, labToday } from "./dateLocal";
import {
  PT_STATUS_STORED, filterPtEvents, groupPtEvents, ptEventChoices, ptStatus, sortPtEvents,
  type PtEvent, type PtEventFilters, type PtResult,
} from "@shared/ptEvents";
import { ptEvaluationOpen, ptEvaluations, ptUngradedColumns } from "./ptEvaluations";
import { ptReviewDetail, withPtReviews } from "./ptReviews";
import { ptEventDocuments } from "./ptDocuments";

export const NO_DEPARTMENT = "No department on VeritaMap®";
export const NO_PROGRAM = "Program not on file";

export interface PtDeps {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
  hasPTAccess: (user: any, lab?: any) => boolean;
  licenseCtxFromReq: (req: any, productName?: string) => any;
}

const txt = (v: unknown): string => String(v ?? "").trim();
const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const isPtDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** The lab's enrolled programs, both stores, as the list names them. */
export function ptPrograms(sqlite: any, labId: number): { v1: Map<number, any>; v2: Map<number, any>; list: Array<{ key: string; label: string }> } {
  const v1 = new Map<number, any>(), v2 = new Map<number, any>(), list = new Map<string, string>();
  for (const e of sqlite.prepare("SELECT * FROM pt_enrollments_v2 WHERE lab_id = ? ORDER BY year_enrolled DESC, vendor, program_name").all(labId) as any[]) {
    const p = { key: `v2|${e.id}`, label: [e.vendor, e.program_name, e.year_enrolled].map(txt).filter(Boolean).join(" ") };
    v2.set(Number(e.id), p); list.set(p.key, p.label);
  }
  for (const e of sqlite.prepare("SELECT * FROM pt_enrollments WHERE lab_id = ? ORDER BY enrollment_year DESC, pt_provider, program_code").all(labId) as any[]) {
    const code = txt(e.program_code) || txt(e.analyte);
    const p = { key: `v1|${txt(e.pt_provider)}|${code}|${e.enrollment_year}`, label: [e.pt_provider, code, e.enrollment_year].map(txt).filter(Boolean).join(" "), analyte: e.analyte };
    v1.set(Number(e.id), p); list.set(p.key, p.label);
  }
  return { v1, v2, list: Array.from(list, ([key, label]) => ({ key, label })) };
}

/** The department of an analyte: the VeritaMap departments of the analyzers that run it, by its own name or its CLIA name. */
export function ptDepartmentOf(sqlite: any, labId: number): (analyte: string) => string {
  const match = createAnalyteMatcher(cliaAnalytes as any);
  const byName = new Map<string, Set<string>>(), byClia = new Map<unknown, Set<string>>();
  const rows = sqlite.prepare(
    `SELECT DISTINCT it.analyte, i.category FROM veritamap_instrument_tests it
       JOIN veritamap_instruments i ON i.id = it.instrument_id
       JOIN veritamap_maps m ON m.id = i.map_id
      WHERE m.lab_id = ? AND it.active = 1 AND i.category IS NOT NULL AND TRIM(i.category) <> ''`
  ).all(labId) as any[];
  const add = (map: Map<any, Set<string>>, key: any, dept: string) => { if (key) map.set(key, (map.get(key) ?? new Set<string>()).add(dept)); };
  for (const r of rows) {
    add(byName, nzKey(r.analyte), txt(r.category));
    add(byClia, match(r.analyte)?.id, txt(r.category));
  }
  return (analyte) => {
    const found = byName.get(nzKey(analyte)) ?? byClia.get(match(analyte)?.id);
    return found?.size ? Array.from(found).sort().join(" / ") : NO_DEPARTMENT;
  };
}

/** Every result of one lab, read the way the list, the review, the bias screen and the report all read it. */
export function ptResults(sqlite: any, labId: number): PtResult[] {
  const programs = ptPrograms(sqlite, labId), department = ptDepartmentOf(sqlite, labId);
  const people = new Map((sqlite.prepare("SELECT id, first_name, last_name FROM staff_employees WHERE tier2_lab_id = ?").all(labId) as any[])
    .map((p) => [Number(p.id), `${txt(p.first_name)} ${txt(p.last_name)}`.trim()]));
  const evaluations = ptEvaluations(sqlite, labId);
  return (sqlite.prepare("SELECT * FROM pt_events WHERE lab_id = ? ORDER BY event_date DESC, id DESC").all(labId) as any[]).map((r) => {
    const v1 = programs.v1.get(Number(r.enrollment_id)), v2 = programs.v2.get(Number(r.enrollment_id));
    const program = (v1 && nzKey(v1.analyte) === nzKey(r.analyte) ? v1 : null) ?? v2 ?? v1 ?? { key: `none|${r.enrollment_id}`, label: NO_PROGRAM };
    const testedBy = r.tested_by_employee_id == null ? null : Number(r.tested_by_employee_id);
    const evaluated = { status: ptStatus(r.pass_fail), evaluations: evaluations.get(Number(r.id)) ?? [] };
    return {
      id: Number(r.id), enrollment_id: Number(r.enrollment_id), event_id: r.event_id ?? null, event_name: r.event_name ?? null,
      event_date: String(r.event_date ?? "").slice(0, 10), analyte: txt(r.analyte),
      your_result: num(r.your_result), your_method: r.your_method ?? null, peer_mean: num(r.peer_mean), peer_sd: num(r.peer_sd), peer_n: num(r.peer_n),
      acceptable_low: num(r.acceptable_low), acceptable_high: num(r.acceptable_high), sdi: num(r.sdi),
      pass_fail: r.pass_fail, ...evaluated, evaluation_open: ptEvaluationOpen(evaluated),
      ungraded_reason: r.ungraded_reason ?? null, ungraded_reason_text: r.ungraded_reason_text ?? null, notes: r.notes ?? null,
      submission_due_date: txt(r.submission_due_date).slice(0, 10) || null, submitted_date: txt(r.submitted_date).slice(0, 10) || null,
      tested_by_employee_id: testedBy, tested_by: testedBy == null ? null : people.get(testedBy) ?? null,
      program_key: program.key, program: program.label, department: department(r.analyte),
    };
  });
}

export const ptToday = (sqlite: any, labId: number): string => labToday(labTimeZoneById(sqlite, labId));
export const ptEventsOfLab = (sqlite: any, labId: number): PtEvent[] => withPtReviews(sqlite, labId, groupPtEvents(ptResults(sqlite, labId), ptToday(sqlite, labId)));

/** The event holding a result of this lab, or null (another lab's result, or none). */
export function ptEventOfResult(sqlite: any, labId: number, resultId: unknown): PtEvent | null {
  const id = Number(resultId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return ptEventsOfLab(sqlite, labId).find((e) => e.results.some((r) => r.id === id)) ?? null;
}

/** A limited Staff login in this lab: its own roster row, or nobody's. Null when the person isn't limited. */
export const ptStaffOwn = (sqlite: any, req: any) => staffOwnScope(sqlite, req.userId, req.scope.labId, "veritapt");

const filtersOf = (q: any): PtEventFilters => {
  const one = (k: string) => (typeof q?.[k] === "string" && q[k] ? String(q[k]) : undefined);
  return { program: one("program"), analyte: one("analyte"), department: one("department"), status: one("status"), from: one("from"), to: one("to"), sort: one("sort"), dir: one("dir") };
};

export const ptAudit = (req: any, action: "create" | "update" | "delete", entityType: string, entityId: number | string, entityLabel: string, before: any, after: any) => logAudit({
  userId: req.userId, ownerUserId: req.scope?.lab?.owner_user_id ?? req.ownerUserId ?? req.userId, module: "veritapt", action, entityType, entityId, entityLabel,
  before: before ?? undefined, after: after ?? undefined, ipAddress: req.ip,
});

// ── One result's write ──────────────────────────────────────────────────────

/** Columns of one result as entered, or the first thing wrong. A field left out keeps what is on file. */
export function ptResultColumns(body: any, existing: any | null): { error?: string; code?: string; cols?: Record<string, any> } {
  const b = body ?? {};
  const keep = (key: string, value: (v: any) => any) => (b[key] !== undefined ? value(b[key]) : existing?.[key] ?? null);
  const text = (v: any) => txt(v) || null;
  const cols: Record<string, any> = {
    event_id: keep("event_id", text), event_name: keep("event_name", text), event_date: keep("event_date", text), analyte: keep("analyte", text),
    your_method: keep("your_method", text), notes: keep("notes", text),
    submission_due_date: keep("submission_due_date", text), submitted_date: keep("submitted_date", text),
  };
  for (const [key, label] of [["your_result", "Your result"], ["peer_mean", "Peer mean"], ["peer_sd", "Peer SD"], ["peer_n", "Peer group size"], ["acceptable_low", "Lowest acceptable"], ["acceptable_high", "Highest acceptable"]] as const) {
    if (b[key] !== undefined && b[key] !== null && b[key] !== "" && !Number.isFinite(Number(b[key]))) return { error: `${label} must be a number.` };
    cols[key] = keep(key, num);
  }
  if (!cols.event_date || !cols.analyte) return { error: "Event date and analyte are required" };
  for (const [key, label] of [["event_date", "Event date"], ["submission_due_date", "Submission due date"], ["submitted_date", "Submitted date"]] as const) {
    if (b[key] !== undefined && cols[key] && !isPtDay(cols[key])) return { error: `${label} must be a date.` };
  }
  if (cols.acceptable_low != null && cols.acceptable_high != null && cols.acceptable_low > cols.acceptable_high) return { error: "Lowest acceptable is above highest acceptable." };
  cols.pass_fail = b.pass_fail !== undefined && b.pass_fail !== null && b.pass_fail !== "" ? String(b.pass_fail) : existing?.pass_fail ?? "pending";
  if (cols.pass_fail !== existing?.pass_fail && !Object.values(PT_STATUS_STORED).includes(cols.pass_fail)) return { error: "Status must be Acceptable, Unacceptable, Ungraded or Not yet graded." };
  const ungraded = ptUngradedColumns(b, existing, cols.pass_fail);
  if (ungraded.error) return { error: ungraded.error, code: ungraded.code };
  Object.assign(cols, ungraded.cols);
  // SDI as it has always been worked out here. Without a result, a peer mean and an SD there is none; one on file from before
  // stays until those numbers change.
  const changed = ["your_result", "peer_mean", "peer_sd"].some((k) => cols[k] !== num(existing?.[k]));
  cols.sdi = cols.your_result != null && cols.peer_mean != null && cols.peer_sd ? Math.round(((cols.your_result - cols.peer_mean) / cols.peer_sd) * 100) / 100 : changed ? null : existing?.sdi ?? null;
  return { cols };
}

export function registerPtEventRoutes(app: Express, deps: PtDeps) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess, hasPTAccess, licenseCtxFromReq } = deps;
  const read = [authMiddleware, labScopeMiddleware];
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapt")];
  const plan = (req: any, res: any) => {
    if (hasPTAccess(req.user, req.scope?.lab)) return true;
    res.status(403).json({ error: "VeritaPT™ subscription required" });
    return false;
  };

  app.get("/api/labs/:labId/pt/events", ...read, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId, own = ptStaffOwn(sqlite(), req);
    const events = ptEventsOfLab(sqlite(), labId);
    res.json({
      events: own ? events.map((e) => ({ ...e, open_evaluations: 0, review: null, results: e.results.map((r) => ({ ...r, evaluations: [], evaluation_open: false, tested_by: r.tested_by_employee_id != null && r.tested_by_employee_id === own.employeeId ? r.tested_by : null })) })) : events,
      programs: ptPrograms(sqlite(), labId).list, ...ptEventChoices(events),
      can_edit: !own && hasModuleEditAccess(labId, req.userId, "veritapt"), own_only: !!own, today: ptToday(sqlite(), labId),
    });
  });

  app.get("/api/labs/:labId/pt/events/export.xlsx", ...read, async (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId;
    if (ptStaffOwn(sqlite(), req)) return res.status(403).json({ error: "A staff login can't export the lab's proficiency testing.", code: "STAFF_OWN_ONLY" });
    const f = filtersOf(req.query);
    const events = sortPtEvents(filterPtEvents(ptEventsOfLab(sqlite(), labId), f), f.sort, f.dir);
    const programs = new Map(ptPrograms(sqlite(), labId).list.map((p) => [p.key, p.label]));
    const { buildPtEventsWorkbook } = await import("./ptEventsExport");
    const { applyLicenseToExcelJS } = await import("./licenseStamp");
    const today = ptToday(sqlite(), labId);
    const buf = await buildPtEventsWorkbook(
      { labName: req.scope.lab?.lab_name || null, clia: req.scope.lab?.clia_number || null, today, events, filters: { ...f, program: f.program ? programs.get(f.program) ?? f.program : undefined } },
      (wb) => applyLicenseToExcelJS(wb, licenseCtxFromReq(req, "VeritaPT™")),
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="VeritaPT_Events_${today}.xlsx"`);
    res.send(buf);
  });

  // One event, by any of its results: what the event screen and the result form open on.
  app.get("/api/labs/:labId/pt/events/:resultId", ...read, (req: any, res: any) => {
    if (!plan(req, res)) return;
    if (ptStaffOwn(sqlite(), req)) return res.status(403).json({ error: "A staff login can't open an event's record.", code: "STAFF_OWN_ONLY" });
    const event = ptEventOfResult(sqlite(), req.scope.labId, req.params.resultId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const canEdit = hasModuleEditAccess(req.scope.labId, req.userId, "veritapt");
    res.json({
      event, ...ptReviewDetail(sqlite(), req.scope.labId, event, canEdit), documents: ptEventDocuments(sqlite(), req.scope.labId, event, ptEventsOfLab(sqlite(), req.scope.labId)),
      can_edit: canEdit, today: ptToday(sqlite(), req.scope.labId),
    });
  });

  // A program of this lab, or null: an enrollment id of another lab is never recorded against.
  const enrollmentInLab = (labId: number, id: unknown) => sqlite().prepare("SELECT id FROM pt_enrollments_v2 WHERE id = ? AND lab_id = ? UNION ALL SELECT id FROM pt_enrollments WHERE id = ? AND lab_id = ? LIMIT 1")
    .get(Number(id), labId, Number(id), labId) as any;
  const personInLab = (labId: number, id: unknown) => (id == null || id === "" ? null : (sqlite().prepare("SELECT id FROM staff_employees WHERE id = ? AND tier2_lab_id = ?").get(Number(id), labId) as any)?.id ?? undefined);

  app.post("/api/labs/:labId/pt/results", ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId, b = req.body ?? {};
    if (!enrollmentInLab(labId, b.enrollment_id)) return res.status(400).json({ error: "Pick one of this laboratory's enrolled programs." });
    const person = personInLab(labId, b.tested_by_employee_id);
    if (person === undefined) return res.status(400).json({ error: "That person isn't on this laboratory's roster." });
    const r = ptResultColumns(b, null);
    if (!r.cols) return res.status(400).json({ error: r.error, code: r.code });
    const now = new Date().toISOString();
    const row: Record<string, any> = { ...r.cols, enrollment_id: Number(b.enrollment_id), tested_by_employee_id: person, lab_id: labId, user_id: req.scope.lab.owner_user_id, created_at: now, updated_at: now };
    const keys = Object.keys(row);
    const id = Number(sqlite().prepare(`INSERT INTO pt_events (${keys.join(", ")}) VALUES (${keys.map((k) => `@${k}`).join(", ")})`).run(row).lastInsertRowid);
    const created = sqlite().prepare("SELECT * FROM pt_events WHERE id = ?").get(id);
    ptAudit(req, "create", "pt_result", id, `${row.analyte}, ${row.event_date}`, null, created);
    res.status(201).json(created);
  });

  app.put("/api/labs/:labId/pt/results/:id", ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const labId = req.scope.labId, b = req.body ?? {};
    const existing = sqlite().prepare("SELECT * FROM pt_events WHERE id = ? AND lab_id = ?").get(Number(req.params.id), labId) as any;
    if (!existing) return res.status(404).json({ error: "Result not found" });
    if (b.enrollment_id !== undefined && Number(b.enrollment_id) !== Number(existing.enrollment_id) && !enrollmentInLab(labId, b.enrollment_id)) return res.status(400).json({ error: "Pick one of this laboratory's enrolled programs." });
    const person = b.tested_by_employee_id === undefined ? existing.tested_by_employee_id : personInLab(labId, b.tested_by_employee_id);
    if (person === undefined) return res.status(400).json({ error: "That person isn't on this laboratory's roster." });
    const r = ptResultColumns(b, existing);
    if (!r.cols) return res.status(400).json({ error: r.error, code: r.code });
    const row: Record<string, any> = { ...r.cols, enrollment_id: b.enrollment_id !== undefined ? Number(b.enrollment_id) : existing.enrollment_id, tested_by_employee_id: person, updated_at: new Date().toISOString() };
    sqlite().prepare(`UPDATE pt_events SET ${Object.keys(row).map((k) => `${k} = @${k}`).join(", ")} WHERE id = @id`).run({ ...row, id: existing.id });
    const updated = sqlite().prepare("SELECT * FROM pt_events WHERE id = ?").get(existing.id);
    ptAudit(req, "update", "pt_result", existing.id, `${row.analyte}, ${row.event_date}`, existing, updated);
    res.json(updated);
  });

  // One due date and one submitted date for every result of an event.
  app.patch("/api/labs/:labId/pt/events/:resultId/dates", ...edit, (req: any, res: any) => {
    if (!plan(req, res)) return;
    const event = ptEventOfResult(sqlite(), req.scope.labId, req.params.resultId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const sets: Record<string, string | null> = {};
    for (const [key, label] of [["submission_due_date", "Submission due date"], ["submitted_date", "Submitted date"]] as const) {
      if (req.body?.[key] === undefined) continue;
      const v = txt(req.body[key]) || null;
      if (v && !isPtDay(v)) return res.status(400).json({ error: `${label} must be a date.` });
      sets[key] = v;
    }
    if (!Object.keys(sets).length) return res.status(400).json({ error: "Enter a due date or a submitted date." });
    const now = new Date().toISOString();
    sqlite().transaction(() => {
      for (const r of event.results) {
        const before = sqlite().prepare("SELECT submission_due_date, submitted_date FROM pt_events WHERE id = ?").get(r.id) as any;
        if (Object.keys(sets).every((k) => (before[k] ?? null) === sets[k])) continue;
        sqlite().prepare(`UPDATE pt_events SET ${Object.keys(sets).map((k) => `${k} = @${k}`).join(", ")}, updated_at = @now WHERE id = @id AND lab_id = @lab`).run({ ...sets, now, id: r.id, lab: req.scope.labId });
        ptAudit(req, "update", "pt_result", r.id, `${r.analyte}, ${r.event_date}: dates`, before, sets);
      }
    })();
    res.json({ ok: true });
  });
}
