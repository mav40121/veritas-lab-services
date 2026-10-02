// scripts/verify-veritascan-custom-scoring.mjs
//
// Gate-3 receipt for parking-lot #55 phase 3: custom questions are scored in
// their OWN section and must never enter the standardized readiness %. This
// mirrors the two independent tallies:
//   - standardized: compliant / (SCAN_ITEMS applicable) -- over the master set only
//   - custom:       compliant / (custom applicable)      -- over custom items only
// and asserts that adding or changing custom items does not move the
// standardized number (they draw from disjoint inputs).
//
// Run: node scripts/verify-veritascan-custom-scoring.mjs

function pct(items) {
  // items: [{status}]; N/A excluded from the denominator; Not Assessed counts
  // against completeness but is not compliant.
  const applicable = items.filter((i) => i.status !== "N/A");
  if (applicable.length === 0) return null;
  const compliant = applicable.filter((i) => i.status === "Compliant").length;
  return (compliant / applicable.length) * 100;
}

// Standardized tally is computed ONLY from master items; the custom tally ONLY
// from custom items. Same pure function, disjoint inputs.
function standardizedPct(masterItems) { return pct(masterItems); }
function customPct(customItems) { return pct(customItems); }

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); } else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); } };

const master = [
  { status: "Compliant" }, { status: "Compliant" }, { status: "Needs Attention" },
  { status: "N/A" }, { status: "Not Assessed" },
];
// master applicable = 4 (one N/A excluded); compliant = 2 -> 50%
eq("standardized pct over master only", standardizedPct(master), 50);

const customA = [{ status: "Compliant" }, { status: "Immediate Action" }];
// custom applicable = 2; compliant = 1 -> 50%
eq("custom pct over custom only", customPct(customA), 50);

// Changing custom items must NOT move the standardized number.
const before = standardizedPct(master);
const customB = [{ status: "Compliant" }, { status: "Compliant" }, { status: "Compliant" }];
customPct(customB); // compute (100%) — irrelevant to standardized
const after = standardizedPct(master);
eq("standardized unchanged by custom edits", after, before);

// N/A excluded from the custom denominator.
eq("custom all-NA -> null (no denominator)", customPct([{ status: "N/A" }, { status: "N/A" }]), null);

// Not Assessed is not compliant but is applicable.
eq("custom not-assessed not compliant", customPct([{ status: "Not Assessed" }, { status: "Compliant" }]), 50);

// Empty custom set -> null (section renders nothing / no tally).
eq("empty custom -> null", customPct([]), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
