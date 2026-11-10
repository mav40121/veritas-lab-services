// scripts/verify-regulated-analyte-labels.ts
//
// Receipt for the VeritaCheck label fix (2026-11-05). PDFs called 47 of the 106 Subpart I analytes a "Lab-Set Internal Goal" and printed
// "no canonical CLIA PT criterion exists for this analyte" for cortisol, WBC, PTT and others, because the check read the startup self-heal's
// short list. This imports the ACTUAL modules and proves:
//   1. Every row of client/src/lib/cliaTeaData.ts is recognized by its own name, cites its own section, and is CLIA TEa when it holds that criterion.
//   2. Direct: the everyday spellings (catalog aliases, NAME_MAP, preset labels) reach the right row.
//   3. Fallback: free text around an analyte's name still reaches it.
//   4. Negative: another test that shares a word with a regulated analyte does not. Those names printed a false citation before.
//   5. A criterion the study does not share with the CFR is a Lab-Set Internal Goal and says what the CLIA criterion is; numbers count, floors count.
//   6. The three lab-set cases are kept apart: only an analyte known to have no criterion may be told so.
//   7. The startup self-heal's list stays frozen, word for word inside the table, in its order.
//
// Run: DB_PATH=.tmp-verify-reg.db npx tsx scripts/verify-regulated-analyte-labels.ts   (the DB is only for importing the backfill module)

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { teaData as TABLE, CLIA_TEA_TABLE_ECFR_DATE } from "../client/src/lib/cliaTeaData";
import { cliaAnalytes } from "../server/cliaAnalytes";
import { CATALOG_ROW, NAME_MAP, cfrNumericCriterion, criterionStanding, hasCanonicalTea, regulatedAnalyteFor, teaLabelFor, type StoredCriterion } from "../shared/regulatedAnalytes";
import { cfrSectionForTestName, DEFAULT_CFR_SECTION, teaData as SELF_HEAL_ROWS } from "../server/backfillAbsoluteFloor";

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  -> " + detail : ""}`);
}
const rowOf = (n: string) => regulatedAnalyteFor(n)?.analyte ?? null;
const wantRow = (n: string, analyte: string) => check(`"${n}" -> ${analyte}`, rowOf(n) === analyte, String(rowOf(n)));

const percent = (value: number, floor: number | null = null, floorUnit: string | null = null): StoredCriterion => ({ cliaAllowableError: value, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: floor, cliaAbsoluteUnit: floorUnit });
const absolute = (value: number, unit: string): StoredCriterion => ({ cliaAllowableError: value, teaIsPercentage: 0, teaUnit: unit, cliaAbsoluteFloor: null, cliaAbsoluteUnit: null });

// ── 1. Every row of the table ────────────────────────────────────────────────
console.log("== Every Subpart I row");
check(`the table has 106 rows (got ${TABLE.length})`, TABLE.length === 106);
for (const row of TABLE) {
  check(`${row.analyte} is recognized as itself`, rowOf(row.analyte) === row.analyte, String(rowOf(row.analyte)));
  check(`${row.analyte} cites 42 CFR ${row.cfr}`, cfrSectionForTestName(row.analyte) === `42 CFR ${row.cfr}`, cfrSectionForTestName(row.analyte));
  const cfr = cfrNumericCriterion(row.criteria);
  if (cfr) {
    const stored = cfr.mode === "percent" ? percent(cfr.value, cfr.floor, cfr.floorUnit) : absolute(cfr.value, cfr.unit || "units");
    check(`${row.analyte} holding ${row.criteria} is CLIA TEa`, teaLabelFor(row.analyte, stored) === "CLIA TEa", criterionStanding(row.analyte, stored).kind);
    const off = cfr.mode === "percent" ? percent(cfr.value + 0.01, cfr.floor, cfr.floorUnit) : absolute(cfr.value + 1, cfr.unit || "units");
    check(`${row.analyte} holding another number is a Lab-Set Internal Goal`, teaLabelFor(row.analyte, off) === "Lab-Set Internal Goal", criterionStanding(row.analyte, off).kind);
  } else {
    // "100% accuracy", "±2 dilutions ...": no number can be that criterion, so a numeric TEa on the study is the lab's own, and says what the CFR's is.
    const standing = criterionStanding(row.analyte, percent(0.2));
    check(`${row.analyte} (${row.criteria.slice(0, 24)}...) with a numeric TEa is lab-set on a regulated analyte`, standing.kind === "lab_set_regulated", standing.kind);
  }
}
const numeric = TABLE.filter((r) => cfrNumericCriterion(r.criteria));
check(`${numeric.length} rows parse as numbers, the other 18 are stated another way`, numeric.length === 88, String(numeric.length));

