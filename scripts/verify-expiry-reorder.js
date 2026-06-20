// scripts/verify-expiry-reorder.js
//
// Math receipt for expiry-aware reordering (decorateInventoryItem in
// server/veritabench.ts). An item flags for reorder when its EFFECTIVE
// position falls to or below the reorder point, where effective position caps
// usable on-hand at burn_rate * days_until_expiry and adds (uncapped) on-order.
// This proves the demo hero (plenty on the shelf, but short-dated) flags for
// reorder, and that no-expiry / zero-burn / inbound-stock cases are unchanged.
//
//   node scripts/verify-expiry-reorder.js

// Pure mirror of the decorateInventoryItem reorder math. Kept in lockstep with
// server/veritabench.ts; if that changes, change this and re-run.
function decorate({ onHand, onOrder = 0, burn, lead, safety, desired, daysToExpiry = null, upu = 1 }) {
  const inventoryPosition = onHand + onOrder;
  const reorderPoint = burn * (lead + safety);
  const orderToQty = burn * desired;
  const usableOnHand = (burn > 0 && daysToExpiry !== null)
    ? Math.max(0, Math.min(onHand, burn * daysToExpiry))
    : onHand;
  const effectivePosition = usableOnHand + onOrder;
  const belowPar = inventoryPosition <= reorderPoint;
  const needsReorder = effectivePosition <= reorderPoint;
  const expiryDrivenReorder = needsReorder && !belowPar;
  const reorderReason = !needsReorder ? null : (belowPar ? "Below reorder point" : "Expiring lot");
  const shortfall = Math.max(0, Math.round(orderToQty) - effectivePosition);
  const suggestedOrderPacks = upu > 1 ? Math.ceil(shortfall / upu) : shortfall;
  return {
    reorderPoint: Math.round(reorderPoint),
    effectivePosition: Math.round(effectivePosition),
    needsReorder, expiryDrivenReorder, reorderReason,
    shortfall, suggestedOrderPacks,
  };
}

const cases = [
  {
    name: "Expiry-driven hero: 6000 strips, 46d nominal supply, lot expires in 14d",
    in: { onHand: 6000, burn: 130, lead: 12, safety: 5, desired: 30, daysToExpiry: 14, upu: 50 },
    expect: { reorderPoint: 2210, effectivePosition: 1820, needsReorder: true, expiryDrivenReorder: true, reorderReason: "Expiring lot" },
  },
  {
    name: "Below-par by quantity, expiry far out (unchanged behavior)",
    in: { onHand: 700, burn: 45, lead: 12, safety: 5, desired: 30, daysToExpiry: 540, upu: 20 },
    expect: { reorderPoint: 765, effectivePosition: 700, needsReorder: true, expiryDrivenReorder: false, reorderReason: "Below reorder point" },
  },
  {
    name: "Healthy: plenty of stock, expiry far out -> no reorder",
    in: { onHand: 20000, burn: 300, lead: 12, safety: 5, desired: 30, daysToExpiry: 720, upu: 200 },
    expect: { needsReorder: false, expiryDrivenReorder: false, reorderReason: null },
  },
  {
    name: "No expiration date: identical to quantity-only logic (healthy)",
    in: { onHand: 100, burn: 5, lead: 10, safety: 3, desired: 30, daysToExpiry: null },
    expect: { reorderPoint: 65, effectivePosition: 100, needsReorder: false, reorderReason: null },
  },
  {
    name: "No expiration date, low quantity: below par (backward compatible)",
    in: { onHand: 50, burn: 5, lead: 10, safety: 3, desired: 30, daysToExpiry: null },
    expect: { reorderPoint: 65, effectivePosition: 50, needsReorder: true, expiryDrivenReorder: false, reorderReason: "Below reorder point" },
  },
  {
    name: "Zero burn, near expiry: never expiry-triggers (you are not using it)",
    in: { onHand: 100, burn: 0, lead: 10, safety: 3, desired: 30, daysToExpiry: 5 },
    expect: { reorderPoint: 0, effectivePosition: 100, needsReorder: false, reorderReason: null },
  },
  {
    name: "Short-dated lot but fresh inbound on-order covers it -> no double order",
    in: { onHand: 6000, onOrder: 3000, burn: 130, lead: 12, safety: 5, desired: 30, daysToExpiry: 14, upu: 50 },
    expect: { effectivePosition: 4820, needsReorder: false, reorderReason: null },
  },
];

let failed = 0;
for (const c of cases) {
  const got = decorate(c.in);
  const diffs = [];
  for (const [k, v] of Object.entries(c.expect)) {
    if (got[k] !== v) diffs.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
  }
  if (diffs.length) {
    failed++;
    console.log(`FAIL  ${c.name}`);
    diffs.forEach((d) => console.log(`        ${d}`));
  } else {
    console.log(`PASS  ${c.name}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
