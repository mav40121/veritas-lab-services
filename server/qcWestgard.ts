// VeritaQC Westgard rule evaluation. Extracted from server/routes.ts 2026-10-04
// so it can be unit-tested (scripts/verify-veritaqc-basis.ts).
//
// SDIs are measured against the lot's evaluation basis from ./qcBasis: the lab's
// own established mean/SD, or the manufacturer's published mean/SD while the
// lab is still establishing its own on a new lot. The Levey-Jennings chart, the continuous line chart and the
// monthly PDF draw the same basis, so the chart and the flags always agree.
// History: 2026-10-07 (PR #1464) scored every lot against the manufacturer
// mean/SD. The client (MedStar) wants the lab's own numbers once it has enough
// runs and the manufacturer's only until then (emails 2026-09-30, 2026-10-08).

import { computeBasis, loadBasisLot, basisConfig, type QcBasis, type QcBasisConfig } from "./qcBasis";

export type WestgardViolation = {
  rule_code: string;
  severity: "warning" | "rejection";
  detail: string;
  related_result_ids: number[];
};

// PURE rule engine over a chronological series, judged at index i against one
// mean/SD. Every window rule uses the same basis as the run being judged.
export function westgardRulesAt(
  vals: number[], ids: number[], i: number, mean: number, sd: number,
  biasN: number, trendN: number,
): WestgardViolation[] {
  const violations: WestgardViolation[] = [];
  if (i < 0 || i >= vals.length) return violations;
  if (!Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return violations;
  const sdis = vals.map(x => (x - mean) / sd);
  const z = sdis[i];
  if (Math.abs(z) > 3) {
    violations.push({ rule_code: "1-3s", severity: "rejection",
      detail: `|SDI|=${Math.abs(z).toFixed(2)} > 3`, related_result_ids: [ids[i]] });
  } else if (Math.abs(z) > 2) {
    violations.push({ rule_code: "1-2s", severity: "warning",
      detail: `|SDI|=${Math.abs(z).toFixed(2)} > 2`, related_result_ids: [ids[i]] });
  }
  if (i >= 1 && Math.abs(z) > 2 && Math.abs(sdis[i - 1]) > 2 && z * sdis[i - 1] > 0) {
    violations.push({ rule_code: "2-2s", severity: "rejection",
      detail: "2 consecutive results on same side >2SD",
      related_result_ids: [ids[i - 1], ids[i]] });
  }
  // Audit #6 (2026-07-12): canonical Westgard R-4s requires the two points to
  // STRADDLE the mean (one > +2s AND the other < -2s) with a > 4s span, not merely
  // a > 4s range.
  if (i >= 1 && Math.abs(z - sdis[i - 1]) > 4 &&
      ((z > 2 && sdis[i - 1] < -2) || (z < -2 && sdis[i - 1] > 2))) {
    violations.push({ rule_code: "R-4s", severity: "rejection",
      detail: `range ${Math.abs(z - sdis[i - 1]).toFixed(2)}SD, points straddle the mean (>+2s and <-2s)`,
      related_result_ids: [ids[i - 1], ids[i]] });
  }
  if (i >= 3) {
    const window = sdis.slice(i - 3, i + 1);
    if (window.every(s => Math.abs(s) > 1) && window.every(s => s * window[0] > 0)) {
      violations.push({ rule_code: "4-1s", severity: "rejection",
        detail: "4 consecutive results on same side >1SD",
        related_result_ids: ids.slice(i - 3, i + 1) });
    }
  }
  if (biasN > 0 && i >= biasN - 1) {
    const window = sdis.slice(i - biasN + 1, i + 1);
    if (window.every(s => s * window[0] > 0)) {
      violations.push({ rule_code: `${biasN}-x`, severity: "rejection",
        detail: `${biasN} consecutive results on same side of mean (bias)`,
        related_result_ids: ids.slice(i - biasN + 1, i + 1) });
    }
  }
  if (trendN > 0 && i >= trendN - 1) {
    const window = vals.slice(i - trendN + 1, i + 1);
    const strictlyUp = window.every((x, k) => k === 0 || x > window[k - 1]);
    const strictlyDown = window.every((x, k) => k === 0 || x < window[k - 1]);
    if (strictlyUp || strictlyDown) {
      const direction = strictlyUp ? "increasing" : "decreasing";
      violations.push({ rule_code: `${trendN}-T`, severity: "rejection",
        detail: `${trendN} consecutive results strictly ${direction} (trend)`,
        related_result_ids: ids.slice(i - trendN + 1, i + 1) });
    }
  }
  return violations;
}

export const MFR_RANGE_RULE = "MFR-range";

// Which rules judge run i. While the lot is still on the manufacturer's values
// and the lab's policy is 'range', the run passes or fails on the manufacturer's
// published range only (the full Westgard rules start once the lab has its own
// mean and SD); a lot with no published range falls back to the full rules.
// Otherwise the full Westgard rules run against the basis. Shared by entry and
// the admin re-score so both judge a run the same way.
export function rulesForRun(
  vals: number[], ids: number[], i: number, basis: QcBasis | null,
  mfrRange: { low: number | null; high: number | null }, cfg: QcBasisConfig,
  biasN: number, trendN: number,
): WestgardViolation[] {
  const low = mfrRange.low == null ? null : Number(mfrRange.low);
  const high = mfrRange.high == null ? null : Number(mfrRange.high);
  const hasRange = (low != null && Number.isFinite(low)) || (high != null && Number.isFinite(high));
  if (basis?.source === "manufacturer" && cfg.establishingRules === "range" && hasRange) {
    const v = vals[i];
    if ((low != null && Number.isFinite(low) && v < low) || (high != null && Number.isFinite(high) && v > high)) {
      return [{ rule_code: MFR_RANGE_RULE, severity: "rejection",
        detail: `${v} is outside the manufacturer's range ${low ?? "-"} to ${high ?? "-"} (lab still establishing its own mean and SD)`,
        related_result_ids: [ids[i]] }];
    }
    return [];
  }
  return westgardRulesAt(vals, ids, i, basis ? basis.mean : NaN, basis ? basis.sd : NaN, biasN, trendN);
}

// The runs on one lot in the order they are judged (result_date, then entry), with the lot and its basis settings. A
// file import (server/qcFileImport.ts) holds one per lot and adds each run to it as it is stored, so thousands of runs
// don't re-read the lot's history each; what judges a run is the same either way.
export interface LotRuns {
  history: { id: number; result_value: number; result_date: string }[];
  lot: ReturnType<typeof loadBasisLot>;
  cfg: QcBasisConfig;
}
export function loadLotRuns(sqlite: any, labId: number, controlLotId: number): LotRuns {
  const history = sqlite.prepare(
    "SELECT id, result_value, result_date FROM qc_results WHERE lab_id = ? AND control_lot_id = ? AND accepted_for_reporting = 1 AND voided_at IS NULL ORDER BY result_date ASC, id ASC"
  ).all(labId, controlLotId) as LotRuns["history"];
  const lot = loadBasisLot(sqlite, labId, controlLotId);
  return { history, lot, cfg: basisConfig(sqlite, labId, lot?.analyte ?? null) };
}

// Judge one just-entered run. Returns the violations and the basis that judged
// it (callers store the basis on the result for the audit trail). When the lot
// has just reached its establish count, the lab's mean/SD is locked.
export function evaluateQcRun(
  sqlite: any, labId: number, controlLotId: number, newResultId: number,
  biasN: number, trendN: number, loaded?: LotRuns,
): { violations: WestgardViolation[]; basis: QcBasis | null } {
  const { history, lot, cfg } = loaded ?? loadLotRuns(sqlite, labId, controlLotId);
  const ids = history.map(r => r.id);
  // Audit HIGH #1 (2026-07-12): anchor evaluation to the ACTUAL just-entered
  // result, not the last date-ordered element, so a back-dated entry is judged
  // itself (and against the runs that precede it in chart order).
  const i = ids.indexOf(newResultId);
  if (i < 0) return { violations: [], basis: null };
  const vals = history.map(r => Number(r.result_value));
  // The basis is the runs before this one in that order (resolveBasis with beforeResultId, from the history in hand).
  const basis = lot ? computeBasis(lot, vals.slice(0, i), cfg) : null;
  const violations = rulesForRun(vals, ids, i, basis,
    { low: lot?.mfr_range_low ?? null, high: lot?.mfr_range_high ?? null },
    cfg, biasN, trendN);
  return { violations, basis };
}

// Back-compat wrapper (violations only).
export function evaluateWestgardForLot(
  sqlite: any, labId: number, controlLotId: number, newResultId: number, biasN: number, trendN: number,
): WestgardViolation[] {
  return evaluateQcRun(sqlite, labId, controlLotId, newResultId, biasN, trendN).violations;
}
