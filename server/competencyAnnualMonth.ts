// server/competencyAnnualMonth.ts
//
// The lab's annual competency month (Michael Q157 = 1, 2026-10-13) and VeritaStaff's stored annual due dates. A method's own
// due date is worked out when read, so a rule change reaches it at once; staff_competency_schedules.annual_due_at is stored,
// so it is figured again here, from the completions on the row. Only that column changes, and a row with no recorded
// competency is left alone. Used by the setting's save (PUT /api/labs/:labId/competency/annual-month) and by the admin
// re-figure (BUG-202: dates stored under the rule that could move an annual more than six months earlier).
import { competencyDueColumns } from "./competencySchedule";

export interface AnnualRefigureRow { employeeId: number; before: string | null; after: string | null }

// staffLab: the lab's staff_labs row. month: 1-12, or null for off.
export function annualDueChanges(sqlite: any, staffLab: any, month: number | null): AnnualRefigureRow[] {
  const rows = sqlite.prepare(
    `SELECT s.employee_id, s.annual_due_at, s.initial_completed_at, s.six_month_completed_at, s.first_annual_completed_at, s.last_annual_completed_at,
            e.highest_complexity, e.hire_date
     FROM staff_competency_schedules s JOIN staff_employees e ON e.id = s.employee_id WHERE e.lab_id = ?`
  ).all(staffLab.id) as any[];
  const out: AnnualRefigureRow[] = [];
  for (const r of rows) {
    if (!r.initial_completed_at && !r.six_month_completed_at && !r.first_annual_completed_at && !r.last_annual_completed_at) continue;
    const due = competencyDueColumns(
      { accreditor: staffLab.accreditation_body, nys: staffLab.includes_nys === 1, highestComplexity: r.highest_complexity, hireDate: r.hire_date, annualMonth: month },
      { initialCompletedAt: r.initial_completed_at, sixMonthCompletedAt: r.six_month_completed_at, firstAnnualCompletedAt: r.first_annual_completed_at, lastAnnualCompletedAt: r.last_annual_completed_at },
    );
    if ((due.annual_due_at ?? null) !== (r.annual_due_at ?? null)) out.push({ employeeId: r.employee_id, before: r.annual_due_at ?? null, after: due.annual_due_at ?? null });
  }
  return out;
}

export function applyAnnualDueChanges(sqlite: any, changes: AnnualRefigureRow[]): number {
  const upd = sqlite.prepare("UPDATE staff_competency_schedules SET annual_due_at = ? WHERE employee_id = ?");
  for (const c of changes) upd.run(c.after, c.employeeId);
  return changes.length;
}
