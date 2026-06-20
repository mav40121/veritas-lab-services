// scripts/verify-writeoff.js
//
// Math receipt for the /write-off endpoint (server/veritabench.ts): clamps qty
// to on-hand, prices the loss (qty x unit_cost), reduces on-hand, and validates
// the reason code. The dollar value is what rolls into the month's waste total.
//
//   node scripts/verify-writeoff.js

const REASONS = new Set(["expired", "damaged", "recalled", "lost"]);

function writeOff(item, qty, reason) {
  reason = String(reason || "expired").toLowerCase();
  if (!REASONS.has(reason)) return { error: "bad reason" };
  const onHand = item.quantity_on_hand || 0;
  let q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return { error: "bad qty" };
  if (q > onHand) q = onHand;
  if (q <= 0) return { error: "nothing on hand" };
  const unitCost = item.unit_cost || 0;
  return { qty: q, waste_value: q * unitCost, after_on_hand: onHand - q, reason_code: reason };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const item = () => ({ quantity_on_hand: 10, unit_cost: 5 });

check("partial expired write-off", writeOff(item(), 4, "expired"),
  { qty: 4, waste_value: 20, after_on_hand: 6, reason_code: "expired" });
check("over-qty clamps to on-hand", writeOff(item(), 100, "damaged"),
  { qty: 10, waste_value: 50, after_on_hand: 0, reason_code: "damaged" });
check("recalled reason allowed", writeOff(item(), 2, "recalled"),
  { qty: 2, waste_value: 10, after_on_hand: 8, reason_code: "recalled" });
check("bad reason rejected", writeOff(item(), 2, "used"), { error: "bad reason" });
check("zero qty rejected", writeOff(item(), 0, "expired"), { error: "bad qty" });
check("no unit cost -> zero waste value", writeOff({ quantity_on_hand: 5, unit_cost: 0 }, 3, "lost"),
  { qty: 3, waste_value: 0, after_on_hand: 2, reason_code: "lost" });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
