// scripts/verify-tea-allowance-appendix.mjs
//
// Math receipt for the verification-PDF appendix verdict fix (2026-07-09).
// The statistical appendix (renderStudyAppendix in server/veritacheck_verification.ts)
// now evaluates cal_ver and method_comparison verdicts with the SAME dual-criterion
// total-allowable-error envelope the authoritative computeStudyStatus uses, PER
// instrument reading. Previously it used a percent-only band on the mean, which
// (a) ignored clia_absolute_floor, (b) mis-scaled an absolute TEa as a percent,
// and (c) hid a single out-of-range instrument behind the mean.
//
// This script encodes the authoritative envelope (mirroring routes.ts ~193-195)
// as the reference, and asserts the NEW appendix logic agrees while the OLD
// (buggy) logic disagreed on the flagged cases. No network, no DB. Run:
//   node scripts/verify-tea-allowance-appendix.mjs

// ---- The shipped helper (must match server/teaAllowance.ts byte-for-byte) ----
function teaAllowanceAt(base, cliaAllowableError, teaIsPercentage, cliaAbsoluteFloor) {
  const pctAllowance = teaIsPercentage ? Math.abs(base) * cliaAllowableError : 0;
  const absAllowance = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : cliaAllowableError;
  return Math.max(pctAllowance, absAllowance);
}
const FP_EPS = 1e-9;

// ---- Authoritative cal_ver verdict, transcribed from routes.ts computeStudyStatus ----
// return (passCount === totalCount && totalCount > 0) ? "pass" : "fail"
function authoritativeCalVer(levels, tea, teaIsPct, floor) {
  let pass = 0, total = 0;
  for (const lv of levels) {
    const allowance = teaAllowanceAt(lv.assigned, tea, teaIsPct, floor);
    for (const v of lv.values) { total++; if (Math.abs(v - lv.assigned) <= allowance + FP_EPS) pass++; }
  }
  return total > 0 && pass === total ? "pass" : "fail";
}

// ---- NEW appendix per-level verdict (what we just shipped) ----
function newAppendixCalVer(levels, tea, teaIsPct, floor) {
  return levels.every(lv => {
    const allowance = teaAllowanceAt(lv.assigned, tea, teaIsPct, floor);
    return tea > 0 ? lv.values.every(v => Math.abs(v - lv.assigned) <= allowance + FP_EPS) : true;
  }) ? "pass" : "fail";
}

