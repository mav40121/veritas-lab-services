# Scoping: VeritaResponse™ — Post-Survey Deficiency Response Module

**Status.** Pre-build scoping doc. No code on this module ships until the operator approves this scope.
**Source.** Parking-lot item #17, recorded 2026-05-07 at COLA Nashville booth.
**Author.** Claude Code, 2026-05-10. Restructures and refines the research already captured in PARKING_LOT.md item #17.

This is a Tier-1 product expansion. Sized larger than VeritaPT or VeritaCheck. Treat with the same architectural care as the original VeritaAssure suite.

---

## 1. Goal in one sentence

Help a lab manage the full lifecycle of responding to inspection deficiencies (CAP, TJC, COLA, CMS-2567, AABB), from intake of a citation through corrective-action authoring, supporting-evidence collection, submission tracking, and 30/60/90-day effectiveness verification.

## 2. Why now

- **CMS QSO-25-19-ALL (2025-06-17)** shortened the public-release timeline for CMS-2567 statements of deficiencies from 90 days to 14 days. Reputational stakes on getting a fast, defensible response submitted are materially higher than they used to be.
- **Most COLA labs** (small physician-office labs) have no coherent system for this today. They use Word docs and email threads. This is the strongest booth pitch we have for that segment.
- **Pairs with VeritaCheck and VeritaPT** to complete the compliance lifecycle: prevent → respond → prove. VeritaCheck finds gaps before they get cited; VeritaResponse handles the citation when one slips through; VeritaPT proves the lab's PT covers the menu.

## 3. Common spine across all accreditors (data model anchor)

Eleven fields are common to every accreditor's deficiency-response shape:

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

Accreditor-specific layer is just (a) which fields are required vs optional, (b) field naming, (c) submission portal, (d) deadline clock, (e) terminology. **One normalized `findings` table with per-accreditor renderer adapters.**

## 4. Accreditor matrix (researched 2026-05-07)

| Accreditor | Deadline clock | Submission channel | Severity tiers | Notes |
|---|---|---|---|---|
| **CAP** | 30 days from inspection date | e-LAB Solutions Suite (online only) | Phase I (written), Phase II (written + supporting) | One response per checklist item, numerical order. Tech-specialist back-and-forth. Decision target 50-75 days. |
| **TJC** | 60 days from posted final report | Joint Commission Connect (Survey Process > Post-Survey) | Each RFI gets its own ESC | May 2024 update: ESC must additionally document factors impacting patient care found during root-cause analysis. |
| **COLA** | Educational / consultative model | Direct contact, technical support free during plan development | "Why" emphasis, not just "what was fixed" | 2-year cycle, ongoing PT monitoring. |
| **CMS / state (CLIA)** | 10 days from receipt | Form CMS-2567, paper / fax / email | Standard vs Condition-level | Five required POC elements per State Operations Manual section 7314. Condition-level deficiencies escalate to Directed POC with 12-month hard deadline before CLIA cert revocation (42 CFR 493.1832). **NEW 2025: public release at 14 days post-receipt instead of 90.** |
| **AABB** | Event/nonconformance-driven (not survey-only) | Nonconforming Event Report (NER) form, Sections A-M | Risk levels 1-5 | FDA notification within 45 days for reportable events. Lead-staff review chain. CAPA evaluation. |

**Sources** (preserved from parking lot):
- CAP guide: https://documents.cap.org/documents/Guide-to-Accreditation_11_2025.pdf
- CAP common deficiencies: https://www.nsh.org/blogs/natalie-paskoski/2021/03/09/cap-deficiencies-and-how-to-avoid-them
- CAP e-LAB Solutions Suite: https://www.cap.org/laboratory-improvement/proficiency-testing/e-lab-solutions-suite
- TJC ESC overview: https://www.jointcommission.org/en-us/knowledge-library/support-center/post-survey-or-review/what-is-evidence-of-standards-compliance
- TJC ESC blog (May 2024 update): https://barrins-assoc.com/tjc-cms-blog/behavioral-health/evidence-of-standards-compliance/
- COLA: https://cola.org/accreditation/
- CMS-2567 form: https://www.cms.gov/medicare/cms-forms/cms-forms/downloads/cms2567.pdf
- POC writing guide: https://apps.hhs.texas.gov/business/CBT/correctionplans-nf/Writing_Acc_POCs_for_NF_REV_NOV_2023_FINAL_print.html
- 42 CFR 493.1832: https://www.law.cornell.edu/cfr/text/42/493.1832
- CMS QSO-25-19-ALL (14-day public release): https://leadingage.org/cms-shortens-timeline-on-public-release-of-statements-of-deficiencies/
- AABB NER: https://www.aabb.org/docs/default-source/default-document-library/accreditation/commendable-practices/nonconforming-event-report.pdf

