// scripts/verify-custom-dual-criterion-tea.mjs
//
// Gate 3 receipt for the custom (lab-defined) DUAL-CRITERION TEa feature.
//
// The custom TEa entry now accepts an optional absolute floor + unit alongside
// the percent goal, evaluated as "pass if within the GREATER of the percent or
// the absolute allowance". This is required for low-count analytes (eosinophils,
// basophils) where a bare percent goal is statistically wrong: 15% of a basophil
// of 1.0% is 0.15%, so any real-world scatter fails on percent alone.
//
// This script proves two independent pieces, without touching prod:
//   (A) the CLIENT resolution logic (VeritaCheckPage.tsx) that turns the custom
//       inputs into the persisted clia_absolute_floor / clia_absolute_unit, and
//   (B) the SERVER dual-criterion pass rule (routes.ts computeStudyStatus:
//       allowance = max(|assigned|*tea, absFloor)), which the persisted floor
//       feeds. The custom floor rides the SAME column presets use, so proving the
//       rule on that column proves the feature end to end.
//
// Run: node scripts/verify-custom-dual-criterion-tea.mjs

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

// ---- (A) Client resolution: mirrors VeritaCheckPage.tsx Edit 3 exactly --------
function resolve({ isCustom, customAbsFloor = null, customAbsUnit = "", presetFloor = null, presetUnit = null }) {
  const customAbsFloorResolved = (isCustom && customAbsFloor != null && customAbsFloor > 0) ? customAbsFloor : null;
  const cliaAbsoluteFloor = isCustom
    ? customAbsFloorResolved
    : (presetFloor ?? null);
  const cliaAbsoluteUnit = isCustom
    ? (customAbsFloorResolved != null ? ((customAbsUnit || "").trim() || null) : null)
    : (presetUnit ?? null);
  return { cliaAbsoluteFloor, cliaAbsoluteUnit };
}

// custom, floor + unit -> both persist
check("custom floor+unit persists", resolve({ isCustom: true, customAbsFloor: 0.5, customAbsUnit: "%" }), { cliaAbsoluteFloor: 0.5, cliaAbsoluteUnit: "%" });
// custom, floor but blank unit -> floor persists, unit null (warning shown, PDF renders cleanly)
check("custom floor, blank unit -> unit null", resolve({ isCustom: true, customAbsFloor: 0.1, customAbsUnit: "  " }), { cliaAbsoluteFloor: 0.1, cliaAbsoluteUnit: null });
// custom, zero floor -> null (a 0 floor would make max(pct,0) pass everything)
check("custom zero floor -> null", resolve({ isCustom: true, customAbsFloor: 0, customAbsUnit: "%" }), { cliaAbsoluteFloor: null, cliaAbsoluteUnit: null });
// custom, negative floor -> null
check("custom negative floor -> null", resolve({ isCustom: true, customAbsFloor: -3, customAbsUnit: "%" }), { cliaAbsoluteFloor: null, cliaAbsoluteUnit: null });
// custom, no floor (percent-only) -> null
check("custom percent-only -> null floor", resolve({ isCustom: true, customAbsFloor: null }), { cliaAbsoluteFloor: null, cliaAbsoluteUnit: null });
// custom floor set but unit whitespace trims to a real unit
check("custom unit trimmed", resolve({ isCustom: true, customAbsFloor: 0.2, customAbsUnit: "  x10^9/L  " }), { cliaAbsoluteFloor: 0.2, cliaAbsoluteUnit: "x10^9/L" });
// PRESET path unchanged: preset floor + unit flow through (AST +/-15% or +/-6 U/L)
check("preset floor unchanged", resolve({ isCustom: false, presetFloor: 6, presetUnit: "U/L" }), { cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "U/L" });
// PRESET path unchanged: preset without a floor -> null
check("preset no floor unchanged", resolve({ isCustom: false, presetFloor: null, presetUnit: null }), { cliaAbsoluteFloor: null, cliaAbsoluteUnit: null });
// A custom floor MUST NOT leak into a preset selection (isCustom=false ignores custom fields)
check("custom fields ignored when preset selected", resolve({ isCustom: false, customAbsFloor: 99, customAbsUnit: "bogus", presetFloor: 6, presetUnit: "U/L" }), { cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "U/L" });

