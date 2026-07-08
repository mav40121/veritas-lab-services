// scripts/verify-rumke.mts
//
// Gate 3 receipt for the Rümke manual-differential evaluator (server/rumke.ts).
// Proves the dependency-free Clopper-Pearson implementation reproduces the
// published Rümke / CLSI H20 95% confidence limits, and that evaluateManualDiff
// applies "reference within the manual count's CI" correctly (the eos/baso case).
//
// Reference values are the exact binomial 95% limits (percent) a surveyor would
// check against; tolerance 0.1% absolute.
//
// Run: npx tsx scripts/verify-rumke.mts

import { clopperPearson, evaluateManualDiff } from "../server/rumke.ts";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  " + detail}`);
  cond ? pass++ : fail++;
}
function near(a: number, b: number, tol = 0.1) {
  return Math.abs(a - b) <= tol;
}

// --- Published Rümke 95% limits (percent): [x, n, loPct, hiPct] --------------
const TABLE: [number, number, number, number][] = [
  [0, 100, 0.0, 3.62],
  [1, 100, 0.03, 5.45],
  [3, 100, 0.62, 8.52],
  [5, 100, 1.64, 11.28],
  [10, 100, 4.9, 17.62],
  [20, 100, 12.67, 29.18],
  [30, 100, 21.24, 39.98],
  [50, 100, 39.83, 60.17],
  [100, 100, 96.38, 100.0],
  [6, 200, 1.11, 6.42],
  [2, 200, 0.12, 3.57],
];
for (const [x, n, lo, hi] of TABLE) {
  const ci = clopperPearson(x, n);
  const loP = ci.lo * 100;
  const hiP = ci.hi * 100;
  ok(`CI ${x}/${n} lo ≈ ${lo}%`, near(loP, lo), `got ${loP.toFixed(2)}`);
  ok(`CI ${x}/${n} hi ≈ ${hi}%`, near(hiP, hi), `got ${hiP.toFixed(2)}`);
}

// Symmetry sanity: the CI of x/n mirrors (n-x)/n.
{
  const a = clopperPearson(30, 100);
  const b = clopperPearson(70, 100);
  ok("CI symmetry 30/100 vs 70/100", near(a.lo * 100, 100 - b.hi * 100, 0.05) && near(a.hi * 100, 100 - b.lo * 100, 0.05));
}
// Wider N=100 than N=200 at the same proportion (more cells → tighter limits).
{
  const w100 = clopperPearson(3, 100);
  const w200 = clopperPearson(6, 200);
  const width100 = (w100.hi - w100.lo) * 100;
  const width200 = (w200.hi - w200.lo) * 100;
  ok("N=200 tightens the 3% interval vs N=100", width200 < width100, `100→${width100.toFixed(2)}% 200→${width200.toFixed(2)}%`);
}

// --- evaluateManualDiff: the eos/baso worked case (N=100) --------------------
const res = evaluateManualDiff({
  cellsCounted: 100,
  referenceSource: "Sysmex XN-1000 automated differential",
  classes: [
    { name: "Neutrophils", manualCount: 55, referencePct: 58 }, // within 44.7-65.0
    { name: "Lymphocytes", manualCount: 30, referencePct: 33 }, // within 21.2-40.0
    { name: "Monocytes", manualCount: 8, referencePct: 6 },     // within 3.5-15.2
    { name: "Eosinophils", manualCount: 3, referencePct: 10 },  // EXCEEDS 0.6-8.5
    { name: "Basophils", manualCount: 1, referencePct: 4 },     // within 0.0-5.5
  ],
});
const eos = res.classes.find((c) => c.name === "Eosinophils")!;
const baso = res.classes.find((c) => c.name === "Basophils")!;
ok("eos reference 10% EXCEEDS its 0.6-8.5% limit", eos.within === false, `ciHi=${eos.ciHiPct.toFixed(2)}`);
ok("baso reference 4% within its 0.0-5.5% limit", baso.within === true, `ciHi=${baso.ciHiPct.toFixed(2)}`);
ok("overall FAIL because eos exceeded", res.overallPass === false);
ok("count sum tallied correctly (55+30+8+3+1=97)", res.countSum === 97);
ok("all-within case passes", evaluateManualDiff({
  cellsCounted: 100,
  classes: [
    { name: "Neutrophils", manualCount: 55, referencePct: 55 },
    { name: "Eosinophils", manualCount: 3, referencePct: 3 },
    { name: "Basophils", manualCount: 1, referencePct: 1 },
  ],
}).overallPass === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
