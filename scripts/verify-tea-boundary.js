#!/usr/bin/env node
// verify-tea-boundary.js
//
// Backfill for commit 6e02c0d (2026-04-06) per parking-lot #41. That commit
// changed three calculation paths to use <= instead of <  when comparing
// observed error against the CLIA TEa boundary. CLIA TEa defines the
// MAXIMUM allowable error: results EXACTLY at the boundary are acceptable,
// not failing. The fix shipped without a paired verify script; this is
// that script.
//
// What this script proves:
//
//   1. Cal Ver per-instrument pass/fail: |e| < TEa => Pass, |e| = TEa => Pass,
//      |e| > TEa => Fail. The "= TEa" branch is the patched-in case.
//   2. Cal Ver per-level mean pass/fail: same semantics.
//   3. Method comparison per-instrument pass/fail: |pctDiff / 100| <= cliaError.
//   4. Same logic across positive and negative observed error (Math.abs).
//   5. Floating-point boundary edges: epsilon-above-TEa fails; the canonical
//      decimal boundary (e.g. 0.10 cliaError, value=110 vs assigned=100)
//      passes despite the IEEE 754 representation quirk.
//
// Reimplements the formulas inline (pure JS) so the script stays
// self-contained and CI-safe; mirrors the pattern in
// scripts/verify-precision-parity.js.

// --- Reimplementations of the patched formulas (verbatim transcribed
//     from client/src/lib/calculations.ts as of 6e02c0d) ---

function calVerInstrumentPassFail(value, assigned, cliaError) {
  const e = assigned !== 0 ? (value - assigned) / assigned : 0;
  return Math.abs(e) <= cliaError ? "Pass" : "Fail";
}

function calVerMeanPassFail(mean, assigned, cliaError) {
  const obsError = assigned !== 0 ? (mean - assigned) / assigned : 0;
  return Math.abs(obsError) <= cliaError ? "Pass" : "Fail";
}

function methodCompPassFail(value, ref, cliaError) {
  const diff = value - ref;
  const pctDiff = ref !== 0 ? (diff / ref) * 100 : 0;
  return Math.abs(pctDiff / 100) <= cliaError ? "Pass" : "Fail";
}

// --- Test harness ---

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}

// 1. Cal Ver per-instrument: just-under TEa is Pass
{
  const v = calVerInstrumentPassFail(109, 100, 0.10);
  check("calVer instrument: 9% error vs 10% TEa => Pass", v === "Pass");
}

// 2. Cal Ver per-instrument: EXACT TEa boundary is Pass (the patched-in branch)
{
  const v = calVerInstrumentPassFail(110, 100, 0.10);
  check("calVer instrument: 10% error vs 10% TEa => Pass (boundary inclusive)", v === "Pass",
    "this is the case 6e02c0d patched -- < would give Fail");
}

// 3. Cal Ver per-instrument: just-over TEa is Fail
{
  const v = calVerInstrumentPassFail(110.001, 100, 0.10);
  check("calVer instrument: 10.001% error vs 10% TEa => Fail", v === "Fail");
}

// 4. Cal Ver per-instrument: negative-side EXACT boundary is Pass
{
  const v = calVerInstrumentPassFail(90, 100, 0.10);
  check("calVer instrument: -10% error vs 10% TEa => Pass (Math.abs)", v === "Pass");
}

// 5. Cal Ver per-instrument: negative-side just-over is Fail
{
  const v = calVerInstrumentPassFail(89.999, 100, 0.10);
  check("calVer instrument: -10.001% error vs 10% TEa => Fail", v === "Fail");
}

// 6. Cal Ver per-instrument: assigned=0 short-circuits to 0 error
{
  const v = calVerInstrumentPassFail(50, 0, 0.10);
  check("calVer instrument: assigned=0 => 0 error => Pass", v === "Pass");
}

// 7. Cal Ver per-level mean: EXACT boundary is Pass
{
  const v = calVerMeanPassFail(110, 100, 0.10);
  check("calVer mean: 10% error vs 10% TEa => Pass (boundary inclusive)", v === "Pass");
}

// 8. Cal Ver per-level mean: just-over is Fail
{
  const v = calVerMeanPassFail(110.0001, 100, 0.10);
  check("calVer mean: 10.0001% error vs 10% TEa => Fail", v === "Fail");
}

