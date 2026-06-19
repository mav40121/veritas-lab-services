// server/enterpriseTransfer.ts
//
// Pure decision logic for VeritaStock enterprise inventory transfers
// (warehouse <-> stockroom location). Deliberately free of DB and Express
// so scripts/verify-enterprise-transfer.mjs can unit-test it case-for-case.
// Any change to these functions must be mirrored in that verify script.
//
// Security model, stated once so it is not re-derived per call site: a
// transfer may only move stock between two labs that (a) share the same
// owner_user_id and (b) the acting user is an active member of both. That
// shared-owner check is the cross-tenant boundary, the same class the
// lab-scoping sweeps protect. computeUsageQty keeps every quantity in
// usage_units so a box/each pack size can never silently mis-convert,
// mirroring the kiosk adjust path.

export function computeUsageQty(displayQty: number, unitsPerCountUnit: number): number {
  const pack =
    Number.isFinite(unitsPerCountUnit) && unitsPerCountUnit > 0
      ? Math.floor(unitsPerCountUnit)
      : 1;
  return Math.round(displayQty) * pack;
}

export interface TransferGuardInput {
  fromLabId: number;
  toLabId: number;
  fromOwnerUserId: number;
  toOwnerUserId: number;
  actingUserIsMemberOfDestination: boolean;
  sourceQtyOnHand: number; // usage_units
  usageQty: number; // usage_units to move
}

export type TransferGuardResult = { ok: boolean; error?: string };

export function validateTransfer(i: TransferGuardInput): TransferGuardResult {
  if (!Number.isFinite(i.fromLabId) || !Number.isFinite(i.toLabId)) {
    return { ok: false, error: "invalid_lab" };
  }
  if (i.fromLabId === i.toLabId) {
    return { ok: false, error: "same_lab" };
  }
  if (i.fromOwnerUserId !== i.toOwnerUserId) {
    return { ok: false, error: "cross_owner" };
  }
  if (!i.actingUserIsMemberOfDestination) {
    return { ok: false, error: "no_access_to_destination" };
  }
  if (!Number.isFinite(i.usageQty) || i.usageQty <= 0) {
    return { ok: false, error: "qty_must_be_positive" };
  }
  if (i.usageQty > i.sourceQtyOnHand) {
    return { ok: false, error: "insufficient_stock" };
  }
  return { ok: true };
}

// matchKey decides whether the same physical item exists at the destination
// location. Catalog number is the strong key; item name is the fallback for
// the many legacy rows that were imported without a catalog number.
export function matchKey(item: {
  catalog_number?: string | null;
  item_name?: string | null;
}): string {
  const cat = (item.catalog_number || "").trim().toLowerCase();
  if (cat) return `cat:${cat}`;
  return `name:${(item.item_name || "").trim().toLowerCase()}`;
}

// countOnHand mirrors decorateKioskItem: stored qty is usage_units; the
// count-unit view divides by pack size only when packs are bundled.
export function countOnHand(quantityOnHand: number, unitsPerCountUnit: number): number {
  const pack =
    Number.isFinite(unitsPerCountUnit) && unitsPerCountUnit > 0
      ? Math.floor(unitsPerCountUnit)
      : 1;
  return pack > 1 ? Math.round(quantityOnHand / pack) : quantityOnHand;
}

// ── Multi-item (batch) transfer validation ──────────────────────────────
// A batch moves several items from ONE source lab to ONE destination lab in
// a single all-or-nothing operation. The batch-level checks (same-owner,
// destination membership, distinct labs) are evaluated once; the per-line
// checks (item present at source, positive quantity, enough stock) are
// evaluated per line. The endpoint pre-validates with this BEFORE opening
// the DB transaction, so a single bad line rejects the whole batch with a
// precise error instead of half-moving stock. Mirrored in
// scripts/verify-enterprise-transfer-batch.mjs.

