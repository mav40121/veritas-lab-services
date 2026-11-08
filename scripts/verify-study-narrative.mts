// Receipt for the VeritaCheck results-screen narrative fixes (2026-11-08,
// the parked findings from the ADLM build). Runs the real calculators, the
// screen narrative (client/src/lib/studyNarrative.ts) and the printed
// report's HTML builders (server/pdfReport.ts) on made-up inputs; no lab data.
//
//   npx tsx scripts/verify-study-narrative.mts
//
// Checks: a criterion stored in units (Sodium ±4 mmol/L) prints as ±4 mmol/L,
// never ±400.0%; two analyzers count the levels once and never read "This
// instrument"; every narrative ends with the closing line and a FAIL gives no
// instruction; the CFR paragraphs match on screen and on paper (42 CFR
// 493.1255(b)(2) and 493.1253(b)(3) for calibration verification limits,
// 493.1253(b)(1)(i)(B) for precision, 493.1281(a) for method comparison);
// no "Manufacturer precision claims are verified" without a vendor claim.
import { calculateStudy, calculatePrecision, calculateQualitative, calculateLotToLot, type DataPoint } from "../client/src/lib/calculations";
import { generateNarrative, CLOSING_SENTENCE } from "../client/src/lib/studyNarrative";
import { computeStudyResults } from "../client/src/lib/studyResults";
import { buildCalVerHTML, buildPrecisionHTML, buildMethodCompHTML, buildLotToLotHTML } from "../server/pdfReport";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`);
  if (!ok) failures++;
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const narrativeOf = (html: string) => {
  const t = text(html);
  const i = t.indexOf("Study Narrative Summary");
  return i < 0 ? "" : t.slice(i, i + 2500);
};
const study = (over: Record<string, unknown>) => ({
  id: 1, testName: "Sodium", instrument: "Analyzer A", analyst: "Test Analyst", date: "2026-11-08",
  studyType: "cal_ver", cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L",
  cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, instruments: JSON.stringify(["Analyzer A"]),
  dataPoints: "[]", status: "pass", createdAt: "2026-11-08T12:00:00Z", ...over,
}) as any;
const pts = (rows: Array<[number, Record<string, number>]>): DataPoint[] =>
  rows.map(([expected, vals], i) => ({ level: i + 1, expectedValue: expected, instrumentValues: vals }));

// 1. Sodium, one analyzer, units criterion, PASS, 2 mmol/L constant offset.
{
  const s = study({});
  const r = calculateStudy(pts([[120, { "Analyzer A": 122 }], [140, { "Analyzer A": 142 }], [160, { "Analyzer A": 162 }]]), ["Analyzer A"], 4, "cal_ver", false);
  const n = generateNarrative(r, s);
  check("Sodium cal ver screen: criterion reads ±4 mmol/L", n.includes("±4 mmol/L"), n);
  check("Sodium cal ver screen: no ±400.0%", !n.includes("400.0%"), n);
  check("Sodium cal ver screen: a 2 mmol/L offset isn't called negligible", n.includes("small positive constant offset of 2.000"), n);
  check("Sodium cal ver screen: cites 493.1255(b)(2) and 493.1253(b)(3)", n.includes("§493.1255(b)(2) and §493.1253(b)(3)"), n);
  check("Sodium cal ver screen: PASS ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
  const p = narrativeOf(buildCalVerHTML(s, r as any));
  check("Sodium cal ver PDF: criterion reads ±4 mmol/L, no 400.0%", p.includes("±4 mmol/L") && !p.includes("400.0%"), p);
  check("Sodium cal ver PDF: cites 493.1255(b)(2) and 493.1253(b)(3)", p.includes("§493.1255(b)(2) and §493.1253(b)(3)") && !p.includes("§493.1255(b)(3) and §493.1253(b)(2)"), p);
  check("Sodium cal ver PDF: a 2 mmol/L offset isn't called negligible", p.includes("small positive constant offset of 2.000"), p);
}

// 2. Sodium FAIL: no instruction to the director, still the closing line.
{
  const s = study({ status: "fail" });
  const r = calculateStudy(pts([[120, { "Analyzer A": 121 }], [140, { "Analyzer A": 139 }], [160, { "Analyzer A": 166 }]]), ["Analyzer A"], 4, "cal_ver", false);
  const n = generateNarrative(r, s);
  check("Sodium cal ver FAIL screen: says 1 of 3 levels exceeded", n.startsWith("1 of 3 calibration level for Sodium exceeded"), n);
  check("Sodium cal ver FAIL screen: no 'Review ...' instruction", !/\bReview\b/.test(n), n);
  check("Sodium cal ver FAIL screen: ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
}

// 3. Two analyzers, five levels: levels counted once, each analyzer described.
{
  const names = ["Analyzer A", "Analyzer B"];
  const s = study({ instruments: JSON.stringify(names) });
  const rows: Array<[number, Record<string, number>]> = [100, 120, 140, 160, 180].map((v) => [v, { "Analyzer A": v + 1, "Analyzer B": v - 1 }]);
  const r = calculateStudy(pts(rows), names, 4, "cal_ver", false);
  const n = generateNarrative(r, s);
  check("Two analyzers screen: '5 calibration levels ... on 2 analyzers'", n.startsWith("5 calibration levels for Sodium were run on 2 analyzers"), n);
  check("Two analyzers screen: never 'All 10' or 'This instrument'", !n.includes("All 10") && !n.includes("This instrument"), n);
  check("Two analyzers screen: each analyzer's maximum error in mmol/L", n.includes("Analyzer A: slope") && n.includes("Analyzer B: slope") && n.includes("maximum observed error 1.00 mmol/L"), n);
  check("Two analyzers screen: ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
}

// 4. Glucose, percent with an absolute floor: both terms, dual note before the closing line.
{
  const s = study({ testName: "Glucose", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL" });
  const r = calculateStudy(pts([[50, { "Analyzer A": 53 }], [150, { "Analyzer A": 152 }], [300, { "Analyzer A": 305 }]]), ["Analyzer A"], 0.08, "cal_ver", true, 6);
  const n = generateNarrative(r, s);
  check("Glucose screen: criterion reads ±8.0% or ±6 mg/dL (greater)", n.includes("±8.0% or ±6 mg/dL (greater)"), n);
  check("Glucose screen: dual-criterion note sits before the closing line", n.includes("dual-criterion rule") && n.endsWith(CLOSING_SENTENCE), n);
}

// 5. Precision PASS and FAIL (Albumin's CLIA criterion ±8%, so the CFR paragraph prints; no vendor SD).
{
  const s = study({ testName: "Albumin", studyType: "precision", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%" });
  const pass = calculatePrecision([{ level: 1, levelName: "Level 1", values: [40, 41, 40, 39, 40, 41, 40, 40, 39, 41] }], 0.08, "simple");
  const n = generateNarrative(pass as any, s);
  check("Precision PASS screen: no 'Manufacturer precision claims are verified'", !n.includes("Manufacturer precision claims"), n);
  check("Precision PASS screen: cites 493.1253(b)(1)(i)(B)", n.includes("§493.1253(b)(1)(i)(B)"), n);
  check("Precision PASS screen: ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
  const p = narrativeOf(buildPrecisionHTML(s, pass));
  check("Precision PASS PDF: no 'Manufacturer precision claims are verified'", !p.includes("Manufacturer precision claims"), p);
  check("Precision PASS PDF: cites 493.1253(b)(1)(i)(B), not (b)(2)(ii)", p.includes("§493.1253(b)(1)(i)(B)") && !p.includes("§493.1253(b)(2)(ii)"), p);
  const fail = calculatePrecision([{ level: 1, levelName: "Level 1", values: [30, 45, 38, 50, 33, 47, 36, 52, 31, 44] }], 0.08, "simple");
  const f = generateNarrative(fail as any, study({ testName: "Albumin", studyType: "precision", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%", status: "fail" }));
  check("Precision FAIL screen: no 'Review ...' instruction, ends with the closing line", !/\bReview\b/.test(f) && f.endsWith(CLOSING_SENTENCE), f);
}

// 6. Sodium method comparison in units: limit and bias in mmol/L; PDF cites 493.1281(a).
{
  const names = ["Primary", "Comparison"];
  const s = study({ studyType: "method_comparison", instruments: JSON.stringify(names) });
  // VeritaCheckPage passes the primary's reading as expectedValue and only the comparison analyzers as names.
  const rows = [120, 130, 140, 150, 160].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { Comparison: v + 1 } })) as DataPoint[];
  const r = calculateStudy(rows, ["Comparison"], 4, "method_comparison", false);
  const n = generateNarrative(r, s);
  check("Sodium method comparison screen: PASS, limit ±4 mmol/L and bias +1.00 mmol/L, no 400.0%", n.includes("mean bias of +1.00 mmol/L is within the adopted method comparison acceptance criterion of ±4 mmol/L") && !n.includes("400.0%"), n);
  check("Sodium method comparison screen: ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
  const p = narrativeOf(buildMethodCompHTML(s, r as any));
  check("Sodium method comparison PDF: cites 493.1281(a), not 493.1253(b)(2)", p.includes("§493.1281(a)") && !p.includes("adopted under 42 CFR §493.1253(b)(2)"), p);
}

// 7. Qualitative FAIL: no instruction, closing line.
{
  const names = ["Reference", "New"];
  const s = study({ testName: "hCG, urine", studyType: "qualitative", instruments: JSON.stringify(names), cliaAllowableError: 0.9, teaIsPercentage: 1 });
  const cats = ["Positive", "Negative"];
  const rows = ["Positive", "Negative", "Positive", "Negative", "Positive"].map((c, i) => ({
    level: i + 1, expectedValue: null, instrumentValues: {},
    expectedCategory: c, instrumentCategories: { New: i < 2 ? (c === "Positive" ? "Negative" : "Positive") : c },
  })) as DataPoint[];
  const r = calculateQualitative(rows, ["New"], cats, 0.9);
  const n = generateNarrative(r as any, s);
  check("Qualitative FAIL screen: no 'Review discordant' instruction, ends with the closing line", !/\bReview\b/.test(n) && n.endsWith(CLOSING_SENTENCE), n);
}

// 8. Q239 = 1: Sodium precision in units, judged as 2 SD within ±4 mmol/L, on screen and on paper.
{
  const s = study({ studyType: "precision", status: "fail" });
  const vals = Array.from({ length: 20 }, (_, i) => 140 + (i % 2 ? 2.5 : -2.5)); // 2 SD about 5.1 mmol/L, CV 1.8%
  const r = calculatePrecision([{ level: 1, levelName: "Level 1", values: vals }], 4, "simple", { teaIsPercentage: false, unit: "mmol/L" });
  const n = generateNarrative(r as any, s);
  check("Sodium precision: FAIL under 2 SD within ±4 mmol/L (the old 400% CV reading passed it)", !r.overallPass, r.summary);
  check("Sodium precision screen: speaks in 2 SD and ±4 mmol/L, no 400.0%", n.includes("largest 2 SD of 5.130 mmol/L") && n.includes("±4 mmol/L") && !n.includes("400.0%"), n);
  check("Sodium precision screen: ends with the closing line", n.endsWith(CLOSING_SENTENCE), n);
  const html = buildPrecisionHTML(s, r);
  const p = narrativeOf(html);
  check("Sodium precision PDF: speaks in 2 SD and ±4 mmol/L, no 400.0%", p.includes("largest 2 SD of 5.130 mmol/L") && p.includes("±4 mmol/L") && !text(html).includes("400.0%"), p);
  check("Sodium precision PDF table: '2 SD / Limit' with 5.130 / ±4 mmol/L", text(html).includes("2 SD / Limit") && text(html).includes("5.130 / ±4 mmol/L"));
}

// 9. Q239 = 1: Sodium lot-to-lot in units, on paper; and its citation is the reference block's 493.1255(b)(3)(i).
{
  const s = study({ studyType: "lot_to_lot", status: "fail" });
  const data = [[138, 144], [140, 146], [142, 147], [135, 141], [145, 150]].map(([c, nw], i) => ({ specimenId: `S${i + 1}`, currentLot: c, newLot: nw, cohort: "Normal" as const }));
  s.dataPoints = JSON.stringify({ data, sampleType: "normal", analyte: "Sodium", units: "mmol/L" });
  const r = calculateLotToLot(data, 4, "normal", false, null, "mmol/L");
  const html = buildLotToLotHTML(s, r);
  const t = text(html);
  check("Sodium lot PDF: FAIL, differences in mmol/L, no 400.0% anywhere", !r.overallPass && t.includes("Diff (mmol/L)") && t.includes("Mean |Diff|") && t.includes("5.60 mmol/L") && !t.includes("400.0%"), t.slice(0, 600));
  check("Sodium lot PDF: cites 493.1255(b)(3)(i), not 493.1253(b)(2)", t.includes("adopted under 42 CFR §493.1255(b)(3)(i)") && !t.includes("adopted under 42 CFR §493.1253(b)(2)"));
}

// 10. The summary line names the unit (2026-11-08 follow-up): computeStudyResults is what the results screen and the
// PDF request use, and it reads the stored criterion through criterionForm.
{
  const calPts = JSON.stringify(pts([[120, { "Analyzer A": 122 }], [140, { "Analyzer A": 142 }], [160, { "Analyzer A": 162 }]]));
  const cal = computeStudyResults(study({ dataPoints: calPts }));
  check("Sodium cal ver summary: 'Adopted Acceptance Criterion (TEa) was ±4 mmol/L.'", cal.summary.includes("Adopted Acceptance Criterion (TEa) was ±4 mmol/L."), cal.summary);
  const mcRows = JSON.stringify([120, 130, 140, 150, 160].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { Comparison: v + 1 } })));
  const mc = computeStudyResults(study({ studyType: "method_comparison", dataPoints: mcRows, instruments: JSON.stringify(["Comparison"]) }));
  check("Sodium method comparison summary: 'criterion (TEa) of ±4 mmol/L'", mc.summary.includes("acceptance criterion (TEa) of ±4 mmol/L."), mc.summary);
  const glu = computeStudyResults(study({ testName: "Glucose", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL",
    dataPoints: JSON.stringify(pts([[50, { "Analyzer A": 53 }], [150, { "Analyzer A": 152 }], [300, { "Analyzer A": 305 }]])) }));
  check("Glucose cal ver summary: '±8.0% or ±6 mg/dL (greater)'", glu.summary.includes("was ±8.0% or ±6 mg/dL (greater)."), glu.summary);
  const two = ["Analyzer A", "Analyzer B"];
  const cc = computeStudyResults(study({ studyType: "cal_ver_correlation", instruments: JSON.stringify(two),
    dataPoints: JSON.stringify(pts([120, 140, 160].map((v) => [v, { "Analyzer A": v + 1, "Analyzer B": v + 2 }]))) })) as any;
  check("Sodium cal ver + correlation: both halves' summaries read ±4 mmol/L", cc.calVer.summary.includes("±4 mmol/L.") && cc.correlation.summary.includes("±4 mmol/L."), `${cc.calVer.summary} | ${cc.correlation.summary}`);
  const pctOnly = computeStudyResults(study({ testName: "Albumin", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%", dataPoints: calPts }));
  check("Albumin (percent, no floor) summary unchanged: '±8.0%.'", pctOnly.summary.includes("was ±8.0%."), pctOnly.summary);
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
