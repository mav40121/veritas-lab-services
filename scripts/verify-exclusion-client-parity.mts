// scripts/verify-exclusion-client-parity.mts
//
// Gate 3 / verify receipt for the client/server verdict-parity fix: the client
// calc functions now honor director-excluded points, so the on-screen and PDF
// verdict match the exclusion-aware server status (Phase 2). Imports the REAL
// functions from client/src/lib/calculations and asserts the filter flips the
// verdict when an outlier is excluded.
//
// Run: npx tsx scripts/verify-exclusion-client-parity.mts

import { calculateCalVer, calculateMethodComparison } from "../client/src/lib/calculations";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const inst = ["Analyzer A"];
const tea = 0.10, floor = 0.2;
// 3 levels; L2 is a gross outlier (60% off) that fails the 10% criterion.
const basePoints: any[] = [
  { level: 1, expectedValue: 100, instrumentValues: { "Analyzer A": 104 } }, // 4% ok
  { level: 2, expectedValue: 100, instrumentValues: { "Analyzer A": 160 } }, // 60% FAIL
  { level: 3, expectedValue: 100, instrumentValues: { "Analyzer A": 97 } },  // 3% ok
];
const withExclusion: any[] = basePoints.map((p, i) => (i === 1 ? { ...p, excluded: true, exclusion_reason: "outlier" } : p));

// cal_ver
const cv0 = calculateCalVer(basePoints as any, inst, tea, true, floor);
check("cal_ver with outlier -> FAIL", cv0.overallPass === false, `overallPass=${cv0.overallPass}`);
const cv1 = calculateCalVer(withExclusion as any, inst, tea, true, floor);
check("cal_ver with outlier excluded -> PASS", cv1.overallPass === true, `overallPass=${cv1.overallPass}`);
check("cal_ver excluded point dropped from per-level results", (cv1.levelResults?.length ?? -1) === 2, `levels=${cv1.levelResults?.length}`);

// method_comparison (instrument vs reference; expectedValue is the reference).
const mcInst = ["Inst"];
const mcBase: any[] = [
  { level: 1, expectedValue: 100, instrumentValues: { Inst: 102 } }, // 2% ok
  { level: 2, expectedValue: 100, instrumentValues: { Inst: 165 } }, // 65% FAIL
  { level: 3, expectedValue: 100, instrumentValues: { Inst: 99 } },  // 1% ok
];
const mcExcl: any[] = mcBase.map((p, i) => (i === 1 ? { ...p, excluded: true } : p));
const mc0 = calculateMethodComparison(mcBase as any, mcInst, tea, true, floor);
const mc1 = calculateMethodComparison(mcExcl as any, mcInst, tea, true, floor);
check("method_comparison with outlier -> FAIL", mc0.overallPass === false, `overallPass=${mc0.overallPass}`);
check("method_comparison with outlier excluded -> PASS", mc1.overallPass === true, `overallPass=${mc1.overallPass}`);

// No-exclusion no-op: a clean study computes identically.
const clean: any[] = [
  { level: 1, expectedValue: 100, instrumentValues: { "Analyzer A": 104 } },
  { level: 2, expectedValue: 100, instrumentValues: { "Analyzer A": 103 } },
];
const cA = calculateCalVer(clean as any, inst, tea, true, floor);
const cB = calculateCalVer(clean.map((p) => ({ ...p })) as any, inst, tea, true, floor);
check("no-exclusion study is unaffected (filter is a no-op)", cA.overallPass === cB.overallPass && cA.levelResults.length === 2);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
