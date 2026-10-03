// Receipt for server/seatAccess.ts (Gate 3, logic). Asserts the seat-type read gate used
// on the account-wide management/operations endpoints:
//   - owner / members (not seat users)          -> allowed (not blocked)
//   - active (writer) seats                      -> allowed
//   - view_only reviewer seats                   -> BLOCKED (403 seat_not_authorized)
//   - staff_portal seats                         -> BLOCKED
// The authoritative end-to-end check is the /qa-sweep re-run: the 9 staff-seat
// OVER-PERM(main-api leak) 200s must become 403 PASS(blocked).
// Run: node_modules/.bin/tsx scripts/verify-seat-operator-gate.ts
import { blockNonOperatorSeat } from "../server/seatAccess";

let pass = 0, fail = 0;
function check(label: string, cond: boolean) { if (cond) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label}`); } }
function mockRes() { return { _code: 0 as number, _body: null as any, status(c: number) { this._code = c; return this; }, json(b: any) { this._body = b; return this; } }; }

// 1. Owner / member (not a seat user): always allowed.
{ const res = mockRes(); const blocked = blockNonOperatorSeat({ isSeatUser: false, seatType: "active" }, res);
  check("owner/member not blocked", blocked === false && res._code === 0); }

// 2. Active (writer) seat: allowed.
{ const res = mockRes(); const blocked = blockNonOperatorSeat({ isSeatUser: true, seatType: "active" }, res);
  check("active seat not blocked", blocked === false && res._code === 0); }

// 3. view_only reviewer seat: BLOCKED with 403 seat_not_authorized.
{ const res = mockRes(); const blocked = blockNonOperatorSeat({ isSeatUser: true, seatType: "view_only" }, res);
  check("view_only seat blocked (403 seat_not_authorized)", blocked === true && res._code === 403 && res._body?.error === "seat_not_authorized"); }

// 4. staff_portal seat: BLOCKED.
{ const res = mockRes(); const blocked = blockNonOperatorSeat({ isSeatUser: true, seatType: "staff_portal" }, res);
  check("staff_portal seat blocked (403)", blocked === true && res._code === 403); }

console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
