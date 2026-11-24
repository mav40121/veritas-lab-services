// server/equipmentSchedules.ts
//
// VeritaMaintain schedules and checklists (B10, 2026-11-24). Rules: shared/equipmentSchedules.ts. Storage: server/equipmentScheduleData.ts.
// Registered by server/equipment.ts, whose events are how a schedule gets completed.
//
//   - An instrument has any number of schedules: how often, the next due date, its own reminder recipients (blank is the lab's list), and
//     one of the lab's VeritaDC documents as its SOP, opened at the current approved version. The first one is the instrument's PM.
//   - A schedule can carry a checklist. Editing it adds a version; a completion names the version it answered and keeps a copy of every
//     step, so an edit never changes what was recorded. Someone answering an older version than the one on file is told, not recorded.
//   - Completing a schedule logs a maintenance event in the person's own sign-in. A failed step, or a value outside its limits, needs its
//     corrective action. The due date moves by the schedule's own frequency, never earlier unless the person says so.
//   - A schedule is ended, with a reason, not deleted: what was done on it stays.
//
// Access is the module's split: schedules and checklists are setup (VeritaMaintain edit); completing one is recording work, open to every
// active member, Staff logins included. Veritas support sets schedules up and never completes one (server/vlsSupport.ts).
import type { Express } from "express";
import { labToday } from "./dateLocal";
import { approvedReadVersionId } from "./policyApprovedVersion";
import { sendApprovedDocument } from "./approvedDocumentView";
import { EMAIL_RE } from "./labGroups";
import { isYmd } from "../shared/stainLogRules";
import { cleanSteps, dueAfter, frequencyLabel, isFrequency, isScheduleType, judgeStep, sameSteps, scheduleStatus, type StepOutcome } from "../shared/equipmentSchedules";
import { COMPLETION_JOIN, currentChecklist, mirrorPrimary, primaryOf, STANDING_COMPLETION, type ScheduleRow } from "./equipmentScheduleData";

type Sqlite = any;

export interface ScheduleRouteContext {
  read: any[]; record: any[]; setup: any[];
  sqlite: () => Sqlite;
  equipmentIn: (req: any) => any;
  notFound: (res: any) => any;
  movedAway: (res: any, eq: any) => any;
  audit: (req: any, action: any, entityType: string, entityId: number, label: string, before: any, after: any) => any;
  namesFor: (req: any) => <T extends Record<string, any>>(row: T) => T;
  userName: (userId: number) => string | null;
  text: (v: any, max: number) => string | null;
  truthy: (v: any) => boolean;
  cleanEvent: (b: any, from?: any) => { error?: string; code?: string; v?: any };
  logEvent: (req: any, eq: any, v: any, o: any) => { eventId: number; done: any[]; waits: boolean };
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
}

/** The addresses typed on a schedule, or the one that isn't an address. An empty list means the lab's own list. */
function cleanRecipients(raw: any): { error?: string; list?: { email: string }[] } {
  const parts: string[] = Array.isArray(raw) ? raw.map((r) => (typeof r === "string" ? r : r?.email)) : typeof raw === "string" ? raw.split(/[,;]/) : [];
  const list: { email: string }[] = [];
  for (const p of parts) {
    const email = String(p ?? "").trim();
    if (!email) continue;
    if (!EMAIL_RE.test(email) || email.length > 254) return { error: `${email} isn't an email address` };
    if (!list.some((x) => x.email.toLowerCase() === email.toLowerCase())) list.push({ email });
  }
  if (list.length > 25) return { error: "A schedule holds at most 25 recipients" };
  return { list };
}

const recipientsOf = (s: ScheduleRow): { email: string }[] => { try { const j = JSON.parse(s.recipients_json || "[]"); return Array.isArray(j) ? j : []; } catch { return []; } };

