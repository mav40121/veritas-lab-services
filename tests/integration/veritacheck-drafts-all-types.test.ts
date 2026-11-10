// tests/integration/veritacheck-drafts-all-types.test.ts
//
// Receipt for BUG-146 (found 2026-11-09 while fixing BUG-145; SCAHC's tech re-entered a PT/INR study three times
// that day). Save Draft sent the calibration-verification grid for every study type but PT/INR, so a draft kept none
// of its entries, and Edit read back only a few forms. Boots the REAL routes against a throwaway SQLite DB with
// made-up values and, for each study type, does what the page does (client/src/lib/studyFormPayload.ts holds the
// builders Save Draft and Run Study call and the reader Edit calls):
//   D. Save Draft, then Edit: every entry comes back, plus the settings a draft needs to reopen as it was left
//   E. Run Study, then Edit of the finished study: every saved entry comes back
//   V. the finished study's stored verdict is the one the results page computes from the same row (Run Study's
//      saved shape still reads)
//   P. Save Changes (Draft) from Edit (PUT): a changed entry is kept, the rest stay, and precision's vendor SD,
//      target and lots are written (the PUT didn't name those columns)
//
// Run: rm -f .tmp-drafts.db && DB_PATH=.tmp-drafts.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritacheck-drafts-all-types.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a: unknown, b: unknown) => `want ${String(JSON.stringify(a)).slice(0, 220)} got ${String(JSON.stringify(b)).slice(0, 220)}`;

// ── Made-up forms, one per study type ─────────────────────────────────────────
const C = (v: number, dir: "below" | "above" = "below") => ({ censored: true as const, censor_direction: dir, censor_value: v });
const filledOnly = (a: unknown[] | undefined) => (a || []).filter((v: any) => v !== null && v !== undefined && !(typeof v === "number" && Number.isNaN(v)));
const NaNs = (n: number) => Array(n).fill(NaN) as number[];
const withGaps = (vals: (number | null)[], n: number) => { const a = NaNs(n); vals.forEach((v, i) => { if (v !== null) a[i] = v; }); return a; };

const precisionSimple = () => ({
  mode: "simple" as const, levels: 2, levelNames: ["Made-up Low", "Made-up High", "Level 3 (Mid)"],
  values: [[5.1, 5.0, 5.2, null, 5.1, 4.9, C(4.5), 5.0], Array.from({ length: 22 }, (_, i) => +(20 + (i % 5) * 0.1).toFixed(1)), []] as any[][],
  reps: 25, days: 5, runsPerDay: 1, replicatesPerRun: 2, advancedData: [[], [], []] as any[][][],
  vendorSd: "0.12", vendorSdConc: "5.0", targetMean: "5.05", targetCv: "",
  controlLot: "CTL-MU-1", reagentLot: "RGT-MU-2", comment: "Made-up comment", resultUnits: "mg/dL",
  importSource: null,
});
const precisionAdvanced = () => ({
  ...precisionSimple(), mode: "advanced" as const, levels: 1, days: 3, runsPerDay: 1, replicatesPerRun: 2,
  values: [[], [], []] as any[][],
  advancedData: [[[5.0, 5.1], [5.2, 5.0], [4.9, null]], [], []] as any[][][],
  vendorSd: "", vendorSdConc: "", targetMean: "", controlLot: "", reagentLot: "", comment: "", resultUnits: "",
});
const lot = (n: number, cohort: "Normal" | "Abnormal", pairs: Array<[number | null, number | null]>) =>
  Array.from({ length: n }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: pairs[i]?.[0] ?? null, newLot: pairs[i]?.[1] ?? null, cohort }));
