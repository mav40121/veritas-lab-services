// scripts/verify-censoring-entry.mjs
//
// Receipts for the Censoring Level 2 DATA-ENTRY integration (PR B,
// 2026-06-10). The data-entry grid now accepts "<17" / ">500" on four
// surfaces (Correlation/Method Comparison, Calibration Verification/
// Linearity, Precision, Reference Interval).
//
// This mirrors the client helpers added to VeritaCheckPage.tsx
// (parseCell, cellFilled, cellDisplay, toNumericDataPoints,
// toNumericRefData, precision stripReps) using the REAL shared helpers
// from shared/censoring.ts, so a divergence shows up as a failure. It
// asserts the two properties that matter:
//
//   1. ROUND-TRIP: a "<17" typed into a cell parses to the censored
//      object, survives JSON.stringify/parse (the data_points blob), and
//      renders back as "<17" in the input. This is what reaches the
//      server PDF renderer (already verified by verify-censoring-renderer).
//   2. STATUS CALC IS CLEAN: the numeric copy fed to the client
//      calculate* engine has censored cells normalized to null/dropped
//      (default "exclude" policy), so no NaN poisons the stored pass/fail.
//
// Run: npx tsx scripts/verify-censoring-entry.mjs

import { isCensored, parseCensoredInput, displayPointValue } from "../shared/censoring.ts";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

// ── Faithful mirrors of the VeritaCheckPage.tsx helpers ──────────────
function parseCell(value) {
  const parsed = parseCensoredInput(value);
  return parsed === null ? null : (parsed.censored ?? parsed.value ?? null);
}
function cellFilled(v) {
  return isCensored(v) || (v !== null && v !== undefined && !isNaN(v));
}
function cellDisplay(v) {
  return isCensored(v) ? displayPointValue(v) : (v ?? "");
}
function toNumericDataPoints(points) {
  return points.map(dp => ({
    ...dp,
    expectedValue: isCensored(dp.expectedValue) ? null : dp.expectedValue,
    instrumentValues: Object.fromEntries(
      Object.entries(dp.instrumentValues).map(([k, v]) => [k, isCensored(v) ? null : v]),
    ),
  }));
}
function toNumericRefData(rows) {
  return rows.map(r => ({ ...r, value: isCensored(r.value) ? null : r.value }));
}
const stripReps = (arr) => (arr || []).filter(v => !isCensored(v) && v !== undefined && v !== null && !isNaN(v));

// ── Test 1: parseCell turns the typed string into the right shape ────
{
  check("parseCell('<17') -> censored below 17", JSON.stringify(parseCell("<17")) === JSON.stringify({ censored: true, censor_direction: "below", censor_value: 17 }));
  check("parseCell('>500') -> censored above 500", JSON.stringify(parseCell(">500")) === JSON.stringify({ censored: true, censor_direction: "above", censor_value: 500 }));
  check("parseCell('17') -> bare number 17", parseCell("17") === 17);
  check("parseCell('') -> null", parseCell("") === null);
  check("parseCell('abc') -> null", parseCell("abc") === null);
  check("parseCell(' < 17 ') tolerates whitespace", JSON.stringify(parseCell(" < 17 ")) === JSON.stringify({ censored: true, censor_direction: "below", censor_value: 17 }));
}

// ── Test 2: cellDisplay round-trips the marker back to the input ─────
{
  check("cellDisplay(censored) -> '<17'", cellDisplay(parseCell("<17")) === "<17");
  check("cellDisplay(censored above) -> '>500'", cellDisplay(parseCell(">500")) === ">500");
  check("cellDisplay(17) -> 17", cellDisplay(17) === 17);
  check("cellDisplay(null) -> ''", cellDisplay(null) === "");
}

// ── Test 3: cellFilled counts censored as entered ───────────────────
{
  check("cellFilled(censored) -> true", cellFilled(parseCell("<17")) === true);
  check("cellFilled(17) -> true", cellFilled(17) === true);
  check("cellFilled(null) -> false", cellFilled(null) === false);
  check("cellFilled(undefined) -> false", cellFilled(undefined) === false);
}

// ── Test 4: full grid round-trip through the data_points blob ────────
{
  // ethanol-style: director types a "<17" comparison value in one row
  const grid = [
    { level: 1, expectedValue: 25, instrumentValues: { B: 24 } },
    { level: 2, expectedValue: 100, instrumentValues: { B: 101 } },
    { level: 3, expectedValue: 15, instrumentValues: { B: parseCell("<17") } },
  ];
  const stored = JSON.parse(JSON.stringify(grid));           // the data_points blob
  check("blob keeps the censored object", isCensored(stored[2].instrumentValues.B));
  check("blob re-renders '<17' in the cell", cellDisplay(stored[2].instrumentValues.B) === "<17");
  // numeric copy for the client status calc has it dropped to null
  const numeric = toNumericDataPoints(grid);
  check("numeric copy drops censored to null", numeric[2].instrumentValues.B === null);
  check("numeric copy keeps the real numbers", numeric[0].instrumentValues.B === 24 && numeric[1].instrumentValues.B === 101);
}

// ── Test 5: reference-interval specimens round-trip + numeric strip ──
{
  const specimens = [
    { specimenId: "S1", value: 22 },
    { specimenId: "S2", value: parseCell("<17") },
    { specimenId: "S3", value: 28 },
  ];
  const stored = JSON.parse(JSON.stringify(specimens));
  check("ref blob keeps censored specimen", isCensored(stored[1].value));
  check("ref entry-count includes censored (cellFilled)", specimens.filter(s => cellFilled(s.value)).length === 3);
  const numeric = toNumericRefData(specimens);
  check("ref numeric copy drops censored to null", numeric[1].value === null);
  check("ref numeric valid count excludes censored", numeric.filter(s => s.value !== null).length === 2);
}

// ── Test 6: precision replicates — store censored, strip for calc ────
{
  // one level, 5 replicates, last is <17
  const reps = [16.2, 15.8, 16.5, 16.1, parseCell("<17")];
  // stored values keep censored (renderer resolves it)
  const storedValues = reps.filter(v => cellFilled(v));
  check("precision stored keeps all 5 (incl. censored)", storedValues.length === 5 && isCensored(storedValues[4]));
  // calc copy drops the censored replicate (exclude policy)
  const calcValues = stripReps(reps);
  check("precision calc drops censored -> 4 numerics", calcValues.length === 4);
  check("precision calc values are the numerics", JSON.stringify(calcValues) === JSON.stringify([16.2, 15.8, 16.5, 16.1]));
  // advanced mode: days nested array
  const days = [[16.2, parseCell("<17")], [16.0, 16.3]];
  const calcDays = days.map(d => stripReps(d));
  check("precision advanced strips censored per day", JSON.stringify(calcDays) === JSON.stringify([[16.2], [16.0, 16.3]]));
}

// ── Test 7: a clean grid (no censoring) is byte-identical ───────────
{
  const grid = [
    { level: 1, expectedValue: 10, instrumentValues: { B: 11 } },
    { level: 2, expectedValue: 50, instrumentValues: { B: 49 } },
  ];
  const numeric = toNumericDataPoints(grid);
  check("clean grid unchanged by normalize", JSON.stringify(numeric) === JSON.stringify(grid));
  check("clean cells display unchanged", cellDisplay(grid[0].instrumentValues.B) === 11 && cellDisplay(grid[0].expectedValue) === 10);
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
