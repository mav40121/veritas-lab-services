// shared/competencyStatus.ts
//
// Single source of truth for competency element/assessment status, so the
// VeritaComp summary display, the Sign & Complete gate, and the verify script
// all agree. Michael's rule (2026-09-27): a competency element for a given test
// (method group) is only PASS when it carries the DATA that element requires
// AND is marked passed; an element with no data is INCOMPLETE, not PASS; N/A is
// a valid completion state (with a justification captured at save time). An
// assessment is complete only when every element for every test is data-or-N/A.
//
// This replaced the old behavior where an unsigned assessment defaulted to PASS
// with no information (the status mirrored the 'pass' default and the "scored"
// check looked at legacy fields, never the el1-el8 data).

export type ElStatus = "pass" | "fail" | "na" | "incomplete";

const str = (v: any): string => (v == null ? "" : String(v).trim());

/** Does this item row carry the DATA its element (1-8) requires? */
export function elementHasData(item: any, el: number): boolean {
  switch (el) {
    case 1: return !!str(item.el1_specimen_id);
    case 2: return !!str(item.el2_evidence) || !!str(item.el2_date);
    case 3: return !!str(item.el3_qc_date);
    case 4: return !!str(item.el4_date_observed);
    case 5: return !!str(item.el5_sample_id) || !!str(item.el5_sample_type) || item.el5_acceptable != null;
    case 6: return !!str(item.el6_quiz_id) || !!str(item.el6_date_taken) || item.el6_score != null;
    case 7: return !!str(item.el7_date_observed);
    case 8: return !!str(item.el8_function_assessed);
    default: return false;
  }
}

const isNa = (item: any, el: number): boolean => !!item[`el${el}_na`];

/** Status of ONE item row for a specific element. */
export function itemElementStatus(item: any, el: number): ElStatus {
  if (isNa(item, el)) return "na";
  if (!elementHasData(item, el)) return "incomplete";
  return item.passed ? "pass" : "fail";
}

/**
 * Aggregate an element across every method-group row for that element number
 * (the summary shows one row per element across all tests). Incomplete wins:
 * if any test's cell for this element lacks data (and is not N/A), the element
 * is incomplete. "none" means no rows exist for the element at all.
 */
export function aggregateElementStatus(items: any[], el: number): ElStatus | "none" {
  const rows = (items || []).filter((i) => Number(i.element_number ?? i.method_number) === el);
  if (rows.length === 0) return "none";
  const st = rows.map((r) => itemElementStatus(r, el));
  if (st.some((x) => x === "incomplete")) return "incomplete";
  if (st.every((x) => x === "na")) return "na";
  if (st.some((x) => x === "fail")) return "fail";
  return "pass"; // every cell is na-or-pass, and at least one is a pass
}

/**
 * The list of element cells (per method group) that are still incomplete:
 * neither data-filled nor N/A. Empty means the assessment is complete.
 * A method group with no row for an element counts that element as incomplete.
 */
export function incompleteElementCells(
  items: any[],
  methodGroups: Array<{ id: number; name?: string | null }>,
  elementCount: number,
): string[] {
  const missing: string[] = [];
  for (const mg of methodGroups || []) {
    for (let el = 1; el <= elementCount; el++) {
      const row = (items || []).find(
        (i) => Number(i.method_group_id) === Number(mg.id) && Number(i.element_number ?? i.method_number) === el,
      );
      const st = row ? itemElementStatus(row, el) : "incomplete";
      if (st === "incomplete") missing.push(`${mg.name || `Group ${mg.id}`} · Element ${el}`);
    }
  }
  return missing;
}

/**
 * Employee-centric variant: the incomplete element cells keyed by TEST SYSTEM
 * (instrument_id) instead of method group. The per-employee record (Phase 2+)
 * stores items keyed by instrument_id, so the Sign & Complete gate must check
 * completeness per assigned instrument. An instrument with no row for an element
 * counts that element as incomplete, so passing the FULL assigned-instrument
 * list enforces "every assigned test system complete before sign."
 */
export function incompleteElementCellsByInstrument(
  items: any[],
  instruments: Array<{ id: number; name?: string | null }>,
  elementCount: number,
): string[] {
  const missing: string[] = [];
  for (const inst of instruments || []) {
    for (let el = 1; el <= elementCount; el++) {
      const row = (items || []).find(
        (i) => Number(i.instrument_id) === Number(inst.id) && Number(i.element_number ?? i.method_number) === el,
      );
      const st = row ? itemElementStatus(row, el) : "incomplete";
      if (st === "incomplete") missing.push(`${inst.name || `Instrument ${inst.id}`} · Element ${el}`);
    }
  }
  return missing;
}

/** True when every element for every test is data-or-N/A. */
export function isAssessmentComplete(
  items: any[],
  methodGroups: Array<{ id: number; name?: string | null }>,
  elementCount: number,
): boolean {
  return incompleteElementCells(items, methodGroups, elementCount).length === 0;
}

/**
 * "Assessed this cycle" lookback window, in days, for one employee.
 *
 * CLIA competency cadence (42 CFR 493.1451(b)(8) / 493.1235): in an employee's
 * FIRST year performing a test the requirement is semiannual (competency at ~6
 * months and again at ~1 year); once the first annual is completed it becomes
 * annual. So whether a covering assessment still counts as "current" depends on
 * the person's regime: a first-year employee's assessment goes stale at ~6
 * months, an established employee's at ~12 months. The v1 coverage map used a
 * flat 365-day window for everyone, which read a first-year employee as current
 * for longer than their true semiannual cadence.
 *
 * Regime = first-year (semiannual, 183 days) while the person has STARTED their
 * schedule (initial completed) but has NOT yet completed their first annual;
 * otherwise established (annual, 365 days). No schedule, or not-yet-started,
 * defaults to 365 so the window is never tightened on someone with no cadence on
 * record.
 */
export function competencyCycleWindowDays(schedule: {
  initial_completed_at?: string | null;
  first_annual_completed_at?: string | null;
} | null | undefined): number {
  const s = schedule || {};
  const startedSchedule = !!str((s as any).initial_completed_at);
  const firstAnnualDone = !!str((s as any).first_annual_completed_at);
  return startedSchedule && !firstAnnualDone ? 183 : 365;
}
