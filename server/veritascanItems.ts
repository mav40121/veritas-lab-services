// server/veritascanItems.ts
//
// Saving a scan's items. The four item writes (one item or many, lab-scoped and the older unscoped pair) ran the same
// statement copied four times; they call this now, so a rule about what a save may overwrite lives in one place.
//
// A scan screen's auto-save sends every item it holds, not only the one that changed. So a save never changes the owner of
// an item assigned to a person (owner_user_id set, server/inspectionAssign.ts): another browser's copy of the scan would put
// the old typed name back. Only the assignment routes change or clear it.
//
// A carried answer (server/veritascanCarry.ts) is stored as Not Assessed with the answer it came with beside it
// (carried_status), so every count, report and export that reads `status` leaves it out until someone reviews it. Giving the
// item a status is the review; a save that leaves it Not Assessed isn't. A cleared one (clearCarried) is reviewed as nothing.
// Veritas support doesn't answer for the lab: its save leaves a carried item Not Assessed and unreviewed.
import { SCAN_ITEMS } from "../client/src/lib/veritaScanData";
import { logAudit } from "./audit";

/** SQL: the row (aliased `a`, or unqualified) is a carried answer nobody has reviewed. An automatic mark on it since is an answer. */
export const carriedPendingSql = (a = "") => {
  const c = a ? `${a}.` : "";
  return `(${c}carried_at IS NOT NULL AND ${c}carried_reviewed_at IS NULL AND ${c}status = 'Not Assessed')`;
};
export const isCarriedPending = (r: any): boolean => !!r && r.carried_at != null && r.carried_reviewed_at == null && r.status === "Not Assessed";

/** What both item reads send the scan screen. */
export const SCAN_ITEM_READ_COLUMNS = `item_id, status, notes, owner, owner_user_id, due_date, completion_source, completion_link, completion_note, teaching_note,
  CASE WHEN ${carriedPendingSql()} THEN 1 ELSE 0 END AS carried_pending, carried_status, carried_from_name, carried_from_date`;

export interface ScanItemSave {
  itemId: number | string;
  status?: string | null;
  notes?: string | null;
  owner?: string | null;
  dueDate?: string | null;
  /** null keeps the stored teaching note; "" clears it. */
  teachingNote?: string | null;
  /** The person set the carried answer aside and starts this item fresh. */
  clearCarried?: boolean;
}

export interface ScanActor { userId: number; support: boolean; ip?: string }
export const scanActor = (req: any): ScanActor => ({ userId: req.userId, support: !!req.scope?.viaVlsSupport, ip: req.ip });

/** The account whose audit trail a scan's rows go to: the scan's lab's owner, else the account the scan was made under. */
export function scanAuditOwner(sqlite: any, scanId: number | string): { name: string; ownerUserId: number } {
  const s = sqlite.prepare("SELECT s.name, COALESCE(l.owner_user_id, s.user_id) AS owner FROM veritascan_scans s LEFT JOIN labs l ON l.id = s.lab_id WHERE s.id = ?").get(scanId) as any;
  return { name: s?.name ?? `Scan ${scanId}`, ownerUserId: Number(s?.owner ?? 0) };
}

/**
 * Gives a scan a row for every checklist item that has none, as Not Assessed. The scan screen's save writes them all, and the
 * scan list's percentage divides by the rows there are (server/veritascanCounts.ts), so a write that touches a few items of a
 * new scan makes the rest first; otherwise three Compliant answers would read as 100%.
 */
export function ensureScanRows(sqlite: any, scanId: number | string, now: string): void {
  const make = sqlite.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, updated_at) VALUES (?, ?, 'Not Assessed', ?) ON CONFLICT(scan_id, item_id) DO NOTHING");
  for (const i of SCAN_ITEMS as any[]) make.run(scanId, i.id, now);
}

