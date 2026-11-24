// tests/integration/maintain-schedule-migration.test.ts
//
// STANDING test for the boot step that gives each instrument its first schedule (B10, 2026-11-24; server/equipmentScheduleData.ts
// backfillPrimarySchedules). It starts from a database as it was before schedules existed and boots today's code on it:
//   1. no due date, PM interval, status, event or reminder changes: every column the older code had reads exactly as it did
//   2. each instrument with an interval or a due date has one first schedule holding exactly those, as "every N days" (or no interval);
//      one with neither has none; a retired one keeps its own
//   3. a second boot changes nothing and adds nothing
//   4. the older readers see what they saw: the instrument list's status, readiness and digest counts
//   5. completing PM works out the same next date the older code did, and a reminder already sent isn't sent again
//
// The older database is made here from the tables as main had them (frozen below), or, with MAIN_DB=<path>, is a database made by running
// main itself. Run: npm run test:maintain-schedule-migration

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// As main had them on 2026-11-24 (1c739e1b), with every column an ALTER had added by then.
const FROZEN = `
  CREATE TABLE IF NOT EXISTS lab_equipment (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL, instrument_name TEXT NOT NULL, manufacturer TEXT, model TEXT, serial_number TEXT, location TEXT,
    pm_interval_days INTEGER, next_due_date TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), map_instrument_id INTEGER);
  CREATE TABLE IF NOT EXISTS equipment_maintenance_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL, lab_id INTEGER NOT NULL, event_type TEXT NOT NULL, event_date TEXT NOT NULL, performed_by TEXT, next_due_date TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS equipment_reminder_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0, lead_days INTEGER NOT NULL DEFAULT 14, overdue_cadence_days INTEGER NOT NULL DEFAULT 7, recipients_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS equipment_reminder_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, equipment_id INTEGER NOT NULL, lab_id INTEGER NOT NULL, reminder_kind TEXT NOT NULL, due_date TEXT, sent_on TEXT NOT NULL, recipient_email TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`;
const LAB = 900001;
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

