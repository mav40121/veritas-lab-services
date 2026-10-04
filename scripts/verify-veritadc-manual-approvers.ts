// Verify receipt for the VeritaDC per-manual approver override (#39).
// Exercises the REAL canUserApproveStep + countEligibleReviewersForStep +
// manualApproverUserIds against an in-memory SQLite, covering: no-mapping
// fallback, mapping narrows to the designated approver, non-mapped member
// blocked, self-approval still guarded ahead of the override, and the eligible
// count under a mapping.
//
// Run: npx tsx scripts/verify-veritadc-manual-approvers.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
import {
  canUserApproveStep,
  countEligibleReviewersForStep,
  manualApproverUserIds,
} from "../server/veritapolicyApproval";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, owner_user_id INTEGER, medical_director_email TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
  CREATE TABLE lab_members (id INTEGER PRIMARY KEY, lab_id INTEGER, user_id INTEGER, role TEXT, status TEXT);
  CREATE TABLE user_seats (id INTEGER PRIMARY KEY, owner_user_id INTEGER, seat_user_id INTEGER, lab_id INTEGER, seat_type TEXT, status TEXT);
  CREATE TABLE policy_manual_approvers (id INTEGER PRIMARY KEY, lab_id INTEGER, manual_id INTEGER, required_role TEXT, user_id INTEGER);
`);
// lab 1, owner 10. Members: 10 owner, 11 admin, 20 micro TC (mapped), 21 other TC (not mapped).
db.prepare("INSERT INTO labs (id, owner_user_id) VALUES (1, 10)").run();
for (const [id, email] of [[10, "owner@t"], [11, "admin@t"], [20, "micro@t"], [21, "other@t"]] as const)
  db.prepare("INSERT INTO users (id,email) VALUES (?,?)").run(id, email);
for (const [uid, role] of [[10, "owner"], [11, "admin"], [20, "staff"], [21, "staff"]] as const)
  db.prepare("INSERT INTO lab_members (lab_id,user_id,role,status) VALUES (1,?,?,'active')").run(uid, role);
// Manual 5 (Micro) designates user 20 as the technical_consultant approver.
db.prepare("INSERT INTO policy_manual_approvers (lab_id,manual_id,required_role,user_id) VALUES (1,5,'technical_consultant',20)").run();

const step = { required_role: "technical_consultant", specific_user_id: null, allow_self_approval: 0 };
const can = (userId: number, manualId: number | null) =>
  canUserApproveStep(db, { userId, labId: 1, documentOwnerId: 10, stepRow: step, manualId }).ok;

interface C { name: string; got: any; exp: any; }
const cases: C[] = [
  { name: "mapped user approves Micro (manual 5)", got: can(20, 5), exp: true },
  { name: "non-mapped member BLOCKED on Micro (manual 5)", got: can(21, 5), exp: false },
  { name: "non-mapped member allowed when doc has NO manual", got: can(21, null), exp: true },
  { name: "non-mapped member allowed on a manual with NO mapping (6)", got: can(21, 6), exp: true },
  { name: "owner self-approval still blocked ahead of override", got: can(10, 5), exp: false },
  { name: "manualApproverUserIds returns [20] for Micro TC", got: JSON.stringify(manualApproverUserIds(db, 1, 5, "technical_consultant")), exp: "[20]" },
  { name: "manualApproverUserIds null for unmapped role", got: manualApproverUserIds(db, 1, 5, "general_supervisor"), exp: null },
  { name: "eligible count under Micro mapping = 1 (only user 20)", got: countEligibleReviewersForStep(db, { labId: 1, documentOwnerId: 10, stepRow: step, manualId: 5 }), exp: 1 },
  { name: "eligible count with NO manual >= 3 (generic pool)", got: countEligibleReviewersForStep(db, { labId: 1, documentOwnerId: 10, stepRow: step, manualId: null }) >= 3, exp: true },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = c.got === c.exp;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (exp ${c.exp}, got ${c.got})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exit(1);
