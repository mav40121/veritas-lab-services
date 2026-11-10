// VeritaCheck study forms other than PT/INR (ptCoagPayload.ts has that one): what Run Study and Save Draft save,
// built in one place so both store the shape the results page, the PDF and the stored verdict read, and what Edit
// reads back into the form.
//
// BUG-146 (found 2026-11-09 while fixing BUG-145; SCAHC's tech re-entered a PT/INR study three times that day):
//   1. Save Draft sent the calibration-verification grid for every study type, so a draft of precision, lot-to-lot,
//      QC lot verification, multi-analyte coag, reference range, sensitivity, carryover, accuracy/bias, linearity or
//      reportable range kept none of its entries, and a qualitative or semi-quantitative method comparison draft kept
//      its grid but not its assay type, categories or threshold. A draft now saves each form with the builder Run
//      Study uses (status "draft", so nothing is judged until Run Study), plus the few settings only a draft needs
//      to reopen as it was left (replicates per level, runs per level, lot expiration dates, sensitivity's text).
//   2. Edit read back only carryover, accuracy/bias, linearity (not its claimed range), reportable range, PT/INR and
//      the plain grid. readStudyForms reads every form here, for drafts and finished studies alike.
// Run Study's stored shape is unchanged: each builder's non-draft output is the code handleSubmit had inline.

import { isCensored, type CensoredPoint } from "@shared/censoring";
import type { LotToLotDataPoint, QCRangeDataPoint, SensitivityInput } from "./calculations";

export type EntryCell = number | CensoredPoint | null;
export type EntryDataPoint = {
  level: number;
  expectedValue: EntryCell;
  instrumentValues: { [key: string]: EntryCell };
  expectedCategory?: string | null;
  instrumentCategories?: { [key: string]: string | null };
  customLabel?: string;
};

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);
const filled = (v: unknown): boolean => isCensored(v) || (v !== null && v !== undefined && !Number.isNaN(v as number));
const cell = (v: unknown): EntryCell => (isCensored(v) ? v : isNum(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOrBlank = (v: unknown): number | "" => (isNum(v) ? v : "");
const numText = (v: unknown): string => (isNum(v) ? String(v) : "");
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const importFields = (src: any | null) => (src ? { importedFromVeritaqc: true, importSource: src } : {});
const importOf = (dp: any): any | null => (dp && dp.importedFromVeritaqc && dp.importSource ? dp.importSource : null);

// ── Precision ───────────────────────────────────────────────────────────────
export const PRECISION_LEVEL_NAMES = ["Level 1 (Low)", "Level 2 (High)", "Level 3 (Mid)"];
export const PRECISION_REP_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40];
export interface PrecisionForm {
  mode: "simple" | "advanced";
  levels: number;
  levelNames: string[];
  values: EntryCell[][];          // simple: replicates per level
  reps: number;                   // simple: replicate boxes shown per level
  days: number; runsPerDay: number; replicatesPerRun: number;
  advancedData: EntryCell[][][];  // advanced: per level, per day
  vendorSd: string; vendorSdConc: string; targetMean: string; targetCv: string;
  controlLot: string; reagentLot: string; comment: string; resultUnits: string;
  importSource: any | null;
}
export function buildPrecisionPayload(f: PrecisionForm, opts: { draft?: boolean } = {}) {
  const dataPoints: any[] = f.levelNames.slice(0, f.levels).map((name, i) => {
    if (f.mode === "simple") {
      return { level: i + 1, levelName: name, values: (f.values[i] || []).filter((v) => filled(v)), ...(opts.draft ? { replicatesPerLevel: f.reps } : {}) };
    }
    return {
      level: i + 1, levelName: name,
      days: f.advancedData[i] || [],
      numDays: f.days, runsPerDay: f.runsPerDay, replicatesPerRun: f.replicatesPerRun,
      values: (f.advancedData[i] || []).flat().filter((v) => filled(v)),
    };
  });
  if (f.importSource && dataPoints.length > 0) {
    dataPoints[0].importedFromVeritaqc = true;
    dataPoints[0].importSource = f.importSource;
  }
  const numOrNull = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
  const trimOrNull = (s: string) => { const t = s.trim(); return t.length > 0 ? t : null; };
  const columns = {
    vendorSd: numOrNull(f.vendorSd),
    vendorSdConcentration: numOrNull(f.vendorSdConc),
    targetMean: numOrNull(f.targetMean),
    targetCv: numOrNull(f.targetCv),
    controlLot: trimOrNull(f.controlLot),
    reagentLot: trimOrNull(f.reagentLot),
    comment: trimOrNull(f.comment),
    resultUnits: trimOrNull(f.resultUnits),
  };
  return { dataPoints, columns };
}
function readPrecisionForm(dp: unknown, row: any): PrecisionForm | null {
  if (!Array.isArray(dp) || dp.length === 0 || !dp.every((l) => isObj(l) && (Array.isArray(l.values) || Array.isArray(l.days)))) return null;
  const levels = Math.min(3, dp.length);
  const advanced = dp.some((l: any) => Array.isArray(l.days));
  const names = [...PRECISION_LEVEL_NAMES];
  dp.slice(0, 3).forEach((l: any, i: number) => { if (typeof l.levelName === "string" && l.levelName) names[i] = l.levelName; });
  const values: EntryCell[][] = [[], [], []];
  const advancedData: EntryCell[][][] = [[], [], []];
  dp.slice(0, 3).forEach((l: any, i: number) => {
    if (Array.isArray(l.values)) values[i] = l.values.map(cell);
    if (Array.isArray(l.days)) advancedData[i] = l.days.map((d: any) => (Array.isArray(d) ? d.map(cell) : []));
  });
  const first = dp[0] as any;
  const longest = Math.max(0, ...values.map((v) => v.length));
  const savedReps = first.replicatesPerLevel;
  const reps = isNum(savedReps) && savedReps >= longest ? savedReps
    : PRECISION_REP_OPTIONS.find((n) => n >= Math.max(longest, 20)) ?? longest;
  const longestDays = Math.max(1, ...advancedData.map((d) => d.length));
  return {
    mode: advanced ? "advanced" : "simple",
    levels,
    levelNames: names,
    values,
    reps,
    days: isNum(first.numDays) ? first.numDays : advanced ? longestDays : 5,
    runsPerDay: isNum(first.runsPerDay) ? first.runsPerDay : 1,
    replicatesPerRun: isNum(first.replicatesPerRun) ? first.replicatesPerRun : 2,
    advancedData,
    vendorSd: numText(row?.vendorSd), vendorSdConc: numText(row?.vendorSdConcentration),
    targetMean: numText(row?.targetMean), targetCv: numText(row?.targetCv),
    controlLot: str(row?.controlLot), reagentLot: str(row?.reagentLot),
    comment: str(row?.comment), resultUnits: str(row?.resultUnits),
    importSource: importOf(first),
  };
}

// ── Reagent lot verification (lot-to-lot) ───────────────────────────────────
export interface LotToLotForm {
  sampleType: "normal" | "abnormal" | "both";
  currentLotNum: string; currentLotExp: string; newLotNum: string; newLotExp: string;
  analyte: string; units: string;
  numSpecimens: number;
  data: LotToLotDataPoint[];          // the Normal (or only) cohort
  dataAbnormal: LotToLotDataPoint[];  // the Abnormal cohort, used when sampleType is "both"
}
export const lotRows = (n: number, cohort: "Normal" | "Abnormal"): LotToLotDataPoint[] =>
  Array.from({ length: n }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort }));
