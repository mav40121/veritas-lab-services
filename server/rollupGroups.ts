// server/rollupGroups.ts
//
// Roll-up groups, Phase 1 (Michael 2026-11-16: "Could her consultants get a roll up of their labs with a bigger system roll
// up for angie? Can we code that? This would fit many larger systems regional director roll ups." and "Lets build it
// regardless"). A named group of labs (a region, a consultant's labs) the readiness command center can be broken out by.
//
// Presentation only. A group never grants anyone access to a lab, and the command center still shows a person exactly the
// labs /api/readiness/rollup gives them: every lab they are an active member of, plus every lab of an organization where
// they are an active org_owner or org_admin (server/organizationRoles.ts labVisibleToUser). A group's labs are filtered to
// that same set every time it is read.
//
// Two scopes, exactly one per group:
//   organization  organization_id set: a system's groups. Read and edited by that organization's active org_owner or
//                 org_admin; it holds only labs of that organization.
//   personal      owner_user_id set: one person's own network (a consultant group's lead, for example). Read and edited by
//                 that person only; it holds only labs they are an active member of.
// A lab may sit in several groups (two consultants on one lab). Group names are refused when they look like patient
// information (detectPhi), the rule every other free text in the app follows. Every change writes one audit_log row
// (module "account", entity rollup_group).
import { detectPhi } from "@shared/phiPatterns";

export const ROLLUP_GROUP_KINDS = ["region", "consultant", "other"] as const;
export type RollupGroupKind = (typeof ROLLUP_GROUP_KINDS)[number];
export const ROLLUP_GROUP_NAME_MAX = 80;

export type RollupGroupView = {
  id: number;
  name: string;
  kind: RollupGroupKind;
  scope: "organization" | "personal";
  organization_id: number | null;
  organization_name: string | null;
  lab_ids: number[];
};

export class RollupGroupError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

const ORG_ADMIN_ROLES = "('org_owner', 'org_admin')";

export type RollupLabRow = {
  id: number; lab_name: string | null; clia_number: string | null; time_zone: string | null; plan: string | null;
  organization_id: number | null; organization_name: string | null; organization_plan: string | null;
  is_trial: number | null; subscription_expires_at: string | null;
};

/**
 * The labs the command center shows this person, by name: every lab they are an active member of, plus every lab of an
 * organization where they are an active org_owner or org_admin (labVisibleToUser). Repository labs are left out. The one
 * query behind /api/readiness/rollup, its findings list and the groups' reads, so they can't show different labs.
 */
export function rollupLabsFor(sqlite: any, userId: number): RollupLabRow[] {
  return sqlite.prepare(
    `SELECT l.id, l.lab_name, l.clia_number, l.time_zone, l.plan, l.organization_id, o.name AS organization_name, o.plan AS organization_plan,
            l.is_trial, l.subscription_expires_at
       FROM labs l LEFT JOIN organizations o ON o.id = l.organization_id
      WHERE (l.is_repository IS NULL OR l.is_repository = 0)
        AND (EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = l.id AND m.user_id = ? AND m.status = 'active')
             OR l.organization_id IN (SELECT om.organization_id FROM organization_members om
                                       WHERE om.user_id = ? AND om.status = 'active' AND om.org_role IN ${ORG_ADMIN_ROLES}))
      ORDER BY l.lab_name ASC, l.id ASC`
  ).all(userId, userId) as RollupLabRow[];
}

/** The labs the command center shows this person (the same rule as /api/readiness/rollup). */
export function rollupVisibleLabIds(sqlite: any, userId: number): Set<number> {
  return new Set(rollupLabsFor(sqlite, userId).map((l) => l.id));
}

/**
 * The part of that list an organization's plan pays for: labs of an organization this person runs, when the
 * organization's plan or the lab's own is one readiness is included in (planOk is the routes' own allowlist). Used only
 * for someone whose own plan doesn't include readiness, so a lab of theirs outside those organizations stays out.
 */
