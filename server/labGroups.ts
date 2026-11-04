// server/labGroups.ts
//
// A lab's named groups of people (Michael 2026-11-04: "build a group (leads, supervisors, etc.) and set the email reminder
// to everyone assigned to that group"). VeritaTrack reminders use them first; the VeritaDC approval steps (parity plan
// Phase 1 item 3) are meant to use these same rows, so a group belongs to the lab, not to one module.
//
// A member is a VeritaStaff roster person or a typed address. The roster has no email column, so a roster person's address
// is looked up when it is needed: their login, else their staff login seat, else the address the lab typed for them. That
// lookup is why someone who leaves stops getting reminders on their own: a person no longer active on the roster is skipped.
// Do not read staff_employees.user_id here: it holds the account OWNER on every row (see server/rosterMembers.ts).

export const GROUP_NAME_MAX = 60;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface GroupRecipient { email: string; name?: string }
export interface ResolvedGroup { name: string; recipients: GroupRecipient[] }
export interface GroupMemberView {
  id: number;
  employee_id: number | null;
  name: string | null;
  email: string | null;
  inactive: boolean;
}

// Collapse inner whitespace and trim, so "  Lab   Leads " and "Lab Leads" are one group.
export function cleanGroupName(name: unknown): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

// Why a proposed group name cannot be used, or null when it can. `taken` is the lab's other group names, retired ones
// included, so a retired name is brought back rather than duplicated.
export function groupNameProblem(name: unknown, taken: readonly string[] = []): string | null {
  const n = cleanGroupName(name);
  if (!n) return "Enter a group name.";
  if (n.length > GROUP_NAME_MAX) return `Keep the name to ${GROUP_NAME_MAX} characters or fewer.`;
  if (/[—–]/.test(n)) return "Use a hyphen instead of a dash."; // em or en dash (copy rule, CLAUDE.md section 3)
  if (taken.some((t) => cleanGroupName(t).toLowerCase() === n.toLowerCase())) return `"${n}" already exists for this lab.`;
  return null;
}

// The address on file for a roster person: their login, else their staff login seat. Null when they have neither.
export function employeeLoginAddress(sqlite: any, emp: { id: number; login_user_id?: number | null }): string | null {
  if (emp.login_user_id) {
    const u = sqlite.prepare("SELECT email FROM users WHERE id = ?").get(emp.login_user_id) as any;
    if (u?.email && EMAIL_RE.test(u.email)) return u.email;
  }
  const seat = sqlite.prepare(
    "SELECT seat_email FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status IN ('active','pending') ORDER BY id DESC LIMIT 1"
  ).get(emp.id) as any;
  return seat?.seat_email && EMAIL_RE.test(seat.seat_email) ? seat.seat_email : null;
}

export function labGroupMembers(sqlite: any, labId: number, groupId: number): GroupMemberView[] {
  const rows = sqlite.prepare(
    "SELECT id, employee_id, email, name FROM lab_group_members WHERE group_id = ? AND lab_id = ? ORDER BY id"
  ).all(groupId, labId) as any[];
  return rows.map((m) => {
    if (m.employee_id == null) return { id: m.id, employee_id: null, name: m.name || null, email: m.email || null, inactive: false };
    const emp = sqlite.prepare(
      "SELECT id, first_name, last_name, status, login_user_id FROM staff_employees WHERE id = ? AND tier2_lab_id = ?"
    ).get(m.employee_id, labId) as any;
    if (!emp) return { id: m.id, employee_id: m.employee_id, name: m.name || null, email: null, inactive: true };
    return {
      id: m.id,
      employee_id: m.employee_id,
      name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || m.name || null,
      email: employeeLoginAddress(sqlite, emp) || m.email || null,
      inactive: emp.status !== "active",
    };
  });
}

// Who a group's emails go to today: its active members with an address, one line per address. Null when the group is
// retired, is not this lab's, or reaches nobody, so the caller falls back rather than dropping a reminder.
export function resolveLabGroup(sqlite: any, labId: number, groupId: number): ResolvedGroup | null {
  const g = sqlite.prepare("SELECT name, retired FROM lab_groups WHERE id = ? AND lab_id = ?").get(groupId, labId) as any;
  if (!g || g.retired) return null;
  const seen = new Set<string>();
  const recipients: GroupRecipient[] = [];
  for (const m of labGroupMembers(sqlite, labId, groupId)) {
    if (m.inactive || !m.email || seen.has(m.email.toLowerCase())) continue;
    seen.add(m.email.toLowerCase());
    recipients.push(m.name ? { email: m.email, name: m.name } : { email: m.email });
  }
  return recipients.length ? { name: g.name, recipients } : null;
}

// What the screens read. Member lists and the roster (names and addresses) are for the people who manage groups; everyone
// else who can pick a group on a task sees its name and how many people are in it.
export function labGroupsPayload(sqlite: any, labId: number | null | undefined, canEdit: boolean) {
  if (!labId) return { groups: [], roster: [], can_edit: false };
  const taskCounts = new Map<number, number>();
  for (const r of sqlite.prepare(
    "SELECT reminder_group_id AS id, COUNT(*) AS n FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 AND reminder_group_id IS NOT NULL GROUP BY reminder_group_id"
  ).all(labId) as any[]) taskCounts.set(Number(r.id), Number(r.n));
  const groups = (sqlite.prepare("SELECT id, name, retired FROM lab_groups WHERE lab_id = ? ORDER BY name COLLATE NOCASE").all(labId) as any[]).map((g) => {
    const members = labGroupMembers(sqlite, labId, g.id);
    return {
      id: g.id,
      name: g.name,
      retired: !!g.retired,
      task_count: taskCounts.get(g.id) || 0,
      member_count: members.filter((m) => !m.inactive).length,
      ...(canEdit ? { members } : {}),
    };
  });
  const roster = canEdit
    ? (sqlite.prepare(
        "SELECT id, first_name, last_name, login_user_id FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
      ).all(labId) as any[]).map((e) => ({
        id: e.id,
        name: `${e.last_name || ""}, ${e.first_name || ""}`.replace(/^,\s*|,\s*$/g, "").trim() || `Staff ${e.id}`,
        email: employeeLoginAddress(sqlite, e),
      }))
    : [];
  return { groups, roster, can_edit: canEdit };
}
