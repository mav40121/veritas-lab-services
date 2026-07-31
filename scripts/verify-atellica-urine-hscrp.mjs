// Verify the Atellica urine-chemistry + hs-CRP catalog additions
// (COPC / Michael Longstreth feedback 2026-07-29). Asserts the 12 new analytes
// exist on both Siemens Atellica CH 930 / CI 1900 with MODERATE complexity and
// the specialty mirrored from the analyzer's existing serum versions, that
// testCount matches the real test count, and that regular CRP stays distinct.
// Run: node scripts/verify-atellica-urine-hscrp.mjs
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("client/src/lib/fdaInstrumentData.json", "utf-8"));
const MODELS = ["Siemens Atellica CH 930", "Siemens Atellica CI 1900"];
const EXPECT = {
  "Creatinine, urine": "General Chemistry",
  "Calcium, urine": "Electrolytes",
  "Glucose, urine": "General Chemistry",
  "Magnesium, urine": "Electrolytes",
  "Amylase, urine": "General Chemistry",
  "Sodium, urine": "Electrolytes",
  "Potassium, urine": "Electrolytes",
  "Chloride, urine": "Electrolytes",
  "Phosphorus, urine": "General Chemistry",
  "Urea nitrogen, urine": "General Chemistry",
  "Uric acid, urine": "General Chemistry",
  "C-reactive protein, high sensitivity (hs-CRP)": "General Immunology",
};

let pass = 0, fail = 0;
const check = (n, c, d = "") => { c ? (pass++, console.log("  PASS " + n)) : (fail++, console.log("  FAIL " + n + (d ? " -- " + d : ""))); };

for (const m of MODELS) {
  const t = data[m].tests;
  for (const [name, spec] of Object.entries(EXPECT)) {
    const e = t[name];
    check(`${m} :: ${name}`, !!e && e.complexity === "MODERATE" && e.specialty === spec, JSON.stringify(e));
  }
  check(`${m} testCount == len(tests)`, data[m].testCount === Object.keys(t).length, `${data[m].testCount} vs ${Object.keys(t).length}`);
  check(`${m} regular CRP still distinct from hs-CRP`, !!t["C-reactive protein (CRP)"] && !!t["C-reactive protein, high sensitivity (hs-CRP)"]);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
