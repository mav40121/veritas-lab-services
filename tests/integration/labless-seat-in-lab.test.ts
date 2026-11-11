// tests/integration/labless-seat-in-lab.test.ts
//
// Michael 2026-11-11, Q287 = 1. A seat with no lab (user_seats.lab_id NULL, made by POST /api/account/seats and the admin
// attach-seat and create-pending-seat routes) matched no lab, so its holder was refused in the owner's lab she belongs to:
// Brittany (Heywood, seat 149, a writer seat stored edit_all) got "You have view-only access to veritamap", and the older
// GET /api/studies/:id answered "Access denied". The rule (server/seatContext.ts editSeatInLab): a seat with no lab counts as
// the person's seat in a lab when (a) its owner owns that lab and (b) the person is an active member of it. A seat tied to
// the lab wins over one with no lab, and a Staff seat stays view only. One person, one effective seat per lab.
// Fresh database, made-up users and labs only. It checks:
//   1. a lab-less writer seat stored edit_all, held by a member of the owner's lab, creates a VeritaMap map (200), opens and
//      saves the owner's study through GET and PUT /api/studies/:id, creates one through POST /api/studies, and the screens
//      read the same seat (map detail editAccess, GET /api/labs/me seatType, the seat-facts support read)
//   2. the same kind of seat held by someone who isn't a member of the lab, or used in a sister lab of the same owner where
//      the person isn't a member, or in a lab another owner owns, is refused
//   3. a seat tied to the lab beats a lab-less one; a lab-less view_all seat stays view only; a lab-less Staff seat stored
//      edit_all stays view only
//   4. POST /api/account/seats stamps the lab: the owner's one lab, or the lab in X-Active-Lab-Id when they own it; otherwise
//      none as before; an existing account invited at once gets its membership in that same lab
//   5. the admin create-pending-seat and attach-seat routes stamp an optional labId the owner owns, and refuse one they don't
//   6. accepting an invite (sign-up with the link) stamps a lab-less seat with the one owner's lab the person now belongs to
//   7. nothing existing is rewritten: a lab-less seat on file stays lab-less after all of the above
// Run: rm -f <db> && DB_PATH=<db> JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/labless-seat-in-lab.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body: unknown, token: string | null, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const emailOf = (tag: string) => `lsil-${tag.toLowerCase()}-${stamp}@example.test`;
  const register = async (tag: string, extra: Record<string, unknown> = {}) => {
    const email = emailOf(tag);
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Made-up ${tag}`, hipaa_acknowledged: true, ...extra }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string, reg };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);
  const member = (lab: number, userId: number, role = "staff") => Number(sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now).lastInsertRowid);
  // accepted_at is today, so none of these is an "older seat" under Q191's ownerMatchCounts: the new rule alone lets them in.
  const seat = (ownerId: number, lab: number | null, u: { id: number; email: string }, type: string, perms: unknown) => Number(sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, lab_id, seat_type)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, now, JSON.stringify(perms), lab, type).lastInsertRowid);
  const labOf = (seatId: number) => (sqlite.prepare("SELECT lab_id FROM user_seats WHERE id = ?").get(seatId) as any)?.lab_id ?? null;
  const studyRow = (ownerId: number, lab: number, name: string) => Number(sqlite.prepare(
    `INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id)
     VALUES (?, 'Made-up Analyzer', 'Made-up Analyst', '2026-11-01', 'cal_ver', 0.1, '[]', '[]', 'draft', ?, ?, ?)`
  ).run(name, now, ownerId, lab).lastInsertRowid);

  const EDIT_ALL = { mode: "edit_all" }, VIEW_ALL = { mode: "view_all" };
  try {
    const OWNER = await register("Owner"), OWNER2 = await register("Owner2");
    const BRITT = await register("Britt"), NONMEM = await register("NonMember"), TIED = await register("Tied");
    const LVIEW = await register("LablessView"), LSTAFF = await register("LablessStaff"), EXIST = await register("Existing");
    const labA = await provision(OWNER.email, "Made-up Lab A");
    const labB = await provision(OWNER.email, "Made-up Lab B, sister of A");
    const labC = await provision(OWNER2.email, "Made-up Lab C, another owner");
    for (const o of [OWNER, OWNER2]) sqlite.prepare("UPDATE users SET plan = 'hospital', seat_count = 40 WHERE id = ?").run(o.id);
    const A = `/api/labs/${labA}`;
    const owners = (sqlite.prepare("SELECT id, owner_user_id FROM labs WHERE id IN (?, ?, ?) ORDER BY id").all(labA, labB, labC) as any[]).map((l) => l.owner_user_id);
    check("setup: labs A and B belong to one owner, lab C to another", owners.length === 3 && owners[0] === OWNER.id && owners[1] === OWNER.id && owners[2] === OWNER2.id, JSON.stringify({ labA, labB, labC, owners }));

    // Brittany's shape: a writer seat stored edit_all with no lab, under the owner, and an active staff membership in lab A.
    member(labA, BRITT.id); const seatBritt = seat(OWNER.id, null, BRITT, "active", EDIT_ALL);
    member(labC, NONMEM.id); const seatNonmem = seat(OWNER.id, null, NONMEM, "active", EDIT_ALL); // a member of lab C only
    member(labA, TIED.id); const seatTied = seat(OWNER.id, labA, TIED, "active", VIEW_ALL); seat(OWNER.id, null, TIED, "active", EDIT_ALL);
    member(labA, LVIEW.id); seat(OWNER.id, null, LVIEW, "active", VIEW_ALL);
    member(labA, LSTAFF.id); seat(OWNER.id, null, LSTAFF, "staff_portal", EDIT_ALL);
    const studyA = studyRow(OWNER.id, labA, "Made-up Glucose A");
    const studyB = studyRow(OWNER.id, labB, "Made-up Glucose B");
    const hA = { "X-Active-Lab-Id": String(labA) }, hB = { "X-Active-Lab-Id": String(labB) };
    const refusedView = (r: { s: number; j: any }, mod: string) => r.s === 403 && String(r.j?.error || "").includes(`view-only access to ${mod}`);

    // ── 1. Brittany's seat works in the owner's lab she belongs to ──
    const map = await call("POST", `${A}/veritamap/maps`, { name: "Made-up map, lab-less writer" }, BRITT.token);
    check("1a. a lab-less writer seat stored edit_all, held by a member of the owner's lab, creates a VeritaMap map (200)", map.s === 200 && !!map.j.id, `${map.s} ${JSON.stringify(map.j)}`);
    const legacyMap = await call("POST", "/api/veritamap/maps", { name: "Made-up map, legacy route" }, BRITT.token, hA);
    check("1b. ... and through the older unprefixed route with the lab in X-Active-Lab-Id", legacyMap.s === 200 && !!legacyMap.j.id, `${legacyMap.s} ${JSON.stringify(legacyMap.j)}`);
    const open = await call("GET", `/api/studies/${studyA}`, undefined, BRITT.token, hA);
    check("1c. GET /api/studies/:id opens the owner's study in that lab (was 403 Access denied)", open.s === 200 && open.j?.testName === "Made-up Glucose A", `${open.s} ${JSON.stringify(open.j).slice(0, 160)}`);
    const save = await call("PUT", `/api/studies/${studyA}`, { status: "draft", testName: "Made-up Glucose A, edited" }, BRITT.token, hA);
    const saved = (sqlite.prepare("SELECT test_name FROM studies WHERE id = ?").get(studyA) as any)?.test_name;
    check("1d. PUT /api/studies/:id saves it", save.s === 200 && saved === "Made-up Glucose A, edited", `${save.s} ${JSON.stringify(save.j).slice(0, 160)} ${saved}`);
    const created = await call("POST", "/api/studies", { status: "draft", testName: "Made-up Sodium draft", studyType: "cal_ver" }, BRITT.token, hA);
    const createdRow = created.j?.id ? sqlite.prepare("SELECT user_id FROM studies WHERE id = ?").get(created.j.id) as any : null;
    check("1e. POST /api/studies creates one, filed under the owner (its seat check reads {mode:\"edit_all\"} now)", (created.s === 200 || created.s === 201) && createdRow?.user_id === OWNER.id, `${created.s} ${JSON.stringify(created.j).slice(0, 160)}`);
    const detail = await call("GET", `${A}/veritamap/maps/${map.j.id}`, undefined, BRITT.token);
    check("1f. map detail's editAccess reads true for her (hasModuleEditAccess)", detail.s === 200 && detail.j.editAccess === true, `${detail.s} ${detail.j.editAccess}`);
    const labsMe = async (token: string, lab: number) => ((await call("GET", "/api/labs/me", undefined, token)).j as any[]).find((m: any) => m.labId === lab);
    check("1g. GET /api/labs/me gives her seat type in lab A (active), so the screen reads the same seat", (await labsMe(BRITT.token, labA))?.seatType === "active", JSON.stringify(await labsMe(BRITT.token, labA)));
    const facts = await call("GET", `/api/admin/users/${BRITT.id}/seat-facts`, undefined, null, { "x-admin-secret": ADMIN });
    const factA = (facts.j?.editCheck || []).find((e: any) => e.labId === labA);
    check("1h. the seat-facts support read shows the edit check landing on her lab-less seat in lab A", facts.s === 200 && factA?.pickedSeatId === seatBritt && JSON.stringify(factA?.activeSeatsInLab) === JSON.stringify([seatBritt]), JSON.stringify(factA));

    // ── 2. It never reaches a lab the person isn't a member of, or one its owner doesn't own ──
    const nmMap = await call("POST", `${A}/veritamap/maps`, { name: "Made-up map, non-member" }, NONMEM.token);
    check("2a. the same seat held by someone who isn't a member of lab A is refused there (403)", nmMap.s === 403, `${nmMap.s} ${JSON.stringify(nmMap.j)}`);
    const nmStudy = await call("GET", `/api/studies/${studyA}`, undefined, NONMEM.token, hA);
    check("2b. ... and can't open the owner's study in lab A", nmStudy.s === 403, String(nmStudy.s));
    const nmFacts = await call("GET", `/api/admin/users/${NONMEM.id}/seat-facts`, undefined, null, { "x-admin-secret": ADMIN });
    const nmC = (nmFacts.j?.editCheck || []).find((e: any) => e.labId === labC);
    check("2c. in lab C, where that person is a member but the seat's owner owns nothing, the seat doesn't count", nmFacts.s === 200 && nmC && nmC.pickedSeatId === null && (nmC.activeSeatsInLab || []).length === 0, JSON.stringify(nmC));
    const sisterStudy = await call("GET", `/api/studies/${studyB}`, undefined, BRITT.token, hB);
    check("2d. Brittany can't open the owner's study in sister lab B, where she isn't a member (403)", sisterStudy.s === 403, String(sisterStudy.s));
    const sisterMap = await call("POST", `/api/labs/${labB}/veritamap/maps`, { name: "Made-up map, sister lab" }, BRITT.token);
    check("2e. ... nor create a map there (403)", sisterMap.s === 403, `${sisterMap.s} ${JSON.stringify(sisterMap.j)}`);
    check("2f. GET /api/labs/me doesn't list sister lab B for her", !(await labsMe(BRITT.token, labB)));

    // ── 3. Precedence and read-only seats ──
    const tiedMap = await call("POST", `${A}/veritamap/maps`, { name: "Made-up map, tied" }, TIED.token);
    const tiedFacts = await call("GET", `/api/admin/users/${TIED.id}/seat-facts`, undefined, null, { "x-admin-secret": ADMIN });
    const tiedA = (tiedFacts.j?.editCheck || []).find((e: any) => e.labId === labA);
    check("3a. a seat tied to the lab (view_all) beats a lab-less one (edit_all): refused, and the tied seat is the one picked",
      refusedView(tiedMap, "veritamap") && tiedA?.pickedSeatId === seatTied, `${tiedMap.s} ${JSON.stringify(tiedA)}`);
    const viewMap = await call("POST", `${A}/veritamap/maps`, { name: "Made-up map, lab-less view" }, LVIEW.token);
    check("3b. a lab-less view_all seat stays view only", refusedView(viewMap, "veritamap"), `${viewMap.s} ${JSON.stringify(viewMap.j)}`);
    const staffMap = await call("POST", `${A}/veritamap/maps`, { name: "Made-up map, lab-less staff" }, LSTAFF.token);
    check("3c. a lab-less Staff seat stored edit_all stays view only (a Staff seat never edits)", refusedView(staffMap, "veritamap"), `${staffMap.s} ${JSON.stringify(staffMap.j)}`);
    check("3d. ... and GET /api/labs/me reads it as a Staff seat in lab A", (await labsMe(LSTAFF.token, labA))?.seatType === "staff_portal", JSON.stringify(await labsMe(LSTAFF.token, labA)));

    // ── 4. POST /api/account/seats stamps the lab ──
    const invite = (token: string, email: string, headers: Record<string, string> = {}) => call("POST", "/api/account/seats", { email, permissions: EDIT_ALL }, token, headers);
    const seatByEmail = (ownerId: number, email: string) => sqlite.prepare("SELECT id, lab_id, status FROM user_seats WHERE owner_user_id = ? AND seat_email = ?").get(ownerId, email) as any;
    const oneLab = emailOf("invite-one-lab");
    const r1 = await invite(OWNER2.token, oneLab);
    check("4a. an owner with exactly one lab: the new seat takes that lab", r1.s === 200 && seatByEmail(OWNER2.id, oneLab)?.lab_id === labC, `${r1.s} ${JSON.stringify(seatByEmail(OWNER2.id, oneLab))}`);
    const viewing = emailOf("invite-viewing");
    const r2 = await invite(OWNER.token, viewing, hB);
    check("4b. an owner of two labs viewing lab B (X-Active-Lab-Id): the new seat takes lab B", r2.s === 200 && seatByEmail(OWNER.id, viewing)?.lab_id === labB, `${r2.s} ${JSON.stringify(seatByEmail(OWNER.id, viewing))}`);
    const noCtx = emailOf("invite-no-context");
    const r3 = await invite(OWNER.token, noCtx);
    check("4c. an owner of two labs with no lab named: no lab, as before", r3.s === 200 && seatByEmail(OWNER.id, noCtx)?.lab_id == null, `${r3.s} ${JSON.stringify(seatByEmail(OWNER.id, noCtx))}`);
    const notOwned = emailOf("invite-not-owned");
    const r4 = await invite(OWNER.token, notOwned, { "X-Active-Lab-Id": String(labC) });
    check("4d. a lab named that the owner doesn't own isn't taken: no lab", r4.s === 200 && seatByEmail(OWNER.id, notOwned)?.lab_id == null, `${r4.s} ${JSON.stringify(seatByEmail(OWNER.id, notOwned))}`);
    const r5 = await invite(OWNER.token, EXIST.email, hB);
    const existSeat = seatByEmail(OWNER.id, EXIST.email);
    const existMember = sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active'").all(EXIST.id) as any[];
    check("4e. an existing account invited while viewing lab B: an active seat in lab B, and the membership in lab B too",
      r5.s === 200 && existSeat?.status === "active" && existSeat?.lab_id === labB && existMember.length === 1 && existMember[0].lab_id === labB, `${r5.s} ${JSON.stringify(existSeat)} ${JSON.stringify(existMember)}`);

    // ── 5. The admin routes take an optional labId the owner owns ──
    const pend = (body: Record<string, unknown>) => call("POST", "/api/admin/create-pending-seat", { secret: ADMIN, ownerUserId: OWNER.id, ...body }, null);
    const p1 = await pend({ seatEmail: emailOf("admin-pending-a"), labId: labA });
    check("5a. create-pending-seat with labId A stamps lab A", p1.s === 200 && seatByEmail(OWNER.id, emailOf("admin-pending-a"))?.lab_id === labA, `${p1.s} ${JSON.stringify(p1.j).slice(0, 160)}`);
    const p2 = await pend({ seatEmail: emailOf("admin-pending-c"), labId: labC });
    check("5b. ... a labId the owner doesn't own is refused (400 LAB_NOT_OWNED) and nothing is made", p2.s === 400 && p2.j.code === "LAB_NOT_OWNED" && !seatByEmail(OWNER.id, emailOf("admin-pending-c")), `${p2.s} ${JSON.stringify(p2.j)}`);
    const p3 = await pend({ seatEmail: emailOf("admin-pending-none") });
    check("5c. ... and with no labId the seat has no lab, as before", p3.s === 200 && seatByEmail(OWNER.id, emailOf("admin-pending-none"))?.lab_id == null, `${p3.s}`);
    const ATTACH = await register("Attach");
    const at1 = await call("POST", "/api/admin/attach-seat", { secret: ADMIN, ownerUserId: OWNER.id, seatEmail: ATTACH.email, seatUserId: ATTACH.id, labId: labB }, null);
    check("5d. attach-seat with labId B stamps lab B", at1.s === 200 && at1.j?.seat?.lab_id === labB && seatByEmail(OWNER.id, ATTACH.email)?.lab_id === labB, `${at1.s} ${JSON.stringify(at1.j).slice(0, 160)}`);
    const at2 = await call("POST", "/api/admin/attach-seat", { secret: ADMIN, ownerUserId: OWNER.id, seatEmail: ATTACH.email, seatUserId: ATTACH.id, labId: labC }, null);
    check("5e. ... and refuses a labId the owner doesn't own, leaving the seat as it was", at2.s === 400 && at2.j.code === "LAB_NOT_OWNED" && seatByEmail(OWNER.id, ATTACH.email)?.lab_id === labB, `${at2.s} ${JSON.stringify(at2.j)}`);

    // ── 6. Accepting the invite stamps a lab-less seat ──
    // A lab-less seat's acceptance grants the membership in the inviter's primary lab (unchanged); make lab A the owner's primary.
    sqlite.prepare("UPDATE lab_members SET is_primary_lab = CASE WHEN lab_id = ? THEN 1 ELSE 0 END WHERE user_id = ?").run(labA, OWNER.id);
    const pendingEmail = emailOf("admin-pending-none");
    const token = (sqlite.prepare("SELECT invite_token FROM user_seats WHERE owner_user_id = ? AND seat_email = ?").get(OWNER.id, pendingEmail) as any)?.invite_token;
    const acceptSeat = seatByEmail(OWNER.id, pendingEmail);
    const signup = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: pendingEmail, password: "Testpass123", name: "Made-up Invitee", hipaa_acknowledged: true, inviteToken: token }) })).json();
    const inviteeId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(pendingEmail) as any)?.id);
    const inviteeLabs = (sqlite.prepare("SELECT lm.lab_id FROM lab_members lm JOIN labs l ON l.id = lm.lab_id WHERE lm.user_id = ? AND lm.status = 'active' AND l.owner_user_id = ?").all(inviteeId, OWNER.id) as any[]).map((r) => r.lab_id);
    check("6a. signing up with the link: the person is a member of one of the owner's labs (A), and the lab-less seat takes lab A",
      !!signup.token && inviteeLabs.length === 1 && inviteeLabs[0] === labA && labOf(acceptSeat.id) === labA, JSON.stringify({ inviteeLabs, seatLab: labOf(acceptSeat.id), keys: Object.keys(signup) }));

    // ── 7. Nothing on file is rewritten ──
    check("7. Brittany's seat on file still has no lab (no backfill; the rule is read at request time)", labOf(seatBritt) == null && labOf(seatNonmem) == null);
  } finally {
    server.close();
  }

  // ── 6b. stampLablessSeatLab leaves a seat alone when the person belongs to two of the owner's labs ──
  try {
    const ctx: any = await import("../../server/seatContext");
    const now2 = new Date().toISOString();
    const o = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Made-up Two-Lab Owner', 'hospital', ?)").run(`lsil-two-${stamp}@example.test`, now2).lastInsertRowid);
    const u = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Made-up Two-Lab Member', 'hospital', ?)").run(`lsil-twomember-${stamp}@example.test`, now2).lastInsertRowid);
    const l1 = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan) VALUES ('Made-up Two 1', ?, 'hospital')").run(o).lastInsertRowid);
    const l2 = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan) VALUES ('Made-up Two 2', ?, 'hospital')").run(o).lastInsertRowid);
    for (const l of [l1, l2]) sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)").run(l, u, now2, now2, now2);
    const sid = Number(sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, permissions, lab_id) VALUES (?, ?, ?, 'active', '{}', NULL)").run(o, `lsil-twomember-${stamp}@example.test`, u).lastInsertRowid);
    check("6b. a member of two of the owner's labs: accepting leaves the seat without a lab (the read-time rule covers both)", ctx.stampLablessSeatLab(sqlite, sid) === null && (sqlite.prepare("SELECT lab_id FROM user_seats WHERE id = ?").get(sid) as any).lab_id == null);
    check("6c. ... and that seat counts in each of the two labs", ctx.editSeatInLab(sqlite, u, l1, "id")?.id === sid && ctx.editSeatInLab(sqlite, u, l2, "id")?.id === sid);
  } catch (e: any) {
    check("6b. the seat rule's helpers load (server/seatContext.ts stampLablessSeatLab, editSeatInLab)", false, String(e?.message || e).split("\n")[0]);
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
