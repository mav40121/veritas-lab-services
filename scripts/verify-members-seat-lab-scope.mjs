// Receipt for the members-list seat-join fan-out fix (fix/members-seat-join-lab-scope).
//
// Bug (2026-09-08, Milford): the lab members list LEFT JOINed user_seats on
// (seat_user_id, owner_user_id, status='active') WITHOUT lab_id. Seats are
// per-lab, so a member seated on two of the owner's labs has two active
// user_seats rows; the unscoped join fanned the single membership row into two,
// and the member rendered twice in each lab's member list. Carolyn Cyr and
// Sarah DelloRusso (both on Milford Main + Cancer Center under owner 33) each
// showed twice. Same read-side seat-scoping class as PR #1247.
//
// This exercises the EXACT join shape against an in-memory DB and asserts the
// unscoped join duplicates while the lab-scoped join returns one row per
// membership. Exit non-zero on any failure.
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER);
  CREATE TABLE lab_members (id INTEGER PRIMARY KEY, lab_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
  CREATE TABLE user_seats (id INTEGER PRIMARY KEY, owner_user_id INTEGER, seat_user_id INTEGER, lab_id INTEGER, status TEXT, seat_type TEXT);
`);
const OWNER = 33, CAROLYN = 70, MAIN = 4, CANCER = 5;
db.prepare("INSERT INTO users (id,name,email) VALUES (?,?,?)").run(CAROLYN, "Carolyn Cyr", "carolyn.cyr@umassmemorial.org");
db.prepare("INSERT INTO users (id,name,email) VALUES (?,?,?)").run(OWNER, "Lisa Veri", "lisa.veri@umassmemorial.org");
db.prepare("INSERT INTO labs (id,owner_user_id) VALUES (?,?)").run(MAIN, OWNER);
db.prepare("INSERT INTO labs (id,owner_user_id) VALUES (?,?)").run(CANCER, OWNER);
// Carolyn: one ACTIVE membership on the Main lab.
db.prepare("INSERT INTO lab_members (lab_id,user_id,role,status) VALUES (?,?,?,?)").run(MAIN, CAROLYN, "admin", "active");
// Carolyn: an active seat on BOTH labs under the same owner (the real state).
db.prepare("INSERT INTO user_seats (owner_user_id,seat_user_id,lab_id,status,seat_type) VALUES (?,?,?,?,?)").run(OWNER, CAROLYN, MAIN, "active", "active");
db.prepare("INSERT INTO user_seats (owner_user_id,seat_user_id,lab_id,status,seat_type) VALUES (?,?,?,?,?)").run(OWNER, CAROLYN, CANCER, "active", "active");

const OLD = `
  SELECT lm.id AS membership_id, u.email, COALESCE(us.seat_type,'active') AS seat_type
  FROM lab_members lm
  JOIN users u ON u.id = lm.user_id
  LEFT JOIN user_seats us ON us.seat_user_id = lm.user_id AND us.owner_user_id = ? AND us.status = 'active'
  WHERE lm.lab_id = ? AND lm.status = 'active'`;
const NEW = `
  SELECT lm.id AS membership_id, u.email, COALESCE(us.seat_type,'active') AS seat_type
  FROM lab_members lm
  JOIN users u ON u.id = lm.user_id
  LEFT JOIN user_seats us ON us.seat_user_id = lm.user_id AND us.owner_user_id = ? AND us.status = 'active' AND us.lab_id = lm.lab_id
  WHERE lm.lab_id = ? AND lm.status = 'active'`;

let failures = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) failures++; };

const oldRows = db.prepare(OLD).all(OWNER, MAIN);
const newRows = db.prepare(NEW).all(OWNER, MAIN);
ok("unscoped join fans out (reproduces the bug): 2 rows for one membership", oldRows.length === 2);
ok("lab-scoped join returns exactly one row per membership", newRows.length === 1);
ok("lab-scoped row is the correct member", newRows[0]?.email === "carolyn.cyr@umassmemorial.org");
ok("lab-scoped row keeps the seat_type", newRows[0]?.seat_type === "active");

// Owner with NO seat still resolves to 'active' via COALESCE under the scoped join.
db.prepare("INSERT INTO lab_members (lab_id,user_id,role,status) VALUES (?,?,?,?)").run(MAIN, OWNER, "owner", "active");
const ownerRow = db.prepare(NEW + " AND lm.user_id = ?").all(OWNER, MAIN, OWNER);
ok("owner (no seat) still falls back to seat_type active", ownerRow.length === 1 && ownerRow[0].seat_type === "active");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
