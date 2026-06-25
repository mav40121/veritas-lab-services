// server/consumptionLedger.ts
//
// Keystone Layer 2 — the consumption (usage) ledger. Append-only record of stock
// DEPLETIONS so per-location burn / turns / days-on-hand can be learned from
// ACTUAL draw-down instead of entered estimates.
//
// INVARIANTS (same posture as inventory_lots):
//   - on_hand stays authoritative. This module NEVER reads or writes
//     inventory_items.quantity_on_hand — it only records a side-effect row.
//   - Best-effort: a failure here must NEVER break the depletion that produced
//     it (mirrors logAudit). Callers do not depend on the return value.
//   - HIPAA-free: qty + cost snapshot + reason + timestamps only. No patient,
//     order, or test identifiers ever reach this table.
//   - Depletions only: receive / transfer-in are replenishment — do not log.
//
// Consumption is recorded with a POSITIVE qty. logConsumption silently skips a
// non-positive qty, so callers can pass a raw (before - after) delta and an
// upward / no-op adjustment simply records nothing.

import { db } from "./db";

export type ConsumptionReason = "write_off" | "transfer_out" | "adjust_down";

export interface ConsumptionEventInput {
  itemId: number;
  labId: number;
  accountId?: number | null;
  qty: number;                       // units depleted (positive); <= 0 is skipped
  unitCostAtEvent?: number | null;   // snapshot of unit_cost at event time
  reason: ConsumptionReason;
  sourceEventRef?: string | null;    // pointer to the originating record (batch id, etc.)
  occurredAt?: string;               // ISO; defaults to now
}

// Append one depletion event. Returns the new row id, or -1 when skipped/failed.
export function logConsumption(ev: ConsumptionEventInput): number {
  try {
    if (!Number.isFinite(ev.qty) || ev.qty <= 0) return -1; // never record a non-depletion
    const sqlite = (db as any).$client;
    const nowIso = new Date().toISOString();
    const r = sqlite.prepare(`
      INSERT INTO inventory_consumption_events
        (item_id, lab_id, account_id, qty, unit_cost_at_event, reason, source_event_ref, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ev.itemId,
      ev.labId,
      ev.accountId ?? null,
      ev.qty,
      ev.unitCostAtEvent ?? null,
      ev.reason,
      ev.sourceEventRef ?? null,
      ev.occurredAt || nowIso,
      nowIso,
    );
    return Number(r.lastInsertRowid);
  } catch (err: any) {
    // Ledger failure must never break the depletion it records.
    console.error("[consumption] failed to log event:", err?.message || err);
    return -1;
  }
}
