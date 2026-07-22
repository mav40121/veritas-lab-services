// Demo sample-report fixtures (Pfizer demo follow-up 2026-05-19).
// Realistic, hand-tuned demo data for five VeritaCheck study types so that
// a prospective evaluator on /demo can download a generated PDF and see
// the actual report format without having to log in and enter data. Each
// fixture is constructed to (a) exercise the new features shipped this
// session (e.g. QC Lot Verification's three opt-in sections) and (b)
// produce a clean PASS so the demo viewer sees the platform's positive
// output.
//
// Demo lab identity is Riverside Regional Medical Center, CLIA 22D0999999
// (the only lab identity allowed to be hardcoded per CLAUDE.md §7).

import {
  calculateQCRange,
  calculateLotToLot,
  calculatePTCoag,
  calculatePrecision,
  calculateSensitivity,
  type QCRangeDataPoint,
  type LotToLotDataPoint,
  type PrecisionDataPoint,
  type SensitivityInput,
} from "@/lib/calculations";

const DEMO_LAB_NAME = "Riverside Regional Medical Center";
const DEMO_CLIA = "22D0999999";

// ─── Sample 1: QC Lot Verification (Glucose, two levels, three sections) ────

function buildQCLotSample() {
  const analytes = ["Glucose"];
  const analyzers = ["Roche Cobas 8000"];
  const levels = ["Normal", "High"];
  const dateRange = { start: "2026-04-15", end: "2026-04-26" };

  // Realistic 20-point grids per level (2 measurements per day for 10 days,
  // CLSI C24-Ed4 accelerated path). Tight CV around the target mean. Prior
  // lot values are intentionally close to new-lot values so the pooled-SD
  // bias check returns Accept (|SDI| < 1 pooled SD), which is the typical
  // clean lot-changeover outcome a director would expect to see.
  const newNormal   = [94.9, 95.2, 95.0, 95.1, 94.8, 95.3, 95.0, 95.1, 94.9, 95.2, 95.0, 94.9, 95.1, 95.0, 94.8, 95.2, 95.0, 94.9, 95.1, 95.0];
  const priorNormal = [94.8, 95.1, 95.0, 95.0, 94.9, 95.2, 95.0, 95.0, 94.9, 95.1, 95.0, 94.9, 95.0, 94.9, 94.8, 95.1, 94.9, 95.0, 95.0, 94.9];
  const newHigh     = [248.7, 249.2, 248.9, 249.1, 248.8, 249.3, 249.0, 248.9, 249.1, 248.7, 249.2, 248.8, 249.0, 248.9, 249.1, 249.0, 248.8, 249.2, 248.9, 249.0];
  const priorHigh   = [248.5, 249.0, 248.7, 248.9, 248.8, 249.1, 248.9, 248.8, 248.9, 248.6, 249.0, 248.7, 248.8, 248.9, 249.0, 248.8, 248.7, 249.1, 248.8, 248.9];

  const dpKey = (analyte: string, level: string, analyzer: string) =>
    `${analyte}|${level}|${analyzer}`;

  const dataPoints: QCRangeDataPoint[] = [
    {
      analyte: "Glucose", level: "Normal", analyzer: "Roche Cobas 8000",
      runs: newNormal,
      priorLotRuns: priorNormal,
      vendorMean: 94.5, vendorSD: 1.2,
    },
    {
      analyte: "Glucose", level: "High", analyzer: "Roche Cobas 8000",
      runs: newHigh,
      priorLotRuns: priorHigh,
      vendorMean: 248.0, vendorSD: 3.0,
    },
  ];

  const qcRunData: Record<string, number[]> = {
    [dpKey("Glucose", "Normal", "Roche Cobas 8000")]: newNormal,
    [dpKey("Glucose", "High", "Roche Cobas 8000")]: newHigh,
  };
  const priorLotRuns: Record<string, number[]> = {
    [dpKey("Glucose", "Normal", "Roche Cobas 8000")]: priorNormal,
    [dpKey("Glucose", "High", "Roche Cobas 8000")]: priorHigh,
  };
  const vendorValues: Record<string, { mean: number; sd: number }> = {
    "Glucose|Normal": { mean: 94.5, sd: 1.2 },
    "Glucose|High": { mean: 248.0, sd: 3.0 },
  };

  const results = calculateQCRange(dataPoints, dateRange);

  const study = {
    id: -1, userId: -1, createdByUserId: -1,
    testName: "Glucose QC Lot Verification (Cobas 8000)",
    instrument: analyzers.join(", "),
    analyst: "S. Patel, MLS(ASCP)",
    date: "2026-04-26",
    studyType: "qc_range",
    cliaAllowableError: 0.10,
    teaIsPercentage: 1,
    teaUnit: "%",
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    dataPoints: JSON.stringify({
      dataPoints, analytes, analyzers, levels, dateRange,
      oldLotData: {},
      priorLotRuns,
      vendorValues,
      showPriorLot: true, showVendor: true,
    }),
    instruments: JSON.stringify(analyzers),
    status: results.overallPass ? "pass" : "fail",
    createdAt: "2026-04-26T16:00:00.000Z",
    _labName: DEMO_LAB_NAME,
    _cliaNumber: DEMO_CLIA,
  };

  return { study, results };
}

