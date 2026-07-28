// scripts/verify-pfizer-demo.mjs
//
// Receipt for the single-site "Pfizer Proposed" seed (server/veritastockPfizerDemo.ts).
// Recomputes the reorder decision the app makes (veritabench.decorateInventoryItem):
//   reorder_point    = burn * (lead + safety)
//   usable_on_hand   = min(qty, burn * days_until_expiry)   (expiry cap)
//   effective_pos    = usable_on_hand + on_order
//   needs_reorder    = effective_pos <= reorder_point
// and asserts the intended demo heroes. Also checks the stable barcodes are the
// 10 unique VLS-0000200x values. Exits non-zero on any failure.
//
//   node scripts/verify-pfizer-demo.mjs

const WAREHOUSE = 2;
const barcodeFor = (code) => `VLS-${String(WAREHOUSE * 1000 + code).padStart(8, "0")}`;

// Mirror of PFIZER_ITEMS (code, name, qty, burn, lead, safety, expDays, onOrder).
const ITEMS = [
  { code: 1,  name: "Cell culture media, 500 mL bottle",           qty: 600,   burn: 20,  lead: 18, safety: 7, expDays: 12,  onOrder: 0 },
  { code: 2,  name: "Filtered pipette tips, 1000 uL (rack of 96)", qty: 3000,  burn: 40,  lead: 10, safety: 5, expDays: 720, onOrder: 0 },
  { code: 3,  name: "Microcentrifuge tubes, 1.5 mL",               qty: 20000, burn: 300, lead: 10, safety: 5, expDays: 900, onOrder: 0 },
  { code: 4,  name: "Nitrile exam gloves",                         qty: 5000,  burn: 320, lead: 12, safety: 5, expDays: 540, onOrder: 0 },
  { code: 5,  name: "ELISA assay reagent kit, 96-test",            qty: 70,    burn: 3,   lead: 21, safety: 7, expDays: 180, onOrder: 100 },
  { code: 6,  name: "Cryovials, 2 mL sterile",                     qty: 6000,  burn: 60,  lead: 12, safety: 5, expDays: 900, onOrder: 0 },
  { code: 7,  name: "Serological pipettes, 10 mL",                 qty: 700,   burn: 45,  lead: 12, safety: 5, expDays: 720, onOrder: 0 },
  { code: 8,  name: "PBS buffer 1X, 1 L",                          qty: 300,   burn: 6,   lead: 14, safety: 5, expDays: 300, onOrder: 0 },
  { code: 9,  name: "Syringe filters, 0.22 um",                    qty: 300,   burn: 20,  lead: 12, safety: 5, expDays: 600, onOrder: 0 },
  { code: 10, name: "Specimen transport bags",                    qty: 1200,  burn: 25,  lead: 12, safety: 5, expDays: 480, onOrder: 0 },
];

let failures = 0;
const check = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) failures++; };

const decorate = (it) => {
  const reorder_point = it.burn * (it.lead + it.safety);
  const usable = Math.min(it.qty, it.burn * it.expDays);
  const effective = usable + it.onOrder;
  const needs_reorder = effective <= reorder_point;
  const expiry_driven = needs_reorder && it.qty > reorder_point; // raw stock looks fine, expiry forced it
  return { reorder_point, usable, effective, needs_reorder, expiry_driven };
};

// Barcodes: 10 unique, exact scheme.
const barcodes = ITEMS.map((i) => barcodeFor(i.code));
check("10 items", ITEMS.length === 10);
check("barcodes unique", new Set(barcodes).size === 10);
check("barcode scheme VLS-00002001..00002010", barcodes[0] === "VLS-00002001" && barcodes[9] === "VLS-00002010");

const reorderNames = ITEMS.filter((i) => decorate(i).needs_reorder).map((i) => i.name).sort();
const expected = [
  "Cell culture media, 500 mL bottle",
  "Nitrile exam gloves",
  "Serological pipettes, 10 mL",
  "Syringe filters, 0.22 um",
].sort();
check(`Reorder Now = 4 heroes (got ${reorderNames.length})`, JSON.stringify(reorderNames) === JSON.stringify(expected));

// Media is the expiry-driven hero: raw qty above par, but short-dated -> flagged.
const media = decorate(ITEMS[0]);
check("media expiry-driven (qty>reorder_point but usable<=reorder_point)", media.expiry_driven === true && ITEMS[0].qty > media.reorder_point && media.usable <= media.reorder_point);

// ELISA: below par on raw stock but on-order covers it -> NOT reorder (on-order story).
const elisa = decorate(ITEMS[4]);
check("ELISA not reorder because on-order covers it", elisa.needs_reorder === false && ITEMS[4].qty < elisa.reorder_point);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
