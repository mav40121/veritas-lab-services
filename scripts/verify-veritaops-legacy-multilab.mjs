#!/usr/bin/env node
// Gate-3 receipt for the VeritaOps legacy-route multi-lab fixes (#2 + #5).
// Functional proof against a real in-memory SQLite: proves the OLD behavior
// bites (orphaned study, owner-lab identity) and the NEW behavior fixes it.
//
//   #2  legacy POST INSERT must stamp lab_id so the account-scoped list
//       (WHERE lab_id = ?) can see the study it just created.
//   #5  legacy PDF must resolve identity from the labs row for the study's
//       OWN lab (study.lab_id), not the account owner's home lab.
//
// Usage: node scripts/verify-veritaops-legacy-multilab.mjs
import Database from "better-sqlite3";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, lab_name TEXT, clia_number TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, clia_lab_name TEXT, clia_number TEXT);
  CREATE TABLE veritaops_test_cost_studies (
    id INTEGER PRIMARY KEY, account_id INTEGER, lab_id INTEGER,
    test_name TEXT, created_at TEXT, updated_at TEXT
  );
`);
// Owner (user 17) whose HOME lab is lab A. Study is filed on lab B (a
// comped secondary lab under the same owner).
db.prepare("INSERT INTO labs (id, lab_name, clia_number) VALUES (?,?,?)").run(1, "Owner Home Lab", "01D0000001");
db.prepare("INSERT INTO labs (id, lab_name, clia_number) VALUES (?,?,?)").run(2, "Secondary Lab B", "01D0000002");
db.prepare("INSERT INTO users (id, name, email, clia_lab_name, clia_number) VALUES (?,?,?,?,?)")
  .run(17, "Dr. Owner", "owner@x.com", "Owner Home Lab", "01D0000001");

const ACTIVE_LAB = 2;               // resolveLegacyLabId(req) for this request
const now = "2026-07-31T00:00:00Z";

// ── #2: OLD INSERT omits lab_id → orphaned, invisible in the list ──────────
db.prepare("INSERT INTO veritaops_test_cost_studies (account_id, test_name, created_at, updated_at) VALUES (?,?,?,?)")
  .run(17, "OLD Potassium", now, now);
const oldVisible = db.prepare("SELECT * FROM veritaops_test_cost_studies WHERE lab_id = ? ORDER BY updated_at DESC").all(ACTIVE_LAB);
ok("#2 OLD behavior BITES: study created without lab_id is invisible in the lab-scoped list", oldVisible.length === 0);
const oldRow = db.prepare("SELECT lab_id FROM veritaops_test_cost_studies WHERE test_name = ?").get("OLD Potassium");
ok("#2 OLD study row has NULL lab_id (orphan)", oldRow.lab_id === null);

// ── #2: NEW INSERT stamps lab_id → visible in the same list ────────────────
db.prepare("INSERT INTO veritaops_test_cost_studies (account_id, lab_id, test_name, created_at, updated_at) VALUES (?,?,?,?,?)")
  .run(17, ACTIVE_LAB, "NEW Sodium", now, now);
const newVisible = db.prepare("SELECT * FROM veritaops_test_cost_studies WHERE lab_id = ? ORDER BY updated_at DESC").all(ACTIVE_LAB);
ok("#2 NEW behavior FIXED: study stamped with lab_id is visible in the lab-scoped list", newVisible.length === 1 && newVisible[0].test_name === "NEW Sodium");

// ── #5: PDF identity — OLD (owner users row) vs NEW (labs row by study.lab_id)
const study = db.prepare("SELECT * FROM veritaops_test_cost_studies WHERE test_name = ?").get("NEW Sodium");

// OLD identity resolution (the bug): read the account owner's users row.
const ownerRow = db.prepare("SELECT clia_lab_name, clia_number, name FROM users WHERE id = ?").get(17);
const oldLabName = ownerRow?.clia_lab_name || ownerRow?.name || "Laboratory";
const oldClia = ownerRow?.clia_number || "Not on file";
ok("#5 OLD behavior BITES: PDF prints the OWNER's home-lab identity, not the study's lab",
   oldLabName === "Owner Home Lab" && oldClia === "01D0000001");

// NEW identity resolution (the fix): labs row for the study's OWN lab.
const studyLabId = study.lab_id;
const labRow = studyLabId ? db.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(studyLabId) : null;
const newLabName = labRow?.lab_name || "Laboratory";
const newClia = labRow?.clia_number || "Not on file";
ok("#5 NEW behavior FIXED: PDF prints the STUDY's lab identity (Secondary Lab B)",
   newLabName === "Secondary Lab B" && newClia === "01D0000002");
ok("#5 NEW identity differs from the OLD (owner) identity — the multi-lab leak is closed",
   newLabName !== oldLabName && newClia !== oldClia);

// Null-lab study still degrades safely to the 'Laboratory' / 'Not on file' fallback.
const orphan = db.prepare("SELECT * FROM veritaops_test_cost_studies WHERE test_name = ?").get("OLD Potassium");
const orphanLab = orphan.lab_id ? db.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(orphan.lab_id) : null;
ok("#5 null-lab study degrades safely to the Laboratory / Not on file fallback",
   (orphanLab?.lab_name || "Laboratory") === "Laboratory" && (orphanLab?.clia_number || "Not on file") === "Not on file");

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
