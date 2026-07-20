// client/src/lib/faqContent.ts
//
// SINGLE SOURCE OF TRUTH for every visible FAQ on the marketing site.
// Rendered by the page components (ArticleTeaPage, ArticleCalVerPage, FAQPage)
// AND consumed by the server-side SEO pipeline (server/seo-metadata.ts) to
// build FAQPage JSON-LD. One source means the structured data can never drift
// from the visible Q&A, which Google's FAQ policy and the honest-content rule
// require. Edit the Q&A here; both the page and its schema update together.
//
// Generated initially by scripts/extract-faq-content.mjs from the page
// sources, then hand-edited here. Do NOT re-run the generator after the pages
// import from this file.

export interface FaqQA {
  q: string;
  a: string;
}

export interface FaqCategory {
  category: string;
  items: FaqQA[];
}

// /resources/clia-tea-what-lab-directors-dont-know  (visible "Frequently Asked Questions")
export const TEA_ARTICLE_FAQ: FaqQA[] = [
            {
              q: "Does CLIA require labs to use CLIA TEa for calibration verification, or can we use manufacturer criteria?",
              a: "No. CLIA requires (42 CFR §493.1253 and §493.1255) that calibration verification be performed and documented and that the lab establish acceptance criteria, but it does not specify numeric criteria. Many labs adopt the §493 PT acceptable performance criterion for the same analyte as their cal ver acceptance criterion, with medical director or designee approval. This is a recommendation, not a CLIA requirement. We recommend it because the value is federally published, well documented, and simpler to defend than a manufacturer claim or an unwritten internal policy."
            },
            {
              q: "What's the difference between TEa used for proficiency testing and TEa used for calibration verification?",
              a: "It's the same table: the TEa values in 42 CFR Part 493 apply to both. For proficiency testing, they define whether your PT results are graded as acceptable. For calibration verification, they define whether your instrument's performance at each calibration level is acceptable. The regulatory authority is the same; the application differs."
            },
            {
              q: "Our analyte isn't in the CLIA TEa table. What do we use?",
              a: "If an analyte isn't regulated under CLIA proficiency testing requirements, there is no federally mandated TEa. In that case, labs should use manufacturer-stated allowable error, biological variation-based goals (from EFLM or RCPA tables), or medical decision-based criteria established by the laboratory director or designee. Document the rationale for whatever criteria you choose."
            },
            {
              q: "How often does CLIA TEa change?",
              a: "Infrequently, but the CLIA proficiency testing final rule (CMS-3355-F) was the first major update in decades for many analytes. Before that, some values dated to 1992. The criteria became effective July 11, 2024 and were implemented for laboratories on January 1, 2025, making this the largest single update to CLIA acceptable performance criteria in the modern era. Check the current eCFR rather than relying on reference cards or QC software that may not have been updated."
            },
            {
              q: "What does 'target value ±X% or ±Y units, whichever is greater' mean in practice?",
              a: "The dual criterion accounts for concentration-dependent error. At low concentrations, a fixed percentage can be smaller than what's analytically meaningful, so the absolute value floor protects the criterion from being trivially easy to pass near zero. Apply both. The one that allows a larger absolute difference is the governing criterion at that concentration."
            },
          ];

// /resources/clia-calibration-verification-method-comparison  (visible "Frequently Asked Questions")
export const CALVER_ARTICLE_FAQ: FaqQA[] = [
            {
              q: "Does calibration verification apply to waived tests like point-of-care glucose meters?",
              a: "No. Waived tests are explicitly exempt from calibration verification requirements under CLIA. If your lab is performing these studies on waived instruments, you are conducting unnecessary quality control. Redirect those resources."
            },
            {
              q: "What if our analyzer is factory-calibrated and cannot be adjusted by the lab?",
              a: "Calibration verification is not required. CLIA's position is clear: you cannot verify something you cannot perform. If the instrument's calibration is locked by the manufacturer and cannot be adjusted by laboratory personnel, the requirement does not apply."
            },
            {
              q: "How many specimens do we need for a correlation / method comparison study?",
              a: "The Joint Commission does not specify a minimum. The laboratory defines both the number of data points and the acceptability criteria. However, most accrediting bodies look for at least 20 patient specimens spanning the analytical range, which is the EP9 protocol standard."
            },
            {
              q: "Can we use QC material or calibrators instead of commercial verification kits?",
              a: "Yes. Any material with a documented, known true value qualifies as a calibration verification data point. This includes calibrators, manufacturer-assigned QC material, stable proficiency testing samples, and previously validated patient specimens. Commercial kits are a convenience, not a requirement."
            },
            {
              q: "What is the exact deadline for our next calibration verification study?",
              a: "Six months plus twenty days from the date your medical director or designee signed off on the last study. Not from when data was collected. Not from the date the report was generated. The sign-off date is what counts. Document it explicitly in your tracking system."
            },
            {
              q: "Where do I find the CLIA allowable error (TEa) for a specific analyte?",
              a: "In the Code of Federal Regulations Title 42, Part 493, Subpart I. The four sections cited by VeritaCheck™ are §493.927 (general immunology), §493.931 (routine chemistry), §493.937 (toxicology), and §493.941 (hematology). Search for 'acceptable performance' within each section to find the specific criteria."
            },
          ];

