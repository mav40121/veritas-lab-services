// The VeritaCheck acceptance criterion: what the page saves from the picker (criterionOf), what Edit puts back in the
// picker for a saved study (readCriterionForm), and whether a saved criterion is the one its preset label names
// (classifyCriterion). Shared so Edit (client/src/lib/studyFormPayload.ts re-exports these) and the server's
// GET /api/admin/veritacheck/criterion-mismatch-counts agree on what "matches" means.
//
// BUG-153 (found 2026-11-10 while fixing BUG-146): Edit put the saved value in the custom box and left the picker on
// its first preset (ALT/SGPT, ±15% or ±6 U/L), so a re-run from Edit was judged and saved on ALT unless the tech picked
// the criterion again. The presets are shared/cliaPresets.ts, passed in.

export interface CriterionPreset { label: string; value: number; isPercentage?: boolean; unit?: string; absoluteFloor?: number; absoluteUnit?: string }
// A criterion as stored: value is a fraction when isPercentage, else the number itself in its unit (Sodium 4 mmol/L).
export interface SavedCriterion { value: number; isPercentage: boolean; unit: string | null; absoluteFloor: number | null; absoluteUnit: string | null; label: string | null }
export interface CriterionPick {
  presetIndex: number;
  customClia: number; customAbsFloor: number | null; customAbsUnit: string;
  saved: SavedCriterion | null;   // Edit holds the saved criterion as it is until the tech picks another
}
export interface Criterion {
  cliaValue: number; teaIsPercentage: boolean; teaUnit: string;
  cliaAbsoluteFloor: number | null; cliaAbsoluteUnit: string | null; cliaPresetLabel: string | null;
}
export const LAB_DEFINED_LABEL = "Lab-defined";
// The study types whose Run Study stores its own fixed criterion (PT/INR judges each module by its own TEa, typed on its form).
export const FIXED_CRITERION_TYPES = new Set(["qc_range", "multi_analyte_coag", "ref_interval", "carryover", "pt_coag", "sensitivity"]);
// BUG-160 (2026-11-10): those types took the label from the shared picker, which none of them reads (sensitivity's was
// hidden and still saved ALT/SGPT, its first preset), so a QC lot verification could be saved "ALT/SGPT ...". The form
// hides the picker on them and saves this instead. Never blank: BUG-139's floor backfill reads a blank label as a row
// saved before labels. It doesn't print (printedPresetLabel gives null for these types) and classifyCriterion reads them
// as fixedType, so it never counts as a mismatch.
export const FIXED_CRITERION_LABEL = "Set by study type";
export function savedPresetLabel(studyType: string, pickerLabel: string | null): string | null {
  return FIXED_CRITERION_TYPES.has(studyType) ? FIXED_CRITERION_LABEL : pickerLabel;
}
// The parts of a saved criterion a label's preset may fail to give back.
export type CriterionMismatchReason = "value" | "units" | "floor" | "floorUnit";

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

// What the page saves from the picker: the preset's criterion, the custom box (the last preset, "Custom"; a lab-set
// preset with no CLIA value also reads the box), or the saved criterion Edit is holding.
export function criterionOf(presets: CriterionPreset[], s: CriterionPick): Criterion {
  if (s.saved) {
    const v = s.saved;
    return { cliaValue: v.value, teaIsPercentage: v.isPercentage, teaUnit: v.unit ?? (v.isPercentage ? "%" : ""), cliaAbsoluteFloor: v.absoluteFloor, cliaAbsoluteUnit: v.absoluteUnit, cliaPresetLabel: v.label };
  }
  const p = presets[s.presetIndex] ?? presets[0];
  const isCustom = s.presetIndex === presets.length - 1;
  // A custom floor counts only when it is a positive number (a 0 floor would make max(pct, 0) pass everything).
  const floor = isCustom && s.customAbsFloor != null && s.customAbsFloor > 0 ? s.customAbsFloor : null;
  return {
    cliaValue: p.value !== 0 ? p.value : s.customClia,
    teaIsPercentage: p.isPercentage !== false,
    teaUnit: p.unit || "%",
    cliaAbsoluteFloor: isCustom ? floor : (p.absoluteFloor ?? null),
    cliaAbsoluteUnit: isCustom ? (floor != null ? (s.customAbsUnit.trim() || null) : null) : (p.absoluteUnit ?? null),
    cliaPresetLabel: p.value !== 0 ? p.label : LAB_DEFINED_LABEL,
  };
}

// A saved row's criterion, from a client row (camelCase) or a database row (snake_case).
export function savedCriterionOf(row: any): SavedCriterion {
  const rawValue = row?.cliaAllowableError ?? row?.clia_allowable_error;
  const pct = row?.teaIsPercentage ?? row?.tea_is_percentage;
  const unit = row?.teaUnit ?? row?.tea_unit;
  const floor = row?.cliaAbsoluteFloor ?? row?.clia_absolute_floor;
  const floorUnit = row?.cliaAbsoluteUnit ?? row?.clia_absolute_unit;
  const label = row?.cliaPresetLabel ?? row?.clia_preset_label;
  return {
    value: isNum(rawValue) ? rawValue : 0,
    isPercentage: pct !== 0,   // as the server reads it: only 0 is a units criterion
    unit: typeof unit === "string" ? unit : null,
    absoluteFloor: isNum(floor) ? floor : null,
    absoluteUnit: typeof floorUnit === "string" && floorUnit ? floorUnit : null,
    label: typeof label === "string" && label.trim() ? label.trim() : null,
  };
}

