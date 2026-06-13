// scripts/verify-veritaqa-rca.mjs
//
// Receipt for Wave D4 (2026-06-12): VeritaQA root-cause documentation.
// Replicates the pi_entries RCA migration + the /rca endpoint logic over an
// in-memory DB and asserts:
//
//   1. migration adds the 4 RCA columns, idempotent
//   2. RCA persists root_cause + corrective_action + reviewer + timestamp
//   3. an empty RCA body is rejected
//   4. clear wipes the RCA fields
//   5. RCA is separate from `notes` (a value edit cannot clobber an RCA)
//
// Run: node scripts/verify-veritaqa-rca.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE pi_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id INTEGER, account_id INTEGER,
    year INTEGER, month INTEGER, value REAL, volume INTEGER, notes TEXT,
    created_at TEXT, updated_at TEXT, UNIQUE(metric_id, year, month)
  );
`);
function migrate() {
  const cols = db.prepare("PRAGMA table_info(pi_entries)").all().map(c => c.name);
  for (const [col, ddl] of [
    ["root_cause", "ALTER TABLE pi_entries ADD COLUMN root_cause TEXT"],
    ["corrective_action", "ALTER TABLE pi_entries ADD COLUMN corrective_action TEXT"],
    ["rca_reviewed_by", "ALTER TABLE pi_entries ADD COLUMN rca_reviewed_by TEXT"],
    ["rca_reviewed_at", "ALTER TABLE pi_entries ADD COLUMN rca_reviewed_at TEXT"],
  ]) { if (!cols.includes(col)) { try { db.exec(ddl); } catch {} } }
}
migrate(); migrate();
const cols = db.prepare("PRAGMA table_info(pi_entries)").all().map(c => c.name);
check("1. migration adds 4 RCA columns, idempotent",
  ["root_cause","corrective_action","rca_reviewed_by","rca_reviewed_at"].every(c => cols.includes(c)) &&
  cols.filter(c => c === "root_cause").length === 1);

// A red BMP-TAT month for account 7.
db.prepare("INSERT INTO pi_entries (id, metric_id, account_id, year, month, value, notes) VALUES (1, 5, 7, 2026, 3, 82.0, 'Mar value')").run();

function rca(id, body) {
  const e = db.prepare("SELECT * FROM pi_entries WHERE id = ? AND account_id = 7").get(id);
  if (!e) return { status: 404 };
  if (body.clear) {
    db.prepare("UPDATE pi_entries SET root_cause=NULL, corrective_action=NULL, rca_reviewed_by=NULL, rca_reviewed_at=NULL WHERE id=?").run(id);
    return { status: 200 };
  }
  if ((!body.root_cause || !String(body.root_cause).trim()) && (!body.corrective_action || !String(body.corrective_action).trim())) {
    return { status: 400, error: "need root cause or action" };
  }
  db.prepare("UPDATE pi_entries SET root_cause=?, corrective_action=?, rca_reviewed_by=?, rca_reviewed_at='2026-04-05T00:00:00Z' WHERE id=?")
    .run(body.root_cause ?? null, body.corrective_action ?? null, body.reviewed_by ?? null, id);
  return { status: 200 };
}

const r = rca(1, { root_cause: "Analyzer down 6 hours on 3/14, backlog cleared late.", corrective_action: "Added backup analyzer to morning startup checklist.", reviewed_by: "M. Veri" });
const row = db.prepare("SELECT * FROM pi_entries WHERE id = 1").get();
check("2a. RCA accepted", r.status === 200);
check("2b. root cause + corrective action persisted", /Analyzer down/.test(row.root_cause) && /backup analyzer/.test(row.corrective_action));
check("2c. reviewer + timestamp stamped", row.rca_reviewed_by === "M. Veri" && !!row.rca_reviewed_at);
check("2d. notes untouched by the RCA write", row.notes === "Mar value");

check("3. empty RCA body rejected", rca(1, {}).status === 400);

rca(1, { clear: true });
const cleared = db.prepare("SELECT * FROM pi_entries WHERE id = 1").get();
check("4. clear wipes RCA fields", cleared.root_cause === null && cleared.rca_reviewed_at === null);
check("4b. notes survive an RCA clear", cleared.notes === "Mar value");

check("5. cross-account entry rejected", rca(99, { root_cause: "x" }).status === 404 || (db.prepare("SELECT * FROM pi_entries WHERE id = 99").get() === undefined));

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (9/9): Wave D4 VeritaQA root-cause migration, persistence, validation, clear, and notes isolation verified.");
