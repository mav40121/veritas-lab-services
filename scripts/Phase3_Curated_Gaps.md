# VeritaPolicy Phase 3 — Curated Coverage Gaps

Manual semantic review of the 11 combined policies (IDs 97-111) against the 53 source templates that were absorbed into them. This file replaces the trigram-overlap report's 517 raw flags with an editorial verdict per combined: which source obligations are genuinely missing from the combined template, which are paraphrased adequately, and which definitions did not survive the merge.

97 and 105 are 1:1 renames and are not included.

**Verdict legend:**

- **TIGHT** — combined faithfully carries every material source obligation; missing items are stylistic or de minimis.
- **MODERATE GAPS** — 2-5 substantive obligations dropped; combined still ships but should be enriched before the next accreditor cycle.
- **SUBSTANTIAL GAPS** — 6+ substantive obligations dropped, or one or more high-stakes regulatory obligations (OSHA BBP, HIPAA Security Rule, CMS-notification triggers, FDA reportable timeframes) are absent. Enrichment is the priority queue.

---

## #98 — Pretransfusion Testing Policy (sources #49, #50, #51)

**Verdict: MODERATE GAPS**

**Missing obligations:**

- *#49 s4*: Specimen validity window — typically 3 days when the patient has been pregnant or transfused within the prior 3 months. The combined says specimens are received and accessioned but never names the 3-day window. This is the rule auditors look for.
- *#49 s5*: Specimen retention rule — refrigerated at 1-6°C, retained at least 7 days after the last transfusion or compatibility test. Combined retains records 10 years but is silent on physical specimen retention.
- *#50 s1*: Reverse typing is NOT performed on newborns under 4 months of age. Combined says reverse typing is performed "on every recipient specimen" — the neonatal carve-out is real and is dropped.
- *#50 s4*: Daily-of-use QC for ABO/Rh reagents per 42 CFR 493.1256 (positive and negative controls for anti-A, anti-B, anti-D; A1 and B reactive cells). Combined references "validated procedure" but does not state the daily QC rule or the §493.1256 citation.
- *#50 s3*: Historical ABO/Rh comparison rule — current result must be compared to any historical on-file result before issue, and a discrepancy halts issue. Combined C2 covers discrepancies broadly but not the "historical comparison" obligation specifically.
- *#51 s1*: Antiglobulin (indirect Coombs) phase required in major crossmatch unless emergency release. Combined C4 says "serologic crossmatch" generically; the antiglobulin step is not named.
- *#51 s3*: Prior-antibody honoring — historical antibodies must trigger antigen-negative unit selection at every subsequent crossmatch, regardless of current screen. Dropped.

**Missing definitions:**

- *#49*: Specimen validity window
- *#50*: Historical comparison; Second-sample confirmation
- *#51*: Clinically significant antibody