// Each pair is saved labeled with the cohort it was entered for. BUG-157: an Abnormal Only study's pairs are typed
// into the one Specimen Data grid (f.data), whose rows carry "Normal", and were saved that way.
const asCohort = (rows: LotToLotDataPoint[], cohort: "Normal" | "Abnormal") => rows.map((r) => (r.cohort === cohort ? r : { ...r, cohort }));
export function buildLotToLotPayload(f: LotToLotForm, opts: { draft?: boolean } = {}) {
  const allData = f.sampleType === "both" ? [...asCohort(f.data, "Normal"), ...asCohort(f.dataAbnormal, "Abnormal")]
    : asCohort(f.data, f.sampleType === "abnormal" ? "Abnormal" : "Normal");
  const dataPoints = {
    data: allData, sampleType: f.sampleType, currentLot: f.currentLotNum, newLot: f.newLotNum, analyte: f.analyte, units: f.units,
    ...(opts.draft ? { currentLotExp: f.currentLotExp, newLotExp: f.newLotExp } : {}),
  };
  return { allData, dataPoints };
}
function readLotToLotForm(dp: unknown): LotToLotForm | null {
  if (!isObj(dp) || !Array.isArray(dp.data)) return null;
  const sampleType = dp.sampleType === "abnormal" || dp.sampleType === "both" ? dp.sampleType : "normal";
  const rows: LotToLotDataPoint[] = dp.data.filter(isObj).map((r: any, i: number) => ({
    specimenId: typeof r.specimenId === "string" ? r.specimenId : `S${String(i + 1).padStart(3, "0")}`,
    currentLot: isNum(r.currentLot) ? r.currentLot : null,
    newLot: isNum(r.newLot) ? r.newLot : null,
    cohort: r.cohort === "Abnormal" ? "Abnormal" : "Normal",
  }));
  // A one-cohort study's pairs go back into the Specimen Data grid, whose rows are "Normal" whatever the study's cohort
  // (buildLotToLotPayload labels them on save), so a switch to Both keeps them as the Normal cohort.
  const normal = sampleType === "both" ? rows.filter((r) => r.cohort !== "Abnormal") : rows.map((r) => ({ ...r, cohort: "Normal" as const }));
  const n = Math.max(3, normal.length);
  const abnormal = sampleType === "both" ? rows.filter((r) => r.cohort === "Abnormal") : [];
  const pad = (list: LotToLotDataPoint[], cohort: "Normal" | "Abnormal") => [...list, ...lotRows(n, cohort).slice(list.length)];
  return {
    sampleType,
    currentLotNum: str(dp.currentLot), currentLotExp: str(dp.currentLotExp),
    newLotNum: str(dp.newLot), newLotExp: str(dp.newLotExp),
    analyte: str(dp.analyte), units: str(dp.units),
    numSpecimens: n,
    data: pad(normal, "Normal"),
    dataAbnormal: pad(abnormal, "Abnormal"),
  };
}

