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
