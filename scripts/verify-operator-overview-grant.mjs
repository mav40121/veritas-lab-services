// scripts/verify-operator-overview-grant.mjs
//
// Gate-3 receipt for the Phase-2d follow-on (Michael 2026-10-01, option 1):
// provision-system auto-grants the operator (Michael) a seat-free org_admin
// membership on every system it provisions. Mirrors the pure decision in
// server/organizationProvision.ts operatorOverviewGrant().
//
// Run: node scripts/verify-operator-overview-grant.mjs

function operatorOverviewGrant({ ownerUserId, operatorUserId, existing }) {
  if (operatorUserId == null) return "skip";
  if (operatorUserId === ownerUserId) return "skip";
  if (!existing) return "insert";
  if (existing.orgRole === "org_owner") return "skip";
  if (existing.orgRole === "org_admin" && existing.status === "active") return "skip";
  return "promote";
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { if (got === want) { pass++; console.log(`  PASS  ${name} (= ${got})`); } else { fail++; console.log(`  FAIL  ${name}: got ${got}, want ${want}`); } };

// No operator account resolved from email -> nothing to grant.
eq("operator account missing -> skip", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: null, existing: null }), "skip");

// Operator IS the billing owner (already inserted as org_owner above) -> skip.
eq("operator is the org owner -> skip", operatorOverviewGrant({ ownerUserId: 7, operatorUserId: 7, existing: null }), "skip");

// Operator not a member yet -> insert org_admin.
eq("non-member operator -> insert", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: null }), "insert");

// Operator already an active org_admin -> idempotent skip (no duplicate row).
eq("already active org_admin -> skip", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: { orgRole: "org_admin", status: "active" } }), "skip");

// Operator is an org_owner of THIS org (e.g. his own demo system) -> never demote.
eq("operator is org_owner here -> skip (no demote)", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: { orgRole: "org_owner", status: "active" } }), "skip");

// Operator has a deactivated org_admin row -> promote (reactivate).
eq("deactivated org_admin -> promote", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: { orgRole: "org_admin", status: "deactivated" } }), "promote");

// Operator holds some other active role -> promote to org_admin.
eq("other active role -> promote", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: { orgRole: "org_member", status: "active" } }), "promote");

// Operator org_admin but deactivated beats the active check -> promote.
eq("org_admin inactive status -> promote", operatorOverviewGrant({ ownerUserId: 5, operatorUserId: 7, existing: { orgRole: "org_admin", status: "pending" } }), "promote");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
