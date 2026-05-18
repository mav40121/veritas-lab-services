# Disaster Recovery Runbook

**Audience:** Michael, or a successor operator if Michael is unavailable.
**Purpose:** restore production, rotate credentials, or hand off operations after an outage, security incident, or operator change.

This is an internal document. Em-dashes and frank language permitted. Public-facing security posture lives at `/trust` and in the security roadmap PDF.

---

## 1. Critical assets inventory

Where everything lives. If you can't get into one of these, you can't recover. Keep recovery credentials for these in a password manager separate from email (`info@veritaslabservices.com`).

| Asset | Provider | URL / location | Owner of record | Notes |
|---|---|---|---|---|
| Source code | GitHub | https://github.com/mav40121/veritas-lab-services | `mav40121` | Single repo, `main` branch is production |
| Application hosting | Railway | https://railway.com/project/29c628f1-7860-4fca-8fee-227159bb86e8 | Michael's Railway account | Project ID `29c628f1-...`, service `radiant-quietude` (`170f5560-...`), env `cd669f7c-...` |
| Production database | Railway volume `/data/veritas.db` (SQLite via better-sqlite3) | Inside the Railway service | Railway | Single SQLite file on a persistent Railway volume |
| Off-site backups | Cloudflare R2 | bucket `veritaassure-backups` | `info@veritaslabservices.com` Cloudflare account | Endpoint `https://87089271de87158c44de10d2d0220cfa.r2.cloudflarestorage.com`; 730-day retention; nightly at 04:00 UTC |
| DNS | (whoever runs veritaslabservices.com DNS) | Apex `veritaslabservices.com` + `www` CNAME → Railway | TBD by Michael | A loss-of-DNS recovery requires registrar credentials |
| Stripe (payments) | Stripe | https://dashboard.stripe.com | Michael's Stripe account | Webhook secret in Railway env as `STRIPE_WEBHOOK_SECRET` |
| Resend (transactional email) | Resend | https://resend.com | Michael's Resend account | API key in Railway env as `RESEND_API_KEY` |
| Sentry (error tracking) | Sentry | https://veritas-lab-services.sentry.io | Michael's Sentry account | Two projects: `javascript-react` (client) and `node-express` (server) |
| Upstream compliance | Railway SOC 2 Type II + SOC 3; Stripe PCI DSS Level 1; Cloudflare SOC 2 Type II | trust.railway.com / stripe.com / cloudflare.com | n/a | Cite when answering customer security questionnaires |

---

## 2. Common recovery scenarios

### 2a. Application is down / not serving traffic

1. Check Railway dashboard for the most recent deployment status. If it's `FAILED` or `CRASHED`, click into the deployment, view logs, find the error.
2. If a recent merge to `main` triggered a bad deploy: roll back via `gh pr revert <PR_NUMBER>` or use Railway's "redeploy" with an older `commitSha`.
3. Always deploy with `latestCommit: true` and an explicit `commitSha` per CLAUDE.md §14. Never use `serviceInstanceRedeploy` (uses cached build).
4. Verify recovery: `curl -sI https://www.veritaslabservices.com/` should return 200.

### 2b. Database corruption or accidental data deletion

You have two recovery sources:

**Option A: Most recent on-demand snapshot** (fastest if event was minutes ago)
1. SSH into Railway service shell or use the admin endpoint: `GET /api/admin/backup-db?secret=$ADMIN_SECRET` to download a current snapshot of `/data/veritas.db`.
2. Note: this captures the CURRENT state, including the corruption. Only useful if you want a forensic copy.

**Option B: Restore from nightly off-site backup**
1. Sign into Cloudflare R2: https://dash.cloudflare.com → R2 → `veritaassure-backups` bucket.
2. Find the backup with the timestamp BEFORE the corruption (filename: `veritas-backup-2026-MM-DDTHH-MM-SS-XXXZ.db.gz`).
3. Download it.
4. Decompress locally: `gunzip veritas-backup-...db.gz` → produces `.db` file.
5. In Railway, stop the service (Variables tab → Deploy → pause).
6. Replace `/data/veritas.db` with the restored file via Railway shell, OR by uploading via SFTP if you've set up a sidecar service for that purpose.
7. Restart the service.
8. Verify: log in as a known user, confirm expected data is present.

**Recovery time estimate:** 15-30 minutes for Option B if you've done it before. First time will be longer; budget 1-2 hours.

### 2c. Hosting provider (Railway) outage

If Railway is hard-down (not transient):

1. Confirm via https://status.railway.com.
2. The backup is independent (Cloudflare R2). Latest backup is at most 24 hours old.
3. To migrate elsewhere quickly: stand up a new node service on Fly.io, Render, or AWS. The app is a single Express server + SQLite file. Requires:
   - Run `npm install && npm run build`
   - Copy the latest R2 backup to the new host's persistent volume as `/data/veritas.db`
   - Set the same env vars (see "Credential rotation" below for the full list)
   - Point DNS to the new host
4. **Realistic time estimate: 4-8 hours** for a full migration if you've never done it. Practice this drill once a year.

### 2d. Security incident / suspected credential compromise

If a credential is exposed (committed to a public repo, posted in chat, lost laptop):

