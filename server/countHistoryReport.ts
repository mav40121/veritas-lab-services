// server/countHistoryReport.ts
//
// The VeritaStock Count History report: every physical count recorded in
// inventory_count_events (PR 1 capture), per item, with a TRUE burn rate
// reconciled against the physical recounts.
//
// True burn between two consecutive counts of an item:
//   usage = previous_count + receipts_in_window - this_count
// summed across every consecutive pair in the window and divided by the total
// elapsed days. Because it anchors on physical recounts, it captures unlogged
// shrinkage / waste that an estimate or the consumption-ledger learned-burn
// misses. A NEGATIVE result means the recounts found more than expected (a net
// gain / correction), which is surfaced honestly rather than clamped away.
//
// HIPAA-free by construction: reads only inventory_count_events (quantities +
// who + dates), inventory_items (catalog metadata), inventory_receipts (qty +
// date). No patient / order / test identifiers.

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CountHistoryOpts { days?: number; itemId?: number | null }

export interface CountRow {
  counted_qty: number;
  previous_qty: number | null;
  delta: number | null;
  counted_by: string | null;
  source: string;
  occurred_at: string;
}

export interface CountHistoryItem {
  item_id: number;
  item_name: string;
  catalog_number: string | null;
  storage_location: string | null;
  department: string | null;
  count_unit: string | null;
  units_per_count_unit: number;
  counts: CountRow[];
  last_counted_at: string | null;
  count_count: number;
  true_burn_per_day: number | null;            // usage units per day
  true_burn_per_day_count_unit: number | null; // count units per day (per-day / pack size)
}

export interface CountHistoryReport {
  generatedAt: string;
  windowDays: number;
  items: CountHistoryItem[];
}

// Build the report for a lab. sqlite is the better-sqlite3 client. Pure read;
// nowMs is injectable so a verify script gets deterministic windowing.
export function buildCountHistory(sqlite: any, labId: number, opts: CountHistoryOpts = {}, nowMs: number = Date.now()): CountHistoryReport {
  const days = Number.isFinite(opts.days as number) && (opts.days as number) > 0 ? Math.floor(opts.days as number) : 365;
  const sinceIso = new Date(nowMs - days * 86400000).toISOString();

  const params: any[] = [labId, sinceIso];
  let itemFilter = "";
  if (opts.itemId) { itemFilter = " AND ce.item_id = ?"; params.push(opts.itemId); }

  const rows = sqlite.prepare(`
    SELECT ce.item_id, ce.counted_qty, ce.previous_qty, ce.delta, ce.counted_by, ce.source, ce.occurred_at,
           it.item_name, it.catalog_number, it.storage_location, it.department, it.count_unit, it.units_per_count_unit
    FROM inventory_count_events ce
    JOIN inventory_items it ON it.id = ce.item_id
    WHERE ce.lab_id = ? AND ce.occurred_at >= ?${itemFilter}
    ORDER BY ce.item_id ASC, ce.occurred_at ASC
  `).all(...params) as any[];

  // Receipts landed strictly after the prior count and up to (inclusive) this
  // count, so they are added back before computing usage.
  const receiptsStmt = sqlite.prepare(`
    SELECT COALESCE(SUM(qty_received), 0) AS q FROM inventory_receipts
    WHERE item_id = ? AND received_date IS NOT NULL
      AND date(received_date) > date(?) AND date(received_date) <= date(?)
  `);

  const byItem = new Map<number, { meta: any; counts: any[] }>();
  for (const r of rows) {
    if (!byItem.has(r.item_id)) byItem.set(r.item_id, { meta: r, counts: [] });
    byItem.get(r.item_id)!.counts.push(r);
  }

  const items: CountHistoryItem[] = [];
  for (const [itemId, grp] of byItem) {
    const counts: CountRow[] = grp.counts.map((r: any) => ({
      counted_qty: r.counted_qty, previous_qty: r.previous_qty, delta: r.delta,
      counted_by: r.counted_by, source: r.source, occurred_at: r.occurred_at,
    }));
    const pack = Number.isFinite(grp.meta.units_per_count_unit) && grp.meta.units_per_count_unit > 0 ? grp.meta.units_per_count_unit : 1;

    let totalUsage = 0, totalDays = 0;
    for (let i = 1; i < counts.length; i++) {
      const prev = counts[i - 1], cur = counts[i];
      const dtDays = (new Date(cur.occurred_at).getTime() - new Date(prev.occurred_at).getTime()) / 86400000;
      if (!(dtDays > 0)) continue;
      const rcpt = Number(receiptsStmt.get(itemId, prev.occurred_at, cur.occurred_at)?.q || 0);
      totalUsage += prev.counted_qty + rcpt - cur.counted_qty;
      totalDays += dtDays;
    }
    const burn = totalDays > 0 ? totalUsage / totalDays : null;

    items.push({
      item_id: itemId,
      item_name: grp.meta.item_name,
      catalog_number: grp.meta.catalog_number,
      storage_location: grp.meta.storage_location,
      department: grp.meta.department,
      count_unit: grp.meta.count_unit,
      units_per_count_unit: pack,
      counts,
      last_counted_at: counts.length ? counts[counts.length - 1].occurred_at : null,
      count_count: counts.length,
      true_burn_per_day: burn == null ? null : round2(burn),
      true_burn_per_day_count_unit: burn == null ? null : round2(burn / pack),
    });
  }
  items.sort((a, b) => (a.item_name || "").localeCompare(b.item_name || ""));
  return { generatedAt: new Date(nowMs).toISOString(), windowDays: days, items };
}
