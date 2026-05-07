# VeritaAssure Parking Lot

Canonical, persistent record of items deferred from active work. This file
is the source of truth across sessions, replacing the old practice of
reconstructing the parking lot from chat history each time.

**Bootstrap rule:** every fresh VeritaAssure session reads this file as
part of step B2 (see `skills/veritaassure-bootstrap/SKILL.md`). Items in
the OPEN sections must be surfaced to the user during the session
briefing.

**How to use this file:**
- New parking-lot items get added under OPEN, dated, with a one-line
  source pointer (which session or screenshot surfaced it).
- When an item is shipped, it moves to CLOSED with a closure-evidence
  pointer (commit SHA, file/line that proves the change is live, or an
  explicit user statement).
- Never silently delete an item. If it turns out to never have been a
  real ask, move it to NOT CARRIED OVER with the reason.

**Recovery scope:** This file was created 2026-05-01 evening. Items
recovered from prior sessions are best-effort across the
past_session_contexts archive (earliest parking-lot mention found is
2026-04-27). Items parked in earlier sessions may need user recall.

---

## OPEN

### 1. UI relabel "CLIA TEa" -> "Lab-Set Internal Goal" when no canonical CLIA TEa exists

**What:** Several analytes have no §493 PT criterion (LIPASE, BILIRUBIN
UNBOUND/DIRECT, IRON SAT, and others). Today the platform forces the
user to pick a preset, which is functionally the same as forcing them
to invent a non-canonical value. Reports for those analytes cite §493
Subpart I, but §493 Subpart I does not contain a number for them, so
the citation is misleading.

**Fix shape:** When the analyte has no canonical CLIA TEa, the input
field labels and the resulting PDF/Excel report headers should read
"Lab-Set Internal Goal" instead of "CLIA TEa". The narrative should
read "Acceptance criterion: ±X% (laboratory-defined). Source:
laboratory director or designee policy. No CLIA PT criterion exists for
this analyte under 42 CFR §493 Subpart I."

**Source:** session 299e9a73, conversation lines 559, 653, 729 (around
2026-04-28).

**Status:** Open. Confirmed not yet implemented as of 2026-05-01: no
matches for "Lab-Set Internal Goal" or "labSetInternalGoal" in
client/src or server.

**Pre- vs post-COLA:** Open question. VeritaCheck improvements are
inside the freeze exception. User can pull this forward if desired.

---

### 2. Real Stripe checkout abandonment diagnostic using session data

**What:** A genuine diagnosis of whether checkout abandonment is
happening, using Stripe session data, rather than the text-parsed
inference that was incorrectly presented as diagnosis on 2026-04-27.

**Fix shape:** Pull abandoned checkout sessions from Stripe API, group
by drop-off step, surface in admin dashboard or as a daily report.

**Source:** session b2bfb4df, line 1366 (2026-04-27).

**Status:** Open. Confirmed not yet built as of 2026-05-01: no matches
for "checkout.session.expired", "abandoned.cart", or "abandonment" in
server code.

**Pre- vs post-COLA:** Post-COLA per the parking instruction.

---

### 3. VeritaPolicy "Non CLIA" chapter naming leaks generator taxonomy

**What:** server/cfrRequirements.ts chapter labels include strings like
"Non CLIA AABB Transfusion Practice" and "Non CLIA FDA cGMP 21CFR".
These appear on /veritapolicy for any lab that gets the CFR rows (i.e.,
every lab, since CFR is universal). The "Non CLIA" prefix is an
artifact of the generator script categorizing CFR rows by whether they
sit inside or outside 42 CFR Part 493 (CLIA), and that internal
taxonomy leaked to the user.

**Fix shape:** Rename chapters in cfrRequirements.ts to user-facing
labels. Candidates: "Transfusion Service - Federal", "Blood Bank cGMP
- 21 CFR Part 606", or restructure chapters by CFR title (21 vs 42).
Decision needs user input.

**Source:** CAP customer screenshot of /veritapolicy chapter headers,
2026-05-01 evening.

**Status:** Open. Phase 3.6 (commit 2600b3f) shipped a partial fix: the
UI now renders chapter_label only instead of "slug - chapter_label", so
the underscored slug no longer leaks. The "Non CLIA" wording itself is
still on screen.

---

### 4. VeritaPolicy service-line filtering removed

**What:** A CAP-only lab without a blood bank still sees all 21 CFR
Part 606 (FDA blood-bank cGMP) rows on /veritapolicy. The data has
service_line: "blood_bank" on most of these rows, but VeritaPolicy no
longer applies a service-line filter; the prior-session refactor pulled
the blood-bank/transplant/microbiology/maternal-serum toggles out and
replaced them with per-row N/A buttons.