// ── 2. Direct ────────────────────────────────────────────────────────────────
console.log("== Direct: everyday spellings");
const DIRECT: [string, string][] = [
  ["Cortisol", "Cortisol"], ["cortisol", "Cortisol"], ["Serum Cortisol", "Cortisol"], ["Fibrinogen", "Fibrinogen"], ["Factor I", "Fibrinogen"], ["WBC", "CBC - WBC (White Blood Cell Count)"], ["wbc", "CBC - WBC (White Blood Cell Count)"],
  ["White Blood Cell Count", "CBC - WBC (White Blood Cell Count)"], ["Leukocyte Count", "CBC - WBC (White Blood Cell Count)"], ["RBC", "CBC - RBC (Red Blood Cell Count)"], ["Erythrocyte Count", "CBC - RBC (Red Blood Cell Count)"],
  ["HCT", "CBC - Hematocrit"], ["Hematocrit", "CBC - Hematocrit"], ["PLT", "CBC - Platelet Count"], ["Platelets", "CBC - Platelet Count"], ["Platelet Count", "CBC - Platelet Count"],
  ["PTT", "Partial Thromboplastin Time (PTT/aPTT)"], ["aPTT", "Partial Thromboplastin Time (PTT/aPTT)"], ["APTT", "Partial Thromboplastin Time (PTT/aPTT)"], ["Partial Thromboplastin Time", "Partial Thromboplastin Time (PTT/aPTT)"],
  ["INR", "INR (International Normalized Ratio)"], ["PT", "Prothrombin Time (PT)"], ["PT/INR", "Prothrombin Time (PT)"], ["Protime", "Prothrombin Time (PT)"], ["Prothrombin Time", "Prothrombin Time (PT)"],
  ["Gentamicin", "Gentamicin"], ["Theophylline", "Theophylline"], ["Tobramycin", "Tobramycin"], ["Valproic Acid", "Valproic Acid, Total"], ["VPA", "Valproic Acid, Total"], ["Ethanol", "Alcohol, Blood (Ethanol)"], ["ETOH", "Alcohol, Blood (Ethanol)"],
  ["IgG", "IgG"], ["IgA", "IgA"], ["IgM", "IgM"], ["IgE", "IgE"], ["Immunoglobulin G", "IgG"], ["Estradiol", "Estradiol"], ["E2", "Estradiol"], ["LH", "Luteinizing Hormone (LH)"], ["PTH", "Parathyroid Hormone (PTH)"],
  ["T3", "Triiodothyronine (T3)"], ["T3 Uptake", "T3 Uptake"], ["CA-125", "Cancer Antigen 125 (CA-125)"], ["CA 125", "Cancer Antigen 125 (CA-125)"], ["AFP", "Alpha-Fetoprotein (AFP, tumor marker)"], ["C3", "Complement C3"], ["ANA", "Antinuclear Antibody (ANA)"],
  ["RF", "Rheumatoid Factor (RF)"], ["HIV", "Anti-HIV"], ["HBsAg", "HBsAg (Hepatitis B Surface Antigen)"], ["ABO", "ABO Group"], ["Rh", "Rh Group (D typing)"], ["Antibody Screen", "Antibody Detection (Unexpected Antibodies)"], ["Crossmatch", "Compatibility Testing (Crossmatch)"],
  // The names that worked before and had to keep working, the NAME_MAP cases first.
  ["Hemoglobin", "CBC - Hemoglobin"], ["HGB", "CBC - Hemoglobin"], ["Hgb", "CBC - Hemoglobin"], ["hemoglobin", "CBC - Hemoglobin"], ["CBC - Hemoglobin", "CBC - Hemoglobin"], ["Hemoglobin A1c", "Hemoglobin A1c (HbA1c)"], ["HbA1c", "Hemoglobin A1c (HbA1c)"], ["A1c", "Hemoglobin A1c (HbA1c)"],
  ["GC1 CREAT", "Creatinine"], ["Glucose", "Glucose (excluding home use devices)"], ["GLUCOSE", "Glucose (excluding home use devices)"], ["ALT", "Alanine Aminotransferase (ALT/SGPT)"], ["SGPT", "Alanine Aminotransferase (ALT/SGPT)"], ["AST", "Aspartate Aminotransferase (AST/SGOT)"],
  ["BNP", "B-Natriuretic Peptide (BNP)"], ["proBNP", "Pro B-Natriuretic Peptide (proBNP)"], ["Thyroxine", "Thyroxine (T4)"], ["T4", "Thyroxine (T4)"], ["Free T4", "Free Thyroxine (Free T4)"], ["FREE T4", "Free Thyroxine (Free T4)"], ["Troponin I", "Troponin I"], ["Troponin T", "Troponin T"], ["hs-CRP", "C-Reactive Protein (hs-CRP)"],
];
for (const [name, analyte] of DIRECT) wantRow(name, analyte);

