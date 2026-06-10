// server/canonicalMDLs.ts
//
// Canonical medical decision levels (MDLs) per analyte for VeritaCheck
// Method Comparison (CLSI EP09) systematic-error analysis. These are
// the clinical cutoffs at which a measured value triggers a specific
// clinical action (treat, refer, withhold, repeat, etc.). Used to
// compute the systematic error of the new method at each cutoff:
//
//     SE_at_MDL = intercept + (slope - 1) * MDL
//
// and compared against the analyte's CLIA TEa to render a verdict.
//
// SOURCING NOTES:
//   - Values are seeded from published clinical references commonly
//     cited in laboratory medicine practice (Tietz Textbook of
//     Clinical Chemistry; CLSI EP09 worked examples; ADLM guidance
//     where applicable). Each entry carries a `provenance` field
//     summarizing the source.
//   - The lab director or designee remains the final arbiter of which
//     MDLs apply to their specific patient population. The
//     surveyor-defensible posture is: VeritaCheck pre-fills these as
//     a STARTING POINT for the director to verify against the lab's
//     policy. The PDF signature block endorses what the director
//     accepts.
//   - Analytes not in this table fall through; the systematic-error
//     block politely declines to render with a note pointing the
//     director at lab policy.
//
// LOOKUP:
//   - Case-insensitive on the analyte name. Matches are intentionally
//     forgiving (the canonical map includes common synonyms).
//   - When no match is found, getCanonicalMDLs() returns an empty
//     array. Callers should never throw on a missing analyte.

export interface MDLEntry {
  mdl: number;
  label: string;       // brief human-readable label, e.g. "Hypoglycemic threshold"
  units?: string;      // canonical units for context; the study units are authoritative
}

export interface AnalyteMDLs {
  mdls: MDLEntry[];
  provenance: string;  // one-line citation of the source for these values
}

// Normalize an analyte name for lookup: lowercase + strip whitespace.
function norm(s: string): string {
  return String(s || "").trim().toLowerCase();
}

