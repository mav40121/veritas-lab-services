// Lab-identity gate for finalized VeritaCheck studies.
//
// A non-draft VeritaCheck study is a surveyor-facing compliance record; its PDF
// header must carry the lab's CLIA number (CLAUDE.md §5). This gate blocks
// finalizing such a study when the acting lab has no CLIA on record, so a
// signed compliance report can never be produced under an unidentified lab.
// The route returns code CLIA_REQUIRED, which the client turns into an inline
// "add your CLIA number" prompt.
//
// Drafts are exempt on purpose: a draft is work-in-progress, not yet a record,
// so a lab can build the study first and is only asked for its CLIA at the
// point it becomes a finalized compliance artifact. Applied only on the
// lab-scoped study endpoints (authenticated lab users); the legacy optional-auth
// /api/studies calculator path (anonymous demo use, no lab identity) is left
// open by design.

export function blockFinalizeWithoutClia(isDraft: boolean, cliaNumber: unknown): boolean {
  if (isDraft) return false;
  return !(typeof cliaNumber === "string" && cliaNumber.trim().length > 0);
}

export const CLIA_REQUIRED_MESSAGE =
  "Add your lab's CLIA number in Account Settings before saving a finalized compliance study.";
