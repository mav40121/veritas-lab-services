// The Study Narrative Summary on the VeritaCheck results screen.
// Moved out of client/src/pages/StudyResultsPage.tsx (2026-11-08) so
// scripts/verify-study-narrative.mts can run it. server/pdfReport.ts
// narrativeHTML writes the printed report's paragraph and the two should say
// the same thing: same criterion, same CFR paragraph, same closing line.
import type { Study } from "@shared/schema";
import {
  formatTeaCriterion,
  isCalVer,
  isCalVerCorrelation,
  isMethodComp,
  isPrecision,
  isQualitative,
  isSemiQuant,
  type StudyResults,
  type CalVerResults,
  type MethodCompResults,
  type QualitativeResults,
  type SemiQuantResults,
  type PrecisionResults,
} from "./calculations";

// CLAUDE.md, Regulatory language: every narrative ends with this line, and a
// FAIL never tells the director what to do.
export const CLOSING_SENTENCE = "Final approval and clinical determination must be made by the laboratory director or designee.";

// A criterion stored in units (Sodium ±4 mmol/L, Potassium ±0.3 mmol/L,
// Calcium ±1.0 mg/dL, pH ±0.04) holds the number itself in
// cliaAllowableError, not a fraction, so it must never be multiplied by 100.
export function isUnitsCriterion(study: Study): boolean {
  return (study as any).teaIsPercentage === 0;
}

// The adopted criterion as the lab set it: "±4 mmol/L", "±8.0% or ±6 mg/dL (greater)", "±10.0%".
export function studyTeaDisplay(study: Study): string {
  return formatTeaCriterion({
    isPercentage: (study as any).teaIsPercentage !== 0,
    value: study.cliaAllowableError,
    absoluteFloor: (study as any).cliaAbsoluteFloor,
    absoluteUnit: (study as any).cliaAbsoluteUnit,
    valueUnit: (study as any).teaUnit,
  });
}

function analyzerNames(study: Study): string[] {
  try {
    const v = typeof study.instruments === "string" ? JSON.parse(study.instruments) : (study.instruments as any);
    return Array.isArray(v) ? v.map(String) : [];
  } catch { return []; }
}

