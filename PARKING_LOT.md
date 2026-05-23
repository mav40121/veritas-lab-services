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

### 3. VeritaPolicy "Non CLIA" chapter naming leaks generator taxonomy

**CLOSED 2026-05-22 — see CLOSED C18 below.**

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

### 10. Operations module for cost-per-test calculations

**CLOSED 2026-05-22 — see CLOSED C22 below.**

---

### 11. Multi-lab pricing model — Option A (full price per lab, no baseline discount)

**CLOSED 2026-05-22 — see CLOSED C21 below.**

---

### 12. Primary-lab seat counting — owner counts on primary lab only, free on secondaries

**CLOSED 2026-05-22 — see CLOSED C20 below.**

---

### 16. WSLH PT booth follow-up email

**NOT CARRIED OVER 2026-05-21 — see NOT CARRIED OVER R6 below.**

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

**STATUS (as of 2026-05-22): Phases 1 and 2 SHIPPED. Phase 3 deferred
behind #17 (VeritaResponse, not yet built).**

- **Phase 1 shipped:** VeritaScan AAA mini-section (post-COLA, prior session).
- **Phase 2 shipped:** Real AAA coverage in VeritaPT plus the coverage-union UI (PR #18 in the in-session task tracker, Phase 2v2). Reportable-menu source-of-truth uses the lab-entered list; coverage matcher reads both `pt_enrollments_v2` and AAA records.
- **Phase 3 still deferred:** AAA-failure-to-finding linkage. Requires VeritaResponse (PARKING_LOT #17) to exist as the deficiency-response surface that the linkage points at. Cannot ship until #17 ships.

The rest of this entry is the original scoping context, preserved for the eventual Phase 3 work. Skip to "Phase 3 (deferred, post-#17)" further below for the specific deferred work.

---

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

**Status:** PARTIAL as of 2026-05-10.

- Phase 1 (VeritaScan AAA sub-block, items 169-173) **CLOSED** via
  PR #78 (`client/src/lib/veritaScanData.ts`). Item #46 retained as
  AAA gateway; new 5-item block uses ids 169-173 to preserve historical
  scan data integrity.
- Phase 2 v1 (data layer) **CLOSED** 2026-05-10 via PR #80 (merge
  commit 98d184a): `aa_records` table added in `server/db.ts` with
  method CHECK constraint and `frequency_per_year >= 2` CHECK; four
  CRUD endpoints under `/api/pt/aa-records` in `server/routes.ts`.
- Phase 2 v2 (UI + coverage union) **CLOSED** 2026-05-21 (status drift
  audit). All three deliverables verified shipped in current code:
  AAA enrollment form lives in `VeritaPTAppPage.tsx` (modal opened by
  "Manage AAA Records" button); `computePTCoverage()` in
  `server/routes.ts:8486` already unions `pt_enrollments_v2` with
  `aa_records` (lines 8513-8540) and returns 5-bucket summary
  including `aaaCovered`; dashboard renders the AAA-Covered tile at
  `VeritaPTAppPage.tsx:309`. The "STILL OWED" annotation was status
  drift; the work shipped sometime after the data layer but the
  parking lot was not updated.
- Phase 3 (AAA-failure-to-finding linkage) remains deferred pending
  #17 launch.

**Pre- vs post-COLA:** Post-COLA. Phase 1 and Phase 2 data layer
shipped 2026-05-10.

---

### 19. VeritaMap lab-wide menu toggle (cross-department / cross-map view)

**CLOSED 2026-05-10 — see CLOSED C8 below.**

(Original entry preserved below for historical context. Subsequent
sections in the file may still reference #19 as a sequencing
prerequisite for #18 Phase 2; that dependency has been satisfied by
the closure.)

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

## COMPETITOR-DRIVEN CANDIDATES

Six items added 2026-05-10 from a Perplexity competitor analysis of
myLabCompliance.io (encountered at the COLA conference). The analysis
identified gaps where the competitor ships features VeritaAssure does
not. Each item below preserves the analysis source so future agents
do not re-derive Perplexity's recommendations as their own.

Pricing comparison is intentionally NOT included as a parking-lot
item. Operator flagged it as "a separate conversation, not a parking
lot item until you decide" (2026-05-10).

---

### 20. Live QC engine (Levey-Jennings + Westgard)

**What:** A daily-use QC workflow: Levey-Jennings charts, Westgard
multi-rule violation detection, control lot management, automated QC
scheduling. Today VeritaAssure documents QC posture (sign-offs,
records, retention); it does not run the QC. The COLA segment (small
physician-office labs, urgent care, ER) lives in daily QC and will
pick the tool that draws their L-J chart.

**Why this matters:** Per Perplexity analysis 2026-05-10, this is the
single largest gap vs. myLabCompliance.io. Without it, VeritaAssure
is a compliance documentation tool; with it, it becomes a lab
operations platform. Strongest pitch for the COLA-segment audience
the operator just met.

**Fix shape:** Flagship-scale module. Hard build: multi-rule logic
(1-2s, 1-3s, 2-2s, R-4s, 4-1s, 10-x, etc.), statistical control
(SD, CV, mean tracking per lot), lot-bridging studies (parallel
testing of old vs new lot, mean-shift detection), automated alerts.
Pairs with VeritaCheck (verification studies feed initial ranges)
and VeritaTrack (QC sign-offs).

**Source:** Perplexity competitor analysis (myLabCompliance.io),
2026-05-10. Operator forwarded the analysis; no decision yet.

**Status:** Open. Scoping doc required per Section 8 Process Rules
("Large tasks: present a build breakdown first, get approval, THEN
build") before any code.

**Pre- vs post-COLA:** Post-COLA. Multi-week scoping + multi-month
v1 build. Comparable in scale to VeritaResponse (#17).

---

### 21. VeritaStock — lot tracking, expiration monitoring, reorder alerts

**CLOSED 2026-05-21 — see CLOSED C15 below.**

---

### 22. CMS-116 application support + state licensing tracking

**What:** CMS-116 is the federal CLIA application form. Today
VeritaPolicy covers ongoing CLIA posture but not the application
itself. The form is also relevant at certificate-type changes (waived
to moderate, moderate to high). State licensing tracking is the
adjacent piece: many states require their own licensure on top of
CLIA.

**Fix shape:** Concrete, narrow, finite. Form-fill UX for CMS-116,
with state-licensure registry per state (each state's authority,
form, fee, renewal cadence). Pairs with VeritaPolicy and VeritaLab.

**Source:** Perplexity competitor analysis (myLabCompliance.io),
2026-05-10. myLabCompliance.io has this; VeritaAssure does not.

**Status:** Open. Small build relative to the other competitor-driven
candidates. Useful at lab startup and at certificate-type changes.

**Pre- vs post-COLA:** Post-COLA. ~1-2 weeks for v1 (CMS-116 form +
top-10-state licensure registry).

---

### 23. PAL studies as a dedicated guided workflow (conditional)

**CLOSED 2026-05-21 — see CLOSED C16 below.**

---

### 24. Mini-LIS module

**NOT CARRIED OVER 2026-05-21 — see NOT CARRIED OVER R4 below.**

---

### 25. Phlebotomy module

**NOT CARRIED OVER 2026-05-21 — see NOT CARRIED OVER R5 below.**

---

### 26. Source-ground the 21 CFR / 29 CFR / 45 CFR / 42 CFR 482-485 portions of cfrRequirements.ts

**CLOSED 2026-05-21 — see CLOSED C17 below.**

---

### 27. Acquire CAP MOL (Molecular) checklist to verify 2 pending entries

**What:** PR #108 left 2 entries in `server/capRequirements.ts`
flagged as unverified because the operator does not hold the CAP MOL
(Molecular Pathology) MAS xlsx file:

- `MOL.35855` - NGS HLA Discrepancy Resolution
- `MOL.37460` - Contamination Control

The other 11 CAP modules (ANP, CHM, COM, CYP, DRA, GEN, HEM, IMM,
MIC, POC, TRM, URN) were verified against the 12 MAS files held on
the operator's local drive at
`C:/Users/veril/OneDrive/Desktop/Lab/Regulatory/2026 Cap checklists/`.
The MOL module's MAS xlsx is the only one missing from that set.

**Fix shape:** Operator obtains `MAS_MOL_12092025_Long_*.xlsx` from
CAP e-LAB Solutions Suite (download requires CAP accreditation
credentials). Drops the file in the same folder. Re-run
`fix_cap_fabricated_ids_v10.py` with the MOL module included to
verify these 2 IDs exist; if either is fake, substitute against the
real MOL Subject Headers using the same surgical-replacement
discipline.

**Source:** PR #108 commit 92f9573 (closed via merge 2026-05-11),
audit findings.

**Status:** Open, blocks on operator obtaining the MOL checklist.

**Pre- vs post-COLA:** Post-COLA. Two entries; low traffic.

---

### 28. Acquire AABB Standards 35th edition + current COLA Accreditation Manual for exhaustive citation verification

**What:** The 2026-05-11 QC audit found that VeritaScan, cfrRequirements
cross-refs, and colaRequirements.ts cite about 180 AABB and COLA codes
that the public compilations
(`build_aabb_pdf.py` / `build_cola_pdf.py`) do not cover. These are
format-valid (correct chapter prefix and section format) and the master
citation index treats many of them as real, but they cannot be
exhaustively verified against authoritative source until the gated
accreditor manuals are held.

Examples (representative; not exhaustive):
- AABB: `1.2.3`, `1.2.4`, `1.3.3`, `2.1.6`-`2.3.2`, `3.1.1`+ - sequential
  AABB Standards for Blood Banks and Transfusion Services 35th edition
  (effective April 1, 2026) chapter codes.
- COLA: `APM 2`-`APM 16`, `CA 3`-`CA 6`, `FAC 11`-`FAC 14`,
  `MA 4`, `PST 23`, `VER 9` - real COLA criterion codes that the
  public 2013 manual + LabGuides + 2019 Validation excerpts compilation
  does not enumerate fully.

**Fix shape:** Operator obtains the gated manuals (AABB Standards via
AABB enrollment; current COLA Accreditation Manual via the lab's
COLA enrollment). Once held, an exhaustive ID set is extracted and the
QA audit re-run. Any format-valid code that still does not appear in
the real manual gets surgical replacement; any code already in the
manual is confirmed and the "compilation gap" flag in PROVENANCE.md
is downgraded.

**Source:** 2026-05-11 QC/QA audit, documented in
`OneDrive\Lab\Regulatory\aaa Truth Master Document\PROVENANCE.md`
"Audit-coverage limits" section.

**Status:** Open, blocks on operator obtaining the gated accreditor
manuals. Until then, AABB / COLA citations are best-effort against
the public-source compilations.

**Pre- vs post-COLA:** Post-COLA. Operator-side action item, no code
work pending until the source documents land.

---

### 29. VeritaStock barcode scanning (full mobile scan flow)

**What:** The remaining barcode-scanning build for VeritaStock, scoped
during the 2026-05-20 Pfizer follow-up discussion. Order-now reorder
document (PDF + Excel) already shipped in PR #286. This item is the
mobile scan companion that turns VeritaStock into a true Unity Lab
Services-class inventory product.

**Full scope (12 working days):**
- Day 1: barcode generation library + "Print Labels" PDF endpoint
  (Avery 5160, 30 labels per sheet)
- Day 2: schema additions (`barcode_value` column on
  `inventory_items` + `scan_events` audit table) with ALTER TABLE
  migration pattern
- Day 3: PWA shell - manifest, service worker, install prompt,
  mobile-first layout
- Day 4: scanner page - camera access via MediaDevices API,
  zxing-js decode, item lookup, quantity entry, submit
- Day 5: scan-history view per item + scan-events Excel audit export
- Day 6: edge cases - offline scan queue with local IndexedDB,
  permission-denied UX, seat-user scan permissions
- Day 7: real-device testing (iOS Safari + Android Chrome) + verify
  script
- Day 8: polish, marketing copy, roadmap page update, docs, Gate 3
  prod verify
- Day 9-10: offline queue hardening + mobile UI polish + error states
- Day 11-12: label-printing wizard + item-catalog CSV import +
  onboarding flow

**Why parked vs build now:**
- No paying customers yet for VeritaStock specifically
- Pfizer expressed interest but has not committed; quote and pricing
  discussion still in flight as of 2026-05-21
- Pre-sell strategy decided: trigger build on first paid commitment
  rather than speculative-build
- "Coming Q3 2026" badge in marketing copy serves as signal-of-demand
  capture in the meantime

**Pricing model (locked during 2026-05-21 strategy session):**
- Barcode scanning is INCLUDED FREE on every Clinic+ tier that has
  VeritaStock (per the gate-by-cost-to-deliver principle - the
  feature costs zero per customer to deliver after build)
- Optional onboarding service: $1,500 flat (covers custom label
  generation, CSV catalog import, 1-hour training Zoom)
- Marketing line: "Unity Lab Services charges $30K+/year for barcode
  scanning. We include it free with VeritaStock. Optional onboarding:
  $1,500 flat. No tier upgrade required."

**Technical anchors locked:**
- PWA (Progressive Web App), NOT native iOS/Android apps - phone
  camera works fine for lab volumes (200-400 items per round, not
  Amazon-warehouse scale)
- Libraries: zxing-js (scanning) and bwip-js (label generation) -
  both MIT/Apache, $0 cost
- No third-party services, no app store fees, no new infrastructure
- Reuses existing JWT auth and multi-lab scoping

**Out-of-pocket cash cost: $0.** Time cost: ~12 dev days + ~6 hours
of operator testing.

**Trigger to build:** First paid commitment from Pfizer or any other
Hospital/Enterprise prospect that names barcode scanning as a
requirement. Pre-sale closes via the Pfizer email or a similar
inbound, then build kicks off the same day.

**Source:** 2026-05-20 Pfizer follow-up session, after the order-now
reorder document shipped (PR #286). Strategic decision documented in
the team pricing analysis docx at
`C:\Users\veril\Downloads\VeritaAssure-Pricing-Analysis-2026-05-21.docx`
(version 2). The Request-an-Instrument feature (PR #293) was built
instead as the durable customer-feedback channel for VeritaMap;
barcode scanning waits on revenue commitment.

**Status:** Parked pending first paid commitment.

---

### 30. Plain-language summary layer for verbatim CFR citations

**What:** `server/cfrRequirements.ts` carries verbatim eCFR text in
the `description` field (PR #301 closed #26). The verbatim text is
authoritative but written for regulators, not lab directors. A
plain-language paraphrase next to the verbatim would help the
director read faster.

**Status (after 2026-05-21 session):** Partially shipped, then
partially reverted. Lessons learned the hard way.

**What was shipped and kept:**

- PR #309: optional `summary?: string` field added to
  `CFR_REQUIREMENTS`, populated for 5 high-traffic standards
  (§493.1235, §493.1252, §493.1253, §493.1281, §493.1289).
  Operator approved the writing voice on those 5 summaries.
  Data layer remains on file as inert content. No UI surface
  currently reads it.

**What was attempted and reverted:**

- PR #310: a new "Lab Requirements Index" Excel route plus button
  on VeritaPolicyAppPage. One row per citation, columns for
  Source / Citation / Section Title / **Verbatim Text** /
  **Plain-Language Summary** / accreditor cross-refs. Reverted
  2026-05-21 (PR #312) because the "Verbatim Text" column header
  applied to CAP / TJC / COLA accreditor rows whose descriptions
  are paraphrases of copyrighted accreditor manuals. Labelling
  paraphrased copyrighted content as verbatim is the issue, not
  the column itself. See [[feedback_no_verbatim_label_accreditor_content]].
- PR #312 second commit: a "Plain-Language CFR Summary" column on
  the existing Master List Excel that looked up each row's cited
  CFRs in the summary map and concatenated matches. Reverted
  2026-05-21 (PR #313) because the same CFR-section summary
  attached to every Master List row that cited the section --
  §493.1235 (competency) ended up on PPE Policy, Privacy Policy,
  Information System Policy rows, etc. CFR-section-scoped
  summary content does not fit policy-row-scoped Master List
  rows. See [[feedback_cfr_summary_is_cfr_scoped_not_policy_scoped]].

**Future-redesign requirements (what the next attempt must satisfy):**

- Author summaries at a scope that matches the destination surface.
  If the destination is the Master List Excel (one row per policy),
  the summary text must live in `veritapolicyMasterList.ts` and be
  authored one paraphrase per policy_id. CFR-section-scoped text
  belongs on a CFR-scoped surface (a glossary, or an inline tooltip
  on the CFR citation itself), not on a policy-scoped row.
- Any surface that mixes CFR rows (verbatim safe) with accreditor
  rows (paraphrase only) must split column headers or only render
  the verbatim-implying label on CFR rows. Do NOT use one column
  header that claims verbatim for both.
- The 5 summaries already in `cfrRequirements.ts` are valid as
  CFR-section glossary content. They are inappropriate as
  Master-List-row content.

**Effort if redesigned at policy-row scope:** Per-policy writing for
the 96 Master List rows is a multi-day content project, not a
quick pilot.

**Pre- vs post-COLA:** Post-COLA. No customer urgency. Operator
has not yet authorized a redesign attempt as of 2026-05-21.

---

### 31. VeritaStock department-scope toggle (VeritaMap pattern)

**CLOSED 2026-05-22 — see CLOSED C19 below.**

---

### 32. Lab leader community / forum (paid subscription idea)

**What:** Operator-floated 2026-05-22: a vetted online forum for
laboratory leaders (directors, managers, supervisors). Pricing as
proposed: $5 first year promo, then $5/mo or $50/yr. David McCormick
would manage day-to-day moderation with a 50% revenue split. Premise:
existing lab-leader communities have decayed (Facebook groups bot-
infested, LinkedIn lab-leader groups inactive, listservs dead,
ASCP / CLMA discussions gated behind $200+/yr society dues). There
is a real gap in the market for an active, vetted, current
lab-leader water cooler.

**SWOT summary (full analysis done 2026-05-22):**

Strengths: real gap exists, operator credibility (MS/MBA/MLS(ASCP)/
CPHQ + former TJC surveyor + 200+ surveys), warm seed network of
~47 COLA contacts, David's consultant network extends reach,
VeritaAssure customers become natural members, owned SaaS
infrastructure could host.

Weaknesses: operator is already overcommitted across 11+ Verita
modules + active sales pipeline (COPC, Pfizer, Tywauna, Pagan,
Rivera, etc.); forum operations is not core competence for either
operator or David; lab leaders are time-poor and resist a 5th
platform; $5/yr signals low value and underprices proper management;
no plan for the daily content engine that keeps forums alive
post-launch.

Opportunities: real lead funnel into VeritaAssure (zero CAC for
forum members), network-effect competitive moat if it reaches
critical mass (~300+ engaged), content reuse for marketing,
underserved niche within a niche (hospital-employed lab leaders),
AI-assisted moderation now feasible.

Threats: established communities (ASCP, CLMA, CAP, AABB) have 50+
years of institutional inertia; moderation liability is meaningful
in a clinical-leader context (member gets bad peer advice, clinical
event follows, forum operator named); bot/spam invasion is what
killed Facebook lab groups and will come for any open forum; free
competitors keep emerging; biggest threat is distraction from
VeritaAssure core business.

**Economic math kills the proposal as stated:**

- $5/yr × 100 members × 50% split = $250/yr each. David earns more
  from one VeritaAssure Hospital tier referral ($1,999 × 50% Y1 =
  $1,000) than from a full year of forum operations.
- Break-even on real management compensation requires ~500 paying
  members at $50/yr. 500 lab-leader members is harder than it sounds.
  Mature professional society forums struggle to keep that many
  actively paying for digital-only access.
- Realistic David labor at 250 members: 5-8 hrs/week × 52 weeks =
  260-416 hrs/yr for ~$6,250 = $15-24/hr. He will go consult
  at $200/hr instead.

**Verdict:** the IDEA is right (real gap, real demand). The
EXECUTION as proposed is wrong: wrong pricing (too low to signal
value or fund management), wrong incentive (David needs base + equity
not pure rev share at $5/yr), wrong positioning (should be lead funnel
into VeritaAssure not a standalone profit center), wrong commitment
size (one-person shop running a 5th product surface is too much).

**Recommended alternative (not blocked, can do anytime):**

Spin up a free, invite-only Slack or Discord ("Verita Network" or
similar) restricted to lab leaders the operator personally vets, plus
VeritaAssure customers. Positioned as relationship glue + market
intel + product feedback channel, not a profit center. Cost: $15-50/mo
platform + evening hours. Upside is the SaaS lead funnel. Pair with a
quarterly virtual roundtable (90 min, 15-25 invited attendees,
topic-driven, recorded) for the "scheduled high-signal event" while
the Slack/Discord is the "always-on water cooler between events."

**Decision rule to revisit the paid forum:** answer yes to all three
before building: (a) willing to commit 5-8 hrs/week to moderation for
12-18 months even at sub-$5k/yr revenue, (b) explicitly funding it as
a lead funnel into VeritaAssure rather than a P&L, (c) willing to cap
VeritaAssure day-job hours to make room. If any answer is no, build
the free Slack + roundtable alternative first and revisit the paid
forum when VeritaAssure has 50+ paying customers and can fund a
part-time community manager.

**Pre- vs post-COLA:** Post-COLA. No customer urgency.

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

### C6. VeritaPolicy service-line filtering removed (formerly #4)

**Closure rationale (operator decision 2026-05-10):** Keep all
VeritaPolicy rows. CFR-only references with no accreditor reference
are intentional. Labs are welcome to N/A specific lines that do not
apply to them. The "service-line filtering" reframing of the original
report misread the design intent.

**Closure evidence:** No code change required. The current behavior
(all rows shown, per-row N/A available) is the desired behavior.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C7. CLIA number format validation (formerly #13)

**Closure evidence:** `shared/validateClia.ts` defines `CLIA_REGEX =
/^\d{2}D\d{7}$/` (line 24), `validateClia()` helper with whitespace
and dash stripping plus uppercasing (lines 43-57), and
`CLIA_FORMAT_HINT` user-facing error message (lines 26-27). Used in
`client/src/pages/AccountSettingsPage.tsx:393` as placeholder text.
The centralized helper described in the original parking lot fix
shape exists and behaves as specified.

**Source:** Agent verification 2026-05-10 via grep + file read.
Operator confirmed shipped 2026-05-10.

---

### C8. VeritaMap lab-wide menu toggle (formerly #19)

**Closure evidence:** `client/src/pages/VeritaMapLabwidePage.tsx`
exists and implements the labwide read-only union view. Route is
registered in `client/src/App.tsx`. Toggle integration appears in
`client/src/pages/VeritaMapAppPage.tsx` and
`client/src/pages/VeritaMapMapPage.tsx`. Phase 1 of the original
parking lot plan (read-only union view, per-session toggle) shipped.

**Sequencing note:** #18 Phase 2 (real AAA coverage) can now build on
this lab-wide union safely. The hard sequencing dependency the
original entry called out is satisfied.

**Source:** Agent verification 2026-05-10 via grep + file read.
Operator confirmed shipped 2026-05-10.

---

### C9. Tier-1 smoke test checklist (formerly #6)

**Closure evidence:** `docs/smoke-test-tier1.md` documents the Tier-1
smoke-test process and post-deploy verification steps. Shipped via
PR #81 as part of the 2026-05-10 wave.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C10. Per-module gating (formerly #7)

**Closure evidence:** Client-side `useIsReadOnly` module keys wired
on `client/src/pages/VeritaPolicyAppPage.tsx` and
`client/src/pages/VeritaLabAppPage.tsx`. Server-side
`requireModuleEdit('veritapolicy')` and `requireModuleEdit('veritalab')`
guards added on `/api/veritapolicy/*` and `/api/veritalab/*` write
routes in `server/routes.ts`; `requireModuleEdit('veritatrack')`
added on 7 write routes in `server/veritatrack.ts`. Verified by
operator: seat user set to View on `veritapolicy` blocks UI saves
and returns 403 from curl; restoring Edit resumes writes; same
pattern verified for `veritalab` and `veritatrack`. Shipped via
PR #76.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C11. VeritaStock shipped copy (formerly #8)

**Closure evidence:** `client/src/pages/ArticleInventoryManagementPage.tsx`
line 305 footer reads "platform that includes VeritaStock™" instead
of the prior "planned for a future release" wording. Verified live
on `/resources/laboratory-inventory-management`. Shipped via PR #75.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C12. Admin report one-row-per-lab (formerly #14)

**Closure evidence:** `/api/admin/report` rewritten in
`server/routes.ts` (~line 595) to LEFT JOIN `labs` on
`owner_user_id`, expanding multi-lab owners into one row per lab
with the lab's own CLIA. Backward-compatible response shape returns
both `labs` (new) and `users` (legacy alias) so the rollout is
revertible. `client/src/pages/AdminReportPage.tsx` updated to read
`data.labs ?? data.users`, use `effective_clia_number` /
`effective_lab_name`, and key React rows by `lab_id` when present.
Operator-confirmed multi-lab owners now require a second `labs`
row added via Account Settings to surface two rows (data
prerequisite, not a code bug). Shipped via PR #85.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C14. UI relabel "CLIA TEa" -> "Lab-Set Internal Goal" (formerly #1)

**Closure evidence:** Shipped across four PRs over 2026-05-10.

- PR #77: added `hasCanonicalTea(analyte)` and `teaLabelFor(analyte)`
  helpers in `client/src/lib/cliaTeaData.ts` and
  `server/backfillAbsoluteFloor.ts`; swapped the
  `StudyResultsPage.tsx` KPI label so non-canonical analytes show
  "Lab-Set Internal Goal" instead of "CLIA TEa".
- PR #89: added 6 non-canonical analytes (Lipase, Bilirubin Direct,
  Bilirubin Unbound, Iron Saturation, Vitamin D 25-OH, Procalcitonin)
  to `CLIA_PRESETS` on `VeritaCheckPage.tsx` under a new SelectGroup
  "Lab-Set Internal Goal (no CLIA TEa)" with value=0 and cfr="" so
  the form does not cite §493 for them.
- PR #92: promoted the in-form help text to a visible amber callout
  box so users notice the non-canonical category.
- PR #96 (merge commit ccae239): completed the customer-facing
  artifact sweep. Added 4 wording helpers in `server/pdfReport.ts`
  (`criterionLabel`, `criterionAdjective`, `criterionSourcePhrase`,
  `criterionAuthorityPhrase`). Wired them into supportingPageHTML
  (headline "Adopted Acceptance Criterion (TEa)" + "CFR Reference"
  rows become "Lab-Set Internal Goal (no CLIA TEa)" + "Source:
  Laboratory-defined per director or designee policy. No CLIA PT
  criterion exists for this analyte under 42 CFR §493 Subpart I."
  for non-canonical). Wired through all 6 narrative branches:
  cal_ver pass/fail, method_comp pass/fail, precision pass/fail,
  lot_to_lot, pt_coag (the multi-analyte aggregate uses neutral
  per-analyte phrasing since one study can mix canonical and
  lab-defined analytes). Added `acceptanceCriterionLabel(testName)`
  helper in `server/routes.ts` and replaced all 8 demo-PDF persisted
  summaries.

**Verification:** Live `/api/demo/studies/364/pdf` (Glucose precision,
canonical analyte) returns a 3-page PDF that still cites "§493 PT TEa
for this analyte", "Adopted Acceptance Criterion (TEa)", and "adopted
under 42 CFR", and contains NONE of the non-canonical wording
("Lab-Set Internal Goal", "laboratory-defined", "no canonical CLIA PT
criterion", "per laboratory director or designee policy"). The
non-canonical branch is the opposite ternary arm of the same helper
calls and is type-checked by Railway's build; no demo studies exist
for non-canonical analytes yet, so end-to-end PDF verification of
that branch requires creating a real Lipase or Vitamin D study.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C13. WSLH PT vendor (formerly #15)

**Closure evidence:** Shipped 2026-05-10 via PR #79 (merge commit
eeebc6e; merged after rebase to resolve a `server/db.ts` collision
with PR #80's `aa_records` migration block, with both blocks
preserved side by side). `pt_enrollments_v2` CHECK constraint
rebuilt in `server/db.ts` to include `'WSLH'` via idempotent
CREATE NEW + INSERT SELECT + DROP + RENAME migration block.
`shared/wslhCatalog.ts` added with 6 starter programs (1310 General
Chem, 1260 Cardiac, 1080 Blood Lead, 1524 HbA1c, 4190 Hepatitis
Serology, 2230 Hematology). `'wslh'` added to `VALID_PT_VENDORS` in
`server/routes.ts`. WSLH wired into the vendor selector on
`client/src/pages/AccountSettingsPage.tsx` and into the vendor list
on `client/src/pages/VeritaPTAppPage.tsx`. Migration log line
`[migration] pt_enrollments_v2 vendor CHECK rebuilt to include
'WSLH'` is the post-deploy success signal. Shipped via PR #79.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C15. VeritaStock lot tracking + expiration + reorder alerts (formerly #21)

**Closure evidence:** VeritaStock™ shipped the bench-level inventory
features the Perplexity competitor analysis identified as a gap:

- `inventory_items` table includes `lot_number TEXT` and
  `expiration_date TEXT` columns (server/db.ts:2294, 2310, 2313).
  Verified 2026-05-21 via PRAGMA table_info on the live DB.
- Per-lot consumption visible via the existing
  GET /api/labs/:labId/inventory endpoint (each item row carries
  current lot_number; consumption deltas tracked in scan_events
  ready for the future barcode scanning build, parking-lot #29).
- Reorder alerts shipped via PR #286 (commit a4a1fa6) as the
  "order now" reorder document PDF + Excel with director signature
  workflow. Triggered when qty_on_hand <= burn_rate * (lead_time +
  safety_stock). The customer-facing artifact is what
  myLabCompliance.io calls a "reorder alert"; we call it a "reorder
  document" to match the regulatory documentation framing.
- Expiration alerts visible in the VeritaStockPage stats card
  ("Expiring <30d") and the per-item Expiration column in the table
  (client/src/pages/VeritaStockPage.tsx:542-544).

**Honest gap:** myLabCompliance.io may ship more aggressive push
notifications (email or SMS) on lot expiry; VeritaStock today
surfaces this in-app and via the dashboard tile only. If a customer
asks for proactive expiration emails, that becomes a small follow-up
not a re-open of the full category.

**Source:** Originally Perplexity competitor analysis 2026-05-10.
Audit 2026-05-21 confirmed the feature set ships today.

---

### C16. PAL studies guided workflow (formerly #23)

**Closure evidence:** VeritaCheck™ already ships the Precision /
Accuracy / Linearity (PAL) study set under EP-protocol naming:

- **Precision (P):** `studyType === "precision"` — Precision
  Verification (EP15). Shipped with full math parity to EP Evaluator
  including CIs, 2 SD range, vendor SD verdict, and side-by-side
  PDF render verified against the Pfizer A-ALT precision study
  (2026-05-19 demo follow-up, PRs #277-282).
- **Accuracy (A):** `studyType === "method_comparison"` — Correlation
  / Method Comparison. Same EP-equivalent workflow as the PAL
  framing.
- **Linearity (L):** `studyType === "cal_ver"` — Calibration
  Verification / Linearity. Shipped with regression analysis,
  per-level recovery, and PDF render.

All three are available from the VeritaCheck™ study type picker;
they are not packaged under the "PAL" umbrella label because the
EP-protocol naming is more precise (P = EP15, A = method comparison,
L = EP6 cal_ver) and matches the regulatory citation chain on the
PDF deliverables.

**If a customer specifically requests the "PAL" wrapper terminology,**
that is a copy / UX update only, not a new build. Coverage is at
parity.

**Source:** Originally Perplexity competitor analysis 2026-05-10.
Audit 2026-05-21 confirmed the EP studies cover the PAL framing in
full.

---

### C17. Source-grounded 21/29/45 CFR + 42 CFR 482-485 (formerly #26)

**Closure evidence:** PR #301 (commit 8c27806, merged 2026-05-21)
source-grounded the 74 remaining non-493 entries in
`server/cfrRequirements.ts` against verbatim eCFR XML. Breakdown
shipped:

- 43 entries citing 21 CFR (Parts 606, 610, 640 - blood bank cGMP)
- 12 entries citing 29 CFR 1910.x (OSHA bloodborne pathogens,
  chemical hygiene)
- 10 entries citing 45 CFR 164.x (HIPAA Security Rule)
- 9 entries citing 42 CFR 482 / 483 / 484 / 485 (hospital and LTC
  Conditions of Participation)

Verbatim text comes from
`https://www.ecfr.gov/api/versioner/v1/full/{date}/title-{N}.xml`
through the same `rebuild_cfr_from_ecfr_v10.py` pipeline used for
the 493 sweep. Em-dash normalize per CLAUDE.md §3 applied. Header
comments updated to record the additional issue date.

**Follow-on:** The operator-facing concern about verbatim copy
displacement is tracked separately as parking lot #30 (plain-language
summary layer). #30 is additive to the verbatim text shipped in
this close-out, not a replacement for it.

**Source:** PR #301; tasks #18 in the in-session task tracker.

---

### C18. VeritaPolicy "Non CLIA" chapter rename (formerly #3)

**Closure evidence:** PR #300 (commit 34d7707, merged 2026-05-21)
renamed all 44 user-facing chapter labels in
`server/cfrRequirements.ts` that started with "Non CLIA". The string
was an artifact of the generator script categorizing CFR rows by
whether they sat inside or outside 42 CFR Part 493 (CLIA), and the
internal taxonomy was leaking onto the user-facing /veritapolicy
page.

Verified 2026-05-22 by grep: `Non CLIA` returns zero hits in
`server/cfrRequirements.ts`. The labels now read as customer-facing
descriptors anchored to the actual CFR title and topic.

**Earlier partial fix:** Phase 3.6 (commit 2600b3f) had stopped the
UI from rendering the underscored chapter slug alongside the label;
that stopped the "Non_CLIA_*" form from leaking but not the "Non
CLIA" wording itself. PR #300 closed the second half by editing the
data file directly.

**Source:** CAP customer screenshot of the /veritapolicy chapter
headers, 2026-05-01 evening. PR #300; tasks #17 in the in-session
task tracker.

---

### C19. VeritaStock department-scope toggle (formerly #31)

**Closure evidence:** PR #319 (commit d01f5fe, merged 2026-05-22)
shipped the persistent dept-scope toggle on VeritaStockPage. A new
"Working in:" selector in the page header lets a user choose between
"Lab-wide" (default) or any specific department. The choice is
persisted to `ui_preferences.veritastock_scope` and restored on every
reload so users who manage a single department land in their own
workspace without re-filtering.

**Implementation note:** scoped down significantly from the original
3-day Option A plan in the parking lot. The original called for
server-side reorder-list endpoint changes (Day 2), but the existing
endpoints already honor `?department=` query param via PR #304
(vendor filter work). Since the new scope toggle just syncs the
client-side `filterDept` to the user's saved scope on load, the
existing reorder URL builder picks up the dept scope automatically.
No server changes needed. Net diff: 49 lines on one file.

**Behavior model:** scope is the persistent default at load time;
filterDept is the session-level transient override. Changing
filterDept mid-session does NOT update scope (deliberately, to avoid
aggressive auto-saves). Changing scope via the new selector DOES
sync filterDept so the table immediately reflects the new default.

**Source:** John, San Carlos lab, 2026-05-21. Same conversation that
drove the vendor dropdown (PR #304), FILTERED VIEW banner (PR #305),
and Snap Order workflow (PR #307).

---

### C20. Primary-lab seat counting (formerly #12)

**Closure evidence:** `is_primary_lab INTEGER NOT NULL DEFAULT 0`
column was added to the `lab_members` table at db.ts:1276, with the
ALTER TABLE migration at db.ts:1302 ensuring the column is added on
production databases that pre-date the change. The first-lab-created
default is wired at db.ts:1387 (initial INSERT sets is_primary_lab=1
for the seed owner) and db.ts:1446 (membership lookups prefer
is_primary_lab=1 ordering).

The seat-counting logic that honors the primary-lab rule lives at
routes.ts:759 -- the `isSecondaryRow` check treats memberships where
`lab_id` is set AND `is_primary_lab !== 1` as secondary-lab rows
that do not burn a paid seat against the owner's seat count.

Schema, default-on-first-lab, lookup ordering, and seat enforcement
are all in production. The original decision ("owner burns one paid
seat on their primary lab, free implicit seat on every additional
lab they own") is implemented as written.

**Source:** 2026-05-07 multi-lab discussion. Build shipped as part
of the Multi-Lab Tier 2 architecture work (Phase 3.x series, prior
sessions). Status drift discovered 2026-05-22 during parking-lot
audit.

---

### C21. Multi-lab pricing model — Option A (formerly #11)

**Closure evidence:** PR #322 (commit 0ccd925, merged 2026-05-22)
added the customer-facing line to the pricing page that reflects
the parking-lot decision. Initial copy overspecified by asserting
"each lab gets its own subscription at its own tier" -- that
language committed the public page to a pricing structure that
contradicts Enterprise+ positioning ("custom pricing, custom
scope"). Softened the same session in a follow-up PR. Final block
on `client/src/pages/PricingPage.tsx`, immediately after the
Enterprise+ block, reads:

"Own multiple separate labs? Email us and we will work out the
right setup."

with a mailto link to `info@veritaslabservices.com`.

**Decision (per original entry, intent preserved):** the actual
structure (independent subscriptions at full tier price vs one
custom Enterprise+ contract) gets worked out per-customer in the
email conversation, NOT pre-anchored on the public pricing page.
This is why the entry was "Option A" without published bundle
discounts: simplicity and flexibility, with the conversation
shaped by each owner's actual situation.

**Distinct from Enterprise+:** Enterprise+ targets multi-site
health systems buying one centrally-scoped plan; multi-lab owner
block targets one owner with multiple independent labs (different
CLIA numbers, often different tiers, possibly different needs).
Different buyer mental model, both end at "email us."

**Source:** 2026-05-07 multi-lab discussion (Lisa Veri's
canonical-case session). PR #322 (initial build); softening PR
follow-up the same day after the operator caught the Enterprise+
conflict.

---

### C22. VeritaOps cost-per-test module (formerly #10)

**Closure evidence:** v1 of the VeritaOps Cost-Per-Reportable-Test
(CPRT) module shipped across PR #325 through PR #330 on 2026-05-22.
The module is feature-complete for the typical lab director workflow.

**v1 build summary:**

- **PR #325** v1.0 foundation: schema `veritaops_test_cost_studies`
  + ALTER migrations, `server/veritaops.ts` with `computeCprt()` and
  10 CRUD routes (account-scoped + lab-scoped), minimal
  `VeritaOpsAppPage.tsx` with create/edit/list/delete and live
  L1+L2 preview. Plan-gated. CLSI GP11-A cited in page subtitle.
- **PR #326** v1.5 discoverability: Operations marketing tile +
  NavBar entry, addressing the gap where v1.0 shipped a page with
  no nav path. Same-PR discipline lesson recorded in the commit
  message.
- **PR #327** v1.1: L3 (equipment depreciation) and L4 (overhead,
  flat dollars or % markup) opt-in sections in the dialog; live
  preview extended to show enabled layers; studies table gains L3
  and L4 columns with em-dash on opt-out.
- **PR #328** v1.2: PDF export via `server/veritaopsPdf.ts` using
  puppeteer. Internal-use report header, 2x2 CPRT result grid,
  annual cost projection at deepest enabled layer, full assumptions
  table for audit transparency, methodology block citing CLSI GP11-A.
- **PR #329** v1.3: side-by-side comparison view. Per-row checkboxes,
  Compare button activates at exactly 2 selections, dialog shows
  4-layer comparison table with cheaper-side emerald highlighting +
  annual cost tiles at each study's deepest enabled layer.
- **PR #330** v1.4: starter templates. 5 archetypes (custom blank,
  chemistry high-volume, hematology CBC, manual diff, send-out
  reference). Picker only shows when creating new (not editing);
  preserves user-typed test name when applying a template.
- **This PR (v1.5)** ships `scripts/verify-veritaops-cprt-math.js`
  with 10 known-input test cases exercising L1, L2, L3, L4 math
  including divide-by-zero edge cases and the two archetype templates.
  All 10 cases pass.

**Conceptual basis:** CLSI GP11-A "Basic Cost Accounting for
Clinical Services" (1998, the canonical lab cost-accounting
document). Research validated 2026-05-22 via session web pass:
[[reference_active_pipeline_doc]] context, GP35 was incorrectly
cited initially, corrected to GP11-A. HFMA has no lab-specific
cost-accounting framework so we do not cite them. The four-layer
model (Direct -> +Labor -> +Capital -> +Overhead) is universal in
cost accounting literature and aligned with what ADLM, ASCP, and
the published activity-based-costing studies independently describe.

**v2 backlog (NOT shipped, recorded for future work):**

- Excel export (Master List-style branded workbook with About sheet)
- Bulk import from LIS (rolling cost from real volume data)
- Vendor catalog integration (Roche / Abbott / Beckman menu reagent
  prices pre-loaded as defaults)
- Cost roll-up at the department level (sum all tests in Chemistry)
- Annual reporting view ("here is what your test menu cost this year")
- Activity-based costing (multi-step time tracking instead of one
  minutes-per-test number; the ABC PMC study referenced in research
  pass shows the academic methodology)
- Integration with VeritaStock (live reagent cost from inventory
  rather than user-entered; obvious next move because VeritaStock
  already tracks reagent cost + lot info)
- CMS CLFS comparison (let users enter Medicare payment per test
  alongside CPRT to show the margin/loss per test)

**Source:** This thread, 2026-05-07 12:05 PM CDT, user message:
"Parking lot: build an operations module for cost per test
calculations." Scoping pass + research session 2026-05-22; v1
build same session. PRs #325 through this one.

---

## NOT CARRIED OVER (explicitly rejected)

### R4. Mini-LIS module (formerly #24) — HIPAA boundary

**Rejected 2026-05-21 by operator decision.**

**Reason:** A Laboratory Information System handles order entry, result
reporting, patient demographics, MRNs, accession numbers, and specimen-
to-patient linkage. Every one of those touches PHI and pulls VeritaAssure™
across the HIPAA boundary. That triggers BAA negotiations, SOC 2 Type 2,
breach notification obligations, PHI encryption at rest, and audit
trails on every patient-data read. That is a different company with a
different cost structure and a different sales motion.

**Boundary statement:** VeritaAssure™ stays PHI-free as a permanent
architectural and business constraint. The compliance documentation,
QC, inventory, instrument mapping, competency, and policy modules all
sit on the non-PHI side of the line and stay there. New feature
proposals that would require accessioning, patient identifiers, or
specimen-to-patient linkage are rejected on this basis without needing
a per-feature debate.

**Source:** 2026-05-21 strategic decision (this session).

---

### R5. Phlebotomy module (formerly #25) — HIPAA boundary

**Rejected 2026-05-21 by operator decision, same basis as R4.**

**Reason:** Specimen collection by definition links a tube to a patient.
Phlebotomy workflow (drawing, labeling, accessioning, routing) is LIS-
shaped, not compliance-shaped, and crosses the same HIPAA boundary as
R4 Mini-LIS. Phlebotomist credentialing and competency tracking can
still land in VeritaStaff™ or VeritaComp™ when they ship; the
specimen-workflow surface itself is out of scope.

**Source:** 2026-05-21 strategic decision (this session).

---

### R6. WSLH PT booth follow-up email (formerly #16) — stale

**Closed 2026-05-21 by operator decision.**

**Reason:** Originally parked 2026-05-07 after the COLA Nashville booth
meeting. Delayed indefinitely on 2026-05-10 pending operator review of
WSLH contact details, and remained delayed without progress through
2026-05-21. Two weeks of no movement on a "send within 5-10 business
days" item is the real signal that the moment passed. Closing rather
than leaving in indefinite-delay state where it pretends to be active
backlog at every session bootstrap.

If WSLH outreach is needed in the future, that becomes a fresh parking
lot entry with a current set of facts rather than a re-animation of
the 2026-05-07 conversation.

**Source:** 2026-05-21 cleanup decision (this session).

---

### R1. Rotate Railway token because it appeared in chat

**Reason:** Per session 299e9a73 turn 7 (and STANDING_REQUIREMENTS.md
"CREDENTIAL HANDLING" section): tokens the user pastes in our chat are
not a leak; the agent does not auto-park rotation. The original "rotate
GitHub PAT" item was added because the PAT had been written into
committed SESSION_HANDOFF.md files in past sessions and pushed to the
repo, which is an actual leak. Token-in-our-conversation is not.

**Source:** session 299e9a73 turn 7, ~2026-04-28.

---

### R2. Real Stripe checkout abandonment diagnostic (formerly #2)

**Reason:** Operator decision 2026-05-10 — abandoned. Not pursuing a
Stripe-session-based abandonment diagnostic. The original concern
(text-parsed inference incorrectly presented as diagnosis) is noted
as a class of error to avoid; the build itself is no longer wanted.

**Source:** Operator instruction 2026-05-10 in this session.

---

### R3. VeritaScan sign-off date field (formerly #9)

**Reason:** Operator clarification 2026-05-10 — VeritaScan sign-off
is not a regulatory requirement. The cross-reference value with
VeritaMap correlation (originally proposed as the motivating use case)
does not justify adding the schema and UI. No code change.

**Source:** Operator instruction 2026-05-10 in this session.

---
