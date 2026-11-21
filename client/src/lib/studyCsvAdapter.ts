// Per-study-type adapter: turns a Study's raw inputData (stored as JSON in
// study.dataPoints) into a flat CSV string. Each branch reads the shape its
// form saves (client/src/lib/studyFormPayload.ts, ptCoagPayload.ts, and the
// manual differential and heparin forms), so an unknown or corrupted shape
// degrades to an empty CSV (the page then says "No source data found") and
// never throws.
//
// 2026-11-21 (Sentry 7859390250, San Carlos): "n.map is not a function" on
// Export CSV. The adapter cast every type's data to an array, but lot-to-lot,
// QC lot verification, multi-analyte coag, reference range, PT/INR, manual
// differential, heparin range and a qualitative or semi-quantitative method
// comparison save an object, so Export CSV threw on all of them. Precision
// read the wrong fields and sensitivity read the wrong keys, so both gave
// header-only files. scripts/verify-study-csv-shapes.mts pins every type.
//
// The columns export the SOURCE DATA the analyst entered (replicate values,
// per-sample readings, blank/low-level reps). Computed results (slope, CV,
// LoD, etc.) live in the PDF and on screen; the CSV is for the inputs.

import type { Study } from "@shared/schema";
import { isCensored } from "@shared/censoring";
import { toCsv, toCsvMultiSection, type CsvColumn } from "./csvExport";

type Row = Record<string, unknown>;

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const asArray = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const rowsOf = (v: unknown): Row[] => asArray(v).filter(isObj);

// A cell the analyst entered: a number, a censored result ("<5", ">500"), or blank.
export function cellValue(v: unknown): string | number {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? v : "";
  if (isCensored(v)) return `${v.censor_direction === "below" ? "<" : ">"}${v.censor_value}`;
  if (isObj(v) && typeof v.value === "number") return Number.isFinite(v.value) ? v.value : "";
  if (typeof v === "string" || typeof v === "boolean") return String(v);
  return "";
}

const col = (header: string, format: (r: Row) => unknown): CsvColumn<Row> => ({ key: header, header, format });

function parseInstruments(study: Study): string[] {
  const arr = safeJsonParse<string[]>(study.instruments as unknown as string);
  return Array.isArray(arr) ? arr.filter((n) => typeof n === "string") : [];
}

