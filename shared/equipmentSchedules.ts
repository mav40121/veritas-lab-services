// shared/equipmentSchedules.ts
//
// VeritaMaintain schedules and checklists (B10, 2026-11-24), shared by the server (server/equipmentSchedules.ts) and the screens so what a
// person sees before saving is what the server does. Pure: no database and no clock. scripts/verify-equipment-schedule-rules.mts
// exercises every branch.
//
// An instrument has any number of schedules. The first one is the PM the instrument always had (lab_equipment.pm_interval_days and
// next_due_date, which stay its mirror); the rest are the lab's own. A completed schedule's due date moves by its frequency from the day
// the work was done, and never earlier unless the person says so (shared/equipmentPm.ts).
//
// A schedule can carry a checklist: steps marked pass, fail or N/A, or a value with limits. A failed step, or a value outside its limits,
// needs its corrective action. A completed checklist holds a copy of its steps, so editing the checklist never changes it.

import { addDays, outAllDay, type PmDuePlan } from "./equipmentPm";

export const FREQUENCIES = [
  { value: "daily", label: "Daily", days: 1 },
  { value: "weekly", label: "Weekly", days: 7 },
  { value: "monthly", label: "Monthly", days: 30 },
  { value: "quarterly", label: "Quarterly", days: 91 },
  { value: "semiannual", label: "Every 6 months", days: 182 },
  { value: "annual", label: "Annual", days: 365 },
  { value: "every_n_days", label: "Every N days", days: 0 },
  { value: "manual", label: "No set interval", days: 0 },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]["value"];
export const isFrequency = (v: unknown): v is Frequency => FREQUENCIES.some((f) => f.value === v);

export const SCHEDULE_TYPES = [
  { value: "preventive_maintenance", label: "Preventive maintenance" },
  { value: "function_check", label: "Function check" },
  { value: "calibration", label: "Calibration" },
  { value: "service", label: "Service" },
] as const;
export const isScheduleType = (v: unknown): v is string => SCHEDULE_TYPES.some((t) => t.value === v);
export const SCHEDULE_TYPE_LABEL: Record<string, string> = Object.fromEntries(SCHEDULE_TYPES.map((t) => [t.value, t.label]));

/** "Every 90 days", "Monthly". */
export function frequencyLabel(frequency: string, intervalDays?: number | null): string {
  if (frequency === "every_n_days") return Number(intervalDays) > 0 ? `Every ${Number(intervalDays)} day${Number(intervalDays) === 1 ? "" : "s"}` : "Every N days";
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? frequency;
}

/** The plain number of days a frequency stands for, for the older readers of pm_interval_days. Null when it has none. */
export function nominalDays(frequency: string, intervalDays?: number | null): number | null {
  if (frequency === "every_n_days") return Number(intervalDays) > 0 ? Number(intervalDays) : null;
  const d = FREQUENCIES.find((f) => f.value === frequency)?.days ?? 0;
  return d > 0 ? d : null;
}

/** A calendar date moved by whole months; a day the month doesn't have becomes its last day. */
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** The next due date after the work was done, or null when the schedule has no interval. */
export function dueAfter(frequency: string, intervalDays: number | null | undefined, doneOn: string): string | null {
  switch (frequency) {
    case "daily": return addDays(doneOn, 1);
    case "weekly": return addDays(doneOn, 7);
    case "monthly": return addMonths(doneOn, 1);
    case "quarterly": return addMonths(doneOn, 3);
    case "semiannual": return addMonths(doneOn, 6);
    case "annual": return addMonths(doneOn, 12);
    case "every_n_days": return Number(intervalDays) > 0 ? addDays(doneOn, Number(intervalDays)) : null;
    default: return null;
  }
}

/** What completing a schedule does to its due date. A typed date wins; an earlier date is held unless the person says so. */
export function planScheduleDue(o: {
  currentDue: string | null | undefined; frequency: string; intervalDays: number | null | undefined; doneOn: string; typedDue?: string | null; allowEarlier?: boolean;
}): PmDuePlan {
  const computed = o.typedDue || dueAfter(o.frequency, o.intervalDays, o.doneOn);
  if (!computed) return { computed: null, move: false, held: null };
  if (o.currentDue && computed < o.currentDue && !o.allowEarlier) return { computed, move: false, held: { keeps: o.currentDue, works_out_to: computed } };
  return { computed, move: computed !== o.currentDue, held: null };
}

/** How far ahead a schedule reads Due soon, by how often it comes round. The first schedule keeps the 30 days it always had. */
export function dueSoonDays(frequency: string, intervalDays?: number | null, isPrimary = false): number {
  if (isPrimary) return 30;
  switch (frequency) {
    case "daily": return 0;
    case "weekly": return 1;
    case "monthly": return 7;
    case "quarterly": return 14;
    case "every_n_days": return Math.min(30, Math.floor(Number(intervalDays || 0) / 4));
    default: return 30;
  }
}

/** How far ahead the email digest mentions a schedule, at most: no approaching note for a daily one, three days for a weekly one. */
export function reminderLeadDays(frequency: string, intervalDays: number | null | undefined, isPrimary: boolean, labLead: number): number {
  if (isPrimary && (frequency === "every_n_days" || frequency === "manual")) return labLead; // as the single interval always did
  switch (frequency) {
    case "daily": return 0;
    case "weekly": return Math.min(labLead, 3);
    case "monthly": return Math.min(labLead, 7);
    case "every_n_days": return Math.min(labLead, Math.max(0, Number(intervalDays || 0) - 1));
    default: return labLead;
  }
}

