// server/ssoRoutes.ts
//
// HTTP surface for single sign-on (server/sso.ts; Michael 2026-10-15, Q39 = 1):
//   POST /api/auth/sso/lookup    {email} -> does this email's domain sign in with SSO, and is it required
//   GET  /api/auth/sso/start     ?email= -> redirect to the organization's sign-in (state, nonce, PKCE)
//   GET  /api/auth/sso/callback  provider returns here -> checks everything -> /login?sso=<handoff>
//   POST /api/auth/sso/complete  {code} -> the usual sign-in response (session-bound token)
//   GET/POST /api/admin/sso/configs (ADMIN_SECRET) -> Veritas sets SSO up with the customer's IT
// Sign-in failures land on /login?sso_error=<reason>; the page explains them in plain words.
//
// Signing with the hospital's sign-in (S0, 2026-11-27; server/eSignature.ts), for a signed-in person:
//   GET  /api/auth/signature/method        what they sign with: their password, their hospital's sign-in, or either
//   POST /api/auth/signature/sso/start     {purpose, waiter} -> {url}: their hospital's sign-in, a fresh login forced, opened in a
//                                          window; the provider returns to the same /api/auth/sso/callback (no new redirect URI)
//                                          and the callback ends on /sso/sign-done?h=<one-time 60-second code>&w=<waiter>
//   POST /api/auth/signature/sso/complete  {code} -> {proof}: the signer's own session trades the code for the single-use proof
//                                          verifySigner takes in place of a password, bound to them and the purpose, for 120 seconds
// The callback's signing branch checks the token as a sign-in does, then that it is the signer's own address and that auth_time
// is within a few minutes and after they asked. It never signs anyone in. Refusals land on /sso/sign-done?error=<reason>.
import { clearEmailVerification } from "./emailVerification";
import { ssoConfigForEmail, ssoConfigById, discover, newSignIn, saveSignInState, takeSignInState, authorizeUrl,
  exchangeCode, verifyIdToken, emailFromClaims, newHandoff, takeHandoff, parseDomains, domainOf, entraIssuer,
  normalizeDomains, sealClientSecret, SsoTokenError, peekSignRequestId, CLOCK_SKEW_S } from "./sso";
import { effectivePolicy, isInactive } from "./securityPolicy";
import { createSignRequest, issueSignHandoff, signatureMethodFor, signRequestById, takeSignHandoff, SIGN_FRESH_LOGIN_S, WAITER_RE } from "./eSignature";
import { isSignaturePurpose, SIGN_PROOF_SECONDS } from "../shared/eSignature";

type SignInBuilder = (req: any, user: any, mfaMethod: string | null) => any;

