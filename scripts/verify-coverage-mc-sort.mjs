// scripts/verify-coverage-mc-sort.mjs
//
// Gate 3 receipt for the sortable Method-comparisons table on the VeritaCheck
// Coverage page. Mirrors the mcRows comparator in VeritaCheckCoveragePage.tsx:
// null key = default (gaps first, then studies on file); analyte/instruments =
// alpha; study = missing(0) < FAIL(1) < on-file(2); verdict = alpha; every sort
// tiebreaks by analyte for stability. Fixture shaped like San Carlos lab 2.
//
// Run: node scripts/verify-coverage-mc-sort.mjs

const isFail = (v) => String(v || "").toLowerCase() === "fail";

// Comparator copied 1:1 from the component.
function mcSortRows(base, mcSort) {
  if (!mcSort.key) return base.filter((m) => !m.hasStudy).concat(base.filter((m) => m.hasStudy));
  const studyRank = (m) => (!m.hasStudy ? 0 : isFail(m.verdict) ? 1 : 2);
  const val = (m) => {
    switch (mcSort.key) {
      case "instruments": return m.instruments.join(", ").toLowerCase();
      case "study": return studyRank(m);
      case "verdict": return (m.verdict || "").toLowerCase();
      default: return m.analyte.toLowerCase();
    }
  };
  return base.slice().sort((a, b) => {
    const va = val(a), vb = val(b);
    let c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    if (c === 0) c = a.analyte.localeCompare(b.analyte);
    return mcSort.dir === "asc" ? c : -c;
  });
}

// Fixture: two on-file (one PASS, one FAIL) + three missing, deliberately
// out of alpha order so sorting is observable.
const rows = [
  { analyte: "EO%",   instruments: ["Sysmex XN-1000 (R2-D2)", "Sysmex XN-450 (BB-8)"], hasStudy: false, studyId: null, verdict: "",     signed: false },
  { analyte: "BASO#", instruments: ["Sysmex XN-1000 (R2-D2)", "Sysmex XN-450 (BB-8)"], hasStudy: true,  studyId: 501,  verdict: "pass", signed: true  },
  { analyte: "Bilirubin, neonatal", instruments: ["Ortho VITROS 5600 (Bonnie)", "Ortho VITROS 5600 (Clyde)"], hasStudy: false, studyId: null, verdict: "", signed: false },
  { analyte: "BASO%", instruments: ["Sysmex XN-1000 (R2-D2)", "Sysmex XN-450 (BB-8)"], hasStudy: true,  studyId: 502,  verdict: "fail", signed: false },
  { analyte: "EO#",   instruments: ["Sysmex XN-1000 (R2-D2)", "Sysmex XN-450 (BB-8)"], hasStudy: false, studyId: null, verdict: "",     signed: false },
];

let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got=${JSON.stringify(got)}\n  want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}
const names = (arr) => arr.map((m) => m.analyte);

// Default order: the 3 missing first (input order preserved), then the 2 on-file.
eq("default: gaps first then on-file", names(mcSortRows(rows, { key: null, dir: "asc" })),
   ["EO%", "Bilirubin, neonatal", "EO#", "BASO#", "BASO%"]);

// Analyte asc/desc (localeCompare: uppercase analytes before mixed-case "Bilirubin").
eq("analyte asc", names(mcSortRows(rows, { key: "analyte", dir: "asc" })),
   ["BASO#", "BASO%", "Bilirubin, neonatal", "EO#", "EO%"]);
eq("analyte desc", names(mcSortRows(rows, { key: "analyte", dir: "desc" })),
   ["EO%", "EO#", "Bilirubin, neonatal", "BASO%", "BASO#"]);

// Study asc: missing(0) first (alpha tiebreak), then FAIL(1)=BASO%, then on-file(2)=BASO#.
eq("study asc: missing < fail < on-file", names(mcSortRows(rows, { key: "study", dir: "asc" })),
   ["Bilirubin, neonatal", "EO#", "EO%", "BASO%", "BASO#"]);
// Study desc: on-file(2) first, then FAIL(1), then missing(0) reversed-by-key but
// tiebreak analyte still ascending within a rank flips under global negate.
eq("study desc: on-file first", names(mcSortRows(rows, { key: "study", dir: "desc" }))[0], "BASO#");

// Verdict asc: "" (missing) sorts before "fail" before "pass".
const vAsc = names(mcSortRows(rows, { key: "verdict", dir: "asc" }));
eq("verdict asc: blanks first, then fail, then pass", [vAsc[3], vAsc[4]], ["BASO%", "BASO#"]);

// Instruments asc: Ortho VITROS (Bilirubin) sorts before all the Sysmex rows.
eq("instruments asc: Ortho before Sysmex", names(mcSortRows(rows, { key: "instruments", dir: "asc" }))[0], "Bilirubin, neonatal");

// Non-mutation: sorting must not reorder the source array.
mcSortRows(rows, { key: "analyte", dir: "asc" });
eq("source array untouched after sort", names(rows), ["EO%", "BASO#", "Bilirubin, neonatal", "BASO%", "EO#"]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
