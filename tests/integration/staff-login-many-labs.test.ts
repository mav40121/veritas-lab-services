// tests/integration/staff-login-many-labs.test.ts
//
// B3 (BUG-193, Sanford, 2026-11-24): a floating person works in several labs with ONE read-and-sign login. The Staff login invite refused
// any address that already had an account. Boots the REAL routes on a scratch DB with made-up labs and people and proves:
//   1. inviting an address that has an account answers exactly as for one that doesn't, emails that person, and grants nothing
//   2. refused: another account (by link and by id), an expired invite, a cancelled one, a Staff login inviting, another lab's admin,
//      another lab's roster entry, a Veritas support account, a Veritas address, the operator, a script's token
//   3. accepting gives a Staff membership in that lab, tied to that lab's own roster entry, and touches nothing else
//   4. My sign-offs, the bell and the lab list are each lab's own; the switcher moves between them
//   5. a writer in lab A who is Staff in lab S edits A and is refused in S on every road: scoped, unscoped, no header, two labs named,
//      and by a record's id while working in A
//   6. an admin with no seat, an owner, a view-only reviewer and a medical director keep what they had, and are Staff in the new lab
//   7. someone who already owns, manages, edits or directs the lab is refused and changed by nothing
//   8. removing someone from one lab leaves the other alone; they can be invited again; each lab counts its own seats
//   9. one lab can't change a shared sign-in for the others (email, name, two-factor, activity)
//  10. declining ends the invitation only
// Run: npm run test:staff-login-many-labs
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);
const OPERATOR = `operator-${Date.now()}@example.test`;
process.env.OWNER_EMAIL = OPERATOR;

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labSeatSummary } = await import("../../server/labSeats");
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

  // The mail provider, captured. RESEND_API_KEY is set only while an invite is sent, so sign-up confirmation stays off.
  const mails: { to: string; subject: string; html: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith("https://api.resend.com/")) { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "made-up" }), { status: 200 }); }
    return realFetch(url, init);
  }) as any;

  const call = async (method: string, path: string, body: unknown, token?: string, lab?: number | null, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (lab) h["X-Active-Lab-Id"] = String(lab);
    const r = await realFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const get = (path: string, token?: string, lab?: number | null) => call("GET", path, undefined, token, lab);
  const mail = (tag: string) => `sml-${tag}-${stamp}@example.test`;
  const register = async (tag: string, name: string, inviteToken?: string) => {
    const r = await call("POST", "/api/auth/register", { email: mail(tag), password: "Testpass123", name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
    return { token: r.j.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(mail(tag)) as any)?.id), email: mail(tag), s: r.s };
  };
  const provision = async (labName: string, ownerTag: string) => {
    const id = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail(ownerTag), labName, plan: "hospital" })).j.labId);
    sqlite.prepare("UPDATE labs SET is_demo = 0 WHERE id = ?").run(id);
    return id;
  };

  try {
    const OA = await register("ownera", "Made OwnerA"), OB = await register("ownerb", "Made OwnerB");
    const A = await provision("Made-up Main Lab", "ownera"), S = await provision("Made-up Sister Lab", "ownera");
    const B = await provision("Made-up Other Customer Lab", "ownerb");
    sqlite.prepare("UPDATE users SET seat_count = 60 WHERE id IN (?, ?)").run(OA.id, OB.id);
    const ownerOf = (lab: number) => (lab === B ? OB : OA);
    const staffLabOf = (lab: number) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', '22D0000777', ?, ?, ?)").run(ownerOf(lab).id, lab, now, now).lastInsertRowid);
    const roster = (first: string, last: string, lab: number) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2019-03-01', 1, 'active', ?, ?)"
    ).run(staffLabOf(lab), lab, ownerOf(lab).id, last, first, now, now).lastInsertRowid);
    const invite = async (lab: number, employeeId: number, email: string, token = ownerOf(lab).token) => {
      process.env.RESEND_API_KEY = "re_test_dummy";
      try { return await call("POST", `/api/labs/${lab}/staff-portal-invites`, { staff_employee_id: employeeId, email }, token); } finally { delete process.env.RESEND_API_KEY; }
    };
    const seatOf = (email: string, lab: number) => sqlite.prepare("SELECT * FROM user_seats WHERE seat_email = ? AND lab_id = ? ORDER BY id DESC LIMIT 1").get(email, lab) as any;
    const waiting = async (who: { token: string }) => (await get("/api/me/staff-invites", who.token)).j as any[];
    const accept = (who: { token: string }, id: number) => call("POST", `/api/me/staff-invites/${id}/accept`, {}, who.token);
    const acceptLink = (who: { token: string }, token: string) => call("POST", "/api/me/staff-invites/accept", { token }, who.token);
    const memberRow = (lab: number, id: number) => sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(lab, id) as any;
    const writer = async (tag: string, name: string, lab: number) => {
      const [first, last] = name.split(" ");
      await call("POST", `/api/labs/${lab}/members`, { email: mail(tag), role: "staff", firstName: first, lastName: last, permissions: { mode: "edit_all" } }, ownerOf(lab).token);
      return register(tag, name, seatOf(mail(tag), lab).invite_token);
    };

    // The floating person: Staff in lab A first, the usual way.
    const floatA = roster("Flo", "Ating", A), floatS = roster("Flo", "Ating", S), floatB = roster("Flo", "Ating", B);
    const firstInvite = await invite(A, floatA, mail("flo"));
    const FLO = await register("flo", "Flo Ating", firstInvite.j.inviteToken);
    const meBefore = (await get("/api/auth/me", FLO.token)).j;

    // 1. Inviting an address that has an account.
    const newRow = roster("Nova", "Newperson", S);
    const forNew = await invite(S, newRow, mail("nova"));
    const forFlo = await invite(S, floatS, FLO.email);
    const shape = (r: any) => JSON.stringify({ s: r.s, keys: Object.keys(r.j).sort(), ok: r.j.ok, emailSent: r.j.emailSent, linkedToCard: r.j.linkedToCard, linkedName: r.j.linkedName, url: String(r.j.inviteUrl || "").replace(r.j.inviteToken, "T") });
    check("1a. an address with an account is invited", forFlo.s === 200 && forFlo.j.ok === true, JSON.stringify({ s: forFlo.s, e: forFlo.j.error }));
    check("1b. and the inviter's answer is the same as for an address with none", shape(forFlo) === shape(forNew), `${shape(forFlo)} / ${shape(forNew)}`);
    const pendingList = (await get(`/api/labs/${S}/members`, OA.token)).j.pendingInvites as any[];
    const listed = (e: string) => { const p = pendingList.find((x) => x.seat_email === e); return p ? JSON.stringify({ keys: Object.keys(p).sort(), status: p.status, type: p.seat_type }) : "none"; };
    check("1c. the Members page lists both the same way", listed(FLO.email) === listed(mail("nova")) && listed(FLO.email) !== "none", listed(FLO.email));
    const seatS = seatOf(FLO.email, S);
    check("1d. nothing is granted: the seat has no account and there is no membership", seatS.status === "pending" && seatS.seat_user_id === null && !memberRow(S, FLO.id), JSON.stringify({ st: seatS.status, u: seatS.seat_user_id }));
    check("1e. the lab still refuses them", (await get(`/api/labs/${S}/scope-probe`, FLO.token, S)).s === 403);
    const floMail = mails.find((m) => m.to === FLO.email && /Sister Lab/.test(m.html)), newMail = mails.find((m) => m.to === mail("nova"));
    check("1f. only the person's own email says they already have a login", !!floMail && /already have a VeritaAssure/.test(floMail.html) && !/Set a password/.test(floMail.html) && !!newMail && /Set a password/.test(newMail.html) && !/already have/.test(newMail.html));
    const link = (await get(`/api/seats/invite/${seatS.invite_token}`)).j, newLink = (await get(`/api/seats/invite/${seatOf(mail("nova"), S).invite_token}`)).j;
    check("1g. the link's page says it is a staff login and nothing about an account", link.valid === true && link.staffLogin === true && Object.keys(link).sort().join() === Object.keys(newLink).sort().join() && !/account/i.test(JSON.stringify(link)), JSON.stringify(link));

    // 2. Refusals.
    const STRANGER = await register("stranger", "Some Stranger");
    check("2a. the invitation is listed to that person only", (await waiting(FLO)).length === 1 && (await waiting(FLO))[0].id === seatS.id && (await waiting(STRANGER)).length === 0, JSON.stringify(await waiting(FLO)));
    const otherById = await accept(STRANGER, seatS.id), otherByLink = await acceptLink(STRANGER, seatS.invite_token);
    check("2b. another account: by id there is nothing there, by link it's the wrong address", otherById.s === 404 && otherByLink.s === 403 && otherByLink.j.code === "INVITE_OTHER_ACCOUNT", `${otherById.s} ${otherByLink.s} ${otherByLink.j.code}`);
    check("2c. ... and nothing changed", seatOf(FLO.email, S).status === "pending" && !memberRow(S, STRANGER.id));
    check("2d. another account can't decline it either", (await call("POST", `/api/me/staff-invites/${seatS.id}/decline`, {}, STRANGER.token)).s === 404 && seatOf(FLO.email, S).status === "pending");
    const staffInvites = await call("POST", `/api/labs/${A}/staff-portal-invites`, { firstName: "Any", lastName: "Body", email: mail("anybody"), deliverEmail: false }, FLO.token);
    check("2e. a Staff login can't invite", staffInvites.s === 403, `${staffInvites.s}`);
    const outsider = await call("POST", `/api/labs/${B}/staff-portal-invites`, { staff_employee_id: floatB, email: FLO.email, deliverEmail: false }, OA.token);
    check("2f. another lab's owner can't invite here", outsider.s === 403, `${outsider.s}`);
    const wrongRow = await call("POST", `/api/labs/${B}/staff-portal-invites`, { staff_employee_id: floatA, email: FLO.email, deliverEmail: false }, OB.token);
    check("2g. another lab's roster entry is refused", wrongRow.s === 404, `${wrongRow.s}`);
    check("2h. a sister lab's owner route can't cancel or reissue it", (await call("POST", `/api/labs/${A}/seat-invites/${seatS.id}/dismiss`, {}, OA.token)).s === 404 && (await call("POST", `/api/labs/${A}/seat-invites/${seatS.id}/reissue`, {}, OA.token)).s === 404 && seatOf(FLO.email, S).status === "pending");
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 86400000).toISOString(), seatS.id);
    const late = await accept(FLO, seatS.id), lateLink = await acceptLink(FLO, seatS.invite_token);
    check("2i. an expired invite: refused both ways, and not listed", late.s === 400 && late.j.code === "INVITE_EXPIRED" && lateLink.j.code === "INVITE_EXPIRED" && (await waiting(FLO)).length === 0, `${late.s} ${late.j.code}`);
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE id = ?").run(now, seatS.id);
    const cancelRow = roster("Cass", "Cancelled", S);
    await invite(S, cancelRow, STRANGER.email);
    const cancelSeat = seatOf(STRANGER.email, S);
    await call("POST", `/api/labs/${S}/seat-invites/${cancelSeat.id}/dismiss`, {}, OA.token);
    const cancelled = await accept(STRANGER, cancelSeat.id), cancelledLink = await acceptLink(STRANGER, cancelSeat.invite_token);
    check("2j. a cancelled invite: refused both ways, and its link is dead", cancelled.s === 404 && cancelledLink.s === 404 && (await waiting(STRANGER)).length === 0 && (await get(`/api/seats/invite/${cancelSeat.invite_token}`)).j.valid === false && !memberRow(S, STRANGER.id), `${cancelled.s} ${cancelledLink.s}`);
    const SUPPORT = await register("support", "Made Support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(SUPPORT.id);
    const OPER = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Made Operator', 'free', ?)").run(OPERATOR, now).lastInsertRowid);
    const nope = roster("Sup", "Port", S);
    const inviteCode = async (email: string) => { const r = await invite(S, nope, email); return `${r.s} ${r.j.code}`; };
    check("2k. a Veritas support account, the operator and a Veritas address can't be invited", [await inviteCode(SUPPORT.email), await inviteCode(OPERATOR), await inviteCode("someone@veritaslabservices.com")].every((c) => c === "409 STAFF_INVITE_NOT_ALLOWED") && !!OPER && !seatOf(SUPPORT.email, S));
    const planted = Number(sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, 'pending', '{}', ?, ?, 'staff_portal', ?)").run(OA.id, SUPPORT.email, now, `planted-${stamp}`, S, nope).lastInsertRowid);
    const supportAccept = await accept(SUPPORT, planted);
    check("2l. a support account holding an older invite still can't accept it", supportAccept.s === 403 && (await waiting(SUPPORT)).length === 0 && !memberRow(S, SUPPORT.id), `${supportAccept.s} ${supportAccept.j.code}`);
    const script = jwt.sign({ svc: true, userId: FLO.id }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    check("2m. a script's token can't accept for a person", (await accept({ token: script }, seatS.id)).s === 403 && (await acceptLink({ token: script }, seatS.invite_token)).s === 403);
    check("2n. signed out, nobody accepts", (await call("POST", `/api/me/staff-invites/${seatS.id}/accept`, {})).s === 401);
    check("2o. the emailed link doesn't make a second account at the address", (await call("POST", "/api/auth/register", { email: FLO.email, password: "Testpass123", name: "Someone Else", hipaa_acknowledged: true, inviteToken: seatS.invite_token })).s === 409);
    const supportInvite = await call("POST", `/api/labs/${S}/staff-portal-invites`, { staff_employee_id: nope, email: mail("bysupport"), deliverEmail: false }, SUPPORT.token);
    check("2p. Veritas support can't take an invitation link", supportInvite.s === 403, `${supportInvite.s}`);

    // 3. Accepting.
    const userBefore = JSON.stringify(sqlite.prepare("SELECT lab_id, default_lab_id, plan, seat_count, name, email FROM users WHERE id = ?").get(FLO.id));
    const aMember = JSON.stringify(memberRow(A, FLO.id)), aSeat = JSON.stringify(seatOf(FLO.email, A));
    const ok = await accept(FLO, seatS.id);
    const after = seatOf(FLO.email, S);
    check("3a. accepted", ok.s === 200 && ok.j.labId === S && after.status === "active" && after.seat_user_id === FLO.id && !!after.accepted_at, JSON.stringify(ok.j));
    check("3b. a Staff membership in that lab, tied to that lab's own roster entry", memberRow(S, FLO.id)?.role === "staff" && memberRow(S, FLO.id)?.status === "active" && after.staff_employee_id === floatS && after.seat_type === "staff_portal");
    check("3c. the first lab's membership and seat are untouched", JSON.stringify(memberRow(A, FLO.id)) === aMember && JSON.stringify(seatOf(FLO.email, A)) === aSeat);
    check("3d. the account itself is untouched", JSON.stringify(sqlite.prepare("SELECT lab_id, default_lab_id, plan, seat_count, name, email FROM users WHERE id = ?").get(FLO.id)) === userBefore);
    const meAfter = (await get("/api/auth/me", FLO.token)).j;
    check("3e. and reads as it did at sign-in", JSON.stringify([meAfter.isSeatUser, meAfter.seatType, meAfter.ownerUserId, meAfter.plan]) === JSON.stringify([meBefore.isSeatUser, meBefore.seatType, meBefore.ownerUserId, meBefore.plan]));
    check("3f. a second accept is refused", (await accept(FLO, seatS.id)).j.code === "ALREADY_ACCEPTED");
    const audit = sqlite.prepare("SELECT action, entity_label, before_json, after_json FROM audit_log WHERE entity_type = 'staff_invite' AND entity_id = ? ORDER BY id").all(String(seatS.id)) as any[];
    check("3g. the invite and the acceptance are in the audit log, with no address or link", audit.length === 2 && audit[0].action === "create" && /pending/.test(audit[1].before_json) && /active/.test(audit[1].after_json) && !JSON.stringify(audit).includes("@") && !JSON.stringify(audit).includes(seatS.invite_token), JSON.stringify(audit));
    await invite(B, floatB, FLO.email);
    const viaLink = await acceptLink(FLO, seatOf(FLO.email, B).invite_token);
    check("3h. by the emailed link, in another customer's lab too", viaLink.s === 200 && viaLink.j.labId === B && memberRow(B, FLO.id)?.role === "staff", JSON.stringify(viaLink.j));

    sqlite.prepare("UPDATE labs SET mfa_required = 1 WHERE id = ?").run(B);
    const TFA = await register("tfa", "Two Factor");
    await invite(B, roster("Two", "Factor", B), TFA.email);
    const noTfa = await accept(TFA, seatOf(TFA.email, B).id);
    sqlite.prepare("INSERT INTO user_mfa (user_id, method, enabled_at, updated_at) VALUES (?, 'totp', ?, ?)").run(TFA.id, now, now);
    const withTfa = await accept(TFA, seatOf(TFA.email, B).id);
    sqlite.prepare("UPDATE labs SET mfa_required = 0 WHERE id = ?").run(B);
    check("3i. a lab that requires two-factor sign-in is joined only with it", noTfa.s === 403 && noTfa.j.code === "TWO_FACTOR_REQUIRED" && withTfa.s === 200, `${noTfa.s} ${noTfa.j.code} ${withTfa.s}`);

    // 4. Each lab's own.
    const labs = (await get("/api/labs/me", FLO.token)).j as any[];
    const inList = (lab: number) => labs.find((l) => l.labId === lab);
    check("4a. the lab list has all three, Staff in each, with each lab's own roster entry", labs.length === 3 && [[A, floatA], [S, floatS], [B, floatB]].every(([l, e]) => inList(l)?.role === "staff" && inList(l)?.seatType === "staff_portal" && inList(l)?.competencyOwnOnly === true && inList(l)?.ownEmployeeId === e), JSON.stringify(labs.map((l) => [l.labId, l.role, l.seatType, l.ownEmployeeId])));
    const whoAmI = async (lab: number | null) => (await get("/api/me/staff-portal-employee", FLO.token, lab)).j;
    const ids: any[] = []; for (const l of [A, S, B]) ids.push((await whoAmI(l)).employee?.id);
    check("4b. My sign-offs is the lab on screen", ids.join() === [floatA, floatS, floatB].join(), ids.join());
    const sw = await call("POST", "/api/labs/me/default", { labId: S }, FLO.token);
    check("4c. the switcher moves them, and with no lab named My sign-offs follows it", sw.s === 200 && (await whoAmI(null)).employee?.id === floatS, `${sw.s}`);
    const quiz = async (lab: number, emp: number, title: string) => {
      const programId = Number((await call("POST", `/api/labs/${lab}/competency/programs`, { name: `P ${title}`, department: "Chemistry", type: "technical" }, ownerOf(lab).token)).j.id);
      const qid = Number(sqlite.prepare("INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)")
        .run(ownerOf(lab).id, programId, lab, title, ownerOf(lab).id, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now).lastInsertRowid);
      await call("POST", `/api/veritacomp/quizzes/${qid}/assignments`, { staff_employee_ids: [emp] }, ownerOf(lab).token, lab);
      return qid;
    };
    const qA = await quiz(A, floatA, "Quiz at A"), qB = await quiz(B, floatB, "Quiz at B");
    const bell = async (lab?: number) => ((await get(`/api/me/pending-staff-portal-items${lab ? `?lab_id=${lab}` : ""}`, FLO.token, lab)).j.quizzes || []) as any[];
    check("4d. the bell shows one lab's work in that lab, and all of it, marked by lab, everywhere else", (await bell(A)).map((q) => q.quiz_id).join() === String(qA) && (await bell(B)).map((q) => q.quiz_id).join() === String(qB) && (await bell()).map((q) => q.lab_id).sort().join() === [A, B].sort().join(), JSON.stringify(await bell()));
    const assignB = (sqlite.prepare("SELECT id FROM competency_quiz_assignments WHERE quiz_id = ?").get(qB) as any).id;
    const listAt = async (lab: number) => ((await get(`/api/staff-portal-session/quizzes?employee_id=${lab === B ? floatB : floatA}`, FLO.token, lab)).j.quizzes || []).map((q: any) => q.assignment_id) as number[];
    const crossTake = await call("POST", `/api/staff-portal-session/quizzes/${assignB}/attempt`, { answers: [{ question_id: "q1", answer: "A" }], employee_id: floatB }, FLO.token, A);
    check("4e. lab B's quiz is listed in B, not in A, and can't be taken as lab A's person", (await listAt(B)).includes(assignB) && !(await listAt(A)).includes(assignB) && crossTake.s === 403, `${crossTake.s}`);
    const people = async (lab: number) => (await get(`/api/labs/${lab}/staff/employees`, FLO.token, lab)).text;
    roster("Zed", "Coworkerb", B); roster("Yan", "Coworkera", A);
    check("4f. the roster is their own row in each lab", !/Coworkerb/.test(await people(B)) && !/Coworkera/.test(await people(A)) && /Ating/.test(await people(B)));

    // 5. A writer in A, Staff in S.
    const WRI = await writer("wri", "Wri Ter", A);
    const wriMe = (await get("/api/auth/me", WRI.token)).j;
    const wriS = roster("Wri", "Ter", S);
    const wInv = await invite(S, wriS, WRI.email);
    check("5a. a writer in A is invited to S and accepts", wInv.s === 200 && (await accept(WRI, seatOf(WRI.email, S).id)).s === 200 && memberRow(S, WRI.id)?.role === "staff", JSON.stringify({ s: wInv.s, e: wInv.j.error }));
    const wriMe2 = (await get("/api/auth/me", WRI.token)).j;
    check("5b. their account reads as it did", wriMe2.seatType === "active" && JSON.stringify(wriMe2) === JSON.stringify(wriMe), JSON.stringify([wriMe2.seatType, wriMe2.seatPermissions]));
    const ev = (name: string) => ({ enrollment_id: 1, event_date: "2026-11-01", analyte: "Glucose", event_name: name });
    const inA = await call("POST", "/api/veritapt/events", ev("at A"), WRI.token, A);
    check("5c. they still edit A", inA.s === 200 && inA.j.lab_id === A && (await call("POST", `/api/labs/${A}/competency/programs`, { name: "W prog", department: "Chemistry", type: "technical" }, WRI.token, A)).s < 300, JSON.stringify({ s: inA.s, lab: inA.j.lab_id, e: inA.j.error }));
    const countS = () => (sqlite.prepare("SELECT (SELECT COUNT(*) FROM pt_events WHERE lab_id = @s) + (SELECT COUNT(*) FROM veritatrack_tasks WHERE lab_id = @s) + (SELECT COUNT(*) FROM competency_programs WHERE lab_id = @s) AS n").get({ s: S }) as any).n as number;
    const before5 = countS();
    // The shape an invited person has: the account's home lab is the owner's, and the last lab they looked at is S. The older routes
    // judge one and write to the other when no header names a lab.
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A, WRI.id);
    const scoped = await call("POST", `/api/labs/${S}/competency/programs`, { name: "W prog S", department: "Chemistry", type: "technical" }, WRI.token, S);
    const unscoped = await call("POST", "/api/veritapt/events", ev("at S"), WRI.token, S);
    const twoNamed = await call("POST", `/api/veritapt/events?labId=${A}`, ev("two named"), WRI.token, S);
    const bodyNamed = await call("POST", "/api/veritapt/events", { ...ev("body"), lab_id: S }, WRI.token);
    await call("POST", "/api/labs/me/default", { labId: S }, WRI.token);
    const noHeader = await call("POST", "/api/veritapt/events", ev("no header"), WRI.token);
    const noHeaderTask = await call("POST", "/api/veritatrack/tasks", { name: "no header", category: "Other", frequency: "Monthly" }, WRI.token);
    const badHeader = await call("POST", "/api/veritapt/events", ev("bad header"), WRI.token, 999999);
    const study = await call("POST", "/api/studies", { status: "draft", testName: "X", studyType: "precision" }, WRI.token, S);
    check("5d. in S every edit is refused: scoped, unscoped, two labs named, body, no header, a header that isn't theirs, a study", [scoped, unscoped, twoNamed, bodyNamed, noHeader, noHeaderTask, badHeader, study].every((r) => r.s === 403), JSON.stringify([scoped, unscoped, twoNamed, bodyNamed, noHeader, noHeaderTask, badHeader, study].map((r) => r.s)));
    check("5e. and nothing was written there", countS() === before5, `${before5} -> ${countS()}`);
    const wriMe3 = (await get("/api/auth/me", WRI.token)).j;
    check("5e2. looking at S last doesn't make their account a Staff one", wriMe3.seatType === "active" && wriMe3.ownerUserId === OA.id && wriMe3.seatPermissions?.mode === "edit_all", JSON.stringify([wriMe3.seatType, wriMe3.seatPermissions]));
    const sEvent = Number((await call("POST", "/api/veritapt/events", ev("owner at S"), OA.token, S)).j.id);
    const sTask = Number((await call("POST", "/api/veritatrack/tasks", { name: "S task", category: "Other", frequency: "Monthly" }, OA.token, S)).j.id);
    const sMap = Number((await call("POST", "/api/veritamap/maps", { name: "S map" }, OA.token, S)).j.id);
    const sItem = Number(sqlite.prepare("INSERT INTO inventory_items (account_id, lab_id, item_name, quantity_on_hand, created_at, updated_at) VALUES (?, ?, 'S item', 5, ?, ?)").run(OA.id, S, now, now).lastInsertRowid);
    const byId = [
      await call("PUT", `/api/veritapt/events/${sEvent}`, { event_name: "changed" }, WRI.token, A),
      await call("DELETE", `/api/veritapt/events/${sEvent}`, undefined, WRI.token, A),
      await call("PUT", `/api/veritatrack/tasks/${sTask}`, { name: "changed" }, WRI.token, A),
      await call("DELETE", `/api/veritatrack/tasks/${sTask}`, undefined, WRI.token, A),
      await call("DELETE", `/api/veritamap/maps/${sMap}`, undefined, WRI.token, A),
      await call("PUT", `/api/inventory/${sItem}`, { item_name: "changed" }, WRI.token, A),
      await call("DELETE", `/api/inventory/${sItem}`, undefined, WRI.token, A),
    ];
    const kept = (sqlite.prepare("SELECT (SELECT event_name FROM pt_events WHERE id = ?) || (SELECT name FROM veritatrack_tasks WHERE id = ? AND active = 1) || (SELECT name FROM veritamap_maps WHERE id = ?) || (SELECT item_name FROM inventory_items WHERE id = ?) AS t").get(sEvent, sTask, sMap, sItem) as any)?.t;
    check("5f. S's records can't be changed by id while working in A", byId.every((r) => r.s === 403 || r.s === 404) && kept === "owner at SS taskS mapS item", JSON.stringify([byId.map((r) => r.s), kept]));
    const trackA = await get("/api/veritatrack/tasks", WRI.token, A), trackS = await get("/api/veritatrack/tasks", WRI.token, S), oneS = await get(`/api/veritatrack/tasks/${sTask}`, WRI.token, A), twoS = await get(`/api/veritatrack/tasks?labId=${A}`, WRI.token, S), bareS = await get("/api/veritatrack/tasks", WRI.token);
    check("5g. the management views: open in A, closed in S on every road", trackA.s === 200 && [trackS, oneS, twoS, bareS].every((r) => r.s === 403), JSON.stringify([trackA.s, trackS.s, oneS.s, twoS.s, bareS.s]));
    const wLabs = (await get("/api/labs/me", WRI.token)).j as any[];
    check("5h. the lab list says writer in A and Staff in S", wLabs.find((l) => l.labId === A)?.seatType === "active" && !wLabs.find((l) => l.labId === A)?.competencyOwnOnly && wLabs.find((l) => l.labId === S)?.seatType === "staff_portal" && wLabs.find((l) => l.labId === S)?.competencyOwnOnly === true);
    const aEdit = await call("PUT", `/api/veritapt/events/${inA.j.id}`, { event_name: "still mine" }, WRI.token, A);
    check("5i. and A's own records still change", aEdit.s === 200, `${aEdit.s}`);
    // Staff first, writer second: the Staff seat is the older one.
    const LATER = await (async () => { const i = await invite(S, roster("Lat", "Er", S), mail("later")); return register("later", "Lat Er", i.j.inviteToken); })();
    await call("POST", `/api/labs/${A}/members`, { email: mail("later"), role: "staff", firstName: "Lat", lastName: "Er", permissions: { mode: "edit_all" } }, OA.token);
    const lateA = await call("POST", "/api/veritapt/events", ev("later at A"), LATER.token, A), lateS = await call("POST", "/api/veritapt/events", ev("later at S"), LATER.token, S);
    check("5j. Staff first and a writer later: an editor in A, Staff in S, whichever seat is older", lateA.s === 200 && lateS.s === 403 && (await get("/api/veritatrack/tasks", LATER.token, A)).s === 200 && (await get("/api/veritatrack/tasks", LATER.token, S)).s === 403, `${lateA.s} ${lateS.s}`);

    const laterMe = (await get("/api/auth/me", LATER.token)).j;
    check("5k. ... and their account reads as the writer's", laterMe.seatType === "active" && laterMe.seatPermissions?.mode === "edit_all", JSON.stringify([laterMe.seatType, laterMe.seatPermissions]));
    // A member of A with no seat, Staff in another customer's lab: in A nothing is done in that customer's name.
    const PLAIN = await register("plain", "Pla In");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(A, PLAIN.id, now, now, now);
    await invite(B, roster("Pla", "In", B), PLAIN.email);
    const plainAcc = await accept(PLAIN, seatOf(PLAIN.email, B).id);
    const aTask = Number((await call("POST", "/api/veritatrack/tasks", { name: "A task", category: "Other", frequency: "Monthly" }, OA.token, A)).j.id);
    const off = await call("POST", `/api/veritatrack/tasks/${aTask}/signoff`, { completed_date: "2026-11-02", initials: "PI" }, PLAIN.token, A);
    const offRow = sqlite.prepare("SELECT user_id FROM veritatrack_signoffs WHERE task_id = ?").get(aTask) as any;
    check("5l. Staff in another customer's lab never files lab A's work under that customer", plainAcc.s === 200 && off.s === 200 && offRow?.user_id === PLAIN.id && offRow?.user_id !== OB.id, JSON.stringify({ a: plainAcc.s, o: off.s, by: offRow?.user_id, me: PLAIN.id, ob: OB.id }));

    // 6. Nobody is lowered.
    const ADM = await writer("adm", "Adm In", A);
    sqlite.prepare("UPDATE lab_members SET role = 'admin' WHERE lab_id = ? AND user_id = ?").run(A, ADM.id);
    sqlite.prepare("DELETE FROM user_seats WHERE seat_user_id = ?").run(ADM.id);
    const admMe = JSON.stringify((await get("/api/auth/me", ADM.token)).j), admRow = JSON.stringify(memberRow(A, ADM.id));
    await invite(B, roster("Adm", "In", B), ADM.email);
    const admAcc = await accept(ADM, seatOf(ADM.email, B).id);
    check("6a. an admin with no seat accepts in another customer's lab and their account reads the same", admAcc.s === 200 && JSON.stringify((await get("/api/auth/me", ADM.token)).j) === admMe && JSON.stringify(memberRow(A, ADM.id)) === admRow, `${admAcc.s}`);
    const admA = await call("POST", `/api/labs/${A}/competency/programs`, { name: "Adm prog", department: "Chemistry", type: "technical" }, ADM.token, A), admB = await call("POST", `/api/labs/${B}/competency/programs`, { name: "Adm prog B", department: "Chemistry", type: "technical" }, ADM.token, B);
    check("6b. they still run A, and are Staff in B", admA.s < 300 && admB.s === 403 && (await get("/api/veritatrack/tasks", ADM.token, A)).s === 200 && (await get("/api/veritatrack/tasks", ADM.token, B)).s === 403 && (await get(`/api/labs/${B}/members`, ADM.token, B)).j.ownOnly === true, `${admA.s} ${admB.s}`);
    const obMe = JSON.stringify((await get("/api/auth/me", OB.token)).j);
    await invite(A, roster("Made", "OwnerB", A), OB.email, OA.token);
    const obAcc = await accept(OB, seatOf(OB.email, A).id);
    const obOwn = await call("POST", "/api/veritapt/events", ev("owner B"), OB.token, B), obInA = await call("POST", "/api/veritapt/events", ev("owner B in A"), OB.token, A);
    check("6c. an owner accepts, keeps their lab and their account, and is Staff in the other", obAcc.s === 200 && JSON.stringify((await get("/api/auth/me", OB.token)).j) === obMe && obOwn.s === 200 && obInA.s === 403 && (sqlite.prepare("SELECT owner_user_id AS o FROM labs WHERE id = ?").get(B) as any).o === OB.id && memberRow(B, OB.id)?.role === "owner", `${obAcc.s} ${obOwn.s} ${obInA.s}`);
    const VIEW = await writer("view", "View Only", A);
    sqlite.prepare("UPDATE user_seats SET seat_type = 'view_only', permissions = '{\"mode\":\"view_all\"}' WHERE seat_user_id = ?").run(VIEW.id);
    await invite(S, roster("View", "Only", S), VIEW.email);
    const viewAcc = await accept(VIEW, seatOf(VIEW.email, S).id);
    check("6d. a view-only reviewer can accept, and is still view-only in A", viewAcc.s === 200 && (await call("POST", "/api/veritapt/events", ev("v"), VIEW.token, A)).j.error === "view_only_seat" && (await get("/api/me/staff-portal-employee", VIEW.token, S)).j.lab?.id === S, `${viewAcc.s} ${viewAcc.text.slice(0, 120)}`);
    const MD = await writer("md", "Med Director", A);
    await call("PUT", `/api/labs/${A}/medical-director`, { email: MD.email, name: "Med Director" }, OA.token);
    const mdRow = JSON.stringify(memberRow(A, MD.id));
    sqlite.prepare("UPDATE labs SET medical_director_email = NULL WHERE id = ?").run(S);
    await invite(S, roster("Med", "Director", S), MD.email);
    const mdAcc = await accept(MD, seatOf(MD.email, S).id);
    check("6e. a medical director stays the director and admin of A, and Staff in S is only Staff", mdAcc.s === 200 && JSON.parse(mdRow).role === "admin" && JSON.stringify(memberRow(A, MD.id)) === mdRow && memberRow(S, MD.id)?.role === "staff" && (sqlite.prepare("SELECT medical_director_email AS m FROM labs WHERE id = ?").get(A) as any).m === MD.email, `${mdAcc.s} ${mdRow.slice(0, 120)}`);

    // 7. Already in the lab.
    const spare = roster("Spare", "Row", A);
    const already = async (email: string) => { const r = await call("POST", `/api/labs/${A}/staff-portal-invites`, { staff_employee_id: spare, email, deliverEmail: false }, OA.token); return `${r.s} ${r.j.code ?? r.j.error}`; };
    const four = [await already(OA.email), await already(ADM.email), await already(WRI.email), await already(MD.email)];
    check("7a. the lab's owner, admin, writer and medical director aren't given a staff login in it", four.every((c) => c === "409 ALREADY_IN_LAB"), four.join(" | "));
    const CLIMB = await register("climb", "Cli Mber");
    const climbRow = roster("Cli", "Mber", A);
    await invite(A, climbRow, CLIMB.email);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, ?, ?, ?)").run(A, CLIMB.id, now, now, now);
    const climbAcc = await accept(CLIMB, seatOf(CLIMB.email, A).id);
    check("7b. made an admin after the invite went out: accepting is refused and their role stays", climbAcc.s === 409 && memberRow(A, CLIMB.id).role === "admin" && seatOf(CLIMB.email, A).status === "pending", `${climbAcc.s}`);
    const takenRow = roster("Taken", "Entry", A);
    sqlite.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(ADM.id, takenRow);
    const taken = await call("POST", `/api/labs/${A}/staff-portal-invites`, { staff_employee_id: takenRow, email: STRANGER.email, deliverEmail: false }, OA.token);
    check("7c. a roster entry someone else's sign-in is on isn't given to a second person", taken.s === 409 && taken.j.code === "ROSTER_ENTRY_TAKEN", `${taken.s} ${taken.j.code}`);

    // 8. Removing from one lab.
    const seatsIn = (lab: number) => labSeatSummary(sqlite, lab)!.staffPortalUsed;
    const usedA = seatsIn(A), usedS = seatsIn(S), usedB = seatsIn(B), activeA = labSeatSummary(sqlite, A)!.activeUsed;
    await call("POST", "/api/labs/me/default", { labId: S }, FLO.token);
    const removed = await call("DELETE", `/api/labs/${S}/members/${memberRow(S, FLO.id).id}`, undefined, OA.token);
    const ptBare = await get("/api/veritapt/events", FLO.token), ptStale = await get("/api/veritapt/events", FLO.token, S);
    check("8a. removed from S: S refuses them", removed.s === 200 && (await get(`/api/labs/${S}/scope-probe`, FLO.token, S)).s === 403 && seatOf(FLO.email, S).status === "deactivated", `${removed.s}`);
    check("8b. A and B are as they were", (await get(`/api/labs/${A}/scope-probe`, FLO.token, A)).s === 200 && (await get(`/api/labs/${B}/scope-probe`, FLO.token, B)).s === 200 && seatOf(FLO.email, A).status === "active" && seatOf(FLO.email, B).status === "active" && (await whoAmI(A)).employee?.id === floatA);
    check("8c. the older routes don't keep landing in S", [ptBare, ptStale].every((r) => r.s === 200 && Array.isArray(r.j) && r.j.length > 0 && r.j.every((e: any) => e.lab_id !== S)) && (sqlite.prepare("SELECT default_lab_id AS d FROM users WHERE id = ?").get(FLO.id) as any).d !== S, JSON.stringify([ptBare.s, ptStale.s]));
    check("8d. each lab counts its own staff seats", seatsIn(S) === usedS - 1 && seatsIn(A) === usedA && seatsIn(B) === usedB && labSeatSummary(sqlite, A)!.activeUsed === activeA, JSON.stringify([usedA, usedS, usedB, seatsIn(A), seatsIn(S), seatsIn(B)]));
    const again = await invite(S, floatS, FLO.email);
    check("8e. and they can be invited back", again.s === 200 && (await accept(FLO, seatOf(FLO.email, S).id)).s === 200 && memberRow(S, FLO.id)?.role === "staff", JSON.stringify({ s: again.s, e: again.j.error }));

    // 9. A shared sign-in.
    const mid = (lab: number, id: number) => memberRow(lab, id).id;
    const em = await call("PATCH", `/api/labs/${B}/members/${mid(B, FLO.id)}/email`, { email: mail("hijack") }, OB.token), nm = await call("PATCH", `/api/labs/${B}/members/${mid(B, FLO.id)}/name`, { name: "Renamed Person" }, OB.token);
    check("9a. one customer's lab can't change the shared sign-in's email or name", em.s === 409 && em.j.code === "LOGIN_SHARED" && nm.s === 409 && (sqlite.prepare("SELECT email FROM users WHERE id = ?").get(FLO.id) as any).email === FLO.email, `${em.s} ${nm.s}`);
    const ONLY = await (async () => { const i = await invite(B, roster("On", "Ly", B), mail("only")); return register("only", "On Ly", i.j.inviteToken); })();
    const em2 = await call("PATCH", `/api/labs/${B}/members/${mid(B, ONLY.id)}/email`, { email: mail("onlyfixed") }, OB.token);
    check("9b. a person in one lab is corrected as before", em2.s === 200, `${em2.s} ${em2.j.error ?? ""}`);
    const tfa = await call("POST", `/api/labs/${B}/two-factor/reset/${ADM.id}`, {}, OB.token), tfaFlo = await call("POST", `/api/labs/${B}/two-factor/reset/${FLO.id}`, {}, OB.token);
    check("9c. two-factor: refused for someone who runs another lab, allowed for someone who is only Staff elsewhere", tfa.s === 409 && tfa.j.code === "LOGIN_SHARED" && tfaFlo.s === 200, `${tfa.s} ${tfaFlo.s}`);
    const act = await call("GET", `/api/account/seats/${seatOf(ADM.email, B).id}/activity`, undefined, OB.token);
    check("9d. the owner's activity summary leaves out the other customer's lab", act.s === 200 && !/Adm prog"|Made-up Main/.test(act.text) && (act.j.recentActions || []).every((a: any) => a.entityLabel !== "Adm prog"), act.text.slice(0, 300));

    // 10. Declining.
    const FLO2 = await register("dec", "Dec Line");
    const decRow = roster("Dec", "Line", B);
    await invite(B, decRow, FLO2.email);
    const dec = await call("POST", `/api/me/staff-invites/${seatOf(FLO2.email, B).id}/decline`, {}, FLO2.token);
    check("10. declining ends the invitation, frees the seat and grants nothing", dec.s === 200 && seatOf(FLO2.email, B).status === "dismissed" && !memberRow(B, FLO2.id) && (await waiting(FLO2)).length === 0 && (await accept(FLO2, seatOf(FLO2.email, B).id)).s === 404, `${dec.s}`);
  } catch (e: any) {
    check("no unexpected error", false, e?.stack || String(e));
  } finally {
    globalThis.fetch = realFetch;
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
