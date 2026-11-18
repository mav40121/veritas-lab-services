// Quiz scores (Michael 2026-11-17, Q347 = 1: "it is difficult to find peoples quiz scores"). One row per scored quiz in a
// lab, from server/quizScores.ts quizScoreRows. The screen (VeritaCompQuizScoresPage, the person page's section, the Staff
// login's own list) and the Excel download filter the same rows with filterQuizScores, so they can't disagree.

/** Where a score came from. */
export type QuizScoreSource =
  | "assigned"  // a staff member took a quiz assigned to them (Staff Portal); one row per attempt
  | "record"    // an evaluator gave the quiz on a competency record (POST /api/veritacomp/quiz-results)
  | "element6"; // a score typed on a record's Element 6, for a quiz taken outside VeritaComp or entered by hand

/** Pass and Fail are a scored quiz's own result (VeritaComp passes a quiz at 100%). A typed Element 6 score reads
 *  Pass when its element is marked Pass and Not marked otherwise, never Fail (Michael Q179 = 1). */
export type QuizScoreResult = "pass" | "fail" | "not_marked" | "voided";

export interface QuizScoreRow {
  key: string;
  source: QuizScoreSource;
  staff_employee_id: number | null;
  competency_employee_id: number | null;
  person_name: string;
  person_title: string | null;
  quiz_id: number | null;
  quiz_title: string;
  covers: string | null;
  attempt_no: number | null;
  date_taken: string | null;
  score: number | null;
  result: QuizScoreResult;
  /** Why an attempt was voided (shared/quizAttemptVoid.ts); only on a voided row. */
  void_reason?: string | null;
}

export const SOURCE_LABEL: Record<QuizScoreSource, string> = {
  assigned: "Assigned quiz",
  record: "Taken on a record",
  element6: "Entered on Element 6",
};

/** A voided attempt (2026-11-18) keeps its score on the list and reads Voided, never Pass or Fail. */
export const RESULT_LABEL: Record<QuizScoreResult, string> = { pass: "Pass", fail: "Fail", not_marked: "Not marked", voided: "Voided" };

/** The person a row belongs to, for the person filter: the roster id when known, else the competency employee. */
export function personKey(r: Pick<QuizScoreRow, "staff_employee_id" | "competency_employee_id">): string {
  return r.staff_employee_id != null ? `s${r.staff_employee_id}` : `c${r.competency_employee_id ?? 0}`;
}

export interface QuizScoreFilters { person?: string; quiz?: string; result?: string; from?: string; to?: string }

export function filterQuizScores(rows: QuizScoreRow[], f: QuizScoreFilters): QuizScoreRow[] {
  return rows.filter((r) => {
    if (f.person && personKey(r) !== f.person) return false;
    if (f.quiz && r.quiz_title !== f.quiz) return false;
    if (f.result && r.result !== f.result) return false;
    if (f.from && (!r.date_taken || r.date_taken < f.from)) return false;
    if (f.to && (!r.date_taken || r.date_taken > f.to)) return false;
    return true;
  });
}

/** Newest first; a row with no date last; then person, quiz, attempt. */
export function sortQuizScores(rows: QuizScoreRow[]): QuizScoreRow[] {
  return [...rows].sort((a, b) =>
    (b.date_taken || "").localeCompare(a.date_taken || "")
    || a.person_name.localeCompare(b.person_name)
    || a.quiz_title.localeCompare(b.quiz_title)
    || (a.attempt_no ?? 0) - (b.attempt_no ?? 0)
    || a.key.localeCompare(b.key));
}

/** The people and quizzes the filters offer, from the rows themselves. */
export function quizScoreChoices(rows: QuizScoreRow[]): { people: Array<{ key: string; name: string }>; quizzes: string[] } {
  const people = new Map<string, string>();
  for (const r of rows) if (!people.has(personKey(r))) people.set(personKey(r), r.person_name);
  return {
    people: Array.from(people, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name)),
    quizzes: Array.from(new Set(rows.map((r) => r.quiz_title))).sort((a, b) => a.localeCompare(b)),
  };
}