// ---- OLD appendix per-level verdict (the bug) ----
function oldAppendixCalVer(levels, tea) {
  const teaPct = tea * 100; // percent-only, on the mean, ignores floor + teaIsPct
  return levels.every(lv => {
    const mean = lv.values.reduce((a, b) => a + b, 0) / lv.values.length;
    const pctRecovery = lv.assigned !== 0 ? (mean / lv.assigned) * 100 : 100;
    const pctDiff = Math.abs(pctRecovery - 100);
    return teaPct > 0 ? pctDiff <= teaPct : true;
  }) ? "pass" : "fail";
}

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> got ${got}, want ${want}`);
}

console.log("=== cal_ver: NEW appendix must match authoritative computeStudyStatus ===");

// Case 1 — mean masks a single out-of-range instrument (percent TEa).
// readings [100, 111] vs assigned 100, 10% band. Mean recovery 105.5% (<=10),
// so OLD passes; but 111 is 11 out (>10), so authoritative + NEW fail.
{
  const levels = [{ assigned: 100, values: [100, 111] }];
  const tea = 0.10, teaIsPct = true, floor = 2;
  check("C1 authoritative", authoritativeCalVer(levels, tea, teaIsPct, floor), "fail");
  check("C1 NEW appendix",  newAppendixCalVer(levels, tea, teaIsPct, floor), "fail");
  check("C1 OLD appendix (was wrong)", oldAppendixCalVer(levels, tea), "pass");
}

// Case 2 — absolute TEa mis-scaled to a percent. assigned 50, abs TEa 3.
// reading 54 is 4 out (>3) => fail. OLD treated 3 as 300% => everything passes.
{
  const levels = [{ assigned: 50, values: [54] }];
  const tea = 3, teaIsPct = false, floor = null;
  check("C2 authoritative", authoritativeCalVer(levels, tea, teaIsPct, floor), "fail");
  check("C2 NEW appendix",  newAppendixCalVer(levels, tea, teaIsPct, floor), "fail");
  check("C2 OLD appendix (was wrong)", oldAppendixCalVer(levels, tea), "pass");
}

// Case 3 — absolute floor prevents a FALSE fail at a low level.
// assigned 5, 10% band = 0.5, floor 2 => envelope 2. reading 6.5 is 1.5 out (<=2) => pass.
// OLD percent-only: 30% deviation > 10% => false fail.
{
  const levels = [{ assigned: 5, values: [6.5] }];
  const tea = 0.10, teaIsPct = true, floor = 2;
  check("C3 authoritative", authoritativeCalVer(levels, tea, teaIsPct, floor), "pass");
  check("C3 NEW appendix",  newAppendixCalVer(levels, tea, teaIsPct, floor), "pass");
  check("C3 OLD appendix (was wrong)", oldAppendixCalVer(levels, tea), "fail");
}

// Case 4 — common percent case with no floor: NEW == OLD (no regression).
{
  const levels = [{ assigned: 100, values: [105] }];
  const tea = 0.10, teaIsPct = true, floor = 0;
  check("C4 authoritative", authoritativeCalVer(levels, tea, teaIsPct, floor), "pass");
  check("C4 NEW appendix",  newAppendixCalVer(levels, tea, teaIsPct, floor), "pass");
  check("C4 OLD appendix (unchanged here)", oldAppendixCalVer(levels, tea), "pass");
}

console.log("\n=== method_comparison: TEa envelope at each MDL ===");
// NEW envelope at an MDL = teaAllowanceAt(mdl, tea, teaIsPct, floor). OLD = tea*mdl always.
function newMcAtMdl(mdl, tea, teaIsPct, floor) { return tea > 0 ? teaAllowanceAt(mdl, tea, teaIsPct, floor) : 0; }
function oldMcAtMdl(mdl, tea) { return tea > 0 ? tea * mdl : 0; }
function verdict(seAbs, env) { return env > 0 ? (seAbs <= env ? "meets" : "does not meet") : "no TEa on file"; }

// Case 5 — absolute TEa at MDL. tea 3 (abs), mdl 10, se_abs 25.
// NEW envelope = 3 => "does not meet". OLD envelope = 30 => "meets" (far too lax).
{
  const env = newMcAtMdl(10, 3, false, null);
  check("C5 NEW envelope == 3", String(env), "3");
  check("C5 NEW verdict", verdict(25, env), "does not meet");
  check("C5 OLD verdict (was wrong)", verdict(25, oldMcAtMdl(10, 3)), "meets");
}

// Case 6 — percent TEa at MDL, no floor: NEW == OLD (no regression).
{
  const env = newMcAtMdl(10, 0.10, true, 0);
  check("C6 NEW envelope == 1", String(env), "1");
  check("C6 NEW verdict", verdict(0.8, env), "meets");
  check("C6 OLD verdict (same here)", verdict(0.8, oldMcAtMdl(10, 0.10)), "meets");
}

// Case 7 — percent TEa at low MDL where floor should protect. tea 10%, mdl 1, floor 2.
// NEW envelope = max(0.1, 2) = 2. OLD = 0.1 (ignores floor).
{
  const env = newMcAtMdl(1, 0.10, true, 2);
  check("C7 NEW envelope == 2", String(env), "2");
  check("C7 NEW verdict (within floor)", verdict(1.5, env), "meets");
  check("C7 OLD verdict (was wrong, too strict)", verdict(1.5, oldMcAtMdl(1, 0.10)), "does not meet");
}

console.log(failures === 0
  ? "\n=== ALL PASS: appendix verdict now matches authoritative dual-criterion ==="
  : `\n=== ${failures} FAIL ===`);
process.exit(failures === 0 ? 0 : 1);
