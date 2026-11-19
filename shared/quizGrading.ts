// How a quiz attempt is scored, for the Take a Quiz attempt (staff login) and the evaluator's quiz on a record (POST
// /api/veritacomp/quiz-results). An answer is right when its letter is the key of the question it names (the letter is the
// option's position, shared/quizOptions.ts). Each question is answered once: an answer goes to the first question with its id
// that no earlier answer took, so two questions sharing an id (Redington 2026-11-19, before ids were made unique) are graded
// against their own keys, and the same answer sent twice can't count twice (it could pass a quiz by repetition).
import { shownOptions } from "./quizOptions";

export interface SubmittedAnswer { question_id?: unknown; selected_answer?: unknown }
export interface GradedAnswer { question_id: unknown; selected_answer: unknown; correct: boolean }

export interface QuizGrade {
  /** One per submitted answer, in the order sent, as stored on the result. */
  graded: GradedAnswer[];
  correct: number;
  /** Whole percent of the quiz's questions answered right. */
  score: number;
  /** 100% passes. */
  passed: boolean;
  /** 1-based positions of the questions with no answer that is one of their own choices. */
  unanswered: number[];
  /** Each question's graded answer, by the question's position (null when none was sent for it). */
  byQuestion: Array<GradedAnswer | null>;
}

const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) === String(b);

/** Is `letter` one of the choices this question shows (a blank option isn't one)? */
export function isChoiceOf(question: any, letter: unknown): boolean {
  if (typeof letter !== "string" || letter === "") return false;
  return shownOptions(question?.options).some((o) => o.letter === letter);
}

export function gradeQuizAnswers(questions: readonly any[], answers: readonly SubmittedAnswer[]): QuizGrade {
  const byQuestion: Array<GradedAnswer | null> = questions.map(() => null);
  const answeredAt = new Set<number>();
  let correct = 0;
  const graded = answers.map((a) => {
    const index = questions.findIndex((q, i) => byQuestion[i] === null && sameId(q?.id, a?.question_id));
    let isCorrect = false;
    if (index >= 0) {
      const q = questions[index];
      if (isChoiceOf(q, a?.selected_answer)) answeredAt.add(index);
      isCorrect = typeof a?.selected_answer === "string" && a.selected_answer !== "" && a.selected_answer === q?.correct_answer;
    }
    if (isCorrect) correct++;
    const g: GradedAnswer = { question_id: a?.question_id, selected_answer: a?.selected_answer, correct: isCorrect };
    if (index >= 0) byQuestion[index] = g;
    return g;
  });
  const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
  const unanswered = questions.map((_, i) => i).filter((i) => !answeredAt.has(i)).map((i) => i + 1);
  return { graded, correct, score, passed: score === 100, unanswered, byQuestion };
}

/** What the staff attempt route says when a question has no answer. */
export function unansweredMessage(positions: readonly number[]): string {
  const list = positions.join(", ");
  return `Answer every question before submitting. Not answered: question${positions.length === 1 ? "" : "s"} ${list}.`;
}
