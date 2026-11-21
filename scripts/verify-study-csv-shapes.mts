// scripts/verify-study-csv-shapes.mts
//
// Export CSV on a VeritaCheck results page (client/src/lib/studyCsvAdapter.ts), 2026-11-21. Sentry 7859390250
// (San Carlos, 11/20): "TypeError: n.map is not a function" in csvExport. The adapter cast every study type's saved
// data to an array, but lot-to-lot, QC lot verification, multi-analyte coag, reference range, PT/INR, manual
// differential, heparin range and a qualitative or semi-quantitative method comparison save an OBJECT, so Export CSV
// threw on all of them; precision read fields it doesn't save and sensitivity read keys it doesn't save, so both gave
// header-only files. Pins:
//   1. every type, built with the form's own builder where there is one (studyFormPayload.ts, ptCoagPayload.ts), gives
//      a CSV holding the values entered, under the right headers;
//   2. a censored result prints "<5" or ">500", never "[object Object]";
//   3. a shape no branch expects (null, {}, [], a string, wrong field types) gives "" (the page's "No source data
//      found") and never throws, for every type;
//   4. toCsv given something that isn't a row list gives the header alone.
// Run: npx tsx scripts/verify-study-csv-shapes.mts
// Before the fix: CSV_ADAPTER=../client/src/lib/<copy of main's adapter> npx tsx scripts/verify-study-csv-shapes.mts
import {
  buildPrecisionPayload, buildLotToLotPayload, buildQcRangePayload, buildMultiAnalyteCoagPayload,
  buildRefIntervalPayload, buildSensitivityInput, buildCarryoverPayload, buildLevelsPayload,
} from "../client/src/lib/studyFormPayload";
import { buildPtCoagPayload } from "../client/src/lib/ptCoagPayload";
import { toCsv } from "../client/src/lib/csvExport";

const adapterPath = process.env.CSV_ADAPTER ?? "../client/src/lib/studyCsvAdapter";
const { studyToCsv } = (await import(adapterPath)) as { studyToCsv: (s: any) => string };

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
  if (!ok) failures++;
};
const study = (studyType: string, dataPoints: unknown, instruments: string[] = []) => ({
  id: 1, studyType, testName: "Test", date: "2026-11-21", instruments: JSON.stringify(instruments), dataPoints: JSON.stringify(dataPoints),
});
const run = (s: any): { csv: string; error: string } => {
  try { return { csv: studyToCsv(s), error: "" }; } catch (e: any) { return { csv: "", error: String(e?.message || e) }; }
};
const has = (csv: string, ...parts: string[]) => parts.every((p) => csv.includes(p));
const censored = (dir: "below" | "above", v: number) => ({ censored: true, censor_direction: dir, censor_value: v });

// ── 1. Each type with its saved shape ────────────────────────────────────────────────────────────────────────────
const cases: Array<{ name: string; s: any; expect: string[] }> = [];

