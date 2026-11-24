// server/ownRoster.ts
//
// Who a signed-in person is on a lab's VeritaStaff roster (Michael 2026-11-18: "Quizzes can be assigned to admins just as
// easy as staff. That's the real fix."; Redington's microbiology supervisor, on an admin seat, could be assigned a quiz but
// had no bell and no Take a Quiz). A quiz, a document to sign and a competency to acknowledge belong to a roster row, so the
// bell and the My sign-offs screens need the person's OWN row. Two links count, the same two rosterMembers.ts isOnRoster
// reads:
//   1. a Staff login: the active staff_portal seat's staff_employee_id (the only link before this);
//   2. any other sign-in: the active roster row whose login_user_id is this user (set by VeritaStaff's "Add to roster" /
//      "Link to existing entry"), in a lab where the user is still an active member or the owner.
// Never staff_employees.user_id: that column holds the account OWNER's id on every row, which is how an owner's bell once
// listed every staff member's work as their own (fixed 2026-10-08). At most one row per lab per user.

export interface OwnRosterRow { id: number; tier2_lab_id: number; via: "staff_seat" | "login" }

export function ownRosterRows(sqlite: any, userId: number, labId?: number | null): OwnRosterRow[] {
  const lab = labId != null && Number.isFinite(labId) && labId > 0 ? Number(labId) : null;
  const seatRows = (sqlite.prepare(
    `SELECT staff_employee_id AS id, lab_id AS tier2_lab_id FROM user_seats
      WHERE seat_user_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL
        ${lab ? "AND lab_id = ?" : ""}
      ORDER BY id`,
  ).all(...(lab ? [userId, lab] : [userId])) as any[]).map((r) => ({ id: Number(r.id), tier2_lab_id: Number(r.tier2_lab_id), via: "staff_seat" as const }));
  const loginRows = (sqlite.prepare(
    `SELECT se.id, se.tier2_lab_id FROM staff_employees se
      WHERE se.login_user_id = ? AND se.status = 'active' AND se.tier2_lab_id IS NOT NULL
        ${lab ? "AND se.tier2_lab_id = ?" : ""}
        AND (EXISTS (SELECT 1 FROM lab_members lm WHERE lm.lab_id = se.tier2_lab_id AND lm.user_id = se.login_user_id AND lm.status = 'active')
             OR EXISTS (SELECT 1 FROM labs l WHERE l.id = se.tier2_lab_id AND l.owner_user_id = se.login_user_id))
      ORDER BY se.id`,
  ).all(...(lab ? [userId, lab] : [userId])) as any[]).map((r) => ({ id: Number(r.id), tier2_lab_id: Number(r.tier2_lab_id), via: "login" as const }));
  // One row per lab: a Staff login's seat link first, then the login link.
  const byLab = new Map<number, OwnRosterRow>();
  for (const r of [...seatRows, ...loginRows]) if (!byLab.has(r.tier2_lab_id)) byLab.set(r.tier2_lab_id, r);
  return [...byLab.values()];
}

// The one roster row a My sign-offs session acts as: the lab asked for (the active lab), else a Staff login's seat (the primary
// lab's when they are Staff in several labs, B3), else the person's primary lab, else the lowest lab id.
export function ownRosterRowForSession(sqlite: any, userId: number, preferLabId?: number | null): { lab_id: number; staff_employee_id: number; via: OwnRosterRow["via"] } | null {
  const rows = ownRosterRows(sqlite, userId);
  if (!rows.length) return null;
  const want = preferLabId != null && Number.isFinite(preferLabId) && preferLabId > 0 ? Number(preferLabId) : null;
  const primary = (sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' AND is_primary_lab = 1 LIMIT 1").get(userId) as any)?.lab_id ?? null;
  const pick = (want != null && rows.find((r) => r.tier2_lab_id === want))
    || (primary != null && rows.find((r) => r.via === "staff_seat" && r.tier2_lab_id === Number(primary)))
    || rows.find((r) => r.via === "staff_seat")
    || (primary != null && rows.find((r) => r.tier2_lab_id === Number(primary)))
    || [...rows].sort((a, b) => a.tier2_lab_id - b.tier2_lab_id)[0];
  return { lab_id: pick.tier2_lab_id, staff_employee_id: pick.id, via: pick.via };
}

// Labs where this person can have document approvals waiting: every lab they are an active member of, or own.
export function labsForApprovals(sqlite: any, userId: number, labId?: number | null): number[] {
  const lab = labId != null && Number.isFinite(labId) && labId > 0 ? Number(labId) : null;
  const ids = (sqlite.prepare(
    `SELECT lab_id AS id FROM lab_members WHERE user_id = ? AND status = 'active'
     UNION SELECT lab_id AS id FROM user_seats WHERE seat_user_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND lab_id IS NOT NULL
     UNION SELECT id FROM labs WHERE owner_user_id = ?`,
  ).all(userId, userId, userId) as any[]).map((r) => Number(r.id)).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(ids)].filter((id) => lab == null || id === lab).sort((a, b) => a - b);
}
