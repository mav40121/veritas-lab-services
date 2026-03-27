// ─── Shared types ────────────────────────────────────────────────────────────

export interface DataPoint {
  level: number;
  expectedValue: number | null;       // Cal Ver: assigned value | Method Comp: reference method value
  instrumentValues: { [key: string]: number | null };
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
        instruments[n] = { value: v, obsError: e, passFail: Math.abs(e) < cliaError ? "Pass" : "Fail" };
      }
    });

    return {
      level: dp.level,
      assignedValue: assigned,
      mean: meanVal,
      pctRecovery,
      obsError,
      passFailMean: Math.abs(obsError) < cliaError ? "Pass" : "Fail",
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
    : "—";
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
// Input: reference method (x = expectedValue) vs. test method(s) (y = instrumentValues)
// Key metrics: slope, intercept, R², bias per level, Bland-Altman difference

export interface MethodCompLevelResult {
  level: number;
  referenceValue: number;
  instruments: {
    [name: string]: {
      value: number;
      difference: number;       // test - reference (absolute bias)
      pctDifference: number;    // (test - reference) / reference * 100
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
  cliaError: number
): MethodCompResults {
  const valid = dataPoints.filter(
    (dp) => dp.expectedValue !== null && instrumentNames.some((n) => dp.instrumentValues[n] !== null)
  );

  const levelResults: MethodCompLevelResult[] = valid.map((dp) => {
    const ref = dp.expectedValue!;
    const instruments: MethodCompLevelResult["instruments"] = {};
    instrumentNames.forEach((n) => {
      const v = dp.instrumentValues[n];
      if (v !== null && v !== undefined) {
        const diff = v - ref;
        const pctDiff = ref !== 0 ? (diff / ref) * 100 : 0;
        instruments[n] = { value: v, difference: diff, pctDifference: pctDiff, passFail: Math.abs(pctDiff / 100) < cliaError ? "Pass" : "Fail" };
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

  // Regression: Deming + OLS for each test method vs. reference
  const regression: { [k: string]: RegressionResult } = {};
  instrumentNames.forEach((n) => {
    const xs: number[] = [], ys: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { xs.push(r.referenceValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) {
      // Deming regression
      const dem = demingRegression(xs, ys);
      const demSee = seeFn(xs, ys); // SEE from residuals (approximation)
      regression[`${n} vs. Reference (Deming)`] = {
        slope: dem.slope, intercept: dem.intercept, proportionalBias: dem.slope - 1,
        r2: rsq(xs, ys), n: xs.length, see: demSee, regressionType: "Deming"
      };
      // OLS regression with 95% CI
      const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
      const ci = olsCI(xs, ys);
      regression[`${n} vs. Reference (OLS)`] = {
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
    `Method Comparison was performed using ${n} sample levels with CLIA TEa of ±${cliaPercent}%. ` +
    `Regression analysis: ${regLines}. ` +
    `Bland-Altman analysis: ${baLines}. ` +
    `${passCount} of ${totalCount} paired results were within TEa. ` +
    `The method comparison ${overallPass ? "PASSED" : "FAILED"} CLIA acceptability criteria.`;

  return { type: "method_comparison", levelResults, regression, blandAltman, overallPass, passCount, totalCount, xRange, yRange, summary };
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

// ─── Legacy shim — keep old callers working during migration ─────────────────
export type StudyResults = CalVerResults | MethodCompResults | PrecisionResults;

export function calculateStudy(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  cliaError: number,
  studyType: "cal_ver" | "method_comparison" = "cal_ver"
): CalVerResults | MethodCompResults {
  if (studyType === "method_comparison") {
    return calculateMethodComparison(dataPoints, instrumentNames, cliaError);
  }
  return calculateCalVer(dataPoints, instrumentNames, cliaError);
}

// ─── Type guards ──────────────────────────────────────────────────────────────
export function isCalVer(r: StudyResults): r is CalVerResults { return r.type === "cal_ver"; }
export function isMethodComp(r: StudyResults): r is MethodCompResults { return r.type === "method_comparison"; }
export function isPrecision(r: StudyResults): r is PrecisionResults { return r.type === "precision"; }
