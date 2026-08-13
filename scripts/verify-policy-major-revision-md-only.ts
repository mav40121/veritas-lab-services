// scripts/verify-policy-major-revision-md-only.ts
//
// Gate 3 receipt for the VeritaPolicy "major revision -> Medical Director only"
// feature. Imports the REAL canUserApproveStep / countEligibleReviewersForStep /
// isVersionMajorRevision from server/veritapolicyApproval.ts and asserts:
//   - Minor revision (existing behavior): the designated MD, or an owner/admin
//     designee, may approve a medical_director step.
//   - Major revision: ONLY the designated MD may approve; owner/admin designees
//     are blocked  [harness bites].
//   - Major revision with no designated MD: nobody may approve (blocked with a
//     clear message); the submit-time eligible count is 0.
//   - The counter mirrors the gate (3 eligible on minor, 1 on major).
//   - isVersionMajorRevision reads the flag off policy_versions.
//
// Run: node_modules/.bin/tsx scripts/verify-policy-major-revision-md-only.ts
import Database from "better-sqlite3";
import {
  canUserApproveStep,
  countEligibleReviewersForStep,
  isVersionMajorRevision,
} from "../server/veritapolicyApproval";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER, medical_director_email TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
  CREATE TABLE lab_members (lab_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
  CREATE TABLE user_seats (owner_user_id INTEGER, seat_user_id INTEGER, seat_type TEXT, status TEXT);
  CREATE TABLE policy_versions (id INTEGER PRIMARY KEY, is_major_revision INTEGER NOT NULL DEFAULT 0);
`);
// Lab 1: has a designated MD (user 10). Owner=1, Admin=2, plain member=3 (view-only seat).
db.prepare("INSERT INTO labs VALUES (1,1,'md@lab.com')").run();
db.prepare("INSERT INTO users VALUES (1,'owner@lab.com'),(2,'admin@lab.com'),(3,'tech@lab.com'),(10,'md@lab.com')").run();
db.prepare("INSERT INTO lab_members VALUES (1,1,'owner','active'),(1,2,'admin','active'),(1,3,'member','active'),(1,10,'member','active')").run();
db.prepare("INSERT INTO user_seats VALUES (1,3,'view_only','active')").run();
// Lab 2: NO designated MD. Owner=20.
db.prepare("INSERT INTO labs VALUES (2,20,'')").run();
db.prepare("INSERT INTO users VALUES (20,'owner2@lab.com')").run();
db.prepare("INSERT INTO lab_members VALUES (2,20,'owner','active')").run();
// policy_versions: 1 = major, 2 = minor
db.prepare("INSERT INTO policy_versions VALUES (1,1),(2,0)").run();

const STEP = { required_role: "medical_director", specific_user_id: null, allow_self_approval: 0 };
const OWNER_OF_DOC = 99; // uploader; not a lab member, so self-approval never interferes
const can = (userId: number, isMajorRevision: boolean, labId = 1) =>
  canUserApproveStep(db as any, { userId, labId, documentOwnerId: OWNER_OF_DOC, stepRow: STEP, isMajorRevision }).ok;

// --- Minor revision (existing "MD or designee" behavior) ---
check("minor: MD (10) can approve", can(10, false));
check("minor: owner (1) can approve as designee", can(1, false));
check("minor: admin (2) can approve as designee", can(2, false));
check("minor: plain member (3) cannot approve", !can(3, false));

// --- Major revision (MD only, no designee)  [harness bites] ---
check("major: MD (10) can approve", can(10, true));
check("major: owner (1) is BLOCKED (no designee)  [bites]", !can(1, true));
check("major: admin (2) is BLOCKED (no designee)  [bites]", !can(2, true));
check("major: plain member (3) is BLOCKED", !can(3, true));

// --- Major revision, lab with NO designated MD: nobody may approve ---
check("major, no MD designated: owner (20) BLOCKED", !can(20, true, 2));
const noMdReason = canUserApproveStep(db as any, { userId: 20, labId: 2, documentOwnerId: OWNER_OF_DOC, stepRow: STEP, isMajorRevision: true });
check("major, no MD: reason mentions no designated Medical Director",
  !noMdReason.ok && /no active Medical Director is designated/i.test((noMdReason as any).reason));
// minor with no MD falls through to the permissive rule (unchanged) -> owner can
check("minor, no MD designated: owner (20) still allowed (unchanged fallback)", can(20, false, 2));

// --- Submit-time counter mirrors the gate ---
const count = (isMajorRevision: boolean, labId = 1) =>
  countEligibleReviewersForStep(db as any, { labId, documentOwnerId: OWNER_OF_DOC, stepRow: STEP, isMajorRevision });
check("counter minor: 3 eligible (MD + owner + admin)", count(false) === 3);
check("counter major: 1 eligible (MD only)", count(true) === 1);
check("counter major, no MD: 0 eligible", count(true, 2) === 0);

// --- isVersionMajorRevision reads the flag ---
check("isVersionMajorRevision(1) = true (major)", isVersionMajorRevision(db as any, 1) === true);
check("isVersionMajorRevision(2) = false (minor)", isVersionMajorRevision(db as any, 2) === false);
check("isVersionMajorRevision(null) = false", isVersionMajorRevision(db as any, null) === false);
check("isVersionMajorRevision(missing id) = false", isVersionMajorRevision(db as any, 999) === false);

db.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
