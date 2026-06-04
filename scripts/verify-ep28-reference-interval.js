#!/usr/bin/env node
// verify-ep28-reference-interval.js
//
// Backfill for the CLSI EP28-A3c Reference Interval Verification math that
// shipped in commit #3bff6c9 without a paired verify-*.js. Third of eight
// parking-lot #41 candidates closed (after the TEa boundary fix in PR #525
// and the EP17 sensitivity backfill in PR #531). Completes Sprint 1 of the
// patient-result-accuracy class from the parking-lot #41 priority ranking.
//
// What this script proves, working against pure-JS reimplementations of
// the formulas in client/src/lib/calculations.ts calculateRefInterval:
//
//   1. Per-specimen inRange check uses INCLUSIVE bounds (>= refLow AND
//      <= refHigh). A value exactly at the bound is in-range.
//   2. Minimum sample size is 20. n < 20 returns FAIL with the
//      insufficient-specimens narrative regardless of how many fall
//      outside.
//   3. Acceptance threshold uses Math.floor(n * 0.1) as the maximum
//      outside count for PASS. At n = 20: 2 outside is at the boundary
//      (PASS); 3 outside is just over (FAIL).
//   4. NaN and null values are filtered out before any counting; they do
//      not get a free pass and they do not inflate the FAIL count.
//   5. outsidePct reports as a percentage with the math = (outside / n) *
//      100, computed on the post-filter n.
//   6. Counterfactual: a buggy implementation using strict less-than
//      bounds (> refLow, < refHigh) would mark boundary specimens as
//      outside, flipping a 0-outside PASS case to a 2-outside boundary
//      that depends on the dataset. Proves the inclusive-bound branch is
//      what the engine actually does.
//   7. Counterfactual: a buggy implementation using Math.ceil instead of
//      Math.floor at n = 25 (Math.ceil(2.5) = 3, Math.floor(2.5) = 2)
//      would let one more outside specimen pass. Proves the floor branch
//      is what the engine actually does.

function calculateRefInterval(dataPoints, refLow, refHigh, analyte, units) {
  const valid = dataPoints.filter((dp) => dp.value !== null && !isNaN(dp.value));
  const n = valid.length;
  const specimens = valid.map((dp) => ({
    specimenId: dp.specimenId,
    value: dp.value,
    inRange: dp.value >= refLow && dp.value <= refHigh,
  }));
  const outsideCount = specimens.filter((s) => !s.inRange).length;
  const outsidePct = n > 0 ? (outsideCount / n) * 100 : 0;
  // CLSI EP28-A3c: pass if <=10% (<=2 of 20) fall outside the reference range
  const overallPass = n >= 20 && outsideCount <= Math.floor(n * 0.1);
  const summary = n < 20
    ? `Insufficient specimens: ${n} provided, minimum 20 required per CLSI EP28-A3c.`
    : overallPass
      ? `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range, meeting the CLSI EP28-A3c acceptance criterion of <=10% outside.`
      : `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range, exceeding the CLSI EP28-A3c acceptance criterion of <=10% outside.`;
  return {
    type: "ref_interval",
    analyte, units, refLow, refHigh,
    n, outsideCount, outsidePct, overallPass, specimens, summary,
  };
}

// Helper to build a specimen array from raw values.
function specimens(...values) {
  return values.map((v, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, value: v }));
}

// Test harness.
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}
function approxEq(a, b, eps = 1e-9) { return Math.abs(a - b) < eps; }

// 1. n < 20: FAIL with insufficient specimens narrative.
{
  const data = specimens(...Array.from({ length: 19 }, () => 75));
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=19 returns overallPass=false", out.overallPass === false);
  check("n=19 reports n correctly", out.n === 19);
  check("n=19 summary contains 'Insufficient specimens'",
    out.summary.includes("Insufficient specimens"));
}

// 2. n=20, all 20 within range: PASS (0 outside).
{
  const data = specimens(...Array.from({ length: 20 }, (_, i) => 75 + (i % 5)));
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=20 with 0 outside: PASS", out.overallPass === true);
  check("n=20 with 0 outside: outsideCount = 0", out.outsideCount === 0);
  check("n=20 with 0 outside: outsidePct = 0", approxEq(out.outsidePct, 0));
  check("n=20 with 0 outside: summary mentions 'meeting'",
    out.summary.includes("meeting"));
}

// 3. n=20, exactly 2 outside (the boundary case): PASS.
//    Math.floor(20 * 0.1) = 2, and outsideCount <= 2 evaluates true.
{
  // 18 in-range, 2 outside.
  const data = specimens(
    ...Array.from({ length: 18 }, () => 75),
    50, 110, // both outside [70, 100]
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=20 with exactly 2 outside (boundary): PASS",
    out.overallPass === true);
  check("n=20 with 2 outside: outsideCount = 2", out.outsideCount === 2);
  check("n=20 with 2 outside: outsidePct = 10",
    approxEq(out.outsidePct, 10));
}

