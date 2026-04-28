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

/**
 * Parse the canonical TEa from a criteria string and return:
 *  - { mode: 'percent', value: <fractional> } e.g. "±10% or ±0.2 mg/dL (greater)" -> { mode:'percent', value: 0.10 }
 *  - { mode: 'absolute', value: <number>, unit: <string> } e.g. "±4 mmol/L" -> { mode:'absolute', value:4, unit:'mmol/L' }
 *  - null if not parseable.
 */
function parseCanonicalTea(criteria: string): { mode: "percent"; value: number } | { mode: "absolute"; value: number; unit: string } | null {
  // Percent first (handles both percent-only "±10%" and dual "±10% or ±0.2 mg/dL (greater)")
  const pct = criteria.match(/±([\d.]+)%/);
  if (pct) {
    return { mode: "percent", value: parseFloat(pct[1]) / 100 };
  }
  // Absolute-only e.g. "±0.04", "±4 mmol/L", "±1.0 mg/dL"
  const abs = criteria.match(/±([\d.]+)\s*([A-Za-z\/\u00b5%]+(?:\s[A-Za-z\/]+)?)?/);
  if (abs) {
    return { mode: "absolute", value: parseFloat(abs[1]), unit: (abs[2] || "").trim() };
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
  "GC1 CREAT": "Creatinine",
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

// Build lookup: canonical analyte name -> canonical TEa
const teaByAnalyte = new Map<string, { mode: "percent"; value: number } | { mode: "absolute"; value: number; unit: string }>();
for (const entry of teaData) {
  const tea = parseCanonicalTea(entry.criteria);
  if (tea !== null) teaByAnalyte.set(entry.analyte, tea);
}

function resolveCanonicalAnalyte(testName: string): string | null {
  for (const [key, canonical] of Object.entries(NAME_MAP)) {
    if (key.toLowerCase() === testName.toLowerCase()) return canonical;
  }
  if (teaByAnalyte.has(testName)) return testName;
  const lower = testName.toLowerCase();
  for (const analyte of Array.from(teaByAnalyte.keys())) {
    if (analyte.toLowerCase().includes(lower) || lower.includes(analyte.toLowerCase())) {
      return analyte;
    }
  }
  return null;
}

/**
 * Backfill clia_absolute_floor AND correct clia_allowable_error / tea_is_percentage
 * when the stored TEa does not match the canonical CLIA TEa for the analyte.
 *
 * - The user's labs cannot enter custom TEa values; analyte selection always supplies
 *   canonical CLIA TEa. Drift here means a UI bug let the wrong value through (such as
 *   the historic Milford CREAT demo button that loaded ALT 15% instead of Creatinine 10%).
 * - This routine self-heals such drift on every startup and is idempotent.
 * - Every change is logged with the study id, test name, and old vs. new values.
 * - Safe: wrapped in try/catch so failures never crash startup.
 */
export function backfillAbsoluteFloorOnStartup(): void {
  try {
    const sqlite = (db as any).$client;

    // Pass 1: legacy floor backfill where the column is NULL
    const missingFloor = sqlite
      .prepare(
        "SELECT id, test_name FROM studies WHERE clia_absolute_floor IS NULL"
      )
      .all() as Array<{ id: number; test_name: string }>;

    if (missingFloor.length > 0) {
      const update = sqlite.prepare(
        "UPDATE studies SET clia_absolute_floor = ?, clia_absolute_unit = ? WHERE id = ?"
      );
      let count = 0;
      for (const study of missingFloor) {
        const floor = resolveFloor(study.test_name);
        if (floor !== null) {
          update.run(floor.value, floor.unit, study.id);
          count++;
        }
      }
      if (count > 0) {
        console.log(`[backfill] Set clia_absolute_floor for ${count} studies`);
      } else {
        console.log("[backfill] No studies needed clia_absolute_floor backfill");
      }
    }

    // Pass 2: correct clia_allowable_error / tea_is_percentage / clia_absolute_floor / clia_absolute_unit
    // for any study whose test_name resolves to a canonical analyte but whose stored TEa
    // does not match the canonical TEa. This catches data written by buggy demo buttons
    // or older code paths that hardcoded the wrong preset.
    const all = sqlite
      .prepare(
        "SELECT id, test_name, clia_allowable_error, tea_is_percentage, clia_absolute_floor, clia_absolute_unit, tea_unit FROM studies"
      )
      .all() as Array<{
        id: number;
        test_name: string;
        clia_allowable_error: number;
        tea_is_percentage: number | null;
        clia_absolute_floor: number | null;
        clia_absolute_unit: string | null;
        tea_unit: string | null;
      }>;

    const updateTea = sqlite.prepare(
      "UPDATE studies SET clia_allowable_error = ?, tea_is_percentage = ?, tea_unit = ?, clia_absolute_floor = ?, clia_absolute_unit = ? WHERE id = ?"
    );

    const FP_TOL = 1e-9;
    let corrected = 0;
    for (const s of all) {
      const canonical = resolveCanonicalAnalyte(s.test_name);
      if (!canonical) continue;
      const canonicalTea = teaByAnalyte.get(canonical);
      if (!canonicalTea) continue;

      let needsUpdate = false;
      let newAllowable = s.clia_allowable_error;
      let newIsPct = s.tea_is_percentage ?? 1;
      let newTeaUnit = s.tea_unit ?? "%";
      let newFloor: number | null = s.clia_absolute_floor;
      let newFloorUnit: string | null = s.clia_absolute_unit;

      if (canonicalTea.mode === "percent") {
        if (Math.abs((s.clia_allowable_error ?? 0) - canonicalTea.value) > FP_TOL) {
          newAllowable = canonicalTea.value;
          needsUpdate = true;
        }
        if ((s.tea_is_percentage ?? 1) !== 1) {
          newIsPct = 1;
          needsUpdate = true;
        }
        if ((s.tea_unit ?? "%") !== "%") {
          newTeaUnit = "%";
          needsUpdate = true;
        }
        // Apply matching floor if we have one canonical-ly
        const canonicalFloor = resolveFloor(s.test_name);
        if (canonicalFloor) {
          if (s.clia_absolute_floor === null || Math.abs(s.clia_absolute_floor - canonicalFloor.value) > FP_TOL) {
            newFloor = canonicalFloor.value;
            needsUpdate = true;
          }
          if (s.clia_absolute_unit !== canonicalFloor.unit) {
            newFloorUnit = canonicalFloor.unit;
            needsUpdate = true;
          }
        }
      } else {
        // absolute-only TEa (e.g. Sodium ±4 mmol/L, Calcium ±1.0 mg/dL)
        if (Math.abs((s.clia_allowable_error ?? 0) - canonicalTea.value) > FP_TOL) {
          newAllowable = canonicalTea.value;
          needsUpdate = true;
        }
        if ((s.tea_is_percentage ?? 1) !== 0) {
          newIsPct = 0;
          needsUpdate = true;
        }
        if (canonicalTea.unit && (s.tea_unit ?? "") !== canonicalTea.unit) {
          newTeaUnit = canonicalTea.unit;
          needsUpdate = true;
        }
        // Absolute-only TEa has no separate floor
        if (s.clia_absolute_floor !== null) {
          newFloor = null;
          needsUpdate = true;
        }
        if (s.clia_absolute_unit !== null) {
          newFloorUnit = null;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        console.log(
          `[backfill] Correcting study ${s.id} (${s.test_name} -> ${canonical}): ` +
          `clia_allowable_error ${s.clia_allowable_error} -> ${newAllowable}, ` +
          `tea_is_percentage ${s.tea_is_percentage} -> ${newIsPct}, ` +
          `tea_unit ${s.tea_unit} -> ${newTeaUnit}, ` +
          `clia_absolute_floor ${s.clia_absolute_floor} -> ${newFloor}, ` +
          `clia_absolute_unit ${s.clia_absolute_unit} -> ${newFloorUnit}`
        );
        updateTea.run(newAllowable, newIsPct, newTeaUnit, newFloor, newFloorUnit, s.id);
        corrected++;
      }
    }

    if (corrected > 0) {
      console.log(`[backfill] Corrected canonical TEa on ${corrected} studies`);
    } else {
      console.log("[backfill] All studies already have canonical CLIA TEa");
    }
  } catch (err: any) {
    console.error("[backfill] Error during canonical TEa backfill:", err.message);
  }
}
