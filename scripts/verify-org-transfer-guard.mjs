// scripts/verify-org-transfer-guard.mjs
//
// Gate-3 receipt for the Phase-2c transfer/create guard
// (server/organizationRoles.ts transferBlockedOutOfOrg + inheritedOrgIdForNewLab).
// Mirrors the pure logic. If you change it there, change this mirror too.
//
// Run: node scripts/verify-org-transfer-guard.mjs

function transferBlockedOutOfOrg(labOrgId, newOwnerIsActiveOrgMember) {
  if (labOrgId == null) return false;
  return !newOwnerIsActiveOrgMember;
}
function inheritedOrgIdForNewLab(distinctOrgIds) {
  const uniq = Array.from(new Set(distinctOrgIds.filter((n) => Number.isInteger(n) && n > 0)));
  return uniq.length === 1 ? uniq[0] : null;
}

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); }
  else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); }
}

// --- transfer guard ---
// Standalone lab (no org): transfer is never blocked, to anyone.
eq("standalone lab, member -> allowed", transferBlockedOutOfOrg(null, true), false);
eq("standalone lab, non-member -> allowed (org guard N/A)", transferBlockedOutOfOrg(null, false), false);
// Org lab: allowed only when the new owner is an active member of that org.
eq("org lab, new owner in org -> allowed", transferBlockedOutOfOrg(5, true), false);
eq("org lab, new owner NOT in org -> BLOCKED", transferBlockedOutOfOrg(5, false), true);
eq("org lab id 1, not in org -> BLOCKED", transferBlockedOutOfOrg(1, false), true);

// --- new-lab org inheritance ---
eq("owner with no org labs -> no inherit", inheritedOrgIdForNewLab([]), null);
eq("owner all labs in org 3 -> inherit 3", inheritedOrgIdForNewLab([3, 3, 3]), 3);
eq("owner one org lab -> inherit it", inheritedOrgIdForNewLab([7]), 7);
eq("owner labs span 2 orgs -> ambiguous, no inherit", inheritedOrgIdForNewLab([3, 8]), null);
eq("ignores null/0/neg ids", inheritedOrgIdForNewLab([0, -1, 4]), 4);
eq("mixed dup + single real -> that one", inheritedOrgIdForNewLab([9, 9]), 9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
