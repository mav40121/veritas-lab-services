// scripts/verify-active-lab-resolution.mjs
//
// Receipt for the 2026-06-11 fix to resolveActiveLabForRequest
// (server/routes.ts). The membership/ownership check queried the labs
// table by `user_id`, but the labs table has no such column (it is
// `owner_user_id`). The query threw "no such column: user_id"; every
// caller wraps it in try/catch, so the active lab silently failed to
// resolve and generated PDFs lost their lab identity (showed neither the
// wrong lab nor the right one -- exactly Michael's co2 report).
//
// This reproduces the labs/lab_members schema in-memory and asserts:
//   1. the OLD query (labs.user_id) THROWS,
//   2. the FIXED query (labs.owner_user_id UNION lab_members.user_id)
//      resolves for the OWNER and for an active MEMBER, and
//   3. a non-member gets no row (the guard still denies).
//
// Run: node scripts/verify-active-lab-resolution.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
// Mirror the real schema: labs.owner_user_id (NOT user_id); lab_members.user_id.
db.exec(`
  CREATE TABLE labs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clia_number TEXT UNIQUE,
    lab_name TEXT,
    owner_user_id INTEGER NOT NULL
  );
  CREATE TABLE lab_members (lab_id INTEGER, user_id INTEGER, status TEXT);
`);
// Lab 3 "Michaels Lab" owned by user 42; user 99 is an active member; user 7 is neither.
db.prepare("INSERT INTO labs (id, lab_name, owner_user_id) VALUES (3, 'Michaels Lab', 42)").run();
db.prepare("INSERT INTO lab_members (lab_id, user_id, status) VALUES (3, 99, 'active')").run();

const OLD_SQL = `SELECT 1 AS ok FROM labs WHERE id = ? AND user_id = ?
  UNION
  SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`;
const NEW_SQL = `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id = ?
  UNION
  SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'`;

function run(sql, a, b, c, d) {
  return db.prepare(sql).get(a, b, c, d);
}

// 1. OLD query throws (the bug).
{
  let threw = false;
  try { run(OLD_SQL, 3, 42, 3, 42); } catch (e) { threw = /no such column: user_id/.test(e.message); }
  check("OLD labs.user_id query throws 'no such column: user_id'", threw);
}

// 2. FIXED query resolves for the owner and an active member.
{
  const owner = run(NEW_SQL, 3, 42, 3, 42);
  check("FIXED resolves for the lab OWNER (user 42)", !!owner && owner.ok === 1);
  const member = run(NEW_SQL, 3, 99, 3, 99);
  check("FIXED resolves for an active MEMBER (user 99)", !!member && member.ok === 1);
}

// 3. The guard still DENIES a non-member.
{
  const stranger = run(NEW_SQL, 3, 7, 3, 7);
  check("FIXED denies a non-member (user 7) -> no row", stranger === undefined);
}

// 4. lab_name is then readable for the resolved lab (what the PDF stamps).
{
  const lab = db.prepare("SELECT lab_name FROM labs WHERE id = ?").get(3);
  check("resolved lab exposes lab_name 'Michaels Lab' for the PDF header", lab?.lab_name === "Michaels Lab");
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
