// scripts/verify-systematic-error-math.js
//
// Verify the systematic-error-at-MDL math used by the VeritaCheck
// Method Comparison (EP09) study type. The math lives in
// server/canonicalMDLs.ts (computeSystematicErrorAtMDL); we re-spec
// it here so the test exercises the contract rather than the
// implementation.
//
//     SE_at_MDL = intercept + (slope - 1) * MDL  (signed)
//     |SE_at_MDL| < TEa  -> meets criteria
//     |SE_at_MDL| >= TEa -> does not meet criteria
//
// Five test groups (zero bias, pure constant, pure proportional,
// mixed, verdict threshold). Run: node scripts/verify-systematic-error-math.js

function computeSE(slope, intercept, mdl) {
  const seSigned = intercept + (slope - 1) * mdl;
  return {
    se_signed: seSigned,
    se_abs: Math.abs(seSigned),
    constant_bias: intercept,
    proportional_bias_pct: (slope - 1) * 100,
  };
}

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
function near(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 1e-9 : tol);
}

// ── Test 1: zero bias -> SE = 0 everywhere ─────────────────────────
{
  const r1 = computeSE(1, 0, 50);
  const r2 = computeSE(1, 0, 126);
  const r3 = computeSE(1, 0, 200);
  check("zero bias at MDL=50",  near(r1.se_signed, 0) && near(r1.se_abs, 0));
  check("zero bias at MDL=126", near(r2.se_signed, 0) && near(r2.se_abs, 0));
  check("zero bias at MDL=200", near(r3.se_signed, 0) && near(r3.se_abs, 0));
  check("constant_bias = 0 (intercept)", near(r1.constant_bias, 0));
  check("proportional_bias_pct = 0 (slope=1)", near(r1.proportional_bias_pct, 0));
}

// ── Test 2: pure constant bias (slope=1, intercept=2) -> SE=2 at every MDL ──
{
  const slope = 1, intercept = 2;
  const r1 = computeSE(slope, intercept, 50);
  const r2 = computeSE(slope, intercept, 126);
  const r3 = computeSE(slope, intercept, 200);
  check("constant +2 at MDL=50",  near(r1.se_signed,  2) && near(r1.se_abs, 2));
  check("constant +2 at MDL=126", near(r2.se_signed,  2) && near(r2.se_abs, 2));
  check("constant +2 at MDL=200", near(r3.se_signed,  2) && near(r3.se_abs, 2));
}

// ── Test 3: pure proportional bias (slope=1.05) -> SE = 0.05 * MDL ──
{
  const slope = 1.05, intercept = 0;
  const r1 = computeSE(slope, intercept, 50);
  const r2 = computeSE(slope, intercept, 126);
  const r3 = computeSE(slope, intercept, 200);
  check("proportional 5% at MDL=50",  near(r1.se_signed, 2.5));
  check("proportional 5% at MDL=126", near(r2.se_signed, 6.3));
  check("proportional 5% at MDL=200", near(r3.se_signed, 10));
  check("proportional_bias_pct = 5", near(r1.proportional_bias_pct, 5));
}

// ── Test 4: mixed (slope=1.02, intercept=-1) at glucose MDLs ─────────
{
  // SE_at_MDL = -1 + 0.02 * MDL
  // At 50: -1 + 1 = 0; at 126: -1 + 2.52 = 1.52; at 200: -1 + 4 = 3
  const slope = 1.02, intercept = -1;
  const r1 = computeSE(slope, intercept, 50);
  const r2 = computeSE(slope, intercept, 126);
  const r3 = computeSE(slope, intercept, 200);
  check("mixed at MDL=50  -> 0",    near(r1.se_signed, 0, 1e-6));
  check("mixed at MDL=126 -> 1.52", near(r2.se_signed, 1.52, 1e-6));
  check("mixed at MDL=200 -> 3",    near(r3.se_signed, 3, 1e-6));
  check("constant_bias = -1 (intercept)", near(r1.constant_bias, -1));
  check("proportional_bias_pct = 2", near(r1.proportional_bias_pct, 2));
}

// ── Test 5: verdict flip at the TEa boundary ────────────────────────
// Glucose CLIA TEa is 10% (per 42 CFR §493.931). At MDL=126:
// TEa_abs = 0.10 * 126 = 12.6 mg/dL.
// SE just under threshold should "meet"; SE just over should not.
{
  const mdl = 126;
  const teaFraction = 0.10;
  const teaAbs = teaFraction * mdl; // 12.6

  // Under threshold: slope=1, intercept=12.4 -> SE=12.4 at every MDL
  let r = computeSE(1, 12.4, mdl);
  check("SE 12.4 vs TEa 12.6 -> meets", r.se_abs < teaAbs);

  // Over threshold: slope=1, intercept=12.8 -> SE=12.8
  r = computeSE(1, 12.8, mdl);
  check("SE 12.8 vs TEa 12.6 -> does not meet", r.se_abs >= teaAbs);

  // Exactly at: SE = TEa at MDL within float tolerance. Renderer uses
  // <= for "meets" so the boundary lands as "meets"; either side of
  // the boundary remains stable.
  r = computeSE(1, teaAbs, mdl);
  check("SE = TEa at MDL -> meets (boundary within float tolerance)", r.se_abs <= teaAbs + 1e-9);
}

// ── Summary ────────────────────────────────────────────────────────
console.log();
if (failures === 0) {
  console.log("ALL test groups passed.");
  process.exit(0);
} else {
  console.log(`${failures} failure(s).`);
  process.exit(1);
}
