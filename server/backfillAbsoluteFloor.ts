import { db } from "./db";

// --- Canonical CLIA TEa data (from cliaTeaData.ts / backfill-absolute-floor.js) ---
const teaData = [
  { analyte: "Alanine Aminotransferase (ALT/SGPT)", criteria: "±15% or ±6 U/L (greater)" },
  { analyte: "Albumin", criteria: "±8%" },
  { analyte: "Alkaline Phosphatase", criteria: "±20%" },
  { analyte: "Amylase", criteria: "±20%" },
  { analyte: "Aspartate Aminotransferase (AST/SGOT)", criteria: "±15% or ±6 U/L (greater)" },
  { analyte: "Bilirubin, Total", criteria: "±20% or ±0.4 mg/dL (greater)" },
  { analyte: "Blood Gas pCO2", criteria: "±8% or ±5 mm Hg (greater)" },
  { analyte: "Blood Gas pO2", criteria: "±15% or ±15 mmHg (greater)" },
  { analyte: "Blood Gas pH", criteria: "±0.04" },
  { analyte: "B-Natriuretic Peptide (BNP)", criteria: "±30%" },
  { analyte: "Pro B-Natriuretic Peptide (proBNP)", criteria: "±30%" },
  { analyte: "Calcium, Total", criteria: "±1.0 mg/dL" },
  { analyte: "Carbon Dioxide (CO2/Bicarbonate)", criteria: "±20%" },
  { analyte: "Chloride", criteria: "±5%" },
  { analyte: "Cholesterol, Total", criteria: "±10%" },
  { analyte: "Cholesterol, HDL", criteria: "±20% or ±6 mg/dL (greater)" },
  { analyte: "Cholesterol, LDL (direct)", criteria: "±20%" },
  { analyte: "Creatine Kinase (CK)", criteria: "±20%" },
  { analyte: "CK-MB Isoenzymes", criteria: "±25% or ±3 ng/mL (greater) or MB elevated (presence or absence)" },
  { analyte: "Creatinine", criteria: "±10% or ±0.2 mg/dL (greater)" },
  { analyte: "Ferritin", criteria: "±20%" },
  { analyte: "Gamma Glutamyl Transferase (GGT)", criteria: "±15% or ±5 U/L (greater)" },
  { analyte: "Glucose (excluding home use devices)", criteria: "±8% or ±6 mg/dL (greater)" },
  { analyte: "Hemoglobin A1c (HbA1c)", criteria: "±8%" },
  { analyte: "Iron, Total", criteria: "±15%" },
  { analyte: "Lactate Dehydrogenase (LDH)", criteria: "±15%" },
  { analyte: "Magnesium", criteria: "±15%" },
  { analyte: "Phosphorus", criteria: "±10% or ±0.3 mg/dL (greater)" },
  { analyte: "Potassium", criteria: "±0.3 mmol/L" },
  { analyte: "Prostate Specific Antigen (PSA), Total", criteria: "±20% or ±0.2 ng/mL (greater)" },
  { analyte: "Sodium", criteria: "±4 mmol/L" },
  { analyte: "Total Iron Binding Capacity (TIBC)", criteria: "±20%" },
  { analyte: "Total Protein", criteria: "±8%" },
  { analyte: "Triglycerides", criteria: "±15%" },
  { analyte: "Troponin I", criteria: "±30% or ±0.9 ng/mL (greater)" },
  { analyte: "Troponin T", criteria: "±30% or ±0.2 ng/mL (greater)" },
  { analyte: "Urea Nitrogen (BUN)", criteria: "±9% or ±2 mg/dL (greater)" },
  { analyte: "Uric Acid", criteria: "±10%" },
  { analyte: "Complement C4", criteria: "±20% or ±5 mg/dL (greater)" },
  { analyte: "C-Reactive Protein (hs-CRP)", criteria: "±30% or ±1 mg/L (greater)" },
  { analyte: "Carcinoembryonic Antigen (CEA)", criteria: "±15% or ±1 ng/dL (greater)" },
  { analyte: "Folate, Serum", criteria: "±30% or ±1 ng/mL (greater)" },
  { analyte: "Follicle Stimulating Hormone (FSH)", criteria: "±18% or ±2 IU/L (greater)" },
  { analyte: "Free Thyroxine (Free T4)", criteria: "±15% or ±0.3 ng/dL (greater)" },
  { analyte: "Human Chorionic Gonadotropin (hCG)", criteria: "±18% or ±3 mIU/mL (greater) or positive or negative" },
  { analyte: "Testosterone", criteria: "±30% or ±20 ng/dL (greater)" },
  { analyte: "Thyroid Stimulating Hormone (TSH)", criteria: "±20% or ±0.2 mIU/L (greater)" },
  { analyte: "Thyroxine (T4)", criteria: "±20% or ±1.0 mcg/dL (greater)" },
  { analyte: "Vitamin B12", criteria: "±25% or ±30 pg/mL (greater)" },
  { analyte: "Acetaminophen", criteria: "±15% or ±3 mcg/mL (greater)" },
  { analyte: "Blood Lead", criteria: "±10% or ±2 mcg/dL (greater)" },
  { analyte: "Carbamazepine", criteria: "±20% or ±1.0 mcg/mL (greater)" },
  { analyte: "Digoxin", criteria: "±15% or ±0.2 ng/mL (greater)" },
  { analyte: "Lithium", criteria: "±15% or ±0.3 mmol/L (greater)" },
  { analyte: "Phenobarbital", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "Phenytoin (Dilantin)", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "Salicylate", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "CBC - Hemoglobin", criteria: "±7% or ±1.0 g/dL (greater)" },
];

