// tests/integration/sso.test.ts
//
// STANDING integration test for single sign-on (server/sso.ts, server/ssoRoutes.ts; Michael
// 2026-10-15, Q39 = 1). Boots the REAL Express routes against a throwaway SQLite DB with a mock
// OpenID Connect provider mounted on the same server, and drives the real redirect round trip.
// The negatives are the point: a forged, expired, replayed, wrong-audience, wrong-issuer, unsigned or
// HMAC-signed token must never open an account; a disallowed domain, an unknown person and a Veritas
// support account are refused; a required domain cannot use a password; the handoff code works once.
// Run: npm run test:sso

import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const app = express();
  const server = http.createServer(app);

  // ── Mock OpenID Connect provider ─────────────────────────────────────
  const good = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const evil = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(good.publicKey.export({ format: "jwk" }) as any), kid: "k1", alg: "RS256", use: "sig" };
  let issuerUrl = "";
  const CLIENT_ID = "client-123";
  const codes = new Map<string, any>();
  const tokenCalls: any[] = [];
  const signJwt = (header: any, payload: any, key: crypto.KeyObject | "hs256" | "none") => {
    const h = b64url(Buffer.from(JSON.stringify(header))), p = b64url(Buffer.from(JSON.stringify(payload)));
    if (key === "none") return `${h}.${p}.`;
    if (key === "hs256") return `${h}.${p}.${b64url(crypto.createHmac("sha256", "shared").update(`${h}.${p}`).digest())}`;
    return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key))}`;
  };
  const mock = express.Router();
  mock.use(express.urlencoded({ extended: false }));
  mock.get("/tenant-1/v2.0/.well-known/openid-configuration", (_req, res) => res.json({
    issuer: issuerUrl, authorization_endpoint: `${issuerUrl}/authorize`, token_endpoint: `${issuerUrl}/token`, jwks_uri: `${issuerUrl}/keys`,
  }));
  mock.get("/tenant-1/v2.0/keys", (_req, res) => res.json({ keys: [jwk] }));
  mock.post("/tenant-1/v2.0/token", (req, res) => {
    tokenCalls.push({ ...req.body });
    const c = codes.get(String(req.body.code));
    if (!c) return res.status(400).json({ error: "invalid_grant" });
    codes.delete(String(req.body.code));
    const verifierHash = b64url(crypto.createHash("sha256").update(String(req.body.code_verifier || "")).digest());
    if (verifierHash !== c.challenge) return res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    if (req.body.client_id !== CLIENT_ID || req.body.redirect_uri !== c.redirectUri) return res.status(400).json({ error: "invalid_client" });
    res.json({ id_token: c.idToken, token_type: "Bearer" });
  });
  app.use("/mock-idp", mock);
  app.use(express.json({ limit: "10mb" }));
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  issuerUrl = `${base}/mock-idp/tenant-1/v2.0`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Zq", "sso", "7x!"].join("-");

  const req = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const register = async (email: string) => {
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${email.split("@")[0]}`, hipaa_acknowledged: true });
    return Number(r.body?.user?.id);
  };
  const signOutAll = (uid: number) => sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid);

  /** One browser round trip: start -> (provider) -> callback. opts change what the provider returns. */
  const roundTrip = async (email: string, opts: { claims?: any; key?: crypto.KeyObject | "hs256" | "none"; alg?: string; nonce?: string; state?: string; challenge?: string; providerError?: string; kid?: string } = {}) => {
    const start = await fetch(`${base}/api/auth/sso/start?email=${encodeURIComponent(email)}`, { redirect: "manual" });
    const loc = new URL(start.headers.get("location") || "", base);
    const q = loc.searchParams;
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: issuerUrl, aud: CLIENT_ID, sub: "sub-1", email, name: "Test Person", nonce: opts.nonce ?? q.get("nonce"), iat: now, nbf: now, exp: now + 3600, tid: "tenant-1", ...(opts.claims || {}) };
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, {
      challenge: opts.challenge ?? q.get("code_challenge"),
      redirectUri: q.get("redirect_uri"),
      idToken: signJwt({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" }, payload, opts.key ?? good.privateKey),
    });
    const cbUrl = opts.providerError
      ? `${base}/api/auth/sso/callback?error=${opts.providerError}&error_description=refused&state=${encodeURIComponent(opts.state ?? q.get("state") ?? "")}`
      : `${base}/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(opts.state ?? q.get("state") ?? "")}`;
    const cb = await fetch(cbUrl, { redirect: "manual" });
    const to = new URL(cb.headers.get("location") || "", base);
    return { start, q, state: q.get("state"), cbStatus: cb.status, handoff: to.searchParams.get("sso"), error: to.searchParams.get("sso_error") };
  };

  try {
    // Accounts.
    const alice = await register(`alice-${Date.now()}@hospital.test`.replace(/-\d+@/, "@"));
    const aliceEmail = "alice@hospital.test";
    const bob = await register("bob@other.test");
    const supportEmail = "support@hospital.test";
    const support = await register(supportEmail);
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support);
    check("0. test accounts created", [alice, bob, support].every((x) => Number.isInteger(x) && x > 0));

    // Admin setup.
    const noAuth = await req("POST", "/api/admin/sso/configs", { secret: "wrong", name: "x", issuer: issuerUrl, clientId: CLIENT_ID, emailDomains: ["hospital.test"] });
    check("1a. admin setup refuses a wrong secret", noAuth.status === 403);
    const badDomain = await req("POST", "/api/admin/sso/configs", { secret: ADMIN, name: "x", issuer: issuerUrl, clientId: CLIENT_ID, emailDomains: ["not a domain"] });
    check("1b. admin setup refuses an invalid domain", badDomain.status === 400, JSON.stringify(badDomain.body));
    const dry = await req("POST", "/api/admin/sso/configs", { secret: ADMIN, name: "IT Hospital", issuer: issuerUrl, clientId: CLIENT_ID, emailDomains: ["hospital.test"], dryRun: true });
    check("1c. dry run reads the provider's configuration and writes nothing", dry.status === 200 && dry.body?.dryRun === true && dry.body?.plan?.discoveredIssuer === issuerUrl && (sqlite.prepare("SELECT COUNT(*) AS n FROM sso_configs").get() as any).n === 0, JSON.stringify(dry.body).slice(0, 160));
    const made = await req("POST", "/api/admin/sso/configs", { secret: ADMIN, name: "IT Hospital", issuer: issuerUrl, clientId: CLIENT_ID, clientSecret: "s3cr3t-value", emailDomains: ["Hospital.TEST"] });
    const cfgId = Number(made.body?.config?.id);
    const stored = sqlite.prepare("SELECT client_secret_enc, email_domains FROM sso_configs WHERE id = ?").get(cfgId) as any;
    check("1d. setup saves the domain (lowercased) and seals the client secret", made.status === 200 && JSON.parse(stored.email_domains)[0] === "hospital.test" && !!stored.client_secret_enc && !String(stored.client_secret_enc).includes("s3cr3t"), JSON.stringify(made.body));
    const listed = await req("GET", `/api/admin/sso/configs?secret=${encodeURIComponent(ADMIN)}`);
    check("1e. the listing never returns the secret", listed.status === 200 && listed.body.configs?.[0]?.hasClientSecret === true && !JSON.stringify(listed.body).includes("s3cr3t") && !("client_secret_enc" in (listed.body.configs?.[0] || {})));
    const clash = await req("POST", "/api/admin/sso/configs", { secret: ADMIN, name: "Other", issuer: issuerUrl, clientId: "c2", emailDomains: ["hospital.test"] });
    check("1f. a domain cannot belong to two SSO setups", clash.status === 409);

    // Lookup.
    const l1 = await req("POST", "/api/auth/sso/lookup", { email: aliceEmail });
    const l2 = await req("POST", "/api/auth/sso/lookup", { email: "bob@other.test" });
    const l3 = await req("POST", "/api/auth/sso/lookup", { email: "nobody@hospital.test" });
    check("2a. lookup: the hospital domain signs in with SSO (optional)", l1.body?.sso === true && l1.body?.required === false && String(l1.body?.start || "").startsWith("/api/auth/sso/start"));
    check("2b. lookup: another domain does not", l2.body?.sso === false);
    check("2c. lookup answers by domain only (same answer for a person with no account)", JSON.stringify(l3.body) === JSON.stringify({ ...l1.body, start: l3.body.start }));

    // Start.
    signOutAll(alice);
    const rt = await roundTrip(aliceEmail);
    check("3a. start redirects to the provider with PKCE (S256), state, nonce, login hint and our callback", rt.start.status === 302 && rt.q.get("code_challenge_method") === "S256" && (rt.q.get("code_challenge") || "").length >= 43 && !!rt.q.get("state") && !!rt.q.get("nonce") && rt.q.get("login_hint") === aliceEmail && rt.q.get("client_id") === CLIENT_ID && rt.q.get("redirect_uri") === `${base}/api/auth/sso/callback`, rt.start.headers.get("location")?.slice(0, 120));
    check("3b. the provider got the configured client secret at the token step", tokenCalls[tokenCalls.length - 1]?.client_secret === "s3cr3t-value");
    check("3c. a valid token comes back to the sign-in page as a one-time handoff code (no token in the URL)", rt.cbStatus === 302 && !!rt.handoff && !rt.error, JSON.stringify({ e: rt.error }));
    const done = await req("POST", "/api/auth/sso/complete", { code: rt.handoff });
    check("3d. the handoff code signs the person in", done.status === 200 && typeof done.body?.token === "string" && done.body?.user?.email === aliceEmail, JSON.stringify(Object.keys(done.body || {})));
    check("3e. the session works and records single sign-on", (await req("GET", "/api/auth/me", undefined, done.body.token)).status === 200 && (sqlite.prepare("SELECT mfa_method FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(alice) as any)?.mfa_method === "sso");
    const again = await req("POST", "/api/auth/sso/complete", { code: rt.handoff });
    check("3f. the handoff code works only once", again.status === 401);

    // State: single use and expiry.
    signOutAll(alice);
    const replay = await roundTrip(aliceEmail, { state: rt.state! });
    check("4a. a used state cannot be replayed", replay.error === "expired" && !replay.handoff);
    const fresh = await fetch(`${base}/api/auth/sso/start?email=${aliceEmail}`, { redirect: "manual" });
    const freshState = new URL(fresh.headers.get("location") || "", base).searchParams.get("state")!;
    const stateHash = crypto.createHash("sha256").update(freshState).digest("hex");
    sqlite.prepare("UPDATE sso_login_states SET expires_at = ? WHERE state_hash = ?").run(new Date(Date.now() - 1000).toISOString(), stateHash);
    const late = await roundTrip(aliceEmail, { state: freshState });
    check("4b. an expired state is refused", late.error === "expired" && !late.handoff);
    const handoffRow = await roundTrip(aliceEmail);
    sqlite.prepare("UPDATE sso_handoffs SET expires_at = ? WHERE used_at IS NULL").run(new Date(Date.now() - 1000).toISOString());
    check("4c. an expired handoff code is refused", (await req("POST", "/api/auth/sso/complete", { code: handoffRow.handoff })).status === 401);

    // Token checks.
    const cases: Array<[string, any]> = [
      ["5a. a token for another app (wrong audience) is refused", { claims: { aud: "someone-else" } }],
      ["5b. a token from another issuer is refused", { claims: { iss: "https://login.microsoftonline.com/other-tenant/v2.0" } }],
      ["5c. an expired token is refused", { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
      ["5d. a token that is not yet valid is refused", { claims: { nbf: Math.floor(Date.now() / 1000) + 3600 } }],
      ["5e. a token with the wrong nonce is refused", { nonce: "not-the-nonce" }],
      ["5f. a token signed with a different key is refused", { key: evil.privateKey }],
      ["5g. an unsigned token (alg none) is refused", { key: "none", alg: "none" }],
      ["5h. an HMAC-signed token (HS256) is refused", { key: "hs256", alg: "HS256" }],
      ["5i. a token signed with an unknown key id is refused", { kid: "k-unknown" }],
    ];
    for (const [name, o] of cases) {
      signOutAll(alice);
      const r = await roundTrip(aliceEmail, o);
      check(name, r.error === "token_rejected" && !r.handoff, String(r.error));
    }
    signOutAll(alice);
    const pkce = await roundTrip(aliceEmail, { challenge: "x".repeat(43) });
    check("5j. a code redeemed without the matching PKCE verifier gets no sign-in", !!pkce.error && !pkce.handoff, String(pkce.error));

    // Who may sign in.
    const other = await roundTrip(aliceEmail, { claims: { email: "bob@other.test", preferred_username: "bob@other.test" } });
    check("6a. an email outside the configured domain is refused", other.error === "domain_not_allowed" && !other.handoff, String(other.error));
    const nobody = await roundTrip("carol@hospital.test");
    check("6b. a person with no VeritaAssure account is refused (SSO does not create accounts)", nobody.error === "no_account" && !nobody.handoff && !sqlite.prepare("SELECT 1 FROM users WHERE email = 'carol@hospital.test'").get(), String(nobody.error));
    const sup = await roundTrip(supportEmail);
    check("6c. a Veritas support account cannot use a customer's SSO", sup.error === "support_account" && !sup.handoff, String(sup.error));
    const upn = await roundTrip(aliceEmail, { claims: { email: undefined, preferred_username: aliceEmail } });
    check("6d. Entra tokens without an email claim use preferred_username", !!upn.handoff && !upn.error, String(upn.error));
    const refused = await roundTrip(aliceEmail, { providerError: "access_denied" });
    check("6e. a provider refusal lands on the sign-in page with a reason", refused.error === "provider_refused" && !refused.handoff);

    // Two-factor: SSO skips VeritaAssure's own code step.
    sqlite.prepare("INSERT OR REPLACE INTO user_mfa (user_id, method, enabled_at, updated_at) VALUES (?, 'email', ?, ?)").run(alice, new Date().toISOString(), new Date().toISOString());
    signOutAll(alice);
    const mfaRt = await roundTrip(aliceEmail);
    const mfaDone = await req("POST", "/api/auth/sso/complete", { code: mfaRt.handoff });
    check("7. a person enrolled in two-factor signs in through SSO without the extra code step", typeof mfaDone.body?.token === "string" && !mfaDone.body?.mfa_required, JSON.stringify(Object.keys(mfaDone.body || {})));
    sqlite.prepare("DELETE FROM user_mfa WHERE user_id = ?").run(alice);

    // Optional vs required.
    signOutAll(alice);
    const optPw = await req("POST", "/api/auth/login", { email: aliceEmail, password: PW });
    check("8a. optional SSO: the password still works", typeof optPw.body?.token === "string", `status=${optPw.status}`);
    await req("POST", "/api/admin/sso/configs", { secret: ADMIN, id: cfgId, required: true });
    signOutAll(alice);
    const reqPw = await req("POST", "/api/auth/login", { email: aliceEmail, password: PW });
    check("8b. required SSO: password sign-in is refused and points to SSO", reqPw.status === 403 && reqPw.body?.code === "SSO_REQUIRED" && String(reqPw.body?.sso_start || "").includes("/api/auth/sso/start"), JSON.stringify(reqPw.body));
    const wrongPw = await req("POST", "/api/auth/login", { email: "nobody@hospital.test", password: "whatever-1" });
    check("8c. required SSO answers the same for an address with no account (no enumeration)", wrongPw.status === 403 && wrongPw.body?.code === "SSO_REQUIRED");
    signOutAll(support);
    const supPw = await req("POST", "/api/auth/login", { email: supportEmail, password: PW });
    check("8d. required SSO: a Veritas support account keeps its own sign-in", supPw.status === 200 && (typeof supPw.body?.token === "string" || supPw.body?.mfa_setup_required === true), JSON.stringify(Object.keys(supPw.body || {})));
    signOutAll(bob);
    const bobPw = await req("POST", "/api/auth/login", { email: "bob@other.test", password: PW });
    check("8e. other domains are unaffected", typeof bobPw.body?.token === "string");
    const resetsBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM reset_tokens WHERE user_id = ?").get(alice) as any).n;
    const fp = await req("POST", "/api/auth/forgot-password", { email: aliceEmail });
    check("8f. required SSO: no password-reset email is issued", fp.status === 200 && fp.body?.sso_required === true && (sqlite.prepare("SELECT COUNT(*) AS n FROM reset_tokens WHERE user_id = ?").get(alice) as any).n === resetsBefore);
    signOutAll(alice);
    const reqRt = await roundTrip(aliceEmail);
    check("8g. required SSO: the SSO sign-in itself still works", !!reqRt.handoff && (await req("POST", "/api/auth/sso/complete", { code: reqRt.handoff })).status === 200);

    // Switched off.
    await req("POST", "/api/admin/sso/configs", { secret: ADMIN, id: cfgId, enabled: false });
    signOutAll(alice);
    const offPw = await req("POST", "/api/auth/login", { email: aliceEmail, password: PW });
    const offStart = await fetch(`${base}/api/auth/sso/start?email=${aliceEmail}`, { redirect: "manual" });
    check("9. switched off: passwords work again and SSO start explains it is not set up", typeof offPw.body?.token === "string" && String(offStart.headers.get("location")).includes("sso_error=not_configured"));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
