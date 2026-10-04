---
description: Comprehensive pre-demo QA sweep across all four login types (owner, admin-member, staff seat, medical director) on a copy of production data. Catches access, plan-gating, role, and render bugs before a client or a demo does.
---

Run a full QA sweep that would catch access, plan-gating, document-generation, and render bugs before a client or a live demo does. Work through these steps in order. Do NOT claim it passed without the receipts (the matrix + the browser results). This is safe: everything runs against a disposable COPY of production, never production itself.

This sweep runs ONLY against Michael's own QA system, never a client account. The default target is org 5 ("Veritas QA System": Michaels Lab, NYS demo lab, Riverside). If the user passes a specific lab id, honor it with `--lab <id>` (the sweep refuses any lab outside the QA org). Never point it at a client or prospect lab.

## 1. Credentials + a fresh production copy
- Pull `ADMIN_SECRET` and `JWT_SECRET` from Railway env per CLAUDE.md credential handling. Never echo them.
- Download a fresh prod DB: `GET https://www.veritaslabservices.com/api/admin/backup-db?secret=$ADMIN_SECRET` into the scratchpad as `qa-sweep-<timestamp>.db`. Confirm it is a valid SQLite file (> 1 MB).

## 2. Build + boot locally on the copy, with foreign keys ON (match prod)
- `npm run build` (confirm exit 0).
- Boot in the background: `DB_PATH=<copy> JWT_SECRET=<localsecret> ADMIN_SECRET=localadmin STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy FRONTEND_URL=http://localhost:5199 PORT=5199 NODE_ENV=production node dist/index.cjs`.
- Wait until `GET http://localhost:5199/api/staff/specialties` returns 200 (boot runs migrations on the copy; give it time).
- Never disable `PRAGMA foreign_keys`: production enforces them, and turning them off hides real bugs (that masked the 2026-10-03 reset FK failure).

## 3. API + document-generator sweep across all four personas
- Run: `JWT_SECRET=<localsecret> node scripts/qa-sweep/api-sweep.mjs --base http://localhost:5199 --db <copy> --org 5` (or `--lab <id>` for a specific lab in the QA system).
- It auto-discovers, on a lab inside the QA org, four logins: the owner, an admin-member (reaches the lab via membership, the persona that failed the USON demo), a staff seat, and the medical director (the active member whose email matches the lab's `medical_director_email`). It mints a JWT for each and sweeps every module's reads, a write-access probe, the document generators (CMS 209, VeritaMap/VeritaCheck exports), and the director-only actions (QC co-sign), checking two ways: the MD must reach them and every other login must be blocked. It refuses to run without `--org` or `--lab`, and refuses any lab outside the QA org, so it can never sweep a client account.
- A non-zero exit means hard failures: a 403 or 500 on a read, a write blocked for owner/admin, a 500, or a failed generator. Capture the FLAGGED list.

## 4. Browser gate + render sweep (the plan-gate class the API cannot see)
- Mint a JWT for the admin-member persona with the same `JWT_SECRET`.
- Run: `PW_BASE=http://localhost:5199 PW_TOKEN=<admin-member JWT> npx playwright test tests/playwright/qa-gate-sweep.spec.ts tests/playwright/plan-gate-active-lab.spec.ts`
- This logs in as a paid-lab member and asserts EVERY module renders its real app, not a "View Plans" / free-tier wall (the exact failure the USON demo showed).

## 5. Spot-drive the key interactive flows in the browser
Using the built-in browser against http://localhost:5199 as the admin-member on the paid lab (inject `veritas_token` + `veritas_user`), actually PERFORM, not just load:
- a VeritaTrack sign-off (confirm it persists: the task shows a last-performed / next-due date),
- open a VeritaComp program (roster + assessment controls render),
- generate one PDF from its button (confirm the request returns 200 / the file opens).
Look at each result; a 200 is not the same as "it worked".

## 6. Report + teardown
- Report a pass/fail matrix across the four personas and every module. List each failure with persona, route, and status. State plainly what passed and what did not; do not round up.
- Kill the local server by its listening port and remove the DB copy from the scratchpad.

Treat every finding as real until you have verified it.