cases.push({
  name: "cal_ver (array of levels, censored reading)",
  s: study("cal_ver", [
    { level: 1, expectedValue: 50, instrumentValues: { "Analyzer A": 51.2, "Analyzer B": censored("below", 5) } },
    { level: 2, expectedValue: 200, instrumentValues: { "Analyzer A": 198, "Analyzer B": 203 }, customLabel: "High" },
  ], ["Analyzer A", "Analyzer B"]),
  expect: ["Level / Sample", "Analyzer A", "Analyzer B", "51.2", "<5", "High"],
});
cases.push({
  name: "method_comparison quantitative",
  s: study("method_comparison", [{ level: 1, expectedValue: null, instrumentValues: { Ref: 10.1, New: 10.4 } }], ["Ref", "New"]),
  expect: ["Ref", "New", "10.1", "10.4"],
});
cases.push({
  name: "method_comparison qualitative (object with points)",
  s: study("method_comparison", { assayType: "qualitative", categories: ["Pos", "Neg"], passThreshold: 0.9,
    points: [{ level: 1, expectedCategory: "Pos", instrumentCategories: { New: "Pos" } }, { level: 2, expectedCategory: "Neg", instrumentCategories: { New: "Pos" } }] },
    ["Ref", "New"]),
  expect: ["Reference Result (Ref)", "New", "Pos", "Neg"],
});
cases.push({
  name: "method_comparison semi-quantitative",
  s: study("method_comparison", { assayType: "semi_quantitative", gradeScale: ["Neg", "1+", "2+"], passThreshold: 0.8,
    points: [{ level: 1, expectedCategory: "1+", instrumentCategories: { New: "2+" } }] }, ["Ref", "New"]),
  expect: ["Reference Grade (Ref)", "1+", "2+"],
});
cases.push({
  name: "precision simple",
  s: study("precision", buildPrecisionPayload({ mode: "simple", levels: 2, levelNames: ["Low", "High"], values: [[4.1, 4.2, null, 4.3], [9.9, censored("above", 10)]],
    reps: 5, days: 5, runsPerDay: 2, replicatesPerRun: 2, advancedData: [], vendorSd: "", vendorSdConc: "", targetMean: "", targetCv: "",
    controlLot: "", reagentLot: "", comment: "", resultUnits: "", importSource: null } as any).dataPoints),
  expect: ["Level,Day,Replicate,Value", "Low", "4.3", "High", ">10"],
});
cases.push({
  name: "precision advanced (days x replicates)",
  s: study("precision", buildPrecisionPayload({ mode: "advanced", levels: 1, levelNames: ["Level 1"], values: [], reps: 0, days: 2, runsPerDay: 1, replicatesPerRun: 2,
    advancedData: [[[5.1, 5.2], [5.3, 5.4]]], vendorSd: "", vendorSdConc: "", targetMean: "", targetCv: "", controlLot: "", reagentLot: "", comment: "",
    resultUnits: "", importSource: null } as any).dataPoints),
  expect: ["Level 1,1,1,5.1", "Level 1,2,2,5.4"],
});
cases.push({
  name: "lot_to_lot (object with data)",
  s: study("lot_to_lot", buildLotToLotPayload({ sampleType: "both", currentLotNum: "L100", currentLotExp: "2027-01-01", newLotNum: "L200", newLotExp: "2027-06-01",
    analyte: "Glucose", units: "mg/dL", numSpecimens: 2, data: [{ specimenId: "S001", currentLot: 90, newLot: 92, cohort: "Normal" }],
    dataAbnormal: [{ specimenId: "S002", currentLot: 300, newLot: 310, cohort: "Abnormal" }] }).dataPoints),
  expect: ["Specimen ID,Cohort", "Current Lot L100 (mg/dL)", "New Lot L200 (mg/dL)", "S001,Normal,90,92", "S002,Abnormal,300,310"],
});
cases.push({
  name: "qc_range (object with dataPoints, prior lot runs)",
  s: study("qc_range", buildQcRangePayload({ analytes: ["Na"], analyzers: ["A1"], levels: ["L1"], dateStart: "2026-11-01", dateEnd: "2026-11-20",
    runData: { "Na|L1|A1": [140, 141] }, oldLotData: {}, priorLotRuns: { "Na|L1|A1": [139] }, vendorValues: {}, showPriorLot: true, showVendor: false,
    numRuns: 2, importSource: null }).dataPoints),
  expect: ["Analyte,Level,Analyzer,Lot,Replicate,Value", "Na,L1,A1,New lot,1,140", "Na,L1,A1,New lot,2,141", "Na,L1,A1,Prior lot,1,139"],
});
cases.push({
  name: "qc_range legacy prior-lot summary",
  s: study("qc_range", { dataPoints: [{ analyte: "K", level: "L2", analyzer: "A1", runs: [4.0], oldMean: 4.1, oldSD: 0.05 }] }),
  expect: ["K,L2,A1,New lot,1,4", "Prior lot mean (entered),,4.1", "Prior lot SD (entered),,0.05"],
});
cases.push({
  name: "multi_analyte_coag (object with specimens)",
  s: study("multi_analyte_coag", buildMultiAnalyteCoagPayload({ instrument: "CA-660", newLotPT: "", oldLotPT: "", newLotAPTT: "", oldLotAPTT: "", newLotFib: "", oldLotFib: "",
    isi: 1.0, normalMeanPT: 12, sampleType: "normal", teaPT: 0.15, teaAPTT: 0.15, teaFib: 0.2,
    specimens: [{ id: "S1", ptNew: "12.1", ptOld: "12.0", apttNew: "30", apttOld: "31", fibNew: "", fibOld: "" }] }).dataPoints),
  expect: ["Specimen ID", "PT New Lot (sec)", "S1,12.1,12,30,31,,"],
});
cases.push({
  name: "ref_interval (object with specimens, censored)",
  s: study("ref_interval", buildRefIntervalPayload({ analyte: "TSH", units: "mIU/L", low: 0.4, high: 4.0, numSpecimens: 2,
    data: [{ specimenId: "R1", value: 1.2 }, { specimenId: "R2", value: censored("below", 0.01) }] }).dataPoints),
  expect: ["# Reference interval verified: 0.4 to 4 mIU/L", "Specimen ID,Value (mIU/L)", "R1,1.2", "R2,<0.01"],
});
cases.push({
  name: "ref_interval legacy array",
  s: study("ref_interval", [{ specimenId: "R1", value: 2.2 }]),
  expect: ["Specimen ID,Value", "R1,2.2"],
});
cases.push({
  name: "carryover",
  s: study("carryover", buildCarryoverPayload({ units: "mg/dL", data: [{ sequence: 1, sample_type: "L", value: 5 }, { sequence: 2, sample_type: "H", value: 500 }] }).dataPoints),
  expect: ["Sequence,Material,Value (mg/dL)", "1,Low,5", "2,High,500"],
});
cases.push({
  name: "sensitivity (wrapper { input, results })",
  s: study("sensitivity", { input: buildSensitivityInput({ mode: "establishment", analyteName: "", units: "ng/mL", blanksText: "0.01,LotA\n0.02",
    lowLevelText: "0.10\n0.12", loqLevels: [{ expectedConcentration: "0.5", repsText: "0.49\n0.52" }], cvThreshold: 20, biasThreshold: 25,
    mfgLob: "", mfgLod: "", mfgLoq: "" }), results: { overallPass: true } }),
  expect: ["Blank Replicates", "LotA,,,0.01", "Low-Level Replicates (LoD)", ",,,0.12", "LoQ Levels", "0.5,,,,0.52"],
});
cases.push({
  name: "accuracy_bias",
  s: study("accuracy_bias", buildLevelsPayload("accuracy_bias", { analyte: "ALT", units: "U/L", levels: [{ name: "L1", assignedValue: 100 }],
    replicatesPerLevel: 2, runData: { L1: [99, 101] }, claimedLow: "", claimedHigh: "", importSource: null }).dataPoints),
  expect: ["Level,Assigned (U/L),Replicate #,Value (U/L)", "L1,100,1,99", "L1,100,2,101"],
});
cases.push({
  name: "reportable_range with claimed range",
  s: study("reportable_range", { units: "mg/dL", claimed_range_low: 10, claimed_range_high: 500, levels: [{ name: "Low", assigned_value: 10, replicates: [10.2] }] }),
  expect: ["# Claimed Reportable Range: 10 to 500 mg/dL", "Low,10,1,10.2"],
});
cases.push({
  name: "pt_coag (module1Instruments, module2, module3)",
  s: study("pt_coag", buildPtCoagPayload({
    instrument1: { name: "CA-660 A", reagentLot: "N123", reagentExp: "2027-03-01", isi: 1.02, ptRILow: 9.8, ptRIHigh: 12.4, inrRILow: 0.9, inrRIHigh: 1.1, ptValues: [11.1, 10.9, null] },
    addlInstruments: [], instrument2Name: "CA-660 B",
    module2Rows: [{ id: "P1", x: 11, y: 11.2 }, { id: "P2", x: 20, y: 20.5 }, { id: "P3", x: 30, y: 29.4 }], module2TEa: 0.2,
    skipModule3: false, module3Rows: [{ id: "Q1", x: 12, y: 12.3 }, { id: "Q2", x: 22, y: 22.1 }, { id: "Q3", x: 35, y: 34 }], module3TEa: 0.2,
    oldLotNum: "O999", oldLotExp: "2026-12-01",
  }).dataPoints),
  expect: ["Module 1: Normal Patient PT (sec)", "CA-660 A,1,11.1", "CA-660 A,2,10.9", "X (CA-660 A),Y (CA-660 B)", "P3,30,29.4",
    "X (Old Lot O999),Y (New Lot N123)", "Q1,12,12.3"],
});
cases.push({
  name: "manual_diff",
  s: study("manual_diff", { cellsCounted: 100, referenceSource: "XN-1000", classes: [{ name: "Neutrophils", manualCount: 60, referencePct: 58.2 }] }),
  expect: ["# Cells counted: 100; Reference: XN-1000", "Cell Class,Manual Count,Reference %", "Neutrophils,60,58.2"],
});
cases.push({
  name: "heparin_range",
  s: study("heparin_range", { reagentLot: "H1", antiXaMethod: "STA", targetLow: 0.3, targetHigh: 0.7,
    samples: [{ id: "1", patientCode: "A01", antiXa: 0.45, aptt: 72, inr: 1.1, plasma: "fresh", exclude: true, excludeReason: "Clotted" }] }),
  expect: ["Anti-Xa (IU/mL)", "1,A01,0.45,72,1.1,fresh,Yes,Clotted"],
});

