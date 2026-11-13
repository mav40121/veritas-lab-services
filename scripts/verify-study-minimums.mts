// scripts/verify-study-minimums.mts
//
// BUG-156 (2026-11-13): client/src/lib/studyMinimums.ts is the one minimum the VeritaCheck form's count, Run Study
// button and "Before you can generate the report" panel read. Pins:
//   1. every study type's minimum is the Run Study button's number from before (main 7e3a0ecd), so no other type moves;
//   2. precision needs every chosen level (1 to 3), clamped, never 0;
//   3. the count's old numbers differed from the button for precision, carryover, QC lot verification, accuracy/bias and
//      reportable range (the drift this fixes), and now there is one number;
//   4. the unit words and the singular/plural.
// Run: npx tsx scripts/verify-study-minimums.mts
import { minFilledFor, filledUnitFor, countOf } from "../client/src/lib/studyMinimums";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`); if (!ok) failures++; };

// The Run Study button's disabled check on main 7e3a0ecd, copied as it was.
const oldButton = (t: string) => (t === "ref_interval" ? 20 : t === "sensitivity" ? 5 : t === "carryover" ? 12 : t === "qc_range" ? 2 : t === "accuracy_bias" ? 2 : t === "linearity" ? 3 : t === "reportable_range" ? 2 : 3);
// The count under the form on main 7e3a0ecd.
const oldCount = (t: string) => (t === "precision" ? 1 : t === "ref_interval" ? 20 : t === "sensitivity" ? 5 : 3);
const TYPES = ["cal_ver", "cal_ver_correlation", "method_comparison", "precision", "lot_to_lot", "pt_coag", "qc_range", "multi_analyte_coag",
  "ref_interval", "sensitivity", "carryover", "accuracy_bias", "linearity", "reportable_range", "manual_diff", "heparin_range", "cumsum", "something_new"];

// 1. Every type but precision keeps the button's number.
const moved = TYPES.filter((t) => t !== "precision" && minFilledFor(t) !== oldButton(t));
check("1. every study type but precision keeps the Run Study button's minimum", moved.length === 0, moved.join(", "));
check("1. an unknown type gets 3, as the button's default did", minFilledFor("something_new") === 3);

// 2. Precision: every chosen level.
check("2. precision with 1, 2 and 3 levels needs 1, 2 and 3", [1, 2, 3].every((n) => minFilledFor("precision", n) === n), [1, 2, 3].map((n) => minFilledFor("precision", n)).join(","));
check("2. precision clamps to 1..3 and never reads 0", minFilledFor("precision", 0) === 1 && minFilledFor("precision", 7) === 3 && minFilledFor("precision", NaN) === 1 && minFilledFor("precision") === 1 && minFilledFor("precision", 2.6) === 2);
check("2. the form's default of 2 levels was blocked before (button 3) and runs now with both filled", oldButton("precision") === 3 && minFilledFor("precision", 2) === 2);

// 3. The drift, and one number now.
const drift = TYPES.filter((t) => oldCount(t) !== oldButton(t));
check("3. before, the count and the button disagreed on exactly these types", JSON.stringify(drift) === JSON.stringify(["precision", "qc_range", "carryover", "accuracy_bias", "reportable_range"]), drift.join(", "));

// 4. Words.
check("4. unit words", filledUnitFor("precision") === "level" && filledUnitFor("lot_to_lot") === "specimen" && filledUnitFor("pt_coag") === "specimen"
  && filledUnitFor("ref_interval") === "specimen" && filledUnitFor("multi_analyte_coag") === "specimen" && filledUnitFor("sensitivity") === "blank replicate"
  && filledUnitFor("method_comparison") === "sample" && filledUnitFor("carryover") === "result" && filledUnitFor("cal_ver") === "level");
check("4. singular and plural", countOf(1, "level") === "1 level" && countOf(2, "level") === "2 levels" && countOf(0, "specimen") === "0 specimens" && countOf(1, "more level") === "1 more level");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