// Canonical map. Synonyms map to the same key.
const CANON: Record<string, AnalyteMDLs> = {
  "glucose": {
    mdls: [
      { mdl: 50,  label: "Hypoglycemia threshold", units: "mg/dL" },
      { mdl: 126, label: "Diabetes diagnostic cutoff (fasting)", units: "mg/dL" },
      { mdl: 200, label: "Critical / random diabetes cutoff", units: "mg/dL" },
    ],
    provenance: "ADA 2024 diagnostic criteria; commonly cited in laboratory practice.",
  },
  "sodium": {
    mdls: [
      { mdl: 125, label: "Severe hyponatremia", units: "mmol/L" },
      { mdl: 135, label: "Lower reference bound", units: "mmol/L" },
      { mdl: 145, label: "Upper reference bound", units: "mmol/L" },
      { mdl: 160, label: "Severe hypernatremia", units: "mmol/L" },
    ],
    provenance: "Common clinical action thresholds; Tietz Textbook of Clinical Chemistry.",
  },
  "potassium": {
    mdls: [
      { mdl: 3.0, label: "Hypokalemia treatment threshold", units: "mmol/L" },
      { mdl: 5.5, label: "Hyperkalemia alert", units: "mmol/L" },
      { mdl: 6.5, label: "Critical hyperkalemia (ECG / action threshold)", units: "mmol/L" },
    ],
    provenance: "Critical value publications; commonly cited in laboratory practice.",
  },
  "chloride": {
    mdls: [
      { mdl: 98,  label: "Lower reference bound", units: "mmol/L" },
      { mdl: 107, label: "Upper reference bound", units: "mmol/L" },
    ],
    provenance: "Tietz Textbook of Clinical Chemistry, reference range midpoints.",
  },
  "bicarbonate": {
    mdls: [
      { mdl: 18, label: "Metabolic acidosis cutoff", units: "mmol/L" },
      { mdl: 30, label: "Metabolic alkalosis cutoff", units: "mmol/L" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "co2": { /* alias for bicarbonate */
    mdls: [
      { mdl: 18, label: "Metabolic acidosis cutoff", units: "mmol/L" },
      { mdl: 30, label: "Metabolic alkalosis cutoff", units: "mmol/L" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "bun": {
    mdls: [
      { mdl: 20, label: "Upper reference bound", units: "mg/dL" },
      { mdl: 50, label: "Marker of renal dysfunction", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "creatinine": {
    mdls: [
      { mdl: 1.2, label: "Upper reference bound (adult)", units: "mg/dL" },
      { mdl: 2.0, label: "Renal dysfunction threshold", units: "mg/dL" },
      { mdl: 4.0, label: "Severe renal dysfunction", units: "mg/dL" },
    ],
    provenance: "KDIGO 2024; commonly cited in laboratory practice.",
  },
  "calcium": {
    mdls: [
      { mdl: 7.0,  label: "Severe hypocalcemia", units: "mg/dL" },
      { mdl: 8.5,  label: "Lower reference bound", units: "mg/dL" },
      { mdl: 10.5, label: "Upper reference bound", units: "mg/dL" },
      { mdl: 12.0, label: "Significant hypercalcemia", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "magnesium": {
    mdls: [
      { mdl: 1.3, label: "Hypomagnesemia cutoff", units: "mg/dL" },
      { mdl: 2.5, label: "Upper reference bound", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "phosphorus": {
    mdls: [
      { mdl: 2.5, label: "Hypophosphatemia cutoff", units: "mg/dL" },
      { mdl: 4.5, label: "Upper reference bound", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "albumin": {
    mdls: [
      { mdl: 3.5, label: "Lower reference bound", units: "g/dL" },
      { mdl: 2.5, label: "Significant hypoalbuminemia", units: "g/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "total protein": {
    mdls: [
      { mdl: 6.0, label: "Lower reference bound", units: "g/dL" },
      { mdl: 8.3, label: "Upper reference bound", units: "g/dL" },
    ],
    provenance: "Tietz Textbook of Clinical Chemistry.",
  },
  "ast": {
    mdls: [
      { mdl: 40,  label: "Upper reference bound", units: "U/L" },
      { mdl: 100, label: "Significant hepatocellular injury", units: "U/L" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "alt": {
    mdls: [
      { mdl: 40,  label: "Upper reference bound", units: "U/L" },
      { mdl: 100, label: "Significant hepatocellular injury", units: "U/L" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "alkaline phosphatase": {
    mdls: [
      { mdl: 130, label: "Upper reference bound (adult)", units: "U/L" },
    ],
    provenance: "Tietz Textbook of Clinical Chemistry.",
  },
  "alp": { /* alias */
    mdls: [
      { mdl: 130, label: "Upper reference bound (adult)", units: "U/L" },
    ],
    provenance: "Tietz Textbook of Clinical Chemistry.",
  },
  "total bilirubin": {
    mdls: [
      { mdl: 1.2, label: "Upper reference bound", units: "mg/dL" },
      { mdl: 3.0, label: "Visible jaundice threshold", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "bilirubin": { /* alias */
    mdls: [
      { mdl: 1.2, label: "Upper reference bound", units: "mg/dL" },
      { mdl: 3.0, label: "Visible jaundice threshold", units: "mg/dL" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "cholesterol": {
    mdls: [
      { mdl: 200, label: "Borderline high cutoff", units: "mg/dL" },
      { mdl: 240, label: "High cutoff", units: "mg/dL" },
    ],
    provenance: "NCEP ATP III; commonly cited in laboratory practice.",
  },
  "triglycerides": {
    mdls: [
      { mdl: 150, label: "Borderline high cutoff", units: "mg/dL" },
      { mdl: 200, label: "High cutoff", units: "mg/dL" },
      { mdl: 500, label: "Very high cutoff", units: "mg/dL" },
    ],
    provenance: "NCEP ATP III; commonly cited in laboratory practice.",
  },
  "hdl": {
    mdls: [
      { mdl: 40, label: "Low HDL cutoff", units: "mg/dL" },
    ],
    provenance: "NCEP ATP III; commonly cited in laboratory practice.",
  },
  "ldl": {
    mdls: [
      { mdl: 100, label: "Near-optimal cutoff", units: "mg/dL" },
      { mdl: 130, label: "Borderline high cutoff", units: "mg/dL" },
      { mdl: 190, label: "Very high cutoff", units: "mg/dL" },
    ],
    provenance: "NCEP ATP III; commonly cited in laboratory practice.",
  },
  "tsh": {
    mdls: [
      { mdl: 0.4, label: "Lower reference bound", units: "mIU/L" },
      { mdl: 4.5, label: "Upper reference bound", units: "mIU/L" },
      { mdl: 10,  label: "Overt hypothyroidism threshold", units: "mIU/L" },
    ],
    provenance: "ATA 2024 guidelines; commonly cited in laboratory practice.",
  },
  "hemoglobin": {
    mdls: [
      { mdl: 7.0,  label: "Transfusion trigger (stable patient)", units: "g/dL" },
      { mdl: 12.0, label: "Lower reference bound (adult female)", units: "g/dL" },
      { mdl: 13.5, label: "Lower reference bound (adult male)", units: "g/dL" },
    ],
    provenance: "AABB clinical practice guidelines; commonly cited.",
  },
  "hematocrit": {
    mdls: [
      { mdl: 21, label: "Severe anemia threshold", units: "%" },
      { mdl: 36, label: "Lower reference bound (adult female)", units: "%" },
      { mdl: 41, label: "Lower reference bound (adult male)", units: "%" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "platelets": {
    mdls: [
      { mdl: 50,  label: "Procedure-bleeding risk threshold (x10^3/uL)" },
      { mdl: 150, label: "Lower reference bound (x10^3/uL)" },
      { mdl: 450, label: "Upper reference bound (x10^3/uL)" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
  "wbc": {
    mdls: [
      { mdl: 4.0,  label: "Lower reference bound (x10^3/uL)" },
      { mdl: 11.0, label: "Upper reference bound (x10^3/uL)" },
    ],
    provenance: "Common clinical action thresholds; laboratory practice.",
  },
};

export function getCanonicalMDLs(analyteName: string): MDLEntry[] {
  if (!analyteName) return [];
  const hit = CANON[norm(analyteName)];
  return hit ? [...hit.mdls] : [];
}

export function getCanonicalMDLProvenance(analyteName: string): string {
  if (!analyteName) return "";
  return CANON[norm(analyteName)]?.provenance || "";
}

// ── Math: systematic error at a medical decision level ──────────────
//
// Inputs:
//   slope: regression slope (new method vs reference)
//   intercept: regression intercept
//   mdl: medical decision level in analyte units
//
// Returns the signed and absolute systematic error at the cutoff
// PLUS the decomposition into constant and proportional bias for
// context. The verdict step (compare |SE| to TEa) lives at the
// callsite because it needs the analyte's TEa lookup, which the
// caller already has access to.

export interface SystematicErrorAtMDL {
  mdl: number;
  se_signed: number;     // intercept + (slope - 1) * mdl, signed
  se_abs: number;        // |se_signed|
  constant_bias: number; // = intercept
  proportional_bias_pct: number; // = (slope - 1) * 100
}

export function computeSystematicErrorAtMDL(slope: number, intercept: number, mdl: number): SystematicErrorAtMDL {
  const se_signed = intercept + (slope - 1) * mdl;
  return {
    mdl,
    se_signed,
    se_abs: Math.abs(se_signed),
    constant_bias: intercept,
    proportional_bias_pct: (slope - 1) * 100,
  };
}