// ── QC lot verification (qc_range) ──────────────────────────────────────────
export interface QcRangeForm {
  analytes: string[]; analyzers: string[]; levels: string[];
  dateStart: string; dateEnd: string;
  runData: Record<string, number[]>;
  oldLotData: Record<string, { mean: number | null; sd: number | null }>;
  priorLotRuns: Record<string, number[]>;
  vendorValues: Record<string, { mean: number | null; sd: number | null }>;
  showPriorLot: boolean; showVendor: boolean;
  numRuns: number;
  importSource: any | null;
}
export function buildQcRangePayload(f: QcRangeForm, opts: { draft?: boolean } = {}) {
  const points: QCRangeDataPoint[] = [];
  for (const analyte of f.analytes) {
    for (const level of f.levels) {
      for (const analyzer of f.analyzers) {
        const key = `${analyte}|${level}|${analyzer}`;
        const runs = (f.runData[key] || []).filter((v) => !isNaN(v));
        if (runs.length === 0) continue;
        const old = f.oldLotData[key];
        // Crossover bias check: parallel prior-lot replicates keyed identically to the new-lot grid; only attached
        // when the section is opted in and the grid has values.
        const priorRuns = f.showPriorLot ? (f.priorLotRuns[key] || []).filter((v) => !isNaN(v)) : [];
        // Vendor SDI: method-agnostic key (analyte+level only) so the same vendor mean/SD applies across analyzers.
        const vendor = f.showVendor ? f.vendorValues[`${analyte}|${level}`] : undefined;
        points.push({
          analyte, level, analyzer, runs,
          oldMean: old?.mean, oldSD: old?.sd,
          priorLotRuns: priorRuns.length > 0 ? priorRuns : undefined,
          vendorMean: vendor?.mean ?? undefined,
          vendorSD: vendor?.sd ?? undefined,
        });
      }
    }
  }
  const dataPoints = {
    dataPoints: points, analytes: f.analytes, analyzers: f.analyzers, levels: f.levels,
    dateRange: { start: f.dateStart, end: f.dateEnd },
    oldLotData: f.oldLotData,
    priorLotRuns: f.priorLotRuns,
    vendorValues: f.vendorValues,
    showPriorLot: f.showPriorLot, showVendor: f.showVendor,
    importedFromVeritaqc: !!f.importSource,
    importSource: f.importSource,
    ...(opts.draft ? { numRuns: f.numRuns } : {}),
  };
  return { points, dataPoints };
}
function readQcRangeForm(dp: unknown): QcRangeForm | null {
  if (!isObj(dp) || !Array.isArray(dp.dataPoints)) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);
  const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map((x) => (isNum(x) ? x : NaN)) : []);
  const points = dp.dataPoints.filter(isObj);
  const longest = Math.max(0, ...points.map((p: any) => (Array.isArray(p.runs) ? p.runs.length : 0)));
  const numRuns = isNum(dp.numRuns) && dp.numRuns >= longest ? dp.numRuns : Math.min(30, Math.max(15, longest));
  const padRuns = (runs: number[]) => [...runs, ...Array(Math.max(0, numRuns - runs.length)).fill(NaN)];
  const runData: Record<string, number[]> = {};
  for (const p of points as any[]) {
    if (typeof p.analyte !== "string" || typeof p.level !== "string" || typeof p.analyzer !== "string") continue;
    runData[`${p.analyte}|${p.level}|${p.analyzer}`] = padRuns(nums(p.runs));
  }
  const priorLotRuns: Record<string, number[]> = {};
  if (isObj(dp.priorLotRuns)) for (const [k, v] of Object.entries(dp.priorLotRuns)) priorLotRuns[k] = nums(v);
  const pairMap = (v: unknown) => {
    const out: Record<string, { mean: number | null; sd: number | null }> = {};
    if (isObj(v)) for (const [k, m] of Object.entries(v)) out[k] = { mean: isNum((m as any)?.mean) ? (m as any).mean : null, sd: isNum((m as any)?.sd) ? (m as any).sd : null };
    return out;
  };
  const analytes = strings(dp.analytes);
  const analyzers = strings(dp.analyzers);
  const levels = strings(dp.levels);
  return {
    analytes,
    analyzers: analyzers.length > 0 ? analyzers : ["Instrument 1"],
    levels: levels.length > 0 ? levels : ["Normal", "Abnormal"],
    dateStart: str(dp.dateRange?.start), dateEnd: str(dp.dateRange?.end),
    runData,
    oldLotData: pairMap(dp.oldLotData),
    priorLotRuns,
    vendorValues: pairMap(dp.vendorValues),
    showPriorLot: dp.showPriorLot === true, showVendor: dp.showVendor === true,
    numRuns,
    importSource: dp.importedFromVeritaqc && dp.importSource ? dp.importSource : null,
  };
}

