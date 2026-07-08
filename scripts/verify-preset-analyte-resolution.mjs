// scripts/verify-preset-analyte-resolution.mjs
//
// Receipt for the "allocation at time of running assay" resolver (Phase 1).
// resolvePresetAnalyteFrom(mapAnalytes, presetLabel) maps a CLIA TEa preset label
// to the single map analyte it identifies, or null when ambiguous/unmatched.
// Exercised against San Carlos's real map-analyte vocabulary (from the live
// coverage dump), including the collision cases that motivated the exact-match
// preference (RBC vs "RBC (urine micro)", Creatinine vs "Creatinine, urine",
// Total Protein vs "Protein, total, urine", Iron vs TIBC) and the negatives that
// MUST NOT auto-resolve (Total T4 -> Free T4, Total Cholesterol, hCG).
// Run: npx tsx scripts/verify-preset-analyte-resolution.mjs

import { resolvePresetAnalyteFrom } from "../server/veritacheckCoverage.ts";

// San Carlos (lab 2) active map analytes — the subset relevant to the presets,
// with every collision sibling included so the exact-preference logic is tested.
const SC = [
  "Aspartate aminotransferase (AST) (SGOT)", "Alanine aminotransferase (ALT) (SGPT)",
  "Alkaline phosphatase (ALP)", "Amylase", "Albumin", "Creatine kinase (CK)",
  "Lactate dehydrogenase (LDH)", "Gamma glutamyl transferase (GGT)",
  "Creatinine", "Creatinine, urine", "Glucose", "Glucose, urine",
  "Protein, total", "Protein, total, urine", "Protein, urine",
  "Calcium, total", "Calcium, ionized", "Calcium, urine",
  "Bilirubin, total", "Bilirubin, direct", "Bilirubin, neonatal", "Bilirubin, unbound", "Bilirubin, urine",
  "Cholesterol", "HDL cholesterol", "LDL cholesterol",
  "Iron", "Iron binding capacity, total", "Ferritin", "Vitamin B12", "Folate (folic acid)",
  "Sodium", "Potassium", "Chloride", "Magnesium", "Phosphorus", "Uric acid",
  "Carbon dioxide, total (CO2)", "Triglyceride", "Urea (BUN)",
  "Acetaminophen", "Salicylates", "Ethanol (alcohol)",
  "Troponin-I (cardiac)", "N-Terminal pro brain natriuretic peptide (ProBNP)",
  "Prostatic specific antigen (PSA)", "Parathyroid hormone - intact",
  "Thyroid stimulating hormone (TSH)", "Thyroxine, free (FT4)",
  "Triiodothyronine, free (FT3)", "Triiodothyronine uptake (T3U) (TU)",
  // Hematology (map uses bare abbreviations) + collision siblings.
  "RBC", "RBC (urine micro)", "RBC-BF", "WBC", "WBC (urine micro)", "WBC-BF",
  "HCT", "HGB", "PLT", "PLT-F", "PLT-I", "A1C",
  "Carboxyhemoglobin", "Methemoglobin", "Oxyhemoglobin/oxygen saturation",
  "Activated partial thromboplastin time (APTT)", "Prothrombin time (PT)", "D-dimer",
];

