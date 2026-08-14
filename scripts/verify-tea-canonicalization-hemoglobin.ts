// scripts/verify-tea-canonicalization-hemoglobin.ts
//
// Gate 3 receipt for the VeritaCheck TEa canonicalization fix (Troy Regional,
// 2026-08-14). Rachel picked "Hemoglobin (±4%)" but the stored/report TEa was
// 8% because the server re-derived TEa from the free-text test name and the
// substring matcher collapsed "Hemoglobin" into the earlier-inserted
// "Hemoglobin A1c (HbA1c)" (8%). The fix:
//   1. enforceCanonicalTea trusts an explicit preset selection (no re-derive).
//   2. NAME_MAP maps plain "Hemoglobin"/"HGB"/"Hgb" -> "CBC - Hemoglobin" (4%)
//      for the free-text path.
//
// Imports the REAL engine (resolveCanonicalAnalyte, teaByAnalyte,
// enforceCanonicalTea) so it exercises production code, not a copy.
//
// Run: node_modules/.bin/tsx scripts/verify-tea-canonicalization-hemoglobin.ts
import { resolveCanonicalAnalyte, teaByAnalyte } from "../server/backfillAbsoluteFloor";
import { enforceCanonicalTea } from "../server/storage";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  -> " + detail : ""}`);
  if (!cond) failures++;
}
const teaVal = (analyte: string | null) => {
  if (!analyte) return null;
  const t = teaByAnalyte.get(analyte);
  return t && t.mode === "percent" ? t.value : null;
};

// --- Resolver: "Hemoglobin" must be CBC Hemoglobin (4%), never A1c (8%) ---
check('resolveCanonicalAnalyte("Hemoglobin") = CBC - Hemoglobin',
  resolveCanonicalAnalyte("Hemoglobin") === "CBC - Hemoglobin",
  String(resolveCanonicalAnalyte("Hemoglobin")));
check('resolveCanonicalAnalyte("HGB") = CBC - Hemoglobin',
  resolveCanonicalAnalyte("HGB") === "CBC - Hemoglobin");
check('resolveCanonicalAnalyte("Hgb") = CBC - Hemoglobin',
  resolveCanonicalAnalyte("Hgb") === "CBC - Hemoglobin");
check('CBC - Hemoglobin TEa = 0.04', teaVal("CBC - Hemoglobin") === 0.04);
check('resolveCanonicalAnalyte("Hemoglobin A1c (HbA1c)") stays A1c',
  resolveCanonicalAnalyte("Hemoglobin A1c (HbA1c)") === "Hemoglobin A1c (HbA1c)");
check('Hemoglobin A1c TEa = 0.08', teaVal("Hemoglobin A1c (HbA1c)") === 0.08);

// Same class: plain "Thyroxine"/"T4" resolves to Total T4, not Free T4.
check('resolveCanonicalAnalyte("Thyroxine") = Thyroxine (T4)',
  resolveCanonicalAnalyte("Thyroxine") === "Thyroxine (T4)",
  String(resolveCanonicalAnalyte("Thyroxine")));
check('resolveCanonicalAnalyte("T4") = Thyroxine (T4)',
  resolveCanonicalAnalyte("T4") === "Thyroxine (T4)");
check('"FREE T4" still resolves to Free Thyroxine (unaffected)',
  resolveCanonicalAnalyte("FREE T4") === "Free Thyroxine (Free T4)");

// --- enforceCanonicalTea: trust an explicit preset (Rachel's exact case) ---
const rachel = enforceCanonicalTea({ testName: "Hemoglobin", cliaAllowableError: 0.04, teaIsPercentage: 1, cliaPresetLabel: "Hemoglobin (±4%)" } as any);
check('preset "Hemoglobin (±4%)" keeps 0.04 (not clobbered to 0.08)  [harness bites]',
  (rachel as any).cliaAllowableError === 0.04, String((rachel as any).cliaAllowableError));

const labDefined = enforceCanonicalTea({ testName: "Some Send-Out", cliaAllowableError: 0.123, teaIsPercentage: 1, cliaPresetLabel: "Lab-defined" } as any);
check('preset "Lab-defined" keeps the lab value 0.123',
  (labDefined as any).cliaAllowableError === 0.123);

// --- Free-text path (no preset): "Hemoglobin" now canonicalizes to 4%, not 8% ---
const freeHgb = enforceCanonicalTea({ testName: "Hemoglobin", cliaAllowableError: 0.99, teaIsPercentage: 1 } as any);
check('free-text "Hemoglobin" (no preset) canonicalizes to 0.04  [was 0.08 before fix]',
  (freeHgb as any).cliaAllowableError === 0.04, String((freeHgb as any).cliaAllowableError));

// --- Regression: normal analytes unaffected on the free-text path ---
const albumin = enforceCanonicalTea({ testName: "Albumin", cliaAllowableError: 0.5, teaIsPercentage: 1 } as any);
check('free-text "Albumin" -> 0.08 (unchanged behavior)', (albumin as any).cliaAllowableError === 0.08);
const sodium = enforceCanonicalTea({ testName: "Sodium", cliaAllowableError: 99, teaIsPercentage: 1 } as any);
check('free-text "Sodium" -> absolute 4 mmol/L', (sodium as any).cliaAllowableError === 4 && (sodium as any).teaIsPercentage === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
