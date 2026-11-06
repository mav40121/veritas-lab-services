// shared/competencyProgramDelete.ts
//
// Michael 2026-11-06, Q184 = 1: a VeritaComp program that holds competency records can't be deleted, the way a quiz with results
// can't. The server refuses with this message and the confirm dialog shows it, so both say the same thing.
export function programHoldsRecordsMessage(recordCount: number): string {
  return `This program holds ${recordCount} competency record${recordCount === 1 ? "" : "s"}. Competency records can't be deleted by deleting the program, so the program stays.`;
}
