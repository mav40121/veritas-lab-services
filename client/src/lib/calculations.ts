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

export interface RegressionResult {
  slope: number;
  intercept: number;
  proportionalBias: number; // slope - 1
  r2: number;
  n: number;
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

  // Regression: each instrument vs. assigned
  const regression: { [k: string]: RegressionResult } = {};
  const assignedVals = levelResults.map((r) => r.assignedValue);
  const meanVals = levelResults.map((r) => r.mean);
  if (assignedVals.length >= 2) {
    const s = slopeFn(assignedVals, meanVals), b = interceptFn(assignedVals, meanVals);
    regression["Mean vs. Assigned"] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(assignedVals, meanVals), n: assignedVals.length };
  }
  instrumentNames.forEach((n) => {
    const xs: number[] = [], ys: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { xs.push(r.assignedValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) {
      const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
      regression[`${n} vs. Assigned`] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys), n: xs.length };
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
      difference: number;       // test - reference (absolute)
      pctDifference: number;    // (test - reference) / reference * 100
      passFail: "Pass" | "Fail"; // |pctDiff| < cliaError
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
      loa_upper: number; // mean + 1.96 SD
      loa_lower: number; // mean - 1.96 SD
      pctMeanDiff: number;
    };
  };
  overallPass: boolean;
  passCount: number;
  totalCount: number;
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

  // Regression: each test method vs. reference
  const regression: { [k: string]: RegressionResult } = {};
  const refVals = levelResults.map((r) => r.referenceValue);
  instrumentNames.forEach((n) => {
    const xs: number[] = [], ys: number[] = [];
    levelResults.forEach((r) => { if (r.instruments[n]) { xs.push(r.referenceValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) {
      const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
      regression[`${n} vs. Reference`] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys), n: xs.length };
    }
  });

  // If multiple test instruments, also compare them against each other
  if (instrumentNames.length >= 2) {
    const i1 = instrumentNames[0];
    instrumentNames.slice(1).forEach((n) => {
      const xs: number[] = [], ys: number[] = [];
      levelResults.forEach((r) => {
        if (r.instruments[i1] && r.instruments[n]) {
          xs.push(r.instruments[i1].value);
          ys.push(r.instruments[n].value);
        }
      });
      if (xs.length >= 2) {
        const s = slopeFn(xs, ys), b = interceptFn(xs, ys);
        regression[`${n} vs. ${i1}`] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys), n: xs.length };
      }
    });
  }

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

  // Build summary text
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

  return { type: "method_comparison", levelResults, regression, blandAltman, overallPass, passCount, totalCount, summary };
}

// ─── Legacy shim — keep old callers working during migration ─────────────────
// Existing studies saved as "cal_ver" or "method_comparison" route through here.

export type StudyResults = CalVerResults | MethodCompResults;

export function calculateStudy(
  dataPoints: DataPoint[],
  instrumentNames: string[],
  cliaError: number,
  studyType: "cal_ver" | "method_comparison" = "cal_ver"
): StudyResults {
  if (studyType === "method_comparison") {
    return calculateMethodComparison(dataPoints, instrumentNames, cliaError);
  }
  return calculateCalVer(dataPoints, instrumentNames, cliaError);
}

// ─── Type guards ──────────────────────────────────────────────────────────────
export function isCalVer(r: StudyResults): r is CalVerResults { return r.type === "cal_ver"; }
export function isMethodComp(r: StudyResults): r is MethodCompResults { return r.type === "method_comparison"; }
