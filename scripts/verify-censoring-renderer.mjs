// scripts/verify-censoring-renderer.mjs
//
// Receipts for the Censoring Level 2 renderer integration in the
// Method Comparison (EP09) appendix (overnight backlog, 2026-06-10).
//
// Mirrors the per-pair resolveAxis + drop/substitute loop added to
// server/veritacheck_verification.ts, using the REAL censoring helpers
// (isCensored, censorValueForMath) from server/censoring.ts so a
// divergence shows up as a failure.
//
// Asserts, for a method-comparison data_points blob with a mix of
// numeric and censored (<X) comparison-axis values:
//   - exclude policy drops censored pairs (N shrinks, censoredExcluded counts)
//   - substitute_lld / substitute_lld_half impute and keep the pairs
//   - a blob with NO censored points is byte-identical to today
//     (censoredExcluded == censoredSubstituted == 0, same xs/ys)
//   - censoring on the X (reference) axis is handled too
//
// Run: npx tsx scripts/verify-censoring-renderer.mjs

import { isCensored, censorValueForMath } from "../server/censoring.ts";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
function eq(a, b) { return Math.abs(a - b) < 1e-9; }

// Faithful mirror of the loop in veritacheck_verification.ts method_comparison branch.
function extract(dp, compName, policy) {
  const xs = [], ys = [];
  let excludedCount = 0, censoredExcluded = 0, censoredSubstituted = 0;
  const resolveAxis = (raw) => {
    if (isCensored(raw)) return censorValueForMath(raw, policy);
    return (raw !== null && raw !== undefined && !isNaN(raw)) ? Number(raw) : null;
  };
  for (const p of dp) {
    if (p && p.excluded === true) { excludedCount++; continue; }
    const xRaw = p.expectedValue;
    const yRaw = p.instrumentValues?.[compName];
    const anyCensored = isCensored(xRaw) || isCensored(yRaw);
    const x = resolveAxis(xRaw);
    const y = resolveAxis(yRaw);
    if (x === null || y === null) { if (anyCensored) censoredExcluded++; continue; }
    if (anyCensored) censoredSubstituted++;
    xs.push(x); ys.push(y);
  }
  return { xs, ys, n: xs.length, excludedCount, censoredExcluded, censoredSubstituted };
}

const below17 = { censored: true, censor_direction: "below", censor_value: 17 };

// ── ethanol-style blob: 3 numeric pairs + 2 with comparison-axis <17 ──
const blob = [
  { expectedValue: 25,  instrumentValues: { B: 24 } },
  { expectedValue: 100, instrumentValues: { B: 101 } },
  { expectedValue: 250, instrumentValues: { B: 248 } },
  { expectedValue: 15,  instrumentValues: { B: below17 } },
  { expectedValue: 12,  instrumentValues: { B: below17 } },
];

// ── Test 1: exclude (default) drops the 2 censored pairs ──
{
  const r = extract(blob, "B", "exclude");
  check("exclude: N == 3", r.n === 3, `got ${r.n}`);
  check("exclude: 2 censored excluded", r.censoredExcluded === 2);
  check("exclude: 0 substituted", r.censoredSubstituted === 0);
  check("exclude: ys are the 3 numerics", JSON.stringify(r.ys) === JSON.stringify([24, 101, 248]));
}

// ── Test 2: substitute_lld keeps all 5, censored y -> 17 ──
{
  const r = extract(blob, "B", "substitute_lld");
  check("substitute_lld: N == 5", r.n === 5);
  check("substitute_lld: 2 substituted", r.censoredSubstituted === 2);
  check("substitute_lld: 0 excluded", r.censoredExcluded === 0);
  check("substitute_lld: censored y == 17", r.ys[3] === 17 && r.ys[4] === 17);
}

// ── Test 3: substitute_lld_half keeps all 5, censored y -> 8.5 ──
{
  const r = extract(blob, "B", "substitute_lld_half");
  check("substitute_lld_half: N == 5", r.n === 5);
  check("substitute_lld_half: censored y == 8.5", r.ys[3] === 8.5 && r.ys[4] === 8.5);
}

// ── Test 4: a blob with NO censored points is unchanged ──
{
  const clean = [
    { expectedValue: 10, instrumentValues: { B: 11 } },
    { expectedValue: 50, instrumentValues: { B: 49 } },
    { expectedValue: 90, instrumentValues: { B: 92 } },
  ];
  const ex = extract(clean, "B", "exclude");
  const sl = extract(clean, "B", "substitute_lld");
  check("clean blob: N == 3 under any policy", ex.n === 3 && sl.n === 3);
  check("clean blob: 0 censored counts (note suppressed)", ex.censoredExcluded === 0 && ex.censoredSubstituted === 0);
  check("clean blob: xs/ys identical to raw", JSON.stringify(ex.xs) === JSON.stringify([10, 50, 90]) && JSON.stringify(ex.ys) === JSON.stringify([11, 49, 92]));
  check("clean blob: policy does not change output", JSON.stringify(ex.ys) === JSON.stringify(sl.ys));
}

// ── Test 5: censoring on the X (reference) axis is handled too ──
{
  const xCensored = [
    { expectedValue: below17, instrumentValues: { B: 14 } },
    { expectedValue: 100,     instrumentValues: { B: 99 } },
  ];
  const ex = extract(xCensored, "B", "exclude");
  check("x-axis censored, exclude: N == 1", ex.n === 1 && ex.censoredExcluded === 1);
  const slh = extract(xCensored, "B", "substitute_lld_half");
  check("x-axis censored, substitute_lld_half: x == 8.5", slh.xs[0] === 8.5 && slh.n === 2);
}

// ── Test 6: per-point exclusion still wins over censoring ──
{
  const withExcl = [
    { expectedValue: 25, instrumentValues: { B: 24 }, excluded: true },
    { expectedValue: 12, instrumentValues: { B: below17 } },
    { expectedValue: 80, instrumentValues: { B: 81 } },
  ];
  const r = extract(withExcl, "B", "exclude");
  check("excluded point counted separately, not as censored", r.excludedCount === 1 && r.censoredExcluded === 1 && r.n === 1);
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
