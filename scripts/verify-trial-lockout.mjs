// scripts/verify-trial-lockout.mjs
//
// Receipt for the card-less trial hard-lock added to labScopeMiddleware
// (server/routes.ts). Mirrors the exact decision: a lab is blocked (reads AND
// writes, everyone) only when is_trial=1 AND now >= subscription_expires_at.
// A non-trial lab is never blocked here (it falls through to the existing
// getAccessLevel/requireWriteAccess 2-year read-only retention for paid lapses).
//
// Run: node scripts/verify-trial-lockout.mjs

function trialBlocked(is_trial, subscription_expires_at, nowMs) {
  if (Number(is_trial) !== 1) return false;          // paid/comped lab: not this gate
  if (!subscription_expires_at) return false;        // trial with no expiry set: don't lock
  return nowMs >= new Date(subscription_expires_at).getTime();
}

const EXP = "2026-07-16T00:00:00.000Z"; // lab 7 (Trendy Elite) expiry
const before = new Date("2026-07-15T23:59:59.000Z").getTime();
const at     = new Date("2026-07-16T00:00:00.000Z").getTime();
const after  = new Date("2026-07-16T00:00:01.000Z").getTime();

const cases = [
  ["trial, one second before expiry -> ALLOW",              trialBlocked(1, EXP, before), false],
  ["trial, exactly at expiry -> BLOCK",                     trialBlocked(1, EXP, at),     true],
  ["trial, after expiry -> BLOCK",                          trialBlocked(1, EXP, after),  true],
  ["NON-trial (paid), after expiry -> ALLOW (read-only path)", trialBlocked(0, EXP, after), false],
  ["trial, no expiry set -> ALLOW (defensive)",            trialBlocked(1, null, after), false],
  ["trial, is_trial as string '1', after expiry -> BLOCK", trialBlocked("1", EXP, after), true],
];

let failed = 0;
for (const [label, got, want] of cases) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${got}, want ${want})`);
}
console.log(failed ? `\n${failed} FAILED` : "\nAll trial-lockout cases passed.");
process.exit(failed ? 1 : 0);
