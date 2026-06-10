// scripts/verify-veritacheck-point-exclusion.js
//
// Verify the per-point exclusion semantics for VeritaCheck studies
// (Michael L feedback, 2026-06-09):
//
//   1. A point with excluded === true is skipped from the
//      regression. excludedCount surfaces in the metric table.
//   2. Excluded points stay in the data array (audit trail intact).
//   3. Excluding an outlier shifts slope / intercept predictably
//      toward the non-outlier mass of the data.
//   4. Including a point back restores the original math.
//
// Run: node scripts/verify-veritacheck-point-exclusion.js

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }

// Mirror of the regression block in server/veritacheck_verification.ts
function runRegression(dp, compName) {
  const xs = [], ys = [];
  let excludedCount = 0;
  for (const p of dp) {
    if (p && p.excluded === true) { excludedCount++; continue; }
    const x = p.expectedValue;
    const y = p.instrumentValues?.[compName];
    if (x != null && !isNaN(x) && y != null && !isNaN(y)) {
      xs.push(x); ys.push(y);
    }
  }
  const n = xs.length;
  if (n < 2) return { n, slope: NaN, intercept: NaN, excludedCount };
  const xm = xs.reduce((s, v) => s + v, 0) / n;
  const ym = ys.reduce((s, v) => s + v, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - xm) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - xm) * (ys[i] - ym), 0);
  const slope = sxx === 0 ? 1 : sxy / sxx;
  const intercept = ym - slope * xm;
  return { n, slope, intercept, excludedCount };
}

// ── Test 1: clean data, no exclusion -> baseline ────────────────────
{
  // y = x exactly: slope=1, intercept=0
  const dp = [];
  for (let x = 50; x <= 200; x += 10) {
    dp.push({ expectedValue: x, instrumentValues: { B: x } });
  }
  const r = runRegression(dp, "B");
  check("baseline N", r.n === dp.length, `n=${r.n}`);
  check("baseline slope = 1", near(r.slope, 1));
  check("baseline intercept = 0", near(r.intercept, 0));
  check("baseline excludedCount = 0", r.excludedCount === 0);
}

// ── Test 2: inject outlier, see slope skew ──────────────────────────
{
  const dp = [];
  for (let x = 50; x <= 200; x += 10) {
    dp.push({ expectedValue: x, instrumentValues: { B: x } });
  }
  // Push the n=8 point WAY off (a clear outlier from transcription error)
  dp[7].instrumentValues.B = 500; // x=120 measured at 500
  const r = runRegression(dp, "B");
  check("outlier present, slope != 1", !near(r.slope, 1, 0.05), `slope=${r.slope}`);
}

// ── Test 3: exclude the outlier, slope returns to ~1 ─────────────────
{
  const dp = [];
  for (let x = 50; x <= 200; x += 10) {
    dp.push({ expectedValue: x, instrumentValues: { B: x } });
  }
  dp[7].instrumentValues.B = 500;
  dp[7].excluded = true;
  dp[7].exclusion_reason = "transcription error";
  const r = runRegression(dp, "B");
  check("excluded count = 1", r.excludedCount === 1);
  check("post-exclusion N = total - 1", r.n === dp.length - 1, `n=${r.n}`);
  check("post-exclusion slope ~ 1", near(r.slope, 1, 1e-9), `slope=${r.slope}`);
  check("post-exclusion intercept ~ 0", near(r.intercept, 0, 1e-9), `intercept=${r.intercept}`);
}

// ── Test 4: include-back restores the math ───────────────────────────
{
  const dp = [];
  for (let x = 50; x <= 200; x += 10) {
    dp.push({ expectedValue: x, instrumentValues: { B: x } });
  }
  dp[7].instrumentValues.B = 500;
  dp[7].excluded = true;
  let r = runRegression(dp, "B");
  const slopeAfterExclude = r.slope;
  // Now restore
  dp[7].excluded = false;
  dp[7].exclusion_reason = null;
  r = runRegression(dp, "B");
  check("re-included point participates again", r.excludedCount === 0);
  check("slope shifts back toward outlier-biased value", !near(r.slope, slopeAfterExclude, 0.05));
}

// ── Test 5: excluded points remain in the array (audit trail) ──────
{
  const dp = [
    { expectedValue: 50,  instrumentValues: { B: 50 },  excluded: true, exclusion_reason: "specimen issue" },
    { expectedValue: 100, instrumentValues: { B: 100 } },
    { expectedValue: 150, instrumentValues: { B: 150 } },
  ];
  // dp.length must still be 3 after regression read; exclusion is metadata, not delete
  const r = runRegression(dp, "B");
  check("array length unchanged after exclusion read", dp.length === 3);
  check("regression N = 2", r.n === 2);
  check("excluded point retains reason", dp[0].exclusion_reason === "specimen issue");
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
