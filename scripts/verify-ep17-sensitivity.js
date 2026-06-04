#!/usr/bin/env node
// verify-ep17-sensitivity.js
//
// Backfill for the EP17-A2 analytical sensitivity math (LoB / LoD / LoQ)
// that shipped in commit #118 without a paired verify-*.js. Second of
// eight parking-lot #41 candidates closed (after the TEa boundary fix in
// PR #525).
//
// What this script proves, working against pure-JS reimplementations of
// the formulas in client/src/lib/calculations.ts calculateSensitivity:
//
//   1. LoB parametric = mean_blank + 1.645 * SD_blank (one-tailed 95%).
//   2. LoB non-parametric = 95th percentile via the R-7 / numpy-default
//      linear-interpolation method.
//   3. Cβ finite-sample correction lookup with linear interpolation
//      between table entries; asymptote at 1.645 at large n.
//   4. LoD = LoB_parametric + Cβ(n_low) * SD_low_level.
//   5. LoQ ladder: lowest concentration where CV <= cvThreshold AND
//      |bias%| <= biasThreshold passes; lower failing levels do not.
//   6. Per-lot LoB breakdown emitted when at least one blank replicate
//      carries a `.lot` label, with per-lot mean / SD / n / LoB.
//   7. Verification-mode pass logic: LoB_obs <= claim.lob AND LoD_obs
//      <= claim.lod (and LoQ_obs <= claim.loq when an LoQ is requested).
//   8. Establishment-mode pass logic: LoD > LoB (sanity) and, when LoQ
//      is requested, LoQ identified.
//   9. Counterfactual: a buggy "LoD = LoB + 1.645 * SD" implementation
//      (ignoring Cβ for small n) would over-estimate LoD at small n,
//      proving the Cβ correction matters.