// ─── Sample 2: Reagent Lot Verification (Albumin, EP26 two-cohort) ────────

function buildReagentLotSample() {
  // 20 paired specimens, Normal and Abnormal cohorts. New lot tracks current
  // within ~2% bias to show a clean PASS under the two-part TEa rule
  // (mean abs %diff within TEa AND >=90% specimens within TEa).
  const normalSpecimens = [
    { specimenId: "N001", currentLot: 4.2, newLot: 4.25, cohort: "Normal" as const },
    { specimenId: "N002", currentLot: 4.5, newLot: 4.48, cohort: "Normal" as const },
    { specimenId: "N003", currentLot: 4.7, newLot: 4.72, cohort: "Normal" as const },
    { specimenId: "N004", currentLot: 4.1, newLot: 4.18, cohort: "Normal" as const },
    { specimenId: "N005", currentLot: 4.6, newLot: 4.58, cohort: "Normal" as const },
    { specimenId: "N006", currentLot: 4.3, newLot: 4.36, cohort: "Normal" as const },
    { specimenId: "N007", currentLot: 4.9, newLot: 4.88, cohort: "Normal" as const },
    { specimenId: "N008", currentLot: 4.4, newLot: 4.42, cohort: "Normal" as const },
    { specimenId: "N009", currentLot: 4.8, newLot: 4.82, cohort: "Normal" as const },
    { specimenId: "N010", currentLot: 4.0, newLot: 4.05, cohort: "Normal" as const },
  ];
  const abnormalSpecimens = [
    { specimenId: "A001", currentLot: 2.8, newLot: 2.84, cohort: "Abnormal" as const },
    { specimenId: "A002", currentLot: 3.1, newLot: 3.13, cohort: "Abnormal" as const },
    { specimenId: "A003", currentLot: 2.5, newLot: 2.52, cohort: "Abnormal" as const },
    { specimenId: "A004", currentLot: 3.3, newLot: 3.31, cohort: "Abnormal" as const },
    { specimenId: "A005", currentLot: 2.9, newLot: 2.93, cohort: "Abnormal" as const },
    { specimenId: "A006", currentLot: 3.0, newLot: 3.04, cohort: "Abnormal" as const },
    { specimenId: "A007", currentLot: 2.7, newLot: 2.73, cohort: "Abnormal" as const },
    { specimenId: "A008", currentLot: 3.2, newLot: 3.22, cohort: "Abnormal" as const },
    { specimenId: "A009", currentLot: 2.6, newLot: 2.65, cohort: "Abnormal" as const },
    { specimenId: "A010", currentLot: 3.4, newLot: 3.42, cohort: "Abnormal" as const },
  ];
  const allSpecimens: LotToLotDataPoint[] = [...normalSpecimens, ...abnormalSpecimens];
  const tea = 0.10; // 10% TEa for Albumin (CLIA)

  const results = calculateLotToLot(allSpecimens, tea, "both");

  const study = {
    id: -2, userId: -1, createdByUserId: -1,
    testName: "Albumin Reagent Lot Verification (EP26)",
    instrument: "Beckman AU5800",
    analyst: "K. Nguyen, MLS(ASCP)",
    date: "2026-04-22",
    studyType: "lot_to_lot",
    cliaAllowableError: tea,
    teaIsPercentage: 1,
    teaUnit: "%",
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    dataPoints: JSON.stringify({
      analyte: "Albumin", units: "g/dL",
      currentLotNum: "LOT-2026-A", currentLotExp: "2026-09-30",
      newLotNum: "LOT-2026-B", newLotExp: "2027-03-31",
      sampleType: "both", numSpecimens: 20,
      data: normalSpecimens, dataAbnormal: abnormalSpecimens,
    }),
    instruments: JSON.stringify(["Beckman AU5800"]),
    status: results.overallPass ? "pass" : "fail",
    createdAt: "2026-04-22T14:30:00.000Z",
    _labName: DEMO_LAB_NAME,
    _cliaNumber: DEMO_CLIA,
  };

  return { study, results };
}

