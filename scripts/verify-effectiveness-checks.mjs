// scripts/verify-effectiveness-checks.mjs
//
// Receipt for Wave C3 (2026-06-12): VeritaResponse effectiveness monitoring.
// Replicates the schema + generate/record logic over an in-memory DB:
//
//   1. migration adds the table, idempotent
//   2. generate creates exactly 30/60/90-day checks anchored on completion_date
//   3. generate is idempotent (UNIQUE(finding_id, interval_days))
//   4. generate refuses a finding with no completion_date
//   5. record "effective" stamps the checkpoint
//   6. record "not_effective" on a closed finding reopens it to drafting
//   7. worklist seam query returns only pending checks due within 30 days
//
// Run: node scripts/verify-effectiveness-checks.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE findings (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, finding_number TEXT, accreditor TEXT, standard_ref TEXT, status TEXT, completion_date TEXT, updated_at TEXT);
`);
function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finding_effectiveness_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      finding_id INTEGER NOT NULL, lab_id INTEGER, interval_days INTEGER NOT NULL,
      due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','effective','not_effective')),
      outcome_note TEXT, verified_at TEXT, verified_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(finding_id, interval_days)
    );
  `);
}
migrate(); migrate();
const cols = db.prepare("PRAGMA table_info(finding_effectiveness_checks)").all().map(c => c.name);
check("1. migration adds the table, idempotent", ["finding_id","interval_days","due_date","status","verified_by"].every(c => cols.includes(c)));

const INTERVALS = [30, 60, 90];
function generate(findingId, labId) {
  const f = db.prepare("SELECT * FROM findings WHERE id = ? AND lab_id = ?").get(findingId, labId);
  if (!f) return { status: 404 };
  if (!f.completion_date) return { status: 400, error: "no completion date" };
  let created = 0;
  for (const days of INTERVALS) {
    const d = new Date(f.completion_date);
    d.setUTCDate(d.getUTCDate() + days);
    try {
      const r = db.prepare("INSERT INTO finding_effectiveness_checks (finding_id, lab_id, interval_days, due_date) VALUES (?,?,?,?)")
        .run(findingId, labId, days, d.toISOString().slice(0, 10));
      if (r.changes) created++;
    } catch { /* unique conflict */ }
  }
  return { status: 200, created };
}
function record(findingId, labId, checkId, status) {
  const f = db.prepare("SELECT * FROM findings WHERE id = ? AND lab_id = ?").get(findingId, labId);
  const c = db.prepare("SELECT * FROM finding_effectiveness_checks WHERE id = ? AND finding_id = ?").get(checkId, findingId);
  if (!f || !c) return { status: 404 };
  db.prepare("UPDATE finding_effectiveness_checks SET status = ?, verified_at = '2026-06-12T00:00:00Z', verified_by = 'M. Veri' WHERE id = ?").run(status, checkId);
  let reopened = false;
  if (status === "not_effective" && f.status === "closed") {
    db.prepare("UPDATE findings SET status = 'drafting' WHERE id = ?").run(findingId);
    reopened = true;
  }
  return { status: 200, reopened };
}

// Finding 1: closed CAP finding completed 2026-06-01 in lab 3.
db.prepare("INSERT INTO findings (id, lab_id, finding_number, accreditor, standard_ref, status, completion_date) VALUES (1, 3, 'GEN.20377', 'CAP', 'GEN.20377', 'closed', '2026-06-01')").run();
// Finding 2: open, no completion date.
db.prepare("INSERT INTO findings (id, lab_id, finding_number, accreditor, status, completion_date) VALUES (2, 3, 'D5400', 'CMS', 'open', NULL)").run();

const g1 = generate(1, 3);
check("2a. generate creates 3 checks", g1.status === 200 && g1.created === 3);
const made = db.prepare("SELECT interval_days, due_date FROM finding_effectiveness_checks WHERE finding_id = 1 ORDER BY interval_days").all();
check("2b. intervals are 30/60/90", made.map(m => m.interval_days).join(",") === "30,60,90");
check("2c. 30-day due = completion + 30", made[0].due_date === "2026-07-01");
check("2d. 90-day due = completion + 90", made[2].due_date === "2026-08-30");

const g1b = generate(1, 3);
check("3. generate is idempotent (0 new on second call)", g1b.created === 0 && db.prepare("SELECT COUNT(*) c FROM finding_effectiveness_checks WHERE finding_id = 1").get().c === 3);

check("4. generate refuses finding with no completion_date", generate(2, 3).status === 400);

const first = db.prepare("SELECT id FROM finding_effectiveness_checks WHERE finding_id = 1 AND interval_days = 30").get();
record(1, 3, first.id, "effective");
check("5. record effective stamps the checkpoint",
  db.prepare("SELECT status, verified_by FROM finding_effectiveness_checks WHERE id = ?").get(first.id).status === "effective");

const second = db.prepare("SELECT id FROM finding_effectiveness_checks WHERE finding_id = 1 AND interval_days = 60").get();
const r2 = record(1, 3, second.id, "not_effective");
check("6a. not_effective reopens a closed finding", r2.reopened === true);
check("6b. finding status flipped to drafting", db.prepare("SELECT status FROM findings WHERE id = 1").get().status === "drafting");

// Worklist seam: pending checks due within 30 days of a reference date.
// 30-day check is now 'effective', 60-day is 'not_effective', 90-day pending
// due 2026-08-30 -> outside a +30d window from 2026-06-12, inside from 2026-08-12.
const seamFar = db.prepare("SELECT COUNT(*) c FROM finding_effectiveness_checks WHERE lab_id = 3 AND status = 'pending' AND date(due_date) <= date('2026-06-12','+30 days')").get();
check("7a. no pending checks due within 30 days of 2026-06-12", seamFar.c === 0);
const seamNear = db.prepare("SELECT COUNT(*) c FROM finding_effectiveness_checks WHERE lab_id = 3 AND status = 'pending' AND date(due_date) <= date('2026-08-12','+30 days')").get();
check("7b. the 90-day pending check surfaces within 30 days of 2026-08-12", seamNear.c === 1);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (12/12): Wave C3 effectiveness checkpoint generation, idempotency, reopen-on-failure, and worklist seam verified.");
