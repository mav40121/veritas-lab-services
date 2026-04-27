// ─── Shared types ────────────────────────────────────────────────────────────

export interface DataPoint {
  level: number;
  expectedValue: number | null;       // Cal Ver: assigned value | Method Comp: reference method value
  instrumentValues: { [key: string]: number | null };
  // Qualitative / semi-quantitative categorical fields (used INSTEAD of numeric fields)
  expectedCategory?: string | null;
  instrumentCategories?: { [key: string]: string | null };
}

// ─── Math helpers ────────────────────────────────────────────────────────────

function mean(v: number[]) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }

function slopeFn(x: number[], y: number[]) {
  const n = x.length; if (n < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0);
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  return den === 0 ? 1 : num / den;
}
function interceptFn(x: number[], y: number[]) { return mean(y) - slopeFn(x, y) * mean(x); }
function rsq(x: number[], y: number[]) {
  if (x.length < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) ** 2;
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) * y.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  return den === 0 ? 1 : num / den;
}
function stddev(v: number[]) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

// Standard Error of Estimate (SEE) — spread of Y around the regression line
function seeFn(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  const s = slopeFn(x, y), b = interceptFn(x, y);
  const sse = y.reduce((sum, yi, i) => sum + (yi - (s * x[i] + b)) ** 2, 0);
  return Math.sqrt(sse / (n - 2));
}

// Deming regression (assumes equal error variance: lambda=1)
function demingRegression(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  if (n < 2) return { slope: 1, intercept: 0 };
  const xm = mean(x), ym = mean(y);
  const Sxx = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) / (n - 1);
  const Syy = y.reduce((s, yi) => s + (yi - ym) ** 2, 0) / (n - 1);
  const Sxy = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) / (n - 1);
  const slope = (Syy - Sxx + Math.sqrt((Syy - Sxx) ** 2 + 4 * Sxy ** 2)) / (2 * Sxy);
  const intercept = ym - slope * xm;
  return { slope, intercept };
}

// 95% CI for OLS slope and intercept using t-distribution (df = n-2)
// t critical value approximation for common n values
function tCritical(df: number): number {
  // Approximation of t(0.025, df) — accurate enough for lab use
  if (df <= 1) return 12.706;
  if (df <= 2) return 4.303;
  if (df <= 3) return 3.182;
  if (df <= 4) return 2.776;
  if (df <= 5) return 2.571;
  if (df <= 6) return 2.447;
  if (df <= 7) return 2.365;
  if (df <= 8) return 2.306;
  if (df <= 9) return 2.262;
  if (df <= 10) return 2.228;
  if (df <= 15) return 2.131;
  if (df <= 20) return 2.086;
  if (df <= 25) return 2.060;
  if (df <= 30) return 2.042;
  if (df <= 40) return 2.021;
  if (df <= 60) return 2.000;
  if (df <= 120) return 1.980;
  return 1.960;
}

function olsCI(x: number[], y: number[]): { slopeLo: number; slopeHi: number; interceptLo: number; interceptHi: number } {
  const n = x.length;
  if (n < 3) return { slopeLo: 0, slopeHi: 0, interceptLo: 0, interceptHi: 0 };
  const xm = mean(x);
  const s = slopeFn(x, y), b = interceptFn(x, y);
  const see = seeFn(x, y);
  const Sxx = x.reduce((sum, xi) => sum + (xi - xm) ** 2, 0);
  const t = tCritical(n - 2);
  const seSlopeNum = see / Math.sqrt(Sxx);
  const seIntercept = see * Math.sqrt(x.reduce((sum, xi) => sum + xi ** 2, 0) / (n * Sxx));
  return {
    slopeLo: s - t * seSlopeNum,
    slopeHi: s + t * seSlopeNum,
    interceptLo: b - t * seIntercept,
    interceptHi: b + t * seIntercept,
  };
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  proportionalBias: number; // slope - 1
  r2: number;
  n: number;
  see: number;
  // 95% CI
  slopeLo?: number;
  slopeHi?: number;
  interceptLo?: number;
  interceptHi?: number;
  regressionType?: "Deming" | "OLS";
}

// ─── CALIBRATION VERIFICATION ─────────────────────────────────────────────────
// Input: known assigned values (x) vs. measured values per instrument (y)
// Key metrics: % recovery, observed error vs. TEa, pass/fail per level

export interface CalVerLevelResult {
  level: number;
  assignedValue: number;
  mean: number;
  pctRecovery: number;
  obsError: number;        // (mean - assigned) / assigned, as fraction
  passFailMean: "Pass" | "Fail";
  instruments: {
    [name: string]: {
      value: number;
      obsError: number;    // (value - assigned) / assigned
      passFail: "Pass" | "Fail";
    };
  };
}

export interface CalVerResults {
  type: "cal_ver";
  levelResults: CalVerLevelResult[];
  regression: { [key: string]: RegressionResult };
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  maxPctRecovery: number;
  minPctRecovery: number;
  avgObsError: number;
  summary: string;
}

