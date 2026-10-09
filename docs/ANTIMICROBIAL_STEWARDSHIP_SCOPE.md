# Antimicrobial stewardship: the laboratory's share, inside VeritaAssure

Scope document for parking lot #81. Written 2026-10-09. Scope only; nothing here is built.

**Ask (Lisa, 2026-10-07):** "Lets scope an antimicrobial stewardship program in the system."

**Short answer:** build the laboratory's piece of the hospital program, not the pharmacy's. Five parts:

1. A cumulative antibiogram built from the lab's own susceptibility totals.
2. A register of the lab's susceptibility reporting rules.
3. Turnaround tracking for the rapid tests stewardship depends on.
4. A log of the lab's participation in the stewardship committee.
5. A readiness view against the CMS requirement.

The minimum version is M (1-2 weeks). Everything stays HIPAA-free: aggregate counts only, never a patient record.

---

## 1. Why a lab needs this (regulatory basis)

The requirement sits on the **hospital**, not on CLIA. 42 CFR Part 493 has no antibiogram or stewardship requirement. The Conditions of Participation for hospitals and for critical access hospitals require a facility-wide program, and the lab's role is that it is the source of the resistance data.

**42 CFR 482.42(b)** (hospitals; eCFR text as of 2026-10-01):

> (b) Standard: Antibiotic stewardship program organization and policies. The hospital must demonstrate that: (1) An individual (or individuals), who is qualified through education, training, or experience in infectious diseases and/or antibiotic stewardship, is appointed by the governing body as the leader(s) of the antibiotic stewardship program and that the appointment is based on the recommendations of medical staff leadership and pharmacy leadership; (2) The hospital-wide antibiotic stewardship program: (i) Demonstrates coordination among all components of the hospital responsible for antibiotic use and resistance, including, but not limited to, the infection prevention and control program, the QAPI program, the medical staff, nursing services, and pharmacy services; (ii) Documents the evidence-based use of antibiotics in all departments and services of the hospital; and (iii) Documents any improvements, including sustained improvements, in proper antibiotic use; (3) The antibiotic stewardship program adheres to nationally recognized guidelines, as well as best practices, for improving antibiotic use; and (4) The antibiotic stewardship program reflects the scope and complexity of the hospital services provided.

**42 CFR 485.640(b)** applies to critical access hospitals; eCFR text as of 2026-10-01. Its wording is the same as 482.42(b), except that it says "CAH" for "hospital" and adds "or responsible individual" to the appointment in (b)(1). This matters for customers like Redington-Fairview, a 25-bed critical access hospital.

**Where the lab fits:** (b)(2)(i) requires "coordination among all components of the hospital responsible for antibiotic use and resistance." The laboratory produces the resistance data (the antibiogram) and sets the susceptibility reporting rules, which shape prescribing. A lab that can hand the committee a current antibiogram, its reporting rules, and minutes showing it attended is demonstrating that coordination.

**Accreditor layer (not yet verified by us):**
- **The Joint Commission:** the hospital and CAH programs have a medication-management standard on antimicrobial stewardship. Our TJC data covers the laboratory program and does not hold it, so this document cites no standard number.
- **CAP:** the microbiology checklist is commonly cited for cumulative antibiogram expectations. Our verified CAP data (`server/capRequirements.ts`) has no antibiogram entry, so no CAP ID is cited here either.

Both must be confirmed against the source before any customer-facing crosswalk ships (see open questions).

**Method standard:** the conventions for a cumulative antibiogram come from CLSI M39 (Analysis and Presentation of Cumulative Antimicrobial Susceptibility Test Data). The commonly applied rules are:
- the first isolate of a species per patient per analysis period;
- at least 30 isolates per organism before reporting a percent susceptible;
- analysis at least annually.

We do not hold the current M39 edition. These rules are to be confirmed against it before build, and they must be implemented as the lab's configurable settings, not hardcoded claims.

---

## 2. Scope: the five parts

### 2.1 Cumulative antibiogram builder (the core deliverable)

- **Input:** organism by antimicrobial counts for one analysis period: number tested and number susceptible (and intermediate/resistant where the lab reports them), plus the period and the specimen-source filter. These are already de-duplicated to first isolate per patient by the lab's LIS antibiogram report. **No patient identifiers enter VeritaAssure** (the HIPAA-free rule): the de-duplication happens in the LIS, and we take its totals.
- **Output:** a percent-susceptible table in the standard orientation (organisms down, drugs across).
  - Cells under the 30-isolate threshold are suppressed or flagged; the threshold is lab-configurable.
  - The period, source filter and method notes are printed on the face of the report.
  - The lab director or designee signs the release, per our PDF rules.
