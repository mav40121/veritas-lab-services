// server/inventoryLots.ts
//
// Phase 2 of nested-lot tracking (Option 2). A product (inventory_items row) has
// many child lots (inventory_lots), each with its own quantity + expiration.
//
// DESIGN — on_hand stays authoritative, lots are a synced child breakdown:
// inventory_items.quantity_on_hand remains the single source of truth for the
// total (it drives reorder + valuation, untouched). inventory_lots is kept in
// sync with it. This means a bug in lot bookkeeping can never corrupt on_hand,
// and any depletion done through a non-lot path (write-off, adjust-down,
// transfer-out, a direct edit) is reflected in the lots FEFO (oldest-expiry
// first) by reconcileLots, so we do not have to surgically rewrite every
// mutation. Receive explicitly creates/credits the arriving lot via addLot.

type Sqlite = any;

// Items PAST their expiration date with quantity on hand, in the given locations (GET .../veritastock/expired-on-shelf,
// which passes every location of the enterprise group). An item's expiration_date is its earliest lot's (reconcileLots),
// so this is one row per product per location. expiration_date is stored as 'YYYY-MM-DD', so a lexical comparison
// against the lab's day is a correct "in the past" test. Moved out of routes.ts (2026-11-11).
export function expiredOnShelfItems(sqlite: Sqlite, labIds: number[], today: string): any[] {
  if (labIds.length === 0) return [];
  const ph = labIds.map(() => "?").join(",");
  return sqlite.prepare(`
    SELECT ii.id AS id, ii.item_name AS item_name, ii.catalog_number AS catalog_number,
           ii.lot_number AS lot_number, ii.expiration_date AS expiration_date,
           ii.quantity_on_hand AS quantity_on_hand, ii.usage_unit AS usage_unit,
           COALESCE(ii.unit_cost, 0) AS unit_cost, ii.lab_id AS lab_id, l.lab_name AS location_name
      FROM inventory_items ii
      LEFT JOIN labs l ON l.id = ii.lab_id
     WHERE ii.lab_id IN (${ph})
       AND COALESCE(ii.status, 'active') = 'active'
       AND ii.expiration_date IS NOT NULL AND ii.expiration_date != ''
       AND ii.expiration_date < ?
       AND COALESCE(ii.quantity_on_hand, 0) > 0
     ORDER BY ii.expiration_date ASC, ii.item_name ASC
  `).all(...labIds, today) as any[];
}

// Expired LOTS still on the shelf in one lab (the compliance digest, 2026-11-11): each inventory_lots row past its
// expiration with quantity left, on an active item of this lab. An item with no lot rows (before nested lots, or never
// reconciled) counts as one lot from its own expiration and quantity, as it reads on the expired-on-shelf list.
export function expiredLotsOnShelf(sqlite: Sqlite, labId: number, today: string): number {
  const lots = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM inventory_lots l JOIN inventory_items ii ON ii.id = l.item_id
      WHERE ii.lab_id = ? AND COALESCE(ii.status, 'active') = 'active'
        AND l.expiration_date IS NOT NULL AND l.expiration_date != '' AND l.expiration_date < ?
        AND COALESCE(l.quantity, 0) > 0`
  ).get(labId, today) as any).n as number;
  const noLots = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM inventory_items ii
      WHERE ii.lab_id = ? AND COALESCE(ii.status, 'active') = 'active'
        AND ii.expiration_date IS NOT NULL AND ii.expiration_date != '' AND ii.expiration_date < ?
        AND COALESCE(ii.quantity_on_hand, 0) > 0
        AND NOT EXISTS (SELECT 1 FROM inventory_lots l WHERE l.item_id = ii.id)`
  ).get(labId, today) as any).n as number;
  return lots + noLots;
}

// Lots for an item, oldest-expiry first (FEFO order). NULL/blank expiry sorts last.
export function lotsForItem(sqlite: Sqlite, itemId: number): any[] {
  return sqlite.prepare(
    `SELECT id, lot_number, expiration_date, quantity
       FROM inventory_lots WHERE item_id = ?
      ORDER BY (expiration_date IS NULL OR expiration_date = ''), expiration_date ASC, id ASC`
  ).all(itemId) as any[];
}

