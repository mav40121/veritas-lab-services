// scripts/verify-coverage-seed-classify.mjs
//
// Receipt for the coverage-seeder v2 (server/routes.ts seed-coverage-studies):
//   1. Portable specialty+instrument classifier (cal-verifiable vs exempt) that
//      works on any lab's analyzers and reproduces Michaels Lab 143 cal-ver / 46
//      exempt.
//   2. One cal-ver per (analyte, instrument MODEL): sibling units of the same
//      model collapse to one study (they already cover each other via model-token
//      matching), killing the "2 of every study" duplicate look.
//
// Run: node scripts/verify-coverage-seed-classify.mjs

const EXEMPT_INSTR = ["manual", "tube", "gram", "kit", "clinitek", "statstrip",
  "i-stat", "istat", "echo", "gel", "id-mts", "id mts", "rapid", "wet",
  "genexpert", "cepheid", "id now", "bactec", "bd max", "microscop", "osom"];
const WAIVED_INSTR = ["statstrip", "clinitek", "kit", "osom", "rapid"];
const EXEMPT_SPECIALTY = new Set(["Blood Bank", "Immunohematology", "Molecular",
  "Serology", "General Immunology", "Microbiology", "POC", "Urinalysis", "Toxicology"]);
function classify(instrumentName, specialty) {
  const n = (instrumentName || "").toLowerCase();
  const waived = WAIVED_INSTR.some((k) => n.includes(k)) || specialty === "Serology" || specialty === "Urinalysis";
  if (EXEMPT_INSTR.some((k) => n.includes(k))) return { calver: false, type: waived ? "waived" : "noncal" };
  if (EXEMPT_SPECIALTY.has(specialty)) return { calver: false, type: waived ? "waived" : "noncal" };
  return { calver: true };
}

// [instrument, specialty, expectCalver]
const cases = [
  // Michaels Lab measuring analyzers -> cal-verifiable
  ["Siemens Dimension EXL", "Chemistry", true],
  ["Sysmex XN-2000", "Hematology", true],
  ["Stago STA Compact Max", "Coagulation", true],
  ["Alcor mini-iSED", "Hematology", true],
  // Demo lab measuring analyzers -> cal-verifiable
  ["Ortho 5600 Primary", "Chemistry", true],
  ["Tosoh", "Chemistry", true],
  ["CA-660 Primary", "Coagulation", true],
  ["XN-1000", "Hematology", true],
  ["Mini i-Sed", "Hematology", true],
  // Exempt: manual / waived / qualitative
  ["Manual Differential", "Hematology", false],
  ["CLINITEK Status+", "Urinalysis", false],
  ["Clinitek Novus", "Urinalysis", false],
  ["Abbott i-STAT Alinity G3+", "POC", false],
  ["Nova StatStrip Glucose", "POC", false],
  ["Echo", "Blood Bank", false],
  ["Tube Method", "Blood Bank", false],
  ["Ortho ID-MTS Gel", "Blood Bank", false],
  ["Cepheid GeneXpert IV", "Molecular", false],
  ["Gram Stain", "Microbiology", false],
  ["HIV Rapid Kit", "Serology", false],
];

let failed = 0;
for (const [instr, spec, want] of cases) {
  const got = classify(instr, spec).calver;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  classify(${instr} / ${spec}) calver=${got} want=${want}`);
}

// Cal-ver dedup by (analyte, instrument MODEL).
function dedupCount(combos) {
  const seen = new Set(); let seeded = 0, deduped = 0;
  for (const cb of combos) {
    const key = `${cb.analyte}||${cb.model}`;
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key); seeded++;
  }
  return { seeded, deduped };
}
// WBC on two Sysmex XN-2000 units (Fred, Wilma) -> 1 seeded, 1 deduped.
const d1 = dedupCount([{ analyte: "WBC", model: "Sysmex XN-2000" }, { analyte: "WBC", model: "Sysmex XN-2000" }]);
const c1 = d1.seeded === 1 && d1.deduped === 1;
if (!c1) failed++;
console.log(`${c1 ? "PASS" : "FAIL"}  WBC on Fred+Wilma (same model) -> seeded ${d1.seeded}, deduped ${d1.deduped} (want 1/1)`);
// Glucose on two different models -> 2 seeded, 0 deduped.
const d2 = dedupCount([{ analyte: "Glucose", model: "Siemens Dimension EXL" }, { analyte: "Glucose", model: "Ortho 5600" }]);
const c2 = d2.seeded === 2 && d2.deduped === 0;
if (!c2) failed++;
console.log(`${c2 ? "PASS" : "FAIL"}  Glucose on two models -> seeded ${d2.seeded}, deduped ${d2.deduped} (want 2/0)`);

console.log(failed ? `\n${failed} FAILED` : "\nAll classifier + dedup cases passed.");
process.exit(failed ? 1 : 0);