// ── Multi-analyte coag lot comparison ───────────────────────────────────────
export type MaSpecimenRow = { id: string; ptNew: string; ptOld: string; apttNew: string; apttOld: string; fibNew: string; fibOld: string };
export const MA_DEFAULT_ROWS = 24;
export const maRow = (n: number): MaSpecimenRow => ({ id: `S${String(n).padStart(3, "0")}`, ptNew: "", ptOld: "", apttNew: "", apttOld: "", fibNew: "", fibOld: "" });
export interface MultiAnalyteCoagForm {
  instrument: string;
  newLotPT: string; oldLotPT: string; newLotAPTT: string; oldLotAPTT: string; newLotFib: string; oldLotFib: string;
  isi: number; normalMeanPT: number;
  sampleType: "normal" | "random";
  teaPT: number; teaAPTT: number; teaFib: number;
  specimens: MaSpecimenRow[];
}
export function buildMultiAnalyteCoagPayload(f: MultiAnalyteCoagForm, opts: { draft?: boolean } = {}) {
  const rows = f.specimens.map((s) => ({
    specimenId: s.id,
    ptNew: s.ptNew ? parseFloat(s.ptNew) : null,
    ptOld: s.ptOld ? parseFloat(s.ptOld) : null,
    apttNew: s.apttNew ? parseFloat(s.apttNew) : null,
    apttOld: s.apttOld ? parseFloat(s.apttOld) : null,
    fibNew: s.fibNew ? parseFloat(s.fibNew) : null,
    fibOld: s.fibOld ? parseFloat(s.fibOld) : null,
  }));
  const rawSpecimens = rows.filter((s) => (s.ptNew != null && s.ptOld != null) || (s.apttNew != null && s.apttOld != null) || (s.fibNew != null && s.fibOld != null));
  const dataPoints = {
    // A draft keeps every row as typed, half-entered pairs included; Run Study keeps the rows with a complete pair.
    specimens: opts.draft ? rows : rawSpecimens, isi: f.isi, normalMeanPT: f.normalMeanPT,
    teas: { pt: f.teaPT, aptt: f.teaAPTT, fib: f.teaFib },
    lots: { ptNew: f.newLotPT, ptOld: f.oldLotPT, apttNew: f.newLotAPTT, apttOld: f.oldLotAPTT, fibNew: f.newLotFib, fibOld: f.oldLotFib },
    instrument: f.instrument, sampleType: f.sampleType,
  };
  return { rawSpecimens, dataPoints };
}
function readMultiAnalyteCoagForm(dp: unknown): MultiAnalyteCoagForm | null {
  if (!isObj(dp) || !Array.isArray(dp.specimens)) return null;
  const rows: MaSpecimenRow[] = dp.specimens.filter(isObj).map((s: any, i: number) => ({
    id: typeof s.specimenId === "string" && s.specimenId ? s.specimenId : `S${String(i + 1).padStart(3, "0")}`,
    ptNew: numText(s.ptNew), ptOld: numText(s.ptOld), apttNew: numText(s.apttNew), apttOld: numText(s.apttOld), fibNew: numText(s.fibNew), fibOld: numText(s.fibOld),
  }));
  // A finished study saved only its complete rows; give the form back its empty rows after them.
  let next = Math.max(0, ...rows.map((r) => parseInt(r.id.replace(/\D/g, ""), 10) || 0)) + 1;
  while (rows.length < MA_DEFAULT_ROWS) rows.push(maRow(next++));
  const lots = isObj(dp.lots) ? dp.lots : {};
  const teas = isObj(dp.teas) ? dp.teas : {};
  return {
    instrument: typeof dp.instrument === "string" ? dp.instrument : "ACL TOP 351",
    newLotPT: str(lots.ptNew), oldLotPT: str(lots.ptOld), newLotAPTT: str(lots.apttNew), oldLotAPTT: str(lots.apttOld), newLotFib: str(lots.fibNew), oldLotFib: str(lots.fibOld),
    isi: isNum(dp.isi) ? dp.isi : 0.97,
    normalMeanPT: isNum(dp.normalMeanPT) ? dp.normalMeanPT : 12.0,
    sampleType: dp.sampleType === "normal" ? "normal" : "random",
    teaPT: isNum(teas.pt) ? teas.pt : 0.2, teaAPTT: isNum(teas.aptt) ? teas.aptt : 0.15, teaFib: isNum(teas.fib) ? teas.fib : 0.2,
    specimens: rows,
  };
}

