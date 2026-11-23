// tests/integration/invite-links-roster.test.ts
//
// BUG-183 (Redington 2026-11-23): an admin assigned the Micro quizzes had an empty bell. A quiz belongs to a roster entry, and an
// admin or editor invite never tied the person's sign-in to the entry they already had. Boots the REAL routes on a scratch DB with
// made-up people and proves:
//   1. an admin invited by name who signs up is tied to their one roster entry, and their bell lists the quiz assigned to it
//   2. an editor who already has an account is tied the moment they are invited
//   3. the name that counts is the one the director typed: a person who signs up under someone else's name gets nobody's entry
//   4. left alone, for the VeritaStaff prompt: two entries with the same name, an entry someone else's sign-in or Staff invite is on,
//      a different first name with the same first word, no name on the invite, an entry in another lab, a person who left
//   5. a person marked "not lab personnel" and a Staff (read-and-sign) invite are unchanged
//   6. the link is in the audit log and names no one
// Run: npm run test:invite-links-roster
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
  const mail = (tag: string) => `ilr-${tag}-${stamp}@example.test`;
  const register = async (tag: string, name: string, inviteToken?: string) => {
    const r = await call("POST", "/api/auth/register", { email: mail(tag), password: "Testpass123", name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(mail(tag)) as any)?.id);
    return { token: r.j.token as string, id, s: r.s };
  };

  try {
    const OWNER = await register("owner", "Made Owner");
    const provision = async (labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail("owner"), labName, plan: "hospital" })).j.labId);
    const labId = await provision("Made-up Invite Link Lab"), otherLab = await provision("Made-up Other Lab");
    sqlite.prepare("UPDATE users SET seat_count = 60 WHERE id = ?").run(OWNER.id);
    const L = `/api/labs/${labId}`;
    const H = { "X-Active-Lab-Id": String(labId) };
    const staffLabOf = (lab: number) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', '22D0000777', ?, ?, ?)").run(OWNER.id, lab, now, now).lastInsertRowid);
    const row = (first: string, last: string, lab = labId, login: number | null = null) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, login_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2019-03-01', 1, ?, 'active', ?, ?)"
    ).run(staffLabOf(lab), lab, OWNER.id, last, first, login, now, now).lastInsertRowid);
    const linkOf = (id: number) => (sqlite.prepare("SELECT login_user_id FROM staff_employees WHERE id = ?").get(id) as any).login_user_id as number | null;
    const invite = async (tag: string, first: string, last: string, extra: any = {}) => {
      const r = await call("POST", `${L}/members`, { email: mail(tag), role: "admin", firstName: first, lastName: last, ...extra }, OWNER.token);
      const token = (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ? AND lab_id = ?").get(mail(tag), labId) as any)?.invite_token as string;
      return { s: r.s, token, j: r.j };
    };

    // 1. The report: an admin with a roster entry, a quiz assigned to it, then the invite accepted.
    const adminRow = row("Robin", "Micro");
    const programId = Number((await call("POST", `${L}/competency/programs`, { name: "Made-up Micro", department: "Microbiology", type: "technical" }, OWNER.token)).j.id);
    const quizId = Number(sqlite.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, 'Made-up Micro Quiz', '[]', ?, ?, ?)"
    ).run(OWNER.id, programId, labId, OWNER.id, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now).lastInsertRowid);
    const assigned = await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [adminRow] }, OWNER.token, H);
    const i1 = await invite("robin", "Robin", "Micro");
    check("0. the quiz is assigned and the admin invite is waiting", assigned.s === 200 && i1.s === 200 && !!i1.token && linkOf(adminRow) === null, JSON.stringify({ a: assigned.s, i: i1.s, e: i1.j.error }));
    const ROBIN = await register("robin", "Robin Micro", i1.token);
    check("1a. accepting the invite ties the roster entry to that sign-in", ROBIN.s === 200 && linkOf(adminRow) === ROBIN.id, JSON.stringify({ s: ROBIN.s, link: linkOf(adminRow), id: ROBIN.id }));
    const bell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, ROBIN.token);
    check("1b. the bell lists the quiz", bell.s === 200 && (bell.j.quizzes || []).some((q: any) => q.quiz_id === quizId), JSON.stringify(bell.j));
    const me = await call("GET", "/api/me/staff-portal-employee", undefined, ROBIN.token);
    check("1c. My sign-offs knows them", me.s === 200 && me.j.employee?.id === adminRow && me.j.lab?.id === labId, JSON.stringify(me.j));

    // 2. An editor who already has an account is a member at once.
    const editorRow = row("Cal R.", "Tester");
    const CAL = await register("cal", "Cal Tester");
    const i2 = await invite("cal", "Cal", "Tester", { role: "staff" });
    check("2. an editor with an account is tied when invited (a middle initial in the entry still matches)", i2.s === 200 && linkOf(editorRow) === CAL.id, JSON.stringify({ s: i2.s, e: i2.j.error, st: i2.j.status, link: linkOf(editorRow) }));

    // 3. The director's typed name counts, not the one typed at sign-up.
    const bossRow = row("Dana", "Director");
    const i3 = await invite("pretend", "Pat", "Newcomer");
    const PRETEND = await register("pretend", "Dana Director", i3.token);
    check("3a. signing up under someone else's name ties nobody", PRETEND.s === 200 && linkOf(bossRow) === null, JSON.stringify({ s: PRETEND.s, link: linkOf(bossRow) }));
    const pretendMe = await call("GET", "/api/me/staff-portal-employee", undefined, PRETEND.token);
    check("3b. and they have no roster identity", pretendMe.s === 404, `${pretendMe.s}`);

    // 4. Left for the VeritaStaff prompt.
    const twinA = row("Sam", "Twin"), twinB = row("Sam", "Twin");
    const i4 = await invite("sam", "Sam", "Twin"); await register("sam", "Sam Twin", i4.token);
    check("4a. two entries with the same name: neither", linkOf(twinA) === null && linkOf(twinB) === null);
    const taken = row("Lee", "Taken", labId, OWNER.id);
    const i5 = await invite("lee", "Lee", "Taken"); await register("lee", "Lee Taken", i5.token);
    check("4b. an entry on another sign-in is not moved", linkOf(taken) === OWNER.id, `${linkOf(taken)}`);
    const staffInvited = row("Kim", "Waiting");
    const sp = await call("POST", `${L}/staff-portal-invites`, { staff_employee_id: staffInvited, email: mail("kimstaff"), deliverEmail: false }, OWNER.token);
    const i6 = await invite("kim", "Kim", "Waiting"); await register("kim", "Kim Waiting", i6.token);
    check("4c. an entry with a Staff invite waiting is left", sp.s === 200 && linkOf(staffInvited) === null, JSON.stringify({ sp: sp.s, e: sp.j.error, link: linkOf(staffInvited) }));
    const maryBeth = row("Mary Beth", "Smith");
    const i7 = await invite("mary", "Mary Ann", "Smith"); await register("mary", "Mary Ann Smith", i7.token);
    check("4d. Mary Ann is not Mary Beth", linkOf(maryBeth) === null, `${linkOf(maryBeth)}`);
    const unnamedRow = row("Una", "Named");
    const i8 = await invite("una", "", ""); await register("una", "Una Named", i8.token);
    check("4e. an invite with no name ties nobody", linkOf(unnamedRow) === null, `${linkOf(unnamedRow)}`);
    const elsewhere = row("Eve", "Elsewhere", otherLab);
    const i9 = await invite("eve", "Eve", "Elsewhere"); await register("eve", "Eve Elsewhere", i9.token);
    check("4f. an entry in another lab is not tied", linkOf(elsewhere) === null, `${linkOf(elsewhere)}`);
    const leftRow = row("Lou", "Left"); sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(leftRow);
    const i10 = await invite("lou", "Lou", "Left"); await register("lou", "Lou Left", i10.token);
    check("4g. a person who left is not tied", linkOf(leftRow) === null, `${linkOf(leftRow)}`);

    // 5. Unchanged.
    const hiddenRow = row("Hal", "Hidden");
    const HAL = await register("hal", "Hal Hidden");
    sqlite.prepare("INSERT INTO staff_roster_prompt_hidden (lab_id, user_id, hidden_by_user_id, hidden_at) VALUES (?, ?, ?, ?)").run(labId, HAL.id, OWNER.id, now);
    await invite("hal", "Hal", "Hidden");
    check("5a. someone marked not lab personnel is left", linkOf(hiddenRow) === null, `${linkOf(hiddenRow)}`);
    const portalRow = row("Stan", "Portal");
    const spi = await call("POST", `${L}/staff-portal-invites`, { staff_employee_id: portalRow, email: mail("stan"), deliverEmail: false }, OWNER.token);
    const spToken = (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ?").get(mail("stan")) as any)?.invite_token;
    const STAN = await register("stan", "Stan Portal", spToken);
    const stanMe = await call("GET", "/api/me/staff-portal-employee", undefined, STAN.token);
    check("5b. a Staff login is still tied through its seat, not this link", spi.s === 200 && linkOf(portalRow) === null && stanMe.j.employee?.id === portalRow, JSON.stringify({ link: linkOf(portalRow), me: stanMe.s }));

    // 6. The audit log.
    const audit = sqlite.prepare("SELECT user_id, entity_id, entity_label, after_json FROM audit_log WHERE entity_type = 'staff_employee.login_link' ORDER BY id").all() as any[];
    check("6. each link is in the audit log, by ids", audit.length === 2 && audit[0].entity_id === String(adminRow) && audit[0].user_id === ROBIN.id && audit[1].entity_id === String(editorRow) && !/Robin|Cal|@/.test(JSON.stringify(audit)), JSON.stringify(audit));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
