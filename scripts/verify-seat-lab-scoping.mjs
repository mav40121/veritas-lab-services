// Receipt for the per-lab seat-scoping fix (fix/seat-lab-scoping).
//
// Bug: seat checks were keyed on (owner_user_id, seat_email) with NO lab_id, so
// a person seated on one of an owner's labs could not be invited to another lab
// under the same owner ("This email already has a seat under the lab owner"),
// and removing them from one lab deactivated their seat on every other lab.
//
// This exercises the EXACT SQL the routes now run, against an in-memory DB, and
// asserts the fixed (lab-scoped) behavior differs from the old (owner-scoped)
// behavior in the two ways that matter. Exit non-zero on any failure.
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`CREATE TABLE user_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id INTEGER, seat_email TEXT, lab_id INTEGER,
  status TEXT DEFAULT 'active'
);`);

const OWNER = 100, EMAIL = "carolyn.cyr@umassmemorial.org", CANCER = 200, MAIN = 201;
// Carolyn already holds an active seat on the cancer-center lab under this owner.
db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, lab_id, status) VALUES (?,?,?,'active')")
  .run(OWNER, EMAIL, CANCER);

const OLD_DUP = db.prepare("SELECT id FROM user_seats WHERE owner_user_id = ? AND seat_email = ? AND status != 'deactivated'");
const NEW_DUP = db.prepare("SELECT id FROM user_seats WHERE owner_user_id = ? AND seat_email = ? AND lab_id = ? AND status != 'deactivated'");

let failed = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failed++; };

// 1. The OLD owner-scoped check wrongly blocks inviting Carolyn to the main lab.
check("old check BLOCKS invite to a second lab (reproduces the bug)",
  !!OLD_DUP.get(OWNER, EMAIL));
// 2. The NEW lab-scoped check allows the main-lab invite (no seat on MAIN yet).
check("new check ALLOWS invite to the main lab",
  !NEW_DUP.get(OWNER, EMAIL, MAIN));
// 3. The NEW check still blocks a true duplicate on the SAME lab.
check("new check still BLOCKS a duplicate seat on the same lab",
  !!NEW_DUP.get(OWNER, EMAIL, CANCER));

// Now seat Carolyn on the main lab too (the invite succeeds).
db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, lab_id, status) VALUES (?,?,?,'active')")
  .run(OWNER, EMAIL, MAIN);

// 4. Removing her from the MAIN lab (lab-scoped deactivate) must leave the
//    cancer-center seat active. The old owner-scoped deactivate would kill both.
db.prepare("UPDATE user_seats SET status = 'deactivated' WHERE owner_user_id = ? AND seat_email = ? AND lab_id = ? AND status != 'deactivated'")
  .run(OWNER, EMAIL, MAIN);
const cancerStillActive = db.prepare("SELECT status FROM user_seats WHERE owner_user_id=? AND seat_email=? AND lab_id=?").get(OWNER, EMAIL, CANCER);
const mainNowOff = db.prepare("SELECT status FROM user_seats WHERE owner_user_id=? AND seat_email=? AND lab_id=?").get(OWNER, EMAIL, MAIN);
check("removing from main lab leaves cancer-center seat ACTIVE", cancerStillActive.status === "active");
check("removing from main lab deactivates ONLY the main-lab seat", mainNowOff.status === "deactivated");

db.close();
if (failed) { console.error(`\n${failed} assertion(s) FAILED`); process.exit(1); }
console.log("\nAll seat lab-scoping assertions passed.");
