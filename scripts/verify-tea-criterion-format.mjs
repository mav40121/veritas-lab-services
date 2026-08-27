// scripts/verify-tea-criterion-format.mjs
//
// Receipt for the 2026-08-26 "custom TEa shows ±0.0%" cosmetic fix. A lab-defined
// (custom) TEa can set a 0% percent goal with only an absolute floor, e.g. ESR
// (an unregulated analyte with no CLIA-defined TEa) at ±3 mm/hr. Before the fix,
// every criterion string rendered "±0.0% or ±3 mm/hr (greater)". Now the zero
// percent term is dropped so it reads "±3 mm/hr".
//
// This mirrors two pieces of source logic and asserts the branch outputs:
//   1. formatTeaCriterion()  in client/src/lib/calculations.ts  (symbol style,
//      used by the form Active-TEa summary, StudyResultsPage formatTeaDisplay,
//      and the cal-ver summary).
//   2. the teaTxt/floorTxt narrative guard in client/src/pages/VeritaCheckPage.tsx
//      (prose style, "X% or Y, whichever is greater").
//
// Run: node scripts/verify-tea-criterion-format.mjs   (exits non-zero on fail)

// --- mirror of formatTeaCriterion (calculations.ts) ---
function formatTeaCriterion(opts) {
  const { isPercentage, value, absoluteFloor, absoluteUnit, valueUnit } = opts;
  const floorTerm =
    absoluteFloor != null && absoluteFloor > 0
      ? `±${absoluteFloor}${absoluteUnit ? ` ${absoluteUnit}` : ""}`
      : "";
  if (!isPercentage) {
    const u = valueUnit ?? absoluteUnit ?? "";
    return `±${value}${u ? ` ${u}` : ""}`;
  }
  const pctTerm = value > 0 ? `±${(value * 100).toFixed(1)}%` : "";
  if (pctTerm && floorTerm) return `${pctTerm} or ${floorTerm} (greater)`;
  return floorTerm || pctTerm || `±${(value * 100).toFixed(1)}%`;
}

// --- mirror of the VeritaCheckPage narrative teaTxt/floorTxt guard ---
function narrative(presetIsPercentage, tea, presetAbsFloor, presetAbsUnit) {
  const teaTxt = !presetIsPercentage
    ? `${tea} ${presetAbsUnit || ""}`.trim()
    : tea > 0
      ? `${(tea * 100).toFixed(1)}%`
      : `${presetAbsFloor ?? 0} ${presetAbsUnit || ""}`.trim();
  const floorTxt = presetIsPercentage && tea > 0 && presetAbsFloor ? ` or ${presetAbsFloor} ${presetAbsUnit || ""}, whichever is greater` : "";
  return `${teaTxt}${floorTxt}`;
}

let fail = 0;
const PM = "±";
const expect = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)}`);
  if (!ok) fail++;
};

console.log("formatTeaCriterion (symbol style):\n");
// THE fix: custom absolute-only TEa (ESR) drops the 0% term.
expect("ESR custom 0% + 3 mm/hr floor", formatTeaCriterion({ isPercentage: true, value: 0, absoluteFloor: 3, absoluteUnit: "mm/hr" }), `${PM}3 mm/hr`);
// Regulated dual criterion is unchanged.
expect("Glucose 8% + 6 mg/dL", formatTeaCriterion({ isPercentage: true, value: 0.08, absoluteFloor: 6, absoluteUnit: "mg/dL" }), `${PM}8.0% or ${PM}6 mg/dL (greater)`);
// Percent-only unchanged.
expect("Percent only 15%", formatTeaCriterion({ isPercentage: true, value: 0.15, absoluteFloor: null }), `${PM}15.0%`);
// Pure absolute mode unchanged.
expect("Pure absolute 5 mm Hg", formatTeaCriterion({ isPercentage: false, value: 5, valueUnit: "mm Hg" }), `${PM}5 mm Hg`);
// Cal-ver path passes no unit: floor renders without a unit (matches prior behavior).
expect("Custom 0% + floor 3, no unit", formatTeaCriterion({ isPercentage: true, value: 0, absoluteFloor: 3 }), `${PM}3`);
// Degenerate 0% with no floor falls back to the percent (invalid state, must not crash).
expect("0% and no floor -> fallback", formatTeaCriterion({ isPercentage: true, value: 0, absoluteFloor: null }), `${PM}0.0%`);

console.log("\nnarrative guard (prose style):\n");
expect("ESR custom 0% + 3 mm/hr -> floor only", narrative(true, 0, 3, "mm/hr"), "3 mm/hr");
expect("Glucose 8% + 6 mg/dL prose", narrative(true, 0.08, 6, "mg/dL"), "8.0% or 6 mg/dL, whichever is greater");
expect("Percent only prose", narrative(true, 0.15, null, ""), "15.0%");

if (fail) { console.error(`\n${fail} FAIL(s)`); process.exit(1); }
console.log("\nAll TEa criterion formatting checks passed.");
