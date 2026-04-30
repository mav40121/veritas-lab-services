# VeritaAssure, Session Handoff Summary

**Generated:** April 30, 2026 at 11:36 AM MST
**Latest commit on main:** `240e6aa`
**Purpose:** Paste this as the first message in a new Perplexity Computer conversation to resume work seamlessly.

---

## CRITICAL: Read This First

Before doing ANY build work, read the standing requirements file in full from the live repo:

```
veritas-lab-services / STANDING_REQUIREMENTS.md  (branch: main)
```

This file is the canonical source of all copy rules, PDF requirements, regulatory language standards, Excel standards, pricing, credentials, and infrastructure. It must be loaded at the start of every coding task. No exceptions.

If a `veritaassure-bootstrap` skill is available in your skill library, the phrase "run VeritaAssure bootstrap" triggers the full preflight sequence and you can skip this file.

---

## 1. User Identity

- **Name:** Michael Veri
- **Byline (verbatim):** `Michael Veri, MLS(ASCP) - VeritaAssure™` (hyphen, not em dash, not comma)
- **Email:** verilabguy@gmail.com / info@veritaslabservices.com
- **Timezone:** America/Phoenix (MST, no daylight saving)
- **Company:** Veritas Lab Services, LLC, 119 Glen Ave, Upton, MA 01568 (filed 1/2/2026, sole employee)

### Identity rules (do not violate)

- DO NOT add "TJC Surveyor" to the byline. Michael served 2021 to 2025; he is not currently a surveyor.
- DO NOT use "MT(ASCP)". He is MLS(ASCP).
- DO NOT add "MS, MBA, CPHQ" or any other credentials beyond MLS(ASCP) in the byline.
- The byline uses a hyphen between "MLS(ASCP)" and "VeritaAssure™", not a comma and not an em dash.

### Non-negotiable copy rules

- NO em dashes (`—`) anywhere. Use commas, colons, or hyphens.
- All product names use ™, never ®.
- NO "EP Evaluator" by name in product or marketing copy. Private chat with Michael is fine.
- NO "CAMLAB". Use "TJC standard".
- NO "LabVine Learning".
- NO "method validation" describing what labs do. Labs verify; manufacturers validate. Use "method verification" or "performance verification" for laboratory work.
- Governing law in legal text: Massachusetts.
- "medical director or designee" everywhere a director sign-off is referenced.
- ExcelJS only, never SheetJS.
- PDF signatures on PAGE 1 for VeritaCheck™, VeritaComp™, and CMS 209.

---

## 2. Product, the 11 modules

VeritaAssure™ is a SaaS compliance and operations platform for clinical laboratories.

**Compliance modules (8):**

1. VeritaCheck™, performance verification (calibration verification, method comparison, EP15 precision, linearity)
2. VeritaMap™, test menu regulatory mapping (CLIA complexity, TJC, CAP)
3. VeritaScan™, 168-item inspection readiness self-assessment
4. VeritaComp™, competency assessment (six CLIA elements, medical director or designee sign-off)
5. VeritaStaff™, personnel credentialing including CMS 209
6. VeritaLab™, CLIA certificate and accreditation tracking
7. VeritaPT™, proficiency testing tracker (reads VeritaMap™ menu, finds gaps against CLIA PT requirements)
8. VeritaPolicy™, TJC policy compliance

**Operations modules (3, live with public marketing pages):**

9. VeritaTrack™, QC task tracking and sign-off
10. VeritaStock™, reagent and inventory management
11. VeritaBench™, productivity and staffing analytics (workload by section, PI dashboards, staffing planning)

---

## 3. Current Pricing (from `server/stripe.ts` on main)

Source of truth is `server/stripe.ts`. As of latest commit:

**One-time and per-module:**

- Per Study: $25 one-time (`price_1TGXPo5dn6rqLgIxsnvNa2oi`)
- VeritaCheck™ Unlimited: $299 per year (`price_1TGXPn5dn6rqLgIxfyoLXVKo`)

**Full-suite annual tiers (with grandfathered prior amounts):**

