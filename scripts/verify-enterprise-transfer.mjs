// scripts/verify-enterprise-transfer.mjs
//
// Gate 3 step 2 (math) + step 5 (guard-branch) receipt for the VeritaStock
// enterprise transfer endpoint (server/routes.ts POST
// /api/labs/:labId/veritastock/transfer). Mirrors the pure functions in
// server/enterpriseTransfer.ts case-for-case. If you change the math or a
// guard there, change it here too.
//
// Run: node scripts/verify-enterprise-transfer.mjs

// ---- mirrors of server/enterpriseTransfer.ts -----------------------------
function computeUsageQty(displayQty, unitsPerCountUnit) {
  const pack =
    Number.isFinite(unitsPerCountUnit) && unitsPerCountUnit > 0
      ? Math.floor(unitsPerCountUnit)
      : 1;
  return Math.round(displayQty) * pack;
}

function validateTransfer(i) {
  if (!Number.isFinite(i.fromLabId) || !Number.isFinite(i.toLabId)) return { ok: false, error: "invalid_lab" };
  if (i.fromLabId === i.toLabId) return { ok: false, error: "same_lab" };
  if (i.fromOwnerUserId !== i.toOwnerUserId) return { ok: false, error: "cross_owner" };
  if (!i.actingUserIsMemberOfDestination) return { ok: false, error: "no_access_to_destination" };
  if (!Number.isFinite(i.usageQty) || i.usageQty <= 0) return { ok: false, error: "qty_must_be_positive" };
  if (i.usageQty > i.sourceQtyOnHand) return { ok: false, error: "insufficient_stock" };
  return { ok: true };
}

function matchKey(item) {
  const cat = (item.catalog_number || "").trim().toLowerCase();
  if (cat) return `cat:${cat}`;
  return `name:${(item.item_name || "").trim().toLowerCase()}`;
}

function countOnHand(quantityOnHand, unitsPerCountUnit) {
  const pack =
    Number.isFinite(unitsPerCountUnit) && unitsPerCountUnit > 0
      ? Math.floor(unitsPerCountUnit)
      : 1;
  return pack > 1 ? Math.round(quantityOnHand / pack) : quantityOnHand;
}

// ---- harness -------------------------------------------------------------
let pass = 0;
let fail = 0;
function check(name, got, want) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}\n        got  ${g}\n        want ${w}`);
  }
}

const OK = { fromLabId: 2, toLabId: 6, fromOwnerUserId: 15, toOwnerUserId: 15, actingUserIsMemberOfDestination: true, sourceQtyOnHand: 180, usageQty: 40 };

console.log("computeUsageQty (box -> usage_units):");
check("4 boxes x pack 10 = 40 eaches", computeUsageQty(4, 10), 40);
check("5 eaches x pack 1 = 5", computeUsageQty(5, 1), 5);
check("fractional display rounds before multiply (3.4 -> 3 x 2)", computeUsageQty(3.4, 2), 6);
check("pack 0 is treated as 1 (no div/mul by zero)", computeUsageQty(7, 0), 7);
check("missing pack is treated as 1", computeUsageQty(7, undefined), 7);

console.log("validateTransfer guards:");
check("valid same-owner transfer passes", validateTransfer(OK), { ok: true });
check("same lab rejected", validateTransfer({ ...OK, toLabId: 2 }), { ok: false, error: "same_lab" });
check("cross-owner rejected (cross-tenant boundary)", validateTransfer({ ...OK, toOwnerUserId: 99 }), { ok: false, error: "cross_owner" });
check("no destination membership rejected", validateTransfer({ ...OK, actingUserIsMemberOfDestination: false }), { ok: false, error: "no_access_to_destination" });
check("zero quantity rejected", validateTransfer({ ...OK, usageQty: 0 }), { ok: false, error: "qty_must_be_positive" });
check("negative quantity rejected", validateTransfer({ ...OK, usageQty: -5 }), { ok: false, error: "qty_must_be_positive" });
check("over-transfer rejected (more than on hand)", validateTransfer({ ...OK, usageQty: 200 }), { ok: false, error: "insufficient_stock" });
check("exact on-hand allowed", validateTransfer({ ...OK, usageQty: 180 }), { ok: true });

console.log("matchKey (cross-location item match):");
check("catalog number wins, case-insensitive", matchKey({ catalog_number: " AB-12 ", item_name: "CBC Diluent" }), "cat:ab-12");
check("falls back to item name when no catalog", matchKey({ catalog_number: "", item_name: "CBC Diluent" }), "name:cbc diluent");
check("same item, different lab punctuation still matches name", matchKey({ item_name: "cbc diluent" }), "name:cbc diluent");

console.log("countOnHand (usage_units -> count_unit view):");
check("pack 10: 40 usage = 4 boxes", countOnHand(40, 10), 4);
check("pack 1: 5 usage = 5 eaches", countOnHand(5, 1), 5);
check("partial pack rounds to nearest box", countOnHand(38, 10), 4);

console.log("");
console.log(`enterprise-transfer verify: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
