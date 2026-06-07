#!/usr/bin/env node
// verify-deming-ols-ci.js
//
// Backfill for commit 72e203c (2026-03-26) per parking-lot #41.
// That commit added 95% confidence intervals on the OLS slope/intercept,
// Standard Error of Estimate (SEE), and the t-distribution table with
// linear interpolation for intermediate df. The CI fix matters for
// small-n method comparison and cal-ver studies; the prior step-
// function lookup under-estimated t for intermediate df (e.g. df=11
// returned 2.131 instead of 2.201, a 3.2% CI under-coverage).
//
// What this script proves (pure-JS reimplementation transcribed
// verbatim from client/src/lib/calculations.ts as of 72e203c):
//
//   1-3. slopeFn on perfect y=x, y=2x, y=x+5 returns the closed-form slope.
//   4. interceptFn on y=2x+1 returns intercept=1.
//   5. slopeFn n<2 fallback returns 1.
//   6. slopeFn with denominator=0 (all xi equal) returns 1.
//   7. rsq on perfect line returns 1.0.
//   8. rsq n<2 fallback returns 1.
//   9. stddev of {1..5} returns sqrt(2.5).
//  10. stddev n<2 fallback returns 0.
//  11. seeFn on perfect line returns 0 (zero residuals).
//  12. seeFn n<3 fallback returns 0.
//  13. seeFn on a known non-perfect set matches hand-computed SEE.
//  14. tCritical(df=1) returns the table's 12.706.
//  15. tCritical(df=10) returns 2.228.
//  16. tCritical(df=11) returns 2.201 — the specific case the fix
//      targeted (prior step-function returned 2.131).
//  17. tCritical(df=15) returns 2.131.
//  18. tCritical(df=35) returns the linear-interp midpoint between
//      df=30 (2.042) and df=40 (2.021): 2.0315.
//  19. tCritical(df>120) returns the asymptotic 1.960.
//  20. tCritical(df<=1) returns 12.706 (clamp).
//  21. olsCI on perfect line: CI collapses (SEE=0 → margin=0).
//  22. olsCI n<3 fallback: all zeros.
//  23. olsCI on a known non-perfect set matches hand-computed
//      slope/intercept CI bounds.

// ── Reimplementations transcribed from client/src/lib/calculations.ts
//    at commit 72e203c. Verbatim formulas, plain JS, no imports.

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function slopeFn(x, y) {
  const n = x.length; if (n < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0);
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  return den === 0 ? 1 : num / den;
}

function interceptFn(x, y) { return mean(y) - slopeFn(x, y) * mean(x); }

function rsq(x, y) {
  if (x.length < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) ** 2;
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) * y.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  return den === 0 ? 1 : num / den;
}

function stddev(v) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function seeFn(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  const s = slopeFn(x, y), b = interceptFn(x, y);
  const sse = y.reduce((sum, yi, i) => sum + (yi - (s * x[i] + b)) ** 2, 0);
  return Math.sqrt(sse / (n - 2));
}

const T_TABLE = [
  { df: 1, t: 12.706 }, { df: 2, t: 4.303 }, { df: 3, t: 3.182 }, { df: 4, t: 2.776 },
  { df: 5, t: 2.571 }, { df: 6, t: 2.447 }, { df: 7, t: 2.365 }, { df: 8, t: 2.306 },
  { df: 9, t: 2.262 }, { df: 10, t: 2.228 }, { df: 11, t: 2.201 }, { df: 12, t: 2.179 },
  { df: 13, t: 2.160 }, { df: 14, t: 2.145 }, { df: 15, t: 2.131 }, { df: 16, t: 2.120 },
  { df: 17, t: 2.110 }, { df: 18, t: 2.101 }, { df: 19, t: 2.093 }, { df: 20, t: 2.086 },
  { df: 21, t: 2.080 }, { df: 22, t: 2.074 }, { df: 23, t: 2.069 }, { df: 24, t: 2.064 },
  { df: 25, t: 2.060 }, { df: 26, t: 2.056 }, { df: 27, t: 2.052 }, { df: 28, t: 2.048 },
  { df: 29, t: 2.045 }, { df: 30, t: 2.042 }, { df: 40, t: 2.021 }, { df: 50, t: 2.009 },
  { df: 60, t: 2.000 }, { df: 80, t: 1.990 }, { df: 100, t: 1.984 }, { df: 120, t: 1.980 },
];

