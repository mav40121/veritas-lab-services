// server/veritastockPfizerDemo.ts
//
// One-off seed for the temporary single-site "Pfizer Proposed" demo. Rewrites
// ONLY the Warehouse location (lab 2) with a laboratory-consumables catalog so
// the single-site demo reads for a lab/pharma audience. Deliberately isolated
// from server/veritastockDemoReset.ts (the San Carlos five-location baseline)
// so revert is unaffected: re-enabling the nightly reset (or running
// /api/admin/reset-demo) restores the San Carlos items from that untouched
// fixture.
//
// Barcodes use the SAME stable scheme as the reset (VLS-<lab_id*1000+code>), so
// Print Barcodes + Scan resolve correctly and any preprinted VLS-2001..2010
// labels still scan (reprint gives the new item names).
//
// SAFETY: hard-refuses unless STOCK_DEPLOYMENT, so it can never touch the main
// service's real customer labs.

const STOCK = process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";
const WAREHOUSE = 2; // the single "Pfizer Proposed" site

function isoPlusDays(now: Date, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// Generic laboratory / pharma consumables (real industry suppliers; no claim
// that these are any specific customer's SKUs). `code` (1-10) drives the stable
// barcode; NEVER renumber an existing code.
type PItem = {
  code: number; name: string; category: string; unit_cost: number;
  usage_unit: string; order_unit: string; units_per_order_unit: number;
  lead_time_days: number; safety_stock_days: number; desired_days_of_stock: number;
  vendor: string; catalog_number: string;
  qty: number; burn: number; expDays?: number; onOrder?: number; onOrderEtaDays?: number;
};

// reorder_point = burn * (lead + safety), computed downstream in veritabench.
// Heroes: media = expiry-driven (qty above par but short-dated); gloves /
// serological pipettes / syringe filters = below par; ELISA kit = below par + on-order.
const PFIZER_ITEMS: PItem[] = [
  { code: 1,  name: "Cell culture media, 500 mL bottle", category: "Reagent",     unit_cost: 28.00, usage_unit: "bottle", order_unit: "case", units_per_order_unit: 6,    lead_time_days: 18, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "Thermo Fisher",  catalog_number: "TF-CCM-500", qty: 600,   burn: 20,  expDays: 12 },
  { code: 2,  name: "Filtered pipette tips, 1000 uL (rack of 96)", category: "Consumable", unit_cost: 9.50, usage_unit: "rack",   order_unit: "case", units_per_order_unit: 10,   lead_time_days: 10, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Eppendorf",      catalog_number: "EP-TIP-1000", qty: 3000,  burn: 40,  expDays: 720 },
  { code: 3,  name: "Microcentrifuge tubes, 1.5 mL", category: "Consumable", unit_cost: 0.08, usage_unit: "tube",   order_unit: "case", units_per_order_unit: 500,  lead_time_days: 10, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Eppendorf",      catalog_number: "EP-MCT-1500", qty: 20000, burn: 300, expDays: 900 },
  { code: 4,  name: "Nitrile exam gloves", category: "PPE",       unit_cost: 0.06, usage_unit: "glove",  order_unit: "case", units_per_order_unit: 1000, lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "VWR",            catalog_number: "VWR-NIT-1000", qty: 5000,  burn: 320, expDays: 540 },
  { code: 5,  name: "ELISA assay reagent kit, 96-test", category: "Reagent", unit_cost: 240.00, usage_unit: "kit",  order_unit: "kit",  units_per_order_unit: 1,    lead_time_days: 21, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "Sigma-Aldrich",  catalog_number: "SA-ELISA-96", qty: 70,   burn: 3,   expDays: 180, onOrder: 100, onOrderEtaDays: 12 },
  { code: 6,  name: "Cryovials, 2 mL sterile", category: "Consumable", unit_cost: 0.35, usage_unit: "vial",  order_unit: "case", units_per_order_unit: 500,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Corning",        catalog_number: "CRN-CRYO-2", qty: 6000,  burn: 60,  expDays: 900 },
  { code: 7,  name: "Serological pipettes, 10 mL", category: "Consumable", unit_cost: 0.30, usage_unit: "pipette", order_unit: "case", units_per_order_unit: 200, lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Corning",        catalog_number: "CRN-SERO-10", qty: 700,   burn: 45,  expDays: 720 },
  { code: 8,  name: "PBS buffer 1X, 1 L", category: "Reagent",     unit_cost: 12.00, usage_unit: "bottle", order_unit: "case", units_per_order_unit: 6,    lead_time_days: 14, safety_stock_days: 5, desired_days_of_stock: 45, vendor: "Sigma-Aldrich",  catalog_number: "SA-PBS-1L", qty: 300,   burn: 6,   expDays: 300 },
  { code: 9,  name: "Syringe filters, 0.22 um", category: "Consumable", unit_cost: 1.40, usage_unit: "filter", order_unit: "box", units_per_order_unit: 50,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Sartorius",      catalog_number: "SAR-SF-022", qty: 300,   burn: 20,  expDays: 600 },
  { code: 10, name: "Specimen transport bags", category: "Consumable", unit_cost: 0.10, usage_unit: "bag",   order_unit: "box",  units_per_order_unit: 100,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Fisher Scientific", catalog_number: "FS-STB-100", qty: 1200, burn: 25,  expDays: 480 },
];

const PFIZER_VENDORS = [
  { name: "Thermo Fisher",     account_number: "PF-TF-0091",  ordering_pattern: "Portal", notes: "Media and reagents" },
  { name: "Eppendorf",         account_number: "PF-EP-0142",  ordering_pattern: "Portal", notes: "Pipette tips, tubes" },
  { name: "VWR",               account_number: "PF-VWR-0210", ordering_pattern: "EDI",    notes: "PPE and general lab" },
  { name: "Sigma-Aldrich",     account_number: "PF-SA-0335",  ordering_pattern: "Portal", notes: "Assay kits, buffers" },
  { name: "Corning",           account_number: "PF-CRN-0418", ordering_pattern: "EDI",    notes: "Cryovials, pipettes" },
  { name: "Sartorius",         account_number: "PF-SAR-0502", ordering_pattern: "Portal", notes: "Filtration" },
  { name: "Fisher Scientific", account_number: "PF-FS-0687",  ordering_pattern: "EDI",    notes: "Transport, consumables" },
];

export function seedPfizerSingleSiteDemo(sqlite: any, now: Date = new Date()): { ok: boolean; reason?: string; lab_id?: number; items?: number; barcodes?: string[] } {
  if (!STOCK) return { ok: false, reason: "refused: not the VeritaStock deployment (STOCK_DEPLOYMENT not set)" };
  const nowIso = now.toISOString();
  const barcodeFor = (code: number) => `VLS-${String(WAREHOUSE * 1000 + code).padStart(8, "0")}`;

  const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(WAREHOUSE) as any;
  if (!ownerRow) return { ok: false, reason: `lab ${WAREHOUSE} not found` };
  const accountId = ownerRow.owner_user_id ?? null;

  const insertItem = sqlite.prepare(`
    INSERT INTO inventory_items
      (account_id, lab_id, item_name, category, department, vendor, catalog_number, quantity_on_hand, unit, expiration_date,
       status, burn_rate, order_unit, usage_unit, units_per_order_unit, count_unit, units_per_count_unit,
       lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, unit_cost,
       on_order_qty, on_order_expected_date, on_order_placed_date, barcode_value, created_at, updated_at)
    VALUES (@account_id, @lab_id, @item_name, @category, @department, @vendor, @catalog_number, @qty, @unit, @exp,
       'active', @burn, @order_unit, @usage_unit, @upo, @usage_unit, 1,
       @lead, @safety, @desired, 0, @unit_cost, @on_order, @on_order_eta, @on_order_placed, @barcode, @now, @now)
  `);

  const barcodes: string[] = [];
  const tx = sqlite.transaction(() => {
    // Isolate lab 2: clear its inventory + demo vendors + trend snapshots + waste
    // + receipts, and any transfers touching it (the reset's pending WH->ED batch
    // references a lab-2 item that we are replacing). None of this touches the
    // other four locations, so the San Carlos revert reseeds them intact.
    sqlite.prepare("DELETE FROM inventory_items WHERE lab_id = ?").run(WAREHOUSE);
    for (const t of ["stock_vendors", "stock_vendor_contacts", "inventory_monthly_snapshots", "inventory_waste_events", "inventory_receipts"]) {
      try { sqlite.prepare(`DELETE FROM ${t} WHERE lab_id = ?`).run(WAREHOUSE); } catch {}
    }
    try { sqlite.prepare("DELETE FROM inventory_transfers WHERE from_lab_id = ? OR to_lab_id = ?").run(WAREHOUSE, WAREHOUSE); } catch {}

    for (const it of PFIZER_ITEMS) {
      const barcode = barcodeFor(it.code);
      barcodes.push(barcode);
      insertItem.run({
        account_id: accountId, lab_id: WAREHOUSE, item_name: it.name, category: it.category,
        department: "Materials Management", vendor: it.vendor, catalog_number: it.catalog_number,
        qty: it.qty, unit: it.usage_unit,
        exp: it.expDays != null ? isoPlusDays(now, it.expDays) : null,
        burn: it.burn, order_unit: it.order_unit, usage_unit: it.usage_unit, upo: it.units_per_order_unit,
        lead: it.lead_time_days, safety: it.safety_stock_days, desired: it.desired_days_of_stock,
        unit_cost: it.unit_cost, on_order: it.onOrder ?? 0,
        on_order_eta: it.onOrderEtaDays != null ? isoPlusDays(now, it.onOrderEtaDays) : null,
        on_order_placed: (it.onOrder && it.onOrderEtaDays != null)
          ? isoPlusDays(now, -Math.max(0, it.lead_time_days - it.onOrderEtaDays)) : null,
        barcode, now: nowIso,
      });
    }

    // Vendor Directory for lab 2 so it is never blank and the Order PDF cover fills.
    try {
      const insV = sqlite.prepare("INSERT INTO stock_vendors (lab_id, name, account_number, ordering_pattern, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)");
      for (const v of PFIZER_VENDORS) insV.run(WAREHOUSE, v.name, v.account_number, v.ordering_pattern, v.notes, nowIso, nowIso);
    } catch {}
  });
  tx();

  return { ok: true, lab_id: WAREHOUSE, items: PFIZER_ITEMS.length, barcodes };
}
