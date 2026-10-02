// scripts/verify-diff-correlation-key.mjs
//
// Receipt for the manual-differential correlation fix. The method-comparison
// requirement groups analytes by diffCorrelationKey() so a manual diff percentage
// ("Lymphs") pairs with the analyzer percentage ("Lymph%"/"LY%") as ONE correlation,
// but NEVER with the absolute count ("LY#") and never across classes.
//
// Run: node --import tsx scripts/verify-diff-correlation-key.mjs

import { diffCorrelationKey } from "../shared/presetAnalytes.ts";

let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };
const key = diffCorrelationKey;

console.log("=== manual % pairs with analyzer % (the reported bug) ===");
ok('"Lymphs" (manual) === "Lymph%" (analyzer)', key("Lymphs") === key("Lymph%") && key("Lymphs") === "diff:lymphocyte:pct");
ok('"Lymphs" === "LY%"', key("Lymphs") === key("LY%"));
ok('"Lymphs" === "Lymphocytes"', key("Lymphs") === key("Lymphocytes"));
ok('"Lymphs" === "Lymphocyte %"', key("Lymphs") === key("Lymphocyte %"));
for (const [manual, analyzer, slug] of [
  ["Neuts", "Neutrophil%", "neutrophil"],
  ["Monos", "Mono%", "monocyte"],
  ["Eos", "Eos%", "eosinophil"],
  ["Basos", "Baso%", "basophil"],
  ["Segs", "Neut%", "neutrophil"],
]) ok(`"${manual}" === "${analyzer}" (${slug} pct)`, key(manual) === key(analyzer) && key(manual) === `diff:${slug}:pct`);

console.log("\n=== % must NOT pair with # (the over-match hazard) ===");
ok('"Lymph%" !== "LY#"', key("Lymph%") !== key("LY#"));
ok('"Lymphs" !== "Absolute lymphocytes"', key("Lymphs") !== key("Absolute lymphocytes"));
ok('"LY#" is abs', key("LY#") === "diff:lymphocyte:abs");
ok('"Lymphocyte count" is abs', key("Lymphocyte count") === "diff:lymphocyte:abs");
ok('"Neut#" is abs', key("Neut#") === "diff:neutrophil:abs");

console.log("\n=== classes must NOT cross ===");
ok('"Lymphs" !== "Neutrophils"', key("Lymphs") !== key("Neutrophils"));
ok('"Mono%" !== "Baso%"', key("Mono%") !== key("Baso%"));
ok('"Eos" !== "Lymphs"', key("Eos") !== key("Lymphs"));

console.log("\n=== non-differential analytes return null (unchanged exact-string grouping) ===");
for (const n of ["Glucose", "Hemoglobin", "HGB", "Base excess", "Total Protein", "Creatinine", "WBC", "Platelets", "Monoclonal protein", "Bun", ""])
  ok(`"${n}" -> null`, key(n) === null);

console.log("\n=== grouping simulation: 2 instruments collapse into one correlation ===");
const combos = [
  { analyte: "Lymphs", instrument_id: 10 },   // manual differential instrument
  { analyte: "Lymph%", instrument_id: 11 },   // XN-1000
  { analyte: "LY#", instrument_id: 11 },       // XN-1000 absolute (separate)
  { analyte: "Glucose", instrument_id: 12 },
  { analyte: "Glucose", instrument_id: 13 },
];
const groups = new Map();
for (const c of combos) {
  const k = diffCorrelationKey(c.analyte) ?? c.analyte;
  if (!groups.has(k)) groups.set(k, new Set());
  groups.get(k).add(c.instrument_id);
}
ok("manual Lymphs + analyzer Lymph% group has 2 instruments -> correlation needed",
  (groups.get("diff:lymphocyte:pct") || new Set()).size === 2);
ok("LY# absolute is its own group with 1 instrument -> no false correlation",
  (groups.get("diff:lymphocyte:abs") || new Set()).size === 1);
ok("Glucose still groups by exact string with 2 instruments",
  (groups.get("Glucose") || new Set()).size === 2);

console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAIL`}`);
process.exit(fails === 0 ? 0 : 1);
