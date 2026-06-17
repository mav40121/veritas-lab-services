// scripts/verify-enterprise-transfer-batch.mjs
//
// Gate 3 receipt for the multi-item (batch) transfer validator
// (server/enterpriseTransfer.ts validateBatch, used by POST
// /api/labs/:labId/veritastock/transfer-batch). Mirrors validateBatch
// case-for-case. If you change the guard there, change it here too.
//
// Run: node scripts/verify-enterprise-transfer-batch.mjs

function validateBatch(i) {
  const errors = [];
  if (!Number.isFinite(i.fromLabId) || !Number.isFinite(i.toLabId)) errors.push({ itemId: null, error: "invalid_lab" });
  if (i.fromLabId === i.toLabId) errors.push({ itemId: null, error: "same_lab" });
  if (i.fromOwnerUserId !== i.toOwnerUserId) errors.push({ itemId: null, error: "cross_owner" });
  if (!i.actingUserIsMemberOfDestination) errors.push({ itemId: null, error: "no_access_to_destination" });
  if (!Array.isArray(i.lines) || i.lines.length === 0) errors.push({ itemId: null, error: "empty_batch" });
  const seen = new Set();
  for (const l of i.lines || []) {
    if (seen.has(l.itemId)) { errors.push({ itemId: l.itemId, error: "duplicate_item" }); continue; }
    seen.add(l.itemId);
    if (!l.existsAtSource) errors.push({ itemId: l.itemId, error: "not_at_source" });
    else if (!Number.isFinite(l.usageQty) || l.usageQty <= 0) errors.push({ itemId: l.itemId, error: "qty_must_be_positive" });
    else if (l.usageQty > l.sourceQtyOnHand) errors.push({ itemId: l.itemId, error: "insufficient_stock" });
  }
  return { ok: errors.length === 0, errors };
}

let pass = 0, fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${g}\n        want ${w}`); }
}

const OK = {
  fromLabId: 8, toLabId: 9, fromOwnerUserId: 17, toOwnerUserId: 17, actingUserIsMemberOfDestination: true,
  lines: [
    { itemId: 101, usageQty: 40, sourceQtyOnHand: 180, existsAtSource: true },
    { itemId: 102, usageQty: 10, sourceQtyOnHand: 50, existsAtSource: true },
  ],
};

console.log("batch-level guards:");
check("valid 2-line batch passes", validateBatch(OK), { ok: true, errors: [] });
check("empty batch rejected", validateBatch({ ...OK, lines: [] }), { ok: false, errors: [{ itemId: null, error: "empty_batch" }] });
check("same lab rejected", validateBatch({ ...OK, toLabId: 8 }), { ok: false, errors: [{ itemId: null, error: "same_lab" }] });
check("cross-owner rejected", validateBatch({ ...OK, toOwnerUserId: 99 }), { ok: false, errors: [{ itemId: null, error: "cross_owner" }] });
check("no destination membership rejected", validateBatch({ ...OK, actingUserIsMemberOfDestination: false }), { ok: false, errors: [{ itemId: null, error: "no_access_to_destination" }] });

console.log("per-line guards:");
check("line not stocked at source rejected", validateBatch({ ...OK, lines: [{ itemId: 7, usageQty: 5, sourceQtyOnHand: 0, existsAtSource: false }] }),
  { ok: false, errors: [{ itemId: 7, error: "not_at_source" }] });
check("zero quantity line rejected", validateBatch({ ...OK, lines: [{ itemId: 7, usageQty: 0, sourceQtyOnHand: 50, existsAtSource: true }] }),
  { ok: false, errors: [{ itemId: 7, error: "qty_must_be_positive" }] });
check("over-transfer line rejected", validateBatch({ ...OK, lines: [{ itemId: 7, usageQty: 80, sourceQtyOnHand: 50, existsAtSource: true }] }),
  { ok: false, errors: [{ itemId: 7, error: "insufficient_stock" }] });
check("duplicate item line rejected", validateBatch({ ...OK, lines: [
  { itemId: 5, usageQty: 10, sourceQtyOnHand: 50, existsAtSource: true },
  { itemId: 5, usageQty: 10, sourceQtyOnHand: 50, existsAtSource: true },
] }), { ok: false, errors: [{ itemId: 5, error: "duplicate_item" }] });

console.log("one bad line fails the whole batch (all-or-nothing):");
check("good + over-transfer line -> not ok, flags the bad line", validateBatch({ ...OK, lines: [
  { itemId: 101, usageQty: 40, sourceQtyOnHand: 180, existsAtSource: true },
  { itemId: 102, usageQty: 999, sourceQtyOnHand: 50, existsAtSource: true },
] }), { ok: false, errors: [{ itemId: 102, error: "insufficient_stock" }] });

console.log("");
console.log(`batch verify: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
