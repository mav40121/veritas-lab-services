// scripts/verify-pt-recommendations-root.mjs
//
// Receipt for the 2026-08-25 VeritaPT recommendation root fix: the engine now
// matches + categorizes analytes off cliaAnalytes.ts (the CMS analyte reference:
// comprehensive aliases + ptCategory + tier), instead of a hand-built normMap +
// narrow 25-program catalog that missed whole disciplines and verbose menu names
// (San Carlos got a partial order). This exercises the SAME matching the endpoint
// uses (nzKey + alias lookup + leading-phrase / parenthetical fallback) against
// cliaAnalytes, and asserts the previously-failing names now resolve to the right
// discipline. Documents the residual cliaAnalytes-completeness gaps as expected.
//
// Run: node scripts/verify-pt-recommendations-root.mjs   (exits non-zero on fail)
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(process.cwd(), "server", "cliaAnalytes.ts"), "utf8");
const block = src.match(/export const cliaAnalytes: CliaAnalyte\[\] = \[([\s\S]*?)\n\];/)[1];
const analytes = [];
for (const o of block.match(/\{[\s\S]*?\}/g) || []) {
  const name = (o.match(/name:\s*"([^"]*)"/) || [])[1];
  if (!name) continue;
  const al = (o.match(/aliases:\s*\[([^\]]*)\]/) || [])[1] || "";
  const aliases = [...al.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const ptCategory = (o.match(/ptCategory:\s*"([^"]*)"/) || [])[1] || "";
  analytes.push({ name, aliases, ptCategory });
}

const nz = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const lut = new Map();
for (const a of analytes) for (const k of [a.name, ...a.aliases]) { const kk = nz(k); if (kk && !lut.has(kk)) lut.set(kk, a); }
const match = (raw) => {
  const d = lut.get(nz(raw));
  if (d) return d;
  const cands = [raw.split("(")[0], ...((raw.match(/\(([^)]+)\)/g) || []).map((x) => x.replace(/[()]/g, "")))];
  for (const c of cands) {
    const h = lut.get(nz(c));
    if (h) return h;
    for (const s of c.split(/[\/,]/)) { const h2 = lut.get(nz(s)); if (h2) return h2; }
  }
  return null;
};

let fail = 0;
const expect = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)}`);
  if (!ok) fail++;
};

console.log(`Loaded ${analytes.length} reference analytes.\n`);
// The fix: verbose / variant menu names resolve to the correct discipline.
expect("ALT verbose -> General Chemistry", match("Alanine aminotransferase (ALT) (SGPT)")?.ptCategory, "General Chemistry");
expect("TSH verbose -> Endocrinology", match("Thyroid stimulating hormone (TSH)")?.ptCategory, "Endocrinology");
expect("PT verbose -> Coagulation", match("Prothrombin time (PT)")?.ptCategory, "Coagulation");
expect("Vancomycin -> Toxicology / TDM", match("Vancomycin")?.ptCategory, "Toxicology / TDM");
expect("HBsAg -> Immunology / Serology", match("Hepatitis B surface antigen (HBsAg)")?.ptCategory, "Immunology / Serology");
expect("ABO Group -> Blood Bank / Immunohematology", match("ABO Group")?.ptCategory, "Blood Bank / Immunohematology");
expect("25-OH vitamin D -> Endocrinology", match("25-hydroxyvitamin D (25-OH-D)")?.ptCategory, "Endocrinology");
expect("Vitamin B12 -> Endocrinology", match("Vitamin B12")?.ptCategory, "Endocrinology");

// A representative menu now spans many disciplines, not just chemistry + heme.
const menu = ["Alanine aminotransferase (ALT) (SGPT)", "Thyroid stimulating hormone (TSH)", "Prothrombin time (PT)",
  "Vancomycin", "Hepatitis B surface antigen (HBsAg)", "ABO Group", "Chloride", "WBC"];
const cats = new Set(menu.map((x) => match(x)?.ptCategory).filter(Boolean));
expect("representative menu spans >= 6 disciplines", cats.size >= 6, true);

// Documented residual gaps (cliaAnalytes completeness, a separate follow-up):
// individual drugs of abuse and analyzer differential sub-cells are not in the
// reference, so they stay Unmapped until added. Asserting they are still null
// keeps this receipt honest about what the fix does and does not cover.
expect("BASO# still unmapped (diff sub-cell not in reference)", match("BASO#"), null);
expect("Amphetamines still unmapped (individual DOA not in reference)", match("Amphetamines"), null);

if (fail) { console.error(`\n${fail} FAIL(s)`); process.exit(1); }
console.log("\nAll PT recommendation root-fix checks passed.");