async function main() {
  const dbPath = process.env.DB_PATH!;
  if (!dbPath) throw new Error("DB_PATH is required");
  const Database = require2("better-sqlite3");
  if (process.env.MAIN_DB) fs.copyFileSync(process.env.MAIN_DB, dbPath);
  const old = new Database(dbPath);
  if (!process.env.MAIN_DB) old.exec(FROZEN);
  else check("0. MAIN_DB is from before schedules", !old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'equipment_schedules'").get() && !(old.prepare("PRAGMA table_info(lab_equipment)").all() as any[]).some((c) => c.name === "retired_at"));
  const ins = old.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, pm_interval_days, next_due_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2025-03-04T10:00:00.000Z', '2026-10-01T10:00:00.000Z')");
  const add = (name: string, days: number | null, due: string | null, status = "active") => Number(ins.run(LAB, name, days, due, status).lastInsertRowid);
  const ids = {
    both: add("Interval and date", 180, iso(3)), overdue: add("Overdue", 90, iso(-40)), intervalOnly: add("Interval only", 365, null), dateOnly: add("Date only", null, iso(100)),
    neither: add("Neither", null, null), retired: add("Retired", 30, "2024-01-01", "retired"), zero: add("Zero interval", 0, iso(200)), blank: add("Blank date", null, ""), daily: add("Every day", 1, iso(1)),
  };
  const ev = old.prepare("INSERT INTO equipment_maintenance_events (equipment_id, lab_id, event_type, event_date, performed_by, next_due_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'MU', ?, 'made up', '2026-06-01T10:00:00.000Z', '2026-06-01T10:00:00.000Z')");
  ev.run(ids.both, LAB, "preventive_maintenance", iso(-177), iso(3));
  ev.run(ids.both, LAB, "repair", iso(-20), null);
  old.prepare("INSERT INTO equipment_reminder_config (lab_id, enabled, lead_days, overdue_cadence_days, recipients_json) VALUES (?, 1, 14, 7, '[{\"email\":\"lab@example.com\"}]')").run(LAB);
  old.prepare("INSERT INTO equipment_reminder_log (equipment_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?, ?, 'approaching-3', ?, ?, 'lab@example.com')").run(ids.both, LAB, iso(3), iso(0));
  old.prepare("INSERT INTO equipment_reminder_log (equipment_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?, ?, 'overdue', ?, ?, 'lab@example.com')").run(ids.overdue, LAB, iso(-40), iso(-1));
  // Every column the older code had, for every row in the database.
  const TABLES = ["lab_equipment", "equipment_maintenance_events", "equipment_reminder_config", "equipment_reminder_log"];
  const cols = Object.fromEntries(TABLES.map((t) => [t, (old.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name).join(", ")]));
  const snap = (h: any) => JSON.stringify(TABLES.map((t) => h.prepare(`SELECT ${cols[t]} FROM ${t} ORDER BY id`).all()));
  const before = snap(old);
  const counts = old.prepare("SELECT COUNT(*) AS n FROM lab_equipment").get().n;
  const others = old.prepare("SELECT id, lab_id, pm_interval_days, next_due_date FROM lab_equipment WHERE lab_id <> ?").all(LAB) as any[];
  old.close();

  // Boot today's code on it.
  const { db } = await import("../../server/db");
  const sqlite = (db as any).$client;
  check("1. nothing the older code had changed: no due date, interval, status, event or reminder", snap(sqlite) === before);
  const sched = sqlite.prepare("SELECT * FROM equipment_schedules ORDER BY equipment_id, id").all() as any[];
  const of = (id: number) => sched.filter((s) => s.equipment_id === id);
  const one = (id: number, frequency: string, days: number | null, due: string | null) => {
    const r = of(id);
    return r.length === 1 && r[0].is_primary === 1 && r[0].active === 1 && r[0].lab_id === LAB && r[0].frequency === frequency && r[0].interval_days === days && r[0].next_due_date === due && r[0].schedule_type === "preventive_maintenance" && r[0].recipients_json === "[]" && r[0].starts_on === "2025-03-04";
  };
  check("2. an interval and a date", one(ids.both, "every_n_days", 180, iso(3)), JSON.stringify(of(ids.both)));
  check("2. an overdue one stays overdue on the same date", one(ids.overdue, "every_n_days", 90, iso(-40)));
  check("2. an interval with no date, and a date with no interval", one(ids.intervalOnly, "every_n_days", 365, null) && one(ids.dateOnly, "manual", null, iso(100)));
  check("2. a zero interval is no interval", one(ids.zero, "manual", null, iso(200)));
  check("2. every 1 day is every 1 day, not a daily one that would owe a record a day back to when it was added", one(ids.daily, "every_n_days", 1, iso(1)));
  check("2. neither, or a blank date: none", of(ids.neither).length === 0 && of(ids.blank).length === 0);
  check("2. a retired one keeps its own", one(ids.retired, "every_n_days", 30, "2024-01-01"));
  check("2. every instrument in the database: the schedule is the interval and date it has", others.every((e) => {
    const r = of(e.id); const has = Number(e.pm_interval_days) > 0 || !!String(e.next_due_date || "").trim();
    return has ? r.length === 1 && r[0].next_due_date === e.next_due_date && r[0].interval_days === (Number(e.pm_interval_days) > 0 ? e.pm_interval_days : null) && r[0].lab_id === e.lab_id : r.length === 0;
  }), `${others.length} other instruments`);
  console.log(`      (${counts} instruments, ${others.length} of them made by the older code's own routes)`);

  // 3. Again
  const schedBefore = JSON.stringify(sched);
  const boot = spawnSync(process.execPath, [path.join(path.dirname(require2.resolve("tsx/package.json")), "dist", "cli.mjs"), "-e", "import('./server/db').then(() => process.exit(0))"], { env: { ...process.env, MAIN_DB: "" }, encoding: "utf8" });
  check("3. a second boot changes nothing and adds nothing", boot.status === 0 && snap(sqlite) === before && JSON.stringify(sqlite.prepare("SELECT * FROM equipment_schedules ORDER BY equipment_id, id").all()) === schedBefore, `${boot.status} ${String(boot.stderr).slice(0, 300)}`);

  // 4. The older readers
  const { equipmentDueCounts } = await import("../../server/labReadiness");
  const today = iso(0);
  const c = equipmentDueCounts(sqlite, LAB, today);
  check("4. readiness counts what it counted", c.overdue === 1 && c.total === 8, JSON.stringify(c));

  // 5. The routes and the reminders
  const express = (await import("express")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const { registerRoutes } = await import("../../server/routes");
  const { equipmentMailer, runEquipmentReminders } = await import("../../server/equipmentReminders");
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    const now = new Date().toISOString();
    const reg = await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `mig-${Date.now()}@example.com`, password: ["Migr", "ate", "77!"].join("-"), name: "Owner Mig", hipaa_acknowledged: true }) });
    const uid = Number(((await reg.json()) as any).user?.id);
    sqlite.prepare("INSERT INTO labs (id, lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, clia_number, created_at, updated_at) VALUES (?, 'Migration Lab', ?, 'hospital', 'active', '2099-01-01T00:00:00.000Z', '99D0000777', ?, ?)").run(LAB, uid, now, now);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'owner', 'active', 1, ?, ?, ?)").run(LAB, uid, now, now, now);
    const token = jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "20m" });
    const call = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(`${base}/api/labs/${LAB}${p}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    const list = (await call("GET", "/equipment")).body as any[];
    check("4. the instrument list reads the same dates and statuses", list.length === 8 && list.find((e) => e.id === ids.overdue).maintenance_status === "overdue" && list.find((e) => e.id === ids.both).maintenance_status === "due_soon" && list.find((e) => e.id === ids.both).next_due_date === iso(3) && list.find((e) => e.id === ids.neither).maintenance_status === "none", JSON.stringify(list.map((e) => [e.id, e.maintenance_status])));
    // A later test lab's clock can be a day behind UTC; what matters is that nothing already sent goes again.
    const sent: any[] = [];
    equipmentMailer.ready = () => true;
    equipmentMailer.send = async (m) => { sent.push(m); };
    sqlite.prepare("UPDATE equipment_reminder_config SET enabled = 0 WHERE lab_id <> ?").run(LAB);
    sqlite.prepare("UPDATE labs SET time_zone = 'UTC' WHERE id = ?").run(LAB);
    await runEquipmentReminders();
    const text = sent.map((m) => m.text).join("\n");
    check("5. a reminder already sent for a date isn't sent again, and an overdue one keeps its cadence", !/Interval and date/.test(text) && !/Overdue,/.test(text), text);
    const old5 = (await call("GET", `/equipment/${ids.both}/events`)).body as any[];
    check("5. the older entries still read", old5.length === 2 && old5.some((e) => e.event_type === "repair" && e.performed_by === "MU"));
    const pm = await call("POST", `/equipment/${ids.both}/events`, { event_type: "preventive_maintenance", event_date: iso(-1) });
    check("5. completing PM works out the same next date the older code did (event + 180 days)", pm.status === 200 && pm.body.next_due_date === iso(179) && sqlite.prepare("SELECT next_due_date AS d FROM equipment_schedules WHERE equipment_id = ?").get(ids.both).d === iso(179), JSON.stringify(pm.body.next_due_date));
    const noInterval = await call("POST", `/equipment/${ids.dateOnly}/events`, { event_type: "preventive_maintenance", event_date: iso(-1) });
    check("5. with no interval and no date typed, the date stays", noInterval.status === 200 && noInterval.body.next_due_date === iso(100));
    const note = await call("POST", `/equipment/${ids.both}/events/${old5.find((e) => e.event_type === "preventive_maintenance").id}/correct`, { reason: "Initials", performed_by: "MUP" });
    check("5. correcting a note on an older PM entry moves nothing", note.status === 200 && sqlite.prepare("SELECT next_due_date AS d FROM lab_equipment WHERE id = ?").get(ids.both).d === iso(179), JSON.stringify(note.body));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
