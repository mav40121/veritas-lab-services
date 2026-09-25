// scripts/verify-pt-failure.mts
//
// Receipt for the PT-failure investigation logic (Build #3, 2026-09-25).
// Exercises shared/ptFailure.ts: the 80% / 100% (immunohematology) event
// threshold, single-event classification incl. failure-to-participate, the CLIA
// "unsuccessful performance" repeat pattern (two consecutive / two of three),
// and the root-cause category set.
//
// Run: npx tsx scripts/verify-pt-failure.mts   (exits non-zero on fail)

import {
  ptPassingThreshold, classifyPtScore, isUnsuccessfulPattern,
  PT_ROOT_CAUSE_CATEGORIES, rootCauseLabel, type PtEventResult,
} from "../shared/ptFailure";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

// thresholds
check("general threshold is 80", ptPassingThreshold("general") === 80);
check("immunohematology threshold is 100", ptPassingThreshold("immunohematology") === 100);

// single-event classification (general)
check("general 80% is acceptable (boundary)", classifyPtScore(80) === "acceptable");
check("general 79% is unsuccessful", classifyPtScore(79) === "unsuccessful");
check("general 100% is acceptable", classifyPtScore(100) === "acceptable");

// immunohematology needs 100
check("immuno 80% is unsuccessful", classifyPtScore(80, "immunohematology") === "unsuccessful");
check("immuno 100% is acceptable", classifyPtScore(100, "immunohematology") === "acceptable");

// failure to participate (no score)
check("NaN score is unsuccessful (no result / no participation)", classifyPtScore(NaN) === "unsuccessful");

// repeat pattern
const A: PtEventResult = "acceptable", U: PtEventResult = "unsuccessful";
check("single unsuccessful is NOT a pattern", isUnsuccessfulPattern([A, A, U]) === false);
check("two consecutive unsuccessful IS a pattern", isUnsuccessfulPattern([A, U, U]) === true);
check("two of last three (U,A,U) IS a pattern", isUnsuccessfulPattern([U, A, U]) === true);
check("A,A,A is not a pattern", isUnsuccessfulPattern([A, A, A]) === false);
check("only one event, unsuccessful, not yet a pattern", isUnsuccessfulPattern([U]) === false);
check("older failures don't count once cleared (A,U,A -> ok)", isUnsuccessfulPattern([U, A, A]) === false);

// categories
check("6 root-cause categories", PT_ROOT_CAUSE_CATEGORIES.length === 6, String(PT_ROOT_CAUSE_CATEGORIES.length));
check("includes 'no_explanation'", PT_ROOT_CAUSE_CATEGORIES.some(c => c.value === "no_explanation"));
check("no em dash in any category label", PT_ROOT_CAUSE_CATEGORIES.every(c => !c.label.includes("—")));
check("rootCauseLabel resolves", rootCauseLabel("methodology").startsWith("Methodology"));
check("rootCauseLabel of unknown is empty", rootCauseLabel("bogus") === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
