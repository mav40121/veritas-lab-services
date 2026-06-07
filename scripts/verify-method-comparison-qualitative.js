#!/usr/bin/env node
// verify-method-comparison-qualitative.js
//
// Backfill for commit 4e14d1a (2026-04-17) per parking-lot #41. That
// commit added qualitative + semi-quantitative method comparison study
// types to VeritaCheck with their own categorical / ordinal math:
//
//   - Qualitative: concordance matrix, percent agreement, Cohen's kappa,
//     sensitivity/specificity for binary scales.
//   - Semi-quantitative: concordance matrix on an ordinal grade scale,
//     exact agreement, within-+/-1-grade agreement, linear-weighted
//     kappa, maximum discrepancy.
//
// The original commit shipped without a paired verify script; this is
// that script. Pure-JS reimplementation transcribed from
// client/src/lib/calculations.ts as of 4e14d1a, matching the pattern in
// scripts/verify-tea-boundary.js and scripts/verify-precision-parity.js.
//
// What this script proves:
//
//   1. Qualitative perfect agreement: kappa = 1.0, percent agreement
//      = 100%, sens/spec = 100%, PASS.
//   2. Qualitative perfect disagreement (binary): kappa near worst case,
//      0% agreement, FAIL.
//   3. Qualitative binary realistic case (2x2 confusion matrix from a
//      hand-computed example): exact sens / spec / kappa values.
//   4. Qualitative ternary case: 3-category matrix, sens/spec absent
//      (only computed for binary, by design).
//   5. Qualitative threshold boundary: just-above-passThreshold = PASS;
//      just-below = FAIL.
//   6. Semi-quant exact-grade agreement: 100% exact, kappa = 1.0, PASS.
//   7. Semi-quant within-+/-1-grade boundary: 1 sample exactly 1 grade
//      off counts as within-1, max discrepancy = 1.
//   8. Semi-quant fail case: 2 samples > +/-1 grade off, percent within
//      +/-1 drops below 80%, FAIL.
//   9. Semi-quant weighted kappa: hand-computed on a 4-grade scale with
//      a known matrix; checks the linear-weight formula.
//  10. Semi-quant maxDiscrepancy: reports the largest grade gap across
//      all samples, not the modal one.

// ── Reimplementations transcribed from client/src/lib/calculations.ts
//    at commit 4e14d1a. Verbatim formulas, plain JS (no TS), no imports.

function interpretKappa(k) {
  if (k < 0.20) return "Poor";
  if (k <= 0.40) return "Fair";
  if (k <= 0.60) return "Moderate";
  if (k <= 0.80) return "Substantial";
  return "Almost Perfect";
}

// calculateQualitative(dataPoints, compName, categories, passThreshold)
//
// dataPoints: [{ expectedCategory, instrumentCategories: { [compName]: cat } }, ...]
function calculateQualitative(dataPoints, compName, categories, passThreshold) {
  const valid = dataPoints.filter(
    (dp) => dp.expectedCategory && dp.instrumentCategories && dp.instrumentCategories[compName]
  );
  const n = valid.length;

  const matrix = {};
  categories.forEach((r) => {
    matrix[r] = {};
    categories.forEach((c) => { matrix[r][c] = 0; });
  });
  valid.forEach((dp) => {
    const ref = dp.expectedCategory;
    const comp = dp.instrumentCategories[compName];
    if (matrix[ref] && matrix[ref][comp] !== undefined) matrix[ref][comp]++;
  });

  let agree = 0;
  categories.forEach((c) => { agree += (matrix[c] && matrix[c][c]) || 0; });
  const percentAgreement = n > 0 ? (agree / n) * 100 : 0;

  const Po = n > 0 ? agree / n : 0;
  let Pe = 0;
  categories.forEach((c) => {
    const rowTotal = categories.reduce((s, cc) => s + ((matrix[c] && matrix[c][cc]) || 0), 0);
    const colTotal = categories.reduce((s, rc) => s + ((matrix[rc] && matrix[rc][c]) || 0), 0);
    Pe += rowTotal * colTotal;
  });
  Pe = n > 0 ? Pe / (n * n) : 0;
  const cohensKappa = Pe < 1 ? (Po - Pe) / (1 - Pe) : 1;

  let sensitivity = 0, specificity = 0;
  if (categories.length === 2) {
    const pos = categories[0], neg = categories[1];
    const tp = (matrix[pos] && matrix[pos][pos]) || 0;
    const fn = (matrix[pos] && matrix[pos][neg]) || 0;
    const fp = (matrix[neg] && matrix[neg][pos]) || 0;
    const tn = (matrix[neg] && matrix[neg][neg]) || 0;
    sensitivity = (tp + fn) > 0 ? (tp / (tp + fn)) * 100 : 0;
    specificity = (tn + fp) > 0 ? (tn / (tn + fp)) * 100 : 0;
  }

  const overallPass = percentAgreement >= passThreshold * 100;
  return { n, matrix, percentAgreement, cohensKappa, sensitivity, specificity, overallPass };
}

