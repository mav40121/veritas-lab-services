// scripts/verify-inventory-position.js
//
// Math receipt for on-order / inventory-position logic in decorateInventoryItem
// (server/veritabench.ts). Confirms that:
//   - reorder is decided on inventory position (on_hand + on_order), not on-hand
//   - an item already on a PO stops flagging needs_reorder once position clears
//     the reorder point
//   - suggested-order shortfall nets out what's already on order (no double-buy)
//
//   node scripts/verify-inventory-position.js

function decorate(item) {
  const burnRate = item.burn_rate || 0;
  const onHand = item.quantity_on_hand || 0;
  const onOrder = item.on_order_qty || 0;
  const inventoryPosition = onHand + onOrder;
  const upu = item.units_per_order_unit || 1;
  const reorderPoint = burnRate * ((item.lead_time_days || 0) + (item.safety_stock_days || 0));
  const orderToQty = burnRate * (item.desired_days_of_stock || 0);
  const needsReorder = inventoryPosition <= reorderPoint;
  const shortfall = Math.max(0, Math.round(orderToQty) - inventoryPosition);
  const suggestedOrderPacks = upu > 1 ? Math.ceil(shortfall / upu) : shortfall;
  return { reorder_point: Math.round(reorderPoint), inventory_position: inventoryPosition, needs_reorder: needsReorder, shortfall, suggested_order_packs: suggestedOrderPacks };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// burn 10/day, lead 5, safety 3 -> reorder point 80; desired 30 -> order-to 300.
const base = { burn_rate: 10, lead_time_days: 5, safety_stock_days: 3, desired_days_of_stock: 30, units_per_order_unit: 1 };

// A: 50 on hand, nothing on order -> below reorder point, must reorder.
const a = decorate({ ...base, quantity_on_hand: 50, on_order_qty: 0 });
check("A reorder point", a.reorder_point, 80);
check("A needs_reorder (50 <= 80)", a.needs_reorder, true);
check("A shortfall (300 - 50)", a.shortfall, 250);

// B: 50 on hand + 40 on order = position 90 -> clears reorder point, no reorder.
const b = decorate({ ...base, quantity_on_hand: 50, on_order_qty: 40 });
check("B inventory_position", b.inventory_position, 90);
check("B needs_reorder (90 > 80)", b.needs_reorder, false);
check("B shortfall nets out on-order (300 - 90)", b.shortfall, 210);

// C: position still below order-to but above reorder point -> no reorder, smaller shortfall.
const c = decorate({ ...base, quantity_on_hand: 50, on_order_qty: 200 });
check("C needs_reorder (250 > 80)", c.needs_reorder, false);
check("C shortfall (300 - 250)", c.shortfall, 50);

// D: position above order-to target -> zero shortfall, no double-order.
const d = decorate({ ...base, quantity_on_hand: 50, on_order_qty: 300 });
check("D shortfall floored at 0", d.shortfall, 0);
check("D suggested packs 0", d.suggested_order_packs, 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
