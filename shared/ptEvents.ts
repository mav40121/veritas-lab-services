// shared/ptEvents.ts
//
// VeritaPT events (B11, 2026-11-24). pt_events holds one row per result; an event is the results of one program that share
// an event code (or name), or, when neither is entered, an event date. The server groups the rows (server/ptEvents.ts) and
// the Events tab and its Excel export filter and sort them with the functions here, so the two show the same list.
//
// A result's status comes from pt_events.pass_fail and nothing else: 'pass' is Acceptable, 'fail' is Unacceptable, 'ungraded'
// is Ungraded, anything else ('pending') is Not yet graded. Every older reader asks for 'pass', 'fail' or 'pending' by name,
// so an ungraded result is neither a pass nor a fail to any of them.

export type PtStatus = "acceptable" | "unacceptable" | "ungraded" | "not_graded";

export const PT_STATUSES: readonly PtStatus[] = ["unacceptable", "ungraded", "not_graded", "acceptable"];
export const PT_STATUS_LABEL: Record<PtStatus, string> = {
  acceptable: "Acceptable",
  unacceptable: "Unacceptable",
  ungraded: "Ungraded",
  not_graded: "Not yet graded",
};
/** The stored value of each status. */
export const PT_STATUS_STORED: Record<PtStatus, string> = { acceptable: "pass", unacceptable: "fail", ungraded: "ungraded", not_graded: "pending" };

export function ptStatus(passFail: unknown): PtStatus {
  return passFail === "pass" ? "acceptable" : passFail === "fail" ? "unacceptable" : passFail === "ungraded" ? "ungraded" : "not_graded";
}

export interface PtResult {
  id: number;
  enrollment_id: number;
  event_id: string | null;
  event_name: string | null;
  event_date: string;
  analyte: string;
  your_result: number | null;
  your_method: string | null;
  peer_mean: number | null;
  peer_sd: number | null;
  peer_n: number | null;
  acceptable_low: number | null;
  acceptable_high: number | null;
  sdi: number | null;
  pass_fail: string;
  status: PtStatus;
  notes: string | null;
  submission_due_date: string | null;
  submitted_date: string | null;
  tested_by_employee_id: number | null;
  tested_by: string | null;
  program_key: string;
  program: string;
  department: string;
}

/** Whether an event's results went in on time, from the dates the lab entered. A missing date is never read as late. */
export type PtSubmission = "on_time" | "late" | "not_recorded" | "not_due" | "no_due_date";
export const PT_SUBMISSION_LABEL: Record<PtSubmission, string> = {
  on_time: "On time",
  late: "Late",
  not_recorded: "Past due, no submitted date on file",
  not_due: "Not due yet",
  no_due_date: "No due date on file",
};

export interface PtEvent {
  key: string;
  /** The newest result of the event: what its screen and its routes open by. */
  id: number;
  name: string;
  program_key: string;
  program: string;
  event_date: string;
  due_date: string | null;
  submitted_date: string | null;
  submission: PtSubmission;
  analytes: string[];
  departments: string[];
  counts: Record<PtStatus, number>;
  results: PtResult[];
}

const day = (v: unknown): string => String(v ?? "").slice(0, 10);

/** What makes two results the same event: program, then code or name (within one year), or the date when neither is entered. */
export function ptEventKey(r: Pick<PtResult, "program_key" | "event_id" | "event_name" | "event_date">): string {
  const label = String(r.event_id || r.event_name || "").trim().toLowerCase();
  return label ? `${r.program_key}|${label}|${day(r.event_date).slice(0, 4)}` : `${r.program_key}|on ${day(r.event_date)}`;
}

export function ptSubmissionOf(results: Array<Pick<PtResult, "submission_due_date" | "submitted_date">>, today: string): PtSubmission {
  const due = results.filter((r) => day(r.submission_due_date));
  if (!due.length) return "no_due_date";
  if (due.some((r) => day(r.submitted_date) && day(r.submitted_date) > day(r.submission_due_date))) return "late";
  const missing = due.filter((r) => !day(r.submitted_date));
  if (!missing.length) return "on_time";
  return missing.some((r) => day(r.submission_due_date) < today) ? "not_recorded" : "not_due";
}

