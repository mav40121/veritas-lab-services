// server/seedStudyProfiles.ts
//
// BUG-023 (Michael Q70 = 1, 2026-10-10): the VeritaCheck coverage seeder (POST /api/admin/veritacheck/seed-coverage-studies)
// wrote 50, 100, 150, 200, 250 for every analyte, so a seeded Hemoglobin correlation read "50 - 250 g/dL", and it scored
// qualitative blood bank tests (ABO, antibody screen, crossmatch) as numeric comparisons. This module gives the seeder
// values a lab director would recognize:
//   - quantitative analytes: a clinically plausible span and units, judged against the analyte's CLIA criterion from
//     teaData (42 CFR 493 Subpart I) when one exists, else a 10% lab-set goal (labeled as such by the report);
//   - blood bank and other qualitative tests: categorical agreement data (assayType "qualitative");
//   - urine dipstick chemistries: grade agreement data (assayType "semi_quantitative").
// The data are representative demo values for showcase labs only (the seeder is admin-gated and marks every row
// COVERAGE_SEED). Every generated study passes computeStudyStatus, so the boot recompute keeps it PASS.

import { resolveCanonicalAnalyte, teaData, parseCanonicalTea, parseAbsoluteFloor } from "./backfillAbsoluteFloor";

export type QuantProfile = { kind: "quant"; label: string; min: number; max: number; units: string; decimals: number };
export type QualProfile = { kind: "qual"; label: string; categories: string[]; sequence: string[] };
export type SemiProfile = { kind: "semi"; label: string; gradeScale: string[]; sequence: [string, string][] };
export type SeedProfile = QuantProfile | QualProfile | SemiProfile;

const norm = (s: string) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const has = (n: string, ...words: string[]) => words.some((w) => n.includes(` ${w} `));

// Quantitative spans (low abnormal to high abnormal) and conventional US units.
const Q = (label: string, min: number, max: number, units: string, decimals: number): QuantProfile => ({ kind: "quant", label, min, max, units, decimals });

function urineContext(n: string, specialty?: string): boolean {
  return /urinalysis/i.test(specialty || "") || has(n, "ur", "urine", "urinary", "ua", "dipstick");
}

