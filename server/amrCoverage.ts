// server/amrCoverage.ts
//
// 2026-06-09 (Michael L feedback). Edge-coverage math for studies that
// claim a numeric AMR (Analytical Measurement Range). Given the lab's
// claimed AMR low/high and the tested data points, compute how close
// the lowest and highest tested values come to each end and produce a
// verdict (full / near-edge / under-tested).
//
// Thresholds (per EP06 commentary, not regulation):
//   each end >= 95% of AMR span covered  -> "full"
//   each end 90-94% covered              -> "near_edge"
//   any end < 90% covered                -> "under_tested"
//   any tested point outside [low, high] -> "outside_amr" (own state)
//
// Used by:
//   server/veritacheck_verification.ts (Linearity / cal_ver primary
//     surface; Method Comparison + Reference Interval get a short
//     "tested range vs AMR" line).
//
// Blank AMR fields turn the analysis off; callers must check
// shouldRender(study) before calling computeAmrCoverage and skip
// rendering when false.

export type AmrVerdict = "full" | "near_edge" | "under_tested" | "outside_amr";

export interface AmrCoverageInput {
  amrLow: number;
  amrHigh: number;
  amrUnits?: string | null;
  values: number[]; // numeric values to evaluate (test axis)
}

export interface AmrCoverageResult {
  amrLow: number;
  amrHigh: number;
  amrSpan: number;
  amrUnits: string;
  lowestTested: number | null;
  highestTested: number | null;
  // Distance from the closest tested point to each AMR edge, in study
  // units. Positive = inside AMR (gap to edge); negative = beyond AMR.
  lowEdgeDistance: number | null;
  highEdgeDistance: number | null;
  // What % of the AMR span is covered on each end (1 = full).
  // Defined as 1 - (edgeDistance / amrSpan), clamped to [0, 1] for
  // points inside the AMR. For points outside the AMR, the % stays at
  // 1 (since they cover the edge) but the verdict flips to outside_amr.
  lowCoveragePct: number;
  highCoveragePct: number;
  verdict: AmrVerdict;
  // Plain-language summary for the renderer. Always one sentence,
  // surveyor-defensible.
  summary: string;
}

export function shouldRender(study: {
  amr_low?: number | null;
  amr_high?: number | null;
}): boolean {
  const lo = study.amr_low;
  const hi = study.amr_high;
  if (lo == null || hi == null) return false;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (hi <= lo) return false;
  return true;
}

export function computeAmrCoverage(input: AmrCoverageInput): AmrCoverageResult | null {
  const { amrLow, amrHigh, amrUnits = "", values } = input;
  if (!Number.isFinite(amrLow) || !Number.isFinite(amrHigh) || amrHigh <= amrLow) {
    return null;
  }
  const numericValues = values.filter((v) => Number.isFinite(v));
  const amrSpan = amrHigh - amrLow;
  if (numericValues.length === 0) {
    return {
      amrLow, amrHigh, amrSpan, amrUnits: amrUnits || "",
      lowestTested: null, highestTested: null,
      lowEdgeDistance: null, highEdgeDistance: null,
      lowCoveragePct: 0, highCoveragePct: 0,
      verdict: "under_tested",
      summary: `AMR claimed ${amrLow} to ${amrHigh}${amrUnits ? " " + amrUnits : ""}; no numeric data points to evaluate coverage.`,
    };
  }
  const lowestTested = Math.min(...numericValues);
  const highestTested = Math.max(...numericValues);

  // edgeDistance positive when inside AMR (gap to edge); negative when
  // the tested point is past the edge.
  const lowEdgeDistance = lowestTested - amrLow;
  const highEdgeDistance = amrHigh - highestTested;

  // Coverage % at each end. A tested point AT the edge = 1.0 (100%
  // covered). A tested point 5% of AMR span inside = 0.95. A tested
  // point outside = capped at 1 (still covers the edge) but verdict
  // flips.
  const lowCoveragePct = lowEdgeDistance <= 0 ? 1 : Math.max(0, 1 - lowEdgeDistance / amrSpan);
  const highCoveragePct = highEdgeDistance <= 0 ? 1 : Math.max(0, 1 - highEdgeDistance / amrSpan);

  // Verdict
  const minCoverage = Math.min(lowCoveragePct, highCoveragePct);
  let verdict: AmrVerdict;
  if (lowEdgeDistance < 0 || highEdgeDistance < 0) {
    verdict = "outside_amr";
  } else if (minCoverage >= 0.95) {
    verdict = "full";
  } else if (minCoverage >= 0.90) {
    verdict = "near_edge";
  } else {
    verdict = "under_tested";
  }

  // Summary
  const u = amrUnits ? " " + amrUnits : "";
  const pctLo = (lowCoveragePct * 100).toFixed(1);
  const pctHi = (highCoveragePct * 100).toFixed(1);
  let summary: string;
  switch (verdict) {
    case "full":
      summary = `Tested range (${lowestTested} to ${highestTested}${u}) covers >=95% of the claimed AMR ${amrLow} to ${amrHigh}${u} on both ends; AMR fully exercised.`;
      break;
    case "near_edge":
      summary = `Tested range (${lowestTested} to ${highestTested}${u}) covers ${pctLo}% of the AMR low end and ${pctHi}% of the AMR high end; near-edge regions ${lowCoveragePct < 0.95 ? "below " + lowestTested : ""}${lowCoveragePct < 0.95 && highCoveragePct < 0.95 ? " and " : ""}${highCoveragePct < 0.95 ? "above " + highestTested : ""} are extrapolated from neighboring data.`;
      break;
    case "under_tested":
      summary = `Tested range (${lowestTested} to ${highestTested}${u}) covers ${pctLo}% of the AMR low end and ${pctHi}% of the AMR high end; >5% of the claimed AMR is unverified on at least one end.`;
      break;
    case "outside_amr":
      summary = `Tested data extends beyond the claimed AMR ${amrLow} to ${amrHigh}${u} (lowest ${lowestTested}, highest ${highestTested}${u}); consider widening the AMR claim or excluding out-of-range points.`;
      break;
  }
  return {
    amrLow, amrHigh, amrSpan, amrUnits: amrUnits || "",
    lowestTested, highestTested,
    lowEdgeDistance, highEdgeDistance,
    lowCoveragePct, highCoveragePct,
    verdict, summary,
  };
}