export function calculateCalVer(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  cliaError: number
): CalVerResults {
  const valid = dataPoints.filter(
    (dp) => dp.expectedValue !== null && instrumentNames.some((n) => dp.instrumentValues[n] !== null)
  );

  const levelResults: CalVerLevelResult[] = valid.map((dp) => {
    const assigned = dp.expectedValue!;
    const vals = instrumentNames.map((n) => dp.instrumentValues[n]).filter((v): v is number => v !== null);
    const meanVal = vals.length ? mean(vals) : assigned;
    const pctRecovery = assigned !== 0 ? (meanVal / assigned) * 100 : 100;
    const obsError = assigned !== 0 ? (meanVal - assigned) / assigned : 0;

    const instruments: CalVerLevelResult["instruments"] = {};
    instrumentNames.forEach((n) => {
      const v = dp.instrumentValues[n];
      if (v !== null && v !== undefined) {
        const e = assigned !== 0 ? (v - assigned) / assigned : 0;
        instruments[n] = { value: v, obsError: e, passFail: Math.abs(e) <= cliaError ? "Pass" : "Fail" };
      }
    });

    return {
      level: dp.level,
      assignedValue: assigned,
      mean: meanVal,
      pctRecovery,
      obsError,
      passFailMean: Math.abs(obsError) <= cliaError ? "Pass" : "Fail",
      instruments,
    };
  });

  // Regression: each instrument vs. assigned (OLS only for Cal Ver)
  const regression: { [k: string]: RegressionResult } = {};
  const assignedVals = levelResults.map((r) => r.assignedValue);
  const meanVals = levelResults.map((r) => r.mean);
  if (assignedVals.length >= 2) {
    const s = slopeFn(assignedVals, meanVals), b = interceptFn(assignedVals, meanVals);
    const ci = olsCI(assignedVals, meanVals);
    regression["Mean vs. Assigned"] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(assignedVals, meanVals), n: assignedVals.length, see: seeFn(assignedVals, meanVals), ...ci, regressionType: "OLS" };
  }
  instrumentNames.forEach((n) => {
    const xs: number[] = [], ys: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { xs.push(r.assignedValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) {
      const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
      const ci = olsCI(xs, ys);
      regression[`${n} vs. Assigned`] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys), n: xs.length, see: seeFn(xs, ys), ...ci, regressionType: "OLS" };
    }
  });

  let passCount = 0, totalCount = 0;
  levelResults.forEach((r) =>
    instrumentNames.forEach((n) => {
      if (r.instruments[n]) { totalCount++; if (r.instruments[n].passFail === "Pass") passCount++; }
    })
  );
  const overallPass = passCount === totalCount && totalCount > 0;
  const recoveries = levelResults.map((r) => r.pctRecovery);
  const maxPctRecovery = recoveries.length ? Math.max(...recoveries) : 100;
  const minPctRecovery = recoveries.length ? Math.min(...recoveries) : 100;
  const avgObsError = levelResults.length ? mean(levelResults.map((r) => Math.abs(r.obsError))) : 0;

  const range = levelResults.length
    ? `${levelResults[0].assignedValue.toFixed(3)} to ${levelResults[levelResults.length - 1].assignedValue.toFixed(3)}`
    : "-";
  const cliaPercent = (cliaError * 100).toFixed(1);
  const maxDev = levelResults.length ? Math.max(...levelResults.map((r) => Math.abs(r.pctRecovery - 100))) : 0;
  const summary =
    `Calibration Verification was performed over an assigned value range of ${range}. ` +
    `CLIA Total Allowable Error (TEa) was ±${cliaPercent}%. ` +
    `${passCount} of ${totalCount} measured results were within TEa. ` +
    `Maximum deviation from 100% recovery was ${maxDev.toFixed(1)}%. ` +
    `The calibration verification ${overallPass ? "PASSED" : "FAILED"} CLIA accuracy requirements.`;

  return { type: "cal_ver", levelResults, regression, overallPass, passCount, totalCount, maxPctRecovery, minPctRecovery, avgObsError, summary };
}

// ─── METHOD COMPARISON ─────────────────────────────────────────────────────────
// Input: primary method (x = expectedValue) vs. comparison method(s) (y = instrumentValues)
// Key metrics: slope, intercept, R², bias per level, Bland-Altman difference

export interface MethodCompLevelResult {
  level: number;
  referenceValue: number; // primary instrument value
  instruments: {
    [name: string]: {
      value: number;
      difference: number;       // comparison - primary (absolute bias)
      pctDifference: number;    // (comparison - primary) / primary * 100
      passFail: "Pass" | "Fail";
    };
  };
}

export interface MethodCompResults {
  type: "method_comparison";
  levelResults: MethodCompLevelResult[];
  regression: { [key: string]: RegressionResult };
  blandAltman: {
    [key: string]: {
      meanDiff: number;
      sdDiff: number;
      loa_upper: number;
      loa_lower: number;
      pctMeanDiff: number;
    };
  };
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  xRange: { min: number; max: number };
  yRange: { [name: string]: { min: number; max: number } };
  summary: string;
}

export function calculateMethodComparison(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  cliaError: number,
  teaIsPercentage: boolean = true,
  cliaAbsoluteFloor: number | null = null
): MethodCompResults {
  const valid = dataPoints.filter(
    (dp) => dp.expectedValue !== null && instrumentNames.some((n) => dp.instrumentValues[n] !== null)
  );

  // Floating-point tolerance to absorb binary float noise (e.g. 0.3 mmol/L boundary)
  const FP_EPS = 1e-9;

  const levelResults: MethodCompLevelResult[] = valid.map((dp) => {
    const ref = dp.expectedValue!;
    const instruments: MethodCompLevelResult["instruments"] = {};
    instrumentNames.forEach((n) => {
      const v = dp.instrumentValues[n];
      if (v !== null && v !== undefined) {
        const diff = v - ref;
        const pctDiff = ref !== 0 ? (diff / ref) * 100 : 0;
        // Dual-criterion S493 rule: pass when |diff| <= max(percent_allowance, absolute_floor)
        const pctAllowance = teaIsPercentage ? Math.abs(ref) * cliaError : 0;
        const absAllowance = teaIsPercentage
          ? (cliaAbsoluteFloor ?? 0)
          : cliaError;
        const allowance = Math.max(pctAllowance, absAllowance);
        const passed = Math.abs(diff) <= allowance + FP_EPS;
        instruments[n] = { value: v, difference: diff, pctDifference: pctDiff, passFail: passed ? "Pass" : "Fail" };
      }
    });
    return { level: dp.level, referenceValue: ref, instruments };
  });

  // Result ranges
  const refVals = levelResults.map((r) => r.referenceValue);
  const xRange = { min: Math.min(...refVals), max: Math.max(...refVals) };
  const yRange: { [name: string]: { min: number; max: number } } = {};
  instrumentNames.forEach((n) => {
    const ys = levelResults.filter(r => r.instruments[n]).map(r => r.instruments[n].value);
    if (ys.length) yRange[n] = { min: Math.min(...ys), max: Math.max(...ys) };
  });

  // Regression: Deming + OLS for each comparison method vs. primary
  const regression: { [k: string]: RegressionResult } = {};
  instrumentNames.forEach((n) => {
    const xs: number[] = [], ys: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { xs.push(r.referenceValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) {
      // Deming regression
      const dem = demingRegression(xs, ys);
      const demSee = seeFn(xs, ys);
      regression[`${n} vs. Primary (Deming)`] = {
        slope: dem.slope, intercept: dem.intercept, proportionalBias: dem.slope - 1,
        r2: rsq(xs, ys), n: xs.length, see: demSee, regressionType: "Deming"
      };
      // OLS regression with 95% CI
      const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
      const ci = olsCI(xs, ys);
      regression[`${n} vs. Primary (OLS)`] = {
        slope: s, intercept: b, proportionalBias: s - 1,
        r2: rsq(xs, ys), n: xs.length, see: seeFn(xs, ys), ...ci, regressionType: "OLS"
      };
    }
  });

  // Bland-Altman per instrument
  const blandAltman: MethodCompResults["blandAltman"] = {};
  instrumentNames.forEach((n) => {
    const diffs: number[] = [];
    const pctDiffs: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { diffs.push(r.instruments[n].difference); pctDiffs.push(r.instruments[n].pctDifference); } });
    if (diffs.length >= 2) {
      const md = mean(diffs);
      const sd = stddev(diffs);
      const pmd = mean(pctDiffs);
      blandAltman[n] = { meanDiff: md, sdDiff: sd, loa_upper: md + 1.96 * sd, loa_lower: md - 1.96 * sd, pctMeanDiff: pmd };
    }
  });

  let passCount = 0, totalCount = 0;
  levelResults.forEach((r) =>
    instrumentNames.forEach((n) => {
      if (r.instruments[n]) { totalCount++; if (r.instruments[n].passFail === "Pass") passCount++; }
    })
  );
  const overallPass = passCount === totalCount && totalCount > 0;
  const cliaPercent = (cliaError * 100).toFixed(1);

  const regLines = Object.entries(regression)
    .map(([name, reg]) => `${name}: slope=${reg.slope.toFixed(3)}, intercept=${reg.intercept.toFixed(3)}, R²=${reg.r2.toFixed(4)}`)
    .join("; ");
  const baLines = Object.entries(blandAltman)
    .map(([name, ba]) => `${name}: mean bias=${ba.pctMeanDiff.toFixed(2)}%, 95% LoA [${ba.loa_lower.toFixed(3)}, ${ba.loa_upper.toFixed(3)}]`)
    .join("; ");
  const n = levelResults.length;
  const summary =
    `Correlation / Method Comparison was performed using ${n} patient samples with CLIA TEa of ±${cliaPercent}%. ` +
    `Regression analysis: ${regLines}. ` +
    `Bland-Altman analysis: ${baLines}. ` +
    `${passCount} of ${totalCount} paired results were within TEa. ` +
    `The method comparison ${overallPass ? "PASSED" : "FAILED"} CLIA acceptability criteria.`;

  return { type: "method_comparison", levelResults, regression, blandAltman, overallPass, passCount, totalCount, xRange, yRange, summary };
}

