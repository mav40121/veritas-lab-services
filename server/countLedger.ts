// server/countLedger.ts
//
// The physical-count history ledger. Append-only record of every time an item's
// on-hand is SET by a human counting it (kiosk count-workflow, staff-portal
// adjust). This is the source for the "prior counts and dates" report and for a
// true burn rate reconciled against physical recounts.
//
// INVARIANTS (same posture as consumptionLedger / inventory_lots):
//   - on_hand stays authoritative. This module NEVER reads or writes
//     inventory_items.quantity_on_hand — it only records a side-effect row.
//   - Best-effort: a failure here must NEVER break the count it records
//     (mirrors logAudit / logConsumption). Callers ignore the return value.
//   - HIPAA-free: quantities + who (initials or staff name) + timestamps only.
//     No patient, order, or test identifiers ever reach this table.
//   - Absolute, not signed like consumption: a count is recorded whether it goes
//     up, down, or confirms the prior value (delta may be positive, negative, or
//     zero). Only a non-finite counted_qty is skipped.

import { db } from "./db";

export type CountSource = "kiosk" | "staff_portal" | "director" | "import" | "other";

export interface CountEventInput {
  itemId: number;
  labId: number;
  accountId?: number | null;
  countedQty: number;                // the absolute on-hand the human counted
  previousQty?: number | null;       // on-hand before the count
  countedBy?: string | null;         // initials or a staff name label
  source: CountSource;
  occurredAt?: string;               // ISO; defaults to now
}

// Append one count event. Returns the new row id, or -1 when skipped/failed.
export function logCount(ev: CountEventInput): number {
  try {
    if (!Number.isFinite(ev.countedQty)) return -1;
    const sqlite = (db as any).$client;
    const nowIso = new Date().toISOString();
    const prev = Number.isFinite(ev.previousQty as number) ? (ev.previousQty as number) : null;
    const delta = prev == null ? null : ev.countedQty - prev;
    const r = sqlite.prepare(`
      INSERT INTO inventory_count_events
        (item_id, lab_id, account_id, counted_qty, previous_qty, delta, counted_by, source, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ev.itemId,
      ev.labId,
      ev.accountId ?? null,
      ev.countedQty,
      prev,
      delta,
      ev.countedBy ?? null,
      ev.source,
      ev.occurredAt || nowIso,
      nowIso,
    );
    return Number(r.lastInsertRowid);
  } catch (err: any) {
    // Ledger failure must never break the count it records.
    console.error("[count] failed to log event:", err?.message || err);
    return -1;
  }
}
