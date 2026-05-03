---
name: veritaassure-bootstrap
description: "Bootstrap orientation for any Veritas Lab Services / VeritaAssure work. Load and execute B1 to B15 at the start of any thread that mentions Veritas, VeritaAssure, veritaslabservices.com, any Verita-prefixed product (VeritaCheck, VeritaMap, VeritaScan, VeritaComp, VeritaStaff, VeritaLab, VeritaPT, VeritaPolicy, VeritaTrack, VeritaStock, VeritaBench), COLA, SCA Health, San Carlos Apache, or the phrase 'run VeritaAssure bootstrap'. Without this skill, agents repeatedly start cold and ask Michael basic questions about his own product. Treat that as a critical-severity failure mode."
metadata:
  author: michael-veri
  version: '2.0'
  owner_email: verilabguy@gmail.com
---

# VeritaAssure Bootstrap (B1 to B15)

## When to Load and Execute

Run this skill when ANY of the following is true:

- The first user message in a thread mentions Veritas Lab Services, VeritaAssure, veritaslabservices.com, or any Verita-prefixed product.
- The user mentions COLA (the lab accreditor / Laboratory Enrichment Forum), SCA Health, San Carlos Apache, or evaluation-tool work in a Veritas context.
- The user pastes the bootstrap_message.md content or any task link with VeritaAssure / Veritas in the title.
- The user types "run VeritaAssure bootstrap" or any close variant.
- A new agent has been spun up after a context-compaction loop on a Veritas thread.

The user is Michael Veri, MLS(ASCP), owner of Veritas Lab Services, LLC. He has been burned multiple times by sessions that start cold and ask him basic questions about his own product.

## Pre-Bootstrap Behavior

Do not respond to the user with anything substantive until B1 to B15 are complete. A short acknowledgement ("orienting on the project, one moment") is fine. Product questions, recommendations, or work output are not.

The single source of truth is the GitHub repo `mav40121/veritas-lab-services`. Specifically:

- `STANDING_REQUIREMENTS.md` (copy rules, gates, credential handling, deploy rule, infra IDs, pricing)
- `PARKING_LOT.md` (OPEN / CLOSED / NOT CARRIED OVER items across sessions)
- `SESSION_HANDOFF.md` (running session-handoff doc, identity and rules summary)
- `SESSION_HANDOFF-2.md` (current operational state, latest-commit context, build queue, known issues)
- `SESSION_START_CHECKLIST.md` (the 5-section checklist Michael requires every fresh agent to answer)

These files override any conflicting information from memory. If memory and the repo disagree, the repo wins, and memory should be refreshed after the bootstrap.

## Operational Values

These come from `bootstrap_message.md` and are treated as last-known-good, not guaranteed-current. If any value fails, invoke the auth-failure rule below.

- Railway API token: project-scoped token from bootstrap_message.md
- Railway project ID: `29c628f1-7860-4fca-8fee-227159bb86e8`
- Railway service ID: `170f5560-8cf0-4341-9c87-294062ebedd1` (radiant-quietude)
- Railway environment ID: `cd669f7c-23f3-434c-895d-ca40ac504e91`
- ADMIN_SECRET: pull from Railway env at use time, never paste anywhere
- GitHub PAT: stored as `GITHUB_TOKEN` in Railway env, accessed via the `github` credential preset, never paste anywhere
- User lab user_id (production DB): 17
- Author identity: Michael Veri / verilabguy@gmail.com

## B1 to B15 Procedure

Execute B1 through B12 as parallel as possible in the first turn. B13 to B15 follow once B1 to B12 complete.

### B1. Repo identity verify

```
gh api repos/mav40121/veritas-lab-services --jq .full_name
```

Must return `mav40121/veritas-lab-services`. Any other owner string (e.g. `verilabguy/...`) is corrupted session-summary text. Flag it in the briefing and proceed with `mav40121`.

### B2. Canonical-records read (full, in order)

Read these five files in full from the cloned or freshly fetched repo:

1. `STANDING_REQUIREMENTS.md`
2. `PARKING_LOT.md` (every OPEN item gets surfaced in the B15 briefing)
3. `SESSION_HANDOFF.md`
4. `SESSION_HANDOFF-2.md`
5. `SESSION_START_CHECKLIST.md`

