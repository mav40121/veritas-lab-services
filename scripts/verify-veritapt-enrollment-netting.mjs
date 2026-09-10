// scripts/verify-veritapt-enrollment-netting.mjs
//
// Receipt for the 2026-08-31 VeritaPT "net against current enrollments" fix.
//
// The recommendation engine used to read already-covered ONLY from the v1
// analyte-level table (pt_enrollments). Every real lab records API/CAP coverage
// through the normal PT Enrollment UI, which writes the category-level v2 table
// (pt_enrollments_v2). So a fully-enrolled lab (San Carlos main, 9 disciplines)
// came back alreadyCovered=0 and got every discipline it already holds
// re-recommended. The fix nets v2 category enrollments into already-covered:
// an analyte whose ptCategory has an active v2 enrollment is covered, drops out
// of gaps, and its program is not recommended.
//
// This mirrors the netting loop in server/routes.ts (the /api/veritapt/
// recommendations handler) against representative classified menus.
//
// Run: node scripts/verify-veritapt-enrollment-netting.mjs   (exits non-zero on fail)

const nzKey = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Faithful copy of the netting loop (routes.ts step 6 + 7).
function computeNetting(classified, { enrolledAnalytes = [], enrolledCategoriesV2 = [] } = {}) {
  const enrolledSet = new Set(enrolledAnalytes.map(nzKey));
  const enrolledCategories = new Set(enrolledCategoriesV2.map((c) => c.trim()));

  const alreadyCovered = [];
  const gaps = [];
  const gapByCategory = new Map();
  for (const c of classified) {
    const coveredByAnalyte = enrolledSet.has(nzKey(c.canonical));
    const coveredByCategory = c.ptCategory !== "Unmapped" && enrolledCategories.has(c.ptCategory);
    if (coveredByAnalyte || coveredByCategory) {
      alreadyCovered.push(c.canonical);
    } else {
      gaps.push(c.canonical);
      if (c.ptCategory !== "Unmapped") {
        const arr = gapByCategory.get(c.ptCategory) || [];
        arr.push(c.canonical);
        gapByCategory.set(c.ptCategory, arr);
      }
    }
  }
  const recommendedCategories = Array.from(gapByCategory.keys()).sort();
  return { alreadyCovered, gaps, recommendedCategories };
}

let fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  const ok = g === w;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got  ${g}\n        want ${w}`}`);
  if (!ok) fail++;
};

// A menu spanning ten disciplines (one analyte each is enough to test category
// membership; real menus have many per category and net the same way).
const MENU = [
  { canonical: "Glucose", ptCategory: "General Chemistry" },
  { canonical: "Cortisol", ptCategory: "Endocrinology" },
  { canonical: "pH (blood gas)", ptCategory: "Special Chemistry" },
  { canonical: "Acetaminophen", ptCategory: "Toxicology / TDM" },
  { canonical: "Hepatitis B surface antigen", ptCategory: "Immunology / Serology" },
  { canonical: "White blood cell count", ptCategory: "Hematology" },
  { canonical: "Prothrombin time", ptCategory: "Coagulation" },
  { canonical: "ABO group", ptCategory: "Blood Bank / Immunohematology" },
  { canonical: "Urine leukocyte esterase", ptCategory: "Urinalysis" },
  { canonical: "Aerobic culture", ptCategory: "Microbiology" },
];

// The exact nine categories San Carlos main (lab 2) holds in pt_enrollments_v2.
const SCAHC_V2 = [
  "Blood Bank / Immunohematology", "Coagulation", "Endocrinology",
  "General Chemistry", "Hematology", "Immunology / Serology",
  "Special Chemistry", "Toxicology / TDM", "Urinalysis",
];

console.log("Scenario A — San Carlos lab 2: 9 v2 disciplines enrolled, Micro not:");
{
  const r = computeNetting(MENU, { enrolledCategoriesV2: SCAHC_V2 });
  eq("  only Microbiology remains a recommended gap", r.recommendedCategories, ["Microbiology"]);
  eq("  gaps = the single Micro analyte", r.gaps, ["Aerobic culture"]);
  eq("  alreadyCovered count = 9", r.alreadyCovered.length, 9);
  eq("  Micro is NOT already covered", r.alreadyCovered.includes("Aerobic culture"), false);
}

console.log("\nScenario B — lab 6 (CW Bylas): no enrollments at all:");
{
  const bylas = MENU.filter((m) => ["General Chemistry", "Hematology", "Special Chemistry", "Urinalysis"].includes(m.ptCategory));
  const r = computeNetting(bylas, {});
  eq("  every discipline still a gap", r.recommendedCategories,
     ["General Chemistry", "Hematology", "Special Chemistry", "Urinalysis"]);
  eq("  alreadyCovered empty", r.alreadyCovered, []);
}

console.log("\nScenario C — v1 analyte-level netting still works (backward compat):");
{
  const r = computeNetting(MENU, { enrolledAnalytes: ["Glucose", "Prothrombin time"] });
  eq("  Glucose + PT covered by analyte enrollment", r.alreadyCovered.sort(), ["Glucose", "Prothrombin time"]);
  eq("  General Chemistry no longer recommended (only Glucose was in it)",
     r.recommendedCategories.includes("General Chemistry"), false);
  eq("  Coagulation no longer recommended (only PT was in it)",
     r.recommendedCategories.includes("Coagulation"), false);
}

console.log("\nScenario D — v1 and v2 combined; both nets apply:");
{
  const r = computeNetting(MENU, {
    enrolledAnalytes: ["Aerobic culture"],       // covers Micro at analyte level
    enrolledCategoriesV2: SCAHC_V2,              // covers the other nine
  });
  eq("  nothing left to recommend", r.recommendedCategories, []);
  eq("  gaps empty", r.gaps, []);
  eq("  all ten covered", r.alreadyCovered.length, 10);
}

console.log("\nScenario E — a v2 enrollment for an Unmapped category never nets:");
{
  const withUnmapped = [{ canonical: "Mystery analyte", ptCategory: "Unmapped" }, ...MENU];
  const r = computeNetting(withUnmapped, { enrolledCategoriesV2: ["Unmapped", ...SCAHC_V2] });
  eq("  Unmapped analyte stays a gap", r.gaps.includes("Mystery analyte"), true);
  eq("  Unmapped never becomes a recommended category", r.recommendedCategories, ["Microbiology"]);
}

if (fail) { console.error(`\n${fail} FAIL(s)`); process.exit(1); }
console.log("\nAll VeritaPT enrollment-netting checks passed.");
