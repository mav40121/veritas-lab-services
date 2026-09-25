// scripts/verify-repository-lab.mts
//
// Receipt for Build #5 (repository lab). A lab flagged is_repository=1 is a shared
// document/policy library, not a compliance site, and must be EXCLUDED from the
// readiness roll-up (so it never pollutes the network command center or counts).
// This runs the EXACT roll-up lab-selection query from routes.ts against an
// in-memory DB and asserts the exclusion, including legacy NULL rows.
//
// Run: npx tsx scripts/verify-repository-lab.mts   (exits non-zero on fail)

import Database from "better-sqlite3";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, lab_name TEXT, clia_number TEXT, is_repository INTEGER);
  CREATE TABLE lab_members (lab_id INTEGER, user_id INTEGER, status TEXT);
`);
// lab 1 normal (is_repository=0), lab 2 legacy (NULL), lab 3 repository (1), lab 4 normal but not a member.
db.exec(`
  INSERT INTO labs (id, lab_name, clia_number, is_repository) VALUES
    (1, 'Main Lab', '11D1111111', 0),
    (2, 'Legacy Lab', '22D2222222', NULL),
    (3, 'Lifepoint Repository', NULL, 1),
    (4, 'Other Lab', '44D4444444', 0);
  INSERT INTO lab_members (lab_id, user_id, status) VALUES
    (1, 7, 'active'),
    (2, 7, 'active'),
    (3, 7, 'active'),
    (4, 9, 'active');
`);

// EXACT query from GET /api/readiness/rollup
const rollupSql = "SELECT DISTINCT l.id, l.lab_name, l.clia_number FROM labs l JOIN lab_members m ON m.lab_id = l.id WHERE m.user_id = ? AND m.status = 'active' AND (l.is_repository IS NULL OR l.is_repository = 0) ORDER BY l.lab_name ASC";
const ids = (db.prepare(rollupSql).all(7) as any[]).map(r => r.id);

check("includes normal lab (1)", ids.includes(1));
check("includes legacy NULL lab (2)", ids.includes(2), "NULL is_repository treated as normal");
check("EXCLUDES repository lab (3)", !ids.includes(3), "the whole point");
check("excludes non-member lab (4)", !ids.includes(4));
check("exact set is [1,2]", JSON.stringify(ids) === JSON.stringify([2, 1]) || JSON.stringify(ids.slice().sort()) === JSON.stringify([1, 2]), ids.join(","));

// If a lab were re-flagged back to 0, it returns.
db.prepare("UPDATE labs SET is_repository = 0 WHERE id = 3").run();
const ids2 = (db.prepare(rollupSql).all(7) as any[]).map(r => r.id);
check("un-flagged repository returns to the roll-up", ids2.includes(3));

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
