// shared/studyRunDetails.ts
//
// Correlation run details (2026-10-26, Michael: "On correlation studies, give a drop down like what we have for
// precision study. In it, allow them to document reagent lot number, date run, etc."). Optional, entered on the study
// form for Correlation / Method Comparison and Calibration Verification + Correlation:
//   per analyzer   reagent lot, calibrator lot, date run (each analyzer runs its own reagent, so lots are per analyzer)
//   whole study    specimen type (here), result units and a comment (the existing result_units and comment columns)
// Stored as JSON text in studies.run_details. Part of the study record, so it locks with sign-off like the rest.
// Used by the study form, the results page (User Specifications) and the report's Supporting Data (server/pdfReport.ts).

export const RUN_DETAIL_STUDY_TYPES = ["method_comparison", "cal_ver_correlation"] as const;

export function hasRunDetails(studyType: string | null | undefined): boolean {
  return (RUN_DETAIL_STUDY_TYPES as readonly string[]).includes(String(studyType || ""));
}

export interface AnalyzerRunDetails {
  reagentLot?: string;
  calibratorLot?: string;
  dateRun?: string; // YYYY-MM-DD
}

export interface RunDetails {
  specimenType?: string;
  instruments?: Record<string, AnalyzerRunDetails>;
}

const clean = (v: unknown, max = 200): string | undefined => {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  return t || undefined;
};

// Accepts the stored JSON text (or an object) and returns only well-formed, non-empty fields; null when nothing is set.
export function parseRunDetails(raw: unknown): RunDetails | null {
  let obj: any = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || typeof obj !== "object") return null;
  const out: RunDetails = {};
  const specimenType = clean(obj.specimenType);
  if (specimenType) out.specimenType = specimenType;
  const instruments: Record<string, AnalyzerRunDetails> = {};
  for (const [name, v] of Object.entries(obj.instruments || {})) {
    if (!v || typeof v !== "object") continue;
    const a: AnalyzerRunDetails = {};
    const reagentLot = clean((v as any).reagentLot);
    const calibratorLot = clean((v as any).calibratorLot);
    const dateRun = clean((v as any).dateRun, 10);
    if (reagentLot) a.reagentLot = reagentLot;
    if (calibratorLot) a.calibratorLot = calibratorLot;
    if (dateRun && /^\d{4}-\d{2}-\d{2}$/.test(dateRun)) a.dateRun = dateRun;
    if (Object.keys(a).length) instruments[String(name).slice(0, 120)] = a;
  }
  if (Object.keys(instruments).length) out.instruments = instruments;
  return Object.keys(out).length ? out : null;
}

// The JSON text to store, or null when nothing was entered (so an untouched form stores nothing).
export function serializeRunDetails(details: RunDetails | null | undefined): string | null {
  const parsed = parseRunDetails(details ?? null);
  return parsed ? JSON.stringify(parsed) : null;
}

// One line per analyzer, e.g. "Reagent lot 64489UD00 exp 06 Apr 2027; calibrator lot C123; run 2026-10-20".
export function analyzerRunLine(a: AnalyzerRunDetails): string {
  return [
    a.reagentLot ? `Reagent lot ${a.reagentLot}` : "",
    a.calibratorLot ? `calibrator lot ${a.calibratorLot}` : "",
    a.dateRun ? `run ${a.dateRun}` : "",
  ].filter(Boolean).join("; ").replace(/^calibrator/, "Calibrator").replace(/^run /, "Run ");
}

// Label/value rows for display, in study order: specimen type, units, one row per analyzer (in the study's analyzer
// order), comment. Empty when nothing was entered. Values are plain text; the caller escapes for HTML.
export function runDetailRows(
  study: { runDetails?: unknown; resultUnits?: string | null; comment?: string | null },
  analyzerOrder: string[] = [],
): Array<[string, string]> {
  const d = parseRunDetails(study.runDetails) || {};
  const rows: Array<[string, string]> = [];
  if (d.specimenType) rows.push(["Specimen Type", d.specimenType]);
  const units = clean(study.resultUnits);
  if (units) rows.push(["Units", units]);
  const names = Object.keys(d.instruments || {});
  const ordered = [...analyzerOrder.filter((n) => names.includes(n)), ...names.filter((n) => !analyzerOrder.includes(n))];
  for (const name of ordered) {
    const line = analyzerRunLine(d.instruments![name]);
    if (line) rows.push([name, line]);
  }
  const comment = clean(study.comment, 2000);
  if (comment) rows.push(["Comment", comment]);
  return rows;
}
