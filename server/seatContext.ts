// server/seatContext.ts
//
// Which seat (if any) a request is acting under. Parking lot #82 (2026-10-08).
//
// user_seats rows are lab-scoped: (owner_user_id, seat_user_id, lab_id). The old
// lookups took a user's FIRST active seat anywhere (`WHERE seat_user_id = ? AND
// status = 'active' LIMIT 1`, no lab) and treated the whole session as that
// seat. That is only safe for a user whose access comes entirely from one owner.
// An owner who also holds a seat on someone else's lab was turned into that
// other owner's seat user on every request: from 2026-10-01 Michael (user 17,
// owner of labs 1/3/7/14/21/22/24/34) held seats on labs 31, 32 and 25-28, so
// the auth layer resolved him as a seat of user 81 (St. Charles). His writes in
// his own labs were stamped user_id 81 (studies, VeritaTrack tasks and
// sign-offs, a verification) and login and /api/auth/me reported user 81's plan
// and that seat's permissions as his.
//
// Rules, kept as narrow as the bug:
//   * A user who owns NO lab keeps the legacy behavior exactly: first active
//     seat by id (staff whose only access is one owner's seat, San Carlos,
//     Lifepoint, Gameday staff portal, Lisa's gmail account).
//   * An owner working in a lab they own, belong to, or hold a seat on uses the
//     seat for THAT lab (lab_id match, or a legacy lab-less seat under that
//     lab's owner); none means they act as themselves.
//   * An owner with no usable lab context acts as themselves. A seat they hold
//     under their OWN account (self-seats exist for labs 2/6, 18, 25-28) keeps
//     its legacy shape, so those owners see no change.

/** Seat lookup with no lab context. Non-owners: unchanged legacy first seat. Owners: only a seat under their own account. */
export function legacySeatForUser(sqlite: any, userId: number, cols = "owner_user_id"): any | null {
  const ownsLab = sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = ? LIMIT 1").get(userId);
  if (ownsLab) {
    return (
      sqlite
        .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND owner_user_id = ? ORDER BY id LIMIT 1`)
        .get(userId, userId) ?? null
    );
  }
  return (
    sqlite
      .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' ORDER BY id LIMIT 1`) // seat-scope-ok: non-owner legacy fallback (#82)
      .get(userId) ?? null
  );
}

/** The active seat a user holds for one lab: a lab_id match, else a legacy lab-less seat under that lab's owner. */
export function seatForLab(sqlite: any, userId: number, labId: number, cols = "owner_user_id"): any | null {
  return (
    sqlite
      .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND lab_id = ? ORDER BY id LIMIT 1`)
      .get(userId, labId) ??
    sqlite
      .prepare(
        `SELECT ${cols} FROM user_seats
          WHERE seat_user_id = ? AND status = 'active' AND lab_id IS NULL
            AND owner_user_id = (SELECT owner_user_id FROM labs WHERE id = ?)
          ORDER BY id LIMIT 1`,
      )
      .get(userId, labId) ??
    null
  );
}

/** True when the user owns the lab, is an active member of it, or holds an active seat on it. */
export function userTouchesLab(sqlite: any, userId: number, labId: number): boolean {
  return !!sqlite
    .prepare(
      `SELECT 1 AS ok FROM labs WHERE id = ? AND owner_user_id = ?
       UNION SELECT 1 AS ok FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'
       UNION SELECT 1 AS ok FROM user_seats WHERE lab_id = ? AND seat_user_id = ? AND status = 'active'
       LIMIT 1`,
    )
    .get(labId, userId, labId, userId, labId, userId);
}

/**
 * The seat a request acts under. `ctxLabId` is the lab being worked in (URL
 * :labId, else ?labId / X-Active-Lab-Id / Referer), or null.
 */
export function seatForRequest(sqlite: any, userId: number, ctxLabId: number | null, cols = "owner_user_id"): any | null {
  const ownsLab = sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = ? LIMIT 1").get(userId);
  if (!ownsLab) return legacySeatForUser(sqlite, userId, cols);
  if (ctxLabId && userTouchesLab(sqlite, userId, ctxLabId)) return seatForLab(sqlite, userId, ctxLabId, cols);
  return legacySeatForUser(sqlite, userId, cols);
}
