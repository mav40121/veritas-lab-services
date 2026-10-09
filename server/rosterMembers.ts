// VeritaStaff roster prompt (Michael 2026-10-08, Q2 option 1).
//
// Lab Members (who can sign in) and the VeritaStaff roster (the lab's CLIA
// personnel record) are separate records. An editor/admin/MD invite creates the
// login only, so the director had to enter every invited person again in
// VeritaStaff and nothing showed who was missing. This module lists the lab's
// active members who are not on the roster yet, so VeritaStaff can offer
// "Add to roster" (pre-filled, the director confirms title and testing) or
// "Link to existing entry" when a roster row with the same name already exists.
//
// A roster row is tied to a login by staff_employees.login_user_id (the person's
// OWN users.id). Do not confuse it with staff_employees.user_id, which is NOT
// NULL and holds the account OWNER id on every row. A Staff (read-and-sign)
// login is already tied to its roster row through user_seats.staff_employee_id
// on its staff_portal seat, so either link counts as "on the roster".
//
// Left off the list: Veritas support users (users.vls_support = 1; they have no
// place on a lab's roster) and members the director marked "not lab personnel"
// (staff_roster_prompt_hidden).

export type RosterMember = {
  userId: number;
  name: string | null;
  email: string;
  role: string;
  firstName: string;
  lastName: string;
  match: { employeeId: number; name: string } | null;
};

/** Split a users.name into roster first/last. Last word is the last name. */
export function splitName(full: string | null | undefined): { firstName: string; lastName: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Is this login already on this lab's active roster (either link)? */
export function isOnRoster(sqlite: any, labId: number, userId: number): boolean {
  const direct = sqlite.prepare(
    "SELECT 1 FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND login_user_id = ? LIMIT 1"
  ).get(labId, userId);
  if (direct) return true;
  const viaSeat = sqlite.prepare(
    `SELECT 1 FROM user_seats us JOIN staff_employees se ON se.id = us.staff_employee_id
      WHERE us.seat_user_id = ? AND us.seat_type = 'staff_portal' AND us.status = 'active'
        AND se.tier2_lab_id = ? AND se.status = 'active' LIMIT 1`
  ).get(userId, labId);
  return !!viaSeat;
}

/** Active roster rows in this lab that no login is tied to yet. */
function unlinkedEmployees(sqlite: any, labId: number): { id: number; first_name: string; last_name: string }[] {
  return sqlite.prepare(
    `SELECT se.id, se.first_name, se.last_name FROM staff_employees se
      WHERE se.tier2_lab_id = ? AND se.status = 'active' AND se.login_user_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_seats us WHERE us.staff_employee_id = se.id
                         AND us.seat_type = 'staff_portal' AND us.status = 'active' AND us.seat_user_id IS NOT NULL)`
  ).all(labId);
}

function findMatch(pool: { id: number; first_name: string; last_name: string }[], firstName: string, lastName: string) {
  if (!lastName) return null;
  const first = norm(firstName), firstToken = first.split(/\s+/)[0];
  const hit = pool.find((e) => {
    if (norm(e.last_name) !== norm(lastName)) return false;
    const ef = norm(e.first_name);
    return ef === first || ef.split(/\s+/)[0] === firstToken;
  });
  return hit ? { employeeId: hit.id, name: `${hit.last_name}, ${hit.first_name}` } : null;
}

/** The prompt: active members not on the roster, split into shown and hidden. */
export function membersNotOnRoster(sqlite: any, labId: number): { members: RosterMember[]; hidden: RosterMember[] } {
  const rows = sqlite.prepare(
    `SELECT lm.user_id, lm.role, u.name, u.email
       FROM lab_members lm JOIN users u ON u.id = lm.user_id
      WHERE lm.lab_id = ? AND lm.status = 'active' AND COALESCE(u.vls_support, 0) = 0
      ORDER BY CASE lm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, lm.created_at ASC`
  ).all(labId) as { user_id: number; role: string; name: string | null; email: string }[];
  const hiddenIds = new Set<number>(
    (sqlite.prepare("SELECT user_id FROM staff_roster_prompt_hidden WHERE lab_id = ?").all(labId) as { user_id: number }[]).map((r) => r.user_id)
  );
  const pool = unlinkedEmployees(sqlite, labId);
  const members: RosterMember[] = [], hidden: RosterMember[] = [];
  for (const r of rows) {
    if (isOnRoster(sqlite, labId, r.user_id)) continue;
    const { firstName, lastName } = splitName(r.name);
    const m: RosterMember = { userId: r.user_id, name: r.name, email: r.email, role: r.role, firstName, lastName, match: findMatch(pool, firstName, lastName) };
    (hiddenIds.has(r.user_id) ? hidden : members).push(m);
  }
  return { members, hidden };
}

/**
 * Can this login be tied to a roster row in this lab? Returns null when it can,
 * or { status, error, code } to send back.
 */
export function rosterLinkProblem(sqlite: any, labId: number, userId: unknown): { status: number; error: string; code: string } | null {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return { status: 400, error: "Choose a lab member to link.", code: "LOGIN_REQUIRED" };
  const member = sqlite.prepare(
    `SELECT COALESCE(u.vls_support, 0) AS vls FROM lab_members lm JOIN users u ON u.id = lm.user_id
      WHERE lm.lab_id = ? AND lm.user_id = ? AND lm.status = 'active' LIMIT 1`
  ).get(labId, uid) as { vls: number } | undefined;
  if (!member) return { status: 400, error: "That person is not an active member of this lab.", code: "NOT_A_MEMBER" };
  if (Number(member.vls) === 1) return { status: 400, error: "Veritas support accounts are not part of a lab's roster.", code: "VLS_SUPPORT_NOT_ROSTER" };
  if (isOnRoster(sqlite, labId, uid)) return { status: 409, error: "This person is already on the roster.", code: "ALREADY_ON_ROSTER" };
  return null;
}
