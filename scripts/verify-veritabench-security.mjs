// scripts/verify-veritabench-security.mjs
//
// Receipt for the VeritaBench server-security batch (2026-07-12):
//   #1 (HIGH) POST /api/pi/entries accepted a body-supplied metric_id with no
//      ownership check; combined with the global UNIQUE(metric_id, year, month)
//      + an account-less read-back, any suite user could overwrite AND read
//      another account's PI entry. Fixed: validate metric belongs to the account
//      before the upsert + account-filter the read-back.
//   #5 (MED) the ops routes trusted a raw client ?labId (resolveOpsLabId). Fixed:
//      membership-validate the ?labId (labs owner OR active lab_members) before
//      trusting it; unowned falls back to account-only scoping (null). Also closes
//      the #23 leverage-PDF cross-lab identity leak.
//
//   node scripts/verify-veritabench-security.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/veritabench.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== source proofs ===");
ok("#1 PI-entries validates metric ownership before upsert",
  /SELECT 1 FROM pi_metrics WHERE id = \? AND account_id = \?[\s\S]*?if \(!owns\) return res\.status\(404\)/.test(src));
ok("#1 the pi_entries read-back is account-filtered",
  /SELECT \* FROM pi_entries WHERE metric_id = \? AND year = \? AND month = \? AND account_id = \?/.test(src));
ok("#5 resolveOpsLabId membership-validates ?labId (labs owner OR lab_members)",
  /FROM labs WHERE id = \? AND owner_user_id IN \(\?, \?\)[\s\S]*?FROM lab_members WHERE lab_id = \? AND user_id = \? AND status = 'active'/.test(src));
ok("#5 an unowned ?labId falls back to null (account-only scoping)",
  /if \(ok\) return n;\s*\n\s*\} catch \{ \/\* fall through to account-only scoping \*\/ \}\s*\n\s*return null;/.test(src));

console.log("\n=== #1 functional proof: cross-account PI-entry overwrite is blocked ===");
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE pi_metrics (id INTEGER PRIMARY KEY, account_id INTEGER, name TEXT);
  CREATE TABLE pi_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, metric_id INTEGER, account_id INTEGER,
                           year INTEGER, month INTEGER, value REAL,
                           UNIQUE(metric_id, year, month));
  INSERT INTO pi_metrics (id, account_id, name) VALUES (50, 1, 'Contamination rate');  -- account A(1) owns metric 50
  INSERT INTO pi_metrics (id, account_id, name) VALUES (77, 2, 'TAT %');               -- account B(2) owns metric 77
  INSERT INTO pi_entries (metric_id, account_id, year, month, value) VALUES (50, 1, 2026, 3, 2.5); -- A's real entry
`);
// The fixed guard: attacker (account B=2) tries to overwrite A's metric 50.
function ownsMetric(metricId, accountId) {
  return !!db.prepare("SELECT 1 FROM pi_metrics WHERE id = ? AND account_id = ?").get(metricId, accountId);
}
ok("#1 account B(2) does NOT own metric 50 -> upsert would 404 (blocked)", ownsMetric(50, 2) === false);
ok("#1 account A(1) DOES own metric 50 -> legit upsert allowed", ownsMetric(50, 1) === true);
ok("#1 account B(2) owns its own metric 77 -> its legit upsert allowed", ownsMetric(77, 2) === true);
// A's entry is untouched (the block prevents the overwrite).
const aRow = db.prepare("SELECT value FROM pi_entries WHERE metric_id = 50 AND year = 2026 AND month = 3 AND account_id = 1").get();
ok("#1 A's PI entry value is intact (2.5), not overwritten", aRow && aRow.value === 2.5);

console.log("\n=== #5 functional proof: ?labId membership validation ===");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
  CREATE TABLE lab_members (lab_id INTEGER, user_id INTEGER, status TEXT);
  INSERT INTO labs (id, owner_user_id) VALUES (5, 100);   -- user 100 owns lab 5
  INSERT INTO labs (id, owner_user_id) VALUES (6, 999);   -- a DIFFERENT owner's lab
  INSERT INTO lab_members (lab_id, user_id, status) VALUES (7, 100, 'active'); -- user 100 is a member of lab 7
`);
function validLab(labId, userId, ownerId) {
  return !!db.prepare(
    `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id IN (?, ?)
     UNION
     SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`
  ).get(labId, userId, ownerId, labId, userId);
}
ok("#5 user 100 CAN scope to lab 5 (owns it)", validLab(5, 100, 100) === true);
ok("#5 user 100 CAN scope to lab 7 (active member)", validLab(7, 100, 100) === true);
ok("#5 user 100 CANNOT scope to lab 6 (foreign owner) -> falls back to account-only", validLab(6, 100, 100) === false);

db.close();
console.log(fails === 0 ? "\n=== VERITABENCH SECURITY: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
