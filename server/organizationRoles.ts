// server/organizationRoles.ts
//
// Phase 2b of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// Org-level roles honored across a system's labs. A user who is an active
// org_owner or org_admin of the organization that owns a lab is granted
// admin-equivalent access to EVERY lab in that organization, even without a
// per-lab lab_members row. This is what lets a hospital-system administrator
// manage members and write across all the system's sites from one account.
//
// Scope boundary (Q2, Michael 2026-10-01): org roles confer lab role "admin",
// never "owner". Owner-only powers (transfer ownership, delete a lab) stay with
// the per-lab owner; the transfer-out-of-org guard is PR 2c. Standalone labs
// (labs.organization_id IS NULL) are completely unaffected: there is no org, so
// no role is conferred and the existing per-lab membership requirement stands.
//
// The pure core (labRoleFromOrgRole) is mirrored by scripts/verify-org-roles.mjs.

// Pure: the lab-level role an org membership confers across the organization's
// labs. org_owner and org_admin both map to "admin" (manage members + write).
// Any other value, or null/undefined (not an org member), confers nothing.
export function labRoleFromOrgRole(orgRole: string | null | undefined): "admin" | null {
  if (orgRole === "org_owner" || orgRole === "org_admin") return "admin";
  return null;
}

// SQLite: the caller's ACTIVE org_role for the organization that owns `labId`,
// or null when the lab is standalone (organization_id IS NULL), the user is not
// an active member of that org, or the org tables are absent. Status must be
// exactly 'active' — a deactivated org member is denied, same as a deactivated
// lab member.
export function orgRoleForUserOnLab(sqlite: any, userId: number, labId: number): string | null {
  try {
    const row = sqlite
      .prepare(
        `SELECT om.org_role AS org_role
           FROM labs l
           JOIN organization_members om ON om.organization_id = l.organization_id
          WHERE l.id = ? AND om.user_id = ? AND om.status = 'active'
            AND l.organization_id IS NOT NULL
          LIMIT 1`,
      )
      .get(labId, userId) as any;
    return row?.org_role ?? null;
  } catch {
    // organizations/organization_members absent (should not happen post-Phase-1):
    // confer nothing, so access falls back entirely to per-lab membership.
    return null;
  }
}

// Convenience: the effective lab role an org membership confers on this lab for
// this user ("admin" | null). Used by labScopeMiddleware to elevate access.
export function orgDerivedLabRole(sqlite: any, userId: number, labId: number): "admin" | null {
  return labRoleFromOrgRole(orgRoleForUserOnLab(sqlite, userId, labId));
}

// ── PR 2c: transfer / create guard (docs/SYSTEM_ENTITY_DESIGN.md) ───────────
// Q3 (Michael 2026-10-01): a lab that belongs to an organization may not be
// transferred OUT of that organization, and a new lab created by an owner who
// already has an organization inherits it.

// Pure: should a transfer be BLOCKED because it would move an org-linked lab out
// of its organization? A standalone lab (labOrgId null) is never blocked. An
// org lab is blocked unless the new owner is an active member of that org.
export function transferBlockedOutOfOrg(labOrgId: number | null, newOwnerIsActiveOrgMember: boolean): boolean {
  if (labOrgId == null) return false;
  return !newOwnerIsActiveOrgMember;
}

// Pure: the organization a newly created lab should inherit, given the distinct
// org ids the creating owner's EXISTING labs already belong to. Inherit only
// when unambiguous (exactly one org); otherwise none (standalone, or an owner
// whose labs span more than one org).
export function inheritedOrgIdForNewLab(distinctOrgIds: number[]): number | null {
  const uniq = Array.from(new Set(distinctOrgIds.filter((n) => Number.isInteger(n) && n > 0)));
  return uniq.length === 1 ? uniq[0] : null;
}

// SQLite: is the user an ACTIVE member of this organization?
export function isActiveOrgMember(sqlite: any, userId: number, orgId: number): boolean {
  try {
    const row = sqlite
      .prepare("SELECT 1 AS ok FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active' LIMIT 1")
      .get(orgId, userId) as any;
    return !!row;
  } catch {
    return false;
  }
}

// SQLite: the single organization the owner's existing labs belong to, or null
// when there is none or it is ambiguous. The owner's brand-new lab (still
// organization_id NULL at call time) is naturally excluded by the IS NOT NULL
// filter, so this can be called right after the new lab is inserted.
export function resolveOwnerOrgId(sqlite: any, ownerUserId: number): number | null {
  try {
    const rows = sqlite
      .prepare("SELECT DISTINCT organization_id AS org FROM labs WHERE owner_user_id = ? AND organization_id IS NOT NULL")
      .all(ownerUserId) as any[];
    return inheritedOrgIdForNewLab(rows.map((r) => Number(r.org)));
  } catch {
    return null;
  }
}
