// shared/veritamapSpecimen.ts
//
// Specimen type for VeritaMap reference ranges and AMRs (2026-10-19, Lindsay Webber, Redington-Fairview, REQ-079:
// "Take calcium for example. With a Vitros we run urine and serum/plasma using the same reagent. The fluid types have
// different reference ranges and AMRs."). It is the third part of a reference-range band (with age and sex) and a
// second part of an AMR row (with the instrument). '' means all specimen types, which is what every value meant
// before this existed. The lab names its own specimen types; the list below is only a suggestion.

export const ALL_SPECIMENS = "";
export const SPECIMEN_MAX_LENGTH = 40;
export const SPECIMEN_SUGGESTIONS = [
  "Serum/Plasma", "Serum", "Plasma", "Whole Blood", "Urine", "Urine, 24-hour", "CSF", "Body Fluid",
] as const;

// Trim, collapse inner spaces, and refuse anything too long. Never guesses: an unreadable value is an error, because a
// reference range filed under the wrong specimen type is a clinical error.
export function normalizeSpecimen(v: unknown): { specimen: string } | { error: string } {
  if (v === undefined || v === null) return { specimen: ALL_SPECIMENS };
  if (typeof v !== "string") return { error: "specimen_type must be text" };
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > SPECIMEN_MAX_LENGTH) return { error: `specimen_type must be ${SPECIMEN_MAX_LENGTH} characters or fewer` };
  if (/^all( specimen types)?$/i.test(s)) return { specimen: ALL_SPECIMENS };
  return { specimen: s };
}

export function specimenLabel(s: string | null | undefined): string {
  return s ? s : "All specimen types";
}

// Reportable range and maximum dilution (REQ-080): lab-entered text like AMR (e.g. "1.0", ">5000", "1:10"). Trimmed;
// blank stays blank; nothing is calculated or filled in for the lab.
export const REPORTABLE_MAX_LENGTH = 30;
export function normalizeReportableField(v: unknown, name: string): { value: string | null } | { error: string } {
  if (v === undefined || v === null) return { value: null };
  const s = String(v).trim();
  if (!s) return { value: null };
  if (s.length > REPORTABLE_MAX_LENGTH) return { error: `${name} must be ${REPORTABLE_MAX_LENGTH} characters or fewer` };
  return { value: s };
}
