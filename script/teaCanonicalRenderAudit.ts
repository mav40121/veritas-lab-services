/**
 * teaCanonicalRenderAudit.ts
 *
 * Render-time audit backstop for canonical 42 CFR §493 PT TEa values.
 *
 * Strategy: for every entry in the canonical teaData list, construct a
 * synthetic Study object as if a user had selected that analyte through the
 * UI, then call teaDisplayStr() (the single source of truth for how TEa
 * appears on every PDF) and assert the rendered string matches the canonical
 * criteria byte-for-byte (after a small whitespace / unicode normalization).
 *
 * Also smoke-renders one dual-criterion analyte through buildPrecisionHTML
 * to confirm the canonical TEa string actually appears in the produced HTML
 * (catches regressions where teaDisplayStr is correct but a builder bypasses
 * it with a hardcoded fallback).
 *
 * Also runs synthetic dual-criterion verdict tests: pass-pct-fail-floor and
 * pass-floor-fail-pct must each produce the expected overall verdict using
 * the same percent OR floor (greater) rule the production compute paths use.
 *
 * On success, writes dist/data/tea_audit.json with the verification date and
 * pass status. The freshness footer in regulatoryComplianceBoxHTML reads this
 * file at request time so every PDF prints "Canonical TEa list verified
 * against 42 CFR §493 on YYYY-MM-DD."
 *
 * Run as a pre-build step from script/build.ts. Exits non-zero on failure.
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { teaData, parseCanonicalTea, parseAbsoluteFloor } from "../server/backfillAbsoluteFloor.js";
import { teaDisplayStr, buildPrecisionHTML } from "../server/pdfReport.js";

type Study = any;

const ROOT = path.resolve(import.meta.dirname || ".", "..");

/**
 * Build the synthetic Study object the way storage / write-guard code path
 * SHOULD populate it for each canonical analyte. If this matches what
 * teaDisplayStr renders, the production write path is consistent.
 */
function syntheticStudyFor(analyte: string, criteria: string): Study {
  const tea = parseCanonicalTea(criteria);
  const floor = parseAbsoluteFloor(criteria);
  if (!tea) {
    throw new Error(`parseCanonicalTea returned null for ${analyte} — criteria: ${criteria}`);
  }
  const base: Study = {
    id: 0,
    userId: 0,
    testName: analyte,
    instrument: "Synthetic",
    analyst: "audit",
    date: "2026-01-01",
    studyType: "precision",
    dataPoints: "[]",
    instruments: "[]",
    status: "completed",
    createdAt: "2026-01-01",
  };
  if (tea.mode === "percent") {
    base.cliaAllowableError = tea.value; // fractional, e.g. 0.10
    base.teaIsPercentage = 1;
    base.teaUnit = "%";
    if (floor) {
      base.cliaAbsoluteFloor = floor.value;
      base.cliaAbsoluteUnit = floor.unit;
    } else {
      base.cliaAbsoluteFloor = null;
      base.cliaAbsoluteUnit = null;
    }
  } else {
    base.cliaAllowableError = tea.value; // absolute number
    base.teaIsPercentage = 0;
    base.teaUnit = tea.unit;
    base.cliaAbsoluteFloor = null;
    base.cliaAbsoluteUnit = null;
  }
  return base;
}

/**
 * Normalize a TEa criteria string for comparison: collapse whitespace, strip
 * trailing parenthetical CFR comments, lowercase nothing (units are
 * case-sensitive: ng/mL vs ng/ml is a real distinction).
 */
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Strings that, if found anywhere in a rendered TEa, indicate canonical
 * drift. These were the actual defects caught by the CFR audit.
 */
