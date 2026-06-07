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

### 5. v0.6 source-grounded rebuild of all 4 accreditor columns

**Effort:** L (3-5 weeks)
**Importance:** High — accreditor citation accuracy underpins every VeritaPolicy / VeritaScan / VeritaCheck artifact.

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

### 17. New flagship module: VeritaResponse (post-survey deficiency response)

**FLAGSHIP — Tier 1 product expansion. Sized larger than VeritaPT or
VeritaCheck. Treat with same architectural care as the original
VeritaAssure suite.**

**Effort:** XL (6+ weeks; flagship-scale)
**Importance:** High — booth-validated demand at COLA Nashville; no existing module covers post-survey deficiency response; CMS QSO-25-19-ALL 14-day disclosure window raises stakes.

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

**Effort:** S (1-3 days once #17 ships) for Phase 3 — Phases 1 and 2 already shipped.
**Importance:** Medium — closes a real workflow loop (AAA failure → VeritaResponse finding) but only matters once #17 exists.

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

_(item #22 closed 2026-05-28; see C26 below)_

---

### 27. Acquire CAP MOL (Molecular) checklist to verify 2 pending entries

**Effort:** N/A (operator action — ~1 hour of code work once the file is in hand)
**Importance:** Low — two entries total; low traffic; only matters when a customer cites a MOL standard.

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

**Effort:** N/A (operator action — ~1-2 days of audit re-run once the manuals are held)
**Importance:** High — gates #5 from reaching "exhaustively verified" status for AABB and COLA.

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

**Effort:** L (12 working days, ~3 weeks calendar)
**Importance:** High — strategic moat vs Unity Lab Services ($30K+/yr); presold as included on Clinic+ tiers; build triggers on first paid commitment.

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

**Effort:** M (multi-day content authoring across 96 Master List rows if redesigned correctly)
**Importance:** Medium — director readability win; no customer urgency.

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

### 32. Lab leader community / forum (paid subscription idea)

**Effort:** XL (ongoing operational commitment, not a build) as paid; S (a few days to spin up) as free invite-only Slack/Discord alternative.
**Importance:** Low as paid product (SWOT verdict: don't build); Medium as free lead-funnel alternative.

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

_(item #33 closed 2026-05-28; see C27 below)_

---

_(items #34 and #35 closed 2026-05-24; see C23 and C24 below)_

---

### 36. New module: laboratory non-conforming event documentation

**Effort:** L (initial estimate, pending Michael's scope walkthrough — likely new DB tables, form UI, list / filter / status workflow, attachments, signoffs, exportable summary; comparable in shape to VeritaResponse™ or VeritaQC™)
**Importance:** High — every accredited laboratory (TJC, CAP, COLA, AABB) has to document non-conforming events under their quality management system standards. No existing Verita module covers this surface; VeritaResponse™ handles post-survey citations and VeritaQC™ handles QC-rule violations, but the general-purpose NCE workflow is a gap.

**What:** Build a module to document laboratory non-conforming events (NCEs). Surfaces a lab needs to capture include specimen rejection, temperature excursions, reagent issues, equipment failures, result-reporting errors, transcription errors, lost specimens, contamination events, and similar quality incidents. Full scope, target accreditor mapping, terminology preference (NCE / NCR / event / incident / occurrence), and how it should relate to the existing VeritaQC corrective-action engine and VeritaResponse deficiency tracker are TBD pending Michael's scope walkthrough.

**Status:** Parked 2026-05-26 with a one-line scope intent. Michael indicated he will walk through the requirements in more detail in a follow-up conversation. Do not start building until that walkthrough happens; rough sizing here is a placeholder.

**Pre- vs post-COLA:** Post-COLA. No customer urgency yet, but high strategic value once defined — closes a real gap every lab has and that no other Verita module currently serves.

---

_(item #37 closed 2026-05-28; see C28 below)_

---

### 38. Screen-capture video: VeritaCheck method comparison in 60 seconds

**Effort:** S for agent prep (storyboard / pre-fill / captions / checklist); ~1 hour of operator time to record + light post-production.
**Importance:** Medium — operator selected this as the highest-impact positioning artifact during the 2026-05-12 review; pairs with item #37 to give Lisa both a static and a motion asset for follow-ups.

**What:** 30-60 second screen recording demonstrating the "experienced lab tech figures it out in seconds" claim. From blank method-comparison study to completed PDF, no voiceover, no narration, visible cursor motion. Embed autoplay-muted on the marketing site, include in conference follow-up emails.

**Why it parks:** The recording itself has to be done by a human with screen-capture software (Loom, ScreenPal, OBS Studio, Camtasia). The agent cannot drive a live recording. What the agent CAN deliver and will when this item is taken up: storyboard + click-by-click script, demo lab pre-fill state so the take is clean on first try, on-screen caption text, post-production checklist (crop, blur any CLIA number, add CTA card at end).

**Fix shape (when taken up):** Agent ships the recording-prep package (storyboard / pre-fill / captions / checklist). Operator or marketing sits down with Loom and records the take. Total: roughly 1 hour of operator time including a second take if needed.

**Source:** 2026-05-12 conversation. Michael selected the screen-cap video as the highest-impact positioning artifact, then asked the agent to record it. Agent does not have screen-recording capability; option parked rather than fudged.

**Status:** Open. Re-parked 2026-05-27 (originally PR #117, abandoned with merge conflicts then closed-and-re-authored at current numbering). Pending operator decision on whether to record this themselves or pivot to one-pager (item #37).

**Pre- vs post-COLA:** Post-COLA, conference-driven.

---

### 39. MediaLab parity hardening (VeritaPolicy approval workflow depth)

**Effort:** L (1-2 weeks for the high-value items; each independent feature is M)
**Importance:** Medium-High — the C29 build shipped the surface MediaLab markets but depth is shallower than their 30-year-hardened version. Closing the gaps converts a "we replicate MediaLab" claim into a "we replace MediaLab" claim at the same price point.

**What:** The VeritaPolicy approval workflow build (C29, 2026-05-29) hit roughly 60-70% MediaLab feature surface. The following gaps remain when comparing against an enterprise MediaLab Document Control deployment:

- **Quizzes on attestations.** Schema columns `quiz_score` and `quiz_total_questions` exist on `policy_attestations` but the quiz authoring + presentation UI was scoped out of Phase 4. MediaLab labs use 5-10 multiple-choice questions per policy to confirm comprehension, not just attestation. Adds compliance defensibility.
- **PDF watermarking.** MediaLab burns user name + timestamp into every downloaded PDF copy as a deterrent against forwarding. We serve clean originals. Add Puppeteer-style overlay at download time.
- **Per-policy role mapping at department level.** MediaLab lets a lab say "only Microbiology Lab Director can approve Microbiology policies." Our `required_role` is per-step on the workflow, not per-document-by-manual.
- **Approval delegation.** When a reviewer is on vacation, MediaLab supports temporary delegation to a designate. We have no delegation model.
- **In-browser DOCX editing.** MediaLab has a structured editor that creates a Table of Contents from headings. We treat documents as opaque files; revisions require a new upload.
- **Reviewer-phrase library.** MediaLab provides standard reject phrases ("Section X needs CFR citation"). Our reviewer enters free-text comment.
- **Cross-policy linking.** MediaLab lets one policy reference another by ID; surveyor can click through. Ours treats each doc as an island.
- **SSO / Active Directory integration.** Lab IT departments expect AD login. We have email+password only.
- **Excel export of compliance dashboard.** Surveyors want xlsx with VeritaAssure brand colors and proper headers. Our dashboard is JSON only. Half-day to add per the Excel Standard in CLAUDE.md §6.
- **Print stylesheet.** MediaLab has a print view. Ours uses default browser print.
- **Auto-expire cron** (was deferred from Phase 6B). Approved policies past `next_review_date` by 60+ days currently stay status='approved' with a visual red flag. MediaLab auto-flips to expired and locks edits.
- **Real-time customizable email templates.** Our review reminder emails are hardcoded. MediaLab lets each customer customize subject and body.

**Why it parks:** None of these gaps block customer sign-ups; the build is functional and verified at the API + UI happy-path level (35/35 API + 19/19 UI test pass against live prod per the qa-policy-build.js + qa-policy-ui.js scripts). But they will surface in head-to-head sales calls against MediaLab. Triage by hot prospect feedback.

**Recommended sequence when taken up:**
1. PDF watermarking (highest "feels enterprise" signal, ~half day)
2. Quizzes on attestations (compliance defensibility, ~half day)
3. Excel export of compliance dashboard (surveyor request, ~half day)
4. ~~Auto-expire cron (closes Phase 6B gap, ~half day)~~ **SHIPPED 2026-06-02.** PR #510 = state-machine flip with audit log + admin endpoint. PR #514 = write-path edit-lock guards on PATCH /documents/:id and POST /attestations/:id/complete (other paths already had state-machine guards). End-to-end verified on prod via qa-auto-expire-test harness (PR #511 + #512 + #513 + the harness extension in #514).
5. Print stylesheet (minor polish, ~1 hour)

Items 6+ (SSO, delegation, in-browser editing, etc.) are larger and should be customer-triggered.

**Source:** 2026-05-29 QA pass after C29 shipped (qa-policy-build.js + qa-policy-ui.js: 54/54 happy path verified). Honest depth assessment surfaced by Michael's "how confident are you" question — see C29 entry for full QA receipts.

**Status:** Open, customer-triggered. No urgency until a prospect specifically asks for one of the listed depth items.

**Pre- vs post-COLA:** Post-COLA. Defensive against MediaLab in head-to-head sales calls.

---

### 40. VeritaQC Import Phase A: human-in-the-loop Gate 3 click-through (deferred)

**Effort:** XS (~5 minutes of Michael's time on a live URL).
**Importance:** Low. Backend contract is fully verified via 35/35 passing offline contract checks (`scripts/verify-veritaqc-import.js`) plus three live-API smoke checks against prod (candidates, preview, mappings PUT/GET) on Riverside Regional with seed lot `SEED-1780436709094` (18 Glucose results). The browser-driven click was not run because Claude-in-Chrome's renderer froze repeatedly on the Radix Select inside VeritaCheckPage, not on Phase A code itself. Risk of a UX bug surviving to a customer is small but not zero.

What's deferred: the actual user flow at `https://www.veritaslabservices.com/labs/1/study/new` → pick "Precision Verification" → click the "Start from VeritaQC™…" banner → pick Glucose + the seeded control lot → Preview values → Import → confirm replicates land in the precision grid with the sticky level name "Glucose QC Mid (Gate 3)". Per CLAUDE.md §2 Gate 3 step 8 the human-in-the-loop fallback is the explicit alternative when browser-automated drive is impractical, which it was here for tooling reasons. Michael can pick this up whenever he is on the dashboard for an unrelated reason; no need to make a separate trip.

**Source:** task #77 stalled at Gate 3 step 8 on 2026-06-02. PR #500 squash-merged at commit `17a91ff`, prod /api/health confirmed ACTIVE on that commit at 20:43 UTC.

**Status:** Open, awaiting Michael's 5-minute click test. Will move task #77 to completed only after he reports the user-visible result.

---

### 41. Verify-script convention backfill (CLAUDE.md §2)

**Effort:** L (8 backfill scripts, each ~2-4 hours, total ~3-5 working days if done as one focused sweep).
**Importance:** Medium-High. Procedural-debt cleanup against a NON-NEGOTIABLE convention. CLAUDE.md §2 verify-*.js: every math/logic change ships with a paired script that exercises every meaningful branch. The audit run on 2026-06-02 found 31 of 35 math/logic commits in the last 90 days violated the convention. Some are exempt (renames, citation swaps, copy changes) but at least 8 introduced new math or fixed math defects and should have shipped with verification.

The 8 high-stakes backfill candidates surfaced by `scripts/audit_verify_script_coverage.py` (run with default --since 90 days). Strike-through = backfill landed.
- ~~EP17-A2 analytical sensitivity math (#118) — LoB / LoD / LoQ computations~~ ✅ backfilled 2026-06-04 in `scripts/verify-ep17-sensitivity.js` (34/34 PASS).
- Lot-to-Lot + PT/Coag Deming regression (#c66cbc6) — paired-specimen statistical method
- CUMSUM + QC range + multi-analyte lot comparison (#79d9aa5) — multiple new study type maths in one commit
- ~~Reference Interval Verification CLSI EP28-A3c (#3bff6c9) — non-parametric interval calculation~~ ✅ backfilled 2026-06-04 in `scripts/verify-ep28-reference-interval.js` (31/31 PASS).
- Method comparison Deming + OLS with CI, SEE, bias column (#72e203c) — regression statistics
- Precision Verification EP15 ANOVA simple + advanced modes (#9643934) — variance decomposition
- ~~Qualitative + semi-quantitative method comparison (#4e14d1a) — categorical comparison logic~~ ✅ backfilled 2026-06-06 in `scripts/verify-method-comparison-qualitative.js` (37/37 PASS).
- ~~TEa boundary comparison fix (#6e02c0d) — boundary math fix without verification~~ ✅ backfilled 2026-06-03 in `scripts/verify-tea-boundary.js` (19/19 PASS).

**What stays exempt:** renames (e.g. "Reference Interval" -> "Reference Range" relabel), CFR citation swaps, copy authorship, label tweaks. The convention applies to math + branching logic, not text.

**Why it parks:** the audit tool ships in PR #519. Backfill is a multi-PR sweep (one script per candidate). Ideal cadence is one backfill script per session as low-priority procedural fill behind customer-driven work. Lower urgency than feature work because the math has run in prod for 60-90 days without verified defects surfacing; backfill closes the gap for future regression detection, not active bug repair.

**Source:** scripts/audit_verify_script_coverage.py output, run 2026-06-02. Captured as the formal lookback that surfaced the gap.

**Status:** Open. Pre- vs post-COLA: indifferent.

---

### 42. Outbound demo-invite messaging campaign to 1st-degree LinkedIn contacts

**Effort:** L (1 week prep + 4-6 weeks of staged sends)
**Importance:** High. Converts existing warm network (~2,500 1st-degree contacts and growing weekly via the connection-invite cycle) into a demo pipeline. Complements COLA cohort outreach and content-driven inbound; only pipeline that leverages contacts already in 1st degree. The contact base is being built right now (80 sent this week, 80/week ongoing) and will be ready for activation within 4-6 weeks.

**What:** A staged outbound DM campaign walking Michael's 1st-degree LinkedIn contacts through tier-segmented demo invitations for VeritaAssure. Goal: convert warmest contacts into demo conversations first, then chain into trials and paid subscriptions. Separate pipeline from COLA cohort follow-up and from content-driven inbound; all three feed the same demo funnel but originate from different warmth sources.

**Tiered targeting (conversion-likelihood ranked):**

- **Tier 1 — Engagers + role match (highest conversion).** 1st-degree contacts who liked, commented, or shared a Michael Veri post in the last 90 days AND whose role is Lab Director, Quality Officer, Lab Manager, or Hospital Lab Leadership. Estimated size: 30-60 contacts. Highest expected conversion rate.
- **Tier 2 — Role match, no engagement.** 1st-degree contacts whose role matches the ICP but have not engaged with content. Accepted the connection but not been activated. Estimated size: 300-500 contacts. Moderate conversion.
- **Tier 3 — Allied roles.** Quality managers, lab supervisors, POC coordinators. Influence the buyer but are not the decision-maker. Estimated size: 200-400 contacts. Lower direct conversion, useful for organizational reach.
- **Tier 4 — Adjacent (consultants, accreditor staff, IVD vendors).** Influencer audience, not buyers. Estimated size: 100-300 contacts. Low conversion to direct demo, useful for word-of-mouth referrals.

**Message templates per tier:**

- Tier 1: Reference specific engagement and align to a VeritaAssure module. Anchor example: "Your comment on the reference-range post got me thinking about how VeritaCheck handles exactly that workflow, would you want a 30-minute walkthrough?"
- Tier 2: Soft intro anchored on Michael's recent content arc and Lab Management 101 release, then demo offer. No assumption of prior engagement.
- Tier 3: Position as a tool that makes their work easier in support of their director. Demo offer or trial.
- Tier 4: "fyi this exists, happy to walk you through it if useful" framing. No hard demo push.

**Pre-implementation work (must be done before any send):**

1. Export 1st-degree contact list from LinkedIn (Settings, Get a copy of your data, generates CSV with name, headline, email, company, position, connected-on date).
2. Cross-reference with content engagers list (manual pull from past 90 days of post analytics, or LinkedIn SSI export).
3. Build Tier 1-4 buckets in a working CSV with columns: name, LinkedIn URL, role, tier, engagement notes, sent date, replied, demo booked, outcome.
4. Filter out: existing VeritaAssure customers (pull current customer list from production DB), named contacts in COLA follow-up batch, contacts who explicitly opted out, contacts whose last LinkedIn activity is more than 2 years old.
5. Draft tier-specific message templates, store in `linkedin_search/outbound_messages_v1.md`.
6. Confirm cap pacing: LinkedIn 1st-degree DM cap is roughly 80-100 per day rolling. Plan 20-30/day to stay safely under.

**Pacing strategy:**

- Week 1: Tier 1 only, small batch. Watch reply and demo-book rate. Refine messaging if signal is weak.
- Weeks 2-4: Tier 2 staggered batches of 20-30/day, paced to LinkedIn rate limits.
- Week 5: Tier 3 after Tier 1/2 momentum is visible.
- Week 6+: Tier 4 light cadence, lowest priority.

**Risks to surface at implementation time:**

- Mass identical DMs trigger LinkedIn spam detection. Vary message bodies per recipient.
- LinkedIn ToS allows messaging 1st-degree but discourages bulk patterns. Pace strictly.
- Tier 1 reply rate is the leading indicator. If Tier 1 does not convert, do not push Tier 2.
- Coordinate with COLA cohort sender list to prevent double-touch of named contacts.
- Existing customers need to be deduped from the contact list. Pull current customer list from production DB as the source of truth.

**Implementation triggers (decide when to lift off parking lot):**

- Lab Management 101 has shipped (book gives a tangible asset to attach to the message).
- Tier 1 engagement size has hit 50+ (worth running).
- COLA cohort outreach concludes (avoid double-loading sender time).
- Michael has 2-3 hours/week to drive batches via in-panel Claude.

**Source:** 2026-06-04 session, after weekly LinkedIn invite batch completion (80 sent, cap hit at #84 Victoria Allen).

**Status:** Parked. Plan documented. Implementation deferred until trigger conditions met.

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

### C23. CCL lab name visual disambiguation in lab switcher (formerly #34)

**Effort:** XS (under 1 day, actual)
**Importance:** Low — cosmetic; only mattered when Lisa or Michael picked the wrong lab from the dropdown.

**What shipped (PR #361):** Added a `distinguishingSuffix()` helper to `client/src/components/LabSwitcher.tsx` that finds the longest shared prefix across a user's lab names and surfaces the differing tail. When the shared prefix is >20 chars (e.g. Lisa's two Milford labs that share "UMass Memorial Health - Milford Regional Medical Center"), the tail is rendered as a bold-foreground span on the active-lab chip and as an uppercase primary-tinted pill on each dropdown row. Role and primary flags also rendered as proper pills. Dropdown width bumped w-72 → w-80. Hovering a row shows the full lab name via `title=`.

**Source:** flagged 2026-05-23 immediately after provisioning Lisa's CCL lab; closed 2026-05-24.

---

### C24. VC Unlimited Y1/Y2 price disclosure UX (formerly #35)

**Effort:** XS (under 1 day, actual)
**Importance:** Low when shipped (proactive, no customer complaint yet) — but high if a procurement reviewer later disputes the $499 renewal as undisclosed.

**What shipped (PR #362):** VC Unlimited tile on `/pricing` now renders the price block as two prominent lines: `$299 first year` at text-3xl bold and `$499 /yr after` at text-2xl bold directly below. Procurement reviewers can no longer lock onto the headline $299 and miss the renewal disclosure. Implemented by splitting the PLAN data's combined `period` field into `period` + new optional `priceY2` / `periodY2` fields, with a conditional second-line render in PricingPage.tsx. Other tiles unchanged because the conditional gate is on `priceY2`.

**Source:** Pricing rebuild 2026-05-23; closed 2026-05-24 proactively before any customer dispute.

---

### C25. VeritaQC Phase 1 (Levey-Jennings + Westgard live engine) (formerly #20)

**Effort:** L (about 5 days end-to-end, actual: Phase 0 schema → Phase 1A evaluator → 1B entry UI → 1C daily review → 1D monthly PDF + attestation)
**Importance:** High — largest single gap vs myLabCompliance.io per Perplexity competitor analysis; promotes VeritaAssure from documentation tool to lab operations platform.

**What shipped (PRs #364, #365, #366, #367, #368, #369, #370, #371):**
- Phase 0 (#364): six-table schema (`qc_control_lots`, `qc_results`, `qc_rule_violations`, `qc_corrective_actions`, `qc_period_reviews`, `qc_rule_settings`) with PRAGMA-guarded ALTER migrations + admin seed/dump endpoints.
- Phase 1A (#365): `evaluateWestgardForLot` server-side rule engine (1-2s, 1-3s, 2-2s, R-4s, 4-1s, N-x, N-T) with baseline-excludes-candidate evaluation. `POST /api/labs/:labId/qc/results` ingests a result, evaluates rules, returns violations + `requires_corrective_action`. Per-lab + per-analyte rule settings (`bias_consecutive_count`, `trend_consecutive_count`).
- Phase 1B (#366): `VeritaQCAppPage` tech entry UI with lot picker, result form, in-the-moment violation banner, required corrective-action modal on rejection, recent-results table. Three endpoints: `GET /qc/lots`, `GET /qc/results`, `POST /qc/corrective-actions` (with optional `exclude_from_baseline`).
- Phase 1B fix (#367): render form disabled instead of hiding on read-only labs; added `POST /api/admin/extend-lab-subscription`.
- Stale-seat cleanup (#368): `POST /api/admin/seat-cleanup-by-user` to deactivate stray `user_seats` rows from the Lisa-cascade fallout.
- Phase 1C (#369): `VeritaQCDailyReviewPage` cross-lot triage feed grouped by lot, status filter (any / with_violation / missing_ca), summary tiles. `GET /qc/recent` endpoint with date + status filters.
- Phase 1D (#370): `server/pdfQCMonthly.ts` Puppeteer + HTML monthly review PDF with on-page-1 attestation block and inline SVG Levey-Jennings chart (Westgard color bands). Three endpoints: `GET /qc/period-reviews`, `POST /qc/period-reviews` (upsert by lab+lot+year+month), `GET /qc/period-reviews/pdf`. "Monthly Review & Attestation" card on the Daily Review page.
- Owner-override fix (#371): `useIsReadOnly` now returns false immediately when the user is owner or admin of the active lab, regardless of `isSeatUser` state. Closes the architectural gap where stale seat rows from another lab poisoned module rendering on the owner's own labs.

12/12 evaluator scenarios PASS in `scripts/verify-westgard-rules.js`. CLSI C24 supports lab-configurable bias/trend N via `qc_rule_settings`. Phase 1 is feature-complete; future phases (PT integration, multi-instrument LJ overlays, automated calibrator-lot bridging) deferred.

**Source:** Perplexity competitor analysis 2026-05-10. Scoping confirmed via the build_phase1_mockup.py iterations 2026-05-24. Shipped 2026-05-25.

---

### C26. VeritaLab CMS-116 application support + state licensing registry (formerly #22)

**Effort:** M (1-2 weeks for v1, actual)
**Importance:** Medium — competitor parity (myLabCompliance.io) plus useful at lab startup and at certificate-type changes.

**What shipped (five phases):** State licensure registry tab in VeritaLab, seeded with all 51 jurisdictions (state authority, form URL, fee, renewal cadence). CMS-116 form-fill UI tab inside VeritaLab. Draft-to-PDF generator producing the federal CLIA application form from the saved draft. Issued-cert wire-back so the generated certificate from a successful submission lands in the existing certificate tracker without manual re-entry. VeritaLab sub-tab plumbing so both surfaces live alongside the cert tracker at `/veritalab-app`.

**Source:** Perplexity competitor analysis (myLabCompliance.io), 2026-05-10. Reclassified as a VeritaLab extension 2026-05-25. Shipped 2026-05-28.

---

### C27. Active vs view-only seat split (formerly #33)

**Effort:** M (~1 week of engineering, actual: shipped in a single multi-PR session)
**Importance:** Medium — closed the gap between /pricing copy and product behavior; gives sales a clean answer for "do you charge for our medical director?"

**What shipped (six PRs in sequence):**
- #430 foundation: `user_seats.seat_type` column ('active' | 'view_only', default 'active'), `PLAN_VIEW_ONLY_SEATS` map (Clinic 1, Community 2, Hospital 3, System 5), admin report aggregation gains active and view-only counts alongside the existing total.
- #431 invite flow: invite UI asks seat type at the moment of invitation; default 'active'; passes through to the lab-scoped POST `/api/labs/:labId/members` and user-level POST `/api/account/seats`.
- #432 counting gates: dual-cap enforcement at both invite endpoints with `SUM(CASE WHEN COALESCE(seat_type,'active') = ...)` subquery so legacy rows count as active. Owner counts as active. View-only failures return `addOnRatePerYear: 99`; active failures preserve the `nextTier` upgrade hint.
- #433 members page UI: usage card above the invite form ("Active X of Y used", "View-only X of Y used", $99/yr add-on hint at cap), seat-type chip on every member and pending-invite row, `GET /api/labs/:labId/members` extended to return `seat_type`, `seatLimits`, `seatCounts`.
- #434 server gate: `authMiddleware` loads `seat_type`, blocks view-only seats from any non-GET / HEAD / OPTIONS method with `403 view_only_seat`. 12/12 PASS in `scripts/verify-view-only-seat-gate.js`.
- #435 Stripe add-on: `STRIPE_VIEW_ONLY_ADDON_PRICE` env hook, `getViewOnlyAddOnConfig()` helper, `addOnPriceId` exposed on all 402 / GET responses. `scripts/verify-view-only-addon-config.js` runs 3 local assertions + 5 live Stripe assertions when both env vars are present.

`STRIPE_VIEW_ONLY_ADDON_PRICE` remains unset (manual-invoice mode) until Michael creates the recurring $99/yr USD price in the Stripe dashboard.

**Source:** Pricing analysis doc Decision 3 (2026-05-21); MEDIUM scenario revised 2026-05-29 to retire the "unlimited view-only" claim. Shipped 2026-05-28.

---

### C28. "Why VeritaCheck" comparative one-pager (formerly #37)

**Effort:** S (one design pass + four claim paragraphs + PDF + matching marketing-site page, actual)
**Importance:** Medium — closed a positioning gap surfaced by six COLA conference attendees attached to a legacy verification tool; converts product-quality advantage into a leave-behind Lisa can hand out.

**What shipped (two PRs):**
- #428: full article page at `/article/why-veritacheck` covering cost, time-to-first-study, suite integration, and compliance; 1-page Puppeteer PDF generator; marketing-site presence so the article surfaces from the homepage navigation.
- #429: 1-page PDF margin and font fix (margins 12mm → 10mm, fonts shrunk 0.5pt, closing block trimmed) so the PDF holds to a single page instead of overflowing onto page 2.

Copy avoids naming "EP Evaluator" per CLAUDE.md §3; uses "other evaluation tools" and "legacy verification software." Audience recognition is the leverage.

**Source:** 2026-05-11 / 2026-05-12 conference notes review with Michael. Conference attendees (Whitehead, Odegard, Othman, Molinelli, Kyle, Allred) expressed interest in equivalent / superior product. Shipped 2026-05-28.

---

### C29. VeritaPolicy approval workflow — MediaLab functional mirror

**Effort:** XL (one focused session, 12 PRs landed)
**Importance:** High — replaces MediaLab Document Control ($752/$2,250 starting price, scaling to $10K-$20K/yr at enterprise per Capterra public data) with an included VeritaPolicy feature; closes a real positioning gap and gives sales a direct comparator line.

**What shipped (12 PRs over the 2026-05-29 session):**
- #438 Phase 0: 9-table schema (policy_manuals, policy_documents, policy_versions, policy_approval_workflows, policy_approval_steps, policy_signoffs, policy_attestations, policy_review_reminders, policy_audit_log) with PRAGMA migrations.
- #439 Phase 1: upload + manuals UI at `/labs/:labId/veritapolicy-app/my-policies`. 10 default manuals auto-seeded. DOCX/PDF/HTML upload via multer + mammoth render.
- #440 Phase 2: workflow engine with state machine (draft → in_review → approved → expired → archived). Default workflow library seeds 1-step LD approval + 2-step TC then LD.
- #441 Phase 2.1: workflow visibility polish — pending-step badge under in_review status, owner Recall button, eligibility warning in submit dialog.
- #442 Phase 3: 21 CFR Part 11 hardening — bcrypt password re-auth on approve/reject, sha256 tamper detection on render + download, signature history block in View modal.
- #443 Phase 4: employee read-and-attest with assign / list pending / complete endpoints; per-user-per-version idempotency.
- #444 Phase 5: periodic review re-certification with password gate; advances next_review_date by review_interval_months.
- #445 Phase 6A: compliance dashboard at `/labs/:labId/veritapolicy-app/compliance` with headline tiles, per-manual coverage, overdue + due-soon lists, per-user attestation rate.
- #446 Phase 6B: daily cron-fired email reminders via Resend (30_day_warning / overdue / final thresholds). Auto-expire deferred to 6C.
- #447 Phase 7: new-version upload, version history block in View modal, search bar with client-side filter.
- #448 Phase 8: surveyor public links — lab generates signed URL, surveyor browses approved policies at `/surveyor/:token` without auth. Auto-expires, revokeable, use_count tracked. The MediaLab differentiator.
- #449 QA helper: admin endpoint `POST /api/admin/veritapolicy/qa-corrupt-hash` so the tamper detection path can be exercised end-to-end without volume access.

**QA verification (2026-05-29):**
- API suite: 35/35 PASS against live prod via `C:\Users\veril\tooling\playwright-recorder\qa-policy-build.js` (password gate verified, attestation idempotency verified, surveyor token validation verified across short/unknown/revoked/expired states).
- UI suite: 19/19 PASS via Playwright with three browser contexts (owner, QA approver, anonymous surveyor) at `qa-policy-ui.js`.
- PDF upload + render + mobile viewport + synthetic tamper test (qa-policy-extras.js) blocked at session end by Railway token re-auth issue; tests written but not executed.

**MediaLab functional gap remains:** see new entry #39 (MediaLab parity hardening) for the 60-70% surface coverage assessment — quizzes on attestations, PDF watermarking, SSO/AD, in-browser DOCX editing, delegated approvals, reviewer-phrase library, cross-policy linking. The build shipped the surface MediaLab markets; depth and edge cases remain shallower than MediaLab's 30-year hardened version.

**Source:** Pricing strategy conversation 2026-05-29 (Michael: "I don't like bolt-ons; we should replicate this") → scoped 8 phases → shipped all 12 PRs in single session. Shipped 2026-05-29.

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
