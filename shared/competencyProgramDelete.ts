// shared/competencyProgramDelete.ts
//
// Michael 2026-11-06, Q184 = 1: a VeritaComp program that holds competency records can't be deleted, the way a quiz with results
// can't. The server refuses with this message and the confirm dialog shows it, so both say the same thing.
export function programHoldsRecordsMessage(recordCount: number): string {
  return `This program holds ${recordCount} competency record${recordCount === 1 ? "" : "s"}. Competency records can't be deleted by deleting the program, so the program stays.`;
}

// REQ-157 (2026-11-18): a quiz shows on the Quiz tab only under its program, so a program with quizzes isn't deleted.
export function programHoldsQuizzesMessage(quizCount: number): string {
  return `This program has ${quizCount} ${quizCount === 1 ? "quiz" : "quizzes"}. A quiz shows on the Quiz tab only under its program, so the program stays while it has quizzes. Delete a quiz first if it's no longer needed; a quiz with results can't be deleted.`;
}
