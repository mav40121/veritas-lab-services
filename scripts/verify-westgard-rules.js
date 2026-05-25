#!/usr/bin/env node
/*
 * verify-westgard-rules.js
 *
 * Math verification for the VeritaQC Westgard evaluator. Hardcodes input
 * sequences that should fire each rule and asserts the evaluator returns
 * the expected violation. Mirrors the inline evaluateWestgardForLot() in
 * server/routes.ts.
 *
 * Run:
 *   node scripts/verify-westgard-rules.js
 *
 * Exits non-zero on any FAIL so CI can pick it up later.
 */

// Mirrors evaluateWestgardForLot in server/routes.ts.
// Baseline = all values except the LAST one (the new candidate point).
// Mean and SD are established from the baseline only; the candidate
// point is then evaluated against that established baseline.
function evaluate(values, biasN = 10, trendN = 7) {
  if (values.length < 3) return []; // need baseline >= 2 + 1 candidate
  const baseline = values.slice(0, -1);
  const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
  const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / (baseline.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return [];
  const sdis = values.map(v => (v - mean) / sd);
  const i = sdis.length - 1;
  const z = sdis[i];
  const out = [];
  if (Math.abs(z) > 3) out.push({ rule: "1-3s", severity: "rejection" });
  else if (Math.abs(z) > 2) out.push({ rule: "1-2s", severity: "warning" });
  if (i >= 1 && Math.abs(z) > 2 && Math.abs(sdis[i - 1]) > 2 && z * sdis[i - 1] > 0) {
    out.push({ rule: "2-2s", severity: "rejection" });
  }
  if (i >= 1 && Math.abs(z - sdis[i - 1]) > 4) {
    out.push({ rule: "R-4s", severity: "rejection" });
  }
  if (i >= 3) {
    const w = sdis.slice(i - 3, i + 1);
    if (w.every(s => Math.abs(s) > 1) && w.every(s => s * w[0] > 0)) {
      out.push({ rule: "4-1s", severity: "rejection" });
    }
  }
  if (biasN > 0 && i >= biasN - 1) {
    const w = sdis.slice(i - biasN + 1, i + 1);
    if (w.every(s => s * w[0] > 0)) {
      out.push({ rule: `${biasN}-x`, severity: "rejection" });
    }
  }
  if (trendN > 0 && i >= trendN - 1) {
    const w = values.slice(i - trendN + 1, i + 1);
    const up = w.every((v, k) => k === 0 || v > w[k - 1]);
    const down = w.every((v, k) => k === 0 || v < w[k - 1]);
    if (up || down) out.push({ rule: `${trendN}-T`, severity: "rejection" });
  }
  return out;
}

let pass = 0;
let fail = 0;
function check(label, actualRules, expectedRules) {
  const got = actualRules.map(v => v.rule).sort();
  const want = [...expectedRules].sort();
  const ok = got.length === want.length && got.every((g, i) => g === want[i]);
  if (ok) {
    console.log(`PASS  ${label}  rules=${JSON.stringify(got)}`);
    pass++;
  } else {
    console.log(`FAIL  ${label}  got=${JSON.stringify(got)}  want=${JSON.stringify(want)}`);
    fail++;
  }
}

// Build a base series whose mean is exactly 100 and sample SD is exactly 4,
// then append a single test point per scenario. With sd=4, an SDI of N
// corresponds to a result of (100 + 4N).
// Base of 19 readings symmetric around 100, sample SD of 4: use a pattern
// computed analytically.
function baseSeries() {
  // 19 values: alternating +4 / -4 from 100 in equal counts, plus a 100.
  // Mean = 100. Sample SD with this pattern = sqrt( (9*16 + 9*16) / 18 ) = 4.
  return [
    100,
    104, 96, 104, 96, 104, 96, 104, 96, 104, 96,
    104, 96, 104, 96, 104, 96, 104, 96,
  ];
}

// Sanity check the base
{
  const b = baseSeries();
  const m = b.reduce((a, x) => a + x, 0) / b.length;
  const v = b.reduce((s, x) => s + (x - m) ** 2, 0) / (b.length - 1);
  const s = Math.sqrt(v);
  console.log(`base: n=${b.length}, mean=${m.toFixed(4)}, sd=${s.toFixed(4)} (expect mean=100, sd=4)`);
}

// Scenario: append a point that is 2.5 SD high -> 1-2s warning
check("1-2s warning at +2.5 SD",
  evaluate([...baseSeries(), 100 + 2.5 * 4]),
  ["1-2s"]);

// Scenario: append a point that is 3.5 SD high after a baseline ending at -1 SD.
// Expected to fire both 1-3s (|z|=3.5>3) AND R-4s (|3.5 - (-1)|=4.5>4 across zero).
check("1-3s rejection at +3.5 SD (also fires R-4s vs prior point)",
  evaluate([...baseSeries(), 100 + 3.5 * 4]),
  ["1-3s", "R-4s"]);

// Scenario: append two consecutive points >2 SD high -> 2-2s
check("2-2s rejection (two consecutive >2SD same side)",
  evaluate([...baseSeries(), 100 + 2.5 * 4, 100 + 2.6 * 4]),
  ["1-2s", "2-2s"]);

// Scenario: R-4s — one high, next low, range >4 SD
check("R-4s rejection (range >4 SD across zero)",
  evaluate([...baseSeries(), 100 + 2.5 * 4, 100 - 2.5 * 4]),
  ["1-2s", "R-4s"]);

// Scenario: 4-1s — four consecutive >1SD high
check("4-1s rejection (4 consecutive >1SD same side)",
  evaluate([...baseSeries(), 100 + 1.5 * 4, 100 + 1.5 * 4, 100 + 1.5 * 4, 100 + 1.5 * 4]),
  ["4-1s"]);

// Scenario: 10-x bias (default bias_n=10) — 10 consecutive on same side of mean
// Use a sequence of small positive offsets to avoid triggering 4-1s
check("10-x bias rejection (default N=10, 10 consecutive same side)",
  evaluate([...baseSeries(), 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5]),
  ["10-x"]);

// Scenario: configurable bias N=7 (CLSI C24 allows lab choice)
check("N-x bias with configurable N=7",
  evaluate([...baseSeries(), 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5], 7),
  ["7-x"]);

// Scenario: 7-T trend (default trend_n=7) — 7 strictly increasing
check("7-T trend rejection (default N=7 strictly monotonic)",
  evaluate([...baseSeries(), 100.1, 100.2, 100.3, 100.4, 100.5, 100.6, 100.7], 10, 7),
  ["7-T"]);

// Scenario: trend disabled with trend_n=0
check("trend disabled (trend_n=0)",
  evaluate([...baseSeries(), 100.1, 100.2, 100.3, 100.4, 100.5, 100.6, 100.7], 10, 0),
  []);

// Scenario: bias disabled with bias_n=0
check("bias disabled (bias_n=0)",
  evaluate([...baseSeries(), 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5, 100.5], 0),
  []);

// Scenario: not enough baseline (only 1 prior + 1 candidate -> baseline.length = 1)
check("no eval with insufficient baseline",
  evaluate([100, 100]),
  []);

// Scenario: sd==0 (all baseline values identical) — should not evaluate
check("no eval when baseline SD=0",
  evaluate([100, 100, 100, 100, 100]),
  []);

console.log(`\n${pass} passed, ${fail} failed.`);
process.exit(fail === 0 ? 0 : 1);