// ── Reference range verification (ref_interval) ─────────────────────────────
export interface RefIntervalForm {
  analyte: string; units: string;
  low: number | ""; high: number | "";
  numSpecimens: number;
  data: { specimenId: string; value: EntryCell }[];
}
export function buildRefIntervalPayload(f: RefIntervalForm) {
  const dataPoints = {
    specimens: f.data.map((d) => ({ specimenId: d.specimenId, value: d.value })),
    refLow: f.low === "" ? null : Number(f.low), refHigh: f.high === "" ? null : Number(f.high),
    analyte: f.analyte, units: f.units,
  };
  return { dataPoints };
}
function readRefIntervalForm(dp: unknown): RefIntervalForm | null {
  if (!isObj(dp) || !Array.isArray(dp.specimens)) return null;
  const data = dp.specimens.filter(isObj).map((s: any, i: number) => ({
    specimenId: typeof s.specimenId === "string" ? s.specimenId : `S${String(i + 1).padStart(3, "0")}`,
    value: cell(s.value),
  }));
  while (data.length < 20) data.push({ specimenId: `S${String(data.length + 1).padStart(3, "0")}`, value: null });
  return {
    analyte: str(dp.analyte), units: str(dp.units),
    low: numOrBlank(dp.refLow), high: numOrBlank(dp.refHigh),
    numSpecimens: data.length,
    data,
  };
}

// ── Sensitivity (EP17) ──────────────────────────────────────────────────────
export interface SensitivityForm {
  mode: "establishment" | "verification";
  analyteName: string; units: string;
  blanksText: string; lowLevelText: string;
  loqLevels: { expectedConcentration: string; repsText: string }[];
  cvThreshold: number; biasThreshold: number;      // percent, as the form shows them
  mfgLob: string; mfgLod: string; mfgLoq: string;
}
// One replicate per line, "value" or "value,lot".
export const parseSensitivityText = (text: string): { value: number; lot?: string }[] =>
  text.split(/\r?\n/).flatMap((line) => {
    const parts = line.split(/[,\t]/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) return [];
    const val = parseFloat(parts[0]);
    if (isNaN(val)) return [];
    const lot = parts[1];
    return [lot ? { value: val, lot } : { value: val }];
  });
export function buildSensitivityInput(f: SensitivityForm): SensitivityInput {
  const loqLevels = f.loqLevels
    .map((lvl) => ({ expectedConcentration: parseFloat(lvl.expectedConcentration), replicates: parseSensitivityText(lvl.repsText) }))
    .filter((g) => !isNaN(g.expectedConcentration) && g.replicates.length > 0);
  const mfgClaim = f.mode === "verification" ? {
    lob: f.mfgLob !== "" ? parseFloat(f.mfgLob) : undefined,
    lod: f.mfgLod !== "" ? parseFloat(f.mfgLod) : undefined,
    loq: f.mfgLoq !== "" ? parseFloat(f.mfgLoq) : undefined,
  } : undefined;
  return {
    mode: f.mode,
    blanks: parseSensitivityText(f.blanksText),
    lowLevel: parseSensitivityText(f.lowLevelText),
    loqLevels: loqLevels.length > 0 ? loqLevels : undefined,
    cvThreshold: f.cvThreshold / 100,
    biasThreshold: f.biasThreshold / 100,
    manufacturerClaim: mfgClaim,
  };
}
// A draft keeps the form's own text (lines the parser would skip stay) beside the parsed input.
export const sensitivityDraftDataPoints = (f: SensitivityForm) => ({ input: buildSensitivityInput(f), form: f });
function readSensitivityForm(dp: unknown, row: any): SensitivityForm | null {
  if (!isObj(dp)) return null;
  const units = str(row?.teaUnit) || str(row?.cliaAbsoluteUnit);
  if (isObj(dp.form)) {
    const g = dp.form;
    return {
      mode: g.mode === "verification" ? "verification" : "establishment",
      analyteName: str(g.analyteName), units: typeof g.units === "string" ? g.units : units,
      blanksText: str(g.blanksText), lowLevelText: str(g.lowLevelText),
      loqLevels: Array.isArray(g.loqLevels) ? g.loqLevels.filter(isObj).map((l: any) => ({ expectedConcentration: str(l.expectedConcentration), repsText: str(l.repsText) })) : [],
      cvThreshold: isNum(g.cvThreshold) ? g.cvThreshold : 20, biasThreshold: isNum(g.biasThreshold) ? g.biasThreshold : 25,
      mfgLob: str(g.mfgLob), mfgLod: str(g.mfgLod), mfgLoq: str(g.mfgLoq),
    };
  }
  const input = dp.input;
  if (!isObj(input)) return null;
  const lines = (reps: unknown) => (Array.isArray(reps) ? reps.filter((r: any) => isObj(r) && isNum(r.value)).map((r: any) => (r.lot ? `${r.value},${r.lot}` : String(r.value))).join("\n") : "");
  const claim = isObj(input.manufacturerClaim) ? input.manufacturerClaim : {};
  const pct = (v: unknown, dflt: number) => (isNum(v) ? Math.round(v * 100 * 1e6) / 1e6 : dflt);
  return {
    mode: input.mode === "verification" ? "verification" : "establishment",
    analyteName: "", units,
    blanksText: lines(input.blanks), lowLevelText: lines(input.lowLevel),
    loqLevels: Array.isArray(input.loqLevels) ? input.loqLevels.filter(isObj).map((g: any) => ({ expectedConcentration: numText(g.expectedConcentration), repsText: lines(g.replicates) })) : [],
    cvThreshold: pct(input.cvThreshold, 20), biasThreshold: pct(input.biasThreshold, 25),
    mfgLob: numText(claim.lob), mfgLod: numText(claim.lod), mfgLoq: numText(claim.loq),
  };
}

