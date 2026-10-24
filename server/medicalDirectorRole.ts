// server/medicalDirectorRole.ts
//
// A lab's medical director has admin rights (Michael 2026-10-23, Heywood lab 38: "If he is the medical director then he
// is an admin"). The medical director is designated by email (labs.medical_director_email) and keeps the free seat;
// this module only sets the ROLE:
//   - the director's active membership on the lab is raised to admin (an owner is never touched),
//   - a pending invitation for the director on the lab becomes an admin invitation, so accepting it grants admin.
// Read-and-sign staff logins (seat_type 'staff_portal') are left alone. Nobody is ever demoted: a former director who
// was raised keeps admin. Every place that creates a membership or names a director calls
// promoteMedicalDirectorToAdmin for that lab; POST /api/admin/promote-medical-directors corrects existing records.

type Sqlite = any;

const directorEmail = (sqlite: Sqlite, labId: number): string => {
  const lab = sqlite.prepare("SELECT medical_director_email FROM labs WHERE id = ?").get(labId) as any;
  return String(lab?.medical_director_email || "").trim().toLowerCase();
};

const MEMBER_WHERE = `lm.lab_id = ? AND lm.status = 'active' AND lm.role NOT IN ('owner', 'admin')
  AND lm.user_id IN (SELECT u.id FROM users u WHERE lower(u.email) = ?)
  AND NOT EXISTS (SELECT 1 FROM user_seats s WHERE s.lab_id = lm.lab_id AND s.seat_user_id = lm.user_id
                  AND s.seat_type = 'staff_portal' AND s.status != 'deactivated')`;
const INVITE_WHERE = `lab_id = ? AND status = 'pending' AND lower(seat_email) = ?
  AND COALESCE(seat_type, 'active') != 'staff_portal' AND COALESCE(invite_role, 'staff') != 'admin'`;

// What promoteMedicalDirectorToAdmin would change on this lab (read-only).
export function medicalDirectorPromotionPreview(sqlite: Sqlite, labId: number): {
  email: string; members: { userId: number; role: string }[]; invites: number;
} {
  const email = directorEmail(sqlite, labId);
  if (!email) return { email, members: [], invites: 0 };
  const members = sqlite.prepare(`SELECT lm.user_id AS userId, lm.role AS role FROM lab_members lm WHERE ${MEMBER_WHERE}`)
    .all(labId, email) as { userId: number; role: string }[];
  let invites = 0;
  try { invites = (sqlite.prepare(`SELECT COUNT(*) AS n FROM user_seats WHERE ${INVITE_WHERE}`).get(labId, email) as any).n; } catch {}
  return { email, members, invites };
}

// Raise the lab's medical director to admin (membership and pending invitation). Returns the rows changed.
export function promoteMedicalDirectorToAdmin(sqlite: Sqlite, labId: number): { members: number; invites: number } {
  const email = directorEmail(sqlite, labId);
  if (!email) return { members: 0, invites: 0 };
  const now = new Date().toISOString();
  const members = sqlite.prepare(
    `UPDATE lab_members SET role = 'admin', updated_at = ? WHERE id IN (SELECT lm.id FROM lab_members lm WHERE ${MEMBER_WHERE})`,
  ).run(now, labId, email).changes as number;
  let invites = 0;
  try { invites = sqlite.prepare(`UPDATE user_seats SET invite_role = 'admin' WHERE ${INVITE_WHERE}`).run(labId, email).changes as number; } catch {}
  return { members, invites };
}