for (const c of cases) {
  const { csv, error } = run(c.s);
  const missing = c.expect.filter((p) => !csv.includes(p));
  check(`1. ${c.name}`, !error && csv.length > 0 && missing.length === 0, error ? `threw: ${error}` : `missing ${JSON.stringify(missing)} in ${JSON.stringify(csv.slice(0, 300))}`);
}

// ── 2. No "[object Object]" anywhere ─────────────────────────────────────────────────────────────────────────────
const objectLeaks = cases.filter((c) => run(c.s).csv.includes("[object Object]")).map((c) => c.name);
check("2. no exported cell reads [object Object]", objectLeaks.length === 0, objectLeaks.join("; "));

// ── 3. Shapes no branch expects never throw ──────────────────────────────────────────────────────────────────────
const TYPES = ["cal_ver", "cal_ver_correlation", "method_comparison", "correlation", "precision", "lot_to_lot", "qc_range", "multi_analyte_coag",
  "ref_interval", "carryover", "sensitivity", "accuracy_bias", "linearity", "reportable_range", "pt_coag", "manual_diff", "heparin_range",
  "qualitative", "semi_quantitative", "something_new"];
const ODD: unknown[] = [null, {}, [], "text", 42, { data: "nope" }, { specimens: 5 }, { dataPoints: {} }, { input: [] }, { levels: {} },
  { module1Instruments: {}, module2: { data: 3 } }, { classes: "x" }, { samples: null }, [1, 2, 3], [null], { assayType: "qualitative", points: "x" }];