// ─── Sample 3: PT/INR Geometric Mean Calculator (CLSI H47) ──────────────────

function buildPTINRSample() {
  // 25 healthy normal patients with PT in the 11-13 sec range. Geometric
  // mean should land around 12.0 sec; INR equation INR = (PT/MNPT)^ISI.
  const normalPTs = [
    11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5,
    12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8,
    12.0, 11.9, 12.1, 11.8, 12.2,
  ];
  const isi = 1.02;
  const ptRI = { low: 11.0, high: 13.5 };
  const inrRI = { low: 0.9, high: 1.1 };

  // Module 2: current vs new lot PT comparison on 30 patient samples (mix of
  // therapeutic and non-therapeutic INRs).
  const m2x = [12.5, 14.2, 16.8, 18.5, 21.4, 13.8, 15.6, 19.2, 22.7, 24.1, 12.9, 14.8, 17.3, 19.8, 23.2, 13.5, 15.2, 18.1, 21.6, 24.5, 14.0, 16.4, 19.5, 22.3, 25.1, 13.1, 15.8, 18.7, 21.9, 24.8];
  const m2y = [12.3, 14.0, 16.6, 18.3, 21.1, 13.6, 15.4, 19.0, 22.4, 23.8, 12.7, 14.6, 17.1, 19.5, 22.9, 13.3, 15.0, 17.9, 21.3, 24.2, 13.8, 16.1, 19.2, 22.0, 24.8, 12.9, 15.5, 18.4, 21.6, 24.5];
  const m2Ids = Array.from({ length: 30 }, (_, i) => `P${String(i + 1).padStart(3, "0")}`);

  const results = calculatePTCoag(
    [{ name: "Stago STA-R Max3", ptValues: normalPTs, isi, ptRI, inrRI }],
    { xValues: m2x, yValues: m2y, specimenIds: m2Ids, tea: 0.20 },
    null,
  );

  const study = {
    id: -3, userId: -1, createdByUserId: -1,
    testName: "PT/INR Geometric Mean Calculator (Stago STA-R Max3)",
    instrument: "Stago STA-R Max3",
    analyst: "M. Veri, MLS(ASCP)",
    date: "2026-04-18",
    studyType: "pt_coag",
    cliaAllowableError: 0.20,
    teaIsPercentage: 1,
    teaUnit: "%",
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    dataPoints: JSON.stringify({
      module1: { ptValues: normalPTs, isi, ptRI, inrRI },
      module2: {
        data: m2Ids.map((id, i) => ({ id, x: m2x[i], y: m2y[i] })),
        tea: 0.20,
        inst1: "Stago STA-R Max3 (Prior PT Lot)",
        inst2: "Stago STA-R Max3 (New PT Lot)",
      },
      module3: null,
      instrument: "Stago STA-R Max3",
      reagentLot: "STA-NEO-PT-2026-04",
      reagentExp: "2027-04-30",
    }),
    instruments: JSON.stringify(["Stago STA-R Max3 (Prior PT Lot)", "Stago STA-R Max3 (New PT Lot)"]),
    status: results.overallPass ? "pass" : "fail",
    createdAt: "2026-04-18T11:00:00.000Z",
    _labName: DEMO_LAB_NAME,
    _cliaNumber: DEMO_CLIA,
  };

  return { study, results };
}

// ─── Sample 4: Simple Precision Verification (Sodium, EP15-A3) ──────────────

