// tests/integration/maintain-stain-log.test.ts
//
// STANDING integration test for the VeritaMaintain stain log (Michael Q178 = 1, 2026-11-06). The rules themselves are pinned by
// scripts/verify-stain-log-rules.mts, which runs first in the same npm script. Boots the REAL routes on a scratch DB, with made-up people,
// instruments and lots:
//   1. Boot adds the tables with no patient or specimen number column, and they're in the export-all list.
//   2. Setup needs VeritaMaintain edit, stays on this lab's instrument, and a row with entries can only be retired.
//   3. Recording is open to every member, all or nothing for a day. A stain change needs its lot and expiration; an expired lot or a Problem needs the corrective action.
//   4. The month's grid shows only that month and this lab, with the current lot. A void needs a reason, keeps the entry, and only its recorder or an editor can do it.
//   5. The manual stain log has no specimen number. Text that looks like patient information or a specimen number is refused everywhere.
//   6. The monthly review: one signature covers an instrument's maintenance and its stain log; a short daily row, a missed monthly row or a lot past its expiration needs a corrective
//      action; the manual log is one more record; a later entry or void shows as added after the review. An instrument with no stain log reads as it always did.
//   7. The Excel report gets its stain sheets only in a month with stain entries.
//   8. Staff logins: they record, can't set up, and read initials but not a coworker's name. Other labs, a sister lab, a free plan and a read-only lab are refused.
//   9. An instrument holding entries can't be deleted; a row nothing was recorded on can go.
//  10. The ROSE blank form: a Word file with the lab's identity and no patient data, editors only, that goes through the normal VeritaDC upload as a Form.
// Run: npm run test:maintain-stain-log

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { EXPORT_TABLES } from "../../server/exportAllTables";

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
  const PW = ["Stain", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkOwner = async (tag: string) => {
    const email = `stain-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    return { email, token: reg.body.token as string, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const provision = async (email: string, labName: string, plan = "hospital") => (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan, isWarehouse: true })).body.labId as number;
  const mkLab = async (tag: string) => {
    const o = await mkOwner(tag);
    return { ...o, labId: await provision(o.email, `Stain Lab ${tag}`) };
  };
  const addPerson = async (labId: number, ownerId: number, tag: string, kind: "viewer" | "editor" | "staff", name = `Person ${tag}`) => {
    const email = `stain-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, userId);
    if (kind === "editor" || kind === "viewer") {
      const perms = kind === "editor" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}';
      sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')").run(ownerId, email, userId, now, now, perms, `stain-${tag}-${stamp}`, labId);
    }
    let employeeId: number | null = null;
    if (kind === "staff") {
      const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any)?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Stain Lab', '22D0000789', ?, ?, ?)").run(ownerId, labId, now, now).lastInsertRowid);
      employeeId = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Made', 'active', ?, ?)").run(staffLab, labId, ownerId, name.split(" ").pop(), now, now).lastInsertRowid);
      sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')").run(ownerId, email, userId, labId, employeeId);
    }
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const login = await call("POST", "/api/auth/login", { email, password: PW });
    return { email, userId, employeeId, token: login.body.token as string };
  };

  try {
    // ── 1. Tables ──
    const columns = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name as string);
    for (const t of ["stain_log_rows", "stain_log_entries", "stain_manual_entries"]) {
      check(`1. boot adds ${t}`, columns(t).length > 0);
      check(`1. ${t} is in the export-all list, scoped by lab`, (EXPORT_TABLES as any)[t]?.scope?.kind === "lab");
      const phiColumns = columns(t).filter((c) => /patient|mrn|specimen_(?:n|i)|accession|dob|birth/.test(c));
      check(`1. ${t} has no patient or specimen number column`, phiColumns.length === 0, phiColumns.join(","));
    }
    check("1. the manual log keeps the specimen's type", columns("stain_manual_entries").includes("specimen_type"));

    const A = await mkLab("a");
    const B = await mkLab("b");
    const L = `/api/labs/${A.labId}`;
    const S = `${L}/stain-log`;
    const today = new Date().toLocaleDateString("en-CA");

    const stainer = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up autostainer", location: "Histology", next_due_date: "2030-01-01" }, A.token)).body.id as number;
    const plain = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up centrifuge", next_due_date: "2030-01-01" }, A.token)).body.id as number;
    const otherLab = (await call("POST", `/api/labs/${B.labId}/equipment`, { instrument_name: "Other lab stainer" }, B.token)).body.id as number;
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id IN (?, ?, ?)").run(stainer, plain, otherLab);
    const viewer = await addPerson(A.labId, A.userId, "viewer", "viewer", "Vera Viewer");
    const editor = await addPerson(A.labId, A.userId, "editor", "editor", "Eddie Editor");
    const staff = await addPerson(A.labId, A.userId, "staff", "staff", "Sam Stafford");
    const coworker = await addPerson(A.labId, A.userId, "coworker", "staff", "Zora Quillfeather");

    // ── 2. Setup ──
    const R = `${S}/${stainer}/rows`;
    const addRow = (body: any, token = A.token, path = R) => call("POST", path, body, token);
    const hema = (await addRow({ name: "Hematoxylin", row_kind: "stain", frequency: "monthly", required_code: "D" })).body.id as number;
    const eosin = (await addRow({ name: "Eosin", row_kind: "stain" }, editor.token)).body.id as number;
    const water = (await addRow({ name: "Water", row_kind: "solution", frequency: "daily", required_code: "C" })).body.id as number;
    const quality = (await addRow({ name: "Slide quality", row_kind: "check", frequency: "daily" })).body.id as number;
    check("2. the owner and an editor set up rows", [hema, eosin, water, quality].every((id) => id > 0));
    sqlite.prepare("UPDATE stain_log_rows SET created_at = '2026-01-01T00:00:00.000Z' WHERE equipment_id = ?").run(stainer);
    check("2. a Staff login can't set up a row", (await addRow({ name: "Nope" }, staff.token)).status === 403);
    check("2. a view-only seat can't set up a row", (await addRow({ name: "Nope" }, viewer.token)).status === 403);
    check("2. another lab can't set up a row here", [403, 404].includes((await addRow({ name: "Nope" }, B.token)).status));
    check("2. this lab can't put a row on another lab's instrument", (await addRow({ name: "Nope" }, A.token, `${S}/${otherLab}/rows`)).status === 404);
    check("2. a bad row is refused", (await addRow({ name: "No code", frequency: "daily", row_kind: "stain" })).status === 400);
    const order = await call("POST", `${R}/order`, { ids: [quality, hema, eosin, water] }, A.token);
    const orderBad = await call("POST", `${R}/order`, { ids: [quality, hema] }, A.token);
    const orderDup = await call("POST", `${R}/order`, { ids: [quality, quality, eosin, water] }, A.token);
    const orderStaff = await call("POST", `${R}/order`, { ids: [quality, hema, eosin, water] }, staff.token);
    check("2. rows take the lab's order", order.status === 200, `${order.status}`);
    check("2. an order that isn't exactly this instrument's rows is refused", orderBad.status === 400 && orderDup.status === 400);
    check("2. a Staff login can't reorder", orderStaff.status === 403);

    // ── 3. Recording ──
    const E = `${S}/${stainer}/entries`;
    const day = (log_date: string, items: any[], initials = "MU", token = A.token) => call("POST", E, { log_date, initials, items }, token);
    const lotGood = { lot_number: "LOT-1", expiration_date: "2027-06-01" };
    const r1 = await day("2026-09-01", [{ row_id: hema, codes: ["D", "C"], ...lotGood }, { row_id: water, codes: ["C"] }, { row_id: quality, codes: ["OK"] }], "mu");
    check("3. a day records several rows and codes", r1.status === 201 && r1.body.created === 4, `HTTP ${r1.status} ${JSON.stringify(r1.body)}`);
    check("3. initials are stored upper case, with the person signed in", (sqlite.prepare("SELECT initials, recorded_by_user_id, recorded_by_name FROM stain_log_entries WHERE row_id = ? AND code = 'C'").get(hema) as any).initials === "MU" && (sqlite.prepare("SELECT recorded_by_user_id AS u FROM stain_log_entries WHERE row_id = ? AND code = 'C'").get(hema) as any).u === A.userId);
    const bad = await day("2026-09-02", [{ row_id: water, codes: ["C"] }, { row_id: hema, codes: ["C"] }]);
    check("3. a stain change with no lot is refused, and says which row", bad.status === 400 && bad.body.code === "LOT_REQUIRED" && /Hematoxylin/.test(bad.body.error), JSON.stringify(bad.body));
    check("3. and nothing from that day was saved", (sqlite.prepare("SELECT COUNT(*) AS n FROM stain_log_entries WHERE log_date = '2026-09-02'").get() as any).n === 0);
    check("3. a change to water needs no lot", (await day("2026-09-02", [{ row_id: water, codes: ["C"] }])).status === 201);
    const noAction = await day("2026-09-03", [{ row_id: eosin, codes: ["C"], lot_number: "OLD-1", expiration_date: "2026-08-01" }]);
    check("3. an expired lot needs the corrective action", noAction.status === 400 && noAction.body.code === "CORRECTIVE_ACTION_REQUIRED", JSON.stringify(noAction.body));
    const withAction = await day("2026-09-03", [{ row_id: eosin, codes: ["C"], lot_number: "OLD-1", expiration_date: "2026-08-01", corrective_action: "Replaced the same day" }, { row_id: water, codes: ["C"] }]);
    check("3. and is recorded with it", withAction.status === 201 && (sqlite.prepare("SELECT lot_expired AS x FROM stain_log_entries WHERE row_id = ? AND lot_number = 'OLD-1'").get(eosin) as any).x === 1);
    check("3. a Problem needs the corrective action", (await day("2026-09-04", [{ row_id: quality, codes: ["PROBLEM"] }])).body.code === "CORRECTIVE_ACTION_REQUIRED");
    check("3. no initials are refused", (await day("2026-09-04", [{ row_id: water, codes: ["C"] }], " ")).body.code === "INITIALS_REQUIRED");
    check("3. nothing marked is refused", (await day("2026-09-04", [])).body.code === "NO_ITEMS");
    check("3. a future date is refused", (await day("2099-01-01", [{ row_id: water, codes: ["C"] }])).body.code === "BAD_DATE");
    check("3. a date that doesn't exist is refused", (await day("2026-02-30", [{ row_id: water, codes: ["C"] }])).body.code === "BAD_DATE");
    check("3. a row from nowhere is refused", (await day("2026-09-04", [{ row_id: 99999999, codes: ["C"] }])).body.code === "ROW_NOT_FOUND");
    const otherRow = (await addRow({ name: "Elsewhere", row_kind: "solution" }, B.token, `/api/labs/${B.labId}/stain-log/${otherLab}/rows`)).body.id as number;
    check("3. another lab's row is refused", (await day("2026-09-04", [{ row_id: otherRow, codes: ["C"] }])).body.code === "ROW_NOT_FOUND");
    const plainRow = (await addRow({ name: "On the centrifuge", row_kind: "solution" }, A.token, `${S}/${plain}/rows`)).body.id as number;
    check("3. another instrument's row is refused", (await day("2026-09-04", [{ row_id: plainRow, codes: ["C"] }])).body.code === "ROW_NOT_FOUND");
    check("3. a Staff login records", (await day("2026-09-04", [{ row_id: water, codes: ["C"] }, { row_id: quality, codes: ["OK"] }], "SS", staff.token)).status === 201);
    check("3. a view-only seat records too, as with temperature readings", (await day("2026-09-05", [{ row_id: quality, codes: ["OK"] }], "VV", viewer.token)).status === 201);
    check("3. another lab can't record here", [403, 404].includes((await day("2026-09-04", [{ row_id: water, codes: ["C"] }], "XX", B.token)).status));
    check("3. the same code again the same day stays on the log", (await day("2026-09-02", [{ row_id: water, codes: ["C"] }], "MU")).status === 201);

    // A second instrument with no stain log stays out of it; a retired instrument takes no entries
    const retired = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up old stainer" }, A.token)).body.id as number;
    const retiredRow = (await addRow({ name: "Old eosin", row_kind: "solution" }, A.token, `${S}/${retired}/rows`)).body.id as number;
    await call("PUT", `${L}/equipment/${retired}`, { status: "retired" }, A.token);
    check("3. a retired instrument takes no entries", (await call("POST", `${S}/${retired}/entries`, { log_date: "2026-09-04", initials: "MU", items: [{ row_id: retiredRow, codes: ["C"] }] }, A.token)).status === 400);
    check("3. and no new rows", (await addRow({ name: "Nope", row_kind: "solution" }, A.token, `${S}/${retired}/rows`)).status === 400);

    // ── 4. The grid ──
    const G = await call("GET", `${S}/${stainer}?month=2026-09`, undefined, A.token);
    check("4. the grid holds the month's entries", G.status === 200 && G.body.entries.length === 11, `HTTP ${G.status} ${G.body.entries?.length}`);
    check("4. the rows come in the lab's order", G.body.rows.map((r: any) => r.name).join("|") === "Slide quality|Hematoxylin|Eosin|Water", G.body.rows.map((r: any) => r.name).join("|"));
    const cHema = G.body.entries.find((e: any) => e.row_id === hema && e.code === "C");
    check("4. a change reads back with its lot and expiration", cHema.lot_number === "LOT-1" && cHema.expiration_date === "2027-06-01");
    check("4. the dump the same day has no lot", G.body.entries.find((e: any) => e.row_id === hema && e.code === "D").lot_number === null);
    check("4. the row carries its current lot", G.body.rows.find((r: any) => r.id === hema).current_lot?.lot_number === "LOT-1" && G.body.rows.find((r: any) => r.id === water).current_lot === null);
    check("4. the lab's name and CLIA come back for the printed page", /Stain Lab a/.test(G.body.lab.name), JSON.stringify(G.body.lab));
    const earlier = await call("GET", `${S}/${stainer}?month=2026-08`, undefined, A.token);
    check("4. another month is empty, and its rows still show for back-entry", earlier.body.entries.length === 0 && earlier.body.rows.length === 4);
    check("4. the current lot looks only as far as that month", earlier.body.rows.find((r: any) => r.id === hema).current_lot === null);
    check("4. a future month is refused", (await call("GET", `${S}/${stainer}?month=2099-01`, undefined, A.token)).status === 400);
    check("4. an instrument from another lab isn't found", (await call("GET", `${S}/${otherLab}?month=2026-09`, undefined, A.token)).status === 404);
    check("4. another lab can't read this grid", [403, 404].includes((await call("GET", `${S}/${stainer}?month=2026-09`, undefined, B.token)).status));
    const list = await call("GET", S, undefined, A.token);
    const listed = (id: number) => list.body.instruments.find((i: any) => i.id === id);
    check("4. the list shows each instrument with its rows", listed(stainer).rows === 4 && listed(plain).rows === 1, JSON.stringify(list.body.instruments));
    check("4. the list leaves out another lab's instrument", !listed(otherLab));
    check("4. a retired instrument with a row still lists, so its log stays readable", listed(retired).rows === 1);
    check("4. the list says who can set up", list.body.can_setup === true && (await call("GET", S, undefined, staff.token)).body.can_setup === false);
    await call("POST", E, { log_date: today, initials: "MU", items: [{ row_id: water, codes: ["C"] }] }, A.token);
    check("4. the list counts today's entries", (await call("GET", S, undefined, A.token)).body.instruments.find((i: any) => i.id === stainer).entries_today === 1);
    sqlite.prepare("DELETE FROM stain_log_entries WHERE log_date = ?").run(today);

    // Void
    const staffEntry = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE recorded_by_user_id = ? AND row_id = ?").get(staff.userId, water) as any).id as number;
    const V = (id: number) => `${E}/${id}/void`;
    check("4. a void needs a reason", (await call("POST", V(staffEntry), { reason: " " }, staff.token)).body.code === "REASON_REQUIRED");
    check("4. someone else can't void it without edit", (await call("POST", V(staffEntry), { reason: "Mine now" }, coworker.token)).body.code === "NOT_YOUR_ENTRY");
    check("4. a view-only seat can't either", (await call("POST", V(staffEntry), { reason: "Mine now" }, viewer.token)).status === 403);
    check("4. another lab can't", [403, 404].includes((await call("POST", V(staffEntry), { reason: "x" }, B.token)).status));
    const ownVoid = await call("POST", V(staffEntry), { reason: "Wrong day" }, staff.token);
    check("4. the person who recorded it can void it", ownVoid.status === 200 && ownVoid.body.void_reason === "Wrong day" && !!ownVoid.body.voided_at, JSON.stringify(ownVoid.body));
    check("4. not twice", (await call("POST", V(staffEntry), { reason: "Again" }, staff.token)).body.code === "ALREADY_VOIDED");
    const viewerEntry = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE recorded_by_user_id = ?").get(viewer.userId) as any).id as number;
    const editorVoid = await call("POST", V(viewerEntry), { reason: "Entered on the wrong instrument" }, editor.token);
    check("4. an editor can void anyone's", editorVoid.status === 200 && editorVoid.body.voided_by_user_id === editor.userId);
    check("4. a void is audited", (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'veritamaintain' AND entity_type = 'stain_log_entry'").get() as any).n === 2);
    const afterVoid = await call("GET", `${S}/${stainer}?month=2026-09`, undefined, A.token);
    check("4. a voided entry leaves the grid and stays on the record", !afterVoid.body.entries.some((e: any) => e.id === staffEntry) && afterVoid.body.voided.some((e: any) => e.id === staffEntry && e.void_reason === "Wrong day"));
    await call("POST", `${L}/equipment/${stainer}/events`, { event_type: "solution_change", event_date: "2026-09-06", performed_by: "MU", notes: "Changed: clarifier" }, A.token);
    check("4. a solution change on the instrument's history shows beside the grid", (await call("GET", `${S}/${stainer}?month=2026-09`, undefined, A.token)).body.solution_events.some((e: any) => /clarifier/.test(e.notes)));

    // ── 5. Manual log and no PHI ──
    const M = `${S}/manual`;
    const manual = (body: any, token = A.token) => call("POST", M, { log_date: "2026-09-02", specimen_type: "Frozen section", result: "good", initials: "MU", ...body }, token);
    const m1 = await manual({ specimen_number: "S26-1234", accession: "A1" });
    check("5. a manual stain saves", m1.status === 201 && m1.body.specimen_type === "Frozen section" && m1.body.result === "good");
    check("5. a specimen number sent anyway isn't stored", !JSON.stringify(m1.body).includes("S26-1234") && !JSON.stringify(sqlite.prepare("SELECT * FROM stain_manual_entries WHERE id = ?").get(m1.body.id)).includes("S26-1234"));
    check("5. a problem needs the corrective action", (await manual({ result: "problem" })).body.code === "CORRECTIVE_ACTION_REQUIRED");
    check("5. no type is refused", (await manual({ specimen_type: "" })).body.code === "TYPE_REQUIRED");
    check("5. no initials are refused", (await manual({ initials: "" })).body.code === "INITIALS_REQUIRED");
    check("5. a future date is refused", (await manual({ log_date: "2099-01-01" })).body.code === "BAD_DATE");
    const problem = await manual({ log_date: "2026-09-03", result: "problem", comments: "Pale; re-stained", test_slide: true });
    check("5. a problem saves with its action, and a test slide is marked", problem.status === 201 && problem.body.test_slide === 1);
    const manualStaff = await manual({ log_date: "2026-09-04", initials: "SS" }, staff.token);
    check("5. a Staff login records a manual stain", manualStaff.status === 201);
    check("5. another lab can't record here", [403, 404].includes((await manual({}, B.token)).status));
    const manualRead = await call("GET", `${M}?month=2026-09`, undefined, A.token);
    check("5. the month reads back", manualRead.status === 200 && manualRead.body.entries.length === 3, `${manualRead.body.entries?.length}`);
    check("5. another month is empty", (await call("GET", `${M}?month=2026-08`, undefined, A.token)).body.entries.length === 0);
    check("5. another lab can't read it", [403, 404].includes((await call("GET", `${M}?month=2026-09`, undefined, B.token)).status));
    check("5. another lab's log doesn't show it", (await call("GET", `/api/labs/${B.labId}/stain-log/manual?month=2026-09`, undefined, B.token)).body.entries.length === 0);
    const mv = `${M}/${manualStaff.body.id}/void`;
    check("5. a void needs a reason", (await call("POST", mv, { reason: "" }, staff.token)).body.code === "REASON_REQUIRED");
    check("5. someone else can't void it", (await call("POST", mv, { reason: "x" }, coworker.token)).body.code === "NOT_YOUR_ENTRY");
    check("5. the recorder can", (await call("POST", mv, { reason: "Duplicate" }, staff.token)).status === 200);
    check("5. it stays on the record", (await call("GET", `${M}?month=2026-09`, undefined, A.token)).body.voided.length === 1);

    const refused = (r: { status: number; body: any }) => r.status === 400 && r.body.code === "PHI_REFUSED" && /patient information/.test(r.body.error);
    check("5. a labeled MRN in a manual comment is refused", refused(await manual({ comments: "MRN: 00482913" })));
    check("5. a specimen number in a manual comment is refused", refused(await manual({ comments: "Specimen # S26-1234" })));
    check("5. a patient label as a specimen type is refused", refused(await manual({ specimen_type: "Patient: Jane Doe" })));
    check("5. a labeled MRN in a corrective action is refused", refused(await day("2026-09-07", [{ row_id: quality, codes: ["PROBLEM"], corrective_action: "MRN: 00482913" }])));
    check("5. an accession number in a lot field is refused", refused(await day("2026-09-07", [{ row_id: eosin, codes: ["C"], lot_number: "accession 12345", expiration_date: "2027-01-01" }])));
    check("5. a void reason is checked too", refused(await call("POST", V(viewerEntry), { reason: "DOB 3/14/1961" }, A.token)));
    check("5. a row name is checked too", refused(await addRow({ name: "Patient: Jane" })));
    check("5. the refusal doesn't repeat the text", !JSON.stringify((await manual({ comments: "MRN: 00482913" })).body).includes("00482913"));
    check("5. ordinary words about patients save", (await manual({ log_date: "2026-09-08", result: "problem", comments: "Pale. Patient testing not affected." })).status === 201);
    check("5. nothing refused was stored", !JSON.stringify(sqlite.prepare("SELECT * FROM stain_log_entries").all()).includes("00482913") && !JSON.stringify(sqlite.prepare("SELECT * FROM stain_manual_entries").all()).includes("00482913"));
    const { scanPhi } = await import("../../server/phiScan");
    sqlite.prepare("INSERT INTO stain_manual_entries (lab_id, log_date, specimen_type, result, initials, comments, created_at) VALUES (?, '2020-01-01', 'Made-up', 'good', 'MU', 'MRN: 00482913', ?)").run(A.labId, now);
    check("5. the nightly scan reads these tables", scanPhi(sqlite).findings.some((f) => f.table === "stain_manual_entries"));
    sqlite.prepare("DELETE FROM stain_manual_entries WHERE log_date = '2020-01-01'").run();

    // ── 6. The monthly review ──
    const RV = `${L}/maintain-reviews`;
    const month = "2026-09";
    const reviewMonth = async () => (await call("GET", `${RV}?month=${month}`, undefined, A.token)).body;
    const item = (m: any, type: string, id: number) => m.items.find((i: any) => i.type === type && i.id === id);
    const m0 = await reviewMonth();
    const inst = item(m0, "equipment", stainer);
    // Live entries: water changed 9/1, 9/2, 9/3; the 9/4 change and the 9/5 check were voided; slide quality on 9/1 and 9/4.
    check("6. the instrument's stain log is on its review, by row and date", inst.problems.includes("Water: 1 day in use with no C recorded: 9/4") && inst.problems.includes("Slide quality: 2 days in use with no entry: 9/2, 9/3"), JSON.stringify(inst.problems));
    check("6. a daily row is short only on a day the instrument was used, and a voided entry doesn't make a day used", inst.problems.length === 2 && !JSON.stringify(inst.problems).includes("9/5"), JSON.stringify(inst.problems));
    check("6. what it shows is noted", inst.notes.some((n: string) => /days on the stain log/.test(n)) && inst.notes.some((n: string) => /voided, with the reason/.test(n)) && inst.notes.some((n: string) => /expired lot, each with its corrective action/.test(n)), JSON.stringify(inst.notes));
    check("6. 'No entries this month' doesn't show on an instrument with a stain log", !inst.notes.includes("No entries this month"), JSON.stringify(inst.notes));
    check("6. the summary says it has a stain log", inst.summary.stain_rows === 4, JSON.stringify(inst.summary));
    const noLog = item(m0, "equipment", plain);
    check("6. an instrument with no stain entries reads as it always did", noLog.problems.length === 0 && noLog.notes.includes("No entries this month"), JSON.stringify(noLog));
    const man = item(m0, "stain_manual", A.labId);
    check("6. the manual log is one more record for the month", man?.name === "Manual stain log" && man.problems.length === 0 && man.notes.some((n: string) => /manual stains/.test(n)), JSON.stringify(man));
    check("6. a month with no manual stains leaves it off", !item((await call("GET", `${RV}?month=2026-08`, undefined, A.token)).body, "stain_manual", A.labId));
    check("6. another lab's review doesn't show this lab's log", !item((await call("GET", `/api/labs/${B.labId}/maintain-reviews?month=${month}`, undefined, B.token)).body, "stain_manual", A.labId));

    const sign = (items: any[], extra: any = {}) => call("POST", RV, { month, items, typed_signature: "Owner A", password: PW, ...extra }, A.token);
    const instItem = [{ type: "equipment", id: stainer }];
    const manItem = [{ type: "stain_manual", id: A.labId }];
    check("6. a problem on the stain log needs a corrective action to sign", (await sign(instItem)).body.code === "CORRECTIVE_ACTION_REQUIRED");
    const signedInst = await sign(instItem, { corrective_action: "Reminded staff of the daily change; no impact on patient testing." });
    check("6. it signs with one, on the existing review", signedInst.status === 201 && signedInst.body.reviewed === 1, JSON.stringify(signedInst.body));
    check("6. the manual log signs without one", (await sign(manItem)).status === 201);
    check("6. and not twice", (await sign(manItem)).body.code === "ALREADY_REVIEWED");
    check("6. another lab's manual item isn't in this month", (await sign([{ type: "stain_manual", id: B.labId }])).status === 404);
    const m1r = await reviewMonth();
    const inst1 = item(m1r, "equipment", stainer);
    const man1 = item(m1r, "stain_manual", A.labId);
    check("6. the signed row keeps what was seen", inst1.review.problems.some((p: string) => /Water/.test(p)) && (inst1.review.summary.notes as string[]).some((n) => /stain log/.test(n)), JSON.stringify(inst1.review));
    check("6. the grid reads the review", (await call("GET", `${S}/${stainer}?month=${month}`, undefined, A.token)).body.review?.typed_signature === "Owner A");
    check("6. the manual log reads its review", (await call("GET", `${M}?month=${month}`, undefined, A.token)).body.review?.typed_signature === "Owner A");
    check("6. nothing added after yet", inst1.entries_after_review === 0 && man1.entries_after_review === 0, `${inst1.entries_after_review} ${man1.entries_after_review}`);
    await new Promise((r) => setTimeout(r, 15));
    await day("2026-09-20", [{ row_id: water, codes: ["C"] }]);
    await manual({ log_date: "2026-09-21" });
    const m2r = await reviewMonth();
    check("6. an entry added after signing shows as added after the review", item(m2r, "equipment", stainer).entries_after_review === 1 && item(m2r, "stain_manual", A.labId).entries_after_review === 1, `${item(m2r, "equipment", stainer).entries_after_review}`);
    const early = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE row_id = ? AND log_date = '2026-09-01' AND code = 'OK'").get(quality) as any).id as number;
    await new Promise((r) => setTimeout(r, 15));
    await call("POST", V(early), { reason: "Recorded on the wrong day" }, A.token);
    check("6. so does a void of an entry from before", item(await reviewMonth(), "equipment", stainer).entries_after_review === 2, `${item(await reviewMonth(), "equipment", stainer).entries_after_review}`);

    // Monthly rows and lots through the real tables, on their own instrument in a past month
    const second = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up second stainer" }, A.token)).body.id as number;
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(second);
    const SR = `${S}/${second}`;
    const mDump = (await addRow({ name: "Second eosin", row_kind: "stain", frequency: "monthly", required_code: "D" }, A.token, `${SR}/rows`)).body.id as number;
    const asNeeded = (await addRow({ name: "Second bluing", row_kind: "stain" }, A.token, `${SR}/rows`)).body.id as number;
    sqlite.prepare("UPDATE stain_log_rows SET created_at = '2026-01-01T00:00:00.000Z' WHERE equipment_id = ?").run(second);
    const secondDay = (log_date: string, items: any[]) => call("POST", `${SR}/entries`, { log_date, initials: "MU", items }, A.token);
    await secondDay("2026-08-20", [{ row_id: asNeeded, codes: ["C"], lot_number: "AUG-LOT", expiration_date: "2026-09-10" }]);
    await secondDay("2026-09-12", [{ row_id: asNeeded, codes: ["F"] }]);
    const second0 = item(await reviewMonth(), "equipment", second);
    check("6. a monthly row with nothing in a finished month needs an action", second0.problems.some((p: string) => /Second eosin: no D \(dumped\) recorded this month/.test(p)), JSON.stringify(second0.problems));
    check("6. a lot from last month, past its expiration in use this month, needs one", second0.problems.some((p: string) => /Second bluing: lot AUG-LOT expired 2026-09-10 and was in use on 1 day after that: 9\/12/.test(p)), JSON.stringify(second0.problems));
    const voidable = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE row_id = ? AND lot_number = 'AUG-LOT'").get(asNeeded) as any).id as number;
    await call("POST", `${SR}/entries/${voidable}/void`, { reason: "Wrong lot typed" }, A.token);
    check("6. a voided change no longer counts as the lot in the station", !item(await reviewMonth(), "equipment", second).problems.some((p: string) => /AUG-LOT/.test(p)));
    await secondDay("2026-09-13", [{ row_id: mDump, codes: ["D"] }]);
    check("6. the code it needs clears the monthly row", !item(await reviewMonth(), "equipment", second).problems.some((p: string) => /Second eosin/.test(p)));

    // A lab moving over: a row added today, older logs back-entered onto it
    const moved = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up moved-over stainer" }, A.token)).body.id as number;
    const movedDaily = (await addRow({ name: "Moved water", row_kind: "solution", frequency: "daily", required_code: "C" }, A.token, `${S}/${moved}/rows`)).body.id as number;
    const movedOther = (await addRow({ name: "Moved eosin", row_kind: "solution" }, A.token, `${S}/${moved}/rows`)).body.id as number;
    const movedDay = (log_date: string, items: any[]) => call("POST", `${S}/${moved}/entries`, { log_date, initials: "MU", items }, A.token);
    await movedDay("2026-06-05", [{ row_id: movedDaily, codes: ["C"] }]);
    await movedDay("2026-06-06", [{ row_id: movedOther, codes: ["F"] }]);
    await movedDay("2026-06-04", [{ row_id: movedOther, codes: ["F"] }]);
    const june = await call("GET", `${RV}?month=2026-06`, undefined, A.token);
    const mvItem = item(june.body, "equipment", moved);
    check("6. an instrument added today with older logs shows in that month", !!mvItem, JSON.stringify(june.body.items?.map((i: any) => i.name)));
    check("6. a gap inside the back-entered log is a problem", mvItem?.problems?.some((p: string) => /Moved water: 1 day in use with no C recorded: 6\/6/.test(p)), JSON.stringify(mvItem?.problems));
    check("6. the day before the row's first entry isn't", !mvItem?.problems?.some((p: string) => /6\/4/.test(p)), JSON.stringify(mvItem?.problems));
    check("6. and they read as entered late", mvItem?.notes?.some((n: string) => /3 stain log entries added more than 2 days after the date/.test(n)), JSON.stringify(mvItem?.notes));

    // Retiring a row
    check("6. a row with entries can't change type", (await call("PUT", `${S}/${moved}/rows/${movedOther}`, { row_kind: "check" }, A.token)).body.code === "ROW_HAS_ENTRIES");
    const retireRow = await call("PUT", `${S}/${moved}/rows/${movedOther}`, { active: false }, A.token);
    check("6. a row can be retired, dated today", retireRow.status === 200 && retireRow.body.active === 0 && /^\d{4}-\d{2}-\d{2}$/.test(retireRow.body.retired_at), JSON.stringify(retireRow.body));
    check("6. a retired row takes no entries", (await movedDay("2026-06-07", [{ row_id: movedOther, codes: ["F"] }])).body.code === "ROW_RETIRED");
    check("6. its entries still show", (await call("GET", `${S}/${moved}?month=2026-06`, undefined, A.token)).body.rows.some((r: any) => r.id === movedOther));
    check("6. it still shows in the month it was retired", (await call("GET", `${S}/${moved}?month=${today.slice(0, 7)}`, undefined, A.token)).body.rows.some((r: any) => r.id === movedOther));
    sqlite.prepare("UPDATE stain_log_rows SET retired_at = '2026-07-15' WHERE id = ?").run(movedOther);
    check("6. and drops off a later month with nothing in it", !(await call("GET", `${S}/${moved}?month=2026-08`, undefined, A.token)).body.rows.some((r: any) => r.id === movedOther));
    const restored = await call("PUT", `${S}/${moved}/rows/${movedOther}`, { active: true, name: "Moved eosin renamed" }, A.token);
    check("6. and restored, and renamed", restored.body.active === 1 && restored.body.retired_at === null && restored.body.name === "Moved eosin renamed");
    check("6. a row from another instrument isn't found", (await call("PUT", `${S}/${stainer}/rows/${movedOther}`, { name: "x" }, A.token)).status === 404);
    check("6. a Staff login can't retire a row", (await call("PUT", `${S}/${moved}/rows/${movedOther}`, { active: false }, staff.token)).status === 403);

    // ── 7. The Excel report ──
    const xlsx = async (m: string) => {
      const x = await fetch(`${base}${RV}/report.xlsx?month=${m}`, { headers: { Authorization: `Bearer ${A.token}` } });
      const { default: ExcelJS } = await import("exceljs");
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
      return wb;
    };
    const wb = await xlsx(month);
    check("7. the report gets the stain log's sheets", wb.worksheets.map((w) => w.name).join("|") === "About|Monthly Review|Temperature Readings|Equipment Entries|Stain Log|Manual Stain Log", wb.worksheets.map((w) => w.name).join("|"));
    const rowsOf = (name: string) => { const out: string[] = []; wb.getWorksheet(name)!.eachRow((row, n) => { if (n > 1) out.push((row.values as any[]).slice(1).join("|")); }); return out; };
    const stainRows = rowsOf("Stain Log");
    check("7. a change shows its lot and expiration", stainRows.some((r) => r.includes("Made-up autostainer|Hematoxylin|2026-09-01|C|Changed or re-filled|LOT-1|2027-06-01|MU")), stainRows.slice(0, 3).join(" // "));
    check("7. a void stays, with its reason", stainRows.some((r) => /Voided \d{4}-\d{2}-\d{2}: Wrong day/.test(r)), stainRows.join(" // ").slice(0, 300));
    const manRows = rowsOf("Manual Stain Log");
    check("7. the manual sheet shows the stain, with a problem's action, and no specimen number column", manRows.some((r) => r.includes("Problem|Yes|MU|Pale; re-stained")) && !(wb.getWorksheet("Manual Stain Log")!.getRow(1).values as any[]).join("|").toLowerCase().includes("specimen #"), manRows.join(" // ").slice(0, 300));
    check("7. the manual log reads as that on the review sheet", rowsOf("Monthly Review").some((r) => r.startsWith("Manual stain log|Manual stain log|")), rowsOf("Monthly Review").join(" // ").slice(0, 200));
    const wbEmpty = await xlsx("2026-03");
    check("7. a month with none keeps the sheets it always had", wbEmpty.worksheets.map((w) => w.name).join("|") === "About|Monthly Review|Temperature Readings|Equipment Entries", wbEmpty.worksheets.map((w) => w.name).join("|"));

    // ── 8. Staff, other labs, plan and read-only ──
    await day("2026-10-01", [{ row_id: water, codes: ["C"] }], "ZQ", coworker.token);
    await manual({ log_date: "2026-10-01", initials: "ZQ" }, coworker.token);
    await day("2026-10-02", [{ row_id: water, codes: ["C"] }], "SS", staff.token);
    const coworkerGrid = await call("GET", `${S}/${stainer}?month=2026-10`, undefined, staff.token);
    const coworkerText = JSON.stringify(coworkerGrid.body);
    check("8. a Staff login reads the grid, with initials", coworkerGrid.status === 200 && coworkerText.includes('"initials":"ZQ"'), `${coworkerGrid.status}`);
    check("8. and not a coworker's name", !coworkerText.includes("Quillfeather"), coworkerText.slice(0, 200));
    check("8. their own name stays", coworkerText.includes("Sam Stafford"));
    const manualText = JSON.stringify((await call("GET", `${M}?month=2026-10`, undefined, staff.token)).body);
    check("8. nor on the manual log", manualText.includes('"initials":"ZQ"') && !manualText.includes("Quillfeather"));
    const voidByCoworker = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE recorded_by_user_id = ?").get(coworker.userId) as any).id as number;
    await call("POST", V(voidByCoworker), { reason: "Duplicate" }, coworker.token);
    check("8. nor on a void", !JSON.stringify((await call("GET", `${S}/${stainer}?month=2026-10`, undefined, staff.token)).body).includes("Quillfeather"));
    check("8. an editor reads the names", JSON.stringify((await call("GET", `${S}/${stainer}?month=2026-10`, undefined, editor.token)).body).includes("Quillfeather"));
    check("8. the owner too", JSON.stringify((await call("GET", `${S}/${stainer}?month=2026-10`, undefined, A.token)).body).includes("Quillfeather"));

    // Sister lab: one owner holds both; a seat in lab A doesn't reach lab C
    const labC = await provision(A.email, "Stain Lab sister");
    const sisterEq = (await call("POST", `/api/labs/${labC}/equipment`, { instrument_name: "Sister stainer" }, A.token)).body.id as number;
    const sisterRow = (await addRow({ name: "Sister eosin", row_kind: "solution" }, A.token, `/api/labs/${labC}/stain-log/${sisterEq}/rows`)).body.id as number;
    await call("POST", `/api/labs/${labC}/stain-log/${sisterEq}/entries`, { log_date: "2026-09-01", initials: "MU", items: [{ row_id: sisterRow, codes: ["C"] }] }, A.token);
    await call("POST", `/api/labs/${labC}/stain-log/manual`, { log_date: "2026-09-01", specimen_type: "Sister type", result: "good", initials: "MU" }, A.token);
    for (const [who, tok] of [["An editor", editor.token], ["A Staff login", staff.token]] as const) {
      check(`8. ${who} in lab A can't read the sister lab's grid`, [403, 404].includes((await call("GET", `/api/labs/${labC}/stain-log/${sisterEq}?month=2026-09`, undefined, tok)).status));
      check(`8. ${who} can't read its manual log`, [403, 404].includes((await call("GET", `/api/labs/${labC}/stain-log/manual?month=2026-09`, undefined, tok)).status));
      check(`8. ${who} can't record there`, [403, 404].includes((await call("POST", `/api/labs/${labC}/stain-log/${sisterEq}/entries`, { log_date: "2026-09-02", initials: "XX", items: [{ row_id: sisterRow, codes: ["C"] }] }, tok)).status));
    }
    check("8. the sister lab's instrument isn't found from lab A", (await call("GET", `${S}/${sisterEq}?month=2026-09`, undefined, A.token)).status === 404);
    check("8. nor its row, on an instrument here", (await day("2026-09-22", [{ row_id: sisterRow, codes: ["C"] }])).body.code === "ROW_NOT_FOUND");
    const sisterEntry = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE row_id = ?").get(sisterRow) as any).id as number;
    check("8. nor its entry", (await call("POST", V(sisterEntry), { reason: "x" }, A.token)).status === 404);
    const sisterManual = (sqlite.prepare("SELECT id FROM stain_manual_entries WHERE lab_id = ?").get(labC) as any).id as number;
    check("8. nor its manual entry", (await call("POST", `${M}/${sisterManual}/void`, { reason: "x" }, A.token)).status === 404);

    // Plan allowlist
    const F = await mkOwner("free");
    const freeLab = await provision(F.email, "Stain Lab free");
    sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(freeLab);
    const freeEq = Number(sqlite.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, created_at, updated_at) VALUES (?, 'Free stainer', ?, ?)").run(freeLab, now, now).lastInsertRowid);
    check("8. a plan off the allowlist can't read the list", (await call("GET", `/api/labs/${freeLab}/stain-log`, undefined, F.token)).status === 403);
    check("8. or a grid", (await call("GET", `/api/labs/${freeLab}/stain-log/${freeEq}?month=2026-09`, undefined, F.token)).status === 403);
    check("8. or the manual log", (await call("GET", `/api/labs/${freeLab}/stain-log/manual?month=2026-09`, undefined, F.token)).status === 403);
    check("8. or set up a row", (await addRow({ name: "Nope", row_kind: "solution" }, F.token, `/api/labs/${freeLab}/stain-log/${freeEq}/rows`)).status === 403);
    check("8. or record", (await call("POST", `/api/labs/${freeLab}/stain-log/manual`, { log_date: "2026-09-01", specimen_type: "x", result: "good", initials: "MU" }, F.token)).status === 403);
    check("8. signed out, nothing opens", (await call("GET", S)).status === 401);

    // ── 9. Deleting ──
    const emptyRow = (await addRow({ name: "Typo row", row_kind: "solution" }, A.token, `${S}/${moved}/rows`)).body.id as number;
    check("9. a Staff login can't remove a row", (await call("DELETE", `${S}/${moved}/rows/${emptyRow}`, undefined, staff.token)).status === 403);
    check("9. a row nothing was recorded on can go", (await call("DELETE", `${S}/${moved}/rows/${emptyRow}`, undefined, A.token)).status === 200 && !sqlite.prepare("SELECT id FROM stain_log_rows WHERE id = ?").get(emptyRow));
    const heldDelete = await call("DELETE", `${S}/${moved}/rows/${movedDaily}`, undefined, A.token);
    check("9. a row with entries can't", heldDelete.status === 409 && heldDelete.body.code === "ROW_HAS_ENTRIES" && !!sqlite.prepare("SELECT id FROM stain_log_rows WHERE id = ?").get(movedDaily), JSON.stringify(heldDelete.body));
    const voidedOnly = (await addRow({ name: "Voided only", row_kind: "solution" }, A.token, `${S}/${moved}/rows`)).body.id as number;
    await movedDay("2026-06-08", [{ row_id: voidedOnly, codes: ["C"] }]);
    const voidedId = (sqlite.prepare("SELECT id FROM stain_log_entries WHERE row_id = ?").get(voidedOnly) as any).id as number;
    await call("POST", `${S}/${moved}/entries/${voidedId}/void`, { reason: "Wrong row" }, A.token);
    check("9. a row holding only a void can't either: the void is a record", (await call("DELETE", `${S}/${moved}/rows/${voidedOnly}`, undefined, A.token)).status === 409);
    const delHeld = await call("DELETE", `${L}/equipment/${moved}`, undefined, A.token);
    check("9. an instrument holding entries can't be deleted", delHeld.status === 409 && delHeld.body.code === "HOLDS_STAIN_LOG" && !!sqlite.prepare("SELECT id FROM lab_equipment WHERE id = ?").get(moved), JSON.stringify(delHeld.body));
    check("9. an instrument with rows and no entries can, and takes its rows with it", (await call("DELETE", `${L}/equipment/${plain}`, undefined, A.token)).status === 200 && !sqlite.prepare("SELECT id FROM stain_log_rows WHERE id = ?").get(plainRow));

    // ── 10. ROSE blank form ──
    const ROSE = `${L}/veritapolicy/blank-forms/rose.docx`;
    sqlite.prepare("UPDATE labs SET clia_number = '22D0000789' WHERE id = ?").run(A.labId);
    const docxRes = await fetch(base + ROSE, { headers: { Authorization: `Bearer ${A.token}` } });
    const docxBuf = Buffer.from(await docxRes.arrayBuffer());
    check("10. the form downloads as a Word file", docxRes.status === 200 && /wordprocessingml/.test(docxRes.headers.get("content-type") || "") && /Blank_Form\.docx/.test(docxRes.headers.get("content-disposition") || ""), `${docxRes.status}`);
    const JSZip = (await import("jszip")).default;
    const docXml = await (await JSZip.loadAsync(docxBuf)).file("word/document.xml")!.async("string");
    const footXml = await (await JSZip.loadAsync(docxBuf)).file(/word\/footer/)[0].async("string");
    const docText = docXml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");
    check("10. it carries this lab's name and CLIA", docText.includes("Stain Lab a") && docText.includes("CLIA: 22D0000789"), docText.slice(0, 120));
    check("10. it has the three sites, five passes each, with the codes", ["First site", "Second site", "Third site"].every((s) => docText.includes(s)) && (docText.match(/88172/g) || []).length === 4 && (docText.match(/88177/g) || []).length === 13, `${(docText.match(/88172/g) || []).length} ${(docText.match(/88177/g) || []).length}`);
    check("10. it has the label box and the signature, and says the patient stays on paper", docText.includes("Patient ID label") && docText.includes("Pathologist signature") && /never entered in VeritaAssure®/.test(docText));
    const emDash = String.fromCharCode(0x2014);
    check("10. no em dash in it", !docText.includes(emDash) && !footXml.includes(emDash));
    check("10. the footer carries the marks, with VeritaDC as a ™ and VeritaAssure as an ®", footXml.includes("VeritaAssure®") && footXml.includes("VeritaDC™"));
    check("10. a Staff login can't get it", (await fetch(base + ROSE, { headers: { Authorization: `Bearer ${staff.token}` } })).status === 403);
    check("10. another lab can't", [403, 404].includes((await fetch(base + ROSE, { headers: { Authorization: `Bearer ${B.token}` } })).status));
    check("10. a plan off the allowlist can't", (await fetch(`${base}/api/labs/${freeLab}/veritapolicy/blank-forms/rose.docx`, { headers: { Authorization: `Bearer ${F.token}` } })).status === 403);
    const bLab = await fetch(`${base}/api/labs/${B.labId}/veritapolicy/blank-forms/rose.docx`, { headers: { Authorization: `Bearer ${B.token}` } });
    const bXml = await (await JSZip.loadAsync(Buffer.from(await bLab.arrayBuffer()))).file("word/document.xml")!.async("string");
    check("10. each lab gets its own name, and no CLIA on file says so", bXml.includes("Stain Lab b") && !bXml.includes("Stain Lab a"));

    const fd = new FormData();
    fd.append("file", new Blob([docxBuf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "Rapid_On_Site_Evaluation_Blank_Form.docx");
    fd.append("title", "Rapid On-Site Evaluation (ROSE)");
    fd.append("doc_type", "form");
    const up = await fetch(`${base}${L}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: fd });
    const upBody = await up.json() as any;
    check("10. it uploads through the normal VeritaDC route, with no patient warning", up.status === 201 && upBody.phiWarning === null, JSON.stringify(upBody));
    const docRow = sqlite.prepare("SELECT title, doc_type, status, lab_id FROM policy_documents WHERE id = ?").get(upBody.id) as any;
    check("10. it's a draft Form in this lab, waiting on the lab's own approval", docRow.doc_type === "form" && docRow.status === "draft" && docRow.lab_id === A.labId, JSON.stringify(docRow));
    const render = await call("GET", `${L}/veritapolicy/documents/${upBody.id}/render`, undefined, A.token);
    check("10. it opens in VeritaDC", render.status === 200, `${render.status}`);
    const dl = await fetch(`${base}${L}/veritapolicy/documents/${upBody.id}/download`, { headers: { Authorization: `Bearer ${A.token}` } });
    const dlXml = await (await JSZip.loadAsync(Buffer.from(await dl.arrayBuffer()))).file("word/document.xml")!.async("string");
    check("10. it downloads to print, as the same blank form", dl.status === 200 && dlXml.includes("Rapid On-Site Evaluation"));

    // Read-only comes last: it blocks the rest
    const lapsed = new Date(Date.now() - 30 * 86400000).toISOString();
    sqlite.prepare("UPDATE labs SET subscription_status = 'expired', subscription_expires_at = ?, plan = 'hospital' WHERE id = ?").run(lapsed, A.labId);
    sqlite.prepare("UPDATE users SET subscription_status = 'expired', subscription_expires_at = ? WHERE id IN (?, ?, ?)").run(lapsed, A.userId, editor.userId, staff.userId);
    check("8. a lab in read-only can't record", (await day("2026-09-25", [{ row_id: water, codes: ["C"] }], "SS", staff.token)).body.code === "SUBSCRIPTION_EXPIRED_READ_ONLY");
    check("8. or add a manual stain", (await manual({ log_date: "2026-09-25" }, staff.token)).body.code === "SUBSCRIPTION_EXPIRED_READ_ONLY");
    check("8. or set up a row", (await addRow({ name: "Nope", row_kind: "solution" })).status === 403);
    check("8. it can still read its log", (await call("GET", `${S}/${stainer}?month=2026-09`, undefined, A.token)).status === 200);
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
