// ── VeritaMap Excel Export Lookup Tables ─────────────────────────────────────


export const UNITS_LOOKUP: Record<string, string> = {
  "sodium": "mmol/L",
  "potassium": "mmol/L",
  "chloride": "mmol/L",
  "carbon dioxide, total (co2)": "mmol/L",
  "co2": "mmol/L",
  "glucose": "mg/dL",
  "bun": "mg/dL",
  "urea": "mg/dL",
  "creatinine": "mg/dL",
  "calcium, total": "mg/dL",
  "calcium, ionized": "mg/dL",
  "magnesium": "mg/dL",
  "phosphorus": "mg/dL",
  "uric acid": "mg/dL",
  "total protein": "g/dL",
  "albumin": "g/dL",
  "bilirubin, total": "mg/dL",
  "bilirubin": "mg/dL",
  "bilirubin, direct": "mg/dL",
  "alt": "U/L",
  "ast": "U/L",
  "alp": "U/L",
  "ggt": "U/L",
  "ldh": "U/L",
  "ck": "U/L",
  "creatine kinase": "U/L",
  "creatine kinase (ck)": "U/L",
  "lipase": "U/L",
  "amylase": "U/L",
  "cholesterol": "mg/dL",
  "triglyceride": "mg/dL",
  "hdl cholesterol": "mg/dL",
  "ldl cholesterol": "mg/dL",
  "troponin-i (cardiac)": "ng/mL",
  "troponin i": "ng/mL",
  "troponin t": "ng/mL",
  "bnp": "pg/mL",
  "probnp": "pg/mL",
  "nt-probnp": "pg/mL",
  "tsh": "mIU/L",
  "free t4": "ng/dL",
  "free t3": "pg/mL",
  "hemoglobin a1c": "%",
  "hba1c": "%",
  "ferritin": "ng/mL",
  "iron": "mcg/dL",
  "vitamin b12": "pg/mL",
  "folate": "ng/mL",
  "psa": "ng/mL",
  "ph": "",
  "pco2": "mmHg",
  "po2": "mmHg",
  "hemoglobin": "g/dL",
  "hematocrit": "%",
  "wbc": "x10(9)/L",
  "rbc": "x10(12)/L",
  "platelets": "x10(9)/L",
  "mcv": "fL",
  "mch": "pg",
  "mchc": "g/dL",
  "neutrophils": "x10(9)/L",
  "lymphocytes": "%",
  "pt": "sec",
  "inr": "",
  "ptt": "sec",
  "aptt": "sec",
  "activated partial thromboplastin time": "sec",
  "fibrinogen": "mg/dL",
  "d-dimer": "mg/L FEU",
  "anti-xa": "IU/mL",
  "esr": "mm/hr",
  "ammonia": "mcmol/L",
  "osmolality": "mOsm/Kg",
  "acetaminophen": "mcg/mL",
  "digoxin": "ng/mL",
  "ethanol": "mg/dL",
  "lithium": "mmol/L",
  "phenobarbital": "mcg/mL",
  "phenytoin": "mcg/mL",
  "salicylates": "mg/dL",
  "salicylate": "mg/dL",
  "theophylline": "mcg/mL",
  "valproic acid": "mcg/mL",
  "carbamazepine": "mcg/mL",
  "carboxyhemoglobin": "%",
};

// Reference ranges removed - each laboratory must establish and verify its own
// reference intervals per CLIA 493.1253. Do not pre-populate published ranges.
export const REFERENCE_RANGES: Record<string, string> = {};

// AMR removed - each laboratory must verify its own analytical measurement range
// per CLIA 493.1253(b)(1). Do not pre-populate typical ranges.
export const AMR_LOOKUP: Record<string, string> = {};

// CFR section lookup (matches the client-side CFR_MAP)
export const CFR_MAP: Record<string, string> = {
  "General Chemistry": "§493.931",
  "Routine Chemistry": "§493.931",
  "Hematology": "§493.941",
  "Coagulation": "§493.941",
  "General Immunology": "§493.927",
  "Endocrinology": "§493.933",
  "Toxicology": "§493.937",
  "Immunohematology": "§493.959",
  "Urinalysis": "§493.931",
  "Blood Gas": "§493.931",
  "Microbiology": "§493.945",
};

// Compliance status helper
export function getComplianceStatus(dateStr: string | null, monthsRequired: number): string {
  if (!dateStr) return "Missing";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Missing";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const maxDays = monthsRequired * 30.44 + 20; // match client logic
  if (diffDays > maxDays) return "Overdue";
  if (diffDays > maxDays - 30) return "Due Soon";
  return "Compliant";
}

// Case-insensitive lookup helper
export function lookupAnalyte<T>(table: Record<string, T>, analyte: string): T | undefined {
  return table[analyte.toLowerCase()];
}

// Instructions sheet content
export const INSTRUCTIONS_CONTENT = [
  ["VeritaMap™ Compliance Export - How to Use This File"],
  [""],
  ["1. About This Export"],
  ["This file was generated from VeritaAssure™ VeritaMap™, a clinical laboratory compliance mapping tool."],
  ["Each row represents one analyte in your laboratory's test menu, with associated regulatory requirements,"],
  ["instrument assignments, compliance dates, and reference data."],
  [""],
  ["2. Column Guide"],
  ["• Columns A-F: Analyte identification - test name, department, specialty, complexity, instruments, and count."],
  ["• Column G: CFR Section - the applicable 42 CFR Part 493 section for the test specialty."],
  ["• Column H: Correlation Required - Yes if non-waived test is run on 2+ instruments (42 CFR §493.1213)."],
  ["• Columns I-K: Unit of measure, reference range, and AMR (lab-entered values only)."],
  ["• Critical Low / Critical High: your laboratory's MEC-adopted critical value thresholds (lab-entered; blank until you enter them)."],
  ["• Columns S-Z: Compliance dates and calculated status for Calibration Verification, Correlation / Method Comparison, Precision, and SOP Review."],
  ["• Column AA: Notes - free text from your VeritaMap™."],
  [""],
  ["3. Lab Fill-In Columns"],
  ["Lab Critical Low/High: Enter your laboratory's established critical value thresholds."],
  ["Lab AMR Low/High: Enter your instrument's validated analytical measurement range from package insert."],
  ["Calibration Verification, Correlation / Method Comparison, Precision, and SOP dates should be updated regularly in VeritaMap™."],
  [""],
  ["4. Reference Ranges and Critical Values"],
  ["Reference ranges and AMR must be established and verified by each laboratory per CLIA 493.1253."],
  ["Values shown in the Reference Range and AMR columns are lab-entered only - no pre-populated defaults are provided."],
  ["Critical Low and Critical High record your facility's MEC-adopted critical value thresholds; they are blank until your laboratory enters them."],
  ["Your facility's Medical Executive Committee (MEC) is responsible for approving the critical value policy for your laboratory and recording the MEC-approved values."],
  ["Your laboratory director or designee implements the MEC-approved policy and is accountable for establishing and approving all reference ranges per CLIA 493.1253."],
  [""],
  ["5. AMR - Analytical Measurement Range"],
  ["AMR must be verified by each laboratory per CLIA 493.1253(b)(1)."],
  ["Enter your instrument's verified AMR from your most recent calibration/linearity verification data."],
  [""],
  ["6. Data Source"],
  ["veritaassure.com | Veritas Lab Services, LLC"],
];
