// shared/regulatedAnalytes.ts
//
// One answer, for the VeritaCheck PDF and the results screen, to two questions about a study:
//   1. Which row of the 42 CFR 493 Subpart I table does this test name mean? The table is client/src/lib/cliaTeaData.ts, pinned
//      row for row to the eCFR by scripts/verify-citations-tea-cap.py.
//   2. Is the criterion stored on the study that row's CLIA criterion, or the lab's own?
//
// Everything here READS. Nothing in this file writes a study, and nothing that writes a study may import it. The startup self-heal
// and the write guard in server/backfillAbsoluteFloor.ts and server/storage.ts keep their own short list on purpose: adding a row
// there rewrites saved customer studies on the next deploy. See the comment on teaData in that file.
//
// Run: npx tsx scripts/verify-regulated-analyte-labels.ts

import { teaData as SUBPART_I_TABLE, type TeaAnalyte } from "../client/src/lib/cliaTeaData";
import { cliaAnalytes } from "../server/cliaAnalytes";
import { nzKey } from "../server/ptAnalyteMatcher";

// Map from a DB test_name to its canonical analyte (null = explicitly no canonical TEa). The startup self-heal reads this map too, so
// a new entry that names a short-list analyte can change saved studies. scripts/verify-regulated-analyte-labels.ts pins its content.
export const NAME_MAP: Record<string, string | null> = {
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
  // Plain "Hemoglobin"/"HGB" is the CBC analyte (±4% per the 2022 final rule),
  // NOT glycated "Hemoglobin A1c (HbA1c)" (±8%). Without these exact mappings,
  // the substring fallback collapses "Hemoglobin" into the earlier-inserted
  // A1c entry and mis-assigns 8% (Troy Regional, 2026-08-14).
  "Hemoglobin": "CBC - Hemoglobin",
  "HGB": "CBC - Hemoglobin",
  "Hgb": "CBC - Hemoglobin",
  // Same substring-collapse class: plain "Thyroxine"/"T4" is Total T4, but the
  // substring fallback collapses it into the earlier "Free Thyroxine (Free T4)".
  // ("FREE T4" already maps to Free Thyroxine above, so free T4 is unaffected.)
  "Thyroxine": "Thyroxine (T4)",
  "T4": "Thyroxine (T4)",
  "LIPASE": null,
  "BILIRUBIN, UNBOUND": null,
  "BILIRUBIN, DIRECT": null,
  "IRON SATURATION (%IRON SAT)": null,
};

