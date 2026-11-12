// tests/integration/quiz-results-retake.test.ts
//
// Redington (Cathy Thornton), 2026-11-11: she assigned the chemistry quiz, a staff member took it on his staff login and failed,
// and she could find neither his result nor a way to let him take it again. Boots the REAL routes on a scratch DB with made-up
// people and proves:
//   GET /api/veritacomp/quizzes/:id/results gives an editor (and the owner) every person and every attempt, with the score,
//   Pass or Fail and the answers given beside the quiz's answer key; a Staff login gets only their own attempts, with no answers
//   and no key; a view-only seat is refused;
//   POST /api/veritacomp/quizzes/:id/retake gives a person whose latest attempt failed the next attempt, which they take on their
//   staff login as before; it's refused while an attempt is open, after a pass, with no attempt, and off the active roster; the
//   failed attempt and its result don't change; a retake is audited;
//   competency_quiz_assignments.attempt_no and the unique index on (quiz_id, staff_employee_id, attempt_no);
//   plain Assign still skips anyone already assigned; nothing crosses to a sister lab or another customer.
// Run: npm run test:quiz-results-retake
import http from "node:http";
import fs from "node:fs";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  // A database from before this change: the assignments table with no attempt_no, the old one-row-per-person index, and a row on
  // file. Only on a new scratch file, so the boot below migrates it the way it migrates the live database.
  const dbPath = process.env.DB_PATH;
  let legacySeeded = false;
  if (dbPath && !fs.existsSync(dbPath)) {
    const Database = (globalThis as any).require("better-sqlite3");
    const old = new Database(dbPath);
    old.exec(`
      CREATE TABLE competency_quiz_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, quiz_id INTEGER NOT NULL, staff_employee_id INTEGER NOT NULL, lab_id INTEGER NOT NULL,
        assigned_by_user_id INTEGER NOT NULL, assigned_at TEXT NOT NULL, due_date TEXT, status TEXT NOT NULL DEFAULT 'assigned',
        completed_result_id INTEGER, completed_at TEXT
      );
      CREATE UNIQUE INDEX idx_quiz_assign_unique ON competency_quiz_assignments(quiz_id, staff_employee_id);
      INSERT INTO competency_quiz_assignments (id, quiz_id, staff_employee_id, lab_id, assigned_by_user_id, assigned_at, status, completed_at)
        VALUES (900001, 900001, 900001, 900001, 900001, '2026-06-10T00:00:00.000Z', 'completed', '2026-06-11T00:00:00.000Z');
    `);
    old.close();
    legacySeeded = true;
  }
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
  const call = async (method: string, path: string, body: unknown, token: string, labHeader?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `qrr-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `QRR ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);
  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now);
  const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, now, perms, `qrr-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);

  try {
    // ── A made-up lab, a sister lab under the same owner, and another customer ──
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), VIEWER = await register("Viewer");
    const SAM = await register("Sam"), ZED = await register("Zed"), GUS = await register("Gus");
    const SISTER_EDITOR = await register("SisterEditor"), OWNER2 = await register("Owner2");
    const labA = await provision(OWNER.email, "Made-up Retake Lab");
    const labOther = await provision(OWNER2.email, "Made-up Other Customer");
    const labB = Number(sqlite.prepare(
      "INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Made-up Sister Lab', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?"
    ).run(now, now, labA).lastInsertRowid);
    member(labB, OWNER.id, "owner");
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active' WHERE id = ?").run(labB);
    const L = `/api/labs/${labA}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Retake Lab", cliaNumber: "11D7654390", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    await call("POST", `/api/labs/${labOther}/staff/lab`, { labName: "Made-up Other Customer", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER2.token);
    const person = async (last: string, first: string, labPath = L, token = OWNER.token) =>
      Number((await call("POST", `${labPath}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, token)).j.id);
    const samId = await person("Retaker", "Sam"), zedId = await person("Quillfeather", "Zed"), gusId = await person("Leaving", "Gus"), neverId = await person("Unassigned", "Nora");
    const otherCustomerPerson = await person("Elsewhere", "Olive", `/api/labs/${labOther}`, OWNER2.token);
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labA, VIEWER.id); seat(OWNER.id, labA, VIEWER, "view_only", '{"mode":"view_all"}', null);
    member(labA, SAM.id); seat(OWNER.id, labA, SAM, "staff_portal", '{"mode":"view_all"}', samId);
    member(labA, ZED.id); seat(OWNER.id, labA, ZED, "staff_portal", '{"mode":"view_all"}', zedId);
    member(labA, GUS.id); seat(OWNER.id, labA, GUS, "staff_portal", '{"mode":"view_all"}', gusId);
    member(labB, SISTER_EDITOR.id); seat(OWNER.id, labB, SISTER_EDITOR, "active", '{"mode":"edit_all"}', null);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(labB, SISTER_EDITOR.id);

    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical" }, OWNER.token, labA)).j.id;
    const QUESTIONS = [
      { id: "q1", question: "Made-up question one?", options: ["A. first", "B. second", "C. third"], correct_answer: "A", explanation: "Made-up reason one." },
      { id: "q2", question: "Made-up question two?", options: ["A. first", "B. second", "C. third"], correct_answer: "B", explanation: "Made-up reason two." },
      { id: "q3", question: "Made-up question three?", options: ["A. first", "B. second", "C. third"], correct_answer: "C", explanation: "Made-up reason three." },
    ];
    const quizMade = await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Chemistry Quiz", questions: QUESTIONS }, OWNER.token, labA);
    const quizId = Number(quizMade.j.id);
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labA, quizId);
    const assigned = await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, zedId, gusId] }, EDITOR.token, labA);
    check("0. fixture: a lab, a sister lab, another customer, people, seats, a quiz assigned to three people",
      labA > 0 && labB > 0 && labOther > 0 && samId > 0 && zedId > 0 && gusId > 0 && neverId > 0 && quizId > 0 && assigned.s === 200 && assigned.j.created?.length === 3,
      `${quizMade.s} ${assigned.s} ${JSON.stringify(assigned.j).slice(0, 160)}`);

    // ── Schema ────────────────────────────────────────────────────────────────
    const col = (sqlite.prepare("PRAGMA table_info(competency_quiz_assignments)").all() as any[]).find((c) => c.name === "attempt_no");
    check("1a. competency_quiz_assignments has attempt_no, NOT NULL, default 1", !!col && col.notnull === 1 && String(col.dflt_value) === "1", JSON.stringify(col));
    const indexes = sqlite.prepare("PRAGMA index_list(competency_quiz_assignments)").all() as any[];
    const attemptIdx = indexes.find((i) => i.name === "idx_quiz_assign_attempt_unique");
    const idxCols = attemptIdx ? (sqlite.prepare("PRAGMA index_info(idx_quiz_assign_attempt_unique)").all() as any[]).map((c) => c.name) : [];
    check("1b. the unique index is on (quiz_id, staff_employee_id, attempt_no)", !!attemptIdx && attemptIdx.unique === 1 && JSON.stringify(idxCols) === JSON.stringify(["quiz_id", "staff_employee_id", "attempt_no"]), JSON.stringify(idxCols));
    check("1c. the old one-row-per-person index is gone", !indexes.some((i) => i.name === "idx_quiz_assign_unique"), indexes.map((i) => i.name).join(","));
    if (legacySeeded) {
      const legacy = sqlite.prepare("SELECT * FROM competency_quiz_assignments WHERE id = 900001").get() as any;
      check("1e. a row already on file before the change reads as attempt 1, otherwise as it was", legacy?.attempt_no === 1 && legacy?.status === "completed" && legacy?.quiz_id === 900001 && legacy?.completed_at === "2026-06-11T00:00:00.000Z", JSON.stringify(legacy));
      sqlite.prepare("DELETE FROM competency_quiz_assignments WHERE id = 900001").run();
    } else {
      console.log("INFO  the scratch database already existed, so the before-the-change migration wasn't rebuilt");
    }
    const rowsOf = (sid: number) => sqlite.prepare("SELECT * FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ? ORDER BY attempt_no").all(quizId, sid) as any[];
    check("1d. a plain Assign is attempt 1", [samId, zedId, gusId].every((s) => rowsOf(s).length === 1 && rowsOf(s)[0].attempt_no === 1));
    const auditCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_retake'").get() as any).n);
    const retake = (sid: number, token = EDITOR.token, body: any = {}, header: number | undefined = labA) => call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, { staff_employee_id: sid, ...body }, token, header);

    // ── Open attempt: no retake yet ───────────────────────────────────────────
    const auditsBefore = auditCount();
    const openRefused = await retake(samId);
    check("2a. a retake is refused while the person's attempt is still open", openRefused.s === 409 && openRefused.j.code === "RETAKE_OPEN" && rowsOf(samId).length === 1, `${openRefused.s} ${openRefused.j.code}`);
    const neverRefused = await retake(neverId);
    check("2b. a retake is refused for someone never assigned the quiz", neverRefused.s === 409 && neverRefused.j.code === "NO_ATTEMPT", `${neverRefused.s} ${neverRefused.j.code}`);

    // ── Attempt 1: Sam fails, Zed passes, Gus fails ───────────────────────────
    const take = async (token: string, sid: number, picks: string[], signature: string) => {
      const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, token);
      const open = (list.j.quizzes || []).find((q: any) => q.quiz_id === quizId && q.status === "assigned");
      const answers = QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] }));
      const r = open ? await call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: sid, answers, typed_signature: signature }, token) : { s: 0, j: {} as any, text: "" };
      return { list, open, r };
    };
    const sam1 = await take(SAM.token, samId, ["A", "A", "C"], "Sam Retaker");
    const zed1 = await take(ZED.token, zedId, ["A", "B", "C"], "Zed Quillfeather");
    const gus1 = await take(GUS.token, gusId, ["C", "C", "C"], "Gus Leaving");
    check("3a. on his staff login Sam takes attempt 1 and fails (2 of 3)", sam1.r.s === 200 && sam1.r.j.score === 67 && sam1.r.j.passed === false, `${sam1.r.s} ${JSON.stringify(sam1.r.j).slice(0, 120)}`);
    check("3b. Zed passes, and Gus fails", zed1.r.s === 200 && zed1.r.j.passed === true && gus1.r.s === 200 && gus1.r.j.passed === false);
    const attempt1Row = JSON.stringify(rowsOf(samId)[0]);
    const attempt1Result = JSON.stringify(sqlite.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(rowsOf(samId)[0].completed_result_id));

    // ── What an editor sees ───────────────────────────────────────────────────
    const resultsUrl = `/api/veritacomp/quizzes/${quizId}/results`;
    const ed = await call("GET", resultsUrl, undefined, EDITOR.token, labA);
    const pOf = (j: any, sid: number) => (j.people || []).find((p: any) => p.staff_employee_id === sid);
    const samEd = pOf(ed.j, samId);
    check("4a. an editor sees everyone assigned the quiz", ed.s === 200 && ed.j.people?.length === 3 && !!pOf(ed.j, zedId) && !!pOf(ed.j, gusId), `${ed.s} ${ed.text.slice(0, 160)}`);
    check("4b. Sam's attempt 1: number, date, score and Fail", samEd?.attempts?.length === 1 && samEd.attempts[0].attempt_no === 1 && samEd.attempts[0].score === 67 && samEd.attempts[0].passed === false && !!samEd.attempts[0].date_taken && samEd.attempts[0].status === "completed", JSON.stringify(samEd?.attempts?.[0]).slice(0, 200));
    const samAnswers = samEd?.attempts?.[0]?.answers || [];
    check("4c. Sam's answers, each marked right or wrong", samAnswers.length === 3 && samAnswers.map((a: any) => `${a.question_id}:${a.selected_answer}:${a.correct}`).join(",") === "q1:A:true,q2:A:false,q3:C:true", JSON.stringify(samAnswers));
    check("4d. with the quiz's questions and correct answers beside them", ed.j.questions?.length === 3 && ed.j.questions.map((q: any) => q.correct_answer).join("") === "ABC" && ed.j.questions[1].explanation === "Made-up reason two." && ed.j.own_only === false);
    check("4e. Zed's attempt reads Pass", pOf(ed.j, zedId)?.attempts?.[0]?.passed === true && pOf(ed.j, zedId)?.attempts?.[0]?.score === 100);
    check("4f. Assign a retake is offered for Sam (attempt 2) and Gus, not for Zed who passed", samEd?.can_retake === true && samEd?.next_attempt_no === 2 && pOf(ed.j, gusId)?.can_retake === true && pOf(ed.j, zedId)?.can_retake === false && pOf(ed.j, zedId)?.retake_refusal === "RETAKE_PASSED");
    const own = await call("GET", resultsUrl, undefined, OWNER.token, labA);
    check("4g. the lab's owner sees the same list", own.s === 200 && own.j.people?.length === 3 && pOf(own.j, samId)?.attempts?.[0]?.answers?.length === 3);
    const viewer = await call("GET", resultsUrl, undefined, VIEWER.token, labA);
    check("4h. a view-only seat is refused, with no names or answers", viewer.s === 403 && viewer.j.code === "QUIZ_RESULTS_EDIT_ONLY" && !/Retaker|Quillfeather|correct_answer/.test(viewer.text), `${viewer.s} ${viewer.j.code}`);

    // ── What a Staff login sees ───────────────────────────────────────────────
    const samOwn = await call("GET", resultsUrl, undefined, SAM.token);
    check("5a. a Staff login sees only their own attempts", samOwn.s === 200 && samOwn.j.own_only === true && samOwn.j.people?.length === 1 && samOwn.j.people[0].staff_employee_id === samId && samOwn.j.people[0].attempts[0].score === 67, `${samOwn.s} ${samOwn.text.slice(0, 160)}`);
    check("5b. no coworker's name, no answers, no answer key", !/Quillfeather|Leaving/.test(samOwn.text) && !/correct_answer|"answers"|explanation/.test(samOwn.text) && samOwn.j.questions === undefined, samOwn.text.slice(0, 200));
    check("5c. and no retake offered to them", samOwn.j.people[0].can_retake === false && samOwn.j.people[0].retake_refusal === null);
    const zedOwn = await call("GET", resultsUrl, undefined, ZED.token);
    check("5d. a coworker's Staff login sees only theirs", zedOwn.s === 200 && zedOwn.j.people?.length === 1 && zedOwn.j.people[0].staff_employee_id === zedId && !/Retaker/.test(zedOwn.text));
    const staffAssignments = await call("GET", `/api/veritacomp/quizzes/${quizId}/assignments`, undefined, SAM.token);
    check("5e. the older assignments list still gives a Staff login only their own", staffAssignments.s === 200 && staffAssignments.j.assignments.length === 1 && staffAssignments.j.assignments[0].staff_employee_id === samId);

    // ── Refusals before the retake ────────────────────────────────────────────
    const passedRefused = await retake(zedId);
    check("6a. a retake is refused when the latest attempt passed", passedRefused.s === 409 && passedRefused.j.code === "RETAKE_PASSED" && rowsOf(zedId).length === 1, `${passedRefused.s} ${passedRefused.j.code}`);
    const viewerRetake = await retake(samId, VIEWER.token);
    const staffRetake = await retake(samId, SAM.token);
    check("6b. a view-only seat and a Staff login can't assign a retake", viewerRetake.s === 403 && staffRetake.s === 403 && rowsOf(samId).length === 1, `${viewerRetake.s}/${staffRetake.s}`);
    const badBody = await call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, {}, EDITOR.token, labA);
    const badDue = await retake(samId, EDITOR.token, { due_date: "next week" });
    check("6c. a retake with no person or a bad due date is refused", badBody.s === 400 && badDue.s === 400 && rowsOf(samId).length === 1, `${badBody.s}/${badDue.s}`);
    sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(gusId);
    const gusRefused = await retake(gusId);
    const otherLabRefused = await retake(otherCustomerPerson);
    check("6d. a retake is refused for someone no longer on the lab's active roster, as Assign refuses", gusRefused.s === 400 && gusRefused.j.code === "NOT_ON_ROSTER" && rowsOf(gusId).length === 1 && otherLabRefused.s === 400 && otherLabRefused.j.code === "NOT_ON_ROSTER", `${gusRefused.s} ${gusRefused.j.code} / ${otherLabRefused.s}`);
    const gusListed = pOf((await call("GET", resultsUrl, undefined, EDITOR.token, labA)).j, gusId);
    check("6e. the results list says so instead of offering it", gusListed?.can_retake === false && gusListed?.retake_refusal === "NOT_ON_ROSTER" && gusListed?.on_roster === false);
    check("6f. no refused retake wrote an audit row", auditCount() === auditsBefore, `${auditCount()} vs ${auditsBefore}`);

    // ── Sister lab and another customer ───────────────────────────────────────
    const leaks = (r: { text: string }) => /Retaker|Quillfeather|correct_answer/.test(r.text);
    const refused = (r: { s: number }) => r.s === 403 || r.s === 404;
    for (const [who, token, header] of [
      ["sister-lab editor", SISTER_EDITOR.token, undefined], ["sister-lab editor naming its own lab", SISTER_EDITOR.token, labB], ["sister-lab editor naming lab A", SISTER_EDITOR.token, labA],
      ["another customer's owner", OWNER2.token, undefined], ["another customer's owner naming lab A", OWNER2.token, labA],
    ] as Array<[string, string, number | undefined]>) {
      const read = await call("GET", resultsUrl, undefined, token, header);
      const write = await retake(samId, token, {}, header);
      check(`7. ${who}: can't read the results or assign a retake`, refused(read) && !leaks(read) && refused(write) && !leaks(write) && rowsOf(samId).length === 1, `${read.s}/${write.s}`);
    }

    // ── The retake ────────────────────────────────────────────────────────────
    const made = await retake(samId, EDITOR.token, { due_date: "2026-12-01" });
    const samRows = rowsOf(samId);
    check("8a. after a fail, Assign a retake creates attempt 2, open, with its due date", made.s === 200 && made.j.attempt_no === 2 && samRows.length === 2 && samRows[1].attempt_no === 2 && samRows[1].status === "assigned" && samRows[1].due_date === "2026-12-01" && samRows[1].lab_id === labA && samRows[1].completed_result_id == null, `${made.s} ${JSON.stringify(made.j)}`);
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'quiz_retake' ORDER BY id DESC LIMIT 1").get() as any;
    check("8b. the retake is audited like other VeritaComp writes", auditCount() === auditsBefore + 1 && audit?.module === "veritacomp" && audit?.action === "create" && audit?.entity_id === String(made.j.id) && audit?.user_id === EDITOR.id && /Sam Retaker/.test(audit?.entity_label || "") && /attempt 2/.test(audit?.entity_label || "") && JSON.parse(audit.before_json).latest_attempt.score === 67 && JSON.parse(audit.after_json).assignment.attempt_no === 2, JSON.stringify(audit).slice(0, 240));
    check("8c. attempt 1 and its result are untouched", JSON.stringify(rowsOf(samId)[0]) === attempt1Row && JSON.stringify(sqlite.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(rowsOf(samId)[0].completed_result_id)) === attempt1Result);
    const again = await retake(samId);
    check("8d. a second retake while attempt 2 is open is refused", again.s === 409 && again.j.code === "RETAKE_OPEN" && rowsOf(samId).length === 2, `${again.s} ${again.j.code}`);
    const reassign = await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, neverId] }, EDITOR.token, labA);
    check("8e. plain Assign still skips anyone already assigned, and still assigns someone new", reassign.s === 200 && reassign.j.skipped?.includes(samId) && reassign.j.created?.length === 1 && rowsOf(samId).length === 2 && rowsOf(neverId).length === 1 && rowsOf(neverId)[0].attempt_no === 1, JSON.stringify(reassign.j));
    const cardRows = await call("GET", `/api/veritacomp/quizzes/${quizId}/assignments`, undefined, EDITOR.token, labA);
    check("8f. the quiz card's list carries the attempt number", cardRows.j.assignments.filter((a: any) => a.staff_employee_id === samId).map((a: any) => a.attempt_no).join(",") === "1,2");
    const unassignDone = await call("DELETE", `/api/veritacomp/quiz-assignments/${rowsOf(samId)[0].id}`, undefined, EDITOR.token, labA);
    check("8g. attempt 1 still can't be unassigned; the attempt is on record", unassignDone.s === 409 && rowsOf(samId).length === 2, `${unassignDone.s}`);

    // ── Sam takes attempt 2 on his staff login ────────────────────────────────
    const sam2 = await take(SAM.token, samId, ["A", "B", "C"], "Sam Retaker");
    const listed = (sam2.list.j.quizzes || []).filter((q: any) => q.quiz_id === quizId);
    check("9a. his staff login lists attempt 2 to take, and attempt 1 as completed", listed.length === 2 && listed.some((q: any) => q.status === "assigned" && q.attempt_no === 2) && listed.some((q: any) => q.status === "completed" && q.attempt_no === 1 && q.score === 67), JSON.stringify(listed));
    const opened = await call("GET", `/api/staff-portal-session/quizzes/${samRows[1].id}?employee_id=${samId}`, undefined, SAM.token);
    check("9b. it opens with no answer key in it", opened.s === 200 && opened.j.questions?.length === 3 && !opened.text.includes("correct_answer"), `${opened.s}`);
    check("9c. he takes attempt 2 and passes", sam2.open?.assignment_id === samRows[1].id && sam2.r.s === 200 && sam2.r.j.score === 100 && sam2.r.j.passed === true, `${sam2.r.s} ${JSON.stringify(sam2.r.j).slice(0, 120)}`);
    const samAfter = rowsOf(samId);
    check("9d. attempt 2 is completed with its own result; attempt 1 is unchanged", samAfter[1].status === "completed" && !!samAfter[1].completed_result_id && samAfter[1].completed_result_id !== samAfter[0].completed_result_id && JSON.stringify(samAfter[0]) === attempt1Row && JSON.stringify(sqlite.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(samAfter[0].completed_result_id)) === attempt1Result);
    const result2 = sqlite.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(samAfter[1].completed_result_id) as any;
    check("9e. attempt 2's result is a staff login attempt by Sam", result2?.source === "staff_portal" && result2?.staff_employee_id === samId && result2?.passed === 1 && result2?.quiz_id === quizId);

    const ed2 = await call("GET", resultsUrl, undefined, EDITOR.token, labA);
    const sam2Ed = pOf(ed2.j, samId);
    check("9f. the results list shows both attempts: 1 failed at 67%, 2 passed at 100%", sam2Ed?.attempts?.length === 2 && sam2Ed.attempts.map((a: any) => `${a.attempt_no}:${a.score}:${a.passed}`).join(",") === "1:67:false,2:100:true", JSON.stringify(sam2Ed?.attempts?.map((a: any) => [a.attempt_no, a.score, a.passed])));
    check("9g. each attempt keeps its own answers", sam2Ed?.attempts?.[0]?.answers?.map((a: any) => a.correct).join(",") === "true,false,true" && sam2Ed?.attempts?.[1]?.answers?.every((a: any) => a.correct));
    check("9h. no retake offered after the pass", sam2Ed?.can_retake === false && sam2Ed?.retake_refusal === "RETAKE_PASSED");
    const afterPass = await retake(samId);
    check("9i. a second retake after a pass is refused", afterPass.s === 409 && afterPass.j.code === "RETAKE_PASSED" && rowsOf(samId).length === 2, `${afterPass.s} ${afterPass.j.code}`);
    check("9j. only the one retake was audited", auditCount() === auditsBefore + 1);

    // ── The unique index ──────────────────────────────────────────────────────
    const insertAttempt = (n: number) => sqlite.prepare(
      "INSERT INTO competency_quiz_assignments (quiz_id, staff_employee_id, lab_id, assigned_by_user_id, assigned_at, status, attempt_no) VALUES (?, ?, ?, ?, ?, 'assigned', ?)"
    ).run(quizId, samId, labA, OWNER.id, now, n);
    let dupError = "";
    try { insertAttempt(2); } catch (e: any) { dupError = String(e?.message || e); }
    check("10a. the index holds attempts 1 and 2 for the same person and quiz", rowsOf(samId).map((r) => r.attempt_no).join(",") === "1,2");
    check("10b. and refuses a second attempt 2", /UNIQUE/.test(dupError) && rowsOf(samId).length === 2, dupError);
    let noDefaultDup = "";
    try { sqlite.prepare("INSERT INTO competency_quiz_assignments (quiz_id, staff_employee_id, lab_id, assigned_by_user_id, assigned_at, status) VALUES (?, ?, ?, ?, ?, 'assigned')").run(quizId, zedId, labA, OWNER.id, now); } catch (e: any) { noDefaultDup = String(e?.message || e); }
    check("10c. a row written with no attempt number is attempt 1, and can't duplicate one on file", /UNIQUE/.test(noDefaultDup) && rowsOf(zedId).length === 1, noDefaultDup);

    // ── No cap on retakes ─────────────────────────────────────────────────────
    sqlite.prepare("UPDATE staff_employees SET status = 'active' WHERE id = ?").run(gusId);
    const gus2 = await retake(gusId);
    const gusTake2 = await take(GUS.token, gusId, ["C", "C", "C"], "Gus Leaving");
    const gus3 = await retake(gusId);
    check("11. after a second fail a third attempt can be assigned", gus2.s === 200 && gus2.j.attempt_no === 2 && gusTake2.r.j.passed === false && gus3.s === 200 && gus3.j.attempt_no === 3 && rowsOf(gusId).map((r) => r.attempt_no).join(",") === "1,2,3", `${gus2.s} ${gusTake2.r.s} ${gus3.s}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
