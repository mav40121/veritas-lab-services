// scripts/verify-pt-matcher-disambiguation.mjs
//
// Receipt for the 2026-08-31 VeritaPT matcher fix. Two defects, one fix:
//   1) Ambiguous alias collision. "AST" is an alias on BOTH Antimicrobial
//      Susceptibility Testing (Microbiology) and Aspartate Aminotransferase
//      (General Chemistry). The lookup was first-write-wins, so every "AST"
//      resolved to the micro entry, handing a chemistry-only lab (CW Bylas) a
//      Microbiology PT program it never runs.
//   2) Unmapped sub-analytes. CBC differential sub-cells, urine dipstick pads,
//      individual drugs of abuse, co-oximetry, etc. are not in the reference, so
//      they dropped to "Unmapped" and produced no program.
// Both are solved with the menu's own specialty tag: DISAMBIGUATE a collision by
// preferring the entry whose ptCategory matches the specialty, and ROLL UP an
// unmatched analyte to the specialty's discipline.
//
// This mirrors the matcher in server/routes.ts (multimap + pick + specialty
// fallback) against the real cliaAnalytes.ts data.
//
// Run: node scripts/verify-pt-matcher-disambiguation.mjs   (exits non-zero on fail)
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(process.cwd(), "server", "cliaAnalytes.ts"), "utf8");
const block = src.match(/export const cliaAnalytes: CliaAnalyte\[\] = \[([\s\S]*?)\n\];/)[1];
const analytes = [];
for (const o of block.match(/\{[\s\S]*?\}/g) || []) {
  const name = (o.match(/name:\s*"([^"]*)"/) || [])[1];
  if (!name) continue;
  const al = (o.match(/aliases:\s*\[([^\]]*)\]/) || [])[1] || "";
  const aliases = [...al.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const ptCategory = (o.match(/ptCategory:\s*"([^"]*)"/) || [])[1] || "";
  analytes.push({ name, aliases, ptCategory });
}

const nz = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const SPECIALTY_TO_PTCATEGORY = {
  "general chemistry": "General Chemistry", "electrolytes": "General Chemistry",
  "special chemistry": "Special Chemistry", "blood gas": "Special Chemistry",
  "endocrinology": "Endocrinology", "toxicology": "Toxicology / TDM",
  "therapeutic drug monitoring": "Toxicology / TDM", "immunology": "Immunology / Serology",
  "general immunology": "Immunology / Serology", "serology": "Immunology / Serology",
  "hematology": "Hematology", "coagulation": "Coagulation",
  "immunohematology": "Blood Bank / Immunohematology", "blood bank": "Blood Bank / Immunohematology",
  "transfusion": "Blood Bank / Immunohematology", "microbiology": "Microbiology",
  "urinalysis": "Urinalysis",
};
const specialtyCategory = s => (s ? SPECIALTY_TO_PTCATEGORY[s.toLowerCase().trim()] : undefined) ?? null;

const lut = new Map();
for (const a of analytes) for (const k of [a.name, ...a.aliases]) {
  const kk = nz(k); if (!kk) continue;
  const arr = lut.get(kk) || []; if (!arr.includes(a)) arr.push(a); lut.set(kk, arr);
}
const pick = (arr, want) => !arr || !arr.length ? null : (arr.length === 1 || !want ? arr[0] : (arr.find(a => a.ptCategory === want) || arr[0]));
const match = (raw, specialty) => {
  const want = specialtyCategory(specialty);
  const d = pick(lut.get(nz(raw)), want); if (d) return d;
  const cands = [raw.split("(")[0], ...((raw.match(/\(([^)]+)\)/g) || []).map(x => x.replace(/[()]/g, "")))];
  for (const c of cands) { const h = pick(lut.get(nz(c)), want); if (h) return h;
    for (const s of c.split(/[\/,]/)) { const h2 = pick(lut.get(nz(s)), want); if (h2) return h2; } }
  return null;
};
// classify ptCategory = match ? match.ptCategory : specialty fallback
const classify = (raw, specialty) => { const m = match(raw, specialty); return m ? m.ptCategory : (specialtyCategory(specialty) ?? "Unmapped"); };

let fail = 0;
const expect = (label, got, want) => { const ok = got === want; console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)}`); if (!ok) fail++; };

console.log(`Loaded ${analytes.length} reference analytes.\n`);
console.log("Alias disambiguation (the CW Bylas bug):");
expect("AST as chemistry -> Aspartate Aminotransferase", match("AST", "General Chemistry")?.name, "Aspartate Aminotransferase (AST/SGOT)");
expect("AST as chemistry -> ptCategory General Chemistry", classify("AST", "General Chemistry"), "General Chemistry");
expect("AST as micro -> Antimicrobial Susceptibility Testing", match("AST", "Microbiology")?.name, "Antimicrobial Susceptibility Testing");

console.log("\nSpecialty rollup of unmapped sub-analytes:");
expect("BASO# (heme) -> Hematology", classify("BASO#", "Hematology"), "Hematology");
expect("Urine qualitative dipstick glucose -> Urinalysis", classify("Urine qualitative dipstick glucose", "Urinalysis"), "Urinalysis");
expect("Amphetamines (tox) -> Toxicology / TDM", classify("Amphetamines", "Toxicology"), "Toxicology / TDM");
expect("Aerobic blood culture (micro) -> Microbiology", classify("Aerobic blood culture", "Microbiology"), "Microbiology");
expect("Hepatitis A virus antibody (gen imm) -> Immunology / Serology", classify("Hepatitis A virus antibody", "General Immunology"), "Immunology / Serology");
expect("ALKP abbreviation (chem) -> General Chemistry", classify("ALKP", "General Chemistry"), "General Chemistry");

console.log("\nReal matches unaffected by the fix:");
expect("Glucose -> General Chemistry (real match, any specialty)", classify("Glucose", "Hematology"), "General Chemistry");
expect("Prothrombin time (PT) -> Coagulation", classify("Prothrombin time (PT)", "Coagulation"), "Coagulation");
expect("truly unmappable specialty -> Unmapped", classify("Widget", "Astrology"), "Unmapped");

if (fail) { console.error(`\n${fail} FAIL(s)`); process.exit(1); }
console.log("\nAll VeritaPT matcher disambiguation + rollup checks passed.");
