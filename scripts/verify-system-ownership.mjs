// scripts/verify-system-ownership.mjs
//
// Gate-3 receipt for the Phase-0 System/Organization ownership diagnostic
// (server/systemOwnershipAudit.ts, exposed at GET /api/admin/system-ownership-audit).
// Mirrors computeSystemOwnershipAudit case-for-case against a known input set.
// If you change the audit logic there, change this mirror too.
//
// Run: node scripts/verify-system-ownership.mjs

// ---- mirror of server/systemOwnershipAudit.ts: computeSystemOwnershipAudit ----
function computeSystemOwnershipAudit(labs, users, seats, now = "2026-09-30T00:00:00.000Z") {
  const userById = new Map();
  for (const u of users) userById.set(u.id, u);
  const labById = new Map();
  for (const l of labs) labById.set(l.id, l);

  const activeSeats = seats.filter((s) => s.status !== "deactivated");
  const activeSeatsByOwner = new Map();
  for (const s of activeSeats) {
    if (s.owner_user_id == null) continue;
    activeSeatsByOwner.set(s.owner_user_id, (activeSeatsByOwner.get(s.owner_user_id) || 0) + 1);
  }

  const byOwner = new Map();
  const labsWithMissingOwner = [];
  for (const l of labs) {
    if (l.owner_user_id == null || !userById.has(l.owner_user_id)) {
      labsWithMissingOwner.push({ id: l.id, name: l.lab_name, owner_user_id: l.owner_user_id });
    }
    if (l.owner_user_id == null) continue;
    const arr = byOwner.get(l.owner_user_id) || [];
    arr.push(l);
    byOwner.set(l.owner_user_id, arr);
  }

  const systems = [];
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
  systems.sort((a, b) => b.labCount - a.labCount || a.ownerUserId - b.ownerUserId);

  const orphanSeats = [];
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

// ---- harness -------------------------------------------------------------
let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

// ---- fixture -------------------------------------------------------------
// Owner 1: a 3-lab hospital SYSTEM (labs 10,11,12), one of which is a repository.
// Owner 2: a single standalone clinic (lab 20) - NOT a system.
// Owner 3: owns lab 30, but lab 30 carries a DRIFTED seat (owner_user_id 99).
// Lab 40: owner_user_id 777 which has no users row (missing-owner integrity flag).
const users = [
  { id: 1, email: "system@hospital.test", plan: "hospital", seat_count: 15 },
  { id: 2, email: "solo@clinic.test", plan: "clinic", seat_count: 0 },
  { id: 3, email: "drift@lab.test", plan: "community", seat_count: 5 },
];
const labs = [
  { id: 10, lab_name: "Main Hospital Lab", clia_number: "11D1", owner_user_id: 1, is_repository: 0, is_demo: 0, is_trial: 0, plan: "hospital" },
  { id: 11, lab_name: "North Campus Lab", clia_number: "11D2", owner_user_id: 1, is_repository: 0, is_demo: 0, is_trial: 0, plan: "hospital" },
  { id: 12, lab_name: "Shared Document Library", clia_number: null, owner_user_id: 1, is_repository: 1, is_demo: 0, is_trial: 0, plan: "hospital" },
  { id: 20, lab_name: "Solo Clinic", clia_number: "22D1", owner_user_id: 2, is_repository: 0, is_demo: 0, is_trial: 0, plan: "clinic" },
  { id: 30, lab_name: "Drifted Lab", clia_number: "33D1", owner_user_id: 3, is_repository: 0, is_demo: 0, is_trial: 0, plan: "community" },
  { id: 40, lab_name: "Ghost-Owned Lab", clia_number: "44D1", owner_user_id: 777, is_repository: 0, is_demo: 0, is_trial: 0, plan: "clinic" },
];
const seats = [
  // Owner 1 active seats (labs 10/11), plus one deactivated that must NOT count.
  { id: 100, owner_user_id: 1, lab_id: 10, seat_email: "a@hospital.test", seat_type: "active", status: "active" },
  { id: 101, owner_user_id: 1, lab_id: 11, seat_email: "b@hospital.test", seat_type: "active", status: "pending" },
  { id: 102, owner_user_id: 1, lab_id: 10, seat_email: "gone@hospital.test", seat_type: "active", status: "deactivated" },
  // Owner 2 single active seat.
  { id: 200, owner_user_id: 2, lab_id: 20, seat_email: "c@clinic.test", seat_type: "active", status: "active" },
  // DRIFT: seat sits on lab 30 (owner 3) but its owner_user_id is 99.
  { id: 300, owner_user_id: 99, lab_id: 30, seat_email: "d@lab.test", seat_type: "staff_portal", status: "active" },
];

const r = computeSystemOwnershipAudit(labs, users, seats);

console.log("System ownership audit - fixture result:");
console.log(JSON.stringify(r.summary, null, 2));

// ---- assertions ----------------------------------------------------------
ok("totalLabs = 6", r.summary.totalLabs === 6);
ok("ownersWithLabs = 4 (owners 1,2,3 + ghost 777)", r.summary.ownersWithLabs === 4);
ok("implicitSystems = 1 (only owner 1 has >1 lab)", r.summary.implicitSystems === 1);
ok("repositoryLabs = 1", r.summary.repositoryLabs === 1);

const top = r.systems[0];
ok("largest system sorted first = owner 1", top.ownerUserId === 1);
ok("owner 1 labCount = 3", top.labCount === 3);
ok("owner 1 isImplicitSystem = true", top.isImplicitSystem === true);
ok("owner 1 repositoryLabCount = 1", top.repositoryLabCount === 1);
ok("owner 1 activeSeatsOnOwner = 2 (deactivated excluded)", top.activeSeatsOnOwner === 2);
ok("owner 1 labs sorted by id", top.labs.map((l) => l.id).join(",") === "10,11,12");
ok("owner 1 repository lab flagged", top.labs.find((l) => l.id === 12)?.is_repository === true);

const solo = r.systems.find((s) => s.ownerUserId === 2);
ok("owner 2 is not an implicit system", solo && solo.isImplicitSystem === false);

ok("orphanSeatCount = 1", r.summary.orphanSeatCount === 1);
ok("orphan is seat 300 on lab 30", r.orphanSeats.length === 1 && r.orphanSeats[0].seatId === 300 && r.orphanSeats[0].labId === 30);
ok("orphan records drifted vs correct owner", r.orphanSeats[0]?.seatOwnerUserId === 99 && r.orphanSeats[0]?.labOwnerUserId === 3);

ok("labsWithMissingOwner = 1 (lab 40 -> ghost 777)", r.summary.labsWithMissingOwner === 1);
ok("missing-owner lab is 40", r.labsWithMissingOwner.length === 1 && r.labsWithMissingOwner[0].id === 40);

// A healthy system (no drift) must produce zero orphans.
const healthy = computeSystemOwnershipAudit(
  [{ id: 10, lab_name: "L", clia_number: "1", owner_user_id: 1, is_repository: 0, is_demo: 0, is_trial: 0, plan: "hospital" }],
  [{ id: 1, email: "x@x.test", plan: "hospital", seat_count: 15 }],
  [{ id: 1, owner_user_id: 1, lab_id: 10, seat_email: "s@x.test", seat_type: "active", status: "active" }],
);
ok("healthy system has zero orphan seats", healthy.summary.orphanSeatCount === 0);
ok("healthy single-lab owner is not an implicit system", healthy.summary.implicitSystems === 0);

// ---- report --------------------------------------------------------------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
