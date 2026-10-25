// server/sso.ts
//
// Single sign-on (Michael 2026-10-15, Q39 = 1): OpenID Connect authorization code flow with PKCE,
// Microsoft Entra first (any standards-compliant provider works through discovery). A customer's
// staff sign in with their hospital account; hospital IT controls who gets in.
//
// Rules:
//  - Routed by email domain. Each sso_configs row lists its domains and is optional or required.
//    "Required" refuses password sign-in for those domains (Veritas support accounts excepted).
//  - Matches EXISTING VeritaAssure accounts by email. SSO proves who someone is; it never creates an
//    account or a seat.
//  - The identity token is checked strictly: RS256 only, signature against the provider's published
//    keys, exact issuer, audience = our client id, not expired / not before, and the nonce issued for
//    this sign-in. State is single-use and expires in 10 minutes; PKCE binds the code to this browser.
//  - The finished sign-in reaches the page through a single-use 60-second handoff code, never a token
//    in a URL.
//  - SSO sessions skip VeritaAssure's own two-factor step (the hospital's sign-in does that).
import crypto from "crypto";
import { sealSecret, openSecret } from "./twoFactor";

export const STATE_TTL_MS = 10 * 60 * 1000;
export const HANDOFF_TTL_MS = 60 * 1000;
const CLOCK_SKEW_S = 120;
const CACHE_MS = 60 * 60 * 1000;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export interface SsoConfig {
  id: number;
  organization_id: number | null;
  name: string;
  issuer: string;
  client_id: string;
  client_secret_enc: string | null;
  email_domains: string;
  required: number;
  enabled: number;
}

export const domainOf = (email: string) => String(email || "").trim().toLowerCase().split("@")[1] || "";
export const parseDomains = (cfg: Pick<SsoConfig, "email_domains">): string[] => {
  try { return (JSON.parse(cfg.email_domains || "[]") as string[]).map((d) => String(d).toLowerCase()); } catch { return []; }
};

/** The enabled SSO configuration that covers this email's domain, if any. */
export function ssoConfigForEmail(sqlite: any, email: string): SsoConfig | null {
  const d = domainOf(email);
  if (!d) return null;
  const rows = sqlite.prepare("SELECT * FROM sso_configs WHERE enabled = 1").all() as SsoConfig[];
  return rows.find((c) => parseDomains(c).includes(d)) || null;
}

export function ssoConfigById(sqlite: any, id: number): SsoConfig | null {
  return (sqlite.prepare("SELECT * FROM sso_configs WHERE id = ?").get(id) as SsoConfig) || null;
}

/** Microsoft Entra issuer for a tenant (v2.0 endpoints). */
export const entraIssuer = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/v2.0`;

// ── Provider discovery and signing keys ──────────────────────────────────
type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
const discoCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: any[] }>();
type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Tests point discovery and token calls at a local mock provider. */
export function setSsoFetch(f: Fetcher | null): void { fetcher = f || ((...a) => fetch(...a)); discoCache.clear(); jwksCache.clear(); }

export async function discover(issuer: string): Promise<Discovery> {
  const key = issuer.replace(/\/+$/, "");
  const hit = discoCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.doc;
  const r = await fetcher(`${key}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`discovery failed (${r.status})`);
  const doc = (await r.json()) as Discovery;
  for (const k of ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof doc[k] !== "string" || !doc[k]) throw new Error(`discovery document is missing ${k}`);
  }
  discoCache.set(key, { at: Date.now(), doc });
  return doc;
}

async function signingKey(jwksUri: string, kid: string): Promise<crypto.KeyObject | null> {
  const load = async (force: boolean) => {
    const hit = jwksCache.get(jwksUri);
    if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.keys;
    const r = await fetcher(jwksUri, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`signing keys unavailable (${r.status})`);
    const keys = ((await r.json()) as any)?.keys || [];
    jwksCache.set(jwksUri, { at: Date.now(), keys });
    return keys;
  };
  // Providers rotate keys: on an unknown kid, reload once before refusing.
  for (const force of [false, true]) {
    const jwk = (await load(force)).find((k: any) => k.kid === kid && k.kty === "RSA");
    if (jwk) return crypto.createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  }
  return null;
}

// ── One sign-in round trip ───────────────────────────────────────────────
export interface StartedSignIn { state: string; nonce: string; verifier: string; challenge: string }
export function newSignIn(): StartedSignIn {
  const verifier = b64url(crypto.randomBytes(32));
  return {
    state: b64url(crypto.randomBytes(32)),
    nonce: b64url(crypto.randomBytes(32)),
    verifier,
    challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
  };
}