console.log("== Direct: every NAME_MAP entry");
for (const [name, canonical] of Object.entries(NAME_MAP)) {
  check(`NAME_MAP "${name}" -> ${canonical}`, rowOf(name) === canonical, String(rowOf(name)));
  if (canonical) check(`NAME_MAP target "${canonical}" is a table row`, TABLE.some((r) => r.analyte === canonical));
}

console.log("== Direct: every preset label in the dropdown, holding the preset's own criterion");
// Same map as scripts/verify-citations-tea-cap.py: preset name -> Subpart I row.
const PRESET_ANALYTE: Record<string, string> = {
  "ALT/SGPT": "Alanine Aminotransferase (ALT/SGPT)", "Albumin": "Albumin", "Alkaline Phosphatase": "Alkaline Phosphatase", "Amylase": "Amylase", "AST": "Aspartate Aminotransferase (AST/SGOT)", "Bilirubin, Total": "Bilirubin, Total", "BNP": "B-Natriuretic Peptide (BNP)", "proBNP": "Pro B-Natriuretic Peptide (proBNP)",
  "Carbon Dioxide / Serum CO2 / Bicarbonate": "Carbon Dioxide (CO2/Bicarbonate)", "pCO2, Blood Gas Analyzer": "Blood Gas pCO2", "Blood Gas pO2": "Blood Gas pO2", "Blood Gas pH": "Blood Gas pH", "Calcium, Total": "Calcium, Total", "Chloride": "Chloride", "Cholesterol, Total": "Cholesterol, Total", "Cholesterol, HDL": "Cholesterol, HDL",
  "Cholesterol, LDL Direct": "Cholesterol, LDL (direct)", "CK": "Creatine Kinase (CK)", "CK-MB": "CK-MB Isoenzymes", "Creatinine": "Creatinine", "Ferritin": "Ferritin", "GGT": "Gamma Glutamyl Transferase (GGT)", "Glucose": "Glucose (excluding home use devices)", "Hemoglobin A1c": "Hemoglobin A1c (HbA1c)", "Iron, Total": "Iron, Total",
  "LDH": "Lactate Dehydrogenase (LDH)", "Magnesium": "Magnesium", "Phosphorus": "Phosphorus", "Potassium": "Potassium", "PSA, Total": "Prostate Specific Antigen (PSA), Total", "Sodium": "Sodium", "TIBC Direct": "Total Iron Binding Capacity (TIBC)", "Total Protein": "Total Protein", "Triglycerides": "Triglycerides", "Troponin I": "Troponin I", "Troponin T": "Troponin T",
  "Urea Nitrogen/BUN": "Urea Nitrogen (BUN)", "Uric Acid": "Uric Acid", "CA-125": "Cancer Antigen 125 (CA-125)", "CEA": "Carcinoembryonic Antigen (CEA)", "Cortisol": "Cortisol", "Estradiol": "Estradiol", "Folate, Serum": "Folate, Serum", "FSH": "Follicle Stimulating Hormone (FSH)", "Free T4": "Free Thyroxine (Free T4)", "hCG": "Human Chorionic Gonadotropin (hCG)",
  "LH": "Luteinizing Hormone (LH)", "Parathyroid Hormone": "Parathyroid Hormone (PTH)", "Progesterone": "Progesterone", "Prolactin": "Prolactin", "Testosterone": "Testosterone", "T3 Uptake": "T3 Uptake", "T3, Total": "Triiodothyronine (T3)", "TSH": "Thyroid Stimulating Hormone (TSH)", "T4, Thyroxine": "Thyroxine (T4)", "Vitamin B12": "Vitamin B12", "Acetaminophen": "Acetaminophen",
  "Alcohol, Blood": "Alcohol, Blood (Ethanol)", "Blood Lead": "Blood Lead", "Carbamazepine": "Carbamazepine", "Digoxin": "Digoxin", "Gentamicin": "Gentamicin", "Lithium": "Lithium", "Phenobarbital": "Phenobarbital", "Phenytoin": "Phenytoin (Dilantin)", "Salicylate": "Salicylate", "Theophylline": "Theophylline", "Tobramycin": "Tobramycin", "Valproic Acid, Total": "Valproic Acid, Total",
  "Vancomycin": "Vancomycin", "Erythrocyte Count / RBC": "CBC - RBC (Red Blood Cell Count)", "Fibrinogen": "Fibrinogen", "Hematocrit": "CBC - Hematocrit", "Hemoglobin": "CBC - Hemoglobin", "Leukocyte Count / WBC": "CBC - WBC (White Blood Cell Count)", "Partial Thromboplastin Time": "Partial Thromboplastin Time (PTT/aPTT)", "Platelet Count": "CBC - Platelet Count", "Prothrombin Time / PT": "Prothrombin Time (PT)",
};
// The presets live in shared/cliaPresets.ts since 2026-11-10 (the page imports them; the server reads them too).
const page = readFileSync(new URL("../shared/cliaPresets.ts", import.meta.url), "utf-8");
const presetBlock = page.match(/const CLIA_PRESETS = \[([\s\S]*?)\n\];/)![1];
let presetCount = 0;
for (const line of presetBlock.split(/\r?\n/)) {
  const m = line.match(/^\s*\{ label: "([^"]+)",\s*value: ([\d.]+)/);
  if (!m) continue;
  const value = parseFloat(m[2]);
  if (value === 0) continue; // the lab-set presets and Custom carry no value
  presetCount++;
  const name = m[1].split(" (")[0];
  const analyte = PRESET_ANALYTE[name];
  if (!analyte) { check(`preset "${name}" has an expected row`, false); continue; }
  wantRow(name, analyte);
  const floor = line.match(/absoluteFloor: ([\d.]+)/);
  const unit = line.match(/absoluteUnit: "([^"]+)"/);
  const absUnit = line.match(/ unit: "([^"]+)"/);
  const stored = line.includes("isPercentage: false") ? absolute(value, absUnit![1]) : percent(value, floor ? parseFloat(floor[1]) : null, unit ? unit[1] : null);
  check(`preset "${name}" holding its own value is CLIA TEa`, criterionStanding(name, stored).kind === "clia_tea", criterionStanding(name, stored).kind);
  const cfr = line.match(/cfr: "([^"]*)"/)![1];
  check(`preset "${name}" cites its dropdown section`, cfrSectionForTestName(name) === cfr, `${cfrSectionForTestName(name)} vs ${cfr}`);
  // Some study types save a CLIA preset's percent with no floor.
  if (floor) check(`preset "${name}" saved without its floor is still CLIA TEa`, teaLabelFor(name, percent(value)) === "CLIA TEa");
}
check(`${presetCount} value-carrying presets read from the page`, presetCount === 78, String(presetCount));

