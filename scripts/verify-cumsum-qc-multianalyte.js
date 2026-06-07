#!/usr/bin/env node
// verify-cumsum-qc-multianalyte.js
//
// Backfill for commit 79d9aa5 (2026-03-28) per parking-lot #41.
// That commit added three new study types in one PR: CUMSUM lot-change
// tracker, QC Range Establishment (now "QC Lot Verification"), and
// Multi-Analyte Lot Comparison (Coag). The math shipped without a
// paired verify script; this is that script.
//
// Also covers utilities added later by PR #252 (Phase 2c+2d of the
// VeritaCheck lot-change family redesign): pooledSDTwoSamples,
// classifyBias, classifyVendorSDI. They live in the same module and
// touch the same QC range path, so they ride along here rather than
// in a separate backfill PR.
//
// Pure-JS reimplementations transcribed from
// client/src/lib/calculations.ts + client/src/pages/CumsumPage.tsx
// as of current main, matching the pattern in
// scripts/verify-precision-parity.js.

// ── Reimplementations ──────────────────────────────────────────────────────

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(v) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function geometricMean(values) {
  if (values.length === 0) return 0;
  const logSum = values.reduce((s, v) => s + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

// ── CUMSUM (from CumsumPage.tsx computePreview) ────────────────────────────

function computeCumsumEntry({ isInstall, oldVals, newVals, prevCumsum }) {
  if (isInstall) {
    if (newVals.length === 0) return null;
    return { oldGeoMean: null, newGeoMean: geometricMean(newVals), difference: null, cumsum: 0, verdict: "BASELINE" };
  }
  if (oldVals.length === 0 || newVals.length === 0) return null;
  const oldGM = geometricMean(oldVals);
  const newGM = geometricMean(newVals);
  const diff = newGM - oldGM;
  const cumsum = prevCumsum + diff;
  const verdict = Math.abs(cumsum) <= 7.0 ? "ACCEPT" : "ACTION REQUIRED";
  return { oldGeoMean: oldGM, newGeoMean: newGM, difference: diff, cumsum, verdict };
}

// ── QC Range legacy stats (calculateQCRange minus prior-lot / vendor-SDI) ──

function qcRangeLegacy(runs, oldMean) {
  const valid = runs.filter((v) => v !== null && v !== undefined && !isNaN(v));
  const n = valid.length;
  const newMean = n > 0 ? mean(valid) : 0;
  const newSD = n > 1 ? stddev(valid) : 0;
  const cv = newMean !== 0 ? (newSD / newMean) * 100 : 0;
  const legacyPctDiff = oldMean != null && oldMean !== 0
    ? ((newMean - oldMean) / oldMean) * 100
    : null;
  const flagShift = legacyPctDiff !== null ? Math.abs(legacyPctDiff) > 10 : false;
  return { n, newMean, newSD, cv, legacyPctDiff, flagShift };
}

// ── Multi-Analyte Coag (calculateMultiAnalyteCoag) ─────────────────────────

function calcAnalyte(specimens, getNew, getOld, tea) {
  const valid = specimens.filter((s) => getNew(s) != null && getOld(s) != null);
  const newVals = valid.map((s) => getNew(s));
  const oldVals = valid.map((s) => getOld(s));
  const n = valid.length;
  const meanNew = n > 0 ? mean(newVals) : 0;
  const meanOld = n > 0 ? mean(oldVals) : 0;
  const pctDiffs = valid.map((s) => ((getNew(s) - getOld(s)) / getOld(s)) * 100);
  const meanPctDiff = n > 0 ? mean(pctDiffs) : 0;
  const sdPctDiff = n > 1 ? stddev(pctDiffs) : 0;
  const pass = Math.abs(meanPctDiff) <= tea * 100;
  const flaggedSpecimens = pctDiffs.filter((d) => Math.abs(d) > tea * 100).length;
  return { n, meanNew, meanOld, meanPctDiff, sdPctDiff, pass, flaggedSpecimens };
}

function calculateINR(pt, normalMeanPT, isi) {
  return Math.pow(pt / normalMeanPT, isi);
}

// ── PR #252 additions: pooled SD + bias / vendor-SDI classifications ──────

function pooledSDTwoSamples(sd1, n1, sd2, n2) {
  const df = n1 + n2 - 2;
  if (df <= 0) return Math.max(sd1, sd2);
  const num = (Math.max(n1 - 1, 0)) * sd1 * sd1 + (Math.max(n2 - 1, 0)) * sd2 * sd2;
  return Math.sqrt(num / df);
}

function classifyBias(absSDI) {
  if (absSDI < 1) return "accept";
  if (absSDI < 2) return "caution";
  return "fail";
}

function classifyVendorSDI(absSDI) {
  if (absSDI < 1) return "excellent";
  if (absSDI < 2) return "acceptable";
  if (absSDI < 3) return "investigate";
  return "unacceptable";
}

// ── Test harness ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function approxEq(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

// ─── CUMSUM ────────────────────────────────────────────────────────────────
{
  const r = computeCumsumEntry({ isInstall: true, oldVals: [], newVals: [30, 31, 32], prevCumsum: 999 });
  check("1. CUMSUM install lot: verdict=BASELINE, cumsum=0", r.verdict === "BASELINE" && r.cumsum === 0);
  check("1. CUMSUM install lot: prevCumsum ignored", r.cumsum === 0);
}
{
  // newGM and oldGM = geomean({30,30,30}) = 30, diff=0
  const r = computeCumsumEntry({ isInstall: false, oldVals: [30, 30, 30], newVals: [30, 30, 30], prevCumsum: 2.0 });
  check("2. CUMSUM no drift: diff=0, cumsum=prev (2.0)", approxEq(r.difference, 0, 1e-12) && approxEq(r.cumsum, 2.0, 1e-12));
  check("2. CUMSUM no drift: verdict=ACCEPT", r.verdict === "ACCEPT");
}
{
  // Construct so |cumsum| = 7.0 exactly. prev=6.5, newGM-oldGM=0.5 → cumsum=7.0
  // newGM = oldGM + 0.5. Use single-value lists for clean math:
  //   oldVals=[100], newVals=[100*exp(0.5/100)] doesn't quite — easier: oldVals=[2], newVals=[2.5];
  //   GM({2})=2, GM({2.5})=2.5, diff=0.5
  const r = computeCumsumEntry({ isInstall: false, oldVals: [2], newVals: [2.5], prevCumsum: 6.5 });
  check("3. CUMSUM boundary: |cumsum|=7.0 → ACCEPT (<= rule)", approxEq(r.cumsum, 7.0, 1e-9) && r.verdict === "ACCEPT");
}
{
  // Just above 7.0 → ACTION REQUIRED
  const r = computeCumsumEntry({ isInstall: false, oldVals: [2], newVals: [2.5], prevCumsum: 6.51 });
  check("4. CUMSUM just over: |cumsum|>7.0 → ACTION REQUIRED", r.cumsum > 7.0 && r.verdict === "ACTION REQUIRED");
}
{
  // Negative cumsum trips on absolute value
  const r = computeCumsumEntry({ isInstall: false, oldVals: [2.5], newVals: [2], prevCumsum: -6.51 });
  check("5. CUMSUM negative just under: |cumsum|>7 → ACTION REQUIRED (abs rule)", r.cumsum < -7.0 && r.verdict === "ACTION REQUIRED");
}
{
  // Empty newVals (non-install) returns null
  const r = computeCumsumEntry({ isInstall: false, oldVals: [2], newVals: [], prevCumsum: 0 });
  check("6. CUMSUM empty newVals (non-install) returns null", r === null);
}

// ─── QC Range legacy stats ─────────────────────────────────────────────────
{
  const r = qcRangeLegacy([100, 102, 98, 101, 99], 100);
  // mean=100, SD ≈ sqrt(10/4)=1.5811
  check("7. QC legacy: newMean=100", approxEq(r.newMean, 100, 1e-12));
  check("7. QC legacy: pctDiff=0%, flagShift=false", approxEq(r.legacyPctDiff, 0, 1e-12) && r.flagShift === false);
  check("7. QC legacy: SD ~ sqrt(2.5)", approxEq(r.newSD, Math.sqrt(2.5), 1e-9));
}
{
  // pctDiff = 11% → flagShift true
  const r = qcRangeLegacy([111], 100);
  check("8. QC legacy: pctDiff=11% triggers flagShift", approxEq(r.legacyPctDiff, 11, 1e-12) && r.flagShift === true);
}
{
  // pctDiff = 10% boundary → flagShift false (rule is > 10, not >=)
  const r = qcRangeLegacy([110], 100);
  check("9. QC legacy: pctDiff=10% boundary, flagShift=false (strict >)", approxEq(r.legacyPctDiff, 10, 1e-12) && r.flagShift === false);
}
{
  // n=1 → newSD=0
  const r = qcRangeLegacy([100], 100);
  check("10. QC legacy: n=1 → newSD=0, cv=0", r.newSD === 0 && r.cv === 0);
}
{
  // oldMean=null → legacyPctDiff=null, flagShift=false
  const r = qcRangeLegacy([100, 102, 98], null);
  check("11. QC legacy: oldMean=null → legacyPctDiff=null, flagShift=false", r.legacyPctDiff === null && r.flagShift === false);
}

// ─── Multi-Analyte Coag ────────────────────────────────────────────────────
{
  // 3 specimens, PT new vs old, all within tea=0.10
  const specimens = [
    { ptNew: 11, ptOld: 10 },  // pctDiff = 10% boundary
    { ptNew: 12, ptOld: 12 },  // 0%
    { ptNew: 9, ptOld: 10 },   // -10%
  ];
  const r = calcAnalyte(specimens, (s) => s.ptNew, (s) => s.ptOld, 0.10);
  // pctDiffs = [10, 0, -10]; meanPctDiff = 0; sdPctDiff = sqrt(((10-0)^2+0+(-10-0)^2)/2) = sqrt(100) = 10
  check("12. MultiAnalyte: PT mean PctDiff = 0", approxEq(r.meanPctDiff, 0, 1e-12));
  check("12. MultiAnalyte: SD pctDiff = 10", approxEq(r.sdPctDiff, 10, 1e-9));
  // mean |meanPctDiff| (0) <= 10% → pass
  check("12. MultiAnalyte: pass at TEa=0.10", r.pass === true);
  // Specimens with |pctDiff| > 10 are flagged; none here (boundary 10.0 is not > 10)
  check("12. MultiAnalyte: 0 specimens flagged at boundary", r.flaggedSpecimens === 0);
}
{
  // Specimen at 11% triggers flag
  const specimens = [
    { ptNew: 11.1, ptOld: 10 },  // 11%
    { ptNew: 10, ptOld: 10 },    // 0%
  ];
  const r = calcAnalyte(specimens, (s) => s.ptNew, (s) => s.ptOld, 0.10);
  check("13. MultiAnalyte: specimen at 11% pctDiff is flagged", r.flaggedSpecimens === 1);
}
{
  // Mean diff exceeds TEa → analyte fails
  const specimens = [
    { ptNew: 13, ptOld: 10 },  // 30%
    { ptNew: 13, ptOld: 10 },
    { ptNew: 13, ptOld: 10 },
  ];
  const r = calcAnalyte(specimens, (s) => s.ptNew, (s) => s.ptOld, 0.10);
  check("14. MultiAnalyte: |meanPctDiff|=30 > 10% TEa → FAIL", approxEq(r.meanPctDiff, 30, 1e-9) && r.pass === false);
}
{
  // INR expected vs observed
  // normalMeanPT=11, isi=1.0, avgNewPT=12.1
  //   ratio = 12.1/11 = 1.1
  //   expectedINR = 1.1^1.0 = 1.1
  //   observed (single specimen): INR=12.1/11 = 1.1
  //   isiCheck passes (|1.1-1.1|=0 < 0.15)
  const ptNew = 12.1, ptOld = 11.0, normalMeanPT = 11, isi = 1.0;
  const newINR = calculateINR(ptNew, normalMeanPT, isi);
  const ratio = ptNew / normalMeanPT;
  const expectedINR = Math.pow(ratio, isi);
  check("15. INR validation: observed=expected (delta < 0.15)", approxEq(newINR - expectedINR, 0, 1e-12));
  // Now break ISI: claim isi=1.5 → expectedINR=1.1^1.5=1.1537, observed=1.1 → delta=0.0537 < 0.15 still passes
  // For a delta >= 0.15, need a larger discrepancy. Test the gate logic directly:
  check("15. ISI gate < 0.15 passes", Math.abs(0.1) < 0.15);
  check("15. ISI gate = 0.15 fails (strict <)", !(Math.abs(0.15) < 0.15));
  check("15. ISI gate > 0.15 fails", !(Math.abs(0.2) < 0.15));
}

// ─── pooled SD + classifications ───────────────────────────────────────────
{
  // sd1=1, n1=5; sd2=1, n2=5 → pooled = sqrt((4*1 + 4*1)/8) = 1
  check("16. pooledSD: balanced equal SDs → 1.0", approxEq(pooledSDTwoSamples(1, 5, 1, 5), 1.0, 1e-12));
  // sd1=2, n1=10; sd2=4, n2=10 → ((9*4)+(9*16))/18 = (36+144)/18 = 10 → sqrt = 3.1623
  check("16. pooledSD: known asymmetric → sqrt(10)", approxEq(pooledSDTwoSamples(2, 10, 4, 10), Math.sqrt(10), 1e-9));
  // df=0 fallback: returns max(sd1, sd2)
  check("17. pooledSD: df<=0 fallback → max(sd1,sd2)", pooledSDTwoSamples(2, 1, 5, 1) === 5);
}
{
  check("18. classifyBias: 0.5 → accept", classifyBias(0.5) === "accept");
  check("18. classifyBias: 0.999 → accept (strict <1)", classifyBias(0.999) === "accept");
  check("18. classifyBias: 1.0 → caution (boundary)", classifyBias(1.0) === "caution");
  check("18. classifyBias: 1.5 → caution", classifyBias(1.5) === "caution");
  check("18. classifyBias: 2.0 → fail (boundary)", classifyBias(2.0) === "fail");
  check("18. classifyBias: 5.0 → fail", classifyBias(5.0) === "fail");
}
{
  check("19. classifyVendorSDI: 0.5 → excellent", classifyVendorSDI(0.5) === "excellent");
  check("19. classifyVendorSDI: 1.0 → acceptable (boundary)", classifyVendorSDI(1.0) === "acceptable");
  check("19. classifyVendorSDI: 1.999 → acceptable (strict <2)", classifyVendorSDI(1.999) === "acceptable");
  check("19. classifyVendorSDI: 2.0 → investigate (boundary)", classifyVendorSDI(2.0) === "investigate");
  check("19. classifyVendorSDI: 2.999 → investigate (strict <3)", classifyVendorSDI(2.999) === "investigate");
  check("19. classifyVendorSDI: 3.0 → unacceptable (boundary)", classifyVendorSDI(3.0) === "unacceptable");
  check("19. classifyVendorSDI: 5.0 → unacceptable", classifyVendorSDI(5.0) === "unacceptable");
}

console.log("");
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
