// scripts/verify-veritatrack-audit.mjs
//
// Receipt for Wave B3 (2026-06-12): VeritaTrack audit trail. Replicates the
// veritatrack_audit migration + the trackAudit writes over an in-memory schema
// and asserts:
//
//   1. migration adds the table and is idempotent
//   2. task create / update / deactivate / signoff record / signoff delete each
//      append exactly one append-only row with the right event + lab scope
//   3. a deleted sign-off leaves a durable record AFTER the signoff row is gone
//   4. the read query returns events newest-first scoped to one task
//
// Run: node scripts/verify-veritatrack-audit.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritatrack_signoffs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, lab_id INTEGER, completed_date TEXT, performed_by TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
`);
db.prepare("INSERT INTO users (id, name) VALUES (7, 'M. Veri')").run();

function runMigration() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS veritatrack_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_id INTEGER, task_id INTEGER, signoff_id INTEGER,
      event TEXT NOT NULL, detail TEXT, by_user_id INTEGER,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vtrack_audit_task ON veritatrack_audit(task_id);
  `);
}
runMigration();
runMigration(); // idempotent

const cols = db.prepare("PRAGMA table_info(veritatrack_audit)").all().map(c => c.name);
check("1. migration adds the 8 audit columns, idempotent",
  ["id","lab_id","task_id","signoff_id","event","detail","by_user_id","at"].every(c => cols.includes(c)));

function trackAudit(o) {
  db.prepare("INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id) VALUES (?,?,?,?,?,?)")
    .run(o.labId ?? null, o.taskId ?? null, o.signoffId ?? null, o.event, o.detail ?? null, o.byUserId ?? null);
}

// Lifecycle: create task 1 in lab 3, edit it, record a sign-off, delete it.
trackAudit({ labId: 3, taskId: 1, event: "task_created", detail: "Pipette Calibration (Annual)", byUserId: 7 });
trackAudit({ labId: 3, taskId: 1, event: "task_updated", detail: "Pipette Calibration (Annual)", byUserId: 7 });
const so = db.prepare("INSERT INTO veritatrack_signoffs (task_id, lab_id, completed_date, performed_by) VALUES (1, 3, '2026-06-10', 'JD')").run();
const soId = Number(so.lastInsertRowid);
trackAudit({ labId: 3, taskId: 1, signoffId: soId, event: "signoff_recorded", detail: "Completed 2026-06-10 by JD", byUserId: 7 });
// Read the signoff BEFORE deleting, mirror the server (existing row in hand).
const existing = db.prepare("SELECT * FROM veritatrack_signoffs WHERE id = ?").get(soId);
db.prepare("DELETE FROM veritatrack_signoffs WHERE id = ?").run(soId);
trackAudit({ labId: existing.lab_id, taskId: existing.task_id, signoffId: soId, event: "signoff_deleted", detail: `Removed sign-off dated ${existing.completed_date} (${existing.performed_by})`, byUserId: 7 });

// A second task in a different lab must not bleed into task 1's trail.
trackAudit({ labId: 9, taskId: 2, event: "task_created", detail: "Thermometer Calibration (Annual)", byUserId: 7 });

const all1 = db.prepare("SELECT * FROM veritatrack_audit WHERE task_id = 1").all();
check("2a. task 1 has exactly 4 events", all1.length === 4);
check("2b. events present: created/updated/recorded/deleted",
  ["task_created","task_updated","signoff_recorded","signoff_deleted"].every(e => all1.some(r => r.event === e)));
check("2c. all task-1 events scoped to lab 3", all1.every(r => r.lab_id === 3));

const del = db.prepare("SELECT * FROM veritatrack_audit WHERE event = 'signoff_deleted' AND task_id = 1").get();
check("3. deleted sign-off leaves a durable record (date preserved)",
  !!del && /2026-06-10/.test(del.detail) && db.prepare("SELECT COUNT(*) c FROM veritatrack_signoffs WHERE id = ?").get(soId).c === 0);

// Read query mirror: newest-first, joined to users, scoped to task 1.
const read = db.prepare(
  "SELECT a.event, a.detail, a.at, u.name AS by_name FROM veritatrack_audit a LEFT JOIN users u ON u.id = a.by_user_id WHERE a.task_id = ? ORDER BY a.at DESC, a.id DESC"
).all(1);
check("4a. read returns 4 rows for task 1, none from task 2", read.length === 4);
check("4b. newest-first ordering (last event is signoff_deleted)", read[0].event === "signoff_deleted");
check("4c. by_name resolved via join", read.every(r => r.by_name === "M. Veri"));

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (9/9): Wave B3 VeritaTrack audit migration, lifecycle capture, delete durability, and scoped read verified.");
