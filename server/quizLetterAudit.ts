// Which quizzes and attempts the quiz screens' old letter rule graded wrong (Redington 2026-11-18; shared/quizOptions.ts).
// Before the fix, the Take a Quiz screen and the evaluator's quiz on a record sent each option's FIRST CHARACTER as its
// letter, while the answer key names options by POSITION. This reads, for every quiz: how many questions that rule graded
// against the key (the keyed option sent another letter, a different option sent the key's letter, or two options sent the
// same letter), and, for each attempt recorded before `before`, its stored score and the score it gets when each stored
// answer is read back to the one option that sent it and graded by position. An answer two options could have sent is
// ambiguous and counts as not correct. Read-only; quiz, result and lab ids, scores and counts only, never names or answers.
import { checkQuestionLetters, oldScreenLetter, optionLetter } from "@shared/quizOptions";

export interface QuizLetterAttempt {
  resultId: number;
  createdAt: string | null;
  source: string | null;
  storedScore: number;
  storedPassed: boolean;
  scoreByPosition: number;
  passedByPosition: boolean;
  ambiguousAnswers: number;
}

export interface QuizLetterQuiz {
  quizId: number;
  labId: number | null;
  systemDefault: boolean;
  questions: number;
  keyedOptionGradedWrong: number;
  otherOptionGradedRight: number;
  sharedLetter: number;
  attempts: QuizLetterAttempt[];
}

export interface QuizLetterAudit {
  before: string;
  quizzesChecked: number;
  quizzesAffected: number;
  labsAffected: number[];
  attemptsOnAffected: number;
  attemptsScoreWouldChange: number;
  attemptsWouldPass: number;
  attemptsWithAmbiguousAnswers: number;
  quizzes: QuizLetterQuiz[];
}

function parseList(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(String(raw ?? "[]")); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** One attempt's score read back by position: each stored answer goes to the option that sent it under the old rule (its
 * first character), or to the option at that position when none did; two or more options sending it make it ambiguous. */
export function scoreByPosition(questions: any[], answers: any[]): { score: number; ambiguous: number } {
  let correct = 0, ambiguous = 0;
  for (const q of questions) {
    const a = answers.find((x) => x && x.question_id === q.id);
    const sent = a?.selected_answer == null ? "" : String(a.selected_answer);
    const opts = Array.isArray(q.options) ? q.options : [];
    if (sent === "") continue;
    const senders = opts.map((o: unknown, i: number) => (oldScreenLetter(o) === sent && String(o ?? "").trim() !== "" ? i : -1)).filter((i: number) => i >= 0);
    let idx = -1;
    if (senders.length === 1) idx = senders[0];
    else if (senders.length > 1) { ambiguous++; continue; }
    else idx = opts.findIndex((_: unknown, i: number) => optionLetter(i) === sent);
    if (idx >= 0 && optionLetter(idx) === String(q.correct_answer ?? "")) correct++;
  }
  return { score: questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0, ambiguous };
}

/** `beforeIso` is the moment the position rule went live: an attempt recorded at or after it holds position letters, which the
 * old-rule read-back would misread, so it is left out. It is required, never defaulted. */
export function quizLetterAudit(sqlite: any, beforeIso: string): QuizLetterAudit {
  const before = new Date(beforeIso).toISOString();
  const quizzes = sqlite.prepare("SELECT id, lab_id, user_id, questions FROM competency_quizzes ORDER BY lab_id, id").all() as Array<{ id: number; lab_id: number | null; user_id: number; questions: string }>;
  const resultsFor = sqlite.prepare("SELECT id, answers, score, passed, created_at, source FROM competency_quiz_results WHERE quiz_id = ? ORDER BY id");
  const out: QuizLetterQuiz[] = [];
  for (const qz of quizzes) {
    const questions = parseList(qz.questions);
    let keyedWrong = 0, otherRight = 0, shared = 0;
    for (const q of questions) {
      const c = checkQuestionLetters(q?.options, q?.correct_answer);
      if (c.keyedOptionGradedWrong) keyedWrong++;
      if (c.otherOptionGradedRight) otherRight++;
      if (c.sharedLetter) shared++;
    }
    if (keyedWrong === 0 && otherRight === 0 && shared === 0) continue;
    const attempts: QuizLetterAttempt[] = [];
    for (const r of resultsFor.all(qz.id) as Array<{ id: number; answers: string; score: number; passed: number; created_at: string | null; source: string | null }>) {
      const at = r.created_at ? Date.parse(r.created_at.includes("T") ? r.created_at : r.created_at.replace(" ", "T") + "Z") : NaN;
      if (Number.isFinite(at) && at >= Date.parse(before)) continue;
      const s = scoreByPosition(questions, parseList(r.answers));
      attempts.push({
        resultId: r.id, createdAt: r.created_at, source: r.source,
        storedScore: Number(r.score), storedPassed: Number(r.passed) === 1,
        scoreByPosition: s.score, passedByPosition: s.score === 100, ambiguousAnswers: s.ambiguous,
      });
    }
    out.push({
      quizId: qz.id, labId: qz.lab_id ?? null, systemDefault: Number(qz.user_id) === 0, questions: questions.length,
      keyedOptionGradedWrong: keyedWrong, otherOptionGradedRight: otherRight, sharedLetter: shared, attempts,
    });
  }
  const all = out.flatMap((q) => q.attempts);
  return {
    before,
    quizzesChecked: quizzes.length,
    quizzesAffected: out.filter((q) => q.keyedOptionGradedWrong > 0 || q.otherOptionGradedRight > 0).length,
    labsAffected: [...new Set(out.filter((q) => q.keyedOptionGradedWrong > 0 || q.otherOptionGradedRight > 0).map((q) => q.labId).filter((x): x is number => x != null))].sort((a, b) => a - b),
    attemptsOnAffected: all.length,
    attemptsScoreWouldChange: all.filter((a) => a.scoreByPosition !== a.storedScore).length,
    attemptsWouldPass: all.filter((a) => a.passedByPosition && !a.storedPassed).length,
    attemptsWithAmbiguousAnswers: all.filter((a) => a.ambiguousAnswers > 0).length,
    quizzes: out,
  };
}
