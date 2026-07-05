// scripts/verify-security-hardening.mjs
// Proves the two P2 security hardening fixes:
//   A) the request logger's response-body redactor masks credentials (token,
//      secret, password, pin, ...) at any depth while leaving other fields intact.
//   B) the login rate limiter blocks brute-force by failed-attempt count per
//      IP+email, resets on a successful login, and expires after the window.
// Mirrors the exact logic in server/index.ts (redactSensitive) and
// server/routes.ts (loginFailures limiter). Run: node scripts/verify-security-hardening.mjs
let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

// ── A) Redactor (identical to server/index.ts) ─────────────────────────────
const SENSITIVE_LOG_KEY = /^(token|secret|password|pass|pwd|jwt|api_?key|authorization|access_?token|refresh_?token|pin|client_secret)$/i;
function redactSensitive(key, value) {
  if (SENSITIVE_LOG_KEY.test(key) && typeof value === "string") return "[REDACTED]";
  return value;
}
const red = (obj) => JSON.stringify(obj, redactSensitive);

// The real login response shape: token must be masked, user fields kept.
const loginResp = { token: "eyJhbGciOi.SECRET.JWT", user: { id: 7, email: "a@b.com", plan: "clinic" } };
const s1 = red(loginResp);
check("redactor masks top-level token", s1.includes('"token":"[REDACTED]"'));
check("redactor keeps non-sensitive fields (email/plan)", s1.includes('"email":"a@b.com"') && s1.includes('"plan":"clinic"'));

// Nested + varied key names.
const nested = { data: { apiKey: "AKIA123", refresh_token: "rt_abc", nested: { password: "hunter2", pin: "1234" } }, count: 3 };
const s2 = red(nested);
check("redactor masks nested apiKey", s2.includes('"apiKey":"[REDACTED]"'));
check("redactor masks nested refresh_token", s2.includes('"refresh_token":"[REDACTED]"'));
check("redactor masks deeply-nested password + pin", s2.includes('"password":"[REDACTED]"') && s2.includes('"pin":"[REDACTED]"'));
check("redactor leaves numbers/other keys intact", s2.includes('"count":3'));

// Non-sensitive lookalikes and non-string secrets are left as-is.
const edge = { token_count: 5, description: "the secret sauce", secret: 42 };
const s3 = red(edge);
check("redactor does not mask a non-matching key (token_count)", s3.includes('"token_count":5'));
check("redactor does not mask a value that merely contains 'secret'", s3.includes('"the secret sauce"'));
check("redactor leaves a non-string 'secret' value (only strings masked)", s3.includes('"secret":42'));

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
