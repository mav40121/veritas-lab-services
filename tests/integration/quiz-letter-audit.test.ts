// tests/integration/quiz-letter-audit.test.ts
//
// Redington, 2026-11-18: two quizzes brought over from MediaLab graded every pick wrong, because the quiz screens sent each
// option's first character while the answer key names options by position (shared/quizOptions.ts). Boots the REAL routes on
// a scratch DB with made-up quizzes and proves GET /api/admin/veritacomp/quiz-letter-audit:
//   1. answers 403 without the header
//   2. leaves out a quiz whose options are typed "A. ...", "B. ..." (the old rule graded it right)
//   3. lists a quiz with plain-text options: questions whose keyed option was graded wrong, where a wrong option was graded
//      right, and where two options sent one letter
//   4. re-scores an attempt saved under the old rule by position (an ambiguous answer counts as not right), keeps its stored
//      score beside it, and leaves out an attempt recorded at or after `before`, which is required
//   5. the totals, and it writes nothing
// Run: npm run test:quiz-letter-audit
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { headers });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const n = (sql: string) => Number((sqlite.prepare(sql).get() as any).n);

  try {
    const now = "2026-11-18T12:00:00.000Z";
    const addQuiz = (labId: number, questions: unknown[]) => Number(sqlite.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, questions, created_at, title, lab_id) VALUES (1, NULL, ?, ?, 'Made-up quiz', ?)",
    ).run(JSON.stringify(questions), now, labId).lastInsertRowid);
    const addResult = (quizId: number, answers: unknown[], score: number, createdAt: string) => Number(sqlite.prepare(
      "INSERT INTO competency_quiz_results (quiz_id, employee_id, answers, score, passed, date_taken, created_at, source) VALUES (?, 1, ?, ?, ?, '2026-11-17', ?, 'staff_portal')",
    ).run(quizId, JSON.stringify(answers), score, score === 100 ? 1 : 0, createdAt).lastInsertRowid);

    const lettered = addQuiz(901, [
      { id: "q1", question: "Made-up one", options: ["A. Lymphocyte", "B. Neutrophil", "C. Monocyte", "D. Eosinophil"], correct_answer: "C" },
      { id: "q2", question: "Made-up two", options: ["A. Yes", "B. No"], correct_answer: "A" },
    ]);
    addResult(lettered, [{ question_id: "q1", selected_answer: "C" }, { question_id: "q2", selected_answer: "A" }], 100, "2026-11-17T10:00:00.000Z");
    const plain = addQuiz(902, [
      { id: "q1", question: "Made-up true or false", options: ["True", "False"], correct_answer: "A" },
      { id: "q2", question: "Made-up slide pick", options: ["Image A", "Image B"], correct_answer: "B" },
      { id: "q3", question: "Made-up budding form", options: ["Artifact", "Gram-positive cocci", "Yeast", "Bacilli"], correct_answer: "C" },
      { id: "q4", question: "Made-up wrong letter", options: ["Cocci", "Artifact"], correct_answer: "A" },
    ]);
    // Saved under the old rule: True (T), Image B (I, which Image A also sent), Yeast (Y), Artifact (A, the key's letter).
    const oldAttempt = addResult(plain, [
      { question_id: "q1", selected_answer: "T" }, { question_id: "q2", selected_answer: "I" },
      { question_id: "q3", selected_answer: "Y" }, { question_id: "q4", selected_answer: "A" },
    ], 25, "2026-11-17T11:00:00.000Z");
    // Saved after the fix, by position: left out when `before` is earlier.
    const newAttempt = addResult(plain, [
      { question_id: "q1", selected_answer: "A" }, { question_id: "q2", selected_answer: "B" },
      { question_id: "q3", selected_answer: "C" }, { question_id: "q4", selected_answer: "A" },
    ], 100, "2026-11-19T09:00:00.000Z");
    const before = { quizzes: n("SELECT COUNT(*) AS n FROM competency_quizzes"), results: n("SELECT COUNT(*) AS n FROM competency_quiz_results"), audit: n("SELECT COUNT(*) AS n FROM audit_log") };

    // 1.
    const noHeader = await get("/api/admin/veritacomp/quiz-letter-audit");
    check("1. 403 without the header", noHeader.s === 403, String(noHeader.s));

    const r = await get("/api/admin/veritacomp/quiz-letter-audit?before=2026-11-18T18:00:00.000Z", { "x-admin-secret": ADMIN });
    check("audit answers 200", r.s === 200, String(r.s));
    const ids = (r.j.quizzes || []).map((q: any) => q.quizId);

    // 2.
    check("2. a quiz typed with letters isn't listed", !ids.includes(lettered), JSON.stringify(ids));

    // 3.
    const p = (r.j.quizzes || []).find((q: any) => q.quizId === plain);
    check("3a. the plain-text quiz is listed with its lab and question count", !!p && p.labId === 902 && p.questions === 4, JSON.stringify(p));
    check("3b. all four questions graded the keyed option wrong (True sent T, Image B sent I, Yeast sent Y, Cocci sent C)",
      p?.keyedOptionGradedWrong === 4, String(p?.keyedOptionGradedWrong));
    check("3c. one question graded a wrong option right (Artifact sent the key's A)", p?.otherOptionGradedRight === 1, String(p?.otherOptionGradedRight));
    check("3d. one question had two options sending one letter (Image A, Image B)", p?.sharedLetter === 1, String(p?.sharedLetter));

    // 4.
    const att = p?.attempts || [];
    const o = att.find((a: any) => a.resultId === oldAttempt);
    check("4a. only the attempt recorded before `before` is read", att.length === 1 && !!o && !att.some((a: any) => a.resultId === newAttempt), JSON.stringify(att.map((a: any) => a.resultId)));
    check("4b. its stored score (25) stays beside its score by position: True and Yeast right, Image ambiguous, Artifact wrong = 50",
      o?.storedScore === 25 && o?.scoreByPosition === 50 && o?.ambiguousAnswers === 1 && o?.passedByPosition === false, JSON.stringify(o));
    // An attempt saved by position, read back by the old rule, would be misread (Artifact for A), so the cutover is required.
    const noBefore = await get("/api/admin/veritacomp/quiz-letter-audit", { "x-admin-secret": ADMIN });
    check("4c. without `before` (when the fix went live) it is 400 BEFORE_REQUIRED", noBefore.s === 400 && noBefore.j.code === "BEFORE_REQUIRED", JSON.stringify(noBefore));

    // 5.
    check("5a. totals: the plain quiz affected in lab 902, one attempt whose score would change, none would pass, one ambiguous",
      r.j.quizzesAffected >= 1 && (r.j.labsAffected || []).includes(902) && !(r.j.labsAffected || []).includes(901)
      && r.j.attemptsOnAffected === 1 && r.j.attemptsScoreWouldChange === 1 && r.j.attemptsWouldPass === 0 && r.j.attemptsWithAmbiguousAnswers === 1,
      JSON.stringify({ a: r.j.quizzesAffected, labs: r.j.labsAffected, on: r.j.attemptsOnAffected, ch: r.j.attemptsScoreWouldChange, p: r.j.attemptsWouldPass, amb: r.j.attemptsWithAmbiguousAnswers }));
    check("5b. no names, emails or answers in the answer", !/Made-up|selected_answer|@/.test(JSON.stringify(r.j)));
    const after = { quizzes: n("SELECT COUNT(*) AS n FROM competency_quizzes"), results: n("SELECT COUNT(*) AS n FROM competency_quiz_results"), audit: n("SELECT COUNT(*) AS n FROM audit_log") };
    check("5c. it writes nothing", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