export function saveSignInState(sqlite: any, cfg: SsoConfig, s: StartedSignIn, redirectUri: string, emailHint: string | null): void {
  const now = Date.now();
  // delete-reinsert-ok: expiry cleanup of other rows; the INSERT adds a new state
  sqlite.prepare("DELETE FROM sso_login_states WHERE expires_at < ?").run(new Date(now - STATE_TTL_MS).toISOString());
  sqlite.prepare(
    "INSERT INTO sso_login_states (state_hash, config_id, nonce, code_verifier, redirect_uri, email_hint, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(sha(s.state), cfg.id, s.nonce, s.verifier, redirectUri, emailHint, new Date(now).toISOString(), new Date(now + STATE_TTL_MS).toISOString());
}

/** Takes (and spends) the state for a callback. Null when unknown, already used or expired. */
export function takeSignInState(sqlite: any, state: string): { config_id: number; nonce: string; code_verifier: string; redirect_uri: string; email_hint: string | null } | null {
  if (!state) return null;
  const row = sqlite.prepare("SELECT * FROM sso_login_states WHERE state_hash = ?").get(sha(state)) as any;
  if (!row || row.used_at) return null;
  const spent = sqlite.prepare("UPDATE sso_login_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL").run(new Date().toISOString(), sha(state));
  if (Number(spent?.changes || 0) !== 1) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

export function authorizeUrl(doc: Discovery, cfg: SsoConfig, s: StartedSignIn, redirectUri: string, emailHint: string | null): string {
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set("client_id", cfg.client_id);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", "openid email profile");
  u.searchParams.set("state", s.state);
  u.searchParams.set("nonce", s.nonce);
  u.searchParams.set("code_challenge", s.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (emailHint) u.searchParams.set("login_hint", emailHint);
  return u.toString();
}

/** Trades the authorization code for the identity token (PKCE; client secret only when configured). */
export async function exchangeCode(doc: Discovery, cfg: SsoConfig, code: string, verifier: string, redirectUri: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: cfg.client_id, code_verifier: verifier });
  const secret = openSecret(cfg.client_secret_enc);
  if (secret) body.set("client_secret", secret);
  const r = await fetcher(doc.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: body.toString() });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || typeof j.id_token !== "string") throw new Error(`token exchange failed (${r.status}${j?.error ? ": " + j.error : ""})`);
  return j.id_token;
}

export class SsoTokenError extends Error {}

/** Verifies the identity token: RS256 signature, issuer, audience, time window and nonce. Returns its claims. */
export async function verifyIdToken(idToken: string, doc: Discovery, clientId: string, nonce: string): Promise<Record<string, any>> {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new SsoTokenError("malformed token");
  let header: any, claims: any;
  try { header = JSON.parse(b64urlDecode(parts[0]).toString("utf8")); claims = JSON.parse(b64urlDecode(parts[1]).toString("utf8")); }
  catch { throw new SsoTokenError("malformed token"); }
  if (header?.alg !== "RS256") throw new SsoTokenError(`signing algorithm ${header?.alg} not accepted`);
  if (!header.kid) throw new SsoTokenError("token has no key id");
  const key = await signingKey(doc.jwks_uri, header.kid);
  if (!key) throw new SsoTokenError("signing key not found");
  const ok = crypto.verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, b64urlDecode(parts[2]));
  if (!ok) throw new SsoTokenError("bad signature");
  if (claims.iss !== doc.issuer) throw new SsoTokenError("wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new SsoTokenError("wrong audience");
  if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== clientId) throw new SsoTokenError("wrong authorized party");
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < now - CLOCK_SKEW_S) throw new SsoTokenError("token expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + CLOCK_SKEW_S) throw new SsoTokenError("token not yet valid");
  if (typeof claims.iat === "number" && claims.iat > now + CLOCK_SKEW_S) throw new SsoTokenError("token issued in the future");
  if (!nonce || claims.nonce !== nonce) throw new SsoTokenError("nonce mismatch");
  return claims;
}

/** The sign-in email from the token: email, else Entra's preferred_username / upn. */
export function emailFromClaims(claims: Record<string, any>): string | null {
  for (const k of ["email", "preferred_username", "upn"]) {
    const v = String(claims[k] || "").trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return v;
  }
  return null;
}

// ── Handoff from the callback redirect to the sign-in page ───────────────
export function newHandoff(sqlite: any, userId: number, configId: number): string {
  const code = b64url(crypto.randomBytes(32));
  const now = Date.now();
  // delete-reinsert-ok: expiry cleanup of other rows; the INSERT adds a new handoff
  sqlite.prepare("DELETE FROM sso_handoffs WHERE expires_at < ?").run(new Date(now - HANDOFF_TTL_MS).toISOString());
  sqlite.prepare("INSERT INTO sso_handoffs (code_hash, user_id, config_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(sha(code), userId, configId, new Date(now).toISOString(), new Date(now + HANDOFF_TTL_MS).toISOString());
  return code;
}
export function takeHandoff(sqlite: any, code: string): { user_id: number; config_id: number } | null {
  if (!code) return null;
  const row = sqlite.prepare("SELECT * FROM sso_handoffs WHERE code_hash = ?").get(sha(code)) as any;
  if (!row || row.used_at) return null;
  const spent = sqlite.prepare("UPDATE sso_handoffs SET used_at = ? WHERE code_hash = ? AND used_at IS NULL").run(new Date().toISOString(), sha(code));
  if (Number(spent?.changes || 0) !== 1) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

// ── Admin: save a configuration ──────────────────────────────────────────
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9-]+\.)+[a-z]{2,}$/;
export function normalizeDomains(input: unknown): string[] {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\s,;]+/);
  const out = Array.from(new Set(list.map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter(Boolean)));
  for (const d of out) if (!DOMAIN_RE.test(d)) throw new Error(`"${d}" is not a valid email domain`);
  return out;
}
export const sealClientSecret = (s: string | null | undefined) => (s ? sealSecret(String(s)) : null);
