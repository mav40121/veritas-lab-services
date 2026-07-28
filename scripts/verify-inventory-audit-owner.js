#!/usr/bin/env node
/**
 * verify-inventory-audit-owner.js
 *
 * Receipt for the VeritaStock audit-trail owner-attribution fix (2026-07-28).
 *
 * Bug: /api/inventory/:id/{write-off,adjust,receive} logged their audit_log
 * (and consumption) rows under `req.ownerUserId ?? req.userId`. For a multi-lab
 * user (user 17 is a member of many labs) req.ownerUserId resolves to a single
 * default owner (15, San Carlos), NOT the owner of the item's lab. So a write-off
 * on a Michaels Lab item (lab 3, owner 17) was written under owner 15 and never
 * surfaced in the Michaels Lab audit-log endpoint, which filters
 * owner_user_id = lab.owner_user_id (= 17). Confirmed on prod: audit_log row 3849
 * had owner_user_id 15 for entity_id 25009 (lab_id 3).
 *
 * Fix: resolveInventoryOwnerUserId(item) returns the OWNER OF THE ITEM'S LAB
 * (labs.owner_user_id for item.lab_id), falling back to item.account_id, then the
 * request owner. This mirrors the transfer endpoints (fromLab/toLab.owner_user_id).
 *
 * This script re-implements the resolution logic with an injectable lab lookup
 * and asserts every branch, plus proves the fix changes the buggy case and does
 * NOT regress the single-owner (San Carlos) case.
 */

// Mirror of server/veritabench.ts resolveInventoryOwnerUserId, with the sqlite
// labs lookup injected as `labOwnerOf`.
function resolveInventoryOwnerUserId(item, req, labOwnerOf) {
  const labId = item && item.lab_id;
  if (labId != null) {
    const owner = labOwnerOf(labId);
    if (owner != null) return owner;
  }
  if (item && item.account_id != null) return item.account_id;
  return req.ownerUserId != null ? req.ownerUserId : req.userId;
}

// Production lab -> owner map (from the live labs table).
const LAB_OWNER = { 2: 15, 3: 17 };
const labOwnerOf = (id) => (id in LAB_OWNER ? LAB_OWNER[id] : null);

// The buggy request context: multi-lab user 17 whose default owner resolves to 15.
const REQ = { userId: 17, ownerUserId: 15 };

// The OLD (buggy) attribution, for the regression proof.
const oldOwner = (req) => (req.ownerUserId != null ? req.ownerUserId : req.userId);

let pass = 0, fail = 0;
function check(name, got, want) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${got}, want ${want})`);
  ok ? pass++ : fail++;
}

// 1. Michaels Lab item (lab 3) -> owner 17 (the fix). This is the bug case.
check(
  "write-off on Michaels Lab item (lab_id 3) attributes to owner 17",
  resolveInventoryOwnerUserId({ lab_id: 3, account_id: 17 }, REQ, labOwnerOf),
  17,
);

// 2. Prove the OLD logic mis-attributed the same item to owner 15 (the bug).
check(
  "OLD logic mis-attributed the Michaels item to owner 15 (regression proof)",
  oldOwner(REQ),
  15,
);

// 3. San Carlos item (lab 2) -> owner 15, unchanged. No regression for the
//    single-owner case (San Carlos users legitimately resolve to owner 15).
check(
  "San Carlos item (lab_id 2) still attributes to owner 15 (no regression)",
  resolveInventoryOwnerUserId({ lab_id: 2, account_id: 15 }, { userId: 47, ownerUserId: 15 }, labOwnerOf),
  15,
);

// 4. Legacy single-tenant item (no lab_id) -> item.account_id.
check(
  "legacy item without lab_id falls back to account_id",
  resolveInventoryOwnerUserId({ lab_id: null, account_id: 42 }, REQ, labOwnerOf),
  42,
);

// 5. No lab_id and no account_id -> request owner fallback.
check(
  "item with neither lab_id nor account_id falls back to req owner",
  resolveInventoryOwnerUserId({ lab_id: null, account_id: null }, { userId: 99, ownerUserId: null }, labOwnerOf),
  99,
);

// 6. lab_id present but lab row missing (deleted lab) -> account_id fallback.
check(
  "unknown lab_id falls back to account_id",
  resolveInventoryOwnerUserId({ lab_id: 777, account_id: 17 }, REQ, labOwnerOf),
  17,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
