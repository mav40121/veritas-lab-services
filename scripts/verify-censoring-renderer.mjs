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

import { isCensored, censorValueForMath, applyCensoringToVector } from "../server/censoring.ts";

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

// ─────────────────────────────────────────────────────────────────────
// PRECISION (EP15) + CAL VER (EP06) integration (2026-06-10 PR A).
//
// Both branches feed each level's raw reading list through the shared
// resolveRawValues() helper, which wraps applyCensoringToVector. Mirror
// that helper here so a divergence in policy handling shows as a fail.
// ─────────────────────────────────────────────────────────────────────
function resolveRawValues(rawList, policy) {
  return applyCensoringToVector(
    (rawList || []).map((v) => (isCensored(v) ? v : { value: v })),
    policy,
  );
}

// ── Test 7: precision level with a <17 replicate, exclude policy ──
{
  // one level, 5 replicates, the last one is <17
  const replicates = [16.2, 15.8, 16.5, 16.1, below17];
  const r = resolveRawValues(replicates, "exclude");
  check("precision exclude: 4 numeric values kept", r.values.length === 4);
  check("precision exclude: 1 censored excluded", r.excludedCount === 1 && r.substitutedCount === 0);
  check("precision exclude: values are the numerics", JSON.stringify(r.values) === JSON.stringify([16.2, 15.8, 16.5, 16.1]));
}

// ── Test 8: precision level, substitute_lld_half imputes 8.5 ──
{
  const replicates = [16.2, 15.8, below17];
  const r = resolveRawValues(replicates, "substitute_lld_half");
  check("precision sub_half: all 3 kept", r.values.length === 3 && r.substitutedCount === 1);
  check("precision sub_half: censored -> 8.5", r.values[2] === 8.5);
}

// ── Test 9: precision clean level is byte-identical under any policy ──
{
  const replicates = [10, 11, 12];
  const ex = resolveRawValues(replicates, "exclude");
  const sl = resolveRawValues(replicates, "substitute_lld");
  check("precision clean: 0 censored counts", ex.excludedCount === 0 && ex.substitutedCount === 0);
  check("precision clean: policy does not change output", JSON.stringify(ex.values) === JSON.stringify(sl.values));
}

// ─────────────────────────────────────────────────────────────────────
// REFERENCE INTERVAL (EP28) integration (2026-06-10 PR A).
//
// Each specimen value is resolved per policy; the verdict math (N,
// outside-range count) uses the resolved value, while the table still
// shows the raw "<17" marker. Mirror the per-specimen resolve loop.
// ─────────────────────────────────────────────────────────────────────
function resolveSpecimens(specimens, refLow, refHigh, policy) {
  let censExc = 0, censSub = 0;
  const resolved = specimens.map((s) => {
    const wasCensored = isCensored(s.value);
    const r = wasCensored
      ? censorValueForMath(s.value, policy)
      : (s.value !== null && s.value !== undefined && !isNaN(s.value) ? Number(s.value) : null);
    if (wasCensored) { if (r === null) censExc++; else censSub++; }
    return { ...s, _resolved: r };
  });
  const valid = resolved.filter((s) => s._resolved !== null);
  const outsideCount = valid.filter((s) => s._resolved < refLow || s._resolved > refHigh).length;
  return { n: valid.length, outsideCount, censExc, censSub };
}

// ── Test 10: ref interval, <17 specimen excluded (default) ──
{
  // ref range 18-30; one specimen is <17 (below range, but censored)
  const specimens = [
    { specimenId: "S1", value: 22 },
    { specimenId: "S2", value: 25 },
    { specimenId: "S3", value: 28 },
    { specimenId: "S4", value: below17 },
  ];
  const r = resolveSpecimens(specimens, 18, 30, "exclude");
  check("ref_interval exclude: N == 3 (censored dropped)", r.n === 3);
  check("ref_interval exclude: 1 censored excluded", r.censExc === 1 && r.censSub === 0);
  check("ref_interval exclude: 0 outside range", r.outsideCount === 0);
}

// ── Test 11: ref interval, substitute_lld keeps the censored specimen ──
//    and it lands OUTSIDE the range (17 < refLow 18), so outsideCount=1.
{
  const specimens = [
    { specimenId: "S1", value: 22 },
    { specimenId: "S2", value: below17 },
  ];
  const r = resolveSpecimens(specimens, 18, 30, "substitute_lld");
  check("ref_interval sub_lld: N == 2 (censored imputed)", r.n === 2 && r.censSub === 1);
  check("ref_interval sub_lld: imputed 17 counts as outside (17 < 18)", r.outsideCount === 1);
}

// ── Test 12: ref interval with no censored specimens is unchanged ──
{
  const specimens = [
    { specimenId: "S1", value: 22 },
    { specimenId: "S2", value: 35 },
  ];
  const r = resolveSpecimens(specimens, 18, 30, "exclude");
  check("ref_interval clean: N == 2, no censored counts", r.n === 2 && r.censExc === 0 && r.censSub === 0);
  check("ref_interval clean: 1 outside range (35 > 30)", r.outsideCount === 1);
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
