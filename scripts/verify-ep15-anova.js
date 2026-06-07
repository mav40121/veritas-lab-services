#!/usr/bin/env node
// verify-ep15-anova.js
//
// Backfill for commit 9643934 (2026-03-27) per parking-lot #41.
// That commit added the EP15 Precision Verification study type with
// both simple-pool and advanced-ANOVA modes. The simple-pool mode
// (mean / SD / CV / pass-fail vs allowable CV plus the CI parity
// stats) is already cross-covered by scripts/verify-precision-parity.js
// against the Pfizer A-ALT dataset. THIS script covers the advanced
// ANOVA variance-decomposition math that has no other receipt.
//
// Pure-JS reimplementation transcribed from
// client/src/lib/calculations.ts (calculatePrecision advanced branch)
// as of current main, matching the pattern in
// scripts/verify-precision-parity.js.
//
// What this script proves:
//
//   1. Simple-mode SD parity check on a known 4-value set (sanity
//      tie-in with verify-precision-parity.js).
//   2. ANOVA on 2-day × 1-run × 2-rep design (hand-derived
//      ms/var components).
//   3. ANOVA on 2-day × 2-run × 2-rep design (richer hand-derived
//      decomposition).
//   4. msNextDown gate: runs_per_day = 1 forces msNextDown = msWithin
//      rather than the meaningless msBetweenRun = 0.
//   5. varBetweenRun clamping: when msBetweenRun < msWithin, the
//      negative variance estimate clamps to 0.
//   6. Degenerate flat data: all replicates identical → every
//      decomposed SD = 0 and totalSD = 0.
//   7. allowableCV / pass-fail logic: cv <= allowableCV passes;
//      cv > allowableCV fails.
//   8. mean = 0 short-circuit: CVs collapse to 0 without
//      divide-by-zero.

// ── Reimplementations transcribed from client/src/lib/calculations.ts
//    calculatePrecision advanced branch.

