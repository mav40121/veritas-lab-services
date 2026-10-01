// scripts/verify-org-coverage.mjs
//
// Gate-3 receipt for the Phase-3c org-covers-labs access overlay
// (server/organizationBilling.ts laterExpiry) and its effect on getAccessLevel.
// Mirrors the pure logic. If you change it there, change this mirror too.
//
// Run: node scripts/verify-org-coverage.mjs

function laterExpiry(a, b) {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
// mirror of server/routes.ts getAccessLevel (lab-expiry branch)
function getAccessLevel(expiryStr, now) {
  if (!expiryStr) return "free";
  const expiry = new Date(expiryStr);
  const twoYears = new Date(expiry); twoYears.setFullYear(twoYears.getFullYear() + 2);
  if (now < expiry) return "full";
  if (now < twoYears) return "read_only";
  return "locked";
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); } };

const PAST = "2025-06-01T00:00:00.000Z";       // expired ~16 months ago, within 2yr of NOW
const LONG_PAST = "2020-01-01T00:00:00.000Z";   // > 2yr ago (locked)
const FUTURE = "2027-10-01T00:00:00.000Z";
const FAR_FUTURE = "2030-01-01T00:00:00.000Z";
const NOW = new Date("2026-10-01T12:00:00.000Z");

// laterExpiry: additive "more generous" semantics
eq("later(null,null)=null", laterExpiry(null, null), null);
eq("later(null,future)=future", laterExpiry(null, FUTURE), FUTURE);
eq("later(future,null)=future", laterExpiry(FUTURE, null), FUTURE);
eq("later(past,future)=future", laterExpiry(PAST, FUTURE), FUTURE);
eq("later(farfuture,future)=farfuture", laterExpiry(FAR_FUTURE, FUTURE), FAR_FUTURE);

// Access consequence (the point of 3c):
// 1. Expired lab + active org -> org coverage restores FULL access.
eq("expired lab alone -> read_only", getAccessLevel(PAST, NOW), "read_only");
eq("expired lab + org future -> full (covered)", getAccessLevel(laterExpiry(PAST, FUTURE), NOW), "full");

// 2. Locked (>2yr) lab + active org -> full.
eq("long-expired lab alone -> locked", getAccessLevel(LONG_PAST, NOW), "locked");
eq("long-expired lab + org future -> full", getAccessLevel(laterExpiry(LONG_PAST, FUTURE), NOW), "full");

// 3. Free lab (no expiry) + active org -> full (org pays for the lab).
eq("free lab alone -> free", getAccessLevel(null, NOW), "free");
eq("free lab + org future -> full", getAccessLevel(laterExpiry(null, FUTURE), NOW), "full");

// 4. Never REDUCES: a lab with its own far-future sub keeps it even if the org expiry is sooner.
eq("lab far-future + org sooner -> stays full on lab's own", getAccessLevel(laterExpiry(FAR_FUTURE, FUTURE), NOW), "full");

// 5. Standalone lab (org expiry null): unchanged.
eq("expired standalone (orgExpiry null) stays read_only", getAccessLevel(laterExpiry(PAST, null), NOW), "read_only");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