export function rollupLabsOnOrganizationPlan(sqlite: any, userId: number, planOk: (plan: string | null) => boolean): RollupLabRow[] {
  const run = new Set(managedOrganizations(sqlite, userId).map((o) => o.id));
  if (!run.size) return [];
  return rollupLabsFor(sqlite, userId).filter((l) => l.organization_id != null && run.has(l.organization_id) && (planOk(l.organization_plan) || planOk(l.plan)));
}

/** Organizations this person runs (active org_owner or org_admin), with names. */
export function managedOrganizations(sqlite: any, userId: number): { id: number; name: string }[] {
  return sqlite.prepare(
    `SELECT o.id, o.name FROM organization_members om JOIN organizations o ON o.id = om.organization_id
      WHERE om.user_id = ? AND om.status = 'active' AND om.org_role IN ${ORG_ADMIN_ROLES} ORDER BY o.name, o.id`
  ).all(userId) as { id: number; name: string }[];
}

/** Labs a group in this scope may hold, before the reader's own view is applied. */
function scopeLabIds(sqlite: any, scope: { organizationId: number | null; ownerUserId: number | null }): Set<number> {
  const rows = scope.organizationId != null
    ? sqlite.prepare("SELECT id FROM labs WHERE organization_id = ? AND (is_repository IS NULL OR is_repository = 0)").all(scope.organizationId)
    : sqlite.prepare(
        `SELECT l.id FROM lab_members m JOIN labs l ON l.id = m.lab_id
          WHERE m.user_id = ? AND m.status = 'active' AND (l.is_repository IS NULL OR l.is_repository = 0)`
      ).all(scope.ownerUserId);
  return new Set((rows as { id: number }[]).map((r) => r.id));
}

function isOrgAdmin(sqlite: any, userId: number, organizationId: number): boolean {
  return !!sqlite.prepare(
    `SELECT 1 FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active' AND org_role IN ${ORG_ADMIN_ROLES} LIMIT 1`
  ).get(organizationId, userId);
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new RollupGroupError(400, "NAME_REQUIRED", "Give the group a name.");
  if (name.length > ROLLUP_GROUP_NAME_MAX) throw new RollupGroupError(400, "NAME_TOO_LONG", `A group name is ${ROLLUP_GROUP_NAME_MAX} characters at most.`);
  const phi = detectPhi(name);
  if (phi.length) throw new RollupGroupError(400, "PHI_REFUSED", "That name looks like patient information. Name the group by region or person instead.", { field: "name", matched: phi });
  return name;
}

function cleanKind(raw: unknown): RollupGroupKind {
  const kind = raw == null || raw === "" ? "other" : String(raw);
  if (!(ROLLUP_GROUP_KINDS as readonly string[]).includes(kind)) throw new RollupGroupError(400, "KIND_INVALID", `kind must be one of: ${ROLLUP_GROUP_KINDS.join(", ")}`);
  return kind as RollupGroupKind;
}

function audit(sqlite: any, actorUserId: number, ownerUserId: number | null, action: string, groupId: number, label: string, before: unknown, after: unknown) {
  sqlite.prepare(
    `INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json)
     VALUES (?, ?, 'account', ?, 'rollup_group', ?, ?, ?, ?)`
  ).run(actorUserId, ownerUserId, action, String(groupId), label, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after));
}

function loadGroup(sqlite: any, groupId: number): any {
  const g = sqlite.prepare("SELECT * FROM rollup_groups WHERE id = ?").get(groupId);
  if (!g) throw new RollupGroupError(404, "NOT_FOUND", "Group not found.");
  return g;
}

function groupLabIds(sqlite: any, groupId: number): number[] {
  return (sqlite.prepare("SELECT lab_id FROM rollup_group_labs WHERE group_id = ? ORDER BY lab_id").all(groupId) as { lab_id: number }[]).map((r) => r.lab_id);
}

