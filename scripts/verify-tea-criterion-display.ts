// Receipt for the absolute-TEa criterion display fix (VeritaCheck cal-ver + method-comp).
// Bug: absolute-TEa analytes printed cliaError*100 + "%" -> Sodium +/-4 showed "+/-400.0%".
// Fix: route the criterion string through formatTeaCriterion (handles percentage, absolute,
// and dual-criterion). Run: node_modules/.bin/tsx scripts/verify-tea-criterion-display.ts
import { formatTeaCriterion } from "../client/src/lib/calculations";

let pass = 0, fail = 0;
function eq(label: string, got: string, want: string) {
  if (got === want) { pass++; console.log(`  PASS  ${label}: ${got}`); }
  else { fail++; console.log(`  FAIL  ${label}: got "${got}" want "${want}"`); }
}

// Percentage TEa (value is a fraction).
eq("percentage 8%", formatTeaCriterion({ isPercentage: true, value: 0.08 }), "±8.0%");
// Absolute TEa (value is the absolute number) - the bug printed "±400.0%".
eq("absolute Sodium +/-4", formatTeaCriterion({ isPercentage: false, value: 4 }), "±4");
eq("absolute Sodium +/-4 with unit", formatTeaCriterion({ isPercentage: false, value: 4, absoluteUnit: "mmol/L" }), "±4 mmol/L");
eq("absolute pH +/-0.04", formatTeaCriterion({ isPercentage: false, value: 0.04 }), "±0.04");
// Dual criterion (percentage with an absolute floor) keeps the floor term.
eq("dual 15% or 6 floor", formatTeaCriterion({ isPercentage: true, value: 0.15, absoluteFloor: 6 }), "±15.0% or ±6 (greater)");
// The old-code value for Sodium would have been (4*100).toFixed(1)+"%" = "400.0%".
eq("old-code sanity: 4*100 = 400 (what we no longer print)", String((4 * 100).toFixed(1)), "400.0");

console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