/** The seed profile for one map analyte, or null when no realistic profile is known (the seeder reports those). */
export function seedProfileFor(analyte: string, specialty?: string): SeedProfile | null {
  const n = norm(analyte);
  const ua = urineContext(n, specialty);

  // Blood bank (qualitative). Categories are the result values a technologist records.
  if (has(n, "abo")) return { kind: "qual", label: "ABO group", categories: ["A", "B", "AB", "O"],
    sequence: ["O", "A", "O", "B", "A", "O", "A", "AB", "O", "A", "O", "B", "A", "O", "A", "O", "AB", "A", "O", "B"] };
  if (has(n, "rh", "rhd") || /\brh\s*\(?d\)?/i.test(analyte)) return { kind: "qual", label: "Rh(D) type", categories: ["Positive", "Negative"],
    sequence: ["Positive", "Positive", "Negative", "Positive", "Positive", "Positive", "Positive", "Negative", "Positive", "Positive", "Positive", "Positive", "Positive", "Negative", "Positive", "Positive", "Positive", "Positive", "Positive", "Positive"] };
  if (has(n, "antibody") && has(n, "identification", "id", "panel")) return { kind: "qual", label: "Antibody identification",
    categories: ["No antibody identified", "Anti-D", "Anti-E", "Anti-K", "Anti-Fya", "Anti-c"],
    sequence: ["Anti-E", "Anti-K", "Anti-D", "No antibody identified", "Anti-Fya", "Anti-E", "Anti-c", "Anti-K", "No antibody identified", "Anti-D"] };
  if (has(n, "antibody") || /type\s*(and|&)\s*screen/i.test(analyte)) return { kind: "qual", label: "Antibody screen", categories: ["Negative", "Positive"],
    sequence: ["Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative"] };
  if (has(n, "crossmatch", "xm", "compatibility")) return { kind: "qual", label: "Crossmatch", categories: ["Compatible", "Incompatible"],
    sequence: ["Compatible", "Compatible", "Compatible", "Incompatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Incompatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible", "Compatible"] };
  if (has(n, "dat", "coombs")) return { kind: "qual", label: "Direct antiglobulin test", categories: ["Negative", "Positive"],
    sequence: ["Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative"] };

  // Urine dipstick and physical (qualitative or grade scales).
  if (ua || has(n, "color", "colour", "clarity", "appearance", "nitrite", "leukocyte", "esterase", "urobilinogen", "ketone", "ketones")) {
    if (has(n, "color", "colour")) return { kind: "qual", label: "Urine color", categories: ["Pale yellow", "Yellow", "Dark yellow", "Amber", "Red"],
      sequence: ["Yellow", "Pale yellow", "Yellow", "Dark yellow", "Yellow", "Amber", "Pale yellow", "Yellow", "Yellow", "Dark yellow", "Yellow", "Pale yellow", "Red", "Yellow", "Yellow", "Dark yellow", "Yellow", "Pale yellow", "Yellow", "Amber"] };
    if (has(n, "clarity", "appearance")) return { kind: "qual", label: "Urine clarity", categories: ["Clear", "Slightly cloudy", "Cloudy", "Turbid"],
      sequence: ["Clear", "Clear", "Slightly cloudy", "Clear", "Cloudy", "Clear", "Clear", "Slightly cloudy", "Clear", "Turbid", "Clear", "Clear", "Slightly cloudy", "Clear", "Cloudy", "Clear", "Clear", "Clear", "Slightly cloudy", "Clear"] };
    if (has(n, "nitrite")) return { kind: "qual", label: "Urine nitrite", categories: ["Negative", "Positive"],
      sequence: ["Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Negative", "Negative"] };
    const grades = (scale: string[], idx: number[]): SemiProfile["sequence"] =>
      idx.map((r, i) => [scale[r], scale[Math.min(scale.length - 1, Math.max(0, r + ([3, 8, 13].includes(i) ? 1 : [6, 16].includes(i) ? -1 : 0)))]] as [string, string]);
    const IDX5 = [0, 0, 1, 2, 0, 3, 1, 4, 0, 2, 0, 1, 3, 0, 4, 2, 1, 0, 3, 0];
    if (has(n, "protein")) { const s = ["Negative", "Trace", "30 mg/dL", "100 mg/dL", "300 mg/dL", "2000 mg/dL"]; return { kind: "semi", label: "Urine protein", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "glucose")) { const s = ["Negative", "100 mg/dL", "250 mg/dL", "500 mg/dL", "1000 mg/dL", "2000 mg/dL"]; return { kind: "semi", label: "Urine glucose", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "blood", "hemoglobin")) { const s = ["Negative", "Trace", "Small", "Moderate", "Large"]; return { kind: "semi", label: "Urine blood", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "ketone", "ketones")) { const s = ["Negative", "Trace", "Small", "Moderate", "Large"]; return { kind: "semi", label: "Urine ketones", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "leukocyte", "esterase", "le")) { const s = ["Negative", "Trace", "Small", "Moderate", "Large"]; return { kind: "semi", label: "Leukocyte esterase", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "bilirubin")) { const s = ["Negative", "Small", "Moderate", "Large"]; return { kind: "semi", label: "Urine bilirubin", gradeScale: s, sequence: grades(s, IDX5.map((x) => Math.min(x, 3))) }; }
    if (has(n, "urobilinogen")) { const s = ["0.2 EU/dL", "1 EU/dL", "2 EU/dL", "4 EU/dL", "8 EU/dL"]; return { kind: "semi", label: "Urobilinogen", gradeScale: s, sequence: grades(s, IDX5) }; }
    if (has(n, "ph")) { const s = ["5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"]; return { kind: "semi", label: "Urine pH", gradeScale: s, sequence: grades(s, [2, 1, 3, 4, 2, 0, 5, 3, 2, 6, 1, 4, 2, 3, 7, 2, 1, 4, 3, 8]) }; }
    if (has(n, "specific", "sg", "gravity")) { const s = ["1.005", "1.010", "1.015", "1.020", "1.025", "1.030"]; return { kind: "semi", label: "Specific gravity", gradeScale: s, sequence: grades(s, [2, 3, 1, 4, 2, 0, 3, 5, 2, 1, 3, 4, 2, 3, 1, 2, 5, 3, 0, 2]) }; }
  }

  // Hematology
  if (has(n, "hemoglobin", "hgb", "hb") && !has(n, "a1c", "glycated", "glycosylated", "hba1c")) return Q("Hemoglobin", 6.0, 19.0, "g/dL", 1);
  if (has(n, "hematocrit", "hct")) return Q("Hematocrit", 18, 56, "%", 1);
  if (has(n, "platelet", "platelets", "plt")) return Q("Platelet count", 20, 750, "x10^3/uL", 0);
  if (has(n, "wbc", "leukocyte", "leukocytes") || /white blood cell/i.test(analyte)) return Q("WBC", 1.5, 35.0, "x10^3/uL", 1);
  if (has(n, "rbc") || /red blood cell/i.test(analyte)) return Q("RBC", 2.0, 6.5, "x10^6/uL", 2);
  if (has(n, "mcv")) return Q("MCV", 68, 112, "fL", 1);
  if (has(n, "differential", "diff", "neutrophil", "neutrophils", "neut", "segs")) return Q("Neutrophils", 15, 90, "%", 0);
  if (has(n, "lymphocyte", "lymphocytes", "lymph", "lymphs")) return Q("Lymphocytes", 5, 70, "%", 0);
  // Coagulation
  if (has(n, "inr")) return Q("INR", 0.9, 4.5, "", 2);
  if (has(n, "pt", "protime") || /prothrombin/i.test(analyte)) return Q("PT", 10.5, 42.0, "sec", 1);
  if (has(n, "ptt", "aptt") || /thromboplastin/i.test(analyte)) return Q("PTT", 24, 95, "sec", 1);
  if (has(n, "fibrinogen")) return Q("Fibrinogen", 90, 650, "mg/dL", 0);
  if (has(n, "d dimer", "ddimer") || /d-dimer/i.test(analyte)) return Q("D-dimer", 0.2, 8.0, "ug/mL FEU", 2);
  // Chemistry
  if (has(n, "sodium", "na")) return Q("Sodium", 118, 165, "mmol/L", 0);
  if (has(n, "potassium", "k")) return Q("Potassium", 2.6, 7.2, "mmol/L", 1);
  if (has(n, "chloride", "cl")) return Q("Chloride", 80, 125, "mmol/L", 0);
  if (has(n, "co2", "bicarbonate", "hco3", "tco2")) return Q("CO2", 10, 40, "mmol/L", 0);
  if (has(n, "bun", "urea")) return Q("BUN", 4, 120, "mg/dL", 0);
  if (has(n, "creatinine", "creat")) return Q("Creatinine", 0.4, 9.5, "mg/dL", 2);
  if (has(n, "glucose", "glu")) return Q("Glucose", 35, 550, "mg/dL", 0);
  if ((has(n, "calcium") || (has(n, "ca") && !/\bca\s*-?\s*\d/i.test(analyte))) && !has(n, "ionized")) return Q("Calcium", 6.0, 14.0, "mg/dL", 1);
  if (has(n, "magnesium", "mg")) return Q("Magnesium", 1.0, 4.5, "mg/dL", 1);
  if (has(n, "phosphorus", "phos", "phosphate")) return Q("Phosphorus", 1.5, 9.0, "mg/dL", 1);
  if (has(n, "albumin", "alb")) return Q("Albumin", 1.5, 5.5, "g/dL", 1);
  if (/total protein/i.test(analyte) || has(n, "tp")) return Q("Total protein", 3.5, 9.5, "g/dL", 1);
  if (has(n, "bilirubin", "tbil")) return Q("Bilirubin, total", 0.2, 18.0, "mg/dL", 1);
  if (has(n, "alt", "sgpt")) return Q("ALT", 8, 850, "U/L", 0);
  if (has(n, "ast", "sgot")) return Q("AST", 10, 900, "U/L", 0);
  if (has(n, "alkaline", "alp")) return Q("Alkaline phosphatase", 30, 1200, "U/L", 0);
  if (has(n, "troponin", "tni", "ctni")) return Q("Troponin I", 0.01, 40.0, "ng/mL", 2);
  if (has(n, "tsh")) return Q("TSH", 0.05, 80, "mIU/L", 2);
  if (has(n, "lactate", "lactic")) return Q("Lactate", 0.5, 15, "mmol/L", 1);
  if (has(n, "lipase")) return Q("Lipase", 10, 2000, "U/L", 0);
  if (has(n, "cholesterol", "chol")) return Q("Cholesterol", 80, 400, "mg/dL", 0);
  if (has(n, "triglyceride", "triglycerides", "trig")) return Q("Triglycerides", 40, 1000, "mg/dL", 0);
  if (/uric acid/i.test(analyte)) return Q("Uric acid", 1.5, 15, "mg/dL", 1);
  if (has(n, "ck", "cpk") || /creatine kinase/i.test(analyte)) return Q("CK", 20, 3000, "U/L", 0);
  if (has(n, "ammonia", "nh3")) return Q("Ammonia", 10, 400, "umol/L", 0);
  if (has(n, "a1c", "hba1c")) return Q("Hemoglobin A1c", 4.0, 14.0, "%", 1);

  // Qualitative by specialty (serology, molecular, rapid antigen): Negative / Positive.
  if (/serology|molecular|microbiology|virology|immunology/i.test(specialty || "")) return { kind: "qual", label: analyte, categories: ["Negative", "Positive"],
    sequence: ["Negative", "Negative", "Positive", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Positive", "Negative", "Negative", "Negative", "Negative", "Negative"] };
  return null;
}

/** CLIA criterion for a quantitative analyte from teaData (42 CFR 493 Subpart I), else a 10% lab-set goal. */
export function seedTeaFor(analyte: string, profileLabel: string): { cliaAllowableError: number; teaIsPercentage: 0 | 1; teaUnit: string; absFloor: number | null; absUnit: string | null; canonical: string | null } {
  const canonical = resolveCanonicalAnalyte(analyte) ?? resolveCanonicalAnalyte(profileLabel);
  const row = canonical ? teaData.find((r) => r.analyte === canonical) : undefined;
  const tea = row ? parseCanonicalTea(row.criteria) : null;
  if (tea && tea.mode === "percent") {
    const floor = parseAbsoluteFloor(row!.criteria);
    return { cliaAllowableError: tea.value, teaIsPercentage: 1, teaUnit: "%", absFloor: floor?.value ?? null, absUnit: floor?.unit ?? null, canonical };
  }
  if (tea && tea.mode === "absolute") return { cliaAllowableError: tea.value, teaIsPercentage: 0, teaUnit: tea.unit, absFloor: null, absUnit: null, canonical };
  return { cliaAllowableError: 0.10, teaIsPercentage: 1, teaUnit: "%", absFloor: null, absUnit: null, canonical: null };
}

const round = (v: number, d: number) => Number(v.toFixed(d));
// Small, varied differences (all within 1.6%), so every seeded point sits well inside any CLIA criterion (the
// tightest relative one in teaData is 4%; the absolute ones are checked by the verify script at the span ends).
const MC_DELTA = [0.012, -0.008, 0.015, -0.011, 0.006, 0.009, -0.014, 0.004, -0.006, 0.010, -0.003, 0.013, -0.009, 0.007, -0.012, 0.005, 0.011, -0.007, 0.002, -0.010];
const CV_DELTA = [0.010, -0.012, 0.008, 0.014, -0.009];
const MC_QUANTILES = [0, 0.03, 0.07, 0.11, 0.16, 0.21, 0.27, 0.33, 0.39, 0.45, 0.51, 0.57, 0.63, 0.69, 0.75, 0.81, 0.86, 0.91, 0.96, 1];

/** Calibration verification / linearity: 5 levels across the span, recovery within ~1.4%. */
export function seedCalVerPoints(p: QuantProfile, label: string): any[] {
  return [0, 0.25, 0.5, 0.75, 1].map((q, i) => {
    const assigned = round(p.min + (p.max - p.min) * q, p.decimals);
    return { level: i + 1, expectedValue: assigned, instrumentValues: { [label]: round(assigned * (1 + CV_DELTA[i]), p.decimals) } };
  });
}

/** Correlation / method comparison, quantitative: 20 patient samples, first label is the primary. */
export function seedMethodCompQuant(p: QuantProfile, labels: string[]): any[] {
  return MC_QUANTILES.map((q, i) => {
    const ref = round(p.min + (p.max - p.min) * q, p.decimals);
    return {
      level: i + 1, expectedValue: null,
      instrumentValues: Object.fromEntries(labels.map((lab, j) => [lab, j === 0 ? ref : round(ref * (1 + MC_DELTA[(i + j * 7) % MC_DELTA.length]), p.decimals)])),
    };
  });
}

/** Correlation / method comparison, qualitative or graded: the first two labels (reference, comparison). */
export function seedMethodCompCategorical(p: QualProfile | SemiProfile, labels: string[]): any {
  const [ref, comp] = labels;
  const points = p.kind === "qual"
    ? p.sequence.map((c, i) => ({ level: i + 1, expectedValue: null, instrumentValues: {}, expectedCategory: c, instrumentCategories: { [comp]: c } }))
    : p.sequence.map(([r, c], i) => ({ level: i + 1, expectedValue: null, instrumentValues: {}, expectedCategory: r, instrumentCategories: { [comp]: c } }));
  return p.kind === "qual"
    ? { assayType: "qualitative", categories: p.categories, passThreshold: 0.9, points, reference: ref }
    : { assayType: "semi_quantitative", gradeScale: p.gradeScale, passThreshold: 0.8, points, reference: ref };
}

/** A believable study date: spread 18 to 160 days back, deterministic per index, so next-due dates vary. */
export function seedStudyDate(todayIso: string, index: number): string {
  const days = 18 + ((index * 37) % 143);
  const d = new Date(`${todayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
