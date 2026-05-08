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
codebase scope; user can request when ready. (Now tracked as #16.)

---

### 16. WSLH PT booth follow-up email

**What:** User met WSLH Proficiency Testing in person at COLA Nashville
2026 on 2026-05-07 (trade-show business card, UTM-tagged catalog URL
`utm_source=tradeshow&utm_medium=business_card&utm_campaign=catalog_page`).
A follow-up email is owed to the WSLH contact within the standard
post-conference window (~5-10 business days from booth meeting), pegging
the relationship before the warmth fades.

**Why this is parked, not done now:** User is still on the floor at
COLA. The right email depends on:

1. The exact WSLH contact name / title / email from the business card
   (user has the card; not in our system).
2. Whether the conversation was vendor-partnership intent (we list them
   as a recognized PT vendor in VeritaPT; they refer mutual labs back
   to us) or pure information-gathering ("here's our catalog, take a
   look").
3. Whether user wants to hand them anything tangible in the email
   (e.g., a screenshot of the WSLH card on the upcoming
   `/veritaassure` catalog, or a short Loom of the VeritaPT coverage
   matcher) — some of which doesn't exist until #15 ships the week of
   2026-05-11.

**Fix shape (when user is ready, post-COLA):**

- User shares: WSLH contact name, email, title, and 1-2 sentences on
  what was actually discussed at the booth.
- Draft a short (~150-200 word), no-em-dash email that:
  - Thanks them for the conversation by name.
  - States the integration we're committing to: WSLH as a recognized
    third PT vendor in VeritaPT, with program-code catalog mapping so
    a WSLH order line auto-credits coverage for the lab's analytes.
  - Names a target ship window (week of 2026-05-11, contingent on
    review).
  - Asks one specific question: confirm we're allowed to use the WSLH
    name + module codes in product UI, and whether they have an API
    or downloadable enrollment-quote schema we should target for the
    Tier L parser later.
  - Closes with a soft co-marketing ask (joint blurb on our
    `/veritaassure` page, mutual referral) only if the booth
    conversation went that direction.
- Reply-to: michael@veritaslabservices.com.
- Sign with full credential block (MS, MBA, MLS(ASCP), CPHQ).
- Confirm before send (per standing rule on outbound communications).

**Source:** 2026-05-07 conference user request; user said "Parking
lot the email" at 14:52 CDT after the WSLH catalog discussion.

**Status:** Open. Blocked on user returning from COLA with the WSLH
business card / contact details. No deadline this week; target send
day is 2026-05-11 or 2026-05-12 to land on a Monday/Tuesday inbox.

**Pre- vs post-COLA:** Post-COLA. User is on the booth floor today
and tomorrow; drafting an outbound vendor email mid-conference is
the wrong order of operations.

---

### 17. New flagship module: VeritaResponse (post-survey deficiency response)

**FLAGSHIP — Tier 1 product expansion. Sized larger than VeritaPT or
VeritaCheck. Treat with same architectural care as the original
VeritaAssure suite.**

**What:** A new module that helps a lab manage the full lifecycle of
responding to inspection deficiencies (CAP, TJC, COLA, CMS-2567,
AABB), from intake of a citation through corrective-action authoring,
supporting-evidence collection, submission tracking, and 30/60/90-day
effectiveness verification. Pairs with VeritaCheck (find gaps before
they cite you) and VeritaPT (prove your PT covers your menu) to
complete the compliance lifecycle: prevent → respond → prove.

**Why now:** Decision recorded 2026-05-07 at COLA Nashville booth.
User identified this as a high-value gap not covered by any of our
existing modules. CMS released QSO-25-19-ALL on 2025-06-17 shortening
the public-release timeline for CMS-2567 statements of deficiencies
from 90 days to 14 days, which materially raises the reputational
stakes on getting a fast, defensible response submitted. Most COLA
labs (small physician-office labs) have no coherent system for this
today — they use Word docs and email threads. This is the strongest
booth pitch we have for that segment.

**Common spine across all accreditors (the data model anchor):**

1. Citation/finding ID (their numbering)
2. Standard / regulation referenced
3. Description of the deficiency
4. Immediate / containment action
5. Root cause
6. Corrective action (what changed)
7. Preventive / system-level action (so it does not recur)
8. Effectiveness monitoring plan
9. Completion date
10. Signature / approval
11. Supporting evidence attachments

Accreditor-specific layer is just (a) which fields are required vs
optional, (b) field naming, (c) submission portal, (d) deadline
clock, (e) terminology. One normalized `findings` table with
per-accreditor renderer adapters.

**Accreditor matrix (researched 2026-05-07):**

- **CAP:** 30 days from inspection date. All online via e-LAB
  Solutions Suite (no email/fax/mail). Phase I = written response
  only. Phase II = written response plus supporting documentation.
  One response per checklist item, numerical order. Technical
  specialist back-and-forth. Decision target 50-75 days.
  Sources:
  https://documents.cap.org/documents/Guide-to-Accreditation_11_2025.pdf ,
  https://www.nsh.org/blogs/natalie-paskoski/2021/03/09/cap-deficiencies-and-how-to-avoid-them ,
  https://www.cap.org/laboratory-improvement/proficiency-testing/e-lab-solutions-suite

- **TJC:** 60 days from posted final report. Submitted via Joint
  Commission Connect (Survey Process > Post-Survey, or Review Process
  > Post-Review for certifications). Each Requirement for Improvement
  (RFI) gets its own ESC. May 2024 update: ESC must additionally
  document any factors impacting patient care found during root-cause
  analysis, including patient follow-up where applicable.
  Sources:
  https://www.jointcommission.org/en-us/knowledge-library/support-center/post-survey-or-review/what-is-evidence-of-standards-compliance ,
  https://barrins-assoc.com/tjc-cms-blog/behavioral-health/evidence-of-standards-compliance/

- **COLA:** Educational/consultative model. COLA technical support is
  free during corrective action plan development. Emphasis on "why"
  not just "what was fixed." 2-year cycle, ongoing PT monitoring.
  Source: https://cola.org/accreditation/

- **CMS / state surveyors (CLIA):** Form CMS-2567 "Statement of
  Deficiencies and Plan of Correction." Left column = surveyor's
  cited deficiency, right column = lab's plan. Returned within 10
  days of receipt, signed by lab director. Five required POC
  elements per State Operations Manual section 7314: (1) corrective
  action for affected patients/items, (2) identify others potentially
  affected, (3) systems/measures to prevent recurrence, (4) ongoing
  monitoring, (5) completion date. Condition-level deficiencies
  escalate to Directed Plan of Correction with 12-month hard deadline
  before CLIA cert revocation (42 CFR 493.1832). NEW 2025: public
  release at 14 days post-receipt instead of 90.
  Sources:
  https://www.cms.gov/medicare/cms-forms/cms-forms/downloads/cms2567.pdf ,
  https://apps.hhs.texas.gov/business/CBT/correctionplans-nf/Writing_Acc_POCs_for_NF_REV_NOV_2023_FINAL_print.html ,
  https://www.law.cornell.edu/cfr/text/42/493.1832 ,
  https://leadingage.org/cms-shortens-timeline-on-public-release-of-statements-of-deficiencies/

- **AABB:** Event/nonconformance-driven model rather than survey-only.
  Nonconforming Event Report (NER) form has Sections A-M with risk
  leveling 1-5, FDA notification within 45 days for reportable events,
  lead-staff review chain, CAPA evaluation. Different shape from
  CAP/TJC/CMS but same underlying spine.
  Source:
  https://www.aabb.org/docs/default-source/default-document-library/accreditation/commendable-practices/nonconforming-event-report.pdf

**Proposed data model (no schema yet, just shape):**

```
findings:
  id, lab_id, accreditor (CAP|TJC|COLA|CMS|AABB|Other),
  inspection_id, finding_number,
  standard_ref (e.g. GEN.20377 / 42 CFR 493.1251 / RFI 03.01.01.01),
  phase_or_severity (Phase I, Phase II, Condition, Standard, RFI,
                     NER risk 1-5),
  description, surveyor_notes,
  due_date (computed from accreditor-specific rule),
  status (open, drafting, submitted, accepted, rejected-resubmit,
          closed),
  immediate_action, containment, root_cause,
  corrective_action, preventive_action, monitoring_plan,
  completion_date, signed_by, signed_at,
  external_submission_ref (e-LAB ticket, JC Connect ID, CMS-2567
                           page#)

finding_attachments: finding_id, file, type
  (SOP, training log, QC chart, ...)

finding_history: finding_id, event, by_user, at, payload
  (audit trail, immutable)

finding_extension_requests: finding_id, requested_until, reason,
  status
```

**Per-accreditor renderer:** each accreditor gets a template adapter
that maps the common spine onto their required output. CAP gets a
per-checklist-item PDF. TJC gets ESC-formatted output. CMS gets a
CMS-2567 right-column populated PDF with all 5 POC elements
explicitly labeled. AABB gets the NER A-M structure. Same data,
different render.

**v1 must-haves beyond the obvious CRUD:**

1. **Due-date auto-computation** per accreditor rule (CAP =
   inspection_date + 30; TJC = report_posted + 60; CMS-2567 =
   receipt + 10; AABB = event-dependent). Calendar feed and email
   reminders at T-14, T-7, T-3, T-1.
2. **CMS-2567 renderer**: real left/right column PDF matching the
   federal form. Forces all 5 POC elements before submit. This alone
   is a big differentiator given the 14-day public-release rule.
3. **Five-elements coach**: blocks submission and tells the user in
   plain language which POC element is missing (same UX shape as
   the CLIA validator hedge from PR #62).
4. **Cross-link to VeritaCheck**: when a deficiency comes in citing
   GEN.20377, surface the most recent VeritaCheck score for that
   item ("Compliant last quarter, what changed?" or "At Risk —
   here's the mitigation we already drafted"). This is the moat. No
   standalone deficiency tool can do that.
5. **Effectiveness check tickler**: 30/60/90 days after
   completion_date, prompt the QA reviewer to attach monitoring
   evidence. Labs almost always drop this; surveyors love to ding it
   at the next inspection.

**Risks to address before build:**

- **Submission integration ceiling:** CAP e-LAB Suite and JC Connect
  are proprietary, online-only, no public API. We help the lab
  prepare and produce artifacts; they paste/upload. Marketing must
  be honest — this is a response-authoring and tracking tool, not a
  submission integration.
- **PHI surface:** TJC's May 2024 update requires patient-impact
  documentation. Strong recommendation: PHI-free zone. Narrative
  only, no patient identifiers; UI nudge "refer by internal case
  number, do not paste PHI." Avoids HIPAA exposure on a SaaS surface
  that small labs will sign up for via self-serve checkout.
- **Accreditor IP:** CMS-2567 is a federal form, public domain.
  CAP/TJC/AABB templates are proprietary. Mirror required CONTENT
  (mandated by regulation) without copying branded forms. Likely
  worth a courtesy contact with CAP and TJC before launch — follows
  the same vendor-side pattern as the WSLH outreach in #16.
- **Module weight:** 3-5 weeks for v1 covering CMS-2567 + CAP
  rendering only. Per-accreditor adapters added over time. Larger
  than VeritaPT or VeritaCheck.

**Scope tiers:**

- **Tier 1 (v1, ~3-5 weeks):** findings table + CRUD UI + CAP
  renderer + CMS-2567 renderer + 5-elements validator + due-date
  computation + email reminders + VeritaCheck cross-link surface.
  Single-accreditor-per-finding for v1; if a lab is dual-accredited
  CAP+TJC, they create separate finding records.
- **Tier 2 (v1.1, ~2-3 weeks):** TJC ESC renderer + COLA renderer +
  effectiveness-check tickler + extension-request workflow.
- **Tier 3 (v2, ~3-4 weeks):** AABB NER renderer + multi-accreditor
  finding linking (one event, two cited bodies) + trend analytics
  across multi-year inspections.
- **Tier 4 (deferred, indefinite):** any actual portal integration
  (e-LAB, JC Connect) only if the accreditor publishes an API.

**Naming chosen:** VeritaResponse. Confirmed by user 2026-05-07.
Alternates considered and rejected: VeritaResolve (more abstract),
VeritaCAPA (insider jargon, conflicts with the federal CMS-2567 "CAP"
acronym).

**Source:** 2026-05-07 conference user request, COLA Nashville. User
asked for thoughts and recommendations on adding a deficiency-response
module. Online research conducted same session covering CAP, TJC,
COLA, CMS-2567, AABB. URLs cited above.

**Status:** Open. Decision to build = Yes. Sequencing = Decide
later. User explicitly chose "decide later — just park for now" on
2026-05-07; will revisit after week of 2026-05-11 once COLA pipeline
is clearer and multi-lab Tier 2 sequencing is firmer.

**Pre- vs post-COLA:** Post-COLA. Build is multi-week regardless;
zero rationale for any code change before the conference ends.

**Cross-references:**

- Depends on multi-lab Tier 2 (#11, #12) for `lab_members` table —
  findings should belong to a specific lab, not a user. Not a hard
  block but cleaner if Tier 2 lands first.
- Cross-link with VeritaCheck (existing module) is a v1 feature, not
  a dependency.
- Pattern for accreditor-courtesy outreach echoes #16 (WSLH email).

---

### 18. Unregulated analyte / Alternative Assessment (AAA) coverage — cross-module gap

**Cross-module: touches VeritaScan, VeritaCheck, VeritaPT, and (later)
VeritaResponse #17. Treat as a single product capability with phased
delivery, not three separate fixes.**

**Question that prompted this (user, 2026-05-07 COLA Nashville):**
"In VeritaScan do we cover unregulated analytes that use alternative
verification and do not purchase PT?"

**Honest answer to user, recorded for posterity:** Partially. Today
VeritaScan / VeritaCheck have exactly one checkbox-grade item on
this topic (item #46: "Alternative performance assessment (APA) in
place for analytes without approved PT program?" citing GEN.19500 /
42 CFR §493.833). VeritaPT does not model AAA at all — its coverage
matcher only sees `pt_enrollments_v2` rows. The user's actual goal
(map a lab's complete reportable menu to a coverage source, PT or
AAA) is unmet.

**Why this matters:** The CLIA-regulated analyte list at
[42 CFR §§493.929-959 Subpart I](https://www.law.cornell.edu/cfr/text/42/part-493/subpart-I)
is finite. Everything else a lab reports is unregulated and falls
under 42 CFR §493.1236(c)(1) requiring twice-yearly verification of
accuracy via alternative methods. CAP enforces the same with
GEN.41770. So a lab's true coverage equation is:

```
reportable test menu = {regulated analytes : PT-required}
                     ∪ {unregulated analytes : AAA-required}
```

Our product currently scores the left set well (VeritaPT) and the
right set with one yes/no checkbox (VeritaScan #46). A surveyor
asking "show me your AAA program for albumin/globulin ratio" — a
calculated, unregulated analyte — leaves the lab on its own. This is
exactly the kind of gap that becomes a CAP Phase II deficiency or a
CMS-2567 condition-level finding under §493.1236, both of which
VeritaResponse #17 would later remediate. CMS QSO-25-19-ALL
(2025-06-17) made these citations publicly visible at 14 days post-
receipt instead of 90, so the reputational stakes are higher than
they used to be.

**Acceptable AAA methods (per CMS S&C 14-12-CLIA and CAP guidance):**

- Split-sample comparison with another laboratory of comparable or
  higher complexity
- Split-sample with a different method or instrument within the
  same lab
- Blind replicate testing of patient samples
- Calibration verification material with assigned values across the
  reportable range (when used for accuracy verification, not the
  CLIA-required calibration verification itself)
- Peer-group comparison via assayed control material with peer
  statistics (e.g. Bio-Rad Unity, API Sigma VP)
- Manufacturer-assayed control material with target values
- Clinical correlation review (limited — acceptable for some
  qualitative tests)
- Other documented method approved by lab director

**Required cadence:** at least twice per year per CMS
§493.1236(c)(1). CAP recommends matching PT cadence (3x/year) but
does not require it.

**Required documentation per surveyor expectation:**

1. List of unregulated analytes the lab reports
2. Method of alternative assessment per analyte
3. Cadence per analyte (must be ≥2/yr)
4. Acceptance criteria per analyte
5. Results of each event with pass/fail determination
6. Corrective action when failure occurs
7. Lab director review and signature
8. 2-year retention (same as PT records, per
   [42 CFR §493.1105(a)(8)](https://www.law.cornell.edu/cfr/text/42/493.1105))

**Decided scope (Option C — both, sequenced). User confirmed
2026-05-07.**

**Phase 1 — VeritaScan AAA mini-section (~½ day, post-COLA week of
2026-05-11):**

- Replace VeritaScan item #46 with a 4-5 item AAA sub-block in the
  Proficiency Testing domain. Renumber downstream items or use
  46a-46e to avoid breaking persisted scan results in the DB.
- Candidate items:
  1. Have you identified all unregulated analytes on your reportable
     menu and documented the list? (CFR §493.1236, CAP GEN.41770)
  2. Is each unregulated analyte assigned a documented alternative
     assessment method?
  3. Is alternative assessment performed at least twice per year per
     analyte?
  4. Are acceptance criteria defined and pass/fail determinations
     recorded for each AAA event?
  5. Does the lab director or designee review and sign AAA records
     at defined intervals?
  6. Are AAA records retained at least 2 years matching PT retention
     under §493.1105(a)(8)?
- This is a content-only change to
  `client/src/lib/veritaScanData.ts` plus matching strings in any
  exported PDFs / CSVs. No schema change required.
- Booth-credible within days; no real coverage logic yet.

**Phase 2 — Real AAA coverage in VeritaPT (~3-4 days, week of
2026-05-11 to 2026-05-18, after #15 lands):**

- New `aa_records` table (proposed shape, no schema yet):

  ```
  aa_records:
    id, lab_id,
    analyte (FK or text matching VeritaMap),
    method (split_sample_external | split_sample_internal |
            blind_replicate | calibration_verif_material |
            peer_group | manufacturer_material | clinical_correlation |
            other),
    method_notes,
    frequency_per_year (int, must be >=2),
    last_performed_date, next_due_date (computed),
    acceptance_criteria, last_result_summary,
    last_pass_fail (pass | fail | pending),
    corrective_action_ref (FK to VeritaResponse #17 finding when fail),
    director_reviewed_at, director_id,
    attached_evidence (file refs),
    retention_through_date (computed: last_performed + 2 years)
  ```

- Extend VeritaPT coverage matcher
  (`computePTCoverage()` in server/routes.ts ~line 6411) to union
  `pt_enrollments_v2` with `aa_records` and report THREE buckets per
  analyte on the reportable menu:
  - PT-covered (existing)
  - AAA-covered (new)
  - Uncovered (new — gap; surveyor finding waiting to happen)
- Dashboard tile / UI: "Menu coverage" with three counts; click into
  the Uncovered bucket to see which analytes need either PT
  enrollment or an AAA plan.
- AAA enrollment form mirrors the VeritaPT enrollment form pattern
  used for CAP/API/WSLH; method dropdown drives which fields are
  required.
- When `last_pass_fail = fail`, auto-prompt to open a VeritaResponse
  #17 finding (post-#17-launch). Until #17 ships, just surface the
  failure prominently in the UI and require corrective_action notes.

**Phase 3 (deferred, post-#17):** AAA-failure-to-finding linkage in
VeritaResponse so the same root-cause / corrective-action narrative
flows to surveyors without re-keying.

**Cross-references:**

- #15 (WSLH catalog mapping): same matcher, AAA is the second source
  of coverage truth after vendor-mapped PT. Phase 2 should ship
  AFTER #15 so the matcher is touched once.
- #17 (VeritaResponse): AAA failures are deficiency precursors;
  Phase 3 closes that loop.
- #11/#12 (multi-lab Tier 2): `aa_records.lab_id` should reference
  the new `lab_members` lab scope. Not a hard block; same stance as
  #17.
- VeritaScan item #46 (today): replaced by Phase 1 sub-block.
- VeritaCheck verification engine: cross-link from CFR §493.1236 and
  CAP GEN.41770 evidence prompts to the lab's AAA records.

**Booth posture (in effect from 2026-05-07 onward):**

If a prospect asks "do you handle AAA?" the answer is:

> "Yes. VeritaScan flags it today, and our coverage analyzer
> treats AAA as a first-class equivalent to PT, shipping next week.
> Our coverage report tells you exactly which analytes on your
> reportable menu are covered by purchased PT, which by alternative
> assessment, and which are uncovered, before a surveyor finds out
> for you."

User confirmed this booth answer 2026-05-07.

**Risks:**

- Phase 1 renumbering risk: existing scan results in the DB key on
  `id`. Use 46a-46e or a new id range (e.g. 169-173) to preserve
  historical scan data integrity. Audit any persisted ScanResult
  table before changing.
- Phase 2 reportable-menu source-of-truth: this requires the lab to
  have entered their full reportable test menu somewhere. VeritaMap
  may or may not be that source today. Confirm during Phase 2 design
  that we have a single canonical menu list per lab, not three.
- Phase 2 method-validity rules per analyte: not every method is
  appropriate for every analyte (e.g. clinical correlation is not
  acceptable for quantitative chemistry). Build a method-acceptable-
  for-this-test guard or accept that the lab director's signature is
  the validity gate.
- PHI surface (split-sample external) low risk: methods reference
  reference-lab name and date, not patient identifiers.

**Sources (researched 2026-05-07):**

- 42 CFR §493.1236(c)(1) (twice-yearly verification of accuracy):
  https://www.law.cornell.edu/cfr/text/42/493.1236
- 42 CFR Subpart I regulated analyte list:
  https://www.law.cornell.edu/cfr/text/42/part-493/subpart-I
- 42 CFR §493.833 (PT for nonregulated analytes — the basis for
  GEN.19500 / Scan #46):
  https://www.law.cornell.edu/cfr/text/42/493.833
- 42 CFR §493.1105(a)(8) (records retention):
  https://www.law.cornell.edu/cfr/text/42/493.1105
- CAP GEN.41770 (alternative assessment requirement) referenced in
  CAP All Common Checklist 2024 edition; primary source: CAP
  e-LAB Solutions Suite checklist export for client laboratories.
- VeritaScan item #46 today:
  client/src/lib/veritaScanData.ts:96

**Status:** Open. User confirmed Option C and Phase 1 + Phase 2
sequencing on 2026-05-07. Phase 1 target: post-COLA week of
2026-05-11. Phase 2 target: same week, after #15 ships.

**Pre- vs post-COLA:** Post-COLA. No code changes during the
conference; booth answer above bridges the gap verbally.

---

### 19. VeritaMap lab-wide menu toggle (cross-department / cross-map view)

**What:** Today VeritaMap's `veritamap_maps` table allows a single
user to own multiple named maps, and many labs split their setup
by department (Chemistry map, Hematology map, Coag map, Blood Bank
map, etc.) instead of building one monolithic map. When the user is
inside a single department map, there is no way to see the test menu
of their other maps without leaving the active map. Add a toggle
(`[ This map ] [ Whole lab ]`) inside VeritaMap that surfaces the
read-only union of all the user's maps as a lab-wide test menu view.

**Question that prompted this (user, 2026-05-08 COLA Nashville):**
"In VeritaMap, if a lab does individual department as opposed to a
monolith build, there needs to be a toggle switch where they can see
the full lab test menu (as opposed to the department map they are
currently in)."

**Current architecture (verified 2026-05-08):**

- `veritamap_maps`: id, user_id, name, instruments[], timestamps
  (server/db.ts:119). One user can own multiple maps. No `lab_id`
  yet — multi-lab Tier 2 (#11/#12) has not shipped.
- `veritamap_tests`: keyed by `map_id` only; no department column.
  Department lives on the instrument inside the map
  (`veritamap_instruments.category`), not on the test row directly.
- `veritamap_test_correlations`: cross-instrument method-comparison
  records, also scoped to a single `map_id` today.
- Department field options: Chemistry, Hematology, Coag, Blood Bank,
  Microbiology, Immunology, etc. — from `CATEGORY_ORDER` in
  client/src/pages/VeritaMapBuildPage.tsx.
- So a "monolithic build" lab uses department-on-instrument inside a
  single map; a "by-department build" lab creates one map per
  department. Both are structurally supported today; only the second
  has the toggle gap.

**Why this matters more than it looks (sequencing implication):**

The by-department-build labs are exactly the labs where #18
(unregulated analyte AAA coverage) and #15 (WSLH catalog mapping)
break silently. VeritaPT's coverage matcher
(`computePTCoverage()` in server/routes.ts ~line 6411) operates per
map, so a lab with 5 department maps gets 5 coverage scores instead
of one lab-wide score. **#18 Phase 2 is wrong by default for
multi-map labs unless the matcher is taught to union across maps,
or this fix lands first.** This is a hard sequencing dependency, not
an optional polish.

**Decided scope (Option A first, then upgrade to Option B inside #18
Phase 2). User confirmed 2026-05-08.**

**Phase 1 (~1 day, post-COLA week of 2026-05-11):**

- New top-level toggle inside VeritaMap UI:
  `[ This map ] [ Whole lab ]`. Persistent per-session selection.
- "Whole lab" view = read-only union of `veritamap_tests` across
  every `veritamap_maps` row owned by the same `user_id` today. (Lab
  scope refactor below.)
- Columns: analyte, source map name, source instrument, department
  (from instrument category), specialty, complexity, last calibration
  verification, last method comparison, last precision, last SOP
  review.
- Sort/filter on department, source map, analyte name.
- Surface duplicates explicitly: when the same analyte appears in 2+
  maps, flag with an icon and a tooltip "Same analyte in 2 maps —
  consider linking via method comparison." This is a useful nudge
  toward `veritamap_test_correlations` records.
- Read-only. To edit an analyte, click routes user back to its
  source map. No inline editing in v1.
- Empty-state copy when user has only one map: hide the toggle
  entirely (no value to show).

**Phase 2 (folded into #18 Phase 2, ~part of those 3-4 days):**

- Coverage matcher (`computePTCoverage()`) extended to operate on
  the lab-wide union of `veritamap_tests`, not a single `map_id`.
- Lab-wide "Menu coverage" dashboard tile: PT-covered / AAA-covered
  / Uncovered (the 3-bucket model from #18) computed across all
  maps.
- Gap analysis: analytes in CLIA Subpart I regulated list that are
  not present in ANY of the user's maps (= analytes the lab might
  not realize they're not running, or are running but not yet
  documented in VeritaMap).
- Duplicate-without-correlation analysis: same analyte in 2+ maps
  with no `veritamap_test_correlations` row = method-comparison gap;
  surveyor citation risk under 42 CFR §493.1281(a) and CAP COM.04250.
- Department-rollup counts on the lab-wide menu (e.g. "42 analytes
  across Chemistry, 28 across Hematology, 14 across Coag").

**Lab scope refactor (when #11/#12 multi-lab Tier 2 lands):**

- Today: union scope is "all maps where `veritamap_maps.user_id =
  current_user`."
- Post-#11/#12: union scope becomes "all maps where the map's
  owning user is a member of the active `lab_id` per `lab_members`
  table, AND the map is associated with that lab."
- Estimated cost of refactor: ~30 minutes once `lab_members` exists.
  Same pattern as the AAA records lab-id refactor in #18 Phase 2.
- Defensive: when shipping Phase 1, isolate the union query in one
  helper so the swap is one function later.

**Out of scope for v1 (deferred):**

- Inline editing in the unified view (raises "which map does this
  edit go to if the analyte is in 2 maps?" — real product question).
- Per-department editor permissions (Lisa-style hematology-director-
  only-edits-Hematology). Belongs with #11/#12 multi-lab role work,
  not here.
- A `veritamap_lab_views` parent table grouping multiple maps under
  one lab umbrella (Option C in user discussion). Premature without
  a real customer asking for cross-department editing.

**Booth posture (in effect from 2026-05-08 onward):**

If a prospect or current customer asks about per-department setups:

> "Yes — VeritaMap supports per-department setups today, and we're
> shipping a lab-wide menu toggle next week so you can see your full
> test menu across departments without leaving your active map. Our
> coverage analyzer will work on the lab-wide menu, not just the
> department you're currently in."

**Risks:**

- Performance: a lab with 5 maps and 200 analytes total is fine; a
  hospital with 30 maps and 2000 analytes might need pagination or
  virtualized rendering. Verify on the largest existing customer
  data shape before shipping.
- Map-name collisions across departments ("My Lab Map" used twice).
  Surface map IDs or created-at timestamps for disambiguation in the
  unified view.
- Read-only constraint may surprise users who expect to edit
  in-place. UI must communicate "click to edit in source map"
  affordance clearly.
- Empty state: hide toggle entirely if user has only one map (most
  current users); otherwise the affordance creates phantom
  expectations.

**Cross-references:**

- **#18 (AAA coverage):** HARD sequencing dependency. Phase 2 of
  #18 must operate on the lab-wide union from this entry, not
  per-map. Either ship #19 Phase 1 first, or build the union into
  #18's matcher directly.
- **#15 (WSLH catalog mapping):** same matcher; same sequencing
  benefit.
- **#11/#12 (multi-lab Tier 2):** lab-id refactor follows once
  `lab_members` exists. Defensive coding in Phase 1 isolates the
  scope query.
- **#17 (VeritaResponse):** future deficiency findings tied to a
  specific map's analyte should still surface in lab-wide search;
  no Phase 1 dependency.
- **veritamap_test_correlations:** the duplicate-without-correlation
  analytics in Phase 2 directly motivate use of this existing table;
  good moat-building.

**Sources:**

- 2026-05-08 conference user request, COLA Nashville. User goal
  recorded verbatim above.
- Code review 2026-05-08:
  - server/db.ts:119 (veritamap_maps schema)
  - server/db.ts:128 (veritamap_tests schema)
  - server/db.ts:145 (veritamap_test_correlations schema)
  - server/routes.ts ~line 6411 (computePTCoverage)
  - client/src/pages/VeritaMapBuildPage.tsx:520-528 (department
    select)
- 42 CFR §493.1281(a) and CAP COM.04250 (multi-instrument method
  comparison requirement) cited under Phase 2 duplicate analysis.

**Status:** Open. User confirmed Option A first / B in #18 Phase 2,
user_id-scoped now with lab_id refactor when #11/#12 lands,
read-only v1, on 2026-05-08. Phase 1 target: post-COLA week of
2026-05-11. Phase 2 target: folded into #18 Phase 2 same week.

**Pre- vs post-COLA:** Post-COLA. No code changes during the
conference; booth posture above bridges verbally.

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
