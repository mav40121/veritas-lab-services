# Regulatory Baseline Index — Veritas Lab Services

This index is a structural map of the operator's authoritative source material. It does **not** contain the source text. Use it to locate the right file/page/section, then read that section for the actual content.

The five sources, in order of authority for typical compliance questions:

1. **42 CFR Part 493** — federal regulation; the floor every US clinical lab must meet.
2. **TJC Laboratory Accreditation Manual 2024** — Joint Commission accreditor manual; binding for TJC-accredited labs.
3. **CAP 2026 Master Checklists** (12 discipline files) — College of American Pathologists checklists; binding for CAP-accredited labs.
4. **CMS CLIA Brochures** — CMS's plain-language interpretation of the regulation.
5. **Lab Management 101** by Michael Veri — operator-authored synthesis, applied workflows.

Section 6 ("Topic crosswalk") is the most useful section once you need to verify a specific claim or draft copy on a specific topic.

---

## 1. 42 CFR Part 493 — Laboratory Requirements

**Source:** https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493
**Structure JSON:** fetched from https://www.ecfr.gov/api/versioner/v1/structure/2026-01-01/title-42.json

| Subpart | Title | Key sections |
|---|---|---|
| **A** (9 sec) | General Provisions | 493.1 Basis/scope · 493.2 Definitions · 493.3 Applicability · 493.5 Categories of tests by complexity · 493.15 Waived tests · 493.17 Test categorization · 493.19 PPM procedures · 493.20 Moderate complexity · 493.25 High complexity |
| **B** (4 sec) | Certificate of Waiver | 493.35 Application · 493.37 Requirements · 493.39 Notification · 493.41 SARS-CoV-2 reporting |
| **C** (6 sec) | Registration Cert / PPM / Certificate of Compliance | 493.43 - 493.53 |
| **D** (4 sec) | Certificate of Accreditation | 493.55 - 493.63 |
| **E** (13 sec) | Accreditation by Private Nonprofit / State Exemption | 493.551 General reqs · 493.553 Approval process · 493.563 Validation inspections · 493.575 Removal of deeming authority |
| **F** (9 sec) | General Administration (Fees) | 493.602 - 493.680 |
| **G** | [Reserved] | — |
| **H** (4 sec) | Participation in PT for Nonwaived Testing | 493.801 Enrollment · 493.803 Successful participation · 493.807 Reinstatement · PT by Specialty/Subspecialty |
| **I** (4 sec) | PT Programs for Nonwaived Testing | 493.901 Approval · 493.903 Admin responsibilities · 493.905 Nonapproved programs |
| **J** (4 sec) | Facility Administration for Nonwaived Testing | 493.1100 Facility admin · 493.1101 Facilities · 493.1103 Transfusion services · 493.1105 Retention requirements |
| **K** (24 sec) | **Quality System for Nonwaived Testing** ⭐ | Conditions: Bacteriology, Mycobact, Mycology, Parasit, Virology, Syphilis, Immunology, Routine Chemistry, Urinalysis, Endocrine, Tox, Hematology, Immunohematology, Histopath, Oral path, Cytology, Cytogenetics, Radiobioassay, Histocompat. Plus the four big systems sub-buckets: General Lab Systems, Preanalytic, Analytic (493.1252-1257 incl. **493.1253 Performance verification**), Postanalytic. |
| **L** | [Reserved] | — |
| **M** (4 sec) | Personnel for Nonwaived Testing | 493.1351 General · PPM · Moderate · High complexity |
| **N-P** | [Reserved] | — |
| **Q** (5 sec) | Inspection | 493.1771 - 493.1780 |
| **R** (22 sec) | Enforcement Procedures | 493.1800 - 493.1850 (sanctions, civil money penalty, suspension, revocation, appeals) |
| **S** | [Reserved] | — |
| **T** (1 sec) | Consultations | 493.2001 CLIAC |