function buildSimplePrecisionSample() {
  // Creatinine, 15% TEa per §493.931. Single level (Normal QC ~1.0 mg/dL),
  // 20 replicates. CV well under the 15% adopted criterion. Demonstrates
  // the EP15-A3 simple aggregate path.
  //
  // Why Creatinine and not Sodium: calculatePrecision treats its TEa input
  // as a fraction (0.15 = 15%) and computes allowableCV = TEa × 100, so an
  // absolute-only analyte like Sodium (±4 mmol/L) would render an allowable
  // CV of 400 percent on the PDF, which is meaningless. Picking a
  // percentage-TEa analyte avoids that pre-existing rendering quirk for
  // the demo without changing any calculation logic.
  const creatValues = [
    1.02, 1.04, 1.01, 1.03, 1.05, 1.02, 1.04, 1.03, 1.02, 1.04,
    1.03, 1.02, 1.04, 1.03, 1.02, 1.05, 1.03, 1.02, 1.04, 1.03,
  ];
  const dataPoints: PrecisionDataPoint[] = [
    { level: 1, levelName: "Normal QC", values: creatValues } as PrecisionDataPoint,
  ];
  const tea = 0.15; // 15% TEa per §493.931 for Creatinine

  const results = calculatePrecision(dataPoints, tea, "simple");

  const study = {
    id: -4, userId: -1, createdByUserId: -1,
    testName: "Creatinine Simple Precision Verification",
    instrument: "Roche Cobas 8000",
    analyst: "J. Hall, MLS(ASCP)",
    date: "2026-04-12",
    studyType: "precision",
    cliaAllowableError: tea,
    teaIsPercentage: 1,
    teaUnit: "%",
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    dataPoints: JSON.stringify(dataPoints),
    instruments: JSON.stringify(["Roche Cobas 8000"]),
    status: results.overallPass ? "pass" : "fail",
    createdAt: "2026-04-12T09:15:00.000Z",
    _labName: DEMO_LAB_NAME,
    _cliaNumber: DEMO_CLIA,
  };

  return { study, results };
}

// ─── Sample 5: Sensitivity Verification (Troponin I, EP17-A2) ────────────────

function buildSensitivitySample() {
  // Verification mode with a manufacturer-claimed LoB / LoD / LoQ. 30 blanks
  // and 30 low-level replicates. Lab values fall under the manufacturer's
  // claims, supporting a PASS in Verification mode.
  // Blanks: target mean ~0.005 ng/mL with realistic noise
  const blanks = [
    { value: 0.004, lot: "A" }, { value: 0.005, lot: "A" }, { value: 0.003, lot: "A" },
    { value: 0.006, lot: "A" }, { value: 0.005, lot: "A" }, { value: 0.004, lot: "A" },
    { value: 0.005, lot: "A" }, { value: 0.006, lot: "A" }, { value: 0.004, lot: "A" },
    { value: 0.005, lot: "A" }, { value: 0.003, lot: "A" }, { value: 0.005, lot: "A" },
    { value: 0.004, lot: "A" }, { value: 0.006, lot: "A" }, { value: 0.005, lot: "A" },
    { value: 0.005, lot: "B" }, { value: 0.006, lot: "B" }, { value: 0.004, lot: "B" },
    { value: 0.005, lot: "B" }, { value: 0.005, lot: "B" }, { value: 0.004, lot: "B" },
    { value: 0.006, lot: "B" }, { value: 0.005, lot: "B" }, { value: 0.005, lot: "B" },
    { value: 0.004, lot: "B" }, { value: 0.005, lot: "B" }, { value: 0.006, lot: "B" },
    { value: 0.005, lot: "B" }, { value: 0.004, lot: "B" }, { value: 0.005, lot: "B" },
  ];
  // Low-level samples at expected ~0.012 ng/mL (just above LoB)
  const lowLevel = [
    { value: 0.012 }, { value: 0.013 }, { value: 0.011 }, { value: 0.014 },
    { value: 0.012 }, { value: 0.013 }, { value: 0.011 }, { value: 0.012 },
    { value: 0.014 }, { value: 0.013 }, { value: 0.012 }, { value: 0.013 },
    { value: 0.011 }, { value: 0.014 }, { value: 0.012 }, { value: 0.013 },
    { value: 0.012 }, { value: 0.011 }, { value: 0.014 }, { value: 0.013 },
    { value: 0.012 }, { value: 0.013 }, { value: 0.011 }, { value: 0.012 },
    { value: 0.014 }, { value: 0.013 }, { value: 0.012 }, { value: 0.011 },
    { value: 0.013 }, { value: 0.012 },
  ];

  const input: SensitivityInput = {
    mode: "verification",
    blanks,
    lowLevel,
    loqLevels: [
      {
        expectedConcentration: 0.020,
        replicates: [
          { value: 0.0198 }, { value: 0.0205 }, { value: 0.0192 }, { value: 0.0208 },
          { value: 0.0201 }, { value: 0.0196 }, { value: 0.0203 }, { value: 0.0199 },
          { value: 0.0207 }, { value: 0.0194 }, { value: 0.0200 }, { value: 0.0202 },
          { value: 0.0197 }, { value: 0.0204 }, { value: 0.0201 }, { value: 0.0199 },
          { value: 0.0203 }, { value: 0.0198 }, { value: 0.0205 }, { value: 0.0200 },
        ],
      },
    ],
    manufacturerClaim: {
      lob: 0.010,
      lod: 0.018,
      loq: 0.030,
    },
    cvThreshold: 0.20,
    biasThreshold: 0.25,
  };

  const results = calculateSensitivity(input);

  const study = {
    id: -5, userId: -1, createdByUserId: -1,
    testName: "Troponin I High-Sensitivity (Sensitivity Verification)",
    instrument: "Ortho VITROS 5600",
    analyst: "D. McCormick, MLS(ASCP)",
    date: "2026-04-08",
    studyType: "sensitivity",
    cliaAllowableError: 0.30,
    teaIsPercentage: 1,
    teaUnit: "%",
    cliaAbsoluteFloor: 0.9,
    cliaAbsoluteUnit: "ng/mL",
    dataPoints: JSON.stringify(input),
    instruments: JSON.stringify(["Ortho VITROS 5600"]),
    status: results.overallPass ? "pass" : "fail",
    createdAt: "2026-04-08T13:45:00.000Z",
    _labName: DEMO_LAB_NAME,
    _cliaNumber: DEMO_CLIA,
  };

  return { study, results };
}

