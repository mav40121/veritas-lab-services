// A quiz question's id is how every answer finds its question (Redington 2026-11-19: the Microbiology Annual Quiz had two
// questions with id "q8" and two with "q9", so the 8th and 9th were graded against the 6th and 7th's keys, and on the Take a
// Quiz screen a pick on one changed the other). Edit Quiz gave a new question the id "q<count + 1>", which on a quiz whose ids
// have gaps (q1, q3, q5, ...) is an id already in use; its Remove renumbered every id, so an attempt already on file then
// pointed its answers at other questions. A new question now takes an id no question has, a removal leaves the others' ids as
// they are, and the server re-ids any repeat before storing a quiz.

function idOf(q: unknown): string {
  const id = (q as any)?.id;
  return typeof id === "string" ? id.trim() : "";
}

/** An id no question in `questions` has: "q" and one more than the highest number any "q<number>" id carries (or the count). */
export function nextQuestionId(questions: readonly unknown[]): string {
  const taken = new Set(questions.map(idOf));
  let n = questions.length;
  for (const id of taken) {
    const m = /^q(\d+)$/.exec(id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  let id = `q${n + 1}`;
  while (taken.has(id)) id = `q${++n + 1}`;
  return id;
}

export interface QuestionIdChange { index: number; from: string; to: string }

/** The questions with every id unique: each id stays on its first question, and a repeat (or a blank id) gets the next free id.
 * Nothing else about a question changes. `changes` lists each question given a new id (index is its 0-based position). */
export function withUniqueQuestionIds<T>(questions: readonly T[]): { questions: T[]; changes: QuestionIdChange[] } {
  const seen = new Set<string>();
  const changes: QuestionIdChange[] = [];
  const out: T[] = questions.map((q) => q);
  // The free ids are worked out against every id on the quiz, so a repeat never takes an id a later question holds.
  const all: unknown[] = [...questions];
  out.forEach((q, index) => {
    const id = idOf(q);
    if (id !== "" && !seen.has(id)) {
      seen.add(id);
      return;
    }
    const fresh = nextQuestionId(all);
    all.push({ id: fresh });
    seen.add(fresh);
    out[index] = { ...(q as any), id: fresh };
    changes.push({ index, from: id, to: fresh });
  });
  return { questions: out, changes };
}

/** The ids two or more questions share, each once, in the order they first repeat. A blank id counts as "". */
export function repeatedQuestionIds(questions: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const repeated: string[] = [];
  for (const q of questions) {
    const id = idOf(q);
    if (seen.has(id) && !repeated.includes(id)) repeated.push(id);
    seen.add(id);
  }
  return repeated;
}
