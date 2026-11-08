import { db } from "./db";
import { cliaAnalytes } from "./cliaAnalytes";
import { CFR_MAP } from "./veritamapData";
import { NAME_MAP, regulatedAnalyteFor } from "@shared/regulatedAnalytes";

export { NAME_MAP };

// --- The analytes the startup self-heal and the write guard act on ---
//
// FROZEN. Do not add a row. backfillAbsoluteFloorOnStartup (Pass 2) and enforceCanonicalTea (server/storage.ts) overwrite the criterion on
// any study with no preset label whose name resolves to a row here, so a new row rewrites saved customer studies on the next deploy.
//
// This is NOT the list of regulated analytes. That is client/src/lib/cliaTeaData.ts (all of 42 CFR 493 Subpart I, pinned to the eCFR by
// scripts/verify-citations-tea-cap.py), and the PDF and screen labels read it through shared/regulatedAnalytes.ts. Every row here must
// match that table word for word; scripts/verify-regulated-analyte-labels.ts and script/teaCanonicalRenderAudit.ts fail if one drifts or
// if a row is added. The order matters too: the substring fallback in resolveCanonicalAnalyte takes the first hit.
export const teaData: { analyte: string; criteria: string }[] = [
  { analyte: "Alanine Aminotransferase (ALT/SGPT)", criteria: "±15% or ±6 U/L (greater)" },
  { analyte: "Albumin", criteria: "±8%" },
  { analyte: "Alkaline Phosphatase", criteria: "±20%" },
  { analyte: "Amylase", criteria: "±20%" },
  { analyte: "Aspartate Aminotransferase (AST/SGOT)", criteria: "±15% or ±6 U/L (greater)" },
  { analyte: "Bilirubin, Total", criteria: "±20% or ±0.4 mg/dL (greater)" },
  { analyte: "Blood Gas pCO2", criteria: "±8% or ±5 mm Hg (greater)" },
  { analyte: "Blood Gas pO2", criteria: "±15% or ±15 mmHg (greater)" },
  { analyte: "Blood Gas pH", criteria: "±0.04" },
  { analyte: "B-Natriuretic Peptide (BNP)", criteria: "±30%" },
  { analyte: "Pro B-Natriuretic Peptide (proBNP)", criteria: "±30%" },
  { analyte: "Calcium, Total", criteria: "±1.0 mg/dL" },
  { analyte: "Carbon Dioxide (CO2/Bicarbonate)", criteria: "±20%" },
  { analyte: "Chloride", criteria: "±5%" },
  { analyte: "Cholesterol, Total", criteria: "±10%" },
  { analyte: "Cholesterol, HDL", criteria: "±20% or ±6 mg/dL (greater)" },
  { analyte: "Cholesterol, LDL (direct)", criteria: "±20%" },
  { analyte: "Creatine Kinase (CK)", criteria: "±20%" },
  { analyte: "CK-MB Isoenzymes", criteria: "±25% or ±3 ng/mL (greater) or MB elevated (presence or absence)" }, // verbatim per 42 CFR §493.931
  { analyte: "Creatinine", criteria: "±10% or ±0.2 mg/dL (greater)" },
  { analyte: "Ferritin", criteria: "±20%" },
  { analyte: "Gamma Glutamyl Transferase (GGT)", criteria: "±15% or ±5 U/L (greater)" },
  { analyte: "Glucose (excluding home use devices)", criteria: "±8% or ±6 mg/dL (greater)" },
  { analyte: "Hemoglobin A1c (HbA1c)", criteria: "±8%" },
  { analyte: "Iron, Total", criteria: "±15%" },
  { analyte: "Lactate Dehydrogenase (LDH)", criteria: "±15%" },
  { analyte: "Magnesium", criteria: "±15%" },
  { analyte: "Phosphorus", criteria: "±10% or ±0.3 mg/dL (greater)" },
  { analyte: "Potassium", criteria: "±0.3 mmol/L" },
  { analyte: "Prostate Specific Antigen (PSA), Total", criteria: "±20% or ±0.2 ng/mL (greater)" },
  { analyte: "Sodium", criteria: "±4 mmol/L" },
  { analyte: "Total Iron Binding Capacity (TIBC)", criteria: "±20%" },
  { analyte: "Total Protein", criteria: "±8%" },
  { analyte: "Triglycerides", criteria: "±15%" },
  { analyte: "Troponin I", criteria: "±30% or ±0.9 ng/mL (greater)" },
  { analyte: "Troponin T", criteria: "±30% or ±0.2 ng/mL (greater)" },
  { analyte: "Urea Nitrogen (BUN)", criteria: "±9% or ±2 mg/dL (greater)" },
  { analyte: "Uric Acid", criteria: "±10%" },
  { analyte: "Complement C4", criteria: "±20% or ±5 mg/dL (greater)" },
  { analyte: "C-Reactive Protein (hs-CRP)", criteria: "±30% or ±1 mg/L (greater)" },
  { analyte: "Carcinoembryonic Antigen (CEA)", criteria: "±15% or ±1 ng/mL (greater)" }, // 42 CFR §493.933 (was ng/dL; corrected to ng/mL per CFR)
  { analyte: "Folate, Serum", criteria: "±30% or ±1 ng/mL (greater)" },
  { analyte: "Follicle Stimulating Hormone (FSH)", criteria: "±18% or ±2 IU/L (greater)" },
  { analyte: "Free Thyroxine (Free T4)", criteria: "±15% or ±0.3 ng/dL (greater)" },
  { analyte: "Human Chorionic Gonadotropin (hCG)", criteria: "±18% or ±3 mIU/mL (greater) or positive or negative" }, // verbatim per 42 CFR §493.933
  { analyte: "Testosterone", criteria: "±30% or ±20 ng/dL (greater)" },
  { analyte: "Thyroid Stimulating Hormone (TSH)", criteria: "±20% or ±0.2 mIU/L (greater)" },
  { analyte: "Thyroxine (T4)", criteria: "±20% or ±1.0 mcg/dL (greater)" },
  { analyte: "Vitamin B12", criteria: "±25% or ±30 pg/mL (greater)" },
  { analyte: "Acetaminophen", criteria: "±15% or ±3 mcg/mL (greater)" },
  { analyte: "Blood Lead", criteria: "±10% or ±2 mcg/dL (greater)" },
  { analyte: "Carbamazepine", criteria: "±20% or ±1.0 mcg/mL (greater)" },
  { analyte: "Digoxin", criteria: "±15% or ±0.2 ng/mL (greater)" },
  { analyte: "Lithium", criteria: "±15% or ±0.3 mmol/L (greater)" },
  { analyte: "Phenobarbital", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "Phenytoin (Dilantin)", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "Salicylate", criteria: "±15% or ±2 mcg/mL (greater)" },
  { analyte: "Vancomycin", criteria: "±15% or ±2 mcg/mL (greater)" }, // 42 CFR §493.937 (added under 2022 final rule, 87 FR 41232, effective 2024-07-11)
  // CBC - Hemoglobin: 2022 final rule (87 FR 41232) changed from "±7% or ±1.0 g/dL (greater)" to percent-only "±4%".
  // The absolute floor was removed entirely. Effective 2024-07-11.
  { analyte: "CBC - Hemoglobin", criteria: "±4%" },
];

