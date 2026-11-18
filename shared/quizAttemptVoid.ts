// Voiding a quiz attempt (Redington 2026-11-18, Michael Q2 = 1: four attempts were scored by a VeritaAssure error, and the lab
// asked to remove them because "they didn't have an accurate chance"). Nothing is deleted. A voided attempt stays in the
// history with who voided it, when and why, and stops counting as a Pass or a Fail anywhere a result is counted: the quiz card,
// Results, Quiz scores and its workbook, and a staff login's own list. A voided latest attempt can be followed by a retake.
// VeritaTrack's sign-off void (server/veritatrackSignoffLog.ts) is the same rule. server/quizAttemptVoid.ts writes it.

export const VOID_REASON_MAX = 500;

/** A reason is required and kept as typed (trimmed), up to VOID_REASON_MAX characters. Returns the problem, or null. */
export function voidReasonProblem(reason: unknown): string | null {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (!r) return "A reason is required to void an attempt.";
  if (r.length > VOID_REASON_MAX) return `Keep the reason to ${VOID_REASON_MAX} characters.`;
  return null;
}

export type AttemptOutcome = "pass" | "fail" | "voided" | "no_score";

/** How a scored attempt reads: Voided first, whatever its score was; otherwise its own Pass or Fail. */
export function attemptOutcome(a: { passed: number | boolean | null | undefined; voided_at?: string | null; voided?: boolean | null }): AttemptOutcome {
  if (a.voided || a.voided_at) return "voided";
  if (a.passed == null) return "no_score";
  return Number(a.passed) === 1 || a.passed === true ? "pass" : "fail";
}

/** The line shown with a voided attempt. */
export function voidedLine(a: { void_reason?: string | null; voided_at?: string | null }, dayOf: (s: string) => string): string {
  const when = a.voided_at ? ` ${dayOf(a.voided_at)}` : "";
  return `Voided${when}${a.void_reason ? `: ${a.void_reason}` : ""}`;
}
