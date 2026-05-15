// Per-study-type adapter: turns a Study's raw inputData (stored as JSON in
// study.dataPoints) into a flat CSV string. Each branch reads only the fields
// it expects, so an unknown or corrupted input shape degrades to an empty CSV
// rather than throwing.
//
// The columns export the SOURCE DATA the analyst entered (replicate values,
// per-sample readings, blank/low-level reps). Computed results (slope, CV,
// LoD, etc.) live in the PDF and on screen; the CSV is for the inputs.

import type { Study } from "@shared/schema";
import { toCsv, toCsvMultiSection, type CsvColumn } from "./csvExport";

function safeJsonParse<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function parseInstruments(study: Study): string[] {
  const arr = safeJsonParse<string[]>(study.instruments as unknown as string);
  return Array.isArray(arr) ? arr : [];
}

// Build a CSV filename per study type. Caller is free to override.
export function defaultCsvFilename(study: Study): string {
  const typeMap: Record<string, string> = {
    cal_ver: "CalVer",
    precision: "Precision",
    method_comparison: "MethodComp",
    lot_to_lot: "LotToLot",
    pt_coag: "PTCoag",
    qc_range: "QCRange",
    multi_analyte_coag: "MultiAnalyteCoag",
    ref_interval: "RefInterval",
    sensitivity: "Sensitivity",
    qualitative: "Qualitative",
    semi_quantitative: "SemiQuant",
  };
  const typeTag = typeMap[study.studyType] ?? "Study";
  const safeName = String(study.testName ?? "")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .slice(0, 60);
  return `VeritaCheck_${typeTag}_${safeName}_${study.date}.csv`;
}

// ─── Per-type serializers ─────────────────────────────────────────────────────

type LevelLike = {
  expectedValue?: number | null;
  level?: number | string;
  instrumentValues?: Record<string, number | null>;
};

function serializeLevelWithInstruments(study: Study, dataPoints: LevelLike[]): string {
  const instruments = parseInstruments(study);
  const columns: CsvColumn<LevelLike>[] = [
    { key: "level", header: "Level / Sample", format: (r) => r.level ?? "" },
    { key: "expectedValue", header: "Assigned / Expected Value", format: (r) => r.expectedValue ?? "" },
    ...instruments.map((name) => ({
      key: name,
      header: name,
      format: (r: LevelLike) => r.instrumentValues?.[name] ?? "",
    })),
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], columns);
}

type PrecisionDP = {
  day?: number | string;
  run?: number | string;
  replicate?: number | string;
  level?: number | string;
  value?: number | null;
};

function serializePrecision(dataPoints: PrecisionDP[]): string {
  const cols: CsvColumn<PrecisionDP>[] = [
    { key: "level", header: "Level", format: (r) => r.level ?? "" },
    { key: "day", header: "Day", format: (r) => r.day ?? "" },
    { key: "run", header: "Run", format: (r) => r.run ?? "" },
    { key: "replicate", header: "Replicate", format: (r) => r.replicate ?? "" },
    { key: "value", header: "Value", format: (r) => r.value ?? "" },
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], cols);
}

type RefIntervalDP = { specimenId?: string; value?: number | null };

function serializeRefInterval(dataPoints: RefIntervalDP[]): string {
  const cols: CsvColumn<RefIntervalDP>[] = [
    { key: "specimenId", header: "Specimen ID", format: (r) => r.specimenId ?? "" },
    { key: "value", header: "Value", format: (r) => r.value ?? "" },
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], cols);
}

type QCRangeDP = {
  analyte?: string;
  level?: string | number;
  day?: string | number;
  value?: number | null;
};

function serializeQCRange(dataPoints: QCRangeDP[]): string {
  const cols: CsvColumn<QCRangeDP>[] = [
    { key: "analyte", header: "Analyte", format: (r) => r.analyte ?? "" },
    { key: "level", header: "Level", format: (r) => r.level ?? "" },
    { key: "day", header: "Day", format: (r) => r.day ?? "" },
    { key: "value", header: "Value", format: (r) => r.value ?? "" },
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], cols);
}

