#!/usr/bin/env node
// scripts/verify-inventory-count-unit.js
//
// Receipt for the VeritaStock count_unit / pack_size structural fix
// (2026-06-09). Exercises the conversion math:
//   usage_qty = new_count * units_per_count_unit
//   count_on_hand = round(quantity_on_hand / units_per_count_unit)
// across the meaningful branches (pack_size = 1 legacy, pack_size > 1,
// pack_size = 0 guard, negative qty rejection).

function adjust({ new_count, new_quantity, pack_size }) {
  const hasCount = typeof new_count === "number" && Number.isFinite(new_count);
  const hasQty = typeof new_quantity === "number" && Number.isFinite(new_quantity);
  if (!hasCount && !hasQty) return { error: "missing" };
  const ps = Number.isFinite(pack_size) && pack_size > 0 ? pack_size : 1;
  if (hasCount) {
    if (!Number.isInteger(new_count) || new_count < 0) return { error: "bad_count" };
    return { usage_qty: new_count * ps, count_entered: new_count, pack_size: ps };
  }
  if (!Number.isInteger(new_quantity) || new_quantity < 0) return { error: "bad_qty" };
  return { usage_qty: new_quantity, count_entered: null, pack_size: ps };
}

function countOnHand(quantity_on_hand, pack_size) {
  const ps = Number.isFinite(pack_size) && pack_size > 0 ? pack_size : 1;
  return ps > 1 ? Math.round(quantity_on_hand / ps) : quantity_on_hand;
}

const cases = [
  // [label, input, expected]
  ["Legacy each-level adjust: pack=1, new_quantity=5",
   { new_quantity: 5, pack_size: 1 },
   { usage_qty: 5, count_entered: null, pack_size: 1 }],
  ["Pack-aware adjust: pack=100, new_count=5 -> 500 tests",
   { new_count: 5, pack_size: 100 },
   { usage_qty: 500, count_entered: 5, pack_size: 100 }],
  ["Pack=1 ignores new_count vs new_quantity (no conversion)",
   { new_count: 5, pack_size: 1 },
   { usage_qty: 5, count_entered: 5, pack_size: 1 }],
  ["Pack=0 guard: falls back to 1",
   { new_count: 3, pack_size: 0 },
   { usage_qty: 3, count_entered: 3, pack_size: 1 }],
  ["Negative new_count rejected",
   { new_count: -1, pack_size: 100 },
   { error: "bad_count" }],
  ["Non-integer new_count rejected",
   { new_count: 2.5, pack_size: 100 },
   { error: "bad_count" }],
  ["Both missing rejected",
   { pack_size: 100 },
   { error: "missing" }],
];

const countCases = [
  ["count_on_hand for 500 tests with pack=100 = 5",
   { quantity_on_hand: 500, pack_size: 100 }, 5],
  ["count_on_hand for 450 tests with pack=100 rounds to 5",
   { quantity_on_hand: 450, pack_size: 100 }, 5],
  ["count_on_hand for 449 tests with pack=100 rounds to 4",
   { quantity_on_hand: 449, pack_size: 100 }, 4],
  ["count_on_hand for pack=1 = qty (no conversion)",
   { quantity_on_hand: 7, pack_size: 1 }, 7],
  ["count_on_hand for pack=0 guard = qty",
   { quantity_on_hand: 7, pack_size: 0 }, 7],
];

let pass = 0, fail = 0;
for (const [label, input, expected] of cases) {
  const got = adjust(input);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) console.log(`  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`);
  ok ? pass++ : fail++;
}
for (const [label, input, expected] of countCases) {
  const got = countOnHand(input.quantity_on_hand, input.pack_size);
  const ok = got === expected;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) console.log(`  expected ${expected}\n  got      ${got}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