// /resources/ep26-reagent-lot-verification
export const EP26_ARTICLE_FAQ: FaqQA[] = [
  {
    q: "Is reagent lot verification required by CLIA?",
    a: "Yes. CLIA requires laboratories to verify that a new reagent lot performs acceptably before reporting patient results from it, and to define and document the acceptance criteria (42 CFR §493.1255(b)(3)(i) and §493.1256). The regulation requires the verification and the documented criteria; it does not prescribe the exact protocol or sample count, which the laboratory establishes with medical director or designee approval.",
  },
  {
    q: "How many samples does EP26 require?",
    a: "EP26 and CLIA do not set a fixed number. The medical director or designee determines it based on the analyte's risk and the laboratory's total allowable error (TEa). In practice, many laboratories adopt a minimum of about 20 patient samples spanning the analytical measuring range, the same floor commonly used for reference interval verification, and use more for higher-stakes analytes.",
  },
  {
    q: "What is the difference between lot-to-lot verification and calibration verification?",
    a: "Calibration verification confirms accuracy against known true values across the reportable range. Reagent lot-to-lot verification confirms that results from a new reagent lot agree with the current lot on patient samples. Calibration verification asks whether your results are correct; lot verification asks whether changing the reagent lot shifted your results. Different triggers, different question.",
  },
  {
    q: "How do I set the acceptance criterion for a lot change?",
    a: "Anchor it to the analyte's total allowable error (TEa). A common, defensible rule is to accept when the mean absolute percent difference between the two lots is within TEa and at least 90 percent of paired patient specimens are within TEa, with the criterion approved by the medical director or designee.",
  },
  {
    q: "What do I do if a new reagent lot fails verification?",
    a: "Treat it as an investigation, not an automatic rejection. Confirm the samples and inputs, repeat or expand the study, and look for an assignable cause such as calibration, control performance, or sample integrity. The final determination rests with the laboratory director or designee.",
  },
  {
    q: "How often must I verify reagent lots?",
    a: "Each time a new reagent lot is put into service for patient testing, before results from that lot are reported. It is event-driven, triggered by every new lot, not a fixed calendar interval.",
  },
];

// /resources/quality-control-testing-into-compliance
export const QC_ARTICLE_FAQ: FaqQA[] = [
  {
    q: "What should you do when a quality control result is out of range?",
    a: "Hold patient results from the affected run, then investigate for an assignable cause: control material integrity and expiration, reagent lot and expiration, calibration status, instrument maintenance and function, operator technique, and environmental conditions. If you find and correct one, document the cause and the corrective action and rerun controls to confirm the system is back in control before resuming patient testing. If no assignable cause is found, the result stands as a real signal, and the next steps are broader troubleshooting, recalibration, or manufacturer support. Final review rests with the medical director or designee.",
  },
  {
    q: "Is it acceptable to repeat a control until it passes?",
    a: "Only as part of a documented investigation. Rerunning a failed control to look for an assignable cause is sound practice. Repeating it to produce a passing number, with no investigation and no documented cause, is testing into compliance.",
  },
  {
    q: "Should control limits come from the package insert or your own data?",
    a: "From your own data. The insert range covers many laboratories, instruments, and reagent lots, so it is wider than any single laboratory's true imprecision and too wide to catch real shifts. Set limits from your own instrument's mean and standard deviation over a baseline period. CLSI C24 takes this position.",
  },
  {
    q: "What is testing into compliance in a clinical laboratory?",
    a: "Retesting or repeating a result until it falls in range without finding and documenting an assignable cause for the original failure. The principle comes from United States v. Barr Laboratories (1993): a laboratory may retest to investigate, but once no error is found it cannot keep testing until a passing value appears, and it cannot average passing retests with the original failing result.",
  },
  {
    q: "What CFR requires corrective action when a control fails?",
    a: "Two standards work together. 42 CFR §493.1256 requires control procedures and bars reporting patient results until controls meet the laboratory's criteria. 42 CFR §493.1282 requires documented corrective action when controls fail.",
  },
  {
    q: "What are sigma metrics in laboratory quality control?",
    a: "A method's sigma is its total allowable error, minus bias, divided by imprecision. High-sigma methods need little quality control; low-sigma methods need multirule designs and tighter review. Designing the quality control to each method's sigma is more protective than running one rule set across every analyte. The figures used to illustrate this are an example, not a universal rule.",
  },
  {
    q: "Does a clean Levey-Jennings chart mean the quality control program is working?",
    a: "Not necessarily. A real analytical system produces occasional outliers over many runs, so a long stretch with no exceptions can mean the limits are too wide or that failures are being repeated away. Treat a flawless chart as a reason to look closer, not a reason to move on.",
  },
];

// /resources/clia-tea-lookup  (visible "Frequently Asked Questions")
export const TEA_LOOKUP_FAQ: FaqQA[] = [
  {
    q: "What is CLIA total allowable error (TEa)?",
    a: "The maximum permissible difference between a laboratory's result and the target value for an analyte, published as the proficiency testing acceptable performance criterion in 42 CFR Part 493, Subpart I.",
  },
  {
    q: "Where do these TEa values come from?",
    a: "The CLIA PT acceptance limits in 42 CFR §493.927 through §493.959, updated by the CLIA PT final rule (CMS-3355-F, effective July 11, 2024, implemented January 1, 2025).",
  },
  {
    q: "Can I use CLIA TEa as my calibration verification acceptance criterion?",
    a: "Many laboratories do, with medical director or designee approval, because it is a federally published, defensible threshold rather than a manufacturer claim.",
  },
  {
    q: "What is the ADLM half-TEa recommendation?",
    a: "ADLM suggests an internal goal at half of the CLIA TEa, giving a quality margin that keeps results well inside acceptable performance.",
  },
  {
    q: "Is the lookup tool free?",
    a: "Yes. It requires no login and covers every analyte in the table.",
  },
];

// /resources/calibration-verification-requirements-clia  (visible "Frequently Asked Questions")
export const CALVER_REQ_FAQ: FaqQA[] = [
  {
    q: "How often is calibration verification required under CLIA?",
    a: "At least every six months for each non-waived quantitative test system, under 42 CFR §493.1255.",
  },
  {
    q: "What events trigger it outside the six-month cycle?",
    a: "A reagent lot change when the manufacturer specifies it, major instrument maintenance or repair that could affect performance, and QC results suggesting the calibration may have shifted. Document the trigger with the results.",
  },
  {
    q: "Which tests require it?",
    a: "All quantitative non-waived tests reported to patients: chemistry panels, hematology indices with a reportable range, coagulation, and quantitative immunoassays.",
  },
  {
    q: "What must the record include?",
    a: "Date, analyst, materials with lot numbers and concentrations, measured results per level, calculated recovery, and the pass/fail determination with criteria applied, reviewed by the medical director or designee.",
  },
  {
    q: "What is the most common inspection finding?",
    a: "Incomplete documentation, not the absence of the verification. Missing lot numbers, no pass/fail determination, or no record of who reviewed it.",
  },
];

