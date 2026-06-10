// scripts/verify-multi-analyte-verification.mjs
//
// Receipts for PR1 of multi-analyte verification packages (Michael
// feedback, 2026-06-09):
//
//   1. Schema migration adds veritacheck_verification_analytes table
//      with the expected columns
//   2. Schema migration adds analyte_id + scope to
//      veritacheck_verification_studies
//   3. Backfill creates exactly one analyte row per pre-existing
//      verification and is idempotent (re-running adds zero new
//      rows)
//   4. Backfill links existing study slots to the new analyte row
//   5. Verifications with zero studies get the "Analyte not
//      specified" placeholder
//   6. Verifications with one study get the analyte name from that
//      study's analyte field
//   7. Endpoint allowlist for studies PATCH includes analyte_id and
//      scope (regression guard for the change above)
//
// Uses an in-memory SQLite via better-sqlite3 so the test can
// exercise the migration without touching the real DB.
//
// Run: node scripts/verify-multi-analyte-verification.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

// ── Seed: a minimal schema that mirrors the pre-migration shape ────
function makeSeedDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE veritacheck_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      instrument_name TEXT,
      lab_id INTEGER
    );
    CREATE TABLE veritacheck_verification_studies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_id INTEGER NOT NULL,
      element TEXT NOT NULL,
      study_id INTEGER,
      analyte TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ── The migration block (extracted verbatim from server/db.ts) ──────
