// tests/integration/quiz-attempt-void.test.ts
//
// Redington, 2026-11-18 (Michael Q2 = 1): four attempts were scored by a VeritaAssure error and the lab asked to remove them,
// because the techs "didn't have an accurate chance". Nothing is deleted: a voided attempt stays in the history with who, when
// and why, and stops counting as a Pass or Fail. Boots the REAL routes on a scratch DB with made-up people and proves:
//   1. competency_quiz_results has voided_at, voided_by_user_id, void_reason
//   2. POST /api/veritacomp/quiz-results/:id/void has the retake's reach: a Staff login and a view-only seat are refused, a sister
//      lab's editor and another customer get 404
//   3. a reason is required (blank, spaces, too long: 400 VOID_REASON_REQUIRED)
//   4. a quiz given on a competency record is refused (409 NOT_ASSIGNED_ATTEMPT)
//   5. an editor voids a failed attempt: the row keeps its score, result and answers and gains when, who and why; the assignment
//      is unchanged; a second void is 409 ALREADY_VOIDED; one audit row (quiz_attempt_void) holds the score before and the reason
//   6. the readers: Results (voided, reason, a retake offered), the quiz card's assignments, the staff login's own list, Quiz
//      scores and its workbook ("Voided: <reason>") all read Voided, not Fail
//   7. a retake follows a voided attempt; a voided pass also opens a retake
//   8. POST /api/admin/veritacomp/quiz-results/void: 403 without the header, a dry run that lists each id, 409 NOT_ALL_VOIDABLE
//      with nothing written when any id can't be voided, and the void as Veritas (user 0) with an audit row
// Run: npm run test:quiz-attempt-void
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
  const call = async (method: string, path: string, body: unknown, token?: string, labHeader?: number, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    let j: any = {}; try { j = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
    return { s: r.status, j, buf };
  };
  const register = async (tag: string) => {
    const email = `qav-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `QAV ${tag}`, hipaa_acknowledged: true }) })).json();
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
  ).run(ownerId, u.email, u.id, now, now, perms, `qav-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);

  try {
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), VIEWER = await register("Viewer");
    const SAM = await register("Sam"), ZED = await register("Zed"), SISTER_EDITOR = await register("SisterEditor"), OWNER2 = await register("Owner2");
    const labA = await provision(OWNER.email, "Made-up Void Lab");
    const labOther = await provision(OWNER2.email, "Made-up Other Customer");
    const labB = Number(sqlite.prepare(
      "INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Made-up Sister Lab', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?"
    ).run(now, now, labA).lastInsertRowid);
    member(labB, OWNER.id, "owner");
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active' WHERE id = ?").run(labB);
    const L = `/api/labs/${labA}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Void Lab", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const person = async (last: string, first: string) =>
      Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const samId = await person("Voidable", "Sam"), zedId = await person("Passer", "Zed");
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labA, VIEWER.id); seat(OWNER.id, labA, VIEWER, "view_only", '{"mode":"view_all"}', null);
    member(labA, SAM.id); seat(OWNER.id, labA, SAM, "staff_portal", '{"mode":"view_all"}', samId);
    member(labA, ZED.id); seat(OWNER.id, labA, ZED, "staff_portal", '{"mode":"view_all"}', zedId);
    member(labB, SISTER_EDITOR.id); seat(OWNER.id, labB, SISTER_EDITOR, "active", '{"mode":"edit_all"}', null);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(labB, SISTER_EDITOR.id);

    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, OWNER.token, labA)).j.id;
    const QUESTIONS = [
      { id: "q1", question: "Made-up one?", options: ["True", "False"], correct_answer: "A" },
      { id: "q2", question: "Made-up two?", options: ["Image A", "Image B"], correct_answer: "B" },
    ];
    const quizId = Number((await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Gram Stain Quiz", questions: QUESTIONS }, OWNER.token, labA)).j.id);
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labA, quizId);
    await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, zedId] }, EDITOR.token, labA);
    const take = async (u: { token: string }, sid: number, picks: string[]) => {
      const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, u.token);
      const open = (list.j.quizzes || []).find((q: any) => q.quiz_id === quizId && q.status === "assigned");
      return call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: sid, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] })), typed_signature: "Made Up" }, u.token);
    };
    const samTook = await take(SAM, samId, ["A", "A"]);   // 1 of 2: 50, Fail
    const zedTook = await take(ZED, zedId, ["A", "B"]);   // 2 of 2: 100, Pass
    const samResult = Number(samTook.j.id), zedResult = Number(zedTook.j.id);
    const recordResult = Number(sqlite.prepare(
      "INSERT INTO competency_quiz_results (assessment_id, quiz_id, employee_id, answers, score, passed, date_taken, created_at, source) VALUES (999999, ?, 0, '[]', 50, 0, '2026-11-18', ?, 'inline_assessment')"
    ).run(quizId, now).lastInsertRowid);
    check("0. fixture: a quiz assigned to two staff logins; Sam failed at 50, Zed passed at 100; a quiz given on a record",
      samTook.s === 200 && samTook.j.score === 50 && zedTook.s === 200 && zedTook.j.score === 100 && recordResult > 0, `${samTook.s} ${JSON.stringify(samTook.j).slice(0, 80)} ${zedTook.s}`);

    // 1.
    const cols = (sqlite.prepare("PRAGMA table_info(competency_quiz_results)").all() as any[]).map((c) => c.name);
    check("1. competency_quiz_results has voided_at, voided_by_user_id, void_reason", ["voided_at", "voided_by_user_id", "void_reason"].every((c) => cols.includes(c)), cols.join(","));

    const rowOf = (id: number) => sqlite.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(id) as any;
    const samBefore = JSON.stringify((({ voided_at, voided_by_user_id, void_reason, ...rest }) => rest)(rowOf(samResult)));
    const voidUrl = (id: number) => `/api/veritacomp/quiz-results/${id}/void`;
    const REASON = "Scored by a VeritaAssure error on 11/18/2026; made-up test.";

    // 2.
    const bySam = await call("POST", voidUrl(samResult), { reason: REASON }, SAM.token, labA);
    check("2a. a Staff login can't void (403) and nothing changes", bySam.s === 403 && !rowOf(samResult).voided_at, `${bySam.s} ${JSON.stringify(bySam.j)}`);
    const byViewer = await call("POST", voidUrl(samResult), { reason: REASON }, VIEWER.token, labA);
    check("2b. a view-only seat can't void (403)", byViewer.s === 403 && !rowOf(samResult).voided_at, `${byViewer.s}`);
    const bySister = await call("POST", voidUrl(samResult), { reason: REASON }, SISTER_EDITOR.token, labB);
    check("2c. a sister lab's editor gets 404", bySister.s === 404 && !rowOf(samResult).voided_at, `${bySister.s}`);
    const byOther = await call("POST", voidUrl(samResult), { reason: REASON }, OWNER2.token, labOther);
    check("2d. another customer gets 404", byOther.s === 404 && !rowOf(samResult).voided_at, `${byOther.s}`);
    const missing = await call("POST", voidUrl(987654321), { reason: REASON }, EDITOR.token, labA);
    check("2e. an attempt that doesn't exist is 404", missing.s === 404, `${missing.s}`);

    // 3.
    const noReason = await call("POST", voidUrl(samResult), {}, EDITOR.token, labA);
    const spaces = await call("POST", voidUrl(samResult), { reason: "   " }, EDITOR.token, labA);
    const tooLong = await call("POST", voidUrl(samResult), { reason: "x".repeat(501) }, EDITOR.token, labA);
    check("3. a reason is required: none, spaces and over 500 characters are 400 VOID_REASON_REQUIRED, nothing changes",
      [noReason, spaces, tooLong].every((r) => r.s === 400 && r.j.code === "VOID_REASON_REQUIRED") && !rowOf(samResult).voided_at,
      `${noReason.s}/${spaces.s}/${tooLong.s}`);

    // 4.
    const onRecord = await call("POST", voidUrl(recordResult), { reason: REASON }, EDITOR.token, labA);
    check("4. a quiz given on a competency record is 409 NOT_ASSIGNED_ATTEMPT", onRecord.s === 409 && onRecord.j.code === "NOT_ASSIGNED_ATTEMPT" && !rowOf(recordResult).voided_at, `${onRecord.s} ${JSON.stringify(onRecord.j)}`);

    // 5.
    const assignmentBefore = JSON.stringify(sqlite.prepare("SELECT * FROM competency_quiz_assignments WHERE completed_result_id = ?").get(samResult));
    const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_attempt_void'").get() as any).n);
    const voided = await call("POST", voidUrl(samResult), { reason: `  ${REASON}  ` }, EDITOR.token, labA);
    const after = rowOf(samResult);
    check("5a. an editor voids the failed attempt (200)", voided.s === 200 && voided.j.result_id === samResult && voided.j.void_reason === REASON, `${voided.s} ${JSON.stringify(voided.j)}`);
    check("5b. the row keeps its score, result and answers and gains when, who and why (reason trimmed)",
      JSON.stringify((({ voided_at, voided_by_user_id, void_reason, ...rest }) => rest)(after)) === samBefore
      && !!after.voided_at && after.voided_by_user_id === EDITOR.id && after.void_reason === REASON && after.score === 50 && after.passed === 0,
      JSON.stringify({ score: after.score, passed: after.passed, by: after.voided_by_user_id, reason: after.void_reason }));
    check("5c. the assignment is unchanged", JSON.stringify(sqlite.prepare("SELECT * FROM competency_quiz_assignments WHERE completed_result_id = ?").get(samResult)) === assignmentBefore);
    const again = await call("POST", voidUrl(samResult), { reason: REASON }, EDITOR.token, labA);
    check("5d. a second void is 409 ALREADY_VOIDED and the first stands", again.s === 409 && again.j.code === "ALREADY_VOIDED" && rowOf(samResult).voided_at === after.voided_at, `${again.s}`);
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'quiz_attempt_void' ORDER BY id DESC LIMIT 1").get() as any;
    const auditAfter = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_attempt_void'").get() as any).n);
    check("5e. one audit row: action update, the attempt's id, the score before, the reason after",
      auditAfter === auditBefore + 1 && audit?.action === "update" && audit?.entity_id === String(samResult) && audit?.user_id === EDITOR.id
      && JSON.parse(audit.before_json).score === 50 && JSON.parse(audit.before_json).passed === false && JSON.parse(audit.after_json).void_reason === REASON,
      JSON.stringify(audit).slice(0, 300));

    // 6.
    const results = await call("GET", `/api/veritacomp/quizzes/${quizId}/results`, undefined, EDITOR.token, labA);
    const samP = (results.j.people || []).find((p: any) => p.staff_employee_id === samId);
    const samA = samP?.attempts?.[0];
    check("6a. Results: Sam's attempt reads voided with its reason, its score kept, and a retake is offered",
      results.s === 200 && samA?.voided === true && samA?.void_reason === REASON && samA?.score === 50 && samP?.can_retake === true && samP?.next_attempt_no === 2,
      JSON.stringify(samP).slice(0, 300));
    const assignments = await call("GET", `/api/veritacomp/quizzes/${quizId}/assignments`, undefined, EDITOR.token, labA);
    const samAssign = (assignments.j.assignments || []).find((a: any) => a.staff_employee_id === samId);
    const zedAssign = (assignments.j.assignments || []).find((a: any) => a.staff_employee_id === zedId);
    check("6b. the quiz card's assignments mark Sam's attempt voided and Zed's not", samAssign?.voided === true && zedAssign?.voided === false, JSON.stringify({ samAssign, zedAssign }).slice(0, 300));
    const ownList = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${samId}`, undefined, SAM.token);
    const ownRow = (ownList.j.quizzes || []).find((q: any) => q.quiz_id === quizId);
    check("6c. the staff login's own list shows the attempt voided with its reason", ownList.s === 200 && ownRow?.voided === true && ownRow?.void_reason === REASON, JSON.stringify(ownRow));
    const scores = await call("GET", `${L}/competency/quiz-scores`, undefined, EDITOR.token, labA);
    const samScore = (scores.j.rows || []).find((r: any) => r.key === `r${samResult}`);
    const zedScore = (scores.j.rows || []).find((r: any) => r.key === `r${zedResult}`);
    check("6d. Quiz scores: Sam's row reads voided with its reason and score; Zed's reads pass",
      scores.s === 200 && samScore?.result === "voided" && samScore?.void_reason === REASON && samScore?.score === 50 && zedScore?.result === "pass",
      JSON.stringify({ samScore, zedScore }).slice(0, 300));
    const xlsx = await call("GET", `${L}/competency/quiz-scores/export.xlsx`, undefined, EDITOR.token, labA);
    let cellText = "", summary = "";
    try {
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.buf);
      wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
        const v = String(c.value ?? "");
        if (v.startsWith("Voided")) cellText = v;
        if (/ Voided\./.test(v)) summary = v;
      })));
    } catch (e: any) { cellText = `load failed: ${e.message}`; }
    check("6e. the workbook's Result cell reads 'Voided: <reason>' and the About counts name it", xlsx.s === 200 && cellText === `Voided: ${REASON}` && /1 Voided\./.test(summary), `${cellText} | ${summary.slice(0, 160)}`);

    // 7.
    const retake = await call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, { staff_employee_id: samId }, EDITOR.token, labA);
    check("7a. a retake follows the voided attempt (attempt 2)", retake.s === 200 && retake.j.attempt_no === 2, `${retake.s} ${JSON.stringify(retake.j)}`);
    const zedVoid = await call("POST", voidUrl(zedResult), { reason: "Made-up: voided pass" }, OWNER.token, labA);
    const results2 = await call("GET", `/api/veritacomp/quizzes/${quizId}/results`, undefined, OWNER.token, labA);
    const zedP = (results2.j.people || []).find((p: any) => p.staff_employee_id === zedId);
    check("7b. the owner can void a pass, and then a retake is offered", zedVoid.s === 200 && zedP?.attempts?.[0]?.voided === true && zedP?.can_retake === true, `${zedVoid.s} ${JSON.stringify(zedP).slice(0, 200)}`);

    // 8.
    const samTook2 = await take(SAM, samId, ["B", "A"]);   // attempt 2: 0, Fail
    const sam2 = Number(samTook2.j.id);
    const A = "/api/admin/veritacomp/quiz-results/void";
    const noSecret = await call("POST", A, { resultIds: [sam2], reason: REASON });
    check("8a. the admin route answers 403 without the header", noSecret.s === 403, `${noSecret.s}`);
    const dry = await call("POST", A, { resultIds: [sam2, samResult, recordResult], reason: REASON }, undefined, undefined, { "x-admin-secret": ADMIN });
    const planOf = (id: number) => (dry.j.plan || []).find((p: any) => p.resultId === id);
    check("8b. a dry run lists each id: the new attempt voidable, the voided one ALREADY_VOIDED, the record one NOT_ASSIGNED_ATTEMPT; nothing written",
      dry.s === 200 && dry.j.dryRun === true && planOf(sam2)?.voidable === true && planOf(sam2)?.labId === labA && planOf(sam2)?.attemptNo === 2
      && planOf(samResult)?.code === "ALREADY_VOIDED" && planOf(recordResult)?.code === "NOT_ASSIGNED_ATTEMPT" && !rowOf(sam2).voided_at,
      JSON.stringify(dry.j).slice(0, 400));
    const mixed = await call("POST", A, { resultIds: [sam2, samResult], reason: REASON, dryRun: false }, undefined, undefined, { "x-admin-secret": ADMIN });
    check("8c. applying with any id that can't be voided is 409 NOT_ALL_VOIDABLE and writes nothing", mixed.s === 409 && mixed.j.code === "NOT_ALL_VOIDABLE" && !rowOf(sam2).voided_at, `${mixed.s}`);
    const auditN = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_attempt_void'").get() as any).n);
    const applied = await call("POST", A, { resultIds: [sam2], reason: REASON, dryRun: false }, undefined, undefined, { "x-admin-secret": ADMIN });
    const s2 = rowOf(sam2);
    const lastAudit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'quiz_attempt_void' ORDER BY id DESC LIMIT 1").get() as any;
    check("8d. applied: voided as Veritas (user 0) with the reason, one audit row by user 0",
      applied.s === 200 && applied.j.voided?.length === 1 && !!s2.voided_at && s2.voided_by_user_id === 0 && s2.void_reason === REASON
      && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_attempt_void'").get() as any).n) === auditN + 1
      && lastAudit?.user_id === 0 && lastAudit?.entity_id === String(sam2),
      `${applied.s} ${JSON.stringify(applied.j).slice(0, 200)}`);
    const noReasonAdmin = await call("POST", A, { resultIds: [zedResult], reason: " " }, undefined, undefined, { "x-admin-secret": ADMIN });
    check("8e. the admin route needs a reason too (400 VOID_REASON_REQUIRED)", noReasonAdmin.s === 400 && noReasonAdmin.j.code === "VOID_REASON_REQUIRED", `${noReasonAdmin.s}`);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
