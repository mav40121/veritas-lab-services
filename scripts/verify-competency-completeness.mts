// scripts/verify-competency-completeness.mts
//
// Receipt for the competency completeness rule (2026-09-27): an element is PASS
// only with its required data AND passed; no data -> INCOMPLETE (never PASS);
// N/A is a valid completion; an assessment is complete only when every element
// for every test is data-or-N/A. Mirrors shared/competencyStatus.ts.
//
// Run: npx tsx scripts/verify-competency-completeness.mts   (exits non-zero on fail)

import { itemElementStatus, elementHasData, aggregateElementStatus, incompleteElementCells, isAssessmentComplete } from "../shared/competencyStatus";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

// 1) Element 1 with passed=true but NO specimen -> INCOMPLETE (the reported bug).
check("el1 passed w/o specimen = incomplete", itemElementStatus({ passed: 1 }, 1) === "incomplete");
// 2) Element 1 with specimen + passed -> PASS.
check("el1 specimen + passed = pass", itemElementStatus({ el1_specimen_id: "S1", passed: 1 }, 1) === "pass");
// 3) Element 1 with specimen but NOT passed -> FAIL.
check("el1 specimen + not passed = fail", itemElementStatus({ el1_specimen_id: "S1", passed: 0 }, 1) === "fail");
// 4) N/A wins regardless of passed/data.
check("el1 na = na", itemElementStatus({ el1_na: 1, passed: 1 }, 1) === "na");
// 5) Per-element data fields recognized.
check("el2 date is data", elementHasData({ el2_date: "2026-09-01" }, 2));
check("el3 qc date is data", elementHasData({ el3_qc_date: "2026-09-01" }, 3));
check("el5 acceptable=false counts as data", elementHasData({ el5_acceptable: 0 }, 5));
check("el6 score=0 counts as data", elementHasData({ el6_score: 0 }, 6));
check("el1 empty specimen is not data", !elementHasData({ el1_specimen_id: "  " }, 1));
// 6) Aggregate across method groups: any incomplete cell -> element incomplete.
{
  const items = [
    { element_number: 1, method_group_id: 10, el1_specimen_id: "S", passed: 1 },
    { element_number: 1, method_group_id: 11, passed: 1 }, // no specimen -> incomplete
  ];
  check("aggregate el1: one group missing data = incomplete", aggregateElementStatus(items, 1) === "incomplete");
}
// 7) Aggregate: all pass -> pass; mix pass+na -> pass; any fail -> fail; all na -> na.
check("aggregate all pass = pass", aggregateElementStatus([{ element_number: 3, method_group_id: 1, el3_qc_date: "d", passed: 1 }], 3) === "pass");
check("aggregate pass+na = pass", aggregateElementStatus([
  { element_number: 3, method_group_id: 1, el3_qc_date: "d", passed: 1 },
  { element_number: 3, method_group_id: 2, el3_na: 1 },
], 3) === "pass");
check("aggregate any fail = fail", aggregateElementStatus([
  { element_number: 3, method_group_id: 1, el3_qc_date: "d", passed: 1 },
  { element_number: 3, method_group_id: 2, el3_qc_date: "d", passed: 0 },
], 3) === "fail");
check("aggregate all na = na", aggregateElementStatus([{ element_number: 3, method_group_id: 1, el3_na: 1 }], 3) === "na");
check("aggregate no rows = none", aggregateElementStatus([], 3) === "none");

// 8) Whole-assessment completeness: 1 method group, 6 elements.
{
  const mgs = [{ id: 10, name: "Chem A" }];
  const complete = [
    { method_group_id: 10, element_number: 1, el1_specimen_id: "S", passed: 1 },
    { method_group_id: 10, element_number: 2, el2_evidence: "E", passed: 1 },
    { method_group_id: 10, element_number: 3, el3_qc_date: "d", passed: 1 },
    { method_group_id: 10, element_number: 4, el4_date_observed: "d", passed: 1 },
    { method_group_id: 10, element_number: 5, el5_na: 1 },
    { method_group_id: 10, element_number: 6, el6_quiz_id: "Q", el6_score: 90, passed: 1 },
  ];
  check("assessment complete when all data-or-na", isAssessmentComplete(complete, mgs, 6));
  const partial = complete.slice(0, 5); // element 6 row missing
  check("assessment incomplete when an element row is missing", !isAssessmentComplete(partial, mgs, 6));
  const emptyEl3 = complete.map((r) => r.element_number === 3 ? { method_group_id: 10, element_number: 3, passed: 1 } : r);
  const cells = incompleteElementCells(emptyEl3, mgs, 6);
  check("incompleteElementCells names the empty element", cells.length === 1 && cells[0].includes("Element 3"), cells.join("; "));
}
// 9) Empty assessment (no items) with method groups -> fully incomplete.
check("no items = all elements incomplete", incompleteElementCells([], [{ id: 1, name: "G" }], 6).length === 6);

// 10) NYS-CLEP (8 elements): El7 Safe Work Practices + El8 Delegated Supervisory.
check("el7 date_observed is data", elementHasData({ el7_date_observed: "2026-09-01" }, 7));
check("el8 function_assessed is data", elementHasData({ el8_function_assessed: "Result review" }, 8));
check("el7 passed w/o data = incomplete", itemElementStatus({ passed: 1 }, 7) === "incomplete");
check("el8 na = na", itemElementStatus({ el8_na: 1 }, 8) === "na");
{
  // A 6-element-complete assessment is INCOMPLETE under the 8-element (NYS) count
  // until El7/El8 are addressed.
  const mgs = [{ id: 10, name: "Chem A" }];
  const sixDone = [1, 2, 3, 4, 5, 6].map((n) => ({ method_group_id: 10, element_number: n, el1_specimen_id: "S", el2_evidence: "E", el3_qc_date: "d", el4_date_observed: "d", el5_sample_id: "x", el6_quiz_id: "Q", passed: 1 }));
  check("6-complete is still incomplete at elementCount 8", !isAssessmentComplete(sixDone, mgs, 8));
  check("6-complete IS complete at elementCount 6", isAssessmentComplete(sixDone, mgs, 6));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