// calculateSemiQuant(dataPoints, compName, gradeScale, passThreshold)
function calculateSemiQuant(dataPoints, compName, gradeScale, passThreshold) {
  const valid = dataPoints.filter(
    (dp) => dp.expectedCategory && dp.instrumentCategories && dp.instrumentCategories[compName]
  );
  const n = valid.length;
  const k = gradeScale.length;

  const gradeIndex = {};
  gradeScale.forEach((g, i) => { gradeIndex[g] = i; });

  const matrix = {};
  gradeScale.forEach((r) => {
    matrix[r] = {};
    gradeScale.forEach((c) => { matrix[r][c] = 0; });
  });

  let exactCount = 0, withinOneCount = 0, maxDisc = 0;
  valid.forEach((dp) => {
    const ref = dp.expectedCategory;
    const comp = dp.instrumentCategories[compName];
    if (matrix[ref] && matrix[ref][comp] !== undefined) matrix[ref][comp]++;
    const refIdx = gradeIndex[ref] !== undefined ? gradeIndex[ref] : 0;
    const compIdx = gradeIndex[comp] !== undefined ? gradeIndex[comp] : 0;
    const diff = Math.abs(refIdx - compIdx);
    if (diff === 0) exactCount++;
    if (diff <= 1) withinOneCount++;
    if (diff > maxDisc) maxDisc = diff;
  });

  const percentExactAgreement = n > 0 ? (exactCount / n) * 100 : 0;
  const percentWithinOneGrade = n > 0 ? (withinOneCount / n) * 100 : 0;

  let weightedPo = 0, weightedPe = 0;
  if (n > 0 && k > 1) {
    gradeScale.forEach((r, i) => {
      gradeScale.forEach((c, j) => {
        const w = 1 - Math.abs(i - j) / (k - 1);
        weightedPo += w * (((matrix[r] && matrix[r][c]) || 0) / n);
      });
    });
    gradeScale.forEach((r, i) => {
      const rowTotal = gradeScale.reduce((s, cc) => s + ((matrix[r] && matrix[r][cc]) || 0), 0);
      gradeScale.forEach((c, j) => {
        const colTotal = gradeScale.reduce((s, rc) => s + ((matrix[rc] && matrix[rc][c]) || 0), 0);
        const w = 1 - Math.abs(i - j) / (k - 1);
        weightedPe += w * (rowTotal / n) * (colTotal / n);
      });
    });
  }
  const weightedKappa = weightedPe < 1 ? (weightedPo - weightedPe) / (1 - weightedPe) : 1;

  const overallPass = percentWithinOneGrade >= passThreshold * 100;
  return { n, matrix, percentExactAgreement, percentWithinOneGrade, weightedKappa, maxDiscrepancy: maxDisc, overallPass };
}

// ── Test harness ───────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? "  -- " + detail : "")); }
}
function approxEq(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-9 : tol); }

// Helper to build a dp from a (expected, observed) pair
function dp(expected, observed) {
  return { level: 0, expectedCategory: expected, instrumentCategories: { Inst: observed } };
}

// ─── 1. Qualitative perfect agreement ──────────────────────────────────────
{
  const data = [dp("Pos","Pos"), dp("Pos","Pos"), dp("Neg","Neg"), dp("Neg","Neg")];
  const r = calculateQualitative(data, "Inst", ["Pos","Neg"], 0.90);
  check("1. Qual perfect agreement: n=4, %agree=100", r.n === 4 && approxEq(r.percentAgreement, 100));
  check("1. Qual perfect agreement: kappa=1.0", approxEq(r.cohensKappa, 1.0, 1e-9));
  check("1. Qual perfect agreement: sens=100, spec=100", approxEq(r.sensitivity, 100) && approxEq(r.specificity, 100));
  check("1. Qual perfect agreement: PASS", r.overallPass === true);
}

