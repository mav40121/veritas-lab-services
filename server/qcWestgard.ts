// VeritaQC Westgard rule evaluation. Extracted from server/routes.ts 2026-10-04
// so it can be unit-tested (scripts/verify-veritaqc-westgard-mfr.ts).
//
// SDIs are measured against the lot's PROGRAMMED mean/SD (qc_control_lots.mfr_mean
// / mfr_sd) -- the same values the Levey-Jennings chart is drawn against -- so the
// chart and the rule flags always agree. (Was cumulative-history mean/SD, which
// the chart does not use; a point flagged as a rejection against the drifted
// history mean/SD could sit inside the chart's green 2SD band, and vice-versa.
// Michael's option 1, 2026-10-04. CLSI C24: evaluate against the established
// mean/SD, which for this lab is the programmed lot value.)

export type WestgardViolation = {
  rule_code: string;
  severity: "warning" | "rejection";
  detail: string;
  related_result_ids: number[];
};

export function evaluateWestgardForLot(
  sqlite: any,
  labId: number,
  controlLotId: number,
  newResultId: number,
  biasN: number,
  trendN: number,
): WestgardViolation[] {
  const lot = sqlite.prepare(
    "SELECT mfr_mean, mfr_sd FROM qc_control_lots WHERE id = ? AND lab_id = ?"
  ).get(controlLotId, labId) as { mfr_mean: number; mfr_sd: number } | undefined;
  const mean = Number(lot?.mfr_mean);
  const sd = Number(lot?.mfr_sd);
  if (!lot || !Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return [];
  // Pull all accepted history (including the new result) in insert order so the
  // multi-point rules can examine windows ending at the new point; every SDI is
  // measured against the programmed mean / SD above, not a cumulative window.
  const history = sqlite.prepare(
    "SELECT id, result_value FROM qc_results WHERE lab_id = ? AND control_lot_id = ? AND accepted_for_reporting = 1 AND voided_at IS NULL ORDER BY result_date ASC, id ASC"
  ).all(labId, controlLotId) as { id: number; result_value: number }[];
  const vals = history.map(r => r.result_value);
  const ids = history.map(r => r.id);
  const sdis = vals.map(v => (v - mean) / sd);
  // Audit HIGH #1 (2026-07-12): anchor evaluation to the ACTUAL just-entered
  // result, not the last date-ordered element. history is ordered by result_date
  // ASC, so a back-dated / out-of-order entry does NOT sort last; `sdis.length-1`
  // would then score a different (usually in-control) result and let the entered
  // flyer pass as clean (false accept). indexOf anchors every single-point +
  // window rule to the point being entered.
  const i = ids.indexOf(newResultId);
  if (i < 0) return [];
  const z = sdis[i];
  const violations: WestgardViolation[] = [];
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
    const strictlyUp = window.every((v, k) => k === 0 || v > window[k - 1]);
    const strictlyDown = window.every((v, k) => k === 0 || v < window[k - 1]);
    if (strictlyUp || strictlyDown) {
      const direction = strictlyUp ? "increasing" : "decreasing";
      violations.push({ rule_code: `${trendN}-T`, severity: "rejection",
        detail: `${trendN} consecutive results strictly ${direction} (trend)`,
        related_result_ids: ids.slice(i - trendN + 1, i + 1) });
    }
  }
  return violations;
}
