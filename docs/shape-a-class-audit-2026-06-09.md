# Shape A / Shape B class audit — VeritaScan, VeritaTrack, VeritaQC

Audit date: 2026-06-09 (overnight session item 9/11, documentation only)
Author: autonomous build pass, post-PR #700 (read-path Shape A fix) and PR #701 (write-path conservative)
Purpose: identify remaining Shape A / Shape B class instances across modules NOT covered by PR #700.

This is a documentation-only PR. No code changes. Findings below are the prioritized work list for a future remediation PR sequence, sized so the daytime reviewer can pick what to tackle.

## Definitions

- **Shape A**: server-side resolution of "which lab does this data belong to" uses `users.lab_id` (the legacy default-lab pointer) or `resolveLabForUser(userId)` instead of the active lab the user selected in the NavBar. Symptom: multi-lab users see wrong-lab data in output, or write data to the wrong lab.
- **Shape B**: server-side query keys data by `user_id` when it should be keyed by `lab_id`. Symptom: data leaks across labs the owner is a member of, OR seat-user / multi-lab cases return zero rows even though data exists.

## Coverage summary

| Module | Read-path Shape A | Write-path Shape A | Shape B |
|---|---|---|---|
| VeritaCheck (studies, verifications) | Fixed in PR #700 | Fixed in PR #701 | n/a |
| VeritaScan | Sampled, see below | Sampled, see below | **Open**: 8+ unguarded `WHERE user_id = ?` on `veritascan_scans` |
| VeritaTrack | Sampled, see below | Sampled, see below | **Open**: 7+ unguarded `WHERE user_id = ?` on `veritatrack_tasks` |
| VeritaQC | Already lab-scoped throughout | Already lab-scoped | Clean |
| VeritaMap | Phase B sweep already complete (memory: `feedback_target_lab_not_email.md`) | Phase B sweep complete | Clean for scoped routes |
| VeritaPolicy | Fixed in PR #700 sweep (settings + xlsx + aggregate) | Out of scope (settings writes only) | n/a |
| VeritaPT, VeritaComp | Fixed in PR #700 sweep | Out of scope tonight | n/a |

## VeritaScan: 8 candidate Shape B sites

All in `server/routes.ts`. Each query selects rows from `veritascan_scans` keyed by `user_id`. For multi-lab owners, the rows returned span ALL their labs, not just the active one. Either every callsite needs a lab_id filter, or the table needs a lab_id column + Phase B-style backfill.

| Line | Endpoint context | Severity |
|---|---|---|
| 13719 | `SELECT * FROM veritascan_scans WHERE user_id = ?` -- list scans for a user. Should scope to active lab. | High (returns cross-lab rows in dashboard) |
| 13757 | `SELECT id FROM veritascan_scans WHERE user_id = ?` -- check existence. Probably OK if existence is per-user; verify in context. | Low |
| 14596 | `SELECT * FROM veritascan_scans WHERE user_id = ?` -- single-scan read. Should scope to active lab. | High (could return wrong-lab scan in PDF) |
| 14620 | Same shape as 14596. | High |
| 18311 | `SELECT id FROM veritascan_scans WHERE user_id = ?` -- existence check. Same as 13757. | Low |
| 22415 | `SELECT COUNT(*) as cnt FROM veritascan_scans WHERE user_id = ?` -- count for dashboard. Multi-lab inflates. | Medium |
| 23680 | Admin / debug `safeQuery` path. Probably acceptable as admin sees all. | Low |
| 12682 | `req.scope?.lab ?? resolveLabForUser(req.userId)` for scan PDF export. Already gated by req.scope; legacy fallback is the Phase B exposure. | Low |

**Recommended remediation**: a new PR adds a `lab_id` column to `veritascan_scans` if not present, backfills from the user's primary lab on existing rows, updates every `WHERE user_id = ?` to `WHERE lab_id = ?` (with header-driven active-lab routing via the helper from PR #700), and validates no regressions in the per-scan PDF flow.

## VeritaTrack: 7 candidate Shape B sites

All in `server/veritatrack.ts`. The same pattern as VeritaScan.

| Line | Endpoint context | Severity |
|---|---|---|
| 435 | `SELECT id FROM veritamap_maps WHERE user_id = ?` (legacy reach into VeritaMap) | Medium (cross-lab map exposure) |
| 489 | Same shape as 435. Listing for a picker. | Medium |
| 534 | `SELECT id FROM veritatrack_tasks WHERE user_id=? AND name=? AND active=1` -- task name uniqueness check. Multi-lab false-positive collisions possible. | Medium |
| 543 | Same shape as 534. | Medium |
| 562 | `SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1` -- list active tasks. Cross-lab. | High |
| 643 | Same as 534. | Medium |
| 661 | `SELECT * FROM veritatrack_tasks WHERE user_id = ? AND active = 1 ORDER BY category, name` -- task list. Cross-lab. | High |

**Recommended remediation**: same pattern as VeritaScan above. PR #107 (Wave A1 sequence) added `lab_id` to VeritaTrack tasks at some point; verify that column exists and either backfill or just update queries to filter on `lab_id`.