**Key sections most often cited in product copy / PDFs:**
- **493.1252** — Test systems, equipment, instruments, reagents, materials, and supplies (Subpart K, Analytic Systems)
- **493.1253** — Establishment and verification of performance specifications (the canonical "Performance Verification" cite)
- **493.1255** — Calibration and calibration verification procedures
- **493.1281** — Comparison of test results
- **Specialty CFR for VeritaCheck PDFs**: Chemistry §493.931, Hematology §493.941, Immunohematology §493.959, Microbiology §493.945, default §493.931 (per CLAUDE.md §5; §493.927 is General Immunology)

---

## 2. TJC Laboratory Accreditation Manual

**Edition:** the current manual (the operator holds a paper copy locally; this index does not commit to a specific edition since accreditor manual editions cannot be named in public copy per CLAUDE.md §3).
**Scope:** approximately 766 pages.

**Top-level chapter map (page numbers from PDF outline):**

| Code | Chapter | Page | Notes |
|---|---|---|---|
| WN | What's New / Full Year Update | 1 | revision summary |
| Cover | Cover | 13 | — |
| INTRO | Introduction | 17 | — |
| PS | Patient Safety Systems | 45 | — |
| APR | Accreditation Participation Requirements | 67 | — |
| DC | Document Control | 81 | — |
| EC | Environment of Care | 103 | — |
| EM | Emergency Management | 137 | — |
| HR | Human Resources | 161 | competency, training |
| IC | Infection Control | 183 | — |
| IM | Information Management | 203 | — |
| LD | Leadership | 219 | director responsibilities, policies |
| NPSG | National Patient Safety Goals | 253 | — |
| PI | **Performance Improvement** | 261 | quality monitoring, indicators |
| QSA | **Quality System Assessment** ⭐ | 275-466 | the largest chapter (192 pages) — verification, calibration, PT, QC, method comparison live here |
| TS | Transplant Safety | 467 | — |
| WT | Waived Testing | 481 | — |
| ACC | Accreditation Process | 499-571 | survey policies, decision rules — see detailed sub-bookmarks below |
| SAG | Survey Activity Guide | 573 | — |
| SE | Sentinel Events | 633 | — |
| QR | Quick Reference | 655 | — |
| RWD | (TBD — not in CLAUDE.md) | 661 | — |
| ESP | (TBD — not in CLAUDE.md) | 667 | — |
| AXA-D | Appendices A-D | 673-682 | — |
| Glossary | Glossary | 683 | — |
| Index | Index | 707 | — |

**ACC chapter sub-bookmarks (most operationally useful):**
- Notices, ACC Chapter Contents, Overview (p.499-501)
- Accreditation Policies (p.502): Tailored Survey, Multiorganization Option, Concurrent Survey, Contracted Services, PT Monitoring, Initial Surveys, Information Accuracy, Public Information Policy, Process for Responding to a Complaint
- Before the Survey (p.517): Joint Commission Connect, Account Executive, E-App, Contract/BAA, Annual/Survey Fees
- During the Survey (p.522): Notification, Team Composition, Agenda, Tracer Methodology, Immediate Threat to Health/Safety, Summary of Reports
- After the Survey (p.535): Scoring Process, ESC Process (Evidence of Standards Compliance), Award Display
- Between Surveys (p.545): ICM (Intracycle Monitoring), FSA (Focused Standards Assessment), Sentinel Event Follow-up, Notifying TJC About Changes, Cease Services, Reentering, Additional Surveys
- Decision Rules (p.556-566): Initial accreditation, Reaccreditation, PDA02 (patients at risk), PDA04
- Review and Appeal Procedures (p.567)

**For deep-dives:** read pages 275-466 (QSA) when working on any verification, calibration, QC, PT, method comparison, or competency feature. That chapter is the single most-cited TJC source for the VeritaAssure modules.

---

## 3. CAP 2026 Master Checklists

**Edition Date:** 12/09/2025 (all 12 files)

**Canonical column structure** (every file, header row is row 6):
`Requirement (ID) | Policy/Procedure | Phase | Subject Header | Requirement | Note | Evidence of Compliance`

**Rows 1-5** carry the file metadata (copyright, checklist name, edition date, print date, blank). **Row 6** is the column header. **Rows 7+** are checklist requirements.

**Requirement ID format:** `<DISCIPLINE>.<5-digit-number>` (e.g., `GEN.13750`, `COM.01300`, `CHM.13000`).

