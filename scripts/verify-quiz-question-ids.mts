// scripts/verify-quiz-question-ids.mts
//
// Receipt for unique quiz question ids and one-answer-per-question grading (Redington 2026-11-19; shared/quizQuestionIds.ts,
// shared/quizGrading.ts). The known input is production quiz 14's shape (ids and keys only, read through the admin path on
// 2026-11-19): ids q1, q3, q5, q6, q7, q8, q9, q8, q9, q10, q11, and the 11/19 attempt's letters. Exits 1 on any failure.
// Run: npx tsx scripts/verify-quiz-question-ids.mts
import { nextQuestionId, withUniqueQuestionIds, repeatedQuestionIds } from "../shared/quizQuestionIds";
import { gradeQuizAnswers, isChoiceOf, unansweredMessage } from "../shared/quizGrading";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const two = ["True", "False"], three = ["One", "Two", "Three", ""], four = ["One", "Two", "Three", "Four"];

// Quiz 14 as stored on production (option text replaced; counts of non-blank options kept).
const Q14 = [
  { id: "q1", options: two, correct_answer: "A" }, { id: "q3", options: two, correct_answer: "A" },
  { id: "q5", options: two, correct_answer: "A" }, { id: "q6", options: two, correct_answer: "A" },
  { id: "q7", options: four, correct_answer: "B" }, { id: "q8", options: two, correct_answer: "A" },
  { id: "q9", options: two, correct_answer: "A" }, { id: "q8", options: three, correct_answer: "B" },
  { id: "q9", options: three, correct_answer: "C" }, { id: "q10", options: ["One", "Two", "", ""], correct_answer: "B" },
  { id: "q11", options: ["One", "Two", "", ""], correct_answer: "B" },
];

// nextQuestionId
check("1a. on q1, q3, q4 the next id is q5 (the old count + 1 rule gave q4, a repeat)", nextQuestionId([{ id: "q1" }, { id: "q3" }, { id: "q4" }]) === "q5");
check("1b. on quiz 14 the next id is q12", nextQuestionId(Q14) === "q12");
check("1c. on no questions it is q1; on ids that aren't q<number> it is q<count + 1>", nextQuestionId([]) === "q1" && nextQuestionId([{ id: "a" }, { id: "b" }]) === "q3");
check("1d. it never returns a taken id, even one that isn't the highest", nextQuestionId([{ id: "q3" }, { id: "x" }, { id: "q4" }]) === "q5");

// withUniqueQuestionIds
const fixed = withUniqueQuestionIds(Q14);
check("2a. quiz 14: the 8th and 9th questions (the repeats) get q12 and q13; everyone else keeps their id",
  JSON.stringify(fixed.questions.map((q) => q.id)) === '["q1","q3","q5","q6","q7","q8","q9","q12","q13","q10","q11"]',
  JSON.stringify(fixed.questions.map((q) => q.id)));
check("2b. it lists the two changes by position", JSON.stringify(fixed.changes) === JSON.stringify([{ index: 7, from: "q8", to: "q12" }, { index: 8, from: "q9", to: "q13" }]), JSON.stringify(fixed.changes));
check("2c. keys and options are unchanged, and the input isn't modified", fixed.questions.every((q, i) => q.correct_answer === Q14[i].correct_answer && q.options === Q14[i].options) && Q14[7].id === "q8");
const blanks = withUniqueQuestionIds([{ id: "" }, { id: "q1" }, {}]).questions.map((q: any) => q.id);
check("2d. a blank or missing id gets a free one (past the count, so never one a later question holds)", JSON.stringify(blanks) === '["q4","q1","q5"]', JSON.stringify(blanks));
check("2e. unique ids are left alone", withUniqueQuestionIds([{ id: "q1" }, { id: "q2" }]).changes.length === 0);
check("2f. repeatedQuestionIds names q8 and q9 on quiz 14, none once fixed", JSON.stringify(repeatedQuestionIds(Q14)) === '["q8","q9"]' && repeatedQuestionIds(fixed.questions).length === 0);

// gradeQuizAnswers on the stored (repeated) shape
const keys = Q14.map((q) => ({ question_id: q.id, selected_answer: q.correct_answer }));
const allRight = gradeQuizAnswers(Q14, keys);
check("3a. every key chosen on quiz 14 as stored scores 100% and Pass (the old rule scored 82%: questions 8 and 9 read Wrong)",
  allRight.score === 100 && allRight.passed && allRight.graded.every((g) => g.correct) && allRight.unanswered.length === 0, JSON.stringify(allRight));
// The 11/19 attempt's letters: on the old screen a pick on question 8 or 9 replaced 6 or 7's (shared id), so 6 held B and 7 held C.
const attempt = ["A", "A", "A", "A", "B", "B", "C", "B", "C", "B", "B"].map((s, i) => ({ question_id: Q14[i].id, selected_answer: s }));
const old = attempt.filter((a) => { const q = Q14.find((qq) => qq.id === a.question_id)!; return a.selected_answer === q.correct_answer; }).length;
const now = gradeQuizAnswers(Q14, attempt);
check("3b. that attempt: the old rule's 7 of 11 (64%, stored) against the new rule's 9 of 11 (82%); questions 6 and 7 stay wrong (their answers were overwritten), 8 and 9 read right",
  old === 7 && now.correct === 9 && now.score === 82 && JSON.stringify(now.graded.map((g) => g.correct)) === JSON.stringify([true, true, true, true, true, false, false, true, true, true, true]),
  `${old} ${now.correct} ${JSON.stringify(now.graded.map((g) => g.correct))}`);
check("3c. question 7 held C, which isn't one of its two choices: it counts as unanswered (the stop the lab asked for)", JSON.stringify(now.unanswered) === "[7]", JSON.stringify(now.unanswered));
const repeated = gradeQuizAnswers([{ id: "q1", options: two, correct_answer: "A" }, { id: "q2", options: two, correct_answer: "B" }], [{ question_id: "q1", selected_answer: "A" }, { question_id: "q1", selected_answer: "A" }]);
check("3d. the same right answer sent twice counts once: 50% and question 2 unanswered (the old rule scored 100%, Pass)", repeated.score === 50 && !repeated.passed && JSON.stringify(repeated.unanswered) === "[2]", JSON.stringify(repeated));
const shuffled = gradeQuizAnswers(fixed.questions, [...fixed.questions].reverse().map((q) => ({ question_id: q.id, selected_answer: q.correct_answer })));
check("3e. answers in another order (a randomized quiz) still pair by id: 100%", shuffled.score === 100 && shuffled.byQuestion.every((g, i) => g?.question_id === fixed.questions[i].id));
check("3f. a number id matches its string form, as the old screens sent", gradeQuizAnswers([{ id: 7, options: two, correct_answer: "A" }], [{ question_id: "7", selected_answer: "A" }]).score === 100);
const none = gradeQuizAnswers(Q14, []);
check("3g. no answers: 0%, every question unanswered", none.score === 0 && none.unanswered.length === 11);

// isChoiceOf and the message
check("4a. isChoiceOf: A and B on a two-choice question; not C, not a blank option's D, not lowercase", isChoiceOf(Q14[0], "A") && isChoiceOf(Q14[0], "B") && !isChoiceOf(Q14[0], "C") && !isChoiceOf(Q14[7], "D") && !isChoiceOf(Q14[0], "a") && !isChoiceOf(Q14[0], ""));
check("4b. the message names one question or several", unansweredMessage([7]) === "Answer every question before submitting. Not answered: question 7." && unansweredMessage([2, 5]) === "Answer every question before submitting. Not answered: questions 2, 5.");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
