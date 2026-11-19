// tests/integration/quiz-auto-retake.test.ts
//
// Redington, 2026-11-18 (Michael Q3 = 1): "Can we make the quiz reset happen automatically?" A per-quiz setting, off by default:
// a failed attempt on a staff login opens the next attempt at once, and that failed attempt's review leaves out the correct
// answers, so the retake can't be passed by copying the key. Boots the REAL routes on a scratch DB with made-up people and proves:
//   1. competency_quizzes.auto_retake, default 0
//   2. create stores it (on when asked, off otherwise) and the program's quiz list carries it
//   3. edit keeps it when the body leaves it out, and turns it off and on when sent
//   4. a failed attempt on an auto-retake quiz: no correct answers or explanations in the review, each question still marked
//      right or wrong, attempt 2 open with the same due date, opened by the system (assigned_by_user_id 0), one audit row
//   5. submitting attempt 1 again opens nothing more
//   6. passing attempt 2: the full review comes back, no attempt 3
//   7. a quiz with the setting off: the full review as before and no automatic attempt
//   8. someone off the lab's active roster gets no automatic attempt
//   9. the evaluator's Results still has every answer, and offers no retake while the automatic one is open
// Run: npm run test:quiz-auto-retake
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
  const call = async (method: string, path: string, body: unknown, token?: string, labHeader?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string) => {
    const email = `qar-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `QAR ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now);
  const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, now, perms, `qar-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);

  try {
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), SAM = await register("Sam"), ZED = await register("Zed"), GUS = await register("Gus");
    const labA = Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Auto Retake Lab", plan: "hospital" }) })).json()).labId);
    const L = `/api/labs/${labA}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Auto Retake Lab", cliaNumber: "11D7654393", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const person = async (last: string, first: string) =>
      Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const samId = await person("Retrier", "Sam"), zedId = await person("Manual", "Zed"), gusId = await person("Leaving", "Gus");
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    for (const [u, rid] of [[SAM, samId], [ZED, zedId], [GUS, gusId]] as const) { member(labA, u.id); seat(OWNER.id, labA, u, "staff_portal", '{"mode":"view_all"}', rid); }

    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, OWNER.token, labA)).j.id;
    const QUESTIONS = [
      { id: "q1", question: "Made-up one?", options: ["True", "False"], correct_answer: "A", explanation: "Made-up reason one." },
      { id: "q2", question: "Made-up two?", options: ["Image A", "Image B"], correct_answer: "B", explanation: "Made-up reason two." },
    ];
    const madeAuto = await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Auto Quiz", questions: QUESTIONS, autoRetake: true }, EDITOR.token, labA);
    const madeOff = await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Manual Quiz", questions: QUESTIONS }, EDITOR.token, labA);
    const autoId = Number(madeAuto.j.id), offId = Number(madeOff.j.id);
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id IN (?, ?)").run(labA, autoId, offId);
    const stored = (id: number) => Number((sqlite.prepare("SELECT auto_retake FROM competency_quizzes WHERE id = ?").get(id) as any).auto_retake);

    // 1.
    const col = (sqlite.prepare("PRAGMA table_info(competency_quizzes)").all() as any[]).find((c) => c.name === "auto_retake");
    check("1. competency_quizzes.auto_retake exists with default 0", !!col && String(col.dflt_value) === "0", JSON.stringify(col));

    // 2.
    const list = await call("GET", `/api/veritacomp/programs/${prog}/quizzes`, undefined, EDITOR.token, labA);
    const inList = (id: number) => (list.j || []).find((q: any) => q.id === id);
    check("2. create stores it (on when asked, off otherwise) and the program's list carries it",
      madeAuto.j.auto_retake === 1 && madeOff.j.auto_retake === 0 && stored(autoId) === 1 && stored(offId) === 0 && inList(autoId)?.auto_retake === 1 && inList(offId)?.auto_retake === 0,
      JSON.stringify({ a: madeAuto.j.auto_retake, o: madeOff.j.auto_retake, la: inList(autoId)?.auto_retake }));

    // 3.
    const put = (id: number, extra: Record<string, unknown>) => call("PUT", `/api/veritacomp/quizzes/${id}`, { title: "Made-up Auto Quiz", questions: QUESTIONS, ...extra }, EDITOR.token, labA);
    await put(autoId, {});
    const kept = stored(autoId);
    await put(autoId, { autoRetake: false });
    const off = stored(autoId);
    await put(autoId, { autoRetake: true });
    check("3. edit keeps it when left out, and turns it off and back on when sent", kept === 1 && off === 0 && stored(autoId) === 1, JSON.stringify({ kept, off, on: stored(autoId) }));

    // 4.
    await call("POST", `/api/veritacomp/quizzes/${autoId}/assignments`, { staff_employee_ids: [samId, gusId], due_date: "2026-12-15" }, EDITOR.token, labA);
    await call("POST", `/api/veritacomp/quizzes/${offId}/assignments`, { staff_employee_ids: [zedId] }, EDITOR.token, labA);
    const attemptsOf = (quiz: number, sid: number) => sqlite.prepare("SELECT * FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ? ORDER BY attempt_no").all(quiz, sid) as any[];
    const take = async (u: { token: string }, quiz: number, sid: number, picks: string[]) => {
      const l = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, u.token);
      const open = (l.j.quizzes || []).find((q: any) => q.quiz_id === quiz && q.status === "assigned");
      const r = await call("POST", `/api/staff-portal-session/quizzes/${open?.assignment_id}/attempt`, { employee_id: sid, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] })), typed_signature: "Made Up" }, u.token);
      return { ...r, assignmentId: open?.assignment_id };
    };
    const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_retake'").get() as any).n);
    const samFail = await take(SAM, autoId, samId, ["A", "A"]);
    const qs = samFail.j.questions || [];
    check("4a. a failed attempt on an auto-retake quiz: 50%, key hidden, no correct answer or explanation in the review",
      samFail.s === 200 && samFail.j.score === 50 && samFail.j.passed === false && samFail.j.key_hidden === true
      && qs.length === 2 && qs.every((q: any) => !("correct_answer" in q) && !("explanation" in q)),
      JSON.stringify(samFail.j).slice(0, 300));
    check("4b. each question is still marked right or wrong", qs.find((q: any) => q.id === "q1")?.was_correct === true && qs.find((q: any) => q.id === "q2")?.was_correct === false);
    const samRows = attemptsOf(autoId, samId);
    check("4c. attempt 2 is open with the failed one's due date, opened by the system (assigned_by_user_id 0), and the response names it",
      samRows.length === 2 && samRows[1].attempt_no === 2 && samRows[1].status === "assigned" && samRows[1].due_date === samRows[0].due_date && samRows[0].due_date === "2026-12-15"
      && samRows[1].assigned_by_user_id === 0 && samFail.j.next_attempt?.assignment_id === samRows[1].id && samFail.j.next_attempt?.attempt_no === 2,
      JSON.stringify(samRows.map((r) => ({ a: r.attempt_no, s: r.status, d: r.due_date, by: r.assigned_by_user_id }))));
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'quiz_retake' ORDER BY id DESC LIMIT 1").get() as any;
    check("4d. one audit row: a retake created by user 0, marked automatic",
      Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_retake'").get() as any).n) === auditBefore + 1
      && audit?.user_id === 0 && audit?.action === "create" && audit?.entity_id === String(samRows[1].id) && JSON.parse(audit.after_json).assignment.automatic === true && audit?.owner_user_id === OWNER.id,
      JSON.stringify(audit).slice(0, 300));

    // 5.
    const again = await call("POST", `/api/staff-portal-session/quizzes/${samFail.assignmentId}/attempt`, { employee_id: samId, answers: [], typed_signature: "Made Up" }, SAM.token);
    check("5. submitting attempt 1 again returns it as already on record and opens nothing more", again.j.already_completed === true && attemptsOf(autoId, samId).length === 2, `${again.s} ${attemptsOf(autoId, samId).length}`);

    // 9 (while attempt 2 is open).
    const results = await call("GET", `/api/veritacomp/quizzes/${autoId}/results`, undefined, EDITOR.token, labA);
    const samP = (results.j.people || []).find((p: any) => p.staff_employee_id === samId);
    check("9a. the evaluator's Results still has every answer of attempt 1, and the answer key",
      (samP?.attempts?.[0]?.answers || []).length === 2 && (results.j.questions || []).every((q: any) => typeof q.correct_answer === "string"), JSON.stringify(samP?.attempts?.[0]).slice(0, 200));
    check("9b. no retake is offered while the automatic attempt is open", samP?.can_retake === false && samP?.retake_refusal === "RETAKE_OPEN", JSON.stringify({ c: samP?.can_retake, r: samP?.retake_refusal }));

    // 6.
    const samPass = await take(SAM, autoId, samId, ["A", "B"]);
    check("6. passing attempt 2: the full review (correct answers and explanations) and no attempt 3",
      samPass.j.passed === true && samPass.j.key_hidden === false && (samPass.j.questions || []).every((q: any) => typeof q.correct_answer === "string" && typeof q.explanation === "string")
      && samPass.j.next_attempt === null && attemptsOf(autoId, samId).length === 2,
      JSON.stringify(samPass.j).slice(0, 200));

    // 7.
    const zedFail = await take(ZED, offId, zedId, ["B", "A"]);
    check("7. a quiz with the setting off: the full review as before and no automatic attempt",
      zedFail.j.passed === false && zedFail.j.key_hidden === false && (zedFail.j.questions || []).every((q: any) => typeof q.correct_answer === "string") && zedFail.j.next_attempt === null && attemptsOf(offId, zedId).length === 1,
      JSON.stringify(zedFail.j).slice(0, 200));

    // 8.
    // Off the roster, the staff list may not show the quiz, so submit straight to the assignment.
    sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(gusId);
    const gusAssignment = attemptsOf(autoId, gusId)[0]?.id;
    const gusFail = await call("POST", `/api/staff-portal-session/quizzes/${gusAssignment}/attempt`, { employee_id: gusId, answers: QUESTIONS.map((q) => ({ question_id: q.id, selected_answer: q.correct_answer === "A" ? "B" : "A" })), typed_signature: "Made Up" }, GUS.token);
    check("8. someone off the lab's active roster gets no automatic attempt (refused, or scored with none opened)",
      !!gusAssignment && attemptsOf(autoId, gusId).length === 1 && (gusFail.s !== 200 || (gusFail.j.passed === false && gusFail.j.next_attempt === null)),
      `${gusFail.s} ${JSON.stringify(gusFail.j).slice(0, 160)}`);
    console.log(`INFO  8: the submit for someone off the roster answered ${gusFail.s}`);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