/**
 * Parse a CLIA criteria string and extract the absolute floor value.
 * Returns { value, unit } or null if no absolute floor (percent-only or absolute-only).
 */
export function parseAbsoluteFloor(criteria: string): { value: number; unit: string } | null {
  const dualMatch = criteria.match(
    /±[\d.]+%\s+or\s+±([\d.]+)\s+([^(]+?)\s*\(greater\)/i
  );
  if (dualMatch) {
    return { value: parseFloat(dualMatch[1]), unit: dualMatch[2].trim() };
  }
  return null;
}

/**
 * Parse the canonical TEa from a criteria string and return:
 *  - { mode: 'percent', value: <fractional> } e.g. "±10% or ±0.2 mg/dL (greater)" -> { mode:'percent', value: 0.10 }
 *  - { mode: 'absolute', value: <number>, unit: <string> } e.g. "±4 mmol/L" -> { mode:'absolute', value:4, unit:'mmol/L' }
 *  - null if not parseable.
 */
export function parseCanonicalTea(criteria: string): { mode: "percent"; value: number } | { mode: "absolute"; value: number; unit: string } | null {
  // Percent first (handles both percent-only "±10%" and dual "±10% or ±0.2 mg/dL (greater)")
  const pct = criteria.match(/±([\d.]+)%/);
  if (pct) {
    return { mode: "percent", value: parseFloat(pct[1]) / 100 };
  }
  // Absolute-only e.g. "±0.04", "±4 mmol/L", "±1.0 mg/dL"
  const abs = criteria.match(/±([\d.]+)\s*([A-Za-z\/\u00b5%]+(?:\s[A-Za-z\/]+)?)?/);
  if (abs) {
    return { mode: "absolute", value: parseFloat(abs[1]), unit: (abs[2] || "").trim() };
  }
  return null;
}

// Build lookup: canonical analyte name -> { value, unit }
export const floorByAnalyte = new Map<string, { value: number; unit: string }>();
for (const entry of teaData) {
  const floor = parseAbsoluteFloor(entry.criteria);
  if (floor !== null) {
    floorByAnalyte.set(entry.analyte, floor);
  }
}

/**
 * Returns true iff `testName` matches an analyte in cliaAnalytes.ts whose tier is
 * "unregulated". Used as a short-circuit guard before the substring fallback in
 * resolveCanonicalAnalyte / resolveFloor: an unregulated analyte must never be
 * canonicalized onto a regulated analyte's TEa via name overlap. The historic bug
 * was MICROALBUMIN (MALB) substring-matching to Albumin (8%), overriding the
 * user's selected 15%.
 */
function isUnregulatedAnalyte(testName: string): boolean {
  const lower = testName.toLowerCase();
  for (const a of cliaAnalytes) {
    if (a.tier !== "unregulated") continue;
    if (a.name.toLowerCase() === lower) return true;
    for (const alias of a.aliases) {
      if (alias.toLowerCase() === lower) return true;
    }
  }
  return false;
}

export function resolveFloor(testName: string): { value: number; unit: string } | null {
  // Short-circuit: unregulated analytes never inherit a regulated analyte's floor
  if (isUnregulatedAnalyte(testName)) return null;
  // 1. Try NAME_MAP (case-insensitive)
  for (const [key, canonical] of Object.entries(NAME_MAP)) {
    if (key.toLowerCase() === testName.toLowerCase()) {
      if (canonical === null) return null;
      return floorByAnalyte.get(canonical) ?? null;
    }
  }

  // 2. Try direct match against canonical names
  if (floorByAnalyte.has(testName)) {
    return floorByAnalyte.get(testName)!;
  }

  // 3. Try case-insensitive substring match against canonical names
  const lower = testName.toLowerCase();
  for (const [analyte, floor] of floorByAnalyte.entries()) {
    if (analyte.toLowerCase().includes(lower) || lower.includes(analyte.toLowerCase())) {
      return floor;
    }
  }

  return null;
}

// Build lookup: canonical analyte name -> canonical TEa
export const teaByAnalyte = new Map<string, { mode: "percent"; value: number } | { mode: "absolute"; value: number; unit: string }>();
for (const entry of teaData) {
  const tea = parseCanonicalTea(entry.criteria);
  if (tea !== null) teaByAnalyte.set(entry.analyte, tea);
}

export function resolveCanonicalAnalyte(testName: string): string | null {
  // Short-circuit: unregulated analytes never canonicalize, even on substring overlap
  if (isUnregulatedAnalyte(testName)) return null;
  for (const [key, canonical] of Object.entries(NAME_MAP)) {
    if (key.toLowerCase() === testName.toLowerCase()) return canonical;
  }
  if (teaByAnalyte.has(testName)) return testName;
  const lower = testName.toLowerCase();
  for (const analyte of Array.from(teaByAnalyte.keys())) {
    if (analyte.toLowerCase().includes(lower) || lower.includes(analyte.toLowerCase())) {
      return analyte;
    }
  }
  return null;
}

// The 42 CFR 493 Subpart I section a study's regulatory sentence should cite
// ("The results ... meet the CLIA criteria per 42 CFR §493.9xx"). A Subpart I
// analyte cites its own table row. Reading the catalog first printed §493.911
// (Bacteriology) on every "AST" study, because the catalog also lists AST as
// Antimicrobial Susceptibility Testing, and §493.931 on "Phenytoin (Dilantin)"
// and "Follicle Stimulating Hormone (FSH)", which it did not find by that name.
// Any other name in the catalog gets its subspecialty's section via the same
// CFR_MAP VeritaMap uses, and "" when that subspecialty has none (Urinalysis).
// §493.931 stays the documented default for a name the catalog does not hold
// (CLAUDE.md §5). The PDF prints a section only for a recognized analyte
// (shared/regulatedAnalytes.ts criterionStanding), so neither of those two
// reaches a report.
export const DEFAULT_CFR_SECTION = "42 CFR §493.931";
export function cfrSectionForTestName(testName: string | null | undefined): string {
  if (!testName) return DEFAULT_CFR_SECTION;
  const raw = String(testName).trim();
  if (!raw) return DEFAULT_CFR_SECTION;
  const row = regulatedAnalyteFor(raw);
  if (row) return `42 CFR ${row.cfr}`;
  const needle = raw.toLowerCase();
  for (const a of cliaAnalytes) {
    if (![a.name, ...a.aliases].some((n) => n.toLowerCase() === needle)) continue;
    const section = CFR_MAP[a.subspecialty] ?? CFR_MAP[a.specialty];
    return section ? `42 CFR ${section}` : "";
  }
  return DEFAULT_CFR_SECTION;
}

/**
 * Backfill clia_absolute_floor AND correct clia_allowable_error / tea_is_percentage
 * when the stored TEa does not match the canonical CLIA TEa for the analyte.
 *
 * - The user's labs cannot enter custom TEa values; analyte selection always supplies
 *   canonical CLIA TEa. Drift here means a UI bug let the wrong value through (such as
 *   the historic Milford CREAT demo button that loaded ALT 15% instead of Creatinine 10%).
 * - This routine self-heals such drift on every startup and is idempotent.
 * - Every change is logged with the study id, test name, and old vs. new values.
 * - Safe: wrapped in try/catch so failures never crash startup.
 */
export function backfillAbsoluteFloorOnStartup(): void {
  try {
    const sqlite = (db as any).$client;

    // Pass 1: legacy floor backfill where the column is NULL, for rows saved before the preset label existed (2026-06-04).
    // BUG-139 (Michael 2026-11-08, Q241 = 1): a row with a preset label holds the criterion the lab picked, "Lab-defined"
    // included, so it is skipped here as Pass 2 skips it. Before, a lab-defined Creatinine at 5% gained a ±0.2 mg/dL
    // floor on the next deploy, and a no-floor preset on "IgE" or "Urine Creatinine" took another analyte's floor
    // through the substring match. Rows it changed before stay as they are; GET /api/admin/veritacheck/floor-backfill-counts
    // counts them for Michael.
    const missingFloor = sqlite
      .prepare(
        "SELECT id, test_name FROM studies WHERE clia_absolute_floor IS NULL AND (clia_preset_label IS NULL OR TRIM(clia_preset_label) = '')"
      )
      .all() as Array<{ id: number; test_name: string }>;

    if (missingFloor.length > 0) {
      const update = sqlite.prepare(
        "UPDATE studies SET clia_absolute_floor = ?, clia_absolute_unit = ? WHERE id = ?"
      );
      let count = 0;
      for (const study of missingFloor) {
        const floor = resolveFloor(study.test_name);
        if (floor !== null) {
          update.run(floor.value, floor.unit, study.id);
          count++;
        }
      }
      if (count > 0) {
        console.log(`[backfill] Set clia_absolute_floor for ${count} studies`);
      } else {
        console.log("[backfill] No studies needed clia_absolute_floor backfill");
      }
    }

    // Pass 2: correct clia_allowable_error / tea_is_percentage / clia_absolute_floor / clia_absolute_unit
    // for any study whose test_name resolves to a canonical analyte but whose stored TEa
    // does not match the canonical TEa. This catches data written by buggy demo buttons
    // or older code paths that hardcoded the wrong preset.
    const all = sqlite
      .prepare(
        "SELECT id, test_name, clia_allowable_error, tea_is_percentage, clia_absolute_floor, clia_absolute_unit, tea_unit, clia_preset_label FROM studies"
      )
      .all() as Array<{
        id: number;
        test_name: string;
        clia_allowable_error: number;
        tea_is_percentage: number | null;
        clia_absolute_floor: number | null;
        clia_absolute_unit: string | null;
        tea_unit: string | null;
        clia_preset_label: string | null;
      }>;

    const updateTea = sqlite.prepare(
      "UPDATE studies SET clia_allowable_error = ?, tea_is_percentage = ?, tea_unit = ?, clia_absolute_floor = ?, clia_absolute_unit = ? WHERE id = ?"
    );

    const FP_TOL = 1e-9;
    let corrected = 0;
    for (const s of all) {
      // Respect an explicit preset selection: if the user picked a TEa preset,
      // that stored value is authoritative and the self-heal must not re-derive
      // it from the free-text test_name (the "Hemoglobin" -> "Hemoglobin A1c"
      // 4%->8% collapse). Legacy rows with no preset label still self-heal.
      if (s.clia_preset_label != null && String(s.clia_preset_label).trim() !== "") continue;
      const canonical = resolveCanonicalAnalyte(s.test_name);
      if (!canonical) continue;
      const canonicalTea = teaByAnalyte.get(canonical);
      if (!canonicalTea) continue;

      let needsUpdate = false;
      let newAllowable = s.clia_allowable_error;
      let newIsPct = s.tea_is_percentage ?? 1;
      let newTeaUnit = s.tea_unit ?? "%";
      let newFloor: number | null = s.clia_absolute_floor;
      let newFloorUnit: string | null = s.clia_absolute_unit;

      if (canonicalTea.mode === "percent") {
        if (Math.abs((s.clia_allowable_error ?? 0) - canonicalTea.value) > FP_TOL) {
          newAllowable = canonicalTea.value;
          needsUpdate = true;
        }
        if ((s.tea_is_percentage ?? 1) !== 1) {
          newIsPct = 1;
          needsUpdate = true;
        }
        if ((s.tea_unit ?? "%") !== "%") {
          newTeaUnit = "%";
          needsUpdate = true;
        }
        // Apply matching floor if we have one canonical-ly; otherwise CLEAR any stale
        // floor on file. This handles regulatory transitions like CBC Hemoglobin under the
        // 2022 final rule (87 FR 41232, eff. 2024-07-11), which moved from dual-criterion
        // "±7% or ±1.0 g/dL (greater)" to percent-only "±4%" (floor removed).
        const canonicalFloor = resolveFloor(s.test_name);
        if (canonicalFloor) {
          if (s.clia_absolute_floor === null || Math.abs(s.clia_absolute_floor - canonicalFloor.value) > FP_TOL) {
            newFloor = canonicalFloor.value;
            needsUpdate = true;
          }
          if (s.clia_absolute_unit !== canonicalFloor.unit) {
            newFloorUnit = canonicalFloor.unit;
            needsUpdate = true;
          }
        } else {
          // No canonical floor for this analyte: clear any stale floor on the row.
          if (s.clia_absolute_floor !== null) {
            newFloor = null;
            needsUpdate = true;
          }
          if (s.clia_absolute_unit !== null) {
            newFloorUnit = null;
            needsUpdate = true;
          }
        }
      } else {
        // absolute-only TEa (e.g. Sodium ±4 mmol/L, Calcium ±1.0 mg/dL)
        if (Math.abs((s.clia_allowable_error ?? 0) - canonicalTea.value) > FP_TOL) {
          newAllowable = canonicalTea.value;
          needsUpdate = true;
        }
        if ((s.tea_is_percentage ?? 1) !== 0) {
          newIsPct = 0;
          needsUpdate = true;
        }
        if (canonicalTea.unit && (s.tea_unit ?? "") !== canonicalTea.unit) {
          newTeaUnit = canonicalTea.unit;
          needsUpdate = true;
        }
        // Absolute-only TEa has no separate floor
        if (s.clia_absolute_floor !== null) {
          newFloor = null;
          needsUpdate = true;
        }
        if (s.clia_absolute_unit !== null) {
          newFloorUnit = null;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        console.log(
          `[backfill] Correcting study ${s.id} (${s.test_name} -> ${canonical}): ` +
          `clia_allowable_error ${s.clia_allowable_error} -> ${newAllowable}, ` +
          `tea_is_percentage ${s.tea_is_percentage} -> ${newIsPct}, ` +
          `tea_unit ${s.tea_unit} -> ${newTeaUnit}, ` +
          `clia_absolute_floor ${s.clia_absolute_floor} -> ${newFloor}, ` +
          `clia_absolute_unit ${s.clia_absolute_unit} -> ${newFloorUnit}`
        );
        updateTea.run(newAllowable, newIsPct, newTeaUnit, newFloor, newFloorUnit, s.id);
        corrected++;
      }
    }

    if (corrected > 0) {
      console.log(`[backfill] Corrected canonical TEa on ${corrected} studies`);
    } else {
      console.log("[backfill] All studies already have canonical CLIA TEa");
    }

    // Pass 3: one-time idempotent correction for study 425 (MICROALBUMIN MALB).
    // Background: MICROALBUMIN (MALB) is unregulated (no CFR-defined TEa). User
    // rodrigo selected custom TEa=15%, but the pre-fix substring resolver
    // collapsed "MICROALBUMIN (MALB)" -> "Albumin" (regulated, 8%) and the write
    // guard in storage.ts then clobbered TEa to 0.08, flipping the verdict to
    // fail. The unregulated short-circuit added in this same commit prevents
    // the substring collapse going forward; this Pass 3 heals the one already-
    // corrupted row. Guarded by exact prior-state match so it is a no-op on
    // every subsequent startup AND a no-op on any other DB (test, dev, fork)
    // that does not have this exact row in this exact state.
    try {
      const target = sqlite
        .prepare(
          "SELECT id, user_id, clia_allowable_error, status, result FROM studies " +
          "WHERE id = 425 AND test_name = 'MICROALBUMIN (MALB)' " +
          "AND clia_allowable_error = 0.08 AND status = 'fail'"
        )
        .get() as { id: number; user_id: number; clia_allowable_error: number; status: string; result: string | null } | undefined;
      if (target) {
        const before = {
          clia_allowable_error: 0.08,
          tea_is_percentage: 1,
          tea_unit: "%",
          clia_absolute_floor: null,
          clia_absolute_unit: null,
          status: "fail",
          result: target.result ?? null,
        };
        const after = {
          clia_allowable_error: 0.15,
          tea_is_percentage: 1,
          tea_unit: "%",
          clia_absolute_floor: null,
          clia_absolute_unit: null,
          status: "pass",
          result: "pass",
        };
        sqlite
          .prepare(
            "UPDATE studies SET clia_allowable_error = 0.15, tea_is_percentage = 1, " +
            "tea_unit = '%', clia_absolute_floor = NULL, clia_absolute_unit = NULL, " +
            "status = 'pass', result = 'pass' WHERE id = 425"
          )
          .run();
        console.log("[backfill] Pass 3: corrected study 425 (MICROALBUMIN MALB) TEa 8% -> 15%, fail -> pass");
        try {
          sqlite
            .prepare(
              "INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json, created_at) " +
              "VALUES (?, ?, 'veritacheck', 'admin_correction', 'study', '425', ?, ?, ?, datetime('now'))"
            )
            .run(
              target.user_id,
              target.user_id,
              "MICROALBUMIN (MALB): substring-resolver bug correction",
              JSON.stringify(before),
              JSON.stringify(after),
            );
        } catch (auditErr: any) {
          console.error("[backfill] Pass 3 audit_log insert failed (correction itself succeeded):", auditErr.message);
        }
      }
    } catch (err: any) {
      console.error("[backfill] Pass 3 error:", err.message);
    }
  } catch (err: any) {
    console.error("[backfill] Error during canonical TEa backfill:", err.message);
  }
}
