# Tier-1 Smoke Test — Five-Phase Deploy Stack

**Purpose.** End-to-end click-through across each `accreditation_choice` value to confirm the five-phase deploy stack (Phases 1, 2, 3, 3.5, 3.6) renders correctly for every accreditor combination today. This is a process checklist; no code changes are part of running it.

**When to run.** Before any major deploy or on demand whenever a customer reports an accreditor-specific rendering issue. Initially run after Phase 3.6 shipped (2026-05-01); periodic re-runs catch regressions.

**Time required.** ~30-45 minutes. One person walking the checklist; no coordination required.

**What to record.** For each step, mark Pass / Fail / Note. On any Fail, capture a screenshot and the URL, then file a parking-lot item with the rendering bug and stop the smoke test until the fix lands.

---

## Setup (one-time per session)

- [ ] Log in as `verilabguy@gmail.com` (the operator's primary account; has access to every accreditation_choice value via Account Settings).
- [ ] Open the live site at https://www.veritaslabservices.com (apex 301s to www; print-QC requires the www. form per CLAUDE.md §4).
- [ ] Open browser DevTools → Network panel. Watch for any 4xx or 5xx during the walk.
- [ ] Have a scratch pad open to record screenshot file names and the accreditation_choice value that produced each issue.

---

## Walk 1: Each `accreditation_choice` value

For every value in `{ TJC, CAP, AABB, COLA, CAP+AABB, CLIA }`, do the following:

### 1. Set the accreditation choice

- [ ] Go to `/account/settings`.
- [ ] Under "Accreditation," pick the value being tested.
- [ ] Click **Save**.
- [ ] Confirm the save toast appears and the radio stays on the chosen value after page refresh.

### 2. /veritapolicy renders for this accreditor

- [ ] Navigate to `/veritapolicy`.
- [ ] Confirm the page loads without spinner stuck or 404.
- [ ] Confirm the AO column header on the master list reflects the chosen accreditor (e.g., "TJC" / "CAP" / "AABB" / "COLA" / "CAP + AABB" / "CLIA only").
- [ ] Open one row's expand panel; confirm the row's AO citations match the chosen accreditor.
- [ ] If `CAP+AABB`: confirm both CAP and AABB columns render; if `CLIA`: confirm only CFR citations show.

### 3. /veritacomp renders for this accreditor

- [ ] Navigate to `/veritacomp`.
- [ ] Confirm the page loads.
- [ ] Open one competency program; confirm the regulation citations include the right accreditor's standards (or are CFR-only for `CLIA`).

### 4. VeritaScan PDF export per accreditor

- [ ] Navigate to `/veritascan`.
- [ ] Click **Generate PDF** on the most recent scan record (or create a fresh one if none exist).
- [ ] Open the downloaded PDF.
- [ ] Verify the accreditor badge area on page 1 shows the value picked in step 1.
- [ ] Verify the citations column inside the scan items reflects the accreditor (TJC / CAP / AABB / COLA / both for CAP+AABB / CFR-only for CLIA).
- [ ] Save the PDF as `smoke-VeritaScan-<choice>-<YYYYMMDD>.pdf` for the audit trail.

### 5. /veritamap end-to-end

- [ ] Navigate to `/veritamap`.
- [ ] Pick any existing map or create a fresh one.
- [ ] Open the map; confirm tests render and the "Whole lab" toggle works (per parking-lot #19, closed).
- [ ] Click "Whole lab"; confirm the union view across all maps loads.

### 6. /veritapt end-to-end

- [ ] Navigate to `/veritapt`.
- [ ] Confirm the coverage analysis loads. Numbers are not all zero (assuming the map has tests).
- [ ] Click **Manage Enrollments** → **Add**.
- [ ] Add a dummy enrollment (vendor=Other, program=Smoke Test, category=General Chemistry, year=current).
- [ ] Confirm the row appears in the enrollments table.
- [ ] Delete the dummy enrollment; confirm it disappears.

### 7. /veritalab certificate page

- [ ] Navigate to `/veritalab`.
- [ ] Confirm certificates list loads.
- [ ] If you have a CLIA certificate uploaded, confirm the expiration badge color matches days-to-expiration.

---

## Walk 2: Module gates (per parking-lot #7, closed)

Test that per-module seat permissions take effect on the four pages from #7:

- [ ] Switch to a seat user account (or create one via Account Settings → Seats → Invite).
- [ ] In the owner account, set the seat user's `veritapolicy` permission to View.
- [ ] As the seat user, navigate to `/veritapolicy`. Try to edit a policy. **Expected:** UI shows read-only state and any save attempt is rejected by the server.
- [ ] Repeat for `veritalab` (set seat to View, confirm certificate save is blocked) and `veritatrack` (set to View, confirm sign-off submit is blocked).
- [ ] Set all three back to Edit and confirm the seat can write again.

---

## Walk 3: Public-facing surface QC

- [ ] Navigate to https://www.veritaslabservices.com (logged out).
- [ ] Page renders; meta description shows "Performance verification" not "Method validation" (parking-lot, closed via PR #71).
- [ ] Navigate to `/veritacheck` (logged out). Title is "VeritaCheck™ | CLIA Performance Verification Software for Clinical Labs."
- [ ] Navigate to `/resources/laboratory-inventory-management`. Footer mentions VeritaStock™ as included (not "planned for a future release"; parking-lot #8, closed via PR #75).
- [ ] Spot-check `/roadmap`: VeritaStock is in the "Live" section, not "Coming Soon."

---

## Failure handling

- **One-off render bug:** screenshot, file path, and accreditor value go into a parking-lot item. Continue the smoke test.
- **Page does not load (5xx, white screen, JS error):** stop the smoke test, file a P1 parking-lot item, capture the browser console + Network tab.
- **Citation wrong for a specific accreditor:** stop the smoke test for that accreditor, capture the row ID and the wrong citation; file a parking-lot item under the v0.6 source-grounded rebuild (#5) since that is the active workstream for citation accuracy.

## Sign-off

After the walk completes:

- [ ] Record date and time.
- [ ] Record any failures and link to the parking-lot items filed for them.
- [ ] If clean across all 6 accreditation_choice values + module gates + public surface: mark the smoke test "PASS" and store the sign-off note alongside the saved VeritaScan PDFs in your accreditation evidence folder.
