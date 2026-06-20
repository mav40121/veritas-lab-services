// scripts/verify-abc-stratification.js
//
// Math receipt for VeritaStock ABC stratification (client/src/pages/VeritaStockPage.tsx).
// Replicates the abcClassMap logic on a known input set and asserts the 80/15/5
// Pareto split, the boundary-crossing rule (crossing item lands in the higher
// class), and that zero-usage items are left unclassified.
//
//   node scripts/verify-abc-stratification.js

function classify(items) {
  const map = new Map();
  const ranked = items
    .map((i) => ({ id: i.id, val: (i.burn_rate || 0) * (i.unit_cost || 0) * 365 }))
    .filter((r) => r.val > 0)
    .sort((a, b) => b.val - a.val);
  const totalVal = ranked.reduce((s, r) => s + r.val, 0);
  if (totalVal <= 0) return map;
  let cum = 0;
  for (const r of ranked) {
    const startPct = cum / totalVal;
    cum += r.val;
    map.set(r.id, startPct < 0.8 ? "A" : startPct < 0.95 ? "B" : "C");
  }
  return map;
}

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${actual}, expected ${expected}`);
}

// Annual values (burn x cost x 365). Pick burn=1 so val == cost*365; relative
// ranking is what matters. Shares of total: 100/200=50, 50/200=25, 30/200=15,
// 15/200=7.5, 5/200=2.5.
// Cumulative-before-item: item1 0%, item2 50%, item3 75%, item4 90%, item5 97.5%.
//   item1 (0%)    < 0.8  -> A
//   item2 (50%)   < 0.8  -> A
//   item3 (75%)   < 0.8  -> A   (this item crosses 80% on the way out: stays A)
//   item4 (90%)   in 0.8..0.95 -> B
//   item5 (97.5%) >= 0.95 -> C
const items = [
  { id: 1, burn_rate: 1, unit_cost: 100 / 365 },
  { id: 2, burn_rate: 1, unit_cost: 50 / 365 },
  { id: 3, burn_rate: 1, unit_cost: 30 / 365 },
  { id: 4, burn_rate: 1, unit_cost: 15 / 365 },
  { id: 5, burn_rate: 1, unit_cost: 5 / 365 },
  { id: 6, burn_rate: 0, unit_cost: 999 },  // no burn -> no usage -> unclassified
  { id: 7, burn_rate: 5, unit_cost: 0 },    // no cost -> no usage -> unclassified
];

const m = classify(items);
check("item1 (50% of spend)", m.get(1), "A");
check("item2 (cum 75%)", m.get(2), "A");
check("item3 crosses 80% boundary, stays A", m.get(3), "A");
check("item4 (80-95% band)", m.get(4), "B");
check("item5 (final 5%)", m.get(5), "C");
check("item6 no burn -> unclassified", m.get(6), undefined);
check("item7 no cost -> unclassified", m.get(7), undefined);

// Empty / all-zero set must not throw and must classify nothing.
const empty = classify([{ id: 1, burn_rate: 0, unit_cost: 0 }]);
check("all-zero set yields empty map", empty.size, 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
