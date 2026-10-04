# SSO / Active Directory Login — Design

Status: PROPOSED (scoping). Parking-lot item #39 (MediaLab parity), SSO/AD sub-item.
Author: scoped 2026-10-04. Owner: Michael Veri.

## 1. Problem and motivation

Enterprise laboratory IT departments (Lifepoint, Sanford class) require federated
single sign-on against their corporate directory. Today VeritaAssure has
email + password only (`passport-local`, bcrypt, JWT). "AD login" in practice
almost always means **SAML 2.0** federation: ADFS, Microsoft Entra ID (Azure AD),
Okta, and Ping all speak SAML, and it is the lowest common denominator IT will
accept. Lack of SSO is the number one hard blocker in enterprise IT review.

SSO is already the System-tier pricing trigger (CLAUDE.md section 10:
"System tier triggered by ... SSO/BAA/SLA requirements"), so it is gated to
System-tier organizations and does not need its own Stripe SKU.

## 2. Goals and non-goals

### Phase 1 goals (this design)
- SP-initiated **SAML 2.0** SSO at the **organization** level (one enterprise =
  one IdP covering all its labs).
- Org admin can configure their IdP (metadata) and enable SSO.
- A user who authenticates at the IdP lands in the app with the same JWT session
  the app already issues, so nothing downstream changes.
- Just-in-time (JIT) linking/creation of users, with a seat-safe default.

### Non-goals (Phase 2+, deal-triggered)
- OIDC / OAuth2 (Entra ID or Google Workspace via `openid-client`).
- IdP group -> role mapping (map AD groups to owner/admin/MD/staff).
- SCIM 2.0 automated provisioning/deprovisioning.
- IdP-initiated login.
- Enforce-SSO (disable password login for SSO-managed users).

## 3. Current auth model (integration points)

- JWT: `signToken(userId)` -> `jwt.sign({ userId }, JWT_SECRET, { expiresIn: "30d" })`
  (server/routes.ts ~713). `authMiddleware` verifies it and resolves seat/role.
- Endpoints: `POST /api/auth/register` (~6014), `POST /api/auth/login` (~6332),
  `GET /api/auth/me` (~6461).
- Client stores `veritas_token` + `veritas_user` in localStorage.
- Org model: `organizations` (db.ts ~2282) and `organization_members` (~2297)
  already exist; labs belong to an organization.
- Seat model: owner/admin are `lab_members`; seats are `user_seats`
  (seat_type active | view_only | staff_portal).

**Key leverage:** after a SAML assertion is validated, we resolve/create a
`users.id` and call `signToken(userId)`. Every existing route, gate, and the
client are unchanged. SSO is purely an alternative front door.

## 4. Architecture — Phase 1 (SAML 2.0, SP-initiated, per-org)

### 4.1 Library
Use **`@node-saml/node-saml`** (the maintained successor to passport-saml) for
AuthnRequest generation and assertion validation: XML signature verification,
audience/recipient checks, `NotBefore`/`NotOnOrAfter` clock-skew, and replay
(InResponseTo) tracking. **Do not hand-roll SAML XML or crypto** — SAML has a
long history of signature-wrapping and canonicalization attacks that vetted
libraries guard against. Add it to package.json; no other new runtime dep.

### 4.2 Data model

```
CREATE TABLE org_sso_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  protocol TEXT NOT NULL DEFAULT 'saml',        -- 'saml' (Phase 2: 'oidc')
  idp_entity_id TEXT,                           -- IdP EntityID / issuer
  idp_sso_url TEXT,                             -- IdP SSO (redirect/POST) URL
  idp_x509_cert TEXT,                           -- IdP signing cert (PEM)
  sp_entity_id TEXT,                            -- our SP EntityID (generated)
  allowed_email_domains TEXT,                   -- CSV allowlist for JIT
  jit_provisioning INTEGER NOT NULL DEFAULT 1,  -- auto-create on first login
  default_seat_type TEXT NOT NULL DEFAULT 'staff_portal', -- seat for JIT users
  updated_by INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id)
);

CREATE TABLE user_sso_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  idp_subject TEXT NOT NULL,                    -- SAML NameID (persistent)
  email TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(organization_id, idp_subject)
);
```

An org is addressed by a stable **slug** (new `organizations.sso_slug`, or reuse
an existing slug) so IdP URLs are human-stable, e.g. `/api/sso/lifepoint/acs`.

### 4.3 Endpoints (all under the org slug)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sso/:slug/metadata` | SP metadata XML to hand the customer's IdP admin (ACS URL, SP EntityID, SP signing cert). |
| GET | `/api/sso/:slug/login` | SP-initiated: build a signed AuthnRequest, 302 to the IdP SSO URL. |
| POST | `/api/sso/:slug/acs` | Assertion Consumer Service: validate the SAML Response, resolve/JIT the user, `signToken`, 302 into the app with the token. |

