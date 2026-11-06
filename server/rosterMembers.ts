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

/**
 * The active roster row a Staff invite typed by name refers to (Michael 2026-11-04, Redington). An invite from Lab Members always made a
 * new roster row, so everyone already on the roster got a second one. One match is that person. Two people with the same name are told
 * apart by who has no login yet; if that doesn't settle it, the director invites from the person's row in VeritaStaff.
 */
export function rosterRowForInvite(sqlite: any, labId: number, firstName: string, lastName: string): { employeeId: number } | { ambiguous: true } | null {
  const last = norm(lastName), first = norm(firstName), firstToken = first.split(/\s+/)[0];
  if (!last || !first) return null;
  const same = (sqlite.prepare("SELECT id, first_name, last_name FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active'").all(labId) as { id: number; first_name: string; last_name: string }[])
    .filter((e) => {
      if (norm(e.last_name) !== last) return false;
      const ef = norm(e.first_name);
      return ef === first || ef.split(/\s+/)[0] === firstToken;
    });
  if (same.length === 0) return null;
  if (same.length === 1) return { employeeId: same[0].id };
  const free = new Set(unlinkedEmployees(sqlite, labId).map((e) => e.id));
  const open = same.filter((e) => free.has(e.id));
  return open.length === 1 ? { employeeId: open[0].id } : { ambiguous: true };
}

/**
 * A pending Staff invite tied to a roster row that's no longer active (the duplicate someone cleaned up) can't work when it's accepted.
 * Re-attach it when exactly one active row has the same name. Safe to repeat. Returns how many moved.
 */
export function reattachOrphanStaffInvites(sqlite: any, labId: number): number {
  const orphans = sqlite.prepare(
    `SELECT us.id, se.first_name, se.last_name FROM user_seats us
       JOIN staff_employees se ON se.id = us.staff_employee_id
      WHERE us.lab_id = ? AND us.seat_type = 'staff_portal' AND us.status = 'pending' AND se.status != 'active'`
  ).all(labId) as { id: number; first_name: string; last_name: string }[];
  let moved = 0;
  for (const o of orphans) {
    const hit = rosterRowForInvite(sqlite, labId, o.first_name, o.last_name);
    if (!hit || "ambiguous" in hit) continue;
    const taken = sqlite.prepare("SELECT 1 FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status != 'deactivated' LIMIT 1").get(hit.employeeId);
    if (taken) continue;
    moved += Number(sqlite.prepare("UPDATE user_seats SET staff_employee_id = ? WHERE id = ? AND status = 'pending'").run(hit.employeeId, o.id).changes || 0);
  }
  return moved;
}

// Anything here means a row holds real work, so it's never folded into another row automatically.
const ROW_HOLDS_WORK = [
  ["staff_roles", "employee_id"], ["staff_employee_instruments", "employee_id"], ["competency_employees", "staff_employee_id"], ["competency_method_signoffs", "staff_employee_id"],
  ["competency_quiz_assignments", "staff_employee_id"], ["schedule_assignments", "staff_employee_id"], ["lab_group_members", "employee_id"], ["policy_read_sign_assignments", "employee_id"], ["policy_prior_signatures", "staff_employee_id"],
];

/**
 * Fold the second card an invite made into the person's real card (Michael 2026-11-04: "at time of invite, can we link it to the staff
 * card?"; Redington's two Austin cards). Only a row an invite made and that holds no work: no testing, hire date, login, roles, instruments,
 * competencies, quizzes or groups. Only when exactly one other active row has the same name and it has no login yet. The seat and any
 * signatures move to the real card; the extra row is set aside, never deleted. Safe to repeat. Returns how many were folded.
 */
export function foldInviteDuplicates(sqlite: any, labId: number): { employeeId: number; into: number }[] {
  const seats = sqlite.prepare(
    `SELECT us.id AS seat_id, se.id AS row_id, se.first_name, se.last_name FROM user_seats us
       JOIN staff_employees se ON se.id = us.staff_employee_id
      WHERE us.lab_id = ? AND us.seat_type = 'staff_portal' AND us.status != 'deactivated' AND se.status = 'active'
        AND COALESCE(se.performs_testing, 0) = 0 AND se.hire_date IS NULL AND se.login_user_id IS NULL`
  ).all(labId) as { seat_id: number; row_id: number; first_name: string; last_name: string }[];
  const folded: { employeeId: number; into: number }[] = [];
  for (const s of seats) {
    const holdsWork = ROW_HOLDS_WORK.some(([table, col]) => {
      try { return !!sqlite.prepare(`SELECT 1 FROM ${table} WHERE ${col} = ? LIMIT 1`).get(s.row_id); } catch { return true; }
    });
    if (holdsWork) continue;
    const last = norm(s.last_name), first = norm(s.first_name), firstToken = first.split(/\s+/)[0];
    const others = (sqlite.prepare("SELECT id, first_name, last_name, login_user_id FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND id != ?").all(labId, s.row_id) as any[])
      .filter((e) => norm(e.last_name) === last && (norm(e.first_name) === first || norm(e.first_name).split(/\s+/)[0] === firstToken));
    if (others.length !== 1 || others[0].login_user_id != null) continue;
    const target = others[0].id as number;
    if (sqlite.prepare("SELECT 1 FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status != 'deactivated' LIMIT 1").get(target)) continue;
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      sqlite.prepare("UPDATE user_seats SET staff_employee_id = ? WHERE id = ?").run(target, s.seat_id);
      for (const table of ["staff_portal_policy_signatures", "staff_portal_competency_signatures"]) {
        try { sqlite.prepare(`UPDATE OR IGNORE ${table} SET staff_employee_id = ? WHERE staff_employee_id = ?`).run(target, s.row_id); } catch { /* table absent on a very old database */ }
      }
      sqlite.prepare("UPDATE staff_employees SET status = 'merged_duplicate', updated_at = ? WHERE id = ?").run(now, s.row_id);
    })();
    folded.push({ employeeId: s.row_id, into: target });
  }
  return folded;
}

export type RosterStaffRow = { employeeId: number; name: string; title: string | null; status: "login" | "invited" | "not_invited"; email: string | null };

/** Everyone on the VeritaStaff roster as a staff member of the lab: whether they can sign in, are invited, or haven't been invited yet. */
export function rosterStaffStatus(sqlite: any, labId: number): { people: RosterStaffRow[]; counts: { total: number; login: number; invited: number; not_invited: number } } {
  reattachOrphanStaffInvites(sqlite, labId);
  foldInviteDuplicates(sqlite, labId);
  const rows = sqlite.prepare(
    "SELECT id, first_name, last_name, middle_initial, title, login_user_id FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
  ).all(labId) as any[];
  const seats = sqlite.prepare(
    "SELECT staff_employee_id, status, accepted_at, seat_email FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status != 'deactivated' AND staff_employee_id IS NOT NULL"
  ).all(labId) as any[];
  const seatBy = new Map<number, any>(seats.map((s) => [s.staff_employee_id, s]));
  const people: RosterStaffRow[] = rows.map((e) => {
    const seat = seatBy.get(e.id);
    const status = e.login_user_id != null || seat?.accepted_at ? "login" : seat ? "invited" : "not_invited";
    const name = [e.last_name, e.first_name].filter(Boolean).join(", ") + (e.middle_initial ? ` ${e.middle_initial}.` : "");
    return { employeeId: e.id, name, title: e.title ?? null, status, email: seat?.seat_email ?? null };
  });
  const count = (s: string) => people.filter((p) => p.status === s).length;
  return { people, counts: { total: people.length, login: count("login"), invited: count("invited"), not_invited: count("not_invited") } };
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
