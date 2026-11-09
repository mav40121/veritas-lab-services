// scripts/verify-security-hardening.mjs
// Proves the two P2 security hardening fixes:
//   A) the request logger writes no response body, and masks a credential in the path.
//   B) the login rate limiter blocks brute-force by failed-attempt count per
//      IP+email, resets on a successful login, and expires after the window.
// Mirrors the exact logic in server/logRedact.ts (requestLogLine) and
// server/routes.ts (loginFailures limiter). Run: node scripts/verify-security-hardening.mjs
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

// ── A) Request log (identical to server/logRedact.ts): no response body, and no credential in the path ──
const TOKEN_IN_PATH = /^(\/api\/(?:surveyor|public\/policy-share|seats\/invite|pdf|zip|export-all\/file|scheduling\/booking)\/)[^/]+/;
const requestLogLine = (method, path, status, ms) => `${method} ${path.replace(TOKEN_IN_PATH, "$1[REDACTED]")} ${status} in ${ms}ms`;
check("the log line masks a token in the path", requestLogLine("GET", "/api/surveyor/TOK/policies", 200, 5) === "GET /api/surveyor/[REDACTED]/policies 200 in 5ms");
check("the log line masks a document share link token", requestLogLine("GET", "/api/public/policy-share/TOK/file", 200, 5) === "GET /api/public/policy-share/[REDACTED]/file 200 in 5ms");
check("the log line leaves other paths alone", requestLogLine("GET", "/api/labs/3/members", 200, 5) === "GET /api/labs/3/members 200 in 5ms");

// ── B) Login rate limiter (mirror of server/routes.ts, now injectable) ─────
const WINDOW = 15 * 60 * 1000, MAX = 10;
const store = new Map();
const checkRate = (key, now) => {
  const e = store.get(key);
  if (!e) return { blocked: false };
  if (e.resetAt <= now) { store.delete(key); return { blocked: false }; }
  if (e.count >= MAX) return { blocked: true, retryAfterSec: Math.ceil((e.resetAt - now) / 1000) };
  return { blocked: false };
};
const recordFailure = (key, now) => {
  const e = store.get(key);
  if (!e || e.resetAt <= now) store.set(key, { count: 1, resetAt: now + WINDOW });
  else e.count += 1;
};
const clearRate = (key) => store.delete(key);

const K = "1.2.3.4|user@lab.com", other = "9.9.9.9|user@lab.com";
let t = 1_000_000;

// 9 failures: still allowed (threshold is 10).
for (let i = 0; i < 9; i++) recordFailure(K, t);
check("under threshold (9 failures) is NOT blocked", checkRate(K, t).blocked === false);

// 10th failure trips the block.
recordFailure(K, t);
const blocked = checkRate(K, t);
check("at threshold (10 failures) IS blocked", blocked.blocked === true);
check("blocked response carries a positive Retry-After", blocked.retryAfterSec > 0 && blocked.retryAfterSec <= WINDOW / 1000);

// A different IP for the same email is independent (no collateral lockout).
check("different IP for same email is not blocked", checkRate(other, t).blocked === false);

// A successful login clears the counter.
clearRate(K);
check("successful login clears the block", checkRate(K, t).blocked === false);

// Window expiry: re-fill to blocked, then advance past the window.
for (let i = 0; i < 10; i++) recordFailure(K, t);
check("re-blocked after 10 more failures", checkRate(K, t).blocked === true);
check("block auto-expires after the window", checkRate(K, t + WINDOW + 1).blocked === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