- **Year over year:** keep each released antibiogram, so the next version shows changes in percent susceptible per organism and drug pair.
- **Deliverables:** the PDF for the stewardship committee and pocket-card use, plus an Excel export following our Excel standard.

### 2.2 Susceptibility reporting rules register

The lab documents its selective (cascade) reporting rules, for example "report the narrower agent; release the broader agent only if resistant". Each rule records the organism group, source, drugs suppressed and released, the effective date, and approval by the lab director or designee. It is a controlled list with version history, which is exactly what VeritaDC already does for documents. Option: store it as a structured table inside VeritaDC rather than build a new store.

### 2.3 Rapid-diagnostic turnaround

Stewardship depends on fast results, such as Gram stain to provider and blood culture identification time. VeritaQA's PI starter library already carries blood, urine and AFB culture contamination rates. This part adds turnaround metrics for the rapid tests the lab offers, as PI metrics in the same place, so no new screen is needed.

### 2.4 Committee participation log

This covers the lab's representative, meeting dates, minutes or attachments, and action items with owners and due dates. It is the evidence for the "coordination" language in (b)(2)(i). It fits the existing pattern of dated entries plus document links, as in VeritaTrack or VeritaQA.

### 2.5 Readiness view

A one-screen checklist against 482.42(b) / 485.640(b), with accreditor rows added once verified:
- antibiogram released this period;
- reporting rules current;
- committee attendance logged;
- turnaround metrics trending.

It shows what the lab can hand a surveyor or the committee.

---

## 3. What already exists to build on (checked in code 2026-10-09)

| Exists | Where | Use |
|---|---|---|
| 42 CFR 482.42 in the requirement library | `server/cfrRequirements.ts` id 4095 | the readiness crosswalk |
| **485.640 is NOT in the library** | n/a | add it (CAH customers) |
| Culture contamination PI metrics (blood, urine, AFB) | `client/src/lib/piStarterLibrary.ts` (VeritaQA) | part 2.3 sits beside these |
| Microbiology isolation and identification policy template (mentions susceptibility) | `server/policyTemplates/data/040_microbiology_isolation_id.json` | link the reporting-rules register to it |
| Master-list note "Antimicrobial stewardship support: antibiogram production cadence and reporting cascades. Annual antibiogram is the common deliverable." | `server/veritapolicyMasterList.ts`, **on policy 66, Manual Hematology QC Policy** | **looks misplaced** (a microbiology note on a hematology QC policy); confirm and move it |
| Signed-PDF and Excel standards, lab identity stamping | existing PDF and Excel helpers | the antibiogram outputs |

---

## 4. Where it lives

**Recommendation: a "Stewardship" tab inside VeritaQA, not a new module.**
- VeritaQA already hosts the PI metrics that part 2.3 extends.
- Adding a module changes the "eighteen modules" count in every public-facing artifact.

The reporting-rules register (2.2) rides in VeritaDC as a structured controlled list.

---

## 5. Minimum version and effort

| Part | In the minimum version | Effort |
|---|---|---|
| 2.1 Antibiogram builder (manual entry + LIS-totals CSV upload, suppression threshold, signed PDF, Excel) | yes | M (about 1 week) |
| 2.4 Committee log | yes | S |
| 2.5 Readiness view (CFR rows only) | yes | S |
| 2.2 Reporting-rules register | next | S-M |
| 2.3 Rapid-diagnostic turnaround metrics | next | S |
| Year-over-year trend view | next | S |
| Accreditor rows in the crosswalk | after source verification | S |

Minimum version total: **M (1-2 weeks)**. Pharmacy-side stewardship (days of therapy, antibiotic time-outs, prescriber audit-and-feedback) is out of scope. That is pharmacy software, and it would make this an XL build in someone else's lane.

---

## 6. Open questions (for Lisa and Michael)

1. **Is this hosted in VeritaQA as a tab** (recommended), or does it become its own module and change the module count?
2. **Data intake:** do we accept only LIS antibiogram totals (recommended; HIPAA-free), or also isolate-level rows with a lab-generated, non-identifying key so we can de-duplicate ourselves? The second needs a privacy review before it is considered.
3. **Which customer asks first?** A hospital customer's stewardship committee (for example Lisa's Milford or St. Charles) would set the minimum-version priority and confirm the report format their committee uses.
4. **Accreditor sources:** we need the TJC hospital/CAH stewardship standard text and the CAP microbiology checklist item(s) before any accreditor row ships.
5. **Master-list note on policy 66:** confirm it belongs on a microbiology policy and move it.
6. **M39 edition:** confirm the current CLSI M39 conventions (first-isolate rule, isolate threshold, period) against the document before build.