// ── Carryover (EP10) ────────────────────────────────────────────────────────
export type CarryoverRow = { sequence: number; sample_type: "L" | "H"; value: number | null };
export interface CarryoverForm { units: string; data: CarryoverRow[] }
export function buildCarryoverPayload(f: CarryoverForm, opts: { draft?: boolean } = {}) {
  const valid = f.data.filter((dp) => dp.value !== null && !isNaN(dp.value as number));
  // A draft keeps every row, so the L/H pattern and the blank rows come back as they were.
  const rows = opts.draft ? f.data : valid;
  const dataPoints = { specimens: rows.map((d) => ({ sequence: d.sequence, sample_type: d.sample_type, value: d.value })), units: f.units };
  return { valid, dataPoints };
}
function readCarryoverForm(dp: unknown): CarryoverForm | null {
  if (!isObj(dp) || !Array.isArray(dp.specimens)) return null;
  const data = dp.specimens.filter(isObj).map((s: any) => ({
    sequence: typeof s.sequence === "number" ? s.sequence : 0,
    sample_type: (s.sample_type === "H" ? "H" : "L") as "L" | "H",
    value: s.value === null || s.value === undefined ? null : Number(s.value),
  }));
  if (data.length === 0) return null;
  return { units: str(dp.units), data };
}

// ── Accuracy / bias, linearity, reportable range: per-level assigned value + replicates ──
export type LevelRow = { name: string; assignedValue: number | null };
export interface LevelsForm {
  analyte: string; units: string;
  levels: LevelRow[];
  replicatesPerLevel: number;
  runData: Record<string, number[]>;
  claimedLow: number | ""; claimedHigh: number | "";   // linearity and reportable range
  importSource: any | null;
}
type LevelsKind = "accuracy_bias" | "linearity" | "reportable_range";
const builtLevelsOf = (f: LevelsForm) => f.levels.map((lv) => ({
  name: lv.name, assigned_value: lv.assignedValue,
  replicates: (f.runData[lv.name] || []).filter((v) => v !== undefined && v !== null && !isNaN(v)),
}));
// Linearity's Coverage Summary (informational; the verdict ignores it): verified range against the claimed AMR.
function linearityCoverage(usable: { assigned_value: number | null }[], linCL: number | null, linCH: number | null) {
  if (linCL === null || linCH === null || !(linCH > linCL)) return null;
  const verifiedAssigned = usable.map((lv) => lv.assigned_value as number).filter((v) => Number.isFinite(v));
  if (verifiedAssigned.length < 2) return null;
  const verifiedLow = Math.min(...verifiedAssigned);
  const verifiedHigh = Math.max(...verifiedAssigned);
  const claimedSpan = linCH - linCL;
  // Negative gap = calibrators reached past the claimed bound; clamp to 0.
  const upperGapAbs = Math.max(0, linCH - verifiedHigh);
  const lowerGapAbs = Math.max(0, verifiedLow - linCL);
  const upperGapPct = (upperGapAbs / claimedSpan) * 100;
  const lowerGapPct = (lowerGapAbs / claimedSpan) * 100;
  const verifiedCoveragePct = Math.max(0, 100 - upperGapPct - lowerGapPct);
  return {
    claimed_low: linCL, claimed_high: linCH, verified_low: verifiedLow, verified_high: verifiedHigh,
    upper_gap_abs: upperGapAbs, lower_gap_abs: lowerGapAbs, upper_gap_pct: upperGapPct, lower_gap_pct: lowerGapPct,
    verified_coverage_pct: verifiedCoveragePct,
  };
}
export function buildLevelsPayload(kind: LevelsKind, f: LevelsForm, opts: { draft?: boolean } = {}) {
  const builtLevels = builtLevelsOf(f);
  const draftExtra = opts.draft ? { replicatesPerLevel: f.replicatesPerLevel } : {};
  const cl: number | null = f.claimedLow === "" ? null : Number(f.claimedLow);
  const ch: number | null = f.claimedHigh === "" ? null : Number(f.claimedHigh);
  if (kind === "accuracy_bias") {
    const dataPoints = { analyte: f.analyte.trim(), units: f.units.trim(), levels: builtLevels, ...importFields(f.importSource), ...draftExtra };
    return { builtLevels, claimedLow: cl, claimedHigh: ch, coverage: null, dataPoints };
  }
  if (kind === "linearity") {
    const usable = builtLevels.filter((lv) => lv.assigned_value !== null && lv.replicates.length >= 2);
    const coverage = linearityCoverage(usable, cl, ch);
    const dataPoints = {
      analyte: f.analyte.trim(), units: f.units.trim(), levels: builtLevels,
      claimed_range_low: cl, claimed_range_high: ch, coverage,
      ...importFields(f.importSource), ...draftExtra,
    };
    return { builtLevels, claimedLow: cl, claimedHigh: ch, coverage, dataPoints };
  }
  const dataPoints = {
    analyte: f.analyte.trim(), units: f.units.trim(), claimed_range_low: cl, claimed_range_high: ch, levels: builtLevels,
    ...importFields(f.importSource), ...draftExtra,
  };
  return { builtLevels, claimedLow: cl, claimedHigh: ch, coverage: null, dataPoints };
}
function readLevelsForm(dp: unknown): LevelsForm | null {
  if (!isObj(dp) || !Array.isArray(dp.levels) || dp.levels.length === 0) return null;
  const persisted = dp.levels as Array<{ name?: string; assigned_value?: number | null; replicates?: number[] }>;
  const levels = persisted.map((lv, i) => ({
    name: typeof lv.name === "string" && lv.name ? lv.name : `Level ${i + 1}`,
    assignedValue: lv.assigned_value === null || lv.assigned_value === undefined ? null : Number(lv.assigned_value),
  }));
  const runData: Record<string, number[]> = {};
  let maxReps = 0;
  persisted.forEach((lv, i) => {
    const reps = Array.isArray(lv.replicates) ? lv.replicates.map((v) => Number(v)) : [];
    runData[levels[i].name] = reps;
    if (reps.length > maxReps) maxReps = reps.length;
  });
  return {
    analyte: str(dp.analyte), units: str(dp.units),
    levels,
    replicatesPerLevel: isNum(dp.replicatesPerLevel) && dp.replicatesPerLevel >= maxReps ? dp.replicatesPerLevel : maxReps,
    runData,
    claimedLow: numOrBlank(dp.claimed_range_low), claimedHigh: numOrBlank(dp.claimed_range_high),
    importSource: importOf(dp),
  };
}

