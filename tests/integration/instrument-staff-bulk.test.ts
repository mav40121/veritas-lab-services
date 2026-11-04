// tests/integration/instrument-staff-bulk.test.ts
//
// STANDING integration test for assigning several instruments at once (Michael 2026-11-04: "select multiple instruments, that way the selected staff will be assigned to every selected instrument").
//   1. The staff picked go on every instrument picked.
//   2. Nobody comes off, and a pairing already in place keeps its date and isn't counted as new.
//   3. The staff list says how many of the picked instruments each person is on.
//   4. The instrument list counts active testing staff only.
//   5. An instrument or person from another lab refuses the whole request, with nothing written, and another lab can't read or write here.
//   6. A new pairing inside a person's setup session flags nothing; outside it, one reassessment per new pairing; one already in place flags nothing.
//   7. Empty lists are refused, and the one-instrument save still takes people off.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:instrument-staff-bulk

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
  const PW = ["Bulk", "chk", "77!"].join("-");
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
      const email = `bulk-${tag}-${stamp}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
      const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Bulk Lab ${tag}`, plan: "hospital", isWarehouse: true });
      const labId = prov.body.labId as number;
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      const row = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
      const staffLab = row?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Bulk Lab', '22D0000888', ?, ?, ?)").run(userId, labId, now, now).lastInsertRowid);
      const addRow = (first: string, last: string, extra: { testing?: number; status?: string; baseline?: string | null } = {}) => Number(sqlite.prepare(
        "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, duties_baseline_at, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2024-02-06', ?, ?, ?, ?, ?)"
      ).run(staffLab, labId, userId, last, first, extra.testing ?? 1, extra.baseline ?? null, extra.status ?? "active", now, now).lastInsertRowid);
      const L = `/api/labs/${labId}`;
      const map = await call("POST", `${L}/veritamap/maps`, { name: `Core ${tag}` }, reg.body.token);
      const addInstrument = async (name: string, serial: string) => {
        await call("POST", `${L}/veritamap/maps/${map.body.id}/instruments`, { instrument_name: name, role: "Primary", category: "Hematology", serial_number: serial }, reg.body.token);
        return Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND serial_number = ?").get(map.body.id, serial) as any).id);
      };
      return { token: reg.body.token as string, labId, userId, L, addRow, addInstrument };
    };
    const A = await mkLab("a");
    const B = await mkLab("b");
    const i1 = await A.addInstrument("Analyzer One", "S1");
    const i2 = await A.addInstrument("Analyzer Two", "S2");
    const i3 = await A.addInstrument("Analyzer Three", "S3");
    const iB = await B.addInstrument("Other Lab Analyzer", "SB");
    const ann = A.addRow("Ann", "Early");
    const bea = A.addRow("Bea", "Early");
    const cal = A.addRow("Cal", "Stays");
    const old = A.addRow("Ollie", "Settled", { baseline: "2024-03-01T00:00:00.000Z" });
    const left = A.addRow("Lee", "Left", { status: "terminated" });
    const noTest = A.addRow("Nate", "Notesting", { testing: 0 });
    const bStaff = B.addRow("Bo", "Otherlab");
    const pairs = (where = "1 = 1", ...args: any[]) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM staff_employee_instruments sei JOIN staff_employees e ON e.id = sei.employee_id WHERE e.tier2_lab_id = ? AND ${where}`).get(A.labId, ...args) as any).n as number;
    const events = (emp: number) => (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_duty_change_events WHERE employee_id = ?").get(emp) as any).n as number;
    const ASSIGN = `${A.L}/staff/instruments-bulk/assign`;
    const STAFF = `${A.L}/staff/instruments-bulk/employees`;

    // Cal is already on instrument 1 with an older date, and stays.
    const oldDate = "2025-01-15T00:00:00.000Z";
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(cal, i1, oldDate, A.userId);

    // 1. Every instrument, every person
    const r1 = await call("POST", ASSIGN, { instrumentIds: [i1, i2], employeeIds: [ann, bea] }, A.token);
    check("1. the request saves", r1.status === 200 && r1.body.ok === true, `HTTP ${r1.status} ${r1.body.error ?? ""}`);
    check("1. two people on two instruments makes four pairings", r1.body.added === 4 && pairs("e.id IN (?, ?)", ann, bea) === 4, JSON.stringify(r1.body));
    check("1. each person is on both", pairs("e.id = ? AND sei.instrument_id IN (?, ?)", ann, i1, i2) === 2 && pairs("e.id = ? AND sei.instrument_id IN (?, ?)", bea, i1, i2) === 2);
    check("1. an instrument not picked is left alone", pairs("sei.instrument_id = ?", i3) === 0);

    // 2. Only adds
    check("2. someone not picked stays on the instrument", pairs("e.id = ? AND sei.instrument_id = ?", cal, i1) === 1);
    const r2 = await call("POST", ASSIGN, { instrumentIds: [i1, i2], employeeIds: [cal, ann] }, A.token);
    check("2. already in place isn't counted as new", r2.body.added === 1 && r2.body.alreadyAssigned === 3, JSON.stringify(r2.body));
    const kept = sqlite.prepare("SELECT created_at FROM staff_employee_instruments WHERE employee_id = ? AND instrument_id = ?").get(cal, i1) as any;
    check("2. a pairing already in place keeps its date", kept.created_at === oldDate, kept.created_at);

    // 3. The staff list
    const list = await call("GET", `${STAFF}?ids=${i1},${i3}`, undefined, A.token);
    const on = (id: number) => list.body.employees?.find((e: any) => e.id === id)?.on_count;
    check("3. the staff list answers", list.status === 200 && list.body.instrument_count === 2, `HTTP ${list.status}`);
    check("3. it says how many each person is on", on(ann) === 1 && on(old) === 0, JSON.stringify({ ann: on(ann), old: on(old) }));
    check("3. it leaves out people who left and people who don't test", on(left) === undefined && on(noTest) === undefined);
    const listBoth = await call("GET", `${STAFF}?ids=${i1},${i2}`, undefined, A.token);
    check("3. someone on all of them reads as all of them", listBoth.body.employees?.find((e: any) => e.id === ann)?.on_count === 2, JSON.stringify(listBoth.body.employees?.find((e: any) => e.id === ann)?.on_count));

    // 4. The instrument list
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(left, i3, now, A.userId);
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(noTest, i3, now, A.userId);
    const flat = await call("GET", `${A.L}/veritamap/instruments-flat`, undefined, A.token);
    const count = (id: number) => flat.body.find?.((i: any) => i.id === id)?.assigned_count;
    check("4. the count is who is on it", count(i1) === 3 && count(i2) === 3, JSON.stringify({ i1: count(i1), i2: count(i2) }));
    check("4. people who left or don't test aren't counted", count(i3) === 0, String(count(i3)));

    // 5. Lab walls
    const before = pairs();
    const wallI = await call("POST", ASSIGN, { instrumentIds: [i3, iB], employeeIds: [old] }, A.token);
    check("5. another lab's instrument refuses the whole request", wallI.status === 404 && pairs() === before, `HTTP ${wallI.status} rows ${pairs()}`);
    const wallS = await call("POST", ASSIGN, { instrumentIds: [i3], employeeIds: [old, bStaff] }, A.token);
    check("5. another lab's person refuses the whole request", wallS.status === 400 && pairs() === before, `HTTP ${wallS.status} rows ${pairs()}`);
    const gone = await call("POST", ASSIGN, { instrumentIds: [i3], employeeIds: [left] }, A.token);
    check("5. someone who left can't be added", gone.status === 400 && pairs() === before, `HTTP ${gone.status}`);
    const wallRead = await call("GET", `${STAFF}?ids=${iB}`, undefined, A.token);
    check("5. another lab's instrument can't be read", wallRead.status === 404, `HTTP ${wallRead.status}`);
    const outsider = await call("POST", ASSIGN, { instrumentIds: [i3], employeeIds: [old] }, B.token);
    check("5. another lab's owner can't assign here", outsider.status === 403 && pairs() === before, `HTTP ${outsider.status}`);
    const noToken = await call("POST", ASSIGN, { instrumentIds: [i3], employeeIds: [old] });
    check("5. signed out is refused", noToken.status === 401 && pairs() === before, `HTTP ${noToken.status}`);

    // 6. Reassessments
    check("6. a first assignment inside the setup session flags nothing", events(ann) === 0 && events(bea) === 0, `${events(ann)}, ${events(bea)}`);
    const r6 = await call("POST", ASSIGN, { instrumentIds: [i1, i2, i3], employeeIds: [old] }, A.token);
    check("6. past the setup session, one reassessment per new pairing", r6.body.dutyChangeEventsCreated === 3 && events(old) === 3, JSON.stringify(r6.body));
    const r6b = await call("POST", ASSIGN, { instrumentIds: [i1, i2, i3], employeeIds: [old] }, A.token);
    check("6. the same request again flags nothing and adds nothing", r6b.body.dutyChangeEventsCreated === 0 && r6b.body.added === 0 && events(old) === 3, JSON.stringify(r6b.body));

    // 7. Empty lists, and the single save
    check("7. no instruments is refused", (await call("POST", ASSIGN, { instrumentIds: [], employeeIds: [ann] }, A.token)).status === 400);
    check("7. no people is refused", (await call("POST", ASSIGN, { instrumentIds: [i1], employeeIds: [] }, A.token)).status === 400);
    check("7. no instruments on the staff list is refused", (await call("GET", STAFF, undefined, A.token)).status === 400);
    const single = await call("PUT", `${A.L}/staff/instruments/${i2}/employees`, { employeeIds: [ann] }, A.token);
    check("7. the one-instrument save still takes people off", single.status === 200 && pairs("sei.instrument_id = ? AND e.id = ?", i2, bea) === 0 && pairs("sei.instrument_id = ? AND e.id = ?", i2, ann) === 1, `HTTP ${single.status}`);
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
