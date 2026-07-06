// scripts/verify-comp-audit-log-query.mjs
//
// Regression receipt for the 2026-07-06 hotfix of the VeritaComp assessment
// audit-log endpoint (Sentry: SqliteError "no such column: u.lab_name", GET
// /api/labs/2/competency/assessments/167/audit-log). The query selected
// u.lab_name from the users table, but lab_name lives on labs, not users, so
// every Audit-dialog open 500'd. Fix: select u.name AS actor_name instead.
//
// This builds a minimal in-memory DB with the same shape and asserts the OLD
// query throws and the NEW query returns the row with actor_email + actor_name.
//
// Run: node scripts/verify-comp-audit-log-query.mjs

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY, user_id INTEGER, module TEXT, action TEXT,
    entity_type TEXT, entity_id TEXT, entity_label TEXT,
    before_json TEXT, after_json TEXT, ip_address TEXT, created_at TEXT
  );
  INSERT INTO users (id, email, name) VALUES (1, 'bobbi.persinger@scahealth.org', 'Bobbi Felton');
  INSERT INTO audit_log (user_id, module, action, entity_type, entity_id, entity_label, created_at)
    VALUES (1, 'veritacomp', 'sign', 'assessment', '167', 'Sign and Complete', '2026-07-06 18:11:52');
`);

const OLD = "SELECT al.id, u.email AS actor_email, u.lab_name AS actor_lab FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.module='veritacomp' AND al.entity_type='assessment' AND al.entity_id=? ORDER BY al.created_at DESC LIMIT 100";
const NEW = "SELECT al.id, al.action, al.entity_label, al.created_at, u.email AS actor_email, u.name AS actor_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE al.module='veritacomp' AND al.entity_type='assessment' AND al.entity_id=? ORDER BY al.created_at DESC, al.id DESC LIMIT 100";

let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`); ok ? pass++ : fail++; };

// 1. The old query reproduces the production error.
let oldThrew = false, oldErr = "";
try { db.prepare(OLD).all("167"); } catch (e) { oldThrew = true; oldErr = String(e.message); }
check("old query throws 'no such column: u.lab_name'", oldThrew && /no such column: u\.lab_name/.test(oldErr), `(err: ${oldErr})`);

// 2. The fixed query runs and returns the row with valid actor fields.
let rows = [];
let newThrew = false;
try { rows = db.prepare(NEW).all("167"); } catch (e) { newThrew = true; console.log("  new query error:", e.message); }
check("fixed query does not throw", !newThrew);
check("fixed query returns the assessment 167 audit row", rows.length === 1);
check("actor_email populated from users.email", rows[0]?.actor_email === "bobbi.persinger@scahealth.org");
check("actor_name populated from users.name (not lab_name)", rows[0]?.actor_name === "Bobbi Felton");

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
