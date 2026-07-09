// scripts/verify-coverage-alias-match.mts
//
// Receipt for the Coverage synonym-matcher fix (2026-07-09). Abbreviated map
// analytes (HGB, EO#, EO%, ...) could never be credited from a spelled-out
// study name because normAnalyte stripped the symbol to a <4-char token below
// the fuzzy floor. analyteMatch now falls through to analytesShareGroup (curated
// synonym groups), so "Hemoglobin"/"Eosinophils" studies credit HGB/EO#/EO%.
//
// Pure-function verification (no DB, no network): drives the real
// computeCoverageFrom with a synthetic Sysmex map + spelled-out studies, and
// unit-checks analytesShareGroup for both true synonyms and non-false-positives.
//
// Run: node_modules/.bin/tsx scripts/verify-coverage-alias-match.mts

import { computeCoverageFrom } from "../server/veritacheckCoverage";
import { analytesShareGroup } from "../shared/presetAnalytes";

let fails = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== analytesShareGroup: true synonyms match, unrelated do not ===");
ok("HGB ~ Hemoglobin", analytesShareGroup("HGB", "Hemoglobin"));
ok("HEMOGLOBIN (HGB) ~ HGB", analytesShareGroup("HEMOGLOBIN (HGB)", "HGB"));
ok("Eosinophils ~ EO#", analytesShareGroup("Eosinophils", "EO#"));
ok("Eosinophils ~ EO%", analytesShareGroup("Eosinophils", "EO%"));
ok("EO# ~ EO% (same measurand, one study covers both)", analytesShareGroup("EO#", "EO%"));
ok("Mean corpuscular volume ~ MCV", analytesShareGroup("Mean corpuscular volume", "MCV"));
ok("Sodium !~ Potassium", !analytesShareGroup("Sodium", "Potassium"));
ok("MCH !~ MCHC (distinct indices)", !analytesShareGroup("MCH", "MCHC"));
ok("Eosinophils !~ Basophils", !analytesShareGroup("Eosinophils", "Basophils"));

console.log("\n=== computeCoverageFrom: spelled study credits abbreviated map point ===");
const instruments = [
  { id: 1, instrument_name: "Sysmex XN-1000", nickname: "R2-D2", serial_number: null },
  { id: 2, instrument_name: "Sysmex XN-450", nickname: "BB-8", serial_number: null },
];
const combos = [
  { id: 1, analyte: "EO#", specialty: "Hematology", instrument_id: 1 },
  { id: 2, analyte: "EO#", specialty: "Hematology", instrument_id: 2 },
  { id: 3, analyte: "EO%", specialty: "Hematology", instrument_id: 1 },
  { id: 4, analyte: "EO%", specialty: "Hematology", instrument_id: 2 },
  { id: 5, analyte: "HGB", specialty: "Hematology", instrument_id: 1 },
  { id: 6, analyte: "HGB", specialty: "Hematology", instrument_id: 2 },
  { id: 7, analyte: "Potassium", specialty: "Chemistry", instrument_id: 1 },
  { id: 8, analyte: "Potassium", specialty: "Chemistry", instrument_id: 2 },
];
const studies = [
  { id: 665, test_name: "Eosinophils", instrument: "R2-D2, Sysmex XN-1000, BB-8, Sysmex XN-450", study_type: "method_comparison", status: "pass", lifecycle_state: "finalized", date: "2026-06-05" },
  { id: 700, test_name: "HEMOGLOBIN (HGB)", instrument: "R2-D2, BB-8", study_type: "method_comparison", status: "pass", lifecycle_state: "finalized", date: "2026-06-05" },
];
const cov = computeCoverageFrom(instruments as any, combos as any, studies as any);
const mc = Object.fromEntries(cov.methodComparisons.map((m) => [m.analyte, m.hasStudy]));
ok("EO# method comparison now credited", mc["EO#"] === true);
ok("EO% method comparison now credited (one study, both points)", mc["EO%"] === true);
ok("HGB method comparison now credited", mc["HGB"] === true);
ok("Potassium still Missing (no matching study, no false credit)", mc["Potassium"] === false);
ok("Eosinophils study left the unaligned bucket", !cov.unmappedStudies.some((u) => u.id === 665));
ok("Hemoglobin study left the unaligned bucket", !cov.unmappedStudies.some((u) => u.id === 700));

console.log(fails === 0 ? "\n=== ALL PASS: abbreviated map points credit from spelled studies ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
