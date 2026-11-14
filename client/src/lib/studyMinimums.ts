// client/src/lib/studyMinimums.ts
//
// How much a VeritaCheck form needs before Run Study can save it, and what one counted entry is called, in one place
// (BUG-156, 2026-11-13). The count under the form, the Run Study button and the "Before you can generate the report"
// panel each kept their own copy of these numbers, and they drifted: precision's counter and its submit check took one
// level, while the button and the panel fell through to 3, so a 2-level precision study (the form's default) could
// never be run; the counter also read 3 for carryover (the button needs 12), QC lot verification, accuracy/bias and
// reportable range (the button needs 2). The page's own count of filled entries (filledLevels) is what these compare to.

/** Entries the form must have filled before Run Study. For precision, every level the user chose (1 to 3), each with
 *  at least 3 measurements: an empty level would be saved as a level with no values. */
export function minFilledFor(studyType: string, precisionLevels = 1): number {
  switch (studyType) {
    case "precision": return Math.min(3, Math.max(1, Math.trunc(Number(precisionLevels) || 1)));
    case "ref_interval": return 20;
    case "sensitivity": return 5;
    case "carryover": return 12;
    case "qc_range": return 2;
    case "accuracy_bias": return 2;
    case "linearity": return 3;
    case "reportable_range": return 2;
    default: return 3;
  }
}

/** What one counted entry is, for "3 levels ready" and "Fill 2 more levels". */
export function filledUnitFor(studyType: string): string {
  switch (studyType) {
    case "lot_to_lot":
    case "pt_coag":
    case "ref_interval":
    case "multi_analyte_coag":
      return "specimen";
    case "sensitivity": return "blank replicate";
    case "method_comparison": return "sample";
    case "carryover": return "result";
    default: return "level";
  }
}

/** "1 level", "2 levels", "1 blank replicate". */
export function countOf(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}
