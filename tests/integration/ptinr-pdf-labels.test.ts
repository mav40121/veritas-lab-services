// tests/integration/ptinr-pdf-labels.test.ts
//
// BUG-147 (2026-11-10): page 4 of a PT/INR Geometric Mean Calculator study's PDF, the Supporting Data & User
// Specifications block, printed "Study Type: Method Comparison: Multi-Instrument Correlation (CLSI EP09 + EP15-A3)"
// and "±20.0% (ALT/SGPT (±15% or ±6 U/L))". supportingPageHTML (server/pdfReport.ts) picked the study type from a
// chain with no pt_coag entry, so it fell to the method comparison label, and it appended the saved cliaPresetLabel.
// The PT/INR form sets its own TEa per comparison module and never reads the shared criterion picker, so that label is
// whatever the picker held: ALT/SGPT, the first preset, unless someone changed it. The same line did the same to
// QC Lot Verification (qc_range) and Multi-Analyte Lot Comparison (multi_analyte_coag).
//
// Throwaway SQLite DB, made-up rows saved the way the forms save them (picker left on ALT/SGPT), read back through
// studyRowToClient and computeStudyResults, rendered by the builders the PDF route runs:
//   1. PT/INR with only Module 1 (the SCAHC shape): the page names the PT/INR study, no ALT, no method comparison,
//      criterion "None" (no comparison module ran), no Allowable Systematic Error row.
//   2. The criterion is the TEa each comparison module used: Module 3 alone; Module 2 and Module 3, each its own.
//   3. A legacy row with no preset label, and a row whose picker held the PT preset, read the same way.
//   4. qc_range and multi_analyte_coag name their own study type and carry no preset label.
//   5. Unchanged on purpose: calibration verification still prints its picked preset and its systematic error row;
//      method comparison keeps its label.
//
// Run: rm -f .tmp-ptinr-pdf.db && DB_PATH=.tmp-ptinr-pdf.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/ptinr-pdf-labels.test.ts

import { db } from "../../server/db";
import { buildPTCoagHTML, buildQCRangeHTML, buildMultiAnalyteCoagHTML, buildCalVerHTML, buildMethodCompHTML } from "../../server/pdfReport";
import { studyRowToClient } from "../../server/studyPdf";
import { computeStudyResults } from "../../client/src/lib/studyResults";
import { buildPtCoagPayload } from "../../client/src/lib/ptCoagPayload";
import { buildQcRangePayload, buildMultiAnalyteCoagPayload } from "../../client/src/lib/studyFormPayload";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const ALT = "ALT/SGPT (±15% or ±6 U/L)"; // CLIA_PRESETS[0], the picker's default
const sqlite = (db as any).$client;
const insert = sqlite.prepare(`INSERT INTO studies (user_id, created_by_user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at,
  tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label)
  VALUES (1, 1, @name, @instrument, 'Made-up Analyst', '2026-11-10', @type, @tea, @points, @instruments, 'pass', '2026-11-10T00:00:00Z', 1, '%', @floor, @floorUnit, @preset)`);
const saved = (r: { name: string; type: string; tea: number; points: unknown; instruments: string[]; preset: string | null; floor?: number | null; floorUnit?: string | null }) => {
  const id = Number(insert.run({ name: r.name, instrument: r.instruments[0], type: r.type, tea: r.tea, points: JSON.stringify(r.points), instruments: JSON.stringify(r.instruments), preset: r.preset, floor: r.floor ?? null, floorUnit: r.floorUnit ?? null }).lastInsertRowid);
  const study = studyRowToClient(sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id));
  return { study, results: computeStudyResults(study) as any };
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
// The Supporting Data & User Specifications block: page 4 of a single-instrument PT/INR study with no comparison.
const supportingOf = (html: string) => { const at = html.indexOf('class="supporting-page"'); return at < 0 ? "" : text(html.slice(html.lastIndexOf("<", at))); };

