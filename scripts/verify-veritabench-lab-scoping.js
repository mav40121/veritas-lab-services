// Verify Phase 1 of the operations leverage chain: lab-scope productivity_months
// and staffing_studies. Exercised against an in-memory SQLite DB that mirrors the
// pre-migration schema, this proves:
//   1. The productivity_months rebuild preserves every row and adds lab_id.
//   2. The table-level UNIQUE(account_id, year, month) is replaced by two PARTIAL
//      unique indexes: legacy null-lab rows stay unique on (account, year, month);
//      lab-tagged rows are unique on (account, lab_id, year, month) so two labs can
//      hold the same month.
//   3. The claim-or-insert upsert: a single-lab owner's legacy null row is claimed
//      (no duplicate) on first lab-scoped save; two labs coexist for one month.
//   4. Read scoping: each lab sees its own rows plus legacy null rows, with an
//      account-only fallback when no lab context is passed.
//   5. staffing_studies additive lab_id ALTER + scoped read.
//
// Run: node scripts/verify-veritabench-lab-scoping.js

import Database from "better-sqlite3";

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const db = new Database(":memory:");

// --- 1. Pre-migration productivity_months schema (table-level UNIQUE) + seed ---
db.exec(`
  CREATE TABLE productivity_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    billable_tests INTEGER,
    productive_hours REAL,
    non_productive_hours REAL,
    overtime_hours REAL,
    total_ftes REAL,
    facility_type TEXT DEFAULT 'community',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(account_id, year, month)
  )
`);
const ins = db.prepare(
  "INSERT INTO productivity_months (account_id, year, month, billable_tests, productive_hours) VALUES (?,?,?,?,?)"
);
ins.run(17, 2026, 1, 100000, 13000); // owner 17, Jan (legacy)
ins.run(17, 2026, 2, 110000, 14000); // owner 17, Feb (legacy)
ins.run(22, 2026, 1, 50000, 6000);   // owner 22, Jan (legacy)

const beforeCount = db.prepare("SELECT COUNT(*) n FROM productivity_months").get().n;

let oldBlocked = false;
try { db.prepare("INSERT INTO productivity_months (account_id, year, month) VALUES (17, 2026, 1)").run(); }
catch { oldBlocked = true; }
check("old schema blocks same (account,year,month) twice", oldBlocked);

// --- 2. Run the migration (mirrors server/db.ts) ---
db.exec("BEGIN");
db.exec(`CREATE TABLE productivity_months_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, lab_id INTEGER,
  year INTEGER NOT NULL, month INTEGER NOT NULL, billable_tests INTEGER, productive_hours REAL,
  non_productive_hours REAL, overtime_hours REAL, total_ftes REAL, facility_type TEXT DEFAULT 'community',
  notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')) )`);
db.exec(`INSERT INTO productivity_months_new
  (id, account_id, lab_id, year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes, created_at, updated_at)
  SELECT id, account_id, NULL, year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes, created_at, updated_at
  FROM productivity_months`);
db.exec("DROP TABLE productivity_months");
db.exec("ALTER TABLE productivity_months_new RENAME TO productivity_months");
db.exec("CREATE UNIQUE INDEX uq_productivity_months_legacy ON productivity_months(account_id, year, month) WHERE lab_id IS NULL");
db.exec("CREATE UNIQUE INDEX uq_productivity_months_lab ON productivity_months(account_id, lab_id, year, month) WHERE lab_id IS NOT NULL");
db.exec("COMMIT");

const afterCount = db.prepare("SELECT COUNT(*) n FROM productivity_months").get().n;
check("rebuild preserves all rows", beforeCount === 3 && afterCount === 3);
const cols = db.prepare("PRAGMA table_info(productivity_months)").all().map((c) => c.name);
check("lab_id column added", cols.includes("lab_id"));
check("existing rows carry null lab_id", db.prepare("SELECT COUNT(*) n FROM productivity_months WHERE lab_id IS NULL").get().n === 3);

// --- 3. Partial unique indexes ---
let legacyDupBlocked = false;
try { db.prepare("INSERT INTO productivity_months (account_id, lab_id, year, month) VALUES (17, NULL, 2026, 1)").run(); }
catch { legacyDupBlocked = true; }
check("legacy null-lab duplicate still blocked", legacyDupBlocked);

db.prepare("INSERT INTO productivity_months (account_id, lab_id, year, month, billable_tests) VALUES (17, 10, 2026, 5, 9000)").run();
db.prepare("INSERT INTO productivity_months (account_id, lab_id, year, month, billable_tests) VALUES (17, 11, 2026, 5, 4000)").run();
check("two labs hold same (account,year,month)",
  db.prepare("SELECT COUNT(*) n FROM productivity_months WHERE account_id=17 AND year=2026 AND month=5").get().n === 2);

