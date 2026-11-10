// shared/policyApprovedVersion.ts
//
// BUG-151: while a newer revision of a VeritaDC document is a draft or in review, a limited Staff login, the staff portal and
// a share link keep reading the version recorded as approved (server/policyApprovedVersion.ts). Every screen that shows it
// says so in these words.
export const REVISION_IN_PROGRESS_NOTE = "A revision is in progress. This is the approved version.";
