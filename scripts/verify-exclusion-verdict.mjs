// scripts/verify-exclusion-verdict.mjs
//
// Gate 3 receipt for VeritaCheck Phase 2 (exclusion-aware verdict + FAIL->PASS
// justification gate + boot-cascade guard). Reproduces the new server logic
// from server/routes.ts with known inputs and asserts every branch:
//   1. cal_ver verdict honors excluded points (the filter added to
//      computeStudyStatus): a failing point makes it FAIL; excluding that
//      point recomputes to PASS.
//   2. The exclusion endpoint's gate: a FAIL->PASS flip requires a
//      justification (422 without one, persisted with one).
//   3. Including (un-excluding) the point reverts the verdict to FAIL and the
//      override record is cleared.
//   4. dataPointsHaveExclusions (the boot guard): true when any point is
//      excluded, so recomputeAllStudyStatuses skips it (never auto-flips).
//
// Run: node scripts/verify-exclusion-verdict.mjs

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// --- mirror of the exclusion filter + the cal_ver dual-criterion rule -------
// (server/routes.ts computeStudyStatus, cal_ver branch). Only the cal_ver rule
// is reproduced; the point of this test is the EXCLUSION FILTER and the GATE,
// which are study-type-agnostic.
function calVerStatus(dataPoints, instrumentNames, tea, teaIsPct = true, absFloor = null) {
  // Phase 2 filter: drop excluded points before computing.
  const pts = Array.isArray(dataPoints) ? dataPoints.filter((p) => !(p && p.excluded)) : dataPoints;
  const FP_EPS = 1e-9;
  let pass = 0, total = 0;
  for (const dp of pts) {
    if (dp.expectedValue == null) continue;
    const assigned = dp.expectedValue;
    const pctAllow = teaIsPct ? Math.abs(assigned) * tea : 0;
    const absAllow = teaIsPct ? (absFloor ?? 0) : tea;
    const allow = Math.max(pctAllow, absAllow);
    for (const n of instrumentNames) {
      const v = dp.instrumentValues[n];
      if (v != null) { total++; if (Math.abs(v - assigned) <= allow + FP_EPS) pass++; }
    }
  }
  return (pass === total && total > 0) ? "pass" : "fail";
}

function dataPointsHaveExclusions(dp) {
  return Array.isArray(dp) && dp.some((p) => p && p.excluded);
}

// The exclusion endpoint's persist decision (server/routes.ts applyPointExclusion).
// Returns {action, status, override} or {error:'requiresVerdictJustification'}.
function applyExclusionDecision(mode, curStatus, newStatus, justification) {
  const flipFailToPass = curStatus === "fail" && newStatus === "pass";
  if (mode === "exclude" && flipFailToPass) {
    if (!justification || !justification.trim()) {
      return { error: "requiresVerdictJustification", newVerdict: "pass" };
    }
    return { action: "override", status: newStatus, override: { justification: justification.trim(), before: "fail" } };
  }
  const clearOverride = newStatus !== "pass";
  return { action: "persist", status: newStatus, override: clearOverride ? null : "kept" };
}

// --- fixtures ---------------------------------------------------------------
const inst = ["Analyzer A"];
const tea = 0.10; // 10%
// 3 levels; level 2 (idx 1) is a gross outlier that fails at 10% TEa.
const basePoints = [
  { level: 1, expectedValue: 100, instrumentValues: { "Analyzer A": 104 } }, // 4% ok
  { level: 2, expectedValue: 100, instrumentValues: { "Analyzer A": 130 } }, // 30% FAIL
  { level: 3, expectedValue: 100, instrumentValues: { "Analyzer A": 97 } },  // 3% ok
];

// 1) Failing point present -> FAIL
const s0 = calVerStatus(basePoints, inst, tea);
check("cal_ver with outlier computes FAIL", s0 === "fail", `got ${s0}`);

// 2) Exclude the outlier -> filter drops it -> PASS
const excluded = basePoints.map((p, i) => (i === 1 ? { ...p, excluded: true, exclusion_reason: "specimen clot" } : p));
const s1 = calVerStatus(excluded, inst, tea);
check("excluding the outlier recomputes to PASS", s1 === "pass", `got ${s1}`);

// 3) Boot guard detects the exclusion -> recomputeAllStudyStatuses would skip
check("dataPointsHaveExclusions true after exclusion (boot skips)", dataPointsHaveExclusions(excluded) === true);
check("dataPointsHaveExclusions false on clean data (boot recomputes)", dataPointsHaveExclusions(basePoints) === false);

// 4) Gate: FAIL -> PASS without justification is refused
const g1 = applyExclusionDecision("exclude", "fail", "pass", "");
check("FAIL->PASS exclusion without justification is refused", g1.error === "requiresVerdictJustification");

// 5) Gate: FAIL -> PASS with justification records the override + retains pre-fail
const g2 = applyExclusionDecision("exclude", "fail", "pass", "  Outlier from a known clotted specimen, repeat in control. ");
check("FAIL->PASS with justification persists as PASS", g2.action === "override" && g2.status === "pass");
check("override records the justification (trimmed)", g2.override?.justification === "Outlier from a known clotted specimen, repeat in control.");
check("override retains the pre-exclusion FAIL for audit", g2.override?.before === "fail");

// 6) An exclusion that does NOT flip the verdict needs no justification
const g3 = applyExclusionDecision("exclude", "pass", "pass", "");
check("non-flip exclusion needs no justification", g3.action === "persist" && g3.status === "pass");

// 7) Include (un-exclude) reverts to FAIL and clears the override
const reverted = calVerStatus(basePoints, inst, tea); // back to all points
const g4 = applyExclusionDecision("include", "pass", reverted, "");
check("un-excluding reverts the verdict to FAIL", reverted === "fail");
check("revert to FAIL clears the override record", g4.action === "persist" && g4.override === null);

console.log("");
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
