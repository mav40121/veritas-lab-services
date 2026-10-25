// server/ssoRoutes.ts
//
// HTTP surface for single sign-on (server/sso.ts; Michael 2026-10-15, Q39 = 1):
//   POST /api/auth/sso/lookup    {email} -> does this email's domain sign in with SSO, and is it required
//   GET  /api/auth/sso/start     ?email= -> redirect to the organization's sign-in (state, nonce, PKCE)
//   GET  /api/auth/sso/callback  provider returns here -> checks everything -> /login?sso=<handoff>
//   POST /api/auth/sso/complete  {code} -> the usual sign-in response (session-bound token)
//   GET/POST /api/admin/sso/configs (ADMIN_SECRET) -> Veritas sets SSO up with the customer's IT
// Sign-in failures land on /login?sso_error=<reason>; the page explains them in plain words.
import { ssoConfigForEmail, ssoConfigById, discover, newSignIn, saveSignInState, takeSignInState, authorizeUrl,
  exchangeCode, verifyIdToken, emailFromClaims, newHandoff, takeHandoff, parseDomains, domainOf, entraIssuer,
  normalizeDomains, sealClientSecret, SsoTokenError } from "./sso";
import { effectivePolicy, isInactive } from "./securityPolicy";

type SignInBuilder = (req: any, user: any, mfaMethod: string | null) => any;

export function registerSsoRoutes(app: any, deps: {
  sqlite: any;
  storage: any;
  logAudit: (e: any) => any;
  buildSignIn: SignInBuilder;
  adminSecret: string;
}) {
  const { sqlite, storage, logAudit, buildSignIn, adminSecret } = deps;

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
    const st = takeSignInState(sqlite, String(req.query?.state || ""));
    if (!st) return fail(res, "expired", "state unknown, used or expired");
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

  app.post("/api/auth/sso/complete", (req: any, res: any) => {
    const h = takeHandoff(sqlite, String(req.body?.code || ""));
    if (!h) return res.status(401).json({ error: "This sign-in link expired. Sign in again.", code: "SSO_HANDOFF_EXPIRED" });
    const user = storage.getUserById(Number(h.user_id));
    if (!user) return res.status(401).json({ error: "Account not found." });
    // The organization's sign-in already did the second factor: no VeritaAssure code step.
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
