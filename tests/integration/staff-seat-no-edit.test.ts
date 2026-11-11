// tests/integration/staff-seat-no-edit.test.ts
//
// Michael 2026-11-11: "That should require an admin seat ... If she is in a staff seat, she should not be able to do that."
// A Heywood user on a Staff seat (user_seats.seat_type 'staff_portal', read and sign) was refused a new VeritaMap map, rightly,
// but the lab's owner could flip that seat to Edit, after which it wrote. A Staff seat never passes a module edit check,
// whatever its stored permissions say, and no route stores edit on one. Writer seats, admins and owners are unchanged.
// Boots the real routes on a fresh database with made-up users and labs only. It checks:
//   1. a Staff seat stored {mode:"edit_all"}, and one stored custom {veritamap:"edit", ...}, are refused (403) on
//      POST /api/labs/:labId/veritamap/maps, VeritaScan's create scan and VeritaPT's create enrollment; a writer seat with the
//      same permissions passes; the owner and a lab admin pass; someone holding a Staff seat and a writer seat passes
//   2. the older unprefixed POST /api/veritamap/maps refuses too: with the lab named in X-Active-Lab-Id, and with no lab context
//      at all (an older lab-less Staff seat: requireModuleEdit's legacy branch); a writer seat in each shape passes
//   3. the screens get the same answer: GET map detail's editAccess (hasModuleEditAccess), GET /api/labs/me's seatType (a writer
//      seat before a Staff seat) and GET /api/auth/me's seatType; a Staff seat stored with edit on VeritaComp still enters its
//      own competency data (canEnterOwnData)
//   4. GET /api/admin/staff-seat-edit-counts needs the header, counts the active or pending Staff seats whose stored permissions
//      give edit, by lab id and module, leaves out writer, view-only-permission and deactivated seats, shows no email, writes nothing
//   5. PATCH /api/account/seats/:seatId/permissions refuses edit on a Staff seat (400 STAFF_SEAT_READ_ONLY, nothing stored), saves
//      a view-only change on it, and still saves edit on a writer seat
//   6. the lab-scoped PATCH .../members/:memberId/permissions and the admin POST /api/admin/set-seat-permissions refuse the same,
//      and the members PATCH changes the writer seat of someone who holds both; POST /api/account/seats won't bring a deactivated
//      Staff seat back with edit
//   7. the shared rule (shared/seatEditRule.ts) reads every stored shape as resolveSeatPermission does
// Run: rm -f <db> && DB_PATH=<db> JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/staff-seat-no-edit.test.ts
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
  const register = async (tag: string) => {
    const email = `ssne-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Made-up ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);
  const member = (lab: number, userId: number, role = "staff") => Number(sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now).lastInsertRowid);
  const seat = (ownerId: number, lab: number | null, u: { id: number | null; email: string }, type: string, perms: unknown, status = "active", rosterId: number | null = null) => Number(sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, status === "active" ? now : null, status, JSON.stringify(perms), `ssne-${u.email}-${type}-${status}`, lab, type, rosterId).lastInsertRowid);
  const permsOf = (seatId: number) => (sqlite.prepare("SELECT permissions FROM user_seats WHERE id = ?").get(seatId) as any)?.permissions;

  const EDIT_ALL = { mode: "edit_all" };
  const CUSTOM = { mode: "custom", overrides: { veritamap: "edit", veritascan: "edit", veritapt: "edit", veritacomp: "edit" } };
  const VIEW_ALL = { mode: "view_all" };

  try {
    const OWNER = await register("Owner"), OWNER2 = await register("Owner2"), LEGACY_OWNER = await register("LegacyOwner");
    const STAFF_EA = await register("StaffEditAll"), STAFF_CU = await register("StaffCustom"), STAFF_VA = await register("StaffViewAll");
    const WRITER_EA = await register("WriterEditAll"), WRITER_CU = await register("WriterCustom"), ADMIN_M = await register("LabAdmin");
    const BOTH = await register("BothSeats"), STAFF_P = await register("StaffPatch"), OTHER2 = await register("OtherLabStaff");
    const LEGACY = await register("LegacyStaff"), LEGACY_W = await register("LegacyWriter");
    const labId = await provision(OWNER.email, "Made-up Staff Seat Lab");
    const lab2 = await provision(OWNER2.email, "Made-up Second Lab");
    const L = `/api/labs/${labId}`;
    // The account-level invite route reads the owner's own plan and seat count.
    sqlite.prepare("UPDATE users SET plan = 'hospital', seat_count = 40 WHERE id = ?").run(OWNER.id);

    // A roster row for STAFF_CU, so its own competency record exists (section 3).
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Staff Seat Lab", cliaNumber: "11D7654390", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const cuRoster = Number((await call("POST", `${L}/staff/employees`, { lastName: "Custom", firstName: "Made-up", highestComplexity: "M", performsTesting: true, hireDate: "2020-01-01" }, OWNER.token)).j.id);

    // BOTH's Staff seat is inserted before its writer seat, so an unordered pick lands on the Staff seat.
    member(labId, STAFF_EA.id); const seatStaffEA = seat(OWNER.id, labId, STAFF_EA, "staff_portal", EDIT_ALL);
    member(labId, STAFF_CU.id); const seatStaffCU = seat(OWNER.id, labId, STAFF_CU, "staff_portal", CUSTOM, "active", cuRoster);
    member(labId, STAFF_VA.id); seat(OWNER.id, labId, STAFF_VA, "staff_portal", VIEW_ALL);
    const writerEaMember = member(labId, WRITER_EA.id); const seatWriterEA = seat(OWNER.id, labId, WRITER_EA, "active", EDIT_ALL);
    const writerCuMember = member(labId, WRITER_CU.id); const seatWriterCU = seat(OWNER.id, labId, WRITER_CU, "active", CUSTOM);
    member(labId, ADMIN_M.id, "admin");
    const bothMember = member(labId, BOTH.id); const seatBothStaff = seat(OWNER.id, labId, BOTH, "staff_portal", VIEW_ALL); const seatBothWriter = seat(OWNER.id, labId, BOTH, "active", VIEW_ALL);
    const staffPMember = member(labId, STAFF_P.id); const seatStaffP = seat(OWNER.id, labId, STAFF_P, "staff_portal", VIEW_ALL);
    const seatPending = seat(OWNER.id, labId, { id: null, email: `ssne-pending-${stamp}@example.test` }, "staff_portal", { veritacomp: "edit", veritamap: "view" }, "pending");
    const deactEmail = `ssne-deactivated-${stamp}@example.test`;
    const seatDeact = seat(OWNER.id, labId, { id: null, email: deactEmail }, "staff_portal", EDIT_ALL, "deactivated");
    member(lab2, OTHER2.id); seat(OWNER2.id, lab2, OTHER2, "staff_portal", { veritamap: "edit" }); // legacy flat, every key edit: reads as edit everywhere
    // An older lab-less seat under an owner with no lab: no lab context resolves, so requireModuleEdit takes its legacy branch.
    seat(LEGACY_OWNER.id, null, LEGACY, "staff_portal", EDIT_ALL);
    seat(LEGACY_OWNER.id, null, LEGACY_W, "active", EDIT_ALL);
    const legacyCtx = sqlite.prepare("SELECT (SELECT COUNT(*) FROM labs WHERE owner_user_id = ?) AS owns, (SELECT lab_id FROM users WHERE id = ?) AS home, (SELECT COUNT(*) FROM lab_members WHERE user_id IN (?, ?)) AS m").get(LEGACY_OWNER.id, LEGACY_OWNER.id, LEGACY.id, LEGACY_W.id) as any;
    check("setup: a made-up lab with Staff, writer, admin and two-seat logins; the legacy seats' owner has no lab and they have no membership",
      labId > 0 && lab2 > 0 && cuRoster > 0 && !!STAFF_EA.token && legacyCtx.owns === 0 && legacyCtx.home == null && legacyCtx.m === 0, JSON.stringify({ labId, lab2, cuRoster, legacyCtx }));

    // ── 1. requireModuleEdit on three modules ──
    const newMap = (token: string, name: string) => call("POST", `${L}/veritamap/maps`, { name }, token);
    const newScan = (token: string, name: string) => call("POST", `${L}/veritascan/scans`, { name }, token);
    const newPt = (token: string) => call("POST", `${L}/pt/enrollments`, { vendor: "CAP", program_name: "Made-up Chemistry Survey", pt_category: "Chemistry", year_enrolled: 2026 }, token);
    // BUG-168: the refusal names the module by its display name (VeritaMap®), not its key.
    const refusedView = (r: { s: number; j: any }, mod: string) => r.s === 403 && r.j?.error === `You have view-only access to ${mod}. Ask the account owner to grant edit access.`;
    for (const [who, u] of [["edit_all", STAFF_EA], ["custom veritamap edit", STAFF_CU]] as const) {
      const m = await newMap(u.token, `Made-up map ${who}`);
      check(`1a. a Staff seat stored ${who} is refused a new VeritaMap map (403)`, refusedView(m, "VeritaMap®"), `${m.s} ${JSON.stringify(m.j)}`);
      const sc = await newScan(u.token, `Made-up scan ${who}`);
      check(`1b. ... and a new VeritaScan scan (403)`, refusedView(sc, "VeritaScan®"), `${sc.s} ${JSON.stringify(sc.j)}`);
      const pt = await newPt(u.token);
      check(`1c. ... and a new VeritaPT enrollment (403)`, refusedView(pt, "VeritaPT™"), `${pt.s} ${JSON.stringify(pt.j)}`);
    }
    const staffMaps = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM veritamap_maps WHERE name LIKE 'Made-up map %'").get() as any).n);
    check("1d. nothing was created by the refused Staff seats", staffMaps === 0, String(staffMaps));
    const va = await newMap(STAFF_VA.token, "Made-up map view_all");
    check("1e. a Staff seat stored view_all is refused, as before", refusedView(va, "VeritaMap®"), String(va.s));
    for (const [who, u] of [["edit_all", WRITER_EA], ["custom", WRITER_CU]] as const) {
      const m = await newMap(u.token, `Made-up writer map ${who}`), sc = await newScan(u.token, `Made-up writer scan ${who}`), pt = await newPt(u.token);
      check(`1f. a writer seat stored ${who} still creates a map, a scan and a PT enrollment`, m.s === 200 && !!m.j.id && sc.s === 200 && !!sc.j.id && pt.s === 201, `${m.s}/${sc.s}/${pt.s}`);
    }
    for (const [who, u] of [["the owner", OWNER], ["a lab admin with no seat", ADMIN_M]] as const) {
      const m = await newMap(u.token, `Made-up ${who} map`), sc = await newScan(u.token, `Made-up ${who} scan`), pt = await newPt(u.token);
      check(`1g. ${who} still creates a map, a scan and a PT enrollment`, m.s === 200 && sc.s === 200 && pt.s === 201, `${m.s}/${sc.s}/${pt.s}`);
    }
    // BOTH's writer seat is view_all, so a create is refused for the writer seat's reason; give it edit and it passes.
    sqlite.prepare("UPDATE user_seats SET permissions = ? WHERE id = ?").run(JSON.stringify(EDIT_ALL), seatBothWriter);
    const bothMap = await newMap(BOTH.token, "Made-up two-seat map");
    check("1h. someone holding a Staff seat and a writer seat with edit in the lab is judged on the writer seat, and creates a map", bothMap.s === 200 && !!bothMap.j.id, `${bothMap.s} ${JSON.stringify(bothMap.j)}`);
    sqlite.prepare("UPDATE user_seats SET permissions = ? WHERE id = ?").run(JSON.stringify(VIEW_ALL), seatBothWriter);

    // ── 2. The older unprefixed route ──
    const hdr = { "X-Active-Lab-Id": String(labId) };
    const legacyStaff = await call("POST", "/api/veritamap/maps", { name: "Made-up legacy map staff" }, STAFF_EA.token, hdr);
    const legacyWriter = await call("POST", "/api/veritamap/maps", { name: "Made-up legacy map writer" }, WRITER_EA.token, hdr);
    check("2a. POST /api/veritamap/maps with the lab in X-Active-Lab-Id: a Staff seat stored edit_all is refused", refusedView(legacyStaff, "VeritaMap®"), `${legacyStaff.s} ${JSON.stringify(legacyStaff.j)}`);
    check("2b. ... a writer seat still creates the map", legacyWriter.s === 200 && !!legacyWriter.j.id, String(legacyWriter.s));
    const noCtxStaff = await call("POST", "/api/veritamap/maps", { name: "Made-up no-lab map staff" }, LEGACY.token);
    const noCtxWriter = await call("POST", "/api/veritamap/maps", { name: "Made-up no-lab map writer" }, LEGACY_W.token);
    check("2c. with no lab context at all (an older lab-less Staff seat stored edit_all, the legacy branch) it is refused", refusedView(noCtxStaff, "VeritaMap®"), `${noCtxStaff.s} ${JSON.stringify(noCtxStaff.j)}`);
    check("2d. ... and a lab-less writer seat stored edit_all still creates the map there", noCtxWriter.s === 200 && !!noCtxWriter.j.id, `${noCtxWriter.s} ${JSON.stringify(noCtxWriter.j)}`);

    // ── 3. The screens read the same answer ──
    const ownerMap = Number((await newMap(OWNER.token, "Made-up detail map")).j.id);
    const detail = async (token: string) => (await call("GET", `${L}/veritamap/maps/${ownerMap}`, undefined, token)).j;
    check("3a. map detail's editAccess: false for a Staff seat stored edit_all, true for a writer seat stored edit_all",
      (await detail(STAFF_EA.token)).editAccess === false && (await detail(WRITER_EA.token)).editAccess === true);
    const labsMe = async (token: string) => ((await call("GET", "/api/labs/me", undefined, token)).j as any[]).find((m: any) => m.labId === labId);
    check("3b. GET /api/labs/me: a Staff login's seatType is staff_portal; someone with both seats reads their writer seat (active)",
      (await labsMe(STAFF_EA.token))?.seatType === "staff_portal" && (await labsMe(BOTH.token))?.seatType === "active", JSON.stringify([(await labsMe(STAFF_EA.token))?.seatType, (await labsMe(BOTH.token))?.seatType]));
    const authMe = async (token: string) => (await call("GET", "/api/auth/me", undefined, token)).j;
    check("3c. GET /api/auth/me carries the seat's type beside its permissions (staff_portal for a Staff login, active for a writer)",
      (await authMe(STAFF_EA.token)).seatType === "staff_portal" && (await authMe(WRITER_EA.token)).seatType === "active", JSON.stringify([(await authMe(STAFF_EA.token)).seatType, (await authMe(WRITER_EA.token)).seatType]));
    const ownView = await call("GET", `${L}/competency/employee/${cuRoster}`, undefined, STAFF_CU.token);
    check("3d. a Staff seat stored with edit on VeritaComp still enters its own competency data (canEnterOwnData)", ownView.s === 200 && ownView.j.canEnterOwnData === true, `${ownView.s} ${ownView.j.canEnterOwnData}`);

    // ── 4. The admin count ──
    const no = await call("GET", "/api/admin/staff-seat-edit-counts", undefined, null);
    const wrong = await call("GET", "/api/admin/staff-seat-edit-counts", undefined, null, { "x-admin-secret": "not-the-secret" });
    const viaQuery = await call("GET", `/api/admin/staff-seat-edit-counts?secret=${ADMIN}`, undefined, null);
    check("4a. the count route refuses without the header, with a wrong one, and with the secret in the URL (403)", no.s === 403 && wrong.s === 403 && viaQuery.s === 403, `${no.s}/${wrong.s}/${viaQuery.s}`);
    const seatsBefore = JSON.stringify(sqlite.prepare("SELECT * FROM user_seats ORDER BY id").all());
    const cnt = await call("GET", "/api/admin/staff-seat-edit-counts", undefined, null, { "x-admin-secret": ADMIN });
    const t = cnt.j?.totals || {};
    const labRow = (id: number | null) => (cnt.j?.labs || []).find((x: any) => x.labId === id);
    // Staff seats active or pending: EA, CU, VA, BOTH's, P, the pending one, OTHER2, LEGACY = 8. With edit: EA, CU, pending, OTHER2, LEGACY.
    check("4b. totals: 8 active or pending Staff seats, 5 with stored edit (4 active, 1 pending), 3 with edit on every module, in 3 labs (one is no lab)",
      cnt.s === 200 && t.staffSeats === 8 && t.withEdit === 5 && t.active === 4 && t.pending === 1 && t.editAll === 3 && t.labsWithEdit === 3, JSON.stringify(t));
    check("4c. by module: veritamap 4 (the pending seat's is view), veritacomp 5, veritascan 4, veritaqc 3 (edit_all and every-key-edit only)",
      t.modules?.veritamap === 4 && t.modules?.veritacomp === 5 && t.modules?.veritascan === 4 && t.modules?.veritaqc === 3, JSON.stringify(t.modules));
    const r1 = labRow(labId), r2 = labRow(lab2), rn = labRow(null);
    check("4d. by lab id: this lab 3 with edit (2 active, 1 pending; 1 edit_all), the second lab 1 (every-key-edit), no lab 1",
      r1?.withEdit === 3 && r1?.active === 2 && r1?.pending === 1 && r1?.editAll === 1 && r1?.staffSeats === 6 && r2?.withEdit === 1 && r2?.editAll === 1 && rn?.withEdit === 1 && rn?.editAll === 1, JSON.stringify(cnt.j?.labs));
    check("4e. writer seats with edit, Staff seats with view only and the deactivated Staff seat aren't counted (the totals above leave them out)", t.withEdit === 5 && t.staffSeats === 8);
    check("4f. counts and lab ids only: no email, name or seat id in the answer", !/@|Made-up|ssne-|seat_?id/i.test(JSON.stringify(cnt.j)), JSON.stringify(cnt.j).slice(0, 200));
    check("4g. it writes nothing", JSON.stringify(sqlite.prepare("SELECT * FROM user_seats ORDER BY id").all()) === seatsBefore);

    // ── 5. PATCH /api/account/seats/:seatId/permissions ──
    const patchAcct = (seatId: number, permissions: unknown) => call("PATCH", `/api/account/seats/${seatId}/permissions`, { permissions }, OWNER.token);
    const pBefore = permsOf(seatStaffP);
    const pEa = await patchAcct(seatStaffP, EDIT_ALL);
    check("5a. Edit all on a Staff seat: 400 STAFF_SEAT_READ_ONLY with the plain message, and nothing stored",
      pEa.s === 400 && pEa.j.code === "STAFF_SEAT_READ_ONLY" && pEa.j.error === "A staff login is for reading and signing. To let this person edit, give them an admin seat." && permsOf(seatStaffP) === pBefore, `${pEa.s} ${JSON.stringify(pEa.j)} ${permsOf(seatStaffP)}`);
    const pCu = await patchAcct(seatStaffP, { mode: "custom", overrides: { veritamap: "edit" } });
    const pFlat = await patchAcct(seatStaffP, { veritamap: "edit", veritacheck: "view" });
    check("5b. Custom with one module on Edit, and the older flat shape with one Edit, are refused the same way, nothing stored",
      pCu.s === 400 && pCu.j.code === "STAFF_SEAT_READ_ONLY" && pFlat.s === 400 && pFlat.j.code === "STAFF_SEAT_READ_ONLY" && permsOf(seatStaffP) === pBefore, `${pCu.s}/${pFlat.s}`);
    const pView = await patchAcct(seatStaffP, { mode: "custom", overrides: { veritamap: "view" } });
    check("5c. a view-only change on a Staff seat still saves", pView.s === 200 && JSON.parse(permsOf(seatStaffP)).mode === "custom", `${pView.s} ${permsOf(seatStaffP)}`);
    const pWriter = await patchAcct(seatWriterCU, EDIT_ALL);
    check("5d. Edit all on a writer seat still saves", pWriter.s === 200 && JSON.parse(permsOf(seatWriterCU)).mode === "edit_all", `${pWriter.s} ${permsOf(seatWriterCU)}`);
    const pAudit = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'seat.permissions' AND entity_id = ?").get(String(seatStaffP)) as any).n);
    check("5e. the refused writes left no audit row; the one saved change left one", pAudit === 1, String(pAudit));

    // ── 6. The other routes that write seat permissions ──
    const patchMember = (memberId: number, permissions: unknown) => call("PATCH", `${L}/members/${memberId}/permissions`, { permissions }, OWNER.token);
    const mStaff = await patchMember(staffPMember, EDIT_ALL);
    check("6a. the lab members PATCH refuses Edit all on a Staff login (400 STAFF_SEAT_READ_ONLY), nothing stored", mStaff.s === 400 && mStaff.j.code === "STAFF_SEAT_READ_ONLY" && JSON.parse(permsOf(seatStaffP)).mode === "custom", `${mStaff.s} ${JSON.stringify(mStaff.j)}`);
    const mStaffView = await patchMember(staffPMember, VIEW_ALL);
    check("6b. ... and saves View all on it", mStaffView.s === 200 && JSON.parse(permsOf(seatStaffP)).mode === "view_all", String(mStaffView.s));
    const mWriter = await patchMember(writerEaMember, CUSTOM);
    check("6c. ... and still saves edit on a writer seat", mWriter.s === 200 && JSON.parse(permsOf(seatWriterEA)).mode === "custom", String(mWriter.s));
    const mBoth = await patchMember(bothMember, EDIT_ALL);
    check("6d. for someone holding both seats it changes the writer seat and leaves the Staff seat as it was",
      mBoth.s === 200 && mBoth.j.seatId === seatBothWriter && JSON.parse(permsOf(seatBothWriter)).mode === "edit_all" && JSON.parse(permsOf(seatBothStaff)).mode === "view_all", `${mBoth.s} ${JSON.stringify(mBoth.j)}`);
    const adminSet = (seatId: number, permissions: unknown) => call("POST", "/api/admin/set-seat-permissions", { seatId, permissions }, null, { "x-admin-secret": ADMIN });
    const aStaff = await adminSet(seatStaffEA, { mode: "custom", overrides: { veritapolicy: "edit" } });
    const aStaffView = await adminSet(seatPending, VIEW_ALL);
    const aWriter = await adminSet(seatWriterEA, EDIT_ALL);
    check("6e. the admin set-seat-permissions refuses edit on a Staff seat, saves View all on one, and saves edit on a writer seat",
      aStaff.s === 400 && aStaff.j.code === "STAFF_SEAT_READ_ONLY" && JSON.parse(permsOf(seatStaffEA)).mode === "edit_all" && aStaffView.s === 200 && JSON.parse(permsOf(seatPending)).mode === "view_all"
        && aWriter.s === 200 && JSON.parse(permsOf(seatWriterEA)).mode === "edit_all", `${aStaff.s}/${aStaffView.s}/${aWriter.s}`);
    const reinvite = await call("POST", "/api/account/seats", { email: deactEmail, permissions: EDIT_ALL }, OWNER.token);
    const deactRow = sqlite.prepare("SELECT status, permissions FROM user_seats WHERE id = ?").get(seatDeact) as any;
    check("6f. POST /api/account/seats won't bring a deactivated Staff seat back with edit (400), and the row stays deactivated",
      reinvite.s === 400 && reinvite.j.code === "STAFF_SEAT_READ_ONLY" && deactRow.status === "deactivated", `${reinvite.s} ${JSON.stringify(reinvite.j)} ${deactRow.status}`);
    // The seat ids the routes saw stay with the right people.
    check("6g. the Staff seat stored edit_all is still refused after all that (stored values never decide it)", refusedView(await newMap(STAFF_EA.token, "Made-up map after"), "VeritaMap®"));
    check("6h. ids used: the custom Staff seat and the writer seats exist", seatStaffCU > 0 && seatWriterEA > 0 && seatWriterCU > 0);
  } finally {
    server.close();
  }

  // ── 7. The shared rule ──
  try {
    const rule: any = await import("../../shared/seatEditRule");
    const { effectiveSeatPermission, modulesWithStoredEdit, staffSeatEditRefusal, isReadOnlySeatType } = rule;
    check("7a. effectiveSeatPermission: a Staff seat reads view on every shape; a writer seat or no type reads its permissions",
      effectiveSeatPermission("staff_portal", { mode: "edit_all" }, "veritamap") === "view" && effectiveSeatPermission("staff_portal", { veritamap: "edit" }, "veritamap") === "view"
        && effectiveSeatPermission("active", { mode: "edit_all" }, "veritamap") === "edit" && effectiveSeatPermission(null, { mode: "edit_all" }, "veritamap") === "edit"
        && effectiveSeatPermission(undefined, { mode: "custom", overrides: { veritamap: "edit" } }, "veritamap") === "edit" && effectiveSeatPermission("active", { mode: "custom", overrides: { veritamap: "edit" } }, "veritascan") === "view");
    check("7b. view_only reads view too (authMiddleware already refuses it every write); active and staff_portal are told apart",
      isReadOnlySeatType("view_only") && isReadOnlySeatType("staff_portal") && !isReadOnlySeatType("active") && !isReadOnlySeatType(null) && !isReadOnlySeatType(undefined));
    check("7c. modulesWithStoredEdit: edit_all names every module, an override to view takes one out, view_all with an edit override names it",
      modulesWithStoredEdit({ mode: "edit_all" }).length === 15 && !modulesWithStoredEdit({ mode: "edit_all", overrides: { veritamap: "view" } }).includes("veritamap")
        && JSON.stringify(modulesWithStoredEdit({ mode: "view_all", overrides: { veritapt: "edit" } })) === JSON.stringify(["veritapt"]), JSON.stringify(modulesWithStoredEdit({ mode: "view_all", overrides: { veritapt: "edit" } })));
    check("7d. ... the flat shape: every key edit is edit everywhere; mixed is literal; empty, malformed and a JSON string read as stored",
      modulesWithStoredEdit({ veritamap: "edit" }).length === 15 && JSON.stringify(modulesWithStoredEdit({ veritamap: "edit", veritacheck: "view" })) === JSON.stringify(["veritamap"])
        && modulesWithStoredEdit({}).length === 0 && modulesWithStoredEdit("not json").length === 0 && modulesWithStoredEdit(null).length === 0 && modulesWithStoredEdit('{"mode":"edit_all"}').length === 15);
    check("7e. staffSeatEditRefusal: only a Staff seat with some edit is refused; view-only changes and writer seats pass",
      staffSeatEditRefusal("staff_portal", { mode: "edit_all" })?.code === "STAFF_SEAT_READ_ONLY" && staffSeatEditRefusal("staff_portal", { mode: "view_all" }) === null
        && staffSeatEditRefusal("active", { mode: "edit_all" }) === null && staffSeatEditRefusal("view_only", { mode: "edit_all" }) === null);
  } catch (e: any) {
    check("7. the shared rule shared/seatEditRule.ts loads", false, String(e?.message || e).split("\n")[0]);
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