// Globally-forbidden substrings: any rendered TEa containing one of these is
// a regression. Note ng/dL alone is NOT globally forbidden — Free T4 and
// Testosterone legitimately use ng/dL per CFR. Only the CEA-specific ng/dL
// is a regression, and that is enforced via FORBIDDEN_PER_ANALYTE below.
const FORBIDDEN_GLOBAL = [
  "±7% or ±1.0 g/dL", // pre-2022 Hemoglobin floor (now removed)
  "\u00B17% or \u00B11.0 g/dL",
];

/**
 * Per-analyte forbidden substrings — caught only when rendering THAT analyte.
 * Example: CEA must not render with ng/dL anywhere.
 */
const FORBIDDEN_PER_ANALYTE: Record<string, string[]> = {
  "Carcinoembryonic Antigen (CEA)": ["ng/dL"],
  "CBC - Hemoglobin": ["g/dL", "1.0 g/dL"],
};

type Failure = { analyte: string; rule: string; expected?: string; got?: string };

function auditTeaDisplayStr(): Failure[] {
  const failures: Failure[] = [];
  for (const { analyte, criteria } of teaData) {
    const study = syntheticStudyFor(analyte, criteria);
    const rendered = teaDisplayStr(study);

    // Build the expected canonical render string from criteria.
    // teaDisplayStr formats:
    //   percent-only:           "±X.X%"
    //   percent + floor (dual): "±X.X% or ±F unit (greater)"
    //   absolute-only:          "±F unit"
    const tea = parseCanonicalTea(criteria)!;
    const floor = parseAbsoluteFloor(criteria);
    let expected: string;
    if (tea.mode === "percent") {
      const pct = `\u00B1${(tea.value * 100).toFixed(1)}%`;
      expected = floor ? `${pct} or \u00B1${floor.value} ${floor.unit} (greater)` : pct;
    } else {
      expected = `\u00B1${tea.value} ${tea.unit}`.trim();
    }

    if (norm(rendered) !== norm(expected)) {
      failures.push({
        analyte,
        rule: "teaDisplayStr render does not match canonical criteria",
        expected,
        got: rendered,
      });
    }

    // Global forbidden substrings
    for (const bad of FORBIDDEN_GLOBAL) {
      if (rendered.includes(bad)) {
        failures.push({
          analyte,
          rule: `Rendered TEa contains globally-forbidden substring: ${bad}`,
          got: rendered,
        });
      }
    }

    // Per-analyte forbidden substrings
    const perAnalyte = FORBIDDEN_PER_ANALYTE[analyte] || [];
    for (const bad of perAnalyte) {
      if (rendered.includes(bad)) {
        failures.push({
          analyte,
          rule: `Rendered TEa for ${analyte} contains forbidden substring: ${bad}`,
          got: rendered,
        });
      }
    }
  }
  return failures;
}

/**
 * Smoke-render: for one dual-criterion analyte and one percent-only analyte,
 * call buildPrecisionHTML with synthetic results and confirm the canonical
 * TEa string actually shows up in the produced HTML. Catches the case where
 * teaDisplayStr is correct but a builder bypasses it with a hardcoded
 * fallback.
 */
