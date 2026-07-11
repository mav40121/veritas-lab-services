// scripts/verify-veritastaff-employee-atomic.mjs
//
// Receipt for the VeritaStaff employee create/update atomicity fix (audit #4,
// 2026-07-10). Both lab-scoped handlers did the employee row, the roles
// DELETE+re-insert, and the competency-schedule writes as separate un-transactioned
// statements, so a mid-sequence throw could leave a half-written employee (e.g.
// a row with ZERO roles after the DELETE succeeded but a re-insert threw). Now
// each is wrapped in sqlite.transaction() so it all commits or all rolls back.
// ensureCompetencyScheduleMilestones uses plain prepared statements (no nested
// transaction), so the wrap is safe. Rollback proven in sqlite: a mid-loop throw
// left emp=0 rows, roles=0 rows.
//
//   node scripts/verify-veritastaff-employee-atomic.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("create wraps the write sequence in a transaction returning the new id",
  /const empId = sqlite\.transaction\(\(\) => \{[\s\S]*?INSERT INTO staff_employees[\s\S]*?return id;\s*\}\)\(\);/.test(routes));
ok("update wraps UPDATE + roles + milestones in a transaction",
  /sqlite\.transaction\(\(\) => \{\s*sqlite\.prepare\(\s*"UPDATE staff_employees SET[\s\S]*?DELETE FROM staff_roles[\s\S]*?ensureCompetencyScheduleMilestones[\s\S]*?\}\)\(\);/.test(routes));
// The lab-scoped update's roles DELETE now lives INSIDE the transaction via
// `sqlite.prepare` (the legacy user_id-scoped handler is a same-class follow-up
// and still uses (db as any).$client — out of scope for this PR).
ok("the lab-scoped update roles DELETE is inside the transaction (sqlite.prepare)",
  /sqlite\.transaction\(\(\) => \{\s*sqlite\.prepare\(\s*"UPDATE staff_employees SET[\s\S]*?sqlite\.prepare\("DELETE FROM staff_roles WHERE employee_id = \?"\)\.run\(req\.params\.id\)/.test(routes));

console.log(fails === 0 ? "\n=== VERITASTAFF EMPLOYEE ATOMIC: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
