// server/competencyNotApplicable.ts
//
// "Not applicable" on one VeritaComp program (2026-10-28, BUG-115, RFGH Brandy Morgan: "To mark an employee N/A for
// something they do not perform, do I remove them from the assessment, or mark them N/A? ... how do I do so without
// inactivating them mistakenly?"). Every program lists every active person in the lab, so a microbiology checklist
// showed "Not assessed" for phlebotomists, and the only way off it (the Employees-tab X) deactivated the person in
// every program. A competency_program_not_applicable row takes one person off ONE program: the program shows them as
// Not applicable, does not offer them for a new assessment, and refuses one for them. Their status, their VeritaStaff
// record, their other programs and any assessment already saved on this program are untouched.

export type NotApplicableRow = { employee_id: number; reason: string | null; marked_at: string };

export function notApplicableRows(client: any, programId: number | string): NotApplicableRow[] {
  return client.prepare(
    "SELECT employee_id, reason, marked_at FROM competency_program_not_applicable WHERE program_id = ? ORDER BY marked_at",
  ).all(programId) as NotApplicableRow[];
}

export function notApplicableIds(client: any, programId: number | string): Set<number> {
  return new Set(notApplicableRows(client, programId).map((r) => Number(r.employee_id)));
}

/** Why a new assessment for this person on this program is refused, or null. */
export function notApplicableProblem(client: any, programId: number | string, employeeId: number | string): string | null {
  const row = client.prepare(
    `SELECT e.name FROM competency_program_not_applicable na JOIN competency_employees e ON e.id = na.employee_id
      WHERE na.program_id = ? AND na.employee_id = ?`,
  ).get(programId, employeeId) as any;
  return row ? `${row.name || "This person"} is marked Not applicable on this competency. Clear it on the Employees tab first.` : null;
}

export const NOT_APPLICABLE_REASON_MAX = 200;
