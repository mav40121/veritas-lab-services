// server/competencyImportSchedule.ts
//
// Michael Q12 = 1 (2026-10-27). Labs moving onto VeritaAssure bring staff who were
// assessed under their old system. The historical import (VeritaComp > Bulk Import)
// loaded those assessments but left each person's VeritaStaff schedule empty, so a
// person with years of competencies on file read as a new hire: "Not cleared for
// patient testing", then Overdue 90 days after being added.
//
// The import now fills the schedule from the records it loads, the same way the lab
// would on the competency record (Michael Q74, 2026-10-11):
//   - an imported annual, reassessment or duty-change competency (passed) means the
//     person was already testing: Recorded as Existing staff, and the most recent one
//     is the "Most recent annual" the clock runs from. Initial and 6-month are left
//     blank on purpose: an old initial with no 6-month on file would read as a missed
//     6-month. The full history stays in VeritaComp.
//   - otherwise a passed initial is the initial (the earliest one), with the 6-month
//     if one was imported: the first-year walk runs from it.
//   - a passed 6-month with no initial: Existing staff, clock from the 6-month (for a
//     waived tester, who has no 6-month, it counts as the most recent competency).
//   - orientation only, or only fail / remediation rows: nothing changes. That person
//     has not passed a competency, so they stay not cleared.
// The import never overwrites the lab: a person the lab marked New hire is left
// alone, and a person whose schedule already has a completion date keeps every date
// (they are only marked Existing staff when they have no initial and no marking).

import { competencyDueColumns, isWaivedComplexity } from "./competencySchedule";

export interface ImportedCompetency {
  assessmentType: string;
  assessmentDate: string; // YYYY-MM-DD
  status: string;
  evaluatorName: string;
}

export interface ScheduleFill {
  recordedAs: "existing" | null; // null = leave the marking as it is
  initialCompletedAt: string | null;
  initialSignedBy: string | null;
  sixMonthCompletedAt: string | null;
  sixMonthSignedBy: string | null;
  lastAnnualCompletedAt: string | null;
  lastAnnualSignedBy: string | null;
}

const ANNUAL_LIKE = new Set(["annual", "reassessment", "duty_change"]);

const earliest = (rows: ImportedCompetency[]) => rows.reduce((a, b) => (b.assessmentDate < a.assessmentDate ? b : a));
const latest = (rows: ImportedCompetency[]) => rows.reduce((a, b) => (b.assessmentDate > a.assessmentDate ? b : a));

// The schedule one person's imported records support, or null when they include no
// passed competency (orientation only, or only fail / remediation).
export function scheduleFromImportedHistory(rows: ImportedCompetency[], opts: { waived: boolean }): ScheduleFill | null {
  const passed = rows.filter((r) => r.status === "pass" && r.assessmentType !== "orientation" && /^\d{4}-\d{2}-\d{2}$/.test(r.assessmentDate));
  if (!passed.length) return null;
  const fill: ScheduleFill = {
    recordedAs: null, initialCompletedAt: null, initialSignedBy: null, sixMonthCompletedAt: null,
    sixMonthSignedBy: null, lastAnnualCompletedAt: null, lastAnnualSignedBy: null,
  };
  const annualLike = passed.filter((r) => ANNUAL_LIKE.has(r.assessmentType));
  const initials = passed.filter((r) => r.assessmentType === "initial");
  const sixes = passed.filter((r) => r.assessmentType === "6month");
  if (annualLike.length) {
    const last = latest(annualLike);
    return { ...fill, recordedAs: "existing", lastAnnualCompletedAt: last.assessmentDate, lastAnnualSignedBy: last.evaluatorName || null };
  }
  if (initials.length) {
    const first = earliest(initials);
    fill.initialCompletedAt = first.assessmentDate;
    fill.initialSignedBy = first.evaluatorName || null;
    const laterSixes = sixes.filter((s) => s.assessmentDate >= first.assessmentDate);
    if (!opts.waived && laterSixes.length) {
      const six = earliest(laterSixes);
      fill.sixMonthCompletedAt = six.assessmentDate;
      fill.sixMonthSignedBy = six.evaluatorName || null;
    }
    return fill;
  }
  if (sixes.length) {
    const six = latest(sixes);
    if (opts.waived) return { ...fill, recordedAs: "existing", lastAnnualCompletedAt: six.assessmentDate, lastAnnualSignedBy: six.evaluatorName || null };
    return { ...fill, recordedAs: "existing", sixMonthCompletedAt: six.assessmentDate, sixMonthSignedBy: six.evaluatorName || null };
  }
  return null;
}

export type ScheduleOutcome = "scheduled" | "marked_existing" | "left_new_hire" | "already_cleared" | "no_passed_competency";

export interface ScheduleResult {
  staffEmployeeId: number;
  name: string;
  outcome: ScheduleOutcome;
  before: Record<string, any> | null; // changed columns only (empty when nothing changed)
  after: Record<string, any> | null;
  created: boolean;
}

