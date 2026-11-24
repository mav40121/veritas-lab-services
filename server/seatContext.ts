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
//
// One login, Staff in several labs (B3, BUG-193, 2026-11-24). A person can be Staff (read and sign) in lab B and a writer, an
// admin or an owner in lab A with the same sign-in, so a Staff seat speaks only for its own lab:
//   * A request that can land in a lab where they are only Staff acts under that Staff seat (staffLabForRequest), whatever
//     they hold elsewhere. On a /api/labs/:labId route that lab is the one in the URL.
//   * Anywhere else a Staff seat tied to another lab counts for nothing: the lab's own seat, else what they had before.
//   * With no lab to go by (sign-in, /api/auth/me) a Staff seat stands in only when they have nothing more anywhere.
// People with no Staff seat are unchanged.

/** Seat lookup with no lab context. Non-owners: the first seat that isn't a Staff seat, else a Staff seat when it's all they have. Owners: only a seat under their own account. */
export function legacySeatForUser(sqlite: any, userId: number, cols = "owner_user_id"): any | null {
  const ownsLab = sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = ? LIMIT 1").get(userId);
  if (ownsLab) {
    return (
      sqlite
        .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND owner_user_id = ? ORDER BY id LIMIT 1`)
        .get(userId, userId) ?? null
    );
  }
  const more = nonStaffSeat(sqlite, userId, cols);
  if (more) return more;
  // A lab or system admin with no seat row acts as themselves, as they did before they were given a Staff login elsewhere.
  if (managesLabWithoutStaffSeat(sqlite, userId)) return null;
  return (
    sqlite
      .prepare(
        `SELECT ${cols} FROM user_seats WHERE seat_user_id = @user AND status = 'active'
          ORDER BY CASE WHEN lab_id = (SELECT default_lab_id FROM users WHERE id = @user) THEN 0 ELSE 1 END, id LIMIT 1`, // seat-scope-ok: only Staff seats are left here; the lab they were last in, then the oldest
      )
      .get({ user: userId }) ?? null
  );
}

/** The first active seat that isn't a Staff seat, or null. */
function nonStaffSeat(sqlite: any, userId: number, cols: string): any | null {
  return (
    sqlite
      .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND COALESCE(seat_type, 'active') <> 'staff_portal' ORDER BY id LIMIT 1`) // seat-scope-ok: non-owner legacy fallback (#82)
      .get(userId) ?? null
  );
}

/** The lab's owner, its owner or admin by membership, or an owner or admin of its organization. */
export function managesLab(sqlite: any, userId: number, labId: number): boolean {
  return !!sqlite
    .prepare(
      `SELECT 1 AS ok FROM labs WHERE id = @lab AND owner_user_id = @user
       UNION SELECT 1 AS ok FROM lab_members WHERE lab_id = @lab AND user_id = @user AND status = 'active' AND role IN ('owner','admin')
       UNION SELECT 1 AS ok FROM organization_members om JOIN labs l ON l.organization_id = om.organization_id
              WHERE l.id = @lab AND om.user_id = @user AND om.status = 'active' AND om.org_role IN ('org_owner','org_admin')
       LIMIT 1`,
    )
    .get({ lab: labId, user: userId });
}

function managesLabWithoutStaffSeat(sqlite: any, userId: number): boolean {
  const staffLab = "SELECT 1 FROM user_seats us WHERE us.seat_user_id = @user AND us.status = 'active' AND us.seat_type = 'staff_portal' AND us.lab_id = l.id";
  return !!sqlite
    .prepare(
      `SELECT 1 AS ok FROM labs l
        WHERE NOT EXISTS (${staffLab})
          AND (EXISTS (SELECT 1 FROM lab_members lm WHERE lm.lab_id = l.id AND lm.user_id = @user AND lm.status = 'active' AND lm.role IN ('owner','admin'))
            OR EXISTS (SELECT 1 FROM organization_members om WHERE om.organization_id = l.organization_id AND om.user_id = @user
                        AND om.status = 'active' AND om.org_role IN ('org_owner','org_admin')))
        LIMIT 1`,
    )
    .get({ user: userId });
}

/** True when this person is Staff (read and sign) in this lab and nothing more there: the rule requireModuleEdit judges by. */
export function staffOnlyInLab(sqlite: any, userId: number, labId: number): boolean {
  if (!(Number(userId) > 0) || !(Number(labId) > 0)) return false;
  const seat = editSeatInLab(sqlite, Number(userId), Number(labId), "seat_type") as { seat_type: string | null } | null;
  return seat?.seat_type === "staff_portal" && !managesLab(sqlite, Number(userId), Number(labId));
}