Read in full. Do not self-summarize. Let the content load into context. If only a subset is needed for the day's work, still read all five during bootstrap; that is what makes future questions answerable without re-asking.

### B3. Memory pull (parallel with B2)

Run `memory_search` with three focused queries:

1. "What are my standing requirements for VeritaAssure?"
2. "What is the current state of the VeritaAssure platform, modules, pricing, deploy?"
3. "What credentials and platforms do I use for veritaslabservices.com?"

Memory provides continuity across threads. It is not authoritative for facts that may have changed; the repo is.

### B4. Site health

```
curl -s https://www.veritaslabservices.com/api/health
```

Expect `{"status":"ok","service":"veritas-lab-services","timestamp":"...","commit":"<sha>","bootedAt":"..."}`. Record the `commit` field for the B7 drift check.

### B5. Apex redirect spot-check

```
curl -sI https://veritaslabservices.com/
```

Expect a 301 to `https://www.veritaslabservices.com/`. Print-QC depends on the `www.` form being canonical. If apex stops 301'ing, surface as a separate issue, do not silently work around it.

### B6. Latest commit on main

```
gh api repos/mav40121/veritas-lab-services/commits/main \
  --jq '{sha: .sha[0:7], date: .commit.committer.date, msg: (.commit.message | split("\n")[0])}'
```

Note the short SHA and the first line of the commit message.

### B7. Latest Railway deployment plus drift check

GraphQL against `backboard.railway.app/graphql/v2`, query `deployments(first: 1, input: { projectId, serviceId, environmentId })`. Pull `node.status`, `node.createdAt`, `node.meta.commitHash`.

Drift check: the `meta.commitHash` from B7 should match the `commit` from B4 (live site) and the SHA from B6 (main HEAD). Any mismatch is drift. Halt and report; do not start new work on top of an unreconciled deploy.

### B8. Working-tree drift

In the cloned repo:

```
git status -s
git log --oneline origin/main ^HEAD
```

`git status -s` should be empty. The `git log` should also be empty (meaning local main has no commits ahead of origin/main). Anything else means uncommitted or unpushed work that needs reconciliation before any new build.

### B9. Railway token reachability

The Railway token in `bootstrap_message.md` is project-scoped. Test it with a project-scoped query:

```
query { project(id: "29c628f1-7860-4fca-8fee-227159bb86e8") { id name } }
```

A successful response confirms the token works for the operations we actually use (`project`, `deployments`, `variables`, `serviceInstanceDeploy`). Do NOT use `me { id email }` to test the token. Project-scoped tokens return Not Authorized on `me`, which is expected, not a failure. If a project-scoped query fails, invoke the auth-failure rule below.

### B10. GitHub PAT reachability

If B1 succeeded via the `github` credential preset, the PAT is reachable. No additional check needed. Never paste or echo the PAT.

### B11. ADMIN_SECRET pull and backup

GraphQL `variables(projectId, environmentId, serviceId)` returns the full env map. Pull `ADMIN_SECRET` into a shell variable in a single `bash` call:

```bash
ADMIN_SECRET=$(curl -s -X POST https://backboard.railway.app/graphql/v2 \
  -H "Authorization: Bearer $RAILWAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"query { variables(projectId: \\\"$PROJECT_ID\\\", environmentId: \\\"$ENV_ID\\\", serviceId: \\\"$SERVICE_ID\\\") }\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['variables'].get('ADMIN_SECRET',''))")

TS=$(date -u +%Y%m%dT%H%M%SZ)
curl -s -L --get --data-urlencode "secret=$ADMIN_SECRET" \
  -o "/home/user/workspace/backups/veritaassure_${TS}.db" \
  https://www.veritaslabservices.com/api/admin/backup-db

unset ADMIN_SECRET
```

The variable never appears in tool output, never gets written to a file, and never gets echoed to the user. The `unset` runs in the same shell.

### B12. Backup integrity

On the downloaded `.db`:

