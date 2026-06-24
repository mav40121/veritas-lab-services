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

// 10 SKUs. unit_cost is per usage unit. `code` is a STABLE per-SKU ordinal
// (1-10) used to derive a deterministic barcode_value that does NOT depend on
// the auto-increment row id. The reset deletes and re-inserts every demo item,
// so an id-derived barcode (VLS-<id>) changed on every reset and invalidated
// any preprinted labels. Deriving barcode_value from (lab_id, code) keeps the
// printed barcode identical across every reset. NEVER renumber an existing
// code: doing so re-issues that item's barcode and breaks labels in the field.
type ItemSpec = {
  key: string; code: number; name: string; category: string; unit_cost: number;
  usage_unit: string; order_unit: string; units_per_order_unit: number;
  lead_time_days: number; safety_stock_days: number; desired_days_of_stock: number;
  vendor: string; catalog_number: string;
};
const ITEMS: Record<string, ItemSpec> = {
  RESP:   { key: "RESP",  code: 1,  name: "Rapid respiratory test cartridge", category: "Diagnostics",   unit_cost: 24.00, usage_unit: "test",  order_unit: "kit",  units_per_order_unit: 25,   lead_time_days: 21, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "Abbott",          catalog_number: "RESP-CART-25" },
  STRIP:  { key: "STRIP", code: 2,  name: "Glucometer test strips",           category: "Point of Care",  unit_cost: 0.85,  usage_unit: "strip", order_unit: "box",  units_per_order_unit: 50,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Roche Accu-Chek", catalog_number: "GLU-STRIP-50" },
  IVKIT:  { key: "IVKIT", code: 3,  name: "IV start kit",                      category: "Supply",         unit_cost: 4.20,  usage_unit: "kit",   order_unit: "case", units_per_order_unit: 20,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "IV-START-20" },
  SALINE: { key: "SALINE",code: 4,  name: "Normal saline 1000 mL IV bag",     category: "Supply",         unit_cost: 1.80,  usage_unit: "bag",   order_unit: "case", units_per_order_unit: 12,   lead_time_days: 10, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Baxter",          catalog_number: "NS-1000-12" },
  BCSET:  { key: "BCSET", code: 5,  name: "Blood culture bottle set",         category: "Diagnostics",    unit_cost: 7.20,  usage_unit: "set",   order_unit: "case", units_per_order_unit: 20,   lead_time_days: 21, safety_stock_days: 7, desired_days_of_stock: 45, vendor: "BD BACTEC",       catalog_number: "BC-SET-20" },
  EDTA:   { key: "EDTA",  code: 6,  name: "EDTA collection tube",             category: "Supply",         unit_cost: 0.12,  usage_unit: "tube",  order_unit: "box",  units_per_order_unit: 100,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Greiner",         catalog_number: "EDTA-4ML-100" },
  DRESS:  { key: "DRESS", code: 7,  name: "Wound care dressing kit",          category: "Supply",         unit_cost: 6.50,  usage_unit: "kit",   order_unit: "case", units_per_order_unit: 10,   lead_time_days: 14, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "WND-DRESS-10" },
  GLOVE:  { key: "GLOVE", code: 8,  name: "Nitrile exam gloves",              category: "Supply",         unit_cost: 0.06,  usage_unit: "glove", order_unit: "case", units_per_order_unit: 1000, lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "GLV-NIT-1000" },
  PADS:   { key: "PADS",  code: 9,  name: "Alcohol prep pads",                category: "Supply",         unit_cost: 0.02,  usage_unit: "pad",   order_unit: "box",  units_per_order_unit: 200,  lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Medline",         catalog_number: "ALC-PREP-200" },
  TRANS:  { key: "TRANS", code: 10, name: "Specimen transport kit",           category: "Supply",         unit_cost: 0.55,  usage_unit: "kit",   order_unit: "box",  units_per_order_unit: 50,   lead_time_days: 12, safety_stock_days: 5, desired_days_of_stock: 30, vendor: "Cardinal Health", catalog_number: "SPEC-TRANS-50" },
};

// Per-location distribution: [itemKey, qty, burn_rate/day, opts].
// opts.expDays = expiration that many days from today; opts.onOrder / onOrderEtaDays
// stage the hero conditions. The warehouse holds the bulk of all ten.
type Line = [string, number, number, { expDays?: number; onOrder?: number; onOrderEtaDays?: number }?];
const DIST: Record<number, Line[]> = {
  [WAREHOUSE]: [
    ["RESP", 400, 9, { expDays: 240 }],
    // Expiry-driven reorder hero: 6000 strips is ~46 days of supply at 130/day,
    // well above the ~2210 reorder point, so quantity alone would NOT flag it.
    // But this lot expires in 14 days, so only ~1820 are usable before expiry.
    // VeritaStock surfaces it in Reorder Now ("Expiring lot") even though the
    // shelf looks full: sufficient quantity on hand, but short-dated.
    ["STRIP", 6000, 130, { expDays: 14 }],
    // Four items intentionally below reorder point (burn x (lead+safety)) across
    // two vendors so the Reorder Now tile + vendor-grouped Order PDF populate:
    // IVKIT/GLOVE/DRESS = Medline, SALINE = Baxter.
    ["IVKIT", 700, 45, { expDays: 540 }],    // reorder pt 765
    ["SALINE", 800, 60, { expDays: 420 }],   // reorder pt 900
    ["BCSET", 800, 16, { expDays: 200, onOrder: 200, onOrderEtaDays: 12 }],
    ["EDTA", 13000, 360, { expDays: 600 }],
    ["DRESS", 150, 10, { expDays: 540 }],    // reorder pt 190
    ["GLOVE", 5000, 320, { expDays: 720 }],  // reorder pt 5440
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

// Vendor directory records (the 7 real San Carlos vendors). Account numbers are
// clearly-demo (SCAHC- prefix); no fabricated emails/phones. Seeded per location
// so the Vendor Directory is never blank and the Order PDF auto-fills its cover.
const VENDORS: Array<{ name: string; account_number: string; ordering_pattern: string; notes: string }> = [
  { name: "Medline", account_number: "SCAHC-MED-0042", ordering_pattern: "EDI / punchout", notes: "Primary med-surg distributor" },
  { name: "Baxter", account_number: "SCAHC-BAX-1187", ordering_pattern: "Online portal", notes: "IV solutions" },
  { name: "BD BACTEC", account_number: "SCAHC-BD-3320", ordering_pattern: "Online portal", notes: "Blood culture media" },
  { name: "Abbott", account_number: "SCAHC-ABT-5561", ordering_pattern: "Rep + portal", notes: "Rapid diagnostics" },
  { name: "Roche Accu-Chek", account_number: "SCAHC-RAC-7790", ordering_pattern: "Online portal", notes: "Glucose monitoring" },
  { name: "Greiner", account_number: "SCAHC-GBO-2204", ordering_pattern: "Distributor", notes: "Specimen collection tubes" },
  { name: "Cardinal Health", account_number: "SCAHC-CAH-6615", ordering_pattern: "EDI", notes: "Distribution" },
];

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
       on_order_qty, on_order_expected_date, on_order_placed_date, barcode_value, created_at, updated_at)
    VALUES (@account_id, @lab_id, @item_name, @category, @department, @vendor, @catalog_number, @qty, @unit, @exp,
       'active', @burn, @order_unit, @usage_unit, @upo, @usage_unit, 1,
       @lead, @safety, @desired, 0, @unit_cost, @on_order, @on_order_eta, @on_order_placed, @barcode, @now, @now)
  `);
  // Deterministic barcode: VLS-<8 digits> where the number is lab_id * 1000 +
  // the SKU's stable `code`. Independent of the auto-increment row id, so the
  // SAME label scans the SAME item after every reset. The scanner resolves by
  // exact barcode_value string (lab-scoped), so this stays in lockstep with the
  // printed label. lab_id < 1000 and code <= 10 guarantees no cross-location
  // collision (warehouse 2 -> VLS-00002001..010, ED 3 -> VLS-00003001..010).
  const barcodeFor = (labId: number, code: number) => `VLS-${String(labId * 1000 + code).padStart(8, "0")}`;
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
    // Remove the two dropped locations ENTIRELY (inventory + memberships + lab
    // row + orphan demo data) so they vanish from the location switcher and the
    // Enterprise roll-up, not just show as empty.
    for (const lid of EMPTY_LABS) {
      for (const t of ["inventory_items", "stock_vendors", "stock_vendor_contacts", "inventory_monthly_snapshots", "inventory_waste_events", "lab_members"]) {
        try { sqlite.prepare(`DELETE FROM ${t} WHERE lab_id = ?`).run(lid); } catch {}
      }
      try { sqlite.prepare("DELETE FROM labs WHERE id = ?").run(lid); } catch {}
    }
    // Clear stale transfer history (old lab-reagent transfers leaked into the
    // Enterprise view). Demo DB, so a full clear is safe.
    try { sqlite.prepare("DELETE FROM inventory_transfers").run(); } catch {}
    // Clear demo waste events for a clean ledger each reset.
    sqlite.prepare(`DELETE FROM inventory_waste_events WHERE lab_id IN (${DEMO_LABS.join(",")})`).run();
    // Clear demo receipt history each reset (any visitor receives + test residue);
    // seeded lead-time history is added back per item below where applicable.
    try { sqlite.prepare(`DELETE FROM inventory_receipts WHERE lab_id IN (${DEMO_LABS.join(",")})`).run(); } catch {}

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
          barcode: barcodeFor(labId, it.code),
          on_order_eta: o.onOrderEtaDays != null ? isoPlusDays(now, o.onOrderEtaDays) : null,
          // Placed date for an in-flight PO is back-dated so placed + lead = ETA
          // (e.g. 21-day lead, ETA in 12 days => placed 9 days ago). Lets the
          // Receiving screen show a real Order Placed date and a coherent receipt.
          on_order_placed: (o.onOrder && o.onOrderEtaDays != null)
            ? isoPlusDays(now, -Math.max(0, it.lead_time_days - o.onOrderEtaDays))
            : null,
          now: nowIso,
        });
      }
      // Barcodes are assigned deterministically in the INSERT above (VLS-<lab*1000+code>),
      // so there is no id-derived backfill here. Re-running the reset re-issues the
      // exact same barcode for each item, keeping any preprinted labels valid.

      // Seed the Vendor Directory for this location so it is never blank and the
      // Order PDF cover auto-fills. Replace any prior demo rows first.
      try {
        sqlite.prepare("DELETE FROM stock_vendors WHERE lab_id = ?").run(labId);
        const insV = sqlite.prepare("INSERT INTO stock_vendors (lab_id, name, account_number, ordering_pattern, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)");
        for (const v of VENDORS) insV.run(labId, v.name, v.account_number, v.ordering_pattern, v.notes, nowIso, nowIso);
      } catch {}

      // Current value = basis for the trend's latest month.
      const curVal = (sqlite.prepare("SELECT COALESCE(SUM(quantity_on_hand * unit_cost),0) AS v FROM inventory_items WHERE lab_id = ?").get(labId) as any)?.v || 0;
      months.forEach((ym, idx) => {
        const val = Math.round(curVal * TREND_FACTORS[idx]);
        const w = WASTE[labId]?.[idx];
        upsertSnap.run({ lab_id: labId, ym, val, waste: w?.value ?? 0, note: w?.note ?? null, now: nowIso });
      });
      summary.push({ lab_id: labId, items: DIST[labId].length, current_value: Math.round(curVal) });
    }

    // Seed ONE pending Warehouse -> ED shipment so the demo's two-phase
    // ship->accept beat (the destination Accepts/Rejects from the Incoming
    // panel) is always present and self-heals every reset. Without this the
    // hero batch had to be created by hand and vanished at the next reset.
    // Mirrors the live transfer-batch send exactly: stock leaves the Warehouse
    // source NOW (in transit, debited from on_hand) and lands at ED only when
    // the destination Accepts. Matches the prior hand-made batch (BC sets + prep
    // pads) so the rehearsed demo is unchanged. (All inventory_transfers were
    // cleared above, so this is the only pending batch after a reset.)
    const stockOwner = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(WAREHOUSE) as any)?.owner_user_id;
    if (stockOwner != null) {
      const PENDING_BATCH_ID = "demo-pending-wh-ed";
      const initiator = (sqlite.prepare("SELECT email FROM users WHERE id = ?").get(stockOwner) as any)?.email || `user ${stockOwner}`;
      // [itemKey, qty in usage units] — qty leaves the Warehouse on send.
      const PENDING_LINES: Array<[string, number]> = [["BCSET", 3], ["PADS", 5]];
      const insPending = sqlite.prepare(`
        INSERT INTO inventory_transfers
          (owner_user_id, from_lab_id, to_lab_id, from_item_id, to_item_id,
           catalog_number, item_name, qty_usage_units, display_qty, display_unit,
           status, batch_id, initiated_by_user_id, initiated_by_name, notes, created_at)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL, ?)
      `);
      for (const [key, qty] of PENDING_LINES) {
        const it = ITEMS[key];
        const srcRow = sqlite.prepare("SELECT id, quantity_on_hand FROM inventory_items WHERE lab_id = ? AND item_name = ?").get(WAREHOUSE, it.name) as any;
        if (!srcRow) continue;
        // Stock leaves the source now (in transit), exactly like a live send.
        sqlite.prepare("UPDATE inventory_items SET quantity_on_hand = ?, updated_at = ? WHERE id = ?")
          .run(Math.max(0, srcRow.quantity_on_hand - qty), nowIso, srcRow.id);
        insPending.run(stockOwner, WAREHOUSE, ED, srcRow.id, it.catalog_number, it.name, qty, qty, it.usage_unit, PENDING_BATCH_ID, stockOwner, initiator, nowIso);
      }
    }

    // Seed receipt history at the Warehouse so the lead-time drift flag shows
    // live. RESP (Abbott, programmed 21d) consistently takes ~28d -> SLOWER,
    // stockout-risk red flag. EDTA (Greiner, programmed 12d) arrives in ~7d ->
    // FASTER, over-buffered amber flag. (Receipts were cleared above.)
    const insReceipt = sqlite.prepare(
      `INSERT INTO inventory_receipts (lab_id, item_id, account_id, item_name, vendor, qty_received, usage_unit, order_placed_date, expected_date, received_date, programmed_lead_time_days, actual_lead_time_days, received_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const SEED_RECEIPTS: Array<{ key: string; programmed: number; actuals: number[] }> = [
      { key: "RESP", programmed: 21, actuals: [27, 29, 28, 30] },
      { key: "EDTA", programmed: 12, actuals: [7, 6, 8] },
    ];
    for (const sr of SEED_RECEIPTS) {
      const it = ITEMS[sr.key];
      const row = sqlite.prepare("SELECT id, account_id FROM inventory_items WHERE lab_id = ? AND item_name = ?").get(WAREHOUSE, it.name) as any;
      if (!row) continue;
      sr.actuals.forEach((actual, idx) => {
        // Oldest first; most recent receipt ~20 days ago, ~40 days apart.
        const recvOffset = -(20 + (sr.actuals.length - 1 - idx) * 40);
        const received = isoPlusDays(now, recvOffset);
        const placed = isoPlusDays(now, recvOffset - actual);
        const expected = isoPlusDays(now, recvOffset - actual + sr.programmed);
        insReceipt.run(WAREHOUSE, row.id, row.account_id, it.name, it.vendor, it.units_per_order_unit, it.usage_unit, placed, expected, received, sr.programmed, actual, null, nowIso);
      });
    }

    // Seed a believable VeritaStock audit history so the Audit Trail tab is
    // alive in the demo. Clear the demo owner's prior veritastock rows first so
    // the trail is consistent each reset and never accumulates stale test data.
    // (The live endpoints now log receive/adjust/write-off/transfer; this seeds
    // a backdated set of the SAME action types, so nothing here is fabricated
    // beyond what the system genuinely produces.)
    const demoOwner = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(WAREHOUSE) as any)?.owner_user_id;
    if (demoOwner != null) {
      // Clear the ENTIRE VeritaStock audit history, not just the warehouse
      // owner's rows. This function only ever runs on the isolated STOCK
      // deployment (hard-guarded at the top), where every module='veritastock'
      // audit row is demo data. A blanket clear guarantees a clean trail on
      // every reset regardless of which owner an action was logged under, and
      // sweeps any post-reset "playing" residue that a single-owner delete missed.
      try { sqlite.prepare("DELETE FROM audit_log WHERE module = 'veritastock'").run(); } catch {}
      const itemIdAt = (lab: number, key: string): number | null => {
        const r = sqlite.prepare("SELECT id FROM inventory_items WHERE lab_id = ? AND item_name = ?").get(lab, ITEMS[key].name) as any;
        return r?.id ?? null;
      };
      const insAudit = sqlite.prepare(
        `INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json, ip_address, created_at)
         VALUES (?, ?, 'veritastock', ?, 'inventory_item', ?, ?, ?, ?, NULL, ?)`
      );
      const at = (daysAgo: number, hhmm: string) => `${isoPlusDays(now, -daysAgo)} ${hhmm}:00`;
      // [daysAgo, time, action, lab, itemKey, entity_label, before, after]
      const EVENTS: Array<[number, string, string, number, string, string, any, any]> = [
        [44, "08:11", "receive",   WAREHOUSE, "GLOVE",  "Nitrile exam gloves: received 4000 glove (on hand 8000 to 12000)", { quantity_on_hand: 8000 }, { quantity_on_hand: 12000 }],
        [41, "09:02", "receive",   WAREHOUSE, "EDTA",   "EDTA collection tube: received 5000 tube (on hand 6000 to 11000)", { quantity_on_hand: 6000 }, { quantity_on_hand: 11000 }],
        [38, "13:24", "adjust",    WAREHOUSE, "GLOVE",  "Nitrile exam gloves: count adjusted 12000 to 11940 (cycle count)", { quantity_on_hand: 12000 }, { quantity_on_hand: 11940 }],
        [35, "10:47", "receive",   WAREHOUSE, "SALINE", "Normal saline 1000 mL IV bag: received 600 bag (on hand 240 to 840)", { quantity_on_hand: 240 }, { quantity_on_hand: 840 }],
        [33, "15:09", "write_off", WAREHOUSE, "BCSET",  "Blood culture bottle set: wrote off 120 set (expired), $864.00 loss", { quantity_on_hand: 540 }, { quantity_on_hand: 420 }],
        [30, "11:31", "transfer_out", WAREHOUSE, "GLOVE", "Nitrile exam gloves: -2000 glove to ED Stockroom", { quantity_on_hand: 11940 }, { quantity_on_hand: 9940 }],
        [30, "11:46", "transfer_in",  ED,        "GLOVE", "Nitrile exam gloves: +2000 glove accepted from San Carlos Warehouse", { quantity_on_hand: 1500 }, { quantity_on_hand: 3500 }],
        [27, "08:55", "adjust",    ED,        "PADS",   "Alcohol prep pads: count adjusted 1800 to 1760 (cycle count)", { quantity_on_hand: 1800 }, { quantity_on_hand: 1760 }],
        [24, "14:02", "receive",   WAREHOUSE, "RESP",   "Rapid respiratory test cartridge: received 75 test (on hand 90 to 165)", { quantity_on_hand: 90 }, { quantity_on_hand: 165 }],
        [22, "09:38", "write_off", ED,        "STRIP",  "Glucometer test strips: wrote off 50 strip (damaged), $42.50 loss", { quantity_on_hand: 400 }, { quantity_on_hand: 350 }],
        [19, "16:20", "transfer_out", WAREHOUSE, "EDTA", "EDTA collection tube: -1500 tube to Inpatient Unit", { quantity_on_hand: 11000 }, { quantity_on_hand: 9500 }],
        [19, "16:33", "transfer_in",  INPATIENT, "EDTA", "EDTA collection tube: +1500 tube accepted from San Carlos Warehouse", { quantity_on_hand: 800 }, { quantity_on_hand: 2300 }],
        [16, "10:05", "receive",   WAREHOUSE, "IVKIT",  "IV start kit: received 400 kit (on hand 160 to 560)", { quantity_on_hand: 160 }, { quantity_on_hand: 560 }],
        [13, "12:50", "adjust",    WAREHOUSE, "SALINE", "Normal saline 1000 mL IV bag: count adjusted 720 to 700 (cycle count)", { quantity_on_hand: 720 }, { quantity_on_hand: 700 }],
        [10, "08:19", "write_off", INPATIENT, "SALINE", "Normal saline 1000 mL IV bag: wrote off 24 bag (expired), $43.20 loss", { quantity_on_hand: 180 }, { quantity_on_hand: 156 }],
        [8,  "11:14", "receive",   WAREHOUSE, "STRIP",  "Glucometer test strips: received 1000 strip (on hand 2000 to 3000)", { quantity_on_hand: 2000 }, { quantity_on_hand: 3000 }],
        [6,  "13:41", "transfer_out", WAREHOUSE, "SALINE", "Normal saline 1000 mL IV bag: -300 bag to Clinic", { quantity_on_hand: 700 }, { quantity_on_hand: 400 }],
        [6,  "14:02", "transfer_in",  CLINIC,    "SALINE", "Normal saline 1000 mL IV bag: +300 bag accepted from San Carlos Warehouse", { quantity_on_hand: 90 }, { quantity_on_hand: 390 }],
        [3,  "09:27", "adjust",    WAREHOUSE, "BCSET",  "Blood culture bottle set: count adjusted 420 to 416 (cycle count)", { quantity_on_hand: 420 }, { quantity_on_hand: 416 }],
        [1,  "10:48", "receive",   WAREHOUSE, "DRESS",  "Wound care dressing kit: received 100 kit (on hand 60 to 160)", { quantity_on_hand: 60 }, { quantity_on_hand: 160 }],
      ];
      for (const [d, hhmm, action, lab, key, label, before, after] of EVENTS) {
        const iid = itemIdAt(lab as number, key as string);
        if (iid == null) continue;
        // user_id AND owner_user_id both = the demo owner (8 placeholders).
        insAudit.run(demoOwner, demoOwner, action, iid, label, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, at(d as number, hhmm as string));
      }
    }
  });
  tx();
  return { ok: true, labs: summary, months };
}
