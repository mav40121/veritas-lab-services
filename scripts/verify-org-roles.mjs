// scripts/verify-org-roles.mjs
//
// Gate-3 receipt for the Phase-2b org-role elevation (server/organizationRoles.ts
// labRoleFromOrgRole) and the effective-role precedence applied in
// labScopeMiddleware. Mirrors the pure logic. If you change it there, change
// this mirror too.
//
// Run: node scripts/verify-org-roles.mjs

// ---- mirror of server/organizationRoles.ts (pure core) ----
function labRoleFromOrgRole(orgRole) {
  if (orgRole === "org_owner" || orgRole === "org_admin") return "admin";
  return null;
}

// ---- mirror of labScopeMiddleware effective-role precedence ----
// baseRole = per-lab lab_members.role (null when the user has no membership on
// this lab). orgRoleValue = the user's active org_role for the lab's org (null
// when the lab is standalone or the user is not an active org member).
function effectiveRole(baseRole, orgRoleValue) {
  const orgLabRole = labRoleFromOrgRole(orgRoleValue); // "admin" | null
  if (!baseRole && !orgLabRole) return null; // no access (middleware 403s)
  let role = baseRole;
  if (baseRole !== "owner" && orgLabRole === "admin") role = "admin";
  return role;
}

// canManageLabMembers / isLabOwner mirrors (routes.ts:6923,6926).
const canManage = (role) => role === "owner" || role === "admin";
const isOwner = (role) => role === "owner";

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); }
  else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); }
}

// --- labRoleFromOrgRole ---
eq("org_owner -> admin", labRoleFromOrgRole("org_owner"), "admin");
eq("org_admin -> admin", labRoleFromOrgRole("org_admin"), "admin");
eq("null -> none", labRoleFromOrgRole(null), null);
eq("undefined -> none", labRoleFromOrgRole(undefined), null);
eq("unknown role -> none", labRoleFromOrgRole("system_reviewer"), null);

// --- effective-role precedence ---
// Standalone lab (no org): behavior unchanged, driven purely by membership.
eq("standalone owner stays owner", effectiveRole("owner", null), "owner");
eq("standalone admin stays admin", effectiveRole("admin", null), "admin");
eq("standalone staff stays staff", effectiveRole("staff", null), "staff");
eq("standalone non-member -> no access", effectiveRole(null, null), null);

// Org-linked lab, caller is an org admin/owner but NOT a per-lab member:
eq("org_admin, no membership -> admin", effectiveRole(null, "org_admin"), "admin");
eq("org_owner, no membership -> admin", effectiveRole(null, "org_owner"), "admin");

// Org-linked lab, caller already a per-lab member AND an org admin:
eq("per-lab owner + org_admin stays owner", effectiveRole("owner", "org_admin"), "owner"); // never downgrade/usurp owner
eq("per-lab staff + org_admin -> admin", effectiveRole("staff", "org_admin"), "admin");   // elevated
eq("per-lab admin + org_admin -> admin", effectiveRole("admin", "org_admin"), "admin");

// Org member whose role confers nothing (defensive): no elevation.
eq("per-lab staff + unknown org role stays staff", effectiveRole("staff", "system_reviewer"), "staff");
eq("no membership + unknown org role -> no access", effectiveRole(null, "system_reviewer"), null);

// --- downstream capability checks (the point of 2b) ---
// An org admin with no membership CAN manage members (Q2) ...
eq("org_admin can manage members", canManage(effectiveRole(null, "org_admin")), true);
// ... but is NOT a lab owner, so owner-only powers (transfer/delete) stay denied.
eq("org_admin is NOT lab owner (transfer stays denied)", isOwner(effectiveRole(null, "org_admin")), false);
eq("org_owner is NOT lab owner either (transfer guard is 2c)", isOwner(effectiveRole(null, "org_owner")), false);
// A plain staff on a standalone lab still cannot manage members.
eq("standalone staff cannot manage members", canManage(effectiveRole("staff", null)), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