let labDupBlocked = false;
try { db.prepare("INSERT INTO productivity_months (account_id, lab_id, year, month) VALUES (17, 10, 2026, 5)").run(); }
catch { labDupBlocked = true; }
check("same lab duplicate month blocked", labDupBlocked);

// --- 4. claim-or-insert upsert (mirrors server/veritabench.ts) ---
function upsert(accountId, labId, year, month, billable) {
  let target = labId != null
    ? db.prepare("SELECT id FROM productivity_months WHERE account_id=? AND lab_id=? AND year=? AND month=?").get(accountId, labId, year, month)
    : db.prepare("SELECT id FROM productivity_months WHERE account_id=? AND lab_id IS NULL AND year=? AND month=?").get(accountId, year, month);
  if (!target && labId != null)
    target = db.prepare("SELECT id FROM productivity_months WHERE account_id=? AND lab_id IS NULL AND year=? AND month=?").get(accountId, year, month);
  if (target) db.prepare("UPDATE productivity_months SET lab_id=?, billable_tests=? WHERE id=?").run(labId, billable, target.id);
  else db.prepare("INSERT INTO productivity_months (account_id, lab_id, year, month, billable_tests) VALUES (?,?,?,?,?)").run(accountId, labId, year, month, billable);
}

// Owner 22 re-saves their legacy Jan row under lab 99 -> claims it, no duplicate.
upsert(22, 99, 2026, 1, 55000);
const acct22Jan = db.prepare("SELECT * FROM productivity_months WHERE account_id=22 AND year=2026 AND month=1").all();
check("legacy row claimed (no duplicate) on first lab-scoped save",
  acct22Jan.length === 1 && acct22Jan[0].lab_id === 99 && acct22Jan[0].billable_tests === 55000);

// Re-saving the same lab/month updates in place (still one row).
upsert(17, 10, 2026, 5, 9500);
check("re-save same lab/month updates in place",
  db.prepare("SELECT COUNT(*) n FROM productivity_months WHERE account_id=17 AND lab_id=10 AND year=2026 AND month=5").get().n === 1 &&
  db.prepare("SELECT billable_tests b FROM productivity_months WHERE account_id=17 AND lab_id=10 AND year=2026 AND month=5").get().b === 9500);

// --- 5. Read scoping ---
function readScoped(accountId, labId) {
  return labId != null
    ? db.prepare("SELECT * FROM productivity_months WHERE account_id=? AND (lab_id=? OR lab_id IS NULL) ORDER BY year, month").all(accountId, labId)
    : db.prepare("SELECT * FROM productivity_months WHERE account_id=? ORDER BY year, month").all(accountId);
}
const lab10 = readScoped(17, 10);
const lab11 = readScoped(17, 11);
check("lab 10 sees its own + legacy, not lab 11's", lab10.some((r) => r.lab_id === 10) && !lab10.some((r) => r.lab_id === 11));
check("lab 11 sees its own + legacy, not lab 10's", lab11.some((r) => r.lab_id === 11) && !lab11.some((r) => r.lab_id === 10));
check("legacy null rows visible under any lab", lab10.filter((r) => r.lab_id === null).length === 2);
check("account-only fallback (no labId) sees all account rows",
  readScoped(17, null).length === db.prepare("SELECT COUNT(*) n FROM productivity_months WHERE account_id=17").get().n);

// --- 6. staffing_studies additive lab_id + scoped read ---
db.exec(`CREATE TABLE staffing_studies (
  id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, name TEXT, department TEXT DEFAULT 'Core Lab',
  start_date TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')) )`);
db.prepare("INSERT INTO staffing_studies (account_id, name) VALUES (17, 'Legacy Core Lab Study')").run(); // null lab_id
db.exec("ALTER TABLE staffing_studies ADD COLUMN lab_id INTEGER");
const ssCols = db.prepare("PRAGMA table_info(staffing_studies)").all().map((c) => c.name);
check("staffing_studies lab_id column added", ssCols.includes("lab_id"));
db.prepare("INSERT INTO staffing_studies (account_id, lab_id, name) VALUES (17, 10, 'UMiami Main Q1')").run();
db.prepare("INSERT INTO staffing_studies (account_id, lab_id, name) VALUES (17, 11, 'UMiami Off-site Q1')").run();
const ssLab10 = db.prepare("SELECT * FROM staffing_studies WHERE account_id=? AND (lab_id=? OR lab_id IS NULL)").all(17, 10);
check("staffing lab 10 sees its own + legacy, not lab 11's",
  ssLab10.some((r) => r.lab_id === 10) && ssLab10.some((r) => r.lab_id === null) && !ssLab10.some((r) => r.lab_id === 11));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