// ── The data grid (calibration verification, correlation, method comparison of every assay type) ──
export const GRADE_PRESETS: Record<"plus" | "urinalysis", string[]> = {
  plus: ["Negative", "1+", "2+", "3+", "4+"],
  urinalysis: ["Negative", "Trace", "Small", "Moderate", "Large"],
};
export type AssayType = "quantitative" | "qualitative" | "semi_quantitative";
export interface GridForm {
  points: EntryDataPoint[];
  assayType: AssayType;
  qualCategories: string[]; qualPassThreshold: number;
  gradePreset: "plus" | "urinalysis" | "custom"; customGrades: string[]; semiQuantPassThreshold: number;
}
export const gradeScaleOf = (f: Pick<GridForm, "gradePreset" | "customGrades">) => (f.gradePreset === "custom" ? f.customGrades : GRADE_PRESETS[f.gradePreset]);
// What method comparison saves. A qualitative or semi-quantitative study saves its assay type with the grid.
export function methodComparisonDataPoints(f: GridForm): unknown {
  if (f.assayType === "qualitative") return { assayType: "qualitative", categories: f.qualCategories, passThreshold: f.qualPassThreshold, points: f.points };
  if (f.assayType === "semi_quantitative") return { assayType: "semi_quantitative", gradeScale: gradeScaleOf(f), passThreshold: f.semiQuantPassThreshold, points: f.points };
  return f.points;
}
export interface GridRead {
  points: EntryDataPoint[];
  assay?: Omit<GridForm, "points">;   // method comparison only
}
function readGrid(dp: unknown, studyType: string): GridRead | null {
  if (Array.isArray(dp)) return dp.length > 0 ? { points: dp as EntryDataPoint[] } : null;
  if (studyType !== "method_comparison" || !isObj(dp) || !Array.isArray(dp.points)) return null;
  if (dp.assayType !== "qualitative" && dp.assayType !== "semi_quantitative") return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s) => typeof s === "string") as string[] : []);
  const scale = strings(dp.gradeScale);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
  const gradePreset = dp.assayType !== "semi_quantitative" || scale.length === 0 || same(scale, GRADE_PRESETS.plus) ? "plus"
    : same(scale, GRADE_PRESETS.urinalysis) ? "urinalysis" : "custom";
  const categories = strings(dp.categories);
  return {
    points: dp.points as EntryDataPoint[],
    assay: {
      assayType: dp.assayType,
      qualCategories: dp.assayType === "qualitative" && categories.length > 0 ? categories : ["Positive", "Negative"],
      qualPassThreshold: dp.assayType === "qualitative" && isNum(dp.passThreshold) ? dp.passThreshold : 0.9,
      gradePreset,
      customGrades: gradePreset === "custom" ? scale : [...GRADE_PRESETS.plus],
      semiQuantPassThreshold: dp.assayType === "semi_quantitative" && isNum(dp.passThreshold) ? dp.passThreshold : 0.8,
    },
  };
}