**Recommended add-backs (first priority):** specimen validity window (#49), neonatal reverse-typing carve-out (#50), daily ABO/Rh QC per §493.1256 (#50), antigen-negative selection for prior antibodies (#51).

---

## #99 — Blood Component Handling Policy (sources #42, #44, #45, #46, #47, #48, #55, #56, #57)

**Verdict: SUBSTANTIAL GAPS**

This is the deepest merge in the consolidation (9 sources → 1 combined) and the most thinned. The combined ships a competent program skeleton but leaves out a lot of operational specificity.

**Missing obligations:**

- *#42 s2*: FEFO (First Expiry First Out) rotation rule. Combined never names FEFO.
- *#42 s3*: Minimum-on-hand by component and ABO/Rh, with reorder triggers approved by the medical director or designee. Dropped.
- *#44 s4*: Medical director or designee review of every emergency external release within 5 business days. Dropped.
- *#45 s1*: Component-specific temperature ranges — RBC 1-6°C; platelets 20-24°C with continuous gentle agitation; FFP -18°C or colder; cryo -18°C or colder. Combined says "validated temperatures" without listing them.
- *#45 s4*: Return-window rule — RBC accepted back into inventory only within 30 minutes of issue (or longer if validated cooler maintained 1-10°C and integrity intact). Dropped.
- *#46 s6*: Monthly review of the Storage Alarm Response log by the medical director or designee. Dropped.
- *#47 s2*: Daily-of-use reactivity QC per 42 CFR 493.1273(a) with specific elements (reagent red cells, antisera, antiglobulin reagent against IgG-sensitized control cells, negative controls). Combined C5 says "QC-tested on each day of use" without the §493.1273(a) detail.
- *#47 s3*: New-lot parallel testing against the prior lot before placing the new lot into service. Dropped.
- *#55 s3*: Plasma ABO compatibility table (AB universal; A→A&O; B→B&O; O→O only). Dropped.
- *#56 s1*: Specific TA-GVHD irradiation indications — intrauterine and neonatal, HLA-matched, biologic-relative units, hematologic malignancy, HSCT, congenital immunodeficiency. Combined names TA-GVHD but not the indication list.
- *#57 s1*: Specific leukoreduction indications — CMV transmission risk, febrile non-hemolytic reaction prevention, HLA-alloimmunization. Combined names leukoreduction but not the indication list.

**Missing definitions:** FEFO; Chain of custody; Validated cooler; Return window; Reactivity QC; Antiglobulin reagent; Thawed plasma; TA-GVHD (combined has it but def text is sparse).

**Recommended add-backs (first priority):** the temperature-range table (#45), FEFO and minimum-on-hand (#42), the plasma ABO compatibility table (#55), the irradiation indication list (#56), and the leukoreduction indication list (#57). These five carry the bulk of the operational specificity an AABB assessor would walk through.

---

## #100 — Transfusion Administration Policy (sources #52, #53, #54, #58, #59, #60)

**Verdict: SUBSTANTIAL GAPS**

The biggest single gap is the RhIG dosing protocol from #54, which is fully dropped.

**Missing obligations:**

- *#52 s2*: Two clinical staff independently verify patient against unit at bedside; both sign. Combined C1 says "two patient identifiers and a documented checklist" but does not specify two-staff independent verification.
- *#53 s2*: Group O default by sex — O Rh-negative for women of childbearing potential, O Rh-positive otherwise. Dropped.
- *#54 s2*: RhIG antepartum dose — 1 vial (300 mcg) at approximately 28 weeks gestation. Dropped.
- *#54 s2*: RhIG postpartum dose — 1 vial within 72 hours of delivery of a D-positive infant. Dropped.
- *#54 s3*: Fetomaternal-hemorrhage screen (rosette test or equivalent) on the postpartum maternal sample of every D-negative woman delivering a D-positive infant; positive screen triggers quantitative testing (Kleihauer-Betke or flow cytometry). Dropped.
- *#54 s4*: Dose calculation for FMH greater than 30 mL fetal whole blood — 1 additional vial per 30 mL fetal whole blood, calculation verified by a second technologist or the medical director or designee. Dropped.
- *#58 s2*: Neonatal transfusion rules — no reverse ABO under 4 months; use mother's antibody screen if available; small-volume aliquots from approved parent units with full traceability. Combined C4 says "fresh, volume-reduced as clinically indicated" but does not name the maternal-antibody-screen rule or the aliquot procedure.
- *#60 s7*: Fatal reactions reported to FDA CBER ASAP by phone or electronic transmission, written report within 7 days, per 21 CFR 606.170(b). Combined C7 says "within the required timeframe" without naming the 7-day rule.

**Missing definitions:** Bedside check (two-staff specifics); Fetomaternal hemorrhage (FMH); Rosette test; Neonatal transfusion; Aliquot; DAT.

**Recommended add-backs (first priority):** the full RhIG section (#54 — antepartum, postpartum, FMH screen, dose calc), the neonatal carve-outs (#58), the Group O default by sex (#53), and the explicit 7-day fatal-reaction reporting (#60). These are concrete actions a transfusion service does daily, and a TJC or AABB surveyor will ask for them by name.

---

## #101 — Blood Recipient Look-Back Policy (sources #61, #62)

**Verdict: TIGHT**

Sources #61 (HIV) and #62 (HCV) describe the same workflow with different regulatory citations. The combined explicitly cites both 21 CFR 610.46 (HIV) and 21 CFR 610.47 (HCV) and pulls the merged workflow forward intact. No material obligations dropped.

---

## #102 — Donor Operations Policy (sources #43, #63, #64, #65)

**Verdict: MODERATE GAPS**

The supplier-agreement piece (#43) and the donation core (#63) lost specific obligations that a collection establishment would need spelled out.

**Missing obligations:**

- *#43 s3*: Annual supplier performance review (on-time delivery, recall responsiveness, component quality). Combined CS1 says "renew annually" but does not require a performance review.
- *#63 s2*: Written donor consent covering donation process, risks, post-donation testing, and notification of abnormal findings. Dropped.
- *#63 s3*: Donor History Questionnaire (current FDA-recognized DHQ) — named instrument. Combined says "health history questionnaire" without naming the DHQ or its FDA-recognized status.
- *#63 s4*: Post-donation testing per 21 CFR 610.40-45 — ABO/Rh, antibody screen, transfusion-transmitted infectious diseases. Dropped.
- *#63 s5*: Donor notification of abnormal findings per 21 CFR 630.40 with required information and follow-up resources. Dropped.
- *#64 s3*: Specific donor reactions named — vasovagal, hematoma, citrate reaction. Combined says "any adverse donor reaction" generically.
- *#65 s4*: Post-procedure care for therapeutic apheresis — return of cellular components, delayed-reaction monitoring, discharge criteria. Dropped.

**Missing definitions:** Donor History Questionnaire; Deferral; Adverse donor reaction; Therapeutic apheresis (combined has it but def is sparse).

**Recommended add-backs (first priority):** DHQ as named instrument (#63), donor consent (#63), 21 CFR 610.40-45 post-donation testing (#63), 21 CFR 630.40 abnormal-finding notification (#63). This combined matters only for labs that actually collect; for hospital labs purchasing from a supplier the gap is lower-stakes.

---

## #103 — Personnel Qualifications Policy (sources #17, #91, #92, #93, #94)

**Verdict: SUBSTANTIAL GAPS**

The Laboratory Director-change workflow (#91) and the supervisor-vacancy workflow (#92) carry CMS-facing obligations that did not survive the merge.

**Missing obligations:**

- *#17 s5/s6*: 60-day pre-expiration credential notification; on lapse, the individual is removed from CLIA-qualifying duties. Combined CS4 says "flag any lapse" but does not state the 60-day notification or the duty-removal rule.
- *#91 s4*: On any change of Laboratory Director, the lab notifies CMS within 30 days per 42 CFR 493.1775. Dropped.
- *#91 s4*: New Laboratory Director re-approves all active procedures within 6 months of appointment. Dropped.
- *#91 s6*: Documented director-oversight model (on-site days per month, remote access, on-call coverage) reviewed annually. Dropped.
- *#92 s4*: Vacancies in any technical-supervisor role longer than 30 days reported to the medical director or designee for escalation. Dropped.
- *#92 s6*: Annual review of each technical supervisor against the eight CLIA responsibilities at 42 CFR 493.1451(b). Dropped.
- *#93 s4*: Day-to-day oversight model for general supervisor — on-site, accessible by phone, or able to be present in person within a reasonable time per CMS guidance. Dropped.
- *#93 s5*: Orientation of every new testing staff member delivered or directly overseen by the general supervisor. Dropped.
- *#93 s6*: Annual performance evaluation of every testing staff member by the general supervisor or delegate. Dropped.

**Missing definitions:** Medical director; Designee; Director-oversight model; Specialty (in the CLIA §493.1271 sense); Role Vacancy register; Day-to-day oversight; Qualifying pathway.

**Recommended add-backs (first priority):** CMS-notification on director change within 30 days (#91), new-director procedure re-approval within 6 months (#91), 30-day technical-supervisor vacancy escalation (#92), 60-day credential-expiration notification + duty removal on lapse (#17). These four are the CMS-side trip wires.

---

## #104 — Training and Competency Policy (sources #18, #19, #20)

**Verdict: MODERATE GAPS**

The combined captures the timeline and the six-element framework. What is missing is the precise enforcement detail that auditors hammer on.

**Missing obligations:**

- *#18 s2*: Specific orientation topics enumerated — HIPAA, infection prevention, downtime procedures, critical-value reporting, incident reporting. Combined C1 says "lab, the test menu, relevant safety and QC procedures, and documentation expectations" — the enumeration is dropped.
- *#19 s4*: Re-training when test system, reagent, calibrator, or procedure changes materially, documented BEFORE the change goes into effect. Combined C2 mentions "procedure changes" but does not state the before-go-live requirement.
- *#19 s5*: Continuing-education tracking categories — external CE, internal in-services, vendor training, conference attendance — logged in the personnel record. Dropped.
- *#20 s4*: Element 1 (direct observation of testing) and Element 4 (direct observation of maintenance) require the **observer's** initials, not the evaluator's; observer must hold the role of Laboratory Director, Technical Consultant, or Technical Supervisor. Combined C5 names the evaluator but does not enforce the observer-role rule.
- *#20 s5*: Element 3 records the date the staff member **ran** the QC, not the date the QC was reviewed. Dropped.
- *#20 s6*: The same person may serve as both the observer and the evaluator if their role qualifies, but both signature fields are required. Dropped.
- *#20 p4*: Subsequent assessment dates are driven by the prior assessment date, not by the calendar year. Dropped.

**Missing definitions:** Orientation; Initial Training; Re-training; Continuing education; Direct observation.

**Recommended add-backs (first priority):** the four precise enforcement points from #20 (observer vs evaluator, observer role requirement, Element 3 date semantics, anchor-to-prior-date scheduling). These are exactly what surveyors look for on competency records.

---

## #106 — Waived and Point-of-Care Testing Policy (sources #85, #86, #87, #88)

**Verdict: MODERATE GAPS**

**Missing obligations:**

- *#85 s2*: Modification of a waived test (different sample type, off-label use, calculation alteration) reclassifies the test as **high complexity** per CMS guidance, not just "non-waived." Combined C1 understates the reclassification.
- *#87 s3*: Assessor for waived testing is the General Supervisor, the Technical Consultant, or the medical director or designee per CMS guidance for waived complexity. Combined C4 does not specify the assessor role for waived.
- *#88 s1*: Every POCT site under the lab's CLIA certificate is listed on the lab's CLIA application and approved by the medical director or designee. Combined C5 says "centrally overseen" but does not mention CLIA-application listing.
- *#88 p1*: New POCT site at a different address triggers a CLIA certificate update. Dropped.
- *#88 s3*: POCT roster of trained / competency-assessed / authorized operators, maintained current. Dropped.
- *#88 s5*: POCT results entered into the LIS or EHR with operator ID, device ID, date/time, and result. Dropped.

**Missing definitions:** Manufacturer's instructions; Modification (with the reclassification consequence); External QC; Internal QC; POCT operator.

**Recommended add-backs (first priority):** the reclassification-to-high-complexity language (#85), the assessor-role list for waived (#87), the CLIA-application/address rules for POCT sites (#88).

---

## #107 — Molecular Testing Policy (sources #75, #76, #77)

**Verdict: SUBSTANTIAL GAPS for the genetic-testing piece**

The molecular-core elements (#75 verification and #76 QC) survive in adequate shape. The molecular-genetic obligations from #77 — which are the highest-risk piece because they touch patient counseling and reclassification workflows — are mostly dropped.

**Missing obligations:**

- *#76 s2*: Quantitative molecular assays include at least two concentration levels of positive control. Dropped.
- *#77 s1*: Genetic test orders include indication, family history when relevant, ethnicity when used in interpretation, and any prior testing in the patient or family. Dropped.
- *#77 s2*: Informed consent for genetic testing where required by state law or by the lab's policy; consent covers implications of positive, negative, and indeterminate results. Combined says "interpretive guidance" but never names consent.
- *#77 s3*: Variant classification per current ACMG-style criteria or equivalent (pathogenic, likely pathogenic, VUS, likely benign, benign). Combined C3 says "report interpretation guidance" but does not name ACMG-style criteria.
- *#77 s4*: Reports include the regions or genes tested, variants identified, variant classification, recommended follow-up (genetic counseling, family testing, clinical correlation), and limitations. Combined names "interpretive guidance" generically.
- *#77 s5*: Variant reclassification procedure — clinically significant reclassifications trigger amended reports and provider notification. Dropped.

**Missing definitions:** Pre-amplification area; Run-level QC; Variant classification; Variant reclassification.

**Recommended add-backs (first priority):** the variant-reclassification workflow (#77) and the genetic-test report content list (#77). The variant-reclassification piece is where labs get sued; do not leave it implicit.

---

## #108 — Health Information Management Policy (sources #25, #26, #27)

**Verdict: SUBSTANTIAL GAPS**

Three CFR-cited obligations dropped, each consequential. This is a steady-state policy serving multiple accreditors; thinning it will get caught.

**Missing obligations:**

- *#25 s3*: Minimum-necessary standard — only the PHI needed for the purpose is accessed or shared. Dropped (combined C1 mentions need-to-know but not the regulatory term "minimum necessary").
- *#25 s6*: Business Associate Agreements with every vendor, courier, or contractor that creates, receives, maintains, or transmits PHI on the lab's behalf. Dropped.
- *#25 s7*: Privacy-incident workflow — breach risk assessment per 45 CFR 164.402, notifications to affected individuals, HHS via the breach portal, and media if 500+ in a state, per 45 CFR 164.404. Combined C6 references 45 CFR 164.402 but does not name the 60-day individual / HHS / 500+ media tiers.
- *#26 s3*: Multi-factor authentication enforced for remote access and for any administrative role; shared accounts prohibited. Dropped.
- *#26 s4*: Audit logs retained for at least 6 years per the HIPAA Security Rule and reviewed at least monthly. Combined says "audit controls" but not the 6-year retention or monthly review.
- *#26 s5*: ePHI encrypted at rest on portable devices and during transmission across non-internal networks. Combined says "validated, encrypted channels" but only for transmission, not at-rest on portable devices.
- *#27 s1*: Interface calculation verification at LIS go-live and after any interface change, per 42 CFR 493.1281(c). Dropped.
- *#27 s2*: LIS-to-EHR result-transmission validation end-to-end with a documented sample-patient/sample-result test. Dropped.
- *#27 p3*: Daily review of the LIS interface error queue. Dropped.

**Missing definitions:** Minimum necessary; Business Associate Agreement (BAA); ePHI; Audit log; Calculation verification; Interface error queue.

**Recommended add-backs (first priority):** BAA requirement (#25), MFA for remote/admin (#26), interface calculation verification per §493.1281(c) (#27), 60-day breach-notification mechanics (#25). The §493.1281 reference is a CLIA hit, not just HIPAA.

---

## #109 — Laboratory Governance and Leadership Policy (sources #29, #30, #31, #32)

**Verdict: SUBSTANTIAL GAPS**

Governance and ethical-conduct obligations from #30 and #32 dropped at a board-level. Combined ships a useful org-chart-and-just-culture sketch but does not carry the governing-body, anti-kickback, and fabrication-consequence content the source policies named.

**Missing obligations:**

- *#29 s4*: Current org chart posted in the lab and available to inspectors on request; previous versions archived at least 2 years. Dropped.
- *#29 s5*: CLIA-required role vacant more than 30 days reported to CMS per 42 CFR 493.1775. Combined CS1 mentions org-chart maintenance but does not name the 30-day CMS escalation.
- *#30 s2*: Governing body responsibilities documented — appointment and oversight of the medical director, approval of major operational and capital decisions, financial stewardship, final accountability for regulatory compliance. Dropped entirely; combined never describes a governing body.
- *#30 p2*: Governing body meetings on a regular schedule (typically quarterly) with retained minutes. Dropped.
- *#31 s2*: Reckless behavior, willful misconduct, knowing policy violation — subject to discipline; honest mistakes addressed through process improvement. Combined C4 says "just-culture principles" but does not draw the disciplinary line.
- *#32 s2*: Fabrication of test results, alteration of records, falsification of QC or competency — absolute violations resulting in immediate termination and reporting to licensing/regulatory authorities. Dropped.
- *#32 s5*: Anti-kickback obligations (42 USC 1320a-7b) and Stark Law obligations (42 USC 1395nn). Dropped entirely. These are federal statute obligations and their absence in a Code of Ethical Conduct is unusual.

**Missing definitions:** Reporting line; Role Vacancy register; Governing body; Decision authority; Non-punitive reporting; Conflict of interest; Anti-kickback.

**Recommended add-backs (first priority):** the governing body responsibilities from #30, the anti-kickback / Stark citation from #32, the fabrication-consequence language from #32, the 30-day CMS escalation for vacant CLIA roles from #29. The first three are board-level governance; the fourth is a CMS-facing trigger.

---

## #110 — Infection Prevention and Standard Precautions Policy (sources #22, #23)

**Verdict: SUBSTANTIAL GAPS**

Only two sources merged, but the obligations dropped are the central OSHA Bloodborne Pathogens Standard obligations. This is the highest-risk thinning in the entire Phase 3.

**Missing obligations:**

- *#22 s3*: Hepatitis B vaccination offered at no cost to every staff member with occupational exposure within 10 working days of initial assignment; declination documented in writing. Dropped. **This is the central OSHA 29 CFR 1910.1030(f) obligation.**
- *#22 p3*: On a sharps injury or exposure incident, source-patient testing where the source is identifiable, per OSHA. Combined CS3 says "medical follow-up arranged per the exposure control plan" but does not name source-patient testing.
- *#23 s4*: No eating, drinking, smoking, applying cosmetics or lip balm, handling contact lenses, mouth pipetting in the lab work area. Dropped. This is the classic OSHA/CAP rule and is the easiest single thing to be cited on.
- *#23 p2*: PPE donning sequence (gown, mask/respirator, eye protection, gloves) and doffing sequence (gloves, gown, eye protection, mask/respirator) with hand hygiene before and after. Dropped.
- *#23 p4*: Reusable lab coats sent to laundry, NOT taken home; laundry contract specifies bloodborne-pathogen handling. Dropped.
- *#23 p5*: Spill response uses EPA-registered tuberculocidal disinfectant per the manufacturer's contact time. Combined CS3 references the spill response procedure but does not name the tuberculocidal-disinfectant requirement.

**Missing definitions:** Exposure incident; Personal Protective Equipment (PPE); Spill Kit.

**Recommended add-backs (first priority):** HBV vaccination workflow per OSHA 1910.1030(f) (#22), the no-eating/drinking ban (#23), source-patient testing on exposure (#22), tuberculocidal disinfectant in spill response (#23). The first two are not optional; surveyors look for them by name on the first day of a TJC or COLA visit.

---

## #111 — Human Cells, Tissues, and Cellular Tissue-Based Products (HCT/P) Policy (sources #82, #83, #84)

**Verdict: MODERATE GAPS**

**Missing obligations:**

- *#82 s2*: Required infectious-disease markers — HIV-1/2, HBV, HCV, HTLV-I/II, syphilis treponemal, others per current FDA list. Combined C1 says "infectious disease screening" generically.
- *#82 s3*: Results reported to the procuring organization with full specimen identification, test methods, reactive/non-reactive determination, and limitations. Dropped.
- *#83 s1*: Products missing eligibility evidence are NOT accepted. Combined C2 covers handling but does not state the affirmative rejection rule.
- *#83 s3*: Release to surgical use requires verified donor eligibility, intact packaging, valid expiration, and recipient/product identification matching the request. Combined CS3 says "after eligibility determination is complete" but does not enumerate the four-element check.
- *#84 s2*: Reportable adverse reactions per 21 CFR 1271.350(a) reported to FDA within **15 days** of the lab becoming aware. Combined C4 says "within the required timeframe" without naming 15 days.

**Missing definitions:** Donor eligibility testing; HCT/P deviation; HCT/P adverse reaction.

**Recommended add-backs (first priority):** the explicit infectious-disease marker list (#82), the 15-day FDA reporting timeframe (#84), the four-element release check (#83). These are the specific operational checkpoints an FDA tissue-establishment inspection walks through.

---

# Summary

| Combined | Sources merged | Verdict | High-priority add-backs |
|---|---|---|---|
| #98 Pretransfusion Testing | 3 | MODERATE GAPS | 4 |
| #99 Blood Component Handling | 9 | SUBSTANTIAL GAPS | 5 |
| #100 Transfusion Administration | 6 | SUBSTANTIAL GAPS | 4 |
| #101 Look-Back (HIV/HCV) | 2 | TIGHT | 0 |
| #102 Donor Operations | 4 | MODERATE GAPS | 4 |
| #103 Personnel Qualifications | 5 | SUBSTANTIAL GAPS | 4 |
| #104 Training and Competency | 3 | MODERATE GAPS | 4 (single source #20 carries all four) |
| #106 Waived and POCT | 4 | MODERATE GAPS | 3 |
| #107 Molecular Testing | 3 | SUBSTANTIAL GAPS | 2 (both from #77 genetic) |
| #108 Health Information Management | 3 | SUBSTANTIAL GAPS | 4 |
| #109 Leadership Governance | 4 | SUBSTANTIAL GAPS | 4 |
| #110 Infection Prevention | 2 | SUBSTANTIAL GAPS | 4 (all OSHA BBP) |
| #111 HCT/P | 3 | MODERATE GAPS | 3 |

**Verdict totals:** 1 TIGHT, 5 MODERATE GAPS, 7 SUBSTANTIAL GAPS.
**Recommended high-priority add-backs across all combineds:** 41 specific obligations.

**The two highest-stakes combineds to enrich first:**

1. **#110 Infection Prevention.** The OSHA Bloodborne Pathogens Standard obligations dropped (HBV vaccination workflow, source-patient testing on exposure, no-eating-or-drinking ban, tuberculocidal-disinfectant spill response) are exactly what a TJC or COLA surveyor looks for in the first hour. This is not a coverage hint — this is an OSHA citation risk.

2. **#108 Health Information Management.** Three CFR-cited obligations missing (§493.1281(c) interface calculation verification, the BAA requirement, the HIPAA Security Rule MFA and 6-year audit-log retention). These are commonly cited and the combined currently does not name them.

**What this report is not:** I have not re-checked the CFR citation aggregation in the master list rows. The trigram report flagged some statements as LOW OVERLAP that I judged as adequately paraphrased — those are not listed here. The reviewer (you) makes the final call on whether to add back each item or accept the thinning.

---

## Addendum (post-enrichment, 2026-05-27): definition gap closure

After the 19 high-priority definition add-backs landed in PR #397, the trigram coverage script's "NOT IN COMBINED" flag count dropped from 25 → 6.

The 6 still-flagged definitions are **genuine naming variants** where the concept IS in the combined template under a slightly different spelling that the substring-match script cannot detect as a synonym. These are NOT real gaps. Leaving the combined names as-is rather than polluting the templates with duplicate entries:

| Source def name | Combined name (already present) | Source → Combined |
|---|---|---|
| Forward type | Forward typing | #50 → #98 |
| Reverse type | Reverse typing | #50 → #98 |
| Computer (electronic) crossmatch | Electronic crossmatch | #51 → #98 |
| Primary-source verification | Primary source verification | #17 → #103 |
| Six-month assessment | 6-month re-assessment | #20 → #104 |
| POCT coordinator | POC coordinator | #88 → #106 |

All six are documented in the verify-veritapolicy-docx.js receipts and the regenerated coverage report. Future iterations of the coverage script could add a Levenshtein or normalized-name match to suppress these automatically.