// /resources/how-to-perform-method-comparison-study  (visible "Frequently Asked Questions")
export const METHODCOMP_FAQ: FaqQA[] = [
  {
    q: "When is a method comparison study required?",
    a: "When placing a new analyzer into service, adding a new reagent system for an existing test, or demonstrating two instruments running the same analyte produce equivalent results.",
  },
  {
    q: "How many specimens does it need?",
    a: "A minimum of 40 patient specimens spanning the full analytical measurement range, deliberately collected at low, mid, and high concentrations.",
  },
  {
    q: "Why patient specimens instead of QC material?",
    a: "Fresh patient samples reflect the actual matrix the methods encounter in routine testing; QC materials do not.",
  },
  {
    q: "What statistics does it use?",
    a: "Slope, y-intercept, Pearson correlation coefficient, and bias at medical decision points. Deming or Passing-Bablok regression is preferred over ordinary least squares because it accounts for error in both methods.",
  },
  {
    q: "How do you set pass or fail?",
    a: "The laboratory or manufacturer sets acceptable limits for slope, intercept, and bias, defined before running the study, with bias at decision points within total allowable error. CLSI EP09-A3 is the reference protocol.",
  },
];

// /resources/precision-verification-report-interpretation-guide  (visible "Frequently Asked Questions")
export const PRECISION_FAQ: FaqQA[] = [
  {
    q: "Why is precision verification required?",
    a: "42 CFR §493.1253 requires laboratories to verify performance specifications, including precision, before reporting patient results and after changes that could affect performance.",
  },
  {
    q: "What do mean, SD, and CV mean on the report?",
    a: "Mean is the average of replicates; standard deviation is how widely replicates spread around it; coefficient of variation is the SD as a percent of the mean, CV = (SD / mean) x 100.",
  },
  {
    q: "How many replicates does it need?",
    a: "CLSI EP15-A3 recommends at least 20 replicates for within-run precision and a 5-day by 5-replicate design for full within-laboratory precision. Fewer than 20 widens the confidence interval and weakens the estimate.",
  },
  {
    q: "What do Pass, Fail, and Uncertain mean?",
    a: "Against a vendor SD goal, Pass means the upper bound of the 95 percent confidence interval for the observed SD is below the goal; Fail means the lower bound exceeds it; Uncertain means the goal falls inside the interval and more replicates may be warranted.",
  },
  {
    q: "What acceptance criterion should I use?",
    a: "A fraction of the CLIA TEa is common, often the ADLM half-TEa convention, or the manufacturer's published within-run SD. Final acceptance rests with the medical director or designee.",
  },
];

// /resources/tjc-laboratory-inspection-checklist-preparation  (visible "Frequently Asked Questions")
export const TJC_INSPECTION_FAQ: FaqQA[] = [
  {
    q: "How does a TJC laboratory survey work?",
    a: "It follows a tracer: the surveyor starts at a patient result and works backward through who ordered it, which analyzer ran it, its verification records, who performed it, their competency, and the proficiency testing record for that analyte.",
  },
  {
    q: "What do surveyors trace most consistently?",
    a: "Five areas: performance verification records, proficiency testing, competency assessments, test menu and instrument documentation, and current approved procedures.",
  },
  {
    q: "How do you prepare for a Joint Commission laboratory survey?",
    a: "Maintain documentation continuously, be able to retrieve any record in under two minutes, and run a mock survey about ninety days before the anticipated survey window using your actual documentation.",
  },
  {
    q: "When should you run a mock survey?",
    a: "About ninety days out, so any gap found can be corrected before it becomes a finding on the official report.",
  },
  {
    q: "What is the most common survey pitfall?",
    a: "\"We do it, we just do not document it.\" Without a record, a surveyor cannot distinguish a compliant laboratory from a non-compliant one.",
  },
];

// /resources/cost-per-reportable-test-four-layer-framework  (visible "Frequently Asked Questions")
export const CPRT_FAQ: FaqQA[] = [
  {
    q: "What is cost per reportable test (CPRT)?",
    a: "The fully-considered cost of producing one reportable laboratory result, built up in four layers under the CLSI GP11-A framework.",
  },
  {
    q: "What are the four CPRT layers?",
    a: "Layer 1 is reagents and supplies; Layer 2 adds direct labor; Layer 3 adds equipment depreciation and maintenance; Layer 4 adds overhead. Each answers a different financial question.",
  },
  {
    q: "Which layer for an insource vs send-out decision?",
    a: "Usually Layer 2, reagents and supplies plus direct labor, when the analyzer is already on the floor.",
  },
  {
    q: "Which layer justifies a new analyzer?",
    a: "Layer 3, which adds equipment depreciation and maintenance across projected volume.",
  },
  {
    q: "Which layer sets a charge-master price?",
    a: "Layer 4, the fully loaded cost including overhead.",
  },
  {
    q: "Does CLIA require CPRT?",
    a: "No, but 42 CFR §493.1407 and §493.1445 make the laboratory director responsible for defending the laboratory's resource decisions.",
  },
];

// /resources/manual-logs-why-most-labs-should-stop  (visible "Frequently Asked Questions")
export const MANUAL_LOGS_FAQ: FaqQA[] = [
  {
    q: "Why do laboratories use manual logs?",
    a: "Originally to solve a memory problem from an era of few computers: record the result at the bench before an interruption could distort it.",
  },
  {
    q: "What is the hidden cost of a manual log?",
    a: "It introduces a transcription error mode, a result miscopied from the log into the LIS, an error that cannot occur without the log.",
  },
  {
    q: "Why is documented review of transcribed results required?",
    a: "That review exists to catch the transcription error the log itself introduces; it is the administrative cost of the log's bench convenience.",
  },
  {
    q: "What does direct entry from analyzer to LIS eliminate?",
    a: "The transcription event and the associated review burden, and it shortens time to result availability.",
  },
  {
    q: "When is a manual log still appropriate?",
    a: "Narrow cases only: a waived test or instrument that does not interface with the LIS, or a send-out requiring a paper requisition for chain of custody.",
  },
];