/** Marks one carried row reviewed and writes its audit row. Call inside the transaction that gave it its answer. */
export function reviewCarried(sqlite: any, o: { row: any; after: any; scan: { name: string; ownerUserId: number }; actor: ScanActor; now: string; cleared?: boolean }): void {
  sqlite.prepare("UPDATE veritascan_items SET carried_reviewed_at = ?, carried_reviewed_by_user_id = ? WHERE id = ?").run(o.now, o.actor.userId, o.row.id);
  logAudit({
    userId: o.actor.userId, ownerUserId: o.scan.ownerUserId, module: "veritascan", action: "update", entityType: "veritascan_item", entityId: o.row.id,
    entityLabel: `${o.scan.name}: item ${o.row.item_id} carried answer ${o.cleared ? "set aside" : "reviewed"}`,
    before: { status: "Not Assessed", carried_status: o.row.carried_status, carried_from: o.row.carried_from_name, carried_from_date: o.row.carried_from_date },
    after: o.after, ipAddress: o.actor.ip,
  });
}

/**
 * Upserts the rows, all or none, and touches the scan. Returns the carried items this save reviewed, and those Veritas
 * support's save left as they were (held).
 */
export function saveScanItemRows(sqlite: any, opts: { scanId: number | string; rows: ScanItemSave[]; now: string; actor: ScanActor }): { reviewed: number[]; held: number[] } {
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
  const reviewed: number[] = [], held: number[] = [];
  sqlite.transaction(() => {
    const pending = new Map<number, any>((sqlite.prepare(`SELECT * FROM veritascan_items WHERE scan_id = ? AND ${carriedPendingSql()}`).all(opts.scanId) as any[]).map((r) => [Number(r.item_id), r]));
    const scan = pending.size ? scanAuditOwner(sqlite, opts.scanId) : null;
    for (const r of opts.rows) {
      const carried = pending.get(Number(r.itemId));
      let status = r.status || "Not Assessed";
      if (carried && opts.actor.support && (status !== "Not Assessed" || r.clearCarried)) {
        status = "Not Assessed";
        held.push(Number(r.itemId));
      }
      stmt.run(opts.scanId, r.itemId, status, r.notes || null, r.owner || null, r.dueDate ?? null, r.teachingNote ?? null, opts.now);
      if (!carried || opts.actor.support) continue;
      if (r.clearCarried && status === "Not Assessed") {
        // Set aside: a person the copy assigned goes with it.
        sqlite.prepare("UPDATE veritascan_items SET owner = ?, owner_user_id = NULL, owner_assigned_at = NULL, owner_assigned_by_user_id = NULL WHERE id = ?").run(r.owner || null, carried.id);
        reviewCarried(sqlite, { row: carried, after: { status, notes: r.notes || null }, scan: scan!, actor: opts.actor, now: opts.now, cleared: true });
      } else if (status !== "Not Assessed") {
        reviewCarried(sqlite, { row: carried, after: { status }, scan: scan!, actor: opts.actor, now: opts.now });
      } else continue;
      pending.delete(Number(r.itemId));
      reviewed.push(Number(r.itemId));
    }
    sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(opts.now, opts.scanId);
  })();
  return { reviewed, held };
}

/** The bulk save's rows as either naming sends them (camelCase or snake_case); a row with no item id is skipped. */
export function scanItemRowsFromBody(items: any[]): ScanItemSave[] {
  const rows: ScanItemSave[] = [];
  for (const r of items) {
    const itemId = r?.item_id ?? r?.itemId;
    if (itemId == null) continue;
    rows.push({
      itemId, status: r.status, notes: r.notes, owner: r.owner, dueDate: r.due_date ?? r.dueDate ?? null, clearCarried: r.clearCarried === true,
      // Absent -> null, so the stored teaching note is kept (a status-only save cannot wipe it).
      teachingNote: "teaching_note" in r ? (r.teaching_note ?? null) : "teachingNote" in r ? (r.teachingNote ?? null) : null,
    });
  }
  return rows;
}

/** An export's notes for a row: a carried answer says where it came from and that nobody has reviewed it. */
export function scanExportNotes(row: any, dayOf: (stamp: string) => string): string {
  const notes = row?.notes || "";
  if (!row?.carried_pending) return notes;
  const from = [row.carried_from_name, row.carried_from_date ? dayOf(String(row.carried_from_date)) : null].filter(Boolean).join(", ").replace(/[<>]/g, "");
  return `Carried from ${from || "an earlier scan"}, not yet reviewed (answer there: ${row.carried_status}).${notes ? ` ${notes}` : ""}`;
}
