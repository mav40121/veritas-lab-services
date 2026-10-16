// client/src/lib/studyResults.ts
//
// One place that turns a saved VeritaCheck study into the results its report shows (moved verbatim from
// StudyResultsPage on 2026-10-16). The results page and the server's "Download all records" job both call it, so a
// study PDF in the export is built from exactly the numbers the director sees on screen. Relative imports only: the
// server bundles this file too. Sensitivity studies are computed here for the export; the page renders them on its
// own path before it reaches this function.

import {
  calculateCalVerCorrelation, calculateLotToLot, calculateMethodComparison, calculateMultiAnalyteCoag, calculatePTCoag,
  calculatePrecision, calculateQCRange, calculateQualitative, calculateRefInterval, calculateSemiQuant, calculateSensitivity,
  calculateStudy,
  type DataPoint, type PrecisionDataPoint, type QCRangeDataPoint, type StudyResults,
} from "./calculations";
import { isCensored, censorValueForMath, type CensoringPolicy } from "../../../shared/censoring";
import type { Study } from "../../../shared/schema";

// 2026-06-11: a saved study's data_points may contain censored ("<17") values
// (Censoring Level 2). The on-screen results are RE-COMPUTED from data_points
// through the numeric calculate* engine, which would NaN-poison on a censored
// object. Resolve every censored value per the study's policy (exclude -> null
// which every calculate* filters; substitute -> imputed number) before
// computing, so the screen matches the server-rendered PDF. No-op when the blob
// has no censored values.
export function deepResolveCensored(obj: any, policy: CensoringPolicy): any {
  if (isCensored(obj)) return censorValueForMath(obj, policy);
  if (Array.isArray(obj)) return obj.map((x) => deepResolveCensored(x, policy));
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) out[k] = deepResolveCensored(obj[k], policy);
    return out;
  }
  return obj;
}

