import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { useAuth } from "@/components/AuthContext";
import { useLocation, useSearch } from "wouter";
import {
  calculateStudy,
  calculateMethodComparison,
  calculatePrecision,
  calculateLotToLot,
  calculatePTCoag,
  calculateQCRange,
  calculateMultiAnalyteCoag,
  calculateQualitative,
  calculateSemiQuant,
  isCalVer,
  isMethodComp,
  isPrecision,
  isLotToLot,
  isPTCoag,
  isQCRange,
  isMultiAnalyteCoag,
  isQualitative,
  isSemiQuant,
  type StudyResults,
  type CalVerResults,
  type MethodCompResults,
  type QualitativeResults,
  type SemiQuantResults,
  type PrecisionResults,
  type LotToLotResults,
  type PTCoagResults,
  type QCRangeResults,
  type MultiAnalyteResults,
  type RefIntervalResults,
  type PrecisionDataPoint,
  type DataPoint,
  type QCRangeDataPoint,
  calculateRefInterval,
  isRefInterval,
} from "@/lib/calculations";
import type { Study } from "@shared/schema";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { FileDown, ArrowLeft, CheckCircle2, XCircle, Loader2, BookOpen } from "lucide-react";
import React, { useState, useCallback, useEffect } from "react";
import { API_BASE } from "@/lib/queryClient";

async function downloadPDF(study: Study, results: StudyResults) {
  const res = await fetch(`${API_BASE}/api/generate-pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ study, results }),
  });
  if (!res.ok) throw new Error(await res.text());

  const typeMap: Record<string, string> = { cal_ver: "CalVer", precision: "Precision", method_comparison: "MethodComp", lot_to_lot: "LotToLot", pt_coag: "PTCoag", qc_range: "QCRange", multi_analyte_coag: "MultiAnalyteCoag", ref_interval: "RefInterval" };
  const filename = `VeritaCheck_${typeMap[study.studyType] || "Study"}_${study.testName.replace(/\s+/g, "_")}_${study.date}.pdf`;

  const { token } = await res.json();
  downloadPdfToken(token, filename);
}

const CHART_COLORS = ["#2ecbc7", "#4f9ef5", "#67d967", "#f5a623", "#a78bfa"];

// ─── Shared header / pass-fail ────────────────────────────────────────────────
function StudyHeader({ study, results }: { study: Study; results: StudyResults }) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const handlePDF = useCallback(async () => {
    setPdfLoading(true);
    try { await downloadPDF(study, results); }
    catch (e) { alert("PDF generation failed. Please try again."); }
    finally { setPdfLoading(false); }
  }, [study, results]);

  return (
    <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
            <Link href="/dashboard">
              <ArrowLeft size={14} className="mr-1" />Dashboard
            </Link>
          </Button>
        </div>
        <h1 className="text-xl font-bold">{study.testName}</h1>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : study.studyType === "precision" ? "Precision Verification (EP15)" : study.studyType === "lot_to_lot" ? "Lot-to-Lot Verification" : study.studyType === "pt_coag" ? "PT/Coag New Lot Validation" : study.studyType === "qc_range" ? "QC Range Establishment" : study.studyType === "multi_analyte_coag" ? "Multi-Analyte Lot Comparison (Coag)" : study.studyType === "ref_interval" ? "Reference Range Verification" : "Correlation / Method Comparison"}
          </Badge>
          <span className="text-sm text-muted-foreground">{study.instrument}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{study.date}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">Analyst: {study.analyst}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {results.overallPass ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border px-3 py-1 text-sm font-semibold">
            <CheckCircle2 size={14} className="mr-1.5" />PASS
          </Badge>
        ) : (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/30 border px-3 py-1 text-sm font-semibold">
            <XCircle size={14} className="mr-1.5" />FAIL
          </Badge>
        )}
        <Button
          onClick={handlePDF}
          disabled={pdfLoading}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          data-testid="button-download-pdf"
        >
          {pdfLoading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <FileDown size={14} className="mr-1.5" />}
          {pdfLoading ? "Generating…" : "Download PDF"}
        </Button>
      </div>
    </div>
  );
}

function generateNarrative(results: StudyResults, study: Study): string {
  const cliaPct = (study.cliaAllowableError * 100).toFixed(1);
  const adlmPct = (study.cliaAllowableError * 50).toFixed(1);
  let narrative = "";

  if (isCalVer(results)) {
    const cv = results as CalVerResults;
    const maxErr = Math.max(...cv.levelResults.map(r => Math.abs(r.obsError * 100)));
    const meetsAdlm = maxErr <= study.cliaAllowableError * 50;
    const slope = Object.values(cv.regression)[0];
    const slopeVal = slope?.slope ?? 1;
    const interceptVal = slope?.intercept ?? 0;
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias"
      : slopeVal > 1
        ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional bias, results trend slightly high at upper concentrations`
        : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional bias, results trend slightly low at upper concentrations`;
    const interceptInterp = Math.abs(interceptVal) < study.cliaAllowableError * 100 * 0.1
      ? "a negligible constant offset"
      : interceptVal > 0
        ? `a small positive constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`
        : `a small negative constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`;
    if (cv.overallPass) {
      narrative = `All ${cv.totalCount} calibration levels for ${study.testName} fell within the adopted calibration verification acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1255(b)(3) and §493.1253(b)(2)). `;
      narrative += meetsAdlm
        ? `The maximum observed error of ${maxErr.toFixed(1)}% also meets the ADLM-recommended internal goal of ±${adlmPct}%, indicating performance well above the adopted acceptance criterion. `
        : `The maximum observed error of ${maxErr.toFixed(1)}% meets the adopted acceptance criterion; the ADLM recommends an internal goal of ±${adlmPct}% for enhanced quality assurance. `;
      narrative += `The regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) and intercept of ${interceptVal.toFixed(3)} (ideal: 0) indicate ${slopeInterp} and ${interceptInterp}. This instrument is performing within the adopted limits across its reportable range.`;
    } else {
      const failCount = cv.totalCount - cv.passCount;
      narrative = `${failCount} of ${cv.totalCount} calibration level${failCount > 1 ? "s" : ""} for ${study.testName} exceeded the adopted calibration verification acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1255(b)(3) and §493.1253(b)(2)). The regression slope of ${slopeVal.toFixed(3)} and intercept of ${interceptVal.toFixed(3)} suggest ${slopeInterp} and ${interceptInterp}. Review calibration, reagent lot, and instrument maintenance records. Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  } else if (isQualitative(results)) {
    const qr = results as QualitativeResults;
    const kappaInterp = qr.cohensKappa < 0.20 ? "Poor" : qr.cohensKappa <= 0.40 ? "Fair" : qr.cohensKappa <= 0.60 ? "Moderate" : qr.cohensKappa <= 0.80 ? "Substantial" : "Almost Perfect";
    if (qr.overallPass) {
      narrative = `Qualitative method comparison for ${study.testName} demonstrated ${qr.percentAgreement.toFixed(1)}% overall agreement (${qr.totalSamples} samples). ` +
        `Cohen's kappa = ${qr.cohensKappa.toFixed(3)} (${kappaInterp}). ` +
        (qr.sensitivity > 0 ? `Sensitivity = ${qr.sensitivity.toFixed(1)}%, Specificity = ${qr.specificity.toFixed(1)}%. ` : "") +
        `The acceptance criterion of >=${(qr.passThreshold * 100).toFixed(0)}% agreement was met. Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `Qualitative method comparison for ${study.testName} demonstrated ${qr.percentAgreement.toFixed(1)}% overall agreement, which does not meet the acceptance criterion of >=${(qr.passThreshold * 100).toFixed(0)}% agreement. ` +
        `Cohen's kappa = ${qr.cohensKappa.toFixed(3)} (${kappaInterp}). Review discordant specimens and investigate potential causes.`;
    }
  } else if (isSemiQuant(results)) {
    const sq = results as SemiQuantResults;
    const kappaInterp = sq.weightedKappa < 0.20 ? "Poor" : sq.weightedKappa <= 0.40 ? "Fair" : sq.weightedKappa <= 0.60 ? "Moderate" : sq.weightedKappa <= 0.80 ? "Substantial" : "Almost Perfect";
    if (sq.overallPass) {
      narrative = `Semi-quantitative method comparison for ${study.testName} demonstrated ${sq.percentWithinOneGrade.toFixed(1)}% agreement within +/-1 grade (${sq.totalSamples} samples). ` +
        `Exact agreement: ${sq.percentExactAgreement.toFixed(1)}%. Weighted kappa = ${sq.weightedKappa.toFixed(3)} (${kappaInterp}). ` +
        `Maximum discrepancy: ${sq.maxDiscrepancy} grade${sq.maxDiscrepancy !== 1 ? "s" : ""}. ` +
        `The acceptance criterion of >=${(sq.passThreshold * 100).toFixed(0)}% within +/-1 grade was met. Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `Semi-quantitative method comparison for ${study.testName} demonstrated ${sq.percentWithinOneGrade.toFixed(1)}% agreement within +/-1 grade, which does not meet the acceptance criterion of >=${(sq.passThreshold * 100).toFixed(0)}%. ` +
        `Maximum discrepancy: ${sq.maxDiscrepancy} grade${sq.maxDiscrepancy !== 1 ? "s" : ""}. Weighted kappa = ${sq.weightedKappa.toFixed(3)} (${kappaInterp}). ` +
        `Review discrepant samples and investigate potential causes.`;
    }
  } else if (isMethodComp(results)) {
    const mc = results as MethodCompResults;
    const firstReg = Object.values(mc.regression).find(r => (r as any).regressionType === "Deming") || Object.values(mc.regression)[0];
    const slopeVal = firstReg?.slope ?? 1;
    const r2Val = firstReg?.r2 ?? 1;
    const rVal = Math.sqrt(r2Val);
    const ba = mc.blandAltman ? Object.values(mc.blandAltman)[0] : null;
    const meanBiasPct: number = (ba as any)?.pctMeanDiff ?? (ba as any)?.meanPctBias ?? 0;
    const correlationInterp = rVal >= 0.99 ? "excellent" : rVal >= 0.975 ? "acceptable" : "borderline, review carefully";
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias between methods"
      : slopeVal > 1
        ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional difference, the comparison method reads slightly higher than the primary at upper concentrations`
        : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional difference, the comparison method reads slightly lower than the primary at upper concentrations`;
    const teaLabel = formatTeaDisplay(study);
    const biasInterp = Math.abs(meanBiasPct) <= study.cliaAllowableError * 100
      ? `within the adopted method comparison acceptance criterion of ${teaLabel}`
      : `exceeds the adopted method comparison acceptance criterion of ${teaLabel} and requires investigation`;
    if (mc.overallPass) {
      narrative = `The Pearson correlation coefficient of ${rVal.toFixed(3)} indicates ${correlationInterp} agreement between the two methods for ${study.testName}. The Deming regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) indicates ${slopeInterp}. The mean bias of ${meanBiasPct >= 0 ? "+" : ""}${meanBiasPct.toFixed(1)}% is ${biasInterp}. The Bland-Altman analysis confirms no clinically significant systematic difference between methods. Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `The method comparison for ${study.testName} did not meet the adopted acceptance criterion. The correlation of ${rVal.toFixed(3)} and a mean bias of ${meanBiasPct >= 0 ? "+" : ""}${meanBiasPct.toFixed(1)}% (adopted limit: \u00B1${cliaPct}%; §493 PT TEa for this analyte; adopted under 42 CFR §493.1253(b)(2)) indicate unacceptable agreement between methods. Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  } else if (isPrecision(results)) {
    const pr = results as PrecisionResults;
    const maxCV = Math.max(...pr.levelResults.map(r => (r as any).totalCV ?? r.cv ?? 0));
    const meetsAdlm = maxCV <= study.cliaAllowableError * 50;
    const isAdvanced = (pr as any).mode === "advanced";
    if (pr.overallPass) {
      narrative = `The precision study for ${study.testName} demonstrated a maximum observed CV of ${maxCV.toFixed(2)}%, which is within the adopted precision acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1253(b)(1)(i)). `;
      narrative += meetsAdlm
        ? `The result also meets the ADLM-recommended internal precision goal of ±${adlmPct}%, indicating performance well above the adopted acceptance criterion. `
        : `The ADLM recommends an internal precision goal of ±${adlmPct}% for enhanced quality assurance. `;
      if (isAdvanced && (pr.levelResults[0] as any)?.withinRunCV !== undefined) {
        const wrCV = ((pr.levelResults[0] as any).withinRunCV ?? 0).toFixed(2);
        const bdCV = ((pr.levelResults[0] as any).betweenDayCV ?? 0).toFixed(2);
        narrative += `ANOVA components show within-run CV of ${wrCV}% and between-day CV of ${bdCV}%, indicating a stable analytical system. `;
      }
      narrative += `Manufacturer precision claims are verified. This instrument is performing with acceptable reproducibility.`;
    } else {
      narrative = `The precision study for ${study.testName} did not meet the adopted acceptance criterion. The maximum observed CV of ${maxCV.toFixed(2)}% exceeds the adopted precision acceptance criterion of ±${cliaPct}% (§493 PT TEa for this analyte; adopted under 42 CFR §493.1253(b)(1)(i)). Review reagent lot, instrument maintenance, and QC trends for contributing factors. Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  }
  // Append dual-criterion methodology note when applicable
  const absFloor = (study as any).cliaAbsoluteFloor;
  if (absFloor != null && narrative) {
    narrative += " TEa pass/fail uses the 42 CFR S493 dual-criterion rule: pass when the absolute difference is within the greater of the percent or absolute term.";
  }
  return narrative;
}

