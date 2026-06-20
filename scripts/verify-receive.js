// scripts/verify-receive.js
//
// Math receipt for the /receive endpoint logic (server/veritabench.ts):
// receiving moves qty from on-order into on-hand, defaults to the full open PO,
// clamps an over-receive to what's on order, floors remaining on-order at 0,
// and clears the expected-arrival date once nothing remains on order.
//
//   node scripts/verify-receive.js

function receive(item, received_qty) {
  const onOrder = item.on_order_qty || 0;
  if (onOrder <= 0) return { error: "Nothing on order to receive" };
  let recv = (received_qty === undefined || received_qty === null || received_qty === "")
    ? onOrder
    : Number(received_qty);
  if (!Number.isFinite(recv) || recv <= 0) return { error: "received_qty must be a positive number" };
  if (recv > onOrder) recv = onOrder;
  const newOnHand = (item.quantity_on_hand || 0) + recv;
  const newOnOrder = Math.max(0, onOrder - recv);
  const newExpected = newOnOrder > 0 ? (item.on_order_expected_date ?? null) : null;
  return { received_qty: recv, quantity_on_hand: newOnHand, on_order_qty: newOnOrder, on_order_expected_date: newExpected };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const item = () => ({ quantity_on_hand: 50, on_order_qty: 40, on_order_expected_date: "2026-07-01" });

// Full receive (default) -> all 40 land, on-order cleared, date cleared.
check("full receive (default)", receive(item(), undefined),
  { received_qty: 40, quantity_on_hand: 90, on_order_qty: 0, on_order_expected_date: null });

// Partial receive -> 15 land, 25 stays on order, date preserved.
check("partial receive (15)", receive(item(), 15),
  { received_qty: 15, quantity_on_hand: 65, on_order_qty: 25, on_order_expected_date: "2026-07-01" });

// Over-receive -> clamped to the 40 on order.
check("over-receive clamps to on-order", receive(item(), 100),
  { received_qty: 40, quantity_on_hand: 90, on_order_qty: 0, on_order_expected_date: null });

// Nothing on order -> error.
check("nothing on order errors", receive({ quantity_on_hand: 10, on_order_qty: 0 }, undefined),
  { error: "Nothing on order to receive" });

// Non-positive received -> error.
check("negative received errors", receive(item(), -5),
  { error: "received_qty must be a positive number" });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
