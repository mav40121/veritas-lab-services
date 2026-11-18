// scripts/verify-quiz-option-letters.mts
//
// Redington 2026-11-18: two quizzes brought over from MediaLab graded every pick wrong. The answer key names an option by
// position (A = first); the quiz screens took each option's first character as its letter, so an option typed "True" sent
// "T". shared/quizOptions.ts is the rule now. Pins:
//   1. the letter is the position, whatever the option's text starts with; a blank option is left out without moving the
//      letters after it;
//   2. picking the keyed option on a True/False and a plain-text question grades right by position, and the old rule
//      graded it wrong (the bug, on the shape of the reported quizzes);
//   3. a quiz typed "A. ...", "B. ..." grades the same under both rules (nothing moves for it);
//   4. optionIndexFor reads a new answer by position and an answer saved before by first character;
//   5. checkQuestionLetters and scoreByPosition (the admin audit) on known questions.
// Run: npx tsx scripts/verify-quiz-option-letters.mts
import { optionLetter, shownOptions, optionIndexFor, oldScreenLetter, checkQuestionLetters } from "../shared/quizOptions";
import { scoreByPosition } from "../server/quizLetterAudit";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`); if (!ok) failures++; };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// The server's grading, unchanged: an answer is right when it equals the key.
const grade = (sent: string, key: string) => sent === key;
// What each screen sent for the option at index i.
const newSent = (options: string[], i: number) => shownOptions(options).find((o) => o.index === i)?.letter ?? "";
const oldSent = (options: string[], i: number) => oldScreenLetter(options[i]);

// 1. Letters by position.
check("1a. optionLetter 0..3 is A..D", eq([0, 1, 2, 3].map(optionLetter), ["A", "B", "C", "D"]));
check("1b. True/False options get A and B", eq(shownOptions(["True", "False"]).map((o) => o.letter), ["A", "B"]));
check("1c. options starting alike get their own letters", eq(shownOptions(["Image A", "Image B"]).map((o) => o.letter), ["A", "B"]));
check("1d. blank slots are left out and the letters before them stay", eq(shownOptions(["A. Yes", "B. No", "", "  "]).map((o) => [o.letter, o.text]), [["A", "A. Yes"], ["B", "B. No"]]));
check("1e. a blank in the middle doesn't move the next letter", eq(shownOptions(["One", "", "Three"]).map((o) => o.letter), ["A", "C"]));
check("1f. no options gives nothing", eq(shownOptions(undefined), []) && eq(shownOptions(null), []));

// 2. The reported shapes: key by position, options as plain text.
const tf = { options: ["True", "False"], key: "A" };
check("2a. True/False keyed A: picking True grades right now", grade(newSent(tf.options, 0), tf.key));
check("2b. ... and the old rule graded it wrong (sent T)", !grade(oldSent(tf.options, 0), tf.key) && oldSent(tf.options, 0) === "T");
const plain = { options: ["Artifact", "Gram-positive cocci", "Yeast", "Budding forms"], key: "C" };
check("2c. a plain-text question keyed C: picking the third option grades right now", grade(newSent(plain.options, 2), plain.key));
check("2d. ... the old rule sent Y for it", oldSent(plain.options, 2) === "Y" && !grade(oldSent(plain.options, 2), plain.key));
check("2e. no other option grades right now", [0, 1, 3].every((i) => !grade(newSent(plain.options, i), plain.key)));
const twins = { options: ["Image A", "Image B"], key: "B" };
check("2f. two options starting alike: the second grades right and the first doesn't", grade(newSent(twins.options, 1), "B") && !grade(newSent(twins.options, 0), "B"));
check("2g. ... the old rule sent I for both", oldSent(twins.options, 0) === "I" && oldSent(twins.options, 1) === "I");

// 3. A quiz typed with letters grades the same under both rules.
const lettered = ["A. Lymphocyte", "B. Neutrophil", "C. Monocyte", "D. Eosinophil"];
check("3a. a lettered question: each option sends the same letter under both rules", lettered.every((_, i) => newSent(lettered, i) === oldSent(lettered, i)));
check("3b. ... and its check finds nothing", eq(checkQuestionLetters(lettered, "C"), { keyedOptionGradedWrong: false, otherOptionGradedRight: false, sharedLetter: false }));

// 4. Reading a stored answer back.
check("4a. a new answer B reads as the second option", optionIndexFor(["True", "False"], "B") === 1);
check("4b. an answer saved before, T, reads as True", optionIndexFor(["True", "False"], "T") === 0);
check("4c. an answer saved before, F, reads as False", optionIndexFor(["True", "False"], "F") === 1);
check("4d. nothing matching gives -1, blank gives -1", optionIndexFor(["True", "False"], "Z") === -1 && optionIndexFor(["True", "False"], "") === -1 && optionIndexFor(["True", "False"], null) === -1);
check("4e. the key reads by position on a lettered question", optionIndexFor(lettered, "C") === 2);

// 5. The audit's question check and re-score.
check("5a. True/False keyed A: the keyed option graded wrong", checkQuestionLetters(["True", "False"], "A").keyedOptionGradedWrong === true);
check("5b. options starting alike share a letter", checkQuestionLetters(["Image A", "Image B"], "B").sharedLetter === true);
check("5c. a wrong option that starts with the key's letter graded right (Bacteria for key B; Cocci, Artifact for key A)", checkQuestionLetters(["Bacteria", "Artifact"], "B").otherOptionGradedRight === true && checkQuestionLetters(["Cocci", "Artifact"], "A").otherOptionGradedRight === true);
check("5c2. ... and not when only the keyed option starts with it", checkQuestionLetters(["Artifact", "Budding", "Cocci"], "A").otherOptionGradedRight === false);
const qs = [
  { id: "q1", options: ["True", "False"], correct_answer: "A" },
  { id: "q2", options: ["True", "False"], correct_answer: "B" },
  { id: "q3", options: ["Applying iodine", "Overdecolorizing", "Rinsing", "Air drying"], correct_answer: "B" },
  { id: "q4", options: ["Image A", "Image B"], correct_answer: "B" },
];
// An attempt saved under the old rule: True, False, Overdecolorizing, Image (one of the two).
const oldAnswers = [{ question_id: "q1", selected_answer: "T" }, { question_id: "q2", selected_answer: "F" }, { question_id: "q3", selected_answer: "O" }, { question_id: "q4", selected_answer: "I" }];
const s = scoreByPosition(qs, oldAnswers);
check("5d. re-scored by position: 3 of 4 right (q4 ambiguous) = 75, one ambiguous", s.score === 75 && s.ambiguous === 1, JSON.stringify(s));
const oldGrade = Math.round((qs.filter((q) => oldAnswers.find((a) => a.question_id === q.id)?.selected_answer === q.correct_answer).length / qs.length) * 100);
check("5e. ... where the old rule stored 0", oldGrade === 0, String(oldGrade));
const newAnswers = [{ question_id: "q1", selected_answer: "A" }, { question_id: "q2", selected_answer: "B" }, { question_id: "q3", selected_answer: "B" }, { question_id: "q4", selected_answer: "B" }];
check("5f. an attempt saved by position re-scores to its own score (100)", scoreByPosition(qs, newAnswers).score === 100);

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