- `file <path>` (expect SQLite 3.x)
- `ls -lh <path>` (expect multi-MB, not a tiny error response)
- `sqlite3 <path> 'PRAGMA integrity_check;'` (expect `ok`)
- `sqlite3 <path> 'SELECT COUNT(*) FROM users;'`
- `sqlite3 <path> 'SELECT COUNT(*) FROM studies;'`
- `sqlite3 <path> 'SELECT id, email, name, plan FROM users WHERE id = 17;'` (expect Michael Veri / verilabguy@gmail.com)

If any of these fail, the backup endpoint or DB is in trouble. Surface in B15 as a critical issue.

### B13. Verified-date staleness check

Compare today against the "Verified-working" date at the top of `bootstrap_message.md`. If the gap is greater than 30 days, surface a one-liner in B15:

> "Heads up: bootstrap values were last verified working YYYY-MM-DD, which is N days ago. Run a quick reachability check before relying on them."

Notice only, not a block. The agent still tries the values; the auth-failure rule handles actual failures.

### B14. PR flow (used for any change after bootstrap)

Branch protection rejects direct push to main. Standing flow:

1. `git checkout main && git pull --ff-only`
2. `git checkout -b <type>/<slug>` (e.g. `feat/<slug>`, `fix/<slug>`, `docs/<slug>`)
3. Edit files, run any local audit script
4. `git add` and `git commit` with hook-compliant message:
   ```
   <Subject line>

   TASK: <one-line task>
   PLAN:
   1. <step>
   2. <step>
   Self-check:
   - <potential error 1>
   - <potential error 2>
   - <potential error 3>
   ```
5. `git push -u origin <branch>`
6. `gh pr create --title "<title>" --body "<TASK / ASSUMPTIONS / PLAN / SELF-CHECK body>"`
7. Wait for CI green (audit script, GitGuardian, any other required checks)
8. `gh pr merge <num> --squash --delete-branch` ONLY after the user authorizes the merge for that specific PR (Gate 2)
9. `git checkout main && git pull --ff-only` to sync local
10. If a Railway deploy is needed, call `serviceInstanceDeploy` with `latestCommit: true`. Never `serviceInstanceRedeploy`. Each deploy needs its own Gate 2 authorization tied to the merged commit
11. Verify the deployed `commitHash` from a fresh B7 query matches new main HEAD

Each push and each deploy needs Gate 2 authorization tied to that specific commit. "Fix it" or "do it" earlier in the conversation does NOT cover later changes the agent introduced on its own initiative.

### B15. Briefing to user

A single response covering:

- Reachability table (B1, B4, B5, B6, B7, B8, B9, B10) with pass/fail per row
- Backup verification (B11, B12) with file path, size, integrity, user count, study count, user_id 17 confirmation
- Parking lot OPEN items (count plus a table with item, pre/post-COLA flag where present)
- Staleness notice (B13) if triggered
- Any reconciliations (e.g. operational value in bootstrap_message.md superseding a value in memory)
- Explicit "ready for instruction" line

No work begins until the user gives a task or says proceed.

## Auth-Failure Rule (Binding)

If the agent gets 401, 403, or any "invalid token / unauthorized / permission denied" response from Railway, GitHub, or any other operational endpoint using the values in `bootstrap_message.md`, the agent does the following in order:

1. Stops the current operation. No retries beyond one to confirm the failure is reproducible.
2. Tells the user, in one sentence, which value failed and how (e.g. "Railway API token returned 401 on the variables query").
3. Asks the user once: "Has the value rotated? Paste the new one or tell me to skip the operation that needs it."
4. If the user says skip, the agent records the failure as an OPEN item in `PARKING_LOT.md` with date and which operation was skipped, then continues with whatever work doesn't need that credential.
5. Does NOT churn through alternative tools, browser logins, or guesswork. Does NOT silently fall back to a different code path.
6. Does NOT later flag the user-pasted replacement as compromised. Per `STANDING_REQUIREMENTS.md` "CREDENTIAL HANDLING": tokens the user pastes in our chat are authorized for that thread's work.

Special case for project-scoped Railway tokens: a Not Authorized response on `me { id email }` is expected and is NOT an auth failure. Test reachability with a project-scoped query (`project`, `deployments`, `variables`) instead.