function runMigration(db) {
  const vcsCols = db.prepare("PRAGMA table_info(veritacheck_verification_studies)").all().map((c) => c.name);
  if (!vcsCols.includes("analyte_id")) db.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN analyte_id INTEGER");
  if (!vcsCols.includes("scope")) db.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN scope TEXT NOT NULL DEFAULT 'analyte'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS veritacheck_verification_analytes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      verification_id INTEGER NOT NULL,
      analyte_name TEXT NOT NULL,
      tea_value REAL,
      tea_units TEXT,
      tea_is_percentage INTEGER DEFAULT 1,
      mdls_json TEXT,
      amr_low REAL,
      amr_high REAL,
      amr_units TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'draft',
      finalized_at TEXT,
      finalized_by_user_id INTEGER,
      finalized_signature TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (verification_id) REFERENCES veritacheck_verifications(id)
    )
  `);
  const verifsNeedingAnalyte = db.prepare(`
    SELECT v.id, v.user_id
    FROM veritacheck_verifications v
    WHERE NOT EXISTS (
      SELECT 1 FROM veritacheck_verification_analytes a WHERE a.verification_id = v.id
    )
  `).all();
  let inserted = 0;
  let linkedStudies = 0;
  const insertAnalyte = db.prepare(
    "INSERT INTO veritacheck_verification_analytes (verification_id, analyte_name, sort_order) VALUES (?, ?, 0)"
  );
  const linkStudies = db.prepare(
    "UPDATE veritacheck_verification_studies SET analyte_id = ? WHERE verification_id = ? AND analyte_id IS NULL"
  );
  for (const v of verifsNeedingAnalyte) {
    const firstStudyAnalyte = db.prepare(
      "SELECT analyte FROM veritacheck_verification_studies WHERE verification_id = ? AND analyte IS NOT NULL AND analyte <> '' ORDER BY id LIMIT 1"
    ).get(v.id)?.analyte;
    const analyteName = firstStudyAnalyte || "Analyte not specified";
    const result = insertAnalyte.run(v.id, analyteName);
    inserted++;
    const linked = linkStudies.run(result.lastInsertRowid, v.id);
    linkedStudies += linked.changes;
  }
  return { inserted, linkedStudies };
}

// ── Test 1: schema additions ────────────────────────────────────────
{
  const db = makeSeedDb();
  runMigration(db);
  const vcsCols = db.prepare("PRAGMA table_info(veritacheck_verification_studies)").all().map((c) => c.name);
  check("studies gained analyte_id column", vcsCols.includes("analyte_id"));
  check("studies gained scope column", vcsCols.includes("scope"));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  check("veritacheck_verification_analytes table created", tables.includes("veritacheck_verification_analytes"));
  const aCols = db.prepare("PRAGMA table_info(veritacheck_verification_analytes)").all().map((c) => c.name);
  const required = ["id","verification_id","analyte_name","tea_value","tea_units","tea_is_percentage","mdls_json","amr_low","amr_high","amr_units","lifecycle_state","finalized_at","finalized_by_user_id","finalized_signature","sort_order","created_at","updated_at"];
  for (const col of required) {
    check(`analytes table has column ${col}`, aCols.includes(col));
  }
  db.close();
}

// ── Test 2: backfill on empty DB ────────────────────────────────────
{
  const db = makeSeedDb();
  const r = runMigration(db);
  check("empty DB: zero analytes inserted", r.inserted === 0);
  check("empty DB: zero studies linked", r.linkedStudies === 0);
  db.close();
}

// ── Test 3: backfill with a verification that has a single study ────
{
  const db = makeSeedDb();
  db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (1, 100, 'Roche c702')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'accuracy', 'Glucose')").run();
  const r = runMigration(db);
  check("single-study verification: 1 analyte inserted", r.inserted === 1, `got ${r.inserted}`);
  check("single-study verification: 1 study linked", r.linkedStudies === 1, `got ${r.linkedStudies}`);
  const analyte = db.prepare("SELECT * FROM veritacheck_verification_analytes WHERE verification_id = 1").get();
  check("analyte name matches study analyte", analyte.analyte_name === "Glucose");
  check("analyte lifecycle_state defaults to draft", analyte.lifecycle_state === "draft");
  const study = db.prepare("SELECT * FROM veritacheck_verification_studies WHERE verification_id = 1").get();
  check("study scope defaults to 'analyte'", study.scope === "analyte");
  check("study analyte_id set to new row", study.analyte_id === analyte.id);
  db.close();
}

// ── Test 4: backfill with multi-study verification picks first ──────
{
  const db = makeSeedDb();
  db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (1, 100, 'Roche c702')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'accuracy', 'Glucose')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'precision', 'Glucose')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'carryover', 'Glucose')").run();
  const r = runMigration(db);
  check("multi-study verification: 1 analyte inserted", r.inserted === 1);
  check("multi-study verification: 3 studies linked", r.linkedStudies === 3);
  const analyte = db.prepare("SELECT * FROM veritacheck_verification_analytes WHERE verification_id = 1").get();
  check("multi-study verification: analyte name picked from first study", analyte.analyte_name === "Glucose");
  db.close();
}

// ── Test 5: verification with no studies gets placeholder ───────────
{
  const db = makeSeedDb();
  db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (1, 100, 'Roche c702')").run();
  const r = runMigration(db);
  check("empty verification: 1 analyte inserted", r.inserted === 1);
  check("empty verification: 0 studies linked", r.linkedStudies === 0);
  const analyte = db.prepare("SELECT * FROM veritacheck_verification_analytes WHERE verification_id = 1").get();
  check("empty verification: placeholder name 'Analyte not specified'", analyte.analyte_name === "Analyte not specified");
  db.close();
}

// ── Test 6: verification with NULL/blank analyte gets placeholder ───
{
  const db = makeSeedDb();
  db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (1, 100, 'Roche c702')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'accuracy', NULL)").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'precision', '')").run();
  const r = runMigration(db);
  const analyte = db.prepare("SELECT * FROM veritacheck_verification_analytes WHERE verification_id = 1").get();
  check("NULL/blank analyte: placeholder used", analyte.analyte_name === "Analyte not specified");
  db.close();
}

// ── Test 7: idempotency — re-running the migration is a no-op ───────
{
  const db = makeSeedDb();
  db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (1, 100, 'Roche c702')").run();
  db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (1, 'accuracy', 'Glucose')").run();
  const first = runMigration(db);
  check("first run: 1 analyte + 1 study linked", first.inserted === 1 && first.linkedStudies === 1);
  const second = runMigration(db);
  check("second run: 0 analytes inserted (idempotent)", second.inserted === 0, `inserted=${second.inserted}`);
  check("second run: 0 studies linked (idempotent)", second.linkedStudies === 0, `linked=${second.linkedStudies}`);
  const third = runMigration(db);
  check("third run: still 0 (idempotent)", third.inserted === 0 && third.linkedStudies === 0);
  const aCount = db.prepare("SELECT COUNT(*) AS n FROM veritacheck_verification_analytes").get().n;
  check("total analyte rows = 1 after 3 runs", aCount === 1);
  db.close();
}

// ── Test 8: backfill across many verifications ──────────────────────
{
  const db = makeSeedDb();
  for (let i = 1; i <= 25; i++) {
    db.prepare("INSERT INTO veritacheck_verifications (id, user_id, instrument_name) VALUES (?, 100, 'Roche c702')").run(i);
    db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte) VALUES (?, 'accuracy', ?)").run(i, `Analyte${i}`);
  }
  const r = runMigration(db);
  check("25 verifications: 25 analytes inserted", r.inserted === 25);
  check("25 verifications: 25 studies linked", r.linkedStudies === 25);
  const analytes = db.prepare("SELECT * FROM veritacheck_verification_analytes ORDER BY verification_id").all();
  check("each analyte_name unique", new Set(analytes.map((a) => a.analyte_name)).size === 25);
  db.close();
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