/** A person may edit a group they own, or a group of an organization they run. */
function assertCanEdit(sqlite: any, userId: number, g: any) {
  const ok = g.organization_id != null ? isOrgAdmin(sqlite, userId, g.organization_id) : g.owner_user_id === userId;
  // Same answer as a group that doesn't exist, so a group id outside one's reach says nothing about it.
  if (!ok) throw new RollupGroupError(404, "NOT_FOUND", "Group not found.");
}

/**
 * Every group this person can read, with lab ids cut to the labs they see, plus what they may build: their own network
 * (labs they are a member of) and each organization they run (that organization's labs they see).
 */
export function rollupGroupsFor(sqlite: any, userId: number) {
  const visible = rollupVisibleLabIds(sqlite, userId);
  const orgs = managedOrganizations(sqlite, userId);
  const orgIds = orgs.map((o) => o.id);
  const rows = sqlite.prepare(
    `SELECT g.id, g.name, g.kind, g.organization_id, g.owner_user_id, o.name AS organization_name
       FROM rollup_groups g LEFT JOIN organizations o ON o.id = g.organization_id
      WHERE g.owner_user_id = ? ${orgIds.length ? `OR g.organization_id IN (${orgIds.map(() => "?").join(",")})` : ""}
      ORDER BY g.name COLLATE NOCASE, g.id`
  ).all(userId, ...orgIds) as any[];
  const groups: RollupGroupView[] = rows.map((g) => ({
    id: g.id,
    name: g.name,
    kind: (ROLLUP_GROUP_KINDS as readonly string[]).includes(g.kind) ? g.kind : "other",
    scope: g.organization_id != null ? "organization" : "personal",
    organization_id: g.organization_id ?? null,
    organization_name: g.organization_id != null ? g.organization_name ?? null : null,
    lab_ids: groupLabIds(sqlite, g.id).filter((id) => visible.has(id)),
  }));
  const personalLabs = [...scopeLabIds(sqlite, { organizationId: null, ownerUserId: userId })].filter((id) => visible.has(id)).sort((a, b) => a - b);
  const organizations = orgs.map((o) => ({
    id: o.id,
    name: o.name,
    lab_ids: [...scopeLabIds(sqlite, { organizationId: o.id, ownerUserId: null })].filter((id) => visible.has(id)).sort((a, b) => a - b),
  }));
  return { groups, can_build: { personal: { lab_ids: personalLabs }, organizations } };
}

/** Labs not allowed in a group of this scope, from a requested list. */
function ineligible(sqlite: any, scope: { organizationId: number | null; ownerUserId: number | null }, labIds: number[]): number[] {
  const allowed = scopeLabIds(sqlite, scope);
  return labIds.filter((id) => !allowed.has(id));
}

function cleanLabIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw new RollupGroupError(400, "LAB_IDS_REQUIRED", "labIds must be a list of lab ids.");
  const ids = [...new Set(raw.map((x) => Number(x)))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new RollupGroupError(400, "LAB_IDS_INVALID", "labIds must be whole lab ids.");
  if (ids.length > 2000) throw new RollupGroupError(400, "LAB_IDS_INVALID", "Too many labs in one group.");
  return ids.sort((a, b) => a - b);
}

function replaceLabs(sqlite: any, groupId: number, labIds: number[]) {
  sqlite.prepare("DELETE FROM rollup_group_labs WHERE group_id = ?").run(groupId);
  const ins = sqlite.prepare("INSERT INTO rollup_group_labs (group_id, lab_id) VALUES (?, ?)");
  for (const id of labIds) ins.run(groupId, id);
  sqlite.prepare("UPDATE rollup_groups SET updated_at = datetime('now') WHERE id = ?").run(groupId);
}

