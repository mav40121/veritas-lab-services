// scripts/verify-org-seat-cap.mjs
//
// Gate-3 receipt for the Phase-2a org-aware seat cap (server/organizationSeats.ts
// resolveActiveSeatCap). Mirrors the pure function and proves the Q1 parity
// guarantee: when an org's pool equals the owner's current cap, the number does
// not move. If you change the logic there, change this mirror too.
//
// Run: node scripts/verify-org-seat-cap.mjs

function resolveActiveSeatCap({ organizationId, orgActiveSeatPool, ownerSeatCount, ownerPlanSeats }) {
  const ownerCap = Math.max(ownerSeatCount || 0, ownerPlanSeats || 1);
  if (organizationId != null && orgActiveSeatPool != null && orgActiveSeatPool > 0) return orgActiveSeatPool;
  return ownerCap;
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); }
  else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); }
}

// Standalone labs (no org): current owner-level behavior, unchanged.
eq("standalone hospital, default", resolveActiveSeatCap({ organizationId: null, orgActiveSeatPool: null, ownerSeatCount: 0, ownerPlanSeats: 15 }), 15);
eq("standalone, custom seat_count wins", resolveActiveSeatCap({ organizationId: null, orgActiveSeatPool: null, ownerSeatCount: 20, ownerPlanSeats: 15 }), 20);
eq("standalone free fallback to 1", resolveActiveSeatCap({ organizationId: null, orgActiveSeatPool: null, ownerSeatCount: 0, ownerPlanSeats: 1 }), 1);

// Org-linked with pool set: cap comes from the org pool.
eq("org pool overrides owner cap", resolveActiveSeatCap({ organizationId: 1, orgActiveSeatPool: 50, ownerSeatCount: 1, ownerPlanSeats: 15 }), 50);
eq("org pool below owner plan still wins", resolveActiveSeatCap({ organizationId: 1, orgActiveSeatPool: 10, ownerSeatCount: 1, ownerPlanSeats: 25 }), 10);

// Org-linked but pool not migrated yet (null/0): defensive fallback to owner cap.
eq("org, pool null -> owner cap", resolveActiveSeatCap({ organizationId: 1, orgActiveSeatPool: null, ownerSeatCount: 1, ownerPlanSeats: 25 }), 25);
eq("org, pool 0 -> owner cap", resolveActiveSeatCap({ organizationId: 1, orgActiveSeatPool: 0, ownerSeatCount: 1, ownerPlanSeats: 15 }), 15);

// Q1 parity snapshot: migration sets pool = owner cap, so the number is identical.
// Gameday (#66 enterprise, seat_count 1 -> ownerCap 25), pool migrated to 25.
eq("Gameday parity (pool==cap==25)", resolveActiveSeatCap({ organizationId: 1, orgActiveSeatPool: 25, ownerSeatCount: 1, ownerPlanSeats: 25 }), 25);
// UMass Milford (#33 hospital, seat_count 15 -> ownerCap 15), pool migrated to 15.
eq("UMass parity (pool==cap==15)", resolveActiveSeatCap({ organizationId: 2, orgActiveSeatPool: 15, ownerSeatCount: 15, ownerPlanSeats: 15 }), 15);
// San Carlos (#37 enterprise, seat_count 1 -> 25), pool 25.
eq("San Carlos parity (25)", resolveActiveSeatCap({ organizationId: 3, orgActiveSeatPool: 25, ownerSeatCount: 1, ownerPlanSeats: 25 }), 25);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