export function registerEquipmentScheduleRoutes(app: Express, ctx: ScheduleRouteContext) {
  const { read, record, setup, sqlite, equipmentIn, notFound, movedAway, audit, namesFor, userName, text, truthy } = ctx;
  const scheduleIn = (req: any, eq: any): ScheduleRow | null =>
    (sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ? AND equipment_id = ? AND lab_id = ?").get(Number(req.params.scheduleId), eq.id, eq.lab_id) as ScheduleRow) ?? null;
  const noSchedule = (res: any) => res.status(404).json({ error: "That schedule isn't on this instrument" });
  const label = (eq: any, s: { name: string }) => `${eq.instrument_name}: ${s.name}`;

  const view = (s: ScheduleRow, names: (r: any) => any, manages: boolean) => {
    const doc = s.sop_document_id ? (sqlite().prepare("SELECT id, title, doc_number, status, archived_at, current_version_id, approved_version_id FROM policy_documents WHERE id = ? AND lab_id = ?").get(s.sop_document_id, s.lab_id) as any) : null;
    const last = sqlite().prepare(
      `SELECT c.*, e.event_date AS done_day, e.performed_by FROM ${COMPLETION_JOIN} WHERE c.lab_id = ? AND c.schedule_id = ? AND ${STANDING_COMPLETION} ORDER BY e.event_date DESC, c.id DESC LIMIT 1`
    ).get(s.lab_id, s.id) as any;
    const list = currentChecklist(sqlite(), s.lab_id, s.id);
    const { recipients_json: _hidden, ...rest } = s as any;
    return {
      ...names(rest), status: s.active ? scheduleStatus(s, labToday()) : "none", frequency_label: frequencyLabel(s.frequency, s.interval_days),
      // Who gets the emails is setup; a reader sees only whether it has its own list.
      recipients: manages ? recipientsOf(s) : [], has_own_recipients: recipientsOf(s).length > 0,
      sop: s.sop_document_id ? { id: s.sop_document_id, title: doc?.title ?? null, doc_number: doc?.doc_number ?? null, readable: approvedReadVersionId(doc) != null } : null,
      checklist: list ? { version_id: list.id, version_no: list.version_no, created_at: list.created_at, change_note: list.change_note, steps: list.steps } : null,
      last_completed: last ? names({ id: last.id, done_day: last.done_day, completed_by_user_id: last.completed_by_user_id, completed_by_name: last.completed_by_name, failed_steps: last.failed_steps, counts: last.counts, carried_from_lab_name: last.carried_from_lab_name }) : null,
    };
  };

  app.get("/api/labs/:labId/equipment/:id/schedules", ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const names = namesFor(req);
    const canEdit = ctx.hasModuleEditAccess(eq.lab_id, req.userId, "veritamaintain") || req.scope?.viaVlsSupport;
    const rows = sqlite().prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? AND equipment_id = ? ORDER BY active DESC, is_primary DESC, id").all(eq.lab_id, eq.id) as ScheduleRow[];
    res.json({ schedules: rows.map((s) => view(s, names, canEdit)), can_edit: canEdit && !eq.moved_to_lab_id, today: labToday(), retired: eq.status === "retired" });
  });

  // What both add and edit write; a problem is the message to send back.
  const clean = (req: any, eq: any, b: any, from: Partial<ScheduleRow> | null): { error?: string; code?: string; v?: any } => {
    const pick = (k: string, d: any = null) => (b[k] !== undefined ? b[k] : from ? (from as any)[k] : d);
    const name = String(pick("name", "") ?? "").replace(/\s+/g, " ").trim();
    if (!name) return { error: "Enter the schedule's name", code: "NAME_REQUIRED" };
    if (name.length > 120) return { error: "The name is too long" };
    if (/[\u2014\u2013]/.test(name)) return { error: "Use a hyphen instead of a dash." };
    const schedule_type = pick("schedule_type", "preventive_maintenance");
    if (!isScheduleType(schedule_type)) return { error: "Pick the kind of maintenance", code: "BAD_TYPE" };
    const frequency = pick("frequency");
    if (!isFrequency(frequency)) return { error: "Pick how often it is due", code: "BAD_FREQUENCY" };
    let interval_days: number | null = null;
    if (frequency === "every_n_days") {
      interval_days = Number(pick("interval_days"));
      if (!Number.isInteger(interval_days) || interval_days < 1 || interval_days > 3650) return { error: "Enter the number of days, 1 to 3650", code: "BAD_INTERVAL" };
    }
    let next_due_date: string | null = b.next_due_date !== undefined ? (b.next_due_date || null) : from ? from.next_due_date ?? null : frequency === "daily" ? labToday() : dueAfter(frequency, interval_days, labToday());
    if (next_due_date && !isYmd(next_due_date)) return { error: "The next due date isn't a date", code: "BAD_DATE" };
    let recipients_json = from?.recipients_json ?? "[]";
    if (b.recipients !== undefined) {
      const r = cleanRecipients(b.recipients);
      if (r.error) return { error: r.error, code: "BAD_RECIPIENT" };
      recipients_json = JSON.stringify(r.list);
    }
    let sop_document_id = from?.sop_document_id ?? null;
    if (b.sop_document_id !== undefined) {
      sop_document_id = null;
      if (b.sop_document_id !== null && b.sop_document_id !== "") {
        const doc = sqlite().prepare("SELECT id FROM policy_documents WHERE id = ? AND lab_id = ? AND archived_at IS NULL").get(Number(b.sop_document_id), eq.lab_id) as any;
        if (!doc) return { error: "That document isn't in this lab's VeritaDC", code: "BAD_DOCUMENT" };
        sop_document_id = doc.id;
      }
    }
    return { v: { name, schedule_type, frequency, interval_days, next_due_date, recipients_json, sop_document_id } };
  };

  const addVersion = (req: any, eq: any, s: ScheduleRow, steps: any[], note: string | null, now: string): number => {
    const no = Number((sqlite().prepare("SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM equipment_checklist_versions WHERE lab_id = ? AND schedule_id = ?").get(eq.lab_id, s.id) as any).n);
    const id = Number(sqlite().prepare("INSERT INTO equipment_checklist_versions (lab_id, equipment_id, schedule_id, version_no, change_note, created_by_user_id, created_by_name, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(eq.lab_id, eq.id, s.id, no, note, req.userId, userName(req.userId), now).lastInsertRowid);
    const ins = sqlite().prepare("INSERT INTO equipment_checklist_steps (lab_id, version_id, position, step_text, kind, unit, min_value, max_value) VALUES (?,?,?,?,?,?,?,?)");
    steps.forEach((x, i) => ins.run(eq.lab_id, id, i + 1, x.step_text, x.kind, x.unit, x.min_value, x.max_value));
    return no;
  };

  app.post("/api/labs/:labId/equipment/:id/schedules", ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired", code: "RETIRED" });
    const c = clean(req, eq, req.body || {}, null);
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const steps: { error?: string; steps?: any[] } = req.body?.steps !== undefined ? cleanSteps(req.body.steps) : { steps: [] };
    if (steps.error) return res.status(400).json({ error: steps.error, code: "BAD_STEPS" });
    const v = c.v;
    const now = new Date().toISOString();
    let id = 0;
    sqlite().transaction(() => {
      // An instrument with no PM yet takes its first longer PM schedule as the one the list and readiness read.
      const primary = !primaryOf(sqlite(), eq.lab_id, eq.id) && v.schedule_type === "preventive_maintenance" && v.frequency !== "daily" && v.frequency !== "weekly" ? 1 : 0;
      id = Number(sqlite().prepare(
        `INSERT INTO equipment_schedules (lab_id, equipment_id, name, schedule_type, frequency, interval_days, next_due_date, recipients_json, sop_document_id, is_primary, active, starts_on, created_by_user_id, created_by_name, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`
      ).run(eq.lab_id, eq.id, v.name, v.schedule_type, v.frequency, v.interval_days, v.next_due_date, v.recipients_json, v.sop_document_id, primary, labToday(), req.userId, userName(req.userId), now, now).lastInsertRowid);
      const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(id) as ScheduleRow;
      if (primary) mirrorPrimary(sqlite(), row, now);
      if (steps.steps!.length) addVersion(req, eq, row, steps.steps!, text(req.body?.change_note, 500), now);
    })();
    const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(id) as ScheduleRow;
    audit(req, "create", "equipment_schedule", id, label(eq, row), null, { ...row, steps: steps.steps });
    res.status(201).json(view(row, namesFor(req), true));
  });

  app.put("/api/labs/:labId/equipment/:id/schedules/:scheduleId", ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (!s.active) return res.status(409).json({ error: "This schedule has ended", code: "ENDED" });
    const c = clean(req, eq, req.body || {}, s);
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const v = c.v;
    const now = new Date().toISOString();
    // A schedule that becomes daily owes a record a day from the day it does, not from when it was made.
    const starts = v.frequency === "daily" && s.frequency !== "daily" ? labToday() : s.starts_on;
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE equipment_schedules SET name=?, schedule_type=?, frequency=?, interval_days=?, next_due_date=?, recipients_json=?, sop_document_id=?, starts_on=?, updated_at=? WHERE id=?")
        .run(v.name, v.schedule_type, v.frequency, v.interval_days, v.next_due_date, v.recipients_json, v.sop_document_id, starts, now, s.id);
      const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(s.id) as ScheduleRow;
      if (row.is_primary) mirrorPrimary(sqlite(), row, now);
    })();
    const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(s.id) as any;
    const changed = Object.keys(row).filter((k) => k !== "updated_at" && row[k] !== (s as any)[k]);
    if (changed.length) audit(req, "update", "equipment_schedule", s.id, label(eq, row), Object.fromEntries(changed.map((k) => [k, (s as any)[k]])), { equipment_id: eq.id, ...Object.fromEntries(changed.map((k) => [k, row[k]])) });
    res.json(view(row, namesFor(req), true));
  });

  app.post("/api/labs/:labId/equipment/:id/schedules/:scheduleId/end", ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (!s.active) return res.status(409).json({ error: "This schedule has already ended", code: "ENDED" });
    const reason = text(req.body?.reason, 1000);
    if (!reason) return res.status(400).json({ error: "Enter why this schedule is ending", code: "REASON_REQUIRED" });
    const now = new Date().toISOString();
    sqlite().transaction(() => {
      sqlite().prepare("UPDATE equipment_schedules SET active = 0, ended_on = ?, ended_at = ?, ended_by_user_id = ?, ended_by_name = ?, end_reason = ?, updated_at = ? WHERE id = ?").run(labToday(), now, req.userId, userName(req.userId), reason, now, s.id);
      const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(s.id) as ScheduleRow;
      if (row.is_primary) mirrorPrimary(sqlite(), row, now);
    })();
    audit(req, "update", "equipment_schedule", s.id, `${label(eq, s)} ended`, { active: 1, next_due_date: s.next_due_date }, { equipment_id: eq.id, active: 0, reason });
    res.json(view(scheduleIn(req, eq)!, namesFor(req), true));
  });

  app.post("/api/labs/:labId/equipment/:id/schedules/:scheduleId/resume", ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (s.active) return res.status(409).json({ error: "This schedule hasn't ended", code: "NOT_ENDED" });
    const now = new Date().toISOString();
    sqlite().transaction(() => {
      const other = primaryOf(sqlite(), eq.lab_id, eq.id);
      sqlite().prepare("UPDATE equipment_schedules SET active = 1, ended_on = NULL, ended_at = NULL, ended_by_user_id = NULL, ended_by_name = NULL, end_reason = NULL, starts_on = ?, is_primary = ?, updated_at = ? WHERE id = ?")
        .run(labToday(), s.is_primary && !other ? 1 : 0, now, s.id);
      const row = sqlite().prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(s.id) as ScheduleRow;
      if (row.is_primary) mirrorPrimary(sqlite(), row, now);
    })();
    audit(req, "restore", "equipment_schedule", s.id, `${label(eq, s)} resumed`, { active: 0, end_reason: s.end_reason, ended_on: s.ended_on }, { equipment_id: eq.id, active: 1 });
    res.json(view(scheduleIn(req, eq)!, namesFor(req), true));
  });

  // The checklist as it should be from now on: a new version, unless nothing changed. No steps takes the checklist off.
  app.put("/api/labs/:labId/equipment/:id/schedules/:scheduleId/checklist", ...setup, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.moved_to_lab_id) return movedAway(res, eq);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (!s.active) return res.status(409).json({ error: "This schedule has ended", code: "ENDED" });
    const steps = cleanSteps(req.body?.steps);
    if (steps.error) return res.status(400).json({ error: steps.error, code: "BAD_STEPS" });
    const cur = currentChecklist(sqlite(), eq.lab_id, s.id);
    if (sameSteps(cur?.steps ?? [], steps.steps!)) return res.json({ ...view(s, namesFor(req), true), unchanged: true });
    const now = new Date().toISOString();
    let no = 0;
    sqlite().transaction(() => { no = addVersion(req, eq, s, steps.steps!, text(req.body?.change_note, 500), now); })();
    audit(req, "update", "equipment_checklist", s.id, `${label(eq, s)} checklist version ${no}`, { version_no: cur?.version_no ?? null, steps: cur?.steps?.map((x) => x.step_text) ?? [] }, { equipment_id: eq.id, version_no: no, steps: steps.steps });
    res.json(view(s, namesFor(req), true));
  });

  app.get("/api/labs/:labId/equipment/:id/schedules/:scheduleId/sop", ...read, async (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (!s.sop_document_id) return res.status(404).json({ error: "No SOP is linked to this schedule" });
    await sendApprovedDocument(sqlite(), req, res, { labId: eq.lab_id, documentId: s.sop_document_id, surface: "equipment_schedule_sop" });
  });

  // Each version of the checklist, newest first, so an inspector can see what a completion answered.
  app.get("/api/labs/:labId/equipment/:id/schedules/:scheduleId/checklist-versions", ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    const names = namesFor(req);
    const versions = sqlite().prepare("SELECT * FROM equipment_checklist_versions WHERE lab_id = ? AND schedule_id = ? ORDER BY version_no DESC").all(eq.lab_id, s.id) as any[];
    res.json(versions.map((x) => names({ ...x, steps: sqlite().prepare("SELECT * FROM equipment_checklist_steps WHERE lab_id = ? AND version_id = ? ORDER BY position, id").all(eq.lab_id, x.id) })));
  });

  // Completing a schedule: recording work, open to every member who records. It logs the maintenance event in their sign-in.
  app.post("/api/labs/:labId/equipment/:id/schedules/:scheduleId/complete", ...record, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    if (eq.status === "retired") return res.status(409).json({ error: "This instrument is retired. Restore it to log maintenance.", code: "RETIRED" });
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    if (!s.active) return res.status(409).json({ error: "This schedule has ended", code: "ENDED" });
    const b = req.body || {};
    const doneOn = b.done_on ?? labToday();
    if (!isYmd(doneOn)) return res.status(400).json({ error: "Pick the date", code: "BAD_DATE" });
    if (doneOn > labToday()) return res.status(400).json({ error: "The date can't be in the future", code: "BAD_DATE" });
    const list = currentChecklist(sqlite(), eq.lab_id, s.id);
    if (list && Number(b.version_id) !== list.id) return res.status(409).json({ error: "The checklist changed since you opened it. Reload it and answer the current one.", code: "CHECKLIST_CHANGED" });
    const outcomes: StepOutcome[] = [];
    for (const st of list?.steps ?? []) {
      const a = Array.isArray(b.answers) ? b.answers.find((x: any) => Number(x?.step_id) === st.id) : undefined;
      const r = judgeStep(st, a);
      if (r.error) return res.status(400).json({ error: `Step ${st.position}, ${st.step_text}: ${r.error}`, code: r.code, step_id: st.id });
      outcomes.push(r.outcome!);
    }
    const count = (k: string) => outcomes.filter((o) => o.result === k).length;
    const summary = list ? `${s.name} (checklist version ${list.version_no}): ${count("pass")} passed, ${count("fail")} failed, ${count("na")} N/A` : s.name;
    const notes = [summary, String(b.notes ?? "").trim()].filter(Boolean).join("\n");
    const c = ctx.cleanEvent({ ...b, event_type: s.schedule_type, event_date: doneOn, notes, completes_pm: s.schedule_type === "preventive_maintenance" });
    if (c.error) return res.status(400).json({ error: c.error, ...(c.code ? { code: c.code } : {}) });
    const r = ctx.logEvent(req, eq, c.v, {
      primary: s.is_primary === 1, others: s.is_primary === 1 ? [] : [s], allowEarlier: truthy(b.allow_earlier_due), typedAll: true,
      ...(list ? { checklist: { schedule: s, version: list, outcomes } } : {}),
    });
    const row = scheduleIn(req, eq)!;
    res.status(201).json({ ok: true, event_id: r.eventId, failed_steps: count("fail"), next_due_date: row.next_due_date, due_date_held: r.done[0]?.held ?? null, awaiting_vendor_report_event: r.waits, schedule: view(row, namesFor(req), false) });
  });

  // What was completed on a schedule, newest first, with every step as it was answered. `from` and `to` are days.
  app.get("/api/labs/:labId/equipment/:id/schedules/:scheduleId/completions", ...read, (req: any, res: any) => {
    const eq = equipmentIn(req);
    if (!eq) return notFound(res);
    const s = scheduleIn(req, eq);
    if (!s) return noSchedule(res);
    const names = namesFor(req);
    const from = isYmd(req.query?.from) ? req.query.from : "0000-01-01", to = isYmd(req.query?.to) ? req.query.to : "9999-12-31";
    const rows = sqlite().prepare(
      `SELECT c.*, e.event_date AS done_day, e.performed_by, e.notes, e.id AS standing_event_id FROM ${COMPLETION_JOIN} WHERE c.lab_id = ? AND c.schedule_id = ? AND ${STANDING_COMPLETION} AND e.event_date >= ? AND e.event_date <= ? ORDER BY e.event_date DESC, c.id DESC LIMIT 400`
    ).all(eq.lab_id, s.id, from, to) as any[];
    const results = sqlite().prepare("SELECT * FROM equipment_checklist_results WHERE lab_id = ? AND completion_id = ? ORDER BY position, id");
    res.json(rows.map((r) => names({ ...r, results: results.all(eq.lab_id, r.id) })));
  });
}
