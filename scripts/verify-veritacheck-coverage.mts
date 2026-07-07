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
  { id: 5, instrument_name: "Ortho VITROS 5600", nickname: "Clyde" }, // second unit of the same model
];
const combos = [
  { id: 10, analyte: "Vancomycin", specialty: "Toxicology", instrument_id: 1 },
  { id: 11, analyte: "Glucose", specialty: "General Chemistry", instrument_id: 1 },
  { id: 12, analyte: "Glucose", specialty: "General Chemistry", instrument_id: 2 },
  { id: 13, analyte: "A1C", specialty: "Endocrinology", instrument_id: 3, linearity_exempt_multical: 1 },
  { id: 14, analyte: "pH", specialty: "Electrolytes", instrument_id: 4, linearity_exempt_noncal: 1 },
  { id: 15, analyte: "Sodium", specialty: "Electrolytes", instrument_id: 1 },
  // ALT runs on both Ortho VITROS 5600 units (Bonnie + Clyde) -> needs a
  // method comparison between them; the two units must show distinctly.
  { id: 16, analyte: "ALT", specialty: "General Chemistry", instrument_id: 1 },
  { id: 17, analyte: "ALT", specialty: "General Chemistry", instrument_id: 5 },
];
const studies = [
  { id: 100, test_name: "Vancomycin", instrument: "Bonnie, Ortho VITROS", study_type: "cal_ver", status: "pass", lifecycle_state: "finalized" },
  { id: 101, test_name: "Glucose", instrument: "Bonnie, Ortho VITROS", study_type: "method_comparison", status: "pass", lifecycle_state: "draft" },
  { id: 102, test_name: "Sodium", instrument: "R2-D2, Sysmex XN-1000", study_type: "cal_ver", status: "pass", lifecycle_state: "draft" },
  // Unaligned: coverage-relevant type, but the name matches NO map analyte, so it
  // is credited nowhere and must surface in unmappedStudies. Signed + passing.
  { id: 103, test_name: "Aspartate Aminotransferase", instrument: "Bonnie", study_type: "method_comparison", status: "pass", lifecycle_state: "finalized", date: "2026-05-01" },
  // Unaligned + failing + not signed. Also proves fail verdict flows through.
  { id: 105, test_name: "Ferritin", instrument: "R2-D2", study_type: "cal_ver", status: "fail", lifecycle_state: "draft", date: "2026-06-01" },
  // Unmatched name but a NON-coverage study type -> must be excluded by the type filter.
  { id: 104, test_name: "Some Random Widget", instrument: "Bonnie", study_type: "precision", status: "pass", lifecycle_state: "draft", date: "2026-04-01" },
];

const r = computeCoverageFrom(instruments, combos, studies);
const row = (id: number) => r.rows.find((x) => x.instrumentTestId === id);
const mc = (analyte: string) => r.methodComparisons.find((x) => x.analyte === analyte);

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
check("row instrument label carries the nickname", row(10)?.instrument, "Ortho VITROS 5600 (Bonnie)");
check("summary linearityRequired (8 combos minus 2 exempt)", r.summary.linearityRequired, 6);
check("summary linearityCovered", r.summary.linearityCovered, 1);
check("summary linearityReview", r.summary.linearityReview, 1);
check("summary linearityMissing", r.summary.linearityMissing, 4);
check("summary linearityExempt", r.summary.linearityExempt, 2);
check("method comparisons needed (Glucose + ALT)", r.summary.methodComparisonsNeeded, 2);
check("method comparisons done (id101 Glucose only)", r.summary.methodComparisonsDone, 1);
check("ALT on two same-model units shows both distinctly", mc("ALT")?.instruments, ["Ortho VITROS 5600 (Bonnie)", "Ortho VITROS 5600 (Clyde)"]);

// Unaligned studies: coverage-relevant studies whose name matches no map analyte.
const us = r.unmappedStudies;
const usIds = us.map((x) => x.id);
check("unaligned surfaces the two unmatched coverage studies (103,105) sorted by name", usIds, [103, 105]);
check("matched studies (100/101/102) are NOT flagged unaligned", usIds.includes(100) || usIds.includes(101) || usIds.includes(102), false);
check("non-coverage study type (precision #104) excluded from unaligned", usIds.includes(104), false);
check("unaligned #103 carries verdict/signed/date", { verdict: us.find((x) => x.id === 103)?.verdict, signed: us.find((x) => x.id === 103)?.signed, date: us.find((x) => x.id === 103)?.date }, { verdict: "pass", signed: true, date: "2026-05-01" });
check("unaligned #105 failing + unsigned", { verdict: us.find((x) => x.id === 105)?.verdict, signed: us.find((x) => x.id === 105)?.signed }, { verdict: "fail", signed: false });
check("unaligned does not inflate coverage counts (covered still 1)", r.summary.linearityCovered, 1);
check("empty map -> hasMap false", computeCoverageFrom([], [], []).hasMap, false);
check("empty map -> unmappedStudies empty", computeCoverageFrom([], [], []).unmappedStudies, []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