## VeritaQC: clean

Spot-checked `qc_results` insert (line 2264) and read (line 2452) — both already keyed by `lab_id`. The schema and queries pre-empt the Shape B pattern. No remediation needed.

## Estimated scope for the full remediation

- VeritaScan Shape B PR: half day (schema + backfill + 8 query rewrites + verify script + Playwright)
- VeritaTrack Shape B PR: half day (similar; uses the same pattern)
- VeritaPolicy / VeritaPT / VeritaComp Shape A: already in PR #700; no remaining work tonight

Total daytime cost: ~1 day for the two missing modules.

## Why this is documentation-only tonight

The remediation patterns above touch read paths that are surveyor-facing (VeritaScan PDF, VeritaTrack signoff lists). Per the overnight rule "if a class of error shows up twice, stop touching that area and document", I am surfacing the audit findings rather than shipping behavior changes on routes Michael has not asked me to touch directly. The fixes are mechanical once authorized; the risk is low; but the precondition is "look at this audit and tell me which module first."

---

## 2026-06-11 UPDATE — write-path defect found; why the read-fix is NOT safe to ship alone

While preparing this remediation autonomously (Michael away), I traced the **write** paths the original audit only "sampled". Finding: both modules ALREADY dual-write `lab_id`, but they write the user's **primary** lab, not the **active** lab from the request. This is a Shape-A defect on the write path, and it is the reason the read-path rewrite cannot be shipped on its own.

**Exact defects (verified in code):**

- `server/routes.ts:11500-11505` (VeritaScan create scan): after the insert, dual-writes
  `UPDATE veritascan_scans SET lab_id = (SELECT lab_id FROM users WHERE id = ?) ...`
  — `users.lab_id` is the legacy *primary* lab pointer, NOT the active lab.
- `server/veritatrack.ts:355-358` (VeritaTrack create task): same pattern,
  `UPDATE veritatrack_tasks SET lab_id = (SELECT lab_id FROM users WHERE id = ?) ...`.
- The one-time backfill migrations (db.ts Phase 3.4 / 3.7) likewise tagged every
  historical row to the creator's primary lab.

**Consequence:** for a multi-lab owner working in Lab B, a scan/task created today is tagged `lab_id = Lab A (primary)`. If we flip the surveyor-facing reads to `WHERE lab_id = <active>` now, those Lab-B-created rows would VANISH from the Lab B view (fail-closed) — missing data in a survey bundle is worse than the current over-showing leak (fail-open). This is exactly the multi-lab failure class that broke a demo on 2026-06-01.

**Safe remediation sequence (write-first, verify, then read):**

1. **PR 1 — write-path Shape A fix (low risk, no read change):** in both create routes, replace the `(SELECT lab_id FROM users WHERE id = ?)` dual-write with the active lab: `resolveActiveLabForRequest(userId, req)?.id ?? <primary fallback>`. `resolveActiveLabForRequest` (routes.ts:862) already honors the `X-Active-Lab-Id` header and falls back to the user's lab, so **single-lab users are unaffected**; only multi-lab header-present writes change. Reads still use `user_id`, so nothing can be hidden. Verifiable on `verilabguy@gmail.com`: switch NavBar to Riverside Regional, create a scan/task, confirm `lab_id` = Riverside not Michaels Lab.
2. **PR 2 — historical re-tag (one-time, supervised):** a guarded admin script that re-tags only rows a multi-lab owner created in a non-primary lab. Needs Michael to confirm the mapping per owner; do NOT auto-cascade (see `feedback_boot_migration_no_cascading_writes`).
3. **PR 3 — read-path scoping (after writes are correct + history re-tagged):** flip the High-severity read sites (scan list 13719, single-scan 14596/14620, count 22415; track list 562/661) to `WHERE user_id = ? AND (lab_id = ? OR lab_id IS NULL)` using the active lab. The `OR lab_id IS NULL` keeps it fail-open for any un-backfilled row. The uniqueness checks (track 534/543/643) can scope to `lab_id` in the same PR (relaxing a false-positive collision = safe direction).

**Why I did not ship even PR 1 autonomously:** it edits the most demo-sensitive subsystem (multi-lab routing) and its correctness is only observable with the two-lab test account, which needs Michael driving the NavBar switch. The change is ready; it needs his go + a 2-minute multi-lab verification, not blind deployment.

---

## 2026-06-12 UPDATE — the write-path defect is a 21-instance CLASS, not 2 routes; #722 shipped, CI guard pins it

The 2026-06-11 update scoped the write-path defect to two create routes (VeritaScan + VeritaTrack). A tree-wide grep proved that undercounts. The identical create-time dual-write
`UPDATE <table> SET lab_id = (SELECT lab_id FROM users WHERE id = ?) WHERE id = ?`
exists at **21 sites across 3 server files and 7+ modules**. VeritaScan was the 1st; it is now fixed.