// ─── QUALITATIVE METHOD COMPARISON ───────────────────────────────────────────
// Binary concordance: Pos/Neg, Reactive/Nonreactive, Detected/Not Detected

export interface QualitativeResults {
  type: "qualitative";
  concordanceMatrix: { [refCat: string]: { [compCat: string]: number } };
  totalSamples: number;
  percentAgreement: number;
  sensitivity: number;
  specificity: number;
  cohensKappa: number;
  overallPass: boolean;
  summary: string;
  categories: string[];
  passThreshold: number;
}

function interpretKappa(k: number): string {
  if (k < 0.20) return "Poor";
  if (k <= 0.40) return "Fair";
  if (k <= 0.60) return "Moderate";
  if (k <= 0.80) return "Substantial";
  return "Almost Perfect";
}

export function calculateQualitative(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  categories: string[],
  passThreshold: number = 0.90
): QualitativeResults {
  // Use expectedCategory as reference, instrumentCategories for comparison
  const compName = instrumentNames[0];
  const valid = dataPoints.filter(
    (dp) => dp.expectedCategory && dp.instrumentCategories?.[compName]
  );
  const n = valid.length;

  // Build concordance matrix
  const matrix: { [ref: string]: { [comp: string]: number } } = {};
  categories.forEach((r) => {
    matrix[r] = {};
    categories.forEach((c) => { matrix[r][c] = 0; });
  });
  valid.forEach((dp) => {
    const ref = dp.expectedCategory!;
    const comp = dp.instrumentCategories![compName]!;
    if (matrix[ref] && matrix[ref][comp] !== undefined) {
      matrix[ref][comp]++;
    }
  });

  // Percent agreement (diagonal sum / total)
  let agree = 0;
  categories.forEach((c) => { agree += matrix[c]?.[c] || 0; });
  const percentAgreement = n > 0 ? (agree / n) * 100 : 0;

  // Cohen's kappa: k = (Po - Pe) / (1 - Pe)
  const Po = n > 0 ? agree / n : 0;
  let Pe = 0;
  categories.forEach((c) => {
    const rowTotal = categories.reduce((s, cc) => s + (matrix[c]?.[cc] || 0), 0);
    const colTotal = categories.reduce((s, rc) => s + (matrix[rc]?.[c] || 0), 0);
    Pe += (rowTotal * colTotal);
  });
  Pe = n > 0 ? Pe / (n * n) : 0;
  const cohensKappa = Pe < 1 ? (Po - Pe) / (1 - Pe) : 1;

  // Sensitivity and specificity (for binary: first category = positive)
  let sensitivity = 0, specificity = 0;
  if (categories.length === 2) {
    const pos = categories[0], neg = categories[1];
    const tp = matrix[pos]?.[pos] || 0;
    const fn = matrix[pos]?.[neg] || 0;
    const fp = matrix[neg]?.[pos] || 0;
    const tn = matrix[neg]?.[neg] || 0;
    sensitivity = (tp + fn) > 0 ? (tp / (tp + fn)) * 100 : 0;
    specificity = (tn + fp) > 0 ? (tn / (tn + fp)) * 100 : 0;
  }

  const overallPass = percentAgreement >= passThreshold * 100;

  const summary =
    `Qualitative method comparison was performed using ${n} patient samples. ` +
    `Overall agreement was ${percentAgreement.toFixed(1)}% (${agree}/${n}). ` +
    `Cohen's kappa = ${cohensKappa.toFixed(3)} (${interpretKappa(cohensKappa)}). ` +
    (categories.length === 2 ? `Sensitivity = ${sensitivity.toFixed(1)}%, Specificity = ${specificity.toFixed(1)}%. ` : "") +
    `Acceptance criterion: >=${(passThreshold * 100).toFixed(0)}% agreement. ` +
    `The qualitative method comparison ${overallPass ? "PASSED" : "FAILED"} acceptability criteria.`;

  return {
    type: "qualitative", concordanceMatrix: matrix, totalSamples: n,
    percentAgreement, sensitivity, specificity, cohensKappa,
    overallPass, summary, categories, passThreshold,
  };
}

// ─── SEMI-QUANTITATIVE METHOD COMPARISON ────────────────────────────────────
// Ordinal grades with +/-1 grade acceptance

export interface SemiQuantSampleDetail {
  sample: number;
  reference: string;
  comparison: string;
  gradeDiff: number;
  pass: boolean;
}

export interface SemiQuantResults {
  type: "semi_quantitative";
  concordanceMatrix: { [refGrade: string]: { [compGrade: string]: number } };
  totalSamples: number;
  percentExactAgreement: number;
  percentWithinOneGrade: number;
  weightedKappa: number;
  maxDiscrepancy: number;
  overallPass: boolean;
  summary: string;
  gradeScale: string[];
  sampleDetails: SemiQuantSampleDetail[];
  passThreshold: number;
}

