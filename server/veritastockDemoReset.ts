// server/veritastockDemoReset.ts
//
// Canonical reset for the San Carlos VeritaStock demo. Restores the five
// locations to a known baseline: 10 supply-chain items distributed hub-and-spoke,
// a few hero conditions (near-expiry, on-order, reorder-now), and a 6-month
// inventory valuation history with waste in two months. Same payload is used for
// the one-time setup (admin endpoint) and the nightly auto-reset (index.ts).
//
// SAFETY: this deletes and rewrites inventory for specific lab IDs. On the main
// veritaslabservices.com service those IDs are REAL customer labs. The reset
// therefore hard-refuses unless STOCK_DEPLOYMENT is on, so it can only ever run
// on the isolated VeritaStock service.

export const STOCK_DEMO_IS_STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";

// Lab IDs on the VeritaStock service.
const WAREHOUSE = 2, ED = 3, BYLAS = 5, INPATIENT = 7, CLINIC = 8;
const EMPTY_LABS = [4, 6]; // Main Lab + Pharmacy: dropped from the demo, kept empty.
const DEMO_LABS = [WAREHOUSE, ED, BYLAS, INPATIENT, CLINIC];

// 10 SKUs. unit_cost is per usage unit.
type ItemSpec = {
  key: string; name: string; category: string; unit_cost: number;
  usage_unit: string; order_unit: string; units_per_order_unit: number;
  lead_time_days: number; safety_stock_days: number; desired_days_of_stock: number;
  vendor: string; catalog_number: string;
};
const ITEMS: Record<string, ItemSpec> = {
  RESP:   { key: "RESP",  name: "Rapid respiratory test cartridge", category: "Diagnostics",   unit_cost: 24.00, usage_unit: "test",  order_unit: "kit",  units_per_order_unit: 25,   lead_time_days: 21, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "Abbott",          catalog_number: "RESP-CART-25" },
  STRIP:  { key: "STRIP", name: "Glucometer test strips",           category: "Point of Care",  unit_cost: 0.85,  usage_unit: "strip", order_unit: "box",  units_per_order_unit: 50,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Roche Accu-Chek", catalog_number: "GLU-STRIP-50" },
  IVKIT:  { key: "IVKIT", name: "IV start kit",                      category: "Supply",         unit_cost: 4.20,  usage_unit: "kit",   order_unit: "case", units_per_order_unit: 20,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "IV-START-20" },
  SALINE: { key: "SALINE",name: "Normal saline 1000 mL IV bag",     category: "Supply",         unit_cost: 1.80,  usage_unit: "bag",   order_unit: "case", units_per_order_unit: 12,   lead_time_days: 10, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Baxter",          catalog_number: "NS-1000-12" },
  BCSET:  { key: "BCSET", name: "Blood culture bottle set",         category: "Diagnostics",    unit_cost: 7.20,  usage_unit: "set",   order_unit: "case", units_per_order_unit: 20,   lead_time_days: 21, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "BD BACTEC",       catalog_number: "BC-SET-20" },
  EDTA:   { key: "EDTA",  name: "EDTA collection tube",             category: "Supply",         unit_cost: 0.12,  usage_unit: "tube",  order_unit: "box",  units_per_order_unit: 100,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Greiner",         catalog_number: "EDTA-4ML-100" },
  DRESS:  { key: "DRESS", name: "Wound care dressing kit",          category: "Supply",         unit_cost: 6.50,  usage_unit: "kit",   order_unit: "case", units_per_order_unit: 10,   lead_time_days: 14, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "WND-DRESS-10" },
  GLOVE:  { key: "GLOVE", name: "Nitrile exam gloves",              category: "Supply",         unit_cost: 0.06,  usage_unit: "glove", order_unit: "case", units_per_order_unit: 1000, lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "GLV-NIT-1000" },
  PADS:   { key: "PADS",  name: "Alcohol prep pads",                category: "Supply",         unit_cost: 0.02,  usage_unit: "pad",   order_unit: "box",  units_per_order_unit: 200,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "ALC-PREP-200" },
  TRANS:  { key: "TRANS", name: "Specimen transport kit",           category: "Supply",         unit_cost: 0.55,  usage_unit: "kit",   order_unit: "box",  units_per_order_unit: 50,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Cardinal Health", catalog_number: "SPEC-TRANS-50" },
};

// Per-location distribution: [itemKey, qty, burn_rate/day, opts].
// opts.expDays = expiration that many days from today; opts.onOrder / onOrderEtaDays
// stage the hero conditions. The warehouse holds the bulk of all ten.
type Line = [string, number, number, { expDays?: number; onOrder?: number; onOrderEtaDays?: number }?];
const DIST: Record<number, Line[]> = {
  [WAREHOUSE]: [
    ["RESP", 400, 9, { expDays: 240 }],
    ["STRIP", 6000, 130, { expDays: 300 }],
    ["IVKIT", 1500, 45, { expDays: 540 }],
    ["SALINE", 2000, 60, { expDays: 420 }],
    ["BCSET", 800, 16, { expDays: 200, onOrder: 200, onOrderEtaDays: 12 }],
    ["EDTA", 13000, 360, { expDays: 600 }],
    ["DRESS", 500, 10, { expDays: 540 }],
    ["GLOVE", 12000, 320, { expDays: 720 }],
    ["PADS", 20000, 300, { expDays: 720 }],
    ["TRANS", 1200, 20, { expDays: 480 }],
  ],
  [ED]: [
    ["RESP", 60, 4, { expDays: 90 }],
    ["BCSET", 200, 7, { expDays: 120 }],
    ["IVKIT", 400, 14, {}],
    ["SALINE", 300, 12, {}],
    ["GLOVE", 8000, 240, {}],
    ["EDTA", 1500, 60, {}],
    ["TRANS", 500, 12, {}],
    ["STRIP", 300, 10, { expDays: 40 }],
  ],
  [INPATIENT]: [
    ["SALINE", 800, 28, {}],
    ["IVKIT", 500, 16, {}],
    ["DRESS", 120, 5, {}],
    ["GLOVE", 6000, 180, {}],
    ["EDTA", 1200, 45, {}],
    ["STRIP", 250, 8, {}],
  ],
  [BYLAS]: [
    ["RESP", 40, 2, { expDays: 75 }],
    ["STRIP", 800, 18, {}],
    ["GLOVE", 5000, 150, {}],
    ["EDTA", 1000, 30, {}],
    ["TRANS", 400, 10, {}],
    ["DRESS", 100, 3, {}],
  ],
  [CLINIC]: [
    ["RESP", 50, 5, { expDays: 20 }],   // near-expiry hero: motivates the live write-off
    ["STRIP", 700, 16, {}],
    ["GLOVE", 4000, 120, {}],
    ["EDTA", 900, 28, {}],
    ["TRANS", 350, 9, {}],
    ["IVKIT", 80, 5, {}],
  ],
};

// 6-month trend shape: month value = current value x factor (gentle decline as
// the network optimizes working capital). Index 0 = 5 months ago ... 5 = current.
const TREND_FACTORS = [1.12, 1.10, 1.07, 1.04, 1.01, 1.00];
// Waste dollars by lab, by month index. Concentrated in months 1 and 2 (the
// "before" period); zero afterward to show waste driven to zero once expiry
// visibility kicked in. Months 3-5 (incl current) are 0 at reset.
const WASTE: Record<number, Record<number, { value: number; note: string }>> = {
  [CLINIC]:    { 1: { value: 1200, note: "Rapid respiratory cartridges expired" } },
  [INPATIENT]: { 1: { value: 640,  note: "Saline IV bags expired" } },
  [ED]:        { 2: { value: 1350, note: "Glucometer strips expired" } },
  [WAREHOUSE]: { 2: { value: 960,  note: "Blood culture sets expired" } },
};

function ymOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function lastSixMonths(now: Date): string[] {
  const out: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(ymOf(d));
  }
  return out;
}
function isoPlusDays(now: Date, days: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function resetVeritaStockDemo(sqlite: any, now: Date = new Date()): { ok: boolean; reason?: string; labs?: any[]; months?: string[] } {
  if (!STOCK_DEMO_IS_STOCK_DEPLOYMENT) {
    return { ok: false, reason: "refused: not the VeritaStock deployment (STOCK_DEPLOYMENT not set)" };
  }
  const months = lastSixMonths(now);
  const nowIso = now.toISOString();

  const insertItem = sqlite.prepare(`
    INSERT INTO inventory_items
      (account_id, lab_id, item_name, category, department, vendor, catalog_number, quantity_on_hand, unit, expiration_date,
       status, burn_rate, order_unit, usage_unit, units_per_order_unit, count_unit, units_per_count_unit,
       lead_time_days, safety_stock_days, desired_days_of_stock, standing_order, unit_cost,
       on_order_qty, on_order_expected_date, created_at, updated_at)
    VALUES (@account_id, @lab_id, @item_name, @category, @department, @vendor, @catalog_number, @qty, @unit, @exp,
       'active', @burn, @order_unit, @usage_unit, @upo, @usage_unit, 1,
       @lead, @safety, @desired, 0, @unit_cost, @on_order, @on_order_eta, @now, @now)
  `);
  const upsertSnap = sqlite.prepare(`
    INSERT INTO inventory_monthly_snapshots
      (lab_id, year_month, avg_value_on_hand, opening_value, closing_value, waste_value, waste_note, created_at, updated_at)
    VALUES (@lab_id, @ym, @val, @val, @val, @waste, @note, @now, @now)
    ON CONFLICT(lab_id, year_month) DO UPDATE SET
      avg_value_on_hand = excluded.avg_value_on_hand,
      opening_value = excluded.opening_value,
      closing_value = excluded.closing_value,
      waste_value = excluded.waste_value,
      waste_note = excluded.waste_note,
      updated_at = excluded.updated_at
  `);

  const summary: any[] = [];
  const tx = sqlite.transaction(() => {
    // Rename Bylas (drop the "Lab" framing) and empty the dropped locations.
    try { sqlite.prepare("UPDATE labs SET lab_name = ?, updated_at = ? WHERE id = ?").run("Bylas Health Center", nowIso, BYLAS); } catch {}
    for (const lid of EMPTY_LABS) sqlite.prepare("DELETE FROM inventory_items WHERE lab_id = ?").run(lid);
    // Clear demo waste events for a clean ledger each reset.
    sqlite.prepare(`DELETE FROM inventory_waste_events WHERE lab_id IN (${DEMO_LABS.join(",")})`).run();

    for (const labId of DEMO_LABS) {
      const ownerRow = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any;
      const accountId = ownerRow?.owner_user_id ?? null;
      sqlite.prepare("DELETE FROM inventory_items WHERE lab_id = ?").run(labId);
      for (const [key, qty, burn, opts] of DIST[labId]) {
        const it = ITEMS[key];
        const o = opts || {};
        insertItem.run({
          account_id: accountId, lab_id: labId, item_name: it.name, category: it.category,
          department: "Materials Management", vendor: it.vendor, catalog_number: it.catalog_number, qty, unit: it.usage_unit,
          exp: o.expDays != null ? isoPlusDays(now, o.expDays) : null,
          burn, order_unit: it.order_unit, usage_unit: it.usage_unit, upo: it.units_per_order_unit,
          lead: it.lead_time_days, safety: it.safety_stock_days, desired: it.desired_days_of_stock,
          unit_cost: it.unit_cost, on_order: o.onOrder ?? 0,
          on_order_eta: o.onOrderEtaDays != null ? isoPlusDays(now, o.onOrderEtaDays) : null,
          now: nowIso,
        });
      }
      // Canonical barcodes for any fresh rows.
      try { sqlite.prepare("UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE lab_id = ? AND (barcode_value IS NULL OR barcode_value = '')").run(labId); } catch {}

      // Current value = basis for the trend's latest month.
      const curVal = (sqlite.prepare("SELECT COALESCE(SUM(quantity_on_hand * unit_cost),0) AS v FROM inventory_items WHERE lab_id = ?").get(labId) as any)?.v || 0;
      months.forEach((ym, idx) => {
        const val = Math.round(curVal * TREND_FACTORS[idx]);
        const w = WASTE[labId]?.[idx];
        upsertSnap.run({ lab_id: labId, ym, val, waste: w?.value ?? 0, note: w?.note ?? null, now: nowIso });
      });
      summary.push({ lab_id: labId, items: DIST[labId].length, current_value: Math.round(curVal) });
    }
  });
  tx();
  return { ok: true, labs: summary, months };
}
