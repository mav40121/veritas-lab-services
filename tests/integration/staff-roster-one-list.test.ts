// tests/integration/staff-roster-one-list.test.ts
//
// STANDING integration test for one list of staff (Michael 2026-11-04, Redington: "as they add staff seats it is duplicating rows"; "at time of invite, can we link it to the staff card?"):
//   1. A Staff invite by typed name links to the person's existing roster row and makes no second one, through case, spacing and a middle initial. Someone new still gets a row.
//   2. Two people with the same name: the one with no login is used; if that doesn't settle it, the director is told to invite from the row. An existing login or a waiting invite isn't doubled.
//   3. The Lab Members list shows everyone on the roster as login, invited or not invited, for owners and admins only, and contacts nobody.
//   4. A pending invite left on a removed row re-attaches to the real row.
//   5. A second card an invite already made folds into the real one, seat and signatures included, whenever anyone opens the list. It is set aside, never deleted.
//   6. A row holding real work is never folded, and a same-name row with a login isn't a target.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:staff-roster-one-list

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Roster", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const stamp = Date.now();
    const mkLab = async (tag: string) => {
      const email = `roster-${tag}-${stamp}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
      const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Roster Lab ${tag}`, plan: "hospital", isWarehouse: true });
      return { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
    };
    const A = await mkLab("a");
    const B = await mkLab("b");
    const row = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any;
    const staffLab = row?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Roster Lab', '22D0000777', ?, ?, ?)").run(A.userId, A.labId, now, now).lastInsertRowid);
    const addRow = (first: string, last: string, extra: { hire?: string; testing?: number; login?: number | null; middle?: string } = {}) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, middle_initial, hire_date, performs_testing, login_user_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)"
    ).run(staffLab, A.labId, A.userId, last, first, extra.middle ?? null, extra.hire ?? "2026-02-06", extra.testing ?? 1, extra.login ?? null, now, now).lastInsertRowid);
    const L = `/api/labs/${A.labId}`;
    const invite = (body: any) => call("POST", `${L}/staff-portal-invites`, { deliverEmail: false, ...body }, A.token);
    const rowCount = (first: string, last: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND lower(last_name) = lower(?) AND lower(first_name) LIKE lower(?)").get(A.labId, last, `${first}%`) as any).n;
    const mail = (tag: string) => `roster-${tag}-${stamp}@example.com`;
    const statusOf = async (id: number) => (await call("GET", `${L}/staff-roster-status`, undefined, A.token)).body.people?.find((p: any) => p.employeeId === id);

    // 1. Linking at invite
    const ann = addRow("Ann", "Signer", { middle: "V" });
    const i1 = await invite({ firstName: "Ann", lastName: "Signer", email: mail("ann") });
    check("1. a typed invite links to the existing row", i1.status === 200 && i1.body.staffEmployeeId === ann && i1.body.linkedToCard === true && /Signer, Ann/.test(i1.body.linkedName), JSON.stringify({ s: i1.status, e: i1.body.error, id: i1.body.staffEmployeeId }));
    check("1. and makes no second row", rowCount("Ann", "Signer") === 1, `${rowCount("Ann", "Signer")}`);
    const bea = addRow("Bea", "O'Neil");
    const i2 = await invite({ firstName: "  bea ", lastName: "O'NEIL", email: mail("bea") });
    check("1. case and spacing don't matter", i2.body.staffEmployeeId === bea && rowCount("Bea", "O'Neil") === 1, JSON.stringify(i2.body.error || i2.body.staffEmployeeId));
    const cal = addRow("Cal R.", "Tester");
    const i3 = await invite({ firstName: "Cal", lastName: "Tester", email: mail("cal") });
    check("1. a middle initial typed in the first name still matches", i3.body.staffEmployeeId === cal && rowCount("Cal", "Tester") === 1);
    const i4 = await invite({ firstName: "Nina", lastName: "Newhire", email: mail("nina") });
    check("1. someone new still gets a row", i4.status === 200 && i4.body.linkedToCard === false && rowCount("Nina", "Newhire") === 1, JSON.stringify(i4.body.error));

    // 2. The same name, and not doubling up
    const twinLogin = (await call("POST", "/api/auth/register", { email: mail("twin"), password: PW, name: "Twin Login", hipaa_acknowledged: true })).body;
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, Number(twinLogin.user?.id), now, now, now);
    addRow("Sam", "Twin", { login: Number(twinLogin.user?.id) });
    const samFree = addRow("Sam", "Twin");
    const i5 = await invite({ firstName: "Sam", lastName: "Twin", email: mail("sam") });
    check("2. two same names: the one with no login is used", i5.body.staffEmployeeId === samFree, JSON.stringify(i5.body.error || i5.body.staffEmployeeId));
    addRow("Pat", "Pair"); addRow("Pat", "Pair");
    const i6 = await invite({ firstName: "Pat", lastName: "Pair", email: mail("pat") });
    check("2. two free same names asks to invite from the row", i6.status === 409 && i6.body.code === "ROSTER_NAME_AMBIGUOUS" && rowCount("Pat", "Pair") === 2, `HTTP ${i6.status}`);
    const i7 = await invite({ firstName: "Ann", lastName: "Signer", email: mail("ann2") });
    check("2. a waiting invite isn't doubled at another address", i7.status === 409 && i7.body.code === "INVITE_PENDING", `HTTP ${i7.status} ${i7.body.code}`);
    sqlite.prepare("UPDATE user_seats SET accepted_at = ?, status = 'active' WHERE seat_email = ?").run(now, mail("cal"));
    const i8 = await invite({ firstName: "Cal", lastName: "Tester", email: mail("cal2") });
    check("2. someone with a login isn't invited again", i8.status === 409 && /already has a staff login/.test(i8.body.error), `HTTP ${i8.status}`);

    // 3. The list
    const noInvite = addRow("Dee", "Waiting");
    const left = addRow("Lee", "Leaving");
    sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(left);
    const s3 = await call("GET", `${L}/staff-roster-status`, undefined, A.token);
    const by = (id: number) => s3.body.people?.find((p: any) => p.employeeId === id);
    check("3. someone not invited yet is listed", s3.status === 200 && by(noInvite)?.status === "not_invited" && by(noInvite)?.email === null, JSON.stringify(by(noInvite)));
    check("3. someone invited shows it, with the address", by(ann)?.status === "invited" && by(ann)?.email === mail("ann"));
    check("3. someone with a login shows it", by(cal)?.status === "login");
    check("3. someone who left isn't listed", !by(left));
    check("3. the counts add up", s3.body.counts.login + s3.body.counts.invited + s3.body.counts.not_invited === s3.body.counts.total, JSON.stringify(s3.body.counts));
    const seatsBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ?").get(A.labId) as any).n;
    await call("GET", `${L}/staff-roster-status`, undefined, A.token);
    check("3. listing someone creates no seat and contacts nobody", (sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ?").get(A.labId) as any).n === seatsBefore);
    const i9 = await invite({ staff_employee_id: noInvite, email: mail("dee") });
    check("3. inviting from the list uses that row", i9.status === 200 && i9.body.staffEmployeeId === noInvite && rowCount("Dee", "Waiting") === 1, `HTTP ${i9.status}`);
    const otherLab = await call("GET", `${L}/staff-roster-status`, undefined, B.token);
    check("3. another lab can't read it", [403, 404].includes(otherLab.status), `HTTP ${otherLab.status}`);
    const editorEmail = mail("editor");
    const editorReg = await call("POST", "/api/auth/register", { email: editorEmail, password: PW, name: "Eddie Editor", hipaa_acknowledged: true });
    const editorId = Number(editorReg.body.user?.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, editorId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A.labId, editorId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(editorId);
    const editorLogin = await call("POST", "/api/auth/login", { email: editorEmail, password: PW });
    check("3. someone who isn't an owner or admin can't read it", (await call("GET", `${L}/staff-roster-status`, undefined, editorLogin.body.token)).status === 403);

    // 4. An invite left on a removed row
    const realGus = addRow("Gus", "Moved");
    const removedGus = addRow("Gus", "Moved", { hire: undefined, testing: 0 });
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, seat_type, lab_id, staff_employee_id, invited_at, invite_token) VALUES (?, ?, 'pending', 'staff_portal', ?, ?, ?, ?)").run(A.userId, mail("gus"), A.labId, removedGus, now, `t-gus-${stamp}`);
    sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(removedGus);
    await call("GET", `${L}/staff-portal-invites`, undefined, A.token);
    check("4. a pending invite on a removed row re-attaches to the real one", (sqlite.prepare("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?").get(mail("gus")) as any).e === realGus);

    // 5. Folding a second card an invite already made (the Redington case)
    const realSyl = addRow("Sylvia", "Card", { hire: "2026-02-06", testing: 1 });
    const stubSyl = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Card', 'Sylvia', 'H', 0, 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, seat_type, lab_id, staff_employee_id, invited_at, invite_token) VALUES (?, ?, 'pending', 'staff_portal', ?, ?, ?, ?)").run(A.userId, mail("syl"), A.labId, stubSyl, now, `t-syl-${stamp}`);
    sqlite.prepare("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, typed_signature) VALUES (?, 999001, 999001, ?, 'Sylvia Card')").run(A.labId, stubSyl);
    const list = await call("GET", `${L}/staff/employees`, undefined, A.token);
    const rows: any[] = Array.isArray(list.body) ? list.body : list.body.employees || [];
    check("5. the list shows one card", rows.filter((r) => r.last_name === "Card").length === 1 && rows.some((r) => r.id === realSyl) && !rows.some((r) => r.id === stubSyl), `${rows.filter((r) => r.last_name === "Card").length}`);
    check("5. the invite moved to the real card", (sqlite.prepare("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?").get(mail("syl")) as any).e === realSyl);
    check("5. a signature moved with it", (sqlite.prepare("SELECT staff_employee_id AS e FROM staff_portal_policy_signatures WHERE document_id = 999001").get() as any).e === realSyl);
    check("5. the extra row is set aside, not deleted", (sqlite.prepare("SELECT status FROM staff_employees WHERE id = ?").get(stubSyl) as any)?.status === "merged_duplicate");
    check("5. it doesn't appear as someone who left", !((await call("GET", `${L}/staff/employees-terminated`, undefined, A.token)).body || []).some((e: any) => e.id === stubSyl));
    check("5. the real card shows as invited", (await statusOf(realSyl))?.status === "invited");

    // 6. Never folded
    const realWork = addRow("Wes", "Work");
    const stubWork = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Work', 'Wes', 0, 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, seat_type, lab_id, staff_employee_id, invited_at, invite_token) VALUES (?, ?, 'pending', 'staff_portal', ?, ?, ?, ?)").run(A.userId, mail("wes"), A.labId, stubWork, now, `t-wes-${stamp}`);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, tier2_lab_id, role, specialty_number) VALUES (?, ?, ?, 'TP', 7)").run(stubWork, staffLab, A.labId);
    await call("GET", `${L}/staff/employees`, undefined, A.token);
    check("6. a row with a role on it is never folded", (sqlite.prepare("SELECT status FROM staff_employees WHERE id = ?").get(stubWork) as any).status === "active" && (sqlite.prepare("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?").get(mail("wes")) as any).e === stubWork && realWork > 0);
    const loginUser = (await call("POST", "/api/auth/register", { email: mail("kim"), password: PW, name: "Kim Login", hipaa_acknowledged: true })).body;
    addRow("Kim", "Linked", { login: Number(loginUser.user?.id) });
    const stubKim = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Linked', 'Kim', 0, 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, seat_type, lab_id, staff_employee_id, invited_at, invite_token) VALUES (?, ?, 'pending', 'staff_portal', ?, ?, ?, ?)").run(A.userId, mail("kim2"), A.labId, stubKim, now, `t-kim-${stamp}`);
    await call("GET", `${L}/staff/employees`, undefined, A.token);
    check("6. a same-name row with a login isn't a target", (sqlite.prepare("SELECT status FROM staff_employees WHERE id = ?").get(stubKim) as any).status === "active");
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
