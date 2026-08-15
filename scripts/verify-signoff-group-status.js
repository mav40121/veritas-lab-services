#!/usr/bin/env node
/**
 * verify-signoff-group-status.js
 *
 * Receipt for the fix to the VeritaCheck Sign-off Groups "Open" vs "Signed"
 * badge (SCAHC / San Carlos report, 2026-08-15). Chineme Swann's "Urine
 * Chemistry" group showed the grey "Open" badge while reading "2 of 2 signed"
 * with both member studies individually signed.
 *
 * Root cause: the stored study_signoff_groups.status column only flips to
 * 'signed' on the batch "Sign and Lock all" action. Signing each study on its
 * own results page finalizes the study (lifecycle_state='finalized') but never
 * touches the group, so the badge stayed "Open" at N-of-N signed.
 *
 * Fix: the badge is derived — a group reads as signed when the stored status is
 * 'signed' OR every member study is finalized. The raw status is left untouched
 * so the add-to-group pickers and the add/remove gates still treat an unlocked
 * group as addable (option 1: no auto-lock).
 *
 * This script mirrors isSignedFromCounts() from
 * client/src/pages/VeritaCheckSignoffGroupsPage.tsx. Keep the two in sync.
 */

// EXACT mirror of the client predicate.
function isSignedFromCounts(status, total, finalized) {
  return status === "signed" || (total > 0 && finalized === total);
}

// The detail panel derives finalized from what it already has in hand:
// finalized = members.length - draftCount. Model that path too.
function isSignedFromMembers(status, memberCount, draftCount) {
  const finalized = memberCount - draftCount;
  return isSignedFromCounts(status, memberCount, finalized);
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${actual}, expected ${expected})`);
}

console.log("== list badge: isSignedFromCounts(status, total, finalized) ==");
// The reported bug: signed individually, group never batch-signed.
check("Urine Chemistry: open, 2 of 2 finalized -> Signed", isSignedFromCounts("open", 2, 2), true);
// Partial: one still a draft -> stays Open.
check("Partial: open, 1 of 2 finalized -> Open", isSignedFromCounts("open", 2, 1), false);
// Empty group must never read Signed off a vacuous all-finalized.
check("Empty: open, 0 of 0 -> Open", isSignedFromCounts("open", 0, 0), false);
// Fresh draft group.
check("Fresh: open, 0 of 1 finalized -> Open", isSignedFromCounts("open", 1, 0), false);
// The three other groups in the screenshot: batch sign-and-locked.
check("Batch-signed: signed, 5 of 5 -> Signed", isSignedFromCounts("signed", 5, 5), true);
check("Batch-signed large: signed, 97 of 97 -> Signed", isSignedFromCounts("signed", 97, 97), true);
// A stored-signed group is Signed even if the count read is momentarily empty.
check("Stored signed, 0 members -> Signed", isSignedFromCounts("signed", 0, 0), true);

console.log("\n== detail header: isSignedFromMembers(status, memberCount, draftCount) ==");
// Urine Chemistry detail: 2 members, 0 drafts -> Signed badge (not the button).
check("Detail: open, 2 members, 0 drafts -> Signed", isSignedFromMembers("open", 2, 0), true);
// One draft remaining -> still shows the Sign-and-Lock button (not signed).
check("Detail: open, 2 members, 1 draft -> not Signed", isSignedFromMembers("open", 2, 1), false);
// Empty group detail -> not Signed (button shows, disabled).
check("Detail: open, 0 members, 0 drafts -> not Signed", isSignedFromMembers("open", 0, 0), false);

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
