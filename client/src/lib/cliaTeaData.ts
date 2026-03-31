// CLIA Allowable Error (TEa) Database
// Source: 42 CFR Part 493, Subpart H - effective July 11, 2024 (2025 CLIA Final Rule)
// Sections: §493.927 (Immunology), §493.931 (Chemistry), §493.933 (Endocrinology),
//           §493.937 (Toxicology), §493.941 (Hematology), §493.959 (Coagulation/Immunohematology)

export type TeaSpecialty =
  | "Routine Chemistry"
  | "General Immunology"
  | "Endocrinology"
  | "Toxicology"
  | "Hematology"
  | "Coagulation"
  | "Immunohematology"
  | "Urinalysis"
  | "Microbiology";

export interface TeaAnalyte {
  analyte: string;
  criteria: string;
  specialty: TeaSpecialty;
  cfr: string;
  notes?: string;
  qualitative?: boolean;
}

export const teaData: TeaAnalyte[] = [
  // ─── ROUTINE CHEMISTRY §493.931 ───────────────────────────────────────────
  { analyte: "Alanine Aminotransferase (ALT/SGPT)", criteria: "±15% or ±6 U/L (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Albumin", criteria: "±8%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Alkaline Phosphatase", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Amylase", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Aspartate Aminotransferase (AST/SGOT)", criteria: "±15% or ±6 U/L (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Bilirubin, Total", criteria: "±20% or ±0.4 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Blood Gas pCO2", criteria: "±8% or ±5 mm Hg (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Blood Gas pO2", criteria: "±15% or ±15 mmHg (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Blood Gas pH", criteria: "±0.04", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "B-Natriuretic Peptide (BNP)", criteria: "±30%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Pro B-Natriuretic Peptide (proBNP)", criteria: "±30%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Calcium, Total", criteria: "±1.0 mg/dL", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Carbon Dioxide (CO2/Bicarbonate)", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Chloride", criteria: "±5%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Cholesterol, Total", criteria: "±10%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Cholesterol, HDL", criteria: "±20% or ±6 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Cholesterol, LDL (direct)", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Creatine Kinase (CK)", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "CK-MB Isoenzymes", criteria: "±25% or ±3 ng/mL (greater) or MB elevated (presence or absence)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Creatinine", criteria: "±10% or ±0.2 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Ferritin", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Gamma Glutamyl Transferase (GGT)", criteria: "±15% or ±5 U/L (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Glucose (excluding home use devices)", criteria: "±8% or ±6 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Hemoglobin A1c (HbA1c)", criteria: "±8%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Iron, Total", criteria: "±15%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Lactate Dehydrogenase (LDH)", criteria: "±15%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Magnesium", criteria: "±15%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Phosphorus", criteria: "±10% or ±0.3 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Potassium", criteria: "±0.3 mmol/L", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Prostate Specific Antigen (PSA), Total", criteria: "±20% or ±0.2 ng/mL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Sodium", criteria: "±4 mmol/L", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Total Iron Binding Capacity (TIBC)", criteria: "±20%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Total Protein", criteria: "±8%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Triglycerides", criteria: "±15%", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Troponin I", criteria: "±30% or ±0.9 ng/mL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Troponin T", criteria: "±30% or ±0.2 ng/mL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Urea Nitrogen (BUN)", criteria: "±9% or ±2 mg/dL (greater)", specialty: "Routine Chemistry", cfr: "§493.931" },
  { analyte: "Uric Acid", criteria: "±10%", specialty: "Routine Chemistry", cfr: "§493.931" },

  // ─── GENERAL IMMUNOLOGY §493.927 ──────────────────────────────────────────
  { analyte: "Alpha-1 Antitrypsin", criteria: "±20% or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Alpha-Fetoprotein (AFP, tumor marker)", criteria: "±20% or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Antinuclear Antibody (ANA)", criteria: "±2 dilutions or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Antistreptolysin O (ASO)", criteria: "±2 dilutions or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Anti-HIV", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "Complement C3", criteria: "±15%", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Complement C4", criteria: "±20% or ±5 mg/dL (greater)", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "C-Reactive Protein (hs-CRP)", criteria: "±30% or ±1 mg/L (greater)", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "HBsAg (Hepatitis B Surface Antigen)", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "Anti-HBc (Hepatitis B Core Antibody)", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "HBeAg (Hepatitis B e Antigen)", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "Anti-HBs (Hepatitis B Surface Antibody)", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "Anti-HCV (Hepatitis C Antibody)", criteria: "Reactive (positive) or nonreactive (negative)", specialty: "General Immunology", cfr: "§493.927", qualitative: true },
  { analyte: "IgA", criteria: "±20%", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "IgE", criteria: "±20%", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "IgG", criteria: "±20%", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "IgM", criteria: "±20%", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Infectious Mononucleosis", criteria: "±2 dilutions or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Rheumatoid Factor (RF)", criteria: "±2 dilutions or positive or negative", specialty: "General Immunology", cfr: "§493.927" },
  { analyte: "Rubella", criteria: "±2 dilutions or positive or negative or immune or nonimmune", specialty: "General Immunology", cfr: "§493.927" },

  // ─── ENDOCRINOLOGY §493.933 ───────────────────────────────────────────────
  { analyte: "Cancer Antigen 125 (CA-125)", criteria: "±20%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Carcinoembryonic Antigen (CEA)", criteria: "±15% or ±1 ng/dL (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Cortisol", criteria: "±20%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Estradiol", criteria: "±30%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Folate, Serum", criteria: "±30% or ±1 ng/mL (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Follicle Stimulating Hormone (FSH)", criteria: "±18% or ±2 IU/L (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Free Thyroxine (Free T4)", criteria: "±15% or ±0.3 ng/dL (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Human Chorionic Gonadotropin (hCG)", criteria: "±18% or ±3 mIU/mL (greater) or positive or negative", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Luteinizing Hormone (LH)", criteria: "±20%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Parathyroid Hormone (PTH)", criteria: "±30%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Progesterone", criteria: "±25%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Prolactin", criteria: "±20%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Testosterone", criteria: "±30% or ±20 ng/dL (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "T3 Uptake", criteria: "±18%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Triiodothyronine (T3)", criteria: "±30%", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Thyroid Stimulating Hormone (TSH)", criteria: "±20% or ±0.2 mIU/L (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Thyroxine (T4)", criteria: "±20% or ±1.0 mcg/dL (greater)", specialty: "Endocrinology", cfr: "§493.933" },
  { analyte: "Vitamin B12", criteria: "±25% or ±30 pg/mL (greater)", specialty: "Endocrinology", cfr: "§493.933" },

  // ─── TOXICOLOGY §493.937 ──────────────────────────────────────────────────
  { analyte: "Acetaminophen", criteria: "±15% or ±3 mcg/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Alcohol, Blood (Ethanol)", criteria: "±20%", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Blood Lead", criteria: "±10% or ±2 mcg/dL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Carbamazepine", criteria: "±20% or ±1.0 mcg/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Digoxin", criteria: "±15% or ±0.2 ng/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Gentamicin", criteria: "±25%", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Lithium", criteria: "±15% or ±0.3 mmol/L (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Phenobarbital", criteria: "±15% or ±2 mcg/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Phenytoin (Dilantin)", criteria: "±15% or ±2 mcg/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Salicylate", criteria: "±15% or ±2 mcg/mL (greater)", specialty: "Toxicology", cfr: "§493.937" },
  { analyte: "Theophylline", criteria: "±20%", specialty: "Toxicology", cfr: "§493.937" },

  // ─── HEMATOLOGY §493.941 ──────────────────────────────────────────────────
  { analyte: "CBC - WBC (White Blood Cell Count)", criteria: "±15%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - RBC (Red Blood Cell Count)", criteria: "±6%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - Hemoglobin", criteria: "±7% or ±1.0 g/dL (greater)", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - Hematocrit", criteria: "±6%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - MCV (Mean Corpuscular Volume)", criteria: "±7%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - MCHC (Mean Corpuscular Hemoglobin Conc.)", criteria: "±8%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "CBC - Platelet Count", criteria: "±25%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "Differential - Neutrophils (Granulocytes)", criteria: "±3 percentage points or ±14% (greater)", specialty: "Hematology", cfr: "§493.941", notes: "Absolute count ±30%" },
  { analyte: "Differential - Lymphocytes", criteria: "±3 percentage points or ±14% (greater)", specialty: "Hematology", cfr: "§493.941", notes: "Absolute count ±30%" },
  { analyte: "Differential - Monocytes", criteria: "±3 percentage points or ±14% (greater)", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "Differential - Eosinophils", criteria: "±3 percentage points or ±14% (greater)", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "Differential - Basophils", criteria: "±3 percentage points or ±14% (greater)", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "Fibrinogen", criteria: "±20%", specialty: "Hematology", cfr: "§493.941" },
  { analyte: "Reticulocyte Count", criteria: "±3 percentage points or ±30% (greater)", specialty: "Hematology", cfr: "§493.941" },

  // ─── COAGULATION ──────────────────────────────────────────────────────────
  { analyte: "Prothrombin Time (PT)", criteria: "±15%", specialty: "Coagulation", cfr: "§493.941", notes: "INR is the preferred reporting format; PT seconds ±15% of target value" },
  { analyte: "INR (International Normalized Ratio)", criteria: "±15%", specialty: "Coagulation", cfr: "§493.941" },
  { analyte: "Partial Thromboplastin Time (PTT/aPTT)", criteria: "±15%", specialty: "Coagulation", cfr: "§493.941", notes: "Some sources cite ±10 sec or 25% for values >40 sec per RCPA/WSLH" },
  { analyte: "D-Dimer", criteria: "Positive or negative; no fixed CLIA % TEa", specialty: "Coagulation", cfr: "§493.941", notes: "CLIA does not specify a quantitative TEa for D-Dimer. Labs should use manufacturer-stated allowable difference or established biological variation goals." },

  // ─── IMMUNOHEMATOLOGY (BLOOD BANK) ────────────────────────────────────────
  { analyte: "ABO Group", criteria: "100% accuracy", specialty: "Immunohematology", cfr: "§493.959", qualitative: true },
  { analyte: "Rh Group (D typing)", criteria: "100% accuracy", specialty: "Immunohematology", cfr: "§493.959", qualitative: true },
  { analyte: "Antibody Detection (Unexpected Antibodies)", criteria: "100% accuracy", specialty: "Immunohematology", cfr: "§493.959", qualitative: true },
  { analyte: "Antibody Identification", criteria: "100% accuracy", specialty: "Immunohematology", cfr: "§493.959", qualitative: true },
  { analyte: "Compatibility Testing (Crossmatch)", criteria: "100% accuracy", specialty: "Immunohematology", cfr: "§493.959", qualitative: true },

  // ─── URINALYSIS ───────────────────────────────────────────────────────────
  { analyte: "Urinalysis - Qualitative (dipstick)", criteria: "Positive or negative; ±1 graduation (semi-quantitative)", specialty: "Urinalysis", cfr: "§493.931", notes: "For glucose, protein, etc. Semi-quantitative results must be within 1 reagent strip grade of target" },
];

export const specialties: TeaSpecialty[] = [
  "Routine Chemistry",
  "General Immunology",
  "Endocrinology",
  "Toxicology",
  "Hematology",
  "Coagulation",
  "Immunohematology",
  "Urinalysis",
];

export function searchTea(query: string, specialty?: TeaSpecialty): TeaAnalyte[] {
  const q = query.toLowerCase().trim();
  return teaData.filter(a => {
    const matchesQuery = !q || a.analyte.toLowerCase().includes(q) ||
      a.criteria.toLowerCase().includes(q) ||
      (a.notes?.toLowerCase().includes(q));
    const matchesSpecialty = !specialty || a.specialty === specialty;
    return matchesQuery && matchesSpecialty;
  });
}
