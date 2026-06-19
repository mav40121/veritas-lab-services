// scripts/verify-enterprise-scope.mjs
//
// Gate 3 receipt for the enterprise roll-up scoping change
// (server/enterpriseTransfer.ts scopeEnterpriseLocations, used by the
// /veritastock/enterprise/rollup route). The roll-up used to show every lab an
// owner has; it now narrows to the warehouse group (a warehouse + the
// stockrooms whose parent_warehouse_lab_id points at it), with a fallback to
// the full owner list when no warehouse links exist so legacy enterprises that
// never set parent_warehouse_lab_id are never broken.
//
// Mirrors the pure helpers. Run: node scripts/verify-enterprise-scope.mjs

function resolveWarehouseId(lab) {
  const p = lab.parent_warehouse_lab_id;
  return p == null ? lab.id : Number(p);
}
function inWarehouseGroup(lab, warehouseId) {
  return lab.id === warehouseId || Number(lab.parent_warehouse_lab_id) === warehouseId;
}
function scopeEnterpriseLocations(baseLab, ownerLabs) {
  const warehouseId = resolveWarehouseId(baseLab);
  const group = ownerLabs.filter((l) => inWarehouseGroup(l, warehouseId));
  return group.length >= 2 ? group : ownerLabs;
}

const ids = (arr) => arr.map((l) => l.id).sort((a, b) => a - b).join(",");

// One owner (e.g. verilabguy) with: a 7-lab San Carlos group (warehouse 10 +
// stockrooms 11..16), a 2-lab EE test group (warehouse 8 + stockroom 9), and a
// standalone unlinked lab (99). Proves cross-group isolation under one owner.
const W = (id) => ({ id, parent_warehouse_lab_id: null });
const S = (id, parent) => ({ id, parent_warehouse_lab_id: parent });
const SANCARLOS = [W(10), S(11, 10), S(12, 10), S(13, 10), S(14, 10), S(15, 10), S(16, 10)];
const OWNER_LABS = [...SANCARLOS, W(8), S(9, 8), W(99)];

const cases = [
  {
    name: "San Carlos entered from the warehouse -> only the 7 San Carlos labs",
    base: W(10), owner: OWNER_LABS, expect: "10,11,12,13,14,15,16",
  },
  {
    name: "San Carlos entered from a stockroom -> same 7-lab group",
    base: S(13, 10), owner: OWNER_LABS, expect: "10,11,12,13,14,15,16",
  },
  {
    name: "EE test group under the same owner stays isolated (no San Carlos bleed)",
    base: W(8), owner: OWNER_LABS, expect: "8,9",
  },
  {
    name: "Legacy unlinked enterprise (2 labs, no links) falls back to owner-wide",
    base: W(2), owner: [W(2), W(6)], expect: "2,6",
  },
  {
    name: "Linked SCAHC group (lab 6 points to warehouse 2) -> just those two",
    base: W(2), owner: [W(2), S(6, 2)], expect: "2,6",
  },
  {
    name: "Single-lab account -> unchanged (returns the one lab)",
    base: W(5), owner: [W(5)], expect: "5",
  },
  {
    name: "Standalone lab among groups falls back to owner-wide (not a demo surface)",
    base: W(99), owner: OWNER_LABS, expect: ids(OWNER_LABS),
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = ids(scopeEnterpriseLocations(c.base, c.owner));
  const ok = got === c.expect;
  if (ok) { pass++; console.log(`PASS  ${c.name}  -> [${got}]`); }
  else { fail++; console.log(`FAIL  ${c.name}  -> got [${got}], expected [${c.expect}]`); }
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
