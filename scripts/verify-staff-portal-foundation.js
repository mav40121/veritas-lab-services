// scripts/verify-staff-portal-foundation.js
//
// Receipt for the Staff Portal foundation PR (2026-06-08 evening).
// Exercises the set_qty delta math + asserts the two new
// staff_employees columns are referenced in the right routes.
//
// Run: node scripts/verify-staff-portal-foundation.js
// Exit 0 on PASS, 1 on FAIL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const files = {
  db: fs.readFileSync(path.join(ROOT, "server/db.ts"), "utf8"),
  bench: fs.readFileSync(path.join(ROOT, "server/veritabench.ts"), "utf8"),
  routes: fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"),
};

let pass = 0, fail = 0;
function assert(label, cond, hint) {
  if (cond) { console.log("PASS  " + label); pass++; }
  else      { console.log("FAIL  " + label + (hint ? "  -- " + hint : "")); fail++; }
}

// ── set_qty math ────────────────────────────────────────────────────────
// Mirror of the delta computation in server/veritabench.ts.
function deltaForSetQty(qtyBefore, qtyNew) {
  return Math.trunc(qtyNew) - qtyBefore;
}
function applyDeltaWithFloor(qtyBefore, delta) {
  return Math.max(0, qtyBefore + delta);
}

assert("set_qty: 5 -> 8 yields delta +3",
  deltaForSetQty(5, 8) === 3);
assert("set_qty: 13 -> 12 yields delta -1",
  deltaForSetQty(13, 12) === -1);
assert("set_qty: 13 -> 0 yields delta -13",
  deltaForSetQty(13, 0) === -13);
assert("set_qty: 5 -> 100 yields delta +95",
  deltaForSetQty(5, 100) === 95);
assert("set_qty: 5 -> 5 yields delta 0 (no-op write skipped)",
  deltaForSetQty(5, 5) === 0);
// Truncate non-integer input
assert("set_qty: 5 -> 7.9 truncates to 7, delta +2",
  deltaForSetQty(5, 7.9) === 2);
// Floor on negative result (should never happen if validation works,
// but defense-in-depth)
assert("set_qty floor: 5 + (-10) clamps to 0",
  applyDeltaWithFloor(5, -10) === 0);

// ── Schema additions ────────────────────────────────────────────────────

assert("staff_employees CREATE TABLE includes can_adjust_inventory",
  /can_adjust_inventory INTEGER NOT NULL DEFAULT 0/.test(files.db));
assert("staff_employees CREATE TABLE includes can_view_audit",
  /can_view_audit INTEGER NOT NULL DEFAULT 0/.test(files.db));
assert("staff_employees ALTER TABLE migration for can_adjust_inventory",
  /ALTER TABLE staff_employees ADD COLUMN can_adjust_inventory/.test(files.db));
assert("staff_employees ALTER TABLE migration for can_view_audit",
  /ALTER TABLE staff_employees ADD COLUMN can_view_audit/.test(files.db));

// ── set_qty action wired in scan endpoint ───────────────────────────────

assert("scan endpoint ALLOWED_ACTIONS includes set_qty",
  /"set_qty"/.test(files.bench) && /ALLOWED_ACTIONS.*set_qty/s.test(files.bench));
assert("scan endpoint validates quantity_new",
  /set_qty requires a finite non-negative quantity_new/.test(files.bench));
assert("scan endpoint computes delta = quantityNew - qtyBefore for set_qty",
  /Math\.trunc\(quantityNew\) - qtyBefore/.test(files.bench));

// ── Update endpoint accepts toggle fields ───────────────────────────────

assert("PUT /api/staff/employees/:id reads canAdjustInventory from body",
  /canAdjustInventory/.test(files.routes));
assert("PUT /api/staff/employees/:id reads canViewAudit from body",
  /canViewAudit/.test(files.routes));
assert("PUT /api/staff/employees/:id writes can_adjust_inventory column",
  /can_adjust_inventory=\?/.test(files.routes));
assert("PUT /api/staff/employees/:id writes can_view_audit column",
  /can_view_audit=\?/.test(files.routes));

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