/** Create a group: personal unless organizationId is given (then the caller must run that organization). */
export function createRollupGroup(sqlite: any, userId: number, body: any) {
  const name = cleanName(body?.name);
  const kind = cleanKind(body?.kind);
  const orgRaw = body?.organizationId;
  const organizationId = orgRaw == null || orgRaw === "" ? null : Number(orgRaw);
  if (organizationId != null) {
    if (!Number.isInteger(organizationId) || !isOrgAdmin(sqlite, userId, organizationId)) {
      throw new RollupGroupError(403, "ORG_ADMIN_ONLY", "Only that organization's owner or an organization admin can add its groups.");
    }
  }
  const labIds = body?.labIds == null ? [] : cleanLabIds(body.labIds);
  const scope = { organizationId, ownerUserId: organizationId == null ? userId : null };
  const bad = ineligible(sqlite, scope, labIds);
  if (bad.length) throw new RollupGroupError(400, "LAB_NOT_ELIGIBLE", organizationId != null ? "A system's group holds only that system's labs." : "Your own groups hold only labs you belong to.", { labIds: bad });
  let id = 0;
  sqlite.transaction(() => {
    id = Number(sqlite.prepare(
      "INSERT INTO rollup_groups (name, kind, organization_id, owner_user_id, created_by_user_id) VALUES (?, ?, ?, ?, ?)"
    ).run(name, kind, organizationId, scope.ownerUserId, userId).lastInsertRowid);
    replaceLabs(sqlite, id, labIds);
    audit(sqlite, userId, scope.ownerUserId, "create", id, name, null, { name, kind, organization_id: organizationId, owner_user_id: scope.ownerUserId, lab_ids: labIds });
  })();
  return { id };
}

/** Rename a group or change its kind. */
export function updateRollupGroup(sqlite: any, userId: number, groupId: number, body: any) {
  const g = loadGroup(sqlite, groupId);
  assertCanEdit(sqlite, userId, g);
  const name = body?.name === undefined ? g.name : cleanName(body.name);
  const kind = body?.kind === undefined ? g.kind : cleanKind(body.kind);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE rollup_groups SET name = ?, kind = ?, updated_at = datetime('now') WHERE id = ?").run(name, kind, groupId);
    audit(sqlite, userId, g.owner_user_id ?? null, "update", groupId, name, { name: g.name, kind: g.kind }, { name, kind });
  })();
  return { id: groupId };
}

/** Replace a group's labs. Labs the caller doesn't see are kept as they are, so an edit never drops what it can't show. */
export function setRollupGroupLabs(sqlite: any, userId: number, groupId: number, body: any) {
  const g = loadGroup(sqlite, groupId);
  assertCanEdit(sqlite, userId, g);
  const wanted = cleanLabIds(body?.labIds);
  const scope = { organizationId: g.organization_id ?? null, ownerUserId: g.organization_id != null ? null : g.owner_user_id };
  const bad = ineligible(sqlite, scope, wanted);
  if (bad.length) throw new RollupGroupError(400, "LAB_NOT_ELIGIBLE", g.organization_id != null ? "A system's group holds only that system's labs." : "Your own groups hold only labs you belong to.", { labIds: bad });
  const visible = rollupVisibleLabIds(sqlite, userId);
  const before = groupLabIds(sqlite, groupId);
  const hidden = before.filter((id) => !visible.has(id));
  const next = [...new Set([...wanted, ...hidden])].sort((a, b) => a - b);
  sqlite.transaction(() => {
    replaceLabs(sqlite, groupId, next);
    audit(sqlite, userId, g.owner_user_id ?? null, "set_labs", groupId, g.name, { lab_ids: before }, { lab_ids: next });
  })();
  return { id: groupId, lab_ids: next.filter((id) => visible.has(id)) };
}

/** Delete a group (the grouping only; no lab record is touched). */
export function deleteRollupGroup(sqlite: any, userId: number, groupId: number) {
  const g = loadGroup(sqlite, groupId);
  assertCanEdit(sqlite, userId, g);
  const before = groupLabIds(sqlite, groupId);
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM rollup_group_labs WHERE group_id = ?").run(groupId);
    sqlite.prepare("DELETE FROM rollup_groups WHERE id = ?").run(groupId);
    audit(sqlite, userId, g.owner_user_id ?? null, "delete", groupId, g.name, { name: g.name, kind: g.kind, organization_id: g.organization_id, owner_user_id: g.owner_user_id, lab_ids: before }, null);
  })();
  return { id: groupId, deleted: true };
}

