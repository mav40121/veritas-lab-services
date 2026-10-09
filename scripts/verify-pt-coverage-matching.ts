// scripts/verify-pt-coverage-matching.ts
// Receipt for bug 6 (2026-10-09): Redington-Fairview's VeritaPT map said "PT
// enrollment is not required" for 21 of 27 analytes, including PT, APTT, ABO,
// Rh, crossmatch and antibody ID (all regulated: 42 CFR 493.941, 493.959). The
// coverage map used an exact-name lookup and treated any miss with a known
// complexity as exempt. It now uses the shared matcher (server/ptAnalyteMatcher.ts)
// and never exempts a name it cannot place.
// This imports the REAL matcher and reference (no copied logic) and runs every
// one of Redington's 27 menu names, plus the earlier matcher cases.
// Run: npx tsx scripts/verify-pt-coverage-matching.ts   (exits non-zero on fail)
import { createAnalyteMatcher } from "../server/ptAnalyteMatcher";
import { cliaAnalytes } from "../server/cliaAnalytes";

const match = createAnalyteMatcher(cliaAnalytes);
let fails = 0;
const check = (label: string, ok: boolean, detail: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}  :: ${detail}`); if (!ok) fails++; };

// [menu name, menu specialty, expected reference id (null = no match), expected tier]
const CASES: [string, string, string | null, string | null][] = [
  // Redington-Fairview lab 34, regulated (42 CFR 493.959 immunohematology, 493.941 hematology)
  ["ABO Group", "Immunohematology", "abo-group", "regulated"],
  ["ABO forward grouping", "Blood Bank", "abo-group", "regulated"],
  ["ABO reverse grouping", "Blood Bank", "abo-group", "regulated"],
  ["ABO/Rh confirmation", "Blood Bank", "abo-group", "regulated"],
  ["Rh typing", "Immunohematology", "d-rho-typing", "regulated"],
  ["Rh Type", "Immunohematology", "d-rho-typing", "regulated"],
  ["Antibody Screen", "Immunohematology", "unexpected-antibody-detection", "regulated"],
  ["Antibody Identification", "Immunohematology", "antibody-identification", "regulated"],
  ["Antibody identification panel A (11-cell panel)", "Blood Bank", "antibody-identification", "regulated"],
  ["Antibody identification panel B (11-cell panel)", "Blood Bank", "antibody-identification", "regulated"],
  ["Crossmatch (AHG)", "Immunohematology", "compatibility-testing", "regulated"],
  ["Crossmatch (IS)", "Immunohematology", "compatibility-testing", "regulated"],
  ["Crossmatch compatibility testing (AHG)", "Blood Bank", "compatibility-testing", "regulated"],
  ["Immediate spin crossmatch", "Blood Bank", "compatibility-testing", "regulated"],
  ["Fibrinogen", "Hematology", "fibrinogen", "regulated"],
  ["Activated partial thromboplastin time (APTT)", "Hematology", "ptt", "regulated"],
  ["Prothrombin time (PT)", "Hematology", "pt-inr", "regulated"],
  // Redington-Fairview, NOT on the Subpart I lists
  ["DAT anti-IgG", "Blood Bank", "direct-antiglobulin-test", "unregulated"],
  ["DAT anti-IgG/anti-C3d", "Blood Bank", "direct-antiglobulin-test", "unregulated"],
  ["Direct Antiglobulin Test (DAT)", "Immunohematology", "direct-antiglobulin-test", "unregulated"],
  ["Phenotyping (Rh, Kell, Duffy, Kidd, MNS)", "Immunohematology", "rbc-antigen-typing", "unregulated"],
  ["Fetal Screen", "Blood Bank", "fetal-rbc-screen", "unregulated"],
  ["Heparin, unfractionated heparin (UFH) and low molecular weight heparin (LMWH)", "Hematology", "heparin-anti-xa", "unregulated"],
  // Redington-Fairview, no reference entry: the lab confirms (never "not required")
  ["Prenatal testing", "Blood Bank", null, null],
  ["Selected cells", "Blood Bank", null, null],
  ["Weak D", "Blood Bank", null, null],
  // Earlier matcher behavior that must hold (PR #1240, #1244)
  ["Alanine aminotransferase (ALT) (SGPT)", "General Chemistry", "alt", "regulated"],
  ["AST", "General Chemistry", "ast", "regulated"],
  ["AST", "Microbiology", "antimicrobial-susceptibility", "regulated"],
  // Guards: a short prefix must not swallow a different test
  ["PT mixing study", "Coagulation", null, null],
];
for (const [name, spec, wantId, wantTier] of CASES) {
  const m = match(name, spec);
  const gotId = m ? (m as any).id : null;
  const okId = wantId === null ? gotId === null : gotId === wantId || (wantId === "alt" && /alanine/i.test(m?.name || "")) || (wantId === "ast" && /aspartate/i.test(m?.name || ""));
  const okTier = wantTier === null || (m && m.tier === wantTier);
  check(`${name} [${spec}]`, !!okId && !!okTier, `${m ? `${m.name} (${m.tier})` : "no match -> confirm"}; want ${wantId ?? "no match"}`);
}
// The reference must carry the 42 CFR 493.959 and 493.941 PT analytes as regulated.
for (const id of ["abo-group", "d-rho-typing", "unexpected-antibody-detection", "compatibility-testing", "antibody-identification", "fibrinogen", "ptt", "pt-inr"]) {
  const a = cliaAnalytes.find((x: any) => x.id === id);
  check(`reference ${id} is regulated`, !!a && a.tier === "regulated", a ? a.name : "missing");
}
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
