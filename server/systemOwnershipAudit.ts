// server/systemOwnershipAudit.ts
//
// Phase 0 of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// Read-only diagnostic. A "system" is not yet a modeled entity; today it is an
// emergent property of several labs sharing one users.id via labs.owner_user_id.
// This audit surfaces that current ground truth so Phase 1's backfill has a
// verified picture to work from:
//   - groups every lab under its owner (the current "implicit system"),
//   - marks owners with more than one lab as Phase-1 organization candidates,
//   - flags any active seat whose owner_user_id has drifted from its lab's
//     current owner (the seat-pool-drift / San Carlos siloing shape that
//     POST /api/admin/reparent-orphan-seats fixes; should be zero when healthy),
//   - flags labs whose owner_user_id has no matching users row.
//
// No writes. The pure core (computeSystemOwnershipAudit) is mirrored verbatim by
// scripts/verify-system-ownership.mjs; if you change the logic here, change it
// there too.

export interface OwnershipLabRow {
  id: number;
  lab_name: string | null;
  clia_number: string | null;
  owner_user_id: number | null;
  is_repository: number | null;
  is_demo: number | null;
  is_trial: number | null;
  plan: string | null;
}

export interface OwnershipUserRow {
  id: number;
  email: string | null;
  plan: string | null;
  seat_count: number | null;
}

export interface OwnershipSeatRow {
  id: number;
  owner_user_id: number | null;
  lab_id: number | null;
  seat_email: string | null;
  seat_type: string | null;
  status: string | null;
}

export interface SystemOwnershipLab {
  id: number;
  name: string | null;
  clia: string | null;
  is_repository: boolean;
  is_demo: boolean;
  is_trial: boolean;
  plan: string | null;
}

export interface SystemOwnershipGroup {
  ownerUserId: number;
  ownerEmail: string | null;
  ownerPlan: string | null;
  ownerSeatCount: number;
  labCount: number;
  repositoryLabCount: number;
  activeSeatsOnOwner: number;
  isImplicitSystem: boolean;
  labs: SystemOwnershipLab[];
}

export interface OrphanSeat {
  seatId: number;
  seatEmail: string | null;
  seatType: string | null;
  seatOwnerUserId: number | null;
  labId: number;
  labName: string | null;
  labOwnerUserId: number | null;
}

export interface LabMissingOwner {
  id: number;
  name: string | null;
  owner_user_id: number | null;
}

export interface SystemOwnershipAudit {
  generatedAt: string;
  summary: {
    totalLabs: number;
    ownersWithLabs: number;
    implicitSystems: number;
    orphanSeatCount: number;
    repositoryLabs: number;
    labsWithMissingOwner: number;
  };
  systems: SystemOwnershipGroup[];
  orphanSeats: OrphanSeat[];
  labsWithMissingOwner: LabMissingOwner[];
}

/**
 * Pure core. Operates on plain row arrays so it is trivially unit-testable and
 * has no database dependency. Mirrored by scripts/verify-system-ownership.mjs.
 */
export function computeSystemOwnershipAudit(
  labs: OwnershipLabRow[],
  users: OwnershipUserRow[],
  seats: OwnershipSeatRow[],
  now: string = new Date().toISOString(),
): SystemOwnershipAudit {
  const userById = new Map<number, OwnershipUserRow>();
  for (const u of users) userById.set(u.id, u);

  const labById = new Map<number, OwnershipLabRow>();
  for (const l of labs) labById.set(l.id, l);

  // Non-deactivated seats only: deactivated seats affect no count, matching the
  // seat gate and the reparent-orphan-seats endpoint.
  const activeSeats = seats.filter((s) => s.status !== "deactivated");
  const activeSeatsByOwner = new Map<number, number>();
  for (const s of activeSeats) {
    if (s.owner_user_id == null) continue;
    activeSeatsByOwner.set(s.owner_user_id, (activeSeatsByOwner.get(s.owner_user_id) || 0) + 1);
  }

  // Group labs by owner, and flag labs whose owner is missing from users.
  const byOwner = new Map<number, OwnershipLabRow[]>();
  const labsWithMissingOwner: LabMissingOwner[] = [];
  for (const l of labs) {
    if (l.owner_user_id == null || !userById.has(l.owner_user_id)) {
      labsWithMissingOwner.push({ id: l.id, name: l.lab_name, owner_user_id: l.owner_user_id });
    }
    if (l.owner_user_id == null) continue;
    const arr = byOwner.get(l.owner_user_id) || [];
    arr.push(l);
    byOwner.set(l.owner_user_id, arr);
  }

  const systems: SystemOwnershipGroup[] = [];
  for (const [ownerUserId, ownerLabs] of byOwner) {
    const u = userById.get(ownerUserId);
    systems.push({
      ownerUserId,
      ownerEmail: u?.email ?? null,
      ownerPlan: u?.plan ?? null,
      ownerSeatCount: u?.seat_count ?? 0,
      labCount: ownerLabs.length,
      repositoryLabCount: ownerLabs.filter((l) => l.is_repository === 1).length,
      activeSeatsOnOwner: activeSeatsByOwner.get(ownerUserId) || 0,
      isImplicitSystem: ownerLabs.length > 1,
      labs: ownerLabs
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((l) => ({
          id: l.id,
          name: l.lab_name,
          clia: l.clia_number,
          is_repository: l.is_repository === 1,
          is_demo: l.is_demo === 1,
          is_trial: l.is_trial === 1,
          plan: l.plan,
        })),
    });
  }
  // Biggest implicit systems first, then by owner id for a stable order.
  systems.sort((a, b) => b.labCount - a.labCount || a.ownerUserId - b.ownerUserId);

  // Orphan seats: an active seat whose owner_user_id no longer matches its lab's
  // current owner. This is the seat-pool-drift shape.
  const orphanSeats: OrphanSeat[] = [];
  for (const s of activeSeats) {
    if (s.lab_id == null) continue;
    const lab = labById.get(s.lab_id);
    if (!lab) continue;
    if (lab.owner_user_id != null && s.owner_user_id !== lab.owner_user_id) {
      orphanSeats.push({
        seatId: s.id,
        seatEmail: s.seat_email,
        seatType: s.seat_type,
        seatOwnerUserId: s.owner_user_id,
        labId: s.lab_id,
        labName: lab.lab_name,
        labOwnerUserId: lab.owner_user_id,
      });
    }
  }

  return {
    generatedAt: now,
    summary: {
      totalLabs: labs.length,
      ownersWithLabs: systems.length,
      implicitSystems: systems.filter((s) => s.isImplicitSystem).length,
      orphanSeatCount: orphanSeats.length,
      repositoryLabs: labs.filter((l) => l.is_repository === 1).length,
      labsWithMissingOwner: labsWithMissingOwner.length,
    },
    systems,
    orphanSeats,
    labsWithMissingOwner,
  };
}

/**
 * Thin SQLite adapter used by the admin endpoint. Reads only.
 */
export function auditSystemOwnership(sqlite: any): SystemOwnershipAudit {
  const labs = sqlite
    .prepare(
      "SELECT id, lab_name, clia_number, owner_user_id, is_repository, is_demo, is_trial, plan FROM labs",
    )
    .all() as OwnershipLabRow[];
  const users = sqlite.prepare("SELECT id, email, plan, seat_count FROM users").all() as OwnershipUserRow[];
  const seats = sqlite
    .prepare("SELECT id, owner_user_id, lab_id, seat_email, seat_type, status FROM user_seats")
    .all() as OwnershipSeatRow[];
  return computeSystemOwnershipAudit(labs, users, seats);
}
