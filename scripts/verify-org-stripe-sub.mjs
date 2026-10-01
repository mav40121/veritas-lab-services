// scripts/verify-org-stripe-sub.mjs
//
// Gate-3 receipt for the Phase-3d Stripe subscription builder
// (server/organizationBilling.ts buildOrgSubscriptionItems). Mirrors the pure
// logic. If you change it there, change this mirror too. The live Stripe call
// itself is exercised in Stripe TEST mode, not here.
//
// Run: node scripts/verify-org-stripe-sub.mjs

function buildOrgSubscriptionItems(items, currency = "usd") {
  return items.map((it) => ({
    price_data: {
      currency,
      unit_amount: it.annualAmountCents,
      recurring: { interval: "year" },
      product_data: { name: it.description || (it.labId != null ? `Lab ${it.labId}` : "System line item") },
    },
    quantity: 1,
    metadata: it.labId != null ? { labId: String(it.labId) } : {},
  }));
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); } };

const items = [
  { labId: 10, description: "Raleigh General", annualAmountCents: 9000000 },
  { labId: 11, description: "Beckley", annualAmountCents: 9000000 },
  { labId: 12, description: "System Repository", annualAmountCents: 0 },
  { labId: null, description: "System SSO add-on", annualAmountCents: 1500000 },
];
const subs = buildOrgSubscriptionItems(items);

eq("one sub item per line item", subs.length, 4);
eq("unit_amount carried (cents)", subs[0].price_data.unit_amount, 9000000);
eq("yearly recurring", subs[0].price_data.recurring.interval, "year");
eq("product name from description", subs[0].price_data.product_data.name, "Raleigh General");
eq("zero-amount line kept ($0 item)", subs[2].price_data.unit_amount, 0);
eq("per-lab metadata set", subs[0].metadata, { labId: "10" });
eq("org-level line (null lab) -> empty metadata", subs[3].metadata, {});
eq("org-level line name falls back to description", subs[3].price_data.product_data.name, "System SSO add-on");
eq("default currency usd", subs[0].price_data.currency, "usd");

// custom currency honored
const eur = buildOrgSubscriptionItems([{ labId: 1, description: "X", annualAmountCents: 100 }], "eur");
eq("custom currency honored", eur[0].price_data.currency, "eur");

// a line with no description and a lab -> synthesized name
const noDesc = buildOrgSubscriptionItems([{ labId: 7, description: null, annualAmountCents: 500 }]);
eq("no description -> Lab <id> name", noDesc[0].price_data.product_data.name, "Lab 7");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