1. **Rotate the affected credential immediately** (see Section 3).
2. Check Sentry for unusual error patterns that might indicate exploitation.
3. Check Railway logs (`gh` / Railway API) for unusual requests in the last 24-72 hours.
4. If customer data may have been accessed: prepare breach notification per state laws (MA 201 CMR 17.00 requires written notice; review with counsel).
5. Document the incident: what was exposed, when, what was rotated, what was investigated. Keep this for your own records and for the next SOC 2 audit.

---

## 3. Credential rotation procedures

Each entry: where the secret is used, how to rotate it, and what to redeploy.

### `JWT_SECRET`
- **Purpose:** signs user session tokens.
- **Rotation:** generate a new random string (`openssl rand -hex 64`). Update in Railway env. Railway redeploys. **All users get logged out and must log in again.** Notify users before rotating if it's not an emergency.

### `ADMIN_SECRET`
- **Purpose:** gates `/api/admin/*` endpoints (backup download, etc.).
- **Rotation:** new random string (`openssl rand -hex 32`). Update in Railway env. Redeploys silently. No user impact.

### `STRIPE_SECRET_KEY`
- **Purpose:** server-side Stripe API calls.
- **Rotation:** Stripe dashboard → Developers → API keys → roll the key. Update in Railway env. **Test a checkout immediately** after rotation to confirm.

### `STRIPE_WEBHOOK_SECRET`
- **Purpose:** verifies Stripe webhook signatures.
- **Rotation:** Stripe dashboard → Developers → Webhooks → roll the signing secret. Update in Railway env. **Subscription updates may fail during the rotation window** if Stripe and Railway are out of sync; do this during low-traffic hours.

### `RESEND_API_KEY`
- **Purpose:** sends transactional + alert emails.
- **Rotation:** Resend dashboard → API Keys → create new, delete old. Update in Railway env. Send a test email after rotation.

### Cloudflare R2 backup credentials (`BACKUP_S3_ACCESS_KEY_ID` + `BACKUP_S3_SECRET_ACCESS_KEY`)
- **Purpose:** writes nightly backups to R2 bucket.
- **Rotation:** Cloudflare dashboard → R2 → Manage R2 API Tokens → rotate. Update both env vars in Railway. Test by triggering a backup (next 04:00 UTC, or temporarily re-add `/api/admin/run-backup-now` debug route).

### GitHub PAT (for `gh` CLI access via this runbook)
- **Purpose:** repository operations (push, PR create, merge).
- **Rotation:** GitHub → Settings → Developer settings → Personal access tokens → revoke + regenerate. Update wherever it's stored (Windows credential manager, password manager).

### Sentry DSN (`SENTRY_DSN`, `VITE_SENTRY_DSN`)
- **Purpose:** sends client + server errors to Sentry.
- **Rotation:** Sentry → Project → Client Keys (DSN) → rotate. Update both env vars in Railway. The client DSN gets baked into the JS bundle at build time; client SDK won't reflect the new DSN until the next Railway deploy.

### Railway API token (project-scoped)
- **Purpose:** programmatic Railway API access (used in this runbook).
- **Rotation:** Railway dashboard → project → Settings → Tokens → revoke + create new. Update wherever it's stored.

---

## 4. Operator succession plan

If Michael is unavailable for an extended period (illness, emergency, transition):

1. **Successor must have access to:**
   - Michael's password manager (where Railway, Cloudflare, GitHub, Stripe, Resend, Sentry credentials live)
   - `info@veritaslabservices.com` email account
   - DNS registrar account for `veritaslabservices.com`
   - This runbook
   - The repo (already public on GitHub)

2. **Communicate to customers within 7 days** if continuity is uncertain. Acceptable forms: email to active accounts, a banner on the homepage, or a status page entry.

3. **Read before doing anything destructive:**
   - `CLAUDE.md` (root of repo) for the operating contract
   - `STANDING_REQUIREMENTS.md` for the long-form spec
   - `SESSION_START_CHECKLIST.md` for the daily-work checklist

4. **Do not** rotate credentials in a panic on day 1. Stabilize first; rotation can wait until you understand the system.

---

## 5. Recovery time targets

These are commitments only after Sprint 2 ships. Today they're aspirational.

| Event | Recovery time objective (RTO) | Recovery point objective (RPO) |
|---|---|---|
| Application crash | < 5 minutes (Railway auto-restart) | 0 (no data loss) |
| Bad deploy on main | < 30 minutes (revert + redeploy) | 0 |
| Database corruption | < 2 hours (R2 restore) | < 24 hours (nightly backup) |
| Railway provider outage | < 8 hours (migrate to alt host) | < 24 hours |
| Security incident | Variable (depends on scope) | Variable |

---

## 6. After any DR event

Document what happened. Format:

- **What broke:** (1-3 sentences)
- **When (UTC):** detection time, recovery time
- **Root cause:** (technical, not blame)
- **Customer impact:** how many labs, what couldn't they do
- **Fix shipped:** PR link
- **Prevention:** what we changed so this doesn't recur

Email summary to customers within 24 hours if customer-visible. Keep all summaries in `docs/incidents/` for the SOC 2 audit when we get there.
