# Merge Checklist — 2026-05-10 Wave

Per-PR verification steps for the multi-PR run shipped on 2026-05-10. Use this as a template the next time a wave of PRs lands. Merge one, deploy, verify, then merge the next. Don't batch.

---

## Wave 1 — Pure docs (zero deploy risk, batch-merge OK)

These touch only markdown. Safe to merge as a batch in any order. No verification step.

- PR #74 — Parking lot updates (closures, deletions, decisions)
- PR #73 — Regulatory baseline index
- PR #81 — Tier-1 smoke test checklist
- PR #82 — VeritaOps cost-per-test scoping
- PR #83 — VeritaResponse flagship scoping
- PR #84 — Competitor-driven candidates (myLabCompliance.io analysis)

---

## Wave 2 — Code, no schema (merge one at a time, deploy + verify each)

### PR #75 — VeritaStock shipped copy

- **What changes:** One sentence in the inventory-management article footer.
- **Verify:** Open `/resources/laboratory-inventory-management`. Footer reads "platform that includes VeritaStock™" not "planned for a future release."
- **Rollback:** Revert PR. No data changes.

### PR #78 — VeritaScan AAA sub-block (5 items)

- **What changes:** Appends ids 169–173 to client/src/lib/veritaScanData.ts.
- **Verify:** Log in. /veritascan. Confirm 5 new items appear in Proficiency Testing domain after item #52.
- **Rollback:** Revert PR. Existing scan rows for ids 169–173 stay in DB but UI no longer renders them.

### PR #77 — CLIA TEa "Lab-Set Internal Goal" label (begins #1)

- **What changes:** New helpers in shared/cliaTeaData.ts and server/backfillAbsoluteFloor.ts. Swaps "CLIA TEa" → "Lab-Set Internal Goal" on StudyResultsPage KPI for non-canonical analytes.
- **Verify:** Create a study with analyte "Lipase" (no canonical TEa). KPI label reads "Lab-Set Internal Goal." Repeat with "Glucose." KPI label reads "CLIA TEa."
- **Rollback:** Revert PR. No data changes.

### PR #76 — Per-module gating (closes #7)

- **What changes:** Client-side useIsReadOnly module keys on VeritaPolicy + VeritaLab. Server-side requireModuleEdit on /api/veritapolicy/*, /api/veritalab/*, /api/veritatrack/*.
- **Verify:** Set seat user to View on `veritapolicy`. Confirm save attempts fail (UI disabled; curl returns 403). Repeat for `veritalab` and `veritatrack`. Set back to Edit; writes resume.
- **Rollback:** Revert PR. Existing seat permission data unchanged.

### PR #85 — Admin report one-row-per-lab (closes #14)

- **What changes:** Admin report query LEFT JOINs labs on owner_user_id. Multi-lab owners expand into multiple rows.
- **Verify:** AdminReport. Lisa shows TWO rows, one per lab, with each lab's own CLIA. Single-lab user shows one row. Legacy user with no labs row still renders via fallback fields.
- **Rollback:** Revert PR. Server returns both `labs` (new) and `users` (legacy alias) during rollout, so rollback is clean.

---

## Wave 3 — Schema migrations (merge ONE, deploy, watch logs, then the next)

### PR #79 — WSLH PT vendor (CHECK rebuild) (closes #15)

- **What changes:** Rebuilds pt_enrollments_v2 CHECK constraint to include 'WSLH'. Idempotent. Adds shared/wslhCatalog.ts.
- **Watch:** Server logs after deploy. Look for `[migration] pt_enrollments_v2 vendor CHECK rebuilt to include 'WSLH'`. If migration fails, the error is caught and logged; table stays in prior state.
- **Verify:** AccountSettings → Preferred PT Vendor → WSLH option present and saves. /veritapt → Manage Enrollments → Add → vendor=WSLH, program=1310, save.
- **Rollback:** Revert PR. Constraint widening is harmless even if the file revert doesn't auto-rebuild back to the 3-vendor list.

### PR #80 — aa_records schema + CRUD endpoints (begins #18 Phase 2)

- **What changes:** New aa_records table. Four endpoints under /api/pt/aa-records.
- **Watch:** Server logs after deploy for the new CREATE TABLE.
- **Verify:** `GET /api/pt/aa-records` returns 200 with `[]`. POST a record (analyte=Lipase, method=split_sample_external, frequency_per_year=2). GET returns it. DELETE clears it.
- **Rollback:** Revert PR. Drop the table manually if you want a clean rollback.

---

## Per-PR rules

- Merge one, deploy, verify, then merge the next.
- For schema migrations (#79, #80) wait for the migration log line before declaring deploy success.
- Every PR has a clean revert path. If anything looks off post-deploy, capture symptom + URL + the deployed commitHash and report.
- Never use `serviceInstanceRedeploy`; always `serviceInstanceDeploy(latestCommit: true, commitSha: '<the-merge-sha>')` per CLAUDE.md §14.

---

## When to use this template

This file is dated 2026-05-10 to mark the specific wave. For future merge cycles, copy this file to a new dated filename (e.g., `merge-checklist-YYYY-MM-DD.md`) and adjust the PR list. The structural approach (Waves by risk; per-PR Verify + Rollback; rules at the end) is the reusable part.
