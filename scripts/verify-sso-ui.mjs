// scripts/verify-sso-ui.mjs
//
// Browser receipt for single sign-on (server/sso.ts; Michael 2026-10-15, Q39 = 1). LOCAL server + scratch
// DB only; the accounts are local test data. Runs a small mock OpenID Connect provider on its own port
// (auto-approves, like a user who is already signed in to their hospital account) and drives the real
// sign-in page through the real redirects:
//   1. the Sign In card shows "Sign in with your organization"
//   2. optional SSO: email -> Sign in with your organization -> provider -> back -> signed in (dashboard)
//   3. a person with no account comes back to a plain message, not a session
//   4. a domain without SSO gets "isn't set up", and no redirect
//   5. required SSO: typing a password and pressing Sign In goes through SSO instead, and signs in
//   6. light, dark and 390px; no horizontal page scroll
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-sso-ui.mjs
import { createRequire } from "node:module";
import http from "node:http";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── Mock provider ─────────────────────────────────────────────────────────
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "ui-1", alg: "RS256", use: "sig" };
const CLIENT_ID = "ui-client";
const codes = new Map();
let issuer = "";
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const json = (o, s = 200) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (u.pathname.endsWith("/.well-known/openid-configuration")) return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` });
  if (u.pathname.endsWith("/keys")) return json({ keys: [jwk] });
  if (u.pathname.endsWith("/authorize")) {
    const q = u.searchParams, code = b64url(crypto.randomBytes(16));
    codes.set(code, { challenge: q.get("code_challenge"), nonce: q.get("nonce"), email: q.get("login_hint"), redirect: q.get("redirect_uri") });
    res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(q.get("state"))}` });
    return res.end();
  }
  if (u.pathname.endsWith("/token") && req.method === "POST") {
    let raw = ""; for await (const ch of req) raw += ch;
    const b = new URLSearchParams(raw), c = codes.get(b.get("code"));
    if (!c || b64url(crypto.createHash("sha256").update(b.get("code_verifier") || "").digest()) !== c.challenge || b.get("redirect_uri") !== c.redirect) return json({ error: "invalid_grant" }, 400);
    codes.delete(b.get("code"));
    const now = Math.floor(Date.now() / 1000);
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "ui-1", typ: "JWT" })));
    const p = b64url(Buffer.from(JSON.stringify({ iss: issuer, aud: CLIENT_ID, sub: "ui-sub", email: c.email, name: "UI Person", nonce: c.nonce, iat: now, nbf: now, exp: now + 3600 })));
    return json({ id_token: `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), privateKey))}` });
  }
  json({ error: "not found" }, 404);
});
await new Promise((r) => idp.listen(0, "127.0.0.1", r));
issuer = `http://127.0.0.1:${idp.address().port}/tenant-ui/v2.0`;

// ── Accounts and SSO setup (scratch DB) ──────────────────────────────────
const stamp = Date.now();
const PW = ["Zq", "ssoui", "7x!"].join("-");
const email = `jordan.${stamp}@hospital-qa.test`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id;
await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" });
scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE owner_user_id = ?").run(uid); d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid); });
const existing = (await call("GET", `/api/admin/sso/configs?secret=${ADMIN}`)).body?.configs?.find((c) => c.emailDomains.includes("hospital-qa.test"));
const saved = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, ...(existing ? { id: existing.id } : {}), name: "Hospital QA (Entra)", issuer, clientId: CLIENT_ID, emailDomains: ["hospital-qa.test"], required: false, enabled: true });
const cfgId = saved.body?.config?.id;
check("0. QA account and an optional SSO setup on the scratch DB", !!uid && !!cfgId, JSON.stringify(saved.body).slice(0, 140));

const browser = await chromium.launch();
const fresh = async (scheme, width) => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme }); return { ctx, page: await ctx.newPage() }; };
const card = (page) => page.locator("form").filter({ has: page.getByTestId("sso-button") });
const endSessions = () => scratch((d) => d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid));

// 1-2) Optional SSO round trip.
{
  const { ctx, page } = await fresh("light", 1280);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  check("1. the Sign In card shows Sign in with your organization", await page.getByTestId("sso-button").isVisible());
  await card(page).screenshot({ path: `${OUT}/sso-login-card-light.png` });
  await page.getByPlaceholder("you@lab.com").fill(email);
  await page.getByTestId("sso-button").click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
  const token = await page.evaluate(() => localStorage.getItem("veritas_token"));
  check("2a. email + Sign in with your organization -> provider -> back -> signed in on the dashboard", /\/dashboard/.test(page.url()) && !!token, page.url());
  const row = scratch((d) => d.prepare("SELECT mfa_method FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(uid));
  check("2b. the session records single sign-on", row?.mfa_method === "sso", JSON.stringify(row));
  check("2c. no token or handoff code is left in the address bar", !/[?&](sso|token)=/.test(page.url()));
  await ctx.close();
}

// 3) A person with no account.
for (const [scheme, width] of [["light", 1280], ["dark", 390]]) {
  const { ctx, page } = await fresh(scheme, width);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(`nobody.${stamp}@hospital-qa.test`);
  await page.getByTestId("sso-button").click();
  await page.getByTestId("sso-error").waitFor({ timeout: 20000 }).catch(() => {});
  const msg = await page.getByTestId("sso-error").innerText().catch(() => "");
  if (!msg) console.log("   debug: url", page.url(), "| body", (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
  check(`3. [${scheme} ${width}px] no account: a plain message, no session`, msg.includes("no VeritaAssure account") && !(await page.evaluate(() => localStorage.getItem("veritas_token"))), msg);
  check(`3b. [${scheme} ${width}px] no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await card(page).screenshot({ path: `${OUT}/sso-no-account-${scheme}-${width}.png` });
  await ctx.close();
}

// 4) A domain without SSO.
{
  const { ctx, page } = await fresh("light", 1280);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill("someone@other-qa.test");
  await page.getByTestId("sso-button").click();
  await page.getByTestId("sso-error").waitFor({ timeout: 10000 }).catch(() => {});
  const msg = await page.getByTestId("sso-error").innerText().catch(() => "");
  check("4. a domain without SSO: 'isn't set up', stays on the page", msg.includes("isn't set up for other-qa.test") && page.url().startsWith(`${BASE}/login`), msg);
  await ctx.close();
}

// 5) Required SSO: the password path goes through SSO.
{
  await call("POST", "/api/admin/sso/configs", { secret: ADMIN, id: cfgId, required: true });
  endSessions();
  const { ctx, page } = await fresh("dark", 1280);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(email);
  await page.getByTestId("login-password").fill(PW);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
  const row = scratch((d) => d.prepare("SELECT mfa_method FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(uid));
  check("5. required SSO: Sign In with a password goes through the organization's sign-in instead", /\/dashboard/.test(page.url()) && row?.mfa_method === "sso", `${page.url()} ${JSON.stringify(row)}`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await card(page).screenshot({ path: `${OUT}/sso-login-card-dark.png` }).catch(() => {});
  await ctx.close();
  await call("POST", "/api/admin/sso/configs", { secret: ADMIN, id: cfgId, enabled: false });
}

await browser.close();
idp.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
