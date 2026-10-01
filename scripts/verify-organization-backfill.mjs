// scripts/verify-organization-backfill.mjs
//
// Gate-3 receipt for the Phase-1b org backfill helpers
// (server/organizationBackfill.ts, used by POST /api/admin/organizations/backfill).
// Mirrors suggestOrgName + computeBackfillCandidates case-for-case. If you change
// the logic there, change this mirror too.
//
// Run: node scripts/verify-organization-backfill.mjs

// ---- mirror of server/organizationBackfill.ts ----------------------------
function longestCommonPrefix(strs) {
  if (strs.length === 0) return "";
  let p = strs[0];
  for (let k = 1; k < strs.length; k++) {
    const s = strs[k];
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}
function suggestOrgName(labNames, ownerName, ownerEmail) {
  const names = labNames.map((n) => (n || "").trim()).filter((n) => n.length > 0);
  if (names.length > 0) {
    let lcp = longestCommonPrefix(names).trim();
    lcp = lcp.replace(/[\s\-:,|/]+$/, "").trim();
    if (lcp.length >= 4) return lcp;
    return names.slice().sort((a, b) => b.length - a.length)[0];
  }
  if (ownerName && ownerName.trim()) return ownerName.trim();
  if (ownerEmail && ownerEmail.trim()) return ownerEmail.trim();
  return "Unnamed System";
}
function computeBackfillCandidates(labs, users) {
  const userById = new Map();
  for (const u of users) userById.set(u.id, u);
  const byOwner = new Map();
  for (const l of labs) {
    if (l.owner_user_id == null) continue;
    const arr = byOwner.get(l.owner_user_id) || [];
    arr.push(l);
    byOwner.set(l.owner_user_id, arr);
  }
  const out = [];
  for (const [ownerUserId, ownerLabs] of byOwner) {
    if (ownerLabs.length <= 1) continue;
    const u = userById.get(ownerUserId);
    const sorted = ownerLabs.slice().sort((a, b) => a.id - b.id);
    const labNames = sorted.map((l) => l.lab_name || "");
    out.push({
      ownerUserId,
      ownerEmail: u?.email ?? null,
      ownerName: u?.name ?? null,
      labCount: ownerLabs.length,
      labIds: sorted.map((l) => l.id),
      labNames,
      suggestedName: suggestOrgName(labNames, u?.name, u?.email),
      alreadyLinked: ownerLabs.some((l) => l.organization_id != null),
    });
  }
  out.sort((a, b) => b.labCount - a.labCount || a.ownerUserId - b.ownerUserId);
  return out;
}

// ---- harness -------------------------------------------------------------
let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

// ---- name-suggestion unit cases ------------------------------------------
ok("Gameday LCP name", suggestOrgName([
  "Gameday Men's Health - Traverse City",
  "Gameday Men's Health Plymouth",
  "Gameday Men's Health Brighton",
]) === "Gameday Men's Health");

ok("weak LCP falls back to longest lab name", suggestOrgName([
  "San Carlos Apache Healthcare Corporation",
  "SCAHC - Clarence Wesley",
]) === "San Carlos Apache Healthcare Corporation");

ok("no lab names falls back to owner name", suggestOrgName([], "Jane Owner", "j@x.test") === "Jane Owner");
ok("no names/owner falls back to email", suggestOrgName(["", "  "], null, "j@x.test") === "j@x.test");
ok("trailing separator trimmed", suggestOrgName(["Acme Labs - East", "Acme Labs - West"]) === "Acme Labs");

// ---- candidate computation -----------------------------------------------
const users = [
  { id: 66, email: "m.hiltunen@medstarconsultants.com", name: "Mike Hiltunen" },
  { id: 37, email: "chineme.swann@scahealth.org", name: "Chineme Swann" },
  { id: 2, email: "solo@clinic.test", name: "Solo Owner" },
  { id: 9, email: "linked@x.test", name: "Linked Owner" },
];
const labs = [
  { id: 19, lab_name: "Gameday Men's Health - Traverse City", owner_user_id: 66, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 29, lab_name: "Gameday Men's Health Plymouth", owner_user_id: 66, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 30, lab_name: "Gameday Men's Health Brighton", owner_user_id: 66, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 2, lab_name: "San Carlos Apache Healthcare Corporation", owner_user_id: 37, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 6, lab_name: "SCAHC - Clarence Wesley", owner_user_id: 37, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 40, lab_name: "Solo Clinic", owner_user_id: 2, is_demo: 0, is_repository: 0, organization_id: null },
  { id: 50, lab_name: "Linked A", owner_user_id: 9, is_demo: 0, is_repository: 0, organization_id: 100 },
  { id: 51, lab_name: "Linked B", owner_user_id: 9, is_demo: 0, is_repository: 0, organization_id: null },
];

const c = computeBackfillCandidates(labs, users);
console.log("\ncandidates:");
for (const x of c) console.log(`  owner#${x.ownerUserId} labs=${x.labCount} alreadyLinked=${x.alreadyLinked} name="${x.suggestedName}"`);

ok("3 candidates (owners 66,37,9; solo excluded)", c.length === 3);
ok("solo single-lab owner excluded", !c.some((x) => x.ownerUserId === 2));
const g = c.find((x) => x.ownerUserId === 66);
ok("Gameday candidate labCount 3", g && g.labCount === 3);
ok("Gameday suggested name", g && g.suggestedName === "Gameday Men's Health");
ok("Gameday labIds sorted", g && g.labIds.join(",") === "19,29,30");
const sc = c.find((x) => x.ownerUserId === 37);
ok("SCAHC suggested name = longest lab", sc && sc.suggestedName === "San Carlos Apache Healthcare Corporation");
const ln = c.find((x) => x.ownerUserId === 9);
ok("partially-linked owner flagged alreadyLinked", ln && ln.alreadyLinked === true);
ok("largest system sorted first", c[0].ownerUserId === 66);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