// /faq  (the main FAQ page, grouped by category)
// /resources/tjc-laboratory-inspection-what-to-expect  (visible "Frequently Asked Questions")
export const MOCK_INSPECTION_FAQ: FaqQA[] = [
  {
    q: "What is a laboratory mock inspection?",
    a: "A laboratory mock inspection is a full rehearsal of an accreditation survey, run by an independent reviewer before the real surveyor arrives, so the laboratory finds and fixes its own gaps first. It follows the same arc as the real survey: the tour, the proficiency testing and record review, the tracers that follow real patients, the personnel files, and the procedures watched at the bedside. The goal is not to pass the mock. It is to surface the findings while there is still time to correct them.",
  },
  {
    q: "How often should a laboratory run a mock inspection?",
    a: "At a minimum, once in the months leading up to an expected survey, commonly three to six months out, which leaves time to close what it finds. Beyond that schedule, run one after any event that changes the risk: a new test or instrument placed into service, a change in laboratory leadership or key staff, or a prior deficiency that has to be shown as corrected.",
  },
  {
    q: "What is the difference between a mock inspection and the real survey?",
    a: "The method is the same; the stakes and the reviewer differ. A mock inspection is conducted by your own independent reviewer and its findings stay internal, so they can be corrected before they become official. The real survey is conducted by the accreditor and its findings become Requirements for Improvement in the final report, each one placed on the SAFER matrix by risk. A good mock inspection is deliberately run to be as demanding as the real one, because a soft mock gives false comfort.",
  },
  {
    q: "What should a laboratory inspection checklist include?",
    a: "It should follow the survey arc rather than a generic list: the full footprint of testing including bedside and point of care sites, proficiency testing enrollment and follow-up on every score below 100, quality control and maintenance and temperature records with documented monthly review, individualized quality control plans where used, verification of performance specifications and correlation and linearity studies on schedule, reference ranges and critical value handling, personnel competency with primary source verified credentials, referral laboratory oversight, verification that the laboratory information system moves results without altering them, laboratory safety, the eyewash, safety showers, and PPE, and the broader environment-of-care records where they fall to the laboratory, specimen handling, and result reporting. Each item should map to the TJC standard that requires it; TJC surveys to the CLIA regulations underneath, with additional requirements layered on as it sees fit.",
  },
  {
    q: "What is tracer methodology in a laboratory survey?",
    a: "A tracer is a real case the surveyor follows through the system to test whether the process worked in practice. The surveyor names a specific event, such as a unit of blood transfused in the ICU in a given month or a critical troponin that resulted in the ED, and asks the laboratory to find it and present it the way the care team saw it. The tracer then moves outward into the clinical documentation, most often to the provider notification on a critical value or the vital sign monitoring on a transfusion, where the gaps usually sit.",
  },
  {
    q: "Who should conduct a laboratory mock inspection?",
    a: "Someone independent of the area under review. The reviewer needs to read the records the way a stranger will, not the way the author intended, and that is only possible when the reviewer did not build the system. That can be a qualified staff member from another section, a quality officer, or an outside consultant with survey experience. The one person who should not run it is the person who owns the area being reviewed.",
  },
];

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    category: "About VeritaAssure\u2122",
    items: [
      {
        q: "What is VeritaAssure\u2122?",
        a: "VeritaAssure\u2122 is a SaaS compliance and operations platform built specifically for clinical laboratories. The suite includes seventeen modules organized into two streams: eleven compliance modules (performance verification, inspection readiness, competency, policy management, test menu mapping, personnel records, certificate tracking, proficiency testing, regulatory calendar, post-survey deficiency response, and daily QC sign-off) and six operations modules (billable-tests-per-hour benchmarking, monthly productivity tracking, by-hour staffing analysis, quality indicators, inventory, and cost-per-reportable-test studies). See What's included in the VeritaAssure\u2122 suite below for each module by name. Every report includes regulatory citations and a laboratory director or designee review block.",
      },
      {
        q: "Who built VeritaAssure\u2122?",
        a: "VeritaAssure\u2122 was designed and built by Michael Veri, MS, MBA, MLS(ASCP), CPHQ - a laboratory professional with over 23 years in clinical laboratory science. Michael spent 4 years as a Joint Commission surveyor, conducting more than 200 laboratory surveys across the country. He built VeritaAssure\u2122 as someone who lived the compliance burden from both sides of the inspection table.",
      },
      {
        q: "Is VeritaAssure\u2122 a CLIA-approved or accreditation-approved software?",
        a: "VeritaAssure\u2122 is a documentation and compliance management tool. It generates records that laboratories can use to satisfy their regulatory obligations, but it is not itself a regulatory body and does not grant certification or accreditation. Your laboratory director or designee retains final responsibility for all compliance determinations.",
      },
      {
        q: "Does VeritaAssure\u2122 replace my laboratory director or designee?",
        a: "No. Every report and study generated by VeritaAssure\u2122 includes a laboratory director or designee review block. Final approval and clinical determination must be made by the laboratory director or designee. VeritaAssure\u2122 supports compliance documentation - it does not replace professional judgment.",
      },
    ],
  },
  {
    category: "Products and Modules",
    items: [
      {
        q: "What's included in the VeritaAssure\u2122 suite?",
        a: "The suite includes seventeen production modules across two streams. Compliance (eleven): VeritaCheck\u2122 (performance verification, calibration verification, EP15 precision), VeritaMap\u2122 (test menu regulatory mapping), VeritaScan\u2122 (inspection readiness self-assessment with the AAA sub-block for unregulated analytes), VeritaComp\u2122 (competency assessment), VeritaPolicy\u2122 (TJC policy compliance), VeritaStaff\u2122 (personnel credentialing), VeritaLab\u2122 (CLIA certificate and accreditation tracking), VeritaPT\u2122 (proficiency testing tracker covering CAP, API, and WSLH plus alternative assessment records), VeritaTrack\u2122 (regulatory calendar and milestone tracker), VeritaResponse\u2122 (post-survey deficiency response with the federal CMS-2567 renderer and a cross-link to your VeritaCheck history), and VeritaQC\u2122 (daily QC sign-off with Westgard evaluation). Operations (six): VeritaBench\u2122 (free billable-tests-per-hour calculator), VeritaPace\u2122 (monthly productivity tracker with year-over-year trend), VeritaShift\u2122 (by-hour staffing analyzer), VeritaQA\u2122 (quality indicators dashboard), VeritaStock\u2122 (reagent and inventory management with barcode and Order PDF), and VeritaOps\u2122 (cost-per-reportable-test studies). See the roadmap for what's coming next.",
      },
      {
        q: "What is VeritaCheck\u2122?",
        a: "VeritaCheck\u2122 is the performance verification and calibration verification module. It supports CLIA TEa-based pass/fail with automated lookup, EP15 precision, EP9 method comparison, and reportable range studies. Every report includes regulatory citations, statistics, and a director review block, exported as a signed PDF.",
      },
      {
        q: "What is VeritaScan\u2122?",
        a: "VeritaScan\u2122 is a 173-item inspection readiness self-assessment across 10 compliance domains, triple-mapped to The Joint Commission standards, CAP checklists, and 42 CFR Part 493. Studies completed in VeritaCheck\u2122 automatically check off corresponding items, so your inspection readiness is always current. Built by a former TJC laboratory surveyor with 200+ facility inspections. Includes an executive summary export.",
      },
      {
        q: "What is VeritaTrack\u2122?",
        a: "VeritaTrack\u2122 is a QC task tracking and sign-off module for daily, weekly, and monthly compliance tasks. Assign tasks to staff, capture electronic sign-offs with timestamps, and produce an audit-ready log for inspections.",
      },
      {
        q: "What is VeritaStock\u2122?",
        a: "VeritaStock\u2122 manages reagent and supply inventory: lot tracking, expiration alerts, par levels, FIFO rotation prompts, and burn-rate-based reorder calculations. Designed to eliminate the spreadsheets most labs use today.",
      },
      {
        q: "What is VeritaBench\u2122?",
        a: "VeritaBench\u2122 is the productivity and staffing analytics suite for laboratory operations. It includes VeritaBench\u2122 (free billable-tests-per-hour calculator at /calculator), VeritaPace\u2122 (monthly productivity tracker with year-over-year trend analysis at /veritabench), VeritaShift\u2122 (by-hour staffing analyzer at /veritabench/staffing), and VeritaQA\u2122 (quality indicators dashboard at /veritabench/pi). Built for hospital and enterprise labs that need to defend headcount and budget decisions.",
      },
      {
        q: "What is VeritaMap\u2122?",
        a: "VeritaMap\u2122 is the test menu regulatory mapping module. One row per test, one column per regulatory obligation (CLIA complexity, PT enrollment, competency assignment, linearity and correlation requirements, QC obligations, reference range source, SOP location). Every cell maps to the exact 42 CFR section and TJC standard that mandates it, so your obligations are visible and auditable across the entire test menu.",
      },
      {
        q: "What is VeritaComp\u2122?",
        a: "VeritaComp\u2122 manages staff competency assessments across the six CLIA-required methods, the 2-of-4 waived testing requirements, and non-technical duties. Integrates with VeritaMap\u2122 for automatic instrument and method group setup. Generates the documentation framework surveyors expect across TJC, CAP, COLA, and CLIA-only accreditation.",
      },
      {
        q: "Where do the Element 6 problem-solving quiz questions come from?",
        a: "Directors author Element 6 quizzes themselves, in-app. The Quizzes tab on every competency program lets you write questions row by row (question, four options, correct answer, explanation), upload a JSON file you wrote elsewhere, edit any existing quiz, and attach a quiz to any method group in the program. Each quiz requires a 100% score to pass; the full quiz and graded answers append to the competency PDF. Director authorship is intentional: Element 6 is the director's signoff on what their staff need to know, and surveyors expect that ownership to be visible. A planned future enhancement (parked, no timeline yet) is a shared, opt-in question library where directors who want to contribute can publish their questions for other labs with the same instruments to browse and upvote.",
      },
      {
        q: "What is VeritaLab\u2122?",
        a: "VeritaLab\u2122 tracks your laboratory's certificates and accreditations: CLIA certificates, state licenses, accreditation status, and lab director credentials. Reminder alerts fire well before anything expires, and the actual certificate documents are stored so you can retrieve them in seconds during a survey.",
      },
      {
        q: "What is VeritaPolicy\u2122?",
        a: "VeritaPolicy\u2122 is a policy and procedure tracker for TJC, CAP, COLA, and CMS-required policies. Pre-loaded with the requirements for each accreditor, with per-requirement N/A controls so you can mark policies that don't apply to your lab. Build your policy library, link documents to requirements, and generate an inspector-ready compliance report.",
      },
      {
        q: "What is VeritaStaff\u2122?",
        a: "VeritaStaff\u2122 manages laboratory personnel records: staff roster, CLIA role assignments, qualifications, hire-date onboarding, competency milestone tracking, and CMS 209 report generation.",
      },
      {
        q: "What is VeritaPT\u2122?",
        a: "VeritaPT\u2122 tracks proficiency testing enrollment, survey results, and corrective actions by analyte. Monitor unacceptable results, close the loop with documented corrective actions, and generate surveyor-ready reports covering all enrollments, events, and corrective actions across CAP, API, WSLH, and alternative assessment records.",
      },
      {
        q: "What is VeritaResponse\u2122?",
        a: "VeritaResponse\u2122 manages post-survey deficiency response. When you get cited, VeritaResponse\u2122 turns Word documents and email threads into one tracked finding with a due-date clock per accreditor (CAP 30 days, TJC 60 days, CMS-2567 10 days, AABB event-driven). Renders the federal CMS-2567 Plan of Correction PDF with all 5 POC elements labeled, plus dedicated CAP, TJC ESC, COLA, and AABB renderers. Cross-links to your most recent VeritaCheck\u2122 study for the cited standard so you can show the surveyor what you had already done.",
      },
      {
        q: "Do modules work together, or are they separate?",
        a: "They're integrated. Studies in VeritaCheck\u2122 automatically check off VeritaScan\u2122 items. Instruments registered in VeritaMap\u2122 feed VeritaCheck\u2122 instrument selection and VeritaComp\u2122 competency programs. Personnel in VeritaStaff\u2122 tie into VeritaComp\u2122 assessments. One subscription, one login, shared data.",
      },
    ],
  },
  {
    category: "Teams and Seats",
    items: [
      {
        q: "Can my team share an account?",
        a: "Yes. Every paid plan includes seats for additional staff members. The owner invites teammates by email; each gets their own login and customizable permissions. Studies, instruments, and inspection records are shared across the team.",
      },
      {
        q: "How are seat permissions configured?",
        a: "The account owner sets permissions per seat: read-only, study-author, instrument-admin, billing-admin, and others. You can scope a seat to specific modules - for example, an inventory manager who only sees VeritaStock\u2122.",
      },
      {
        q: "How many seats are included in each plan?",
        a: "Seat counts scale with plan tier. Clinic includes 2 seats, Community 5, Hospital 15, and Enterprise 25. Seat counts include the account owner, so a 5-seat Community plan is the owner plus 4 invited teammates. See the pricing page or contact info@veritaslabservices.com for specifics on your situation.",
      },
      {
        q: "Can I add more seats later?",
        a: "Each plan tier includes a fixed number of seats. To get more seats, upgrade to the next tier (Clinic to Community, Community to Hospital, or Hospital to Enterprise) from your Account Settings. Tier upgrades are prorated against your current billing period.",
      },
      {
        q: "Can I belong to multiple labs?",
        a: "Yes. VeritaAssure™ supports multi-lab access. A user who is added as a member of more than one lab can switch between them from the navigation bar; data is scoped to whichever lab is currently active. Each lab maintains its own test menu, accreditation flags, policies, and member list. Membership is checked on every read and every write, so a member of Lab A cannot read or modify records belonging to Lab B.",
      },
    ],
  },
  {
    category: "Compliance and Standards",
    items: [
      {
        q: "Which accreditation programs does VeritaAssure\u2122 support?",
        a: "VeritaAssure\u2122 aligns with The Joint Commission (TJC), CAP (College of American Pathologists), COLA, and CMS/CLIA requirements. VeritaScan\u2122 items are triple-mapped to TJC standards, CAP checklists, and 42 CFR Part 493. Reports cite the specific regulation each finding addresses.",
      },
      {
        q: "How does VeritaAssure\u2122 handle the CLIA TEa standard?",
        a: "VeritaCheck\u2122 pre-populates the \u00a7493 proficiency-testing TEa for each analyte (from \u00a7493.927, \u00a7493.931, \u00a7493.937, and \u00a7493.941) as the default calibration verification acceptance criterion. Under \u00a7493.1253(b)(2) and \u00a7493.1255(b)(3), CLIA requires the lab to establish and document acceptance criteria but does not specify the numeric value. Adopting the \u00a7493 PT TEa is a recommendation, made and approved by your medical director or designee. The TEa lookup tool is available at /resources/clia-tea-lookup.",
      },
      {
        q: "Does VeritaAssure\u2122 work for waived-only labs?",
        a: "Yes. Certificate of Waiver labs are placed in the Clinic tier automatically. Even waived-only labs benefit from VeritaScan\u2122's inspection readiness self-assessment, VeritaStock\u2122 inventory management, and personnel and certificate tracking.",
      },
      {
        q: "Can a non-laboratorian use VeritaAssure\u2122?",
        a: "Yes, but every report still requires a laboratory director or designee review block. VeritaAssure\u2122 is built so a quality manager, lab supervisor, or technologist can complete the work, while the director retains final approval responsibility.",
      },
      {
        q: "How often is the regulatory data updated?",
        a: "The 42 CFR Part 493 TEa values are sourced from the CLIA proficiency testing final rule (CMS-3355-F), effective July 11, 2024 and implemented January 1, 2025, and are updated when CMS publishes a Federal Register notice that changes them. TJC, CAP, COLA, AABB, and CMS checklists are mapped to the current published standards; updates are pushed to the platform without action on your part. See /resources/clia-tea-lookup for the live TEa reference tool.",
      },
    ],
  },
  {
    category: "HIPAA and Data Privacy",
    items: [
      {
        q: "Is VeritaAssure\u2122 a HIPAA-covered platform?",
        a: "No. VeritaAssure\u2122 is not designed to store, process, or transmit protected health information (PHI). It is a QC and compliance documentation tool. Users are required to use only de-identified data: sample IDs, QC lot numbers, instrument control values, and non-patient-identifiable information. Do not enter patient names, dates of birth, medical record numbers, or any other PHI into any VeritaAssure\u2122 module.",
      },
      {
        q: "Why isn't VeritaAssure\u2122 a HIPAA-covered platform?",
        a: "Performance verification studies, calibration verification, proficiency testing documentation, inspection readiness checklists, and staff competency records do not require patient data. QC work is performed on controls and reference materials, not patient specimens. Compliance documentation references regulatory standards, not patient outcomes. There is no legitimate need for PHI in any function VeritaAssure\u2122 performs.",
      },
      {
        q: "Will you sign a Business Associate Agreement (BAA)?",
        a: "A BAA is available for organizations that require one as part of their vendor compliance program. Contact info@veritaslabservices.com. Because VeritaAssure\u2122 does not process PHI, a BAA is a contractual formality rather than a functional requirement.",
      },
      {
        q: "What data do you collect about me?",
        a: "We collect your name, email address, lab name, CLIA number, and the compliance data you enter into the platform: study results, test menus, inspection responses, and personnel records. We do not collect patient data, and we do not share or sell your data to third parties.",
      },
      {
        q: "Who can see my data?",
        a: "Your data is visible only to you and any seat users you invite. Veritas Lab Services staff may access data for support purposes. We do not sell, share, or disclose your data to third parties.",
      },
    ],
  },
  {
    category: "Data Security",
    items: [
      {
        q: "How is my data protected?",
        a: "All data is transmitted over encrypted HTTPS connections and stored in an isolated database on a secured cloud server. Access requires authentication with your credentials. Passwords are hashed before storage and never stored in plaintext.",
      },
      {
        q: "Where is my data hosted?",
        a: "Data is hosted on US-based cloud infrastructure with industry-standard physical and network security controls. The application server runs on Railway (US-West region); nightly backups go to an independent off-site storage provider. See /trust for the complete security and privacy posture. Contact info@veritaslabservices.com for a security questionnaire if your IT team requires one.",
      },
      {
        q: "Where can I read your full security and privacy posture?",
        a: "See /trust for the complete write-up: hosting, encryption, multi-lab data isolation, subprocessors (Railway, Stripe, Resend, Sentry), HIPAA BAA availability, vulnerability reporting, and SOC 2 status. The page is updated as policies change.",
      },
      {
        q: "Do you back up my data?",
        a: "Yes. Your data is backed up nightly to off-site cold storage independent of the application server. Contact info@veritaslabservices.com if you need to recover data.",
      },
      {
        q: "What happens to my data if VeritaAssure\u2122 experiences an outage?",
        a: "Your data is stored on a persistent cloud volume and is not affected by application restarts or brief outages. Nightly snapshots ensure your data can be restored from the most recent backup in the event of a prolonged outage.",
      },
    ],
  },
  {
    category: "Subscriptions and Billing",
    items: [
      {
        q: "What plans are available?",
        a: "VeritaAssure\u2122 offers plans for labs of all sizes, from a single per-study purchase to enterprise subscriptions for large health systems. Plans include seats for your team and the full VeritaAssure\u2122 module suite. Certificate of Waiver labs are always placed in the lowest tier. For current pricing, visit the pricing page.",
      },
      {
        q: "How does pricing scale with lab size?",
        a: "Plans are tiered by lab type, not by per-instrument or per-test volume. Clinic ($499/yr) is for single-CLIA practices. Community ($999/yr) for community hospitals and reference networks. Hospital ($1,999/yr) for full-service hospital labs. Enterprise ($2,999/yr) for health systems with multiple sites. All plans include the full module suite.",
      },
      {
        q: "How is my plan tier determined?",
        a: "During checkout you can enter your CLIA number and we will look it up against CMS data to suggest a plan based on your certificate type and facility size. You can always select a different tier. Certificate of Waiver labs are placed in the Clinic tier.",
      },
      {
        q: "Do you offer a free trial?",
        a: "Yes, on our multi-seat suite plans (Clinic, Community, Hospital). Those subscriptions include a 14-day free trial: you can use the full platform during the trial and are only charged when it ends. VeritaCheck™ Unlimited does not include a trial; it bills at its discounted first-year price at checkout. You can also run individual VeritaCheck™ studies on a per-study basis with no subscription.",
      },
      {
        q: "Can I try VeritaAssure\u2122 before subscribing?",
        a: "Yes. A fully interactive live demo is available at veritaslabservices.com/demo with no login required. Our multi-seat suite plans include a 14-day free trial, so you can use the full platform before being billed. VeritaCheck\u2122 Unlimited bills at its discounted first-year price at checkout, and you can also run individual VeritaCheck\u2122 studies on a per-study basis without a subscription.",
      },
      {
        q: "What's the difference between the per-study price and the unlimited subscription?",
        a: "Per Study is $25 per validation study, paid one-time, no subscription. It's ideal for labs that run only a handful of studies a year. VeritaCheck\u2122 Unlimited at $299 per year breaks even after just 12 studies and includes all VeritaCheck\u2122 functionality. For full-suite access (VeritaTrack\u2122, VeritaStock\u2122, VeritaBench\u2122, and others), choose Clinic, Community, Hospital, or Enterprise.",
      },
      {
        q: "Do you offer a money-back guarantee?",
        a: "Yes. Subscription plans include a 30-day money-back guarantee on your first charge. We'll refund the first subscription charge in full within 30 days of that charge. One refund per customer; applies to the initial charge only, not renewals or per-study purchases.",
      },
      {
        q: "What payment methods do you accept?",
        a: "Self-service subscriptions are processed by credit or debit card through Stripe. Hospitals and health systems requiring purchase order-based invoicing should contact info@veritaslabservices.com to arrange billing. Payment card information is processed and stored by Stripe and is never stored on our servers.",
      },
      {
        q: "Do you accept purchase orders or invoicing?",
        a: "Yes. Hospitals and health systems can request PO-based invoicing instead of credit card billing. Visit /request-invoice or email info@veritaslabservices.com to set up.",
      },
      {
        q: "Are there discounts available?",
        a: "We offer discount codes for COLA members, conference attendees, and multi-site groups. Email info@veritaslabservices.com if your situation may qualify.",
      },
      {
        q: "Can I cancel at any time?",
        a: "Yes. You can cancel your subscription at any time. Your access will continue through the end of your current billing period.",
      },
    ],
  },
  {
    category: "Data Retention and Cancellation",
    items: [
      {
        q: "What happens to my data if I cancel?",
        a: "Your data is retained for 2 years after your subscription ends. During this period you can reactivate your subscription and regain full access to your historical records. This retention period is designed to align with common laboratory record retention requirements.",
      },
      {
        q: "Can I export my data before canceling?",
        a: "Yes. Every module that generates structured data has an Excel or PDF export function. We recommend exporting your records before canceling if you want local copies.",
      },
      {
        q: "What happens after the 2-year retention period?",
        a: "After 2 years of inactivity, your account and associated data are permanently deleted from our servers. We will notify you by email before this occurs.",
      },
      {
        q: "Can I request deletion of my data before the retention period ends?",
        a: "Yes. Contact info@veritaslabservices.com to request early deletion. We will confirm deletion within 30 days.",
      },
    ],
  },
  {
    category: "Technical and Support",
    items: [
      {
        q: "What browsers does VeritaAssure\u2122 support?",
        a: "VeritaAssure\u2122 works in any modern browser including Chrome, Edge, Firefox, and Safari. No software installation is required.",
      },
      {
        q: "Is there a mobile app?",
        a: "Not currently. VeritaAssure\u2122 is a web-based platform accessible from any device with a browser, but it is optimized for desktop use.",
      },
      {
        q: "Does VeritaAssure\u2122 integrate with my LIS?",
        a: "Not today. VeritaAssure\u2122 is a standalone compliance and operations platform; you enter QC data, study results, and competency records directly. LIS integration is on the roadmap. For most labs the categories of data VeritaAssure\u2122 tracks (performance verification, QC events, competency, instrument metadata, inspection readiness, PT, certificates, policies) live outside the LIS anyway, so the duplicate-entry burden is smaller than it first appears.",
      },
      {
        q: "Is software validation documentation available?",
        a: "Yes. A software validation template is available for download on the Resources page. Laboratories that require formal software validation documentation as part of their quality system can use this template to document their validation process.",
      },
      {
        q: "Is there a public roadmap?",
        a: "Yes. The product roadmap at /roadmap shows what's shipped, what's in active development, and what's planned next. Customer requests routinely bump items up the priority list.",
      },
      {
        q: "Do you offer consulting services beyond software?",
        a: "Yes. Veritas Lab Services offers laboratory consulting at /services, including mock inspections, performance verification strategy, quality management system buildouts, and CLIA application support. Consulting and software are sold separately.",
      },
      {
        q: "How do I schedule a live walkthrough?",
        a: "Visit /book to schedule a 30-minute call with Michael Veri. We'll walk through your specific accreditation situation and the modules most relevant to your lab.",
      },
      {
        q: "How do I get support?",
        a: "Email info@veritaslabservices.com. We aim to respond within 2 business days.",
      },
      {
        q: "Is training available?",
        a: "Clinic and Community plans include a complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure\u2122 specialist. Hospital plans include a 2-hour session. Enterprise plans include custom onboarding tailored to your organization. Additional training sessions can be arranged on request.",
      },
    ],
  },
];

