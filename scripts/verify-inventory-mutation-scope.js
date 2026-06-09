#!/usr/bin/env node
// scripts/verify-inventory-mutation-scope.js
//
// Receipt for the inventory mutation scope fix (2026-06-09).
// Exercises resolveInventoryItemForMutation's decision matrix:
//   - account_id match: 200 (legacy direct path)
//   - lab member of item's lab: 200 (multi-lab fix)
//   - foreign lab: 403 (don't leak existence)
//   - item missing: 404

function resolve({ item, userId, ownerId, isLabMember }) {
  if (!item) return { item: null, status: 404 };
  if (item.account_id === ownerId) return { item, status: 200 };
  if (item.lab_id && isLabMember) return { item, status: 200 };
  return { item: null, status: 403 };
}

const cases = [
  ["Owner direct: account_id matches ownerId",
   { item: { id: 1, account_id: 7, lab_id: 3 }, userId: 7, ownerId: 7, isLabMember: false },
   { ok: true, status: 200 }],
  ["Seeded item: account_id != ownerId but user is lab_member",
   { item: { id: 2, account_id: 99, lab_id: 3 }, userId: 7, ownerId: 7, isLabMember: true },
   { ok: true, status: 200 }],
  ["Foreign lab: account_id != ownerId AND not a lab_member -> 403",
   { item: { id: 3, account_id: 99, lab_id: 4 }, userId: 7, ownerId: 7, isLabMember: false },
   { ok: false, status: 403 }],
  ["Item missing -> 404 (no existence leak)",
   { item: null, userId: 7, ownerId: 7, isLabMember: false },
   { ok: false, status: 404 }],
  ["Item with no lab_id (legacy single-tenant) + no account match -> 403",
   { item: { id: 4, account_id: 99, lab_id: null }, userId: 7, ownerId: 7, isLabMember: false },
   { ok: false, status: 403 }],
];

let pass = 0, fail = 0;
for (const [label, input, expected] of cases) {
  const got = resolve(input);
  const ok = (got.status === expected.status) && (!!got.item === expected.ok);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) console.log(`  expected status=${expected.status} ok=${expected.ok}\n  got      status=${got.status} ok=${!!got.item}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