/**
 * Parse a CLIA criteria string and extract the absolute floor value.
 * Returns { value, unit } or null if no absolute floor (percent-only or absolute-only).
 */
function parseAbsoluteFloor(criteria: string): { value: number; unit: string } | null {
  const dualMatch = criteria.match(
    /±[\d.]+%\s+or\s+±([\d.]+)\s+([^(]+?)\s*\(greater\)/i
  );
  if (dualMatch) {
    return { value: parseFloat(dualMatch[1]), unit: dualMatch[2].trim() };
  }
  return null;
}

// Build lookup: canonical analyte name -> { value, unit }
const floorByAnalyte = new Map<string, { value: number; unit: string }>();
for (const entry of teaData) {
  const floor = parseAbsoluteFloor(entry.criteria);
  if (floor !== null) {
    floorByAnalyte.set(entry.analyte, floor);
  }
}

// Map from DB test_name -> canonical analyte name (or null = explicitly unmapped)
const NAME_MAP: Record<string, string | null> = {
  "FREE T4": "Free Thyroxine (Free T4)",
  "GLUCOSE": "Glucose (excluding home use devices)",
  "Urea (BUN)": "Urea Nitrogen (BUN)",
  "CREATININE": "Creatinine",
  "SODIUM (NA+)": "Sodium",
  "POTASSIUM (K+)": "Potassium",
  "CHLORIDE (CL-)": "Chloride",
  "CARBON DIOXIDE (ECO2)": "Carbon Dioxide (CO2/Bicarbonate)",
  "CALCIUM": "Calcium, Total",
  "TOTAL PROTEIN": "Total Protein",
  "ALBUMIN": "Albumin",
  "TOTAL BILIRUBIN": "Bilirubin, Total",
  "AST": "Aspartate Aminotransferase (AST/SGOT)",
  "ALT/SGPT": "Alanine Aminotransferase (ALT/SGPT)",
  "URIC ACID": "Uric Acid",
  "TRIGLYCERIDES": "Triglycerides",
  "CHOLESTEROL TOTAL": "Cholesterol, Total",
  "AMYLASE": "Amylase",
  "PHOSPHORUS": "Phosphorus",
  "ALKALINE PHOSPHATE": "Alkaline Phosphatase",
  "LDHI": "Lactate Dehydrogenase (LDH)",
  "CK": "Creatine Kinase (CK)",
  "Gamma glutamyl transferase (GGT)": "Gamma Glutamyl Transferase (GGT)",
  "MAGNESIUM": "Magnesium",
  "CHOLESTEROL, HDL": "Cholesterol, HDL",
  "CHOLESTEROL, LDL DIRECT": "Cholesterol, LDL (direct)",
  "IRON, TOTAL (FE)": "Iron, Total",
  "TOTAL IRON BINDING CAPACITY, DIRECT (DTIBC)": "Total Iron Binding Capacity (TIBC)",
  "PT": "Prothrombin Time (PT)",
  "LIPASE": null,
  "BILIRUBIN, UNBOUND": null,
  "BILIRUBIN, DIRECT": null,
  "IRON SATURATION (%IRON SAT)": null,
};

function resolveFloor(testName: string): { value: number; unit: string } | null {
  // 1. Try NAME_MAP (case-insensitive)
  for (const [key, canonical] of Object.entries(NAME_MAP)) {
    if (key.toLowerCase() === testName.toLowerCase()) {
      if (canonical === null) return null;
      return floorByAnalyte.get(canonical) ?? null;
    }
  }

  // 2. Try direct match against canonical names
  if (floorByAnalyte.has(testName)) {
    return floorByAnalyte.get(testName)!;
  }

  // 3. Try case-insensitive substring match against canonical names
  const lower = testName.toLowerCase();
  for (const [analyte, floor] of floorByAnalyte.entries()) {
    if (analyte.toLowerCase().includes(lower) || lower.includes(analyte.toLowerCase())) {
      return floor;
    }
  }

  return null;
}

/**
 * Backfill clia_absolute_floor for all studies that are missing it.
 * Idempotent: no-ops if every eligible study already has a floor.
 * Safe: wrapped in try/catch so failures never crash startup.
 */
export function backfillAbsoluteFloorOnStartup(): void {
  try {
    const sqlite = (db as any).$client;

    const studies = sqlite
      .prepare(
        "SELECT id, test_name FROM studies WHERE clia_absolute_floor IS NULL"
      )
      .all() as Array<{ id: number; test_name: string }>;

    if (studies.length === 0) {
      console.log("[backfill] No studies needed clia_absolute_floor backfill");
      return;
    }

    const update = sqlite.prepare(
      "UPDATE studies SET clia_absolute_floor = ?, clia_absolute_unit = ? WHERE id = ?"
    );

    let count = 0;
    for (const study of studies) {
      const floor = resolveFloor(study.test_name);
      if (floor !== null) {
        update.run(floor.value, floor.unit, study.id);
        count++;
      }
    }

    if (count > 0) {
      console.log(`[backfill] Set clia_absolute_floor for ${count} studies`);
    } else {
      console.log("[backfill] No studies needed backfill");
    }
  } catch (err: any) {
    console.error("[backfill] Error backfilling clia_absolute_floor:", err.message);
  }
}
