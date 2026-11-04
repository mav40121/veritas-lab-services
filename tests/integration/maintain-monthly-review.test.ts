// tests/integration/maintain-monthly-review.test.ts
//
// STANDING integration test for the VeritaMaintain monthly record review (Michael 2026-11-04, Q161 = 1; CAP COM.04200):
//   1. The month lists each instrument and temperature unit, and what the records show: readings, days short, out of range, late entries, PM overdue, solution changes.
//   2. Who signs: the designated medical director, a designee with this duty in an active letter (by login or by roster link), the owner as a recorded override. Nobody else.
//      A letter without the duty, a revoked letter and a draft letter don't count.
//   3. Signing needs a typed name and the password; a problem needs a corrective action; only items in this lab and this month; no signing twice.
//   4. What was signed is kept: the row holds what was seen, and an entry added afterward shows as added after the review.
//   5. Another lab can't read or sign. A lab in read-only can't sign. Boot adds the table, and it's in the export-all list.
//   6. The Excel report has the About sheet first, the review and the underlying records.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:maintain-monthly-review

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
  const PW = ["Review", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `review-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Review Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };

  try {
    check("0. boot adds the table", (sqlite.prepare("PRAGMA table_info(maintain_record_reviews)").all() as any[]).length > 0);
    check("0. it is in the export-all list", !!(EXPORT_TABLES as any).maintain_record_reviews);

    const A = await mkLab("a");
    const B = await mkLab("b");
    const addPerson = async (tag: string, seat: "editor" | "staff" = "editor") => {
      const email = `review-${tag}-${Date.now()}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Person ${tag}`, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A.labId, userId);
      if (seat === "editor") {
        sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`).run(A.userId, email, userId, now, now, `review-${tag}-${Date.now()}`, A.labId);
      }
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
      const login = await call("POST", "/api/auth/login", { email, password: PW });
      return { email, userId, token: login.body.token as string };
    };
    const L = `/api/labs/${A.labId}`;
    const R = `${L}/maintain-reviews`;

    // A past month, so nothing depends on today. The unit and instrument existed all month.
    const month = "2026-09";
    const addLetter = (who: { user?: number; employee?: number }, duties: Record<string, boolean>, status = "active", position = "general_supervisor") => Number(sqlite.prepare(
      `INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_staff_employee_id, delegate_name, position, complexity_scope, responsibilities_json, status, created_at, updated_at) VALUES (?, ?, ?, 'Made Up', ?, 'high', ?, ?, ?, ?)`
    ).run(A.labId, who.user ?? null, who.employee ?? null, position, JSON.stringify(duties), status, now, now).lastInsertRowid);

    const stainer = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up autostainer", location: "Histology", pm_interval_days: 180, next_due_date: "2026-08-01" }, A.token)).body.id;
    const microscope = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up microscope", next_due_date: "2027-06-01" }, A.token)).body.id;
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id IN (?, ?)").run(stainer, microscope);
    await call("POST", `${L}/equipment/${stainer}/events`, { event_type: "solution_change", event_date: "2026-09-03", performed_by: "MU", notes: "Changed: Hematoxylin", }, A.token);
    sqlite.prepare("UPDATE lab_equipment SET next_due_date = '2026-08-01' WHERE id = ?").run(stainer);
    sqlite.prepare("UPDATE equipment_maintenance_events SET created_at = '2026-09-03T15:00:00.000Z' WHERE equipment_id = ?").run(stainer);
    const fridge = (await call("POST", `${L}/temp-logs/units`, { name: "Made-up refrigerator", min_value: 2, max_value: 8, readings_per_day: 1 }, A.token)).body.id;
    const room = (await call("POST", `${L}/temp-logs/units`, { name: "Made-up room", unit_type: "humidity", scale: "RH", min_value: 30, max_value: 60 }, A.token)).body.id;
    sqlite.prepare("UPDATE temp_log_units SET created_at = '2026-01-01T00:00:00.000Z' WHERE id IN (?, ?)").run(fridge, room);
    const insertReading = sqlite.prepare("INSERT INTO temp_log_readings (lab_id, unit_id, reading_date, reading_time, value, in_range, initials, corrective_action, created_at) VALUES (?, ?, ?, '08:00', ?, ?, 'MU', ?, ?)");
    // The refrigerator: every day but the 10th and 20th. One out of range. One entered weeks late.
    for (let d = 1; d <= 30; d += 1) {
      const day = `2026-09-${String(d).padStart(2, "0")}`;
      insertReading.run(A.labId, room, day, 45, 1, null, `${day}T12:00:00.000Z`);
      if (d === 10 || d === 20) continue;
      const outOfRange = d === 5;
      insertReading.run(A.labId, fridge, day, outOfRange ? 12 : 4, outOfRange ? 0 : 1, outOfRange ? "Moved contents" : null, d === 15 ? "2026-10-20T12:00:00.000Z" : `${day}T12:00:00.000Z`);
    }

    // 1. What the month shows
    const m0 = await call("GET", `${R}?month=${month}`, undefined, A.token);
    check("1. the month lists all four records", m0.status === 200 && m0.body.items.length === 4 && m0.body.counts.open === 4, `HTTP ${m0.status} ${m0.body.items?.length}`);
    const item = (m: any, type: string, id: number) => m.body.items.find((i: any) => i.type === type && i.id === id);
    const f0 = item(m0, "temp_unit", fridge);
    check("1. days short are a problem, named by date", f0.problems.length === 1 && /2 days short/.test(f0.problems[0]) && /9\/10, 9\/20/.test(f0.problems[0]), JSON.stringify(f0.problems));
    check("1. out-of-range readings are shown", f0.summary.out_of_range === 1 && f0.notes.some((n: string) => /1 out of range/.test(n)), JSON.stringify(f0.notes));
    check("1. an entry made weeks late is called out", f0.summary.entered_late === 1 && f0.notes.some((n: string) => /added more than 2 days after/.test(n)), JSON.stringify(f0.notes));
    check("1. a unit with every reading has no problem", item(m0, "temp_unit", room).problems.length === 0);
    const s0 = item(m0, "equipment", stainer);
    check("1. overdue PM is a problem", s0.problems.length === 1 && /PM was due 2026-08-01/.test(s0.problems[0]), JSON.stringify(s0.problems));
    check("1. solution changes are counted", s0.summary.solution_changes === 1 && s0.notes.some((n: string) => /1 solution change/.test(n)), JSON.stringify(s0.notes));
    const mic = item(m0, "equipment", microscope);
    check("1. an instrument with no entries is shown, not a problem", mic.problems.length === 0 && mic.notes.includes("No entries this month"), JSON.stringify(mic));
    check("1. a future month is refused", (await call("GET", `${R}?month=2099-01`, undefined, A.token)).status === 400);

    // 2. Who signs
    const body = (items: any[], extra: any = {}) => ({ month, items, typed_signature: "Made Up Reviewer", password: PW, ...extra });
    const roomItem = [{ type: "temp_unit", id: room }];
    const nobody = await addPerson("nobody");
    const asNobody = await call("GET", `${R}?month=${month}`, undefined, nobody.token);
    check("2. someone with no authority can read but is told they can't sign", asNobody.status === 200 && asNobody.body.can_review === false);
    check("2. and is refused", (await call("POST", R, body(roomItem), nobody.token)).body.code === "NOT_DIRECTOR_OR_DESIGNEE");
    const wrongDuty = await addPerson("wrongduty");
    addLetter({ user: wrongDuty.userId }, { finding_closure: true });
    check("2. a letter without this duty doesn't count", (await call("POST", R, body(roomItem), wrongDuty.token)).status === 403);
    const revoked = await addPerson("revoked");
    addLetter({ user: revoked.userId }, { equipment_record_review: true }, "revoked");
    check("2. a revoked letter doesn't count", (await call("POST", R, body(roomItem), revoked.token)).status === 403);
    const draftLetter = await addPerson("draftletter");
    addLetter({ user: draftLetter.userId }, { equipment_record_review: true }, "draft");
    check("2. a draft letter doesn't count", (await call("POST", R, body(roomItem), draftLetter.token)).status === 403);

    const gs = await addPerson("gs");
    addLetter({ user: gs.userId }, { equipment_record_review: true });
    const gsMonth = await call("GET", `${R}?month=${month}`, undefined, gs.token);
    check("2. a General Supervisor with the duty can sign, labeled as a designee", gsMonth.body.can_review === true && /Designee, General Supervisor/.test(gsMonth.body.capacity_label), gsMonth.body.capacity_label);

    // 3. Signing
    check("3. no name is refused", (await call("POST", R, body(roomItem, { typed_signature: " " }), gs.token)).status === 400);
    check("3. no password is refused", (await call("POST", R, body(roomItem, { password: "" }), gs.token)).status === 400);
    check("3. a wrong password is refused", (await call("POST", R, body(roomItem, { password: "wrong-password" }), gs.token)).status === 401);
    check("3. nothing picked is refused", (await call("POST", R, body([]), gs.token)).status === 400);
    check("3. a bad month is refused", (await call("POST", R, body(roomItem, { month: "2026-13" }), gs.token)).status === 400);
    check("3. a record from nowhere is refused", (await call("POST", R, body([{ type: "temp_unit", id: 99999999 }]), gs.token)).status === 404);
    const fridgeItem = [{ type: "temp_unit", id: fridge }];
    const noAction = await call("POST", R, body(fridgeItem), gs.token);
    check("3. a problem without a corrective action is refused", noAction.status === 400 && noAction.body.code === "CORRECTIVE_ACTION_REQUIRED", `HTTP ${noAction.status}`);
    const clean = await call("POST", R, body(roomItem), gs.token);
    check("3. a clean record signs without one", clean.status === 201 && clean.body.reviewed === 1, `HTTP ${clean.status} ${clean.body.error || ""}`);
    check("3. signing twice is refused", (await call("POST", R, body(roomItem), gs.token)).body.code === "ALREADY_REVIEWED");
    const mixed = await call("POST", R, body([...fridgeItem, { type: "equipment", id: stainer }], { corrective_action: "Reminded staff; no impact on patient testing. PM booked." }), gs.token);
    check("3. problems sign with a corrective action", mixed.status === 201 && mixed.body.reviewed === 2, `HTTP ${mixed.status}`);

    // 4. What was signed is kept
    const m1 = await call("GET", `${R}?month=${month}`, undefined, gs.token);
    const f1 = item(m1, "temp_unit", fridge);
    check("4. the review reads back with who, as what and the action", f1.review?.typed_signature === "Made Up Reviewer" && /Designee/.test(f1.review?.capacity_label) && /Reminded staff/.test(f1.review?.corrective_action), JSON.stringify(f1.review));
    check("4. the counts move", m1.body.counts.reviewed === 3 && m1.body.counts.open === 1, JSON.stringify(m1.body.counts));
    check("4. the signed row holds what was seen", JSON.parse((sqlite.prepare("SELECT problems_json AS p FROM maintain_record_reviews WHERE item_type = 'temp_unit' AND item_id = ?").get(fridge) as any).p)[0]?.includes("2 days short") === true);
    const audit = sqlite.prepare("SELECT action, entity_type FROM audit_log WHERE module = 'veritamaintain' AND entity_type = 'monthly_record_review'").all() as any[];
    check("4. signing is audited", audit.length === 2, `${audit.length}`);
    await new Promise((r) => setTimeout(r, 15));
    const lateOne = await call("POST", `${L}/temp-logs/units/${fridge}/readings`, { reading_date: "2026-09-10", value: 4, initials: "MU" }, A.token);
    const m2 = await call("GET", `${R}?month=${month}`, undefined, gs.token);
    const f2 = item(m2, "temp_unit", fridge);
    check("4. an entry added after signing shows as added after the review", lateOne.status === 201 && f2.entries_after_review === 1, `${f2.entries_after_review}`);
    check("4. and the problems signed stay what they were", f2.review.problems.length === 1 && /2 days short/.test(f2.review.problems[0]), JSON.stringify(f2.review.problems));

    // Roster-linked letter, the medical director and the owner override
    const nowMonth = "2026-08";
    const bench = await addPerson("bench", "staff");
    const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any)?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Review Lab', '22D0000456', ?, ?, ?)").run(A.userId, A.labId, now, now).lastInsertRowid);
    const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Bench', 'Bea', 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(A.userId, bench.email, bench.userId, A.labId, emp);
    addLetter({ employee: emp }, { equipment_record_review: true });
    const benchSign = await call("POST", R, { month: nowMonth, items: [{ type: "equipment", id: microscope }], typed_signature: "Bea Bench", password: PW }, bench.token);
    check("2. a Staff login named by the letter through the roster can sign, with no seat used", benchSign.status === 201 && /Designee/.test(benchSign.body.capacity_label), `HTTP ${benchSign.status} ${benchSign.body.error || ""}`);
    const bench2 = await addPerson("bench2", "staff");
    const emp2 = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Bench', 'Bo', 'active', ?, ?)").run(staffLab, A.labId, A.userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(A.userId, bench2.email, bench2.userId, A.labId, emp2);
    addLetter({ employee: emp2 }, { equipment_record_review: true }, "revoked");
    addLetter({ employee: emp2 }, { finding_closure: true });
    check("2. through the roster too, a revoked letter or one without this duty doesn't count", (await call("GET", `${R}?month=${month}`, undefined, bench2.token)).body.can_review === false);
    const director = await addPerson("director");
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(director.email, A.labId);
    const dirMonth = await call("GET", `${R}?month=${month}`, undefined, director.token);
    check("2. the designated medical director signs as that", dirMonth.body.capacity_label === "Medical director", dirMonth.body.capacity_label);
    const ownerSign = await call("POST", R, { month, items: [{ type: "equipment", id: microscope }], typed_signature: "Owner A", password: PW }, A.token);
    check("2. the owner signs as a recorded override", ownerSign.status === 201 && /override/.test(ownerSign.body.capacity_label), ownerSign.body.capacity_label);

    // 5. Other labs and read-only
    check("5. another lab can't read this lab's month", [403, 404].includes((await call("GET", `${R}?month=${month}`, undefined, B.token)).status));
    check("5. another lab can't sign here", [403, 404].includes((await call("POST", R, body(roomItem), B.token)).status));
    const otherStainer = (await call("POST", `/api/labs/${B.labId}/equipment`, { instrument_name: "Other lab instrument" }, B.token)).body.id;
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(otherStainer);
    check("5. this lab can't sign another lab's record", (await call("POST", R, { month: nowMonth, items: [{ type: "equipment", id: otherStainer }], typed_signature: "Made Up Reviewer", password: PW }, gs.token)).status === 404);

    // 6. The Excel report
    const x = await fetch(`${base}${R}/report.xlsx?month=${month}`, { headers: { Authorization: `Bearer ${gs.token}` } });
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
    check("6. the report has About first, then the review and the records", x.status === 200 && wb.worksheets.map((w) => w.name).join("|") === "About|Monthly Review|Temperature Readings|Equipment Entries", wb.worksheets.map((w) => w.name).join("|"));
    const review = wb.getWorksheet("Monthly Review")!;
    const rows: string[] = [];
    review.eachRow((row, n) => { if (n > 1) rows.push(`${row.getCell(1).value}|${row.getCell(5).value}|${row.getCell(10).value ?? ""}`); });
    check("6. the review sheet shows each record and the entry added after", rows.length === 4 && rows.some((r) => /Made-up refrigerator\|Reviewed\|1/.test(r)), JSON.stringify(rows));
    check("6. the readings sheet has the month's readings with their scale", wb.getWorksheet("Temperature Readings")!.rowCount === 60 && String(wb.getWorksheet("Temperature Readings")!.getRow(2).getCell(5).value).length > 0, `${wb.getWorksheet("Temperature Readings")!.rowCount}`);
    check("6. the entries sheet has the solution change in plain words", wb.getWorksheet("Equipment Entries")!.getRow(2).getCell(3).value === "Solution change");
    check("6. lab identity is on the page header", /CLIA/.test(String(review.headerFooter?.oddHeader || "")));

    // Read-only comes last: it blocks the rest
    sqlite.prepare("UPDATE labs SET subscription_status = 'expired', subscription_expires_at = '2020-01-01', plan = 'hospital' WHERE id = ?").run(A.labId);
    sqlite.prepare("UPDATE users SET subscription_status = 'expired', subscription_expires_at = '2020-01-01' WHERE id = ?").run(gs.userId);
    const readOnly = await call("POST", R, { month: "2026-07", items: [{ type: "equipment", id: stainer }], typed_signature: "Made Up Reviewer", password: PW, corrective_action: "x" }, gs.token);
    check("5. a lab in read-only can't sign", readOnly.status === 403, `HTTP ${readOnly.status} ${readOnly.body.error || ""}`);
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