export function calculateSemiQuant(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  gradeScale: string[],
  passThreshold: number = 0.80
): SemiQuantResults {
  const compName = instrumentNames[0];
  const valid = dataPoints.filter(
    (dp) => dp.expectedCategory && dp.instrumentCategories?.[compName]
  );
  const n = valid.length;
  const k = gradeScale.length;

  // Build grade index map for ordinal distance
  const gradeIndex: { [g: string]: number } = {};
  gradeScale.forEach((g, i) => { gradeIndex[g] = i; });

  // Concordance matrix
  const matrix: { [ref: string]: { [comp: string]: number } } = {};
  gradeScale.forEach((r) => {
    matrix[r] = {};
    gradeScale.forEach((c) => { matrix[r][c] = 0; });
  });

  const sampleDetails: SemiQuantSampleDetail[] = [];
  let exactCount = 0, withinOneCount = 0, maxDisc = 0;

  valid.forEach((dp) => {
    const ref = dp.expectedCategory!;
    const comp = dp.instrumentCategories![compName]!;
    if (matrix[ref] && matrix[ref][comp] !== undefined) {
      matrix[ref][comp]++;
    }
    const refIdx = gradeIndex[ref] ?? 0;
    const compIdx = gradeIndex[comp] ?? 0;
    const diff = Math.abs(refIdx - compIdx);
    if (diff === 0) exactCount++;
    if (diff <= 1) withinOneCount++;
    if (diff > maxDisc) maxDisc = diff;
    sampleDetails.push({
      sample: dp.level, reference: ref, comparison: comp,
      gradeDiff: diff, pass: diff <= 1,
    });
  });

  const percentExactAgreement = n > 0 ? (exactCount / n) * 100 : 0;
  const percentWithinOneGrade = n > 0 ? (withinOneCount / n) * 100 : 0;

  // Weighted kappa with linear weights: w_ij = 1 - |i-j| / (k-1)
  let weightedPo = 0, weightedPe = 0;
  if (n > 0 && k > 1) {
    gradeScale.forEach((r, i) => {
      gradeScale.forEach((c, j) => {
        const w = 1 - Math.abs(i - j) / (k - 1);
        weightedPo += w * ((matrix[r]?.[c] || 0) / n);
      });
    });
    gradeScale.forEach((r, i) => {
      const rowTotal = gradeScale.reduce((s, cc) => s + (matrix[r]?.[cc] || 0), 0);
      gradeScale.forEach((c, j) => {
        const colTotal = gradeScale.reduce((s, rc) => s + (matrix[rc]?.[c] || 0), 0);
        const w = 1 - Math.abs(i - j) / (k - 1);
        weightedPe += w * (rowTotal / n) * (colTotal / n);
      });
    });
  }
  const weightedKappa = weightedPe < 1 ? (weightedPo - weightedPe) / (1 - weightedPe) : 1;

  const overallPass = percentWithinOneGrade >= passThreshold * 100;

  const summary =
    `Semi-quantitative method comparison was performed using ${n} patient samples ` +
    `with a ${k}-grade ordinal scale (${gradeScale.join(", ")}). ` +
    `Exact agreement: ${percentExactAgreement.toFixed(1)}% (${exactCount}/${n}). ` +
    `Agreement within +/-1 grade: ${percentWithinOneGrade.toFixed(1)}% (${withinOneCount}/${n}). ` +
    `Weighted kappa = ${weightedKappa.toFixed(3)} (${interpretKappa(weightedKappa)}). ` +
    `Maximum discrepancy: ${maxDisc} grade${maxDisc !== 1 ? "s" : ""}. ` +
    `Acceptance criterion: >=${(passThreshold * 100).toFixed(0)}% within +/-1 grade. ` +
    `The semi-quantitative method comparison ${overallPass ? "PASSED" : "FAILED"} acceptability criteria.`;

  return {
    type: "semi_quantitative", concordanceMatrix: matrix, totalSamples: n,
    percentExactAgreement, percentWithinOneGrade, weightedKappa,
    maxDiscrepancy: maxDisc, overallPass, summary, gradeScale,
    sampleDetails, passThreshold,
  };
}

// ─── PRECISION / IMPRECISION ──────────────────────────────────────────────────

export interface PrecisionLevelResult {
  level: number;
  levelName: string;
  n: number;
  mean: number;
  sd: number;
  cv: number;
  allowableCV: number;
  passFail: "Pass" | "Fail";
  withinRunSD?: number;
  withinRunCV?: number;
  betweenRunSD?: number;
  betweenRunCV?: number;
  betweenDaySD?: number;
  betweenDayCV?: number;
  totalSD?: number;
  totalCV?: number;
}

export interface PrecisionResults {
  type: "precision";
  mode: "simple" | "advanced";
  levelResults: PrecisionLevelResult[];
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  summary: string;
}

export interface PrecisionDataPoint {
  level: number;
  levelName: string;
  values: number[];
  days?: number[][];
  numDays?: number;
  runsPerDay?: number;
  replicatesPerRun?: number;
}

