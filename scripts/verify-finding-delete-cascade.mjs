// scripts/verify-finding-delete-cascade.mjs
//
// Receipt for the finding-delete cascade fix (2026-06-13, found in browser QA).
// Wave C3 added finding_effectiveness_checks with FK finding_id -> findings(id).
// The DELETE /api/labs/:labId/findings/:id handler did not clear that table, so
// deleting any finding that had 30/60/90-day checkpoints hit the FK and 500'd.
// This replicates the delete order with FK enforcement ON and asserts the
// finding deletes cleanly once the checkpoints are cleared first.
//
// Run: node scripts/verify-finding-delete-cascade.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE findings (id INTEGER PRIMARY KEY, lab_id INTEGER);
  CREATE TABLE finding_attachments (id INTEGER PRIMARY KEY, finding_id INTEGER);
  CREATE TABLE finding_history (id INTEGER PRIMARY KEY, finding_id INTEGER);
  CREATE TABLE finding_extension_requests (id INTEGER PRIMARY KEY, finding_id INTEGER);
  CREATE TABLE finding_reminder_log (id INTEGER PRIMARY KEY, finding_id INTEGER, FOREIGN KEY (finding_id) REFERENCES findings(id));
  CREATE TABLE finding_effectiveness_checks (
    id INTEGER PRIMARY KEY, finding_id INTEGER NOT NULL, interval_days INTEGER,
    FOREIGN KEY (finding_id) REFERENCES findings(id)
  );
`);
db.prepare("INSERT INTO findings (id, lab_id) VALUES (1, 3)").run();
db.prepare("INSERT INTO finding_history (id, finding_id) VALUES (1, 1)").run();
for (const d of [30, 60, 90]) db.prepare("INSERT INTO finding_effectiveness_checks (finding_id, interval_days) VALUES (1, ?)").run(d);

// OLD order (the bug): clear the other child tables but NOT effectiveness_checks.
function deleteOld(id) {
  db.prepare("DELETE FROM finding_attachments WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_history WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_extension_requests WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_reminder_log WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM findings WHERE id = ?").run(id); // FK violation here
}
let oldThrew = false;
try { deleteOld(1); } catch (e) { oldThrew = /FOREIGN KEY/i.test(e.message); }
check("1. old delete order throws an FK constraint error (reproduces the 500)", oldThrew);
check("1a. finding still present after the failed delete", db.prepare("SELECT COUNT(*) c FROM findings WHERE id=1").get().c === 1);

// NEW order (the fix): clear effectiveness_checks before deleting the finding.
function deleteNew(id) {
  db.prepare("DELETE FROM finding_attachments WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_history WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_extension_requests WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_reminder_log WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM finding_effectiveness_checks WHERE finding_id = ?").run(id);
  db.prepare("DELETE FROM findings WHERE id = ?").run(id);
}
let newThrew = false;
try { deleteNew(1); } catch { newThrew = true; }
check("2. new delete order succeeds (no throw)", !newThrew);
check("2a. finding deleted", db.prepare("SELECT COUNT(*) c FROM findings WHERE id=1").get().c === 0);
check("2b. effectiveness checks cleared", db.prepare("SELECT COUNT(*) c FROM finding_effectiveness_checks WHERE finding_id=1").get().c === 0);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (5/5): finding-delete now clears finding_effectiveness_checks before removing the finding (FK 500 fixed).");