console.log("== Direct: the catalog");
const NO_TABLE_ROW = cliaAnalytes.filter((a) => a.tier === "regulated" && !CATALOG_ROW[a.id]);
for (const id of Object.keys(CATALOG_ROW)) check(`CATALOG_ROW ${id} is a catalog entry and a table row`, cliaAnalytes.some((a) => a.id === id) && TABLE.some((r) => r.analyte === CATALOG_ROW[id]), CATALOG_ROW[id]);
check("every regulated catalog entry has a table row, except microbiology and syphilis serology, which Subpart I grades another way", NO_TABLE_ROW.every((a) => a.specialty === "Microbiology" || a.subspecialty === "Syphilis Serology"), NO_TABLE_ROW.map((a) => a.id).join(", "));
const tableCovered = new Set(Object.values(CATALOG_ROW));
check("every table row is reachable from the catalog, except INR, which sits in the catalog's PT entry", TABLE.filter((r) => !tableCovered.has(r.analyte)).map((r) => r.analyte).join("|") === "INR (International Normalized Ratio)", TABLE.filter((r) => !tableCovered.has(r.analyte)).map((r) => r.analyte).join("|"));

// ── 3. Fallback ──────────────────────────────────────────────────────────────
console.log("== Fallback: free text around the name");
const FALLBACK: [string, string][] = [
  ["ALT (Pfizer side-by-side)", "Alanine Aminotransferase (ALT/SGPT)"], ["Glucose - QC Run 3", "Glucose (excluding home use devices)"], ["Sodium daily QC", "Sodium"], ["ALT Level 1 - Multichem", "Alanine Aminotransferase (ALT/SGPT)"], ["High Sensitivity Troponin I", "Troponin I"],
  ["Cortisol AM", "Cortisol"], ["AM Cortisol", "Cortisol"], ["Cortisol - Cobas e601", "Cortisol"], ["WBC - XN-1000", "CBC - WBC (White Blood Cell Count)"], ["WBC Level 1", "CBC - WBC (White Blood Cell Count)"], ["Hemoglobin - XN-1000", "CBC - Hemoglobin"], ["Hemoglobin (XN-1000)", "CBC - Hemoglobin"], ["IgG (nephelometry)", "IgG"], ["IgG, Serum", "IgG"],
  ["Hemoglobin A1c POC", "Hemoglobin A1c (HbA1c)"], ["Free T4 Level 2", "Free Thyroxine (Free T4)"], ["T3 Uptake QC", "T3 Uptake"], ["Gentamicin Trough", "Gentamicin"], ["Vancomycin Peak", "Vancomycin"], ["Platelet Count, Citrate", "CBC - Platelet Count"], ["PT - Stago", "Prothrombin Time (PT)"], ["aPTT Reagent Lot B", "Partial Thromboplastin Time (PTT/aPTT)"], ["Plasma Glucose", "Glucose (excluding home use devices)"], ["Glucose, Plasma", "Glucose (excluding home use devices)"],
  ["Carbon Dioxide / Serum CO2 / Bicarbonate", "Carbon Dioxide (CO2/Bicarbonate)"], ["ABO/Rh confirmation", "ABO Group"], ["Rubella IgG", "Rubella"], ["Anti-HIV 1/2", "Anti-HIV"], ["LDL, Direct", "Cholesterol, LDL (direct)"], ["Direct LDL", "Cholesterol, LDL (direct)"],
];
for (const [name, analyte] of FALLBACK) wantRow(name, analyte);

