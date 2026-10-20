// server/competencyHireDate.ts
//
// The VeritaStaff hire date is the source of truth for a VeritaComp employee that is linked to a VeritaStaff
// person (competency_employees.staff_employee_id). competency_employees.hire_date is only a copy, taken when the
// row was bridged, and it goes stale when the date is entered or changed in VeritaStaff later.
//
// BUG-090 (Sampson, 2026-10-20): Natalie Edge's VeritaComp row was bridged on 10/13, before her VeritaStaff hire
// date (10/19) existed, so the new-hire evaluation showed no hire date and no due date.

// SQL for an assessment query that joins competency_employees as `e`: the linked VeritaStaff date when there is
// one, otherwise the VeritaComp copy. Uses its own alias so it never collides with a query's existing joins.
export const EMPLOYEE_HIRE_DATE_SQL =
  "COALESCE((SELECT hd_se.hire_date FROM staff_employees hd_se WHERE hd_se.id = e.staff_employee_id), e.hire_date)";

type HasHireDate = { staff_employee_id?: number | null; hire_date?: string | null };

// Pure core (mirrored by the integration test): a row linked to a VeritaStaff person takes that person's hire
// date when VeritaStaff has one; an unlinked row, or a linked row whose VeritaStaff date is blank, keeps its own.
export function preferStaffHireDate<T extends HasHireDate>(rows: T[], staffDates: Map<number, string | null>): T[] {
  return rows.map((r) => {
    const sid = r.staff_employee_id;
    if (sid == null) return r;
    const staff = staffDates.get(Number(sid));
    return staff ? { ...r, hire_date: staff } : r;
  });
}

// SQLite convenience for the employee-list routes.
export function withStaffHireDates<T extends HasHireDate>(client: any, rows: T[]): T[] {
  const ids = Array.from(new Set(rows.map((r) => r.staff_employee_id).filter((x): x is number => x != null).map(Number)));
  if (ids.length === 0) return rows;
  const staffDates = new Map<number, string | null>();
  for (const s of client
    .prepare(`SELECT id, hire_date FROM staff_employees WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as { id: number; hire_date: string | null }[]) {
    staffDates.set(Number(s.id), s.hire_date);
  }
  return preferStaffHireDate(rows, staffDates);
}