// ─── 2. Qualitative perfect disagreement (binary) ──────────────────────────
{
  // All Pos called Neg, all Neg called Pos
  const data = [dp("Pos","Neg"), dp("Pos","Neg"), dp("Neg","Pos"), dp("Neg","Pos")];
  const r = calculateQualitative(data, "Inst", ["Pos","Neg"], 0.90);
  check("2. Qual perfect disagreement: %agree=0", approxEq(r.percentAgreement, 0));
  // Po=0, Pe=0.5 (balanced marginals), kappa = (0-0.5)/(1-0.5) = -1
  check("2. Qual perfect disagreement: kappa=-1.0", approxEq(r.cohensKappa, -1.0, 1e-9));
  check("2. Qual perfect disagreement: sens=0, spec=0", approxEq(r.sensitivity, 0) && approxEq(r.specificity, 0));
  check("2. Qual perfect disagreement: FAIL", r.overallPass === false);
}

// ─── 3. Qualitative realistic 2x2 (hand-computed) ──────────────────────────
{
  //   Matrix:    Pos    Neg
  //   Pos (ref):  18      2   (20 truly positive)
  //   Neg (ref):   3     27   (30 truly negative)
  //   n=50, agree=45, %agree=90, sens=18/20=90, spec=27/30=90
  //   Po=0.90; row1Total*colPosTotal=20*21=420; row2Total*colNegTotal=30*29=870
  //   Pe = (420 + 870) / 50^2 = 1290 / 2500 = 0.516
  //   kappa = (0.90 - 0.516) / (1 - 0.516) = 0.384 / 0.484 = 0.79338843...
  const data = [];
  for (let i = 0; i < 18; i++) data.push(dp("Pos","Pos"));
  for (let i = 0; i < 2;  i++) data.push(dp("Pos","Neg"));
  for (let i = 0; i < 3;  i++) data.push(dp("Neg","Pos"));
  for (let i = 0; i < 27; i++) data.push(dp("Neg","Neg"));
  const r = calculateQualitative(data, "Inst", ["Pos","Neg"], 0.90);
  check("3. Qual realistic 2x2: n=50, %agree=90", r.n === 50 && approxEq(r.percentAgreement, 90));
  check("3. Qual realistic 2x2: sens=90, spec=90", approxEq(r.sensitivity, 90) && approxEq(r.specificity, 90));
  check("3. Qual realistic 2x2: kappa ~= 0.7934", approxEq(r.cohensKappa, 0.7933884297520661, 1e-6), "got " + r.cohensKappa);
  check("3. Qual realistic 2x2: kappa interp = Substantial", interpretKappa(r.cohensKappa) === "Substantial");
  check("3. Qual realistic 2x2: PASS at 90% threshold", r.overallPass === true);
}

// ─── 4. Qualitative ternary (3 categories): sens/spec absent ───────────────
{
  // Diagonal matrix: 1/2/3 — perfect 3-cat agreement
  const data = [dp("A","A"), dp("B","B"), dp("B","B"), dp("C","C"), dp("C","C"), dp("C","C")];
  const r = calculateQualitative(data, "Inst", ["A","B","C"], 0.90);
  check("4. Qual ternary perfect: %agree=100", approxEq(r.percentAgreement, 100));
  check("4. Qual ternary perfect: kappa=1.0", approxEq(r.cohensKappa, 1.0, 1e-9));
  // sens/spec are only computed when categories.length === 2
  check("4. Qual ternary perfect: sens=0 (no binary calc)", r.sensitivity === 0);
  check("4. Qual ternary perfect: spec=0 (no binary calc)", r.specificity === 0);
}

// ─── 5. Qualitative threshold boundary ─────────────────────────────────────
{
  // 9 of 10 agree -> 90% exactly; passes at threshold 0.90.
  const data10 = [];
  for (let i = 0; i < 9; i++) data10.push(dp("Pos","Pos"));
  data10.push(dp("Pos","Neg"));
  const r90 = calculateQualitative(data10, "Inst", ["Pos","Neg"], 0.90);
  check("5. Qual boundary: %agree=90 PASSES at threshold 0.90", approxEq(r90.percentAgreement, 90) && r90.overallPass === true);
  // Same data, threshold 0.91 -> fails.
  const r91 = calculateQualitative(data10, "Inst", ["Pos","Neg"], 0.91);
  check("5. Qual boundary: %agree=90 FAILS at threshold 0.91", r91.overallPass === false);
}