## Credential Handling Protocol (NON-NEGOTIABLE)

Codified in `STANDING_REQUIREMENTS.md` under "CREDENTIAL HANDLING":

- Do NOT ask Michael to paste operational secrets in chat. Not `ADMIN_SECRET`, not `RESEND_API_KEY`, not `STRIPE_SECRET_KEY`, not `STRIPE_WEBHOOK_SECRET`, not `JWT_SECRET`, not the GitHub PAT.
- The ONLY credential Michael may be asked for is the Railway API token, and only when it is not in agent memory or `bootstrap_message.md`.
- All other secrets are pulled from Railway service env via GraphQL `variables(projectId, environmentId, serviceId)`, used in a single shell call, and discarded.
- Never echo a secret value into tool output, never write one to a persistent file, never paste one back to the user.
- If Michael voluntarily pastes a credential, do NOT later flag it as compromised. He authorized that disclosure for the thread's work.

## Identity and Hard Rules (cite STANDING_REQUIREMENTS.md as source)

These are the rules most often violated by fresh agents. The full list is in `STANDING_REQUIREMENTS.md`.

**Identity / byline:** Michael Veri, MLS(ASCP) - VeritaAssure(TM). Do not add "TJC Surveyor" (he served 2021 to 2025 but is not currently a surveyor). Do not add "MT(ASCP)" (he is MLS, not MT).

**Banned terms in product / marketing copy:**
- The legacy evaluation-tool product name (use "other evaluation tools" if needed; fine to discuss internally with Michael)
- "CAMLAB" (use "TJC standard")
- Dated TJC manual references (use "the current TJC standard" or "TJC standard for laboratory accreditation")
- "LabVine Learning" (removed permanently)
- "method validation" / "validation suite" when describing what a lab does. Labs verify, manufacturers validate. Use "performance verification" or "verification of performance specifications"

**Punctuation:** No em dashes in public-facing artifacts. Internal-only files (this skill, STANDING_REQUIREMENTS.md, PARKING_LOT.md, SESSION_HANDOFF, code comments, agent-to-user chat, scratch notes) allow em dashes.

**Product symbol:** Always (TM), never (R). Every Verita-prefixed name carries it on first use in any document.

**URLs in printed assets:**
- Canonical demo: `www.veritaslabservices.com/demo`
- Canonical compliance demo: `www.veritaslabservices.com/demo/compliance`
- The hash form (`/#/demo`) is RETIRED. Forbidden in any print, brochure, leave-behind, slide deck, ad, social card, or generated PDF.
- Before declaring print QC complete on any asset with URLs, run an explicit grep for forbidden patterns: `/#/`, `localhost`, `127.0.0.1`, `radiant-quietude`, `staging`, `preview`, `pr-`, any non-www subdomain. Clean grep is required, not optional. Visual inspection is not a substitute.

**PDF compliance:**
- VeritaCheck, VeritaComp, and CMS 209 PDFs: director signature block on PAGE 1, alongside results / narrative / CFR citations. No exceptions.
- VeritaScan PDFs: internal use, no signature, internal-use disclaimer instead.
- VeritaLab certificate PDFs: no signature.
- Never write "medical director" or "laboratory director" alone. Always "medical director or designee."
- Header reads "LABORATORY DIRECTOR OR DESIGNEE REVIEW."
- Never tell the director what to do on a FAIL. No "do not report patient results" language.
- VeritaCheck narratives end with: "Final approval and clinical determination must be made by the laboratory director or designee."

**Excel exports:** ExcelJS only, never SheetJS. `const { default: ExcelJS } = await import('exceljs')`. Teal #01696F headers, freeze pane B2 (C2 for VeritaMap), auto-filter on every column. Full spec in `STANDING_REQUIREMENTS.md`.

**Deploy rule:** every Railway `serviceInstanceDeploy` mutation MUST include `latestCommit: true`. `serviceInstanceRedeploy` is banned. Failing to include the flag caused a critical outage on 2026-04-14.

