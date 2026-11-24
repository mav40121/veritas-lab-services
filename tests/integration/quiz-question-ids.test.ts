// tests/integration/quiz-question-ids.test.ts
//
// Redington, 2026-11-19: a retake of the Microbiology Annual Quiz still read "Wrong" on two questions whose chosen option was
// the key. The quiz had two questions with id "q8" and two with "q9" (Edit Quiz gave a new question "q<count + 1>" on a quiz
// whose ids had gaps), and every answer finds its question by id, so the 8th and 9th were graded against the 6th and 7th's
// keys, and the Take a Quiz screen kept one answer for both. Boots the REAL routes on a scratch DB with made-up people and proves:
//   1. a quiz stored with repeated ids (as one was before) grades each question against its own key
//   2. the same answer sent twice counts once (it can't pass a quiz by repetition)
//   1c. an attempt by a person with no VeritaComp employee saves, adds no employee row and prints no warning (BUG-181)
//   3. a staff attempt with a question unanswered, or answered with a letter that isn't one of its choices, is refused with
//      400 QUIZ_UNANSWERED naming the question, and nothing is stored
//   4. the evaluator's quiz on a record is graded the same way (each question against its own key)
//   5. create, edit and the admin upload store every id unique, the first question keeping its id
//   6. the admin audit lists the quiz with repeated ids, and the new id each repeat would get, read-only
//   7. the repair is a dry run unless dryRun false with the dry run's total (409 COUNT_CHANGED otherwise), changes only the
//      repeats' ids, leaves attempts as recorded, writes one audit row, and a second run finds nothing
// Run: npm run test:quiz-question-ids
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
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body: unknown, token?: string, labHeader?: number, admin = false) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    if (admin) headers["x-admin-secret"] = ADMIN;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string) => {
    const email = `qid-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `QID ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const member = (lab: number, userId: number) => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, now, now, now);
  const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, now, perms, `qid-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);

  try {
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), SAM = await register("Sam");
    const labA = Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Question Id Lab", plan: "hospital" }) })).json()).labId);
    const L = `/api/labs/${labA}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Question Id Lab", cliaNumber: "11D7654394", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const samId = Number((await call("POST", `${L}/staff/employees`, { lastName: "Repeat", firstName: "Sam", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labA, SAM.id); seat(OWNER.id, labA, SAM, "staff_portal", '{"mode":"view_all"}', samId);
    const prog = Number((await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, OWNER.token, labA)).j.id);

    // The quiz's shape on production: ids q1, q3, then "q8" and "q9" twice each, with different keys.
    const REPEATED = [
      { id: "q1", question: "Made-up one?", options: ["True", "False"], correct_answer: "A" },
      { id: "q3", question: "Made-up three?", options: ["True", "False"], correct_answer: "A" },
      { id: "q8", question: "Made-up eight, first?", options: ["True", "False"], correct_answer: "A" },
      { id: "q9", question: "Made-up nine, first?", options: ["True", "False"], correct_answer: "A" },
      { id: "q8", question: "Made-up eight, second?", options: ["True", "True if quick", "False", ""], correct_answer: "B" },
      { id: "q9", question: "Made-up nine, second?", options: ["Plant it", "Plant around it", "New plate", ""], correct_answer: "C" },
    ];
    const made = await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Repeated Ids", questions: [{ id: "q1", question: "x?", options: ["A", "B"], correct_answer: "A" }] }, EDITOR.token, labA);
    const quizId = Number(made.j.id);
    // Stored as it was before this rule (straight to the row; every write route now re-ids repeats).
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ?, questions = ? WHERE id = ?").run(labA, JSON.stringify(REPEATED), quizId);
    await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId] }, EDITOR.token, labA);
    const openAssignment = () => (sqlite.prepare("SELECT id FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ? AND status = 'assigned' ORDER BY attempt_no DESC LIMIT 1").get(quizId, samId) as any)?.id;
    const submit = (answers: unknown[]) => call("POST", `/api/staff-portal-session/quizzes/${openAssignment()}/attempt`, { employee_id: samId, answers, typed_signature: "Made Up" }, SAM.token);
    const resultsCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_quiz_results WHERE quiz_id = ?").get(quizId) as any).n);

    // 3 first (nothing stored), then 1.
    const before3 = resultsCount();
    const missing = await submit(REPEATED.slice(0, 5).map((q) => ({ question_id: q.id, selected_answer: q.correct_answer })));
    check("3a. a question with no answer is refused: 400 QUIZ_UNANSWERED naming question 6, nothing stored",
      missing.s === 400 && missing.j.code === "QUIZ_UNANSWERED" && JSON.stringify(missing.j.questions) === "[6]" && /question 6\b/.test(missing.j.error) && resultsCount() === before3,
      `${missing.s} ${JSON.stringify(missing.j)}`);
    const notAChoice = await submit(REPEATED.map((q, i) => ({ question_id: q.id, selected_answer: i === 3 ? "C" : q.correct_answer })));
    check("3b. a letter that isn't one of the question's choices (C on a two-choice question) counts as unanswered",
      notAChoice.s === 400 && notAChoice.j.code === "QUIZ_UNANSWERED" && JSON.stringify(notAChoice.j.questions) === "[4]" && resultsCount() === before3,
      `${notAChoice.s} ${JSON.stringify(notAChoice.j)}`);
    const blankChoice = await submit(REPEATED.map((q, i) => ({ question_id: q.id, selected_answer: i === 4 ? "D" : q.correct_answer })));
    check("3c. the letter of a blank option (D, an unused slot) counts as unanswered", blankChoice.s === 400 && JSON.stringify(blankChoice.j.questions) === "[5]", `${blankChoice.s} ${JSON.stringify(blankChoice.j)}`);

    // 2 (a failed attempt first, so a retake can follow).
    const twice = await submit([...REPEATED.map((q, i) => ({ question_id: q.id, selected_answer: i === 0 ? "B" : q.correct_answer })), { question_id: "q3", selected_answer: "A" }]);
    check("2. a repeated answer counts once: one wrong of six reads 83% and Fail, never 100%",
      twice.s === 200 && twice.j.score === 83 && twice.j.passed === false, `${twice.s} ${JSON.stringify(twice.j).slice(0, 160)}`);
    const retake = await call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, { staff_employee_id: samId }, EDITOR.token, labA);
    check("2b. (setup) the retake opens", retake.s === 200 || retake.s === 201, `${retake.s} ${JSON.stringify(retake.j).slice(0, 120)}`);

    const employees = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_employees WHERE lab_id = ?").get(labA) as any).n);
    const employeesBefore = employees(), warned: string[] = [], warn = console.warn;
    console.warn = (...a: any[]) => { warned.push(a.map(String).join(" ")); warn(...a); };
    const right = await submit(REPEATED.map((q) => ({ question_id: q.id, selected_answer: q.correct_answer })));
    console.warn = warn;
    const stored = sqlite.prepare("SELECT answers, score, passed, employee_id, staff_employee_id FROM competency_quiz_results WHERE id = ?").get(right.j.id) as any;
    check("1c. the attempt is stored under the roster person, with no VeritaComp employee made and no warning",
      Number(stored?.staff_employee_id) === samId && Number(stored?.employee_id) === 0 && employees() === employeesBefore && !warned.some((w) => /staff-portal quiz attempt/.test(w)),
      `${JSON.stringify({ e: stored?.employee_id, s: stored?.staff_employee_id })} employees ${employeesBefore} -> ${employees()} warned ${warned.join(" | ").slice(0, 160)}`);
    const marks = JSON.parse(stored?.answers || "[]").map((a: any) => a.correct);
    check("1a. every key chosen on a quiz with repeated ids: 100%, Pass, each answer stored right (the 5th and 6th were Wrong before)",
      right.s === 200 && right.j.score === 100 && right.j.passed === true && stored?.score === 100 && marks.length === 6 && marks.every((m: boolean) => m === true),
      `${right.s} ${JSON.stringify(right.j).slice(0, 160)} ${JSON.stringify(marks)}`);
    const review = right.j.questions || [];
    check("1b. the review pairs each question with its own answer", review.length === 6 && review.every((q: any, i: number) => q.selected_answer === REPEATED[i].correct_answer && q.was_correct === true),
      JSON.stringify(review.map((q: any) => [q.id, q.selected_answer, q.was_correct])));

    // 4.
    // A competency person for the evaluator's record (made up, in this lab).
    const compEmp = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, title, status, created_at, lab_id, staff_employee_id) VALUES (?, 'Sam Repeat', 'Made-up Tech', 'active', ?, ?, ?)")
      .run(OWNER.id, now, labA, samId).lastInsertRowid);
    const onRecord = await call("POST", "/api/veritacomp/quiz-results", { quizId, employeeId: compEmp, answers: REPEATED.map((q) => ({ question_id: q.id, selected_answer: q.correct_answer })) }, EDITOR.token, labA);
    check("4. the evaluator's quiz on a record grades each repeated question against its own key (100%)", onRecord.s === 200 && onRecord.j.score === 100 && onRecord.j.passed === true,
      `${onRecord.s} ${JSON.stringify(onRecord.j).slice(0, 200)}`);

    // 6 and 7 before 5 (5 writes through the routes, which would fix the quiz).
    const audit = await call("GET", "/api/admin/veritacomp/quiz-question-id-audit", undefined, undefined, undefined, true);
    const mine = (audit.j.quizzes || []).find((q: any) => q.quizId === quizId);
    check("6a. the audit lists the quiz with its repeated ids and the new id each repeat would get",
      audit.s === 200 && !!mine && JSON.stringify(mine.repeatedIds) === '["q8","q9"]'
      && JSON.stringify(mine.changes) === JSON.stringify([{ position: 5, from: "q8", to: "q10" }, { position: 6, from: "q9", to: "q11" }])
      && mine.labId === labA && mine.attempts.length === resultsCount(),
      JSON.stringify(mine));
    check("6b. the audit needs the admin header and changes nothing",
      (await call("GET", "/api/admin/veritacomp/quiz-question-id-audit", undefined)).s === 403
      && (sqlite.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId) as any).questions === JSON.stringify(REPEATED));
    const resultsBefore = JSON.stringify(sqlite.prepare("SELECT id, answers, score, passed FROM competency_quiz_results WHERE quiz_id = ? ORDER BY id").all(quizId));
    const dry = await call("POST", "/api/admin/veritacomp/quiz-question-ids/repair", { quizIds: [quizId] }, undefined, undefined, true);
    check("7a. the repair is a dry run by default: total 2, nothing written", dry.s === 200 && dry.j.dryRun === true && dry.j.total === 2
      && (sqlite.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId) as any).questions === JSON.stringify(REPEATED), JSON.stringify(dry.j));
    const wrongTotal = await call("POST", "/api/admin/veritacomp/quiz-question-ids/repair", { quizIds: [quizId], dryRun: false, expectedTotal: 3 }, undefined, undefined, true);
    const noTotal = await call("POST", "/api/admin/veritacomp/quiz-question-ids/repair", { quizIds: [quizId], dryRun: false }, undefined, undefined, true);
    check("7b. applying with another total is 409 COUNT_CHANGED, without one 400, nothing written",
      wrongTotal.s === 409 && wrongTotal.j.code === "COUNT_CHANGED" && noTotal.s === 400 && noTotal.j.code === "EXPECTED_TOTAL_REQUIRED"
      && (sqlite.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId) as any).questions === JSON.stringify(REPEATED), `${wrongTotal.s} ${noTotal.s}`);
    const auditRowsBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_question_ids'").get() as any).n);
    const applied = await call("POST", "/api/admin/veritacomp/quiz-question-ids/repair", { quizIds: [quizId], dryRun: false, expectedTotal: 2 }, undefined, undefined, true);
    const after = JSON.parse((sqlite.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId) as any).questions);
    check("7c. applied: the repeats get q10 and q11, every other id and every key, option and question text unchanged",
      applied.s === 200 && applied.j.dryRun === false && applied.j.total === 2
      && JSON.stringify(after.map((q: any) => q.id)) === '["q1","q3","q8","q9","q10","q11"]'
      && after.every((q: any, i: number) => q.question === REPEATED[i].question && q.correct_answer === REPEATED[i].correct_answer && JSON.stringify(q.options) === JSON.stringify(REPEATED[i].options)),
      `${applied.s} ${JSON.stringify(after.map((q: any) => q.id))}`);
    const row = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'quiz_question_ids' ORDER BY id DESC LIMIT 1").get() as any;
    check("7d. attempts on file are left as recorded, and one audit row (user 0) holds the ids before and after",
      JSON.stringify(sqlite.prepare("SELECT id, answers, score, passed FROM competency_quiz_results WHERE quiz_id = ? ORDER BY id").all(quizId)) === resultsBefore
      && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_question_ids'").get() as any).n) === auditRowsBefore + 1
      && row?.user_id === 0 && row?.entity_id === String(quizId) && JSON.parse(row.before_json).ids[4] === "q8" && JSON.parse(row.after_json).ids[4] === "q10",
      JSON.stringify(row).slice(0, 240));
    const again = await call("POST", "/api/admin/veritacomp/quiz-question-ids/repair", { quizIds: [quizId] }, undefined, undefined, true);
    check("7e. a second run finds nothing", again.s === 200 && again.j.total === 0, JSON.stringify(again.j));

    // 5.
    const idsOf = (id: number) => JSON.parse((sqlite.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(id) as any).questions).map((q: any) => q.id);
    const created = await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Create", questions: REPEATED }, EDITOR.token, labA);
    check("5a. create stores every id unique, the first question with an id keeping it", created.s === 200 || created.s === 201
      ? JSON.stringify(idsOf(Number(created.j.id))) === '["q1","q3","q8","q9","q10","q11"]' : false, `${created.s} ${JSON.stringify(idsOf(Number(created.j.id)))}`);
    const edited = await call("PUT", `/api/veritacomp/quizzes/${created.j.id}`, { title: "Made-up Create", questions: [...REPEATED, { ...REPEATED[0] }] }, EDITOR.token, labA);
    check("5b. edit does the same (a copy of question 1 added at the end gets q10... the next free id)", edited.s === 200
      && JSON.stringify(idsOf(Number(created.j.id))) === '["q1","q3","q8","q9","q10","q11","q12"]', `${edited.s} ${JSON.stringify(idsOf(Number(created.j.id)))}`);
    const uploaded = await call("POST", "/api/admin/competency-quizzes/upload", { secret: ADMIN, programId: prog, title: "Made-up Upload", questions: REPEATED });
    const upId = Number(uploaded.j.id ?? uploaded.j.quizId);
    check("5c. the admin upload does the same", uploaded.s < 300 && JSON.stringify(idsOf(upId)) === '["q1","q3","q8","q9","q10","q11"]', `${uploaded.s} ${JSON.stringify(uploaded.j).slice(0, 120)}`);
    const adminPut = await call("PUT", `/api/admin/competency-quizzes/${upId}`, { secret: ADMIN, title: "Made-up Upload", questions: [...REPEATED, { ...REPEATED[1] }] });
    check("5d. the admin edit does the same", adminPut.s < 300 && JSON.stringify(idsOf(upId)) === '["q1","q3","q8","q9","q10","q11","q12"]', `${adminPut.s} ${JSON.stringify(idsOf(upId))}`);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
