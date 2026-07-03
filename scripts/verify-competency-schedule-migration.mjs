// scripts/verify-competency-schedule-migration.mjs
// Proves the guarded ALTER for staff_competency_schedules.nys_six_month_due_at
// (server/db.ts): an OLD-schema DB missing the column gains it after the migration
// runs, a write to the column then succeeds (the exact op that was 500-ing on prod),
// and re-running the migration is an idempotent no-op.
// Run: node scripts/verify-competency-schedule-migration.mjs
import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log("PASS  " + name); }
  else { fail++; console.log("FAIL  " + name); }
};

const db = new Database(":memory:");
const cols = () => db.prepare("PRAGMA table_info(staff_competency_schedules)").all().map((c) => c.name);

// 1. Simulate an OLD prod DB: the table as it existed before the NYS column was added.
db.exec(`CREATE TABLE staff_competency_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  lab_id INTEGER NOT NULL,
  six_month_due_at TEXT,
  notes TEXT
)`);
check("old schema is missing nys_six_month_due_at", !cols().includes("nys_six_month_due_at"));

// 2. The exact migration block from server/db.ts.
function migrate() {
  const scsColNames = db.prepare("PRAGMA table_info(staff_competency_schedules)").all().map((c) => c.name);
  if (!scsColNames.includes("nys_six_month_due_at")) {
    try { db.exec("ALTER TABLE staff_competency_schedules ADD COLUMN nys_six_month_due_at TEXT"); } catch {}
  }
}
migrate();
check("after migration the column exists", cols().includes("nys_six_month_due_at"));

// 3. A write to the new column now succeeds (this is the write that was throwing 500).
let wrote = false;
try {
  db.prepare("INSERT INTO staff_competency_schedules (employee_id, lab_id, nys_six_month_due_at) VALUES (?, ?, ?)")
    .run(1, 1, "2026-01-01");
  wrote = true;
} catch { wrote = false; }
check("insert writing nys_six_month_due_at succeeds", wrote);

// 4. Idempotent: re-running does not throw and does not duplicate the column.
let idempotent = true;
try { migrate(); } catch { idempotent = false; }
check("re-running the migration is an idempotent no-op",
  idempotent && cols().filter((c) => c === "nys_six_month_due_at").length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
