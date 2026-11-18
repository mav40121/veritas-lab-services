// tests/integration/competency-program-restore.test.ts
//
// REQ-157 (Redington-Fairview, 2026-11-18): deleting a VeritaComp program left its quizzes pointing at a program that no longer
// exists, so they dropped off the Quiz tab (it lists quizzes program by program). Boots the REAL routes on a scratch DB with
// made-up people and proves:
//   1. both program lists carry quizCount
//   2. a program with a quiz is refused on the lab-scoped and the older route (409 PROGRAM_HOLDS_QUIZZES, quiz_count), and
//      nothing is removed; a program holding records still answers PROGRAM_HOLDS_RECORDS first
//   3. once its quiz is deleted, the program deletes
//   4. GET /api/admin/competency/orphan-quizzes: 403 without the header; lists a quiz whose program is gone with its counts
//   5. planDeletedProgramRestore from a copy made before the delete: the program, both method groups, the checklist item and
//      its picture, the Not applicable row for a person still on file (one for a person not on file is skipped), the quiz
//      waiting with its assignment and result; a different lab is LAB_MISMATCH
//   6. applyDeletedProgramRestore: a wrong total is COUNT_CHANGED with nothing written; the right total puts every row back
//      with its id, the quiz is on the program's quiz list again, the orphan list no longer has it, one audit row; a second
//      apply is PROGRAM_EXISTS
//   7. POST /api/admin/competency/restore-deleted-program: 403 without the header, 400 without ids, 503 with no backup storage
// Run: npm run test:competency-program-restore
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { planDeletedProgramRestore, applyDeletedProgramRestore, RestoreRefused } = await import("../../server/competencyProgramRestore");
  const Database = (await import("better-sqlite3")).default;
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
  const call = async (method: string, path: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `cpr-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);

  try {
    const OWNER = await register("owner"), OTHER = await register("other");
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const labId = await provision(OWNER.email, "Made-up Restore Lab"), lab2 = await provision(OTHER.email, "Made-up Other Lab");
    const L = `/api/labs/${labId}`;
    const H = { "X-Active-Lab-Id": String(labId) };
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Restore Lab", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const staffId = Number((await call("POST", `${L}/staff/employees`, { lastName: "Self", firstName: "Ann", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const compId = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, 'Ann Self', 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(OWNER.id, labId, staffId, now).lastInsertRowid);

    const mkProgram = async (name: string) => Number((await call("POST", `${L}/competency/programs`, { name, department: "Other", type: "technical" }, OWNER.token)).j.id);
    const addGroup = (programId: number, name: string, instruments: string[]) => Number(sqlite.prepare(
      "INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, ?, ?, '[]')").run(programId, name, JSON.stringify(instruments)).lastInsertRowid);
    const addQuiz = (programId: number, title: string, groupIds: number[]) => Number(sqlite.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(OWNER.id, programId, labId, title, JSON.stringify(groupIds), OWNER.id, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now).lastInsertRowid);
    const programExists = (id: number) => n("SELECT COUNT(*) AS n FROM competency_programs WHERE id = ?", id) === 1;

    // ── 1 and 2: the refusal ───────────────────────────────────────────────────────────────────────
    const P = await mkProgram("Made-up Body Fluids");
    const g1 = addGroup(P, "Made-up Analyzer A", ["Made-up Analyzer A"]), g2 = addGroup(P, "Made-up Analyzer B", ["Made-up Analyzer B"]);
    const Q = addQuiz(P, "Made-up Body Fluid Quiz", [g1, g2]);
    const listScoped = await call("GET", `${L}/competency/programs`, undefined, OWNER.token);
    const listOld = await call("GET", "/api/competency/programs", undefined, OWNER.token, H);
    const inScoped = (listScoped.j as any[]).find?.((p: any) => p.id === P), inOld = (Array.isArray(listOld.j) ? listOld.j : []).find((p: any) => p.id === P);
    check("1. both program lists carry quizCount 1", inScoped?.quizCount === 1 && inOld?.quizCount === 1, JSON.stringify({ scoped: inScoped?.quizCount, old: inOld?.quizCount, oldStatus: listOld.s }));
    for (const [label, path] of [["lab-scoped route", `${L}/competency/programs/${P}`], ["older route", `/api/competency/programs/${P}`]] as const) {
      const r = await call("DELETE", path, undefined, OWNER.token, H);
      check(`2a. ${label}: a program with a quiz is refused with 409 PROGRAM_HOLDS_QUIZZES and the count, nothing removed`,
        r.s === 409 && r.j.code === "PROGRAM_HOLDS_QUIZZES" && r.j.quiz_count === 1 && /1 quiz\b/.test(r.j.error || "") && programExists(P)
          && n("SELECT COUNT(*) AS n FROM competency_method_groups WHERE program_id = ?", P) === 2 && n("SELECT COUNT(*) AS n FROM competency_quizzes WHERE id = ?", Q) === 1,
        JSON.stringify({ s: r.s, j: r.j }));
    }
    const PR = await mkProgram("Made-up With Records");
    addQuiz(PR, "Made-up Quiz On Records", []);
    sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, created_at) VALUES (?, ?, 'annual', '2026-10-15', 'Made Up Evaluator', 'completed', ?)").run(PR, compId, now);
    const rr = await call("DELETE", `${L}/competency/programs/${PR}`, undefined, OWNER.token);
    check("2b. a program holding records and a quiz answers PROGRAM_HOLDS_RECORDS first", rr.s === 409 && rr.j.code === "PROGRAM_HOLDS_RECORDS" && programExists(PR), JSON.stringify(rr.j));

    // ── 3: delete the quiz, then the program ───────────────────────────────────────────────────────
    const P3 = await mkProgram("Made-up Empty After Quiz");
    const Q3 = addQuiz(P3, "Made-up Unused Quiz", []);
    const dq = await call("DELETE", `/api/veritacomp/quizzes/${Q3}`, undefined, OWNER.token, H);
    const dp = await call("DELETE", `${L}/competency/programs/${P3}`, undefined, OWNER.token);
    check("3. once its quiz is deleted, the program deletes", dq.s === 200 && dp.s === 200 && !programExists(P3), JSON.stringify({ dq: dq.s, dp: dp.s, dpj: dp.j }));

    // ── a copy made before the old delete, then the delete the way it used to run ──────────────────
    sqlite.prepare("INSERT INTO competency_checklist_images (lab_id, sha256, data_url, created_at) VALUES (?, ?, 'data:image/png;base64,AAAA', ?)").run(labId, `sha-${stamp}`, now);
    const imgId = Number((sqlite.prepare("SELECT id FROM competency_checklist_images WHERE sha256 = ?").get(`sha-${stamp}`) as any).id);
    const itemId = Number(sqlite.prepare("INSERT INTO competency_checklist_items (program_id, label, description, sort_order, image_id) VALUES (?, 'A', 'Made-up item', 0, ?)").run(P, imgId).lastInsertRowid);
    const naId = Number(sqlite.prepare("INSERT INTO competency_program_not_applicable (program_id, employee_id, reason, marked_by_user_id, marked_at) VALUES (?, ?, 'Made-up reason', ?, ?)").run(P, compId, OWNER.id, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO competency_quiz_assignments (quiz_id, staff_employee_id, lab_id, assigned_by_user_id, assigned_at, status) VALUES (?, ?, ?, ?, ?, 'completed')").run(Q, staffId, labId, OWNER.id, now);
    sqlite.prepare("INSERT INTO competency_quiz_results (quiz_id, employee_id, answers, score, passed, date_taken, created_at) VALUES (?, ?, '[]', 89, 0, '2026-11-17', ?)").run(Q, compId, now);
    const copy = new Database(sqlite.serialize());
    // In the copy only: a Not applicable row for someone who isn't on file now; it must be skipped, never inserted.
    copy.prepare("INSERT INTO competency_program_not_applicable (program_id, employee_id, reason, marked_by_user_id, marked_at) VALUES (?, 987654321, 'Made-up gone', ?, ?)").run(P, OWNER.id, now);
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM competency_method_groups WHERE program_id = ?").run(P);
      sqlite.prepare("DELETE FROM competency_checklist_items WHERE program_id = ?").run(P);
      sqlite.prepare("DELETE FROM competency_program_not_applicable WHERE program_id = ?").run(P);
      sqlite.prepare("DELETE FROM competency_programs WHERE id = ?").run(P);
      sqlite.prepare("DELETE FROM competency_checklist_images WHERE id = ?").run(imgId);
    })();

    // ── 4: the orphan list ────────────────────────────────────────────────────────────────────────
    const o403 = await call("GET", "/api/admin/competency/orphan-quizzes", undefined);
    const o = await call("GET", "/api/admin/competency/orphan-quizzes", undefined, undefined, { "x-admin-secret": ADMIN });
    const mine = (o.j.labs || []).find((l: any) => l.labId === labId);
    check("4. orphan quizzes: 403 without the header; lists the quiz with its assignment and result counts, no names",
      o403.s === 403 && o.s === 200 && JSON.stringify(mine?.quizIds) === JSON.stringify([Q]) && mine?.assignments === 1 && mine?.results === 1 && !/Ann|Self|Made-up Body Fluid Quiz/.test(o.text),
      JSON.stringify({ o403: o403.s, mine }));

    // ── 5: the plan ───────────────────────────────────────────────────────────────────────────────
    const plan = planDeletedProgramRestore(sqlite, copy, labId, P);
    check("5a. plan: the program, both method groups with their instruments, the item, its picture, one Not applicable row (one skipped)",
      plan.ok && plan.program?.name === "Made-up Body Fluids" && plan.methodGroups.map((m) => m.id).join(",") === `${g1},${g2}` && plan.methodGroups[0].instruments[0] === "Made-up Analyzer A"
        && JSON.stringify(plan.rows) === JSON.stringify({ programs: 1, methodGroups: 2, checklistItems: 1, checklistImages: 1, notApplicable: 1 }) && plan.skippedNotApplicable === 1 && plan.total === 6,
      JSON.stringify({ ok: plan.ok, problems: plan.problems, rows: plan.rows, skipped: plan.skippedNotApplicable, total: plan.total }));
    check("5b. plan: the quiz waiting for it, with its question, assignment and result counts",
      plan.quizzesWaiting.length === 1 && plan.quizzesWaiting[0].id === Q && plan.quizzesWaiting[0].questions === 1 && plan.quizzesWaiting[0].assignments === 1 && plan.quizzesWaiting[0].results === 1,
      JSON.stringify(plan.quizzesWaiting));
    const wrongLab = planDeletedProgramRestore(sqlite, copy, lab2, P);
    check("5c. plan for a different lab: LAB_MISMATCH, not ok", !wrongLab.ok && wrongLab.problems.some((p) => p.code === "LAB_MISMATCH"), JSON.stringify(wrongLab.problems));
    const missing = planDeletedProgramRestore(sqlite, copy, labId, 999999);
    check("5d. a program not in the copy: NOT_IN_COPY", !missing.ok && missing.problems[0]?.code === "NOT_IN_COPY", JSON.stringify(missing.problems));

    // ── 6: apply ──────────────────────────────────────────────────────────────────────────────────
    const auditBefore = n("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'veritacomp' AND action = 'restore' AND entity_type = 'program' AND entity_id = ?", String(P));
    let wrong: any = null;
    try { applyDeletedProgramRestore(sqlite, copy, labId, P, plan.total + 1, "veritas-backup-test.db.gz"); } catch (e) { wrong = e; }
    check("6a. a wrong total: COUNT_CHANGED and nothing written", wrong instanceof RestoreRefused && wrong.code === "COUNT_CHANGED" && !programExists(P)
      && n("SELECT COUNT(*) AS n FROM competency_method_groups WHERE id IN (?, ?)", g1, g2) === 0, String(wrong?.code));
    const applied = applyDeletedProgramRestore(sqlite, copy, labId, P, plan.total, "veritas-backup-test.db.gz");
    const quizList = await call("GET", `/api/veritacomp/programs/${P}/quizzes`, undefined, OWNER.token, H);
    const o2 = await call("GET", "/api/admin/competency/orphan-quizzes", undefined, undefined, { "x-admin-secret": ADMIN });
    check("6b. applied: every row back with its id, the gone person's row not inserted",
      applied.total === 6 && programExists(P) && n("SELECT COUNT(*) AS n FROM competency_method_groups WHERE id IN (?, ?) AND program_id = ?", g1, g2, P) === 2
        && n("SELECT COUNT(*) AS n FROM competency_checklist_items WHERE id = ? AND image_id = ?", itemId, imgId) === 1 && n("SELECT COUNT(*) AS n FROM competency_checklist_images WHERE id = ?", imgId) === 1
        && n("SELECT COUNT(*) AS n FROM competency_program_not_applicable WHERE id = ? AND program_id = ?", naId, P) === 1 && n("SELECT COUNT(*) AS n FROM competency_program_not_applicable WHERE employee_id = 987654321") === 0,
      JSON.stringify(applied.rows));
    check("6c. the quiz is on the program's quiz list again and off the orphan list; its result is untouched",
      quizList.s === 200 && (Array.isArray(quizList.j) ? quizList.j : []).some((q: any) => q.id === Q) && !(o2.j.labs || []).some((l: any) => l.labId === labId)
        && n("SELECT COUNT(*) AS n FROM competency_quiz_results WHERE quiz_id = ? AND score = 89", Q) === 1,
      JSON.stringify({ s: quizList.s, ids: (Array.isArray(quizList.j) ? quizList.j : []).map((q: any) => q.id), orphanLabs: o2.j.labs }));
    check("6d. one audit row (veritacomp, restore, program)", n("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'veritacomp' AND action = 'restore' AND entity_type = 'program' AND entity_id = ?", String(P)) === auditBefore + 1);
    let again: any = null;
    try { applyDeletedProgramRestore(sqlite, copy, labId, P, plan.total, "veritas-backup-test.db.gz"); } catch (e) { again = e; }
    check("6e. a second apply: PROGRAM_EXISTS", again instanceof RestoreRefused && again.code === "PROGRAM_EXISTS", String(again?.code));
    copy.close();

    // ── 7: the admin route's guards ───────────────────────────────────────────────────────────────
    const r403 = await call("POST", "/api/admin/competency/restore-deleted-program", { labId, programId: P });
    const r400 = await call("POST", "/api/admin/competency/restore-deleted-program", {}, undefined, { "x-admin-secret": ADMIN });
    const r503 = await call("POST", "/api/admin/competency/restore-deleted-program", { labId, programId: P, before: now }, undefined, { "x-admin-secret": ADMIN });
    check("7. restore route: 403 without the header, 400 without ids, 503 BACKUP_NOT_CONFIGURED with no backup storage",
      r403.s === 403 && r400.s === 400 && r400.j.code === "IDS_REQUIRED" && r503.s === 503 && r503.j.code === "BACKUP_NOT_CONFIGURED",
      JSON.stringify({ r403: r403.s, r400: r400.j, r503: r503.j }));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
