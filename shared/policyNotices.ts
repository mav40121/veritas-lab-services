// shared/policyNotices.ts
//
// The choices on the VeritaDC email notices card (server/policyNotices.ts sends them). Both notices are off until a lab's owner
// or an admin turns one on.

/** How long after someone first owes a document, with no due date on it, it counts as overdue. */
export const OVERDUE_SIGN_DAYS = [7, 14, 30, 60, 90] as const;
export const DEFAULT_OVERDUE_SIGN_DAYS = 30;

/** The most documents one bulk approval signs. */
export const BULK_APPROVE_MAX = 100;
