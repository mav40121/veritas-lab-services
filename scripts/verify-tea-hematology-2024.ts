// Verify receipt for the 2024 §493.941 hematology + CEA-unit correction to the
// client TEa table (2026-10-04, Michael-approved against the eCFR §493.941 Table 2).
// Locks the corrected values against regression and confirms the deliberately
// UNCHANGED ones stayed put.
//
// Run: node_modules/.bin/tsx scripts/verify-tea-hematology-2024.ts
import { teaData, hasCanonicalTea } from "../client/src/lib/cliaTeaData";

let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  -> " + detail : ""}`);
  if (!cond) fail++;
}
const crit = (n: string) => teaData.find((r) => r.analyte === n)?.criteria;

// ── Corrected to the 2024 §493.941 Table 2 ──────────────────────────────
check("CBC - Hemoglobin = ±4% (was ±7% or ±1.0 g/dL)", crit("CBC - Hemoglobin") === "±4%", String(crit("CBC - Hemoglobin")));
check("CBC - RBC = ±4% (was ±6%)", crit("CBC - RBC (Red Blood Cell Count)") === "±4%", String(crit("CBC - RBC (Red Blood Cell Count)")));
check("CBC - Hematocrit = ±4% (was ±6%)", crit("CBC - Hematocrit") === "±4%", String(crit("CBC - Hematocrit")));
check("CBC - WBC = ±10% (was ±15%)", crit("CBC - WBC (White Blood Cell Count)") === "±10%", String(crit("CBC - WBC (White Blood Cell Count)")));
const cea = crit("Carcinoembryonic Antigen (CEA)") || "";
check("CEA floor unit = ng/mL, not ng/dL", cea.includes("ng/mL") && !cea.includes("ng/dL"), cea);

// ── Deliberately UNCHANGED (already correct per §493.941) ───────────────
check("CBC - Platelet Count unchanged = ±25%", crit("CBC - Platelet Count") === "±25%", String(crit("CBC - Platelet Count")));
check("Fibrinogen unchanged = ±20%", crit("Fibrinogen") === "±20%", String(crit("Fibrinogen")));
check("INR unchanged = ±15%", crit("INR (International Normalized Ratio)") === "±15%", String(crit("INR (International Normalized Ratio)")));

// ── Flagged-for-Michael items left UNCHANGED (not in §493.941 Table 2) ──
check("CBC - MCV left unchanged (flagged, not auto-edited) = ±7%", crit("CBC - MCV (Mean Corpuscular Volume)") === "±7%", String(crit("CBC - MCV (Mean Corpuscular Volume)")));

// ── Regression: exact-match canonical lookup still works ────────────────
check("hasCanonicalTea('CBC - Hemoglobin') still true", hasCanonicalTea("CBC - Hemoglobin") === true);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
