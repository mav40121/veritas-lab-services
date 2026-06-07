#!/usr/bin/env node
// verify-deming-lot-to-lot.js
//
// Backfill for commit c66cbc6 (2026-03-28) per parking-lot #41.
// That commit added Lot-to-Lot Verification + PT/Coag New Lot
// Validation study types built on Deming regression and an Error Index
// pass/fail criterion. It shipped without a paired verify script; this
// is that script.
//
// What this script proves (pure-JS reimplementation transcribed
// verbatim from client/src/lib/calculations.ts as of c66cbc6, matching
// the pattern in scripts/verify-precision-parity.js):
//
//   1. demingRegression on a perfect y = x line returns slope=1, intercept=0.
//   2. demingRegression on perfect y = 2x returns slope=2, intercept=0.
//   3. demingRegression on perfect y = 2x + 1 returns slope=2, intercept=1.
//   4. demingRegression on perfect y = x + 5 returns slope=1, intercept=5.
//   5. demingRegression on n < 2 returns the {1, 0} fallback.
//   6-9. geometricMean: {2,8}=4, {1,1,1}=1, {1,10,100}=10, empty=0.
//  10-11. calculateINR: pt=12 / normalPT=11 / isi=1 = 12/11; pt=12 / 10 / isi=2 = 1.44.
//  12-13. calculateModule1: 9 of 10 within PT RI passes (10% boundary);
//        8 of 10 within (20% outside) fails.
//  14. calculateModule1: empty PT inputs returns pass=false (n=0 branch).
//  15. calculateDemingModule: r = 1.0 on a perfectly collinear set.
//  16-17. ErrorIndex boundary: |EI|=1.0 PASSES, |EI|=1.000001 FAILS.
//  18-19. Coverage threshold: 9/10 = 90% PASSES (>=90 boundary),
//         8/10 = 80% FAILS.

// ── Reimplementations transcribed from client/src/lib/calculations.ts
//    at commit c66cbc6. Verbatim formulas, plain JS, no imports.

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function demingRegression(x, y) {
  const n = x.length;
  if (n < 2) return { slope: 1, intercept: 0 };
  const xm = mean(x), ym = mean(y);
  const Sxx = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) / (n - 1);
  const Syy = y.reduce((s, yi) => s + (yi - ym) ** 2, 0) / (n - 1);
  const Sxy = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) / (n - 1);
  const slope = (Syy - Sxx + Math.sqrt((Syy - Sxx) ** 2 + 4 * Sxy ** 2)) / (2 * Sxy);
  const intercept = ym - slope * xm;
  return { slope, intercept };
}

