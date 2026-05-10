// WSLH PT (Wisconsin State Laboratory of Hygiene Proficiency Testing) catalog.
// Source: WSLH Clinical Catalog and the 2025 CMS regulated-analyte updates.
// Catalog reference: https://wslhpt.org/clia-and-proficiency-testing-changes/
// 2022 catalog PDF: https://www.slh.wisc.edu/wp-content/uploads/2021/08/WSLHPT_2022_Clinical_Catalog-1.pdf
//
// WSLH is CMS-approved and accepted by CAP, TJC, and COLA. This catalog drives
// the program-code autocomplete on the VeritaPT enrollment form when vendor =
// WSLH, and (in #18 Phase 2) the coverage matcher's lookup from analyte to
// covered modules.
//
// Catalog scope (v1, parking-lot #15 Tier M):
// Starter codes referenced in the parking-lot entry (general chemistry panel,
// cardiac, blood lead, HbA1c, HBV/HCV serology, hematology). Full catalog
// build-out is deferred to a follow-up PR once we have a clean export from
// the 2026 catalog (WSLH listed it as "Coming Soon" as of 2026-05-07).
//
// Schema mirrors `cliaAnalytes` in server/cliaAnalytes.ts. ptCategory strings
// must match values used by the existing `computePTCoverage()` matcher in
// server/routes.ts so WSLH plugs into the same coverage logic.

export interface WslhProgram {
  programCode: string;
  programName: string;
  ptCategory: string;
  analytes: string[];
  shipmentsPerYear: number | null;
  samplesPerShipment: number | null;
  notes?: string;
}

export const wslhCatalog: WslhProgram[] = [
  // ─── Routine Chemistry ─────────────────────────────────────────────────────
  {
    programCode: "1310",
    programName: "General Chemistry Panel (Comprehensive)",
    ptCategory: "Routine Chemistry",
    analytes: [
      "Sodium",
      "Potassium",
      "Chloride",
      "Carbon Dioxide (CO2/Bicarbonate)",
      "Glucose (excluding home use devices)",
      "Urea Nitrogen (BUN)",
      "Creatinine",
      "Calcium, Total",
      "Total Protein",
      "Albumin",
      "Bilirubin, Total",
      "Alkaline Phosphatase",
      "Aspartate Aminotransferase (AST/SGOT)",
      "Alanine Aminotransferase (ALT/SGPT)",
    ],
    shipmentsPerYear: 3,
    samplesPerShipment: 5,
    notes: "Codes 1310-1322 cover panel sub-modules; 1310 is the comprehensive bundle.",
  },
  {
    programCode: "1260",
    programName: "Cardiac Markers (BNP / NT-proBNP / Troponin)",
    ptCategory: "Routine Chemistry",
    analytes: [
      "B-Natriuretic Peptide (BNP)",
      "Pro B-Natriuretic Peptide (proBNP)",
      "Troponin I",
      "Troponin T",
      "CK-MB Isoenzymes",
    ],
    shipmentsPerYear: 3,
    samplesPerShipment: 5,
  },
  {
    programCode: "1080",
    programName: "Blood Lead",
    ptCategory: "Toxicology",
    analytes: ["Blood Lead"],
    shipmentsPerYear: 3,
    samplesPerShipment: 3,
  },
  {
    programCode: "1524",
    programName: "Hemoglobin A1c",
    ptCategory: "Routine Chemistry",
    analytes: ["Hemoglobin A1c (HbA1c)"],
    shipmentsPerYear: 3,
    samplesPerShipment: 5,
    notes: "Accuracy-based PT supported.",
  },

  // ─── Immunology / Serology ────────────────────────────────────────────────
  {
    programCode: "4190",
    programName: "Viral Hepatitis Serology (HBV / HCV)",
    ptCategory: "General Immunology",
    analytes: [
      "HBsAg (Hepatitis B Surface Antigen)",
      "Anti-HBc (Hepatitis B Core Antibody)",
      "HBeAg (Hepatitis B e Antigen)",
      "Anti-HBs (Hepatitis B Surface Antibody)",
      "Anti-HCV (Hepatitis C Antibody)",
    ],
    shipmentsPerYear: 3,
    samplesPerShipment: 5,
  },

  // ─── Hematology ────────────────────────────────────────────────────────────
  // Codes 2230-2370 split by instrument family. Listed as a single placeholder
  // entry pointing to the catalog range; per-instrument codes get added in the
  // follow-up catalog build-out PR.
  {
    programCode: "2230",
    programName: "Hematology - General CBC (instrument-family specific 2230-2370)",
    ptCategory: "Hematology",
    analytes: [
      "CBC - Hemoglobin",
      "Differential - Neutrophils (Granulocytes)",
      "Differential - Lymphocytes",
      "Differential - Monocytes",
      "Differential - Eosinophils",
      "Differential - Basophils",
    ],
    shipmentsPerYear: 3,
    samplesPerShipment: 5,
    notes: "WSLH publishes 2230-2370 as a range of instrument-family-specific codes; pick the code matching your analyzer.",
  },
];

/**
 * Lookup a WSLH program by its code (case-sensitive — codes are numeric strings).
 */
export function findWslhProgram(programCode: string): WslhProgram | undefined {
  return wslhCatalog.find((p) => p.programCode === programCode);
}

/**
 * Fuzzy match for the enrollment form autocomplete: substring match on either
 * programCode or programName, case-insensitive.
 */
export function searchWslhCatalog(query: string): WslhProgram[] {
  const q = (query || "").trim().toLowerCase();
  if (!q) return wslhCatalog;
  return wslhCatalog.filter(
    (p) =>
      p.programCode.toLowerCase().includes(q) ||
      p.programName.toLowerCase().includes(q),
  );
}
