// scripts/verify-veritaceu-profile-resolver.mjs
//
// Gate-3 receipt for VeritaCEU phase 4: the CE requirement resolver
// (loadCeuResolver in server/routes.ts). Mirrors the fallback chain:
//   employee's assigned profile -> lab default profile -> ASCP CMP 36/36.
// Only ACTIVE profiles are loaded, so an employee pointing at a retired profile
// cleanly falls back. This protects the existing flat behavior for labs with no
// profiles (resolver returns 36/36, identical to phase 1).
//
// Run: node scripts/verify-veritaceu-profile-resolver.mjs

function makeResolver(activeProfiles) {
  const byId = new Map();
  let def = null;
  for (const p of activeProfiles) {
    const entry = { required: Number(p.required_credits), cycleMonths: Number(p.cycle_months) };
    byId.set(Number(p.id), entry);
    if (p.is_default) def = entry;
  }
  const fallback = { required: 36, cycleMonths: 36 };
  return {
    default: def || fallback,
    for(profileId) {
      if (profileId != null && byId.has(Number(profileId))) return byId.get(Number(profileId));
      return def || fallback;
    },
  };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); } };

// No profiles at all -> ASCP 36/36 for everyone (phase-1 behavior preserved).
let r = makeResolver([]);
eq("no profiles, assigned null -> 36/36", r.for(null), { required: 36, cycleMonths: 36 });
eq("no profiles, assigned id -> 36/36", r.for(5), { required: 36, cycleMonths: 36 });
eq("no profiles, default is 36/36", r.default, { required: 36, cycleMonths: 36 });

// A default profile + a specific state profile.
const profs = [
  { id: 1, required_credits: 36, cycle_months: 36, is_default: 1 },   // ASCP CMP default
  { id: 2, required_credits: 24, cycle_months: 24, is_default: 0 },   // a state license rule
];
r = makeResolver(profs);
eq("assigned to state profile -> 24/24", r.for(2), { required: 24, cycleMonths: 24 });
eq("assigned null -> lab default 36/36", r.for(null), { required: 36, cycleMonths: 36 });
eq("assigned to default profile -> 36/36", r.for(1), { required: 36, cycleMonths: 36 });
eq("lab default exposed", r.default, { required: 36, cycleMonths: 36 });

// Assigned to a profile that is no longer active (retired -> not loaded) falls
// back to the lab default.
r = makeResolver(profs); // id 3 is not in the active set
eq("assigned to retired/unknown id -> lab default", r.for(3), { required: 36, cycleMonths: 36 });

// A lab with profiles but NO default -> unassigned falls back to ASCP 36/36.
r = makeResolver([{ id: 7, required_credits: 50, cycle_months: 12, is_default: 0 }]);
eq("no default, assigned id 7 -> 50/12", r.for(7), { required: 50, cycleMonths: 12 });
eq("no default, unassigned -> 36/36", r.for(null), { required: 36, cycleMonths: 36 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