// /resources/verifying-reference-intervals  (visible "Frequently Asked Questions")
// Every answer restates prose already published in
// ArticleReferenceIntervalVerificationPage.tsx. No new regulatory claim: both
// 42 CFR 493.1253 and CLSI EP28-A3c are cited in that article's own References.
export const REFINT_ARTICLE_FAQ: FaqQA[] = [
  {
    q: "Does CLIA require laboratories to establish reference intervals, or only verify them?",
    a: "CLIA, under 42 CFR 493.1253, lists the reference interval among the performance specifications a laboratory must verify are appropriate for its own patient population before reporting patient results. It does not require most laboratories to establish intervals from scratch, and it does not dictate a single method. In practice there are three tiers: establishing, verifying, and documented review. Most laboratories only need the second or third.",
  },
  {
    q: "How many samples does it take to verify a reference interval?",
    a: "Commonly twenty. The laboratory tests a small group of its own reference individuals against the interval it intends to adopt, and if no more than a small proportion, conventionally two of the twenty, fall outside the proposed interval, the interval is considered verified for that laboratory's population. If three or more of the twenty fall outside, the verification has not passed, and the CLSI EP28-A3c procedure is to test a second group of twenty. Establishing an interval from scratch is a different tier: the CLSI guideline recommends a minimum of 120 qualified reference individuals per partition, which is why very few clinical laboratories do it.",
  },
  {
    q: "What do you do if your laboratory cannot recruit twenty reference individuals?",
    a: "Use the documented review, sometimes called transference. It is the tier for the laboratory that genuinely cannot recruit even twenty reference individuals, which is a real situation for low-volume, specialized, or newly implemented tests, and it uses no new reference samples. The laboratory assesses the manufacturer's reference population as described in the package insert or method documentation, reviews the published literature and clinical guidance for the analyte, confirms the analytical performance of the method in its own hands, and documents the similarity or difference between the reference population and the population it serves. This tier is a fallback, not a shortcut. It is the path a surveyor scrutinizes hardest, and its entire strength is the quality of the written rationale.",
  },
  {
    q: "Do you have to re-verify reference intervals after changing instruments or methods?",
    a: "Yes. The reference interval is tied to the method that produces it, and when the method changes, the verification no longer holds. A new analyzer, a new platform, a significant reagent reformulation, or a change in measurement principle can shift where results fall, and an interval verified on the old method is not automatically valid on the new one. A laboratory that migrates instruments and carries its reference intervals forward untouched has quietly un-verified them, and it is one of the most common gaps a thorough inspector finds.",
  },
  {
    q: "What is a reference individual, and how do you define one?",
    a: "A reference individual is a person who meets criteria the laboratory sets in writing before the study begins. A list of twenty healthy adults with no definition of healthy is a dataset that looks rigorous and defends nothing. The definition is a set of inclusion and exclusion criteria set in advance: the age range and sex distribution appropriate to the analyte, a health-status screen, exclusions for relevant medications and conditions, and fasting status where the analyte requires it. When a surveyor asks how the reference population was constituted, the written criteria are the answer. Their strength comes from being explicit, not from the sample being large.",
  },
  {
    q: "What does a surveyor expect to see for reference intervals?",
    a: "Evidence of a defensible process, not a full establishment study. A surveyor who understands reference intervals knows most laboratories cannot produce one and are not required to. The surveyor wants written inclusion and exclusion criteria for reference individuals; a verification study, or a documented review with a real rationale, for the intervals in use; a similarity assessment between the reference population and the laboratory's patients, especially where the two plainly differ; and evidence that the intervals were re-verified when the method changed. The laboratory that can produce those is in a far stronger position than the one holding only a stack of package inserts.",
  },
];

// Flatten categories to a single Q&A list (for FAQPage JSON-LD mainEntity).
export function flattenFaq(categories: FaqCategory[]): FaqQA[] {
  return categories.flatMap((c) => c.items);
}