**Fix shape:** UX decision (auto N/A vs. hidden vs. per-row N/A vs.
service-line picker). Then implement in
client/src/pages/VeritaPolicyAppPage.tsx and
server/routes.ts /api/veritapolicy/requirements.

**Source:** CAP customer screenshot of /veritapolicy, 2026-05-01
evening.

**Status:** Open.

---

### 5. v0.6 source-grounded rebuild of all 4 accreditor columns

**What:** AABB ids in aabbRequirements.ts (138/168 marked "real") and
COLA ids in colaRequirements.ts (167/168 marked "real") came from
agent generator output, not from a human cross-check against the
authoritative source documents (BBTS PDF for AABB, current COLA
checklist PDF for COLA). Same concern less acute for CAP (12 MAS xlsx)
and TJC (CAMLAB PDF + text extract).

**Fix shape:** Per the in-flight todo list at session start:
- Spawn CAP rebuild subagent (12 MAS xlsx files)
- Spawn TJC rebuild subagent (CAMLAB PDF + text extract)
- Spawn AABB rebuild subagent (BBTS PDF)
- Spawn COLA rebuild subagent (current checklist PDF)
- Review topical audits for each accreditor (gate: <10% wrong)
- Merge passing CSVs into v0.6 master citation index

**Source:** prior session handoff. Re-confirmed during 2026-05-01 QC
review.

**Status:** Open. Multi-hour subagent fan-out work.

**Pre- vs post-COLA:** Pre-COLA. May 6-8 conference; Saturday + Sunday +
Monday available before the booth.

---

### 6. Tier-1 smoke test of today's five-phase deploy stack

**What:** Phases 1, 2, 3, 3.5, 3.6 all live in production. Code review
and CI passed each one. End-to-end click-through as a logged-in lab
across each accreditation_choice value (TJC, CAP, AABB, COLA, CAP+AABB,
CLIA) was not done. VeritaScan PDF export with badges generated for
each accreditor type was not done. /veritapolicy and /veritacomp
end-to-end click-through was not done.

**Fix shape:** Process step. User logs in, clicks through each
accreditation_choice value, generates one VeritaScan PDF per
accreditor type, reports back what renders.

**Source:** 2026-05-01 evening QC review.

**Status:** Open. Process item, not a build.

---

### 7. Per-module gating on VeritaPT, VeritaPolicy, VeritaLab, VeritaTrack pages

**What:** These four pages call `useIsReadOnly()` with no module key, so
they only respect the base access level (`read_only` / `locked`) and
never check seat-level permissions. They appear in MODULE_LIST in the
seat invite UI, so an owner picking "Custom" and setting them to View
will see no effect on the seat user. Pages should call
`useIsReadOnly('veritapt')`, `useIsReadOnly('veritapolicy')`,
`useIsReadOnly('veritalab')`, `useIsReadOnly('veritatrack')` respectively
to match the rest of the modules.

**Fix shape:** Code change. Update the relevant page components to
pass their module key into `useIsReadOnly`. Add the same module key
to the corresponding write-side mutation routes via `requireModuleEdit`
middleware (mirroring the pattern in routes.ts for veritacheck etc).

**Source:** 2026-05-01 seat-permissions-mode review (PR #10, commit
a43fbba). Discovered while auditing MODULE_LIST coverage.

**Status:** Open. Not regression-causing; the four pages just
currently behave as if every seat user has edit access regardless of
MODULE_LIST setting for those keys.

---

### 8. FAQ + Roadmap pages still describe VeritaStock as "planned"

**What:** VeritaStock is shipped at /veritastock but the public FAQ
and Roadmap pages still classify it as planned/upcoming. Audit found
this when the user pushed back on the agent's initial mis-claim that
veritastock didn't exist (it did, just unrenamed in some places). The
public copy follows.

**Fix shape:** Copy edit. Update FAQ and Roadmap to reflect that
VeritaStock is live. Confirm any other public surface (TeamPage,
Features, comparison tables) doesn't carry the same staleness.

**Source:** 2026-05-01 David VeritaQA bug session.

**Status:** Open. Public copy bug, not a code bug.

---

### 9. VeritaScan has no sign-off date field, breaking cross-reference with VeritaMap

