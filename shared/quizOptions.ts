// Which letter an answer choice on a VeritaComp quiz carries (Redington 2026-11-18: two quizzes brought over from MediaLab
// graded every pick wrong). The answer key (competency_quizzes.questions[].correct_answer) names an option by its POSITION:
// A is the first option, B the second. The quiz builder stores it that way (its radio buttons set String.fromCharCode(65 +
// index)), and the printed quiz, the answer key and Results read it so. The quiz screens used to take each option's FIRST
// CHARACTER as its letter, which only works when the options were typed "A. ...", "B. ...": an option typed "True" sent "T",
// never the key's "A", so choosing it was graded wrong, and two options starting alike (or two blank slots) shared a letter.
// The letter now always comes from the position; an option's own text is never read for it.

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

export interface ShownOption {
  /** Position letter: what the answer key and a submitted answer hold. */
  letter: string;
  /** The option's own text, as typed. */
  text: string;
  /** Position in the stored options list. */
  index: number;
}

/** The choices a person picks from on a quiz screen: every option with its position letter, leaving out a blank option (an
 * unused slot in the builder's four), whose letter is skipped rather than given to the next option. */
export function shownOptions(options: unknown): ShownOption[] {
  const list = Array.isArray(options) ? options : [];
  const out: ShownOption[] = [];
  list.forEach((o, index) => {
    const text = o == null ? "" : String(o);
    if (text.trim() === "") return;
    out.push({ letter: optionLetter(index), text, index });
  });
  return out;
}

/** Which option a stored letter names: by position (A = first), or, when no position has that letter, by the option's own
 * first character, the way the quiz screens recorded answers before 2026-11-18 ("T" for an option typed "True"). Returns -1
 * when nothing matches. An answer recorded before then whose first character is also a position letter (an option typed
 * "B..." in third place) reads by position, the rule in force from then on. */
export function optionIndexFor(options: unknown, key: string | null | undefined): number {
  const list = Array.isArray(options) ? options.map((o) => (o == null ? "" : String(o))) : [];
  if (key == null || key === "") return -1;
  const byLetter = list.findIndex((_, i) => optionLetter(i) === key);
  if (byLetter >= 0) return byLetter;
  return list.findIndex((o) => o.trim() !== "" && o.trim().charAt(0) === key);
}

/** The letter the quiz screens sent for each option before 2026-11-18 (its first character, blank for a blank option). Used
 * only to count which quizzes and attempts that rule graded differently from the answer key. */
export function oldScreenLetter(option: unknown): string {
  return option == null ? "" : String(option).charAt(0);
}

export interface QuestionLetterCheck {
  /** Choosing the keyed option sent a letter other than the key, so it was graded wrong. */
  keyedOptionGradedWrong: boolean;
  /** Choosing some other option sent the key's letter, so a wrong choice was graded right. */
  otherOptionGradedRight: boolean;
  /** Two options (blank ones included) sent the same letter, so the screen could not tell them apart. */
  sharedLetter: boolean;
}

/** How the screens' old first-character rule treated one question, against the position rule the key is written in. */
export function checkQuestionLetters(options: unknown, correctAnswer: unknown): QuestionLetterCheck {
  const list = Array.isArray(options) ? options : [];
  const key = correctAnswer == null ? "" : String(correctAnswer);
  const keyIndex = list.findIndex((_, i) => optionLetter(i) === key);
  const sent = list.map(oldScreenLetter);
  const keyedOptionGradedWrong = keyIndex < 0 ? false : sent[keyIndex] !== key;
  const otherOptionGradedRight = sent.some((s, i) => i !== keyIndex && String(list[i] ?? "").trim() !== "" && s === key);
  const sharedLetter = new Set(sent).size !== sent.length;
  return { keyedOptionGradedWrong, otherOptionGradedRight, sharedLetter };
}