const COMPLETION_COLS = ["initial_completed_at", "six_month_completed_at", "first_annual_completed_at", "last_annual_completed_at"];

// Applies the imported records to each person's VeritaStaff schedule. Call it inside
// the import's transaction, after the assessments are inserted. dryRun reads only and
// reports what would happen (the preview uses it). A person not on opts.labId is skipped.
export function applyImportedSchedules(
  sqlite: any,
  byStaffEmployee: Map<number, ImportedCompetency[]>,
  opts: { dryRun: boolean; labId: number },
): ScheduleResult[] {
  const out: ScheduleResult[] = [];
  for (const [staffEmployeeId, rows] of Array.from(byStaffEmployee.entries())) {
    const emp = sqlite.prepare("SELECT * FROM staff_employees WHERE id = ?").get(staffEmployeeId) as any;
    // Only people on the lab being imported (staff_employees.tier2_lab_id is the lab's id).
    if (!emp || Number(emp.tier2_lab_id) !== Number(opts.labId)) continue;
    const name = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim();
    const lab = sqlite.prepare("SELECT * FROM staff_labs WHERE id = ?").get(emp.lab_id) as any;
    const before = sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(staffEmployeeId) as any;
    const result = (outcome: ScheduleOutcome, after: any = null, created = false): ScheduleResult => {
      const changedFrom: Record<string, any> = {}, changedTo: Record<string, any> = {};
      if (after) for (const k of Object.keys(after)) {
        if (k === "id") continue;
        const a = before?.[k] ?? null, b = after[k] ?? null;
        if (a !== b) { changedFrom[k] = a; changedTo[k] = b; }
      }
      return { staffEmployeeId, name, outcome, before: changedFrom, after: changedTo, created };
    };
    const fill = scheduleFromImportedHistory(rows, { waived: isWaivedComplexity(emp.highest_complexity) });
    if (!fill) { out.push(result("no_passed_competency")); continue; }
    if (before?.recorded_as === "new_hire") { out.push(result("left_new_hire")); continue; }

    const hasDates = !!before && COMPLETION_COLS.some((c) => before[c]);
    if (hasDates) {
      // The lab already entered this person's schedule: keep every date.
      if (before.initial_completed_at || before.recorded_as) { out.push(result("already_cleared")); continue; }
      if (!opts.dryRun) sqlite.prepare("UPDATE staff_competency_schedules SET recorded_as = 'existing' WHERE employee_id = ?").run(staffEmployeeId);
      out.push(result("marked_existing", { ...before, recorded_as: "existing" }));
      continue;
    }

    const due = competencyDueColumns(
      { accreditor: lab?.accreditation_body, nys: lab?.includes_nys === 1, highestComplexity: emp.highest_complexity, hireDate: emp.hire_date, annualMonth: lab?.competency_annual_month ?? null },
      { initialCompletedAt: fill.initialCompletedAt, sixMonthCompletedAt: fill.sixMonthCompletedAt, firstAnnualCompletedAt: null, lastAnnualCompletedAt: fill.lastAnnualCompletedAt },
    );
    const cols: Record<string, any> = {
      initial_completed_at: fill.initialCompletedAt, initial_signed_by: fill.initialSignedBy,
      six_month_due_at: due.six_month_due_at, six_month_completed_at: fill.sixMonthCompletedAt, six_month_signed_by: fill.sixMonthSignedBy,
      first_annual_due_at: due.first_annual_due_at,
      annual_due_at: due.annual_due_at, last_annual_completed_at: fill.lastAnnualCompletedAt, last_annual_signed_by: fill.lastAnnualSignedBy,
      nys_six_month_due_at: due.nys_six_month_due_at,
      recorded_as: fill.recordedAs ?? before?.recorded_as ?? null,
    };
    if (!opts.dryRun) {
      const names = Object.keys(cols);
      if (before) {
        sqlite.prepare(`UPDATE staff_competency_schedules SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE employee_id = ?`).run(...names.map((n) => cols[n]), staffEmployeeId);
      } else {
        sqlite.prepare(`INSERT INTO staff_competency_schedules (employee_id, lab_id, ${names.join(", ")}) VALUES (?, ?, ${names.map(() => "?").join(", ")})`)
          .run(staffEmployeeId, emp.lab_id, ...names.map((n) => cols[n]));
      }
    }
    out.push(result("scheduled", { ...(before || {}), ...cols }, !before));
  }
  return out;
}

// One line per outcome for the preview and the commit message.
export function summarizeScheduleResults(results: ScheduleResult[]) {
  const count = (o: ScheduleOutcome) => results.filter((r) => r.outcome === o).length;
  return {
    cleared: count("scheduled") + count("marked_existing"),
    scheduled: count("scheduled"),
    markedExisting: count("marked_existing"),
    leftNewHire: count("left_new_hire"),
    alreadyCleared: count("already_cleared"),
    noPassedCompetency: count("no_passed_competency"),
    people: results.map((r) => ({ staffEmployeeId: r.staffEmployeeId, name: r.name, outcome: r.outcome })),
  };
}
