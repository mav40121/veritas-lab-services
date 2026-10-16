// server/competencyBackfillCleanup.ts
//
// BUG-068 cleanup (Michael 2026-10-16, Q52 = 1). Until PR #1665 a startup "demo backfill" filled blank competency
// element fields in every lab with fixed made-up values. This finds those values and clears them, and only them:
//   - a group is matched by its key field carrying the exact made-up value (the backfill always wrote the key field);
//     the other fields of that group are cleared only where they still hold the backfill's value, so anything the
//     lab entered later is kept (e.g. a real observer next to the made-up specimen ID);
//   - every item of a SIGNED assessment is left alone (locked, final signature, or a method sign-off not revoked);
//   - labs passed in excludeLabIds are left alone (the demo lab, whose values came from its demo setup).
// Dry run first: the route reports exactly what would change before anything is written.

export const BACKFILL_GROUPS: Array<{ element: number; key: string; fields: Record<string, string | number> }> = [
  { element: 1, key: "el1_specimen_id", fields: { el1_specimen_id: "0326:C147", el1_observer_initials: "MV" } },
  { element: 2, key: "el2_evidence", fields: { el2_evidence: "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented per SOP", el2_date: "2026-01-16" } },
  { element: 5, key: "el5_sample_id", fields: { el5_sample_id: "CAP-2026-C-01", el5_sample_type: "CAP PT Survey", el5_acceptable: 1 } },
  { element: 6, key: "el6_quiz_id", fields: { el6_quiz_id: "Q-AU5800-001", el6_score: 100, el6_date_taken: "2026-01-18" } },
];

export interface BackfillItem {
  itemId: number;
  assessmentId: number;
  labId: number | null;
  labName: string;
  employee: string;
  element: number | null;
  clear: string[]; // the fields that will be set to NULL
  shown: boolean; // a made-up value sits on the element this row represents
}

const same = (a: any, b: any) => a !== null && a !== undefined && String(a) === String(b);

export function findBackfillItems(sqlite: any, opts: { excludeLabIds?: number[] } = {}) {
  const exclude = new Set((opts.excludeLabIds || []).map(Number));
  const rows = sqlite.prepare(`
    SELECT i.*, a.locked, a.final_signed_by_user_id, p.lab_id, l.lab_name, ce.name AS employee_name,
      EXISTS (SELECT 1 FROM competency_method_signoffs s WHERE s.revoked_at IS NULL AND (s.id = i.signoff_id OR s.assessment_id = a.id)) AS has_signoff
    FROM competency_assessment_items i
    JOIN competency_assessments a ON a.id = i.assessment_id
    JOIN competency_programs p ON p.id = a.program_id
    LEFT JOIN labs l ON l.id = p.lab_id
    LEFT JOIN competency_employees ce ON ce.id = a.employee_id
    WHERE i.el1_specimen_id = '0326:C147' OR i.el2_evidence LIKE '0326:C147 - Sodium 141%' OR i.el5_sample_id = 'CAP-2026-C-01' OR i.el6_quiz_id = 'Q-AU5800-001'
  `).all() as any[];
  const toClear: BackfillItem[] = [];
  const skippedSigned: BackfillItem[] = [];
  const skippedExcluded: BackfillItem[] = [];
  for (const r of rows) {
    const el = Number(r.element_number ?? r.method_number) || null;
    const clear: string[] = [];
    let shown = false;
    for (const g of BACKFILL_GROUPS) {
      if (!same(r[g.key], g.fields[g.key])) continue;
      for (const [f, v] of Object.entries(g.fields)) if (same(r[f], v)) clear.push(f);
      if (g.element === el && !r[`el${g.element}_na`]) shown = true;
    }
    if (!clear.length) continue;
    const item: BackfillItem = { itemId: r.id, assessmentId: r.assessment_id, labId: r.lab_id ?? null, labName: r.lab_name || "(no lab)", employee: r.employee_name || "", element: el, clear, shown };
    const signed = Number(r.locked) === 1 || !!r.final_signed_by_user_id || Number(r.has_signoff) === 1;
    if (r.lab_id != null && exclude.has(Number(r.lab_id))) skippedExcluded.push(item);
    else if (signed) skippedSigned.push(item);
    else toClear.push(item);
  }
  return { toClear, skippedSigned, skippedExcluded };
}

/** Sets the listed fields to NULL on each item, re-checking each value in the same statement (never clears an edit made since the dry run). */
export function clearBackfillItems(sqlite: any, items: BackfillItem[]): number {
  let fieldsCleared = 0;
  const tx = sqlite.transaction((list: BackfillItem[]) => {
    for (const it of list) {
      for (const f of it.clear) {
        const g = BACKFILL_GROUPS.find((x) => f in x.fields)!;
        const res = sqlite.prepare(`UPDATE competency_assessment_items SET "${f}" = NULL WHERE id = ? AND "${f}" = ?`).run(it.itemId, g.fields[f]);
        fieldsCleared += res.changes;
      }
    }
  });
  tx(items);
  return fieldsCleared;
}

export function summarizeByLab(items: BackfillItem[]) {
  const m = new Map<string, { labId: number | null; lab: string; items: number; shown: number; fields: number; people: Set<string> }>();
  for (const it of items) {
    const k = String(it.labId);
    if (!m.has(k)) m.set(k, { labId: it.labId, lab: it.labName, items: 0, shown: 0, fields: 0, people: new Set() });
    const s = m.get(k)!;
    s.items++; s.fields += it.clear.length; if (it.shown) s.shown++; s.people.add(it.employee);
  }
  return [...m.values()].map((s) => ({ ...s, people: s.people.size })).sort((a, b) => b.items - a.items);
}