**Procedural gates (Gate 1 and Gate 2 in STANDING_REQUIREMENTS.md):**
- Gate 1 (recommendation lockout): after any sentence that recommends a change, the next tool call must be `confirm_action`, `ask_user_question`, or a read-only call. Not `edit`, `write`, or any state-modifying call.
- Gate 2 (deploy confirmation): every `git push` to main and every Railway deploy needs explicit user authorization tied to that specific change.

**Mandatory response template:** Before any code, tool call, or file edit, the response must begin with TASK / ASSUMPTIONS / CLARIFYING QUESTION / PLAN / SELF-CHECK. Applies to bug fixes through large builds.

**TEMPLATE-FIRST rule:** The filled-in template gets approved by the user before any file is modified.

**SCRIPT-WITH-ARTIFACT rule:** Any work product generated by Python (xlsx, pdf, csv, docx, pptx, json) ships in the same response as the .py script that produced it.

**Star-on-recommended rule:** Any time the agent uses `ask_user_question` or otherwise presents the user with a choice between options, the recommended option's label is prefixed with a star. The star goes in the LABEL only, never in the description. Applies to all choice-style prompts.

**A5 citation copyright:** Never quote or paraphrase accreditor text. Use ID plus topic phrase in our own words only.

## Parking Lot Maintenance

- New items: append under OPEN with date and source pointer. Commit via the B14 PR flow.
- Shipped items: move to CLOSED with closure-evidence pointer (commit SHA or file/line that proves the change is live).
- Items that were never real: move to NOT CARRIED OVER with reason. Never silently delete.

## What an Oriented Agent Looks Like

By the time you finish B1 to B15, you should be able to answer all five `SESSION_START_CHECKLIST.md` sections without re-asking. Specifically:

- You know the Verita-prefixed modules and which are compliance vs operations.
- You know the current pricing tiers (Per Study $25, VeritaCheck Unlimited $299/yr, Clinic/Waived $499, Community $999, Hospital $1,999, Enterprise $2,999, with grandfathered prices for existing subs).
- You know the live site is on Railway, project `veritas-lab-services`, service `radiant-quietude`, deployed from `mav40121/veritas-lab-services` main branch.
- You know the customer in production is San Carlos Apache Healthcare Corporation.
- You know the credential handling protocol and will not ask Michael to paste secrets.
- You know the print-QC grep rule and will run it before declaring any printed asset done.
- You know "labs verify, manufacturers validate" and will not write "method validation" in marketing copy.
- You know to use the response template before editing any file.

If you cannot, repeat the bootstrap. Do not start work cold.

## Failure Modes to Avoid

Real failures from prior sessions:

1. Asking what VeritaAssure is. It is Michael's SaaS compliance platform. The repo answers this.
2. Asking for the admin secret. It is in Railway env. Pull it.
3. Trusting only `SESSION_HANDOFF-2.md`. That file said "All prior work complete" on 2026-04-04 and is stale. Always cross-check against the latest commit message and the build queue carry-forward.
4. Putting `/#/demo` on a printed asset. The hash router is retired.
5. Adding "TJC Surveyor" to the byline. He is not currently a TJC surveyor.
6. Writing "method validation" in marketing copy. Labs verify, manufacturers validate.
7. Using em dashes in public-facing copy. Banned in customer-visible output.
8. Pushing to main without `confirm_action`. Gate 2 is binary; an unauthorized push is a discrete breach.
9. Deploying without `latestCommit: true`. Caused a real outage on 2026-04-14.
10. Telling Michael a credential he authorized for a session is now compromised. It is not. He chose to share it.
11. Treating a Not Authorized response on `me { }` as a Railway-token failure. Project-scoped tokens are not authorized for `me`; that response is expected and not a failure.

## After Bootstrap

Once Michael says "proceed" or gives a specific task, normal work begins. Continue to follow `STANDING_REQUIREMENTS.md` for every commit, the response template for every change, and the procedural gates for every deploy.

If at any point during the thread you feel under-oriented (a question you cannot answer about a module, a rule you cannot remember), the user can re-trigger this bootstrap with "run VeritaAssure bootstrap", or you can self-trigger by re-running B1 to B15. Re-orientation mid-thread is preferable to guessing.
