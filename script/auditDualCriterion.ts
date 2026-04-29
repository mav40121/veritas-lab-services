/**
 * auditDualCriterion.ts
 *
 * Static audit backstop for §493 PT TEa dual-criterion handling across
 * pdfReport.ts builders and routes.ts compute paths.
 *
 * Catches the regression class where a per-analyte percentage TEa is rendered
 * or evaluated without honoring the absolute floor (clia_absolute_floor).
 *
 * Run as a pre-build step from script/build.ts. Exits non-zero on failure.
 */
import { readFile } from "fs/promises";
import path from "path";

type Failure = { file: string; line: number; rule: string; snippet: string };

const ROOT = path.resolve(import.meta.dirname || ".", "..");

async function read(rel: string): Promise<string> {
  return readFile(path.join(ROOT, rel), "utf-8");
}

function findLine(text: string, idx: number): number {
  return text.slice(0, idx).split("\n").length;
}

/**
 * Rule 1: Every HTML builder for a numeric study type that surfaces a
 * narrative or summary TEa string must reference teaDisplayStr() at least
 * once. (Defensive — even if the analyte has no floor today, a future floor
 * addition should propagate through the same code path.)
 */
const REQUIRED_TEA_DISPLAY_BUILDERS = [
  "buildMethodCompHTML",
  "buildCalVerHTML",
  "buildPrecisionHTML",
  "buildLotToLotHTML",
];

/**
 * Rule 2: Forbidden patterns — hardcoded `±${... * 100}%` style strings
 * outside of teaDisplayStr() itself or chart axis labels. These often
 * mask a missing dual-criterion path.
 */
function checkBuilderUsesTeaDisplay(src: string, fnName: string): Failure[] {
  const fnIdx = src.indexOf(`function ${fnName}`);
  if (fnIdx === -1) return [];
  // Find end of function by brace counting (rough but adequate)
  let depth = 0;
  let end = fnIdx;
  let started = false;
  for (let i = fnIdx; i < src.length; i++) {
    if (src[i] === "{") {
      depth++;
      started = true;
    } else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(fnIdx, end);
  // A builder satisfies the rule if it directly calls teaDisplayStr(), OR if
  // it surfaces TEa via the centralized helpers narrativeHTML()/evalHTML(),
  // which are themselves required to use teaDisplayStr (see central rule below).
  const usesDirect = body.includes("teaDisplayStr(");
  const usesNarrativeHelper = body.includes("narrativeHTML(") || body.includes("evalHTML(");
  if (!usesDirect && !usesNarrativeHelper) {
    return [{
      file: "server/pdfReport.ts",
      line: findLine(src, fnIdx),
      rule: `Builder ${fnName} must surface TEa via teaDisplayStr(), narrativeHTML(), or evalHTML()`,
      snippet: body.split("\n")[0].slice(0, 100),
    }];
  }
  return [];
}

/**
 * Rule 3: routes.ts demo PDF endpoint compute paths for precision and
 * lot_to_lot must reference clia_absolute_floor. Catches the case where a
 * future refactor strips out the dual rule.
 */
function checkRoutesDualCompute(src: string): Failure[] {
  const failures: Failure[] = [];
  // Precision: must check clia_absolute_floor in pass/fail logic
  const precIdx = src.indexOf("study_type === \"precision\"");
  if (precIdx !== -1) {
    // Check next ~3000 chars for absolute_floor reference
    const window = src.slice(precIdx, precIdx + 5000);
    if (!/clia_absolute_floor|cliaAbsoluteFloor|_absFloor/.test(window)) {
      failures.push({
        file: "server/routes.ts",
        line: findLine(src, precIdx),
        rule: "Precision demo PDF endpoint must reference clia_absolute_floor for dual-criterion eval",
        snippet: src.slice(precIdx, precIdx + 80),
      });
    }
  }
  // Lot_to_lot: must check clia_absolute_floor or _absFloor in pair eval
  const l2lIdx = src.indexOf("study_type === \"lot_to_lot\"");
  if (l2lIdx !== -1) {
    const window = src.slice(l2lIdx, l2lIdx + 5000);
    if (!/clia_absolute_floor|cliaAbsoluteFloor|_absFloor/.test(window)) {
      failures.push({
        file: "server/routes.ts",
        line: findLine(src, l2lIdx),
        rule: "Lot-to-lot demo PDF endpoint must reference clia_absolute_floor for dual-criterion eval",
        snippet: src.slice(l2lIdx, l2lIdx + 80),
      });
    }
  }
  return failures;
}

/**
 * Rule 4: computeStudyStatus precision and lot_to_lot branches must
 * reference clia_absolute_floor (via study object alias or direct).
 */
function checkComputeStudyStatus(src: string): Failure[] {
  const failures: Failure[] = [];
  const fnIdx = src.indexOf("function computeStudyStatus");
  if (fnIdx === -1) return failures;
  // Find end of function (brace count)
  let depth = 0;
  let end = fnIdx;
  let started = false;
  for (let i = fnIdx; i < src.length; i++) {
    if (src[i] === "{") {
      depth++;
      started = true;
    } else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = src.slice(fnIdx, end);
  // Both precision and lot_to_lot branches must reference floor
  if (!/clia_absolute_floor|cliaAbsoluteFloor|absFloor/i.test(body)) {
    failures.push({
      file: "server/routes.ts",
      line: findLine(src, fnIdx),
      rule: "computeStudyStatus must reference clia_absolute_floor in precision/lot_to_lot branches",
      snippet: body.split("\n")[0].slice(0, 100),
    });
  }
  return failures;
}

async function main() {
  console.log("[auditDualCriterion] Scanning for §493 PT dual-criterion regressions...");
  const failures: Failure[] = [];

  const pdfSrc = await read("server/pdfReport.ts");
  const routesSrc = await read("server/routes.ts");

  for (const fn of REQUIRED_TEA_DISPLAY_BUILDERS) {
    failures.push(...checkBuilderUsesTeaDisplay(pdfSrc, fn));
  }

  // Central rule: narrativeHTML() and evalHTML() must themselves use teaDisplayStr,
  // since the builders rely on them as the single source of truth.
  for (const helper of ["function narrativeHTML", "function evalHTML"]) {
    const idx = pdfSrc.indexOf(helper);
    if (idx === -1) continue;
    // Take a generous window after the function start to scan its body.
    const window = pdfSrc.slice(idx, idx + 4000);
    if (!window.includes("teaDisplayStr(")) {
      failures.push({
        file: "server/pdfReport.ts",
        line: findLine(pdfSrc, idx),
        rule: `Helper ${helper.replace("function ", "")}() must call teaDisplayStr() so dual-criterion analytes render correctly`,
        snippet: helper,
      });
    }
  }

  failures.push(...checkRoutesDualCompute(routesSrc));
  failures.push(...checkComputeStudyStatus(routesSrc));

  if (failures.length > 0) {
    console.error("\n[auditDualCriterion] FAIL — dual-criterion regressions detected:\n");
    for (const f of failures) {
      console.error(`  ${f.file}:${f.line}  ${f.rule}`);
      console.error(`    ${f.snippet}`);
    }
    console.error("\nFix: ensure each HTML builder calls teaDisplayStr(study) and");
    console.error("each compute path references clia_absolute_floor for dual-criterion analytes.");
    console.error("See server/backfillAbsoluteFloor.ts for the canonical 30+ analyte list.\n");
    process.exit(1);
  }

  console.log("[auditDualCriterion] OK — all builders + compute paths honor dual-criterion floor.");
}

main().catch((err) => {
  console.error("[auditDualCriterion] Unexpected error:", err);
  process.exit(1);
});