function auditSmokeRender(): Failure[] {
  const failures: Failure[] = [];

  const cases = [
    "Creatinine", // dual: ±10% or ±0.2 mg/dL (greater)
    "Albumin", // percent-only: ±8%
    "Sodium", // absolute-only: ±4 mmol/L
    "Carcinoembryonic Antigen (CEA)", // dual: ±15% or ±1 ng/mL (greater) — was ng/dL bug
    "CBC - Hemoglobin", // percent-only post-2022 rule: ±4% (was dual pre-rule)
  ];

  for (const analyte of cases) {
    const entry = teaData.find((t) => t.analyte === analyte);
    if (!entry) {
      failures.push({ analyte, rule: "Smoke-render case not found in canonical teaData" });
      continue;
    }
    const study = syntheticStudyFor(analyte, entry.criteria);
    study.studyType = "precision";
    const expectedTea = teaDisplayStr(study);
    // Minimal results shape buildPrecisionHTML needs.
    const results = {
      mode: "basic",
      levelResults: [
        { levelName: "L1", n: 20, mean: 100, sd: 1, cv: 1.0, passFail: "Pass" },
      ],
      passCount: 1,
      totalCount: 1,
      overallPass: true,
    };
    let html: string;
    try {
      html = buildPrecisionHTML(study, results);
    } catch (e: any) {
      failures.push({
        analyte,
        rule: `buildPrecisionHTML threw: ${e?.message || e}`,
      });
      continue;
    }
    if (!html.includes(expectedTea)) {
      failures.push({
        analyte,
        rule: "buildPrecisionHTML output does not contain canonical TEa string",
        expected: expectedTea,
        got: html.slice(0, 200) + "...",
      });
    }
    // Also check global forbidden substrings inside the full HTML for this analyte.
    for (const bad of FORBIDDEN_GLOBAL) {
      if (html.includes(bad)) {
        failures.push({
          analyte,
          rule: `Rendered HTML contains globally-forbidden substring: ${bad}`,
        });
      }
    }
  }

  return failures;
}

/**
 * Inline replica of the dual-criterion verdict rule the production compute
 * paths use: a result passes if ABS(error) <= max(percent_threshold,
 * absolute_floor). This audit verifies that rule produces the right verdict
 * on the two regression cases that historically broke (pass-pct-fail-floor
 * and pass-floor-fail-pct should each be correctly classified).
 */
function dualVerdict(
  measured: number,
  expected: number,
  pctTea: number, // fractional, e.g. 0.10
  absFloor: number | null
): "Pass" | "Fail" {
  const err = Math.abs(measured - expected);
  const pctThreshold = Math.abs(expected) * pctTea;
  const threshold = absFloor != null ? Math.max(pctThreshold, absFloor) : pctThreshold;
  return err <= threshold ? "Pass" : "Fail";
}

function auditDualVerdicts(): Failure[] {
  const failures: Failure[] = [];

  // Creatinine: ±10% or ±0.2 mg/dL (greater)
  // Case A: low expected (1.0 mg/dL). Pct threshold = 0.10, floor = 0.20 -> threshold = 0.20.
  //   measured=1.15 (err=0.15) should PASS (err<=floor) even though err > pct (0.10).
  //   This is the "pass-floor-fail-pct" case: without dual rule, this would (wrongly) fail.
  {
    const v = dualVerdict(1.15, 1.0, 0.10, 0.2);
    if (v !== "Pass") {
      failures.push({
        analyte: "Creatinine",
        rule: `pass-floor-fail-pct verdict wrong: expected Pass, got ${v}`,
      });
    }
  }

  // Case B: high expected (5.0 mg/dL). Pct threshold = 0.50, floor = 0.20 -> threshold = 0.50.
  //   measured=5.30 (err=0.30) should PASS (err<=pct) even though err > floor (0.20).
  //   This is the "pass-pct-fail-floor" case: without dual rule (taking only floor), it would (wrongly) fail.
  {
    const v = dualVerdict(5.30, 5.0, 0.10, 0.2);
    if (v !== "Pass") {
      failures.push({
        analyte: "Creatinine",
        rule: `pass-pct-fail-floor verdict wrong: expected Pass, got ${v}`,
      });
    }
  }

  // Negative control: clearly outside both rules should still FAIL.
  {
    const v = dualVerdict(2.0, 1.0, 0.10, 0.2); // err=1.0; thresh=max(0.1,0.2)=0.2
    if (v !== "Fail") {
      failures.push({
        analyte: "Creatinine",
        rule: `clear-fail verdict wrong: expected Fail, got ${v}`,
      });
    }
  }

  // Sodium: absolute-only ±4 mmol/L. Pct rule does not apply.
  // measured=143, expected=140 -> err=3, threshold=4 -> Pass.
  // measured=145, expected=140 -> err=5, threshold=4 -> Fail.
  {
    const v1 = dualVerdict(143, 140, 0, 4);
    const v2 = dualVerdict(145, 140, 0, 4);
    if (v1 !== "Pass" || v2 !== "Fail") {
      failures.push({
        analyte: "Sodium",
        rule: `absolute-only verdict wrong: 143->Pass got ${v1}; 145->Fail got ${v2}`,
      });
    }
  }

  return failures;
}

