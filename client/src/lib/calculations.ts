export interface DataPoint {
  level: number;
  expectedValue: number | null;
  instrumentValues: { [key: string]: number | null };
}

export interface DataPointResult {
  level: number;
  expectedValue: number;
  mean: number;
  pctRecovery: number;
  obsErrorMean: number;
  passFailMean: "Pass" | "Fail";
  instruments: { [key: string]: { value: number; obsError: number; passFail: "Pass" | "Fail" } };
}

export interface RegressionResult { slope: number; intercept: number; proportionalBias: number; r2: number; }
export interface StudyResults {
  dataPointResults: DataPointResult[];
  regression: { [instrument: string]: RegressionResult };
  overallPass: boolean; passCount: number; totalCount: number;
  maxPctRecovery: number; minPctRecovery: number; avgObsError: number; summary: string;
}

function mean(v: number[]) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
function slope(x: number[], y: number[]) {
  const n = x.length; if (n < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0);
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  return den === 0 ? 1 : num / den;
}
function intercept(x: number[], y: number[]) { return mean(y) - slope(x, y) * mean(x); }
function rsq(x: number[], y: number[]) {
  if (x.length < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) ** 2;
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) * y.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  return den === 0 ? 1 : num / den;
}

export function calculateStudy(dataPoints: DataPoint[], instrumentNames: string[], cliaError: number): StudyResults {
  const valid = dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null));
  const dataPointResults: DataPointResult[] = valid.map(dp => {
    const expected = dp.expectedValue!;
    const vals = instrumentNames.map(n => dp.instrumentValues[n]).filter((v): v is number => v !== null);
    const meanVal = vals.length ? mean(vals) : expected;
    const pctRecovery = expected !== 0 ? (meanVal / expected) * 100 : 100;
    const obsErrorMean = expected !== 0 ? (meanVal - expected) / expected : 0;
    const instruments: DataPointResult["instruments"] = {};
    instrumentNames.forEach(n => {
      const v = dp.instrumentValues[n];
      if (v !== null && v !== undefined) {
        const e = expected !== 0 ? (v - expected) / expected : 0;
        instruments[n] = { value: v, obsError: e, passFail: Math.abs(e) < cliaError ? "Pass" : "Fail" };
      }
    });
    return { level: dp.level, expectedValue: expected, mean: meanVal, pctRecovery, obsErrorMean, passFailMean: Math.abs(obsErrorMean) < cliaError ? "Pass" : "Fail", instruments };
  });

  const regression: { [k: string]: RegressionResult } = {};
  const expVals = dataPointResults.map(r => r.expectedValue);
  const meanVals = dataPointResults.map(r => r.mean);
  if (expVals.length >= 2) {
    const s = slope(expVals, meanVals), b = intercept(expVals, meanVals);
    regression["Mean"] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(expVals, meanVals) };
  }
  instrumentNames.forEach(n => {
    const xs: number[] = [], ys: number[] = [];
    dataPointResults.forEach(r => { if (r.instruments[n]) { xs.push(r.expectedValue); ys.push(r.instruments[n].value); } });
    if (xs.length >= 2) { const s = slope(xs, ys), b = intercept(xs, ys); regression[n] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys) }; }
  });
  if (instrumentNames.length >= 2) {
    const i1 = instrumentNames[0];
    instrumentNames.slice(1).forEach(n => {
      const xs: number[] = [], ys: number[] = [];
      dataPointResults.forEach(r => { if (r.instruments[i1] && r.instruments[n]) { xs.push(r.instruments[i1].value); ys.push(r.instruments[n].value); } });
      if (xs.length >= 2) { const s = slope(xs, ys), b = intercept(xs, ys); regression[`${n} vs ${i1}`] = { slope: s, intercept: b, proportionalBias: s - 1, r2: rsq(xs, ys) }; }
    });
  }

  let passCount = 0, totalCount = 0;
  dataPointResults.forEach(r => instrumentNames.forEach(n => { if (r.instruments[n]) { totalCount++; if (r.instruments[n].passFail === "Pass") passCount++; } }));
  const overallPass = passCount === totalCount && totalCount > 0;
  const recoveries = dataPointResults.map(r => r.pctRecovery);
  const maxPctRecovery = recoveries.length ? Math.max(...recoveries) : 100;
  const minPctRecovery = recoveries.length ? Math.min(...recoveries) : 100;
  const avgObsError = dataPointResults.length ? mean(dataPointResults.map(r => Math.abs(r.obsErrorMean))) : 0;
  const range = dataPointResults.length ? `${dataPointResults[0].mean.toFixed(3)} to ${dataPointResults[dataPointResults.length - 1].mean.toFixed(3)}` : "—";
  const cliaPercent = (cliaError * 100).toFixed(1);
  const maxDev = Math.max(...dataPointResults.map(r => Math.abs(r.pctRecovery - 100)));
  const summary = `Calibration Verification was analyzed over a measured range of ${range}. This analysis assumes accurate assigned values. Allowable systematic error (SEa) was ${cliaPercent}%. The accuracy test ${overallPass ? "PASSED" : "FAILED"}. The maximum deviation from 100% recovery was ${maxDev.toFixed(1)}%. ${passCount} of ${totalCount} results were accurate within the SEa of ${cliaPercent}%. The system ${overallPass ? "PASSED" : "FAILED"} reportable range tests.`;
  return { dataPointResults, regression, overallPass, passCount, totalCount, maxPctRecovery, minPctRecovery, avgObsError, summary };
}
