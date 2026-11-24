// server/veritascanItems.ts
//
// Saving a scan's items. The four item writes (one item or many, lab-scoped and the older unscoped pair) ran the same
// statement copied four times; they call this now, so a rule about what a save may overwrite lives in one place.
//
// A scan screen's auto-save sends every item it holds, not only the one that changed. So a save never changes the owner of
// an item assigned to a person (owner_user_id set, server/inspectionAssign.ts): another browser's copy of the scan would put
// the old typed name back. Only the assignment routes change or clear it.

/** What both item reads send the scan screen. */
export const SCAN_ITEM_READ_COLUMNS = "item_id, status, notes, owner, owner_user_id, due_date, completion_source, completion_link, completion_note, teaching_note";

export interface ScanItemSave {
  itemId: number | string;
  status?: string | null;
  notes?: string | null;
  owner?: string | null;
  dueDate?: string | null;
  /** null keeps the stored teaching note; "" clears it. */
  teachingNote?: string | null;
}

/** Upserts the rows, all or none, and touches the scan. */
export function saveScanItemRows(sqlite: any, opts: { scanId: number | string; rows: ScanItemSave[]; now: string }): void {
  const stmt = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, teaching_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scan_id, item_id) DO UPDATE SET
      status = excluded.status,
      notes = excluded.notes,
      owner = CASE WHEN veritascan_items.owner_user_id IS NOT NULL THEN veritascan_items.owner ELSE excluded.owner END,
      due_date = excluded.due_date,
      teaching_note = COALESCE(excluded.teaching_note, teaching_note),
      updated_at = excluded.updated_at
  `);
  sqlite.transaction(() => {
    for (const r of opts.rows) {
      stmt.run(opts.scanId, r.itemId, r.status || "Not Assessed", r.notes || null, r.owner || null, r.dueDate ?? null, r.teachingNote ?? null, opts.now);
    }
    sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(opts.now, opts.scanId);
  })();
}

/** The bulk save's rows as either naming sends them (camelCase or snake_case); a row with no item id is skipped. */
export function scanItemRowsFromBody(items: any[]): ScanItemSave[] {
  const rows: ScanItemSave[] = [];
  for (const r of items) {
    const itemId = r?.item_id ?? r?.itemId;
    if (itemId == null) continue;
    rows.push({
      itemId, status: r.status, notes: r.notes, owner: r.owner, dueDate: r.due_date ?? r.dueDate ?? null,
      // Absent -> null, so the stored teaching note is kept (a status-only save cannot wipe it).
      teachingNote: "teaching_note" in r ? (r.teaching_note ?? null) : "teachingNote" in r ? (r.teachingNote ?? null) : null,
    });
  }
  return rows;
}
