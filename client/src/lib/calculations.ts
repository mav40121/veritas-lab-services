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

// ─── Inverse normal / chi-square / Student's t ───────────────────────────────
// Needed for 95% confidence intervals on SD (chi-square inverse) and Mean
// (t-distribution inverse) in the simple precision study. Accuracy goal: match
// EP Evaluator's printed values to two decimal places for N in [5, 100]. All
// hand-rolled to keep the bundle free of a stats dependency, consistent with
// the rest of calculations.ts.

// Acklam's rational approximation for the inverse standard normal CDF.
// 6-figure accuracy across the open interval (0, 1). Reference:
// https://web.archive.org/web/20150910044730/http://home.online.no/~pjacklam/notes/invnorm/
function invStandardNormal(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

// Wilson-Hilferty inverse chi-square: chi2_p,df ≈ df * (1 - 2/(9df) + z * sqrt(2/(9df)))^3.
// Accurate to 4 figures for df >= 5; underlies the 95% CI for SD.
function invChiSquare(p: number, df: number): number {
  if (df <= 0) return 0;
  const z = invStandardNormal(p);
  const a = 2 / (9 * df);
  const t = 1 - a + z * Math.sqrt(a);
  return df * t * t * t;
}

// Hill's series (Hill, CACM 1970 Algorithm 396) for the inverse Student's t CDF.
// Four-term polynomial in z = invStandardNormal(p). Matches EP Evaluator's
// t(0.025, 34) = 2.0322 to four decimals.
function invStudentT(p: number, df: number): number {
  if (df <= 0) return 0;
  if (df > 200) return invStandardNormal(p);
  const z = invStandardNormal(p);
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  const term1 = (z3 + z) / (4 * df);
  const term2 = (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df);
  const term3 = (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df);
  return z + term1 + term2 + term3;
}

// Two-tailed 95% CI for a sample SD given n observations. Returns [lower, upper].
// Derivation: (n-1)*s^2/sigma^2 follows chi-square(n-1), so the CI for sigma
// uses chi2(1-alpha/2) for the LOWER bound on sigma and chi2(alpha/2) for the
// UPPER bound on sigma. Verified against EP Evaluator's printed values for
// the Pfizer A-ALT dataset (n=35, SD=1.1, CI 0.9 to 1.4).
export function sdConfidenceInterval95(sd: number, n: number): [number, number] | null {
  if (n < 2 || sd <= 0) return null;
  const df = n - 1;
  const chiHigh = invChiSquare(0.975, df); // large chi-square -> small sigma -> LOWER CI bound for SD
  const chiLow = invChiSquare(0.025, df);  // small chi-square -> large sigma -> UPPER CI bound for SD
  if (chiHigh <= 0 || chiLow <= 0) return null;
  return [sd * Math.sqrt(df / chiHigh), sd * Math.sqrt(df / chiLow)];
}

// Two-tailed 95% CI for a sample mean using Student's t.
export function meanConfidenceInterval95(meanVal: number, sd: number, n: number): [number, number] | null {
  if (n < 2 || sd <= 0) return null;
  const tCrit = invStudentT(0.975, n - 1);
  const margin = tCrit * sd / Math.sqrt(n);
  return [meanVal - margin, meanVal + margin];
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
// Two-sided t critical value at alpha = 0.05.
// Explicit values for df 1..30; sparse table for df > 30 with linear interpolation.
// The prior step-function lookup under-estimated t for intermediate df (e.g. df=11
// returned 2.131 instead of 2.201, a 3.2% narrowing of the CI), which is meaningful
// for small-n method-comparison and cal-ver studies.
const T_TABLE: { df: number; t: number }[] = [
  { df: 1, t: 12.706 }, { df: 2, t: 4.303 }, { df: 3, t: 3.182 }, { df: 4, t: 2.776 },
  { df: 5, t: 2.571 }, { df: 6, t: 2.447 }, { df: 7, t: 2.365 }, { df: 8, t: 2.306 },
  { df: 9, t: 2.262 }, { df: 10, t: 2.228 }, { df: 11, t: 2.201 }, { df: 12, t: 2.179 },
  { df: 13, t: 2.160 }, { df: 14, t: 2.145 }, { df: 15, t: 2.131 }, { df: 16, t: 2.120 },
  { df: 17, t: 2.110 }, { df: 18, t: 2.101 }, { df: 19, t: 2.093 }, { df: 20, t: 2.086 },
  { df: 21, t: 2.080 }, { df: 22, t: 2.074 }, { df: 23, t: 2.069 }, { df: 24, t: 2.064 },
  { df: 25, t: 2.060 }, { df: 26, t: 2.056 }, { df: 27, t: 2.052 }, { df: 28, t: 2.048 },
  { df: 29, t: 2.045 }, { df: 30, t: 2.042 }, { df: 40, t: 2.021 }, { df: 50, t: 2.009 },
  { df: 60, t: 2.000 }, { df: 80, t: 1.990 }, { df: 100, t: 1.984 }, { df: 120, t: 1.980 },
];
function tCritical(df: number): number {
  if (df <= 1) return T_TABLE[0].t;
  if (df > 120) return 1.960;
  for (let i = 0; i < T_TABLE.length - 1; i++) {
    const a = T_TABLE[i], b = T_TABLE[i + 1];
    if (df === a.df) return a.t;
    if (df > a.df && df < b.df) {
      // Linear interpolation between adjacent table entries
      const w = (df - a.df) / (b.df - a.df);
      return a.t + w * (b.t - a.t);
    }
  }
  // df === 120 falls through the loop; return the last table entry.
  return T_TABLE[T_TABLE.length - 1].t;
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
  cliaError: number,
  teaIsPercentage: boolean = true,
  cliaAbsoluteFloor: number | null = null
): CalVerResults {
  const valid = dataPoints.filter(
    (dp) => dp.expectedValue !== null && instrumentNames.some((n) => dp.instrumentValues[n] !== null)
  );

  // Floating-point tolerance to absorb binary float noise (e.g. boundary at 0.2 mg/dL)
  const FP_EPS = 1e-9;

  // Dual-criterion S493 rule: pass when |observed - assigned| <= max(percent_allowance, absolute_floor)
  // For percent-mode TEa, the percent allowance scales with the assigned value; the absolute
  // floor is the regulatory minimum below which percent allowance is too tight to be meaningful.
  // For absolute-only TEa (e.g. Sodium ±4 mmol/L), there is no percent component.
  const allowanceFor = (assigned: number): number => {
    if (teaIsPercentage) {
      const pctAllowance = Math.abs(assigned) * cliaError;
      const absAllowance = cliaAbsoluteFloor ?? 0;
      return Math.max(pctAllowance, absAllowance);
    }
    return cliaError;
  };

  const levelResults: CalVerLevelResult[] = valid.map((dp) => {
    const assigned = dp.expectedValue!;
    const vals = instrumentNames.map((n) => dp.instrumentValues[n]).filter((v): v is number => v !== null);
    const meanVal = vals.length ? mean(vals) : assigned;
    const pctRecovery = assigned !== 0 ? (meanVal / assigned) * 100 : 100;
    const obsError = assigned !== 0 ? (meanVal - assigned) / assigned : 0;

    const allowance = allowanceFor(assigned);
    const meanDiff = meanVal - assigned;

    const instruments: CalVerLevelResult["instruments"] = {};
    instrumentNames.forEach((n) => {
      const v = dp.instrumentValues[n];
      if (v !== null && v !== undefined) {
        const e = assigned !== 0 ? (v - assigned) / assigned : 0;
        const diff = v - assigned;
        instruments[n] = { value: v, obsError: e, passFail: Math.abs(diff) <= allowance + FP_EPS ? "Pass" : "Fail" };
      }
    });

    return {
      level: dp.level,
      assignedValue: assigned,
      mean: meanVal,
      pctRecovery,
      obsError,
      passFailMean: Math.abs(meanDiff) <= allowance + FP_EPS ? "Pass" : "Fail",
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
  const teaLabel = teaIsPercentage
    ? (cliaAbsoluteFloor != null
      ? `±${(cliaError * 100).toFixed(1)}% or ±${cliaAbsoluteFloor} (greater)`
      : `±${(cliaError * 100).toFixed(1)}%`)
    : `±${cliaError}`;
  const maxDev = levelResults.length ? Math.max(...levelResults.map((r) => Math.abs(r.pctRecovery - 100))) : 0;
  const summary =
    `Calibration Verification was performed over an assigned value range of ${range}. ` +
    `Adopted Acceptance Criterion (TEa) was ${teaLabel}. ` +
    `${passCount} of ${totalCount} measured results were within TEa. ` +
    `Maximum deviation from 100% recovery was ${maxDev.toFixed(1)}%. ` +
    `The calibration verification ${overallPass ? "PASSED" : "FAILED"} the adopted acceptance criterion.`;

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
    `Correlation / Method Comparison was performed using ${n} patient samples with adopted acceptance criterion (TEa) of ±${cliaPercent}%. ` +
    `Regression analysis: ${regLines}. ` +
    `Bland-Altman analysis: ${baLines}. ` +
    `${passCount} of ${totalCount} paired results were within TEa. ` +
    `The method comparison ${overallPass ? "PASSED" : "FAILED"} the adopted acceptance criterion.`;

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
  // Phase 1 parity additions (2026-05-20). Present on every simple-mode
  // result with n >= 2; advanced-mode also populates them for the aggregate
  // (single-pool) view so the same Statistics block can render.
  sdCiLower?: number;
  sdCiUpper?: number;
  meanCiLower?: number;
  meanCiUpper?: number;
  twoSDRangeLower?: number;
  twoSDRangeUpper?: number;
  // Populated only when caller passes opts.targetMean.
  targetMean?: number;
  bias?: number;
  percentBias?: number;
  // Populated only when caller passes opts.vendorSD. The three-state verdict
  // follows EP Evaluator's strict reading: Pass = upper 95% CI for SD ≤ goal;
  // Uncertain = goal lies inside the 95% CI; Fail = lower 95% CI > goal.
  vendorSD?: number;
  vendorVerdict?: "Pass" | "Fail" | "Uncertain";
  // ANOVA components (advanced mode).
  withinRunSD?: number;
  withinRunCV?: number;
  betweenRunSD?: number;
  betweenRunCV?: number;
  betweenDaySD?: number;
  betweenDayCV?: number;
  totalSD?: number;
  totalCV?: number;
}

export interface PrecisionOptions {
  // Optional vendor SD goal (within-run SD claim from manufacturer insert).
  // When set, calculator emits vendorVerdict (Pass/Fail/Uncertain) on each
  // level. Independent of the CLIA TEa% criterion, which still drives the
  // primary passFail field.
  vendorSD?: number;
  vendorSDConcentration?: number;
  // Optional target mean (assigned value or target from QC insert). When set,
  // calculator emits bias / percentBias per level. Does not affect verdict.
  targetMean?: number;
  targetCV?: number;
}

export interface PrecisionResults {
  type: "precision";
  mode: "simple" | "advanced";
  levelResults: PrecisionLevelResult[];
  overallPass: boolean;
  passCount: number;
  totalCount: number;
  summary: string;
  // Echo back the optional inputs so downstream renderers can show them in
  // the User's Specifications and Supporting Data sections without having to
  // re-parse the study record.
  vendorSD?: number;
  vendorSDConcentration?: number;
  targetMean?: number;
  targetCV?: number;
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
  mode: "simple" | "advanced",
  opts: PrecisionOptions = {}
): PrecisionResults {
  const allowableCV = cliaAllowableImprecision * 100;

  // Compute the parity statistics (CIs, 2 SD range, bias, vendor verdict)
  // around an already-derived mean/SD/n. Pulled out so both the simple and
  // advanced result paths share one implementation.
  const parityStats = (n: number, meanVal: number, sdVal: number) => {
    const out: Partial<PrecisionLevelResult> = {};
    if (n < 2 || !(sdVal > 0)) return out;
    const sdCi = sdConfidenceInterval95(sdVal, n);
    if (sdCi) {
      out.sdCiLower = sdCi[0];
      out.sdCiUpper = sdCi[1];
    }
    const meanCi = meanConfidenceInterval95(meanVal, sdVal, n);
    if (meanCi) {
      out.meanCiLower = meanCi[0];
      out.meanCiUpper = meanCi[1];
    }
    out.twoSDRangeLower = meanVal - 2 * sdVal;
    out.twoSDRangeUpper = meanVal + 2 * sdVal;
    if (typeof opts.targetMean === "number" && opts.targetMean !== 0) {
      out.targetMean = opts.targetMean;
      out.bias = meanVal - opts.targetMean;
      out.percentBias = (out.bias / opts.targetMean) * 100;
    }
    if (typeof opts.vendorSD === "number" && opts.vendorSD > 0) {
      out.vendorSD = opts.vendorSD;
      // EP Evaluator strict three-state verdict: Pass when upper 95% CI for SD
      // does not exceed the goal; Uncertain when the goal sits inside the CI;
      // Fail when the goal sits below the lower CI bound.
      const upper = sdCi ? sdCi[1] : sdVal;
      const lower = sdCi ? sdCi[0] : sdVal;
      if (upper <= opts.vendorSD) out.vendorVerdict = "Pass";
      else if (lower <= opts.vendorSD) out.vendorVerdict = "Uncertain";
      else out.vendorVerdict = "Fail";
    }
    return out;
  };

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
        cv: cvVal, allowableCV, passFail: cvVal <= allowableCV ? "Pass" : "Fail",
        ...parityStats(n, meanVal, sdVal),
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
    // When runs_per_day = 1, df_between_run = 0 so msBetweenRun = 0. The next-lower
    // mean square in the expected-mean-square ladder is msWithin, not the meaningless
    // msBetweenRun = 0. Using msBetweenRun here over-estimates between-day variance
    // by msWithin / replicatesPerRun in single-run designs (the EP15 default shape).
    const msNextDown = dfBetweenRun > 0 ? msBetweenRun : msWithin;
    const varBetweenDay = Math.max(0, (msBetweenDay - msNextDown) / (runsPerDay * replicatesPerRun));
    const varTotal = varWithinRun + varBetweenRun + varBetweenDay;

    const toCV = (v: number) => meanVal !== 0 ? (Math.sqrt(v) / meanVal) * 100 : 0;

    return {
      level: dp.level, levelName: dp.levelName, n, mean: meanVal, sd: sdVal,
      cv: cvVal, allowableCV,
      passFail: cvVal <= allowableCV ? "Pass" : "Fail",
      ...parityStats(n, meanVal, sdVal),
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
    `Adopted Precision Acceptance Criterion (CV) was ±${cliaStr}%. ` +
    `${passCount} of ${totalCount} levels met the adopted precision criterion. ` +
    `The precision study ${overallPass ? "PASSED" : "FAILED"} the adopted acceptance criterion.`;

  return {
    type: "precision", mode, levelResults, overallPass, passCount, totalCount, summary,
    vendorSD: opts.vendorSD,
    vendorSDConcentration: opts.vendorSDConcentration,
    targetMean: opts.targetMean,
    targetCV: opts.targetCV,
  };
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

  // Methodology note prepended to the narrative so the printed and on-screen
  // report names CLSI EP26-A explicitly. The pass rule used here is the
  // common TEa-based variant: pass when the mean absolute percent difference
  // is within TEa AND at least 90% of paired specimens fall within TEa. This
  // is a TEa-based variant of EP26-A; the formal critical-difference protocol
  // in EP26-A is impractical for routine clinical chemistry (per Loh 2020 and
  // Thompson 2017 evaluations) and the TEa rule is what most labs use in
  // practice.
  const methodology = `Methodology: CLSI EP26-A (User Evaluation of Between-Reagent Lot Variation). Patient samples are tested on both the current reagent lot and the new reagent lot; per-specimen percent difference is evaluated against the adopted total allowable error (TEa). Pass criterion: mean absolute percent difference within TEa AND at least 90% of paired specimens within TEa.`;
  const summary = methodology + " " + cohortResults.map(c =>
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

// Prior-lot crossover bias classification, computed when prior-lot
// replicate data is provided. Thresholds locked 2026-05-19 per the
// VeritaCheck lot-change family redesign:
//   |Δ| within 1 pooled SD  -> accept
//   1 to 2 pooled SD        -> caution (investigate)
//   2 or more pooled SD     -> fail
export type BiasCheckClassification = "accept" | "caution" | "fail";

export interface QCPriorLotStats {
  mean: number;
  sd: number;
  cv: number;
  n: number;
}

export interface QCBiasCheck {
  deltaMean: number;          // newMean - priorMean
  pctDiffFromPrior: number;   // (newMean - priorMean) / priorMean * 100
  pooledSD: number;
  sdiVsPriorLot: number;      // |deltaMean| / pooledSD
  classification: BiasCheckClassification;
}

// Vendor (package-insert assayed) comparison, computed when vendor
// values are supplied. Westgard SDI convention:
//   |SDI| < 1   -> excellent
//   |SDI| < 2   -> acceptable
//   |SDI| < 3   -> investigate
//   |SDI| >= 3  -> unacceptable
// Display only. CLIA §493.1256 still requires the lab to use its own
// calculated SD on the Levey-Jennings chart, not the vendor's.
export type VendorSDIClassification = "excellent" | "acceptable" | "investigate" | "unacceptable";

export interface QCVendorComparison {
  vendorMean: number;
  vendorSD: number;
  sdi: number;                // (newMean - vendorMean) / vendorSD
  classification: VendorSDIClassification;
}

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
  flagShift: boolean; // >10% shift (legacy heuristic, retained for backward compat)
  // New crossover bias check, populated when priorLotRuns provided.
  priorLot?: QCPriorLotStats;
  biasCheck?: QCBiasCheck;
  // Vendor SDI comparison, populated when vendor values provided.
  vendorComparison?: QCVendorComparison;
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
  // Legacy summary fields, kept for backward compatibility with studies
  // saved before the prior-lot replicate grid landed. Newly created
  // studies populate priorLotRuns instead.
  oldMean?: number | null;
  oldSD?: number | null;
  // New: prior lot's replicate data (parallel grid to runs). When present
  // and containing >=2 valid replicates, the calculation derives the prior
  // lot's mean/SD/CV from this directly rather than trusting summary.
  priorLotRuns?: number[];
  // New: vendor (package insert) values for SDI comparison. Vendor values
  // are typically method-agnostic on the package insert so they attach at
  // analyte+level rather than per analyzer; the entry side dedups across
  // analyzers and forwards the same value here for each row.
  vendorMean?: number | null;
  vendorSD?: number | null;
}

// Pooled SD from two samples per the standard two-sample variance pool.
// sqrt( ((n1-1)*sd1^2 + (n2-1)*sd2^2) / (n1+n2-2) )
// Falls back to whichever side has data when one side is degenerate (n<=1),
// since we still want a meaningful bias check rather than a divide-by-zero.
function pooledSDTwoSamples(sd1: number, n1: number, sd2: number, n2: number): number {
  const df = n1 + n2 - 2;
  if (df <= 0) return Math.max(sd1, sd2);
  const num = (Math.max(n1 - 1, 0)) * sd1 * sd1 + (Math.max(n2 - 1, 0)) * sd2 * sd2;
  return Math.sqrt(num / df);
}

function classifyBias(absSDI: number): BiasCheckClassification {
  if (absSDI < 1) return "accept";
  if (absSDI < 2) return "caution";
  return "fail";
}

function classifyVendorSDI(absSDI: number): VendorSDIClassification {
  if (absSDI < 1) return "excellent";
  if (absSDI < 2) return "acceptable";
  if (absSDI < 3) return "investigate";
  return "unacceptable";
}

export function calculateQCRange(dataPoints: QCRangeDataPoint[], dateRange: { start: string; end: string }): QCRangeResults {
  const levelResults: QCRangeLevelResult[] = dataPoints.map(dp => {
    const valid = dp.runs.filter(v => v !== null && v !== undefined && !isNaN(v));
    const n = valid.length;
    const newMean = n > 0 ? mean(valid) : 0;
    const newSD = n > 1 ? stddev(valid) : 0;
    const cv = newMean !== 0 ? (newSD / newMean) * 100 : 0;

    // Prior-lot crossover bias check: when priorLotRuns has at least 2
    // valid replicates, compute the prior lot's stats from the grid and
    // run a pooled-SD-normalized bias check. Otherwise fall back to the
    // legacy summary fields (oldMean/oldSD) for backward compatibility,
    // which still drives the existing pctDiffFromOld surface but does
    // not populate the new biasCheck object (no SD => no pooled SD).
    const priorRuns = (dp.priorLotRuns || []).filter(v => v !== null && v !== undefined && !isNaN(v as number)) as number[];
    let priorLot: QCPriorLotStats | undefined;
    let biasCheck: QCBiasCheck | undefined;
    if (priorRuns.length >= 2) {
      const priorN = priorRuns.length;
      const priorMean = mean(priorRuns);
      const priorSD = stddev(priorRuns);
      const priorCV = priorMean !== 0 ? (priorSD / priorMean) * 100 : 0;
      priorLot = { mean: priorMean, sd: priorSD, cv: priorCV, n: priorN };
      if (n >= 2) {
        const pooled = pooledSDTwoSamples(newSD, n, priorSD, priorN);
        const delta = newMean - priorMean;
        const pctDiff = priorMean !== 0 ? (delta / priorMean) * 100 : 0;
        const sdi = pooled > 0 ? Math.abs(delta) / pooled : 0;
        biasCheck = {
          deltaMean: delta,
          pctDiffFromPrior: pctDiff,
          pooledSD: pooled,
          sdiVsPriorLot: sdi,
          classification: classifyBias(sdi),
        };
      }
    }

    // Legacy summary-based shift surface (kept for backward compat with
    // studies saved before the prior-lot grid). When priorLot is present
    // we prefer the new pctDiffFromPrior in biasCheck.
    const legacyPctDiff = dp.oldMean != null && dp.oldMean !== 0
      ? ((newMean - dp.oldMean) / dp.oldMean) * 100
      : null;
    const pctDiffFromOld = biasCheck ? biasCheck.pctDiffFromPrior : legacyPctDiff;
    const flagShift = pctDiffFromOld !== null ? Math.abs(pctDiffFromOld) > 10 : false;

    // Vendor SDI comparison: when both vendorMean and a positive vendorSD
    // are supplied, compute the SDI per Westgard.
    let vendorComparison: QCVendorComparison | undefined;
    if (
      dp.vendorMean != null && !isNaN(dp.vendorMean) &&
      dp.vendorSD != null && !isNaN(dp.vendorSD) && dp.vendorSD > 0 &&
      n >= 1
    ) {
      const sdi = (newMean - dp.vendorMean) / dp.vendorSD;
      vendorComparison = {
        vendorMean: dp.vendorMean,
        vendorSD: dp.vendorSD,
        sdi,
        classification: classifyVendorSDI(Math.abs(sdi)),
      };
    }

    return {
      analyte: dp.analyte, level: dp.level, analyzer: dp.analyzer,
      n, newMean, newSD, cv,
      oldMean: priorLot ? priorLot.mean : (dp.oldMean ?? null),
      oldSD: priorLot ? priorLot.sd : (dp.oldSD ?? null),
      pctDiffFromOld, flagShift,
      priorLot, biasCheck, vendorComparison,
    };
  });

  const overallShiftCount = levelResults.filter(r => r.flagShift).length;
  const totalLevels = levelResults.length;

  // New crossover bias-check tally (only counts rows that ran the new
  // pooled-SD bias check, i.e. had prior-lot replicate data).
  const withBias = levelResults.filter(r => r.biasCheck);
  const biasFailCount = withBias.filter(r => r.biasCheck!.classification === "fail").length;
  const biasCautionCount = withBias.filter(r => r.biasCheck!.classification === "caution").length;

  // Vendor SDI tally
  const withVendor = levelResults.filter(r => r.vendorComparison);
  const vendorInvestigateCount = withVendor.filter(r => r.vendorComparison!.classification === "investigate").length;
  const vendorUnacceptableCount = withVendor.filter(r => r.vendorComparison!.classification === "unacceptable").length;

  const analytes = Array.from(new Set(levelResults.map(r => r.analyte)));
  const analyzers = Array.from(new Set(levelResults.map(r => r.analyzer)));

  let summary = `New QC ranges have been established for ${analytes.join(", ")} per CLSI C24-Ed4. ` +
    `${levelResults.reduce((max, r) => Math.max(max, r.n), 0)} runs were performed across ${dateRange.start} to ${dateRange.end} ` +
    `on ${analyzers.join(", ")}. ` +
    `The lab's calculated mean and SD become the operating values on the Levey-Jennings chart, per 42 CFR §493.1256. `;

  if (withBias.length > 0) {
    summary += `Crossover bias check vs prior lot: ${withBias.length - biasFailCount - biasCautionCount} of ${withBias.length} analyte-level combinations within 1 pooled SD (accept), ${biasCautionCount} between 1 and 2 SD (caution), ${biasFailCount} at or above 2 SD (fail). `;
  } else if (overallShiftCount > 0) {
    summary += `${overallShiftCount} of ${totalLevels} analyte-level combinations showed >10% shift from previous lot (legacy summary heuristic). `;
  }

  if (withVendor.length > 0) {
    summary += `Vendor SDI comparison (informational, per Westgard): ${withVendor.length - vendorInvestigateCount - vendorUnacceptableCount} of ${withVendor.length} levels within ±2 SDI of the vendor-assigned mean. Vendor SD is reference only; the lab uses its own calculated SD on the chart.`;
  }

  // Overall pass: prefer the new bias-check verdict when prior-lot data
  // is present (any "fail" classification fails overall). Fall back to the
  // legacy >10% shift heuristic when no prior-lot data was provided.
  const overallPass = withBias.length > 0 ? biasFailCount === 0 : overallShiftCount === 0;
  const passCount = withBias.length > 0
    ? withBias.length - biasFailCount
    : totalLevels - overallShiftCount;
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
export type StudyResults = CalVerResults | MethodCompResults | QualitativeResults | SemiQuantResults | PrecisionResults | LotToLotResults | PTCoagResults | QCRangeResults | MultiAnalyteResults | RefIntervalResults | SensitivityResults;

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
  return calculateCalVer(dataPoints, instrumentNames, cliaError, teaIsPercentage, cliaAbsoluteFloor);
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

// ─── ANALYTICAL SENSITIVITY (CLSI EP17-A2) ────────────────────────────────────
// Limit of Blank (LoB): highest signal expected from a blank sample
// Limit of Detection (LoD): lowest concentration reliably distinguished from blank
// Limit of Quantitation (LoQ): lowest concentration measurable at acceptable
//   precision AND acceptable bias (default thresholds: CV <= 20%, |bias| <= 25%)
//
// Modes:
//   Establishment — full CLSI EP17-A2 study (~60 blank reps, ~60 low-level reps,
//     4-5 LoQ levels). For modified / LDT / in-house tests. CFR §493.1253(b)(2)(iii)
//     (analytical sensitivity establishment).
//   Verification — confirm manufacturer's published claims with smaller study.
//     For FDA-cleared assays. CFR §493.1253(b)(1) (verification of FDA-cleared
//     performance specs; sensitivity verification is implicit, the (b)(1) list
//     enumerates accuracy, precision, and reportable range only).

export interface SensitivityReplicate {
  value: number;
  lot?: string;
  day?: number;
  run?: number;
}

export interface SensitivityLowLevelGroup {
  expectedConcentration: number;
  replicates: SensitivityReplicate[];
}

export interface SensitivityLobResult {
  parametric: number;        // mean(blank) + 1.645 * SD(blank)
  nonParametric: number;     // 95th percentile of blank measurements
  meanBlank: number;
  sdBlank: number;
  nBlank: number;
  byLot?: { [lot: string]: { mean: number; sd: number; n: number; lobParametric: number; lobNonParametric: number } };
}

export interface SensitivityLodResult {
  value: number;             // LoD = LoB + Cβ * SD(low-level)
  lobUsed: number;           // which LoB went into the formula (parametric per EP17-A2 default)
  cBeta: number;             // finite-sample correction factor from Table A1
  sdLowLevel: number;
  nLowLevel: number;
}

export interface SensitivityLoqLevelResult {
  expectedConcentration: number;
  meanObserved: number;
  sd: number;
  cv: number;                // percent
  bias: number;              // mean - expected
  biasPct: number;           // bias / expected * 100
  meetsPrecision: boolean;
  meetsBias: boolean;
  meetsLoq: boolean;         // both criteria
}

export interface SensitivityLoqResult {
  value: number | null;      // lowest expectedConcentration that meets both criteria; null if none
  byLevel: SensitivityLoqLevelResult[];   // sorted ascending by expectedConcentration
  cvThreshold: number;       // percent
  biasThreshold: number;     // percent
}

export interface SensitivityManufacturerClaim {
  lob?: number;
  lod?: number;
  loq?: number;
}

export interface SensitivityResults {
  type: "sensitivity";
  mode: "establishment" | "verification";
  lob: SensitivityLobResult;
  lod: SensitivityLodResult;
  loq: SensitivityLoqResult | null;
  manufacturerClaim?: SensitivityManufacturerClaim;
  overallPass: boolean;
  summary: string;
}

export interface SensitivityInput {
  mode: "establishment" | "verification";
  blanks: SensitivityReplicate[];
  lowLevel: SensitivityReplicate[];                // for LoD
  loqLevels?: SensitivityLowLevelGroup[];          // optional, for LoQ
  cvThreshold?: number;                            // fraction, default 0.20 (20%)
  biasThreshold?: number;                          // fraction, default 0.25 (25%)
  manufacturerClaim?: SensitivityManufacturerClaim; // required when mode = verification
}

// EP17-A2 Table A1: Cβ finite-sample correction factor at α=β=0.05 (one-sided).
// Linear interpolation between table entries; asymptote at 1.645 as n grows.
const CBETA_TABLE: { n: number; c: number }[] = [
  { n: 5,    c: 2.063 }, { n: 10,   c: 1.831 }, { n: 15,   c: 1.766 },
  { n: 20,   c: 1.749 }, { n: 25,   c: 1.717 }, { n: 30,   c: 1.704 },
  { n: 40,   c: 1.683 }, { n: 50,   c: 1.671 }, { n: 60,   c: 1.660 },
  { n: 80,   c: 1.654 }, { n: 100,  c: 1.652 }, { n: 1000, c: 1.645 },
];
function cBeta(n: number): number {
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

// Non-parametric percentile via linear interpolation (R-7 / numpy default).
function percentile(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

export function calculateSensitivity(input: SensitivityInput): SensitivityResults {
  // ── LoB ───────────────────────────────────────────────────────────────────
  const blanks = input.blanks.filter(r => r.value != null && !isNaN(r.value));
  const blankValues = blanks.map(r => r.value);
  const meanBlank = mean(blankValues);
  const sdBlank = stddev(blankValues);
  const nBlank = blankValues.length;
  const lobParametric = meanBlank + 1.645 * sdBlank;
  const lobNonParametric = percentile(blankValues, 95);

  // Per-lot breakdown (only emitted when at least one replicate carries a lot label)
  let byLot: SensitivityLobResult["byLot"] | undefined;
  const lotLabels = Array.from(new Set(blanks.map(r => r.lot).filter((l): l is string => !!l)));
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

  // ── LoD ───────────────────────────────────────────────────────────────────
  const lowValues = input.lowLevel.filter(r => r.value != null && !isNaN(r.value)).map(r => r.value);
  const sdLowLevel = stddev(lowValues);
  const nLowLevel = lowValues.length;
  const cb = cBeta(nLowLevel);
  // EP17-A2 default: LoD = LoB(parametric) + Cβ * SD(low-level)
  const lobUsed = lobParametric;
  const lodValue = lobUsed + cb * sdLowLevel;

  // ── LoQ (optional) ────────────────────────────────────────────────────────
  let loq: SensitivityLoqResult | null = null;
  if (input.loqLevels && input.loqLevels.length > 0) {
    const cvThr = (input.cvThreshold ?? 0.20) * 100;
    const biasThr = (input.biasThreshold ?? 0.25) * 100;
    const byLevel: SensitivityLoqLevelResult[] = input.loqLevels.map(group => {
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

  // ── Pass logic ────────────────────────────────────────────────────────────
  // Establishment mode: pass if LoD > LoB (sanity) and, when LoQ requested, LoQ identified.
  // Verification mode: pass if observed LoB / LoD / LoQ are all <= the manufacturer's claims.
  let overallPass: boolean;
  if (input.mode === "verification" && input.manufacturerClaim) {
    overallPass = true;
    if (input.manufacturerClaim.lob !== undefined) overallPass = overallPass && lobParametric <= input.manufacturerClaim.lob;
    if (input.manufacturerClaim.lod !== undefined) overallPass = overallPass && lodValue <= input.manufacturerClaim.lod;
    if (input.manufacturerClaim.loq !== undefined && loq) overallPass = overallPass && loq.value !== null && loq.value <= input.manufacturerClaim.loq;
  } else {
    // Establishment: LoD must be > LoB by definition; LoQ identified if requested.
    overallPass = lodValue > lobUsed && (loq ? loq.value !== null : true);
  }

  const summary = input.mode === "establishment"
    ? `Analytical sensitivity established per CLSI EP17-A2. LoB = ${lobParametric.toFixed(3)} (parametric, n=${nBlank}); LoD = ${lodValue.toFixed(3)} (n=${nLowLevel} low-level replicates, Cβ=${cb.toFixed(3)})` +
      (loq ? `; LoQ = ${loq.value !== null ? loq.value.toFixed(3) : "not identified"} (criteria: CV ≤ ${loq.cvThreshold.toFixed(0)}%, |bias| ≤ ${loq.biasThreshold.toFixed(0)}%).` : '.') +
      ` ${overallPass ? 'PASSED' : 'FAILED'} the establishment criterion.`
    : `Manufacturer's analytical sensitivity claim verification per CLSI EP17-A2. ` +
      `Observed LoB = ${lobParametric.toFixed(3)}` + (input.manufacturerClaim?.lob !== undefined ? ` (claim: ${input.manufacturerClaim.lob})` : '') + `; ` +
      `Observed LoD = ${lodValue.toFixed(3)}` + (input.manufacturerClaim?.lod !== undefined ? ` (claim: ${input.manufacturerClaim.lod})` : '') +
      (loq && input.manufacturerClaim?.loq !== undefined ? `; Observed LoQ = ${loq.value !== null ? loq.value.toFixed(3) : "not identified"} (claim: ${input.manufacturerClaim.loq})` : '') +
      `. ${overallPass ? 'PASSED' : 'FAILED'} the verification criterion.`;

  return {
    type: "sensitivity",
    mode: input.mode,
    lob: { parametric: lobParametric, nonParametric: lobNonParametric, meanBlank, sdBlank, nBlank, byLot },
    lod: { value: lodValue, lobUsed, cBeta: cb, sdLowLevel, nLowLevel },
    loq,
    manufacturerClaim: input.manufacturerClaim,
    overallPass,
    summary,
  };
}

export function isSensitivity(r: StudyResults | SensitivityResults): r is SensitivityResults { return (r as any).type === "sensitivity"; }
