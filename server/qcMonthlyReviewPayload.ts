// server/qcMonthlyReviewPayload.ts
//
// The data for the VeritaQC monthly period review PDF (server/pdfQCMonthly.ts): the month's results with
// their rule violations and corrective actions, the baseline and basis, and the signatures. Moved out of
// routes.ts (2026-10-16) so the reviewer attribution can be tested directly (BUG-066).

import { resolveBasis } from "./qcBasis";
import type { MonthlyReviewPayload, MonthlyReviewResult } from "./pdfQCMonthly";

// BUG-066 (2026-10-16): the reviewer printed on the monthly review is the person who SIGNED the review
// (qc_period_reviews.reviewed_by_user_id / reviewed_at), never the person downloading the PDF. A month with
// no signed review prints "Pending signature" with no date.
export function buildMonthlyReviewPayload(sqlite: any, labId: number, lot: any, lab: any, year: number, month: number): MonthlyReviewPayload {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonthDate = new Date(year, month, 1);
  const monthEnd = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  const rawResults = sqlite.prepare(
    "SELECT r.id, r.result_value, r.result_date, r.run_time, r.instrument, r.accepted_for_reporting, NULLIF(TRIM(COALESCE(se.first_name,'') || ' ' || COALESCE(se.last_name,'')), '') AS operator_name FROM qc_results r LEFT JOIN staff_employees se ON se.id = r.operator_staff_employee_id WHERE r.lab_id = ? AND r.control_lot_id = ? AND r.result_date >= ? AND r.result_date < ? AND r.voided_at IS NULL ORDER BY r.result_date DESC, r.id DESC"
  ).all(labId, lot.id, monthStart, monthEnd) as any[];
  const resultIds = rawResults.map((r: any) => r.id);
  const violationsByR: Record<number, any[]> = {};
  const casByR: Record<number, any[]> = {};
  if (resultIds.length > 0) {
    const placeholders = resultIds.map(() => "?").join(",");
    const vs = sqlite.prepare("SELECT id, qc_result_id, rule_code, severity, detail FROM qc_rule_violations WHERE superseded_at IS NULL AND qc_result_id IN (" + placeholders + ")").all(...resultIds) as any[];
    for (const v of vs) (violationsByR[v.qc_result_id] = violationsByR[v.qc_result_id] || []).push(v);
    const cs = sqlite.prepare("SELECT id, qc_result_id, action_taken, status, taken_at FROM qc_corrective_actions WHERE qc_result_id IN (" + placeholders + ")").all(...resultIds) as any[];
    for (const c of cs) (casByR[c.qc_result_id] = casByR[c.qc_result_id] || []).push(c);
  }
  const results: MonthlyReviewResult[] = rawResults.map((r: any) => ({
    id: r.id, result_value: r.result_value, result_date: r.result_date, run_time: r.run_time,
    instrument: r.instrument, accepted_for_reporting: r.accepted_for_reporting, operator_name: r.operator_name || null,
    violations: violationsByR[r.id] || [], corrective_actions: casByR[r.id] || [],
  }));
  const accepted = sqlite.prepare("SELECT result_value FROM qc_results WHERE lab_id = ? AND control_lot_id = ? AND accepted_for_reporting = 1 AND voided_at IS NULL").all(labId, lot.id) as { result_value: number }[];
  let baselineMean: number | null = null;
  let baselineSD: number | null = null;
  if (accepted.length >= 2) {
    const vals = accepted.map((a: any) => a.result_value);
    const m = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
    const v = vals.reduce((s: number, x: number) => s + (x - m) ** 2, 0) / (vals.length - 1);
    const sd = Math.sqrt(v);
    if (sd > 0) { baselineMean = m; baselineSD = sd; }
  }
  const cosignRequired = !!(sqlite.prepare("SELECT qc_md_cosign_required FROM labs WHERE id = ?").get(labId) as any)?.qc_md_cosign_required;
  const mdReview = sqlite.prepare(
    "SELECT r.md_signed_name, r.md_signed_at, r.reviewed_at, r.attestation_acknowledged, u.name AS reviewer_name FROM qc_period_reviews r LEFT JOIN users u ON u.id = r.reviewed_by_user_id WHERE r.lab_id = ? AND r.control_lot_id = ? AND r.period_year = ? AND r.period_month = ?"
  ).get(labId, lot.id, year, month) as any;
  return {
    lab: { id: lab.id, lab_name: lab.lab_name, clia_number: lab.clia_number },
    lot: { id: lot.id, analyte: lot.analyte, level: lot.level, lot_number: lot.lot_number, manufacturer: lot.manufacturer, mfr_mean: lot.mfr_mean, mfr_sd: lot.mfr_sd, mfr_sd_interval: lot.mfr_sd_interval, mfr_range_low: lot.mfr_range_low ?? null, mfr_range_high: lot.mfr_range_high ?? null },
    // The chart and the narrative use the same basis the Westgard rules judge
    // the lot's runs against (server/qcBasis.ts).
    basis: (() => { const b = resolveBasis(sqlite, labId, lot.id); return b ? { mean: b.mean, sd: b.sd, source: b.source, label: b.label } : null; })(),
    periodYear: year, periodMonth: month, results, baselineMean, baselineSD,
    reviewerName: (mdReview && mdReview.reviewer_name) || "Pending signature",
    reviewerTitle: "Medical director or designee",
    reviewerDate: mdReview && mdReview.reviewed_at ? String(mdReview.reviewed_at).slice(0, 10) : "",
    attestationAcknowledged: !!(mdReview && mdReview.attestation_acknowledged),
    mdCosignRequired: cosignRequired,
    mdSignedName: mdReview?.md_signed_name || null,
    mdSignedDate: mdReview?.md_signed_at ? String(mdReview.md_signed_at).slice(0, 10) : null,
  };
}
