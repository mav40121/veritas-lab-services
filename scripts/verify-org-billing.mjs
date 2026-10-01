// scripts/verify-org-billing.mjs
//
// Gate-3 receipt for the Phase-3b org billing core (server/organizationBilling.ts
// normalizeLineItems + computeOrgInvoice). Mirrors the pure logic. If you change
// it there, change this mirror too.
//
// Run: node scripts/verify-org-billing.mjs

function normalizeLineItems(input) {
  const errors = [];
  const items = [];
  if (!Array.isArray(input) || input.length === 0) { errors.push("lineItems[] (at least one) is required"); return { items, errors }; }
  input.forEach((li, i) => {
    const cents = li?.annualAmountCents;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) { errors.push(`lineItems[${i}].annualAmountCents must be a non-negative integer (cents)`); return; }
    const labId = li?.labId == null ? null : Number(li.labId);
    if (labId != null && (!Number.isInteger(labId) || labId <= 0)) { errors.push(`lineItems[${i}].labId must be a positive integer or null`); return; }
    items.push({ labId, description: li?.description != null ? String(li.description) : null, annualAmountCents: cents });
  });
  return { items, errors };
}
function computeOrgInvoice(items) {
  const totalCents = items.reduce((s, it) => s + (it.annualAmountCents || 0), 0);
  const perLab = items.filter((it) => it.labId != null);
  return { lineCount: items.length, labCount: perLab.length, totalCents, totalDollars: Math.round(totalCents) / 100, perLab };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); } };

// --- normalize / validate ---
eq("empty -> error", normalizeLineItems([]).errors.length > 0, true);
eq("float cents rejected", normalizeLineItems([{ labId: 1, annualAmountCents: 100.5 }]).errors.length, 1);
eq("negative cents rejected", normalizeLineItems([{ labId: 1, annualAmountCents: -1 }]).errors.length, 1);
eq("missing cents rejected", normalizeLineItems([{ labId: 1 }]).errors.length, 1);
eq("zero cents allowed (e.g. included site)", normalizeLineItems([{ labId: 1, annualAmountCents: 0 }]).errors.length, 0);
eq("bad labId rejected", normalizeLineItems([{ labId: -3, annualAmountCents: 100 }]).errors.length, 1);
eq("null labId allowed (org-level line)", normalizeLineItems([{ labId: null, annualAmountCents: 500 }]).errors.length, 0);
eq("string labId coerced", normalizeLineItems([{ labId: "4", annualAmountCents: 100 }]).items[0].labId, 4);

// --- invoice rollup ---
// A 3-lab system: $90k + $90k + $30k (repository included at 0) = $210,000/yr.
const sys = normalizeLineItems([
  { labId: 10, description: "Raleigh General", annualAmountCents: 9000000 },
  { labId: 11, description: "Beckley", annualAmountCents: 9000000 },
  { labId: 12, description: "System Repository", annualAmountCents: 0 },
]);
eq("system normalizes clean", sys.errors.length, 0);
const inv = computeOrgInvoice(sys.items);
eq("total cents summed", inv.totalCents, 18000000);
eq("total dollars", inv.totalDollars, 180000);
eq("lab count (lab-scoped lines)", inv.labCount, 3);

// org-level line (labId null) counts in total but not labCount
const mixed = normalizeLineItems([
  { labId: 10, annualAmountCents: 9000000 },
  { labId: null, description: "System SSO add-on", annualAmountCents: 1500000 },
]);
const inv2 = computeOrgInvoice(mixed.items);
eq("mixed total", inv2.totalCents, 10500000);
eq("mixed labCount excludes org-level line", inv2.labCount, 1);
eq("mixed lineCount includes all", inv2.lineCount, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