function meanFn(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(v) {
  if (v.length < 2) return 0;
  const m = meanFn(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

// Reimplemented from the body of calculatePrecision's advanced branch.
// days: array of day-arrays of replicate values, length = numDays.
// Each day-array is runsPerDay * replicatesPerRun values laid out
// run-major (run0 reps, then run1 reps, etc).
function ep15Anova(days, runsPerDay, replicatesPerRun, allowableCV) {
  const allVals = days.flat().filter((v) => !isNaN(v));
  const n = allVals.length;
  if (n < 2) {
    return { n: 0, mean: 0, sd: 0, cv: 0, passFail: "Fail" };
  }
  const meanVal = meanFn(allVals);
  const sdVal = stddev(allVals);
  const cvVal = meanVal !== 0 ? (sdVal / meanVal) * 100 : 0;

  let ssWithin = 0, dfWithin = 0;
  let ssBetweenRun = 0, dfBetweenRun = 0;
  const dayMeans = [];

  days.forEach((dayRuns) => {
    const runMeans = [];
    for (let r = 0; r < runsPerDay; r++) {
      const runVals = dayRuns
        .slice(r * replicatesPerRun, (r + 1) * replicatesPerRun)
        .filter((v) => !isNaN(v));
      if (runVals.length < 1) continue;
      const rm = meanFn(runVals);
      runMeans.push(rm);
      ssWithin += runVals.reduce((s, v) => s + (v - rm) ** 2, 0);
      dfWithin += runVals.length - 1;
    }
    const dayMean = runMeans.length ? meanFn(runMeans) : 0;
    dayMeans.push(dayMean);
    ssBetweenRun += runMeans.reduce((s, rm) => s + replicatesPerRun * (rm - dayMean) ** 2, 0);
    dfBetweenRun += runMeans.length - 1;
  });

  const grandMean = dayMeans.length ? meanFn(dayMeans) : meanVal;
  const ssBetweenDay = dayMeans.reduce((s, dm) => s + (runsPerDay * replicatesPerRun) * (dm - grandMean) ** 2, 0);
  const dfBetweenDay = dayMeans.length - 1;

  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
  const msBetweenRun = dfBetweenRun > 0 ? ssBetweenRun / dfBetweenRun : 0;
  const msBetweenDay = dfBetweenDay > 0 ? ssBetweenDay / dfBetweenDay : 0;

  const varWithinRun = msWithin;
  const varBetweenRun = Math.max(0, (msBetweenRun - msWithin) / replicatesPerRun);
  const msNextDown = dfBetweenRun > 0 ? msBetweenRun : msWithin;
  const varBetweenDay = Math.max(0, (msBetweenDay - msNextDown) / (runsPerDay * replicatesPerRun));
  const varTotal = varWithinRun + varBetweenRun + varBetweenDay;

  const toCV = (v) => (meanVal !== 0 ? (Math.sqrt(v) / meanVal) * 100 : 0);

  return {
    n, mean: meanVal, sd: sdVal, cv: cvVal,
    passFail: cvVal <= allowableCV ? "Pass" : "Fail",
    msWithin, msBetweenRun, msBetweenDay,
    varWithinRun, varBetweenRun, varBetweenDay, varTotal,
    withinRunSD: Math.sqrt(varWithinRun), withinRunCV: toCV(varWithinRun),
    betweenRunSD: Math.sqrt(varBetweenRun), betweenRunCV: toCV(varBetweenRun),
    betweenDaySD: Math.sqrt(varBetweenDay), betweenDayCV: toCV(varBetweenDay),
    totalSD: Math.sqrt(varTotal), totalCV: toCV(varTotal),
  };
}

// ── Test harness ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function approxEq(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

// ─── 1. Simple-mode SD parity (cross-check with verify-precision-parity) ──
{
  // {100, 102, 104, 106}; mean=103, SD = sqrt(((9+1+1+9)/3)) = sqrt(20/3) ≈ 2.5820
  const vals = [100, 102, 104, 106];
  const sd = stddev(vals);
  check("1. Simple SD on {100,102,104,106} = sqrt(20/3)", approxEq(sd, Math.sqrt(20 / 3), 1e-9), "got " + sd);
}

// ─── 2. ANOVA 2-day × 1-run × 2-rep ────────────────────────────────────────
{
  // Day 1: [100, 102] runMean=101, day1SS within = 1+1=2
  // Day 2: [104, 106] runMean=105, day2SS within = 2
  // ssWithin = 4; dfWithin = (2-1)*2 = 2; msWithin = 2
  // ssBetweenRun = 0 (one run per day → runMeans variance against itself); dfBetweenRun = 0
  //   msBetweenRun = 0
  // dayMeans = [101, 105]; grandMean = 103
  // ssBetweenDay = (1*2) * ((101-103)² + (105-103)²) = 2 * (4+4) = 16
  // dfBetweenDay = 1; msBetweenDay = 16
  // varWithinRun = 2; varBetweenRun = max(0, (0-2)/2) = 0
  // msNextDown = msWithin = 2 (dfBetweenRun=0 → fallback)
  // varBetweenDay = max(0, (16-2)/(1*2)) = 7
  // varTotal = 2 + 0 + 7 = 9 → totalSD = 3
  const r = ep15Anova([[100, 102], [104, 106]], 1, 2, 10);
  check("2. ANOVA 2x1x2: msWithin = 2", approxEq(r.msWithin, 2, 1e-9));
  check("2. ANOVA 2x1x2: msBetweenRun = 0", approxEq(r.msBetweenRun, 0, 1e-9));
  check("2. ANOVA 2x1x2: msBetweenDay = 16", approxEq(r.msBetweenDay, 16, 1e-9));
  check("2. ANOVA 2x1x2: varWithinRun = 2", approxEq(r.varWithinRun, 2, 1e-9));
  check("2. ANOVA 2x1x2: varBetweenRun = 0 (clamped, also single-run)", approxEq(r.varBetweenRun, 0, 1e-9));
  check("2. ANOVA 2x1x2: varBetweenDay = 7 (msNextDown = msWithin)", approxEq(r.varBetweenDay, 7, 1e-9));
  check("2. ANOVA 2x1x2: totalSD = 3 (sqrt(9))", approxEq(r.totalSD, 3, 1e-9));
}

// ─── 3. ANOVA 2-day × 2-run × 2-rep ────────────────────────────────────────
{
  // Day 1 layout: [100,102, 104,106]; run0=[100,102] runMean=101 SS=2; run1=[104,106] runMean=105 SS=2
  //   day1Mean = (101+105)/2 = 103
  //   ssBetweenRun day1 = 2*(101-103)² + 2*(105-103)² = 8+8 = 16
  //   dfBetweenRun day1 = 2-1 = 1
  // Day 2 layout: [108,110, 112,114]; run0=[108,110] rm=109 SS=2; run1=[112,114] rm=113 SS=2
  //   day2Mean = 111; ssBetweenRun day2 = 16; dfBetweenRun day2 = 1
  // ssWithin = 8; dfWithin = 4; msWithin = 2
  // ssBetweenRun = 32; dfBetweenRun = 2; msBetweenRun = 16
  // dayMeans = [103, 111]; grandMean = 107
  // ssBetweenDay = (2*2)*((103-107)² + (111-107)²) = 4*32 = 128
  // dfBetweenDay = 1; msBetweenDay = 128
  // varWithinRun = 2
  // varBetweenRun = max(0, (16-2)/2) = 7
  // msNextDown = msBetweenRun = 16 (dfBetweenRun > 0)
  // varBetweenDay = max(0, (128-16)/(2*2)) = 28
  // varTotal = 2 + 7 + 28 = 37 → totalSD = sqrt(37)
  const r = ep15Anova([[100, 102, 104, 106], [108, 110, 112, 114]], 2, 2, 10);
  check("3. ANOVA 2x2x2: msWithin = 2", approxEq(r.msWithin, 2, 1e-9));
  check("3. ANOVA 2x2x2: msBetweenRun = 16", approxEq(r.msBetweenRun, 16, 1e-9));
  check("3. ANOVA 2x2x2: msBetweenDay = 128", approxEq(r.msBetweenDay, 128, 1e-9));
  check("3. ANOVA 2x2x2: varWithinRun = 2", approxEq(r.varWithinRun, 2, 1e-9));
  check("3. ANOVA 2x2x2: varBetweenRun = 7", approxEq(r.varBetweenRun, 7, 1e-9));
  check("3. ANOVA 2x2x2: varBetweenDay = 28 (msNextDown = msBetweenRun = 16)", approxEq(r.varBetweenDay, 28, 1e-9));
  check("3. ANOVA 2x2x2: totalSD = sqrt(37)", approxEq(r.totalSD, Math.sqrt(37), 1e-9));
}

// ─── 4. msNextDown gate (runs_per_day = 1 → msWithin) ─────────────────────
{
  // This is the headline bug-fix in 9643934's expected-mean-square ladder
  // for single-run-per-day designs. Without the patch, msNextDown = 0
  // would over-estimate varBetweenDay by msWithin/replicatesPerRun.
  // We assert the fallback path here.
  // Same case as branch 2: 2-day × 1-run × 2-rep. The fact that
  // varBetweenDay = 7, not (msBetweenDay - 0)/(1*2) = 8, proves the gate.
  const r = ep15Anova([[100, 102], [104, 106]], 1, 2, 10);
  const wrongIfGateMissing = r.msBetweenDay / (1 * 2);  // = 8
  const correctWithGate = 7;
  check("4. msNextDown gate: varBetweenDay = 7 (correct), not 8 (would be if msNextDown=0)",
    approxEq(r.varBetweenDay, correctWithGate, 1e-9) && !approxEq(r.varBetweenDay, wrongIfGateMissing, 1e-9));
}

// ─── 5. varBetweenRun clamping when msBetweenRun < msWithin ───────────────
{
  // Construct a case where msBetweenRun < msWithin so the raw
  // (msBetweenRun - msWithin)/replicatesPerRun is negative.
  // Within-run variance is intentionally larger than the between-run.
  //   Day 1 run0 [90, 110]: rm = 100, SS = 200
  //   Day 1 run1 [99, 101]: rm = 100, SS = 2
  //   Day 1: dayMean=100; ssBetweenRun day1 = 2*(0)+2*(0) = 0
  //   ssWithin day1 = 202
  // ssWithin = 202; dfWithin = 2; msWithin = 101
  // ssBetweenRun = 0; dfBetweenRun = 1; msBetweenRun = 0
  // varBetweenRun_raw = (0 - 101) / 2 = -50.5 → clamps to 0
  const r = ep15Anova([[90, 110, 99, 101]], 2, 2, 10);
  check("5. clamping: msBetweenRun=0 < msWithin=101", approxEq(r.msBetweenRun, 0, 1e-9) && approxEq(r.msWithin, 101, 1e-9));
  check("5. clamping: varBetweenRun = 0 (clamped from negative)", r.varBetweenRun === 0);
}

// ─── 6. Degenerate flat data: all replicates identical ─────────────────────
{
  const r = ep15Anova([[100, 100], [100, 100]], 1, 2, 10);
  check("6. Flat data: msWithin = 0", r.msWithin === 0);
  check("6. Flat data: msBetweenDay = 0", r.msBetweenDay === 0);
  check("6. Flat data: varWithinRun + varBetweenRun + varBetweenDay = 0", r.varWithinRun === 0 && r.varBetweenRun === 0 && r.varBetweenDay === 0);
  check("6. Flat data: totalSD = 0", r.totalSD === 0);
}

// ─── 7. allowableCV pass/fail logic ────────────────────────────────────────
{
  // Pool {100,102,104,106}: simpleSD ≈ 2.582; mean=103; cv ≈ 2.507%
  // allowableCV = 5 → PASS
  const rPass = ep15Anova([[100, 102, 104, 106]], 1, 4, 5);
  check("7. allowableCV=5%: PASS (cv ~ 2.5)", rPass.passFail === "Pass");
  // allowableCV = 1.0 → FAIL
  const rFail = ep15Anova([[100, 102, 104, 106]], 1, 4, 1.0);
  check("7. allowableCV=1.0%: FAIL (cv ~ 2.5)", rFail.passFail === "Fail");
}

// ─── 8. mean = 0 short-circuit (no divide-by-zero) ─────────────────────────
{
  // Force mean to 0 by mixing equal-magnitude positives and negatives.
  // {-1, 1, -1, 1}: mean=0, simpleSD = sqrt(((1+1+1+1)/3)) = sqrt(4/3) ≈ 1.155
  // cv branch must short-circuit to 0 instead of dividing by 0.
  const r = ep15Anova([[-1, 1, -1, 1]], 1, 4, 10);
  check("8. mean=0: cv = 0 (no divide-by-zero)", r.cv === 0);
  check("8. mean=0: withinRunCV = 0, totalCV = 0", r.withinRunCV === 0 && r.totalCV === 0);
}

console.log("");
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
