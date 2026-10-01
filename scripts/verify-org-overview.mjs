// scripts/verify-org-overview.mjs
//
// Gate-3 receipt for Phase-2d overview visibility (server/organizationRoles.ts
// labVisibleToUser) — the predicate the /api/labs/me switcher and
// /api/readiness/rollup SQL implement so an org_owner/org_admin sees the whole
// system without a per-lab membership. Mirrors the pure logic.
//
// Run: node scripts/verify-org-overview.mjs

function labVisibleToUser({ isActiveLabMember, labOrganizationId, userOrgAdminOrgIds }) {
  if (isActiveLabMember) return true;
  if (labOrganizationId != null && userOrgAdminOrgIds.includes(labOrganizationId)) return true;
  return false;
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); } else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); } };

// Member of the lab -> always visible (unchanged behavior).
eq("member, standalone lab -> visible", labVisibleToUser({ isActiveLabMember: true, labOrganizationId: null, userOrgAdminOrgIds: [] }), true);
eq("member, org lab -> visible", labVisibleToUser({ isActiveLabMember: true, labOrganizationId: 4, userOrgAdminOrgIds: [] }), true);

// NOT a member, but org_admin of the lab's org -> now visible (the new capability).
eq("non-member, org_admin of lab's org -> visible", labVisibleToUser({ isActiveLabMember: false, labOrganizationId: 4, userOrgAdminOrgIds: [4] }), true);
eq("non-member, org_admin of several orgs incl this -> visible", labVisibleToUser({ isActiveLabMember: false, labOrganizationId: 7, userOrgAdminOrgIds: [4, 7, 9] }), true);

// NOT a member, org role on a DIFFERENT org -> hidden (no cross-org leak).
eq("non-member, org_admin of a different org -> hidden", labVisibleToUser({ isActiveLabMember: false, labOrganizationId: 4, userOrgAdminOrgIds: [9] }), false);

// NOT a member, standalone lab (no org) -> hidden (org role cannot grant it).
eq("non-member, standalone lab -> hidden", labVisibleToUser({ isActiveLabMember: false, labOrganizationId: null, userOrgAdminOrgIds: [4] }), false);

// NOT a member, no org roles at all -> hidden.
eq("non-member, no org roles -> hidden", labVisibleToUser({ isActiveLabMember: false, labOrganizationId: 4, userOrgAdminOrgIds: [] }), false);

// Both member AND org_admin -> visible (SQL DISTINCT/LEFT-JOIN dedupes to one row).
eq("member + org_admin -> visible (deduped in SQL)", labVisibleToUser({ isActiveLabMember: true, labOrganizationId: 4, userOrgAdminOrgIds: [4] }), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
