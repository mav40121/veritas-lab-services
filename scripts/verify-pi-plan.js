#!/usr/bin/env node
/**
 * verify-pi-plan.js
 *
 * Receipt for VeritaQA Phase 1 (PI Plan + annual leadership review, TJC
 * PI.02.01.01). Exercises the two pieces of branching logic in the server:
 *   1. next_review_due = review_date + 12 months (addMonthsIso).
 *   2. review_status.overdue = no review yet, OR the last review's
 *      next_review_due has passed relative to "today".
 * These drive the EP2 "reviewed within 12 months / overdue" governance, so
 * they must be exact.
 */

// Faithful copy of server/veritabench.ts addMonthsIso.
function addMonthsIso(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  if (isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Faithful copy of the GET /api/pi/plan review_status computation.
function reviewStatus(reviews, today) {
  const sorted = [...reviews].sort((a, b) =>
    a.review_date < b.review_date ? 1 : a.review_date > b.review_date ? -1 : 0
  );
  const last = sorted[0] || null;
  return {
    never_reviewed: !last,
    last_review_date: last ? last.review_date : null,
    next_review_due: last ? last.next_review_due : null,
    overdue: !last || (last.next_review_due != null && last.next_review_due < today),
  };
}

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}\n        expected ${JSON.stringify(want)}\n        got      ${JSON.stringify(got)}`); }
};

// --- addMonthsIso ---
eq("+12mo mid-year", addMonthsIso("2026-07-31", 12), "2027-07-31");
eq("+12mo year-end", addMonthsIso("2026-01-15", 12), "2027-01-15");
eq("+12mo leap Feb 29 rolls to Mar 1", addMonthsIso("2024-02-29", 12), "2025-03-01");
eq("invalid date -> null", addMonthsIso("not-a-date", 12), null);

// --- reviewStatus ---
eq("no reviews -> overdue + never_reviewed", reviewStatus([], "2026-07-31"), {
  never_reviewed: true, last_review_date: null, next_review_due: null, overdue: true,
});
eq("current review (due in future) -> not overdue", reviewStatus(
  [{ review_date: "2026-03-01", next_review_due: "2027-03-01" }], "2026-07-31"), {
  never_reviewed: false, last_review_date: "2026-03-01", next_review_due: "2027-03-01", overdue: false,
});
eq("stale review (due passed) -> overdue", reviewStatus(
  [{ review_date: "2024-01-01", next_review_due: "2025-01-01" }], "2026-07-31"), {
  never_reviewed: false, last_review_date: "2024-01-01", next_review_due: "2025-01-01", overdue: true,
});
eq("latest of several reviews wins", reviewStatus([
  { review_date: "2023-05-01", next_review_due: "2024-05-01" },
  { review_date: "2026-06-01", next_review_due: "2027-06-01" },
  { review_date: "2024-05-01", next_review_due: "2025-05-01" },
], "2026-07-31"), {
  never_reviewed: false, last_review_date: "2026-06-01", next_review_due: "2027-06-01", overdue: false,
});
eq("due exactly today -> not overdue (strict <)", reviewStatus(
  [{ review_date: "2025-07-31", next_review_due: "2026-07-31" }], "2026-07-31"), {
  never_reviewed: false, last_review_date: "2025-07-31", next_review_due: "2026-07-31", overdue: false,
});

console.log(`\n${failures === 0 ? "All" : "NOT all"} PI-plan review cases passed.`);
if (failures > 0) { console.error(`${failures} case(s) FAILED.`); process.exit(1); }