// How a saved criterion stands against the label it carries:
//   matches       the label's preset (or Custom, for "Lab-defined") gives back the saved value, percent or units, and floor
//   mismatch      the label names a preset (or "Lab-defined") that can't give it back; `reasons` says which parts differ
//   fixedType     a type that stores its own fixed criterion, saved with FIXED_CRITERION_LABEL (BUG-160) or with a label
//                 naming a preset (before BUG-160): only the label matters
//   noLabel       no preset label (saved before labels, 2026-06-04)
//   unknownLabel  a label no preset carries (a renamed preset, or a form's own label such as manual differential's)
// The value's unit (teaUnit) isn't compared: Run Study writes it from the preset, or for accuracy/bias, linearity and
// reportable range from the form's units.
export function classifyCriterion(row: any, presets: CriterionPreset[]): {
  kind: "matches" | "mismatch" | "fixedType" | "noLabel" | "unknownLabel";
  reasons: CriterionMismatchReason[]; presetIndex: number; custom: { clia: number; absFloor: number | null; absUnit: string } | null; saved: SavedCriterion;
} {
  const studyType: string = row?.studyType ?? row?.study_type ?? "";
  const saved = savedCriterionOf(row);
  const customIdx = presets.length - 1;
  let presetIndex = -1;
  let custom: { clia: number; absFloor: number | null; absUnit: string } | null = null;
  if (saved.label === LAB_DEFINED_LABEL) {
    presetIndex = customIdx;
    custom = { clia: saved.value, absFloor: saved.absoluteFloor, absUnit: saved.absoluteUnit ?? "" };
  } else if (saved.label) {
    presetIndex = presets.findIndex((p, i) => i !== customIdx && p.value !== 0 && p.label === saved.label);
  }
  if (!saved.label) return { kind: "noLabel", reasons: [], presetIndex, custom, saved };
  if (saved.label === FIXED_CRITERION_LABEL && FIXED_CRITERION_TYPES.has(studyType)) return { kind: "fixedType", reasons: [], presetIndex, custom, saved };
  if (presetIndex < 0) return { kind: "unknownLabel", reasons: [], presetIndex, custom, saved };
  if (FIXED_CRITERION_TYPES.has(studyType)) return { kind: "fixedType", reasons: [], presetIndex, custom, saved };
  const c = criterionOf(presets, { presetIndex, customClia: custom?.clia ?? 0, customAbsFloor: custom?.absFloor ?? null, customAbsUnit: custom?.absUnit ?? "", saved: null });
  const unitKey = (u: string | null) => (u ?? "").replace(/\s+/g, "").toLowerCase();
  const savedFloor = saved.absoluteFloor != null && saved.absoluteFloor > 0 ? saved.absoluteFloor : null;
  const reasons: CriterionMismatchReason[] = [];
  if (Math.abs(c.cliaValue - saved.value) >= 1e-9) reasons.push("value");
  if (c.teaIsPercentage !== saved.isPercentage) reasons.push("units");
  if ((c.cliaAbsoluteFloor ?? null) !== savedFloor) reasons.push("floor");
  else if (c.cliaAbsoluteFloor != null && unitKey(c.cliaAbsoluteUnit) !== unitKey(saved.absoluteUnit)) reasons.push("floorUnit");
  return { kind: reasons.length ? "mismatch" : "matches", reasons, presetIndex, custom, saved };
}

// What Edit puts in the picker for a saved draft or finished study: the preset its label names, or Custom with the
// saved value and floor for "Lab-defined". When that pick doesn't give back the saved criterion (classifyCriterion says
// mismatch, no label or a label no preset carries), Edit holds the saved criterion as it is (`saved`), so nothing
// changes unless the tech picks another criterion. A type that stores its own fixed criterion only needs its label back.
export function readCriterionForm(row: any, presets: CriterionPreset[]): { presetIndex: number; custom: { clia: number; absFloor: number | null; absUnit: string } | null; saved: SavedCriterion | null } {
  const k = classifyCriterion(row, presets);
  const reproduces = k.kind === "matches" || k.kind === "fixedType";
  return { presetIndex: k.presetIndex >= 0 ? k.presetIndex : 0, custom: k.custom, saved: reproduces ? null : k.saved };
}

// The preset name the results screen and the PDF print beside a study's criterion (Michael 2026-11-10, Q275 = 1). The saved
// label, except:
//   - a type that sets its own criterion: the picker's label there is stray (BUG-147 on the PDF, BUG-159 on the screen);
//   - a label naming a preset whose criterion isn't the stored one (classifyCriterion "mismatch"): an Edit re-run before
//     BUG-153 saved ALT/SGPT's name over other tests' criteria, so a signed HbA1c study printed "±8.0% (ALT/SGPT ...)".
//     The stored criterion prints alone; the stored data is untouched.
// A label that isn't a picker preset (manual differential's Rümke, heparin range's sample set) prints as saved.
export function printedPresetLabel(row: any, presets: CriterionPreset[]): string | null {
  const studyType: string = row?.studyType ?? row?.study_type ?? "";
  if (FIXED_CRITERION_TYPES.has(studyType)) return null;
  const k = classifyCriterion(row, presets);
  return k.kind === "mismatch" ? null : k.saved.label;
}
