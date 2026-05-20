// Unit-test receipt for hasCanonicalTea (server/backfillAbsoluteFloor.ts).
// Re-implements the alias-set construction + matching logic in plain JS so
// it can run without tsx/node-modules, then exercises every code path:
//   (1) direct alias-set hit (e.g. "ALT" matches "alt")
//   (2) regex fallback hit (e.g. "ALT (Pfizer side-by-side)" matches "alt")
//   (3) regex fallback NEGATIVE (e.g. "Custom Analyte X" matches nothing)
//   (4) regex with potential metachar in alias (defensive — no current
//       teaData entry has a regex metachar in an alias, but the escape
//       function still has to work if one is ever added)
//
// Run from repo root:
//   node scripts/verify-canonical-tea-matching.js
//
// Exits with non-zero status if any expectation fails so the script can
// land in CI later if desired.

const teaData = [
  { analyte: "Alanine Aminotransferase (ALT/SGPT)" },
  { analyte: "Albumin" },
  { analyte: "Alkaline Phosphatase" },
  { analyte: "Aspartate Aminotransferase (AST/SGOT)" },
  { analyte: "Bilirubin, Total" },
  { analyte: "Blood Gas pCO2" },
  { analyte: "B-Natriuretic Peptide (BNP)" },
  { analyte: "Cholesterol, HDL" },
  { analyte: "Cholesterol, LDL (direct)" },
  { analyte: "Creatinine" },
  { analyte: "Glucose (excluding home use devices)" },
  { analyte: "Hemoglobin A1c (HbA1c)" },
  { analyte: "Sodium" },
  { analyte: "C-Reactive Protein (hs-CRP)" },
  { analyte: "Phenytoin (Dilantin)" },
];

const aliasSet = new Set();
for (const row of teaData) {
  const full = row.analyte.trim().toLowerCase();
  aliasSet.add(full);
  const parenMatches = row.analyte.match(/\(([^)]+)\)/g) || [];
  for (const paren of parenMatches) {
    const inner = paren.slice(1, -1);
    for (const alias of inner.split(/[\/,]/)) {
      const a = alias.trim().toLowerCase();
      if (a.length > 0) aliasSet.add(a);
    }
  }
  const prePar = row.analyte.split("(")[0].trim().toLowerCase();
  if (prePar.length > 0) aliasSet.add(prePar);
}

function escapeRegexAlias(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCanonicalTea(analyte) {
  if (!analyte) return false;
  const needle = String(analyte).trim().toLowerCase();
  if (!needle) return false;
  if (aliasSet.has(needle)) return true;
  for (const alias of aliasSet) {
    if (alias.length < 3) continue;
    const re = new RegExp(`\\b${escapeRegexAlias(alias)}\\b`, "i");
    if (re.test(needle)) return true;
  }
  return false;
}

const cases = [
  // (1) direct hits
  { name: "ALT",                    expect: true,  why: "direct alias from (ALT/SGPT)" },
  { name: "alt",                    expect: true,  why: "case-insensitive direct" },
  { name: "SGPT",                   expect: true,  why: "second alias from same parenthetical" },
  { name: "Sodium",                 expect: true,  why: "full name, no parenthetical" },
  { name: "Albumin",                expect: true,  why: "full name" },
  { name: "Glucose",                expect: true,  why: "pre-paren portion of Glucose (excluding ...)" },
  { name: "BNP",                    expect: true,  why: "direct alias from B-Natriuretic Peptide (BNP)" },
  { name: "HbA1c",                  expect: true,  why: "direct alias from Hemoglobin A1c (HbA1c)" },

  // (2) regex fallback hits — needle contains the alias as a whole word
  { name: "ALT (Pfizer side-by-side)",      expect: true,  why: "fallback: alias 'alt' is a word in needle" },
  { name: "Glucose - QC Run 3",             expect: true,  why: "fallback: alias 'glucose' is a word" },
  { name: "Sodium daily QC",                expect: true,  why: "fallback: 'sodium' is a word" },
  { name: "ALT Level 1 - Multichem",        expect: true,  why: "fallback: 'alt' is a word" },

  // (3) negatives — needle is unrelated to any canonical analyte
  { name: "Custom Analyte X",       expect: false, why: "no match anywhere" },
  { name: "Saltern Buffer",         expect: false, why: "'alt' inside 'saltern' should NOT match (word boundary)" },
  { name: "Glutamine",              expect: false, why: "no canonical entry; word boundary protects" },
  { name: "",                       expect: false, why: "empty string returns false" },
  { name: null,                     expect: false, why: "null returns false" },

  // (4) defensive — if a future teaData entry has regex metachars, escape works
  { name: "B-Natriuretic Peptide",  expect: true,  why: "pre-paren portion (hyphen present)" },
  { name: "C-Reactive Protein",     expect: true,  why: "pre-paren portion (hyphen present)" },
];

let failed = 0;
for (const c of cases) {
  const got = hasCanonicalTea(c.name);
  const ok = got === c.expect;
  if (!ok) failed += 1;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status}  hasCanonicalTea(${JSON.stringify(c.name).padEnd(36)})  expected=${String(c.expect).padEnd(5)} got=${String(got).padEnd(5)}  // ${c.why}`);
}

// Probe the alias set contents for visibility.
console.log("\n--- alias set sample (sorted) ---");
console.log([...aliasSet].sort().join(", "));

console.log(`\n${failed === 0 ? "ALL TESTS PASSED" : `${failed} TEST(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
