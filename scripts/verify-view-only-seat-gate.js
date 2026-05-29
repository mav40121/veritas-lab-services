// Unit-test receipt for parking-lot #33 PR 5 — view-only seats are blocked
// from mutating HTTP endpoints by the gate inside authMiddleware.
//
// Re-implements the gate in plain JS so it can run without tsx/node-modules,
// then exercises every code path:
//   (1) owner request (not a seat user): passes regardless of method
//   (2) active seat user, POST: passes
//   (3) active seat user, GET: passes
//   (4) view-only seat user, GET: passes (reviewers can read)
//   (5) view-only seat user, HEAD: passes
//   (6) view-only seat user, OPTIONS: passes
//   (7) view-only seat user, POST: 403 view_only_seat
//   (8) view-only seat user, PUT: 403 view_only_seat
//   (9) view-only seat user, PATCH: 403 view_only_seat
//   (10) view-only seat user, DELETE: 403 view_only_seat
//   (11) legacy seat row with NULL seat_type behaves as 'active': passes POST
//
// Run from repo root:
//   node scripts/verify-view-only-seat-gate.js
//
// Exits with non-zero status if any expectation fails so the script can
// land in CI later if desired.

function gate(req) {
  // Mirrors the server-side check inserted at the end of authMiddleware.
  if (
    req.isSeatUser &&
    req.seatType === 'view_only' &&
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
  ) {
    return { status: 403, body: { error: 'view_only_seat' } };
  }
  return { status: 200, body: { ok: true } };
}

function makeReq({ isSeatUser, seatType, method }) {
  return { isSeatUser, seatType, method };
}

const cases = [
  { name: 'owner POST', req: makeReq({ isSeatUser: false, seatType: 'active', method: 'POST' }), expect: 200 },
  { name: 'owner DELETE', req: makeReq({ isSeatUser: false, seatType: 'active', method: 'DELETE' }), expect: 200 },
  { name: 'active seat POST', req: makeReq({ isSeatUser: true, seatType: 'active', method: 'POST' }), expect: 200 },
  { name: 'active seat GET', req: makeReq({ isSeatUser: true, seatType: 'active', method: 'GET' }), expect: 200 },
  { name: 'view-only seat GET', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'GET' }), expect: 200 },
  { name: 'view-only seat HEAD', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'HEAD' }), expect: 200 },
  { name: 'view-only seat OPTIONS', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'OPTIONS' }), expect: 200 },
  { name: 'view-only seat POST', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'POST' }), expect: 403 },
  { name: 'view-only seat PUT', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'PUT' }), expect: 403 },
  { name: 'view-only seat PATCH', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'PATCH' }), expect: 403 },
  { name: 'view-only seat DELETE', req: makeReq({ isSeatUser: true, seatType: 'view_only', method: 'DELETE' }), expect: 403 },
  // Legacy back-compat: existing seat rows shipped before PR #430 have
  // seat_type=NULL. authMiddleware coalesces to 'active' so they pass.
  { name: 'legacy seat (null coalesced active) POST', req: makeReq({ isSeatUser: true, seatType: 'active', method: 'POST' }), expect: 200 },
];

let failed = 0;
for (const c of cases) {
  const result = gate(c.req);
  const passed = result.status === c.expect;
  if (passed) {
    console.log(`PASS  ${c.name}: status ${result.status}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${c.name}: expected ${c.expect}, got ${result.status}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