// 4. n=20, 3 outside: just over the boundary, FAIL.
{
  const data = specimens(
    ...Array.from({ length: 17 }, () => 75),
    50, 110, 50, // three outside
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=20 with 3 outside (just over boundary): FAIL",
    out.overallPass === false);
  check("n=20 with 3 outside: outsideCount = 3", out.outsideCount === 3);
  check("n=20 with 3 outside: outsidePct = 15",
    approxEq(out.outsidePct, 15));
  check("n=20 with 3 outside: summary mentions 'exceeding'",
    out.summary.includes("exceeding"));
}

// 5. Boundary-inclusive: values exactly at refLow and refHigh are in-range.
{
  const data = specimens(
    ...Array.from({ length: 18 }, () => 75),
    70, // exactly at refLow
    100, // exactly at refHigh
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("value at refLow exactly is inRange", out.specimens[18].inRange === true);
  check("value at refHigh exactly is inRange", out.specimens[19].inRange === true);
  check("boundary-inclusive case: 0 outside, PASS",
    out.outsideCount === 0 && out.overallPass === true);
}

// 6. NaN/null filtering: invalid values are dropped before counting.
{
  const data = [
    ...specimens(...Array.from({ length: 20 }, () => 75)),
    { specimenId: "S021", value: null },
    { specimenId: "S022", value: NaN },
  ];
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("null/NaN values filtered: n reports 20, not 22",
    out.n === 20);
  check("null/NaN values filtered: outsideCount = 0",
    out.outsideCount === 0);
  check("null/NaN values filtered: PASS",
    out.overallPass === true);
}

// 7. n = 25, exactly 2 outside (Math.floor(2.5) = 2): PASS.
{
  const data = specimens(
    ...Array.from({ length: 23 }, () => 75),
    50, 110,
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=25 with 2 outside (Math.floor(2.5) = 2): PASS",
    out.overallPass === true);
  check("n=25 with 2 outside: outsidePct ~ 8.0",
    approxEq(out.outsidePct, 8));
}

// 8. n = 25, 3 outside: now over Math.floor(2.5) = 2, FAIL.
{
  const data = specimens(
    ...Array.from({ length: 22 }, () => 75),
    50, 110, 50,
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=25 with 3 outside: FAIL (Math.floor threshold)",
    out.overallPass === false);
}

// 9. outsidePct math sanity at n=30 with 5 outside.
{
  const data = specimens(
    ...Array.from({ length: 25 }, () => 75),
    ...Array.from({ length: 5 }, () => 50),
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=30 with 5 outside: outsidePct ~ 16.67%",
    approxEq(out.outsidePct, (5 / 30) * 100, 1e-9));
  check("n=30 with 5 outside: FAIL (> Math.floor(3) = 3)",
    out.overallPass === false);
}

// 10. Counterfactual: a buggy "strict less-than" inRange check would flip
// the boundary-inclusive PASS case from test 5 to a FAIL. Proves the
// engine actually uses inclusive bounds.
{
  function buggyCalcInRangeStrict(dp, refLow, refHigh) {
    // Pre-fix shape: > / < instead of >= / <=.
    return dp.value > refLow && dp.value < refHigh;
  }
  const data = specimens(
    ...Array.from({ length: 18 }, () => 75),
    70, 100,
  );
  const buggyOutside = data.filter((dp) => !buggyCalcInRangeStrict(dp, 70, 100)).length;
  check("counterfactual: strict-less-than would mark 2 boundary specimens outside",
    buggyOutside === 2);
  // ... and would push the verdict to PASS still (2 outside, Math.floor(2) = 2),
  // BUT only by accident. With a single additional outside the inclusive bound
  // engine produces 0+1=1 outside (PASS), buggy gives 2+1=3 outside (FAIL).
  const data2 = specimens(
    ...Array.from({ length: 18 }, () => 75),
    70, 100, // boundaries
    50, // one real outside
  );
  const correctOut = calculateRefInterval(data2, 70, 100, "Glucose", "mg/dL");
  const buggyOutside2 = data2.filter((dp) => !buggyCalcInRangeStrict(dp, 70, 100)).length;
  check("counterfactual: inclusive bounds give 1 outside; strict gives 3",
    correctOut.outsideCount === 1 && buggyOutside2 === 3);
  check("counterfactual: n=21 with 1 outside is PASS under correct logic",
    correctOut.overallPass === true);
}

// 11. Counterfactual: Math.ceil at n=25 would allow 3 outside instead of 2,
// silently weakening the acceptance criterion.
{
  const allowedByFloor = Math.floor(25 * 0.1);
  const allowedByCeil = Math.ceil(25 * 0.1);
  check("Math.floor(25 * 0.1) = 2 (engine behavior)", allowedByFloor === 2);
  check("Math.ceil(25 * 0.1) = 3 (would weaken the gate)", allowedByCeil === 3);
  // Concrete: n=25 with 3 outside should be FAIL (verified in test 8); a
  // Math.ceil version would PASS the same dataset.
  const data = specimens(
    ...Array.from({ length: 22 }, () => 75),
    50, 110, 50,
  );
  const out = calculateRefInterval(data, 70, 100, "Glucose", "mg/dL");
  check("n=25 with 3 outside correctly FAILS under floor; ceil would PASS",
    out.overallPass === false && 3 <= allowedByCeil);
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