// Convenience: pull the right axis out of a data_points blob by study
// type. Skips points flagged excluded:true (Michael L per-point
// exclusion from PR #693/#694).
export function extractValuesForCoverage(
  studyType: string,
  dataPoints: any,
  comparisonInstrumentName?: string,
): number[] {
  if (studyType === "precision") {
    if (!Array.isArray(dataPoints)) return [];
    const out: number[] = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const vals: any[] = p.days ? p.days.flat() : p.values || [];
      for (const v of vals) {
        if (typeof v === "number" && Number.isFinite(v)) out.push(v);
      }
    }
    return out;
  }
  if (studyType === "cal_ver" || studyType === "reportable_range") {
    // Use the MEAN of measured values per level as the tested point
    // for that level. expectedValue (the assigned value) is the
    // reference axis; the AMR is claimed on the measured axis.
    if (!Array.isArray(dataPoints)) return [];
    const out: number[] = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const vals = Object.values(p.instrumentValues || {})
        .filter((v: any) => typeof v === "number" && Number.isFinite(v)) as number[];
      if (vals.length === 0) {
        // Fall back to expectedValue if no measured values present.
        if (typeof p.expectedValue === "number" && Number.isFinite(p.expectedValue)) {
          out.push(p.expectedValue);
        }
        continue;
      }
      out.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    return out;
  }
  if (studyType === "method_comparison" || studyType === "correlation") {
    // Comparison axis = the "new" or "test" instrument. Use whichever
    // axis the renderer uses for coverage. Per the existing renderer
    // (server/veritacheck_verification.ts line 170), the comparison
    // axis is instNames.slice(1)[0] or instNames[0] fallback. We
    // accept the resolved name from the caller.
    if (!Array.isArray(dataPoints)) return [];
    const out: number[] = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const v = comparisonInstrumentName
        ? p.instrumentValues?.[comparisonInstrumentName]
        : Object.values(p.instrumentValues || {})[0];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
    return out;
  }
  if (studyType === "ref_interval") {
    const specimens = Array.isArray(dataPoints?.specimens) ? dataPoints.specimens : [];
    return specimens
      .filter((s: any) => s && s.excluded !== true)
      .map((s: any) => s.value)
      .filter((v: any) => typeof v === "number" && Number.isFinite(v));
  }
  if (studyType === "carryover") {
    // For carryover the AMR is conceptually relevant but the
    // study isn't about range coverage; skip.
    return [];
  }
  return [];
}

// Color for the renderer verdict pill.
export function verdictColor(v: AmrVerdict): string {
  switch (v) {
    case "full": return "#059669";        // green
    case "near_edge": return "#d97706";   // amber
    case "under_tested": return "#dc2626"; // red
    case "outside_amr": return "#7c3aed";  // purple (own state)
  }
}

export function verdictLabel(v: AmrVerdict): string {
  switch (v) {
    case "full": return "AMR fully exercised";
    case "near_edge": return "Near-edge coverage";
    case "under_tested": return "Under-tested";
    case "outside_amr": return "Tested outside AMR";
  }
}
