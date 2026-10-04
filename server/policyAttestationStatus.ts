// Per-assignee roster status for the VeritaDC (VeritaPolicy) attestation
// tracker. Pure and exported so the verify receipt
// (scripts/verify-veritadc-attestation-tracker.ts) exercises the SAME code the
// roster endpoint runs, rather than a drifting copy.
//
// Precedence (first match wins):
//   1. attested  - the assignee completed the attestation (completed_at set).
//   2. overdue   - not attested and the due date is strictly in the past.
//   3. opened    - not attested, not overdue, but the assignee has opened the
//                  document content at least once (a 'viewed'/'version_viewed'
//                  audit event exists for them on this document).
//   4. assigned  - assigned but never opened and not overdue.
//
// due_date is a plain YYYY-MM-DD from the assign dialog and todayStr is the
// UTC day, so the overdue comparison is an exact lexical date compare. The due
// date itself is NOT overdue (strict <): a policy due today is still on time.
export type AttestationRosterStatus = "attested" | "overdue" | "opened" | "assigned";

export function deriveAttestationStatus(args: {
  completedAt: string | null;
  dueDate: string | null;
  lastOpenedAt: string | null;
  todayStr: string;
}): AttestationRosterStatus {
  const { completedAt, dueDate, lastOpenedAt, todayStr } = args;
  if (completedAt) return "attested";
  if (dueDate && dueDate < todayStr) return "overdue";
  if (lastOpenedAt) return "opened";
  return "assigned";
}