export function generateNarrative(results: StudyResults, study: Study): string {
  // BUG-085: a study that cannot be evaluated gets no narrative (it would read as a FAIL); the summary says why.
  if ((results as any).notEvaluable) return "";
  const cliaPct = (study.cliaAllowableError * 100).toFixed(1);
  const units = isUnitsCriterion(study);
  const teaLabel = studyTeaDisplay(study);
  let narrative = "";

  if (isCalVerCorrelation(results)) {
    const cv = results.calVer, mc = results.correlation;
    const nAnalyzers = analyzerNames(study).length;
    const material = String((study as any).material || "").trim() || "calibration verification material with assigned values";
    narrative = `${cv.levelResults.length} known-value samples for ${study.testName} were run on ${nAnalyzers} analyzers. `
      + `Calibration verification: ${cv.overallPass ? "all levels on every analyzer were within" : "one or more levels were outside"} the adopted acceptance criterion against the assigned values (${cv.passCount}/${cv.totalCount}). `
      + (mc && mc.totalCount > 0 ? `Correlation against ${results.primary}: ${mc.overallPass ? "all samples on every comparison analyzer were within" : "one or more samples were outside"} the same criterion (${mc.passCount}/${mc.totalCount}). ` : `Correlation against ${results.primary}: no comparison analyzer readings were entered. `)
      + `The comparison used ${material}, not patient specimens. ${CLOSING_SENTENCE}`;
    return narrative;
  }

  if (isCalVer(results)) {
    const cv = results as CalVerResults;
    const source = `§493 PT TEa for this analyte; adopted under 42 CFR §493.1255(b)(2) and §493.1253(b)(3)`;
    const names = Array.from(new Set(cv.levelResults.flatMap((r) => Object.keys(r.instruments || {}))));
    if (names.length > 1) {
      // BUG-058 on the printed report: totalCount is levels x analyzers, and one
      // slope for the mean of the analyzers can hide one analyzer's error, so
      // count the levels once and describe each analyzer.
      const unit = String((study as any).teaUnit || "").trim();
      const failing: string[] = [];
      const lines = names.map((n) => {
        const reg = (cv.regression || {})[`${n} vs. Assigned`];
        const rows = cv.levelResults.filter((r) => r.instruments[n]);
        if (rows.some((r) => r.instruments[n].passFail !== "Pass")) failing.push(n);
        const errs = rows.map((r) => units ? Math.abs(r.instruments[n].value - r.assignedValue) : Math.abs((r.instruments[n].obsError ?? 0) * 100));
        const maxE = errs.length ? Math.max(...errs) : 0;
        const maxStr = units ? `${maxE.toFixed(2)} ${unit}`.trim() : `${maxE.toFixed(1)}%`;
        return `${n}: slope ${(reg?.slope ?? 1).toFixed(3)}, intercept ${(reg?.intercept ?? 0).toFixed(3)}, maximum observed error ${maxStr}`;
      });
      narrative = `${cv.levelResults.length} calibration levels for ${study.testName} were run on ${names.length} analyzers against the adopted calibration verification acceptance criterion of ${teaLabel} (${source}). ${lines.join("; ")}. `;
      narrative += cv.overallPass
        ? `All levels on every analyzer were within the adopted criterion. ${CLOSING_SENTENCE}`
        : `One or more levels were outside the adopted criterion (${failing.join(", ")}); see the per-level table. ${CLOSING_SENTENCE}`;
    } else {
      const slope = Object.values(cv.regression)[0];
      const slopeVal = slope?.slope ?? 1;
      const interceptVal = slope?.intercept ?? 0;
      const slopeInterp = Math.abs(slopeVal - 1) < 0.02
        ? "minimal proportional bias"
        : slopeVal > 1
          ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional bias, results trend slightly high at upper concentrations`
          : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional bias, results trend slightly low at upper concentrations`;
      // A units criterion is already in the result's units; a percent one keeps the old scale.
      const negligibleOffset = units ? study.cliaAllowableError * 0.1 : study.cliaAllowableError * 100 * 0.1;
      const interceptInterp = Math.abs(interceptVal) < negligibleOffset
        ? "a negligible constant offset"
        : interceptVal > 0
          ? `a small positive constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`
          : `a small negative constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`;
      if (cv.overallPass) {
        narrative = `All ${cv.totalCount} calibration levels for ${study.testName} fell within the adopted calibration verification acceptance criterion of ${teaLabel} (${source}). `;
        narrative += `The regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) and intercept of ${interceptVal.toFixed(3)} (ideal: 0) indicate ${slopeInterp} and ${interceptInterp}. This instrument is performing within the adopted limits across its reportable range. ${CLOSING_SENTENCE}`;
      } else {
        const failCount = cv.totalCount - cv.passCount;
        narrative = `${failCount} of ${cv.totalCount} calibration level${failCount > 1 ? "s" : ""} for ${study.testName} exceeded the adopted calibration verification acceptance criterion of ${teaLabel} (${source}). The regression slope of ${slopeVal.toFixed(3)} and intercept of ${interceptVal.toFixed(3)} suggest ${slopeInterp} and ${interceptInterp}. ${CLOSING_SENTENCE}`;
      }
    }
  } else if (isQualitative(results)) {
    const qr = results as QualitativeResults;
    const kappaInterp = qr.cohensKappa < 0.20 ? "Poor" : qr.cohensKappa <= 0.40 ? "Fair" : qr.cohensKappa <= 0.60 ? "Moderate" : qr.cohensKappa <= 0.80 ? "Substantial" : "Almost Perfect";
    if (qr.overallPass) {
      narrative = `Qualitative method comparison for ${study.testName} demonstrated ${qr.percentAgreement.toFixed(1)}% overall agreement (${qr.totalSamples} samples). ` +
        `Cohen's kappa = ${qr.cohensKappa.toFixed(3)} (${kappaInterp}). ` +
        (qr.sensitivity > 0 ? `Sensitivity = ${qr.sensitivity.toFixed(1)}%, Specificity = ${qr.specificity.toFixed(1)}%. ` : "") +
        `The acceptance criterion of >=${(qr.passThreshold * 100).toFixed(0)}% agreement was met. ${CLOSING_SENTENCE}`;
    } else {
      narrative = `Qualitative method comparison for ${study.testName} demonstrated ${qr.percentAgreement.toFixed(1)}% overall agreement, which does not meet the acceptance criterion of >=${(qr.passThreshold * 100).toFixed(0)}% agreement. ` +
        `Cohen's kappa = ${qr.cohensKappa.toFixed(3)} (${kappaInterp}). ${CLOSING_SENTENCE}`;
    }
  } else if (isSemiQuant(results)) {
    const sq = results as SemiQuantResults;
    const kappaInterp = sq.weightedKappa < 0.20 ? "Poor" : sq.weightedKappa <= 0.40 ? "Fair" : sq.weightedKappa <= 0.60 ? "Moderate" : sq.weightedKappa <= 0.80 ? "Substantial" : "Almost Perfect";
    if (sq.overallPass) {
      narrative = `Semi-quantitative method comparison for ${study.testName} demonstrated ${sq.percentWithinOneGrade.toFixed(1)}% agreement within +/-1 grade (${sq.totalSamples} samples). ` +
        `Exact agreement: ${sq.percentExactAgreement.toFixed(1)}%. Weighted kappa = ${sq.weightedKappa.toFixed(3)} (${kappaInterp}). ` +
        `Maximum discrepancy: ${sq.maxDiscrepancy} grade${sq.maxDiscrepancy !== 1 ? "s" : ""}. ` +
        `The acceptance criterion of >=${(sq.passThreshold * 100).toFixed(0)}% within +/-1 grade was met. ${CLOSING_SENTENCE}`;
    } else {
      narrative = `Semi-quantitative method comparison for ${study.testName} demonstrated ${sq.percentWithinOneGrade.toFixed(1)}% agreement within +/-1 grade, which does not meet the acceptance criterion of >=${(sq.passThreshold * 100).toFixed(0)}%. ` +
        `Maximum discrepancy: ${sq.maxDiscrepancy} grade${sq.maxDiscrepancy !== 1 ? "s" : ""}. Weighted kappa = ${sq.weightedKappa.toFixed(3)} (${kappaInterp}). ${CLOSING_SENTENCE}`;
    }
  } else if (isMethodComp(results)) {
    const mc = results as MethodCompResults;
    const firstReg = Object.values(mc.regression).find(r => (r as any).regressionType === "Deming") || Object.values(mc.regression)[0];
    const slopeVal = firstReg?.slope ?? 1;
    const r2Val = firstReg?.r2 ?? 1;
    const rVal = Math.sqrt(r2Val);
    const ba = mc.blandAltman ? Object.values(mc.blandAltman)[0] : null;
    const meanBiasPct: number = (ba as any)?.pctMeanDiff ?? (ba as any)?.meanPctBias ?? 0;
    const meanBiasAbs: number = (ba as any)?.meanDiff ?? 0;
    const unit = String((study as any).teaUnit || "").trim();
    const biasStr = units
      ? `${meanBiasAbs >= 0 ? "+" : ""}${meanBiasAbs.toFixed(2)}${unit ? ` ${unit}` : ""}`
      : `${meanBiasPct >= 0 ? "+" : ""}${meanBiasPct.toFixed(1)}%`;
    const biasWithin = units ? Math.abs(meanBiasAbs) <= study.cliaAllowableError : Math.abs(meanBiasPct) <= study.cliaAllowableError * 100;
    const correlationInterp = rVal >= 0.99 ? "excellent" : rVal >= 0.975 ? "acceptable" : "borderline, review carefully";
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias between methods"
      : slopeVal > 1
        ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional difference, the comparison method reads slightly higher than the primary at upper concentrations`
        : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional difference, the comparison method reads slightly lower than the primary at upper concentrations`;
    const biasInterp = biasWithin
      ? `within the adopted method comparison acceptance criterion of ${teaLabel}`
      : `exceeds the adopted method comparison acceptance criterion of ${teaLabel} and requires investigation`;
    if (mc.overallPass) {
      narrative = `The Pearson correlation coefficient of ${rVal.toFixed(3)} indicates ${correlationInterp} agreement between the two methods for ${study.testName}. The Deming regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) indicates ${slopeInterp}. The mean bias of ${biasStr} is ${biasInterp}. The Bland-Altman analysis confirms no clinically significant systematic difference between methods. ${CLOSING_SENTENCE}`;
    } else {
      narrative = `The method comparison for ${study.testName} did not meet the adopted acceptance criterion. The correlation of ${rVal.toFixed(3)} and a mean bias of ${biasStr} (adopted limit: ${teaLabel}; §493 PT TEa for this analyte; adopted under 42 CFR §493.1281(a)) indicate unacceptable agreement between methods. ${CLOSING_SENTENCE}`;
    }
  } else if (isPrecision(results)) {
    const pr = results as PrecisionResults;
    const maxCV = Math.max(...pr.levelResults.map(r => (r as any).totalCV ?? r.cv ?? 0));
    const isAdvanced = (pr as any).mode === "advanced";
    // Methodology note shared between pass and fail narratives. Names the
    // path (Simple vs Advanced EP15), cites EP15-A3 alongside the existing
    // §493 cite, and surfaces the CV formula so the reader does not have
    // to consult a separate document to interpret the result.
    const methodologyNote = isAdvanced
      ? `Methodology: CLSI EP15-A3 Advanced (ANOVA-decomposed precision). The study estimates within-run, between-day, and total CV across multiple days, runs, and replicates per run. `
      : `Methodology: CLSI EP15-A3 Simple (aggregate precision). For each level, mean and standard deviation (n-1) are computed across all replicates, and the coefficient of variation (CV) is calculated as SD divided by mean, expressed as a percent. `;
    // The precision criterion is read as a CV percent (calculatePrecision); a
    // criterion stored in units is a separate question for Michael, so this
    // still prints what the calculation used.
    if (pr.overallPass) {
      narrative = methodologyNote;
      narrative += `The precision study for ${study.testName} demonstrated a maximum observed CV of ${maxCV.toFixed(2)}%, which is within the adopted precision acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1253(b)(1)(i)(B)). `;
      if (isAdvanced && (pr.levelResults[0] as any)?.withinRunCV !== undefined) {
        const wrCV = ((pr.levelResults[0] as any).withinRunCV ?? 0).toFixed(2);
        const bdCV = ((pr.levelResults[0] as any).betweenDayCV ?? 0).toFixed(2);
        narrative += `ANOVA components show within-run CV of ${wrCV}% and between-day CV of ${bdCV}%, indicating a stable analytical system. `;
      }
      // No "Manufacturer precision claims are verified": that is only known
      // when a vendor SD was entered, and the per-level vendor verdict shows it.
      narrative += CLOSING_SENTENCE;
    } else {
      narrative = methodologyNote;
      narrative += `The precision study for ${study.testName} did not meet the adopted acceptance criterion. The maximum observed CV of ${maxCV.toFixed(2)}% exceeds the adopted precision acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1253(b)(1)(i)(B)). ${CLOSING_SENTENCE}`;
    }
  }
  // Dual-criterion methodology note, placed before the closing line so the
  // narrative still ends with it.
  const absFloor = (study as any).cliaAbsoluteFloor;
  if (absFloor != null && narrative) {
    const note = "TEa pass/fail uses the 42 CFR §493 dual-criterion rule: pass when the absolute difference is within the greater of the percent or absolute term.";
    narrative = narrative.endsWith(CLOSING_SENTENCE)
      ? `${narrative.slice(0, -CLOSING_SENTENCE.length)}${note} ${CLOSING_SENTENCE}`
      : `${narrative} ${note}`;
  }
  return narrative;
}