// ── Admin (header x-admin-secret only; Michael sets up a demo or a customer's groups) ─────────────────────────────────

/** Groups for one organization or one person, with lab ids; counts and names of groups only. */
export function adminListRollupGroups(sqlite: any, q: { organizationId?: number | null; ownerUserId?: number | null }) {
  const where = q.organizationId != null ? "organization_id = ?" : "owner_user_id = ?";
  const arg = q.organizationId != null ? q.organizationId : q.ownerUserId;
  if (arg == null || !Number.isInteger(Number(arg))) throw new RollupGroupError(400, "SCOPE_REQUIRED", "Pass organizationId or ownerUserId.");
  const rows = sqlite.prepare(`SELECT id, name, kind, organization_id, owner_user_id FROM rollup_groups WHERE ${where} ORDER BY name COLLATE NOCASE, id`).all(Number(arg)) as any[];
  return { groups: rows.map((g) => ({ ...g, lab_ids: groupLabIds(sqlite, g.id) })) };
}

/** Create a group for an organization or a person, with its labs; a dry run unless dryRun is false. */
export function adminCreateRollupGroup(sqlite: any, body: any) {
  const name = cleanName(body?.name);
  const kind = cleanKind(body?.kind);
  const organizationId = body?.organizationId == null ? null : Number(body.organizationId);
  const ownerUserId = body?.ownerUserId == null ? null : Number(body.ownerUserId);
  if ((organizationId == null) === (ownerUserId == null)) throw new RollupGroupError(400, "SCOPE_REQUIRED", "Pass exactly one of organizationId or ownerUserId.");
  if (organizationId != null && !sqlite.prepare("SELECT 1 FROM organizations WHERE id = ?").get(organizationId)) throw new RollupGroupError(404, "ORG_NOT_FOUND", "Organization not found.");
  if (ownerUserId != null && !sqlite.prepare("SELECT 1 FROM users WHERE id = ?").get(ownerUserId)) throw new RollupGroupError(404, "USER_NOT_FOUND", "User not found.");
  const labIds = cleanLabIds(body?.labIds ?? []);
  const bad = ineligible(sqlite, { organizationId, ownerUserId }, labIds);
  if (bad.length) throw new RollupGroupError(400, "LAB_NOT_ELIGIBLE", organizationId != null ? "A system's group holds only that system's labs." : "A person's group holds only labs they belong to.", { labIds: bad });
  const plan = { name, kind, organization_id: organizationId, owner_user_id: ownerUserId, lab_ids: labIds };
  if (body?.dryRun !== false) return { dryRun: true, plan };
  let id = 0;
  sqlite.transaction(() => {
    id = Number(sqlite.prepare(
      "INSERT INTO rollup_groups (name, kind, organization_id, owner_user_id, created_by_user_id) VALUES (?, ?, ?, ?, 0)"
    ).run(name, kind, organizationId, ownerUserId).lastInsertRowid);
    replaceLabs(sqlite, id, labIds);
    audit(sqlite, 0, ownerUserId, "create", id, name, null, plan);
  })();
  return { dryRun: false, id, plan };
}

/** Delete a group by id (admin). */
export function adminDeleteRollupGroup(sqlite: any, groupId: number) {
  const g = loadGroup(sqlite, groupId);
  const before = groupLabIds(sqlite, groupId);
  sqlite.transaction(() => {
    sqlite.prepare("DELETE FROM rollup_group_labs WHERE group_id = ?").run(groupId);
    sqlite.prepare("DELETE FROM rollup_groups WHERE id = ?").run(groupId);
    audit(sqlite, 0, g.owner_user_id ?? null, "delete", groupId, g.name, { name: g.name, kind: g.kind, organization_id: g.organization_id, owner_user_id: g.owner_user_id, lab_ids: before }, null);
  })();
  return { id: groupId, deleted: true };
}
