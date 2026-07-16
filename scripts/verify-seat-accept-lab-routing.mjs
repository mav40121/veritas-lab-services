// scripts/verify-seat-accept-lab-routing.mjs
//
// Receipt for the seat-accept lab-routing fix in server/routes.ts (the register
// seat-accept branch). A seat's explicit lab_id is honored for EVERY seat type;
// only a regular seat with NO lab_id falls back to the inviter's primary lab.
// This closes the leak where a prospect on a lab-scoped seat auto-joined the
// inviter's primary/showcase lab (Michaels Lab, lab 3).
//
// Input set is the REAL observed production seats (2026-07-16 snapshot).
// Run: node scripts/verify-seat-accept-lab-routing.mjs

function resolveTargetLab(seatInvite, ownerPrimaryLabId) {
  const isStaffPortal = seatInvite.seat_type === "staff_portal";
  return seatInvite.lab_id
    ?? (isStaffPortal ? null : ownerPrimaryLabId);
}

// [label, seatInvite, ownerPrimaryLabId, expectedTargetLab]
const cases = [
  // The fix: Faith Medical Center's seat carried lab_id=14; must route to 14,
  // NOT the inviter's primary lab 3 (Michaels Lab). This was the leak.
  ["regular seat, lab_id=14, owner primary=3  -> 14 (prospect to OWN lab)", { seat_type: "active", lab_id: 14 }, 3, 14],
  // Tywauna-style null seat: still falls back to primary (unchanged); a null
  // seat can only be routed by the invite side setting lab_id.
  ["regular seat, lab_id=null, owner primary=3 -> 3 (fallback, unchanged)", { seat_type: "active", lab_id: null }, 3, 3],
  // San Carlos staff seats: unchanged either way.
  ["regular seat, lab_id=2, owner primary=2   -> 2 (San Carlos, no change)", { seat_type: "active", lab_id: 2 }, 2, 2],
  ["regular seat, lab_id=null, owner primary=2 -> 2 (San Carlos null, no change)", { seat_type: "active", lab_id: null }, 2, 2],
  ["regular seat, lab_id=6, owner primary=2   -> 6 (SCAHC seat scoped to lab 6)", { seat_type: "active", lab_id: 6 }, 2, 6],
  // staff_portal: unchanged (already used seat.lab_id; null -> no join).
  ["staff_portal seat, lab_id=14              -> 14 (unchanged)", { seat_type: "staff_portal", lab_id: 14 }, 3, 14],
  ["staff_portal seat, lab_id=null            -> null (unchanged, no join)", { seat_type: "staff_portal", lab_id: null }, 3, null],
];

let failed = 0;
for (const [label, seat, primary, want] of cases) {
  const got = resolveTargetLab(seat, primary);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
}
console.log(failed ? `\n${failed} FAILED` : "\nAll seat-accept routing cases passed.");
process.exit(failed ? 1 : 0);