- Clinic / Waived: $499 per year (`price_1TGXPl5dn6rqLgIx14yANdxj`)
- Community: $999 per year (`price_1TKiEg5dn6rqLgIxrBKvqbGb`), was $799 grandfathered
- Hospital: $1,999 per year (`price_1TKiEg5dn6rqLgIxXioYyC5u`), was $1,299 grandfathered
- Enterprise / Large Hospital: $2,999 per year (`price_1TKiEg5dn6rqLgIxZ9ktBavQ`), was $1,999 grandfathered

**Per-seat add-ons:**

- 2 to 5 seats: $199 per seat (`price_1TGXPn5dn6rqLgIxdrreE5X4`)
- 6 to 10 seats: $179 per seat (`price_1TGXPn5dn6rqLgIxEhLz7fmK`)
- 11 to 25 seats: $159 per seat (`price_1TGXPn5dn6rqLgIxtsRXHf80`)
- 26+ seats: $139 per seat (`price_1TGXPo5dn6rqLgIxo3Fj2Llr`)

Pricing is suite-based, not bed-count.

---

## 4. Routing (browser history, no hash)

The client uses `wouter` with browser history. URLs are clean paths, never `/#/route`.

Public routes include:

- `/` HomePage
- `/services`, `/team`, `/contact`, `/faq`, `/pricing`, `/resources`
- `/veritacheck`, `/veritascan`, `/veritamap` (marketing)
- `/veritascan-app`, `/veritamap-app`, `/veritamap-app/resources` (in-app)
- `/dashboard`, `/dashboard/verifications`
- `/study/new`, `/study/:id/results`
- `/login`, `/register`, `/join`, `/reset-password`
- `/terms`, `/privacy`, `/study-guide`, `/book`, `/request-invoice`
- `/demo` selector, `/demo/operations`, `/demo/compliance`
- `/resources/...` long-form articles, `/resources/clia-tea-lookup`

**Demo URLs are `/demo`, `/demo/operations`, `/demo/compliance`. Never `/#/demo`.**

The apex `veritaslabservices.com` 301s to `www.veritaslabservices.com`. The print-QC contact form requires the `www` host. Always use `www.veritaslabservices.com` in tests and links.

---

## 5. Infrastructure and credentials (NON-NEGOTIABLE handling)

### Where things live

- **Repo:** https://github.com/mav40121/veritas-lab-services (use `gh` CLI with `api_credentials=["github"]`)
- **Hosting:** Railway
  - Project ID: `29c628f1-7860-4fca-8fee-227159bb86e8`
  - Service ID: `170f5560-8cf0-4341-9c87-294062ebedd1` (`radiant-quietude`)
  - Environment ID: `cd669f7c-23f3-434c-895d-ca40ac504e91`
- **Email:** Resend (API key stored as `RESEND_API_KEY` in Railway env)
- **Live site:** https://www.veritaslabservices.com
- **Health endpoint:** `/api/health`

### Credential handling protocol (added in commit `240e6aa`)

This rule is in `STANDING_REQUIREMENTS.md` under "CREDENTIAL HANDLING (NON-NEGOTIABLE)". Summary:

1. **Operational secrets live in Railway env. Read them from Railway, do not ask the user to paste them.**
2. The agent uses Railway's GraphQL `variables(projectId, environmentId, serviceId)` query to fetch values like `ADMIN_SECRET`, `RESEND_API_KEY`, database URLs.
3. Example:
   ```bash
   curl -X POST https://backboard.railway.app/graphql/v2 \
     -H "Authorization: Bearer $RAILWAY_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"query":"query Vars($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}","variables":{"p":"29c628f1-7860-4fca-8fee-227159bb86e8","e":"cd669f7c-23f3-434c-895d-ca40ac504e91","s":"170f5560-8cf0-4341-9c87-294062ebedd1"}}'
   ```
4. Read the value into a shell variable, use it, then `shred -u` any temp file. Never write secrets to files in the workspace and never paste them into chat.
5. The Railway API token itself is the only thing the user provides directly when the prior token expires. Current working token is held by the user; do not echo it back to them or store it in repo files.
6. If a deploy or admin operation needs a secret, the agent fetches it from Railway. The user is asked for credentials only if Railway itself is unreachable, and even then the agent must say so explicitly and explain why.

---

## 6. Gates (mandatory)