// Build a CSV filename per study type. Caller is free to override.
export function defaultCsvFilename(study: Study): string {
  const typeMap: Record<string, string> = {
    cal_ver: "CalVer",
    cal_ver_correlation: "CalVerCorrelation",
    precision: "Precision",
    method_comparison: "MethodComp",
    correlation: "MethodComp",
    lot_to_lot: "LotToLot",
    pt_coag: "PTCoag",
    qc_range: "QCRange",
    multi_analyte_coag: "MultiAnalyteCoag",
    ref_interval: "RefInterval",
    sensitivity: "Sensitivity",
    qualitative: "Qualitative",
    semi_quantitative: "SemiQuant",
    carryover: "Carryover",
    accuracy_bias: "AccuracyBias",
    linearity: "Linearity",
    reportable_range: "ReportableRange",
    manual_diff: "ManualDiff",
    heparin_range: "HeparinRange",
  };
  const typeTag = typeMap[study.studyType] ?? "Study";
  const safeName = String(study.testName ?? "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 60);
  return `VeritaCheck_${typeTag}_${safeName}_${study.date}.csv`;
}

// ─── Per-type serializers ─────────────────────────────────────────────────────

const sampleLabel = (r: Row) => (typeof r.customLabel === "string" && r.customLabel.trim() ? r.customLabel : r.level ?? "");

// Calibration verification, method comparison, cal ver + correlation: one row
// per level / sample with the assigned value and each analyzer's reading.
function serializeLevelWithInstruments(study: Study, raw: unknown): string {
  const points = rowsOf(raw);
  if (points.length === 0) return "";
  const instruments = parseInstruments(study);
  const names = instruments.length > 0
    ? instruments
    : Array.from(new Set(points.flatMap((p) => (isObj(p.instrumentValues) ? Object.keys(p.instrumentValues) : []))));
  const anyExcluded = points.some((p) => p.excluded);
  const columns: CsvColumn<Row>[] = [
    col("Level / Sample", sampleLabel),
    col("Assigned / Expected Value", (r) => cellValue(r.expectedValue)),
    ...names.map((name) => col(name, (r) => cellValue(isObj(r.instrumentValues) ? r.instrumentValues[name] : null))),
    ...(anyExcluded ? [col("Excluded", (r) => (r.excluded ? "Yes" : ""))] : []),
  ];
  return toCsv(points, columns);
}

// Qualitative / semi-quantitative method comparison: { assayType, points: [{ expectedCategory, instrumentCategories }] }.
function serializeCategorical(study: Study, raw: Record<string, any>): string {
  const points = rowsOf(raw.points);
  if (points.length === 0) return "";
  const instruments = parseInstruments(study);
  const names = instruments.length > 1 ? instruments.slice(1)
    : Array.from(new Set(points.flatMap((p) => (isObj(p.instrumentCategories) ? Object.keys(p.instrumentCategories) : []))));
  const refHeader = raw.assayType === "semi_quantitative" ? "Reference Grade" : "Reference Result";
  const columns: CsvColumn<Row>[] = [
    col("Sample", sampleLabel),
    col(instruments[0] ? `${refHeader} (${instruments[0]})` : refHeader, (r) => r.expectedCategory ?? ""),
    ...names.map((name) => col(name, (r) => (isObj(r.instrumentCategories) ? r.instrumentCategories[name] ?? "" : ""))),
  ];
  return toCsv(points, columns);
}

// Precision: [{ level, levelName, values[] }] (simple) or with days[run][rep] (advanced).
function serializePrecision(raw: unknown): string {
  const levels = rowsOf(raw);
  const rows: Row[] = [];
  for (const lv of levels) {
    const name = lv.levelName ?? lv.level ?? "";
    const days = asArray<unknown>(lv.days);
    if (days.length > 0) {
      days.forEach((day, d) => {
        asArray<unknown>(day).forEach((v, i) => {
          if (cellValue(v) === "") return;
          rows.push({ level: name, day: d + 1, replicate: i + 1, value: cellValue(v) });
        });
      });
    } else {
      asArray<unknown>(lv.values).forEach((v, i) => {
        if (cellValue(v) === "") return;
        rows.push({ level: name, day: "", replicate: i + 1, value: cellValue(v) });
      });
    }
  }
  if (rows.length === 0) return "";
  return toCsv(rows, [
    col("Level", (r) => r.level),
    col("Day", (r) => r.day),
    col("Replicate", (r) => r.replicate),
    col("Value", (r) => r.value),
  ]);
}

// Lot-to-lot: { data: [{ specimenId, cohort, currentLot, newLot }], currentLot, newLot, ... }.
function serializeLotToLot(raw: unknown): string {
  if (!isObj(raw)) return "";
  const pairs = rowsOf(raw.data);
  if (pairs.length === 0) return "";
  const units = typeof raw.units === "string" && raw.units ? ` (${raw.units})` : "";
  const cur = typeof raw.currentLot === "string" && raw.currentLot ? `Current Lot ${raw.currentLot}` : "Current Lot";
  const nw = typeof raw.newLot === "string" && raw.newLot ? `New Lot ${raw.newLot}` : "New Lot";
  return toCsv(pairs, [
    col("Specimen ID", (r) => r.specimenId ?? ""),
    col("Cohort", (r) => r.cohort ?? ""),
    col(`${cur}${units}`, (r) => cellValue(r.currentLot)),
    col(`${nw}${units}`, (r) => cellValue(r.newLot)),
  ]);
}

// QC lot verification: { dataPoints: [{ analyte, level, analyzer, runs[], priorLotRuns?, oldMean?, oldSD? }] }.
function serializeQCRange(raw: unknown): string {
  const items = isObj(raw) ? rowsOf(raw.dataPoints) : rowsOf(raw);
  const rows: Row[] = [];
  for (const it of items) {
    const base = { analyte: it.analyte ?? "", level: it.level ?? "", analyzer: it.analyzer ?? "" };
    asArray<unknown>(it.runs).forEach((v, i) => rows.push({ ...base, lot: "New lot", replicate: i + 1, value: cellValue(v) }));
    asArray<unknown>(it.priorLotRuns).forEach((v, i) => rows.push({ ...base, lot: "Prior lot", replicate: i + 1, value: cellValue(v) }));
    if (asArray(it.priorLotRuns).length === 0) {
      if (typeof it.oldMean === "number") rows.push({ ...base, lot: "Prior lot mean (entered)", replicate: "", value: it.oldMean });
      if (typeof it.oldSD === "number") rows.push({ ...base, lot: "Prior lot SD (entered)", replicate: "", value: it.oldSD });
    }
  }
  if (rows.length === 0) return "";
  return toCsv(rows, [
    col("Analyte", (r) => r.analyte),
    col("Level", (r) => r.level),
    col("Analyzer", (r) => r.analyzer),
    col("Lot", (r) => r.lot),
    col("Replicate", (r) => r.replicate),
    col("Value", (r) => r.value),
  ]);
}

// Multi-analyte coag: { specimens: [{ specimenId, ptNew, ptOld, apttNew, apttOld, fibNew, fibOld }] }.
function serializeMultiAnalyteCoag(raw: unknown): string {
  if (!isObj(raw)) return "";
  const specimens = rowsOf(raw.specimens);
  if (specimens.length === 0) return "";
  return toCsv(specimens, [
    col("Specimen ID", (r) => r.specimenId ?? ""),
    col("PT New Lot (sec)", (r) => cellValue(r.ptNew)),
    col("PT Old Lot (sec)", (r) => cellValue(r.ptOld)),
    col("aPTT New Lot (sec)", (r) => cellValue(r.apttNew)),
    col("aPTT Old Lot (sec)", (r) => cellValue(r.apttOld)),
    col("Fibrinogen New Lot (mg/dL)", (r) => cellValue(r.fibNew)),
    col("Fibrinogen Old Lot (mg/dL)", (r) => cellValue(r.fibOld)),
  ]);
}

// Reference range verification: { specimens: [{ specimenId, value }], refLow, refHigh, units }.
// A legacy row may hold the specimen array itself.
function serializeRefInterval(raw: unknown): string {
  const specimens = isObj(raw) ? rowsOf(raw.specimens) : rowsOf(raw);
  if (specimens.length === 0) return "";
  const units = isObj(raw) && typeof raw.units === "string" && raw.units ? raw.units : "";
  const data = toCsv(specimens, [
    col("Specimen ID", (r) => r.specimenId ?? ""),
    col(`Value${units ? ` (${units})` : ""}`, (r) => cellValue(r.value)),
  ]);
  const lo = isObj(raw) && typeof raw.refLow === "number" ? raw.refLow : null;
  const hi = isObj(raw) && typeof raw.refHigh === "number" ? raw.refHigh : null;
  const header = lo !== null && hi !== null ? `# Reference interval verified: ${lo} to ${hi}${units ? " " + units : ""}\n` : "";
  return header + data;
}

// Carryover (CLSI EP10): { specimens: [{ sequence, sample_type, value }], units }.
function serializeCarryover(raw: unknown): string {
  if (!isObj(raw)) return "";
  const specimens = rowsOf(raw.specimens);
  if (specimens.length === 0) return "";
  const units = typeof raw.units === "string" && raw.units ? ` (${raw.units})` : "";
  return toCsv(specimens, [
    col("Sequence", (r) => r.sequence ?? ""),
    col("Material", (r) => (r.sample_type === "H" ? "High" : "Low")),
    col(`Value${units}`, (r) => cellValue(r.value)),
  ]);
}

// Sensitivity (CLSI EP17): saved as { input: { blanks, lowLevel, loqLevels }, results } (a draft adds form).
function serializeSensitivity(raw: unknown): string {
  if (!isObj(raw)) return "";
  const input = isObj(raw.input) ? raw.input : raw;
  const rep = (r: Row) => ({ lot: r.lot ?? "", day: r.day ?? "", run: r.run ?? "", value: cellValue(r.value) });
  const blanks = rowsOf(input.blanks).map(rep);
  const low = rowsOf(input.lowLevel).map(rep);
  const loq = rowsOf(input.loqLevels).flatMap((g) => rowsOf(g.replicates).map((r) => ({ expectedConcentration: g.expectedConcentration ?? "", ...rep(r) })));
  if (blanks.length + low.length + loq.length === 0) return "";
  const repCols = [
    { key: "lot", header: "Lot" },
    { key: "day", header: "Day" },
    { key: "run", header: "Run" },
    { key: "value", header: "Value" },
  ];
  const sections: Array<{ title: string; columns: CsvColumn<any>[]; rows: Row[] }> = [
    { title: "Blank Replicates", columns: repCols, rows: blanks },
    { title: "Low-Level Replicates (LoD)", columns: repCols, rows: low },
  ];
  if (loq.length > 0) {
    sections.push({ title: "LoQ Levels", columns: [{ key: "expectedConcentration", header: "Expected Concentration" }, ...repCols], rows: loq });
  }
  return toCsvMultiSection(sections);
}

// Accuracy / bias, linearity and reportable range: { levels: [{ name, assigned_value, replicates[] }] }.
function levelRows(raw: unknown): Row[] {
  const levels = isObj(raw) ? rowsOf(raw.levels) : [];
  const rows: Row[] = [];
  for (const lv of levels) {
    const reps = asArray<unknown>(lv.replicates);
    if (reps.length === 0) {
      rows.push({ level: lv.name ?? "", assigned: cellValue(lv.assigned_value), replicate: 0, value: "" });
      continue;
    }
    reps.forEach((v, i) => rows.push({ level: lv.name ?? "", assigned: cellValue(lv.assigned_value), replicate: i + 1, value: cellValue(v) }));
  }
  return rows;
}

function levelColumns(units: string): CsvColumn<Row>[] {
  return [
    col("Level", (r) => r.level),
    col(`Assigned${units ? ` (${units})` : ""}`, (r) => r.assigned),
    col("Replicate #", (r) => r.replicate),
    col(`Value${units ? ` (${units})` : ""}`, (r) => r.value),
  ];
}

function serializeLevels(raw: unknown): string {
  const rows = levelRows(raw);
  if (rows.length === 0) return "";
  const units = isObj(raw) && typeof raw.units === "string" ? raw.units : "";
  return toCsv(rows, levelColumns(units));
}

// Reportable range: the levels plus the claimed range as a leading comment line.
function serializeReportableRange(raw: unknown): string {
  const data = serializeLevels(raw);
  if (!data || !isObj(raw)) return data;
  const units = typeof raw.units === "string" ? raw.units : "";
  const cl = typeof raw.claimed_range_low === "number" ? raw.claimed_range_low : null;
  const ch = typeof raw.claimed_range_high === "number" ? raw.claimed_range_high : null;
  const rangeHeader = cl !== null && ch !== null ? `# Claimed Reportable Range: ${cl} to ${ch}${units ? " " + units : ""}\n` : "";
  return rangeHeader + data;
}

// PT/INR: { module1Instruments: [{ name, ptValues[], isi, ptRI, inrRI }] | module1, module2?: { data: [{ id, x, y }] }, module3? }.
function serializePtCoag(raw: unknown): string {
  if (!isObj(raw)) return "";
  const blocks = rowsOf(raw.module1Instruments).length > 0 ? rowsOf(raw.module1Instruments) : (isObj(raw.module1) ? [raw.module1] : []);
  const normals: Row[] = [];
  blocks.forEach((b, bi) => {
    const name = typeof b.name === "string" && b.name ? b.name : `Instrument ${bi + 1}`;
    asArray<unknown>(b.ptValues).forEach((v, i) => {
      if (cellValue(v) === "") return;
      normals.push({ instrument: name, specimen: i + 1, pt: cellValue(v) });
    });
  });
  const pairs = (m: unknown): Row[] => (isObj(m) ? rowsOf(m.data) : [])
    .filter((d) => cellValue(d.x) !== "" || cellValue(d.y) !== "")
    .map((d, i) => ({ specimen: d.id ?? i + 1, x: cellValue(d.x), y: cellValue(d.y) }));
  const m2 = pairs(raw.module2);
  const m3 = pairs(raw.module3);
  if (normals.length + m2.length + m3.length === 0) return "";
  const sections: Array<{ title: string; columns: CsvColumn<any>[]; rows: Row[] }> = [];
  if (normals.length > 0) {
    sections.push({
      title: "Module 1: Normal Patient PT (sec)",
      columns: [col("Instrument", (r) => r.instrument), col("Specimen #", (r) => r.specimen), col("PT (sec)", (r) => r.pt)],
      rows: normals,
    });
  }
  const pairCols = (x: string, y: string) => [col("Specimen", (r) => r.specimen), col(x, (r) => r.x), col(y, (r) => r.y)];
  const named = (m: unknown, key: string) => (isObj(m) && typeof m[key] === "string" && m[key].trim() ? ` ${m[key].trim()}` : "");
  if (m2.length > 0) {
    const x = named(raw.module2, "inst1") ? `X (${named(raw.module2, "inst1").trim()})` : "X (Inst 1)";
    const y = named(raw.module2, "inst2") ? `Y (${named(raw.module2, "inst2").trim()})` : "Y (Inst 2)";
    sections.push({ title: "Module 2: Two-Instrument Comparison", columns: pairCols(x, y), rows: m2 });
  }
  if (m3.length > 0) {
    sections.push({
      title: "Module 3: Old Lot vs New Lot",
      columns: pairCols(`X (Old Lot${named(raw.module3, "oldLot")})`, `Y (New Lot${named(raw.module3, "newLot")})`),
      rows: m3,
    });
  }
  return toCsvMultiSection(sections);
}

// Manual differential (Rumke / CLSI H20): { cellsCounted, referenceSource, classes: [{ name, manualCount, referencePct }] }.
function serializeManualDiff(raw: unknown): string {
  if (!isObj(raw)) return "";
  const classes = rowsOf(raw.classes);
  if (classes.length === 0) return "";
  const data = toCsv(classes, [
    col("Cell Class", (r) => r.name ?? ""),
    col("Manual Count", (r) => cellValue(r.manualCount)),
    col("Reference %", (r) => cellValue(r.referencePct)),
  ]);
  const n = typeof raw.cellsCounted === "number" ? `Cells counted: ${raw.cellsCounted}` : "";
  const src = typeof raw.referenceSource === "string" && raw.referenceSource ? `Reference: ${raw.referenceSource}` : "";
  const header = [n, src].filter(Boolean).join("; ");
  return (header ? `# ${header}\n` : "") + data;
}

// Heparin therapeutic range: { samples: [{ id, patientCode, antiXa, aptt, inr, plasma, exclude, excludeReason }] }.
// Patient codes are de-identified by the laboratory (shared/heparinRange.ts).
function serializeHeparinRange(raw: unknown): string {
  if (!isObj(raw)) return "";
  const samples = rowsOf(raw.samples);
  if (samples.length === 0) return "";
  return toCsv(samples, [
    col("Sample", (r) => r.id ?? ""),
    col("Patient Code (de-identified)", (r) => r.patientCode ?? ""),
    col("Anti-Xa (IU/mL)", (r) => cellValue(r.antiXa)),
    col("aPTT (sec)", (r) => cellValue(r.aptt)),
    col("INR", (r) => cellValue(r.inr)),
    col("Plasma", (r) => r.plasma ?? ""),
    col("Excluded", (r) => (r.exclude ? "Yes" : "")),
    col("Exclusion Reason", (r) => r.excludeReason ?? ""),
  ]);
}

// Older standalone qualitative / semi-quantitative rows: categorical points, or a flat sample list.
function serializeLegacyCategorical(study: Study, raw: unknown): string {
  if (isObj(raw) && Array.isArray(raw.points)) return serializeCategorical(study, raw);
  const rows = rowsOf(raw);
  if (rows.length === 0) return "";
  return toCsv(rows, [
    col("Sample ID", (r) => r.sampleId ?? ""),
    col("Reference", (r) => r.reference ?? r.expected ?? ""),
    col("Candidate", (r) => r.candidate ?? ""),
  ]);
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function studyToCsv(study: Study): string {
  const raw = safeJsonParse<unknown>(study.dataPoints as unknown as string);
  if (!raw) return "";
  try {
    switch (study.studyType) {
      case "precision": return serializePrecision(raw);
      case "lot_to_lot": return serializeLotToLot(raw);
      case "qc_range": return serializeQCRange(raw);
      case "multi_analyte_coag": return serializeMultiAnalyteCoag(raw);
      case "ref_interval": return serializeRefInterval(raw);
      case "carryover": return serializeCarryover(raw);
      case "sensitivity": return serializeSensitivity(raw);
      case "accuracy_bias":
      case "linearity": return serializeLevels(raw);
      case "reportable_range": return serializeReportableRange(raw);
      case "pt_coag": return serializePtCoag(raw);
      case "manual_diff": return serializeManualDiff(raw);
      case "heparin_range": return serializeHeparinRange(raw);
      case "qualitative":
      case "semi_quantitative": return serializeLegacyCategorical(study, raw);
      case "method_comparison":
      case "correlation":
        if (isObj(raw) && (raw.assayType === "qualitative" || raw.assayType === "semi_quantitative")) return serializeCategorical(study, raw);
        return serializeLevelWithInstruments(study, raw);
      case "cal_ver":
      case "cal_ver_correlation":
      default:
        return serializeLevelWithInstruments(study, raw);
    }
  } catch {
    // A shape no branch expects gives "No source data found", never a crash.
    return "";
  }
}