## 5. v1 must-haves (beyond the obvious CRUD)

1. **Due-date auto-computation** per accreditor rule:
   - CAP = inspection_date + 30 days
   - TJC = report_posted_date + 60 days
   - CMS-2567 = receipt_date + 10 days
   - AABB = event-dependent
   - COLA = consultative; flagged as "no hard deadline" with a default check-in target
   - Calendar feed and email reminders at T-14, T-7, T-3, T-1.

2. **CMS-2567 renderer.** Real left-column (surveyor) / right-column (lab plan) PDF matching the federal form. Forces all 5 POC elements before submit. **Differentiator** given the 14-day public-release rule.

3. **Five-elements coach.** Blocks submission and tells the user in plain language which POC element is missing. Same UX shape as the CLIA validator hedge (PR #62 pattern):
   - (1) corrective action for affected patients/items
   - (2) identify others potentially affected
   - (3) systems/measures to prevent recurrence
   - (4) ongoing monitoring
   - (5) completion date

4. **Cross-link to VeritaCheck.** When a deficiency comes in citing GEN.20377 or a CFR §493 section, surface the most recent VeritaCheck score for that item. "Compliant last quarter, what changed?" or "At Risk — here's the mitigation we already drafted." **This is the moat.** No standalone deficiency tool can do that.

5. **Effectiveness-check tickler.** 30/60/90 days after completion_date, prompt the QA reviewer to attach monitoring evidence. Labs almost always drop this; surveyors love to ding it at the next inspection.

## 6. Architecture sketch (no schemas, just shape)

```
findings:
  id, lab_id, accreditor (CAP|TJC|COLA|CMS|AABB|Other),
  inspection_id, finding_number,
  standard_ref (e.g. GEN.20377 / 42 CFR 493.1251 / RFI 03.01.01.01),
  phase_or_severity (Phase I / Phase II / Condition / Standard /
                     RFI / NER risk 1-5),
  description, surveyor_notes,
  due_date (computed from accreditor-specific rule),
  status (open / drafting / submitted / accepted /
          rejected-resubmit / closed),
  immediate_action, containment, root_cause,
  corrective_action, preventive_action, monitoring_plan,
  completion_date, signed_by, signed_at,
  external_submission_ref (e-LAB ticket / JC Connect ID / CMS-2567 page#)

finding_attachments:
  finding_id, file, type (SOP, training log, QC chart, ...)

finding_history:
  finding_id, event, by_user, at, payload   -- audit trail, immutable

finding_extension_requests:
  finding_id, requested_until, reason, status
```

**Per-accreditor renderer.** Each accreditor gets a template adapter that maps the common spine onto their required output:
- CAP: per-checklist-item PDF
- TJC: ESC-formatted output
- CMS: CMS-2567 right-column populated PDF with all 5 POC elements explicitly labeled
- AABB: NER A-M structure
- COLA: consultative narrative

Same data, different render.

## 7. Scope tiers

| Tier | Scope | Effort |
|---|---|---|
| **Tier 1 (v1)** | findings table + CRUD UI + CAP renderer + CMS-2567 renderer + 5-elements validator + due-date computation + email reminders + VeritaCheck cross-link surface. Single-accreditor-per-finding for v1; if a lab is dual-accredited (CAP + TJC) they create separate finding records. | **3-5 weeks** |
| **Tier 2 (v1.1)** | TJC ESC renderer + COLA renderer + effectiveness-check tickler + extension-request workflow. | 2-3 weeks |
| **Tier 3 (v2)** | AABB NER renderer + multi-accreditor finding linking (one event, two cited bodies) + trend analytics across multi-year inspections. | 3-4 weeks |
| **Tier 4 (deferred)** | Any actual portal integration (e-LAB, JC Connect) only if the accreditor publishes an API. | Indefinite |

## 8. Risks

1. **Submission integration ceiling.** CAP e-LAB Suite and JC Connect are proprietary, online-only, no public API. We help the lab prepare and produce artifacts; they paste/upload. **Marketing must be honest** — this is a response-authoring and tracking tool, not a submission integration. Treat the absence of submission integration as a v1 feature, not a bug.

2. **PHI surface.** TJC's May 2024 update requires patient-impact documentation. Strong recommendation: **PHI-free zone.** Narrative only, no patient identifiers; UI nudge "refer by internal case number, do not paste PHI." Avoids HIPAA exposure on a SaaS surface that small labs will sign up for via self-serve checkout.

3. **Accreditor IP.** CMS-2567 is a federal form, public domain. CAP / TJC / AABB templates are proprietary. Mirror required CONTENT (mandated by regulation) without copying branded forms. **Likely worth a courtesy contact** with CAP and TJC before launch, mirroring the WSLH outreach pattern (parking-lot #16).

4. **Module weight.** v1 alone is 3-5 weeks for CMS-2567 + CAP rendering only. Per-accreditor adapters added over time. **Larger than VeritaPT or VeritaCheck.** Operator and team bandwidth need to be planned around this.

## 9. Cross-references

- **Multi-lab Tier 2 (#11/#12):** depends on `lab_members` table — findings should belong to a specific lab, not a user. **Not a hard block** but cleaner if Tier 2 lands first.
- **VeritaCheck (existing):** cross-link is a v1 feature, not a dependency. We pull the most recent VeritaCheck score for the cited standard at finding-creation time.
- **Pattern for accreditor-courtesy outreach:** echoes #16 (WSLH email) — name + scope email before launch.

## 10. Naming

Naming chosen: **VeritaResponse**. Confirmed by operator 2026-05-07.

Alternates considered and rejected:
- VeritaResolve (more abstract)
- VeritaCAPA (insider jargon, conflicts with the federal CMS-2567 "CAP" acronym)

## 11. What the operator needs to decide before code starts

1. **Approve the v1 must-haves** (Section 5). All 5 are recommendations from the parking-lot research; the operator can drop or add.
2. **Approve the Tier-1 scope** (Section 7) — CAP + CMS-2567 only for v1, TJC + COLA in Tier 2, AABB in Tier 3.
3. **Approve the PHI-free zone stance** (risk #2) and the corresponding UI nudge.
4. **Approve the accreditor-courtesy outreach plan** (risk #3) — ack to CAP and TJC before launch, mirroring WSLH (#16).
5. **Confirm subscription tier.** Recommendation: **standalone module priced like VeritaCheck Unlimited** (~$299-499/yr). Reason: this is a real product, not a feature; pricing it standalone signals value and avoids hostility from existing Hospital/Enterprise customers who would expect it bundled if it lived in their tier.
6. **Confirm sequencing.** Recommendation: **after multi-lab Tier 2 (#11/#12) lands** so the lab_id refactor doesn't bite. If the operator wants to ship sooner, the lab_members swap is a one-helper change later.

## 12. Effort estimate

Tier 1 (v1): **3-5 weeks** of focused implementation. Splits roughly:

- 5-7 days: schema (findings, attachments, history, extensions), endpoints, validation
- 7-10 days: CMS-2567 renderer (PDF with the federal form's left-right column shape, all 5 POC elements labeled)
- 5-7 days: CAP per-checklist-item renderer
- 5-7 days: UI (intake form, in-progress list, finding detail view, attachment upload)
- 3-4 days: 5-elements validator + due-date computation + email reminders
- 3-4 days: VeritaCheck cross-link surface (finding creation pulls the most recent VeritaCheck score for the cited standard)
- 3-4 days: testing, edge cases, documentation

Tier 2 (v1.1): **2-3 weeks** for TJC ESC + COLA + effectiveness tickler + extension workflow.
Tier 3 (v2): **3-4 weeks** for AABB NER + multi-accreditor linking + trend analytics.

## 13. The booth pitch (what this looks like to a prospect at COLA next year)

> "When you get cited — and you will — VeritaResponse turns a pile of Word documents and email threads into one tracked finding with a due-date clock, a five-elements validator that won't let you submit a half-baked response, and an automatic cross-reference to your VeritaCheck score for that standard so you can show the surveyor what you'd already done about it. CMS-2567, CAP, TJC, COLA, AABB. One module."