// ── 4. Negative ──────────────────────────────────────────────────────────────
console.log("== Negative: other tests that share a word with a regulated analyte");
const NEGATIVE = [
  // Specimens Subpart I does not grade. Each of these printed "CLIA TEa ... per 42 CFR §493.931" before this fix.
  "Urine Glucose", "Glucose, Urine", "CSF Glucose", "Glucose, CSF", "Glucose (CSF)", "Urine Creatinine", "Creatinine, Urine", "Urine Sodium", "Urine Potassium", "Sweat Chloride", "Urine hCG", "Urine Cortisol", "Urine Free Cortisol", "Salivary Cortisol", "Urine WBC", "CSF WBC", "Body Fluid WBC", "Total Protein, CSF", "Albumin, CSF", "Uric Acid, Urine", "Maternal Serum AFP",
  // Other forms of the analyte.
  "Free Testosterone", "Testosterone, Free", "Cortisol, Free", "Free PSA", "PSA, Free", "Phenytoin, Free", "Valproic Acid, Free", "Digoxin, Free", "Free T3", "Reverse T3", "T3, Free", "T4, Free", "Calcium, Ionized", "Ionized Calcium", "Direct Bilirubin", "Bilirubin Direct", "Indirect Bilirubin", "Bilirubin, Conjugated", "Non-HDL Cholesterol", "LDL, Calculated", "Spun Hematocrit", "Iron Saturation", "Iron Binding Capacity, Unsaturated",
  // Different tests that contain the word.
  "Glucose-6-Phosphate Dehydrogenase", "Glucose Tolerance Test", "Creatinine Clearance", "Albumin/Creatinine Ratio Random", "BUN/Creatinine Ratio", "CMV IgG", "Measles (IgG)", "Tissue Transglutaminase IgA", "IgG Index", "IgG Subclass 1", "HIV-1 RNA", "Hemoglobin A2", "Hemoglobin F", "Hemoglobin Electrophoresis", "Hemoglobin, Plasma", "Plasma Hemoglobin", "Carboxyhemoglobin", "Methemoglobin",
  "Iron Stain", "RBC Folate", "Folate, RBC", "RBC Morphology", "WBC Morphology", "Leukocyte Esterase", "Thyroxine Binding Globulin", "TSH Receptor Antibody", "PTH-rP", "17-OH Progesterone", "PT Mixing Study", "PTT Mixing Study", "PTT-LA", "Prealbumin", "Microalbumin", "Macroprolactin", "D-Dimer", "Fibrinogen Degradation Products", "Fibrin Degradation Products", "Potassium Hydroxide Prep", "Uric Acid Crystals", "Calcium Oxalate Crystals", "Protein Electrophoresis",
  "Direct Coombs", "CA 19-9 tumor marker", "CA 19-9", "Amikacin (aminoglycoside)", "Troponin", "Lead Time",
  // Plainly not an analyte.
  "Custom Analyte X", "Saltern Buffer", "Glutamine", "",
];
for (const name of NEGATIVE) check(`"${name}" is not a Subpart I row`, rowOf(name) === null, String(rowOf(name)));
check("null is not a Subpart I row", regulatedAnalyteFor(null) === null && !hasCanonicalTea(undefined));

