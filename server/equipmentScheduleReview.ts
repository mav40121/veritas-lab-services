// server/equipmentScheduleReview.ts
//
// What one month shows of an instrument's schedules (B10, 2026-11-24), for the monthly record review (server/maintainRecordReview.ts) and its
// workbook. A daily schedule owes a record every day from the day it started: a day with none is a problem, unless the instrument was out
// of service the whole day. Any other schedule is a problem when its due date has passed and nothing is recorded. The first schedule's own
// "PM was due" line stays where it was, in the review.
import { frequencyLabel, missedDays } from "../shared/equipmentSchedules";
import { addDays } from "../shared/equipmentPm";
import { completionsBetween, type ScheduleRow } from "./equipmentScheduleData";

type Sqlite = any;

export interface ScheduleMonthLine {
  schedule: ScheduleRow; frequency: string; done: any[]; done_days: string[]; expected: number | null; missed: string[]; failed_steps: number; overdue: string | null;
}
export interface ScheduleMonth { lines: ScheduleMonthLine[]; problems: string[]; notes: string[]; summary: any[] }

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;
const shortDay = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const dayList = (days: string[]) => `${days.slice(0, 8).map(shortDay).join(", ")}${days.length > 8 ? " and more" : ""}`;

export function scheduleMonth(sqlite: Sqlite, labId: number, eq: any, o: { first: string; last: string; asOf: string; today: string; periods: { down_from: string; down_until?: string | null }[] }): ScheduleMonth {
  const rows = sqlite.prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? AND equipment_id = ? ORDER BY is_primary DESC, id").all(labId, eq.id) as ScheduleRow[];
  const retired = !!eq.status && eq.status !== "active";
  const out: ScheduleMonth = { lines: [], problems: [], notes: [], summary: [] };
  for (const s of rows) {
    if (!s.active && (!s.ended_on || s.ended_on < o.first)) continue;
    const done = completionsBetween(sqlite, labId, s.id, o.first, o.last).filter((c) => !c.carried_from_lab_id || s.frequency === "daily");
    const done_days = [...new Set(done.map((c) => c.done_day as string))];
    const failed = done.reduce((n, c) => n + Number(c.failed_steps || 0), 0);
    let expected: number | null = null, missed: string[] = [];
    if (s.frequency === "daily") {
      const starts = s.starts_on || String(s.created_at || "").slice(0, 10);
      const from = starts > o.first ? starts : o.first;
      // Today isn't over. An ended schedule stops owing the day it ended, and a retired instrument the day it left service.
      let to = o.asOf === o.today ? addDays(o.today, -1) : o.asOf;
      if (s.ended_on && s.ended_on < to) to = s.ended_on;
      const left = retired ? eq.removed_from_service_date || String(eq.retired_at || eq.updated_at || "").slice(0, 10) : "";
      if (left && left < to) to = left;
      const w = from <= to ? missedDays({ from, to, done: done_days, downtime: o.periods }) : { expected: 0, missed: [] };
      expected = w.expected; missed = w.missed;
    }
    const overdue = s.frequency !== "daily" && !s.is_primary && s.active && !retired && s.next_due_date && s.next_due_date < o.asOf ? s.next_due_date : null;
    if (missed.length) out.problems.push(`${s.name}: ${plural(missed.length, "day")} with no record: ${dayList(missed)}`);
    if (overdue) out.problems.push(`${s.name} was due ${overdue} and is not recorded as done`);
    if (expected) out.notes.push(`${s.name}: ${expected - missed.length} of ${plural(expected, "day")} done`);
    else if (s.frequency !== "daily" && done_days.length) out.notes.push(`${s.name}: done ${dayList(done_days)}`);
    if (failed) out.notes.push(`${s.name}: ${plural(failed, "failed step")}, each with its corrective action`);
    out.lines.push({ schedule: s, frequency: frequencyLabel(s.frequency, s.interval_days), done, done_days, expected, missed, failed_steps: failed, overdue });
    if (!s.is_primary || done.length || missed.length) {
      out.summary.push({ name: s.name, frequency: s.frequency, done: done.length, ...(expected !== null ? { expected_days: expected, missed_days: missed.length } : {}), ...(failed ? { failed_steps: failed } : {}), ...(overdue ? { overdue } : {}) });
    }
  }
  return out;
}

/** The month's schedules and checklist answers for the workbook. */
export function scheduleReportRows(sqlite: Sqlite, labId: number, o: { first: string; last: string; asOf: string; today: string }): { schedules: any[]; answers: any[] } {
  const schedules: any[] = [], answers: any[] = [];
  const results = sqlite.prepare("SELECT * FROM equipment_checklist_results WHERE lab_id = ? AND completion_id = ? ORDER BY position, id");
  for (const eq of sqlite.prepare("SELECT * FROM lab_equipment WHERE lab_id = ? ORDER BY instrument_name").all(labId) as any[]) {
    const retired = !!eq.status && eq.status !== "active";
    const periods = sqlite.prepare("SELECT down_from, down_until FROM equipment_downtime WHERE lab_id = ? AND equipment_id = ? AND carried_from_lab_id IS NULL").all(labId, eq.id) as any[];
    const m = scheduleMonth(sqlite, labId, eq, { ...o, periods });
    for (const l of m.lines) {
      const own = l.done.filter((c) => !c.carried_from_lab_id);
      if (retired && !own.length && !l.missed.length) continue;
      const doc = l.schedule.sop_document_id ? (sqlite.prepare("SELECT title, doc_number FROM policy_documents WHERE id = ? AND lab_id = ?").get(l.schedule.sop_document_id, labId) as any) : null;
      schedules.push({
        instrument_name: eq.instrument_name, is_primary: l.schedule.is_primary === 1, name: l.schedule.name, schedule_type: l.schedule.schedule_type, frequency: l.frequency, next_due_date: l.schedule.active ? l.schedule.next_due_date : null,
        ended_on: l.schedule.ended_on, done: own.length, expected: l.expected, missed: l.missed, failed_steps: l.failed_steps, overdue: l.overdue ?? (l.schedule.is_primary && l.schedule.active && !retired && l.schedule.frequency !== "daily" && l.schedule.next_due_date && l.schedule.next_due_date < o.asOf ? l.schedule.next_due_date : null),
        sop: doc ? [doc.doc_number, doc.title].filter(Boolean).join(" ") : null,
      });
      for (const c of own) for (const r of results.all(labId, c.id) as any[]) {
        answers.push({ instrument_name: eq.instrument_name, schedule: l.schedule.name, done_day: c.done_day, version_no: c.checklist_version_no, completed_by_user_id: c.completed_by_user_id, completed_by_name: c.completed_by_name, ...r });
      }
    }
  }
  // A lab with only its PM dates and nothing done on them sees the workbook it always did.
  return { schedules: schedules.some((x) => !x.is_primary || x.done || x.missed.length) ? schedules : [], answers };
}
