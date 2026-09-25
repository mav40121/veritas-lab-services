// shared/ptFailure.ts
//
// PT-failure investigation constants + CLIA proficiency-testing scoring, shared
// by the VeritaResponse PT-failure form (client) and the server/verify script.
//
// CLIA 42 CFR 493.801(b): the laboratory must investigate unsuccessful PT and
// document corrective action. Scoring (493.837 / 493.843 family): an analyte is
// acceptable at >= 80% of a testing event, EXCEPT ABO group / Rh type and
// compatibility (immunohematology), which require 100%. "Unsuccessful
// performance" for an analyte is failure to attain the threshold OR failure to
// participate; the regulatory consequence attaches when it repeats (two
// consecutive, or two of three consecutive, testing events).
//
// No em dashes in any user-facing label (CLAUDE.md section 3).

export const PT_ROOT_CAUSE_CATEGORIES = [
  { value: "clerical", label: "Clerical / transcription (result recording, form entry)" },
  { value: "methodology", label: "Methodology / analytic (calibration, reagent, method limitation)" },
  { value: "technical", label: "Technical (operator technique, procedure not followed)" },
  { value: "pt_material", label: "PT material / specimen (matrix effect, handling, mislabel)" },
  { value: "instrument", label: "Instrument / equipment (malfunction, maintenance lapse)" },
  { value: "no_explanation", label: "No explanation found after investigation" },
] as const;

export type PtRootCauseCategory = typeof PT_ROOT_CAUSE_CATEGORIES[number]["value"];
export type PtAnalyteClass = "immunohematology" | "general";
export type PtEventResult = "acceptable" | "unsuccessful";

// Passing threshold (percent) for a single analyte in one PT event.
export function ptPassingThreshold(cls: PtAnalyteClass): number {
  return cls === "immunohematology" ? 100 : 80;
}

// Classify one analyte's score for one testing event. A non-finite score
// (e.g. failure to participate / no result) is unsuccessful by rule.
export function classifyPtScore(scorePct: number, cls: PtAnalyteClass = "general"): PtEventResult {
  if (!Number.isFinite(scorePct)) return "unsuccessful";
  return scorePct >= ptPassingThreshold(cls) ? "acceptable" : "unsuccessful";
}

// CLIA "unsuccessful performance" pattern across recent events for one analyte,
// ordered oldest-to-newest. True when the two most recent are unsuccessful, or
// two of the last three are unsuccessful.
export function isUnsuccessfulPattern(recent: PtEventResult[]): boolean {
  const n = recent.length;
  if (n >= 2 && recent[n - 1] === "unsuccessful" && recent[n - 2] === "unsuccessful") return true;
  if (n >= 3 && recent.slice(n - 3).filter((r) => r === "unsuccessful").length >= 2) return true;
  return false;
}

export function rootCauseLabel(value: string | null | undefined): string {
  return PT_ROOT_CAUSE_CATEGORIES.find((c) => c.value === value)?.label || "";
}