// Catalog entry (server/cliaAnalytes.ts) to Subpart I table row. The catalog carries the spellings a lab uses. Microbiology and
// syphilis serology are regulated in the catalog but have no row in the table, so they are not listed here.
export const CATALOG_ROW: Record<string, string> = {
  "abo-group": "ABO Group",
  "d-rho-typing": "Rh Group (D typing)",
  "unexpected-antibody-detection": "Antibody Detection (Unexpected Antibodies)",
  "compatibility-testing": "Compatibility Testing (Crossmatch)",
  "antibody-identification": "Antibody Identification",
  "cell-identification-manual": "Cell Identification",
  "wbc-differential-automated": "White Blood Cell Differential",
  "erythrocyte-count": "CBC - RBC (Red Blood Cell Count)",
  "hematocrit": "CBC - Hematocrit",
  "hemoglobin": "CBC - Hemoglobin",
  "leukocyte-count": "CBC - WBC (White Blood Cell Count)",
  "platelet-count": "CBC - Platelet Count",
  "fibrinogen": "Fibrinogen",
  "ptt": "Partial Thromboplastin Time (PTT/aPTT)",
  "pt-inr": "Prothrombin Time (PT)",
  "alpha1-antitrypsin": "Alpha-1 Antitrypsin",
  "afp": "Alpha-Fetoprotein (AFP, tumor marker)",
  "anti-hbs": "Anti-HBs (Hepatitis B Surface Antibody)",
  "anti-hcv": "Anti-HCV (Hepatitis C Antibody)",
  "ana": "Antinuclear Antibody (ANA)",
  "aso": "Antistreptolysin O (ASO)",
  "anti-hiv": "Anti-HIV",
  "complement-c3": "Complement C3",
  "complement-c4": "Complement C4",
  "crp-high-sensitivity": "C-Reactive Protein (hs-CRP)",
  "hbsag": "HBsAg (Hepatitis B Surface Antigen)",
  "anti-hbc": "Anti-HBc (Hepatitis B Core Antibody)",
  "hbeag": "HBeAg (Hepatitis B e Antigen)",
  "immunoglobulin-iga": "IgA",
  "immunoglobulin-igg": "IgG",
  "immunoglobulin-igm": "IgM",
  "immunoglobulin-ige": "IgE",
  "infectious-mono": "Infectious Mononucleosis",
  "rheumatoid-factor": "Rheumatoid Factor (RF)",
  "rubella": "Rubella",
  "alt": "Alanine Aminotransferase (ALT/SGPT)",
  "albumin": "Albumin",
  "alkaline-phosphatase": "Alkaline Phosphatase",
  "amylase": "Amylase",
  "ast": "Aspartate Aminotransferase (AST/SGOT)",
  "bilirubin-total": "Bilirubin, Total",
  "blood-gas-ph": "Blood Gas pH",
  "blood-gas-pco2": "Blood Gas pCO2",
  "blood-gas-po2": "Blood Gas pO2",
  "bnp": "B-Natriuretic Peptide (BNP)",
  "probnp": "Pro B-Natriuretic Peptide (proBNP)",
  "calcium-total": "Calcium, Total",
  "carbon-dioxide": "Carbon Dioxide (CO2/Bicarbonate)",
  "chloride": "Chloride",
  "ldl-direct": "Cholesterol, LDL (direct)",
  "cholesterol-total": "Cholesterol, Total",
  "hdl": "Cholesterol, HDL",
  "creatine-kinase": "Creatine Kinase (CK)",
  "ck-mb": "CK-MB Isoenzymes",
  "creatinine": "Creatinine",
  "ferritin": "Ferritin",
  "ggt": "Gamma Glutamyl Transferase (GGT)",
  "glucose": "Glucose (excluding home use devices)",
  "hba1c": "Hemoglobin A1c (HbA1c)",
  "iron-total": "Iron, Total",
  "ldh": "Lactate Dehydrogenase (LDH)",
  "magnesium": "Magnesium",
  "phosphorus": "Phosphorus",
  "potassium": "Potassium",
  "psa-total": "Prostate Specific Antigen (PSA), Total",
  "sodium": "Sodium",
  "tibc": "Total Iron Binding Capacity (TIBC)",
  "total-protein": "Total Protein",
  "triglycerides": "Triglycerides",
  "troponin-i": "Troponin I",
  "troponin-t": "Troponin T",
  "urea-nitrogen": "Urea Nitrogen (BUN)",
  "uric-acid": "Uric Acid",
  "ca-125": "Cancer Antigen 125 (CA-125)",
  "cea": "Carcinoembryonic Antigen (CEA)",
  "cortisol": "Cortisol",
  "estradiol": "Estradiol",
  "folate-serum": "Folate, Serum",
  "fsh": "Follicle Stimulating Hormone (FSH)",
  "free-thyroxine": "Free Thyroxine (Free T4)",
  "hcg": "Human Chorionic Gonadotropin (hCG)",
  "lh": "Luteinizing Hormone (LH)",
  "pth": "Parathyroid Hormone (PTH)",
  "progesterone": "Progesterone",
  "prolactin": "Prolactin",
  "t3-uptake": "T3 Uptake",
  "testosterone": "Testosterone",
  "t3": "Triiodothyronine (T3)",
  "tsh": "Thyroid Stimulating Hormone (TSH)",
  "t4": "Thyroxine (T4)",
  "vitamin-b12": "Vitamin B12",
  "acetaminophen": "Acetaminophen",
  "alcohol-blood": "Alcohol, Blood (Ethanol)",
  "blood-lead": "Blood Lead",
  "carbamazepine": "Carbamazepine",
  "digoxin": "Digoxin",
  "gentamicin": "Gentamicin",
  "lithium": "Lithium",
  "phenobarbital": "Phenobarbital",
  "phenytoin": "Phenytoin (Dilantin)",
  "salicylate": "Salicylate",
  "theophylline": "Theophylline",
  "tobramycin": "Tobramycin",
  "valproic-acid": "Valproic Acid, Total",
  "vancomycin": "Vancomycin",
};

const ROW_BY_ANALYTE = new Map<string, TeaAnalyte>(SUBPART_I_TABLE.map((r) => [r.analyte, r]));

// Catalog names and aliases of analytes the catalog marks unregulated. A regulated row's words never claim them ("CRP" is standard
// CRP; only hs-CRP is in §493.927).
const UNREGULATED_NAMES = new Set<string>();
for (const a of cliaAnalytes) {
  if (a.tier === "unregulated") for (const n of [a.name, ...a.aliases]) UNREGULATED_NAMES.add(nzKey(n));
}

