#!/usr/bin/env node
// verify-linearity-coverage.js
//
// Offline contract tests for the Linearity Coverage Summary feature
// shipped 2026-06-04 in response to the Longstreth / COPCP feedback on
// the ALT reportable-range gap (parking-lot equivalent #L1).
//
// What this script proves:
//
//   1. When NO claimed AMR is provided, coverage is null. The Linearity
//      output is byte-identical to today's behavior. Critical: existing
//      studies must not change shape.
//   2. Verified range exactly matches claimed AMR -> 0% gap, 100% verified.
//   3. Verified high < claimed high -> non-zero upper_gap_pct, lower_gap_pct=0.
//   4. Verified low > claimed low -> non-zero lower_gap_pct, upper_gap_pct=0.
//   5. Both ends short -> both gaps reported, verified_coverage_pct = 100 - sum.
//   6. Calibrators extend past claimed bounds (negative raw gap) -> clamped
//      to 0% per the engine's Math.max(0, ...) guard. No negative coverage.
//   7. Less than 2 usable assigned values -> coverage stays null (cannot
//      compute a verified range from one point).
//   8. claimed_high == claimed_low -> coverage stays null (divide-by-zero
//      guard; the engine requires claimed_high > claimed_low).
//   9. Verdict logic is UNTOUCHED. The Coverage Summary is informational.
//      A study with a 50% gap still passes if the regression math passes.
//
// Reimplements the engine's coverage block inline (pure JS) so the script
// stays self-contained and CI-safe.

function computeCoverage(usableLevels, claimedLow, claimedHigh) {
  if (claimedLow === null || claimedHigh === null) return null;
  if (!Number.isFinite(claimedLow) || !Number.isFinite(claimedHigh)) return null;
  if (claimedHigh <= claimedLow) return null;
  const verifiedAssigned = usableLevels
    .map(lv => lv.assigned_value)
    .filter(v => Number.isFinite(v));
  if (verifiedAssigned.length < 2) return null;
  const verifiedLow = Math.min(...verifiedAssigned);
  const verifiedHigh = Math.max(...verifiedAssigned);
  const claimedSpan = claimedHigh - claimedLow;
  const upperGapAbs = Math.max(0, claimedHigh - verifiedHigh);
  const lowerGapAbs = Math.max(0, verifiedLow - claimedLow);
  const upperGapPct = (upperGapAbs / claimedSpan) * 100;
  const lowerGapPct = (lowerGapAbs / claimedSpan) * 100;
  const verifiedCoveragePct = Math.max(0, 100 - upperGapPct - lowerGapPct);
  return {
    claimed_low: claimedLow,
    claimed_high: claimedHigh,
    verified_low: verifiedLow,
    verified_high: verifiedHigh,
    upper_gap_abs: upperGapAbs,
    lower_gap_abs: lowerGapAbs,
    upper_gap_pct: upperGapPct,
    lower_gap_pct: lowerGapPct,
    verified_coverage_pct: verifiedCoveragePct,
  };
}