function QCRangeReport({ study, results }: { study: Study; results: QCRangeResults }) {
  const analytes = Array.from(new Set(results.levelResults.map(r => r.analyte)));
  return (
    <div className="space-y-6">
      {analytes.map(analyte => {
        const rows = results.levelResults.filter(r => r.analyte === analyte);
        return (
          <Card key={analyte}>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{analyte} - QC Range Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Analyzer</th>
                      <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Level</th>
                      <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">N</th>
                      <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">New Mean</th>
                      <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">New SD</th>
                      <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">CV%</th>
                      <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Old Mean</th>
                      <th className="text-right py-2 text-xs text-muted-foreground font-medium">% Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className={`border-b border-border/50 ${r.flagShift ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                        <td className="py-1.5 pr-3">{r.analyzer}</td>
                        <td className="py-1.5 pr-3">{r.level}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{r.n}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{r.newMean.toFixed(2)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{r.newSD.toFixed(3)}</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{r.cv.toFixed(1)}%</td>
                        <td className="py-1.5 pr-3 text-right font-mono">{r.oldMean != null ? r.oldMean.toFixed(2) : "-"}</td>
                        <td className={`py-1.5 text-right font-mono ${r.flagShift ? "text-red-500 font-semibold" : ""}`}>
                          {r.pctDiffFromOld != null ? r.pctDiffFromOld.toFixed(1) + "%" : "-"}
                          {r.flagShift && " ⚠"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.some(r => r.n < 10) && <p className="text-xs text-amber-500 mt-2">Some levels have fewer than 10 runs.</p>}
            </CardContent>
          </Card>
        );
      })}
      <div className="rounded-md bg-muted/50 border p-3">
        <p className="text-xs text-muted-foreground italic">Per policy, SD should not change lot to lot. The historical/peer-derived SD should be used for control limits, not the SD calculated here unless it represents a significant change.</p>
      </div>
    </div>
  );
}

function MultiAnalyteCoagReport({ study, results }: { study: Study; results: MultiAnalyteResults }) {
  return (
    <div className="space-y-6">
      {/* Per-analyte summary */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Per-Analyte Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-xs text-muted-foreground font-medium">Analyte</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Mean New</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Mean Old</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">Mean %Diff</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">SD</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">R</th>
                  <th className="text-right py-2 pr-3 text-xs text-muted-foreground font-medium">TEa</th>
                  <th className="text-left py-2 text-xs text-muted-foreground font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.analyteResults.filter(r => r.n > 0).map(r => (
                  <tr key={r.analyte} className={`border-b border-border/50 ${!r.pass ? "bg-red-50 dark:bg-red-950/20" : ""}`}>
                    <td className="py-1.5 pr-3 font-medium">{r.analyte}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.n}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.meanNew.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.meanOld.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.meanPctDiff.toFixed(1)}%</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.sdPctDiff.toFixed(2)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{r.r.toFixed(4)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono">{(r.tea * 100).toFixed(0)}%</td>
                    <td className="py-1.5">
                      {r.pass
                        ? <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">PASS</Badge>
                        : <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-0">FAIL</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ISI validation */}
      {results.ptINRValidation && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">PT/INR - ISI Validation</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-muted-foreground">Mean New INR:</span> <span className="font-mono font-semibold">{results.ptINRValidation.meanNewINR.toFixed(2)}</span></div>
              <div><span className="text-muted-foreground">Mean Old INR:</span> <span className="font-mono font-semibold">{results.ptINRValidation.meanOldINR.toFixed(2)}</span></div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">{results.ptINRValidation.isiCheck}</p>
          </CardContent>
        </Card>
      )}

      {/* Full specimen table */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Specimen Data</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 pr-2 font-medium">ID</th>
                  <th className="text-right py-1.5 pr-2 font-medium">New PT</th>
                  <th className="text-right py-1.5 pr-2 font-medium">INR</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Old PT</th>
                  <th className="text-right py-1.5 pr-2 font-medium">PT %Diff</th>
                  <th className="text-right py-1.5 pr-2 font-medium">New APTT</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Old APTT</th>
                  <th className="text-right py-1.5 pr-2 font-medium">APTT %Diff</th>
                  <th className="text-right py-1.5 pr-2 font-medium">New Fib</th>
                  <th className="text-right py-1.5 pr-2 font-medium">Old Fib</th>
                  <th className="text-right py-1.5 font-medium">Fib %Diff</th>
                </tr>
              </thead>
              <tbody>
                {results.specimens.map((s, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1 pr-2 font-mono">{s.specimenId}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.ptNew != null ? s.ptNew.toFixed(1) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.ptNewINR != null ? s.ptNewINR.toFixed(2) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.ptOld != null ? s.ptOld.toFixed(1) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.ptPctDiff != null ? s.ptPctDiff.toFixed(1) + "%" : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.apttNew != null ? s.apttNew.toFixed(1) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.apttOld != null ? s.apttOld.toFixed(1) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.apttPctDiff != null ? s.apttPctDiff.toFixed(1) + "%" : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.fibNew != null ? s.fibNew.toFixed(1) : "-"}</td>
                    <td className="py-1 pr-2 text-right font-mono">{s.fibOld != null ? s.fibOld.toFixed(1) : "-"}</td>
                    <td className="py-1 text-right font-mono">{s.fibPctDiff != null ? s.fibPctDiff.toFixed(1) + "%" : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EvalBox({ results, study }: { results: StudyResults; study: Study }) {
  const narrative = generateNarrative(results, study);
  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Evaluation of Results</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed text-muted-foreground">{results.summary}</p>

        {/* Narrative summary */}
        {narrative && (
          <div className="mt-4 p-4 rounded-lg border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <BookOpen size={13} className="text-primary" />
              <span className="text-xs font-semibold text-primary uppercase tracking-wide">Study Narrative Summary</span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">{narrative}</p>
          </div>
        )}

        <div className={`mt-4 p-3 rounded-lg border ${results.overallPass ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20"}`}>
          <div className="flex items-center gap-2">
            {results.overallPass
              ? <CheckCircle2 size={16} className="text-green-400" />
              : <XCircle size={16} className="text-red-400" />}
            <span className={`text-sm font-semibold ${results.overallPass ? "text-green-400" : "text-red-400"}`}>
              Overall: {results.overallPass ? "PASS" : "FAIL"}{(results as any).passCount != null ? `, ${(results as any).passCount}/${(results as any).totalCount} ${isPrecision(results) ? "levels within allowable CV" : "results within TEa"}` : ""}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatTeaDisplay(study: Study): string {
  const isAbsolute = (study as any).teaIsPercentage === 0;
  const absFloor = (study as any).cliaAbsoluteFloor;
  const absUnit = (study as any).cliaAbsoluteUnit || '';
  if (isAbsolute) {
    return `\u00B1${study.cliaAllowableError} ${(study as any).teaUnit || ''}`;
  }
  const pctStr = `\u00B1${(study.cliaAllowableError * 100).toFixed(1)}%`;
  if (absFloor != null) {
    return `${pctStr} or \u00B1${absFloor} ${absUnit} (greater)`;
  }
  return pctStr;
}

function UserSpecs({ study, instrumentNames }: { study: Study; instrumentNames: string[] }) {
  const teaDisplay = formatTeaDisplay(study);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">User Specifications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-xs">
          {[
            ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : study.studyType === "precision" ? "Precision Verification (EP15)" : study.studyType === "lot_to_lot" ? "Lot-to-Lot Verification" : study.studyType === "pt_coag" ? "PT/Coag New Lot Validation" : study.studyType === "qc_range" ? "QC Range Establishment" : study.studyType === "multi_analyte_coag" ? "Multi-Analyte Lot Comparison (Coag)" : study.studyType === "ref_interval" ? "Reference Range Verification" : "Correlation / Method Comparison"],
            [study.studyType === "precision" ? "Adopted Precision Acceptance Criterion (CV%)" : "Adopted Acceptance Criterion (TEa)", teaDisplay],
            ["Analyst", study.analyst],
            ["Date", study.date],
            ["Instruments / Methods", instrumentNames.join(", ")],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1.5 border-b border-border/40">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── CALIBRATION VERIFICATION results ────────────────────────────────────────
function CalVerReport({ study, results }: { study: Study; results: CalVerResults }) {
  const { levelResults, regression } = results;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);
  const upperBound = 100 + parseFloat(cliaPercent);
  const lowerBound = 100 - parseFloat(cliaPercent);

  const scatterData = instrumentNames.map((name) => ({
    name,
    data: levelResults.filter((r) => r.instruments[name]).map((r) => ({ x: r.assignedValue, y: r.instruments[name].value })),
  }));

  const recoveryData = levelResults.map((r) => ({
    expected: r.assignedValue,
    recovery: parseFloat(r.pctRecovery.toFixed(2)),
    name: `L${r.level}`,
  }));

  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Data Levels", value: levelResults.length },
          { label: "Results Passing", value: `${results.passCount} / ${results.totalCount}` },
          { label: "CLIA TEa", value: formatTeaDisplay(study) },
          { label: "Max % Recovery", value: `${results.maxPctRecovery.toFixed(1)}%` },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-5 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Scatter Plot - Measured vs. Assigned</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="x" name="Assigned" type="number" label={{ value: "Assigned Value", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis dataKey="y" name="Measured" type="number" label={{ value: "Measured", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Legend />
                {levelResults.length > 0 && (
                  <ReferenceLine
                    segment={[
                      { x: levelResults[0].assignedValue, y: levelResults[0].assignedValue },
                      { x: levelResults[levelResults.length - 1].assignedValue, y: levelResults[levelResults.length - 1].assignedValue },
                    ]}
                    stroke="#666" strokeDasharray="4 2"
                    label={{ value: "1:1", fontSize: 9, fill: "#888" }}
                  />
                )}
                {scatterData.map(({ name, data }, idx) => (
                  <Scatter key={name} name={name} data={data} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Percent Recovery (±TEa bounds)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={recoveryData} margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="expected" label={{ value: "Assigned Value", position: "insideBottom", offset: -10, fontSize: 10 }} />
                <YAxis
                  domain={[Math.min(85, Math.floor(results.minPctRecovery - 2)), Math.max(115, Math.ceil(results.maxPctRecovery + 2))]}
                  label={{ value: "% Recovery", angle: -90, position: "insideLeft", fontSize: 10 }}
                />
                <Tooltip formatter={(v: number) => `${v.toFixed(2)}%`} />
                <ReferenceLine y={100} stroke="#888" strokeDasharray="4 2" label={{ value: "100%", fontSize: 9, fill: "#888" }} />
                <ReferenceLine y={upperBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `+${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <ReferenceLine y={lowerBound} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `-${cliaPercent}%`, fontSize: 9, fill: "#ef4444" }} />
                <Line type="monotone" dataKey="recovery" name="% Recovery" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ fill: CHART_COLORS[0], r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Data table */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Statistical Analysis - Level-by-Level Results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Assigned</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean Measured</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">% Recovery</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Obs Error</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                  {instrumentNames.map((n) => <th key={n} className="text-right py-2 pr-3 text-muted-foreground font-medium">{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {levelResults.map((r) => (
                  <tr key={r.level} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">L{r.level}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.assignedValue.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.mean.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.pctRecovery.toFixed(1)}%</td>
                    <td className="text-right py-2 pr-3 font-mono">{(r.obsError * 100).toFixed(2)}%</td>
                    <td className="text-right py-2 pr-3">
                      <span className={r.passFailMean === "Pass" ? "pass-badge" : "fail-badge"}>{r.passFailMean}</span>
                    </td>
                    {instrumentNames.map((n) => (
                      <td key={n} className="text-right py-2 pr-3 font-mono">
                        {r.instruments[n] ? r.instruments[n].value.toFixed(3) : "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Linearity / Regression */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Linearity Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Comparison</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Slope</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Intercept</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Prop. Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R²</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(regression).map(([name, reg]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.n}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.slope.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.intercept.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "text-green-400" : "text-red-400"}>
                        {(reg.proportionalBias * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{Math.sqrt(reg.r2).toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.r2.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── METHOD COMPARISON results ────────────────────────────────────────────────
// ─── QUALITATIVE CONCORDANCE results ─────────────────────────────────────────
function QualitativeReport({ study, results }: { study: Study; results: QualitativeResults }) {
  const { concordanceMatrix, categories, totalSamples, percentAgreement, sensitivity, specificity, cohensKappa, passThreshold } = results;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const primaryName = instrumentNames[0];
  const compName = instrumentNames[1] || "Comparison";
  const kappaInterp = cohensKappa < 0.20 ? "Poor" : cohensKappa <= 0.40 ? "Fair" : cohensKappa <= 0.60 ? "Moderate" : cohensKappa <= 0.80 ? "Substantial" : "Almost Perfect";

  return (
    <>
      <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
        <span className="font-medium">Reference Method:</span> {primaryName} | <span className="font-medium">Comparison Method:</span> {compName}
        <Badge variant="outline" className="ml-2 text-xs">Qualitative</Badge>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Samples", value: totalSamples },
          { label: "Agreement", value: `${percentAgreement.toFixed(1)}%` },
          { label: "Cohen's Kappa", value: `${cohensKappa.toFixed(3)} (${kappaInterp})` },
          { label: "Pass Threshold", value: `>=${(passThreshold * 100).toFixed(0)}%` },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Concordance Matrix */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Concordance Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">{primaryName} \\ {compName}</th>
                  {categories.map(c => <th key={c} className="text-center py-2 px-3 text-muted-foreground font-medium">{c}</th>)}
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(refCat => {
                  const rowTotal = categories.reduce((s, cc) => s + (concordanceMatrix[refCat]?.[cc] || 0), 0);
                  return (
                    <tr key={refCat} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-medium">{refCat}</td>
                      {categories.map(compCat => {
                        const count = concordanceMatrix[refCat]?.[compCat] || 0;
                        const isAgree = refCat === compCat;
                        return (
                          <td key={compCat} className={`text-center py-2 px-3 font-mono ${isAgree ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold" : count > 0 ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" : ""}`}>
                            {count}
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-3 font-mono text-muted-foreground">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sensitivity / Specificity (binary only) */}
      {categories.length === 2 && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Diagnostic Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">Sensitivity:</span> <span className="font-mono font-bold">{sensitivity.toFixed(1)}%</span></div>
              <div><span className="text-muted-foreground">Specificity:</span> <span className="font-mono font-bold">{specificity.toFixed(1)}%</span></div>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── SEMI-QUANTITATIVE CONCORDANCE results ──────────────────────────────────
function SemiQuantReport({ study, results }: { study: Study; results: SemiQuantResults }) {
  const { concordanceMatrix, gradeScale, totalSamples, percentExactAgreement, percentWithinOneGrade, weightedKappa, maxDiscrepancy, sampleDetails, passThreshold } = results;
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const primaryName = instrumentNames[0];
  const compName = instrumentNames[1] || "Comparison";
  const kappaInterp = weightedKappa < 0.20 ? "Poor" : weightedKappa <= 0.40 ? "Fair" : weightedKappa <= 0.60 ? "Moderate" : weightedKappa <= 0.80 ? "Substantial" : "Almost Perfect";

  // Build grade index for color coding
  const gradeIndex: Record<string, number> = {};
  gradeScale.forEach((g, i) => { gradeIndex[g] = i; });

  return (
    <>
      <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
        <span className="font-medium">Reference Method:</span> {primaryName} | <span className="font-medium">Comparison Method:</span> {compName}
        <Badge variant="outline" className="ml-2 text-xs">Semi-Quantitative</Badge>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Samples", value: totalSamples },
          { label: "Exact Agreement", value: `${percentExactAgreement.toFixed(1)}%` },
          { label: "Within +/-1 Grade", value: `${percentWithinOneGrade.toFixed(1)}%` },
          { label: "Weighted Kappa", value: `${weightedKappa.toFixed(3)} (${kappaInterp})` },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Concordance Matrix */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Concordance Matrix</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">{primaryName} \\ {compName}</th>
                  {gradeScale.map(g => <th key={g} className="text-center py-2 px-3 text-muted-foreground font-medium">{g}</th>)}
                  <th className="text-center py-2 px-3 text-muted-foreground font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {gradeScale.map((refGrade, ri) => {
                  const rowTotal = gradeScale.reduce((s, cg) => s + (concordanceMatrix[refGrade]?.[cg] || 0), 0);
                  return (
                    <tr key={refGrade} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-medium">{refGrade}</td>
                      {gradeScale.map((compGrade, ci) => {
                        const count = concordanceMatrix[refGrade]?.[compGrade] || 0;
                        const diff = Math.abs(ri - ci);
                        const bg = diff === 0 ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-bold"
                          : diff === 1 ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"
                          : count > 0 ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400" : "";
                        return (
                          <td key={compGrade} className={`text-center py-2 px-3 font-mono ${bg}`}>
                            {count}
                          </td>
                        );
                      })}
                      <td className="text-center py-2 px-3 font-mono text-muted-foreground">{rowTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 dark:bg-green-800 inline-block" /> Exact match</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 dark:bg-yellow-800 inline-block" /> +/-1 grade</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 dark:bg-red-800 inline-block" /> {">"}+/-1 grade</span>
          </div>
        </CardContent>
      </Card>

      {/* Sample-by-Sample Detail */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Sample-by-Sample Results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Sample</th>
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">{primaryName} (Reference)</th>
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">{compName}</th>
                  <th className="text-center py-2 pr-3 text-muted-foreground font-medium">Grade Diff</th>
                  <th className="text-center py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                </tr>
              </thead>
              <tbody>
                {sampleDetails.map((sd) => (
                  <tr key={sd.sample} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">S{sd.sample}</td>
                    <td className="py-2 pr-3">{sd.reference}</td>
                    <td className="py-2 pr-3">{sd.comparison}</td>
                    <td className={`text-center py-2 pr-3 font-mono ${sd.gradeDiff === 0 ? "text-green-600" : sd.gradeDiff === 1 ? "text-yellow-600" : "text-red-600"}`}>
                      {sd.gradeDiff}
                    </td>
                    <td className="text-center py-2 pr-3">
                      <span className={sd.pass ? "pass-badge" : "fail-badge"}>{sd.pass ? "Pass" : "Fail"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Additional stats */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Summary Statistics</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <div><span className="text-muted-foreground">Max Discrepancy:</span> <span className="font-mono font-bold">{maxDiscrepancy} grade{maxDiscrepancy !== 1 ? "s" : ""}</span></div>
            <div><span className="text-muted-foreground">Pass Threshold:</span> <span className="font-mono">{`≥${(passThreshold * 100).toFixed(0)}% within ±1`}</span></div>
            <div><span className="text-muted-foreground">Grade Scale:</span> <span className="font-mono">{gradeScale.join(" / ")}</span></div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── METHOD COMPARISON results ────────────────────────────────────────────────
function MethodCompReport({ study, results }: { study: Study; results: MethodCompResults }) {
  const { levelResults, regression, blandAltman } = results;
  const allInstrumentNames: string[] = JSON.parse(study.instruments);
  // Primary instrument is the first in the list; comparison instruments are the rest
  const primaryName = allInstrumentNames[0];
  // Comparison instrument names: either from levelResults keys, or allInstrumentNames[1:]
  const comparisonNames = Object.keys(levelResults[0]?.instruments || {}).length > 0
    ? Object.keys(levelResults[0].instruments)
    : allInstrumentNames.slice(1);
  const cliaPercent = (study.cliaAllowableError * 100).toFixed(1);

  // Check for legacy data format (old studies that used expectedValue as reference)
  const isLegacyFormat = levelResults.length > 0 && comparisonNames.length === 0 && allInstrumentNames.length >= 2;

  // For legacy studies, the instrumentNames in results are keyed by the test instrument names
  const effectiveCompNames = isLegacyFormat ? allInstrumentNames : comparisonNames;

  // Scatter: each comparison instrument vs primary
  const scatterData = effectiveCompNames.map((name) => ({
    name,
    data: levelResults.filter((r) => r.instruments[name]).map((r) => ({ x: r.referenceValue, y: r.instruments[name].value })),
  }));

  // Bland-Altman plot data: difference vs. average
  const baPlotData = effectiveCompNames.flatMap((name, idx) =>
    levelResults
      .filter((r) => r.instruments[name])
      .map((r) => ({
        avg: (r.referenceValue + r.instruments[name].value) / 2,
        diff: r.instruments[name].difference,
        pctDiff: r.instruments[name].pctDifference,
        instrument: name,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      }))
  );

  const xRange = (results as any).xRange as { min: number; max: number } | undefined;
  const yRange = (results as any).yRange as { [name: string]: { min: number; max: number } } | undefined;

  return (
    <>
      {/* Legacy data notice */}
      {isLegacyFormat && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-sm text-amber-700 dark:text-amber-400">
          This study was created with an earlier version of VeritaCheck™. Data has been migrated for display.
        </div>
      )}

      {/* Sub-header: Primary and Comparison methods */}
      <div className="mb-4 p-3 bg-muted/50 rounded-lg text-sm">
        <span className="font-medium">Primary Method:</span> {primaryName} | <span className="font-medium">Comparison Method{effectiveCompNames.length > 1 ? "s" : ""}:</span> {effectiveCompNames.join(", ")}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Patient Samples", value: levelResults.length },
          { label: "Results Passing", value: `${results.passCount} / ${results.totalCount}` },
          { label: "CLIA TEa", value: formatTeaDisplay(study) },
          { label: "Instruments", value: allInstrumentNames.length },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Result Ranges */}
      {xRange && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">{primaryName} (Primary) Range: </span>
                <span className="font-mono">{xRange.min.toFixed(3)} - {xRange.max.toFixed(3)}</span>
              </div>
              {effectiveCompNames.map((n) => yRange?.[n] && (
                <div key={n}>
                  <span className="text-muted-foreground">{n} Range: </span>
                  <span className="font-mono">{yRange[n].min.toFixed(3)} - {yRange[n].max.toFixed(3)}</span>
                </div>
              ))}
              <div>
                <span className="text-muted-foreground">Points (Plotted/Total): </span>
                <span className="font-mono">{levelResults.length}/{levelResults.length}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-comparison sections */}
      {effectiveCompNames.map((compName, compIdx) => (
        <div key={compName} className="mb-8">
          <h3 className="text-base font-bold mb-4 border-b pb-2">{compName} vs. {primaryName}</h3>

          {/* Charts */}
          <div className="grid sm:grid-cols-2 gap-5 mb-6">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Correlation - {compName} vs. {primaryName}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="x" name={primaryName} type="number" label={{ value: `${primaryName} (Primary)`, position: "insideBottom", offset: -10, fontSize: 10 }} />
                    <YAxis dataKey="y" name={compName} type="number" label={{ value: compName, angle: -90, position: "insideLeft", fontSize: 10 }} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    {levelResults.length > 0 && (
                      <ReferenceLine
                        segment={[
                          { x: levelResults[0].referenceValue, y: levelResults[0].referenceValue },
                          { x: levelResults[levelResults.length - 1].referenceValue, y: levelResults[levelResults.length - 1].referenceValue },
                        ]}
                        stroke="#666" strokeDasharray="4 2"
                        label={{ value: "1:1", fontSize: 9, fill: "#888" }}
                      />
                    )}
                    <Scatter
                      name={compName}
                      data={scatterData.find(s => s.name === compName)?.data || []}
                      fill={CHART_COLORS[compIdx % CHART_COLORS.length]}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Bland-Altman - {compName} vs. {primaryName}</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <ScatterChart margin={{ top: 10, right: 10, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="avg" name="Mean" type="number" label={{ value: "Mean of Methods", position: "insideBottom", offset: -10, fontSize: 10 }} />
                    <YAxis dataKey="pctDiff" name="% Diff" type="number" label={{ value: "% Difference", angle: -90, position: "insideLeft", fontSize: 10 }} />
                    <Tooltip formatter={(v: number, name: string) => name === "% Diff" ? `${v.toFixed(2)}%` : v} cursor={{ strokeDasharray: "3 3" }} />
                    <ReferenceLine y={0} stroke="#888" strokeDasharray="4 2" />
                    <ReferenceLine y={parseFloat(cliaPercent)} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `+${cliaPercent}%`, fontSize: 8, fill: "#ef4444" }} />
                    <ReferenceLine y={-parseFloat(cliaPercent)} stroke="#ef4444" strokeDasharray="4 2" label={{ value: `-${cliaPercent}%`, fontSize: 8, fill: "#ef4444" }} />
                    <Scatter
                      name={compName}
                      data={baPlotData.filter((d) => d.instrument === compName)}
                      fill={CHART_COLORS[compIdx % CHART_COLORS.length]}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}

      {/* Data table - sample-by-sample comparison results */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Sample-by-Sample Comparison Results</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Sample</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">{primaryName} (Primary)</th>
                  {effectiveCompNames.map((n) => (
                    <th key={n} colSpan={4} className="text-center py-2 pr-3 text-muted-foreground font-medium border-l border-border/40">{n}</th>
                  ))}
                </tr>
                <tr className="border-b border-border/60 bg-muted/20">
                  <th className="py-1 pr-3" />
                  <th className="py-1 pr-3" />
                  {effectiveCompNames.map((n) => (
                    <React.Fragment key={`sub-${n}`}>
                      <th className="text-right py-1 pr-3 text-muted-foreground font-normal border-l border-border/40">Value</th>
                      <th className="text-right py-1 pr-3 text-muted-foreground font-normal">Bias</th>
                      <th className="text-right py-1 pr-3 text-muted-foreground font-normal">% Diff</th>
                      <th className="text-right py-1 pr-3 text-muted-foreground font-normal">Pass?</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {levelResults.map((r) => (
                  <tr key={r.level} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">S{r.level}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.referenceValue.toFixed(3)}</td>
                    {effectiveCompNames.map((n) => (
                      <React.Fragment key={`${r.level}-${n}`}>
                        <td className="text-right py-2 pr-3 font-mono border-l border-border/20">
                          {r.instruments[n] ? r.instruments[n].value.toFixed(3) : "---"}
                        </td>
                        <td className="text-right py-2 pr-3 font-mono">
                          {r.instruments[n] ? r.instruments[n].difference.toFixed(3) : "---"}
                        </td>
                        <td className="text-right py-2 pr-3 font-mono">
                          {r.instruments[n]
                            ? <span className={Math.abs(r.instruments[n].pctDifference) < study.cliaAllowableError * 100 ? "text-green-400" : "text-red-400"}>
                                {r.instruments[n].pctDifference.toFixed(2)}%
                              </span>
                            : "---"}
                        </td>
                        <td className="text-right py-2 pr-3">
                          {r.instruments[n]
                            ? <span className={r.instruments[n].passFail === "Pass" ? "pass-badge" : "fail-badge"}>{r.instruments[n].passFail}</span>
                            : "---"}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Regression summary — Deming + OLS with CI */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Regression Analysis</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Comparison</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Slope (95% CI)</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Intercept (95% CI)</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">SEE</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Prop. Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">R²</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(regression).map(([name, reg]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.n}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      {reg.slopeLo !== undefined
                        ? <>{reg.slope.toFixed(4)}<br/><span className="text-muted-foreground">({reg.slopeLo.toFixed(3)} – {reg.slopeHi!.toFixed(3)})</span></>
                        : reg.slope.toFixed(4)}
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">
                      {reg.interceptLo !== undefined
                        ? <>{reg.intercept.toFixed(4)}<br/><span className="text-muted-foreground">({reg.interceptLo.toFixed(3)} – {reg.interceptHi!.toFixed(3)})</span></>
                        : reg.intercept.toFixed(4)}
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.see.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "text-green-400" : "text-red-400"}>
                        {(reg.proportionalBias * 100).toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{Math.sqrt(reg.r2).toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{reg.r2.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2">95% Confidence Intervals shown in parentheses (OLS only). VeritaCheck™ uses OLS regression for calibration verification (where calibrator assigned values are treated as exact) and Deming regression for method comparison (where both methods carry measurement error). Other evaluation tools and software may use different regression methods by default. Minor slope differences between tools are expected and do not affect pass/fail evaluation against the adopted acceptance criterion (TEa).</p>
          </div>
        </CardContent>
      </Card>

      {/* Bland-Altman summary table */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Bland-Altman Bias Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Instrument</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean % Bias</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">SD of Diff</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">95% LoA Lower</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">95% LoA Upper</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(blandAltman).map(([name, ba]) => (
                  <tr key={name} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{name}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.meanDiff.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">
                      <span className={Math.abs(ba.pctMeanDiff) < study.cliaAllowableError * 100 ? "text-green-400" : "text-red-400"}>
                        {ba.pctMeanDiff.toFixed(2)}%
                      </span>
                    </td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.sdDiff.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.loa_lower.toFixed(4)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{ba.loa_upper.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── PRECISION VERIFICATION results ──────────────────────────────────────────
function PrecisionReport({ study, results }: { study: Study; results: PrecisionResults }) {
  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: "Control Levels", value: results.levelResults.length },
          { label: "Levels Passing", value: results.passCount, className: "text-green-400" },
          { label: "Allowable CV", value: `±${(study.cliaAllowableError * 100).toFixed(1)}%` },
        ].map(({ label, value, className }) => (
          <Card key={label}><CardContent className="p-4 text-center">
            <div className={`text-2xl font-bold ${className || ""}`}>{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Precision Summary Table */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Precision Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Level</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">N</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Mean</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">SD</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">CV%</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Allow CV%</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                </tr>
              </thead>
              <tbody>
                {results.levelResults.map((r, i) => (
                  <tr key={i} className={`border-b border-border/40 ${i % 2 === 0 ? "bg-muted/20" : ""}`}>
                    <td className="py-2 pr-3">{r.levelName}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.n}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.mean.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.sd.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.cv.toFixed(2)}%</td>
                    <td className="text-right py-2 pr-3 font-mono">±{r.allowableCV.toFixed(1)}%</td>
                    <td className="text-right py-2 pr-3">
                      <span className={r.passFail === "Pass" ? "pass-badge" : "fail-badge"}>{r.passFail}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Advanced mode ANOVA breakdown */}
      {results.mode === "advanced" && results.levelResults.some(r => r.withinRunCV !== undefined) && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm">ANOVA Precision Components</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Level</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Within-Run CV%</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Between-Run CV%</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Between-Day CV%</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Total CV%</th>
                  </tr>
                </thead>
                <tbody>
                  {results.levelResults.map((r, i) => (
                    <tr key={i} className={`border-b border-border/40 ${i % 2 === 0 ? "bg-muted/20" : ""}`}>
                      <td className="py-2 pr-3">{r.levelName}</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.withinRunCV?.toFixed(2) ?? "-"}%</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.betweenRunCV?.toFixed(2) ?? "-"}%</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.betweenDayCV?.toFixed(2) ?? "-"}%</td>
                      <td className="text-right py-2 pr-3 font-mono font-semibold">{r.totalCV?.toFixed(2) ?? "-"}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Individual Measurements */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Individual Measurements</CardTitle></CardHeader>
        <CardContent>
          {results.levelResults.map((r, li) => {
            const rawDP = JSON.parse(study.dataPoints || "[]");
            const dp = rawDP[li];
            const vals: number[] = dp?.values || [];
            const filtered = vals.filter((v: number) => !isNaN(v));
            if (!filtered.length) return null;
            return (
              <div key={li} className="mb-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{r.levelName}</div>
                <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                  {filtered.map((v: number, i: number) => (
                    <div key={i} className="text-center text-xs bg-muted/30 rounded px-1 py-1 font-mono">{v}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </>
  );
}

// ─── LOT-TO-LOT VERIFICATION results ────────────────────────────────────────
function LotToLotReport({ study, results }: { study: Study; results: LotToLotResults }) {
  const teaPct = (results.tea * 100).toFixed(1);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Specimens", value: results.totalCount },
          { label: "Specimens Passing", value: `${results.passCount} / ${results.totalCount}` },
          { label: "TEa", value: `±${teaPct}%` },
          { label: "Cohorts", value: results.cohorts.length },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {results.cohorts.map(cohort => (
        <div key={cohort.cohort}>
          <Card className="mb-6">
            <CardHeader className="pb-2"><CardTitle className="text-sm">{cohort.cohort} Cohort - Summary</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-4">
                <div><span className="text-muted-foreground">N: </span><span className="font-mono">{cohort.n}</span></div>
                <div><span className="text-muted-foreground">Mean Bias: </span><span className="font-mono">{cohort.meanPctDiff.toFixed(2)}%</span></div>
                <div><span className="text-muted-foreground">SD: </span><span className="font-mono">{cohort.sdPctDiff.toFixed(2)}%</span></div>
                <div><span className="text-muted-foreground">Mean |%Diff|: </span><span className="font-mono">{cohort.meanAbsPctDiff.toFixed(2)}%</span></div>
                <div><span className="text-muted-foreground">Max |%Diff|: </span><span className="font-mono">{cohort.maxAbsPctDiff.toFixed(2)}%</span></div>
                <div><span className="text-muted-foreground">Coverage: </span><span className={`font-mono font-semibold ${cohort.coverage >= 90 ? "text-green-400" : "text-red-400"}`}>{cohort.coverage.toFixed(0)}%</span></div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Specimen</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Current Lot</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">New Lot</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">% Diff</th>
                    <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                  </tr></thead>
                  <tbody>
                    {cohort.specimens.map((s, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="py-2 pr-3 font-mono">{s.specimenId}</td>
                        <td className="text-right py-2 pr-3 font-mono">{s.currentLot.toFixed(3)}</td>
                        <td className="text-right py-2 pr-3 font-mono">{s.newLot.toFixed(3)}</td>
                        <td className="text-right py-2 pr-3 font-mono">{s.pctDifference.toFixed(2)}%</td>
                        <td className="text-right py-2 pr-3"><span className={s.passFail === "Pass" ? "pass-badge" : "fail-badge"}>{s.passFail}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </>
  );
}


// --- REFERENCE INTERVAL VERIFICATION results ---
function RefIntervalReport({ study, results }: { study: Study; results: RefIntervalResults }) {
  const { refLow, refHigh, n, outsideCount, outsidePct, overallPass, specimens, analyte, units } = results;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Specimens", value: n },
          { label: "Outside Reference Range", value: `${outsideCount} / ${n}` },
          { label: "% Outside", value: `${outsidePct.toFixed(1)}%` },
          { label: "EP28-A3c Limit", value: "10%" },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {analyte || study.testName} Reference Range: {refLow} - {refHigh} {units}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Specimen</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Value</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Units</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Status</th>
              </tr></thead>
              <tbody>
                {(specimens || []).map((s: any, i: number) => {
                  const inRange = s.value >= refLow && s.value <= refHigh;
                  return (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-mono">{s.specimenId}</td>
                      <td className="text-right py-2 pr-3 font-mono">{s.value}</td>
                      <td className="text-right py-2 pr-3 font-mono">{units}</td>
                      <td className="text-right py-2 pr-3">
                        <span className={inRange ? "pass-badge" : "fail-badge"}>{inRange ? "In range" : "Outside"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── PT/COAG NEW LOT VALIDATION results ─────────────────────────────────────
function PTCoagReport({ study, results }: { study: Study; results: PTCoagResults }) {
  const { module1, module2, module3 } = results;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Geometric Mean PT", value: `${module1.geoMeanPT.toFixed(1)} sec` },
          { label: "Geometric Mean INR", value: module1.geoMeanINR.toFixed(2) },
          { label: "Module 2 Coverage", value: `${module2.coverage.toFixed(0)}%` },
          { label: "Overall", value: results.overallPass ? "PASS" : "FAIL" },
        ].map(({ label, value }) => (
          <Card key={label}><CardContent className="p-4">
            <div className="text-lg font-bold">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* Module 1 */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Module 1: Normal Patient Mean & RI Verification</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-muted-foreground">N: </span><span className="font-mono">{module1.n}</span></div>
            <div><span className="text-muted-foreground">Geo Mean PT: </span><span className="font-mono">{module1.geoMeanPT.toFixed(2)} sec</span></div>
            <div><span className="text-muted-foreground">Geo Mean INR: </span><span className="font-mono">{module1.geoMeanINR.toFixed(3)}</span></div>
            <div><span className="text-muted-foreground">PT RI: </span><span className="font-mono">{module1.ptRI.low}–{module1.ptRI.high} sec</span></div>
            <div><span className="text-muted-foreground">INR RI: </span><span className="font-mono">{module1.inrRI.low}–{module1.inrRI.high}</span></div>
            <div><span className="text-muted-foreground">PT Outside RI: </span><span className={`font-mono font-semibold ${module1.ptRIPass ? "text-green-400" : "text-red-400"}`}>{module1.ptOutsideRI}/{module1.n}</span></div>
            <div><span className="text-muted-foreground">INR Outside RI: </span><span className={`font-mono font-semibold ${module1.inrRIPass ? "text-green-400" : "text-red-400"}`}>{module1.inrOutsideRI}/{module1.n}</span></div>
            <div><span className="text-muted-foreground">Module 1: </span><span className={`font-semibold ${module1.pass ? "text-green-400" : "text-red-400"}`}>{module1.pass ? "PASS" : "FAIL"}</span></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Specimen</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">PT (sec)</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">INR</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">PT in RI?</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">INR in RI?</th>
              </tr></thead>
              <tbody>
                {module1.specimens.map((s, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">{s.id}</td>
                    <td className="text-right py-2 pr-3 font-mono">{s.pt.toFixed(1)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{s.inr.toFixed(2)}</td>
                    <td className="text-right py-2 pr-3"><span className={s.ptInRI ? "text-green-400" : "text-red-400"}>{s.ptInRI ? "Yes" : "No"}</span></td>
                    <td className="text-right py-2 pr-3"><span className={s.inrInRI ? "text-green-400" : "text-red-400"}>{s.inrInRI ? "Yes" : "No"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Module 2 */}
      <Card className="mb-6">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Module 2: Two-Instrument Comparison (Deming Regression)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div><span className="text-muted-foreground">R: </span><span className="font-mono">{module2.regression.r.toFixed(4)}</span></div>
            <div><span className="text-muted-foreground">Slope: </span><span className="font-mono">{module2.regression.slope.toFixed(3)}</span></div>
            <div><span className="text-muted-foreground">Intercept: </span><span className="font-mono">{module2.regression.intercept.toFixed(3)}</span></div>
            <div><span className="text-muted-foreground">N: </span><span className="font-mono">{module2.regression.n}</span></div>
            <div><span className="text-muted-foreground">Avg Error Index: </span><span className="font-mono">{module2.averageErrorIndex.toFixed(3)}</span></div>
            <div><span className="text-muted-foreground">Coverage: </span><span className={`font-mono font-semibold ${module2.pass ? "text-green-400" : "text-red-400"}`}>{module2.coverage.toFixed(0)}%</span></div>
            <div><span className="text-muted-foreground">TEa: </span><span className="font-mono">±{(module2.tea * 100).toFixed(0)}%</span></div>
            <div><span className="text-muted-foreground">Module 2: </span><span className={`font-semibold ${module2.pass ? "text-green-400" : "text-red-400"}`}>{module2.pass ? "PASS" : "FAIL"}</span></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Specimen</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">X (Inst 1)</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Y (Inst 2)</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Error Index</th>
                <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
              </tr></thead>
              <tbody>
                {module2.errorIndexResults.map((r, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-mono">{r.specimenId}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.x.toFixed(1)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.y.toFixed(1)}</td>
                    <td className="text-right py-2 pr-3 font-mono">{r.errorIndex.toFixed(3)}</td>
                    <td className="text-right py-2 pr-3"><span className={r.pass ? "text-green-400" : "text-red-400"}>{r.pass ? "Pass" : "Fail"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Module 3 */}
      {module3 && (
        <Card className="mb-6">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Module 3: Old Lot vs New Lot (Deming Regression)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div><span className="text-muted-foreground">R: </span><span className="font-mono">{module3.regression.r.toFixed(4)}</span></div>
              <div><span className="text-muted-foreground">Slope: </span><span className="font-mono">{module3.regression.slope.toFixed(3)}</span></div>
              <div><span className="text-muted-foreground">Intercept: </span><span className="font-mono">{module3.regression.intercept.toFixed(3)}</span></div>
              <div><span className="text-muted-foreground">Coverage: </span><span className={`font-mono font-semibold ${module3.pass ? "text-green-400" : "text-red-400"}`}>{module3.coverage.toFixed(0)}%</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 text-muted-foreground font-medium">Specimen</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Old Lot</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">New Lot</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Error Index</th>
                  <th className="text-right py-2 pr-3 text-muted-foreground font-medium">Pass?</th>
                </tr></thead>
                <tbody>
                  {module3.errorIndexResults.map((r, i) => (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-mono">{r.specimenId}</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.x.toFixed(1)}</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.y.toFixed(1)}</td>
                      <td className="text-right py-2 pr-3 font-mono">{r.errorIndex.toFixed(3)}</td>
                      <td className="text-right py-2 pr-3"><span className={r.pass ? "text-green-400" : "text-red-400"}>{r.pass ? "Pass" : "Fail"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── Root page ────────────────────────────────────────────────────────────────
function BottomPDFButton({ study, results }: { study: Study; results: StudyResults }) {
  const [pdfLoading, setPdfLoading] = useState(false);
  const handlePDF = useCallback(async () => {
    setPdfLoading(true);
    try { await downloadPDF(study, results); }
    catch (e) { alert("PDF generation failed. Please try again."); }
    finally { setPdfLoading(false); }
  }, [study, results]);
  return (
    <Button onClick={handlePDF} disabled={pdfLoading} className="bg-primary hover:bg-primary/90 text-primary-foreground">
      {pdfLoading ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <FileDown size={14} className="mr-1.5" />}
      {pdfLoading ? "Generating…" : "Download PDF Report"}
    </Button>
  );
}

export default function StudyResults() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id || "0");
  const { isLoggedIn } = useAuth();
  const [, navigate] = useLocation();
  const search = useSearch();

  // Auto-link this study back to a verification package if launched from there
  useEffect(() => {
    const p = new URLSearchParams(search);
    const verificationId = p.get("verificationId");
    const slotId = p.get("slotId");
    const passed = p.get("studyPassed");
    if (verificationId && slotId && id) {
      fetch(`${import.meta.env.VITE_API_BASE || "https://www.veritaslabservices.com"}/api/veritacheck/verifications/${verificationId}/studies/${slotId}`, {
        method: "PATCH",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: id, passed: passed === "1" ? 1 : 0 }),
      });
    }
  }, [id, search]);

  // Scroll to top whenever study ID changes
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); }, [id]);

  const { data: study, isLoading, error } = useQuery<Study>({
    queryKey: ["/api/studies", id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/studies/${id}`);
      if (res.status === 403) {
        const data = await res.json();
        throw new Error(data.error || "Access denied");
      }
      if (res.status === 404) throw new Error("Study not found");
      return res.json();
    },
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
      </div>
    );
  }

  // Handle 403 / access denied
  if (error) {
    const msg = (error as Error).message;
    const isAuthError = msg.includes("authentication") || msg.includes("Access denied") || msg.includes("expired");
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
        <div className="text-4xl mb-4">{isAuthError ? "🔒" : "🔍"}</div>
        <h2 className="text-xl font-bold mb-2">{isAuthError ? "Sign in required" : "Study not found"}</h2>
        <p className="text-muted-foreground mb-6">
          {isAuthError
            ? "This study belongs to a registered account. Please sign in to view it."
            : "This study doesn't exist or may have been deleted."}
        </p>
        <div className="flex gap-3 justify-center">
          {isAuthError && (
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground" onClick={() => navigate("/login")}>
              Sign In
            </Button>
          )}
          <Button variant="outline" asChild><Link href="/dashboard">My Studies</Link></Button>
        </div>
      </div>
    );
  }

  if (!study) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 text-center">
        <p className="text-muted-foreground">Study not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  // PT/Coag is now unlocked — Coming Soon gate removed (was previously behind
  // `if (false && ...)` after launch and has been verified live).

  const instrumentNames: string[] = JSON.parse(study.instruments);
  const rawDataPoints = JSON.parse(study.dataPoints);
  let results: StudyResults;
  if (study.studyType === "precision") {
    results = calculatePrecision(rawDataPoints as PrecisionDataPoint[], study.cliaAllowableError, (rawDataPoints[0]?.days ? "advanced" : "simple"));
  } else if (study.studyType === "lot_to_lot") {
    const { data, sampleType } = rawDataPoints;
    results = calculateLotToLot(data, study.cliaAllowableError, sampleType);
  } else if (study.studyType === "pt_coag") {
    const { module1, module2, module3: m3Raw } = rawDataPoints;
    const m2Valid = module2.data.filter((d: any) => d.x !== null && d.y !== null);
    const module3Data = m3Raw ? (() => {
      const m3Valid = m3Raw.data.filter((d: any) => d.x !== null && d.y !== null);
      return m3Valid.length >= 3 ? { xValues: m3Valid.map((d: any) => d.x), yValues: m3Valid.map((d: any) => d.y), specimenIds: m3Valid.map((d: any) => d.id), tea: m3Raw.tea } : null;
    })() : null;
    results = calculatePTCoag(
      module1,
      { xValues: m2Valid.map((d: any) => d.x), yValues: m2Valid.map((d: any) => d.y), specimenIds: m2Valid.map((d: any) => d.id), tea: module2.tea },
      module3Data
    );
  } else if (study.studyType === "qc_range") {
    const { dataPoints: dp, dateRange } = rawDataPoints;
    results = calculateQCRange(dp as QCRangeDataPoint[], dateRange);
  } else if (study.studyType === "multi_analyte_coag") {
    const { specimens, isi, normalMeanPT, teas } = rawDataPoints;
    results = calculateMultiAnalyteCoag(specimens, isi, normalMeanPT, teas);
  } else if (study.studyType === "ref_interval") {
    const { specimens, refLow, refHigh, analyte, units } = rawDataPoints;
    results = calculateRefInterval(specimens, refLow, refHigh, analyte || study.testName, units || "");
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
        const mappedPoints: DataPoint[] = dp.map(d => ({
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
  } else {
    const isPercentage = (study as any).teaIsPercentage !== 0;
    const absFloor = (study as any).cliaAbsoluteFloor ?? null;
    results = calculateStudy(rawDataPoints as DataPoint[], instrumentNames, study.cliaAllowableError, study.studyType as "cal_ver" | "method_comparison", isPercentage, absFloor);
  }

  const verifReturnId = new URLSearchParams(search).get("verificationId");

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {verifReturnId && (
        <div className="mb-4 flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
          <span className="text-sm text-primary font-medium">Study linked to your Instrument Verification Package</span>
          <button
            onClick={() => navigate("/dashboard/verifications")}
            className="text-sm text-primary underline font-semibold"
          >
            Back to Verification Package
          </button>
        </div>
      )}
      <StudyHeader study={study} results={results} />

      {isCalVer(results) && <CalVerReport study={study} results={results} />}
      {isMethodComp(results) && <MethodCompReport study={study} results={results} />}
      {isQualitative(results) && <QualitativeReport study={study} results={results} />}
      {isSemiQuant(results) && <SemiQuantReport study={study} results={results} />}
      {isPrecision(results) && <PrecisionReport study={study} results={results} />}
      {isLotToLot(results) && <LotToLotReport study={study} results={results} />}
      {isPTCoag(results) && <PTCoagReport study={study} results={results} />}
      {isQCRange(results) && <QCRangeReport study={study} results={results} />}
      {isMultiAnalyteCoag(results) && <MultiAnalyteCoagReport study={study} results={results} />}
      {isRefInterval(results) && <RefIntervalReport study={study} results={results} />}

      {/* Related Tools for PT/Coag studies */}
      {(study.studyType === "pt_coag" || study.studyType === "multi_analyte_coag" || study.studyType === "qc_range") && (
        <Card className="mt-6">
          <CardHeader className="pb-3"><CardTitle className="text-base">Related Tools</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline" size="sm"><Link href="/veritacheck/cumsum">Run CUMSUM Tracker →</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/veritacheck">Establish QC Ranges →</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/veritacheck">Run Multi-Analyte Comparison →</Link></Button>
          </CardContent>
        </Card>
      )}

      <EvalBox results={results} study={study} />
      <UserSpecs study={study} instrumentNames={instrumentNames} />

      <div className="mt-6 flex gap-3 justify-end">
        <Button asChild variant="outline">
          <Link href="/study/new">Run Another Study</Link>
        </Button>
        <BottomPDFButton study={study} results={results} />
      </div>
    </div>
  );
}
