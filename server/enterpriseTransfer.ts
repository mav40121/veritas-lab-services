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