export function computeStudyResults(study: Study): StudyResults {
  if (study.studyType === "sensitivity") {
    return calculateSensitivity((JSON.parse(study.dataPoints) as { input: any }).input) as unknown as StudyResults;
  }
  const instrumentNames: string[] = JSON.parse(study.instruments);
  // Resolve censored ("<17") values per the study's policy BEFORE the numeric
  // calculate* engine runs, so the screen matches the PDF (which resolves the
  // same way server-side). Falls back to "exclude" (the default) when unset.
  const viewCensoringPolicy = ((study as any).censoringPolicy || (study as any).censoring_policy || "exclude") as CensoringPolicy;
  const rawDataPoints = deepResolveCensored(JSON.parse(study.dataPoints), viewCensoringPolicy);
  let results: StudyResults;
  if (study.studyType === "precision") {
    results = calculatePrecision(
      rawDataPoints as PrecisionDataPoint[],
      study.cliaAllowableError,
      (rawDataPoints[0]?.days ? "advanced" : "simple"),
      {
        // Phase 1 parity (2026-05-20): wire the optional inputs persisted
        // on the study record into the calculator so CIs / 2 SD range /
        // bias / vendor verdict appear on saved studies, not only on
        // fresh client-side computations.
        vendorSD: (study as any).vendorSd ?? undefined,
        vendorSDConcentration: (study as any).vendorSdConcentration ?? undefined,
        targetMean: (study as any).targetMean ?? undefined,
        targetCV: (study as any).targetCv ?? undefined,
      },
    );
  } else if (study.studyType === "lot_to_lot") {
    const { data, sampleType } = rawDataPoints;
    results = calculateLotToLot(data, study.cliaAllowableError, sampleType);
  } else if (study.studyType === "pt_coag") {
    const { module1, module1Instruments, module2, module3: m3Raw } = rawDataPoints;
    // Symmetric multi-instrument: module1Instruments[] is the new shape. Legacy
    // single-instrument studies carry a singular `module1` + the top-level
    // `instrument` name; normalize those into a 1-element array so old studies
    // still compute and render.
    const module1Blocks = Array.isArray(module1Instruments) && module1Instruments.length > 0
      ? module1Instruments.map((b: any) => ({ name: b.name, ptValues: b.ptValues, isi: b.isi, ptRI: b.ptRI, inrRI: b.inrRI, reagentLot: b.reagentLot, reagentExp: b.reagentExp }))
      : [{ name: (study as any).instrument, ptValues: module1.ptValues, isi: module1.isi, ptRI: module1.ptRI, inrRI: module1.inrRI, reagentLot: rawDataPoints.reagentLot, reagentExp: rawDataPoints.reagentExp }];
    // Module 2/3 comparisons are optional (may be absent on a multi-instrument study).
    const m2Data = module2 && Array.isArray(module2.data) ? (() => {
      const v = module2.data.filter((d: any) => d.x !== null && d.y !== null);
      return v.length >= 3 ? { xValues: v.map((d: any) => d.x), yValues: v.map((d: any) => d.y), specimenIds: v.map((d: any) => d.id), tea: module2.tea } : null;
    })() : null;
    const module3Data = m3Raw && Array.isArray(m3Raw.data) ? (() => {
      const m3Valid = m3Raw.data.filter((d: any) => d.x !== null && d.y !== null);
      return m3Valid.length >= 3 ? { xValues: m3Valid.map((d: any) => d.x), yValues: m3Valid.map((d: any) => d.y), specimenIds: m3Valid.map((d: any) => d.id), tea: m3Raw.tea } : null;
    })() : null;
    results = calculatePTCoag(module1Blocks, m2Data, module3Data);
  } else if (study.studyType === "qc_range") {
    const { dataPoints: dp, dateRange } = rawDataPoints;
    results = calculateQCRange(dp as QCRangeDataPoint[], dateRange);
  } else if (study.studyType === "multi_analyte_coag") {
    const { specimens, isi, normalMeanPT, teas } = rawDataPoints;
    results = calculateMultiAnalyteCoag(specimens, isi, normalMeanPT, teas);
  } else if (study.studyType === "ref_interval") {
    const { specimens, refLow, refHigh, analyte, units } = rawDataPoints;
    results = calculateRefInterval(specimens, refLow, refHigh, analyte || study.testName, units || "");
  } else if (study.studyType === "carryover") {
    // CLSI EP10-A3 carryover: walk specimens in test order, classify each
    // Low specimen by predecessor type, compute mean/SD for LL and LH
    // pools, return the same results shape the server's buildCarryoverHTML
    // expects (added in PR #477). The shape is the authoritative reference
    // for both the screen render and the PDF render.
    const { specimens: coSpecs, units: coUnits } = (rawDataPoints as { specimens: Array<{ sequence: number; sample_type: "L" | "H"; value: number }>; units?: string });
    const valid = (coSpecs || []).filter(s => s && (s.sample_type === "L" || s.sample_type === "H") && s.value !== null && !isNaN(s.value as number));
    const lValues = valid.filter(d => d.sample_type === "L").map(d => d.value);
    const hValues = valid.filter(d => d.sample_type === "H").map(d => d.value);
    const ll: number[] = [], lh: number[] = [];
    const classifications: string[] = [];
    for (let i = 0; i < valid.length; i++) {
      const dp = valid[i];
      let cls = "";
      if (i > 0) {
        const prev = valid[i - 1];
        if (dp.sample_type === "L") {
          if (prev.sample_type === "L") { ll.push(dp.value); cls = "L-after-L"; }
          else { lh.push(dp.value); cls = "L-after-H"; }
        } else {
          cls = prev.sample_type === "H" ? "H-after-H" : "H-after-L";
        }
      }
      classifications.push(cls);
    }
    const _mean = (a: number[]) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
    const _sd = (a: number[]) => {
      if (a.length < 2) return 0;
      const m = _mean(a);
      return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
    };
    const meanL = _mean(lValues);
    const meanH = _mean(hValues);
    const meanLL = _mean(ll);
    const meanLH = _mean(lh);
    const sdLL = _sd(ll);
    const sdLH = _sd(lh);
    const carryoverAbs = Math.abs(meanLH - meanLL);
    const carryoverPct = (meanH - meanL) !== 0 ? ((meanLH - meanLL) / (meanH - meanL)) * 100 : null;
    const errorLimit = 3 * sdLL;
    const overallPass = ll.length >= 2 && lh.length >= 1 && carryoverAbs <= errorLimit;
    results = {
      type: "carryover",
      analyte: study.testName,
      units: coUnits || "",
      specimens: valid.map((d, i) => ({ sequence: d.sequence, sample_type: d.sample_type, value: d.value, classification: classifications[i] })),
      mean_L: meanL, mean_H: meanH,
      n_LL: ll.length, n_LH: lh.length,
      mean_LL: meanLL, mean_LH: meanLH,
      sd_LL: sdLL, sd_LH: sdLH,
      carryover_absolute: carryoverAbs,
      carryover_pct: carryoverPct,
      error_limit: errorLimit,
      overallPass,
      summary: overallPass
        ? `Absolute carryover ${carryoverAbs.toFixed(3)} ${coUnits || ""} did not exceed the Error Limit of ${errorLimit.toFixed(3)} ${coUnits || ""} (3 x SD of L-after-L specimens). Carryover is within the noise floor.`
        : `Absolute carryover ${carryoverAbs.toFixed(3)} ${coUnits || ""} exceeded the Error Limit of ${errorLimit.toFixed(3)} ${coUnits || ""} (3 x SD of L-after-L specimens). Investigate sampling system contamination.`,
    } as any;
  } else if (study.studyType === "accuracy_bias") {
    // CLSI EP15-A3 §6 accuracy/bias: per-level |mean - assigned| versus the
    // dual-criterion S493 allowance: max(percent_allowance, absolute_floor).
    // All levels must pass for overall pass. Results shape mirrors the server
    // evaluator and buildAccuracyBiasHTML PDF generator.
    const { analyte, units, levels } = (rawDataPoints as {
      analyte?: string;
      units?: string;
      levels?: Array<{ name: string; assigned_value: number | null; replicates: number[] }>;
    });
    const tea = study.cliaAllowableError;
    const teaIsPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = ((study as any).cliaAbsoluteFloor ?? null) as number | null;
    const absUnit = ((study as any).cliaAbsoluteUnit ?? null) as string | null;
    const inLevels = Array.isArray(levels) ? levels : [];
    let allPass = inLevels.length > 0;
    const FP_EPS = 1e-9;
    const perLevel = inLevels.map(lv => {
      const reps = (lv.replicates || []).filter(v => v !== undefined && v !== null && !isNaN(v as number)) as number[];
      const n = reps.length;
      const assigned = lv.assigned_value;
      if (n === 0 || assigned === null || assigned === undefined || assigned === 0) {
        allPass = false;
        return { name: lv.name, assigned_value: assigned ?? null, n, mean: null, sd: null, pctRecovery: null, absBiasPct: null, absBias: null, allowance: null, verdict: "incomplete" };
      }
      const mean = reps.reduce((s, v) => s + v, 0) / n;
      const variance = n > 1 ? reps.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
      const sdv = Math.sqrt(variance);
      const pctRecovery = (mean / assigned) * 100;
      const absBias = Math.abs(mean - assigned);
      const absBiasPct = absBias / Math.abs(assigned) * 100;
      const pctAllowance = teaIsPercentage ? Math.abs(assigned) * tea : 0;
      const absAllowance = teaIsPercentage ? (absFloor ?? 0) : tea;
      const allowance = Math.max(pctAllowance, absAllowance);
      const pass = absBias <= allowance + FP_EPS;
      if (!pass) allPass = false;
      return { name: lv.name, assigned_value: assigned, n, mean, sd: sdv, pctRecovery, absBiasPct, absBias, allowance, verdict: pass ? "pass" : "fail" };
    });
    const teaPctTxt = teaIsPercentage ? `${(tea * 100).toFixed(1)}%` : `${tea} ${absUnit || ""}`.trim();
    const floorTxt = teaIsPercentage && absFloor ? ` or ${absFloor} ${absUnit || ""}, whichever is greater` : "";
    results = {
      type: "accuracy_bias",
      analyte: analyte || study.testName,
      units: units || "",
      tea,
      teaIsPercentage,
      absoluteFloor: absFloor,
      absoluteUnit: absUnit,
      levels: perLevel,
      overallPass: allPass,
      summary: allPass
        ? `All levels met the CLIA total allowable error criterion of ${teaPctTxt}${floorTxt} for ${analyte || study.testName}.`
        : `One or more levels exceeded the CLIA total allowable error criterion of ${teaPctTxt}${floorTxt} for ${analyte || study.testName}.`,
    } as any;
  } else if (study.studyType === "linearity") {
    // CLSI EP06 verification: OLS regression of per-level measured-mean vs
    // assigned target. Pass when |slope - 1| × 100 ≤ TEa% AND r² ≥ 0.95.
    const { analyte, units, levels } = (rawDataPoints as {
      analyte?: string;
      units?: string;
      levels?: Array<{ name: string; assigned_value: number | null; replicates: number[] }>;
    });
    const tea = study.cliaAllowableError;
    const teaIsPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = ((study as any).cliaAbsoluteFloor ?? null) as number | null;
    const absUnit = ((study as any).cliaAbsoluteUnit ?? null) as string | null;
    const inLevels = Array.isArray(levels) ? levels : [];
    const FP_EPS = 1e-9;
    // Per-level rows
    const perLevel = inLevels.map(lv => {
      const reps = (lv.replicates || []).filter(v => v !== undefined && v !== null && !isNaN(v as number)) as number[];
      const n = reps.length;
      const assigned = lv.assigned_value;
      if (n === 0 || assigned === null || assigned === undefined || assigned === 0) {
        return { name: lv.name, assigned_value: assigned ?? null, n, mean: null, sd: null, pctRecovery: null, absBias: null, allowance: null, verdict: "incomplete" };
      }
      const mean = reps.reduce((s, v) => s + v, 0) / n;
      const variance = n > 1 ? reps.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
      const sdv = Math.sqrt(variance);
      const pctRecovery = (mean / assigned) * 100;
      const absBias = Math.abs(mean - assigned);
      const pctAllowance = teaIsPercentage ? Math.abs(assigned) * tea : 0;
      const absAllowance = teaIsPercentage ? (absFloor ?? 0) : tea;
      const allowance = Math.max(pctAllowance, absAllowance);
      const pass = absBias <= allowance + FP_EPS;
      return { name: lv.name, assigned_value: assigned, n, mean, sd: sdv, pctRecovery, absBias, allowance, verdict: pass ? "pass" : "fail" };
    });
    // Regression on usable levels (assigned + replicates present)
    const usablePts = perLevel
      .filter(l => l.assigned_value !== null && l.assigned_value !== undefined && l.assigned_value !== 0 && l.mean !== null)
      .map(l => ({ x: l.assigned_value as number, y: l.mean as number }));
    let slope = 0, intercept = 0, r2 = 0, slopeBiasPct = 0;
    if (usablePts.length >= 3) {
      const n = usablePts.length;
      const meanX = usablePts.reduce((s, p) => s + p.x, 0) / n;
      const meanY = usablePts.reduce((s, p) => s + p.y, 0) / n;
      const ssXX = usablePts.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
      const ssYY = usablePts.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
      const ssXY = usablePts.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
      slope = ssXX > 0 ? ssXY / ssXX : 0;
      intercept = meanY - slope * meanX;
      r2 = (ssXX > 0 && ssYY > 0) ? (ssXY * ssXY) / (ssXX * ssYY) : 0;
      slopeBiasPct = Math.abs(slope - 1) * 100;
    }
    const teaPct = teaIsPercentage ? tea * 100 : 100;
    const slopePass = slopeBiasPct <= teaPct + FP_EPS;
    const r2Pass = r2 >= 0.95 - FP_EPS;
    const overallPass = usablePts.length >= 3 && slopePass && r2Pass;
    const teaTxt = teaIsPercentage ? `${(tea * 100).toFixed(1)}%${absFloor ? ` or ${absFloor} ${absUnit || ""}` : ""}` : `${tea} ${absUnit || ""}`.trim();
    results = {
      type: "linearity",
      analyte: analyte || study.testName,
      units: units || "",
      tea,
      teaIsPercentage,
      absoluteFloor: absFloor,
      absoluteUnit: absUnit,
      slope,
      intercept,
      r2,
      slopeBiasPct,
      levels: perLevel,
      overallPass,
      summary: overallPass
        ? `Linearity verified across ${usablePts.length} levels: |slope - 1| × 100 = ${slopeBiasPct.toFixed(2)}% (within TEa ${teaTxt}) and r² = ${r2.toFixed(4)} (≥ 0.95).`
        : `Linearity not verified: |slope - 1| × 100 = ${slopeBiasPct.toFixed(2)}% ${slopePass ? "within" : "exceeds"} TEa ${teaTxt}; r² = ${r2.toFixed(4)} ${r2Pass ? "meets" : "below"} 0.95.`,
    } as any;
  } else if (study.studyType === "reportable_range") {
    // CLIA §493.1255 AMR verification. Per-level dual-criterion bias against
    // TEa identical to accuracy_bias. Adds claimed_range_low / claimed_range_high
    // as documentation fields surfaced on the report.
    const { analyte, units, levels, claimed_range_low, claimed_range_high } = (rawDataPoints as {
      analyte?: string;
      units?: string;
      levels?: Array<{ name: string; assigned_value: number | null; replicates: number[] }>;
      claimed_range_low?: number | null;
      claimed_range_high?: number | null;
    });
    const tea = study.cliaAllowableError;
    const teaIsPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = ((study as any).cliaAbsoluteFloor ?? null) as number | null;
    const absUnit = ((study as any).cliaAbsoluteUnit ?? null) as string | null;
    const inLevels = Array.isArray(levels) ? levels : [];
    let allPass = inLevels.length > 0;
    const FP_EPS = 1e-9;
    const perLevel = inLevels.map(lv => {
      const reps = (lv.replicates || []).filter(v => v !== undefined && v !== null && !isNaN(v as number)) as number[];
      const n = reps.length;
      const assigned = lv.assigned_value;
      if (n === 0 || assigned === null || assigned === undefined || assigned === 0) {
        allPass = false;
        return { name: lv.name, assigned_value: assigned ?? null, n, mean: null, sd: null, pctRecovery: null, absBiasPct: null, absBias: null, allowance: null, verdict: "incomplete" };
      }
      const mean = reps.reduce((s, v) => s + v, 0) / n;
      const variance = n > 1 ? reps.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
      const sdv = Math.sqrt(variance);
      const pctRecovery = (mean / assigned) * 100;
      const absBias = Math.abs(mean - assigned);
      const absBiasPct = absBias / Math.abs(assigned) * 100;
      const pctAllowance = teaIsPercentage ? Math.abs(assigned) * tea : 0;
      const absAllowance = teaIsPercentage ? (absFloor ?? 0) : tea;
      const allowance = Math.max(pctAllowance, absAllowance);
      const pass = absBias <= allowance + FP_EPS;
      if (!pass) allPass = false;
      return { name: lv.name, assigned_value: assigned, n, mean, sd: sdv, pctRecovery, absBiasPct, absBias, allowance, verdict: pass ? "pass" : "fail" };
    });
    const teaPctTxt = teaIsPercentage ? `${(tea * 100).toFixed(1)}%` : `${tea} ${absUnit || ""}`.trim();
    const floorTxt = teaIsPercentage && absFloor ? ` or ${absFloor} ${absUnit || ""}, whichever is greater` : "";
    const rangeTxt = (claimed_range_low !== null && claimed_range_low !== undefined && claimed_range_high !== null && claimed_range_high !== undefined)
      ? ` for a claimed reportable range of ${claimed_range_low} to ${claimed_range_high} ${units || "units"}`
      : "";
    results = {
      type: "reportable_range",
      analyte: analyte || study.testName,
      units: units || "",
      tea,
      teaIsPercentage,
      absoluteFloor: absFloor,
      absoluteUnit: absUnit,
      claimed_range_low: claimed_range_low ?? null,
      claimed_range_high: claimed_range_high ?? null,
      levels: perLevel,
      overallPass: allPass,
      summary: allPass
        ? `All ${perLevel.length} levels met the CLIA total allowable error criterion of ${teaPctTxt}${floorTxt} for ${analyte || study.testName}${rangeTxt}.`
        : `One or more levels exceeded the CLIA total allowable error criterion of ${teaPctTxt}${floorTxt} for ${analyte || study.testName}${rangeTxt}.`,
    } as any;
  } else if (study.studyType === "method_comparison") {
    // Check if this is qualitative or semi-quantitative data
    if (rawDataPoints.assayType === "qualitative") {
      const { categories, passThreshold, points } = rawDataPoints;
      const comparisonNames = instrumentNames.slice(1);
      const mappedPoints: DataPoint[] = (points as DataPoint[]).map(dp => ({
        level: dp.level, expectedValue: null, instrumentValues: {},
        expectedCategory: dp.expectedCategory ?? null,
        instrumentCategories: Object.fromEntries(comparisonNames.map(n => [n, dp.instrumentCategories?.[n] ?? null])),
      }));
      results = calculateQualitative(mappedPoints, comparisonNames, categories, passThreshold);
    } else if (rawDataPoints.assayType === "semi_quantitative") {
      const { gradeScale, passThreshold, points } = rawDataPoints;
      const comparisonNames = instrumentNames.slice(1);
      const mappedPoints: DataPoint[] = (points as DataPoint[]).map(dp => ({
        level: dp.level, expectedValue: null, instrumentValues: {},
        expectedCategory: dp.expectedCategory ?? null,
        instrumentCategories: Object.fromEntries(comparisonNames.map(n => [n, dp.instrumentCategories?.[n] ?? null])),
      }));
      results = calculateSemiQuant(mappedPoints, comparisonNames, gradeScale, passThreshold);
    } else {
      // Standard quantitative method comparison
      const dp = rawDataPoints as DataPoint[];
      const primaryName = instrumentNames[0];
      const hasAllInstrumentsInValues = dp.length > 0 && instrumentNames.every(n => n in (dp[0].instrumentValues || {}));
      if (hasAllInstrumentsInValues && instrumentNames.length >= 2) {
        const comparisonNames = instrumentNames.slice(1);
        // 2026-07-27 fix: spread ...d FIRST so director-excluded points keep
        // their `excluded`/`exclusion_reason` flags through the remap. Without
        // it, calculateMethodComparison (calculations.ts) could not filter the
        // excluded points on multi-instrument studies, so the on-screen verdict
        // counted all points and showed FAIL on a study the server marked pass.
        const mappedPoints: DataPoint[] = dp.map(d => ({
          ...d,
          level: d.level,
          expectedValue: d.instrumentValues[primaryName] ?? null,
          instrumentValues: Object.fromEntries(comparisonNames.map(n => [n, d.instrumentValues[n] ?? null])),
        }));
        const isPercentage = (study as any).teaIsPercentage !== 0;
        const absFloor = (study as any).cliaAbsoluteFloor ?? null;
        results = calculateMethodComparison(mappedPoints, comparisonNames, study.cliaAllowableError, isPercentage, absFloor);
      } else {
        const comparisonNames = instrumentNames.filter(n => n in (dp[0]?.instrumentValues || {}));
        const isPercentage = (study as any).teaIsPercentage !== 0;
        const absFloor = (study as any).cliaAbsoluteFloor ?? null;
        results = calculateMethodComparison(dp, comparisonNames.length > 0 ? comparisonNames : instrumentNames, study.cliaAllowableError, isPercentage, absFloor);
      }
    }
  } else if (study.studyType === "cal_ver_correlation") {
    // Calibration Verification + Correlation: both halves from the one data entry (first analyzer = primary).
    const isPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = (study as any).cliaAbsoluteFloor ?? null;
    results = calculateCalVerCorrelation(rawDataPoints as DataPoint[], instrumentNames, study.cliaAllowableError, isPercentage, absFloor);
  } else {
    const isPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = (study as any).cliaAbsoluteFloor ?? null;
    results = calculateStudy(rawDataPoints as DataPoint[], instrumentNames, study.cliaAllowableError, study.studyType as "cal_ver" | "method_comparison", isPercentage, absFloor);
  }
  return results;
}