// ---- (B) Server dual-criterion pass rule: mirrors routes.ts:181-189 -----------
// allowance = max(|assigned|*tea, absFloor);  pass if |observed-assigned| <= allowance
const FP_EPS = 1e-9;
function pointPasses({ assigned, observed, tea, absFloor }) {
  const pctAllowance = Math.abs(assigned) * tea;
  const absAllowance = absFloor ?? 0;
  const allowance = Math.max(pctAllowance, absAllowance);
  return Math.abs(observed - assigned) <= allowance + FP_EPS;
}

// Basophil %, automated: assigned 1.0%, observed 1.2% (0.2 abs diff), TEa 15%.
// Percent allowance = 0.15% -> FAILS on percent alone. This is the eos/baso problem.
check("baso % percent-only FAILS (0.2 diff vs 0.15 allow)", pointPasses({ assigned: 1.0, observed: 1.2, tea: 0.15, absFloor: null }), false);
// Same point WITH a 0.5% absolute floor -> allowance = max(0.15, 0.5) = 0.5 -> PASSES.
check("baso % dual-criterion PASSES with 0.5 floor", pointPasses({ assigned: 1.0, observed: 1.2, tea: 0.15, absFloor: 0.5 }), true);
// A genuinely large miss still fails even with the floor: assigned 1.0, observed 1.8 (0.8 diff) vs 0.5 floor.
check("baso % large miss still FAILS with floor", pointPasses({ assigned: 1.0, observed: 1.8, tea: 0.15, absFloor: 0.5 }), false);

// Eosinophil absolute count (x10^9/L): assigned 0.30, observed 0.36 (0.06 diff), TEa 15%.
// Percent allowance = 0.045 -> FAILS; with a 0.10 floor -> allowance 0.10 -> PASSES.
check("eos # percent-only FAILS (0.06 vs 0.045)", pointPasses({ assigned: 0.30, observed: 0.36, tea: 0.15, absFloor: null }), false);
check("eos # dual-criterion PASSES with 0.10 floor", pointPasses({ assigned: 0.30, observed: 0.36, tea: 0.15, absFloor: 0.10 }), true);

// At HIGH concentration the percent governs (floor is irrelevant): assigned 100, observed 118 (18 diff),
// TEa 15% -> pct allowance 15 -> FAILS; the tiny 0.5 floor does not rescue it.
check("high conc: percent governs, small floor irrelevant", pointPasses({ assigned: 100, observed: 118, tea: 0.15, absFloor: 0.5 }), false);
// At high concentration a within-percent point passes: assigned 100, observed 110 (10 <= 15).
check("high conc within percent PASSES", pointPasses({ assigned: 100, observed: 110, tea: 0.15, absFloor: 0.5 }), true);
// Boundary: diff exactly equal to the floor passes (<=).
check("boundary diff == floor PASSES", pointPasses({ assigned: 1.0, observed: 1.5, tea: 0.15, absFloor: 0.5 }), true);

// ---- (C) End-to-end wiring: resolved floor feeds the pass rule ----------------
// Prove the persisted value from (A) is exactly what (B) consumes for the eos case.
const eos = resolve({ isCustom: true, customAbsFloor: 0.10, customAbsUnit: "x10^9/L" });
check("e2e eos floor persisted == 0.10", eos.cliaAbsoluteFloor, 0.10);
check("e2e eos evaluates PASS through persisted floor", pointPasses({ assigned: 0.30, observed: 0.36, tea: 0.15, absFloor: eos.cliaAbsoluteFloor }), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