export type DueStatus = "overdue" | "due_soon" | "ok" | "none";
export function scheduleStatus(s: { next_due_date?: string | null; frequency: string; interval_days?: number | null; is_primary?: number | boolean | null }, today: string): DueStatus {
  if (!s.next_due_date) return "none";
  const days = Math.round((Date.parse(`${s.next_due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (days < 0) return "overdue";
  return days <= dueSoonDays(s.frequency, s.interval_days, !!s.is_primary) ? "due_soon" : "ok";
}

// ── Daily schedules: the days with no record ───────────────────────────────────────────────────────────

export interface DailyWindow {
  /** The first and last day a record was expected, both included. */
  from: string; to: string;
  /** Days with a standing completion. */
  done: Iterable<string>;
  /** Out of service periods; a day wholly inside one isn't expected. */
  downtime?: { down_from: string; down_until?: string | null }[];
}
export function missedDays(w: DailyWindow): { expected: number; missed: string[] } {
  const done = new Set(w.done);
  const missed: string[] = [];
  let expected = 0;
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
    if (outAllDay(w.downtime ?? [], d) && !done.has(d)) continue;
    expected += 1;
    if (!done.has(d)) missed.push(d);
  }
  return { expected, missed };
}

// ── Checklists ─────────────────────────────────────────────────────────────────────────────────────────

export interface ChecklistStep { id?: number; step_text: string; kind: "check" | "value"; unit: string | null; min_value: number | null; max_value: number | null }
export const STEP_TEXT_MAX = 300;
export const STEPS_MAX = 100;

const num = (v: unknown): number | null | undefined => {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : undefined;
};

/** The steps as they will be stored, or the problem to show. */
export function cleanSteps(raw: unknown): { error?: string; steps?: ChecklistStep[] } {
  if (!Array.isArray(raw)) return { error: "The checklist must be a list of steps" };
  if (raw.length > STEPS_MAX) return { error: `A checklist holds at most ${STEPS_MAX} steps` };
  const steps: ChecklistStep[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const r: any = raw[i] || {};
    const step_text = String(r.step_text ?? "").replace(/\s+/g, " ").trim();
    if (!step_text) return { error: `Step ${i + 1} has no text` };
    if (step_text.length > STEP_TEXT_MAX) return { error: `Step ${i + 1} is too long` };
    const kind = r.kind === "value" ? "value" : "check";
    if (kind === "check") { steps.push({ step_text, kind, unit: null, min_value: null, max_value: null }); continue; }
    const min = num(r.min_value), max = num(r.max_value);
    if (min === undefined || max === undefined) return { error: `Step ${i + 1}: the limits must be numbers` };
    if (min !== null && max !== null && min > max) return { error: `Step ${i + 1}: the low limit is above the high limit` };
    steps.push({ step_text, kind, unit: String(r.unit ?? "").trim().slice(0, 30) || null, min_value: min, max_value: max });
  }
  return { steps };
}

/** True when two checklists ask the same things the same way. */
export const sameSteps = (a: ChecklistStep[], b: ChecklistStep[]): boolean =>
  a.length === b.length && a.every((s, i) => s.step_text === b[i].step_text && s.kind === b[i].kind && (s.unit ?? null) === (b[i].unit ?? null) && (s.min_value ?? null) === (b[i].min_value ?? null) && (s.max_value ?? null) === (b[i].max_value ?? null));

/** "2 to 8 °C", "at least 5", "at most 10", or "". */
export function limitsLabel(s: { min_value?: number | null; max_value?: number | null; unit?: string | null }): string {
  const u = s.unit ? ` ${s.unit}` : "";
  if (s.min_value != null && s.max_value != null) return `${s.min_value} to ${s.max_value}${u}`;
  if (s.min_value != null) return `at least ${s.min_value}${u}`;
  if (s.max_value != null) return `at most ${s.max_value}${u}`;
  return "";
}

export interface StepAnswer { result?: string | null; value?: unknown; corrective_action?: string | null }
export interface StepOutcome { result: "pass" | "fail" | "na"; value: number | null; corrective_action: string | null }

/** One step's answer, judged. A value's result comes from its limits, never from what was sent. */
export function judgeStep(step: ChecklistStep, a: StepAnswer | undefined): { error?: string; code?: string; outcome?: StepOutcome } {
  const action = String(a?.corrective_action ?? "").trim().slice(0, 2000) || null;
  if (a?.result === "na") return { outcome: { result: "na", value: null, corrective_action: action } };
  if (step.kind === "check") {
    if (a?.result !== "pass" && a?.result !== "fail") return { error: "Mark it pass, fail or N/A", code: "STEP_UNANSWERED" };
    if (a.result === "fail" && !action) return { error: "A failed step needs its corrective action", code: "CORRECTIVE_ACTION_REQUIRED" };
    return { outcome: { result: a.result, value: null, corrective_action: action } };
  }
  const value = num(a?.value);
  if (value === undefined) return { error: "The value must be a number", code: "BAD_VALUE" };
  if (value === null) return { error: "Enter the value, or mark it N/A", code: "STEP_UNANSWERED" };
  const out = (step.min_value != null && value < step.min_value) || (step.max_value != null && value > step.max_value);
  if (out && !action) return { error: "A value outside its limits needs its corrective action", code: "CORRECTIVE_ACTION_REQUIRED" };
  return { outcome: { result: out ? "fail" : "pass", value, corrective_action: action } };
}

/** True when this answer would be judged a failure, for the form to ask for the corrective action. */
export function answerFails(step: ChecklistStep, a: StepAnswer | undefined): boolean {
  if (a?.result === "na") return false;
  if (step.kind === "check") return a?.result === "fail";
  const value = num(a?.value);
  return typeof value === "number" && ((step.min_value != null && value < step.min_value) || (step.max_value != null && value > step.max_value));
}
