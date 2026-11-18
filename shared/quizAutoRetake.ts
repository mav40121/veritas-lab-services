// Automatic retakes (Redington 2026-11-18, Michael Q3 = 1: "Can we make the quiz reset happen automatically? It's disruptive
// and time consuming for each person to come and ask"). A per-quiz setting, off by default (competency_quizzes.auto_retake).
// When it's on, a failed attempt taken on a staff login opens the next attempt right away, with no evaluator click, and the
// review of that failed attempt shows which questions were missed but not the correct answers, so a retake can't be passed
// by copying the key. Every attempt keeps its own number and score, exactly as an assigned retake does (shared/quizRetake.ts).
// A pass still gets the full review. The server decides with these; the screens use the same words.

export const AUTO_RETAKE_LABEL = "Retake automatically after a failed attempt";
export const AUTO_RETAKE_HELP =
  "Someone who doesn't pass gets the next attempt right away, without asking. Their review shows which questions they missed, not the correct answers. Every attempt stays on record with its number and score.";

export function isAutoRetake(quiz: { auto_retake?: unknown } | null | undefined): boolean {
  return Number(quiz?.auto_retake) === 1;
}

/** The stored flag from a create or edit body: a value left out keeps what's stored (an edit that doesn't send it never turns it off). */
export function autoRetakeFlag(bodyValue: unknown, stored: unknown = 0): 0 | 1 {
  if (bodyValue === undefined) return Number(stored) === 1 ? 1 : 0;
  return bodyValue === true || bodyValue === 1 || bodyValue === "1" ? 1 : 0;
}

/** Whether a staff login's review of an attempt leaves out the correct answers and explanations. */
export function hideKeyOnReview(autoRetake: boolean, passed: boolean): boolean {
  return autoRetake && !passed;
}

/** The line shown after a failed attempt when the next one opened by itself. */
export function nextAttemptLine(attemptNo: number): string {
  return `Attempt ${attemptNo} is open now. Review the questions you missed, then take it when you're ready.`;
}
