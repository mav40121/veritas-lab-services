// scripts/verify-hgb-canonical-tea-cfr.ts
//
// Receipt for parking-lot #66 (2026-10-07): the VeritaCheck PDF labeled plain
// "Hemoglobin" / "HGB" / "Hgb" studies a "Lab-Set Internal Goal" (laboratory-
// defined) because hasCanonicalTea() never consulted NAME_MAP, and every
// narrative cited 42 CFR §493.931 because pdfReport read a `study.cfr` field
// nothing sets. This imports the ACTUAL server module (not a re-implementation)
// and proves:
//   1. NAME_MAP spellings of regulated analytes are canonical (Hemoglobin/HGB/Hgb/GC1 CREAT)
//   2. explicit null mappings (LIPASE) and unregulated analytes (MICROALBUMIN) stay non-canonical
//   3. the pre-existing alias paths still work (ALT, HbA1c) and unknowns stay false
//   4. the CFR section follows the analyte's subspecialty: hematology/coag -> §493.941,
//      endocrinology -> §493.933, chemistry -> §493.931, unknown -> §493.931 (documented default)
//
// Run: DB_PATH=.tmp-verify-hgb.db npx tsx scripts/verify-hgb-canonical-tea-cfr.ts
import { hasCanonicalTea, cfrSectionForTestName, DEFAULT_CFR_SECTION } from "../server/backfillAbsoluteFloor";

let pass = true;
const ok = (name: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${extra ? "  (" + extra + ")" : ""}`);
  if (!cond) pass = false;
};

// 1. NAME_MAP spellings are canonical
for (const n of ["Hemoglobin", "HGB", "Hgb", "hemoglobin", "GC1 CREAT", "CBC - Hemoglobin"]) {
  ok(`hasCanonicalTea("${n}") is true`, hasCanonicalTea(n) === true);
}
// 2. explicit non-canonical
ok(`hasCanonicalTea("LIPASE") is false (NAME_MAP null)`, hasCanonicalTea("LIPASE") === false);
ok(`hasCanonicalTea("MICROALBUMIN (MALB)") is false (unregulated)`, hasCanonicalTea("MICROALBUMIN (MALB)") === false);
// 3. pre-existing paths
ok(`hasCanonicalTea("ALT") is true (alias)`, hasCanonicalTea("ALT") === true);
ok(`hasCanonicalTea("HbA1c") is true (alias)`, hasCanonicalTea("HbA1c") === true);
ok(`hasCanonicalTea("Custom Analyte X") is false`, hasCanonicalTea("Custom Analyte X") === false);
ok(`hasCanonicalTea("") / null are false`, hasCanonicalTea("") === false && hasCanonicalTea(null) === false);

// 4. CFR section by subspecialty
const sec = (n: string) => cfrSectionForTestName(n);
ok(`cfr("Hemoglobin") = 42 CFR §493.941`, sec("Hemoglobin") === "42 CFR §493.941", sec("Hemoglobin"));
ok(`cfr("HGB") = 42 CFR §493.941`, sec("HGB") === "42 CFR §493.941", sec("HGB"));
ok(`cfr("CBC - Hemoglobin") = 42 CFR §493.941`, sec("CBC - Hemoglobin") === "42 CFR §493.941", sec("CBC - Hemoglobin"));
ok(`cfr("PT") = 42 CFR §493.941 (coagulation)`, sec("PT") === "42 CFR §493.941", sec("PT"));
ok(`cfr("Thyroid Stimulating Hormone (TSH)") = 42 CFR §493.933`, sec("Thyroid Stimulating Hormone (TSH)") === "42 CFR §493.933", sec("Thyroid Stimulating Hormone (TSH)"));
ok(`cfr("Glucose") = 42 CFR §493.931`, sec("Glucose") === "42 CFR §493.931", sec("Glucose"));
ok(`cfr("GLUCOSE") = 42 CFR §493.931`, sec("GLUCOSE") === "42 CFR §493.931", sec("GLUCOSE"));
ok(`cfr("Sodium") = 42 CFR §493.931`, sec("Sodium") === "42 CFR §493.931", sec("Sodium"));
ok(`cfr("Custom Analyte X") = documented default`, sec("Custom Analyte X") === DEFAULT_CFR_SECTION, sec("Custom Analyte X"));
ok(`cfr("") = documented default`, sec("") === DEFAULT_CFR_SECTION);

console.log(pass ? "\nALL PASS" : "\nFAILED");
process.exit(pass ? 0 : 1);
