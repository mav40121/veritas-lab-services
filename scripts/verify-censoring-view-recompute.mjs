// scripts/verify-censoring-view-recompute.mjs
//
// Receipt for the 2026-06-11 fix to StudyResultsPage: the on-screen results
// are RE-COMPUTED from study.dataPoints via the numeric calculate* engine. A
// saved study with a censored ("<17") value would NaN-poison that recompute.
// deepResolveCensored resolves censored values per the study's policy at the
// parse site so the screen matches the server-rendered PDF.
//
// This mirrors deepResolveCensored using the REAL shared censorValueForMath /
// isCensored, feeds the resolved blobs into the REAL client calculate*
// functions, and asserts:
//   - exclude policy: censored values drop, stats are finite (no NaN)
//   - substitute_lld: censored values impute, stats finite
//   - a clean blob is byte-identical (no-op)
//
// Run: npx tsx scripts/verify-censoring-view-recompute.mjs

import { isCensored, censorValueForMath } from "../shared/censoring.ts";
import { calculatePrecision, calculateRefInterval, calculateStudy } from "../client/src/lib/calculations.ts";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
const finite = (n) => typeof n === "number" && Number.isFinite(n);

// Faithful mirror of the StudyResultsPage helper.
function deepResolveCensored(obj, policy) {
  if (isCensored(obj)) return censorValueForMath(obj, policy);
  if (Array.isArray(obj)) return obj.map((x) => deepResolveCensored(x, policy));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const k of Object.keys(obj)) out[k] = deepResolveCensored(obj[k], policy);
    return out;
  }
  return obj;
}

const below17 = { censored: true, censor_direction: "below", censor_value: 17 };

// ── Precision: one level, 5 reps, last is <17 ──────────────────────────────
{
  const blob = [{ level: 1, levelName: "L1", values: [16.2, 15.8, 16.5, 16.1, below17] }];
  const resolved = deepResolveCensored(blob, "exclude");
  check("precision exclude: censored rep -> null in values", resolved[0].values[4] === null);
  const r = calculatePrecision(resolved, 0.2, "simple", {});
  const lvl = r.levelResults[0];
  check("precision exclude: n counts the 4 numerics", lvl.n === 4);
  check("precision exclude: mean is finite (no NaN)", finite(lvl.mean));
  check("precision exclude: sd is finite (no NaN)", finite(lvl.sd));

  const sub = deepResolveCensored(blob, "substitute_lld");
  check("precision substitute_lld: censored rep -> 17", sub[0].values[4] === 17);
  const rs = calculatePrecision(sub, 0.2, "simple", {});
  check("precision substitute_lld: n == 5", rs.levelResults[0].n === 5);
}

// ── Reference interval: 21 specimens incl. one <17 ─────────────────────────
{
  const specimens = Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${i}`, value: 20 + (i % 8) }));
  specimens.push({ specimenId: "S20", value: below17 });
  const blob = { specimens, refLow: 18, refHigh: 30, analyte: "CO2", units: "mmol/L" };
  const resolved = deepResolveCensored(blob, "exclude");
  check("ref exclude: censored specimen -> null", resolved.specimens[20].value === null);
  const r = calculateRefInterval(resolved.specimens, resolved.refLow, resolved.refHigh, "CO2", "mmol/L");
  check("ref exclude: N excludes censored (20)", r.n === 20);
  check("ref exclude: outsidePercent finite (no NaN)", finite(r.outsidePercent ?? r.percentOutside ?? 0));
}

// ── Method comparison: 5 pairs, one comparison value <17 ───────────────────
{
  const blob = [
    { level: 1, expectedValue: 25, instrumentValues: { "Inst B": 24 } },
    { level: 2, expectedValue: 100, instrumentValues: { "Inst B": 101 } },
    { level: 3, expectedValue: 250, instrumentValues: { "Inst B": 248 } },
    { level: 4, expectedValue: 15, instrumentValues: { "Inst B": below17 } },
    { level: 5, expectedValue: 12, instrumentValues: { "Inst B": 13 } },
  ];
  const resolved = deepResolveCensored(blob, "exclude");
  check("method_comp exclude: censored y -> null", resolved[3].instrumentValues["Inst B"] === null);
  const r = calculateStudy(resolved, ["Inst B"], 0.1, "method_comparison", true);
  check("method_comp exclude: result type is method_comparison", r.type === "method_comparison");
  // slope/intercept should be finite numbers, not NaN
  const reg = r.regression?.["Inst B"] || Object.values(r.regression || {})[0] || {};
  check("method_comp exclude: regression slope finite", finite(reg.slope));
}

// ── Clean blob (no censoring) is a structural no-op ────────────────────────
{
  const blob = [{ level: 1, levelName: "L1", values: [10, 11, 12] }];
  const resolved = deepResolveCensored(blob, "exclude");
  check("clean blob unchanged by resolve", JSON.stringify(resolved) === JSON.stringify(blob));
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
