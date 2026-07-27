// scripts/verify-methodcomp-exclusion.mts
//
// Regression guard for the 2026-07-27 hotfix: on a multi-instrument method
// comparison, director-excluded points must survive the point remap in
// StudyResultsPage so calculateMethodComparison can filter them. Uses study 677
// (San Carlos RBC, R2-D2 vs BB-8, +/-4% goal) with points 6 and 10 excluded.
//
// Proves the harness bites: the OLD map (drops `excluded`) yields FAIL 8/10;
// the FIXED map (spreads ...d) yields PASS 8/8. If a future change drops the
// flag again, the "old map" expectation flips and this fails.
//
// Run: npx tsx scripts/verify-methodcomp-exclusion.mts
import { calculateMethodComparison } from "../client/src/lib/calculations";

const PRIMARY = "R2-D2, Sysmex XN-1000";
const COMP = ["BB-8, Sysmex XN-450"];
const raw: any[] = [
  { level: 1, instrumentValues: { [PRIMARY]: 4.77, [COMP[0]]: 4.66 } },
  { level: 2, instrumentValues: { [PRIMARY]: 4.86, [COMP[0]]: 4.75 } },
  { level: 3, instrumentValues: { [PRIMARY]: 5.15, [COMP[0]]: 5.10 } },
  { level: 4, instrumentValues: { [PRIMARY]: 3.32, [COMP[0]]: 3.27 } },
  { level: 5, instrumentValues: { [PRIMARY]: 3.33, [COMP[0]]: 3.28 } },
  { level: 6, instrumentValues: { [PRIMARY]: 6.27, [COMP[0]]: 5.98 }, excluded: true, exclusion_reason: "Specimen Issue" },
  { level: 7, instrumentValues: { [PRIMARY]: 4.44, [COMP[0]]: 4.35 } },
  { level: 8, instrumentValues: { [PRIMARY]: 4.11, [COMP[0]]: 4.11 } },
  { level: 9, instrumentValues: { [PRIMARY]: 4.58, [COMP[0]]: 4.47 } },
  { level: 10, instrumentValues: { [PRIMARY]: 5.24, [COMP[0]]: 5.02 }, excluded: true, exclusion_reason: "Specimen Issue" },
];

// The OLD (buggy) remap dropped every field except these three.
const oldMap = raw.map(d => ({
  level: d.level,
  expectedValue: d.instrumentValues[PRIMARY] ?? null,
  instrumentValues: Object.fromEntries(COMP.map(n => [n, d.instrumentValues[n] ?? null])),
}));
// The FIXED remap spreads ...d first, preserving `excluded`/`exclusion_reason`.
const fixedMap = raw.map(d => ({
  ...d,
  level: d.level,
  expectedValue: d.instrumentValues[PRIMARY] ?? null,
  instrumentValues: Object.fromEntries(COMP.map(n => [n, d.instrumentValues[n] ?? null])),
}));

const oldRes = calculateMethodComparison(oldMap as any, COMP, 0.04, true, null);
const fixRes = calculateMethodComparison(fixedMap as any, COMP, 0.04, true, null);

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

console.log("OLD map (drops excluded) -> the bug the fix removes");
check("counts all 10 points", oldRes.totalCount === 10, `total=${oldRes.totalCount}`);
check("8 of 10 pass", oldRes.passCount === 8, `pass=${oldRes.passCount}`);
check("verdict is FAIL (harness bites)", oldRes.overallPass === false, `overallPass=${oldRes.overallPass}`);

console.log("FIXED map (keeps excluded) -> what ships");
check("counts only 8 included points", fixRes.totalCount === 8, `total=${fixRes.totalCount}`);
check("all 8 pass", fixRes.passCount === 8, `pass=${fixRes.passCount}`);
check("verdict is PASS", fixRes.overallPass === true, `overallPass=${fixRes.overallPass}`);

console.log(`\n${pass}/${pass + fail} checks passed`);
if (fail > 0) process.exit(1);