// ─── 6. Semi-quant exact agreement ─────────────────────────────────────────
{
  // Grade scale 1+, 2+, 3+, 4+ with 4 samples perfectly graded.
  const grades = ["1+","2+","3+","4+"];
  const data = [dp("1+","1+"), dp("2+","2+"), dp("3+","3+"), dp("4+","4+")];
  const r = calculateSemiQuant(data, "Inst", grades, 0.80);
  check("6. SemiQuant perfect: %exact=100, %within1=100", approxEq(r.percentExactAgreement, 100) && approxEq(r.percentWithinOneGrade, 100));
  check("6. SemiQuant perfect: weighted kappa=1.0", approxEq(r.weightedKappa, 1.0, 1e-9));
  check("6. SemiQuant perfect: maxDiscrepancy=0", r.maxDiscrepancy === 0);
  check("6. SemiQuant perfect: PASS", r.overallPass === true);
}

// ─── 7. Semi-quant within-+/-1-grade boundary ──────────────────────────────
{
  // 4 samples; 3 exact, 1 off by 1 grade.
  // 3+ called 4+: diff=1, within 1, max=1
  const grades = ["1+","2+","3+","4+"];
  const data = [dp("1+","1+"), dp("2+","2+"), dp("3+","4+"), dp("4+","4+")];
  const r = calculateSemiQuant(data, "Inst", grades, 0.80);
  check("7. SemiQuant boundary: %exact=75, %within1=100", approxEq(r.percentExactAgreement, 75) && approxEq(r.percentWithinOneGrade, 100));
  check("7. SemiQuant boundary: maxDiscrepancy=1", r.maxDiscrepancy === 1);
  check("7. SemiQuant boundary: PASS at 80% threshold", r.overallPass === true);
}

// ─── 8. Semi-quant fail case ───────────────────────────────────────────────
{
  // 5 samples; 3 exact, 2 off by 2+ grades (outside the +/-1 window).
  const grades = ["1+","2+","3+","4+"];
  const data = [
    dp("1+","1+"), dp("2+","2+"), dp("3+","3+"),
    dp("1+","3+"),  // diff=2
    dp("2+","4+"),  // diff=2
  ];
  const r = calculateSemiQuant(data, "Inst", grades, 0.80);
  // exact=3/5=60, within1=3/5=60 (only the diagonals)
  check("8. SemiQuant fail: %exact=60, %within1=60", approxEq(r.percentExactAgreement, 60) && approxEq(r.percentWithinOneGrade, 60));
  check("8. SemiQuant fail: maxDiscrepancy=2", r.maxDiscrepancy === 2);
  check("8. SemiQuant fail: FAIL at 80% threshold", r.overallPass === false);
}