**What:** VeritaScan tracks scan items and completion, but has no
field for the date the director (or designee) signed off on the
scan / closed it out. The VeritaMap correlation feature (in flight
2026-05-03) is adding `signoff_date`, `signoff_by_user_id`, and
`signoff_by_name` so the regulatory-binding date drives `next_due`.
VeritaScan should follow the same pattern so a scan can tie back
to a sign-off event and (eventually) cross-reference VeritaMap
correlation sign-offs (e.g. "this VeritaScan finding was closed
by the same sign-off that closed Hem correlation group 47 on
2026-04-15").

**Fix shape:** Add `signoff_date`, `signoff_by_user_id`,
`signoff_by_name` to the VeritaScan completion path (likely
`veritascan_items` and/or a parent scan-level record). PRAGMA-guarded
ALTER per New DB Table Rule. Backend endpoints to record sign-off.
UI surface for director sign-off action. Cross-reference query so
VeritaMap correlation widget can link to VeritaScan items closed
under the same sign-off, and vice versa.

**Source:** Michael flagged 2026-05-03 during VeritaMap correlation
feature design conversation. Quote: "This is actually a worry of mine
with VeritaScan because it has nowhere to document the sign-off date
to tie back into VeritaMap and VeritaScan."

**Status:** Open. Deferred until after VeritaMap correlation feature
ships so the sign-off pattern is settled and reusable.

---

### 10. Operations module for cost-per-test calculations

**What:** A new VeritaAssure module (working name: VeritaOps or similar)
for laboratory cost-per-test calculations. Inputs span reagent cost,
calibrator cost, control cost, QC frequency, instrument depreciation,
labor (tech time per run, per result), batch sizes, send-out blends,
and overhead allocation. Output: per-test cost with breakdown, plus
throughput and break-even analysis.

**Fix shape:** TBD. Needs a scoping question pass before any code:
which cost dimensions are in scope for v1, what data the user already
has vs needs to enter, how it integrates with VeritaMap (test list)
and VeritaScan (volume), report shapes (PDF, Excel), and whether it
needs its own subscription tier or rolls into an existing one.

**Source:** This thread, 2026-05-07 12:05 PM CDT, user message:
"Parking lot:  build an operations module for cost per test
calculations."

**Status:** Open. Not started. Memory entry exists at
work.projects.veritaassure.operations_module.

**Pre- vs post-COLA:** Post-COLA. New module, not on the conference
demo path.

---

### 11. Multi-lab pricing model — Option A (full price per lab, no baseline discount)

**What:** Decision recorded for how multi-lab system accounts (one
human owning multiple labs) are priced. Lisa Veri is the canonical
case: Hospital tier on UMass Memorial Milford + Clinic tier on a
second lab she owns. Decision: each lab is its own independent
subscription at full tier price. No published multi-lab discount.
Custom deals handled per-customer via Stripe coupon at owner's
discretion (email-only, not on pricing page).

**Fix shape:** Pricing page shows one line: "Managing multiple labs?
Email us." Each lab gets its own Stripe subscription, its own renewal
date, its own seat count, its own tier, its own CLIA. No
`parent_lab_id` linkage in billing. Self-serve "Add another lab"
checkout deferred (Tier 3); manual Stripe creation for the first few
cases is fine.

**Source:** 2026-05-07 multi-lab discussion (this session), Lisa Veri
bringing online a second lab.

**Status:** Open. Decision recorded; build deferred to post-COLA.

**Pre- vs post-COLA:** Post-COLA. Tied to Tier 2 (multi-lab data
layer) build.

---

### 12. Primary-lab seat counting — owner counts on primary lab only, free on secondaries

**What:** Decision recorded for how the lab owner consumes seats when
they own multiple labs. Owner burns one paid seat on their primary
(first) lab. On every additional lab they own, they are a free
implicit seat. Only invited users count against per-lab seat caps on
secondary labs.

**Fix shape:** Add `is_primary_lab` flag (likely on a new
`lab_members` join table replacing the single `users.lab_id` FK).
Default to first lab created; owner can change which lab is primary
via Account Settings. Update seat-cap enforcement to honor the
primary-lab rule. Confirm whether seat-enforcement code needs
refactoring (separate read scoped for this).

**Source:** 2026-05-07 multi-lab discussion (this session).

**Status:** Open. Decision recorded; build deferred to post-COLA.
Depends on Tier 2 (multi-lab data layer).

**Pre- vs post-COLA:** Post-COLA.

---

### 13. CLIA number format validation (client + server)

**What:** Today the CLIA number field accepts any string. Lisa's row
in production has two comma-joined CLIAs ("22D0070843, 22D1077821")
as a result of single-lab schema not supporting multi-lab. New
customers can enter malformed CLIAs that pass through to PDF/Excel
report headers and external sources of truth.

**Fix shape:** Centralized `shared/validateClia.ts` helper. Regex
`^\d{2}D\d{7}$` after stripping whitespace/dashes and uppercasing the
D. Validated client-side in onboarding wizard + AccountSettingsPage,
and server-side on every write path that touches `clia_number`. Error
message: "Must be 10 characters: 2 digits, 'D', then 7 digits — e.g.,
22D0070843." Format-only — no live CMS database lookup. Existing
non-conformant rows continue to load and display unchanged;
validation only blocks **new save attempts** with malformed values.
Retroactive cleanup of Lisa's row deferred until Tier 2 multi-lab
data layer ships.

**Source:** 2026-05-07 multi-lab discussion (this session). Triggered
by admin report screenshot showing comma-joined CLIAs in Lisa's row.

**Status:** Open. Approved to ship as a hedge during COLA — minimal
scope (save-time validation only, no retroactive enforcement).

**Pre- vs post-COLA:** Pre-COLA hedge approved 2026-05-07. Smallest
viable shape to prevent new customers from entering malformed CLIAs.

---

### 14. Admin report — render one row per lab instead of one row per user

**What:** Admin report currently shows one row per user, which causes
Lisa's row to display two CLIAs concatenated in a single cell
("22D0070843, 22D1077821"). The data layer is already lab-aware (two
`labs` rows under her user), but the report query and rendering are
user-centric.

**Fix shape:** Rewrite admin report query to `SELECT FROM labs JOIN
users ON labs.owner_user_id`. One row per lab, with its own CLIA,
tier, status, and primary contact. Owners of multiple labs (Lisa)
appear in the Primary Contact column on multiple rows. Stats label
becomes "Total Labs" (or both Total Accounts and Total Labs).

**Source:** 2026-05-07 multi-lab discussion (this session). Admin
report screenshot showed concatenated CLIAs.

**Status:** Open. Decision recorded; build deferred to post-COLA to
minimize demo risk during conference.

**Pre- vs post-COLA:** Post-COLA. Read-only view change but considered
slightly higher demo risk than CLIA validation alone.

---

### 15. Add WSLH PT as third PT vendor with full catalog mapping

**What:** Today VeritaPT recognizes only two named vendors
(`pt_enrollments_v2.vendor` is `CHECK(vendor IN ('CAP', 'API', 'Other'))`).
WSLH PT (Wisconsin State Laboratory of Hygiene Proficiency Testing) is
a CMS-approved PT provider accepted by CAP, TJC, and COLA, and the
user met them in person at the COLA Nashville 2026 booth on
2026-05-07 (trade-show business card + UTM-tagged catalog URL
confirms direct contact). User's stated goal: map their products to
VeritaMap so VeritaPT can verify that a WSLH order line actually
covers the analytes a lab runs, same as CAP and API today.

**Why it works for our matcher:** WSLH publishes module/program codes
(e.g., 1310-1322 = general chem panel, 1260 = cardiac BNP/troponin,
1080 = blood lead, 1524 = HbA1c, 4190 = HBV/HCV serology, 2230-2370
= hematology by instrument family). Each module is a stable
analyte-list bundle that maps cleanly onto our existing `pt_category`
strings. No new categories needed; the coverage matcher in
`computePTCoverage()` (server/routes.ts ~line 6411) already keys on
`pt_category`, not vendor.

**Fix shape (Tier M, ~½ day):**

1. Migration: drop the `CHECK(vendor IN ('CAP','API','Other'))`
   constraint on `pt_enrollments_v2`; replace with
   `CHECK(vendor IN ('CAP','API','WSLH','Other'))`. SQLite requires
   table rebuild for CHECK changes — do via
   `CREATE TABLE pt_enrollments_v2_new ... ; INSERT SELECT ... ; DROP ; RENAME`
   pattern, idempotent like the other db.ts migrations.
2. Add `'WSLH'` to `users.preferred_pt_vendor` allowed values
   (currently free-text, just update the AccountSettings dropdown +
   any UI guards).
3. Create `shared/wslhCatalog.ts` mirroring the structure of the
   existing `cliaAnalytes` data: `{ programCode, programName,
   ptCategory, analytes[], shipmentsPerYear, samplesPerShipment,
   notes }`. Source: WSLH 2022 Clinical Catalog PDF
   (https://www.slh.wisc.edu/wp-content/uploads/2021/08/WSLHPT_2022_Clinical_Catalog-1.pdf)
   plus 2025 CMS regulated-analyte updates
   (https://wslhpt.org/clia-and-proficiency-testing-changes/). Refresh
   to 2026 catalog when WSLH publishes it ("Coming Soon" on their
   page as of 2026-05-07).
4. VeritaPT enrollment form: when vendor=WSLH, surface a program-code
   autocomplete sourced from `wslhCatalog.ts`. Selecting a code
   auto-fills `program_name` and `pt_category`.
5. Render WSLH alongside CAP and API anywhere vendor logos appear
   (account settings, VeritaPT dashboard, coverage report PDFs).
6. Unit test the catalog: every entry must have a `pt_category` that
   exists in our coverage map; no orphan categories.

**Out of scope for Tier M (deferred to Tier L or later):** parsing
WSLH enrollment-quote PDFs/CSVs to bulk-create enrollments. Manual
entry by program code is fine for v1.

**Source:** 2026-05-07 conference user request, WSLH catalog URL
shared via business card with UTM tags `utm_source=tradeshow`
`utm_medium=business_card` `utm_campaign=catalog_page`. User explicit
goal: "map their products to our veritamap and use veritapt to
document what PT materials were purchased to ensure full PT coverage
for the site."

**Status:** Open. Decision recorded 2026-05-07. Build deferred to
post-COLA week of 2026-05-11 to honor the conference deploy freeze
(same rationale as items #11, #12, #14).

**Pre- vs post-COLA:** Post-COLA. CHECK constraint change requires
table rebuild — non-trivial migration during a live demo week is
out. No customer is blocked today; vendor=Other works as a
placeholder if any booth lab signs up before the build ships.

**Follow-up artifact owed (separate task):** WSLH partnership
follow-up email template tied to the booth meeting. Not in the
codebase scope; user can request when ready.

---

## CLOSED (audit trail)

### C1. FAQ "over 25 years" -> "over 23 years"

**Closure evidence:** client/src/pages/FAQPage.tsx line 20 reads "over
23 years" as of 2026-05-01.

**Source:** session 299e9a73 turn 14, ~2026-04-28.

---

### C5. David's VeritaQA grey-button bug (seat permissions mode)

**Closure evidence:** PR #10 squash-merged as commit a43fbba on
2026-05-01 23:19 MST. Railway deploy succeeded; deployed bundle
(`/assets/index-CBVwW2mk.js`) confirmed to contain new strings
('VeritaQA™ Suite', 'VeritaStock™', 'edit_all', 'view_all',
'Inherits future modules'). Resolver in shared/schema.ts
(`resolveSeatPermission`) auto-upgrades David's stored permissions
(9-of-9 keys = edit, veritabench/veritastock absent) to effective
edit on the new modules without any DB write. Verified locally
against his exact stored shape (14 of 14 expected outcomes matched).

**Source:** 2026-05-01 David's report; veritabench + veritastock
weren't in MODULE_LIST so seat permissions silently defaulted to
view, greying the browse button on /veritabench/pi line 323.

---

### C2. TeamPage present-tense "TJC surveyor" check

**Closure evidence:** site-wide search confirmed all surveyor language
is past-tense, consistent with user's 2021-2025 service. User closed
the item in session 299e9a73 turn 4.

**Source:** session 299e9a73, ~2026-04-28.

---

### C3. My Studies CSV/XLSX export (John as design partner)

**Closure evidence:** client/src/pages/DashboardPage.tsx line 46 calls
`/api/my-studies/export`. server/routes.ts line 1491 implements the
endpoint. Pulled forward into pre-COLA per user instruction.

**Source:** session 299e9a73 turn 5, ~2026-04-28.

---

### C4. Rotate GitHub PAT (because old PAT was committed in SESSION_HANDOFF files)

**Closure evidence:** no `ghp_*` or `github_pat_*` patterns in current
SESSION_HANDOFF.md or SESSION_HANDOFF-2.md as of 2026-05-01.

**Source:** session 299e9a73, ~2026-04-28.

---

## NOT CARRIED OVER (explicitly rejected)

### R1. Rotate Railway token because it appeared in chat

**Reason:** Per session 299e9a73 turn 7 (and STANDING_REQUIREMENTS.md
"CREDENTIAL HANDLING" section): tokens the user pastes in our chat are
not a leak; the agent does not auto-park rotation. The original "rotate
GitHub PAT" item was added because the PAT had been written into
committed SESSION_HANDOFF.md files in past sessions and pushed to the
repo, which is an actual leak. Token-in-our-conversation is not.

**Source:** session 299e9a73 turn 7, ~2026-04-28.

---
