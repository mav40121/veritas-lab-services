// The VeritaCheck acceptance-criterion presets, in the order the picker shows them (VeritaCheckPage.tsx renders the
// dropdown from these indices). Shared so the server reads a saved study's criterion the way Edit does (BUG-153,
// GET /api/admin/veritacheck/criterion-mismatch-counts). Scripts pin the order and values here:
// verify-tea-dropdown-co2-cluster-indices.js, verify-regulated-analyte-labels.ts, verify-citations-tea-cap.py.
// CLIA Proficiency Testing Acceptance Limits (42 CFR Part 493 Subpart I)
export const CLIA_PRESETS = [
  // ── Routine Chemistry §493.931 ──────────────────────────────────────────
  { label: "ALT/SGPT (±15% or ±6 U/L)",              value: 0.15,  absoluteFloor: 6, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Albumin (±8%)",                            value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Alkaline Phosphatase (±20%)",              value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Amylase (±20%)",                           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "AST (±15% or ±6 U/L)",                    value: 0.15,  absoluteFloor: 6, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Bilirubin, Total (±20% or ±0.4 mg/dL)",   value: 0.20,  absoluteFloor: 0.4, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "BNP (±30%)",                               value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "proBNP (±30%)",                            value: 0.30,  cfr: "42 CFR §493.931" },
  // CO2/Bicarbonate sits above pCO2 by intent: bench vernacular for the chemistry
  // analyte is "CO2," and the first CO2-shaped entry a user scans hits is the
  // one they typically want. Keeping the chemistry entry first eliminates the
  // muscle-memory crosswire path that the earlier "Blood Gas pCO2 first" order
  // produced. Index-stability: this swap only affects positions 8-12; the demo
  // button at the bottom of the page targets index 19 (Creatinine), which sits
  // below this block and is unaffected. (2026-06-03)
  { label: "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)", value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg)", value: 0.08,  absoluteFloor: 5, absoluteUnit: "mm Hg", cfr: "42 CFR §493.931" },
  { label: "Blood Gas pO2 (±15% or ±15 mmHg)",         value: 0.15,  absoluteFloor: 15, absoluteUnit: "mmHg", cfr: "42 CFR §493.931" },
  { label: "Blood Gas pH (±0.04)",                     value: 0.04,  isPercentage: false, unit: "pH units", cfr: "42 CFR §493.931" },
  { label: "Calcium, Total (±1.0 mg/dL)",              value: 1.0,   isPercentage: false, unit: "mg/dL",    cfr: "42 CFR §493.931" },
  { label: "Chloride (±5%)",                           value: 0.05,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, Total (±10%)",                value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, HDL (±20% or ±6 mg/dL)",     value: 0.20,  absoluteFloor: 6, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Cholesterol, LDL Direct (±20%)",           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK (±20%)",                                value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK-MB (±25% or ±3 ng/mL)",                value: 0.25,  absoluteFloor: 3, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Creatinine (±10% or ±0.2 mg/dL)",         value: 0.10,  absoluteFloor: 0.2, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Ferritin (±20%)",                          value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "GGT (±15% or ±5 U/L)",                    value: 0.15,  absoluteFloor: 5, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Glucose (±8% or ±6 mg/dL)",               value: 0.08,  absoluteFloor: 6, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Hemoglobin A1c (±8%)",                     value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Iron, Total (±15%)",                       value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "LDH (±15%)",                               value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Magnesium (±15%)",                         value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Phosphorus (±10% or ±0.3 mg/dL)",         value: 0.10,  absoluteFloor: 0.3, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Potassium (±0.3 mmol/L)",                  value: 0.3,   isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
  { label: "PSA, Total (±20% or ±0.2 ng/mL)",         value: 0.20,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Sodium (±4 mmol/L)",                       value: 4,     isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
  { label: "TIBC Direct (±20%)",                       value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Total Protein (±8%)",                      value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Triglycerides (±15%)",                     value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Troponin I (±30% or ±0.9 ng/mL)",         value: 0.30,  absoluteFloor: 0.9, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Troponin T (±30% or ±0.2 ng/mL)",         value: 0.30,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Urea Nitrogen/BUN (±9% or ±2 mg/dL)",     value: 0.09,  absoluteFloor: 2, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Uric Acid (±10%)",                         value: 0.10,  cfr: "42 CFR §493.931" },
  // ── Endocrinology §493.933 ───────────────────────────────────────────────
  { label: "CA-125 (±20%)",                            value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "CEA (±15% or ±1 ng/mL)",                  value: 0.15,  absoluteFloor: 1, absoluteUnit: "ng/mL", cfr: "42 CFR §493.933" },
  { label: "Cortisol (±20%)",                          value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Estradiol (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Folate, Serum (±30% or ±1 ng/mL)",        value: 0.30,  absoluteFloor: 1, absoluteUnit: "ng/mL", cfr: "42 CFR §493.933" },
  { label: "FSH (±18% or ±2 IU/L)",                   value: 0.18,  absoluteFloor: 2, absoluteUnit: "IU/L", cfr: "42 CFR §493.933" },
  { label: "Free T4 (±15% or ±0.3 ng/dL)",            value: 0.15,  absoluteFloor: 0.3, absoluteUnit: "ng/dL", cfr: "42 CFR §493.933" },
  { label: "hCG (±18% or ±3 mIU/mL)",                 value: 0.18,  absoluteFloor: 3, absoluteUnit: "mIU/mL", cfr: "42 CFR §493.933" },
  { label: "LH (±20%)",                                value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Parathyroid Hormone (±30%)",               value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Progesterone (±25%)",                      value: 0.25,  cfr: "42 CFR §493.933" },
  { label: "Prolactin (±20%)",                         value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Testosterone (±30% or ±20 ng/dL)",        value: 0.30,  absoluteFloor: 20, absoluteUnit: "ng/dL", cfr: "42 CFR §493.933" },
  { label: "T3 Uptake (±18%)",                         value: 0.18,  cfr: "42 CFR §493.933" },
  { label: "T3, Total (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "TSH (±20% or ±0.2 mIU/L)",                value: 0.20,  absoluteFloor: 0.2, absoluteUnit: "mIU/L", cfr: "42 CFR §493.933" },
  { label: "T4, Thyroxine (±20% or ±1.0 mcg/dL)",    value: 0.20,  absoluteFloor: 1.0, absoluteUnit: "mcg/dL", cfr: "42 CFR §493.933" },
  { label: "Vitamin B12 (±25% or ±30 pg/mL)",         value: 0.25,  absoluteFloor: 30, absoluteUnit: "pg/mL", cfr: "42 CFR §493.933" },
  // ── Toxicology §493.937 ──────────────────────────────────────────────────
  { label: "Acetaminophen (±15% or ±3 mcg/mL)",       value: 0.15,  absoluteFloor: 3, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  { label: "Alcohol, Blood (±20%)",                    value: 0.20,  cfr: "42 CFR §493.937" },
  { label: "Blood Lead (±10% or ±2 mcg/dL)",          value: 0.10,  absoluteFloor: 2, absoluteUnit: "mcg/dL", cfr: "42 CFR §493.937" },
  { label: "Carbamazepine (±20% or ±1.0 mcg/mL)",     value: 0.20,  absoluteFloor: 1.0, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  { label: "Digoxin (±15% or ±0.2 ng/mL)",            value: 0.15,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.937" },
  { label: "Gentamicin (±25%)",                        value: 0.25,  cfr: "42 CFR §493.937" },
  { label: "Lithium (±15% or ±0.3 mmol/L)",           value: 0.15,  absoluteFloor: 0.3, absoluteUnit: "mmol/L", cfr: "42 CFR §493.937" },
  { label: "Phenobarbital (±15% or ±2 mcg/mL)",       value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  { label: "Phenytoin (±15% or ±2 mcg/mL)",           value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  { label: "Salicylate (±15% or ±2 mcg/mL)",          value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  { label: "Theophylline (±20%)",                      value: 0.20,  cfr: "42 CFR §493.937" },
  { label: "Tobramycin (±20%)",                        value: 0.20,  cfr: "42 CFR §493.937" },
  { label: "Valproic Acid, Total (±20%)",              value: 0.20,  cfr: "42 CFR §493.937" },
  { label: "Vancomycin (±15% or ±2 mcg/mL)",           value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.937" },
  // ── Hematology §493.941 ──────────────────────────────────────────────────
  { label: "Erythrocyte Count / RBC (±4%)",            value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Fibrinogen (±20%)",                        value: 0.20,  cfr: "42 CFR §493.941" },
  { label: "Hematocrit (±4%)",                         value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Hemoglobin (±4%)",                         value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Leukocyte Count / WBC (±10%)",             value: 0.10,  cfr: "42 CFR §493.941" },
  { label: "Partial Thromboplastin Time (±15%)",       value: 0.15,  cfr: "42 CFR §493.941" },
  { label: "Platelet Count (±25%)",                    value: 0.25,  cfr: "42 CFR §493.941" },
  { label: "Prothrombin Time / PT (±15%)",             value: 0.15,  cfr: "42 CFR §493.941" },
  // ── Lab-Set Internal Goal - no CLIA TEa ─────────────────────────────────
  // Common analytes that have no canonical 42 CFR §493 PT criterion. Picking
  // one auto-flips the form to custom-input mode (value: 0 triggers the
  // Custom number field) and the form omits the §493 reference line so the
  // resulting study does not falsely cite a regulation that does not list
  // these analytes. Parking-lot #1.
  { label: "Lipase",                                   value: 0, cfr: "" },
  { label: "Bilirubin, Direct",                        value: 0, cfr: "" },
  { label: "Bilirubin, Unbound",                       value: 0, cfr: "" },
  { label: "Iron Saturation",                          value: 0, cfr: "" },
  { label: "Vitamin D, 25-Hydroxy",                    value: 0, cfr: "" },
  { label: "Procalcitonin",                            value: 0, cfr: "" },
  // ── Custom ───────────────────────────────────────────────────────────────
  { label: "Custom", value: 0, cfr: "" },
];