type QualitativeDP = {
  sampleId?: string;
  reference?: string;
  candidate?: string;
  expected?: string;
};

function serializeQualitative(dataPoints: QualitativeDP[]): string {
  const cols: CsvColumn<QualitativeDP>[] = [
    { key: "sampleId", header: "Sample ID", format: (r) => r.sampleId ?? "" },
    { key: "reference", header: "Reference / Predicate Method", format: (r) => r.reference ?? r.expected ?? "" },
    { key: "candidate", header: "Candidate Method", format: (r) => r.candidate ?? "" },
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], cols);
}

type SemiQuantDP = {
  sampleId?: string;
  reference?: string | number;
  candidate?: string | number;
};

function serializeSemiQuant(dataPoints: SemiQuantDP[]): string {
  const cols: CsvColumn<SemiQuantDP>[] = [
    { key: "sampleId", header: "Sample ID", format: (r) => r.sampleId ?? "" },
    { key: "reference", header: "Reference Grade", format: (r) => r.reference ?? "" },
    { key: "candidate", header: "Candidate Grade", format: (r) => r.candidate ?? "" },
  ];
  return toCsv(dataPoints as unknown as Record<string, unknown>[], cols);
}

type SensitivityInput = {
  blankReplicates?: Array<{ value: number; lot?: string; day?: number; run?: number }>;
  lowLevelGroups?: Array<{
    expectedConcentration: number;
    replicates: Array<{ value: number; lot?: string; day?: number; run?: number }>;
  }>;
};

function serializeSensitivity(input: SensitivityInput): string {
  const blanks = (input.blankReplicates ?? []).map((r) => ({
    section: "blank",
    lot: r.lot ?? "",
    day: r.day ?? "",
    run: r.run ?? "",
    expectedConcentration: "",
    value: r.value,
  }));
  const lows = (input.lowLevelGroups ?? []).flatMap((g) =>
    (g.replicates ?? []).map((r) => ({
      section: "low_level",
      lot: r.lot ?? "",
      day: r.day ?? "",
      run: r.run ?? "",
      expectedConcentration: g.expectedConcentration,
      value: r.value,
    })),
  );

  return toCsvMultiSection([
    {
      title: "Blank Replicates",
      columns: [
        { key: "lot", header: "Lot" },
        { key: "day", header: "Day" },
        { key: "run", header: "Run" },
        { key: "value", header: "Value" },
      ],
      rows: blanks,
    },
    {
      title: "Low-Level Replicates",
      columns: [
        { key: "expectedConcentration", header: "Expected Concentration" },
        { key: "lot", header: "Lot" },
        { key: "day", header: "Day" },
        { key: "run", header: "Run" },
        { key: "value", header: "Value" },
      ],
      rows: lows,
    },
  ]);
}

// ─── Public entry point ──────────────────────────────────────────────────────

export function studyToCsv(study: Study): string {
  const raw = safeJsonParse<unknown>(study.dataPoints as unknown as string);
  if (!raw) return "";

  switch (study.studyType) {
    case "precision":
      return serializePrecision(raw as PrecisionDP[]);
    case "ref_interval":
      return serializeRefInterval(raw as RefIntervalDP[]);
    case "qc_range":
      return serializeQCRange(raw as QCRangeDP[]);
    case "qualitative":
      return serializeQualitative(raw as QualitativeDP[]);
    case "semi_quantitative":
      return serializeSemiQuant(raw as SemiQuantDP[]);
    case "sensitivity":
      return serializeSensitivity(raw as SensitivityInput);
    case "cal_ver":
    case "method_comparison":
    case "lot_to_lot":
    case "pt_coag":
    case "multi_analyte_coag":
    default:
      return serializeLevelWithInstruments(study, raw as LevelLike[]);
  }
}