function tCritical(df) {
  if (df <= 1) return T_TABLE[0].t;
  if (df > 120) return 1.960;
  for (let i = 0; i < T_TABLE.length - 1; i++) {
    const a = T_TABLE[i], b = T_TABLE[i + 1];
    if (df === a.df) return a.t;
    if (df > a.df && df < b.df) {
      const w = (df - a.df) / (b.df - a.df);
      return a.t + w * (b.t - a.t);
    }
  }
  return T_TABLE[T_TABLE.length - 1].t;
}

function olsCI(x, y) {
  const n = x.length;
  if (n < 3) return { slopeLo: 0, slopeHi: 0, interceptLo: 0, interceptHi: 0 };
  const xm = mean(x);
  const s = slopeFn(x, y), b = interceptFn(x, y);
  const see = seeFn(x, y);
  const Sxx = x.reduce((sum, xi) => sum + (xi - xm) ** 2, 0);
  const t = tCritical(n - 2);
  const seSlopeNum = see / Math.sqrt(Sxx);
  const seIntercept = see * Math.sqrt(x.reduce((sum, xi) => sum + xi ** 2, 0) / (n * Sxx));
  return {
    slopeLo: s - t * seSlopeNum,
    slopeHi: s + t * seSlopeNum,
    interceptLo: b - t * seIntercept,
    interceptHi: b + t * seIntercept,
  };
}

// ── Test harness ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function approxEq(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

// ─── 1-3. slopeFn on perfect lines ────────────────────────────────────────
{
  const x = [1, 2, 3, 4, 5];
  check("1. slopeFn y=x: 1.0", approxEq(slopeFn(x, [1, 2, 3, 4, 5]), 1.0, 1e-12));
  check("2. slopeFn y=2x: 2.0", approxEq(slopeFn(x, [2, 4, 6, 8, 10]), 2.0, 1e-12));
  check("3. slopeFn y=x+5: 1.0", approxEq(slopeFn(x, [6, 7, 8, 9, 10]), 1.0, 1e-12));
}

// ─── 4. interceptFn on y = 2x + 1 ──────────────────────────────────────────
{
  check("4. interceptFn y=2x+1: 1.0", approxEq(interceptFn([1, 2, 3, 4, 5], [3, 5, 7, 9, 11]), 1.0, 1e-12));
}

// ─── 5-6. slopeFn fallbacks ────────────────────────────────────────────────
{
  check("5. slopeFn n=0 fallback: 1", slopeFn([], []) === 1);
  check("5. slopeFn n=1 fallback: 1", slopeFn([5], [10]) === 1);
  check("6. slopeFn den=0 (all xi equal): 1", slopeFn([3, 3, 3, 3], [1, 2, 3, 4]) === 1);
}