/** The events of one lab, newest first, each with its results in analyte order. */
export function groupPtEvents(results: PtResult[], today: string): PtEvent[] {
  const byKey = new Map<string, PtResult[]>();
  for (const r of results) {
    const k = ptEventKey(r);
    byKey.set(k, [...(byKey.get(k) || []), r]);
  }
  const uniq = (list: string[]) => Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  return Array.from(byKey.entries()).map(([key, rows]) => {
    rows.sort((a, b) => a.analyte.localeCompare(b.analyte) || a.id - b.id);
    const dates = rows.map((r) => day(r.event_date)).sort();
    const dues = rows.map((r) => day(r.submission_due_date)).filter(Boolean).sort();
    const submitted = rows.map((r) => day(r.submitted_date)).filter(Boolean).sort();
    const named = rows.find((r) => r.event_id || r.event_name);
    const name = named
      ? [named.event_id, named.event_name].map((s) => String(s || "").trim()).filter((s, i, a) => s && a.indexOf(s) === i).join(", ")
      : `Event of ${dates[0]}`;
    const counts: Record<PtStatus, number> = { acceptable: 0, unacceptable: 0, ungraded: 0, not_graded: 0 };
    for (const r of rows) counts[r.status]++;
    return {
      key, id: Math.max(...rows.map((r) => r.id)), name, program_key: rows[0].program_key, program: rows[0].program,
      event_date: dates[0], due_date: dues[0] ?? null,
      // One submitted date for the event only when every result has one: the day the last of them went in.
      submitted_date: submitted.length === rows.length ? submitted[submitted.length - 1] : null,
      submission: ptSubmissionOf(rows, today),
      analytes: uniq(rows.map((r) => r.analyte)), departments: uniq(rows.map((r) => r.department)), counts, results: rows,
    };
  }).sort((a, b) => b.event_date.localeCompare(a.event_date) || b.id - a.id);
}

export interface PtEventFilters {
  program?: string;
  analyte?: string;
  department?: string;
  status?: string;
  from?: string;
  to?: string;
  sort?: string;
  dir?: string;
}

export function filterPtEvents<T extends PtEvent>(events: T[], f: PtEventFilters): T[] {
  return events.filter((e) =>
    (!f.program || e.program_key === f.program)
    && (!f.analyte || e.analytes.includes(f.analyte))
    && (!f.department || e.departments.includes(f.department))
    && (!f.status || (e.counts[f.status as PtStatus] ?? 0) > 0)
    && (!f.from || e.event_date >= f.from)
    && (!f.to || e.event_date <= f.to));
}

export const PT_EVENT_SORTS = ["date", "event", "program", "due", "status"] as const;
const worst = (e: PtEvent): number => PT_STATUSES.findIndex((s) => e.counts[s] > 0);

/** Newest first unless the reader picks a column; an event with no due date sorts after those with one. */
export function sortPtEvents<T extends PtEvent>(events: T[], sort?: string, dir?: string): T[] {
  const by = (PT_EVENT_SORTS as readonly string[]).includes(String(sort)) ? String(sort) : "date";
  const sign = (dir || (by === "date" ? "desc" : "asc")) === "desc" ? -1 : 1;
  const value = (e: PtEvent): string | number =>
    by === "event" ? e.name.toLowerCase() : by === "program" ? e.program.toLowerCase() : by === "due" ? (e.due_date ?? "") : by === "status" ? worst(e) : e.event_date;
  return events.slice().sort((a, b) => {
    if (by === "due" && !a.due_date !== !b.due_date) return a.due_date ? -1 : 1;
    const x = value(a), y = value(b);
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return c !== 0 ? c * sign : b.event_date.localeCompare(a.event_date) || b.id - a.id;
  });
}

export function ptEventChoices(events: PtEvent[]): { analytes: string[]; departments: string[] } {
  const uniq = (list: string[]) => Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
  return { analytes: uniq(events.flatMap((e) => e.analytes)), departments: uniq(events.flatMap((e) => e.departments)) };
}

/** "2 Acceptable, 1 Unacceptable", worst first. */
export function ptStatusText(counts: Record<PtStatus, number>): string {
  return PT_STATUSES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${PT_STATUS_LABEL[s]}`).join(", ");
}