export function calculatePrecision(
  dataPoints: PrecisionDataPoint[],
  cliaAllowableImprecision: number,
  mode: "simple" | "advanced"
): PrecisionResults {
  const allowableCV = cliaAllowableImprecision * 100;

  const levelResults: PrecisionLevelResult[] = dataPoints.map(dp => {
    const allVals = mode === "simple"
      ? dp.values.filter(v => v !== null && !isNaN(v))
      : (dp.days || []).flat().filter(v => v !== null && !isNaN(v));

    if (allVals.length < 2) {
      return {
        level: dp.level, levelName: dp.levelName, n: 0, mean: 0, sd: 0, cv: 0,
        allowableCV, passFail: "Fail" as const
      };
    }

    const n = allVals.length;
    const meanVal = allVals.reduce((a, b) => a + b, 0) / n;
    const variance = allVals.reduce((s, v) => s + (v - meanVal) ** 2, 0) / (n - 1);
    const sdVal = Math.sqrt(variance);
    const cvVal = meanVal !== 0 ? (sdVal / meanVal) * 100 : 0;

    if (mode === "simple") {
      return {
        level: dp.level, levelName: dp.levelName, n, mean: meanVal, sd: sdVal,
        cv: cvVal, allowableCV, passFail: cvVal <= allowableCV ? "Pass" : "Fail"
      };
    }

    // Advanced ANOVA mode
    const numDays = dp.numDays || 1;
    const runsPerDay = dp.runsPerDay || 1;
    const replicatesPerRun = dp.replicatesPerRun || 1;
    const days = dp.days || [];

    let ssWithin = 0, dfWithin = 0;
    let ssBetweenRun = 0, dfBetweenRun = 0;

    const dayMeans: number[] = [];
    days.forEach(dayRuns => {
      const runSize = replicatesPerRun;
      const runMeans: number[] = [];
      for (let r = 0; r < runsPerDay; r++) {
        const runVals = dayRuns.slice(r * runSize, (r + 1) * runSize).filter(v => !isNaN(v));
        if (runVals.length < 1) continue;
        const rm = runVals.reduce((a, b) => a + b, 0) / runVals.length;
        runMeans.push(rm);
        ssWithin += runVals.reduce((s, v) => s + (v - rm) ** 2, 0);
        dfWithin += runVals.length - 1;
      }
      const dayMean = runMeans.length ? runMeans.reduce((a, b) => a + b, 0) / runMeans.length : 0;
      dayMeans.push(dayMean);
      ssBetweenRun += runMeans.reduce((s, rm) => s + replicatesPerRun * (rm - dayMean) ** 2, 0);
      dfBetweenRun += runMeans.length - 1;
    });

    const grandMean = dayMeans.length ? dayMeans.reduce((a, b) => a + b, 0) / dayMeans.length : meanVal;
    const ssBetweenDay = dayMeans.reduce((s, dm) => s + (runsPerDay * replicatesPerRun) * (dm - grandMean) ** 2, 0);
    const dfBetweenDay = dayMeans.length - 1;

    const msWithin = dfWithin > 0 ? ssWithin / dfWithin : 0;
    const msBetweenRun = dfBetweenRun > 0 ? ssBetweenRun / dfBetweenRun : 0;
    const msBetweenDay = dfBetweenDay > 0 ? ssBetweenDay / dfBetweenDay : 0;

    const varWithinRun = msWithin;
    const varBetweenRun = Math.max(0, (msBetweenRun - msWithin) / replicatesPerRun);
    const varBetweenDay = Math.max(0, (msBetweenDay - msBetweenRun) / (runsPerDay * replicatesPerRun));
    const varTotal = varWithinRun + varBetweenRun + varBetweenDay;

    const toCV = (v: number) => meanVal !== 0 ? (Math.sqrt(v) / meanVal) * 100 : 0;

    return {
      level: dp.level, levelName: dp.levelName, n, mean: meanVal, sd: sdVal,
      cv: cvVal, allowableCV,
      passFail: cvVal <= allowableCV ? "Pass" : "Fail",
      withinRunSD: Math.sqrt(varWithinRun), withinRunCV: toCV(varWithinRun),
      betweenRunSD: Math.sqrt(varBetweenRun), betweenRunCV: toCV(varBetweenRun),
      betweenDaySD: Math.sqrt(varBetweenDay), betweenDayCV: toCV(varBetweenDay),
      totalSD: Math.sqrt(varTotal), totalCV: toCV(varTotal),
    };
  });

  const passCount = levelResults.filter(r => r.passFail === "Pass").length;
  const totalCount = levelResults.length;
  const overallPass = passCount === totalCount && totalCount > 0;
  const cliaStr = allowableCV.toFixed(1);
  const summary = `Precision Verification was performed on ${totalCount} control level${totalCount !== 1 ? "s" : ""}. ` +
    `CLIA Allowable Imprecision (CV) was ±${cliaStr}%. ` +
    `${passCount} of ${totalCount} levels met the allowable imprecision criteria. ` +
    `The precision study ${overallPass ? "PASSED" : "FAILED"} CLIA requirements.`;

  return { type: "precision", mode, levelResults, overallPass, passCount, totalCount, summary };
}

// ─── LOT-TO-LOT VERIFICATION ─────────────────────────────────────────────────

export interface LotToLotSpecimen {
  specimenId: string;
  currentLot: number;
  newLot: number;
  pctDifference: number;
  absPctDifference: number;
  passFail: "Pass" | "Fail";
}

export interface LotToLotCohortResult {
  cohort: "Normal" | "Abnormal";
  n: number;
  specimens: LotToLotSpecimen[];
  meanPctDiff: number;
  sdPctDiff: number;
  meanAbsPctDiff: number;
  maxAbsPctDiff: number;
  coverage: number; // % of specimens within TEa
  pass: boolean;
}

export interface LotToLotResults {
  type: "lot_to_lot";
  cohorts: LotToLotCohortResult[];
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  tea: number;
  summary: string;
}

export interface LotToLotDataPoint {
  specimenId: string;
  currentLot: number | null;
  newLot: number | null;
  cohort: "Normal" | "Abnormal";
}

export function calculateLotToLot(
  dataPoints: LotToLotDataPoint[],
  tea: number, // fraction, e.g. 0.10 for 10%
  sampleType: "normal" | "abnormal" | "both"
): LotToLotResults {
  const cohorts: ("Normal" | "Abnormal")[] = sampleType === "both" ? ["Normal", "Abnormal"] : [sampleType === "normal" ? "Normal" : "Abnormal"];

  const cohortResults: LotToLotCohortResult[] = cohorts.map(cohort => {
    const valid = dataPoints.filter(dp => dp.cohort === cohort && dp.currentLot !== null && dp.newLot !== null);
    const specimens: LotToLotSpecimen[] = valid.map(dp => {
      const pctDiff = dp.currentLot !== 0 ? ((dp.newLot! - dp.currentLot!) / dp.currentLot!) * 100 : 0;
      const absPct = Math.abs(pctDiff);
      return {
        specimenId: dp.specimenId,
        currentLot: dp.currentLot!,
        newLot: dp.newLot!,
        pctDifference: pctDiff,
        absPctDifference: absPct,
        passFail: absPct <= tea * 100 ? "Pass" : "Fail",
      };
    });
    const pctDiffs = specimens.map(s => s.pctDifference);
    const absPctDiffs = specimens.map(s => s.absPctDifference);
    const n = specimens.length;
    const meanPctDiff = n > 0 ? mean(pctDiffs) : 0;
    const sdPctDiff = n > 1 ? stddev(pctDiffs) : 0;
    const meanAbsPctDiff = n > 0 ? mean(absPctDiffs) : 0;
    const maxAbsPctDiff = n > 0 ? Math.max(...absPctDiffs) : 0;
    const withinTea = specimens.filter(s => s.passFail === "Pass").length;
    const coverage = n > 0 ? (withinTea / n) * 100 : 0;
    const pass = meanAbsPctDiff <= tea * 100 && coverage >= 90;

    return { cohort, n, specimens, meanPctDiff, sdPctDiff, meanAbsPctDiff, maxAbsPctDiff, coverage, pass };
  });

  const totalSpecimens = cohortResults.reduce((s, c) => s + c.n, 0);
  const totalPass = cohortResults.reduce((s, c) => s + c.specimens.filter(sp => sp.passFail === "Pass").length, 0);
  const overallPass = cohortResults.every(c => c.pass);
  const teaPct = (tea * 100).toFixed(1);

  const summary = cohortResults.map(c =>
    `${c.cohort} cohort (N=${c.n}): Mean |%Diff| = ${c.meanAbsPctDiff.toFixed(1)}%, Coverage = ${c.coverage.toFixed(0)}% within TEa of ±${teaPct}%. ${c.pass ? "PASS" : "FAIL"}.`
  ).join(" ") + ` Overall: ${overallPass ? "PASS" : "FAIL"}: ${totalPass}/${totalSpecimens} specimens within TEa.`;

  return { type: "lot_to_lot", cohorts: cohortResults, overallPass, passCount: totalPass, totalCount: totalSpecimens, tea, summary };
}

// ─── PT/COAG NEW LOT VALIDATION ──────────────────────────────────────────────

