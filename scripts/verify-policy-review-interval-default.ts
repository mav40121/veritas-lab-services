// scripts/verify-policy-review-interval-default.ts
//
// Receipt for the VeritaPolicy biennial-default + MA-annual-exception change.
// Exercises defaultReviewIntervalMonthsForState across every branch: the
// biennial floor (24) for ordinary states / blank / unknown, and the annual
// exception (12) for Massachusetts in any casing. Run: npx tsx scripts/verify-policy-review-interval-default.ts

import {
  defaultReviewIntervalMonthsForState,
  ANNUAL_REVIEW_STATES,
  ANNUAL_MONTHS,
  BIENNIAL_MONTHS,
} from "../server/policyReviewInterval";

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// Annual exception: Massachusetts, case/whitespace insensitive.
check("MA -> annual", defaultReviewIntervalMonthsForState("MA"), ANNUAL_MONTHS);
check("ma (lower) -> annual", defaultReviewIntervalMonthsForState("ma"), ANNUAL_MONTHS);
check("' MA ' (padded) -> annual", defaultReviewIntervalMonthsForState(" MA "), ANNUAL_MONTHS);

// Biennial floor: every other state and every empty/unknown signal.
check("CA -> biennial", defaultReviewIntervalMonthsForState("CA"), BIENNIAL_MONTHS);
check("NY -> biennial", defaultReviewIntervalMonthsForState("NY"), BIENNIAL_MONTHS);
check("AZ -> biennial", defaultReviewIntervalMonthsForState("AZ"), BIENNIAL_MONTHS);
check("'' -> biennial", defaultReviewIntervalMonthsForState(""), BIENNIAL_MONTHS);
check("null -> biennial", defaultReviewIntervalMonthsForState(null), BIENNIAL_MONTHS);
check("undefined -> biennial", defaultReviewIntervalMonthsForState(undefined), BIENNIAL_MONTHS);

// Guard the constants themselves so a future edit can't silently invert them.
check("floor is 24", BIENNIAL_MONTHS, 24);
check("exception is 12", ANNUAL_MONTHS, 12);
check("MA is in the annual set", ANNUAL_REVIEW_STATES.has("MA"), true);
check("NY is NOT in the annual set", ANNUAL_REVIEW_STATES.has("NY"), false);

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll policy review-interval default checks passed.");