Org-admin config CRUD (System-tier gated, owner/admin):

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orgs/:orgId/sso-config` | Read config + SP metadata URL + status. |
| PUT | `/api/orgs/:orgId/sso-config` | Set IdP metadata, domains, JIT policy, enable/disable. |

### 4.4 Flow (SP-initiated)

1. Login page: "Sign in with your organization". User enters org slug or picks
   it from their email domain -> browser hits `GET /api/sso/:slug/login`.
2. Server builds a signed AuthnRequest and 302s to the org's IdP.
3. User authenticates at the IdP (AD creds, MFA, etc.).
4. IdP POSTs a signed SAML Response to `POST /api/sso/:slug/acs`.
5. Server validates signature/audience/timing/replay via node-saml, extracts the
   NameID (subject) + email attribute.
6. **Resolve user:** `user_sso_identities` by (org, subject) -> existing user.
   Else match an existing `users.email` (case-insensitive) in the org's allowed
   domains -> link. Else, if `jit_provisioning` and the domain is allowed ->
   create the user + add as an `organization_members` row and a `user_seats`
   row of `default_seat_type` on the org's primary/first lab. Record the
   `user_sso_identities` row.
7. `signToken(userId)` -> 302 to `/sso/callback#token=...` where a tiny client
   route stores `veritas_token` + fetches `/api/auth/me` for `veritas_user`
   (mirrors the existing login client path).

### 4.5 JIT provisioning and seats (the billing-sensitive part)

Auto-provisioning can balloon seat counts. Phase 1 default: JIT users get a
**staff_portal** seat (read-and-sign), not a writer seat. An owner/admin
promotes them to an active (writer) seat or admin role manually. `default_seat_type`
is configurable per org but defaults to the safe value. The allowed-domain
allowlist prevents a stray IdP from minting accounts.

### 4.6 Security requirements
- Assertion signature MUST validate against `idp_x509_cert`; reject unsigned or
  signature-wrapped responses (node-saml enforces, but add tests).
- Enforce audience (SP EntityID), recipient (ACS URL), and `NotBefore`/
  `NotOnOrAfter` with a small clock skew (120s).
- Replay protection: track consumed `InResponseTo` / assertion IDs.
- Our SP signing key lives in Railway env (new `SAML_SP_PRIVATE_KEY`,
  `SAML_SP_CERT`), never committed (CLAUDE.md section 12).
- The ACS endpoint is unauthenticated by design but rate-limited and org-scoped.
- A dedicated security pass before enabling for a real customer.

## 5. Phase 2 (deal-triggered)
- **OIDC** via `openid-client` for Entra ID / Google Workspace (modern, simpler
  than SAML; some IT prefer it). Same `signToken` landing.
- **Group -> role mapping**: map IdP group claims to owner/admin/MD/staff.
- **SCIM 2.0**: automated provisioning + **deprovisioning** (offboarding). Without
  SCIM, a terminated AD user's login stops but their VeritaAssure account lingers.
- **IdP-initiated** login and **enforce-SSO** (disable passwords for managed users).

## 6. Effort
**L.** Phase 1 SAML MVP ~= 2 weeks: data model + migrations, node-saml wiring,
3 SSO endpoints + 2 config endpoints, org-admin config UI, login-page SSO entry +
`/sso/callback` client route, JIT + seat policy, security hardening, and testing
against a real IdP. Each Phase 2 item is an additional M.

## 7. Open decisions (needed before build)
1. **Target IdP(s)** to build and test against. This drives the test harness
   (Okta dev tenant, Entra ID free, ADFS, or SimpleSAMLphp mock). Knowing the
   first enterprise customer's IdP (e.g., Lifepoint, Sanford) de-risks everything.
2. **JIT default seat**: confirm staff_portal (recommended) vs active-writer for
   auto-created SSO users, given the seat/billing model.
3. **SCIM in v1?** Default recommendation: defer to Phase 2 unless the first
   enterprise requires automated offboarding at contract signing.
4. **Protocol in v1**: SAML only (recommended) vs SAML + OIDC.

## 8. Recommendation
Build **Phase 1 SAML 2.0, SP-initiated, org-level, JIT -> staff_portal, System-tier
gated**. It unblocks the enterprise IT requirement with the broadest IdP
compatibility and zero change to the rest of the app (it only mints the existing
JWT). Defer OIDC, SCIM, and group-role mapping until a specific enterprise deal
names its IdP and offboarding requirements, because those details change the
design. Do not start the build blind: pick a target IdP and settle the JIT/seat
policy first.