// ─── Export: ordered list of demo samples ───────────────────────────────────

export interface DemoSample {
  key: string;
  label: string;
  blurb: string;
  clsi: string;
  cfr: string;
  filename: string;
  build: () => { study: any; results: any };
}

export const DEMO_SAMPLES: DemoSample[] = [
  {
    key: "qc-lot-verification",
    label: "QC Lot Verification",
    blurb: "Establish the lab's own mean and SD for a new QC lot, with optional crossover bias check vs the prior lot and optional vendor SDI comparison. Demonstrates the three-section report structure.",
    clsi: "CLSI C24-Ed4",
    cfr: "42 CFR §493.1256",
    filename: "VeritaCheck_Sample_QC_Lot_Verification.pdf",
    build: buildQCLotSample,
  },
  {
    key: "reagent-lot-verification",
    label: "Reagent Lot Verification",
    blurb: "Patient-sample comparison between current and new reagent lots. Two-part TEa pass rule: mean absolute percent difference within TEa AND at least 90 percent of paired specimens within TEa.",
    clsi: "CLSI EP26",
    cfr: "42 CFR §493.1253(b)(3), §493.1255",
    filename: "VeritaCheck_Sample_Reagent_Lot_Verification.pdf",
    build: buildReagentLotSample,
  },
  {
    key: "pt-inr-geometric-mean",
    label: "PT/INR Geometric Mean Calculator",
    blurb: "Re-establishes the Mean Normal PT from a healthy normal cohort when the PT reagent lot changes, then verifies the new INR equation against the prior lot on patient samples.",
    clsi: "CLSI H47",
    cfr: "21 CFR 864.7340 (PT reagent labeling)",
    filename: "VeritaCheck_Sample_PT_INR_Geometric_Mean.pdf",
    build: buildPTINRSample,
  },
  {
    key: "simple-precision",
    label: "Simple Precision Verification",
    blurb: "Aggregate within-day precision (CV) per level. Verifies the manufacturer's precision claim for an FDA-cleared, unmodified assay.",
    clsi: "CLSI EP15-A3",
    cfr: "42 CFR §493.1253(b)(1)(ii)",
    filename: "VeritaCheck_Sample_Simple_Precision.pdf",
    build: buildSimplePrecisionSample,
  },
  {
    key: "sensitivity-verification",
    label: "Sensitivity Verification (EP17-A2)",
    blurb: "Verification of the manufacturer's LoB, LoD, and LoQ claims. Includes per-reagent-lot LoB breakdown when lot labels are tagged.",
    clsi: "CLSI EP17-A2",
    cfr: "42 CFR §493.1253(b)(1)",
    filename: "VeritaCheck_Sample_Sensitivity_Verification.pdf",
    build: buildSensitivitySample,
  },
];