| File code | Discipline | Items (~) | Notes |
|---|---|---|---|
| **COM** | All Common (foundational, applies to every lab) | ~85 | PT participation/attestation, specimen collection, instrument operation, IQCP, waived tests. **Read this first for any lab compliance question.** |
| **GEN** | Laboratory General | ~253 | QMS, scope of service, PPE, specimen collection, autoverification, phlebotomy. Largest core checklist. |
| **TRM** | Transfusion Medicine | ~259 | LIS validation, monthly QC review, RhIG, donor records, transfusion service medical director. |
| **MIC** | Microbiology | ~215 | PT extent, susceptibility testing, Gram stain, biochemical QC, serologic controls, amplification controls. |
| **ANP** | Anatomic Pathology | ~189 | Professional competency, surgical specimen handling, histology specimen prep, ex vivo microscopy, intra/extra-departmental consultations, verbal reports. |
| **HEM** | Hematology and Coagulation | ~183 | Waived QC, calibration verification, platelet hemocytometry, reference intervals, electrophoresis QC, semen analysis. |
| **CHM** | Chemistry and Toxicology | ~153 | Hemoglobin A1C accuracy-based PT, calibration procedure, daily QC, sweat chloride AMR, blood gas QC. |
| **CYP** | Cytopathology | ~86 | Gynecologic cytopathology PT/educational, antibody QC, non-gyn correlation, diagnostic discrepancies, microwave monitoring. |
| **POC** | Point-of-Care Testing | ~67 | A1C accuracy-based PT, POCT org chart, error detection, personnel training, calibration materials, blood gas QC, PPM competency. |
| **IMM** | Immunology | ~65 | Calibration verification waived, daily QC nonwaived, absorbance/linearity, antiglobulin/anti-C3 controls. |
| **URN** | Urinalysis | ~28 | Specimen examination timing, preservation, waived QC, alternative control procedures, reference materials, carryover detection. |
| **DRA** | **Director Assessment** | ~21 | NOT drug testing. Lab director qualifications, director responsibilities incl. biorepository-only, AP services, education/R&D, government/regulatory interaction. |

**Total checklist items across all 12: ~1,614.**

**Common Subject Header categories** seen across files: Calibration, Calibration Verification, QC (Daily/Monthly/Waived), PT, Reference Intervals, AMR, Specimen Handling, Personnel/Competency, Method Comparison, IQCP, Director Responsibilities, Reagents/Controls.

---

## 4. CMS CLIA Brochures

**Source:** https://www.cms.gov/medicare/quality/clinical-laboratory-improvement-amendments/brochures

The 10 brochures, with CMS download paths:

| # | Title | Date | Path on cms.gov |
|---|---|---|---|
| 1 | **Verification of Performance Specifications** | Apr 2006 | `/regulations-and-guidance/legislation/clia/downloads/6064bk.pdf` |
| 2 | **Calibration and Calibration Verification** | Apr 2006 | `/files/document/clia-brochure-calibration-and-calibration-verification-april-2006.pdf` |
| 3 | **Assessing Personnel Competency** | May 2025 | `/regulations-and-guidance/legislation/clia/downloads/clia_compbrochure_508.pdf` |
| 4 | **Laboratory Director Responsibilities** | May 2025 | `/regulations-and-guidance/legislation/clia/downloads/brochure7.pdf` |
| 5 | **Proficiency Testing and PT Referral** | Oct 2024 | `/files/document/clia-brochure-proficiency-testing-and-pt-referral-october-2024.pdf` |
| 6 | **CLIA Certification (How to Obtain)** | Mar 2026 | `/regulations-and-guidance/legislation/clia/downloads/howobtaincliacertificate.pdf` |
| 7 | **Laboratory Complaints** | May 2025 | `/regulations-and-guidance/legislation/clia/downloads/cliabrochure9.pdf` |
| 8 | **CLIA IQCP Introduction** | Jul 2013 | `/regulations-and-guidance/legislation/clia/downloads/cliabrochure11.pdf` |
| 9 | **CLIA IQCP — Considerations When Deciding to Develop an IQCP** | Nov 2014 | `/regulations-and-guidance/legislation/clia/downloads/cliabrochure12.pdf` |
| 10 | **CLIA IQCP — What is an IQCP?** | Nov 2014 | `/regulations-and-guidance/legislation/clia/downloads/cliabrochure13.pdf` |