export interface BatchLineInput {
  itemId: number;
  usageQty: number; // usage_units to move
  sourceQtyOnHand: number; // usage_units at source
  existsAtSource: boolean; // a source-lab row was found for this item
}

export interface BatchGuardInput {
  fromLabId: number;
  toLabId: number;
  fromOwnerUserId: number;
  toOwnerUserId: number;
  actingUserIsMemberOfDestination: boolean;
  lines: BatchLineInput[];
}

export interface BatchGuardResult {
  ok: boolean;
  errors: Array<{ itemId: number | null; error: string }>;
}

// ── Enterprise scope resolution ──────────────────────────────────────────
// A "warehouse group" is a warehouse lab plus the stockrooms whose
// parent_warehouse_lab_id points at it. Given the lab the user is viewing,
// resolveWarehouseId returns the warehouse that anchors its group (the lab
// itself when it is a warehouse or standalone, else its parent). inWarehouseGroup
// decides membership. The enterprise roll-up uses these to scope which
// locations appear, with an owner-wide fallback when no links are set so a
// legacy enterprise that never set parent_warehouse_lab_id is never broken.
// Pure so scripts/verify-enterprise-scope.mjs can unit-test the cases.

export function resolveWarehouseId(lab: { id: number; parent_warehouse_lab_id?: number | null }): number {
  const p = lab.parent_warehouse_lab_id;
  return p == null ? lab.id : Number(p);
}

export function inWarehouseGroup(
  lab: { id: number; parent_warehouse_lab_id?: number | null },
  warehouseId: number,
): boolean {
  return lab.id === warehouseId || Number(lab.parent_warehouse_lab_id) === warehouseId;
}

// scopeEnterpriseLocations narrows an owner's labs to the warehouse group that
// anchors `baseLab`; if that group has fewer than two labs (no links set), it
// returns the full owner list unchanged (legacy behavior).
export function scopeEnterpriseLocations<T extends { id: number; parent_warehouse_lab_id?: number | null }>(
  baseLab: { id: number; parent_warehouse_lab_id?: number | null },
  ownerLabs: T[],
): T[] {
  const warehouseId = resolveWarehouseId(baseLab);
  const group = ownerLabs.filter((l) => inWarehouseGroup(l, warehouseId));
  return group.length >= 2 ? group : ownerLabs;
}

export function validateBatch(i: BatchGuardInput): BatchGuardResult {
  const errors: Array<{ itemId: number | null; error: string }> = [];
  // Batch-level: same for every line.
  if (!Number.isFinite(i.fromLabId) || !Number.isFinite(i.toLabId)) errors.push({ itemId: null, error: "invalid_lab" });
  if (i.fromLabId === i.toLabId) errors.push({ itemId: null, error: "same_lab" });
  if (i.fromOwnerUserId !== i.toOwnerUserId) errors.push({ itemId: null, error: "cross_owner" });
  if (!i.actingUserIsMemberOfDestination) errors.push({ itemId: null, error: "no_access_to_destination" });
  if (!Array.isArray(i.lines) || i.lines.length === 0) errors.push({ itemId: null, error: "empty_batch" });
  // Per-line, including a duplicate-item guard so two lines can't both draw
  // down the same source row past what validateBatch thinks is available.
  const seen = new Set<number>();
  for (const l of i.lines || []) {
    if (seen.has(l.itemId)) { errors.push({ itemId: l.itemId, error: "duplicate_item" }); continue; }
    seen.add(l.itemId);
    if (!l.existsAtSource) errors.push({ itemId: l.itemId, error: "not_at_source" });
    else if (!Number.isFinite(l.usageQty) || l.usageQty <= 0) errors.push({ itemId: l.itemId, error: "qty_must_be_positive" });
    else if (l.usageQty > l.sourceQtyOnHand) errors.push({ itemId: l.itemId, error: "insufficient_stock" });
  }
  return { ok: errors.length === 0, errors };
}