// Words inside the table's parentheses that are notes, not names of the analyte ("Cholesterol, LDL (direct)" must not make every test
// with "direct" in it regulated). A catalog alias for a class or for two rows is left out too: "Troponin" could be I or T.
const NOT_A_NAME = new Set(["direct", "tumor marker", "excluding home use devices", "troponin", "aminoglycoside"]);

// Spellings of a table row that the table and the catalog do not carry. The preset labels are in here on purpose.
const EXTRA_SPELLINGS: [string, string][] = [
  ["TIBC Direct", "Total Iron Binding Capacity (TIBC)"],
  ["Direct TIBC", "Total Iron Binding Capacity (TIBC)"],
  ["LDL Direct", "Cholesterol, LDL (direct)"],
  ["Protime", "Prothrombin Time (PT)"],
];

const ALIASES = new Map<string, TeaAnalyte>();
const addAlias = (spelling: string, row: TeaAnalyte) => {
  const k = nzKey(spelling);
  if (k && !NOT_A_NAME.has(k) && !UNREGULATED_NAMES.has(k) && !ALIASES.has(k)) ALIASES.set(k, row);
};
// The table's own words win over the catalog's: "AST" is also an alias of Antimicrobial Susceptibility Testing, "INR" of the PT entry.
for (const row of SUBPART_I_TABLE) {
  addAlias(row.analyte, row);
  const lead = row.analyte.split("(")[0];
  addAlias(lead, row);
  addAlias(lead.replace(/^CBC\s*-\s*/i, ""), row);
  for (const paren of row.analyte.match(/\(([^)]+)\)/g) || []) {
    for (const part of paren.slice(1, -1).split(/[\/,]/)) addAlias(part, row);
  }
}
for (const a of cliaAnalytes) {
  const row = ROW_BY_ANALYTE.get(CATALOG_ROW[a.id]);
  if (row) for (const n of [a.name, ...a.aliases]) addAlias(n, row);
}
for (const [spelling, analyte] of EXTRA_SPELLINGS) addAlias(spelling, ROW_BY_ANALYTE.get(analyte)!);

// These appear inside the names of other tests, so they count only as the whole name or the first part of it ("IgG", "IgG, Serum",
// "Hemoglobin - XN-1000"), never loose in the name ("CMV IgG", "Hemoglobin A2", "HIV-1 RNA", "Iron Stain").
const FIRST_PART_ONLY = new Set(["iga", "ige", "igg", "igm", "hemoglobin", "hiv", "iron", "lead", "bal"]);

// A word beside the analyte's name that makes it a different test from the row in the table. "Urine Glucose" and "Glucose, CSF" are
// not §493.931 glucose; "Free Testosterone" is not "Testosterone"; "Spun Hematocrit" is excluded by §493.941 itself.
const NOT_THE_SAME_TEST = new Set([
  // specimen
  "urine", "urinary", "ua", "csf", "spinal", "fluid", "pleural", "peritoneal", "ascitic", "ascites", "synovial", "pericardial", "amniotic", "stool", "fecal", "feces",
  "sweat", "saliva", "salivary", "dipstick", "gastric", "vitreous", "dialysate", "maternal", "hour", "hr",
  // form or fraction of the analyte
  "free", "unbound", "bound", "bioavailable", "bioactive", "ionized", "direct", "indirect", "conjugated", "unconjugated", "delta", "calculated", "calc", "non", "particle",
  "subclass", "subclasses", "isoenzyme", "isoenzymes", "isoform", "isoforms", "fractionated", "fractional", "fraction", "excretion", "clearance", "ratio", "index",
  "saturation", "sat", "unsaturated", "uibc", "binding", "globulin", "receptor", "related", "rp", "oh", "hydroxy", "phosphate", "dehydrogenase", "tolerance", "gtt",
  "challenge", "epoxide", "metabolite", "metabolites", "degradation", "reticulated", "immature", "spun", "rbc",
  // a different method or a different test altogether
  "antibody", "antibodies", "antigen", "morphology", "indices", "distribution", "width", "esterase", "mixing", "lupus", "la", "inhibitor", "electrophoresis", "stain",
  "crystal", "crystals", "hydroxide", "oxalate", "phenotype", "genotype",
]);
// The same idea for one row only: "Glucose, Plasma" is §493.931 glucose, "Hemoglobin, Plasma" is not the CBC analyte.
const NOT_THIS_ROW: Record<string, string[]> = { "CBC - Hemoglobin": ["plasma", "fetal"] };