// ── PT/INR, saved as Run Study saves it ──
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null as number | null, y: null as number | null }));
const pairs = (r: ReturnType<typeof rows>, f: number) => { r.forEach((row, i) => { row.x = 11 + i * 0.6; row.y = +((11 + i * 0.6) * f).toFixed(2); }); return r; };
const ptForm = (o: { m2?: boolean; m3?: boolean; tea2?: number; tea3?: number } = {}) => ({
  instrument1: { name: "Made-up CA-660", reagentLot: "LOT-NEW", reagentExp: "2027-06-30", isi: 0.97, ptRILow: 10, ptRIHigh: 14, inrRILow: 0.9, inrRIHigh: 1.2, ptValues: [...NORMALS] as (number | null)[] },
  addlInstruments: [], instrument2Name: "Made-up CA-660 Backup",
  module2Rows: o.m2 ? pairs(rows(), 0.98) : rows(), module2TEa: o.tea2 ?? 0.2,
  skipModule3: false, module3Rows: o.m3 ? pairs(rows(), 1.03) : rows(), module3TEa: o.tea3 ?? 0.2, oldLotNum: "LOT-OLD",
});
const ptStudy = (name: string, f: ReturnType<typeof ptForm>, preset: string | null) => {
  const { study, results } = saved({ name, type: "pt_coag", tea: f.module2TEa, points: buildPtCoagPayload(f).dataPoints, instruments: [f.instrument1.name, f.instrument2Name], preset });
  const html = buildPTCoagHTML(study, results);
  return { html, page: supportingOf(html), results };
};
const PT_TYPE = "Study Type PT/INR Geometric Mean Calculator (CLSI H47)";

// 1. Module 1 only, picker left on ALT/SGPT.
{
  const { html, page, results } = ptStudy("PT", ptForm(), ALT);
  check("1a. the study is the SCAHC shape: Module 1 only, PASS", results.overallPass === true && !results.module2 && !results.module3);
  check("1b. the supporting page names the PT/INR study", page.includes(PT_TYPE), page.slice(0, 300));
  check("1c. ... and not method comparison", !page.includes("Method Comparison") && !page.includes("EP09"), page.slice(0, 300));
  check('1d. ... and carries no "ALT" (nor does any page)', page.length > 0 && !page.includes("ALT") && !text(html).includes("ALT/SGPT"), page.slice(0, 400));
  check("1e. the criterion row says no comparison module ran, so no TEa was used", page.includes("None: no comparison module was performed (Module 1 verifies the reference intervals)"), page.slice(0, 400));
  check("1f. no Allowable Systematic Error row (PT/INR has none)", !page.includes("Allowable Systematic Error"));
  check("1g. the rest of the page is still there (test name, CFR source, supporting data)", page.includes("Test Name PT") && page.includes("§493.941") && page.includes("Analyst Made-up Analyst"), page.slice(0, 500));
}

// 2. The TEa each comparison module used.
{
  const m3 = ptStudy("PT", ptForm({ m3: true, tea3: 0.15 }), ALT);
  check("2a. Module 3 alone at 15%: the study ran Module 3 at 15%", m3.results.module3?.tea === 0.15 && !m3.results.module2);
  check("2b. ... the criterion row reads Module 3's 15%, not Module 2's unused 20%", m3.page.includes("Module 3: ±15.0%") && !m3.page.includes("Module 2:") && !m3.page.includes("20.0%"), m3.page.slice(0, 400));
  check("2c. ... names the PT/INR study, no ALT", m3.page.includes(PT_TYPE) && !m3.page.includes("ALT"));
  const both = ptStudy("PT", ptForm({ m2: true, m3: true, tea2: 0.2, tea3: 0.15 }), ALT);
  check("2d. Module 2 at 20% and Module 3 at 15%: each module's own TEa", both.page.includes("Module 2: ±20.0%; Module 3: ±15.0%"), both.page.slice(0, 400));
  check("2e. ... names the PT/INR study, no ALT", both.page.includes(PT_TYPE) && !both.page.includes("ALT"));
}

// 3. A legacy row with no preset label, and a row whose picker held the PT preset.
{
  const legacy = ptStudy("PT", ptForm(), null);
  check("3a. no preset label saved: the same type and criterion", legacy.page.includes(PT_TYPE) && legacy.page.includes("None: no comparison module was performed"));
  const ptPreset = ptStudy("PT", ptForm({ m3: true, tea3: 0.2 }), "Prothrombin Time / PT (±15%)");
  check("3b. picker on the PT preset (±15%), Module 3 run at 20%: the row reads the 20% used, not the picker's label",
    ptPreset.page.includes("Module 3: ±20.0%") && !ptPreset.page.includes("Prothrombin Time / PT (±15%)"), ptPreset.page.slice(0, 400));
}

