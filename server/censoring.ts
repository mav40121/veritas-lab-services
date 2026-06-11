// server/censoring.ts
//
// 2026-06-09 (overnight session 8/11): Q1 Censoring Level 2.
// Handles below-detection-limit (<X) and above-upper-limit (>Y)
// results in stat math. Censored points are tagged in the data_points
// blob as:
//   { censored: true, censor_direction: 'below'|'above', censor_value: number, value: null }
//
// A point with `value` numeric and `censored` absent is a regular
// observation. The renderer iterates points, asks censorValueForMath
// for each, and gets back either a number or null (skip).
//
// Per-study `censoring_policy` controls the fallback math:
//   'exclude'              -- skip the point entirely (default; honest)
//   'substitute_lld'       -- use censor_value as-is
//   'substitute_lld_half'  -- use censor_value/2 (Helsel; common in clinical chem)
//
// Per the literature: 'exclude' is the most defensible for surveyor
// purposes since it does not introduce bias. 'substitute_lld_half'
// is the most commonly used in practice. 'substitute_lld' is the
// conservative imputation. We do not implement MLE / ROS (overkill
// for clinical EP studies).

// 2026-06-10 (PR B): the pure helpers (isCensored, parseCensoredInput,
// displayPointValue) + types now live in shared/ so the client data-entry
// grid can import them too. Re-exported here so every existing server
// import path (./censoring) keeps resolving unchanged.
export {
  isCensored,
  parseCensoredInput,
  displayPointValue,
  type CensoringPolicy,
  type CensoredPoint,
} from "@shared/censoring";

import { isCensored, type CensoringPolicy } from "@shared/censoring";

/**
 * Given a point and a study-level policy, return either:
 *   - a number to feed into stat math (substitution)
 *   - null to skip (exclude)
 *
 * Caller should also separately surface censored-point counts on the
 * report so the surveyor sees how many were dropped or imputed.
 */
export function censorValueForMath(
  point: any,
  policy: CensoringPolicy,
): number | null {
  if (!isCensored(point)) {
    // Not censored: caller uses point.value directly.
    return typeof point?.value === "number" && Number.isFinite(point.value) ? point.value : null;
  }
  switch (policy) {
    case "exclude":
      return null;
    case "substitute_lld":
      return point.censor_value;
    case "substitute_lld_half":
      return point.censor_value / 2;
    default:
      return null;
  }
}

/**
 * Filter + map a list of points to a numeric vector per policy, with
 * a count of how many points were dropped (excluded by policy) or
 * substituted (imputation applied).
 */
export function applyCensoringToVector(
  points: any[],
  policy: CensoringPolicy,
): { values: number[]; excludedCount: number; substitutedCount: number } {
  let excludedCount = 0;
  let substitutedCount = 0;
  const values: number[] = [];
  for (const p of points) {
    if (!p) continue;
    if (p.excluded === true) continue; // honor per-point exclusion (PR #693)
    if (isCensored(p)) {
      const v = censorValueForMath(p, policy);
      if (v === null) {
        excludedCount++;
      } else {
        values.push(v);
        substitutedCount++;
      }
    } else if (typeof p.value === "number" && Number.isFinite(p.value)) {
      values.push(p.value);
    }
  }
  return { values, excludedCount, substitutedCount };
}

export function policyLabel(p: CensoringPolicy): string {
  switch (p) {
    case "exclude": return "Exclude (default)";
    case "substitute_lld": return "Substitute LLD";
    case "substitute_lld_half": return "Substitute LLD/2";
  }
}

export function policyNarrative(p: CensoringPolicy): string {
  switch (p) {
    case "exclude":
      return "Censored results were excluded from stat math; bias and precision below the censoring threshold are not characterized by this study.";
    case "substitute_lld":
      return "Censored results were substituted with the censoring threshold value (conservative imputation).";
    case "substitute_lld_half":
      return "Censored results were substituted with half the censoring threshold (per Helsel, Nondetects And Data Analysis; common in clinical chemistry and environmental work).";
  }
}