let pass = 0, fail = 0;
const check = (label, want) => {
  const got = resolvePresetAnalyteFrom(SC, label);
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  "${label}" -> ${JSON.stringify(got)}${ok ? "" : `  (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
};

// ── Positive: preset resolves to the exact map analyte ──
check("AST (±15% or ±6 U/L)", "Aspartate aminotransferase (AST) (SGOT)");
check("ALT/SGPT (±15% or ±6 U/L)", "Alanine aminotransferase (ALT) (SGPT)");
check("Alkaline Phosphatase (±20%)", "Alkaline phosphatase (ALP)");
check("CK (±20%)", "Creatine kinase (CK)");
check("LDH (±15%)", "Lactate dehydrogenase (LDH)");
check("GGT (±15% or ±5 U/L)", "Gamma glutamyl transferase (GGT)");
check("Amylase (±20%)", "Amylase");
check("Albumin (±8%)", "Albumin");
check("Sodium (±4 mmol/L)", "Sodium");
check("Potassium (±0.3 mmol/L)", "Potassium");
check("Chloride (±5%)", "Chloride");
check("Magnesium (±15%)", "Magnesium");
check("Phosphorus (±10% or ±0.3 mg/dL)", "Phosphorus");
check("Uric Acid (±10%)", "Uric acid");
check("Triglycerides (±15%)", "Triglyceride");
check("Urea Nitrogen/BUN (±9% or ±2 mg/dL)", "Urea (BUN)");
check("Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)", "Carbon dioxide, total (CO2)");
check("Cholesterol, HDL (±20% or ±6 mg/dL)", "HDL cholesterol");
check("Cholesterol, LDL Direct (±20%)", "LDL cholesterol");
check("Ferritin (±20%)", "Ferritin");
check("Vitamin B12 (±25% or ±30 pg/mL)", "Vitamin B12");
check("Folate, Serum (±30% or ±1 ng/mL)", "Folate (folic acid)");
check("Acetaminophen (±15% or ±3 mcg/mL)", "Acetaminophen");
check("Salicylate (±15% or ±2 mcg/mL)", "Salicylates");
check("Alcohol, Blood (±20%)", "Ethanol (alcohol)");
check("Troponin I (±30% or ±0.9 ng/mL)", "Troponin-I (cardiac)");
check("proBNP (±30%)", "N-Terminal pro brain natriuretic peptide (ProBNP)");
check("PSA, Total (±20% or ±0.2 ng/mL)", "Prostatic specific antigen (PSA)");
check("Parathyroid Hormone (±30%)", "Parathyroid hormone - intact");
check("TSH (±20% or ±0.2 mIU/L)", "Thyroid stimulating hormone (TSH)");
check("Free T4 (±15% or ±0.3 ng/dL)", "Thyroxine, free (FT4)");
check("T3 Uptake (±18%)", "Triiodothyronine uptake (T3U) (TU)");
check("Partial Thromboplastin Time (±15%)", "Activated partial thromboplastin time (APTT)");
check("Prothrombin Time / PT (±15%)", "Prothrombin time (PT)");
check("TIBC Direct (±20%)", "Iron binding capacity, total");

// ── Exact-preference: pick the exact sibling, not the paren/urine variant ──
check("Creatinine (±10% or ±0.2 mg/dL)", "Creatinine");
check("Glucose (±8% or ±6 mg/dL)", "Glucose");
check("Total Protein (±8%)", "Protein, total");
check("Calcium, Total (±1.0 mg/dL)", "Calcium, total");
check("Bilirubin, Total (±20% or ±0.4 mg/dL)", "Bilirubin, total");
check("Iron, Total (±15%)", "Iron");
check("Erythrocyte Count / RBC (±4%)", "RBC");
check("Leukocyte Count / WBC (±10%)", "WBC");
check("Hematocrit (±4%)", "HCT");
check("Hemoglobin (±4%)", "HGB");   // not Carboxy/Met/Oxy-hemoglobin
check("Platelet Count (±25%)", "PLT"); // not PLT-F / PLT-I
check("Hemoglobin A1c (±8%)", "A1C");

// ── Negative: MUST NOT auto-resolve (ambiguous or wrong-family) ──
check("Cholesterol, Total (±10%)", null);       // matches HDL + LDL + Cholesterol -> ambiguous, uncrosswalked
check("hCG (±18% or ±3 mIU/mL)", null);         // urine/serum/qual variants -> ambiguous
check("T4, Thyroxine (±20% or ±1.0 mcg/dL)", null); // total T4 must NOT map to Free T4
check("Testosterone (±30% or ±20 ng/dL)", null);    // not on San Carlos map
check("Custom lab-defined goal", null);             // custom TEa -> no preset identity

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
