// scripts/verify-org-grouping.mjs
//
// Gate-3 receipt for the LabSwitcher org grouping (client/src/lib/orgGrouping.ts,
// Phase 1c). Mirrors groupMembershipsByOrg + hasOrgGrouping. If you change the
// logic there, change this mirror too.
//
// Run: node scripts/verify-org-grouping.mjs

// ---- mirror of client/src/lib/orgGrouping.ts -----------------------------
function groupMembershipsByOrg(memberships) {
  const byOrg = new Map();
  const ungrouped = [];
  for (const m of memberships) {
    const oid = m.organizationId ?? null;
    if (oid == null) { ungrouped.push(m); continue; }
    let g = byOrg.get(oid);
    if (!g) { g = { orgId: oid, orgName: m.organizationName ?? null, labs: [] }; byOrg.set(oid, g); }
    g.labs.push(m);
  }
  const orgGroups = Array.from(byOrg.values()).sort(
    (a, b) => (a.orgName || "").localeCompare(b.orgName || "") || a.orgId - b.orgId,
  );
  const result = [...orgGroups];
  if (ungrouped.length > 0) result.push({ orgId: null, orgName: null, labs: ungrouped });
  return result;
}
function hasOrgGrouping(groups) {
  return groups.some((g) => g.orgId != null);
}

// ---- harness -------------------------------------------------------------
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}
const lab = (labId, organizationId, organizationName) => ({ labId, organizationId, organizationName, membershipId: labId });

// Case 1: all standalone (no orgs) -> single ungrouped bucket, no headers.
{
  const g = groupMembershipsByOrg([lab(1, null, null), lab(2, null, null)]);
  ok("standalone: one group", g.length === 1);
  ok("standalone: orgId null", g[0].orgId === null);
  ok("standalone: no headers", hasOrgGrouping(g) === false);
  ok("standalone: both labs kept", g[0].labs.length === 2);
}

// Case 2: single org, all labs in it -> one org group, headers shown.
{
  const g = groupMembershipsByOrg([lab(19, 1, "Gameday Men's Health"), lab(29, 1, "Gameday Men's Health"), lab(30, 1, "Gameday Men's Health")]);
  ok("single org: one group", g.length === 1);
  ok("single org: orgName", g[0].orgName === "Gameday Men's Health");
  ok("single org: headers shown", hasOrgGrouping(g) === true);
  ok("single org: 3 labs", g[0].labs.length === 3);
}

// Case 3: mixed -> org groups sorted by name first, ungrouped last.
{
  const g = groupMembershipsByOrg([
    lab(5, 2, "UMass Memorial Health - Milford Regional"),
    lab(2, 3, "San Carlos Apache Healthcare Corporation"),
    lab(99, null, null),
    lab(6, 3, "San Carlos Apache Healthcare Corporation"),
  ]);
  ok("mixed: 3 groups (2 orgs + ungrouped)", g.length === 3);
  ok("mixed: first group sorted alpha (San Carlos)", g[0].orgName === "San Carlos Apache Healthcare Corporation");
  ok("mixed: San Carlos has 2 labs", g[0].labs.length === 2);
  ok("mixed: second group UMass", g[1].orgName === "UMass Memorial Health - Milford Regional");
  ok("mixed: ungrouped is last", g[2].orgId === null && g[2].labs.length === 1 && g[2].labs[0].labId === 99);
  ok("mixed: headers shown", hasOrgGrouping(g) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
