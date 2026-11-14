// shared/policyApprovedVersion.ts
//
// BUG-151: while a newer revision of a VeritaDC document is a draft or in review, a limited Staff login, the staff portal and
// a share link keep reading the version recorded as approved (server/policyApprovedVersion.ts). Every screen that shows it
// says so in these words.
export const REVISION_IN_PROGRESS_NOTE = "A revision is in progress. This is the approved version.";

// BUG-164 (Michael 2026-11-13, Q328 = 1): an inspector's surveyor link shows a document whose review date has passed, marked
// in these words with the date the review was due (shown as the screen formats dates; blank when the date isn't on file).
export function reviewOverdueNote(dueDate: string | null | undefined): string {
  return dueDate ? `Review overdue. The review was due ${dueDate}.` : "Review overdue.";
}