// 9. Method comparison: EXACT TEa boundary is Pass
{
  const v = methodCompPassFail(115, 100, 0.15);
  check("methodComp: 15% pct diff vs 15% TEa => Pass (boundary inclusive)", v === "Pass");
}

// 10. Method comparison: just-under is Pass
{
  const v = methodCompPassFail(114.9, 100, 0.15);
  check("methodComp: 14.9% pct diff vs 15% TEa => Pass", v === "Pass");
}

// 11. Method comparison: just-over is Fail
{
  const v = methodCompPassFail(115.001, 100, 0.15);
  check("methodComp: 15.001% pct diff vs 15% TEa => Fail", v === "Fail");
}

// 12. Method comparison: negative side EXACT boundary is Pass
{
  const v = methodCompPassFail(85, 100, 0.15);
  check("methodComp: -15% pct diff vs 15% TEa => Pass (Math.abs)", v === "Pass");
}

// 13. Method comparison: ref=0 short-circuits to 0 diff
{
  const v = methodCompPassFail(50, 0, 0.15);
  check("methodComp: ref=0 => 0 pct diff => Pass", v === "Pass");
}

// 14. CLIA chemistry preset (ALT, ±15%): assigned 50, observed 57.5 (15% high)
{
  const v = calVerInstrumentPassFail(57.5, 50, 0.15);
  check("ALT: 15% high vs 15% TEa => Pass", v === "Pass");
}

// 15. CLIA chemistry preset (Glucose, ±10%): assigned 200, observed 220 (10% high)
{
  const v = calVerInstrumentPassFail(220, 200, 0.10);
  check("Glucose: 10% high vs 10% TEa => Pass", v === "Pass");
}

// 16. IEEE 754 edge case the boundary fix CANNOT eliminate. Hemoglobin assigned
//     14.0, observed 14.98 looks like exactly 7% high to a human reader, but
//     (14.98 - 14) / 14 evaluates to 0.07000000000000001 in IEEE 754, which is
//     technically > 0.07. The <= fix from 6e02c0d covers cases where the math
//     lands on a cleanly representable binary fraction (test 2: 110/100 hits
//     exactly 0.1); it does NOT rescue cases where decimal arithmetic
//     introduces a representation drift. Document this here so future
//     "false fail at the boundary" reports have a known reference.
{
  const v = calVerInstrumentPassFail(14.98, 14, 0.07);
  check("Hemoglobin 14.0 -> 14.98 vs 7% TEa: Fail due to IEEE 754 drift (not a regression of 6e02c0d)",
    v === "Fail",
    "if this ever returns Pass without changing the implementation, IEEE 754 representation has been worked around upstream");
}

// 17. Negative branch with CLIA preset (Potassium, ±0.5 absolute -> here as 12.5%
//     pct equivalent at K=4.0). Pure pct check.
{
  const v = calVerInstrumentPassFail(3.5, 4.0, 0.125);
  check("Potassium 4.0 -> 3.5: 12.5% low vs 12.5% TEa => Pass", v === "Pass");
}

// 18. Floating-point sanity: 0.1 + 0.2 == 0.30000000000000004 in IEEE 754.
//     Make sure the boundary doesn't accidentally fail on the canonical
//     decimal cases above due to representation quirks. (Caught by tests
//     2 and 7 -- this is the explicit guard.)
{
  const e = Math.abs((110 - 100) / 100); // exactly 0.1
  check("IEEE 754: exact-10% case represents as expected for boundary check",
    e === 0.1 && e <= 0.10, `e=${e}`);
}

// 19. Cross-check: the OLD (pre-6e02c0d, strict <) logic would FAIL at the
//     boundary. Mirror the buggy comparison and confirm it would give the
//     wrong answer; that confirms the assertion above is checking the
//     right thing.
{
  function buggyCalVer(value, assigned, cliaError) {
    const e = assigned !== 0 ? (value - assigned) / assigned : 0;
    return Math.abs(e) < cliaError ? "Pass" : "Fail"; // pre-fix
  }
  const v = buggyCalVer(110, 100, 0.10);
  check("pre-fix (<) would return Fail at boundary (proves the fix matters)",
    v === "Fail");
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
