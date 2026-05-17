# Post-Release QA Checklist

Run this after every Railway deploy to `main`. Budget: ~15 minutes. The checklist exists so single-customer bugs (the kind that bit us repeatedly on 2026-05-16) don't reach paying labs unnoticed.

If any check fails: stop, open a fix PR, do not move on to the next item until the failure is documented.

## Pre-flight

- [ ] Railway deployment status is SUCCESS on the expected commit hash (`gh` or the Railway dashboard).
- [ ] `git log origin/main --oneline -5` matches what you expect; no rogue commits.

## 1. Authentication and session

- [ ] Sign out, then sign back in with the same account. **No "Another session is active" warning.** (Regression risk: PR #179.)
- [ ] Sign in from a second device/browser while a session is active → "Another session is active" warning DOES appear → click "Force Logout Other Device" → both sessions usable independently.
- [ ] Sign out clears the user from NavBar (logo only, no "Michael" dropdown).

## 2. Lab switching (Multi-Lab Tier 2)

- [ ] NavBar shows a lab dropdown ("Michaels Lab" or "Riverside Regional Medical Center") when signed in to an account with ≥2 active memberships. Single-lab users see no dropdown.
- [ ] Click the dropdown → both labs listed → click the other → URL flips to `/labs/<other-id>/<path>` AND the page content swaps to that lab's data.
- [ ] After switching, click any module link (Open Map, Open Scan, All Programs, etc.) → **stays in the new lab's URL**. Does not bounce to the default lab. (Regression risk: PRs #181, #182.)

## 3. Dashboard (VeritaCheck studies)

- [ ] Dashboard loads at `/labs/<id>/dashboard` with all studies listed.
- [ ] Drafts render with an **amber FileEdit icon + DRAFT badge** and a green **Continue** button. (Regression risk: PR #184.)
- [ ] Completed studies show pass/fail badge + View button + edit pencil.
- [ ] Click View on a completed study → results page loads, lab context preserved in URL.
- [ ] Click edit pencil on a completed study → study editor pre-populates with prior values.
- [ ] Click Continue on a draft → editor pre-populates with the partial data you saved.

## 4. VeritaCheck create + save flows

- [ ] Click "New Study" → study form loads at `/labs/<id>/study/new`.
- [ ] Type a test name, leave the rest empty, click **Save Draft** → toast confirms, lands on Dashboard, draft listed.
- [ ] Continue the draft → fill remaining fields → click **Save & Generate Report** → validation runs, navigates to results page.
- [ ] Generate the PDF from the results page → PDF opens in a new tab. Spot check: lab name in header, signature block on page 1, no em-dashes.

## 5. VeritaMap

- [ ] Maps list loads at `/labs/<id>/veritamap-app` with all maps for the active lab.
- [ ] Click **Open Map** on any map → opens at `/labs/<id>/veritamap-app/<map-id>` (lab preserved). Map detail renders, not "Map not found". (Regression risk: PRs #180, #181.)
- [ ] On the map detail page, click **Back to Maps** / **All Maps** → stays in active lab.
- [ ] On the map detail page, click **Whole lab** → stays in active lab (`/labs/<id>/veritamap-app/labwide`).
- [ ] On the map detail page, click **Edit Instruments** → goes to the Build flow at `/labs/<id>/veritamap-app/<map-id>/build`.
- [ ] On the Build page, flip a test toggle → Summary row briefly shows "Saving... → Saved". Close the page, reopen → toggle persists. (Regression risk: PR #183.)
- [ ] On the map detail page, expand a test row → edit the reference range or critical value → "Autosaving... → Saved" appears next to the Save values button. (Regression risk: PR #185.)
- [ ] Click "Reference literature" inside a test row → opens in a new tab at the lab-scoped URL `/labs/<id>/veritamap-app/resources`. (Regression risk: PR #186.)

## 6. VeritaResponse

- [ ] Findings list loads at `/labs/<id>/veritaresponse`.
- [ ] Click a finding → opens at `/labs/<id>/veritaresponse/<id>`.
- [ ] The Accreditor dropdown on the New Finding dialog shows **only the accreditors the lab is flagged for** + CMS + Other. CAP/TJC/COLA/AABB are hidden unless the lab's accreditation flags include them. (Regression risk: PR #170.)
- [ ] Per-accreditor renderer cards (CMS-2567, CAP, TJC, COLA, AABB) appear only when the finding's accreditor matches AND the lab is flagged for that body.
- [ ] Generate a PDF for at least one renderer (CMS-2567 if Michaels Lab; flip a lab flag if needed to test others). PDF opens in a new tab. Spot check the same way as VeritaCheck (lab name, signature on page 1, no em-dashes, no dated accreditor manual references).
- [ ] Click the trash icon on a finding → ConfirmDialog opens → click Delete → row removed. (Regression risk: PR #178.)

## 7. Other modules (spot check)

For each: click in, click out, confirm lab URL preserved.

- [ ] **VeritaScan**: list loads → Open a scan → Back to scans → lab preserved.
- [ ] **VeritaComp**: programs list loads → Open a program → Back to Programs → lab preserved.
- [ ] **VeritaStaff**: employees list loads → Open an employee → Back → lab preserved.
- [ ] **VeritaLab**, **VeritaPT**, **VeritaTrack**, **VeritaPolicy**, **VeritaStock**: if you touched any of these in the last release, sanity check the entry page loads. Otherwise skip.

## 8. Admin report (if you touched admin-side code)

- [ ] Sign in as admin. Open the admin user-management page.
- [ ] A multi-lab user (verilabguy@gmail.com) appears under BOTH their primary lab AND their secondary lab. Secondary-lab row is amber-tinted with a "Secondary lab (owner)" badge. (Regression risk: PR #168.)
- [ ] Secondary-lab row shows the lab-OWNER's seat counts, not the membership user's. (Regression risk: PR #175.)

## 9. Nav + layout sanity (small but visible)

- [ ] Desktop NavBar shows **"Consulting"** (not "Services") as the second link. (Regression risk: PR #177.)
- [ ] Standalone "My Studies" button removed from NavBar; access is via the user dropdown. (Same PR.)
- [ ] Dashboard uses the full width (`max-w-7xl`) — no big empty band on the left. (Same PR.)
- [ ] "Run a Study" button on the NavBar is fully visible (not clipped on the right).

## 10. Public copy sanity (run `script/audit.py`)

- [ ] `python script/audit.py` returns `Audit PASSED -- 0 errors`. The single live-seats warning is acceptable (admin endpoint auth, unrelated to copy).
- [ ] If you shipped any new PDF / Excel / public marketing copy, spot check one for em-dashes (none allowed), product names (™ not ®), URL canonicalization (no `/#/`, no `localhost`, no Railway internal hostnames).

## 11. Email reminder dispatch (only if shipping VeritaResponse changes)

- [ ] If a test finding's `due_date` falls in 14/7/3/1 days, the next midnight UTC cron should email the recipient. To verify without waiting: curl `POST /api/admin/run-finding-reminders?secret=$ADMIN_SECRET` and inspect the returned summary (`checked` / `sent` / `errors`). Should return cleanly with `errors: 0`.

## After the run

- [ ] If everything passed: log the deploy commit hash in your release notes as "QA passed".
- [ ] If something failed: open a fix PR, link the failure in the PR description.

## Updating this checklist

Add a new section whenever you ship a feature that touches a user-visible flow. Remove sections that no longer apply (a deleted module, a deprecated UI). Keep the checklist runnable in under 15 minutes — if it grows beyond that, split into "every release" (this file) and "monthly deep audit" (separate file).