/** True when the person holds an accepted Staff seat anywhere. Nobody else's requests are read any differently. */
export function holdsStaffSeat(sqlite: any, userId: number): boolean {
  return !!sqlite.prepare("SELECT 1 FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND seat_type = 'staff_portal' LIMIT 1").get(userId);
}

const labNumber = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Every lab a request could land in. On a /api/labs/:labId route, that lab. On an older route with no lab in its URL, the labs
 * it names (X-Active-Lab-Id, ?labId, and with no header the body's lab_id) that the person touches, and, when the header names
 * none of theirs, the labs the older routes fall back to (resolveLegacyLabId, resolveLabForUser).
 */
export function labsRequestCanReach(sqlite: any, userId: number, req: any): number[] {
  const path = labNumber(req?.params?.labId);
  if (path) return [path];
  const touches = (l: number | null): l is number => l != null && userTouchesLab(sqlite, userId, l);
  const header = labNumber(req?.headers?.["x-active-lab-id"]);
  const out = [header, labNumber(req?.query?.labId)];
  if (!header) out.push(labNumber(req?.body?.lab_id));
  if (!touches(header)) {
    const u = sqlite.prepare("SELECT lab_id, default_lab_id FROM users WHERE id = ?").get(userId) as any;
    const members = sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY id").all(userId) as any[];
    const primary = sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY is_primary_lab DESC, lab_id LIMIT 1").get(userId) as any;
    out.push(labNumber(u?.lab_id), labNumber(u?.default_lab_id), labNumber(members[0]?.lab_id), labNumber(primary?.lab_id));
  }
  return [...new Set(out.filter(touches))];
}

/** The lab this request could land in where the person is only Staff, or null. */
export function staffLabForRequest(sqlite: any, userId: number, req: any): number | null {
  if (!holdsStaffSeat(sqlite, userId)) return null;
  return labsRequestCanReach(sqlite, userId, req).find((l) => staffOnlyInLab(sqlite, userId, l)) ?? null;
}

/** The active seat a user holds for one lab: a lab_id match (a writer seat before a Staff seat), else a legacy lab-less seat under that lab's owner. */
export function seatForLab(sqlite: any, userId: number, labId: number, cols = "owner_user_id"): any | null {
  return (
    sqlite
      .prepare(`SELECT ${cols} FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND lab_id = ? ORDER BY CASE WHEN seat_type = 'staff_portal' THEN 1 ELSE 0 END, id LIMIT 1`)
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

/**
 * A person's one effective seat in one lab (requireModuleEdit, hasModuleEditAccess, the older study and settings routes that
 * map a seat to its owner, GET /api/labs/me's seatType, VeritaDC approval eligibility, the seat-facts support read).
 *
 * Seats with no lab (Michael 2026-11-11, Q287 = 1). POST /api/account/seats and the admin attach-seat and create-pending-seat
 * routes wrote no lab_id, and accepting an invite didn't fill it in, so a writer seat stored edit_all (Brittany, Heywood, seat
 * 149) matched no lab and its holder was refused "view-only access" in the owner's lab she belongs to. A seat with no lab now
 * counts as the person's seat in a lab when (a) the seat's owner owns that lab and (b) the person is an active member of it.
 * It never reaches a lab the person isn't a member of, or one its owner doesn't own, so a sister lab of the same owner stays
 * out (Q191; server/labAccessGuard.ts ownerMatchCounts is unchanged and never narrower than this).
 *
 * Order: a seat tied to the lab before one with no lab, then a writer seat before a Staff or view-only seat (Staff seats never
 * edit, shared/seatEditRule.ts, so an editor with a staff card is judged on the writer seat), then the oldest.
 */

/**
 * SQL for "seat row `s` is the person's seat in lab `lab`": tied to the lab, or no lab with the lab's owner as its owner and the
 * holder an active member there. `lab` and the holder are SQL expressions (a column or a named parameter), never user text.
 */
export function seatInLabSql(s: string, lab: string): string {
  return `(${s}.lab_id = ${lab} OR (${s}.lab_id IS NULL
    AND ${s}.owner_user_id = (SELECT sil_l.owner_user_id FROM labs sil_l WHERE sil_l.id = ${lab})
    AND EXISTS (SELECT 1 FROM lab_members sil_m WHERE sil_m.lab_id = ${lab} AND sil_m.user_id = ${s}.seat_user_id AND sil_m.status = 'active')))`;
}
export function seatInLabOrderSql(s: string): string {
  return `CASE WHEN ${s}.lab_id IS NULL THEN 1 ELSE 0 END, CASE WHEN COALESCE(${s}.seat_type, 'active') IN ('staff_portal', 'view_only') THEN 1 ELSE 0 END, ${s}.id`;
}
/** A correlated SQL expression: the seat_type of the person's effective seat in the lab, NULL when none. */
export function seatTypeInLabSql(user: string, lab: string): string {
  return `(SELECT sil_s.seat_type FROM user_seats sil_s WHERE sil_s.seat_user_id = ${user} AND sil_s.status = 'active' AND ${seatInLabSql("sil_s", lab)}
    ORDER BY ${seatInLabOrderSql("sil_s")} LIMIT 1)`;
}

export function editSeatInLab(sqlite: any, userId: number, labId: number, cols = "permissions, seat_type"): any | null {
  const sel = cols.split(",").map((c) => `us.${c.trim()}`).join(", ");
  return (
    sqlite
      .prepare(`SELECT ${sel} FROM user_seats us WHERE us.seat_user_id = @user AND us.status = 'active' AND ${seatInLabSql("us", "@lab")}
        ORDER BY ${seatInLabOrderSql("us")} LIMIT 1`)
      .get({ user: userId, lab: labId }) ?? null
  );
}

/**
 * Accepting an invite (Q287 = 1): a seat with no lab takes the lab when its holder is now an active member of exactly one of
 * the seat owner's labs. Anything else leaves it as it is (the read-time rule above still covers it). Returns the lab stamped.
 */
export function stampLablessSeatLab(sqlite: any, seatId: number): number | null {
  const s = sqlite.prepare("SELECT owner_user_id, seat_user_id, lab_id FROM user_seats WHERE id = ?").get(seatId) as any;
  if (!s || s.lab_id != null || !s.seat_user_id) return null;
  const labs = sqlite.prepare(
    `SELECT DISTINCT lm.lab_id AS id FROM lab_members lm JOIN labs l ON l.id = lm.lab_id
      WHERE lm.user_id = ? AND lm.status = 'active' AND l.owner_user_id = ?`
  ).all(s.seat_user_id, s.owner_user_id) as Array<{ id: number }>;
  if (labs.length !== 1) return null;
  const changed = sqlite.prepare("UPDATE user_seats SET lab_id = ? WHERE id = ? AND lab_id IS NULL").run(labs[0].id, seatId).changes;
  return changed ? Number(labs[0].id) : null;
}

/** The admin seat routes' optional labId (Q287 = 1): null when none is given, the lab when ownerUserId owns it, false otherwise. */
export function adminSeatLabId(sqlite: any, labId: unknown, ownerUserId: unknown): number | null | false {
  if (labId == null || labId === "") return null;
  const id = Number(labId);
  if (!Number.isInteger(id) || id <= 0) return false;
  return sqlite.prepare("SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ?").get(id, Number(ownerUserId)) ? id : false;
}

/**
 * The lab a new account-level seat (POST /api/account/seats) is stamped with: the lab the owner is viewing (X-Active-Lab-Id)
 * when they own it, else their one lab when they own exactly one (retired labs left out), else null as before.
 */
export function labForNewAccountSeat(sqlite: any, ownerUserId: number, activeLabHeader: unknown): number | null {
  const owned = (sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ? AND retired_at IS NULL ORDER BY id").all(ownerUserId) as Array<{ id: number }>).map((r) => Number(r.id));
  const viewing = Number(activeLabHeader);
  if (Number.isFinite(viewing) && viewing > 0 && owned.includes(viewing)) return viewing;
  return owned.length === 1 ? owned[0] : null;
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
 * :labId, else ?labId / X-Active-Lab-Id / Referer), or null. `staffLabId` is
 * staffLabForRequest's answer for the same request.
 */
export function seatForRequest(sqlite: any, userId: number, ctxLabId: number | null, cols = "owner_user_id", staffLabId: number | null = null): any | null {
  if (staffLabId) return seatForLab(sqlite, userId, staffLabId, cols);
  const ownsLab = sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = ? LIMIT 1").get(userId);
  if (!ownsLab) {
    // Not Staff in the lab being worked in, and Staff in another: that Staff seat says nothing here.
    if (ctxLabId && holdsStaffSeat(sqlite, userId) && (userTouchesLab(sqlite, userId, ctxLabId) || managesLab(sqlite, userId, ctxLabId))) {
      return seatForLab(sqlite, userId, ctxLabId, cols) ?? nonStaffSeat(sqlite, userId, cols);
    }
    return legacySeatForUser(sqlite, userId, cols);
  }
  if (ctxLabId && userTouchesLab(sqlite, userId, ctxLabId)) return seatForLab(sqlite, userId, ctxLabId, cols);
  return legacySeatForUser(sqlite, userId, cols);
}
