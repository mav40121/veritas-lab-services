// client/src/lib/orgGrouping.ts
//
// Phase 1c of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
// Pure helper: group a user's lab memberships by their organization so the
// LabSwitcher can show each system's labs under its name. Org groups come
// first (sorted by name), then any standalone (ungrouped) labs. Lab order
// within a group is preserved from the input (which /api/labs/me already orders
// primary-first). Mirrored by scripts/verify-org-grouping.mjs.

import type { Membership } from "@/hooks/useMemberships";

export interface OrgGroup {
  orgId: number | null; // null = the standalone/ungrouped bucket
  orgName: string | null;
  labs: Membership[];
}

export function groupMembershipsByOrg(memberships: Membership[]): OrgGroup[] {
  const byOrg = new Map<number, OrgGroup>();
  const ungrouped: Membership[] = [];
  for (const m of memberships) {
    const oid = m.organizationId ?? null;
    if (oid == null) {
      ungrouped.push(m);
      continue;
    }
    let g = byOrg.get(oid);
    if (!g) {
      g = { orgId: oid, orgName: m.organizationName ?? null, labs: [] };
      byOrg.set(oid, g);
    }
    g.labs.push(m);
  }
  const orgGroups = Array.from(byOrg.values()).sort(
    (a, b) => (a.orgName || "").localeCompare(b.orgName || "") || (a.orgId as number) - (b.orgId as number),
  );
  const result: OrgGroup[] = [...orgGroups];
  if (ungrouped.length > 0) result.push({ orgId: null, orgName: null, labs: ungrouped });
  return result;
}

// Show org headers only when at least one real org is present among the
// memberships. A user whose labs are all standalone renders as a flat list
// exactly as before (no headers).
export function hasOrgGrouping(groups: OrgGroup[]): boolean {
  return groups.some((g) => g.orgId != null);
}
