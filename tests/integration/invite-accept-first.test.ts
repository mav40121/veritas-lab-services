// tests/integration/invite-accept-first.test.ts
//
// Michael 2026-11-24: an account joins a lab only when its own person accepts (server/labInvites.ts). An admin, editor, reviewer or
// medical director invite to an address that already had an account used to add the person at once. Boots the REAL routes on a
// scratch DB with made-up labs and people and proves:
//   1. for each kind of invite the answer, the Members page and the seat count are the same whether or not the address has an account,
//      and the person isn't a member: 403 on the lab, no roster link, nothing on their account
//   2. a medical director named by an invite acts only once they accept; until then an approval step naming the director behaves as it
//      does with a pending invite to a brand-new address, and the competency escalation goes to the lab's owner
//   3. accepting gives what was offered, saying what it was, with the roster link and the audit rows
//   4. refused: another account, expired, cancelled, a Veritas support account, a script's token, two-factor
//   5. declined, cancelled or expired: no seat, no membership, and the medical director is who it was before
//   6. a brand-new address signs up from its link exactly as before
//   7. the older account-level invite waits too; a current member's seat is given back at once, as before; the Veritas route is unchanged
//   8. VeritaStock's locations only move people who already work in one of them
// Run: npm run test:invite-accept-first
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labSeatSummary } = await import("../../server/labSeats");
  const { canUserApproveStep, resolveActiveMedicalDirectorUserId } = await import("../../server/veritapolicyApproval");
  const { planCompetencyReminders, readCompetencyReminderConfig } = await import("../../server/competencyReminders");
  const { runUnclaimedSeatInvites, setUnclaimedSeatMailerForTest } = await import("../../server/unclaimedSeatInvites");
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

  const mails: { to: string; subject: string; html: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    if (String(url).startsWith("https://api.resend.com/")) { mails.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "made-up" }), { status: 200 }); }
    return realFetch(url, init);
  }) as any;
  const call = async (method: string, path: string, body: unknown, token?: string, lab?: number | null) => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    if (lab) h["X-Active-Lab-Id"] = String(lab);
    const r = await realFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const get = (path: string, token?: string, lab?: number | null) => call("GET", path, undefined, token, lab);
  const mail = (tag: string) => `iaf-${tag}-${stamp}@example.test`;
  const register = async (tag: string, name: string, inviteToken?: string) => {
    const r = await call("POST", "/api/auth/register", { email: mail(tag), password: "Testpass123", name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
    return { token: r.j.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(mail(tag)) as any)?.id), email: mail(tag), s: r.s };
  };
  const provision = async (labName: string, ownerTag: string, plan = "hospital") => {
    const id = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail(ownerTag), labName, plan })).j.labId);
    sqlite.prepare("UPDATE labs SET is_demo = 0 WHERE id = ?").run(id);
    return id;
  };
  const seatOf = (email: string, lab: number) => sqlite.prepare("SELECT * FROM user_seats WHERE seat_email = ? AND lab_id = ? ORDER BY id DESC LIMIT 1").get(email, lab) as any;
  const memberRow = (lab: number, id: number) => sqlite.prepare("SELECT * FROM lab_members WHERE lab_id = ? AND user_id = ?").get(lab, id) as any;
  const labRow = (lab: number) => sqlite.prepare("SELECT medical_director_email AS e, medical_director_name AS n FROM labs WHERE id = ?").get(lab) as any;
  const userRow = (id: number) => JSON.stringify(sqlite.prepare("SELECT lab_id, default_lab_id, plan, seat_count, name, email FROM users WHERE id = ?").get(id));
  const waiting = async (who: { token: string }) => (await get("/api/me/lab-invites", who.token)).j as any[];
  const accept = (who: { token: string }, id: number) => call("POST", `/api/me/lab-invites/${id}/accept`, {}, who.token);
  const acceptLink = (who: { token: string }, token: string) => call("POST", "/api/me/lab-invites/accept", { token }, who.token);

  try {
    const OA = await register("ownera", "Made OwnerA"), OB = await register("ownerb", "Made OwnerB");
    sqlite.prepare("UPDATE users SET seat_count = 60, plan = 'hospital' WHERE id IN (?, ?)").run(OA.id, OB.id);
    const A = await provision("Made-up Accept Lab", "ownera"), B = await provision("Made-up Home Lab", "ownerb");
    const staffLab = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', '22D0000777', ?, ?, ?)").run(OA.id, A, now, now).lastInsertRowid);
    const roster = (first: string, last: string) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2019-03-01', 1, 'active', ?, ?)"
    ).run(staffLab, A, OA.id, last, first, now, now).lastInsertRowid);
    const linkOf = (id: number) => (sqlite.prepare("SELECT login_user_id FROM staff_employees WHERE id = ?").get(id) as any).login_user_id as number | null;
    const invite = async (email: string, body: Record<string, unknown>, lab = A, token = OA.token) => {
      process.env.RESEND_API_KEY = "re_test_dummy";
      try { return await call("POST", `/api/labs/${lab}/members`, { email, ...body }, token); } finally { delete process.env.RESEND_API_KEY; }
    };
    const shape = (r: any) => JSON.stringify({ s: r.s, keys: Object.keys(r.j).sort(), ok: r.j.ok, status: r.j.status, emailSent: r.j.emailSent, role: r.j.role });
    const listed = async (email: string) => { const p = ((await get(`/api/labs/${A}/members`, OA.token)).j.pendingInvites as any[]).find((x) => x.seat_email === email); return p ? JSON.stringify({ keys: Object.keys(p).sort(), status: p.status, type: p.seat_type, role: p.invite_role, name: p.invitee_name }) : "none"; };
    const used = () => labSeatSummary(sqlite, A)!.activeUsed;

    // 1. Each kind of invite.
    const kinds: { tag: string; body: Record<string, unknown>; offer: string; role: string; costs: number }[] = [
      { tag: "admin", body: { role: "admin", firstName: "Ada", lastName: "Min" }, offer: "an admin", role: "admin", costs: 1 },
      { tag: "editor", body: { role: "staff", firstName: "Ed", lastName: "Itor", permissions: { mode: "edit_all" } }, offer: "an editor", role: "staff", costs: 1 },
      { tag: "viewer", body: { role: "staff", firstName: "Vi", lastName: "Ewer", permissions: { mode: "view_all" } }, offer: "a member (view only)", role: "staff", costs: 1 },
      { tag: "reviewer", body: { role: "staff", seatType: "view_only", firstName: "Rev", lastName: "Iewer" }, offer: "a reviewer (view only)", role: "staff", costs: 0 },
    ];
    const people: Record<string, any> = {};
    for (const k of kinds) {
      const [first, last] = [String(k.body.firstName), String(k.body.lastName)];
      const P = await register(k.tag, `${first} ${last}`);
      const row = roster(first, last);
      const account = userRow(P.id);
      const before = used();
      const r = await invite(P.email, k.body);
      const held = used() - before;
      const rNew = await invite(mail(`${k.tag}-new`), { ...k.body, firstName: first, lastName: `${last}x` });
      const seat = seatOf(P.email, A);
      people[k.tag] = { P, row, seat };
      check(`1. ${k.tag}: the answer is the same as for an address with no account`, r.s === 200 && shape(r) === shape(rNew) && r.j.status === "pending", `${shape(r)} / ${shape(rNew)} ${r.j.error ?? ""}`);
      check(`1. ${k.tag}: and so is the Members page`, (await listed(P.email)).replace(`${last}"`, `${last}x"`) === await listed(mail(`${k.tag}-new`)), `${await listed(P.email)}`);
      check(`1. ${k.tag}: not a member, no roster link, nothing on the account, 403 on the lab`, seat.status === "pending" && seat.seat_user_id === null && !memberRow(A, P.id) && linkOf(row) === null && userRow(P.id) === account && (await get(`/api/labs/${A}/scope-probe`, P.token, A)).s === 403 && (await get(`/api/labs/${A}/members`, P.token, A)).s === 403 && !((await get("/api/labs/me", P.token)).j as any[]).some((l) => l.labId === A));
      check(`1. ${k.tag}: the seat holds its place`, held === k.costs && used() - before === k.costs * 2, `${held} ${used() - before}`);
      check(`1. ${k.tag}: the banner says what is offered`, (await waiting(P)).length === 1 && (await waiting(P))[0].offer === k.offer && (await waiting(P))[0].labName === "Made-up Accept Lab", JSON.stringify(await waiting(P)));
      const m = mails.find((x) => x.to === P.email), mNew = mails.find((x) => x.to === mail(`${k.tag}-new`));
      check(`1. ${k.tag}: only their own email says they already have a login, and as what`, !!m && /already have a VeritaAssure/.test(m.html) && m.html.includes(k.offer) && !!mNew && !/already have/.test(mNew.html) && m.subject === mNew.subject);
    }
    const twice = await invite(people.editor.P.email, kinds[1].body);
    check("1b. a second invite to the same address is refused, as any pending one is", twice.s === 409, `${twice.s}`);

    // 2. A medical director. Lab N has one named by an invite to a brand-new address, lab A by an invite to an existing account.
    const N = await provision("Made-up New Director Lab", "ownera");
    const firstMd = await register("firstmd", "First Director");
    const firstSeat = await invite(firstMd.email, { role: "medical_director", firstName: "First", lastName: "Director" });
    await accept(firstMd, seatOf(firstMd.email, A).id);
    check("2a. a director who accepts is the director, and an admin", firstSeat.s === 200 && resolveActiveMedicalDirectorUserId(sqlite, A) === firstMd.id && memberRow(A, firstMd.id)?.role === "admin", JSON.stringify(firstSeat.j));
    await call("PUT", `/api/labs/${A}/medical-director`, { email: "" }, OA.token);
    const MD = await register("md", "Dee Rector");
    const mdAnswer = await invite(MD.email, { role: "medical_director", firstName: "", lastName: "" });
    const mdNewAnswer = await invite(mail("md-new"), { role: "medical_director", firstName: "", lastName: "" }, N);
    check("2b. the director invite answers the same either way", mdAnswer.s === 200 && shape(mdAnswer) === shape(mdNewAnswer), `${shape(mdAnswer)} / ${shape(mdNewAnswer)}`);
    const mdShown = (await get(`/api/labs/${A}/members`, OA.token)).j.medicalDirector, mdNewShown = (await get(`/api/labs/${N}/members`, OA.token)).j.medicalDirector;
    check("2c. and the Members page names the address the same way, with no name taken from the account", mdShown?.email === MD.email && mdShown?.name === mdNewShown?.name && mdNewShown?.email === mail("md-new"), JSON.stringify([mdShown, mdNewShown]));
    const step = (lab: number, userId: number, isMajorRevision = false) => JSON.stringify(canUserApproveStep(sqlite, { userId, labId: lab, documentOwnerId: 999999, stepRow: { required_role: "medical_director", specific_user_id: null, allow_self_approval: 0 }, isMajorRevision }));
    check("2d. until they accept, a step naming the director behaves as it does with a pending invite to a new address", resolveActiveMedicalDirectorUserId(sqlite, A) === null && resolveActiveMedicalDirectorUserId(sqlite, N) === null && step(A, OA.id) === step(N, OA.id) && step(A, OA.id, true) === step(N, OA.id, true) && JSON.parse(step(A, MD.id)).ok === false, `${step(A, OA.id)} ${step(N, OA.id)} ${step(A, MD.id)}`);
    const letters = (await get(`/api/labs/${A}/director-delegations/catalog`, OA.token, A)).j;
    check("2e. nor do they sign letters, or read the lab", letters.medicalDirectorIsMember === false && (await get(`/api/labs/${A}/director-delegations/catalog`, MD.token, A)).s === 403 && !memberRow(A, MD.id));
    const escalation = (lab: number) => planCompetencyReminders(sqlite, lab, { ...readCompetencyReminderConfig(sqlite, lab), enabled: true, escalation_recipients: [] } as any, "2026-11-24").filter((p) => p.kind === "escalation").flatMap((p) => p.recipients.map((x) => x.email));
    check("2f. the competency escalation goes to the lab's owner, not to someone who hasn't accepted", !escalation(A).includes(MD.email) && !escalation(N).includes(mail("md-new")), JSON.stringify([escalation(A), escalation(N)]));
    check("2g. the banner says medical director", (await waiting(MD))[0]?.offer === "medical director", JSON.stringify(await waiting(MD)));
    sqlite.prepare("UPDATE user_seats SET invite_role = 'staff' WHERE id = ?").run(seatOf(MD.email, A).id); // an older director invite: it is accepting that makes them an admin
    const mdAccepted = await accept(MD, seatOf(MD.email, A).id);
    check("2h. accepting makes them the director: the step is theirs, they are an admin, and their name shows", mdAccepted.s === 200 && resolveActiveMedicalDirectorUserId(sqlite, A) === MD.id && JSON.parse(step(A, MD.id, true)).ok === true && JSON.parse(step(A, OA.id, true)).ok === false && memberRow(A, MD.id)?.role === "admin" && labRow(A).n === "Dee Rector", JSON.stringify([mdAccepted.j, labRow(A), memberRow(A, MD.id)?.role]));
    check("2i. and the escalation is theirs", escalation(A).every((e) => e === MD.email), JSON.stringify(escalation(A)));

    // 3. Accepting.
    const { P: ADM, row: admRow, seat: admSeat } = people.admin;
    const link = (await get(`/api/seats/invite/${admSeat.invite_token}`)).j, linkNew = (await get(`/api/seats/invite/${seatOf(mail("admin-new"), A).invite_token}`)).j;
    check("3a. the link's page says what is offered and nothing about an account", link.valid && link.offer === "an admin" && linkNew.offer === "an admin" && Object.keys(link).sort().join() === Object.keys(linkNew).sort().join());
    const byLink = await acceptLink(ADM, admSeat.invite_token);
    check("3b. an admin, by the emailed link: an admin, and tied to the one roster entry with the name", byLink.s === 200 && memberRow(A, ADM.id)?.role === "admin" && memberRow(A, ADM.id)?.status === "active" && linkOf(admRow) === ADM.id && seatOf(ADM.email, A).seat_user_id === ADM.id, JSON.stringify([byLink.j, memberRow(A, ADM.id)?.role, linkOf(admRow)]));
    for (const [tag, edits, seatType] of [["editor", true, "active"], ["viewer", false, "active"], ["reviewer", false, "view_only"]] as const) {
      const { P, seat, row } = people[tag];
      const r = await accept(P, seat.id);
      const write = await call("POST", `/api/labs/${A}/competency/programs`, { name: `By ${tag}`, department: "Chemistry", type: "technical" }, P.token, A);
      check(`3c. ${tag}: joins with what was offered and no more`, r.s === 200 && memberRow(A, P.id)?.role === "staff" && seatOf(P.email, A).seat_type === seatType && (write.s < 300) === edits && linkOf(row) === P.id, `${r.s} ${write.s} ${linkOf(row)}`);
    }
    const audit = sqlite.prepare("SELECT action, entity_label, before_json, after_json FROM audit_log WHERE entity_type = 'lab_invite' AND entity_id = ? ORDER BY id").all(String(admSeat.id)) as any[];
    const joined = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'lab_members' AND action = 'create:lab-invite:accept' AND user_id = ?").get(ADM.id) as any;
    check("3d. the invite, the acceptance and the membership are in the audit log, with no address or link", audit.length === 2 && audit[0].action === "create" && /as an admin/.test(audit[0].entity_label) && JSON.parse(audit[1].after_json).role === "admin" && joined.n === 1 && !JSON.stringify(audit).includes("@") && !JSON.stringify(audit).includes(admSeat.invite_token), JSON.stringify(audit));
    check("3e. accepting twice is refused", (await accept(ADM, admSeat.id)).j.code === "ALREADY_ACCEPTED");
    const roles = [ADM, people.editor.P].map((p) => userRow(p.id));
    check("3f. nothing is written on the account", roles.every((r) => JSON.parse(r).lab_id !== A || JSON.parse(r).lab_id === null), roles.join());

    // 4. Refusals.
    const STRANGER = await register("stranger", "Some Stranger"), LATE = await register("late", "La Te");
    await invite(LATE.email, { role: "admin", firstName: "La", lastName: "Te" });
    const lateSeat = seatOf(LATE.email, A);
    const other = [await accept(STRANGER, lateSeat.id), await acceptLink(STRANGER, lateSeat.invite_token), await call("POST", `/api/me/lab-invites/${lateSeat.id}/decline`, {}, STRANGER.token)];
    check("4a. another account: nothing there by id, the wrong address by link, and it can't decline it", other.map((r) => r.s).join() === "404,403,404" && other[1].j.code === "INVITE_OTHER_ACCOUNT" && seatOf(LATE.email, A).status === "pending" && !memberRow(A, STRANGER.id), other.map((r) => r.s).join());
    const script = jwt.sign({ svc: true, userId: LATE.id }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    check("4b. a script's token can't accept for a person", (await accept({ token: script }, lateSeat.id)).s === 403 && (await acceptLink({ token: script }, lateSeat.invite_token)).s === 403);
    sqlite.prepare("UPDATE labs SET mfa_required = 1 WHERE id = ?").run(A);
    const noTfa = await accept(LATE, lateSeat.id);
    sqlite.prepare("UPDATE labs SET mfa_required = 0 WHERE id = ?").run(A);
    check("4c. a lab that requires two-factor isn't joined without it", noTfa.s === 403 && noTfa.j.code === "TWO_FACTOR_REQUIRED", `${noTfa.s}`);
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 86400000).toISOString(), lateSeat.id);
    check("4d. an expired one: refused both ways and not listed", (await accept(LATE, lateSeat.id)).j.code === "INVITE_EXPIRED" && (await acceptLink(LATE, lateSeat.invite_token)).j.code === "INVITE_EXPIRED" && (await waiting(LATE)).length === 0);
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE id = ?").run(now, lateSeat.id);
    const SUPPORT = await register("support", "Made Support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(SUPPORT.id);
    const supInvite = await invite(SUPPORT.email, { role: "admin", firstName: "Sup", lastName: "Port" });
    const planted = Number(sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, invite_token, lab_id, seat_type, invite_role) VALUES (?, ?, ?, 'pending', '{}', ?, ?, 'active', 'admin')").run(OA.id, SUPPORT.email, now, `planted-${stamp}`, A).lastInsertRowid);
    check("4e. a Veritas support account can't be invited, or accept an older invite", supInvite.s === 409 && supInvite.j.code === "INVITE_NOT_ALLOWED" && (await accept(SUPPORT, planted)).s === 403 && (await waiting(SUPPORT)).length === 0 && !memberRow(A, SUPPORT.id), `${supInvite.s}`);
    check("4f. signed out, nobody accepts", (await call("POST", `/api/me/lab-invites/${lateSeat.id}/accept`, {})).s === 401);
    const member = await invite(people.editor.P.email, kinds[1].body);
    check("4g. a current member isn't invited again", member.s === 409 && /already a member/.test(member.j.error), `${member.s}`);
    const own = await invite(OA.email, { role: "admin", firstName: "Made", lastName: "OwnerA" });
    check("4h. nor is the lab's owner", own.s === 409, `${own.s}`);

    // 5. Declined, cancelled, expired.
    const director = labRow(A);
    const placeBefore = used();
    const next = async (tag: string) => { const P = await register(tag, `Next ${tag}`); await invite(P.email, { role: "medical_director", firstName: "Next", lastName: tag }); return { P, seat: seatOf(P.email, A) }; };
    const d1 = await next("decliner");
    check("5a. a new director invite names them, as it always has", labRow(A).e === d1.P.email && resolveActiveMedicalDirectorUserId(sqlite, A) === null);
    const declined = await call("POST", `/api/me/lab-invites/${d1.seat.id}/decline`, {}, d1.P.token);
    check("5b. declined: the director is who it was, with no seat and no membership", declined.s === 200 && JSON.stringify(labRow(A)) === JSON.stringify(director) && resolveActiveMedicalDirectorUserId(sqlite, A) === MD.id && seatOf(d1.P.email, A).status === "dismissed" && !memberRow(A, d1.P.id) && (await listed(d1.P.email)) === "none" && used() === placeBefore, JSON.stringify([declined.s, labRow(A), used(), placeBefore]));
    const rows = sqlite.prepare("SELECT action, after_json FROM audit_log WHERE entity_type = 'lab_invite' AND entity_id = ? ORDER BY id").all(String(d1.seat.id)) as any[];
    check("5c. the audit rows are what is left", rows.length === 2 && /put back/.test(rows[1].after_json), JSON.stringify(rows));
    const d2 = await next("cancelled");
    await call("POST", `/api/labs/${A}/seat-invites/${d2.seat.id}/dismiss`, {}, OA.token);
    check("5d. cancelled: the same, and it can't be accepted", JSON.stringify(labRow(A)) === JSON.stringify(director) && (await accept(d2.P, d2.seat.id)).s === 404 && (await acceptLink(d2.P, d2.seat.invite_token)).s === 404 && (await get(`/api/seats/invite/${d2.seat.invite_token}`)).j.valid === false && !memberRow(A, d2.P.id));
    const d3 = await next("expired");
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE id = ?").run(new Date(Date.now() - 31 * 86400000).toISOString(), d3.seat.id);
    setUnclaimedSeatMailerForTest(async () => {});
    const swept = await runUnclaimedSeatInvites({});
    setUnclaimedSeatMailerForTest(null);
    check("5e. expired: the daily job ends it the same way", swept.ended >= 1 && seatOf(d3.P.email, A).status === "deactivated" && JSON.stringify(labRow(A)) === JSON.stringify(director) && !memberRow(A, d3.P.id) && used() === placeBefore, JSON.stringify([swept.ended, labRow(A)]));
    const d4 = await next("replaced");
    await call("PUT", `/api/labs/${A}/medical-director`, { email: ADM.email, name: "Ada Min" }, OA.token);
    await call("POST", `/api/me/lab-invites/${d4.seat.id}/decline`, {}, d4.P.token);
    check("5f. but a director named since then stands", labRow(A).e === ADM.email, JSON.stringify(labRow(A)));
    await call("PUT", `/api/labs/${A}/medical-director`, { email: MD.email, name: "Dee Rector" }, OA.token);
    const again = await invite(d1.P.email, { role: "admin", firstName: "Next", lastName: "decliner" });
    check("5g. and someone who declined can be invited again", again.s === 200 && (await accept(d1.P, seatOf(d1.P.email, A).id)).s === 200 && memberRow(A, d1.P.id)?.role === "admin", `${again.s}`);

    // 6. A brand-new address.
    const freshRow = roster("Fre", "Sh");
    await invite(mail("fresh"), { role: "admin", firstName: "Fre", lastName: "Sh" });
    const FRESH = await register("fresh", "Fre Sh", seatOf(mail("fresh"), A).invite_token);
    check("6a. a brand-new address signs up from its link and joins, as before", FRESH.s === 200 && memberRow(A, FRESH.id)?.role === "admin" && linkOf(freshRow) === FRESH.id, `${FRESH.s}`);
    const NMD = await register("md-new", "New Director", seatOf(mail("md-new"), N).invite_token);
    check("6b. and a brand-new director becomes the director and an admin", NMD.s === 200 && resolveActiveMedicalDirectorUserId(sqlite, N) === NMD.id && memberRow(N, NMD.id)?.role === "admin", `${NMD.s}`);

    // 7. The older account-level invite.
    const S2 = await register("acct", "Ac Count");
    const acctRow = userRow(S2.id);
    const acct = await call("POST", "/api/account/seats", { email: S2.email, permissions: { mode: "edit_all" } }, OB.token);
    const acctNew = await call("POST", "/api/account/seats", { email: mail("acct-new"), permissions: { mode: "edit_all" } }, OB.token);
    check("7a. the older invite waits too, and answers the same", acct.s === 200 && JSON.stringify(acct.j) === JSON.stringify(acctNew.j) && acct.j.status === "pending" && !memberRow(B, S2.id) && userRow(S2.id) === acctRow && (await get(`/api/labs/${B}/scope-probe`, S2.token, B)).s === 403, JSON.stringify([acct.j, acctNew.j]));
    const acctAcc = await accept(S2, seatOf(S2.email, B).id);
    check("7b. and joins that lab when accepted", acctAcc.s === 200 && acctAcc.j.labId === B && memberRow(B, S2.id)?.role === "staff", JSON.stringify(acctAcc.j));
    await call("DELETE", `/api/account/seats/${seatOf(S2.email, B).id}`, undefined, OB.token);
    const back = await call("POST", "/api/account/seats", { email: S2.email, permissions: { mode: "edit_all" } }, OB.token);
    check("7c. a current member's seat is given back at once, as before", back.s === 200 && back.j.status === "active" && seatOf(S2.email, B).status === "active" && seatOf(S2.email, B).seat_user_id === S2.id, JSON.stringify(back.j));
    // An owner of two labs, with none in view: the seat has no lab, and the invitation is for their primary one.
    await call("POST", "/api/labs/me/default", { labId: A }, OA.token);
    const S3 = await register("nolab", "No Lab");
    await call("POST", "/api/account/seats", { email: S3.email, permissions: { mode: "edit_all" } }, OA.token);
    const s3Seat = sqlite.prepare("SELECT * FROM user_seats WHERE seat_email = ?").get(S3.email) as any;
    const primary = Number((sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND is_primary_lab = 1").get(OA.id) as any)?.lab_id);
    const s3Acc = await accept(S3, s3Seat.id);
    check("7d. an older invite with no lab joins the owner's primary lab, as signing up does", s3Seat.lab_id === null && s3Acc.s === 200 && s3Acc.j.labId === primary && memberRow(primary, S3.id)?.role === "staff" && (sqlite.prepare("SELECT lab_id FROM user_seats WHERE id = ?").get(s3Seat.id) as any).lab_id === primary, JSON.stringify([s3Seat.lab_id, s3Acc.j, primary]));
    const V1 = await register("veritas", "By Veritas");
    const adminRoute = await call("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: B, email: V1.email, role: "admin" });
    check("7e. the Veritas provisioning route is unchanged", adminRoute.s === 200 && memberRow(B, V1.id)?.status === "active", `${adminRoute.s} ${adminRoute.j.error ?? ""}`);

    // 8. VeritaStock locations.
    const noJoin = await call("POST", `/api/labs/${A}/veritastock/members/${STRANGER.id}/locations`, { locationIds: [A], defaultLocationId: A }, OA.token, A);
    check("8a. someone who works in none of the locations can't be added to one", noJoin.s === 404 && !memberRow(A, STRANGER.id), `${noJoin.s}`);
    const keep = await call("POST", `/api/labs/${A}/veritastock/members/${people.editor.P.id}/locations`, { locationIds: [A], defaultLocationId: A }, OA.token, A);
    check("8b. someone who does is moved as before", keep.s === 200, `${keep.s} ${keep.j.error ?? ""}`);
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
