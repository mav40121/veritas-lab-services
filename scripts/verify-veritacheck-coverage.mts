// scripts/verify-veritacheck-coverage.mts
//
// Receipt for server/veritacheckCoverage.ts (VeritaCheck Coverage, required-vs-
// have model). Exercises Cal Ver / Linearity covered/review/missing/exempt with
// both exemptions (3+ calibrators, not calibratable), nickname instrument
// matching, and method-comparison need/done.
// Run: npx tsx scripts/verify-veritacheck-coverage.mts

import { computeCoverageFrom } from "../server/veritacheckCoverage.ts";

const instruments = [
  { id: 1, instrument_name: "Ortho VITROS 5600", nickname: "Bonnie" },
  { id: 2, instrument_name: "Sysmex XN-1000", nickname: "R2-D2" },
  { id: 3, instrument_name: "Siemens CA-600", nickname: "Waluigi" },
  { id: 4, instrument_name: "Instrumentation Laboratory GEM Premier 5000", nickname: "Yoshi" },
];
const combos = [
  { id: 10, analyte: "Vancomycin", specialty: "Toxicology", instrument_id: 1 },
  { id: 11, analyte: "Glucose", specialty: "General Chemistry", instrument_id: 1 },
  { id: 12, analyte: "Glucose", specialty: "General Chemistry", instrument_id: 2 },
  { id: 13, analyte: "A1C", specialty: "Endocrinology", instrument_id: 3, linearity_exempt_multical: 1 },
  { id: 14, analyte: "pH", specialty: "Electrolytes", instrument_id: 4, linearity_exempt_noncal: 1 },
  { id: 15, analyte: "Sodium", specialty: "Electrolytes", instrument_id: 1 },
];
const studies = [
  { id: 100, test_name: "Vancomycin", instrument: "Bonnie, Ortho VITROS", study_type: "cal_ver", status: "pass", lifecycle_state: "finalized" },
  { id: 101, test_name: "Glucose", instrument: "Bonnie, Ortho VITROS", study_type: "method_comparison", status: "pass", lifecycle_state: "draft" },
  { id: 102, test_name: "Sodium", instrument: "R2-D2, Sysmex XN-1000", study_type: "cal_ver", status: "pass", lifecycle_state: "draft" },
];

const r = computeCoverageFrom(instruments, combos, studies);
const row = (id: number) => r.rows.find((x) => x.instrumentTestId === id);

let pass = 0, fail = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

check("Vancomycin cal_ver on Ortho -> covered", row(10)?.linearityStatus, "covered");
check("Glucose@Ortho: only a method_comparison exists -> linearity missing", row(11)?.linearityStatus, "missing");
check("Glucose@Sysmex: no cal_ver -> missing", row(12)?.linearityStatus, "missing");
check("A1C flagged 3+ calibrators -> exempt", row(13)?.linearityStatus, "exempt");
check("A1C exempt not counted as required", row(13)?.linearityRequired, false);
check("pH on GEM flagged not-calibratable -> exempt", row(14)?.linearityStatus, "exempt");
check("Sodium cal_ver exists but on wrong instrument -> review", row(15)?.linearityStatus, "review");
check("covered row carries the study id", row(10)?.studyIds, [100]);
check("summary linearityRequired (6 combos minus 2 exempt)", r.summary.linearityRequired, 4);
check("summary linearityCovered", r.summary.linearityCovered, 1);
check("summary linearityReview", r.summary.linearityReview, 1);
check("summary linearityMissing", r.summary.linearityMissing, 2);
check("summary linearityExempt", r.summary.linearityExempt, 2);
check("method comparisons needed (Glucose on 2 instruments)", r.summary.methodComparisonsNeeded, 1);
check("method comparisons done (id101)", r.summary.methodComparisonsDone, 1);
check("empty map -> hasMap false", computeCoverageFrom([], [], []).hasMap, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
