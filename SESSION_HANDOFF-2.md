# VeritaAssure, Active Build Queue and TODO

**Generated:** April 30, 2026 at 11:36 AM MST
**Latest commit on main:** `240e6aa`
**Pairs with:** `SESSION_HANDOFF.md` (read that first for identity, rules, infrastructure)

---

## Reload requirement

Before following this file, the agent must:

1. Reload skills listed in section "Skills Loaded" using `load_skill`.
2. Read any helper files listed in section "Skill Helpers Loaded" using `read`.

If `veritaassure-bootstrap` is in the user's skill library, the phrase **"run VeritaAssure bootstrap"** runs the full session preflight and brings the agent up to speed without manual file reads.

---

## SHARED ASSETS (use same `name` to update across sessions)

- `veritaassure_bootstrap_skill`, the SKILL.md for `veritaassure-bootstrap`
- `clsi_cap_compliance_mapping`, mapping doc
- `seo_content_articles`, long-form resource articles
- `Veritas_BAA_Draft`, draft business associate agreement

Do NOT touch any asset whose name is prefixed `VeritaAssure_REDACTED_SEE_RAILWAY_ENV` unless the user explicitly asks. Those are stale references to operational secrets that now live in Railway env only.

---

## Recent commits (most recent first)

| Commit | Summary |
| --- | --- |
| `240e6aa` | Add CREDENTIAL HANDLING section to standing requirements; remove stale token values from Infrastructure |
| `9fd9f91` | Add trial+discount display to VeritaCheckPage pricing section, matching AccountSettingsPage pattern from commit `26c3a44` |

---

## Active TODOs

### Open, top of queue

1. **SCA Health four-analyte CLIA decision (loudest open item).**
   Carried over from prior sessions. Decision needed on whether the four-analyte panel falls under CLIA "no minimum" guidance or whether VeritaAssure should require an alternate handling path. Awaiting Michael's regulatory call. Do not ship a copy or workflow change until he decides.

2. **EP Evaluator licensing context.**
   Internal note from prior sessions. Do NOT publish "EP Evaluator" by name in any product or marketing copy. Existing wording uses "other evaluation tools" or names the underlying CLSI / EP15 statistic directly. Keep this rule active when reviewing PRs.

3. **COLA-related work.**
   Tracked from prior sessions. Specific deliverable still TBD; do not initiate without Michael confirming scope.

4. **Continuity setup, in progress this session.**
   - [x] Save custom skill `veritaassure-bootstrap` to workspace and validate. (User must manually upload to https://www.perplexity.ai/computer/skills until `save_custom_skill` is exposed in this environment.)
   - [x] Refresh `SESSION_HANDOFF.md` and `SESSION_HANDOFF-2.md` to current state.
   - [ ] Finalize paste-able bootstrap message at `/home/user/workspace/bootstrap_message.md` and pin to memory.
   - [ ] Confirm "run VeritaAssure bootstrap" phrase triggers the skill.

### Closed in this session

- Standing requirements updated with CREDENTIAL HANDLING section (commit `240e6aa`), pushed to `main`, deployed to Railway, verified live (`/api/health` 200 OK, deploy SUCCESS, `commitHash` matches `main`).
- Fresh backup taken at `backups/veritaassure_20260430_182449Z.db`. Integrity OK.
- Railway API token rotated; new working token held by user. Stale `94a28a21-...` token retired.
- `veritaassure-bootstrap` SKILL.md built, em-dash-clean, byline format verified (hyphen, not comma, not em dash). Validated with `agentskills validate`.

---

## Skills Loaded

- `create-skill`, used to build and validate `veritaassure-bootstrap` SKILL.md.

When `veritaassure-bootstrap` is uploaded to the user's skill library, it should be loaded at session start and triggers on:

- Veritas / VeritaAssure / veritaslabservices.com
- Any Verita-prefixed module name
- COLA / SCA Health / EP Eval
- Phrase "run VeritaAssure bootstrap"

---

## Skill Helpers Loaded

None for this session.

---

## Past session context

Located at `/home/user/workspace/past_session_contexts/`. Has `memories/` and `sessions/` directories. Asset index at `past_session_contexts/sessions/asset_index.md`. Key memory files:

- `memories/work/credentials/` for credential-handling protocol notes
- `memories/work/tools/railway/` for Railway IDs and token history
- `memories/projects/veritaassure/` for product, pricing, copy rules history

Read these when context about a prior decision is needed. Do not duplicate the work; reference and continue.

---

## Hard reminders before any code change

1. Emit the mandatory response template (`TASK / ASSUMPTIONS / CLARIFYING QUESTION / PLAN / SELF-CHECK`) before code or edits. Gate 1.
2. `confirm_action` before `git push origin main` and before any Railway deploy. Gate 2.
3. Never include em dashes in any file. Use commas, colons, or hyphens.
4. Never write operational secrets to files in the workspace. Read from Railway env, use, shred.
5. The byline is exactly `Michael Veri, MLS(ASCP) - VeritaAssure™` (hyphen).
6. Demo URLs use clean paths, never `/#/demo`.
7. Always pass `latestCommit: true` on Railway `serviceInstanceDeploy`.
8. Verify deploy success: poll `deployments(first: 1, ...)` until `SUCCESS`, confirm `commitHash`, then hit `/api/health`.

---

End of SESSION_HANDOFF-2.md.