export function registerSsoRoutes(app: any, deps: {
  sqlite: any;
  storage: any;
  logAudit: (e: any) => any;
  buildSignIn: SignInBuilder;
  adminSecret: string;
  authMiddleware: any;
}) {
  const { sqlite, storage, logAudit, buildSignIn, adminSecret, authMiddleware } = deps;

  /**
   * Our callback URL, exactly as registered with the provider: the site the person started on
   * (production: https://www.veritaslabservices.com), or SSO_REDIRECT_BASE when set. A forged Host
   * cannot redirect a sign-in elsewhere: the provider only returns to its registered redirect URIs.
   */
  const callbackUrl = (req: any) => {
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0].trim();
    const base = (process.env.SSO_REDIRECT_BASE || `${proto}://${req.get("host")}`).replace(/\/+$/, "");
    return `${base}/api/auth/sso/callback`;
  };
  const fail = (res: any, reason: string, detail?: string) => {
    if (detail) console.warn(`[sso] sign-in refused: ${reason}: ${detail}`);
    return res.redirect(302, `/login?sso_error=${encodeURIComponent(reason)}`);
  };
  // The signing window's last page: the one-time code, or why not, and which screen asked (waiter, not a secret).
  const signWindow = (res: any, waiter: string | null | undefined, q: Record<string, string>) => {
    const p = new URLSearchParams(q);
    if (waiter && WAITER_RE.test(waiter)) p.set("w", waiter);
    return res.redirect(302, `/sso/sign-done?${p.toString()}`);
  };
  const signFail = (res: any, waiter: string | null | undefined, reason: string, detail?: string) => {
    if (detail) console.warn(`[sso] signature sign-in refused: ${reason}: ${detail}`);
    return signWindow(res, waiter, { error: reason });
  };

  app.post("/api/auth/sso/lookup", (req: any, res: any) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const cfg = email ? ssoConfigForEmail(sqlite, email) : null;
    // Domain-level only: says nothing about whether an account exists.
    res.json(cfg ? { sso: true, required: Number(cfg.required) === 1, name: cfg.name, start: `/api/auth/sso/start?email=${encodeURIComponent(email)}` } : { sso: false });
  });

  app.get("/api/auth/sso/start", async (req: any, res: any) => {
    const email = String(req.query?.email || "").trim().toLowerCase();
    const cfg = email ? ssoConfigForEmail(sqlite, email) : null;
    if (!cfg) return fail(res, "not_configured");
    try {
      const doc = await discover(cfg.issuer);
      const s = newSignIn();
      const redirectUri = callbackUrl(req);
      saveSignInState(sqlite, cfg, s, redirectUri, email);
      res.redirect(302, authorizeUrl(doc, cfg, s, redirectUri, email));
    } catch (e: any) {
      return fail(res, "provider_unavailable", e?.message);
    }
  });

  app.get("/api/auth/sso/callback", async (req: any, res: any) => {
    const stateParam = String(req.query?.state || "");
    const st = takeSignInState(sqlite, stateParam);
    if (!st) {
      // A signing window that comes back late or twice goes back to the signing window, never to the sign-in page.
      const signId = peekSignRequestId(sqlite, stateParam);
      if (signId) return signFail(res, signRequestById(sqlite, signId)?.waiter, "expired", "state unknown, used or expired");
      return fail(res, "expired", "state unknown, used or expired");
    }
    if (st.sign_request_id) return finishSignatureSignIn(req, res, st);
    if (req.query?.error) return fail(res, "provider_refused", `${req.query.error}: ${String(req.query.error_description || "").slice(0, 200)}`);
    const cfg = ssoConfigById(sqlite, Number(st.config_id));
    if (!cfg || Number(cfg.enabled) !== 1) return fail(res, "not_configured");
    let claims: Record<string, any>;
    try {
      const doc = await discover(cfg.issuer);
      const idToken = await exchangeCode(doc, cfg, String(req.query?.code || ""), st.code_verifier, st.redirect_uri);
      claims = await verifyIdToken(idToken, doc, cfg.client_id, st.nonce);
    } catch (e: any) {
      return fail(res, e instanceof SsoTokenError ? "token_rejected" : "provider_unavailable", e?.message);
    }
    const email = emailFromClaims(claims);
    if (!email) return fail(res, "no_email", "token carries no email");
    if (!parseDomains(cfg).includes(domainOf(email))) return fail(res, "domain_not_allowed", email);
    const user = storage.getUserByEmail(email);
    if (!user) return fail(res, "no_account", email);
    const u = sqlite.prepare("SELECT COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(user.id) as any;
    if (Number(u?.vls) === 1) return fail(res, "support_account", email);
    // System security settings: an account turned off for inactivity stays off until an owner turns it back on.
    if (isInactive(sqlite, user.id, effectivePolicy(sqlite, user.id))) return fail(res, "account_inactive", email);
    logAudit({ userId: user.id, module: "account", action: "create", entityType: "session", entityLabel: `${email} (single sign-on: ${cfg.name})`, ipAddress: req.ip });
    res.redirect(302, `/login?sso=${encodeURIComponent(newHandoff(sqlite, user.id, cfg.id))}`);
  });

  // The signing branch of the callback: the same token checks, then the signer's own address and a fresh login. Signs nobody in.
  async function finishSignatureSignIn(req: any, res: any, st: { config_id: number; nonce: string; code_verifier: string; redirect_uri: string; sign_request_id: number | null }) {
    const request = signRequestById(sqlite, Number(st.sign_request_id));
    const waiter = request?.waiter ?? null;
    if (!request || request.handoff_hash) return signFail(res, waiter, "expired", "signature request unknown or already answered");
    if (req.query?.error) return signFail(res, waiter, "provider_refused", `${req.query.error}: ${String(req.query.error_description || "").slice(0, 200)}`);
    const cfg = ssoConfigById(sqlite, Number(st.config_id));
    if (!cfg || Number(cfg.enabled) !== 1 || Number(cfg.id) !== Number(request.config_id)) return signFail(res, waiter, "not_configured");
    let claims: Record<string, any>;
    try {
      const doc = await discover(cfg.issuer);
      const idToken = await exchangeCode(doc, cfg, String(req.query?.code || ""), st.code_verifier, st.redirect_uri);
      claims = await verifyIdToken(idToken, doc, cfg.client_id, st.nonce);
    } catch (e: any) {
      return signFail(res, waiter, e instanceof SsoTokenError ? "token_rejected" : "provider_unavailable", e?.message);
    }
    const user = sqlite.prepare("SELECT id, email, COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(request.user_id) as any;
    if (!user) return signFail(res, waiter, "no_account", `user ${request.user_id}`);
    if (Number(user.vls) === 1) return signFail(res, waiter, "support_account", `user ${user.id}`);
    const email = emailFromClaims(claims);
    if (!email || email !== String(user.email || "").trim().toLowerCase()) return signFail(res, waiter, "wrong_person", `the token is not user ${user.id}'s`);
    if (!parseDomains(cfg).includes(domainOf(email))) return signFail(res, waiter, "domain_not_allowed", `user ${user.id}`);
    // A fresh login: auth_time (the provider must send it for max_age) within a few minutes, and not before the person asked.
    const now = Math.floor(Date.now() / 1000);
    const at = Number(claims.auth_time);
    const askedAt = Math.floor(Date.parse(request.created_at) / 1000);
    const earliest = Math.max(now - SIGN_FRESH_LOGIN_S, askedAt) - CLOCK_SKEW_S;
    if (!Number.isFinite(at) || at < earliest || at > now + CLOCK_SKEW_S) {
      return signFail(res, waiter, "not_fresh", Number.isFinite(at) ? `auth_time ${now - at}s ago` : "the token has no auth_time");
    }
    if (isInactive(sqlite, user.id, effectivePolicy(sqlite, user.id))) return signFail(res, waiter, "account_inactive", `user ${user.id}`);
    const code = issueSignHandoff(sqlite, request.id, { providerName: cfg.name, authTime: new Date(at * 1000).toISOString() });
    logAudit({ userId: user.id, module: "account", action: "create", entityType: "signature_sso", entityLabel: `Hospital sign-in confirmed for a signature (${cfg.name}, ${request.purpose})`, ipAddress: req.ip });
    return signWindow(res, waiter, { h: code });
  }

  // ── Signing with the hospital's sign-in (server/eSignature.ts) ──────
  app.get("/api/auth/signature/method", authMiddleware, (req: any, res: any) => {
    res.json(signatureMethodFor(sqlite, req.userId));
  });

  app.post("/api/auth/signature/sso/start", authMiddleware, async (req: any, res: any) => {
    const purpose = req.body?.purpose;
    if (!isSignaturePurpose(purpose)) return res.status(400).json({ error: "Say what is being signed.", code: "BAD_PURPOSE" });
    const waiter = String(req.body?.waiter || "");
    if (!WAITER_RE.test(waiter)) return res.status(400).json({ error: "The signing screen needs its own id.", code: "BAD_WAITER" });
    const u = sqlite.prepare("SELECT id, email, COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(req.userId) as any;
    if (!u) return res.status(401).json({ error: "Account not found." });
    if (Number(u.vls) === 1) return res.status(403).json({ error: "A Veritas support login can't sign for a lab.", code: "SUPPORT_CANNOT_SIGN" });
    const cfg = ssoConfigForEmail(sqlite, u.email);
    if (!cfg) return res.status(409).json({ error: "Your account doesn't sign in through your organization. Sign with your password.", code: "SSO_NOT_CONFIGURED" });
    let doc: any;
    try { doc = await discover(cfg.issuer); }
    catch (e: any) {
      console.warn(`[sso] signature start: provider unavailable: ${e?.message}`);
      return res.status(502).json({ error: "Your organization's sign-in isn't answering. Try again in a minute.", code: "PROVIDER_UNAVAILABLE" });
    }
    const s = newSignIn();
    const redirectUri = callbackUrl(req);
    const requestId = createSignRequest(sqlite, { userId: u.id, purpose, configId: cfg.id, waiter });
    saveSignInState(sqlite, cfg, s, redirectUri, u.email, requestId);
    res.json({ url: authorizeUrl(doc, cfg, s, redirectUri, u.email, { freshLogin: true }), provider: cfg.name });
  });

  app.post("/api/auth/signature/sso/complete", authMiddleware, (req: any, res: any) => {
    const out = takeSignHandoff(sqlite, String(req.body?.code || ""), req.userId);
    if (!out) return res.status(401).json({ error: "That hospital sign-in expired. Sign in with your hospital again.", code: "SIGN_HANDOFF_EXPIRED" });
    res.json({ proof: out.proof, purpose: out.purpose, provider: out.provider, expiresInSeconds: SIGN_PROOF_SECONDS });
  });

  app.post("/api/auth/sso/complete", (req: any, res: any) => {
    const h = takeHandoff(sqlite, String(req.body?.code || ""));
    if (!h) return res.status(401).json({ error: "This sign-in link expired. Sign in again.", code: "SSO_HANDOFF_EXPIRED" });
    const user = storage.getUserById(Number(h.user_id));
    if (!user) return res.status(401).json({ error: "Account not found." });
    // The organization's sign-in proved the address, and already did the second factor: no VeritaAssure code step.
    clearEmailVerification(sqlite, user.id);
    res.json(buildSignIn(req, user, "sso"));
  });

  // ── Veritas admin: set SSO up with the customer's IT ──────────────────
  const adminOk = (req: any) => (req.headers["x-admin-secret"] || req.body?.secret || req.query?.secret) === adminSecret;
  const shape = (c: any) => ({
    id: c.id, organizationId: c.organization_id, name: c.name, issuer: c.issuer, clientId: c.client_id,
    hasClientSecret: !!c.client_secret_enc, emailDomains: parseDomains(c), required: Number(c.required) === 1,
    enabled: Number(c.enabled) === 1, createdAt: c.created_at, updatedAt: c.updated_at,
  });

  app.get("/api/admin/sso/configs", (req: any, res: any) => {
    if (!adminOk(req)) return res.status(403).json({ error: "Forbidden" });
    res.json({ configs: (sqlite.prepare("SELECT * FROM sso_configs ORDER BY id").all() as any[]).map(shape) });
  });

  // Body: {secret, id?, organizationId?, name, tenantId? | issuer?, clientId, clientSecret?, emailDomains[], required?, enabled?, dryRun?}
  app.post("/api/admin/sso/configs", async (req: any, res: any) => {
    if (!adminOk(req)) return res.status(403).json({ error: "Forbidden" });
    const b = req.body || {};
    const existing = b.id ? ssoConfigById(sqlite, Number(b.id)) : null;
    if (b.id && !existing) return res.status(404).json({ error: "SSO configuration not found" });
    const name = String(b.name ?? existing?.name ?? "").trim();
    const clientId = String(b.clientId ?? existing?.client_id ?? "").trim();
    const issuer = String(b.issuer || (b.tenantId ? entraIssuer(String(b.tenantId).trim()) : existing?.issuer || "")).trim().replace(/\/+$/, "");
    if (!name || !clientId || !issuer) return res.status(400).json({ error: "name, clientId and tenantId (or issuer) are required" });
    if (!/^https:\/\//.test(issuer) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(issuer)) return res.status(400).json({ error: "issuer must be https" });
    let domains: string[];
    try { domains = b.emailDomains !== undefined ? normalizeDomains(b.emailDomains) : (existing ? parseDomains(existing) : []); }
    catch (e: any) { return res.status(400).json({ error: e.message }); }
    if (!domains.length) return res.status(400).json({ error: "at least one email domain is required" });
    const others = (sqlite.prepare("SELECT * FROM sso_configs WHERE enabled = 1 AND id <> ?").all(existing?.id ?? 0) as any[]);
    const clash = domains.find((d) => others.some((o) => parseDomains(o).includes(d)));
    if (clash) return res.status(409).json({ error: `${clash} already signs in through another SSO configuration` });
    let discovered: any;
    try { discovered = await discover(issuer); }
    catch (e: any) { return res.status(400).json({ error: `Could not read the provider's configuration: ${e.message}` }); }
    const plan = { id: existing?.id ?? null, name, issuer, discoveredIssuer: discovered.issuer, clientId, emailDomains: domains,
      required: b.required !== undefined ? !!b.required : Number(existing?.required ?? 0) === 1,
      enabled: b.enabled !== undefined ? !!b.enabled : Number(existing?.enabled ?? 1) === 1,
      organizationId: b.organizationId !== undefined ? (b.organizationId === null ? null : Number(b.organizationId)) : existing?.organization_id ?? null,
      clientSecret: b.clientSecret === undefined ? (existing?.client_secret_enc ? "kept" : "none") : b.clientSecret ? "set" : "cleared" };
    if (b.dryRun) return res.json({ dryRun: true, plan });
    const now = new Date().toISOString();
    const secretEnc = b.clientSecret === undefined ? existing?.client_secret_enc ?? null : sealClientSecret(b.clientSecret);
    if (existing) {
      sqlite.prepare("UPDATE sso_configs SET organization_id = ?, name = ?, issuer = ?, client_id = ?, client_secret_enc = ?, email_domains = ?, required = ?, enabled = ?, updated_at = ? WHERE id = ?")
        .run(plan.organizationId, name, issuer, clientId, secretEnc, JSON.stringify(domains), plan.required ? 1 : 0, plan.enabled ? 1 : 0, now, existing.id);
    } else {
      const r = sqlite.prepare("INSERT INTO sso_configs (organization_id, name, issuer, client_id, client_secret_enc, email_domains, required, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(plan.organizationId, name, issuer, clientId, secretEnc, JSON.stringify(domains), plan.required ? 1 : 0, plan.enabled ? 1 : 0, now, now);
      plan.id = Number(r.lastInsertRowid);
    }
    logAudit({ userId: 0, module: "admin", action: existing ? "update" : "create", entityType: "sso_config", entityId: plan.id, entityLabel: `SSO ${name}: ${domains.join(", ")} (${plan.required ? "required" : "optional"}${plan.enabled ? "" : ", off"})` });
    res.json({ ok: true, config: shape(ssoConfigById(sqlite, Number(plan.id))) });
  });
}
