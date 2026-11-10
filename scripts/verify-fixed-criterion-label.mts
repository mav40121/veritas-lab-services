// scripts/verify-fixed-criterion-label.mts
//
// Receipt for BUG-160 (2026-11-10). Six study types store their own fixed criterion (QC lot verification, multi-analyte
// coag, reference range, carryover, PT/INR, sensitivity), yet the form showed the shared criterion picker on five of
// them and every one saved the picker's label, so a QC lot verification or a sensitivity study (whose picker was hidden)
// was saved "ALT/SGPT (±15% or ±6 U/L)". The form now hides the picker on them and saves "Set by study type".
// Checks:
//   A. savedPresetLabel: each fixed type gets the fixed label whatever the picker holds; every other type keeps the
//      picker's label, a null one too.
//   B. The fixed label is never blank, and classifyCriterion reads such a row as fixedType (not a mismatch).
//   C. BUG-139's floor backfill leaves a fixed-type row with the label alone, where the same row with no label gets a
//      floor (so the check would catch a blank label).
// Run: rm -f .tmp-fixedcrit.db && DB_PATH=.tmp-fixedcrit.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-fixed-criterion-label.mts
import { FIXED_CRITERION_TYPES, FIXED_CRITERION_LABEL, savedPresetLabel, classifyCriterion, printedPresetLabel } from "../shared/studyCriterion";
import { CLIA_PRESETS } from "../shared/cliaPresets";
import { db } from "../server/db";
import { backfillAbsoluteFloorOnStartup } from "../server/backfillAbsoluteFloor";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

// ── A ──
const ALT = CLIA_PRESETS[0].label;
const FIXED = ["qc_range", "multi_analyte_coag", "ref_interval", "carryover", "pt_coag", "sensitivity"];
check("A1. the six fixed types are the ones listed", FIXED.length === FIXED_CRITERION_TYPES.size && FIXED.every((t) => FIXED_CRITERION_TYPES.has(t)));
check(`A2. each fixed type saves "${FIXED_CRITERION_LABEL}" with the picker on ${ALT}`, FIXED.every((t) => savedPresetLabel(t, ALT) === FIXED_CRITERION_LABEL), JSON.stringify(FIXED.map((t) => savedPresetLabel(t, ALT))));
check("A3. ... and with the picker on Custom (Lab-defined) or empty", FIXED.every((t) => savedPresetLabel(t, "Lab-defined") === FIXED_CRITERION_LABEL && savedPresetLabel(t, null) === FIXED_CRITERION_LABEL));
const PICKER_TYPES = ["cal_ver", "cal_ver_correlation", "method_comparison", "precision", "lot_to_lot", "accuracy_bias", "linearity", "reportable_range"];
check("A4. every type that uses the picker keeps its label (a preset, Lab-defined, or none)",
  PICKER_TYPES.every((t) => savedPresetLabel(t, ALT) === ALT && savedPresetLabel(t, "Lab-defined") === "Lab-defined" && savedPresetLabel(t, null) === null));
check("A5. manual differential and heparin (forms that save their own label) aren't fixed types", !FIXED_CRITERION_TYPES.has("manual_diff") && !FIXED_CRITERION_TYPES.has("heparin_range"));

// ── B ──
check("B1. the fixed label isn't blank", FIXED_CRITERION_LABEL.trim().length > 0);
check("B2. no CLIA preset carries the fixed label (it can't be read as a preset)", !CLIA_PRESETS.some((p) => p.label === FIXED_CRITERION_LABEL));
const kinds = FIXED.map((t) => classifyCriterion({ studyType: t, cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: FIXED_CRITERION_LABEL }, CLIA_PRESETS).kind);
check("B3. classifyCriterion reads each saved row as fixedType (the admin counts' bucket), never a mismatch or an unknown label", kinds.every((k) => k === "fixedType"), JSON.stringify(kinds));
const onLot = classifyCriterion({ studyType: "lot_to_lot", cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: FIXED_CRITERION_LABEL }, CLIA_PRESETS).kind;
check("B4. ... and only on a fixed type: the same label on a lot-to-lot row is an unknown label", onLot === "unknownLabel", onLot);
const before = classifyCriterion({ studyType: "qc_range", cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: ALT }, CLIA_PRESETS).kind;
check("B5. a fixed-type row saved before this fix with the picker's label still reads fixedType, as it did", before === "fixedType", before);
const printed = FIXED.map((t) => printedPresetLabel({ studyType: t, cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: FIXED_CRITERION_LABEL }, CLIA_PRESETS));
check("B6. the label never prints beside a criterion (printedPresetLabel, Q275, gives null for every fixed type)", printed.every((p) => p === null), JSON.stringify(printed));

// ── C ──
const sqlite = (db as any).$client;
sqlite.pragma("foreign_keys = OFF");
const ins = sqlite.prepare(`INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit,
  clia_absolute_floor, clia_absolute_unit, clia_preset_label, data_points, instruments, status, lifecycle_state, created_at)
  VALUES (1, 920, 'Creatinine', 'Made-up Analyzer', 'made-up', '2026-11-10', 'carryover', 0.01, 1, '%', NULL, NULL, @label, '[]', '["Made-up Analyzer"]', 'pass', 'draft', '2026-11-10T00:00:00Z')`);
const labeled = Number(ins.run({ label: FIXED_CRITERION_LABEL }).lastInsertRowid);
const blank = Number(ins.run({ label: null }).lastInsertRowid);
backfillAbsoluteFloorOnStartup();
const floorOf = (id: number) => (sqlite.prepare("SELECT clia_absolute_floor AS f FROM studies WHERE id = ?").get(id) as any)?.f ?? null;
check("C1. the floor backfill leaves a carryover row saved with the fixed label alone", floorOf(labeled) === null, String(floorOf(labeled)));
check("C2. ... where the same row with no label is given a floor (the check would catch a blank label)", floorOf(blank) !== null, String(floorOf(blank)));

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