// Loose in the name, the longest alias decides: "Free T4 Level 2" is Free T4, not T4. Two characters is too short to trust ("PT mixing").
const LOOSE_ALIASES: [string[], TeaAnalyte][] = Array.from(ALIASES.entries())
  .filter(([k]) => k.length >= 3 && !FIRST_PART_ONLY.has(k))
  .sort(([a], [b]) => b.length - a.length)
  .map(([k, row]) => [k.split(" "), row]);

function sameTest(row: TeaAnalyte, otherWords: string[]): boolean {
  const notThisRow = NOT_THIS_ROW[row.analyte] || [];
  // A word that is itself a name of this row is no qualifier: "Erythrocyte Count / RBC".
  return !otherWords.some((w) => ALIASES.get(w) !== row && (NOT_THE_SAME_TEST.has(w) || notThisRow.includes(w)));
}

type NameMatch = { row: TeaAnalyte; notRegulated: false } | { row: null; notRegulated: boolean };
const NOT_MATCHED: NameMatch = { row: null, notRegulated: false };
const NOT_REGULATED: NameMatch = { row: null, notRegulated: true };

function matchTestName(testName: string | null | undefined): NameMatch {
  const raw = String(testName ?? "").trim();
  const key = nzKey(raw);
  if (!key) return NOT_MATCHED;
  if (UNREGULATED_NAMES.has(key)) return NOT_REGULATED;
  // NAME_MAP first: it is the map the rest of VeritaCheck resolves a name through, and its null means "no canonical TEa".
  const lower = raw.toLowerCase();
  for (const [name, canonical] of Object.entries(NAME_MAP)) {
    if (name.toLowerCase() !== lower) continue;
    const row = canonical ? ROW_BY_ANALYTE.get(canonical) : null;
    return row ? { row, notRegulated: false } : NOT_REGULATED;
  }
  const whole = ALIASES.get(key);
  if (whole) return { row: whole, notRegulated: false };
  const words = key.split(" ");
  // The first part of the name, with the rest as a note: "ALT (Pfizer side-by-side)", "Glucose - QC Run 3", "T3, Total", "Leukocyte Count / WBC".
  const firstPart = nzKey(raw.split(/[(,\/]|\s-\s/)[0]);
  const first = firstPart ? ALIASES.get(firstPart) : undefined;
  if (first) {
    const rest = words.slice(firstPart.split(" ").length);
    return sameTest(first, rest) ? { row: first, notRegulated: false } : NOT_MATCHED;
  }
  // Loose in the name, whole words only: "Sodium daily QC", "ALT Level 1 - Multichem", "High Sensitivity Troponin I".
  for (const [aliasWords, row] of LOOSE_ALIASES) {
    for (let i = 0; i + aliasWords.length <= words.length; i++) {
      if (!aliasWords.every((w, j) => words[i + j] === w)) continue;
      const rest = [...words.slice(0, i), ...words.slice(i + aliasWords.length)];
      return sameTest(row, rest) ? { row, notRegulated: false } : NOT_MATCHED;
    }
  }
  return NOT_MATCHED;
}

/** The Subpart I table row this test name means, or null. */
export function regulatedAnalyteFor(testName: string | null | undefined): TeaAnalyte | null {
  return matchTestName(testName).row;
}

/** True if the named analyte has a row in the Subpart I table. Says nothing about the criterion stored on a study: see criterionStanding. */
export function hasCanonicalTea(testName: string | null | undefined): boolean {
  return regulatedAnalyteFor(testName) !== null;
}

// A row's criterion as numbers. Null for the rows Subpart I states another way: "100% accuracy", "±2 dilutions or positive or negative",
// "±3 SD based on ...", "Reactive (positive) or nonreactive (negative)".
export type CfrNumericCriterion =
  | { mode: "percent"; value: number; floor: number | null; floorUnit: string | null }
  | { mode: "absolute"; value: number; unit: string };

export function cfrNumericCriterion(criteria: string): CfrNumericCriterion | null {
  const dual = criteria.match(/^±([\d.]+)% or ±([\d.]+) (.+?) \(greater\)/);
  if (dual) return { mode: "percent", value: parseFloat(dual[1]) / 100, floor: parseFloat(dual[2]), floorUnit: dual[3] };
  const pct = criteria.match(/^±([\d.]+)%$/);
  if (pct) return { mode: "percent", value: parseFloat(pct[1]) / 100, floor: null, floorUnit: null };
  const abs = criteria.match(/^±([\d.]+)(?: (\S+))?$/);
  if (abs) return { mode: "absolute", value: parseFloat(abs[1]), unit: abs[2] || "" };
  return null;
}

/** The criterion fields of a study, camelCase as the study pages and PDFs carry them or snake_case as the row does. */
export interface StoredCriterion {
  cliaAllowableError?: number | null;
  clia_allowable_error?: number | null;
  teaIsPercentage?: number | boolean | null;
  tea_is_percentage?: number | boolean | null;
  teaUnit?: string | null;
  tea_unit?: string | null;
  cliaAbsoluteFloor?: number | null;
  clia_absolute_floor?: number | null;
  cliaAbsoluteUnit?: string | null;
  clia_absolute_unit?: string | null;
}

const FP_TOL = 1e-9;
const unitKey = (s: string | null | undefined) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

function storedIsTheCfrCriterion(row: TeaAnalyte, stored: StoredCriterion): boolean {
  const cfr = cfrNumericCriterion(row.criteria);
  if (!cfr) return false;
  const value = stored.cliaAllowableError ?? stored.clia_allowable_error;
  if (value == null || Math.abs(value - cfr.value) > FP_TOL) return false;
  const isPercent = stored.teaIsPercentage ?? stored.tea_is_percentage;
  const storedIsPercent = isPercent !== 0 && isPercent !== false;
  const floor = stored.cliaAbsoluteFloor ?? stored.clia_absolute_floor ?? null;
  if (cfr.mode === "absolute") {
    if (storedIsPercent || floor !== null) return false;
    // "±0.04" (blood gas pH) names no unit in the CFR; the preset stores "pH units".
    return !cfr.unit || unitKey(stored.teaUnit ?? stored.tea_unit) === unitKey(cfr.unit);
  }
  if (!storedIsPercent) return false;
  // Some study types store a CLIA preset's percent without its floor, so a missing floor still counts. A floor Subpart I does not state,
  // or a different one, makes it the lab's own criterion.
  if (floor === null) return true;
  return cfr.floor !== null && Math.abs(floor - cfr.floor) <= FP_TOL && unitKey(stored.cliaAbsoluteUnit ?? stored.clia_absolute_unit) === unitKey(cfr.floorUnit);
}

export type CriterionStanding =
  /** A Subpart I analyte, and the study holds that criterion. */
  | { kind: "clia_tea"; row: TeaAnalyte; section: string }
  /** A Subpart I analyte, and the study holds some other criterion: the lab's own, a stale preset, or a value from before the table. */
  | { kind: "lab_set_regulated"; row: TeaAnalyte; section: string }
  /** The catalog or NAME_MAP says this test has no Subpart I criterion. */
  | { kind: "lab_set_not_regulated"; row: null; section: null }
  /** The name did not match a row. That is not proof the test has no criterion, so nothing may say so. */
  | { kind: "lab_set_not_matched"; row: null; section: null };

/**
 * What a study's acceptance criterion is. Pass the study so a lab's own number is not called CLIA TEa; with no stored criterion
 * (the name alone) a recognized analyte counts as "clia_tea".
 */
export function criterionStanding(testName: string | null | undefined, stored?: StoredCriterion | null): CriterionStanding {
  const match = matchTestName(testName);
  if (!match.row) {
    return match.notRegulated ? { kind: "lab_set_not_regulated", row: null, section: null } : { kind: "lab_set_not_matched", row: null, section: null };
  }
  const section = `42 CFR ${match.row.cfr}`;
  const value = stored?.cliaAllowableError ?? stored?.clia_allowable_error;
  if (!stored || value == null) return { kind: "clia_tea", row: match.row, section };
  return storedIsTheCfrCriterion(match.row, stored)
    ? { kind: "clia_tea", row: match.row, section }
    : { kind: "lab_set_regulated", row: match.row, section };
}

/** The label for a study's acceptance criterion: "CLIA TEa", or "Lab-Set Internal Goal" so nothing implies a CLIA citation that does not apply. */
export function teaLabelFor(testName: string | null | undefined, stored?: StoredCriterion | null): string {
  return criterionStanding(testName, stored).kind === "clia_tea" ? "CLIA TEa" : "Lab-Set Internal Goal";
}
