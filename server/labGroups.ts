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
  // The login this person signs with, when they have one. Only people with a login can sign an approval step.
  user_id: number | null;
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

// The login a roster person signs with: their own (login_user_id), else their active staff login seat.
function employeeLoginUserId(sqlite: any, emp: { id: number; login_user_id?: number | null }): number | null {
  if (emp.login_user_id) return emp.login_user_id;
  const seat = sqlite.prepare(
    "SELECT seat_user_id FROM user_seats WHERE staff_employee_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND seat_user_id IS NOT NULL ORDER BY id DESC LIMIT 1"
  ).get(emp.id) as any;
  return seat?.seat_user_id ?? null;
}

// The login behind a typed address, only when that login belongs to this lab.
function typedAddressUserId(sqlite: any, labId: number, email: string | null): number | null {
  if (!email) return null;
  const u = sqlite.prepare(
    `SELECT u.id FROM users u
      WHERE lower(u.email) = lower(?)
        AND (EXISTS (SELECT 1 FROM lab_members lm WHERE lm.user_id = u.id AND lm.lab_id = ? AND lm.status = 'active')
          OR EXISTS (SELECT 1 FROM user_seats us WHERE us.seat_user_id = u.id AND us.lab_id = ? AND us.status = 'active'))
      LIMIT 1`
  ).get(email, labId, labId) as any;
  return u?.id ?? null;
}

export function labGroupMembers(sqlite: any, labId: number, groupId: number): GroupMemberView[] {
  const rows = sqlite.prepare(
    "SELECT id, employee_id, email, name FROM lab_group_members WHERE group_id = ? AND lab_id = ? ORDER BY id"
  ).all(groupId, labId) as any[];
  return rows.map((m) => {
    if (m.employee_id == null) return { id: m.id, employee_id: null, name: m.name || null, email: m.email || null, inactive: false, user_id: typedAddressUserId(sqlite, labId, m.email) };
    const emp = sqlite.prepare(
      "SELECT id, first_name, last_name, status, login_user_id FROM staff_employees WHERE id = ? AND tier2_lab_id = ?"
    ).get(m.employee_id, labId) as any;
    if (!emp) return { id: m.id, employee_id: m.employee_id, name: m.name || null, email: null, inactive: true, user_id: null };
    const inactive = emp.status !== "active";
    return {
      id: m.id,
      employee_id: m.employee_id,
      name: `${emp.first_name || ""} ${emp.last_name || ""}`.trim() || m.name || null,
      email: employeeLoginAddress(sqlite, emp) || m.email || null,
      inactive,
      user_id: inactive ? null : employeeLoginUserId(sqlite, emp),
    };
  });
}

