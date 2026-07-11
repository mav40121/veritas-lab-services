// scripts/verify-veritastaff-toggle-persist.mjs
//
// Receipt for the VeritaStaff lab-scoped employee toggle-persistence fix
// (audit #3, 2026-07-10). The lab-scoped POST/PUT /api/labs/:labId/staff/
// employees[/:id] omitted can_adjust_inventory / can_view_audit from their
// INSERT/UPDATE, so on a multi-lab account (which always routes through the
// lab-scoped handlers) toggling a Staff Portal access grant showed "Employee
// updated" while the grant never wrote. The legacy user_id-scoped handlers
// persisted them; now the lab-scoped ones do too.
//
//   node scripts/verify-veritastaff-toggle-persist.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// lab-scoped create (INSERT ... tier2_lab_id, user_id ...) now lists the toggles
ok("lab-scoped create INSERT persists can_adjust_inventory + can_view_audit",
  /INSERT INTO staff_employees \(lab_id, tier2_lab_id, user_id,[\s\S]*?performs_testing, can_adjust_inventory, can_view_audit, status/.test(routes));
// lab-scoped update SET now lists the toggles
ok("lab-scoped update SET persists can_adjust_inventory + can_view_audit",
  /UPDATE staff_employees SET[\s\S]*?performs_testing=\?, can_adjust_inventory=\?, can_view_audit=\?, updated_at=\?/.test(routes));
// update keeps existing value when the field is omitted (COALESCE-by-JS)
ok("update preserves the existing grant when the toggle is not sent",
  /canAdjustInventory !== undefined \? \(canAdjustInventory \? 1 : 0\) : \(emp\.can_adjust_inventory \?\? 0\)/.test(routes) &&
  /canViewAudit !== undefined \? \(canViewAudit \? 1 : 0\) : \(emp\.can_view_audit \?\? 0\)/.test(routes));
// both lab-scoped handlers now destructure the toggles from the body
ok("both lab-scoped handlers destructure canAdjustInventory + canViewAudit",
  (routes.match(/performsTesting, roles, canAdjustInventory, canViewAudit \} = req\.body/g) || []).length >= 2);

console.log(fails === 0 ? "\n=== VERITASTAFF TOGGLE PERSIST: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
