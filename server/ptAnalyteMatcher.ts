// One analyte matcher for every VeritaPT screen: the PT coverage map
// (computePTCoverage) and the program recommendations (computeRecommendations)
// both match a lab's VeritaMap menu names to the CLIA analyte reference in
// ./cliaAnalytes through this module.
//
// History: the recommendations engine got a real matcher on 2026-08-25 (PR #1240:
// normalized names, leading phrase + parenthetical abbreviation) and an
// ambiguity tie-break on 2026-08-31 (PR #1244). The coverage map kept an
// exact-name lookup and treated every miss with a known complexity as
// "PT enrollment is not required" - so on 2026-10-09 Redington-Fairview's map
// told the lab that PT, APTT, ABO, Rh, crossmatch and antibody ID needed no PT
// (bug 6; all are regulated under 42 CFR 493.941 / 493.959). Both screens now
// share this matcher, and a name it cannot match is never reported as exempt.

import type { CliaAnalyte } from "./cliaAnalytes";

export const nzKey = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Menu specialty -> PT discipline (values are cliaAnalytes ptCategory values).
// Used to break ties between ambiguous aliases (e.g. "AST" is both Aspartate
// Aminotransferase and Antimicrobial Susceptibility Testing) and to roll an
// unmatched analyte up to its discipline for program recommendations.
export const SPECIALTY_TO_PTCATEGORY: Record<string, string> = {
  "general chemistry": "General Chemistry",
  "routine chemistry": "General Chemistry",
  "electrolytes": "General Chemistry",
  "special chemistry": "Special Chemistry",
  "blood gas": "Special Chemistry",
  "endocrinology": "Endocrinology",
  "toxicology": "Toxicology / TDM",
  "therapeutic drug monitoring": "Toxicology / TDM",
  "immunology": "Immunology / Serology",
  "general immunology": "Immunology / Serology",
  "serology": "Immunology / Serology",
  "hematology": "Hematology",
  "coagulation": "Coagulation",
  "immunohematology": "Blood Bank / Immunohematology",
  "blood bank": "Blood Bank / Immunohematology",
  "transfusion": "Blood Bank / Immunohematology",
  "microbiology": "Microbiology",
  "urinalysis": "Urinalysis",
};

export const specialtyCategory = (spec?: string | null): string | null =>
  (spec ? SPECIALTY_TO_PTCATEGORY[spec.toLowerCase().trim()] : undefined) ?? null;

export type AnalyteMatcher = (raw: string, specialty?: string | null) => CliaAnalyte | null;

export function createAnalyteMatcher(analytes: CliaAnalyte[]): AnalyteMatcher {
  // Multimap: an ambiguous alias keeps every candidate entry.
  const lut = new Map<string, CliaAnalyte[]>();
  for (const a of analytes) {
    for (const key of [a.name, ...a.aliases]) {
      const k = nzKey(key);
      if (!k) continue;
      const arr = lut.get(k) || [];
      if (!arr.includes(a)) arr.push(a);
      lut.set(k, arr);
    }
  }
  const pick = (arr: CliaAnalyte[] | undefined, wantCat: string | null) => {
    if (!arr || arr.length === 0) return null;
    if (arr.length === 1 || !wantCat) return arr[0];
    return arr.find(a => a.ptCategory === wantCat) || arr[0];
  };

  return (raw: string, specialty?: string | null) => {
    const wantCat = specialtyCategory(specialty);
    const name = String(raw || "");
    // 1. The whole name.
    const direct = pick(lut.get(nzKey(name)), wantCat);
    if (direct) return direct;
    // 2. The leading phrase, then its "/" or "," parts ("ABO/Rh confirmation" -> ABO).
    const lead = name.split("(")[0];
    for (const cand of [lead, ...lead.split(/[\/,]/)]) {
      const hit = pick(lut.get(nzKey(cand)), wantCat);
      if (hit) return hit;
    }
    // 3. Each parenthetical, whole, then its "/" parts ("(APTT)", "(PT/INR)").
    //    A comma list in parentheses enumerates OTHER things ("Phenotyping (Rh,
    //    Kell, Duffy)") and is not split, so it cannot pass for D (Rho) typing.
    for (const paren of (name.match(/\(([^)]+)\)/g) || []).map(x => x.replace(/[()]/g, ""))) {
      if (paren.includes(",")) continue;
      for (const cand of [paren, ...paren.split("/")]) {
        const hit = pick(lut.get(nzKey(cand)), wantCat);
        if (hit) return hit;
      }
    }
    // 4. A leading whole-word prefix ("ABO forward grouping" -> ABO, "Rh Type" ->
    //    Rh, "Antibody identification panel A" -> Antibody Identification), only
    //    when the menu's own specialty agrees with the entry's discipline.
    if (wantCat) {
      const words = nzKey(lead).split(" ").filter(Boolean);
      for (let k = words.length - 1; k >= 1; k--) {
        const key = words.slice(0, k).join(" ");
        if (key.length < 3) continue; // "pt" must not swallow "PT mixing study"
        const arr = (lut.get(key) || []).filter(a => a.ptCategory === wantCat);
        if (arr.length) return arr[0];
      }
    }
    return null;
  };
}