const lotToLot = () => ({
  sampleType: "both" as const, currentLotNum: "CUR-MU-1", currentLotExp: "2027-01-31", newLotNum: "NEW-MU-1", newLotExp: "2027-06-30",
  analyte: "Made-up Fibrinogen", units: "mg/dL", numSpecimens: 6,
  data: lot(6, "Normal", [[300, 305], [280, 284], [310, 300], [295, 297], [300, null]]),
  dataAbnormal: lot(6, "Abnormal", [[120, 118], [110, 113], [130, 128], [125, 126]]),
});
const QK = (a: string, l: string, z: string) => `${a}|${l}|${z}`;
const qcRange = () => ({
  analytes: ["Made-up Glucose"], analyzers: ["Made-up Analyzer A", "Made-up Analyzer B"], levels: ["Normal", "Abnormal"],
  dateStart: "2026-10-01", dateEnd: "2026-10-20",
  runData: {
    [QK("Made-up Glucose", "Normal", "Made-up Analyzer A")]: withGaps([100, 101, 99, null, 102, 100, 98, 101, 100, 99, 101, 100], 15),
    [QK("Made-up Glucose", "Normal", "Made-up Analyzer B")]: withGaps([99, 100, 101, 100, 98, 102, 100, 99, 101, 100, 100, 99], 15),
    [QK("Made-up Glucose", "Abnormal", "Made-up Analyzer A")]: withGaps([250, 252, 248, 251, 249, 250, 253, 247, 250, 251, 249, 250], 15),
  } as Record<string, number[]>,
  oldLotData: {} as Record<string, { mean: number | null; sd: number | null }>,
  priorLotRuns: { [QK("Made-up Glucose", "Normal", "Made-up Analyzer A")]: withGaps([100, 99, 101, 100, 102], 15) } as Record<string, number[]>,
  vendorValues: { "Made-up Glucose|Normal": { mean: 100, sd: 3 } } as Record<string, { mean: number | null; sd: number | null }>,
  showPriorLot: true, showVendor: true, numRuns: 15, importSource: null,
});
const maRows = () => {
  const rows = Array.from({ length: 24 }, (_, i) => ({ id: `S${String(i + 1).padStart(3, "0")}`, ptNew: "", ptOld: "", apttNew: "", apttOld: "", fibNew: "", fibOld: "" }));
  [[12.1, 12.0], [12.6, 12.4], [11.9, 12.2], [13.0, 12.8], [12.4, 12.5]].forEach(([n, o], i) => { rows[i].ptNew = String(n); rows[i].ptOld = String(o); });
  rows[5].ptNew = "13.1";                                   // a half-typed pair
  rows[6].apttNew = "30.2"; rows[6].apttOld = "29.8";        // an APTT pair only
  rows[7].fibNew = "301"; rows[7].fibOld = "296"; rows[7].ptNew = "12.2"; rows[7].ptOld = "12.3";
  return rows;
};
const multiAnalyte = () => ({
  instrument: "Made-up Coag Analyzer", newLotPT: "PT-NEW-MU", oldLotPT: "PT-OLD-MU", newLotAPTT: "APTT-NEW-MU", oldLotAPTT: "APTT-OLD-MU", newLotFib: "FIB-NEW-MU", oldLotFib: "FIB-OLD-MU",
  isi: 1.02, normalMeanPT: 12.3, sampleType: "normal" as const, teaPT: 0.2, teaAPTT: 0.15, teaFib: 0.2, specimens: maRows(),
});
const refInterval = () => {
  // 20 numeric results and a 21st censored one. (Fewer than 20 numeric results is a separate, reported mismatch: the
  // stored verdict counts every row and the results page needs 20 numbers.)
  const data = Array.from({ length: 21 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, value: 136 + (i % 9) as any }));
  data[6].specimenId = "MU-07"; data[20].value = C(150, "above");
  return { analyte: "Made-up Sodium", units: "mmol/L", low: 135 as number | "", high: 145 as number | "", numSpecimens: 21, data };
};
const sensitivity = () => ({
  mode: "verification" as const, analyteName: "Made-up Troponin", units: "ng/L",
  blanksText: "0.1\n0.0\n0.2,LOT-A\n0.1\n0.0\nnot a number\n0.1",
  lowLevelText: "1.1\n0.9\n1.3\n1.0\n1.2\n0.8",
  loqLevels: [{ expectedConcentration: "5", repsText: "5.1\n4.8\n5.3\n5.0\n4.9" }],
  cvThreshold: 20, biasThreshold: 25, mfgLob: "0.3", mfgLod: "0.8", mfgLoq: "",
});
const PATTERN: ("L" | "H")[] = ["L","L","H","H","L","L","H","L","H","H","L","L","L","L","H","H","L","L","H","L","L"];
const carryover = () => ({
  units: "mg/dL",
  data: PATTERN.map((t, i) => ({ sequence: i + 1, sample_type: t, value: i < 16 ? (t === "L" ? 10 + (i % 3) * 0.1 : 500 + i) : null })),
});
const levels = (rows: Array<[string, number | null]>, reps: (number | null)[][], n: number) => ({
  levels: rows.map(([name, assignedValue]) => ({ name, assignedValue })),
  runData: Object.fromEntries(rows.map(([name], i) => [name, withGaps(reps[i] || [], n)])) as Record<string, number[]>,
});
const accuracy = () => ({
  analyte: "Made-up ALT", units: "U/L", replicatesPerLevel: 12, claimedLow: "" as number | "", claimedHigh: "" as number | "", importSource: null,
  ...levels([["QC Low", 40], ["QC High", 200]], [[40, 41, 39, null, 40, 42, 38, 40, 41, 39], [200, 198, 202, 201, 199, 200, 203, 197, 200, 201]], 12),
});
const linearity = () => ({
  analyte: "Made-up Glucose", units: "mg/dL", replicatesPerLevel: 3, claimedLow: 10 as number | "", claimedHigh: 500 as number | "",
  importSource: { source: "veritaqc", note: "made-up provenance" },
  ...levels([["Level 1", 20], ["Level 2", 120], ["Level 3", 250], ["Level 4", 450]], [[20, 21, 19], [120, 119, 121], [250, 252, 248], [450, 447, 453]], 3),
});
const reportable = () => ({
  analyte: "Made-up Calcium", units: "mg/dL", replicatesPerLevel: 2, claimedLow: 5 as number | "", claimedHigh: 15 as number | "", importSource: null,
  ...levels([["Low end", 5.2], ["Mid", 9.8], ["High end", 14.6]], [[5.2, 5.3], [9.8, 9.7], [14.6, 14.5]], 2),
});
const catPoints = (rows: Array<[string, string]>, names: string[]) => rows.map(([e, c], i) => ({
  level: i + 1, expectedValue: null, instrumentValues: Object.fromEntries(names.map((n) => [n, null])),
  expectedCategory: e, instrumentCategories: { [names[1]]: c },
}));
const MC_NAMES = ["Made-up Reference", "Made-up Candidate"];
const qualitative = () => ({
  points: catPoints([["Positive", "Positive"], ["Negative", "Negative"], ["Positive", "Positive"], ["Negative", "Positive"], ["Positive", "Positive"], ["Negative", "Negative"]], MC_NAMES),
  assayType: "qualitative" as const, qualCategories: ["Reactive", "Nonreactive", "Indeterminate"], qualPassThreshold: 0.95,
  gradePreset: "plus" as const, customGrades: ["Negative", "1+", "2+", "3+", "4+"], semiQuantPassThreshold: 0.8,
});
const semiQuant = () => ({
  points: catPoints([["Negative", "Negative"], ["Trace", "Trace"], ["Small", "Moderate"], ["Large", "Large"], ["Moderate", "Moderate"]], MC_NAMES),
  assayType: "semi_quantitative" as const, qualCategories: ["Positive", "Negative"], qualPassThreshold: 0.9,
  gradePreset: "urinalysis" as const, customGrades: ["Negative", "1+", "2+", "3+", "4+"], semiQuantPassThreshold: 0.85,
});