// ── 5. A criterion the study does not share with the CFR ─────────────────────
console.log("== A lab's own criterion stays what it is");
const kind = (n: string, s?: StoredCriterion | null) => criterionStanding(n, s).kind;
check("Cortisol at ±20% is CLIA TEa", kind("Cortisol", percent(0.2)) === "clia_tea");
check("Cortisol at ±15% is lab-set on a regulated analyte", kind("Cortisol", percent(0.15)) === "lab_set_regulated");
check("Cortisol at ±20% with a floor the CFR does not state is lab-set", kind("Cortisol", percent(0.2, 1, "mcg/dL")) === "lab_set_regulated");
check("Glucose at ±8% or ±6 mg/dL is CLIA TEa", kind("Glucose", percent(0.08, 6, "mg/dL")) === "clia_tea");
check("Glucose at ±8% with no floor is CLIA TEa (study types that store the percent only)", kind("Glucose", percent(0.08)) === "clia_tea");
check("Glucose at ±5% is lab-set, though it was CLIA TEa on every PDF before", kind("Glucose", percent(0.05)) === "lab_set_regulated");
check("Glucose at ±8% or ±4 mg/dL is lab-set", kind("Glucose", percent(0.08, 4, "mg/dL")) === "lab_set_regulated");
check("Glucose at ±8% or ±6 mmol/L is lab-set: the floor's unit counts", kind("Glucose", percent(0.08, 6, "mmol/L")) === "lab_set_regulated");
check("Sodium at ±4 mmol/L is CLIA TEa", kind("Sodium", absolute(4, "mmol/L")) === "clia_tea");
check("Sodium at ±4% is lab-set: the mode counts", kind("Sodium", percent(4)) === "lab_set_regulated");
check("Sodium at ±3 mmol/L is lab-set", kind("Sodium", absolute(3, "mmol/L")) === "lab_set_regulated");
check("Calcium at ±1.0 mmol/L is lab-set: the unit counts", kind("Calcium", absolute(1, "mmol/L")) === "lab_set_regulated");
check('Blood Gas pH at ±0.04 "pH units" is CLIA TEa: the CFR names no unit', kind("Blood Gas pH", absolute(0.04, "pH units")) === "clia_tea");
check("Creatinine on the stale default ALT preset (±15% or ±6 U/L) is lab-set", kind("Creatinine", percent(0.15, 6, "U/L")) === "lab_set_regulated");
check("IgG at ±20%, typed in as Lab-defined because the dropdown has no IgG, is CLIA TEa", kind("IgG", { ...percent(0.2), cliaPresetLabel: "Lab-defined" } as any) === "clia_tea");
check("a null percent flag reads as percent, as it does everywhere else", kind("Cortisol", { cliaAllowableError: 0.2, teaIsPercentage: null }) === "clia_tea");
check("snake_case row fields read the same", kind("Sodium", { clia_allowable_error: 4, tea_is_percentage: 0, tea_unit: "mmol/L", clia_absolute_floor: null, clia_absolute_unit: null }) === "clia_tea");
check("snake_case off value reads the same", kind("Sodium", { clia_allowable_error: 5, tea_is_percentage: 0, tea_unit: "mmol/L" }) === "lab_set_regulated");
check("the name alone counts a recognized analyte as CLIA TEa", kind("Cortisol") === "clia_tea" && kind("Cortisol", null) === "clia_tea");
check("floating point: 0.1 + 0.2 stored for a 30% criterion is the same number", kind("Estradiol", percent(0.1 + 0.2)) === "clia_tea");

