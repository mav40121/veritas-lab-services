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
 * Unmarked entries (Michael 2026-11-05, Q179 = 1). A stored row has no "failed" mark: passed = 0 is every row's default, so
 * an element with data and no Pass is "fail" above only because nobody has marked it. On a SIGNED row that is its real
 * result and stays. On an unsigned row it reads Needs review, for everyone who sees it. No stored value changes.
 */
export const NEEDS_REVIEW = "needs_review";
export type WorkingStatus = ElStatus | typeof NEEDS_REVIEW;
export const NEEDS_REVIEW_LABEL = "Needs review";

/** An unsigned element's status as people read it. Only for working rows, never a signed set. */
export function workingElementStatus(st: ElStatus | "none"): WorkingStatus {
  if (st === "none") return "incomplete";
  return st === "fail" ? NEEDS_REVIEW : st;
}

/** Elements not yet marked Pass or N/A: what stands between a method and a Pass sign-off. */
export function unmarkedElements(elements: Array<{ num: number; status: string }>): number[] {
  return (elements || []).filter((e) => e.status !== "pass" && e.status !== "na").map((e) => Number(e.num));
}

const elementList = (nums: number[]): string =>
  nums.length === 1 ? `Element ${nums[0]} is` : `Elements ${nums.slice(0, -1).join(", ")} and ${nums[nums.length - 1]} are`;

/**
 * Why a method can't be signed as a Pass, or null when it can. The server refuses with this text and the sign form shows the
 * same text before anyone tries. Fail and Remediation Required are still allowed: that is how an evaluator records someone
 * who didn't pass.
 */
export function methodPassProblem(methodName: string, elements: Array<{ num: number; status: string }>): string | null {
  const open = unmarkedElements(elements);
  if (!open.length) return null;
  return `${methodName} can't be signed as a Pass yet: ${elementList(open)} not marked Pass or N/A. Mark ${open.length === 1 ? "it" : "them"} and save, or choose Fail or Remediation Required.`;
}

/**
 * The same rule for the whole-record Sign & Complete on a program record, whose overall status was chosen on its form.
 * Technical: every unsigned element row marked Pass or N/A. Waived: the required methods passed and dated. Non-technical
 * records have no element marks, so this doesn't apply to them. A record signed on paper and entered with no rows at all
 * (paperNoEntries) has no entries to review.
 */
export function recordPassProblem(programType: string | null | undefined, items: any[], opts: { paperNoEntries?: boolean } = {}): string | null {
  const rows = items || [];
  if (opts.paperNoEntries && rows.length === 0) return null;
  const fix = "Mark them and save, or change the overall determination to Fail or Remediation Required.";
  if (programType === "waived") {
    const passed = new Set(rows.filter((r) => waivedMethodPassed(r)).map((r) => Number(r.waived_method_number ?? r.method_number))).size;
    if (passed >= WAIVED_METHODS_REQUIRED) return null;
    return `This record can't be signed as a Pass yet: ${passed} of ${WAIVED_METHODS_REQUIRED} required waived methods are passed and dated. ${fix}`;
  }
  if (programType !== "technical") return null;
  const open = new Map<string, number[]>();
  for (const r of rows) {
    if (r.signoff_id != null || r.waived_method_number != null) continue;
    const el = Number(r.element_number ?? r.method_number);
    if (!Number.isInteger(el) || el < 1 || el > 8) continue;
    const st = itemElementStatus(r, el);
    if (st === "pass" || st === "na") continue;
    const name = String(r.method_group_name || r.item_label || "Test");
    open.set(name, [...(open.get(name) || []), el]);
  }
  if (!open.size) return null;
  const shown = Array.from(open.entries()).map(([name, nums]) => {
    const sorted = nums.slice().sort((a, b) => a - b);
    return `${name} (Element${sorted.length === 1 ? "" : "s"} ${sorted.length === 1 ? sorted[0] : `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`})`;
  }).join("; ");
  return `This record can't be signed as a Pass yet, because these aren't marked Pass or N/A: ${shown}. ${fix}`;
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
 * Waived testing competency (#91, 2026-10-12): an all-waived test system (a
 * glucose meter, a urine dipstick reader) is assessed by two of four methods per
 * test, at hire and annually, under the accreditor's waived-testing standard;
 * the six CLIA elements apply to moderate and high complexity test systems. On
 * the employee record a waived method is an item row with waived_method_number
 * (1-4) and NULL element/method numbers, so no element logic ever counts it.
 */
export const WAIVED_METHOD_NAMES = [
  "Blind specimen testing",
  "Periodic observation by supervisor",
  "Monitoring of QC performance",
  "Written test specific to the test assessed",
];
export const WAIVED_METHODS_REQUIRED = 2;

/** A waived method counts toward the two required when it is marked passed AND dated. */
export function waivedMethodPassed(item: any): boolean {
  return !!item?.passed && !!str(item?.waived_date);
}

/**
 * Does a competency method group cover a test system (instrument)? Only when the group NAMES it.
 *
 * Michael's rule (2026-10-12): "If there are no new or unique skills, the competency covers both. Same rationale as
 * 'you are competencied for potassium, therefore sodium is covered.'" The software cannot see skills, so the lab says it
 * through the group: analyzers with no new or unique skills between them (XN-1000 / XN-450, CA-660 Primary / Backup) go
 * in ONE group and one competency covers both; an analyzer with its own skills (a manual differential, tube method, a
 * different chemistry platform) has its own group. Analytes inside a group are covered together (potassium covers sodium).
 * Before this, a group also covered any instrument that shared a test or a department with it, so an XN-1000 assessment
 * credited the manual differential and a Beckman AU group credited the Ortho VITROS (BUG-043 fixed the waived half first).
 * A waived device with no naming group falls to a waived program, which the caller checks. Inputs are lowercased.
 */
export function methodGroupCoversInstrument(mg: { instrumentsLC: string[] }, inst: { nameLC: string }): boolean {
  return mg.instrumentsLC.some((n) => !!n && (n.includes(inst.nameLC) || inst.nameLC.includes(n)));
}

/** Passed waived methods recorded for one test system (instrument). */
export function waivedPassedCount(items: any[], instrumentId: number): number {
  const nums = new Set<number>();
  for (const i of items || []) {
    if (Number(i.instrument_id) === Number(instrumentId) && i.waived_method_number != null && waivedMethodPassed(i)) nums.add(Number(i.waived_method_number));
  }
  return nums.size;
}

/**
 * Employee-centric variant: the incomplete element cells keyed by TEST SYSTEM
 * (instrument_id) instead of method group. The per-employee record (Phase 2+)
 * stores items keyed by instrument_id, so the Sign & Complete gate must check
 * completeness per assigned instrument. An instrument with no row for an element
 * counts that element as incomplete, so passing the FULL assigned-instrument
 * list enforces "every assigned test system complete before sign." A waived
 * instrument (waived: true) is complete with two passed waived methods instead.
 */
export function incompleteElementCellsByInstrument(
  items: any[],
  instruments: Array<{ id: number; name?: string | null; waived?: boolean }>,
  elementCount: number,
): string[] {
  const missing: string[] = [];
  for (const inst of instruments || []) {
    if (inst.waived) {
      const n = waivedPassedCount(items, inst.id);
      if (n < WAIVED_METHODS_REQUIRED) missing.push(`${inst.name || `Instrument ${inst.id}`} · ${n} of ${WAIVED_METHODS_REQUIRED} waived methods passed`);
      continue;
    }
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
