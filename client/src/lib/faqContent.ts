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

// /faq  (the main FAQ page, grouped by category)
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
        a: "VeritaScan\u2122 is a 168-item inspection readiness self-assessment across 10 compliance domains, triple-mapped to The Joint Commission standards, CAP checklists, and 42 CFR Part 493. Studies completed in VeritaCheck\u2122 automatically check off corresponding items, so your inspection readiness is always current. Built by a former TJC laboratory surveyor with 200+ facility inspections. Includes an executive summary export.",
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
        a: "Yes. All subscription plans include a 14-day free trial. You can use the full platform during the trial; you're only charged when the trial ends. No commitment.",
      },
      {
        q: "Can I try VeritaAssure\u2122 before subscribing?",
        a: "Yes. A fully interactive live demo is available at veritaslabservices.com/demo with no login required. All subscription plans include a 14-day free trial, so you can use the full platform before being billed. You can also run individual VeritaCheck\u2122 studies on a per-study basis without a subscription.",
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

// Flatten categories to a single Q&A list (for FAQPage JSON-LD mainEntity).
export function flattenFaq(categories: FaqCategory[]): FaqQA[] {
  return categories.flatMap((c) => c.items);
}