// Everyone who can sign a group's approval step today: its active members with a login. Someone who leaves the roster drops
// out on their own. Used for VeritaDC approval steps (canUserApproveStep).
export function labGroupSignerIds(sqlite: any, labId: number, groupId: number): number[] {
  const ids = labGroupMembers(sqlite, labId, groupId).map((m) => m.user_id).filter((id): id is number => id != null);
  return [...new Set(ids)];
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

// The group routes, registered once per module that uses groups (VeritaTrack, VeritaDC) so each keeps its own access check
// and audit log and there is one copy of the rules. Everyone in the module reads the group names; owners and admins build the
// groups and see who is in them. There is no group delete: a retired group stays on the tasks that name it.
export function registerLabGroupRoutes(app: any, opts: {
  sqlite: any;
  prefix: string;
  readGuards: any[];
  editGuards: any[];
  audit: (req: any, event: string, detail: string) => void;
}) {
  const { sqlite, prefix, readGuards, editGuards, audit } = opts;
  const G = `${prefix}/groups`;
  const canEdit = (req: any) => req.scope?.role === "owner" || req.scope?.role === "admin";
  const payload = (req: any, editing = canEdit(req)) => labGroupsPayload(sqlite, req.scope.labId, editing);

  // In front of each route below that changes a group: the owner or admin rule, and the group when the path names one.
  const groupEditor = (req: any, res: any, next: any) => {
    if (!canEdit(req)) return res.status(403).json({ error: "Only a lab owner or admin can change groups." });
    if (req.params.id !== undefined) {
      req.labGroup = sqlite.prepare("SELECT id, name, retired FROM lab_groups WHERE id = ? AND lab_id = ?").get(Number(req.params.id), req.scope.labId);
      if (!req.labGroup) return res.status(404).json({ error: "Group not found" });
    }
    next();
  };
  const guards = [...editGuards, groupEditor];

  app.get(G, ...readGuards, (req: any, res: any) => res.json(payload(req)));

  // Add a group. Adding a name the lab retired brings it back.
  app.post(G, ...guards, (req: any, res: any) => {
    const labId = req.scope.labId;
    const name = cleanGroupName(req.body?.name);
    const existing = sqlite.prepare("SELECT id, name, retired FROM lab_groups WHERE lab_id = ?").all(labId) as any[];
    const retiredMatch = existing.find((g) => g.retired && g.name.toLowerCase() === name.toLowerCase());
    if (retiredMatch) {
      sqlite.prepare("UPDATE lab_groups SET retired = 0, updated_at = datetime('now') WHERE id = ?").run(retiredMatch.id);
      audit(req, "group_restored", retiredMatch.name);
      return res.json(payload(req, true));
    }
    const problem = groupNameProblem(name, existing.map((g) => g.name));
    if (problem) return res.status(400).json({ error: problem });
    sqlite.prepare("INSERT INTO lab_groups (lab_id, name, created_by) VALUES (?, ?, ?)").run(labId, name, req.user?.userId ?? null);
    audit(req, "group_added", name);
    res.json(payload(req, true));
  });

  // Rename and/or retire a group. Tasks and approval steps point at the group's id, so a rename moves nothing. A group on an
  // approval route can't be retired: documents would have nobody to sign that step.
  app.put(`${G}/:id`, ...guards, (req: any, res: any) => {
    const labId = req.scope.labId, group = req.labGroup;
    const wantName = req.body?.name === undefined ? group.name : cleanGroupName(req.body.name);
    const wantRetired = req.body?.retired === undefined ? !!group.retired : !!req.body.retired;
    if (wantName !== group.name) {
      const others = (sqlite.prepare("SELECT name FROM lab_groups WHERE lab_id = ? AND id <> ?").all(labId, group.id) as any[]).map((g) => g.name);
      const problem = groupNameProblem(wantName, others);
      if (problem) return res.status(400).json({ error: problem });
    }
    if (wantRetired && !group.retired) {
      const onRoute = sqlite.prepare(
        `SELECT w.name FROM policy_approval_steps s JOIN policy_approval_workflows w ON w.id = s.workflow_id
          WHERE s.approver_group_id = ? AND s.archived_at IS NULL AND w.archived_at IS NULL LIMIT 1`
      ).get(group.id) as any;
      if (onRoute) return res.status(409).json({ error: `This group signs a step on the approval route "${onRoute.name}". Take it off the route first.`, code: "GROUP_ON_ROUTE" });
    }
    sqlite.prepare("UPDATE lab_groups SET name = ?, retired = ?, updated_at = datetime('now') WHERE id = ?").run(wantName, wantRetired ? 1 : 0, group.id);
    if (wantName !== group.name) audit(req, "group_renamed", `${group.name} -> ${wantName}`);
    if (wantRetired !== !!group.retired) audit(req, wantRetired ? "group_retired" : "group_restored", wantName);
    res.json(payload(req, true));
  });

  // Add someone: a roster person, with an address when they have no login, or a typed address on its own.
  app.post(`${G}/:id/members`, ...guards, (req: any, res: any) => {
    const labId = req.scope.labId, group = req.labGroup;
    const email = String(req.body?.email ?? "").trim();
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    const current = labGroupMembers(sqlite, labId, group.id);
    const by = req.user?.userId ?? null;
    if (req.body?.employee_id != null) {
      const employeeId = Number(req.body.employee_id);
      const emp = sqlite.prepare("SELECT id, first_name, last_name FROM staff_employees WHERE id = ? AND tier2_lab_id = ? AND status = 'active'").get(employeeId, labId) as any;
      if (!emp) return res.status(400).json({ error: "That person is not on this lab's active roster." });
      if (current.some((m) => m.employee_id === employeeId)) return res.status(400).json({ error: "That person is already in this group." });
      // An address typed for this person in another group carries over, so it is only typed once.
      const typedBefore = sqlite.prepare("SELECT email FROM lab_group_members WHERE lab_id = ? AND employee_id = ? AND email IS NOT NULL LIMIT 1").get(labId, employeeId) as any;
      const address = email || typedBefore?.email || null;
      const name = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
      sqlite.prepare("INSERT INTO lab_group_members (group_id, lab_id, employee_id, email, name, added_by) VALUES (?, ?, ?, ?, ?, ?)").run(group.id, labId, employeeId, address, name, by);
      audit(req, "group_member_added", `${group.name}: ${name}`);
    } else {
      if (!email) return res.status(400).json({ error: "Pick someone from the roster or enter an email address." });
      if (current.some((m) => m.email?.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: "That address is already in this group." });
      const name = String(req.body?.name ?? "").trim() || null;
      sqlite.prepare("INSERT INTO lab_group_members (group_id, lab_id, email, name, added_by) VALUES (?, ?, ?, ?, ?)").run(group.id, labId, email, name, by);
      audit(req, "group_member_added", `${group.name}: ${name || email}`);
    }
    res.json(payload(req, true));
  });

  // Fill in or correct a typed address. For a roster person it applies wherever they are in a group.
  app.put(`${G}/:id/members/:memberId`, ...guards, (req: any, res: any) => {
    const labId = req.scope.labId, group = req.labGroup;
    const member = sqlite.prepare("SELECT id, employee_id, name, email FROM lab_group_members WHERE id = ? AND group_id = ? AND lab_id = ?").get(Number(req.params.memberId), group.id, labId) as any;
    if (!member) return res.status(404).json({ error: "That person is not in this group." });
    const email = String(req.body?.email ?? "").trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
    if (member.employee_id != null) sqlite.prepare("UPDATE lab_group_members SET email = ? WHERE lab_id = ? AND employee_id = ?").run(email, labId, member.employee_id);
    else sqlite.prepare("UPDATE lab_group_members SET email = ? WHERE id = ?").run(email, member.id);
    audit(req, "group_member_updated", `${group.name}: ${member.name || email}`);
    res.json(payload(req, true));
  });

  // Take someone out of a group. The audit row keeps who it was.
  app.delete(`${G}/:id/members/:memberId`, ...guards, (req: any, res: any) => {
    const labId = req.scope.labId, group = req.labGroup;
    const member = sqlite.prepare("SELECT id, name, email FROM lab_group_members WHERE id = ? AND group_id = ? AND lab_id = ?").get(Number(req.params.memberId), group.id, labId) as any;
    if (!member) return res.status(404).json({ error: "That person is not in this group." });
    sqlite.prepare("DELETE FROM lab_group_members WHERE id = ?").run(member.id);
    audit(req, "group_member_removed", `${group.name}: ${member.name || member.email}`);
    res.json(payload(req, true));
  });
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
      signer_count: new Set(members.map((m) => m.user_id).filter((id) => id != null)).size,
      ...(canEdit ? { members: members.map(({ user_id, ...m }) => ({ ...m, has_login: user_id != null })) } : {}),
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
