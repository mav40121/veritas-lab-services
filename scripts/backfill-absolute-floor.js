#!/usr/bin/env node
/**
 * One-time backfill: populate clia_absolute_floor for existing studies.
 *
 * Reads the canonical CLIA TEa data from cliaTeaData.ts (via a parsed copy
 * embedded below), matches each study's test_name to a canonical analyte,
 * parses the criteria string for the absolute floor value, and writes it
 * to the clia_absolute_floor column.
 *
 * Usage:
 *   node scripts/backfill-absolute-floor.js [--dry-run]
 *
 * With --dry-run, prints what would change without writing to DB.
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dryRun = process.argv.includes("--dry-run");

// --- Canonical CLIA TEa data (from cliaTeaData.ts) ---
// Each entry: { analyte, criteria }
// We parse the criteria string to extract the absolute floor.
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
 * Returns the absolute floor as a number, or null if no absolute floor.
 *
 * Examples:
 *   "±9% or ±2 mg/dL (greater)" -> 2
 *   "±20% or ±0.4 mg/dL (greater)" -> 0.4
 *   "±8%" -> null (percent-only, no absolute floor)
 *   "±0.3 mmol/L" -> null (absolute-only: the main TEa IS absolute, no separate floor)
 *   "±1.0 mg/dL" -> null (absolute-only)
 */
function parseAbsoluteFloor(criteria) {
  // Dual-criterion pattern: "±X% or ±Y unit (greater)"
  const dualMatch = criteria.match(
    /±[\d.]+%\s+or\s+±([\d.]+)\s+[^(]+\(greater\)/i
  );
  if (dualMatch) {
    return parseFloat(dualMatch[1]);
  }
  return null;
}

// Build lookup: canonical analyte name -> absolute floor
const floorByAnalyte = new Map();
for (const entry of teaData) {
  const floor = parseAbsoluteFloor(entry.criteria);
  if (floor !== null) {
    floorByAnalyte.set(entry.analyte, floor);
  }
}

// Map from DB test_name (case-insensitive) -> canonical analyte name
// Mirrors the audit's NAME_MAP from clia_tea.py
const nameMap = {
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

// Also try direct match by canonical name (for studies created via the UI
// where test_name IS the canonical name from cliaTeaData.ts)
function resolveFloor(testName) {
  // 1. Try nameMap (case-insensitive)
  for (const [key, canonical] of Object.entries(nameMap)) {
    if (key.toLowerCase() === testName.toLowerCase()) {
      if (canonical === null) return null; // explicitly unmapped
      return floorByAnalyte.get(canonical) ?? null;
    }
  }

  // 2. Try direct match against canonical names
  if (floorByAnalyte.has(testName)) {
    return floorByAnalyte.get(testName);
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

// Main
const dbPath = path.resolve(__dirname, "..", "veritas.db");
console.log(`Opening database: ${dbPath}`);
console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

const db = new Database(dbPath);

// Ensure column exists
try {
  db.exec("ALTER TABLE studies ADD COLUMN clia_absolute_floor REAL");
  console.log("Added clia_absolute_floor column.");
} catch {
  // Column already exists
}

const studies = db.prepare("SELECT id, test_name, tea_is_percentage FROM studies").all();
const update = db.prepare("UPDATE studies SET clia_absolute_floor = ? WHERE id = ?");

let updated = 0;
let skipped = 0;

for (const study of studies) {
  // Only set floor for percentage-typed studies (dual-criterion applies when
  // the primary TEa is percentage-based and there's an absolute floor)
  if (!study.tea_is_percentage) {
    skipped++;
    continue;
  }

  const floor = resolveFloor(study.test_name);
  if (floor !== null) {
    if (dryRun) {
      console.log(`  [dry-run] study #${study.id} "${study.test_name}" -> clia_absolute_floor = ${floor}`);
    } else {
      update.run(floor, study.id);
    }
    updated++;
  } else {
    skipped++;
  }
}

console.log(`\nDone. Updated: ${updated}, Skipped (no floor or absolute-typed): ${skipped}`);

if (!dryRun) {
  // Verify the 4 key SCA studies
  const verify = db.prepare("SELECT id, test_name, clia_absolute_floor FROM studies WHERE id IN (330, 331, 339, 351)").all();
  console.log("\nVerification (key SCA studies):");
  for (const row of verify) {
    console.log(`  #${row.id} ${row.test_name}: clia_absolute_floor = ${row.clia_absolute_floor}`);
  }
}

db.close();
