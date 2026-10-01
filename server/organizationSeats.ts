// server/organizationSeats.ts
//
// Phase 2a of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// Org-aware active-seat cap. When an account owner's labs belong to an
// organization, the active-seat cap is the organization's pooled cap
// (organizations.active_seat_pool). Otherwise it is the current owner-level cap,
// max(users.seat_count, PLAN_SEATS[plan]) — completely unchanged.
//
// Organizations are single-owner today (each org == one owner's labs), so
// resolving by owner is equivalent to resolving org-wide; the multi-owner
// generalization (counting seats across several owners in one org) is a later
// step and is called out in the design doc. The pure core (resolveActiveSeatCap)
// is mirrored by scripts/verify-org-seat-cap.mjs.

export function resolveActiveSeatCap(args: {
  organizationId: number | null;
  orgActiveSeatPool: number | null;
  ownerSeatCount: number | null;
  ownerPlanSeats: number;
}): number {
  const ownerCap = Math.max(args.ownerSeatCount || 0, args.ownerPlanSeats || 1);
  // An org-linked account draws from the org pool once it is set. Defensive
  // fallback to the owner cap when the pool is null (an org not yet migrated by
  // the backfill-seat-pools endpoint), so an unmigrated org never caps at 0.
  if (args.organizationId != null && args.orgActiveSeatPool != null && args.orgActiveSeatPool > 0) {
    return args.orgActiveSeatPool;
  }
  return ownerCap;
}

// SQLite convenience: resolve the active-seat cap for an account owner, consulting
// their organization (found via any of their labs linked to an org) and its pool.
// Used by the seat-gate sites so lab-scoped and account-scoped callers share one
// path. Falls back to the owner-level cap when there is no org or the pool is unset.
export function orgSeatCapForOwner(
  sqlite: any,
  ownerUserId: number,
  ownerSeatCount: number | null,
  ownerPlanSeats: number,
): number {
  let organizationId: number | null = null;
  let orgActiveSeatPool: number | null = null;
  try {
    const row = sqlite
      .prepare(
        "SELECT o.id AS org_id, o.active_seat_pool AS pool FROM labs l JOIN organizations o ON o.id = l.organization_id WHERE l.owner_user_id = ? AND l.organization_id IS NOT NULL LIMIT 1",
      )
      .get(ownerUserId) as any;
    if (row) {
      organizationId = row.org_id ?? null;
      orgActiveSeatPool = row.pool ?? null;
    }
  } catch {
    // organizations table absent (should not happen post-Phase-1): fall back to owner cap.
  }
  return resolveActiveSeatCap({ organizationId, orgActiveSeatPool, ownerSeatCount, ownerPlanSeats });
}
