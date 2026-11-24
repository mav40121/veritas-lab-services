// server/assignablePeople.ts
//
// Who inspection work can be assigned to in a lab (B6, 2026-11-24; server/inspectionAssign.ts): the lab's
// owner, an active member, or a person on the lab's active roster with a Staff login. Its own file so the reminder job
// (server/audit.ts) can ask whether an assignee is still on the lab without importing the routes.

export interface AssignablePerson { userId: number; name: string; email: string; staffLogin: boolean }

const STAFF_LOGIN_IN = `EXISTS (SELECT 1 FROM user_seats s JOIN staff_employees se ON se.id = s.staff_employee_id AND se.status = 'active'
   WHERE s.seat_user_id = u.id AND s.lab_id = @lab AND s.seat_type = 'staff_portal' AND s.status = 'active')`;
const MEMBER_IN = `EXISTS (SELECT 1 FROM lab_members lm WHERE lm.lab_id = @lab AND lm.user_id = u.id AND lm.status = 'active')`;
const OWNER_OF = `EXISTS (SELECT 1 FROM labs l WHERE l.id = @lab AND l.owner_user_id = u.id)`;
const EDITOR_SEAT_IN = `EXISTS (SELECT 1 FROM user_seats s WHERE s.seat_user_id = u.id AND s.lab_id = @lab AND s.status = 'active' AND COALESCE(s.seat_type, 'active') <> 'staff_portal')`;
const ADMIN_IN = `EXISTS (SELECT 1 FROM lab_members lm WHERE lm.lab_id = @lab AND lm.user_id = u.id AND lm.status = 'active' AND lm.role IN ('owner', 'admin'))`;

const personSql = (where = "") => `
  SELECT u.id AS userId, u.email AS email,
         COALESCE(NULLIF(TRIM(u.name), ''),
                  (SELECT NULLIF(TRIM(COALESCE(se.first_name, '') || ' ' || COALESCE(se.last_name, '')), '')
                     FROM user_seats s JOIN staff_employees se ON se.id = s.staff_employee_id
                    WHERE s.seat_user_id = u.id AND s.lab_id = @lab LIMIT 1),
                  u.email) AS name,
         CASE WHEN ${STAFF_LOGIN_IN} AND NOT ${EDITOR_SEAT_IN} AND NOT ${ADMIN_IN} AND NOT ${OWNER_OF} THEN 1 ELSE 0 END AS staffLogin
    FROM users u
   WHERE (${OWNER_OF} OR ${MEMBER_IN} OR ${STAFF_LOGIN_IN}) ${where}
   ORDER BY name COLLATE NOCASE, u.id`;

const toPerson = (r: any): AssignablePerson => ({ userId: Number(r.userId), name: String(r.name), email: String(r.email), staffLogin: !!r.staffLogin });

/** Everyone who can be picked in this lab. */
export function assignablePeople(sqlite: any, labId: number): AssignablePerson[] {
  return (sqlite.prepare(personSql()).all({ lab: labId }) as any[]).map(toPerson);
}

/** One person, when they can be picked in this lab today; null otherwise (a stranger, someone who left, another lab's person). */
export function assignablePerson(sqlite: any, labId: number, userId: unknown): AssignablePerson | null {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = sqlite.prepare(personSql("AND u.id = @user")).get({ lab: labId, user: id }) as any;
  return r ? toPerson(r) : null;
}