// ── Save Draft and Edit ─────────────────────────────────────────────────────
export interface StudyForms {
  precision: PrecisionForm;
  lot_to_lot: LotToLotForm;
  qc_range: QcRangeForm;
  multi_analyte_coag: MultiAnalyteCoagForm;
  ref_interval: RefIntervalForm;
  sensitivity: SensitivityForm;
  carryover: CarryoverForm;
  accuracy_bias: LevelsForm;
  linearity: LevelsForm;
  reportable_range: LevelsForm;
  method_comparison: GridForm;
}

// The fields Save Draft sends for this study type, laid over the page's common draft fields (test name, analyst,
// date, criterion). The instrument and criterion follow what Run Study stores for the type. Null: the common fields
// already hold the form (the grid types other than method comparison).
export function studyDraftFields(studyType: string, forms: Partial<StudyForms>): Record<string, unknown> | null {
  const json = (v: unknown) => JSON.stringify(v);
  switch (studyType) {
    case "precision": {
      if (!forms.precision) return null;
      const p = buildPrecisionPayload(forms.precision, { draft: true });
      return { dataPoints: json(p.dataPoints), ...p.columns };
    }
    case "lot_to_lot": return forms.lot_to_lot ? { dataPoints: json(buildLotToLotPayload(forms.lot_to_lot, { draft: true }).dataPoints) } : null;
    case "qc_range": {
      const f = forms.qc_range;
      if (!f) return null;
      return {
        dataPoints: json(buildQcRangePayload(f, { draft: true }).dataPoints),
        instrument: f.analyzers.join(", "), instruments: json(f.analyzers),
        cliaAllowableError: 0.10, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
      };
    }
    case "multi_analyte_coag": {
      const f = forms.multi_analyte_coag;
      if (!f) return null;
      return {
        dataPoints: json(buildMultiAnalyteCoagPayload(f, { draft: true }).dataPoints),
        instrument: f.instrument, instruments: json([f.instrument]),
        cliaAllowableError: f.teaPT, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
      };
    }
    case "ref_interval":
      return forms.ref_interval ? {
        dataPoints: json(buildRefIntervalPayload(forms.ref_interval).dataPoints),
        cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
      } : null;
    case "sensitivity": {
      const f = forms.sensitivity;
      if (!f) return null;
      return {
        dataPoints: json(sensitivityDraftDataPoints(f)),
        cliaAllowableError: 0, teaIsPercentage: 0, teaUnit: f.units || null, cliaAbsoluteFloor: null, cliaAbsoluteUnit: f.units || null,
      };
    }
    case "carryover":
      return forms.carryover ? {
        dataPoints: json(buildCarryoverPayload(forms.carryover, { draft: true }).dataPoints),
        cliaAllowableError: 0.01, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
      } : null;
    case "accuracy_bias":
    case "linearity":
    case "reportable_range": {
      const f = forms[studyType];
      return f ? { dataPoints: json(buildLevelsPayload(studyType, f, { draft: true }).dataPoints) } : null;
    }
    case "method_comparison":
      return forms.method_comparison ? { dataPoints: json(methodComparisonDataPoints(forms.method_comparison)) } : null;
    default:
      return null;
  }
}

export type StudyFormsRead = Partial<StudyForms> & { grid?: GridRead };

// What Edit puts back in the form, for a saved draft or a finished study. Reads by the row's study type, so a shape
// another type also uses (specimens, levels) is never read into the wrong form.
export function readStudyForms(row: any): StudyFormsRead {
  if (!row) return {};
  const studyType: string = row.studyType ?? row.study_type ?? "";
  const raw = row.dataPoints ?? row.data_points;
  let dp: unknown;
  try { dp = typeof raw === "string" ? JSON.parse(raw || "[]") : (raw ?? []); } catch { return {}; }
  const out: StudyFormsRead = {};
  switch (studyType) {
    case "precision": { const f = readPrecisionForm(dp, row); if (f) out.precision = f; break; }
    case "lot_to_lot": { const f = readLotToLotForm(dp); if (f) out.lot_to_lot = f; break; }
    case "qc_range": { const f = readQcRangeForm(dp); if (f) out.qc_range = f; break; }
    case "multi_analyte_coag": { const f = readMultiAnalyteCoagForm(dp); if (f) out.multi_analyte_coag = f; break; }
    case "ref_interval": { const f = readRefIntervalForm(dp); if (f) out.ref_interval = f; break; }
    case "sensitivity": { const f = readSensitivityForm(dp, row); if (f) out.sensitivity = f; break; }
    case "carryover": { const f = readCarryoverForm(dp); if (f) out.carryover = f; break; }
    case "accuracy_bias":
    case "linearity":
    case "reportable_range": { const f = readLevelsForm(dp); if (f) out[studyType] = f; break; }
    case "cal_ver":
    case "cal_ver_correlation":
    case "method_comparison": { const g = readGrid(dp, studyType); if (g) out.grid = g; break; }
    default: break;
  }
  return out;
}
