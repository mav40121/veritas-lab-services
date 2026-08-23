// scripts/verify-enterprise-scope.mjs
//
// Gate 3 receipt for scopeEnterpriseLocations (server/enterpriseTransfer.ts),
// used by the VeritaStock enterprise reads (rollup, team, expired-on-shelf,
// transfers). The roll-up narrows to the base lab's warehouse group (a warehouse
// + the stockrooms whose parent_warehouse_lab_id points at it). A standalone lab
// with no links scopes to ITSELF. The old code fell back to the FULL owner list
// when a lab had no warehouse group, which leaked: a multi-lab owner who owns
// several UNRELATED labs saw one lab's inventory aggregated onto another's page
// (caught on the Riverpoint tutorial sandbox showing "Michaels Lab" items).
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
  return group; // standalone lab -> [baseLab]; linked enterprise -> the group
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
    name: "Two unlinked labs under one owner -> base lab scopes to ITSELF (no leak)",
    base: W(2), owner: [W(2), W(6)], expect: "2",
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
    name: "Standalone lab among groups scopes to itself (no cross-group bleed)",
    base: W(99), owner: OWNER_LABS, expect: "99",
  },
  {
    name: "THE BUG: owner of 6 unrelated standalone labs -> each scopes to itself",
    base: W(22), owner: [W(3), W(7), W(14), W(18), W(21), W(22)], expect: "22",
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
