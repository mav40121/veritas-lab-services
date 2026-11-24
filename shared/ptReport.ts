// shared/ptReport.ts
//
// The VeritaPT period report (B11, 2026-11-24; server/ptReport.ts builds it). One shape for the screen, the PDF and the Excel
// file, so the three carry the same numbers.
import type { PtReviewState, PtStatus, PtSubmission } from "./ptEvents";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface PtPeriod { value: string; label: string; start: string; end: string }

/** A month (2026-03), a quarter (2026-Q1) or a year (2026), as days; null when it is none of them. */
export function ptPeriod(value: unknown): PtPeriod | null {
  const v = String(value ?? "");
  const m = /^(\d{4})(?:-(0[1-9]|1[0-2])|-Q([1-4]))?$/.exec(v);
  if (!m || Number(m[1]) < 1900) return null;
  const year = Number(m[1]);
  const first = m[2] ? Number(m[2]) : m[3] ? (Number(m[3]) - 1) * 3 + 1 : 1;
  const last = m[2] ? first : m[3] ? first + 2 : 12;
  const day = (y: number, mo: number, d: number) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const label = m[2] ? `${MONTHS[first - 1]} ${year}` : m[3] ? `Q${m[3]} ${year} (${MONTHS[first - 1]} to ${MONTHS[last - 1]})` : String(year);
  return { value: v, label, start: day(year, first, 1), end: day(year, last, new Date(Date.UTC(year, last, 0)).getUTCDate()) };
}

export interface PtReport {
  period: PtPeriod;
  /** The lab's day the report was made. Reviews and evaluations are as of this day; results and flags are the period's. */
  as_of: string;
  due: { total: number; counts: Record<PtSubmission, number>; events: Array<{ event: string; program: string; due_date: string; submitted_date: string | null; submission: PtSubmission }> };
  results: Record<PtStatus, number> & { graded: number; acceptable_rate: number | null };
  by_analyte: Array<{ name: string; unacceptable: number; ungraded: number }>;
  by_department: Array<{ name: string; unacceptable: number; ungraded: number }>;
  open_reviews: Array<{ event: string; program: string; event_date: string; state: PtReviewState; open_evaluations: number }>;
  open_evaluations: number;
  /** The two-of-three list as of the period's last day. */
  two_of_three: Array<{ analyte: string; state: "AT-RISK" | "WATCH"; last3: Array<{ event_date: string; pass_fail: string }> }>;
}

/** "92.3%", or that nothing was graded. */
export const ptRateText = (r: PtReport["results"]): string => (r.acceptable_rate == null ? "No graded results" : `${r.acceptable_rate.toFixed(1)}%`);
export const ptRateWords = (r: PtReport["results"]): string =>
  `${r.acceptable} acceptable of ${r.graded} graded. Beside it, not counted in the rate: ${r.ungraded} ungraded, ${r.not_graded} not yet graded.`;
export const ptLast3Text = (last3: Array<{ event_date: string; pass_fail: string }>): string =>
  last3.map((e) => `${e.event_date.slice(0, 10)} ${e.pass_fail === "fail" ? "unacceptable" : "acceptable"}`).join("; ");
export const PT_FLAG_LABEL: Record<"AT-RISK" | "WATCH", string> = { "AT-RISK": "At risk: two or more of the last three unacceptable", WATCH: "On watch: one of the last three unacceptable" };