// Credit a quantity to the lot matching (lot_number, expiration_date) under an
// item, creating the lot if it does not exist yet. Used by receive + create.
export function addLot(
  sqlite: Sqlite,
  item: { id: number; lab_id?: number | null; account_id?: number | null },
  lotNumber: string | null,
  expirationDate: string | null,
  addQty: number,
  nowIso: string,
): void {
  if (!(addQty > 0)) return;
  const match = sqlite.prepare(
    `SELECT id FROM inventory_lots
      WHERE item_id = ? AND COALESCE(lot_number,'') = ? AND COALESCE(expiration_date,'') = ? LIMIT 1`
  ).get(item.id, lotNumber ?? "", expirationDate ?? "") as any;
  if (match) {
    sqlite.prepare("UPDATE inventory_lots SET quantity = quantity + ?, updated_at = ? WHERE id = ?")
      .run(addQty, nowIso, match.id);
  } else {
    sqlite.prepare(
      `INSERT INTO inventory_lots (item_id, lab_id, account_id, lot_number, expiration_date, quantity, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(item.id, item.lab_id ?? null, item.account_id ?? null, lotNumber, expirationDate, addQty, nowIso, nowIso);
  }
}

// Make the lot total equal the item's authoritative quantity_on_hand, using FEFO:
// a shortfall (stock left via a non-lot path) is removed oldest-expiry first; a
// surplus (stock added via a non-lot path) goes to the newest lot, or seeds a lot
// from the item's own lot/expiry when there are none. Also refreshes the item's
// expiration_date / lot_number to the EARLIEST remaining lot so the expiry alerts
// (which read item.expiration_date) reflect the most-urgent lot. Never changes
// quantity_on_hand. Single-lot items (the common case) are a no-op for the dates.
export function reconcileLots(sqlite: Sqlite, itemId: number, nowIso: string): void {
  const item = sqlite.prepare(
    "SELECT id, lab_id, account_id, lot_number, expiration_date, quantity_on_hand FROM inventory_items WHERE id = ?"
  ).get(itemId) as any;
  if (!item) return;
  const onHand = item.quantity_on_hand || 0;
  let lots = lotsForItem(sqlite, itemId);
  const sum = lots.reduce((s, l) => s + (l.quantity || 0), 0);
  if (Math.abs(sum - onHand) > 0.0001) {
    if (sum > onHand) {
      let deficit = sum - onHand;
      for (const l of lots) {
        if (deficit <= 0.0001) break;
        const have = l.quantity || 0;
        const take = Math.min(have, deficit);
        const remain = have - take;
        deficit -= take;
        // delete-reinsert-ok: removes a lot drawn down to zero; the INSERT below is the other branch, not a replacement
        if (remain <= 0.0001) sqlite.prepare("DELETE FROM inventory_lots WHERE id = ?").run(l.id);
        else sqlite.prepare("UPDATE inventory_lots SET quantity = ?, updated_at = ? WHERE id = ?").run(remain, nowIso, l.id);
      }
    } else {
      const surplus = onHand - sum;
      if (lots.length > 0) {
        const newest = lots[lots.length - 1];
        sqlite.prepare("UPDATE inventory_lots SET quantity = quantity + ?, updated_at = ? WHERE id = ?").run(surplus, nowIso, newest.id);
      } else if (onHand > 0) {
        sqlite.prepare(
          `INSERT INTO inventory_lots (item_id, lab_id, account_id, lot_number, expiration_date, quantity, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(item.id, item.lab_id ?? null, item.account_id ?? null, item.lot_number, item.expiration_date, surplus, nowIso, nowIso);
      }
    }
    lots = lotsForItem(sqlite, itemId);
  }
  // Sync the item's headline expiry/lot to the earliest remaining lot so the
  // expired-on-shelf + expiring-soon alerts track the most-urgent lot.
  const earliest = lots.find((l) => l.expiration_date) || lots[0];
  if (earliest && (earliest.expiration_date !== item.expiration_date || (earliest.lot_number ?? null) !== (item.lot_number ?? null))) {
    sqlite.prepare("UPDATE inventory_items SET expiration_date = ?, lot_number = ?, updated_at = ? WHERE id = ?")
      .run(earliest.expiration_date ?? null, earliest.lot_number ?? null, nowIso, itemId);
  }
}