export function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const logSum = values.reduce((s, v) => s + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

export function calculateINR(pt: number, normalMeanPT: number, isi: number): number {
  return Math.pow(pt / normalMeanPT, isi);
}

export interface Module1Result {
  geoMeanPT: number;
  geoMeanINR: number;
  specimens: { id: string; pt: number; inr: number; ptInRI: boolean; inrInRI: boolean }[];
  n: number;
  ptRIPass: boolean; // ≤10% outside PT RI
  inrRIPass: boolean; // ≤10% outside INR RI
  ptOutsideRI: number;
  inrOutsideRI: number;
  ptRI: { low: number; high: number };
  inrRI: { low: number; high: number };
  pass: boolean;
}

export interface DemingRegressionResult {
  slope: number;
  intercept: number;
  r: number;
  r2: number;
  n: number;
  see: number;
  slopeLo?: number;
  slopeHi?: number;
}

export interface ErrorIndexResult {
  specimenId: string;
  x: number;
  y: number;
  errorIndex: number;
  pass: boolean;
}

export interface Module2or3Result {
  regression: DemingRegressionResult;
  errorIndexResults: ErrorIndexResult[];
  averageErrorIndex: number;
  errorIndexRange: { min: number; max: number };
  coverage: number; // % with |EI| ≤ 1.0
  pass: boolean; // coverage ≥ 90%
  tea: number;
}

export interface PTCoagResults {
  type: "pt_coag";
  module1: Module1Result;
  module2: Module2or3Result;
  module3: Module2or3Result | null; // null if skipped
  overallPass: boolean;
  summary: string;
}

export function calculateModule1(
  ptValues: number[],
  isi: number,
  ptRI: { low: number; high: number },
  inrRI: { low: number; high: number }
): Module1Result {
  const geoMeanPT = geometricMean(ptValues);
  const specimens = ptValues.map((pt, i) => {
    const inr = calculateINR(pt, geoMeanPT, isi);
    return {
      id: `S${String(i + 1).padStart(5, "0")}`,
      pt,
      inr,
      ptInRI: pt >= ptRI.low && pt <= ptRI.high,
      inrInRI: inr >= inrRI.low && inr <= inrRI.high,
    };
  });
  const geoMeanINR = geometricMean(specimens.map(s => s.inr));
  const n = specimens.length;
  const ptOutsideRI = specimens.filter(s => !s.ptInRI).length;
  const inrOutsideRI = specimens.filter(s => !s.inrInRI).length;
  const ptRIPass = n > 0 ? (ptOutsideRI / n) <= 0.10 : false;
  const inrRIPass = n > 0 ? (inrOutsideRI / n) <= 0.10 : false;
  return { geoMeanPT, geoMeanINR, specimens, n, ptRIPass, inrRIPass, ptOutsideRI, inrOutsideRI, ptRI, inrRI, pass: ptRIPass && inrRIPass };
}

export function calculateDemingModule(
  xValues: number[],
  yValues: number[],
  specimenIds: string[],
  tea: number // fraction, e.g. 0.20 for 20%
): Module2or3Result {
  const dem = demingRegression(xValues, yValues);
  const xm = mean(xValues), ym = mean(yValues);
  const n = xValues.length;
  const Sxx = xValues.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  const Syy = yValues.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  const Sxy = xValues.reduce((s, xi, i) => s + (xi - xm) * (yValues[i] - ym), 0);
  const r = Sxx > 0 && Syy > 0 ? Sxy / Math.sqrt(Sxx * Syy) : 1;
  const see = seeFn(xValues, yValues);

  const errorIndexResults: ErrorIndexResult[] = xValues.map((x, i) => {
    const y = yValues[i];
    const ei = tea > 0 && x !== 0 ? (y - x) / (tea * x) : 0;
    return { specimenId: specimenIds[i], x, y, errorIndex: ei, pass: Math.abs(ei) <= 1.0 };
  });

  const eiValues = errorIndexResults.map(r => r.errorIndex);
  const averageErrorIndex = mean(eiValues);
  const eiAbsValues = eiValues.map(Math.abs);
  const errorIndexRange = { min: Math.min(...eiValues), max: Math.max(...eiValues) };
  const passCount = errorIndexResults.filter(r => r.pass).length;
  const coverage = n > 0 ? (passCount / n) * 100 : 0;

  return {
    regression: { slope: dem.slope, intercept: dem.intercept, r, r2: r * r, n, see },
    errorIndexResults,
    averageErrorIndex,
    errorIndexRange,
    coverage,
    pass: coverage >= 90,
    tea,
  };
}

export function calculatePTCoag(
  module1Data: { ptValues: number[]; isi: number; ptRI: { low: number; high: number }; inrRI: { low: number; high: number } },
  module2Data: { xValues: number[]; yValues: number[]; specimenIds: string[]; tea: number },
  module3Data: { xValues: number[]; yValues: number[]; specimenIds: string[]; tea: number } | null
): PTCoagResults {
  const module1 = calculateModule1(module1Data.ptValues, module1Data.isi, module1Data.ptRI, module1Data.inrRI);
  const module2 = calculateDemingModule(module2Data.xValues, module2Data.yValues, module2Data.specimenIds, module2Data.tea);
  const module3 = module3Data ? calculateDemingModule(module3Data.xValues, module3Data.yValues, module3Data.specimenIds, module3Data.tea) : null;

  const overallPass = module1.pass && module2.pass && (module3 ? module3.pass : true);

  const m1Summary = `Module 1: Geometric Mean PT = ${module1.geoMeanPT.toFixed(1)} sec, INR = ${module1.geoMeanINR.toFixed(2)}. PT RI verification: ${module1.ptRIPass ? "PASS" : "FAIL"} (${module1.ptOutsideRI}/${module1.n} outside). INR RI verification: ${module1.inrRIPass ? "PASS" : "FAIL"} (${module1.inrOutsideRI}/${module1.n} outside).`;
  const m2Summary = `Module 2: Two-Instrument Comparison. R=${module2.regression.r.toFixed(4)}, Slope=${module2.regression.slope.toFixed(3)}, Coverage=${module2.coverage.toFixed(0)}% within TEa. ${module2.pass ? "PASS" : "FAIL"}.`;
  const m3Summary = module3 ? `Module 3: Old Lot vs New Lot. R=${module3.regression.r.toFixed(4)}, Slope=${module3.regression.slope.toFixed(3)}, Coverage=${module3.coverage.toFixed(0)}% within TEa. ${module3.pass ? "PASS" : "FAIL"}.` : "Module 3: Skipped (single analyzer lab).";

  const summary = `${m1Summary} ${m2Summary} ${m3Summary} Overall: ${overallPass ? "PASS" : "FAIL"}.`;

  return { type: "pt_coag", module1, module2, module3, overallPass, summary };
}

// ─── QC RANGE ESTABLISHMENT ─────────────────────────────────────────────────

export interface QCRangeLevelResult {
  analyte: string;
  level: string;
  analyzer: string;
  n: number;
  newMean: number;
  newSD: number;
  cv: number;
  oldMean: number | null;
  oldSD: number | null;
  pctDiffFromOld: number | null;
  flagShift: boolean; // >10% shift
}

export interface QCRangeResults {
  type: "qc_range";
  levelResults: QCRangeLevelResult[];
  overallShiftCount: number;
  totalLevels: number;
  dateRange: { start: string; end: string };
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  summary: string;
}

export interface QCRangeDataPoint {
  analyte: string;
  level: string;
  analyzer: string;
  runs: number[];
  oldMean?: number | null;
  oldSD?: number | null;
}

export function calculateQCRange(dataPoints: QCRangeDataPoint[], dateRange: { start: string; end: string }): QCRangeResults {
  const levelResults: QCRangeLevelResult[] = dataPoints.map(dp => {
    const valid = dp.runs.filter(v => v !== null && v !== undefined && !isNaN(v));
    const n = valid.length;
    const newMean = n > 0 ? mean(valid) : 0;
    const newSD = n > 1 ? stddev(valid) : 0;
    const cv = newMean !== 0 ? (newSD / newMean) * 100 : 0;
    const pctDiffFromOld = dp.oldMean != null && dp.oldMean !== 0
      ? ((newMean - dp.oldMean) / dp.oldMean) * 100
      : null;
    const flagShift = pctDiffFromOld !== null ? Math.abs(pctDiffFromOld) > 10 : false;
    return {
      analyte: dp.analyte, level: dp.level, analyzer: dp.analyzer,
      n, newMean, newSD, cv,
      oldMean: dp.oldMean ?? null, oldSD: dp.oldSD ?? null,
      pctDiffFromOld, flagShift,
    };
  });

  const overallShiftCount = levelResults.filter(r => r.flagShift).length;
  const totalLevels = levelResults.length;

  const analytes = Array.from(new Set(levelResults.map(r => r.analyte)));
  const analyzers = Array.from(new Set(levelResults.map(r => r.analyzer)));
  const summary = `New QC ranges have been established for ${analytes.join(", ")}. ` +
    `${levelResults.reduce((max, r) => Math.max(max, r.n), 0)} runs were performed across ${dateRange.start} to ${dateRange.end} ` +
    `on ${analyzers.join(", ")}. ` +
    (overallShiftCount > 0
      ? `${overallShiftCount} of ${totalLevels} analyte-level combinations showed >10% shift from previous lot.`
      : `All means are within 10% of previous lot values.`) +
    ` Per policy, SD should not change lot to lot. The historical/peer-derived SD should be used for control limits.`;

  const passCount = totalLevels - overallShiftCount;
  const overallPass = overallShiftCount === 0;
  return { type: "qc_range", levelResults, overallShiftCount, totalLevels, dateRange, overallPass, passCount, totalCount: totalLevels, summary };
}

// ─── MULTI-ANALYTE LOT COMPARISON (COAG) ────────────────────────────────────

export interface MultiAnalyteSpecimen {
  specimenId: string;
  ptNew: number | null;
  ptOld: number | null;
  ptNewINR: number | null;
  ptOldINR: number | null;
  ptPctDiff: number | null;
  apttNew: number | null;
  apttOld: number | null;
  apttPctDiff: number | null;
  fibNew: number | null;
  fibOld: number | null;
  fibPctDiff: number | null;
}

export interface MultiAnalyteAnalyteResult {
  analyte: string;
  n: number;
  meanNew: number;
  meanOld: number;
  meanPctDiff: number;
  sdPctDiff: number;
  r: number;
  tea: number;
  pass: boolean;
  specimens: { specimenId: string; newVal: number; oldVal: number; pctDiff: number; flagged: boolean }[];
}

export interface MultiAnalyteResults {
  type: "multi_analyte_coag";
  specimens: MultiAnalyteSpecimen[];
  analyteResults: MultiAnalyteAnalyteResult[];
  ptINRValidation: { meanNewINR: number; meanOldINR: number; isiCheck: string } | null;
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  summary: string;
}

export function calculateMultiAnalyteCoag(
  rawSpecimens: { specimenId: string; ptNew: number | null; ptOld: number | null; apttNew: number | null; apttOld: number | null; fibNew: number | null; fibOld: number | null }[],
  isi: number,
  normalMeanPT: number,
  teas: { pt: number; aptt: number; fib: number }
): MultiAnalyteResults {
  // Build enriched specimens with auto-calculated INR and % diff
  const specimens: MultiAnalyteSpecimen[] = rawSpecimens.map(s => {
    const ptNewINR = s.ptNew != null && normalMeanPT > 0 ? calculateINR(s.ptNew, normalMeanPT, isi) : null;
    const ptOldINR = s.ptOld != null && normalMeanPT > 0 ? calculateINR(s.ptOld, normalMeanPT, isi) : null;
    const ptPctDiff = s.ptNew != null && s.ptOld != null && s.ptOld !== 0 ? ((s.ptNew - s.ptOld) / s.ptOld) * 100 : null;
    const apttPctDiff = s.apttNew != null && s.apttOld != null && s.apttOld !== 0 ? ((s.apttNew - s.apttOld) / s.apttOld) * 100 : null;
    const fibPctDiff = s.fibNew != null && s.fibOld != null && s.fibOld !== 0 ? ((s.fibNew - s.fibOld) / s.fibOld) * 100 : null;
    return { specimenId: s.specimenId, ptNew: s.ptNew, ptOld: s.ptOld, ptNewINR, ptOldINR, ptPctDiff, apttNew: s.apttNew, apttOld: s.apttOld, apttPctDiff, fibNew: s.fibNew, fibOld: s.fibOld, fibPctDiff };
  });

  function calcAnalyte(name: string, getNew: (s: MultiAnalyteSpecimen) => number | null, getOld: (s: MultiAnalyteSpecimen) => number | null, tea: number): MultiAnalyteAnalyteResult {
    const valid = specimens.filter(s => getNew(s) != null && getOld(s) != null);
    const newVals = valid.map(s => getNew(s)!);
    const oldVals = valid.map(s => getOld(s)!);
    const n = valid.length;
    const meanNew = n > 0 ? mean(newVals) : 0;
    const meanOld = n > 0 ? mean(oldVals) : 0;
    const pctDiffs = valid.map(s => ((getNew(s)! - getOld(s)!) / getOld(s)!) * 100);
    const meanPctDiff = n > 0 ? mean(pctDiffs) : 0;
    const sdPctDiff = n > 1 ? stddev(pctDiffs) : 0;
    const r = n >= 2 ? Math.sqrt(rsq(oldVals, newVals)) * Math.sign(slopeFn(oldVals, newVals)) : 0;
    const pass = Math.abs(meanPctDiff) <= tea * 100;
    const specimenResults = valid.map((s, i) => ({
      specimenId: s.specimenId,
      newVal: getNew(s)!,
      oldVal: getOld(s)!,
      pctDiff: pctDiffs[i],
      flagged: Math.abs(pctDiffs[i]) > tea * 100,
    }));
    return { analyte: name, n, meanNew, meanOld, meanPctDiff, sdPctDiff, r, tea, pass, specimens: specimenResults };
  }

  const analyteResults: MultiAnalyteAnalyteResult[] = [
    calcAnalyte("PT", s => s.ptNew, s => s.ptOld, teas.pt),
    calcAnalyte("APTT", s => s.apttNew, s => s.apttOld, teas.aptt),
    calcAnalyte("Fibrinogen", s => s.fibNew, s => s.fibOld, teas.fib),
  ];

  // PT INR validation
  let ptINRValidation: MultiAnalyteResults["ptINRValidation"] = null;
  const ptResult = analyteResults[0];
  if (ptResult.n > 0 && normalMeanPT > 0) {
    const inrNewVals = specimens.filter(s => s.ptNewINR != null).map(s => s.ptNewINR!);
    const inrOldVals = specimens.filter(s => s.ptOldINR != null).map(s => s.ptOldINR!);
    const meanNewINR = inrNewVals.length ? mean(inrNewVals) : 0;
    const meanOldINR = inrOldVals.length ? mean(inrOldVals) : 0;
    const avgNewPT = ptResult.meanNew;
    const ratio = normalMeanPT > 0 ? avgNewPT / normalMeanPT : 0;
    const expectedINR = ratio > 0 ? Math.pow(ratio, isi) : 0;
    const isiCheck = Math.abs(meanNewINR - expectedINR) < 0.15
      ? `ISI validated: ratio ${ratio.toFixed(3)} → expected INR ${expectedINR.toFixed(2)}, observed ${meanNewINR.toFixed(2)}`
      : `ISI check: ratio ${ratio.toFixed(3)} → expected INR ${expectedINR.toFixed(2)}, observed ${meanNewINR.toFixed(2)}. Review ISI value`;
    ptINRValidation = { meanNewINR, meanOldINR, isiCheck };
  }

  const validAnalytes = analyteResults.filter(r => r.n > 0);
  const overallPass = validAnalytes.every(r => r.pass);
  const passCount = validAnalytes.filter(r => r.pass).length;
  const totalCount = validAnalytes.length;
  const summary = validAnalytes.map(r =>
    `${r.analyte} showed a mean difference of ${r.meanPctDiff.toFixed(1)}% (${r.pass ? "PASS" : "FAIL"} at ${(r.tea * 100).toFixed(0)}% TEa).`
  ).join(" ") + ` Overall: ${overallPass ? "PASS" : "FAIL"}.`;

  return { type: "multi_analyte_coag", specimens, analyteResults, ptINRValidation, overallPass, passCount, totalCount, summary };
}

// ─── Legacy shim — keep old callers working during migration ─────────────────
export type StudyResults = CalVerResults | MethodCompResults | QualitativeResults | SemiQuantResults | PrecisionResults | LotToLotResults | PTCoagResults | QCRangeResults | MultiAnalyteResults | RefIntervalResults;

export function calculateStudy(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  cliaError: number,
  studyType: "cal_ver" | "method_comparison" = "cal_ver",
  teaIsPercentage: boolean = true,
  cliaAbsoluteFloor: number | null = null
): CalVerResults | MethodCompResults {
  if (studyType === "method_comparison") {
    return calculateMethodComparison(dataPoints, instrumentNames, cliaError, teaIsPercentage, cliaAbsoluteFloor);
  }
  return calculateCalVer(dataPoints, instrumentNames, cliaError);
}

// ─── Export Deming for reuse ──────────────────────────────────────────────────
export { demingRegression };

// ─── Type guards ──────────────────────────────────────────────────────────────
export function isCalVer(r: StudyResults): r is CalVerResults { return r.type === "cal_ver"; }
export function isMethodComp(r: StudyResults): r is MethodCompResults { return r.type === "method_comparison"; }
export function isPrecision(r: StudyResults): r is PrecisionResults { return r.type === "precision"; }
export function isLotToLot(r: StudyResults): r is LotToLotResults { return r.type === "lot_to_lot"; }
export function isPTCoag(r: StudyResults): r is PTCoagResults { return r.type === "pt_coag"; }
export function isQCRange(r: StudyResults): r is QCRangeResults { return r.type === "qc_range"; }
export function isMultiAnalyteCoag(r: StudyResults): r is MultiAnalyteResults { return r.type === "multi_analyte_coag"; }
export function isQualitative(r: StudyResults): r is QualitativeResults { return r.type === "qualitative"; }
export function isSemiQuant(r: StudyResults): r is SemiQuantResults { return r.type === "semi_quantitative"; }

// ─── Reference Range Verification ───────────────────────────────────────────
export interface RefIntervalDataPoint {
  specimenId: string;
  value: number | null;
}

export interface RefIntervalResults {
  type: "ref_interval";
  analyte: string;
  units: string;
  refLow: number;
  refHigh: number;
  n: number;
  outsideCount: number;
  outsidePct: number;
  overallPass: boolean;
  specimens: { specimenId: string; value: number; inRange: boolean }[];
  summary: string;
}

export function calculateRefInterval(
  dataPoints: RefIntervalDataPoint[],
  refLow: number,
  refHigh: number,
  analyte: string,
  units: string
): RefIntervalResults {
  const valid = dataPoints.filter(dp => dp.value !== null && !isNaN(dp.value as number));
  const n = valid.length;
  const specimens = valid.map(dp => ({
    specimenId: dp.specimenId,
    value: dp.value as number,
    inRange: (dp.value as number) >= refLow && (dp.value as number) <= refHigh,
  }));
  const outsideCount = specimens.filter(s => !s.inRange).length;
  const outsidePct = n > 0 ? (outsideCount / n) * 100 : 0;
  // CLSI EP28-A3c: pass if ≤10% (≤2 of 20) fall outside the reference range
  const overallPass = n >= 20 && outsideCount <= Math.floor(n * 0.1);
  const summary = n < 20
    ? `Insufficient specimens: ${n} provided, minimum 20 required per CLSI EP28-A3c.`
    : overallPass
      ? `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range [${refLow}–${refHigh} ${units}], meeting the CLSI EP28-A3c acceptance criterion of ≤10% outside.`
      : `${outsideCount} of ${n} specimens (${outsidePct.toFixed(1)}%) fell outside the reference range [${refLow}–${refHigh} ${units}], exceeding the CLSI EP28-A3c acceptance criterion of ≤10% outside.`;

  return { type: "ref_interval", analyte, units, refLow, refHigh, n, outsideCount, outsidePct, overallPass, specimens, summary };
}

export function isRefInterval(r: StudyResults | RefIntervalResults): r is RefIntervalResults { return (r as any).type === "ref_interval"; }
