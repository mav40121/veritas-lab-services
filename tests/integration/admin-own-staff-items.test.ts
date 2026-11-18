// tests/integration/admin-own-staff-items.test.ts
//
// Michael 2026-11-18: "Quizzes can be assigned to admins just as easy as staff. That's the real fix." Redington's
// microbiology supervisor, on an admin (writer) seat, could be assigned a quiz but had no bell and no Take a Quiz: the bell
// route, /api/me/staff-portal-employee and the My sign-offs session gate only knew a Staff login's seat. They now also take
// the roster row an admin or editor's own sign-in is linked to (staff_employees.login_user_id; server/ownRoster.ts). Boots the
// REAL routes on a scratch DB with made-up people and proves:
//   1. an admin on a writer seat, linked to their roster row, sees the assigned quiz on the bell and as their own employee
//   2. they list it and take it in My sign-offs with their normal sign-in: scored, assignment completed, off the bell
//   3. they can't act as another roster row (403 STAFF_PORTAL_NOT_SELF)
//   4. the owner, whose id sits in staff_employees.user_id on every row, still gets nothing (the 2026-10-08 rule)
//   5. an editor with no roster link gets nothing; an admin whose membership ended gets nothing
//   6. a Staff login is unchanged
// Run: npm run test:admin-own-staff-items
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
  const call = async (method: string, path: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `aos-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const OWNER = await register("owner"), SUPER = await register("supervisor"), EDITOR = await register("editor"), STAFF = await register("staff"), GONE = await register("gone");
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Own Items Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    const H = { "X-Active-Lab-Id": String(labId) };
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Own Items Lab", cliaNumber: "11D7654393", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const person = async (last: string, first: string) => Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const superRow = await person("Morgan", "Made"), staffRow = await person("Tech", "Made"), goneRow = await person("Gone", "Made"), editorRow = await person("Editor", "Made");
    const member = (userId: number, role: string, status = "active") => sqlite.prepare(
      "INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, 1, ?, ?, ?)").run(labId, userId, role, status, now, now, now);
    const seat = (u: { id: number; email: string }, type: string, rosterId: number | null) => sqlite.prepare(
      "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)"
    ).run(OWNER.id, u.email, u.id, now, now, type === "staff_portal" ? '{"mode":"view_all"}' : '{"mode":"edit_all"}', `aos-${u.id}-${stamp}`, labId, type, rosterId);
    // The supervisor: an admin on a writer seat, linked to their own roster row the way VeritaStaff's "Link to existing entry" does.
    member(SUPER.id, "admin"); seat(SUPER, "active", null);
    sqlite.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(SUPER.id, superRow);
    // An editor on a writer seat with no roster link; a Staff login; an admin whose membership ended but whose row is still linked.
    member(EDITOR.id, "editor"); seat(EDITOR, "active", null);
    member(STAFF.id, "staff"); seat(STAFF, "staff_portal", staffRow);
    member(GONE.id, "admin", "removed"); sqlite.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(GONE.id, goneRow);

    const programId = Number((await call("POST", `${L}/competency/programs`, { name: "Made-up Gram Stain", department: "Microbiology", type: "technical" }, OWNER.token)).j.id);
    const quizId = Number(sqlite.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, 'Made-up Gram Stain Quiz', '[]', ?, ?, ?)"
    ).run(OWNER.id, programId, labId, OWNER.id, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now).lastInsertRowid);
    const assigned = await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [superRow, staffRow, goneRow, editorRow] }, OWNER.token, H);
    check("0. the quiz is assigned to the admin, the Staff login and two others by the owner", assigned.s === 200 && (assigned.j.created || []).length === 4, JSON.stringify(assigned.j));
    const assignmentOf = (row: number) => Number((sqlite.prepare("SELECT id FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ?").get(quizId, row) as any).id);

    // 1. the admin's bell and identity
    const bell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, SUPER.token);
    check("1a. the admin's bell lists the quiz assigned to them", bell.s === 200 && (bell.j.quizzes || []).some((q: any) => q.quiz_id === quizId && q.assignment_id === assignmentOf(superRow)), JSON.stringify(bell.j));
    const me = await call("GET", "/api/me/staff-portal-employee", undefined, SUPER.token);
    check("1b. My sign-offs knows the admin as their own roster row", me.s === 200 && me.j.employee?.id === superRow && me.j.lab?.id === labId, JSON.stringify(me.j));

    // 2. take it with the normal sign-in
    const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${superRow}`, undefined, SUPER.token);
    const listed = (Array.isArray(list.j) ? list.j : list.j.quizzes || list.j.assignments || []).some((q: any) => Number(q.assignment_id ?? q.id) === assignmentOf(superRow));
    check("2a. Take a Quiz lists it for the admin", list.s === 200 && listed, `${list.s} ${list.text.slice(0, 200)}`);
    const took = await call("POST", `/api/staff-portal-session/quizzes/${assignmentOf(superRow)}/attempt`, { employee_id: superRow, answers: [{ question_id: "q1", selected_answer: "A" }], typed_signature: "Made Morgan" }, SUPER.token);
    const status = (sqlite.prepare("SELECT status FROM competency_quiz_assignments WHERE id = ?").get(assignmentOf(superRow)) as any).status;
    check("2b. the attempt is scored 100 and the assignment is completed", took.s === 200 && took.j.score === 100 && status === "completed", JSON.stringify({ s: took.s, j: took.j, status }));
    const bellAfter = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, SUPER.token);
    check("2c. and it leaves the admin's bell", !(bellAfter.j.quizzes || []).some((q: any) => q.quiz_id === quizId), JSON.stringify(bellAfter.j.quizzes));

    // 3. never as someone else
    const asOther = await call("POST", `/api/staff-portal-session/quizzes/${assignmentOf(staffRow)}/attempt`, { employee_id: staffRow, answers: [{ question_id: "q1", selected_answer: "A" }], typed_signature: "Made Morgan" }, SUPER.token);
    check("3. the admin can't take the Staff login's quiz (403 STAFF_PORTAL_NOT_SELF)", asOther.s === 403 && asOther.j.code === "STAFF_PORTAL_NOT_SELF", JSON.stringify(asOther.j));

    // 4. the 10/8 rule: the owner's id is in staff_employees.user_id on every row, and still maps to nobody
    const ownerRows = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_employees WHERE tier2_lab_id = ? AND user_id = ?").get(labId, OWNER.id) as any).n);
    const ownerBell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, OWNER.token);
    const ownerMe = await call("GET", "/api/me/staff-portal-employee", undefined, OWNER.token);
    check("4. the owner (user_id on every roster row) still gets no quizzes and no roster identity", ownerRows >= 4 && (ownerBell.j.quizzes || []).length === 0 && ownerMe.s === 404, JSON.stringify({ ownerRows, quizzes: ownerBell.j.quizzes, me: ownerMe.s }));

    // 5. no link, or a membership that ended
    const editorBell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, EDITOR.token);
    const editorMe = await call("GET", "/api/me/staff-portal-employee", undefined, EDITOR.token);
    check("5a. an editor with no roster link gets nothing", (editorBell.j.quizzes || []).length === 0 && editorMe.s === 404, JSON.stringify({ q: editorBell.j.quizzes, me: editorMe.s }));
    const goneBell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, GONE.token);
    const goneMe = await call("GET", "/api/me/staff-portal-employee", undefined, GONE.token);
    const goneTake = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${goneRow}`, undefined, GONE.token);
    check("5b. an admin whose membership ended gets nothing, though the row is still linked", (goneBell.j.quizzes || []).length === 0 && goneMe.s === 404 && goneTake.s === 401, JSON.stringify({ q: goneBell.j.quizzes, me: goneMe.s, take: goneTake.s }));

    // 6. a Staff login is unchanged
    const staffBell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, STAFF.token);
    const staffMe = await call("GET", "/api/me/staff-portal-employee", undefined, STAFF.token);
    check("6. a Staff login still sees its own quiz and its own row", (staffBell.j.quizzes || []).some((q: any) => q.assignment_id === assignmentOf(staffRow)) && staffMe.j.employee?.id === staffRow, JSON.stringify({ q: staffBell.j.quizzes, me: staffMe.j.employee?.id }));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