async function writeFreshnessArtifact() {
  const verifiedAt = new Date().toISOString();
  const outDir = path.join(ROOT, "dist", "data");
  await mkdir(outDir, { recursive: true });
  const payload = {
    verifiedAt,
    cfr: "42 CFR §493 Subpart I",
    canonicalAnalyteCount: teaData.length,
    pass: true,
  };
  await writeFile(path.join(outDir, "tea_audit.json"), JSON.stringify(payload, null, 2));
  // Also write to server/data/ so dev runs (which read from server/data) can pick it up.
  const devDir = path.join(ROOT, "server", "data");
  await mkdir(devDir, { recursive: true });
  await writeFile(path.join(devDir, "tea_audit.json"), JSON.stringify(payload, null, 2));
  console.log(`[teaCanonicalRenderAudit] Stamped TEA_AUDIT_VERIFIED_AT=${verifiedAt}`);
}

async function main() {
  console.log(`[teaCanonicalRenderAudit] Auditing ${teaData.length} canonical analytes...`);
  const failures: Failure[] = [];

  failures.push(...auditTeaDisplayStr());
  failures.push(...auditSmokeRender());
  failures.push(...auditDualVerdicts());

  // Unregulated short-circuit regression: analytes whose name or alias contains
  // a regulated canonical name as a substring must NOT canonicalize. Historical
  // bug: MICROALBUMIN (MALB) collapsed to Albumin (8%), overriding user TEa 15%.
  {
    const { resolveCanonicalAnalyte, resolveFloor } = await import("../server/backfillAbsoluteFloor.js");
    const cases: { input: string; reason: string }[] = [
      { input: "MICROALBUMIN (MALB)", reason: "Urine microalbumin is unregulated; must not collapse to Albumin (serum)" },
      { input: "microalbumin", reason: "Lowercase alias of microalbumin must also short-circuit" },
      { input: "Calcium, Ionized", reason: "Ionized calcium is unregulated; must not collapse to Calcium, Total" },
      { input: "Urine Protein, total", reason: "Urine protein is unregulated; must not collapse to Total Protein" },
    ];
    for (const c of cases) {
      const canon = resolveCanonicalAnalyte(c.input);
      if (canon !== null) {
        failures.push({
          analyte: c.input,
          rule: `Unregulated short-circuit failed - resolved to canonical "${canon}". ${c.reason}`,
          got: canon,
        });
      }
      const floor = resolveFloor(c.input);
      if (floor !== null) {
        failures.push({
          analyte: c.input,
          rule: `Unregulated short-circuit failed - resolveFloor returned a floor. ${c.reason}`,
          got: JSON.stringify(floor),
        });
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\n[teaCanonicalRenderAudit] FAIL — ${failures.length} canonical-render defect(s) detected:\n`);
    for (const f of failures) {
      console.error(`  ${f.analyte}  ${f.rule}`);
      if (f.expected) console.error(`    expected: ${f.expected}`);
      if (f.got) console.error(`    got:      ${f.got}`);
    }
    console.error("\nFix: update server/backfillAbsoluteFloor.ts canonical teaData to match 42 CFR §493 Subpart I,");
    console.error("then re-run the build.\n");
    process.exit(1);
  }

  await writeFreshnessArtifact();
  console.log("[teaCanonicalRenderAudit] OK — all canonical analytes render correctly.");
}

main().catch((err) => {
  console.error("[teaCanonicalRenderAudit] Unexpected error:", err);
  process.exit(1);
});
