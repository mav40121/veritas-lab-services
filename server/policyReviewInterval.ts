// Policy review-interval defaults.
//
// The federal / accreditor floor for reviewing a lab policy or procedure is
// BIENNIAL (every 24 months) — CLIA 42 CFR 493.1251(d) requires review when a
// procedure changes and periodically thereafter, and CAP COM.10000 sets the
// two-year cadence. Defaulting every policy to annual over-schedules a lab to
// twice the required review load, which makes the product feel heavier than the
// regulation demands.
//
// Some states require ANNUAL (12-month) policy review. Massachusetts is the one
// Michael has confirmed; the set below is the single place to add another state
// once its annual requirement is confirmed (do not infer — an under-reviewed
// lab is a citation, so only add a state you can cite).
//
// This governs the DEFAULT applied when a new policy is uploaded without an
// explicit interval. It never re-stamps an existing policy: policies already in
// the system keep their stored review_interval_months and next_review_date.
export const ANNUAL_REVIEW_STATES = new Set<string>(["MA"]);

export const BIENNIAL_MONTHS = 24;
export const ANNUAL_MONTHS = 12;

// Returns the default review interval (months) for a lab in the given physical
// state: annual (12) for a state that requires it, biennial (24) otherwise.
// Case-insensitive; a null/blank/unknown state falls back to the biennial floor.
export function defaultReviewIntervalMonthsForState(state?: string | null): number {
  const s = String(state || "").trim().toUpperCase();
  return ANNUAL_REVIEW_STATES.has(s) ? ANNUAL_MONTHS : BIENNIAL_MONTHS;
}
