// server/competencyClearanceSync.ts
//
// Michael Q19 = 1 (2026-10-27). Signing a passed initial competency in VeritaComp never reached the person's VeritaStaff
// record, so the person still read "Not cleared for patient testing" (production 10/27: 3 people at Sampson and 1 at
// San Carlos with a signed initial in VeritaComp). VeritaStaff's clearance reads staff_competency_schedules only.
//
// syncInitialToStaffSchedule records a person's FIRST passed initial in VeritaStaff, and only when their record is
// still empty:
//   - an initial already on the record is kept (the earliest, or what the lab entered);
//   - Existing staff are already cleared, and a new method's initial must not start a first-year clock for someone
//     who was testing before, so they are left alone;
//   - a record with other competency dates entered (6-month or annual) but no initial is left alone too: adding an
//     initial there would put a 6-month due date years in the past;
//   - an initial dated before the person's hire date is never used (Michael Q26 = 1, 2026-10-27): the 10/27 dry run would
//     have cleared a rehire (hired 10/19) and a new hire (hired 8/27) on June initials from before their current hire.
//     Those people are reported as "before_hire" and left for the lab to confirm.
// It never overwrites a date. Called after a per-method sign-off and after a whole-record sign, and by the admin
// backfill (dry run by default). Every change is audit-logged.

import { competencyDueColumns } from "./competencySchedule";
import { logAudit } from "./audit";

export type ClearanceOutcome = "cleared" | "already_cleared" | "existing_staff" | "has_other_dates" | "before_hire" | "no_staff_record";

export interface ClearanceResult {
  staffEmployeeId: number;
  name: string;
  outcome: ClearanceOutcome;
  initialDate?: string;
  before?: Record<string, any>;
  after?: Record<string, any>;
}

export function syncInitialToStaffSchedule(
  sqlite: any,
  staffEmployeeId: number,
  ev: { date: string; signedBy: string | null; source: string },
  opts: { dryRun?: boolean; actorUserId?: number | null; ip?: string } = {},
): ClearanceResult {
  const emp = sqlite.prepare("SELECT * FROM staff_employees WHERE id = ?").get(staffEmployeeId) as any;
  if (!emp) return { staffEmployeeId, name: "", outcome: "no_staff_record" };
  const name = `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim();
  const sched = sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(staffEmployeeId) as any;
  if (sched?.initial_completed_at) return { staffEmployeeId, name, outcome: "already_cleared" };
  if (sched?.recorded_as === "existing") return { staffEmployeeId, name, outcome: "existing_staff" };
  if (sched && (sched.six_month_completed_at || sched.first_annual_completed_at || sched.last_annual_completed_at)) {
    return { staffEmployeeId, name, outcome: "has_other_dates" };
  }
  const date = String(ev.date || "").slice(0, 10);
  const hire = String(emp.hire_date || "").slice(0, 10);
  if (hire && date < hire) return { staffEmployeeId, name, outcome: "before_hire", initialDate: date };
  const lab = sqlite.prepare("SELECT * FROM staff_labs WHERE id = ?").get(emp.lab_id) as any;
  const due = competencyDueColumns(
    { accreditor: lab?.accreditation_body, nys: lab?.includes_nys === 1, highestComplexity: emp.highest_complexity, hireDate: emp.hire_date, annualMonth: lab?.competency_annual_month ?? null },
    { initialCompletedAt: date },
  );
  const cols: Record<string, any> = {
    initial_completed_at: date, initial_signed_by: ev.signedBy || null,
    six_month_due_at: due.six_month_due_at, first_annual_due_at: due.first_annual_due_at,
    annual_due_at: due.annual_due_at, nys_six_month_due_at: due.nys_six_month_due_at,
  };
  const before: Record<string, any> = {};
  for (const k of Object.keys(cols)) before[k] = sched?.[k] ?? null;
  if (!opts.dryRun) {
    const names = Object.keys(cols);
    if (sched) {
      sqlite.prepare(`UPDATE staff_competency_schedules SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE employee_id = ?`).run(...names.map((n) => cols[n]), staffEmployeeId);
    } else {
      sqlite.prepare(`INSERT INTO staff_competency_schedules (employee_id, lab_id, ${names.join(", ")}) VALUES (?, ?, ${names.map(() => "?").join(", ")})`)
        .run(staffEmployeeId, emp.lab_id, ...names.map((n) => cols[n]));
    }
    logAudit({
      userId: opts.actorUserId ?? emp.user_id, ownerUserId: emp.user_id, module: "veritastaff", action: sched ? "update" : "create",
      entityType: "competency_schedule", entityId: staffEmployeeId, entityLabel: `${name} (initial from ${ev.source})`,
      before, after: cols, ipAddress: opts.ip,
    });
  }
  return { staffEmployeeId, name, outcome: "cleared", initialDate: date, before, after: cols };
}

// Every person's earliest passed initial in VeritaComp (per-method sign-offs and whole-record signs), for the backfill.
// A sign-off saved before determinations were recorded (determination NULL) counts as passed; the result says so.
// The earliest initial ON OR AFTER the hire date wins; only when every initial predates the hire date is the earliest
// one returned, so the sync reports that person as "before_hire" rather than dropping them from the list.
export function earliestSignedInitials(sqlite: any, labIds: number[] | null): Array<{ staffEmployeeId: number; date: string; signedBy: string | null; source: string }> {
  type Pick = { staffEmployeeId: number; date: string; signedBy: string | null; source: string };
  const best = new Map<number, Pick>();
  const hires = new Map<number, string>((sqlite.prepare("SELECT id, hire_date FROM staff_employees").all() as any[]).map((e) => [e.id, String(e.hire_date || "").slice(0, 10)]));
  const take = (r: any, source: string) => {
    if (!r.staff_employee_id || !r.d) return;
    const d = String(r.d).slice(0, 10);
    const hire = hires.get(r.staff_employee_id) || "";
    const cur = best.get(r.staff_employee_id);
    const afterHire = (x: string) => !hire || x >= hire;
    const better = !cur
      || (afterHire(d) && !afterHire(cur.date))
      || (afterHire(d) === afterHire(cur.date) && d < cur.date);
    if (better) best.set(r.staff_employee_id, { staffEmployeeId: r.staff_employee_id, date: d, signedBy: r.signer ?? null, source });
  };
  for (const r of sqlite.prepare(
    `SELECT staff_employee_id, signed_date AS d, signer_name AS signer, determination FROM competency_method_signoffs
      WHERE milestone = 'initial' AND revoked_at IS NULL AND (determination = 'pass' OR determination IS NULL)`
  ).all() as any[]) take(r, r.determination ? "VeritaComp sign-off" : "VeritaComp sign-off (no determination recorded)");
  for (const r of sqlite.prepare(
    `SELECT ce.staff_employee_id, COALESCE(a.signed_on_paper_date, a.completion_date, a.assessment_date) AS d, a.evaluator_name AS signer
       FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id
      WHERE a.assessment_type = 'initial' AND a.status = 'pass' AND a.locked = 1 AND ce.staff_employee_id IS NOT NULL`
  ).all() as any[]) take(r, "VeritaComp record");
  let rows = Array.from(best.values());
  if (labIds && labIds.length) {
    const ok = new Set((sqlite.prepare(`SELECT id FROM staff_employees WHERE tier2_lab_id IN (${labIds.map(() => "?").join(",")})`).all(...labIds) as any[]).map((r) => r.id));
    rows = rows.filter((r) => ok.has(r.staffEmployeeId));
  }
  return rows;
}