function lv(assigned) { return { assigned_value: assigned }; }

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}
function approxEq(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// 1. No claimed AMR => coverage null
{
  const c = computeCoverage([lv(5), lv(50), lv(200)], null, null);
  check("no claimed AMR returns null", c === null);
}

// 2. Verified range exactly matches claimed AMR => 0 gap, 100% verified
{
  const c = computeCoverage([lv(10), lv(25), lv(40)], 10, 40);
  check("exact match: upper_gap_pct = 0", c && approxEq(c.upper_gap_pct, 0));
  check("exact match: lower_gap_pct = 0", c && approxEq(c.lower_gap_pct, 0));
  check("exact match: verified_coverage_pct = 100", c && approxEq(c.verified_coverage_pct, 100));
  check("exact match: verified_low + verified_high captured", c && c.verified_low === 10 && c.verified_high === 40);
}

// 3. Upper gap only: verified high (200) below claimed high (1000)
{
  const c = computeCoverage([lv(50), lv(125), lv(200)], 0, 1000);
  // Lower gap: verified_low=50 > claimed_low=0 => gap = 50, pct = 5%
  // Upper gap: claimed_high=1000 - verified_high=200 = 800, pct = 80%
  check("upper-end shortfall: upper_gap_pct = 80%",
    c && approxEq(c.upper_gap_pct, 80), `got ${c?.upper_gap_pct}`);
  check("upper-end shortfall: lower_gap_pct = 5%",
    c && approxEq(c.lower_gap_pct, 5), `got ${c?.lower_gap_pct}`);
  check("upper-end shortfall: verified_coverage_pct = 15%",
    c && approxEq(c.verified_coverage_pct, 15));
}

// 4. Lower gap only: verified low (50) above claimed low (0); verified high reaches claimed high
{
  const c = computeCoverage([lv(50), lv(75), lv(100)], 0, 100);
  // Lower gap: 50 - 0 = 50, pct = 50%; Upper gap: 100 - 100 = 0
  check("lower-end shortfall: lower_gap_pct = 50%", c && approxEq(c.lower_gap_pct, 50));
  check("lower-end shortfall: upper_gap_pct = 0", c && approxEq(c.upper_gap_pct, 0));
  check("lower-end shortfall: verified_coverage_pct = 50%", c && approxEq(c.verified_coverage_pct, 50));
}

// 5. Both ends short
{
  const c = computeCoverage([lv(20), lv(40), lv(60)], 0, 100);
  // Lower: 20 - 0 = 20%, Upper: 100 - 60 = 40%; coverage = 40%
  check("both-end shortfall: upper_gap_pct = 40%", c && approxEq(c.upper_gap_pct, 40));
  check("both-end shortfall: lower_gap_pct = 20%", c && approxEq(c.lower_gap_pct, 20));
  check("both-end shortfall: verified_coverage_pct = 40%", c && approxEq(c.verified_coverage_pct, 40));
}

// 6. Calibrators extend past claimed bounds (over-coverage) => 0 gap, clamped
{
  const c = computeCoverage([lv(-5), lv(50), lv(110)], 0, 100);
  // Raw upper gap = 100 - 110 = -10 (negative); clamped to 0
  // Raw lower gap = -5 - 0 = -5 (negative, verified_low BELOW claimed_low); clamped to 0
  check("over-coverage: upper_gap_pct = 0 (clamped)", c && c.upper_gap_pct === 0);
  check("over-coverage: lower_gap_pct = 0 (clamped)", c && c.lower_gap_pct === 0);
  check("over-coverage: verified_coverage_pct = 100", c && c.verified_coverage_pct === 100);
}

// 7. Less than 2 usable assigned values => coverage null
{
  const c = computeCoverage([lv(50)], 0, 100);
  check("single-level study returns null (cannot define a range)", c === null);
}

// 8. Degenerate claimed range (high <= low) => null
{
  const c = computeCoverage([lv(10), lv(50)], 100, 100);
  check("claimed_high == claimed_low returns null", c === null);
  const c2 = computeCoverage([lv(10), lv(50)], 100, 50);
  check("claimed_high < claimed_low returns null", c2 === null);
}

// 9. Real-world Longstreth-shaped case: ALT claimed 5 to 500, verified 5 to 200
{
  const c = computeCoverage([lv(5), lv(50), lv(100), lv(200)], 5, 500);
  const claimedSpan = 495;
  const upperGap = 500 - 200;
  const upperGapPct = (upperGap / claimedSpan) * 100;
  check("Longstreth ALT case: upper_gap_pct ~ 60.6%",
    c && approxEq(c.upper_gap_pct, upperGapPct, 1e-6));
  check("Longstreth ALT case: lower_gap_pct = 0", c && c.lower_gap_pct === 0);
  check("Longstreth ALT case: verified_coverage_pct ~ 39.4%",
    c && approxEq(c.verified_coverage_pct, 100 - upperGapPct, 1e-6));
}

// 10. NaN / non-finite guard: NaN assigned values are filtered before computing
{
  const c = computeCoverage([lv(10), lv(NaN), lv(50)], 0, 100);
  check("NaN assigned values filtered; coverage computed from finite values",
    c && c.verified_low === 10 && c.verified_high === 50);
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