Prepend `https://www.cms.gov` to any path for the full URL.

**Brochure #1 ("Verification of Performance Specifications", 6064bk.pdf)** is the canonical CMS source for the "performance verification" wording the CLAUDE.md Copy Rule (§3) requires.

---

## 5. Lab Management 101 — Michael Veri

**Size:** ~243 KB / ~90,000 words across 17 chapters / ~532K body characters
**Author:** Michael Veri · **Published by:** Veritas Lab Services · **Edition:** First Edition, 2026

**Chapters:**

1. Understanding US Lab Law
2. The Laboratory Medical Director: Authority, Obligation, and Liability
3. The LAD/LMD Venn Diagram
4. Laboratory Administrative Directors Face Outward
5. Staffing
6. The Workforce Shortage: What the Regulations Actually Allow
7. Enhancing Laboratory Productivity: Understanding the Key Metrics
8. Proficiency Testing
9. Accuracy and Precision Studies: What the Regulations Actually Require
10. Meaningful QC Review: Reading What Your Data Is Actually Telling You
11. The End-of-Month Review: Your Lab's Management Accountability Document
12. Performance Improvement (PI) in the Laboratory
13. Blood Utilization and Management: Protecting Patients and the Bottom Line
14. Blood Administration: What the Laboratory Owes the Transfusionist
15. Laboratory Outreach: From Cost Center to Revenue Driver
16. AI in the Laboratory
17. The Compliance Audit: Seeing Your Own Lab the Way a Surveyor Does

**Front matter:** Disclaimer, Acknowledgements (Lisa Veri MLS(ASCP), Jane Hermansen MBA MT(ASCP), Jeffrey Moore, David McCormick), About the Author, Foreword, Introduction, "What This Book Covers."

**Operator-authored synthesis** — when the regulation, TJC, CAP, and CMS sources disagree or are ambiguous, treat this book as Michael's resolved interpretation. It maps directly to the VeritaAssure module set:
- Ch. 7 → VeritaBench / VeritaPace / VeritaShift (productivity)
- Ch. 8 → VeritaPT
- Ch. 9 → VeritaCheck (verification studies)
- Ch. 10-11 → VeritaTrack / VeritaQA
- Ch. 12 → VeritaQA (PI dashboards)
- Ch. 13-14 → (transfusion module — not yet in product)
- Ch. 17 → VeritaScan (inspection readiness)

The book itself is not committed to this repo (it is published material). Agents on machines without local access should flag any task that needs the book's interpretation rather than guessing.

---

## 6. Topic crosswalk — where each common compliance topic appears across all five sources

Use this when a feature spec or copy claim needs to be verified against multiple authorities. Format: **Topic → CFR cite | TJC location | CAP IDs (sample) | CMS brochure | Book chapter**.

