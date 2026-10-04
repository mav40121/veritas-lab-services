// Verify receipt for VeritaDC approval-workflow delegation (#39).
// Exercises the REAL canUserApproveStepDelegated + delegatorsFor +
// countEligibleReviewersForStep(Delegated) against an in-memory SQLite:
// direct eligibility, delegate inherits inside the window, window boundaries,
// revoked, role scope, manual scope, both self-approval laundering guards, and
// the delegation-aware reviewer count.
//
// Run: npx tsx scripts/verify-veritadc-approval-delegation.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
import {
  canUserApproveStepDelegated,
  delegatorsFor,
  countEligibleReviewersForStep,
  countEligibleReviewersForStepDelegated,
} from "../server/veritapolicyApproval";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER, medical_director_email TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
  CREATE TABLE lab_members (id INTEGER PRIMARY KEY, lab_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
  CREATE TABLE user_seats (id INTEGER PRIMARY KEY, owner_user_id INTEGER, seat_user_id INTEGER, lab_id INTEGER, seat_type TEXT, status TEXT);
  CREATE TABLE policy_manual_approvers (id INTEGER PRIMARY KEY, lab_id INTEGER, manual_id INTEGER, required_role TEXT, user_id INTEGER);
  CREATE TABLE policy_approval_delegations (
    id INTEGER PRIMARY KEY, lab_id INTEGER, from_user_id INTEGER, to_user_id INTEGER,
    required_role TEXT, manual_id INTEGER, starts_on TEXT, ends_on TEXT,
    note TEXT, created_by INTEGER, created_at TEXT, revoked_at TEXT
  );
`);
// lab 1, owner 10. Members 10..28 all active.
db.prepare("INSERT INTO labs (id, owner_user_id) VALUES (1, 10)").run();
for (const id of [10, 11, 20, 21, 22, 25, 26, 27, 28])
  db.prepare("INSERT INTO users (id,email) VALUES (?,?)").run(id, `u${id}@t`);
for (const [uid, role] of [[10, "owner"], [11, "admin"], [20, "staff"], [21, "staff"], [22, "staff"], [25, "staff"], [26, "staff"], [27, "staff"], [28, "staff"]] as const)
  db.prepare("INSERT INTO lab_members (lab_id,user_id,role,status) VALUES (1,?,?,'active')").run(uid, role);

// Step A: specific_user -> user 20, owner 10, self-approval OFF. Clean direct
// eligibility ({20}) so delegation effects are unambiguous.
const stepA = { required_role: "specific_user", specific_user_id: 20, allow_self_approval: 0 };
// Step B: specific_user -> the OWNER (10), self-approval OFF. Used for the
// "delegator is the owner" laundering guard.
const stepB = { required_role: "specific_user", specific_user_id: 10, allow_self_approval: 0 };

const mkDeleg = (from: number, to: number, role: string | null, manual: number | null, start: string, end: string, revoked = false) =>
  db.prepare(
    `INSERT INTO policy_approval_delegations (lab_id,from_user_id,to_user_id,required_role,manual_id,starts_on,ends_on,revoked_at)
     VALUES (1,?,?,?,?,?,?,?)`
  ).run(from, to, role, manual, start, end, revoked ? "2026-10-02 00:00:00" : null);

mkDeleg(20, 22, null, null, "2026-10-01", "2026-10-31");            // D1 active, broad
mkDeleg(20, 25, null, null, "2026-10-01", "2026-10-31", true);      // D2 active window but REVOKED
mkDeleg(20, 26, "medical_director", null, "2026-10-01", "2026-10-31"); // D3 role-scoped (mismatch)
mkDeleg(20, 27, null, 5, "2026-10-01", "2026-10-31");               // D4 manual-scoped to manual 5
mkDeleg(20, 10, null, null, "2026-10-01", "2026-10-31");            // D5 delegate is the OWNER
mkDeleg(10, 28, null, null, "2026-10-01", "2026-10-31");            // D6 delegator is the OWNER (for stepB)

const TODAY = "2026-10-15";
const can = (userId: number, manualId: number | null, today = TODAY, step: any = stepA) =>
  canUserApproveStepDelegated(db, { userId, labId: 1, documentOwnerId: 10, stepRow: step, manualId }, today).ok;

interface C { name: string; got: any; exp: any; }
const cases: C[] = [
  { name: "direct: specific user 20 approves", got: can(20, null), exp: true },
  { name: "control: member 21 with no delegation blocked", got: can(21, null), exp: false },
  { name: "delegate 22 inherits inside window", got: can(22, null), exp: true },
  { name: "window: before start -> blocked", got: can(22, null, "2026-09-15"), exp: false },
  { name: "window: after end -> blocked", got: can(22, null, "2026-11-15"), exp: false },
  { name: "window: first day inclusive", got: can(22, null, "2026-10-01"), exp: true },
  { name: "window: last day inclusive", got: can(22, null, "2026-10-31"), exp: true },
  { name: "revoked delegation -> 25 blocked", got: can(25, null), exp: false },
  { name: "role-scoped delegation (medical_director) does not apply to this step -> 26 blocked", got: can(26, null), exp: false },
  { name: "manual-scoped delegation applies on matching manual 5 -> 27 ok", got: can(27, 5), exp: true },
  { name: "manual-scoped delegation blocked on non-matching manual 6 -> 27", got: can(27, 6), exp: false },
  { name: "manual-scoped delegation blocked on no-manual doc -> 27", got: can(27, null), exp: false },
  { name: "laundering guard 1: delegate IS the owner -> blocked", got: can(10, null), exp: false },
  { name: "laundering guard 2: delegator IS the owner (self-approval off) -> 28 blocked", got: can(28, null, TODAY, stepB), exp: false },
  { name: "delegatorsFor(22) today = [20]", got: JSON.stringify(delegatorsFor(db, 1, 22, "specific_user", null, TODAY)), exp: "[20]" },
  { name: "delegatorsFor(21) today = []", got: JSON.stringify(delegatorsFor(db, 1, 21, "specific_user", null, TODAY)), exp: "[]" },
  { name: "direct count unchanged (regression) = 1", got: countEligibleReviewersForStep(db, { labId: 1, documentOwnerId: 10, stepRow: stepA, manualId: null }), exp: 1 },
  { name: "delegated count (no manual) = 2 (20 + 22; revoked/role/manual/owner excluded)", got: countEligibleReviewersForStepDelegated(db, { labId: 1, documentOwnerId: 10, stepRow: stepA, manualId: null }, TODAY), exp: 2 },
  { name: "delegated count (manual 5) = 3 (20 + 22 broad + 27 manual-scoped)", got: countEligibleReviewersForStepDelegated(db, { labId: 1, documentOwnerId: 10, stepRow: stepA, manualId: 5 }, TODAY), exp: 3 },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = c.got === c.exp;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (exp ${c.exp}, got ${c.got})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exit(1);