**Gate 1, Recommendation lockout.**
Before writing or editing any code, the agent emits the mandatory response template:

```
TASK
ASSUMPTIONS
CLARIFYING QUESTION (or "none")
PLAN
SELF-CHECK
```

No code, no file edits, no commits before SELF-CHECK passes.

**Gate 2, Deploy confirmation.**
Before `git push origin main` and before Railway `serviceInstanceDeploy`, the agent calls `confirm_action` with the diff or commit summary. Always pass `latestCommit: true` on `serviceInstanceDeploy`. After the deploy is requested, poll `deployments(first: 1, input: {serviceId, environmentId})` until status is `SUCCESS`, then confirm `commitHash` matches `main`. Then hit `/api/health` and confirm 200 OK.

---

## 7. Backups

Run a fresh backup at session start if the most recent backup in `/home/user/workspace/backups/` is older than 24 hours.

- The backup endpoint requires `ADMIN_SECRET` (read from Railway env, see section 5).
- Save to `/home/user/workspace/backups/veritaassure_<UTC timestamp>.db`.
- Verify integrity with `sqlite3 <file> "PRAGMA integrity_check;"` and a quick row count on `users`, `studies`, `audit_log`.

Most recent verified backup as of this handoff:

- `backups/veritaassure_20260430_182449Z.db`, 9.6 MB, integrity OK, 23 users, 131 studies, 30 maps, 6 scans, 7 competency assessments, 4 certificates, 8 policies, 93 track tasks, 28 inventory items, 114 audit log entries.

---

## 8. Session preflight checklist

When you start a session, do these in order:

1. Read `STANDING_REQUIREMENTS.md` from the live repo (branch `main`).
2. Confirm access to GitHub, Railway, Resend (via `RESEND_API_KEY` from Railway env), and the live site `/api/health`.
3. Run a fresh backup if the latest one is older than 24 hours.
4. Read `SESSION_HANDOFF.md` (this file) and `SESSION_HANDOFF-2.md` for the current build queue and active TODOs.
5. Verify the latest commit on `main` matches what the user expects.
6. Only then ask the user what to work on, or pick up the next item from `SESSION_HANDOFF-2.md`.

If the user types "run VeritaAssure bootstrap" and the bootstrap skill is loaded, the skill drives steps 1 to 5 automatically.

---

## 9. Workspace layout

```
/home/user/workspace/
  veritas-repo/                  cloned main, user.email = verilabguy@gmail.com
    STANDING_REQUIREMENTS.md     canonical rules
    SESSION_HANDOFF.md           this file
    SESSION_HANDOFF-2.md         active build queue
    SESSION_START_CHECKLIST.md   short version of section 8
    server/stripe.ts             pricing source of truth
    client/src/App.tsx           router (no hash routes)
    client/src/pages/...         all marketing and app pages
  backups/                       *.db SQLite backups
  skills/veritaassure-bootstrap/ session bootstrap skill (manual upload to skill library)
  past_session_contexts/         memories/ and sessions/ for prior context
```

---

## 10. Useful one-liners

```bash
# Latest commit on main
cd /home/user/workspace/veritas-repo && git log --oneline -5

# Health check
curl -sS https://www.veritaslabservices.com/api/health

# Read a Railway env var (replace VAR_NAME)
curl -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"query Vars($p:String!,$e:String!,$s:String!){variables(projectId:$p,environmentId:$e,serviceId:$s)}","variables":{"p":"29c628f1-7860-4fca-8fee-227159bb86e8","e":"cd669f7c-23f3-434c-895d-ca40ac504e91","s":"170f5560-8cf0-4341-9c87-294062ebedd1"}}' \
  | jq -r '.data.variables.VAR_NAME'

# Deploy latest commit on main
curl -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation D($s:String!,$e:String!){serviceInstanceDeploy(serviceId:$s,environmentId:$e,latestCommit:true)}","variables":{"s":"170f5560-8cf0-4341-9c87-294062ebedd1","e":"cd669f7c-23f3-434c-895d-ca40ac504e91"}}'
```

---

End of SESSION_HANDOFF.md. Active TODOs and the build queue are in SESSION_HANDOFF-2.md.