const threw: string[] = [];
const nonEmptyOnJunk: string[] = [];
for (const t of TYPES) {
  for (const o of ODD) {
    const { csv, error } = run(study(t, o, ["A"]));
    if (error) threw.push(`${t} ${JSON.stringify(o)}: ${error}`);
    else if (csv && /\d/.test(csv.split("\n").slice(1).join(""))) nonEmptyOnJunk.push(`${t} ${JSON.stringify(o)}`);
  }
}
check(`3a. ${TYPES.length} types x ${ODD.length} odd shapes: none throws`, threw.length === 0, threw.slice(0, 6).join(" | "));
check("3b. an odd shape never exports data rows with numbers it didn't hold", nonEmptyOnJunk.length === 0, nonEmptyOnJunk.slice(0, 6).join(" | "));
const unparsable = run({ ...study("cal_ver", []), dataPoints: "{not json" });
check("3c. unparsable saved data gives \"\" (page says No source data found)", !unparsable.error && unparsable.csv === "");

// ── 4. toCsv with something that isn't a row list ────────────────────────────────────────────────────────────────
let toCsvOut = "";
let toCsvErr = "";
try { toCsvOut = toCsv({ not: "rows" } as any, [{ key: "a", header: "A" }]); } catch (e: any) { toCsvErr = String(e?.message || e); }
check("4. toCsv given an object gives the header alone", !toCsvErr && toCsvOut === "A", toCsvErr || toCsvOut);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
