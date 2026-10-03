// Seat-type read gate for account-wide management/operations endpoints.
//
// Why this exists: a handful of legacy GLOBAL endpoints (productivity, staffing grid +
// studies, PI departments, VeritaOps cost studies, VeritaStock inventory + reorder list,
// VeritaTrack tasks + dashboard) are gated by authMiddleware + a subscription check only,
// and resolve their data by req.ownerUserId. A SEAT user inherits the owner account via
// req.ownerUserId, so a non-operator seat (a view_only compliance reviewer, or a
// staff_portal tech) was able to READ the owner's account-wide business data. The
// /qa-sweep two-way access matrix flagged this on 2026-10-03 (staff seat user 45 read 9
// management endpoints returning the owner's data).
//
// resolveSeatPermission has no "none" level (its floor is 'view'), so per-module seat
// permissions cannot express "may not view this module". The authorization boundary that
// DOES exist is the seat TYPE: 'active' seats are writers/co-managers the owner trusts;
// 'view_only' and 'staff_portal' are reviewers / portal techs who reach their data through
// their own surfaces (read-and-sign UI, the Staff Portal), not account-wide management
// reads. So these management endpoints admit only the account owner, admins, members
// (none of whom are seat users: req.isSeatUser is false for them, and they resolve to
// their OWN account, not the owner's), and ACTIVE seats.
//
// Returns true when the request was blocked (a 403 was sent) -- the caller returns
// immediately. Returns false when the caller should proceed.
export function blockNonOperatorSeat(req: any, res: any): boolean {
  if (req.isSeatUser && req.seatType && req.seatType !== "active") {
    res.status(403).json({
      error: "seat_not_authorized",
      message:
        "This management view is available to the account owner, admins, and active seats only.",
    });
    return true;
  }
  return false;
}