// ─── 9. Semi-quant weighted kappa (hand-computed) ──────────────────────────
{
  // Grade scale = 4 grades, indices 0..3, k=4, denominator for weight = k-1 = 3.
  // 6 samples:
  //   - 4 exact:  (1+,1+), (2+,2+), (3+,3+), (4+,4+)
  //   - 1 off by 1:  (2+,3+)
  //   - 1 off by 2:  (1+,3+)
  //
  // Build matrix (rows=ref, cols=comp):
  //         1+  2+  3+  4+
  //   1+ |   1   0   1   0  (rowTotal=2)
  //   2+ |   0   1   1   0  (rowTotal=2)
  //   3+ |   0   0   1   0  (rowTotal=1)
  //   4+ |   0   0   0   1  (rowTotal=1)
  //   colTotal 1   1   3   1
  //   n=6
  //
  // weights w_ij = 1 - |i-j|/3:
  //   i=j -> 1; |i-j|=1 -> 2/3; |i-j|=2 -> 1/3; |i-j|=3 -> 0
  //
  // Po (weighted observed):
  //   (1,1)*1*(1/6) + (1,3): w(|0-2|=2)=1/3 * (1/6) = 1/18
  //   (2,2)*1*(1/6)
  //   (2,3): w(|1-2|=1)=2/3 * (1/6) = 2/18 = 1/9
  //   (3,3)*1*(1/6)
  //   (4,4)*1*(1/6)
  //   Sum diagonals (w=1) = 4 * (1/6) = 4/6
  //   Plus off-diagonals: 1/18 + 1/9 = 1/18 + 2/18 = 3/18 = 1/6
  //   Po = 4/6 + 1/6 = 5/6 = 0.8333...
  //
  // Pe (weighted expected): sum over (i,j) of w_ij * (rowTotal_i/n) * (colTotal_j/n)
  //   Rows: 2/6, 2/6, 1/6, 1/6
  //   Cols: 1/6, 1/6, 3/6, 1/6
  //   Expand all 16 cells (in 36-ths to keep integer math):
  //   row=1+ (2/6):
  //     col 1+: w=1, contrib = 1 * (2/6)*(1/6) = 2/36
  //     col 2+: w=2/3, contrib = (2/3) * (2/6)*(1/6) = (2/3)*(2/36) = 4/108
  //     col 3+: w=1/3, contrib = (1/3) * (2/6)*(3/6) = (1/3)*(6/36) = 2/36
  //     col 4+: w=0, contrib = 0
  //   row=2+ (2/6):
  //     col 1+: w=2/3, contrib = (2/3) * (2/6)*(1/6) = 4/108
  //     col 2+: w=1, contrib = (2/6)*(1/6) = 2/36
  //     col 3+: w=2/3, contrib = (2/3)*(2/6)*(3/6) = (2/3)*(6/36) = 4/36
  //     col 4+: w=1/3, contrib = (1/3)*(2/6)*(1/6) = (1/3)*(2/36) = 2/108
  //   row=3+ (1/6):
  //     col 1+: w=1/3, contrib = (1/3)*(1/6)*(1/6) = 1/108
  //     col 2+: w=2/3, contrib = (2/3)*(1/6)*(1/6) = 2/108
  //     col 3+: w=1, contrib = (1/6)*(3/6) = 3/36
  //     col 4+: w=2/3, contrib = (2/3)*(1/6)*(1/6) = 2/108
  //   row=4+ (1/6):
  //     col 1+: w=0, contrib = 0
  //     col 2+: w=1/3, contrib = (1/3)*(1/6)*(1/6) = 1/108
  //     col 3+: w=2/3, contrib = (2/3)*(1/6)*(3/6) = (2/3)*(3/36) = 2/36
  //     col 4+: w=1, contrib = (1/6)*(1/6) = 1/36
  //
  //   Sum in 108-ths:
  //     2/36 = 6/108
  //     4/108
  //     2/36 = 6/108
  //     4/108
  //     2/36 = 6/108
  //     4/36 = 12/108
  //     2/108
  //     1/108
  //     2/108
  //     3/36 = 9/108
  //     2/108
  //     1/108
  //     2/36 = 6/108
  //     1/36 = 3/108
  //   Total = 6+4+6+4+6+12+2+1+2+9+2+1+6+3 = 64/108 = 16/27
  //   Pe = 16/27 = 0.59259259...
  //
  // weightedKappa = (Po - Pe) / (1 - Pe) = (5/6 - 16/27) / (1 - 16/27)
  //   5/6 = 22.5/27; better: LCM(6,27)=54
  //   5/6 = 45/54; 16/27 = 32/54; 1 = 54/54
  //   Numer: 45/54 - 32/54 = 13/54
  //   Denom: 54/54 - 32/54 = 22/54
  //   kappa = 13/22 = 0.59090909...
  const grades = ["1+","2+","3+","4+"];
  const data = [
    dp("1+","1+"), dp("2+","2+"), dp("3+","3+"), dp("4+","4+"),
    dp("2+","3+"),
    dp("1+","3+"),
  ];
  const r = calculateSemiQuant(data, "Inst", grades, 0.80);
  check("9. SemiQuant kappa: n=6", r.n === 6);
  check("9. SemiQuant kappa: %exact=66.67", approxEq(r.percentExactAgreement, 100 * 4 / 6, 1e-6));
  check("9. SemiQuant kappa: %within1=83.33", approxEq(r.percentWithinOneGrade, 100 * 5 / 6, 1e-6));
  check("9. SemiQuant kappa: weighted kappa = 13/22 ~= 0.5909", approxEq(r.weightedKappa, 13 / 22, 1e-6), "got " + r.weightedKappa);
  check("9. SemiQuant kappa: PASS (within1=83.33% >= 80%)", r.overallPass === true);
}

// ─── 10. Semi-quant maxDiscrepancy reports largest gap, not modal ──────────
{
  const grades = ["1+","2+","3+","4+"];
  // 4 samples; 3 with diff=1, 1 with diff=3. Modal diff = 1; max diff = 3.
  const data = [
    dp("1+","2+"),  // 1
    dp("2+","3+"),  // 1
    dp("3+","4+"),  // 1
    dp("1+","4+"),  // 3
  ];
  const r = calculateSemiQuant(data, "Inst", grades, 0.80);
  check("10. SemiQuant max: maxDiscrepancy=3 (not modal 1)", r.maxDiscrepancy === 3);
  // exact=0, within1=3/4=75
  check("10. SemiQuant max: %exact=0, %within1=75", approxEq(r.percentExactAgreement, 0) && approxEq(r.percentWithinOneGrade, 75));
  check("10. SemiQuant max: FAIL at 80% threshold", r.overallPass === false);
}

console.log("");
console.log(`Summary: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
