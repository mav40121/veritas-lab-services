// server/competencyObserver.ts
//
// BUG-075 (Michael Q35 = 1, 2026-10-27). The Element 1 and Element 4 observer (direct observation of routine testing,
// and of instrument maintenance and function checks) must be a Laboratory Director, Technical Consultant or Technical
// Supervisor (42 CFR 493.1235, TJC HR.01.06.01 EP 18). Until now the person page took free text and the program dialog
// only warned, so any initials saved. Every save path now refuses an observer who is not one of the lab's LD/TC/TS
// people in VeritaStaff, on new or changed values only: a value already saved on the record is left alone, so records
// moved over from paper keep their history. People who have left the lab still count (any status), so a paper record
// signed by a former supervisor can be entered once that person is in VeritaStaff with their role.
//
// Observers are stored as initials (el1_observer_initials / el4_observer_initials); the matching rule lives in
// shared/competencyObserver.ts so the pick list and this check agree.

import { normInitials, observerForms } from "@shared/competencyObserver";

export { normInitials, observerForms };

export type QualifiedObserver = {
  employeeId: number;
  name: string;
  initials: string;
  roles: string[];
  active: boolean;
};

/** The lab's LD/TC/TS people in VeritaStaff, current staff first, then people who have left. */
export function loadQualifiedObservers(sqlite: any, labId: number): QualifiedObserver[] {
  const rows = sqlite.prepare(
    `SELECT e.id AS employee_id, e.first_name, e.last_name, e.middle_initial, e.status,
            GROUP_CONCAT(DISTINCT r.role) AS role_csv
     FROM staff_employees e
     JOIN staff_roles r ON r.employee_id = e.id
     WHERE e.tier2_lab_id = ?
       AND r.role IN ('LD', 'TC', 'TS')
     GROUP BY e.id, e.first_name, e.last_name, e.middle_initial, e.status
     ORDER BY CASE WHEN e.status = 'active' THEN 0 ELSE 1 END, e.last_name, e.first_name`
  ).all(labId) as Array<{
    employee_id: number; first_name: string; last_name: string; middle_initial: string | null; status: string; role_csv: string;
  }>;
  return rows.map((r) => {
    const firstInitial = (r.first_name || "").trim().charAt(0).toUpperCase();
    const middleInitial = (r.middle_initial || "").trim().charAt(0).toUpperCase();
    const lastInitial = (r.last_name || "").trim().charAt(0).toUpperCase();
    const initials = [firstInitial, middleInitial, lastInitial].filter(Boolean).join("");
    const name = [r.last_name, r.first_name].filter(Boolean).join(", ") + (r.middle_initial ? ` ${r.middle_initial}.` : "");
    return {
      employeeId: r.employee_id,
      name: name || `Employee #${r.employee_id}`,
      initials,
      roles: (r.role_csv || "").split(",").filter(Boolean),
      active: r.status === "active",
    };
  });
}

/**
 * The first observer value that may not be saved, as an error message, or null when every value is allowed.
 * entries: the Element 1 / 4 observer values being saved (N/A elements left out by the caller).
 * kept: the observer values already saved on this record; re-saving one of those is not a change.
 */
export function observerProblem(
  observers: QualifiedObserver[],
  entries: Array<{ element: number; value: unknown }>,
  kept: Iterable<unknown> = [],
): string | null {
  const allowed = new Set<string>();
  for (const o of observers) for (const f of observerForms(o)) allowed.add(f);
  const keptSet = new Set(Array.from(kept, normInitials).filter(Boolean));
  for (const { element, value } of entries) {
    const v = normInitials(value);
    if (!v || keptSet.has(v) || allowed.has(v)) continue;
    return `Element ${element} observer "${String(value).trim()}" is not a Laboratory Director, Technical Consultant or Technical Supervisor in VeritaStaff. Add the observer in VeritaStaff with that role (someone who has left the lab can be added and marked terminated), then pick them from the list.`;
  }
  return null;
}

/** Element 1 / 4 observer values on program-assessment items (camelCase body shape), skipping N/A elements. */
export function itemObserverEntries(items: any[]): Array<{ element: number; value: unknown }> {
  const out: Array<{ element: number; value: unknown }> = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it?.el1Na) out.push({ element: 1, value: it?.el1ObserverInitials });
    if (!it?.el4Na) out.push({ element: 4, value: it?.el4ObserverInitials });
  }
  return out;
}

/** Element 1 / 4 observer values already saved on stored item rows. */
export function storedObserverValues(rows: any[]): string[] {
  const out: string[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.el1_observer_initials) out.push(r.el1_observer_initials);
    if (r?.el4_observer_initials) out.push(r.el4_observer_initials);
  }
  return out;
}