| Topic | CFR | TJC | CAP | CMS Brochure | Book Ch. |
|---|---|---|---|---|---|
| **Performance verification of test methods** | 493.1253 | QSA chapter (p.275-466) | COM.* (foundational), CHM.13000, IMM.33374 | #1 (6064bk.pdf, "Verification of Performance Specifications") | Ch. 9 |
| **Calibration / calibration verification** | 493.1255 | QSA chapter | CHM.12950, CHM.13000, HEM.18705, POC.08150, IMM.33337, IMM.33448 | #2 (Calibration and Calibration Verification, Apr 2006) | Ch. 9 |
| **Quality control (daily / monthly / waived)** | 493.1256 (Subpart K Analytic) | QSA + PI chapters | HEM.18038, HEM.18691, IMM.34120, MIC.32480, TRM.30000, POC.09145, URN.24320 | (covered in IQCP brochures) | Ch. 10 |
| **Proficiency testing / PT participation** | 493.801, 493.803, 493.901, Subpart H | QSA chapter, PT Monitoring policy in ACC | COM.01100, COM.01300, COM.01400, ANP.* (PT-specific), CYP.00125, MIC.00350 | #5 (PT and PT Referral, Oct 2024) | Ch. 8 |
| **IQCP (Individualized QC Plan)** | 493 Subpart K (incorporated 2014) | QSA chapter | COM.50400 (QC Plan Approval), COM.30980 | #8, #9, #10 (three IQCP brochures) | Ch. 10 |
| **Personnel competency assessment** | 493.1235, 493 Subpart M | HR chapter, LD chapter | GEN.* (competency), POC.06850, POC.09600 (PPM), CYP.* | #3 (Assessing Personnel Competency, May 2025) | Ch. 5 |
| **Laboratory director responsibilities** | 493.1407 (compliance), 493.1445 (high complexity) | LD chapter, ACC chapter | DRA file (entire — director's checklist), TRM.50100, COM.30980 | #4 (Laboratory Director Responsibilities, May 2025) | Ch. 2, 3 |
| **Method comparison / correlation** | 493.1281 | QSA chapter | CHM.* (correlation items), CYP.06850 | (covered in #1 PV brochure) | Ch. 9 |
| **Reportable range / AMR** | 493.1253 (incorporated under PV) | QSA chapter | CHM.30550, HEM.36820 | #1 | Ch. 9 |
| **Quality management system (QMS)** | 493 Subpart K | QSA + PI + LD chapters | GEN.13750, GEN.13806 | (general, not single-brochure) | Ch. 10, 12 |
| **PPE / specimen handling / safety** | 493 Subpart J | EC, IC, HR chapters | GEN.74100 (PPE), COM.06000 (Spec Collection Manual), IMM.41920 | (none specific) | (not deep) |
| **Inspection readiness / TJC survey** | Subpart Q (493.1771-1780) | ACC chapter (p.499-571) | (cross-cuts all) | (none specific) | Ch. 17 |
| **Transfusion service / blood bank** | 493.1103 (Subpart J), 493.1217 (Immunohematology), 493.1271 (Histocompat) | TS chapter (p.467) | TRM.* (entire 266-row file), GEN.40570 (blood culture collection) | (none specific) | Ch. 13, 14 |
| **POC testing** | (cross-cuts; mostly waived rules in Subpart B + 493.15) | WT chapter (p.481), QSA | POC.* (entire 74-row file) | (covered in #8/9/10 IQCP) | (not deep) |
| **CLIA certificate types** | Subparts B, C, D, E | ACC chapter | (not directly) | #6 (How to Obtain CLIA Certificate, Mar 2026) | Ch. 1 |

---

## 7. Working notes for any agent

- The CAP requirement IDs format `<DISCIPLINE>.<NUMBER>` is the canonical citation form for any feature that maps to CAP. Use these IDs in product copy when citing CAP, never narrative paraphrases.
- The CFR cites use `42 CFR §493.NNNN` format. Always cite the section, not the subpart, in product copy.
- TJC cites use the chapter code + standard number, e.g., `QSA.02.10.01`. The standards inside QSA are the most-cited.
- The book is operator-authored. When the regulation is silent or ambiguous (e.g., "what counts as meaningful QC review"), the book's interpretation is the operator's intent and should drive product design.
- For any deep-read of a specific topic, the **fastest path** is: (1) find the topic in §6 crosswalk, (2) read the CMS brochure if listed (plain language), (3) read the relevant book chapter for the operator's framing, (4) read the CFR section for the binding requirement, (5) read the TJC/CAP rows only if the work concerns a TJC- or CAP-accredited customer specifically.
- "Method validation" (banned in public copy per CLAUDE.md §3) IS the official term in some accreditor sources (e.g., the TJC manual section title "Method Validation Records"). Distinguish: official accreditor terminology is fine inside this index and inside product source code that names accreditor sections; product-facing copy must use "performance verification" or "verification of performance specifications."
- Two of the CMS brochures are dated April 2006 (#1 Verification of Performance Specifications and #2 Calibration and Calibration Verification). They remain authoritative because the underlying CFR sections (493.1253 and 493.1255) have not changed.
- Source files referenced by this index live on the operator's local machine. Agents running in environments without that local access should flag any task that requires deep-reading the book or the TJC manual rather than guessing; the structural pointers above are sufficient for citation but not for paraphrase.
