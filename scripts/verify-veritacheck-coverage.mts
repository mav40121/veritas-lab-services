// scripts/verify-veritacheck-coverage.mts
//
// Receipt for server/veritacheckCoverage.ts (VeritaCheck Coverage endpoint).
// Exercises covered / review / missing, nickname vs model instrument matching,
// and method-comparison need/done, on a small synthetic map + studies.
// Run: npx tsx scripts/verify-veritacheck-coverage.mts

import { computeCoverageFrom } from "../server/veritacheckCoverage.ts";

const instruments = [
  { id: 1, instrument_name: "Ortho VITROS 5600", nickname: "Bonnie" },
  { id: 2, instrument_name: "Sysmex XN-1000", nickname: "R2-D2" },
  { id: 3, instrument_name: "Siemens CA-600", nickname: "Waluigi" },
  { id: 4, instrument_name: "Instrumentation Laboratory GEM Premier 5000", nickname: "Yoshi" },
];
const combos = [
  { analyte: "Vancomycin", specialty: "Toxicology", instrument_id: 1 },
  { analyte: "Glucose", specialty: "General Chemistry", instrument_id: 1 },
  { analyte: "Glucose", specialty: "General Chemistry", instrument_id: 2 },
  { analyte: "A1C", specialty: "Endocrinology", instrument_id: 3 },
  { analyte: "pH", specialty: "Electrolytes", instrument_id: 4 },
];
const studies = [
  { id: 100, test_name: "Vancomycin", instrument: "Bonnie, Ortho VITROS", study_type: "cal_ver", status: "pass", lifecycle_state: "finalized" },
  { id: 101, test_name: "Glucose", instrument: "Bonnie, Ortho VITROS", study_type: "method_comparison", status: "pass", lifecycle_state: "draft" },
  { id: 103, test_name: "pH", instrument: "Yoshi", study_type: "precision", status: "pass", lifecycle_state: "finalized" },
];

const r = computeCoverageFrom(instruments, combos, studies);
const cell = (analyte: string, iid: number) => r.rows.find((x) => x.analyte === analyte && instruments.find((i) => i.instrument_name === x.instrument)?.id === iid);

let pass = 0, fail = 0;
const check = (name: string, got: any, want: any) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

check("Vancomycin on Ortho (nickname+model) -> covered", cell("Vancomycin", 1)?.status, "covered");
check("Glucose on Ortho -> covered", cell("Glucose", 1)?.status, "covered");
check("Glucose on Sysmex (analyte yes, instrument no) -> review", cell("Glucose", 2)?.status, "review");
check("A1C on Siemens (no study) -> missing", cell("A1C", 3)?.status, "missing");
check("pH on GEM matched by nickname 'Yoshi' only -> covered", cell("pH", 4)?.status, "covered");
check("covered study id attached", cell("Vancomycin", 1)?.studyIds, [100]);
check("signed=yes when finalized", cell("Vancomycin", 1)?.signed, "yes");
check("signed=no when draft", cell("Glucose", 1)?.signed, "no");
check("summary covered count", r.summary.covered, 3);
check("summary review count", r.summary.review, 1);
check("summary missing count", r.summary.missing, 1);
check("summary combos", r.summary.combos, 5);
check("method comparisons needed (Glucose on 2 instruments)", r.summary.methodComparisonsNeeded, 1);
check("method comparisons done (id101 is method_comparison)", r.summary.methodComparisonsDone, 1);
check("hasMap true", r.hasMap, true);
check("empty map -> hasMap false", computeCoverageFrom([], [], []).hasMap, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