// 4. The same line on QC Lot Verification and Multi-Analyte Lot Comparison.
{
  const QK = (a: string, l: string, z: string) => `${a}|${l}|${z}`;
  const qcForm = {
    analytes: ["Made-up Glucose"], analyzers: ["Made-up Analyzer A"], levels: ["Normal"], dateStart: "2026-10-01", dateEnd: "2026-10-20",
    runData: { [QK("Made-up Glucose", "Normal", "Made-up Analyzer A")]: [100, 101, 99, 102, 100, 98, 101, 100, 99, 101, 100, 99] },
    oldLotData: {}, priorLotRuns: {}, vendorValues: {}, showPriorLot: false, showVendor: false, numRuns: 12, importSource: null,
  };
  const qc = saved({ name: "Made-up Glucose QC", type: "qc_range", tea: 0.10, points: buildQcRangePayload(qcForm as any).dataPoints, instruments: ["Made-up Analyzer A"], preset: ALT });
  const qcPage = supportingOf(buildQCRangeHTML(qc.study, qc.results));
  check("4a. QC Lot Verification: names its own study type", qcPage.includes("Study Type QC Lot Verification (CLSI C24-Ed4)") && !qcPage.includes("Method Comparison"), qcPage.slice(0, 300));
  check("4b. ... no ALT", qcPage.length > 0 && !qcPage.includes("ALT"), qcPage.slice(0, 300));
  const maRows = Array.from({ length: 6 }, (_, i) => ({ id: `S${String(i + 1).padStart(3, "0")}`, ptNew: String(12 + i * 0.3), ptOld: String(12.1 + i * 0.3), apttNew: "", apttOld: "", fibNew: "", fibOld: "" }));
  const maForm = { instrument: "Made-up Coag Analyzer", newLotPT: "N1", oldLotPT: "O1", newLotAPTT: "", oldLotAPTT: "", newLotFib: "", oldLotFib: "", isi: 1.02, normalMeanPT: 12.3, sampleType: "normal", teaPT: 0.2, teaAPTT: 0.15, teaFib: 0.2, specimens: maRows };
  const ma = saved({ name: "Made-up Coag Lot", type: "multi_analyte_coag", tea: 0.2, points: buildMultiAnalyteCoagPayload(maForm as any).dataPoints, instruments: ["Made-up Coag Analyzer"], preset: ALT });
  const maPage = supportingOf(buildMultiAnalyteCoagHTML(ma.study, ma.results));
  check("4c. Multi-Analyte Lot Comparison: names its own study type", maPage.includes("Study Type Multi-Analyte Lot Comparison (Coag)") && !maPage.includes("Method Comparison"), maPage.slice(0, 300));
  check("4d. ... no ALT", maPage.length > 0 && !maPage.includes("ALT"), maPage.slice(0, 300));
}

// 5. Unchanged on purpose.
{
  const glucose = "Glucose (±8% or ±6 mg/dL)";
  const pts = [50, 100, 150, 200, 250].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Made-up Analyzer": v * (i % 2 ? 1.02 : 0.99) } }));
  const cv = saved({ name: "Glucose", type: "cal_ver", tea: 0.08, floor: 6, floorUnit: "mg/dL", points: pts, instruments: ["Made-up Analyzer"], preset: glucose });
  const cvPage = supportingOf(buildCalVerHTML(cv.study, cv.results));
  check("5a. calibration verification still prints the preset it picked, and its systematic error row",
    cvPage.includes("Study Type Calibration Verification (CLSI EP06)") && cvPage.includes(`(${glucose})`) && cvPage.includes("Allowable Systematic Error"), cvPage.slice(0, 400));
  const mcPts = [120, 130, 140, 150, 160].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { Comparison: v + 1 } }));
  const mc = saved({ name: "Sodium", type: "method_comparison", tea: 0.05, points: mcPts, instruments: ["Primary", "Comparison"], preset: "Lab-defined" });
  const mcPage = supportingOf(buildMethodCompHTML(mc.study, mc.results));
  check("5b. method comparison keeps its label and its preset", mcPage.includes("Study Type Method Comparison: Multi-Instrument Correlation (CLSI EP09 + EP15-A3)") && mcPage.includes("(Lab-defined)"), mcPage.slice(0, 400));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