// ─── 7-8. rsq ──────────────────────────────────────────────────────────────
{
  check("7. rsq on perfect y=2x: 1.0", approxEq(rsq([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1.0, 1e-12));
  check("8. rsq n<2 fallback: 1", rsq([5], [10]) === 1);
}

// ─── 9-10. stddev ──────────────────────────────────────────────────────────
{
  // {1,2,3,4,5}, mean=3, Σ(xi-3)² = 10, variance = 10/4 = 2.5, SD = sqrt(2.5)
  check("9. stddev({1..5}) = sqrt(2.5)", approxEq(stddev([1, 2, 3, 4, 5]), Math.sqrt(2.5), 1e-12));
  check("10. stddev n<2 fallback: 0", stddev([7]) === 0);
}

// ─── 11-13. SEE ────────────────────────────────────────────────────────────
{
  check("11. seeFn on perfect y=2x: 0", approxEq(seeFn([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 0, 1e-12));
  check("12. seeFn n<3 fallback: 0", seeFn([1, 2], [3, 4]) === 0);
  // x=[1..5], y=[2,4,7,8,10] -> slope=2.0, intercept=0.2
  //   residuals: 2-2.2=-0.2; 4-4.2=-0.2; 7-6.2=0.8; 8-8.2=-0.2; 10-10.2=-0.2
  //   SSE = 0.04+0.04+0.64+0.04+0.04 = 0.80
  //   SEE = sqrt(0.80 / 3) = sqrt(0.26666...) ≈ 0.5163977795
  check("13. seeFn known non-perfect set: ~0.5164", approxEq(seeFn([1, 2, 3, 4, 5], [2, 4, 7, 8, 10]), Math.sqrt(0.8 / 3), 1e-9));
}

// ─── 14-20. tCritical table + interpolation ────────────────────────────────
{
  check("14. tCritical(df=1): 12.706", tCritical(1) === 12.706);
  check("15. tCritical(df=10): 2.228", tCritical(10) === 2.228);
  // df=11 is the headline bug-fix case. Prior step-function lookup
  // returned 2.131 (the df=15 value); the patched lookup must return 2.201.
  check("16. tCritical(df=11): 2.201 (regression guard for step-function bug)", tCritical(11) === 2.201);
  check("17. tCritical(df=15): 2.131", tCritical(15) === 2.131);
  // df=35 is between df=30 (2.042) and df=40 (2.021). w = (35-30)/10 = 0.5.
  // Interp: 2.042 + 0.5*(2.021 - 2.042) = 2.042 - 0.0105 = 2.0315.
  check("18. tCritical(df=35): 2.0315 (linear interp 30..40)", approxEq(tCritical(35), 2.0315, 1e-12));
  check("19. tCritical(df>120): 1.960", tCritical(150) === 1.960);
  check("20. tCritical(df<=1): 12.706 clamp", tCritical(0) === 12.706 && tCritical(-5) === 12.706);
}

// ─── 21. olsCI on perfect line (SEE=0 → CI collapses) ──────────────────────
{
  const c = olsCI([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
  check("21. olsCI perfect line: slopeLo = slopeHi = 2.0", approxEq(c.slopeLo, 2.0, 1e-9) && approxEq(c.slopeHi, 2.0, 1e-9));
  check("21. olsCI perfect line: interceptLo = interceptHi = 0.0", approxEq(c.interceptLo, 0.0, 1e-9) && approxEq(c.interceptHi, 0.0, 1e-9));
}

// ─── 22. olsCI n<3 fallback ────────────────────────────────────────────────
{
  const c = olsCI([1, 2], [3, 4]);
  check("22. olsCI n<3 fallback: all zeros", c.slopeLo === 0 && c.slopeHi === 0 && c.interceptLo === 0 && c.interceptHi === 0);
}

// ─── 23. olsCI known non-perfect set (hand-derived) ────────────────────────
{
  // x=[1,2,3,4,5], y=[2,4,7,8,10]
  // OLS slope = Sxy/Sxx = 20/10 = 2.0
  // OLS intercept = 6.2 - 2*3 = 0.2
  // SEE = sqrt(0.8/3) ≈ 0.516397779...
  // df = n-2 = 3, t(0.025, 3) = 3.182
  // Sxx = 10
  // SE_slope = SEE / sqrt(Sxx) = 0.516397779 / sqrt(10) = 0.163299316...
  //   margin_slope = 3.182 * 0.163299316 = 0.519618614...
  //   slopeLo = 2.0 - 0.519618614 = 1.480381386
  //   slopeHi = 2.0 + 0.519618614 = 2.519618614
  // Σxi² = 1+4+9+16+25 = 55
  // SE_intercept = SEE * sqrt(Σxi² / (n*Sxx)) = 0.516397779 * sqrt(55/50)
  //              = 0.516397779 * sqrt(1.1) = 0.516397779 * 1.048808848 = 0.541602560...
  //   margin_intercept = 3.182 * 0.541602560 = 1.723379348...
  //   interceptLo = 0.2 - 1.723379348 = -1.523379348
  //   interceptHi = 0.2 + 1.723379348 = 1.923379348
  const c = olsCI([1, 2, 3, 4, 5], [2, 4, 7, 8, 10]);
  const SEE = Math.sqrt(0.8 / 3);
  const tCrit = 3.182;
  const expSlopeMargin = tCrit * SEE / Math.sqrt(10);
  const expInterceptMargin = tCrit * SEE * Math.sqrt(55 / 50);
  check("23. olsCI: slopeLo ~= 2 - margin", approxEq(c.slopeLo, 2.0 - expSlopeMargin, 1e-9), "got " + c.slopeLo);
  check("23. olsCI: slopeHi ~= 2 + margin", approxEq(c.slopeHi, 2.0 + expSlopeMargin, 1e-9));
  check("23. olsCI: interceptLo ~= 0.2 - margin", approxEq(c.interceptLo, 0.2 - expInterceptMargin, 1e-9), "got " + c.interceptLo);
  check("23. olsCI: interceptHi ~= 0.2 + margin", approxEq(c.interceptHi, 0.2 + expInterceptMargin, 1e-9));
}

console.log("");
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