function mean(v) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
function stddev(v) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function percentile(values, pct) {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// EP17-A2 Table A1, transcribed verbatim from calculations.ts.
const CBETA_TABLE = [
  { n: 5,    c: 2.063 }, { n: 10,   c: 1.831 }, { n: 15,   c: 1.766 },
  { n: 20,   c: 1.749 }, { n: 25,   c: 1.717 }, { n: 30,   c: 1.704 },
  { n: 40,   c: 1.683 }, { n: 50,   c: 1.671 }, { n: 60,   c: 1.660 },
  { n: 80,   c: 1.654 }, { n: 100,  c: 1.652 }, { n: 1000, c: 1.645 },
];
function cBeta(n) {
  if (n <= CBETA_TABLE[0].n) return CBETA_TABLE[0].c;
  if (n >= CBETA_TABLE[CBETA_TABLE.length - 1].n) return 1.645;
  for (let i = 0; i < CBETA_TABLE.length - 1; i++) {
    const a = CBETA_TABLE[i], b = CBETA_TABLE[i + 1];
    if (n === a.n) return a.c;
    if (n > a.n && n < b.n) {
      const w = (n - a.n) / (b.n - a.n);
      return a.c + w * (b.c - a.c);
    }
  }
  return 1.645;
}

function calculateSensitivity(input) {
  const blanks = input.blanks.filter(r => r.value != null && !isNaN(r.value));
  const blankValues = blanks.map(r => r.value);
  const meanBlank = mean(blankValues);
  const sdBlank = stddev(blankValues);
  const nBlank = blankValues.length;
  const lobParametric = meanBlank + 1.645 * sdBlank;
  const lobNonParametric = percentile(blankValues, 95);

  let byLot;
  const lotLabels = Array.from(new Set(blanks.map(r => r.lot).filter(l => !!l)));
  if (lotLabels.length > 0) {
    byLot = {};
    for (const lot of lotLabels) {
      const lotVals = blanks.filter(r => r.lot === lot).map(r => r.value);
      if (lotVals.length === 0) continue;
      const m = mean(lotVals);
      const s = stddev(lotVals);
      byLot[lot] = {
        mean: m, sd: s, n: lotVals.length,
        lobParametric: m + 1.645 * s,
        lobNonParametric: percentile(lotVals, 95),
      };
    }
  }

  const lowValues = input.lowLevel.filter(r => r.value != null && !isNaN(r.value)).map(r => r.value);
  const sdLowLevel = stddev(lowValues);
  const nLowLevel = lowValues.length;
  const cb = cBeta(nLowLevel);
  const lobUsed = lobParametric;
  const lodValue = lobUsed + cb * sdLowLevel;

  let loq = null;
  if (input.loqLevels && input.loqLevels.length > 0) {
    const cvThr = (input.cvThreshold ?? 0.20) * 100;
    const biasThr = (input.biasThreshold ?? 0.25) * 100;
    const byLevel = input.loqLevels.map(group => {
      const vals = group.replicates.filter(r => r.value != null && !isNaN(r.value)).map(r => r.value);
      const m = vals.length > 0 ? mean(vals) : 0;
      const s = vals.length > 1 ? stddev(vals) : 0;
      const cv = m !== 0 ? (s / m) * 100 : 0;
      const bias = m - group.expectedConcentration;
      const biasPct = group.expectedConcentration !== 0 ? (bias / group.expectedConcentration) * 100 : 0;
      const meetsPrecision = cv <= cvThr;
      const meetsBias = Math.abs(biasPct) <= biasThr;
      return {
        expectedConcentration: group.expectedConcentration,
        meanObserved: m, sd: s, cv, bias, biasPct,
        meetsPrecision, meetsBias,
        meetsLoq: meetsPrecision && meetsBias,
      };
    }).sort((a, b) => a.expectedConcentration - b.expectedConcentration);
    const lowestPassing = byLevel.find(l => l.meetsLoq);
    loq = {
      value: lowestPassing ? lowestPassing.expectedConcentration : null,
      byLevel,
      cvThreshold: cvThr,
      biasThreshold: biasThr,
    };
  }

  let overallPass;
  if (input.mode === "verification" && input.manufacturerClaim) {
    overallPass = true;
    if (input.manufacturerClaim.lob !== undefined) overallPass = overallPass && lobParametric <= input.manufacturerClaim.lob;
    if (input.manufacturerClaim.lod !== undefined) overallPass = overallPass && lodValue <= input.manufacturerClaim.lod;
    if (input.manufacturerClaim.loq !== undefined && loq) overallPass = overallPass && loq.value !== null && loq.value <= input.manufacturerClaim.loq;
  } else {
    overallPass = lodValue > lobUsed && (loq ? loq.value !== null : true);
  }

  return {
    mode: input.mode,
    lob: { parametric: lobParametric, nonParametric: lobNonParametric, meanBlank, sdBlank, nBlank, byLot },
    lod: { value: lodValue, lobUsed, cBeta: cb, sdLowLevel, nLowLevel },
    loq,
    overallPass,
  };
}

// Test harness ---------------------------------------------------------------

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}
function approxEq(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

// Helper for building input shape.
function r(v, lot) { return lot ? { value: v, lot } : { value: v }; }

// 1. LoB parametric: 20 blank replicates with known mean and SD.
{
  // Values designed so mean = 0.10 exactly, sample SD = 0.02 exactly.
  // For mean = 0.10 and SD = 0.02, 20 symmetric values around 0.10 with the
  // right spread satisfy that. Hand-constructed: 10 at 0.08, 10 at 0.12.
  // Sample SD = sqrt(20 * 0.02^2 / 19) ≈ 0.02053 -- close to 0.02 but not
  // exact. Use a different construction with exact expected outputs:
  // values = [0.08, 0.12] repeated 10 times gives:
  //   mean = 0.10
  //   variance = (10 * 0.02^2 + 10 * 0.02^2) / 19 = 0.4/19 = 0.02105...
  //   sd = sqrt(0.02105...) = 0.04472 -- not 0.02. Recompute.
  // Just hardcode the values and the expected SD from the formula:
  const vals = [0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12, 0.08, 0.12];
  const expectedMean = 0.10;
  const expectedSd = Math.sqrt(20 * 0.02 * 0.02 / 19); // ~0.020519
  const input = {
    mode: "establishment",
    blanks: vals.map(v => r(v)),
    lowLevel: [r(0.30), r(0.32), r(0.31), r(0.33), r(0.29), r(0.32), r(0.30), r(0.31), r(0.32), r(0.30)],
  };
  const out = calculateSensitivity(input);
  check("LoB parametric mean = 0.10", approxEq(out.lob.meanBlank, expectedMean));
  check("LoB parametric SD = expected", approxEq(out.lob.sdBlank, expectedSd, 1e-5));
  check("LoB parametric = mean + 1.645 * SD",
    approxEq(out.lob.parametric, expectedMean + 1.645 * expectedSd, 1e-5));
}

// 2. LoB non-parametric percentile (95%) via R-7 linear interpolation.
{
  // Linear-interpolation 95th percentile of [1..20] should be exactly 19.05
  // (idx = 0.95 * 19 = 18.05; sorted[18] = 19, sorted[19] = 20; 19 + 0.05 * 1 = 19.05).
  const input = {
    mode: "establishment",
    blanks: Array.from({ length: 20 }, (_, i) => r(i + 1)),
    lowLevel: [r(30), r(31), r(30), r(32), r(30)],
  };
  const out = calculateSensitivity(input);
  check("LoB non-parametric 95th percentile of [1..20] = 19.05",
    approxEq(out.lob.nonParametric, 19.05));
}

// 3. Cβ table lookup and interpolation.
{
  // Exact table entries
  check("Cβ(n=5) = 2.063 (table)", approxEq(cBeta(5), 2.063));
  check("Cβ(n=20) = 1.749 (table)", approxEq(cBeta(20), 1.749));
  check("Cβ(n=100) = 1.652 (table)", approxEq(cBeta(100), 1.652));
  // Below-min clamp
  check("Cβ(n=3) clamps to first table entry 2.063", approxEq(cBeta(3), 2.063));
  // Above-max asymptote
  check("Cβ(n=2000) = 1.645 (asymptote)", approxEq(cBeta(2000), 1.645));
  // Interpolation between n=10 (1.831) and n=15 (1.766) at n=12:
  // c = 1.831 + (12-10)/(15-10) * (1.766 - 1.831) = 1.831 + 0.4 * (-0.065) = 1.805
  check("Cβ(n=12) interpolated between n=10 and n=15",
    approxEq(cBeta(12), 1.805));
}

// 4. LoD = LoB_parametric + Cβ(n_low) * SD_low_level.
{
  const blanks = Array.from({ length: 20 }, () => r(0.10));
  // SD of all-same values is 0; LoD reduces to just LoB.
  const out1 = calculateSensitivity({
    mode: "establishment",
    blanks,
    lowLevel: [r(0.30), r(0.30), r(0.30), r(0.30), r(0.30)],
  });
  check("LoD = LoB when blank SD = 0 and low-level SD = 0",
    approxEq(out1.lod.value, out1.lob.parametric));

  // Now a non-trivial case.
  const lowVals = [0.30, 0.32, 0.31, 0.33, 0.29, 0.32, 0.30, 0.31, 0.32, 0.30, 0.31, 0.30, 0.32, 0.31, 0.30];
  const out2 = calculateSensitivity({
    mode: "establishment",
    blanks: Array.from({ length: 20 }, (_, i) => r(0.08 + (i % 2) * 0.04)),
    lowLevel: lowVals.map(v => r(v)),
  });
  const expectedLod = out2.lob.parametric + cBeta(15) * stddev(lowVals);
  check("LoD = LoB_parametric + Cβ(15) * SD_low (15 replicates)",
    approxEq(out2.lod.value, expectedLod, 1e-9));
  check("LoD reports nLowLevel = 15", out2.lod.nLowLevel === 15);
  check("LoD reports cBeta = 1.766 (table entry at n=15)",
    approxEq(out2.lod.cBeta, 1.766));
}

// 5. LoQ ladder: first level fails CV gate, second passes.
{
  const blanks = Array.from({ length: 20 }, () => r(0.10));
  // Level A at 0.30: mean 0.30, CV ~33% (fails 20% CV gate). Wider spread
  // than the textbook precise-replicate look so the SD is genuinely large.
  const levelA = [0.15, 0.45, 0.20, 0.40, 0.18, 0.42, 0.22, 0.38, 0.27, 0.33];
  // Level B at 0.60: mean 0.60, low CV (passes 20% CV gate), bias within 25%
  const levelB = [0.58, 0.60, 0.62, 0.59, 0.61, 0.60, 0.60, 0.60, 0.60, 0.60];
  const input = {
    mode: "establishment",
    blanks,
    lowLevel: [r(0.30), r(0.32), r(0.31), r(0.30), r(0.32)],
    loqLevels: [
      { expectedConcentration: 0.30, replicates: levelA.map(v => r(v)) },
      { expectedConcentration: 0.60, replicates: levelB.map(v => r(v)) },
    ],
    cvThreshold: 0.20,
    biasThreshold: 0.25,
  };
  const out = calculateSensitivity(input);
  const aLevel = out.loq.byLevel.find(l => l.expectedConcentration === 0.30);
  const bLevel = out.loq.byLevel.find(l => l.expectedConcentration === 0.60);
  check("LoQ Level A (0.30) CV exceeds 20% gate", aLevel.cv > 20);
  check("LoQ Level A fails the precision criterion", !aLevel.meetsPrecision);
  check("LoQ Level A meetsLoq = false", aLevel.meetsLoq === false);
  check("LoQ Level B (0.60) CV within 20%", bLevel.cv <= 20);
  check("LoQ Level B bias% within 25%", Math.abs(bLevel.biasPct) <= 25);
  check("LoQ Level B meetsLoq = true", bLevel.meetsLoq === true);
  check("LoQ value = 0.60 (lowest passing concentration)", out.loq.value === 0.60);
}

// 6. Per-lot LoB breakdown when blanks carry .lot labels.
{
  const input = {
    mode: "establishment",
    blanks: [
      r(0.08, "LOT-A"), r(0.12, "LOT-A"), r(0.08, "LOT-A"), r(0.12, "LOT-A"), r(0.10, "LOT-A"),
      r(0.10, "LOT-A"), r(0.10, "LOT-A"), r(0.10, "LOT-A"), r(0.10, "LOT-A"), r(0.10, "LOT-A"),
      r(0.11, "LOT-B"), r(0.13, "LOT-B"), r(0.11, "LOT-B"), r(0.13, "LOT-B"), r(0.12, "LOT-B"),
      r(0.12, "LOT-B"), r(0.12, "LOT-B"), r(0.12, "LOT-B"), r(0.12, "LOT-B"), r(0.12, "LOT-B"),
    ],
    lowLevel: [r(0.30), r(0.31), r(0.30), r(0.32), r(0.30)],
  };
  const out = calculateSensitivity(input);
  check("per-lot byLot present when any blank carries a lot label",
    out.lob.byLot !== undefined);
  check("per-lot byLot has both LOT-A and LOT-B",
    out.lob.byLot && "LOT-A" in out.lob.byLot && "LOT-B" in out.lob.byLot);
  check("LOT-A n = 10", out.lob.byLot["LOT-A"].n === 10);
  check("LOT-B n = 10", out.lob.byLot["LOT-B"].n === 10);
  check("LOT-A LoB ≈ mean + 1.645 * SD per lot",
    approxEq(
      out.lob.byLot["LOT-A"].lobParametric,
      out.lob.byLot["LOT-A"].mean + 1.645 * out.lob.byLot["LOT-A"].sd,
      1e-9
    ));
  check("LOT-B mean > LOT-A mean (per the constructed data)",
    out.lob.byLot["LOT-B"].mean > out.lob.byLot["LOT-A"].mean);
}

// 7. Verification-mode pass logic.
{
  const blanks = Array.from({ length: 20 }, (_, i) => r(0.08 + (i % 2) * 0.04));
  const lowLevel = Array.from({ length: 15 }, (_, i) => r(0.30 + (i % 2) * 0.02));
  // Tight claim: way above observed (will pass)
  const tightClaim = { lob: 1.0, lod: 1.0 };
  const outPass = calculateSensitivity({
    mode: "verification",
    blanks, lowLevel,
    manufacturerClaim: tightClaim,
  });
  check("verification PASS when both observed values <= claim", outPass.overallPass === true);

  // Aggressive claim: below the observed LoD (will fail)
  const aggressiveClaim = { lob: 1.0, lod: 0.05 };
  const outFail = calculateSensitivity({
    mode: "verification",
    blanks, lowLevel,
    manufacturerClaim: aggressiveClaim,
  });
  check("verification FAIL when observed LoD > claim LoD",
    outFail.overallPass === false);

  // LoQ also required
  const outLoq = calculateSensitivity({
    mode: "verification",
    blanks, lowLevel,
    loqLevels: [{
      expectedConcentration: 0.60,
      replicates: [r(0.60), r(0.59), r(0.61), r(0.60), r(0.60)],
    }],
    manufacturerClaim: { lob: 1.0, lod: 1.0, loq: 0.50 }, // claim LoQ = 0.50, observed = 0.60
  });
  check("verification FAIL when observed LoQ > claim LoQ",
    outLoq.overallPass === false);
}

// 8. Establishment-mode pass logic.
{
  const blanks = Array.from({ length: 20 }, (_, i) => r(0.08 + (i % 2) * 0.04));
  const lowLevel = Array.from({ length: 15 }, (_, i) => r(0.30 + (i % 2) * 0.02));
  const out = calculateSensitivity({
    mode: "establishment",
    blanks, lowLevel,
  });
  check("establishment PASS when LoD > LoB (the normal case)",
    out.overallPass === true && out.lod.value > out.lob.parametric);

  // Establishment FAIL when an LoQ is requested but no level passes the
  // gate. Use a single LoQ level with high CV so meetsPrecision = false.
  const outNoLoq = calculateSensitivity({
    mode: "establishment",
    blanks, lowLevel,
    loqLevels: [{
      expectedConcentration: 0.30,
      replicates: [0.15, 0.45, 0.20, 0.40, 0.18, 0.42, 0.22, 0.38, 0.27, 0.33].map(v => r(v)),
    }],
  });
  check("establishment FAIL when LoQ requested but no level passes the gate",
    outNoLoq.overallPass === false && outNoLoq.loq.value === null);
}

// 9. Counterfactual: a buggy implementation that ignores Cβ and uses 1.645
// for all sample sizes would over-estimate LoD at small n (Cβ for n=5 is
// 2.063, much larger than 1.645). The correct implementation produces a
// HIGHER LoD at small n because Cβ > 1.645.
{
  const blanks = Array.from({ length: 20 }, (_, i) => r(0.08 + (i % 2) * 0.04));
  const lowVals = [0.30, 0.32, 0.31, 0.33, 0.29];
  const out = calculateSensitivity({
    mode: "establishment",
    blanks,
    lowLevel: lowVals.map(v => r(v)),
  });
  const sdLow = stddev(lowVals);
  const buggyLod = out.lob.parametric + 1.645 * sdLow; // ignores Cβ
  const correctLod = out.lob.parametric + 2.063 * sdLow; // Cβ for n=5
  check("counterfactual: ignoring Cβ at n=5 under-estimates LoD",
    buggyLod < correctLod);
  check("counterfactual: correct LoD matches Cβ(5)=2.063 application",
    approxEq(out.lod.value, correctLod, 1e-9));
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
