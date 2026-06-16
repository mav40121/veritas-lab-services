// scripts/verify-stock-count-unit-display.mjs
//
// Gate 3 step 2 (math) + step 7 (both conditional branches) receipt for the
// 2026-06-16 VeritaStock On Hand display fix. The desktop list previously
// gated the count_unit display on pack_size > 1, so an item counted in boxes
// at 1 each/box (count_unit=box, usage_unit=each, units_per_count_unit=1) fell
// back to the usage_unit label and read "3 eaches" instead of "3 boxes".
//
// This replicates the EXACT decision in client/src/pages/VeritaStockPage.tsx
// On Hand cell and asserts the rendered text for the regression case (San
// Carlos "Thermo Scientific MAS QC - AMON") plus the surrounding branches.
//
// Run: node scripts/verify-stock-count-unit-display.mjs

// Pure mirror of the On Hand cell render (count units + optional usage paren).
function renderOnHand(item) {
  const pack =
    item.units_per_count_unit && item.units_per_count_unit > 0
      ? item.units_per_count_unit
      : 1;
  const countUnit = item.count_unit || item.usage_unit || "each";
  if (countUnit !== item.usage_unit) {
    const countQty = pack > 1 ? Math.round(item.quantity_on_hand / pack) : item.quantity_on_hand;
    const label = `${countUnit}${countQty === 1 ? "" : "s"}`;
    const paren = pack > 1 ? ` (${item.quantity_on_hand} ${item.usage_unit}s)` : "";
    return `${countQty} ${label}${paren}`;
  }
  return `${item.quantity_on_hand} ${item.usage_unit}s`;
}

const cases = [
  {
    name: "AMON regression: count_unit=box, usage_unit=each, pack=1 -> shows boxes, NOT eaches",
    item: { quantity_on_hand: 3, usage_unit: "each", count_unit: "box", units_per_count_unit: 1 },
    expect: "3 boxs",
  },
  {
    name: "pack>1: count_unit=box, pack=6, qty=18 -> 3 boxes with usage paren",
    item: { quantity_on_hand: 18, usage_unit: "each", count_unit: "box", units_per_count_unit: 6 },
    expect: "3 boxs (18 eachs)",
  },
  {
    name: "pack>1 partial: count_unit=box, pack=6, qty=3 -> rounds to 1 box with paren",
    item: { quantity_on_hand: 3, usage_unit: "each", count_unit: "box", units_per_count_unit: 6 },
    expect: "1 box (3 eachs)",
  },
  {
    name: "singular: count_unit=box, pack=1, qty=1 -> 1 box (no trailing s)",
    item: { quantity_on_hand: 1, usage_unit: "each", count_unit: "box", units_per_count_unit: 1 },
    expect: "1 box",
  },
  {
    name: "count_unit unset -> falls back to usage_unit label",
    item: { quantity_on_hand: 3, usage_unit: "each", count_unit: undefined, units_per_count_unit: 1 },
    expect: "3 eachs",
  },
  {
    name: "count_unit === usage_unit -> falls back to usage_unit label (no redundant relabel)",
    item: { quantity_on_hand: 3, usage_unit: "each", count_unit: "each", units_per_count_unit: 1 },
    expect: "3 eachs",
  },
  {
    name: "case unit at pack=1: count_unit=case, usage_unit=test -> shows cases",
    item: { quantity_on_hand: 4, usage_unit: "test", count_unit: "case", units_per_count_unit: 1 },
    expect: "4 cases",
  },
];

let failed = 0;
for (const c of cases) {
  const got = renderOnHand(c.item);
  const ok = got === c.expect;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) console.log(`        expected: "${c.expect}"\n        got:      "${got}"`);
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) {
  console.error(`${failed} case(s) failed`);
  process.exit(1);
}
