// shared/quizRetake.ts
//
// Redington (Cathy Thornton), 2026-11-11: a staff member took an assigned quiz on his staff login and failed, and there was no way
// to give him another attempt. Each assignment is one attempt (competency_quiz_assignments.attempt_no). "Assign a retake" adds the
// next attempt only when the person's LATEST attempt was taken and did not pass, and only while they are on the lab's active roster.
// The failed attempt and its result stay on record. There is no cap on retakes; that is the lab's policy. The server decides with
// this function on the results list (can_retake) and again on POST /api/veritacomp/quizzes/:id/retake, so both say the same thing.

export type QuizRetakeRefusal = "NOT_ON_ROSTER" | "NO_ATTEMPT" | "RETAKE_OPEN" | "RETAKE_PASSED" | "RETAKE_NO_SCORE";

export interface LatestQuizAttempt {
  attemptNo: number;
  status: string;            // competency_quiz_assignments.status: 'assigned' (open) or 'completed'
  passed: number | null;     // competency_quiz_results.passed for the completed attempt, null when no result is on file
}

export interface QuizRetakeDecision {
  ok: boolean;
  code: QuizRetakeRefusal | null;
  message: string | null;
  nextAttemptNo: number | null;
}

export function quizRetakeDecision(latest: LatestQuizAttempt | null, onRoster: boolean): QuizRetakeDecision {
  const no = (code: QuizRetakeRefusal, message: string): QuizRetakeDecision => ({ ok: false, code, message, nextAttemptNo: null });
  if (!onRoster) return no("NOT_ON_ROSTER", "This person isn't on this lab's active roster, so a retake can't be assigned.");
  if (!latest) return no("NO_ATTEMPT", "This person hasn't been assigned this quiz yet. Use Assign to give them attempt 1.");
  if (latest.status !== "completed") return no("RETAKE_OPEN", `Attempt ${latest.attemptNo} is still open. A retake can be assigned once it's taken and not passed.`);
  if (latest.passed == null) return no("RETAKE_NO_SCORE", `Attempt ${latest.attemptNo} has no score on file, so a retake can't be assigned.`);
  if (Number(latest.passed) === 1) return no("RETAKE_PASSED", `Attempt ${latest.attemptNo} passed, so no retake is needed.`);
  return { ok: true, code: null, message: null, nextAttemptNo: latest.attemptNo + 1 };
}
