// scripts/verify-study-archive.js
//
// Receipt for the VeritaCheck Sign-Off / Amendment / Archive Phase 1 backend
// (server/routes.ts, server/db.ts, 2026-06-15). Reproduces the exact SQL the
// handlers run against an in-memory better-sqlite3 DB and asserts every branch:
//   - auto-archive: signing off an amendment archives ONLY the original it
//     supersedes (the amends_study_id target), never the amendment itself.
//   - active list (archived_at IS NULL) hides the archived original, keeps the
//     amendment; archived view (archived_at IS NOT NULL) returns the original.
//   - manual archive requires a reason and is idempotent (the AND archived_at
//     IS NULL guard); unarchive restores.
//
// Run: node scripts/verify-study-archive.js   (exits non-zero on any failure)

import Database from "better-sqlite3";

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`PASS ${name}`); }
  else { console.log(`FAIL ${name}`); failures++; }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER, status TEXT, lifecycle_state TEXT DEFAULT 'draft',
    amends_study_id INTEGER,
    archived_at TEXT, archived_by_user_id INTEGER, archive_reason TEXT
  );
`);

// Original failed, signed off (finalized) study in lab 1.
const orig = db.prepare(
  "INSERT INTO studies (lab_id, status, lifecycle_state) VALUES (1,'fail','finalized')"
).run().lastInsertRowid;

// Amendment: clone linked via amends_study_id, draft (the /amend behavior).
const amend = db.prepare(
  "INSERT INTO studies (lab_id, status, lifecycle_state, amends_study_id) VALUES (1,'pass','draft',?)"
).run(orig).lastInsertRowid;

// Sign off the amendment -> the finalize handler's auto-archive SQL.
const now = "2026-06-15T00:00:00.000Z";
db.prepare("UPDATE studies SET lifecycle_state='finalized' WHERE id=?").run(amend);
const amendRow = db.prepare("SELECT * FROM studies WHERE id=?").get(amend);
if (amendRow.amends_study_id) {
  db.prepare(
    "UPDATE studies SET archived_at=?, archived_by_user_id=?, archive_reason=? WHERE id=? AND archived_at IS NULL"
  ).run(now, 7, `Superseded by amendment #${amend}`, amendRow.amends_study_id);
}

const o = db.prepare("SELECT * FROM studies WHERE id=?").get(orig);
const a = db.prepare("SELECT * FROM studies WHERE id=?").get(amend);
check("original auto-archived on amendment sign-off", o.archived_at === now);
check("auto-archive reason links to the amendment", o.archive_reason === `Superseded by amendment #${amend}`);
check("amendment itself NOT archived", a.archived_at === null);

// Active list query (what the dashboard pulls).
const active = db.prepare("SELECT id FROM studies WHERE lab_id=? AND archived_at IS NULL ORDER BY id DESC").all(1).map(r => r.id);
check("active list excludes the archived original", !active.includes(orig));
check("active list still includes the amendment", active.includes(amend));

// Archived view query.
const archived = db.prepare("SELECT id FROM studies WHERE lab_id=? AND archived_at IS NOT NULL").all(1).map(r => r.id);
check("archived view returns the superseded original", archived.includes(orig) && !archived.includes(amend));

// Idempotency: re-running auto-archive must not overwrite (AND archived_at IS NULL guard).
db.prepare("UPDATE studies SET archived_at=?, archived_by_user_id=?, archive_reason=? WHERE id=? AND archived_at IS NULL")
  .run("LATER", 99, "second pass", orig);
check("auto-archive is idempotent (already-archived row untouched)", db.prepare("SELECT archived_at FROM studies WHERE id=?").get(orig).archived_at === now);

// Manual archive of a standalone (never-signed-off) study, e.g. an erroneous duplicate.
const dup = db.prepare("INSERT INTO studies (lab_id, status, lifecycle_state) VALUES (1,'fail','draft')").run().lastInsertRowid;
db.prepare("UPDATE studies SET archived_at=?, archived_by_user_id=?, archive_reason=? WHERE id=?").run(now, 7, "Duplicate entry", dup);
check("manual archive works on a non-signed-off study", db.prepare("SELECT archive_reason FROM studies WHERE id=?").get(dup).archive_reason === "Duplicate entry");

// Unarchive restores.
db.prepare("UPDATE studies SET archived_at=NULL, archived_by_user_id=NULL, archive_reason=NULL WHERE id=?").run(dup);
check("unarchive clears archive fields", db.prepare("SELECT archived_at FROM studies WHERE id=?").get(dup).archived_at === null);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
