// scripts/verify-censoring.mjs
//
// Receipts for the censoring helper (overnight session 8/11):
//   1. parseCensoredInput accepts "17", "<17", ">500", trims whitespace
//   2. parseCensoredInput rejects empty / non-numeric input
//   3. isCensored detects structured censored points
//   4. censorValueForMath honors each policy
//   5. applyCensoringToVector returns the right values + counts under
//      exclude / substitute_lld / substitute_lld_half
//   6. displayPointValue renders "<17", ">500", numeric values
//   7. Ethanol-style mixed dataset (mostly numeric + a few <17) is
//      handled correctly under all three policies
//
// Run: npx tsx scripts/verify-censoring.mjs

import * as c from "../server/censoring.ts";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
function eq(a, b) { return Math.abs(a - b) < 1e-9; }

// ── Test 1: parseCensoredInput ──────────────────────────────────────
{
  const a = c.parseCensoredInput("17");
  check("parse '17' -> numeric", a?.value === 17 && !a?.censored);
  const b = c.parseCensoredInput("<17");
  check("parse '<17' -> censored below", b?.censored?.censored === true && b?.censored?.censor_direction === "below" && b?.censored?.censor_value === 17);
  const d = c.parseCensoredInput(">500");
  check("parse '>500' -> censored above", d?.censored?.censored === true && d?.censored?.censor_direction === "above" && d?.censored?.censor_value === 500);
  const e = c.parseCensoredInput("  < 17 ");
  check("parse '  < 17 ' -> censored below (with whitespace)", e?.censored?.censored === true && e?.censored?.censor_value === 17);
  check("parse '' -> null", c.parseCensoredInput("") === null);
  check("parse 'abc' -> null", c.parseCensoredInput("abc") === null);
  check("parse '<abc' -> null", c.parseCensoredInput("<abc") === null);
}

// ── Test 2: isCensored ─────────────────────────────────────────────
{
  check("isCensored on numeric: false", !c.isCensored({ value: 17 }));
  check("isCensored on tagged: true", c.isCensored({ censored: true, censor_direction: "below", censor_value: 17 }));
  check("isCensored on malformed: false", !c.isCensored({ censored: true, censor_value: 17 }));
  check("isCensored on null: false", !c.isCensored(null));
}

// ── Test 3: censorValueForMath policies ────────────────────────────
{
  const pt = { censored: true, censor_direction: "below", censor_value: 17 };
  check("policy exclude returns null", c.censorValueForMath(pt, "exclude") === null);
  check("policy substitute_lld returns 17", c.censorValueForMath(pt, "substitute_lld") === 17);
  check("policy substitute_lld_half returns 8.5", c.censorValueForMath(pt, "substitute_lld_half") === 8.5);
  // numeric point
  check("numeric pt with exclude returns the value", c.censorValueForMath({ value: 42 }, "exclude") === 42);
  check("numeric pt with substitute returns the value", c.censorValueForMath({ value: 42 }, "substitute_lld") === 42);
}

// ── Test 4: applyCensoringToVector ─────────────────────────────────
{
  const dataset = [
    { value: 50 },
    { value: 100 },
    { censored: true, censor_direction: "below", censor_value: 17 },
    { censored: true, censor_direction: "below", censor_value: 17 },
    { value: 250 },
  ];
  const ex = c.applyCensoringToVector(dataset, "exclude");
  check("exclude policy: 3 values", ex.values.length === 3);
  check("exclude policy: 2 excluded", ex.excludedCount === 2);
  check("exclude policy: 0 substituted", ex.substitutedCount === 0);

  const sl = c.applyCensoringToVector(dataset, "substitute_lld");
  check("substitute_lld policy: 5 values", sl.values.length === 5);
  check("substitute_lld policy: 2 substituted at 17", sl.substitutedCount === 2 && sl.values.includes(17));

  const slh = c.applyCensoringToVector(dataset, "substitute_lld_half");
  check("substitute_lld_half policy: 5 values", slh.values.length === 5);
  check("substitute_lld_half policy: 2 substituted at 8.5", slh.substitutedCount === 2 && slh.values.includes(8.5));
}

// ── Test 5: per-point exclusion (PR #693) interacts cleanly ────────
{
  const dataset = [
    { value: 50 },
    { value: 100, excluded: true },
    { censored: true, censor_direction: "below", censor_value: 17 },
  ];
  const ex = c.applyCensoringToVector(dataset, "exclude");
  check("exclusion + censoring: 1 value (50)", ex.values.length === 1 && ex.values[0] === 50);
  check("exclusion + censoring: censored counted as excluded under 'exclude'", ex.excludedCount === 1);
}

// ── Test 6: displayPointValue ──────────────────────────────────────
{
  check("display censored below: <17", c.displayPointValue({ censored: true, censor_direction: "below", censor_value: 17 }) === "<17");
  check("display censored above: >500", c.displayPointValue({ censored: true, censor_direction: "above", censor_value: 500 }) === ">500");
  check("display numeric: 17.000", c.displayPointValue({ value: 17 }) === "17.000");
  check("display numeric digits: 17.0", c.displayPointValue({ value: 17 }, 1) === "17.0");
  check("display null: -", c.displayPointValue({ value: null }) === "-");
}

// ── Test 7: Ethanol example ────────────────────────────────────────
{
  // 5 paired specimens: 3 numeric + 2 below LLD
  const ethanol = [
    { value: 25 },
    { value: 100 },
    { value: 250 },
    { censored: true, censor_direction: "below", censor_value: 17 },
    { censored: true, censor_direction: "below", censor_value: 17 },
  ];
  const ex = c.applyCensoringToVector(ethanol, "exclude");
  check("ethanol exclude: mean of 3 numerics", eq(ex.values.reduce((a, b) => a + b, 0) / ex.values.length, 125));
  const slh = c.applyCensoringToVector(ethanol, "substitute_lld_half");
  check("ethanol substitute_lld_half: 5 values mean = (25+100+250+8.5+8.5)/5 = 78.4", eq(slh.values.reduce((a, b) => a + b, 0) / slh.values.length, 78.4));
}

// ── Test 8: policyLabel + policyNarrative are non-empty ───────────
{
  check("policyLabel(exclude)", typeof c.policyLabel("exclude") === "string" && c.policyLabel("exclude").length > 0);
  check("policyNarrative(exclude)", c.policyNarrative("exclude").includes("excluded"));
  check("policyNarrative(substitute_lld)", c.policyNarrative("substitute_lld").includes("threshold"));
  check("policyNarrative(substitute_lld_half)", c.policyNarrative("substitute_lld_half").includes("half"));
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