function geometricMean(values) {
  if (values.length === 0) return 0;
  const logSum = values.reduce((s, v) => s + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

function calculateINR(pt, normalMeanPT, isi) {
  return Math.pow(pt / normalMeanPT, isi);
}

function calculateModule1(ptValues, isi, ptRI, inrRI) {
  const geoMeanPT = geometricMean(ptValues);
  const specimens = ptValues.map((pt, i) => {
    const inr = calculateINR(pt, geoMeanPT, isi);
    return {
      id: `S${String(i + 1).padStart(5, "0")}`,
      pt, inr,
      ptInRI: pt >= ptRI.low && pt <= ptRI.high,
      inrInRI: inr >= inrRI.low && inr <= inrRI.high,
    };
  });
  const geoMeanINR = geometricMean(specimens.map((s) => s.inr));
  const n = specimens.length;
  const ptOutsideRI = specimens.filter((s) => !s.ptInRI).length;
  const inrOutsideRI = specimens.filter((s) => !s.inrInRI).length;
  const ptRIPass = n > 0 ? (ptOutsideRI / n) <= 0.10 : false;
  const inrRIPass = n > 0 ? (inrOutsideRI / n) <= 0.10 : false;
  return { geoMeanPT, geoMeanINR, n, ptOutsideRI, inrOutsideRI, ptRIPass, inrRIPass, pass: ptRIPass && inrRIPass };
}

// calculateDemingModule shape: returns { regression: { slope, intercept, r, r2, n, see },
// errorIndexResults: [{specimenId, x, y, errorIndex, pass}], coverage, pass }
function calculateDemingModule(xValues, yValues, specimenIds, tea) {
  const dem = demingRegression(xValues, yValues);
  const xm = mean(xValues), ym = mean(yValues);
  const n = xValues.length;
  const Sxx = xValues.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  const Syy = yValues.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  const Sxy = xValues.reduce((s, xi, i) => s + (xi - xm) * (yValues[i] - ym), 0);
  const r = Sxx > 0 && Syy > 0 ? Sxy / Math.sqrt(Sxx * Syy) : 1;

  const errorIndexResults = xValues.map((x, i) => {
    const y = yValues[i];
    const ei = tea > 0 && x !== 0 ? (y - x) / (tea * x) : 0;
    return { specimenId: specimenIds[i], x, y, errorIndex: ei, pass: Math.abs(ei) <= 1.0 };
  });

  const passCount = errorIndexResults.filter((r) => r.pass).length;
  const coverage = n > 0 ? (passCount / n) * 100 : 0;

  return {
    regression: { slope: dem.slope, intercept: dem.intercept, r, r2: r * r, n },
    errorIndexResults,
    coverage,
    pass: coverage >= 90,
  };
}

// ── Test harness ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function approxEq(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

// ─── 1. demingRegression: perfect y = x ────────────────────────────────────
{
  const x = [1, 2, 3, 4, 5];
  const y = [1, 2, 3, 4, 5];
  const r = demingRegression(x, y);
  check("1. Deming y=x: slope=1.0", approxEq(r.slope, 1.0, 1e-9), "got " + r.slope);
  check("1. Deming y=x: intercept=0.0", approxEq(r.intercept, 0.0, 1e-9));
}

// ─── 2. demingRegression: perfect y = 2x ───────────────────────────────────
{
  // Hand-derived:
  //   x̄=3, ȳ=6, Sxx=10/4=2.5, Syy=40/4=10, Sxy=20/4=5
  //   slope = (10 - 2.5 + sqrt((7.5)^2 + 4*25))/10 = (7.5 + sqrt(156.25))/10 = (7.5+12.5)/10 = 2
  //   intercept = 6 - 2*3 = 0
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];
  const r = demingRegression(x, y);
  check("2. Deming y=2x: slope=2.0", approxEq(r.slope, 2.0, 1e-9), "got " + r.slope);
  check("2. Deming y=2x: intercept=0.0", approxEq(r.intercept, 0.0, 1e-9));
}

// ─── 3. demingRegression: perfect y = 2x + 1 ───────────────────────────────
{
  const x = [1, 2, 3, 4, 5];
  const y = [3, 5, 7, 9, 11];
  const r = demingRegression(x, y);
  check("3. Deming y=2x+1: slope=2.0", approxEq(r.slope, 2.0, 1e-9), "got " + r.slope);
  check("3. Deming y=2x+1: intercept=1.0", approxEq(r.intercept, 1.0, 1e-9), "got " + r.intercept);
}

// ─── 4. demingRegression: perfect y = x + 5 ────────────────────────────────
{
  // x̄=3, ȳ=8; deviations identical → Syy=Sxx=2.5, Sxy=2.5
  // slope = (2.5 - 2.5 + sqrt(0 + 4*6.25))/(2*2.5) = sqrt(25)/5 = 5/5 = 1
  // intercept = 8 - 1*3 = 5
  const x = [1, 2, 3, 4, 5];
  const y = [6, 7, 8, 9, 10];
  const r = demingRegression(x, y);
  check("4. Deming y=x+5: slope=1.0", approxEq(r.slope, 1.0, 1e-9), "got " + r.slope);
  check("4. Deming y=x+5: intercept=5.0", approxEq(r.intercept, 5.0, 1e-9), "got " + r.intercept);
}

// ─── 5. demingRegression: n < 2 fallback ──────────────────────────────────
{
  const r0 = demingRegression([], []);
  check("5. Deming n=0 fallback: slope=1, intercept=0", r0.slope === 1 && r0.intercept === 0);
  const r1 = demingRegression([5], [10]);
  check("5. Deming n=1 fallback: slope=1, intercept=0", r1.slope === 1 && r1.intercept === 0);
}

// ─── 6-9. geometricMean ────────────────────────────────────────────────────
{
  check("6. GeoMean({2,8})=4", approxEq(geometricMean([2, 8]), 4, 1e-12));
  check("7. GeoMean({1,1,1})=1", approxEq(geometricMean([1, 1, 1]), 1, 1e-12));
  check("8. GeoMean({1,10,100})=10", approxEq(geometricMean([1, 10, 100]), 10, 1e-9));
  check("9. GeoMean({})=0 (empty branch)", geometricMean([]) === 0);
}

// ─── 10-11. calculateINR ───────────────────────────────────────────────────
{
  // (12/11)^1 = 12/11 ≈ 1.0909
  check("10. INR(12, 11, 1) = 12/11", approxEq(calculateINR(12, 11, 1), 12 / 11, 1e-12));
  // (12/10)^2 = 1.44
  check("11. INR(12, 10, 2) = 1.44", approxEq(calculateINR(12, 10, 2), 1.44, 1e-12));
}

// ─── 12. Module1: 9/10 within PT RI (10% boundary) → PASS ───────────────────
{
  // PT RI = [10, 12]. 9 values in [10..12], 1 outside (15).
  // ptOutsideRI / n = 1/10 = 0.10 ≤ 0.10 → ptRIPass = true.
  // INR RI loose enough that it's not the binding constraint.
  const r = calculateModule1(
    [10, 10, 11, 11, 11, 12, 12, 10, 11, 15],
    1.0,
    { low: 10, high: 12 },
    { low: 0, high: 100 }
  );
  check("12. Module1: ptOutsideRI=1, ptRIPass=true (10% boundary)", r.ptOutsideRI === 1 && r.ptRIPass === true);
  check("12. Module1: overall pass=true", r.pass === true);
}

// ─── 13. Module1: 8/10 within PT RI (20% out) → FAIL ───────────────────────
{
  const r = calculateModule1(
    [10, 10, 11, 11, 11, 12, 12, 10, 15, 15],
    1.0,
    { low: 10, high: 12 },
    { low: 0, high: 100 }
  );
  check("13. Module1: ptOutsideRI=2 / 10 = 20% → ptRIPass=false", r.ptOutsideRI === 2 && r.ptRIPass === false);
  check("13. Module1: overall pass=false", r.pass === false);
}

// ─── 14. Module1: empty inputs → pass=false (n=0 short-circuit) ────────────
{
  const r = calculateModule1([], 1.0, { low: 0, high: 100 }, { low: 0, high: 100 });
  check("14. Module1 empty: pass=false (n=0 branch)", r.pass === false && r.n === 0);
}

// ─── 15. DemingModule: r = 1.0 on perfectly collinear set ──────────────────
{
  const x = [1, 2, 3, 4, 5];
  const y = [2, 4, 6, 8, 10];  // y = 2x
  const r = calculateDemingModule(x, y, ["S1","S2","S3","S4","S5"], 0.20);
  check("15. DemingModule: r = 1.0 on y=2x", approxEq(r.regression.r, 1.0, 1e-9), "got " + r.regression.r);
  check("15. DemingModule: r^2 = 1.0", approxEq(r.regression.r2, 1.0, 1e-9));
  check("15. DemingModule: slope = 2.0", approxEq(r.regression.slope, 2.0, 1e-9));
}

// ─── 16. ErrorIndex boundary: |EI| = 1.0 exactly → PASS ────────────────────
{
  // x=100, y=110, tea=0.10 → ei = 10 / (0.10 * 100) = 10/10 = 1.0 → |ei|=1.0 ≤ 1.0 → pass
  const r = calculateDemingModule([100], [110], ["S1"], 0.10);
  check("16. EI boundary: ei=1.0 PASSES", approxEq(r.errorIndexResults[0].errorIndex, 1.0, 1e-9) && r.errorIndexResults[0].pass === true);
  // x=100, y=90, tea=0.10 → ei = -10/10 = -1.0 → |ei|=1.0 ≤ 1.0 → pass (negative branch)
  const rNeg = calculateDemingModule([100], [90], ["S1"], 0.10);
  check("16. EI negative boundary: ei=-1.0 PASSES", approxEq(rNeg.errorIndexResults[0].errorIndex, -1.0, 1e-9) && rNeg.errorIndexResults[0].pass === true);
}

// ─── 17. ErrorIndex just above 1.0 → FAIL ───────────────────────────────────
{
  // x=100, y=110.001, tea=0.10 → ei = 10.001/10 = 1.0001 → fails
  const r = calculateDemingModule([100], [110.001], ["S1"], 0.10);
  check("17. EI > 1.0: |ei|=1.0001 FAILS", r.errorIndexResults[0].pass === false);
}

// ─── 18. Coverage 90% boundary → PASS ──────────────────────────────────────
{
  // 10 specimens, 9 pass EI (within tea=0.10) and 1 fails.
  // Coverage = 90 → pass=true (>=90 boundary).
  const x = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  const y = [105, 105, 105, 105, 105, 105, 105, 105, 105, 150]; // last one way over
  const ids = x.map((_, i) => "S" + (i+1));
  const r = calculateDemingModule(x, y, ids, 0.10);
  const passCount = r.errorIndexResults.filter((e) => e.pass).length;
  check("18. Coverage 90%: 9/10 within EI threshold", passCount === 9 && approxEq(r.coverage, 90));
  check("18. Coverage 90%: module pass=true (>=90 boundary)", r.pass === true);
}

// ─── 19. Coverage 80% → FAIL ───────────────────────────────────────────────
{
  // 10 specimens, 8 pass EI, 2 fail. Coverage = 80 < 90 → fail.
  const x = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
  const y = [105, 105, 105, 105, 105, 105, 105, 105, 150, 150];
  const ids = x.map((_, i) => "S" + (i+1));
  const r = calculateDemingModule(x, y, ids, 0.10);
  check("19. Coverage 80%: module pass=false", approxEq(r.coverage, 80) && r.pass === false);
}

console.log("");
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