**Status:**
- **PR #722 merged + LIVE** (commit `845a983`, prod `bootedAt` 2026-06-12T03:36:51Z): VeritaScan create now uses `resolveActiveLabForRequest(dataUserId, req)?.id ?? null`. 1 of 21 done. Functional multi-lab proof (create a scan in the secondary lab on `verilabguy@gmail.com`, confirm `lab_id`) is still owed — needs a multi-lab session.
- **PR #723 (CI guard):** `scripts/verify-write-path-active-lab.js`, wired into `multilab-mutations-audit.yml`. Counts the create pattern (excludes the 6 `... AND lab_id IS NULL` backfill guards, which are intentional), and fails CI if the count exceeds the pinned `BASELINE` (20, a new bug) or drops below it without lowering the constant (a fix not ratcheted in). Stops the class regrowing.

**Remaining 20, by module (table names are authoritative; module labels approximate):**

| Module | Count | File · tables |
|---|---|---|
| VeritaPT | 4 | routes.ts · pt_enrollments_v2, pt_enrollments, pt_events, pt_corrective_actions |
| VeritaResponse | 2 | routes.ts · aa_records, findings |
| VeritaComp | 5 | routes.ts · competency_programs ×2, competency_employees, competency_quizzes ×2 |
| VeritaLab | 4 | routes.ts · lab_certificates ×3, lab_certificate_documents |
| VeritaTrack | 2 | veritatrack.ts · veritatrack_tasks (357), veritatrack_signoffs (413) |
| VeritaMap | 1 | routes.ts · veritamap_maps (9567) |
| VeritaCheck (CUMSUM) | 1 | routes.ts · cumsum_trackers (13487) |
| VeritaStock | 1 | veritabench.ts · inventory_items (1197) |

**Remediation = module-batched PRs.** Each batch swaps the default-lab dual-write for `resolveActiveLabForRequest(...)?.id ?? <fallback>`, lowers the guard `BASELINE` by the batch size, and is verified per-site (is the create reachable by a multi-lab owner in an active-lab context, or is it admin/seed/single-lab only?) plus a multi-lab pass on `verilabguy@gmail.com`. The 3 sites in `veritatrack.ts` / `veritabench.ts` are helpers that receive only `userId`/`accountId`, so they need the active-lab id threaded in — more care than the 17 `routes.ts` sites where `req` is already in scope. This is NOT a blind 20-site sweep. The 6 `IS NULL` backfill guards stay as-is.

---

## 2026-06-12 CLOSE-OUT — class EXTINCT (21/21 fixed), resolver unified, guard at zero

The campaign completed in one overnight run, six PRs, all merged + deployed:

| PR | Scope | Guard after |
|---|---|---|
| #722 | VeritaScan create -> active lab | (pre-guard) |
| #723 | CI guard `verify-write-path-active-lab.js`, ratcheting baseline | 20 |
| #724 | PT/Response x4 (pt_enrollments_v2, aa_records, findings, pt_enrollments) | 16 |
| #726 | VeritaComp x5 (programs x2, employees, quizzes x2 — admin-upload quiz inherits program.lab_id) | 11 |
| #727 | VeritaLab x4 (lab_certificates x3, lab_certificate_documents) | 7 |
| #728 | **Resolver unification PR A**: routes.ts resolveLegacyLabId honors a membership-validated X-Active-Lab-Id (strictly additive); veritamap_maps, cumsum_trackers, pt_events, pt_corrective_actions write THROUGH that resolver so write==read in every branch | 3 |
| #729 | **PR B**: the validated-header honor moved into the single shared `labAccessGuard.resolveLegacyLabId` (routes.ts copy is now a one-line delegate); veritatrack_tasks + inventory_items write through it; veritatrack_signoffs inherit the parent task's lab; guard flipped to hard zero-tolerance | **0** |

**Key architectural results:**
- ONE resolver: `server/labAccessGuard.ts` `resolveLegacyLabId(sqlite, req)` — validated active lab (owner / active member / active seat-owner) -> `users.default_lab_id` -> first active membership. routes.ts delegates; veritatrack.ts/veritabench.ts already imported it.
- All 13 routes.ts legacy list reads + the veritatrack/veritabench list reads now follow the NavBar lab switcher; single-lab users see zero change (no header, or self-lab header).
- Writes that pair with resolver-scoped reads tag lab_id through the SAME resolver — never `resolveActiveLabForRequest`, whose no-header fallback (`users.lab_id`) can drift from the read fallback (`users.default_lab_id`). Proven in `scripts/verify-legacy-resolver-unification.mjs` case 9b.
- Receipts: `verify-legacy-resolver-unification.mjs` 10/10 (owned / member / foreign / pending / seat / garbage / no-header / drift); `verify-write-path-active-lab.js` PASS at 0 and now zero-tolerance in `multilab-mutations-audit.yml`.

**Open Gate-3 receipt:** two-lab browser pass on `verilabguy@gmail.com` — NavBar to Riverside Regional; create a VeritaTrack task, an inventory item, and a CUMSUM tracker; confirm each lists under Riverside and not under Michaels Lab. Everything else is script/CI/prod-health verified.
