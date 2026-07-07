// scripts/verify-censored-study-status.mjs
//
// Receipt for the censoring-aware computeStudyStatus fix. A method-comparison /
// cal-ver study with below-detection (censored) points was stamped FAIL on the
// dashboard because the stored-verdict math treated the {censored,...} object as
// a value -> NaN -> per-point fail. The detail page applied the censoring policy
// (exclude) and showed PASS. This proves the resolver (real shared primitives)
// drops censored points under exclude, so a passing study computes PASS.
// Run: npx tsx scripts/verify-censored-study-status.mjs

import { isCensored, censorValueForMath } from "../shared/censoring.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

// The exact resolver added to computeStudyStatus.
const resolveVal = (v, policy) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (isCensored(v)) return censorValueForMath(v, policy);
  return typeof v?.value === "number" && Number.isFinite(v.value) ? v.value : null;
};

// Replicates the two-instrument method_comparison per-point verdict core.
function mcVerdict(points, names, tea, policy) {
  const [primary, comp] = names;
  let passC = 0, totC = 0;
  for (const d of points) {
    const iv = {};
    for (const k of Object.keys(d.instrumentValues || {})) iv[k] = resolveVal(d.instrumentValues[k], policy);
    const ref = iv[primary], v = iv[comp];
    if (ref === null || v === null) continue;
    totC++;
    if (Math.abs(v - ref) <= Math.abs(ref) * tea + 1e-9) passC++;
  }
  return (passC === totC && totC > 0) ? "pass" : "fail";
}

const NAMES = ["WALUIGI, Siemens CA-600", "WARIO, Siemens CA-600"];
const cens = { censored: true, censor_direction: "below", censor_value: 0.19 };
// Study 616 shape: 7 close numeric pairs (all within 15%) + 2 censored + empties.
const num = (a, b) => ({ instrumentValues: { [NAMES[0]]: a, [NAMES[1]]: b } });
const points616 = [
  num(0.34, 0.35), num(2.88, 3.28), { instrumentValues: { [NAMES[0]]: cens, [NAMES[1]]: cens } },
  { instrumentValues: { [NAMES[0]]: cens, [NAMES[1]]: cens } }, num(null, null),
  num(3.28, 3.46), num(0.76, 0.74), num(0.83, 0.85), num(0.31, 0.29), num(0.44, 0.38),
];

// 1. Censored primitives behave per policy.
check("resolveVal(number) passthrough", resolveVal(0.34, "exclude"), 0.34);
check("resolveVal(censored, exclude) -> null", resolveVal(cens, "exclude"), null);
check("resolveVal(censored, substitute_lld) -> censor_value", resolveVal(cens, "substitute_lld"), 0.19);
check("resolveVal({value}) -> value", resolveVal({ value: 1.2 }, "exclude"), 1.2);

// 2. The bug scenario: with exclude policy the 2 censored points drop, 7/7 numeric pass -> PASS.
check("study-616-like verdict (exclude) = pass  [was FAIL pre-fix]", mcVerdict(points616, NAMES, 0.15, "exclude"), "pass");

// 3. A genuinely out-of-TEa point still FAILS (no false pass).
const badPoints = [num(1.0, 1.0), num(1.0, 1.5)]; // 50% diff, tea 15%
check("genuinely biased point still fails", mcVerdict(badPoints, NAMES, 0.15, "exclude"), "fail");

// 4. Under substitute_lld the censored points count (0.19 vs 0.19 agree) -> still pass here.
check("study-616-like verdict (substitute_lld) = pass", mcVerdict(points616, NAMES, 0.15, "substitute_lld"), "pass");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
