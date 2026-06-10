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