// ── What must come back: the typed entries (E), and for a draft also its layout (D) ──
type Canon = (f: any) => unknown;
const entries: Record<string, Canon> = {
  precision: (f) => f && ({
    mode: f.mode, levels: f.levels, names: f.levelNames.slice(0, f.levels),
    values: f.mode === "simple" ? f.values.slice(0, f.levels).map(filledOnly) : f.advancedData.slice(0, f.levels).map((d: any[]) => d.map(filledOnly)),
    advanced: f.mode === "advanced" ? [f.days, f.runsPerDay, f.replicatesPerRun] : null,
    optional: [f.vendorSd, f.vendorSdConc, f.targetMean, f.targetCv].map((s: string) => (s.trim() === "" ? "" : String(parseFloat(s)))).concat([f.controlLot, f.reagentLot, f.comment, f.resultUnits].map((s: string) => s.trim())),
  }),
  lot_to_lot: (f) => f && ({
    sampleType: f.sampleType, lots: [f.currentLotNum, f.newLotNum], analyte: f.analyte, units: f.units, n: f.numSpecimens,
    rows: [...f.data, ...(f.sampleType === "both" ? f.dataAbnormal : [])].map((r: any) => [r.specimenId, r.currentLot, r.newLot, r.cohort]),
  }),
  qc_range: (f) => f && ({
    analytes: f.analytes, analyzers: f.analyzers, levels: f.levels, dates: [f.dateStart, f.dateEnd],
    runs: Object.fromEntries(Object.entries(f.runData).map(([k, v]) => [k, filledOnly(v as number[])]).filter(([, v]) => (v as number[]).length > 0)),
    prior: Object.fromEntries(Object.entries(f.priorLotRuns).map(([k, v]) => [k, filledOnly(v as number[])])),
    vendor: f.vendorValues, old: f.oldLotData, show: [f.showPriorLot, f.showVendor],
  }),
  multi_analyte_coag: (f) => f && ({
    head: [f.instrument, f.newLotPT, f.oldLotPT, f.newLotAPTT, f.oldLotAPTT, f.newLotFib, f.oldLotFib, f.isi, f.normalMeanPT, f.sampleType, f.teaPT, f.teaAPTT, f.teaFib],
    complete: f.specimens.map((s: any) => [s.id, ...[s.ptNew, s.ptOld, s.apttNew, s.apttOld, s.fibNew, s.fibOld].map((v: string) => (v ? parseFloat(v) : null))])
      .filter((r: any[]) => (r[1] != null && r[2] != null) || (r[3] != null && r[4] != null) || (r[5] != null && r[6] != null)),
  }),
  ref_interval: (f) => f && ({ analyte: f.analyte, units: f.units, range: [f.low, f.high], n: f.numSpecimens, rows: f.data.map((d: any) => [d.specimenId, d.value]) }),
  sensitivity: (f) => {
    if (!f) return f;
    const p = (t: string) => t.split(/\r?\n/).map((l) => l.split(/[,\t]/).map((x) => x.trim()).filter(Boolean)).filter((x) => x.length && !isNaN(parseFloat(x[0]))).map((x) => [parseFloat(x[0]), x[1] ?? null]);
    return { mode: f.mode, units: f.units, blanks: p(f.blanksText), low: p(f.lowLevelText), loq: f.loqLevels.map((l: any) => [parseFloat(l.expectedConcentration), p(l.repsText)]),
      thresholds: [f.cvThreshold, f.biasThreshold], claim: f.mode === "verification" ? [f.mfgLob, f.mfgLod, f.mfgLoq].map((s: string) => (s === "" ? "" : String(parseFloat(s)))) : null };
  },
  carryover: (f) => f && ({ units: f.units, valued: f.data.filter((d: any) => d.value !== null).map((d: any) => [d.sequence, d.sample_type, d.value]) }),
  levels: (f) => f && ({
    analyte: f.analyte.trim(), units: f.units.trim(), claimed: [f.claimedLow, f.claimedHigh],
    levels: f.levels.map((lv: any) => [lv.name, lv.assignedValue, filledOnly(f.runData[lv.name])]),
  }),
  method_comparison: (f) => f && ({
    assayType: f.assayType, points: f.points,
    rule: f.assayType === "qualitative" ? [f.qualCategories, f.qualPassThreshold] : f.assayType === "semi_quantitative" ? [f.gradePreset, f.gradePreset === "custom" ? f.customGrades : null, f.semiQuantPassThreshold] : null,
  }),
};
const layout: Record<string, Canon> = {
  precision: (f) => f && (f.mode === "simple" ? { reps: f.reps } : { days: f.advancedData.slice(0, f.levels) }),
  lot_to_lot: (f) => f && ({ exp: [f.currentLotExp, f.newLotExp] }),
  qc_range: (f) => f && ({ numRuns: f.numRuns }),
  multi_analyte_coag: (f) => f && ({ rows: f.specimens.map((s: any) => [s.id, s.ptNew, s.ptOld, s.apttNew, s.apttOld, s.fibNew, s.fibOld].join("|")) }),
  ref_interval: () => null,
  sensitivity: (f) => f && ({ texts: [f.analyteName, f.blanksText, f.lowLevelText, f.loqLevels] }),
  carryover: (f) => f && ({ pattern: f.data.map((d: any) => `${d.sequence}${d.sample_type}${d.value ?? "-"}`).join(",") }),
  levels: (f) => f && ({ reps: f.replicatesPerLevel, imported: !!f.importSource }),
  method_comparison: () => null,
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const lib = await import("../../client/src/lib/studyFormPayload");
  const { calculateSensitivity } = await import("../../client/src/lib/calculations");
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const sqlite = (db as any).$client;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const PW = ["Draft", "all", "7x!"].join("-");
  const email = `it-drafts-${Date.now()}@example.com`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Drafts", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Drafts Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);
    const getRow = async (id: number) => (await call("GET", `/api/labs/${labId}/studies/${id}`, undefined, token, labId)).body;

    // The grid as the page opens it (calibration verification's 10 empty levels): what main's Save Draft sent.
    const emptyGrid = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Instrument 1": null, "Instrument 2": null } }));
    // handleSaveDraft: the common fields, then the type's own (studyDraftFields).
    const draftBody = (studyType: string, form: any, testName: string) => {
      const grid = studyType === "method_comparison" ? form.points : emptyGrid;
      const names = studyType === "method_comparison" ? MC_NAMES : ["Made-up Analyzer", "Instrument 2"];
      return {
        testName, instrument: names[0], analyst: "", date: "2026-11-09", studyType, cliaAllowableError: 0.1,
        dataPoints: JSON.stringify(grid), instruments: JSON.stringify(names),
        teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined", status: "draft",
        ...(lib.studyDraftFields(studyType, { [studyType]: form } as any) ?? {}),
      };
    };
    // handleSubmit: what Run Study saves for the type.
    const runBody = (studyType: string, form: any, testName: string) => {
      const common = {
        testName, instrument: "Made-up Analyzer", analyst: "-", date: "2026-11-09", studyType, cliaAllowableError: 0.1,
        teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined",
        instruments: JSON.stringify(["Made-up Analyzer"]), status: "pass", createdAt: new Date().toISOString(),
      };
      const s = (v: unknown) => JSON.stringify(v);
      switch (studyType) {
        case "precision": { const p = lib.buildPrecisionPayload(form); return { ...common, dataPoints: s(p.dataPoints), ...p.columns }; }
        case "lot_to_lot": return { ...common, dataPoints: s(lib.buildLotToLotPayload(form).dataPoints) };
        case "qc_range": return { ...common, instrument: form.analyzers.join(", "), instruments: s(form.analyzers), dataPoints: s(lib.buildQcRangePayload(form).dataPoints) };
        case "multi_analyte_coag": return { ...common, instrument: form.instrument, instruments: s([form.instrument]), cliaAllowableError: form.teaPT, dataPoints: s(lib.buildMultiAnalyteCoagPayload(form).dataPoints) };
        case "ref_interval": return { ...common, dataPoints: s(lib.buildRefIntervalPayload(form).dataPoints) };
        case "sensitivity": { const input = lib.buildSensitivityInput(form); return { ...common, cliaAllowableError: 0, teaIsPercentage: 0, teaUnit: form.units, cliaAbsoluteUnit: form.units, dataPoints: s({ input, results: calculateSensitivity(input) }) }; }
        case "carryover": return { ...common, cliaAllowableError: 0.01, dataPoints: s(lib.buildCarryoverPayload(form).dataPoints) };
        case "accuracy_bias": case "linearity": case "reportable_range":
          return { ...common, dataPoints: s(lib.buildLevelsPayload(studyType, form).dataPoints) };
        case "method_comparison": return { ...common, instrument: MC_NAMES.join(", "), instruments: s(MC_NAMES), dataPoints: s(lib.methodComparisonDataPoints(form)) };
      }
      throw new Error(studyType);
    };
    const canonKey = (t: string) => (t === "accuracy_bias" || t === "linearity" || t === "reportable_range" ? "levels" : t);
    const readBack = (row: any, studyType: string) => {
      const read: any = lib.readStudyForms(row);
      if (studyType !== "method_comparison") return read[studyType];
      // The page reads the grid into its rows and, for method comparison, the assay type beside it.
      if (!read.grid) return undefined;
      return { points: read.grid.points, assayType: "quantitative", qualCategories: ["Positive", "Negative"], qualPassThreshold: 0.9, gradePreset: "plus", customGrades: ["Negative", "1+", "2+", "3+", "4+"], semiQuantPassThreshold: 0.8, ...(read.grid.assay ?? {}) };
    };

    const cases: Array<[string, string, () => any]> = [
      ["precision (simple, a censored and a skipped cell, vendor claim, lots)", "precision", precisionSimple],
      ["precision (advanced, 3 days)", "precision", precisionAdvanced],
      ["lot-to-lot (both cohorts, a half-typed pair)", "lot_to_lot", lotToLot],
      ["QC lot verification (2 analyzers, prior lot, vendor values)", "qc_range", qcRange],
      ["multi-analyte coag (PT, APTT and fibrinogen pairs, a half-typed pair)", "multi_analyte_coag", multiAnalyte],
      ["reference range (a renamed specimen, a censored value)", "ref_interval", refInterval],
      ["sensitivity (verification, LoQ level)", "sensitivity", sensitivity],
      ["carryover (16 of 21 typed)", "carryover", carryover],
      ["accuracy/bias (12 replicate boxes, a skipped cell)", "accuracy_bias", accuracy],
      ["linearity (claimed range, VeritaQC import)", "linearity", linearity],
      ["reportable range (claimed range)", "reportable_range", reportable],
      ["qualitative method comparison", "method_comparison", qualitative],
      ["semi-quantitative method comparison", "method_comparison", semiQuant],
    ];

    for (const [label, studyType, make] of cases) {
      const form = make();
      const key = canonKey(studyType);
      // ── D: Save Draft, then Edit ──
      const d = await call("POST", `/api/labs/${labId}/studies`, draftBody(studyType, form, `IT draft ${label}`), token, labId);
      const dRow = await getRow(Number(d.body?.id));
      const dRead = readBack(dRow, studyType);
      check(`D. ${label}: Save Draft stores a draft`, (d.status === 200) && dRow?.status === "draft", `${d.status} ${dRow?.status}`);
      check(`D. ${label}: Edit of the draft brings back every entry`, same(entries[key](form), entries[key](dRead)), diff(entries[key](form), entries[key](dRead)));
      check(`D. ${label}: ... and the draft reopens laid out as it was left`, same(layout[key](form), layout[key](dRead)), diff(layout[key](form), layout[key](dRead)));
      // ── E: Run Study, then Edit of the finished study ──
      const r = await call("POST", `/api/labs/${labId}/studies`, runBody(studyType, form, `IT run ${label}`), token, labId);
      const rRow = await getRow(Number(r.body?.id));
      const rRead = readBack(rRow, studyType);
      check(`E. ${label}: Edit of the finished study brings back every saved entry`, r.status === 200 && same(entries[key](form), entries[key](rRead)), `${r.status} ${diff(entries[key](form), entries[key](rRead))}`);
      // ── V: the saved shape still reads ──
      let page: any = null;
      try { page = computeStudyResults({ ...rRow } as any); } catch (e) { page = { error: String(e) }; }
      const pageVerdict = page && typeof page.overallPass === "boolean" ? (page.overallPass ? "pass" : "fail") : null;
      check(`V. ${label}: stored verdict ${String(rRow?.status).toUpperCase()} is the results page's`, (rRow?.status === "pass" || rRow?.status === "fail") && pageVerdict === rRow.status,
        `stored ${rRow?.status} page ${pageVerdict} ${page?.error ?? ""}`);
    }

    // ── P: Save Changes (Draft) from Edit (PUT) ──
    const pf = precisionSimple();
    const pPost = await call("POST", `/api/labs/${labId}/studies`, draftBody("precision", pf, "IT draft precision PUT"), token, labId);
    const pId = Number(pPost.body?.id);
    // Edit opens the draft into the form (fall back to what was typed if the form didn't come back, so P2 still runs).
    const edited: any = readBack(await getRow(pId), "precision") ?? precisionSimple();
    edited.values[0] = [...filledOnly(edited.values[0]), 5.3];
    edited.vendorSd = "0.15"; edited.targetMean = ""; edited.controlLot = "CTL-MU-9"; edited.reagentLot = "RGT-MU-9";
    const pPut = await call("PUT", `/api/labs/${labId}/studies/${pId}`, draftBody("precision", edited, "IT draft precision PUT"), token, labId);
    const pAfter = await getRow(pId);
    const pRead: any = readBack(pAfter, "precision");
    check("P1. precision draft re-saved from Edit: still a draft, the added replicate kept, the rest unchanged",
      pPut.status === 200 && pAfter?.status === "draft" && same((entries.precision(edited) as any).values, (entries.precision(pRead) as any)?.values), `${pPut.status} ${diff((entries.precision(edited) as any).values, (entries.precision(pRead) as any)?.values)}`);
    check("P2. ... the changed vendor SD, cleared target mean and new lots are written (the PUT didn't name those columns)",
      pAfter?.vendorSd === 0.15 && pAfter?.targetMean === null && pAfter?.controlLot === "CTL-MU-9" && pAfter?.reagentLot === "RGT-MU-9" && pAfter?.vendorSdConcentration === 5,
      JSON.stringify({ vendorSd: pAfter?.vendorSd, targetMean: pAfter?.targetMean, controlLot: pAfter?.controlLot, reagentLot: pAfter?.reagentLot, conc: pAfter?.vendorSdConcentration }));
    const lf = lotToLot();
    const lPost = await call("POST", `/api/labs/${labId}/studies`, draftBody("lot_to_lot", lf, "IT draft lot PUT"), token, labId);
    const lId = Number(lPost.body?.id);
    const lEdited: any = readBack(await getRow(lId), "lot_to_lot") ?? lotToLot();
    lEdited.data[4].newLot = 302; lEdited.newLotExp = "2027-07-31";
    await call("PUT", `/api/labs/${labId}/studies/${lId}`, draftBody("lot_to_lot", lEdited, "IT draft lot PUT"), token, labId);
    const lRead: any = readBack(await getRow(lId), "lot_to_lot");
    check("P3. lot-to-lot draft re-saved from Edit: the finished pair and new expiration kept, both cohorts intact",
      same(entries.lot_to_lot(lEdited), entries.lot_to_lot(lRead)) && same(layout.lot_to_lot(lEdited), layout.lot_to_lot(lRead)), diff(entries.lot_to_lot(lEdited), entries.lot_to_lot(lRead)));
    // A study type that doesn't send the precision fields leaves them alone.
    sqlite.prepare("UPDATE studies SET control_lot = 'KEEP-ME' WHERE id = ?").run(lId);
    await call("PUT", `/api/labs/${labId}/studies/${lId}`, draftBody("lot_to_lot", lEdited, "IT draft lot PUT"), token, labId);
    check("P4. a re-save that doesn't send a precision field leaves that column as it was",
      (sqlite.prepare("SELECT control_lot FROM studies WHERE id = ?").get(lId) as any)?.control_lot === "KEEP-ME");

    // ── The grid types read as before ──
    const calGrid = Array.from({ length: 6 }, (_, i) => ({ level: i + 1, expectedValue: 10 * (i + 1), instrumentValues: { "Made-up Analyzer": 10 * (i + 1) + 0.1, "Instrument 2": null } }));
    const cal = await call("POST", `/api/labs/${labId}/studies`, { ...draftBody("cal_ver", null, "IT draft cal ver"), dataPoints: JSON.stringify(calGrid) }, token, labId);
    const calRead: any = lib.readStudyForms(await getRow(Number(cal.body?.id)));
    check("G1. calibration verification draft: the grid comes back as saved (unchanged path)", same(calRead.grid?.points, calGrid) && !calRead.grid?.assay, JSON.stringify(calRead).slice(0, 200));
    const quant = Array.from({ length: 40 }, (_, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { [MC_NAMES[0]]: 50 + i, [MC_NAMES[1]]: 50.5 + i } }));
    const mq = await call("POST", `/api/labs/${labId}/studies`, { ...draftBody("method_comparison", { points: quant }, "IT draft quant mc"), dataPoints: JSON.stringify(lib.methodComparisonDataPoints({ ...qualitative(), assayType: "quantitative", points: quant as any })) }, token, labId);
    const mqRead: any = lib.readStudyForms(await getRow(Number(mq.body?.id)));
    check("G2. quantitative method comparison with 40 samples: all 40 come back, assay type quantitative", mqRead.grid?.points?.length === 40 && same(mqRead.grid.points, quant) && !mqRead.grid.assay);
    const pt: any = lib.readStudyForms({ studyType: "pt_coag", dataPoints: JSON.stringify({ module1: {}, module2: null, module3: null }) });
    check("G3. PT/INR is left to its own reader (ptCoagPayload.ts, the page's hydrate)", Object.keys(pt).length === 0);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