// ── 6. The three lab-set cases ───────────────────────────────────────────────
console.log("== Only an analyte known to have no criterion may be told so");
for (const name of ["Lipase", "LIPASE", "Procalcitonin", "PCT", "Vitamin D", "D-Dimer", "Lactate", "Lactic Acid", "Ammonia", "CRP", "C-Reactive Protein", "ESR", "Heparin", "MICROALBUMIN (MALB)", "microalbumin", "Urine Protein, total", "urine protein", "UA microscopic", "DAT", "BILIRUBIN, DIRECT", "BILIRUBIN, UNBOUND", "IRON SATURATION (%IRON SAT)"]) {
  check(`"${name}" is known to have none`, kind(name, percent(0.15)) === "lab_set_not_regulated", kind(name, percent(0.15)));
}
for (const name of ["Custom Analyte X", "Gram Stain", "RPR", "Urine Glucose", "Direct Bilirubin", "Troponin", "Eosinophils"]) {
  check(`"${name}" is only not matched: nothing may say it has no criterion`, kind(name, percent(0.15)) === "lab_set_not_matched", kind(name, percent(0.15)));
}

// ── 7. CFR section ───────────────────────────────────────────────────────────
console.log("== CFR section");
const SECTIONS: [string, string][] = [
  ["AST", "42 CFR §493.931"], ["SGOT", "42 CFR §493.931"], ["Follicle Stimulating Hormone (FSH)", "42 CFR §493.933"], ["C-Reactive Protein (hs-CRP)", "42 CFR §493.927"], ["Phenytoin (Dilantin)", "42 CFR §493.937"], ["Prothrombin Time (PT)", "42 CFR §493.941"], ["INR", "42 CFR §493.941"],
  ["Cortisol", "42 CFR §493.933"], ["WBC", "42 CFR §493.941"], ["PTT", "42 CFR §493.941"], ["Gentamicin", "42 CFR §493.937"], ["IgG", "42 CFR §493.927"], ["ABO", "42 CFR §493.959"], ["Glucose", "42 CFR §493.931"], ["Gram Stain", "42 CFR §493.911"], ["RPR", "42 CFR §493.923"],
];
for (const [name, section] of SECTIONS) check(`cfr("${name}") = ${section}`, cfrSectionForTestName(name) === section, cfrSectionForTestName(name));
for (const name of ["Urine Protein, total", "UA microscopic", "microalbumin"]) check(`cfr("${name}") is no section: Subpart I has none for urinalysis`, cfrSectionForTestName(name) === "", cfrSectionForTestName(name));
check("a name the catalog does not hold keeps the documented default", cfrSectionForTestName("Custom Analyte X") === DEFAULT_CFR_SECTION);

// ── 8. The startup self-heal's list stays frozen ─────────────────────────────
console.log("== The startup self-heal's list stays frozen");
check(`it has 59 rows (got ${SELF_HEAL_ROWS.length}). Adding one rewrites saved studies on the next deploy`, SELF_HEAL_ROWS.length === 59);
for (const row of SELF_HEAL_ROWS) {
  const t = TABLE.find((r) => r.analyte === row.analyte);
  check(`${row.analyte} matches the table word for word`, !!t && t.criteria === row.criteria, t?.criteria);
}
const frozen = createHash("sha256").update(JSON.stringify(SELF_HEAL_ROWS.map((r) => [r.analyte, r.criteria]))).digest("hex");
check("its names, values and order are unchanged", frozen === "a449e626b198068d5fdf93c28c8e9b714dcd5c5beb71790f60bb9a60ebe4cc82", frozen);
const nameMapHash = createHash("sha256").update(JSON.stringify(NAME_MAP)).digest("hex");
check("NAME_MAP, which the self-heal reads, is unchanged", nameMapHash === "10f5e5f4e24c4bd33911f902ae425a18381dd93befe0ea475b11df16eae19b17", nameMapHash);

console.log("== The date the PDFs print");
check("the table's eCFR comparison date is set", /^\d{4}-\d{2}-\d{2}$/.test(CLIA_TEA_TABLE_ECFR_DATE), CLIA_TEA_TABLE_ECFR_DATE);

console.log(`\nSUMMARY: ${passed} pass, ${failed} fail`);
console.log(failed === 0 ? "ALL TESTS PASSED" : `${failed} TEST(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
