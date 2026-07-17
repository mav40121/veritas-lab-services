import {
  TEA_ARTICLE_FAQ,
  CALVER_ARTICLE_FAQ,
  EP26_ARTICLE_FAQ,
  QC_ARTICLE_FAQ,
  TEA_LOOKUP_FAQ,
  CALVER_REQ_FAQ,
  METHODCOMP_FAQ,
  PRECISION_FAQ,
  TJC_INSPECTION_FAQ,
  CPRT_FAQ,
  MANUAL_LOGS_FAQ,
  REFINT_ARTICLE_FAQ,
  FAQ_CATEGORIES,
  flattenFaq,
  type FaqQA,
} from "../client/src/lib/faqContent";

export interface SEOMetadata {
  title: string;
  description: string;
  // Optional per-route structured data (JSON-LD). When present, static.ts
  // injects it as one or more <script type="application/ld+json"> blocks into
  // the served HTML, alongside the site-wide @graph already in index.html.
  // Reference the existing Organization node via {"@id": ".../#organization"}
  // for publisher. A route may supply a single object or an array of objects
  // (e.g. Article + FAQPage + DefinedTerm on the same page).
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const BASE_URL = "https://www.veritaslabservices.com";

// FAQPage JSON-LD from a list of visible Q&A. The questions/answers are the
// SAME objects the page renders (imported from client/src/lib/faqContent), so
// the structured data is verbatim-identical to the on-page FAQ by construction,
// as Google's FAQ policy and the honest-content rule require.
function faqPageJsonLd(items: FaqQA[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((it) => ({
      "@type": "Question",
      name: it.q,
      acceptedAnswer: { "@type": "Answer", text: it.a },
    })),
  };
}

// DefinedTerm JSON-LD for a glossary term the site authoritatively defines.
// inDefinedTermSet points at the page that defines the term, so AI answer
// engines can anchor a citation to that URL.
function definedTermJsonLd(name: string, description: string, pagePath: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name,
    description,
    inDefinedTermSet: `${BASE_URL}${pagePath}`,
  };
}

// Article JSON-LD for a resource article. Mirrors the shape of the existing
// hand-authored Article nodes (EP26, TEa, QC). articleBody is composed from the
// article's own headline lede, key takeaways, and section headings, copied
// verbatim from the rendered page, so the body signal is faithful with zero
// drift and no fabricated content. Because articleBody is set here, the later
// enrichArticleBodies() pass leaves these nodes untouched.
function articleJsonLd(opts: {
  headline: string;
  description: string;
  articleBody: string;
  path: string;
  datePublished: string;
  dateModified?: string;
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    articleBody: opts.articleBody,
    image: `${BASE_URL}/og-image.png`,
    author: {
      "@type": "Person",
      name: "Michael Veri",
      jobTitle: "Former Joint Commission Laboratory Surveyor",
      url: `${BASE_URL}/team`,
    },
    publisher: { "@id": `${BASE_URL}/#organization` },
    datePublished: opts.datePublished,
    dateModified: opts.dateModified ?? opts.datePublished,
    mainEntityOfPage: `${BASE_URL}${opts.path}`,
  };
}

export const seoMetadataMap: Record<string, SEOMetadata> = {
  "/": {
    title: "VeritaAssure\u2122 Lab Compliance Software | Veritas Lab Services",
    description: "VeritaAssure\u2122 is the all-in-one compliance platform for clinical laboratories. Performance verification, inspection readiness, PT, competency tracking.",
  },
  "/veritaassure": {
    title: "VeritaAssure\u2122 | Lab Compliance Software Suite for Clinical Laboratories",
    description: "The complete laboratory compliance platform. VeritaCheck™, VeritaMap™, VeritaScan™, VeritaTrack™, VeritaPolicy™, and more - built by a lab professional who conducted 200+ Joint Commission surveys.",
  },
  "/pricing": {
    title: "Pricing | VeritaAssure\u2122 Lab Compliance Software",
    description: "Simple annual pricing for clinical laboratory compliance software. Plans for individual labs, community hospitals, regional hospitals, and enterprise health systems.",
  },
  "/services": {
    title: "Services | Veritas Lab Services Laboratory Consulting",
    description: "Laboratory consulting services including compliance assessments, accreditation preparation, performance verification support, and staff education by Michael Veri, MLS(ASCP), CPHQ.",
  },
  "/contact": {
    title: "Contact | Veritas Lab Services",
    description: "Get in touch with Veritas Lab Services. Questions about VeritaAssure\u2122, laboratory consulting, or scheduling a demo.",
  },
  "/team": {
    title: "Our Team | Veritas Lab Services",
    description: "Meet Michael Veri, MS, MBA, MLS(ASCP), CPHQ - laboratory compliance expert, former Joint Commission surveyor, and founder of Veritas Lab Services.",
  },
  "/faq": {
    title: "FAQ | VeritaAssure\u2122 Lab Compliance Software",
    description: "Frequently asked questions about VeritaAssure\u2122, CLIA compliance software, performance verification, and laboratory inspection readiness tools.",
    jsonLd: faqPageJsonLd(flattenFaq(FAQ_CATEGORIES)),
  },
  "/getting-started": {
    title: "Getting Started | VeritaAssure\u2122 Lab Compliance Software",
    description: "Get started with VeritaAssure\u2122. Follow the step-by-step onboarding guide to set up your laboratory compliance platform.",
  },
  "/book": {
    title: "Book a Consultation | Veritas Lab Services",
    description: "Schedule a consultation or demo with Michael Veri. Learn how VeritaAssure\u2122 can help your laboratory stay compliant and survey-ready.",
  },
  "/demo": {
    title: "Demo | VeritaAssure\u2122 Lab Compliance & Operations Software",
    description: "Explore VeritaAssure\u2122 in action. Choose from operations tools (productivity, staffing) or the full compliance suite (performance verification, inspection readiness, competency tracking).",
  },
  "/demo/operations": {
    title: "VeritaBench\u2122 Demo - Lab Productivity & Staffing Tools | VeritaAssure\u2122",
    description: "See VeritaBench\u2122 in action. Interactive productivity calculator, monthly tracking, and by-hour staffing analysis built for clinical laboratories.",
  },
  "/demo/compliance": {
    title: "Compliance Suite Demo | VeritaAssure\u2122 Lab Compliance Software",
    description: "Try the VeritaAssure\u2122 compliance demo. Explore VeritaCheck™ performance verification, VeritaScan™ inspection readiness, VeritaMap™ reportable ranges, and VeritaComp™ competency tracking.",
  },
  "/roadmap": {
    title: "Product Roadmap | VeritaAssure\u2122 Lab Compliance Software",
    description: "See what is coming next for VeritaAssure\u2122. Upcoming features for clinical laboratory compliance, quality management, and accreditation readiness.",
  },
  "/veritacheck": {
    title: "VeritaCheck\u2122 Performance Verification | CLIA Calibration Verification and Method Comparison",
    description: "Run CLIA Calibration Verification / Linearity, Correlation / Method Comparison, and CLSI EP15 precision studies, and generate surveyor-ready, CFR-cited PDF reports, inside the VeritaAssure compliance platform. Built by a former Joint Commission surveyor.",
  },
  "/veritascan": {
    title: "VeritaScan™ | Laboratory Inspection Readiness Checklist Software",
    description: "173-item TJC-standard inspection checklist for clinical laboratories. Track your readiness, identify gaps, and walk into every survey prepared.",
  },
  "/veritamap": {
    title: "VeritaMap™ | Clinical Laboratory Test Menu Mapping Software",
    description: "Map your complete laboratory test menu with instrument assignments, reference ranges, and critical values. Built for CLIA compliance and accreditation surveys.",
  },
  "/veritacomp": {
    title: "VeritaComp™ | Laboratory Competency Assessment Software",
    description: "Manage the six CLIA competency elements for every lab employee. Track assessments, generate PDF documentation, and stay survey-ready year-round.",
  },
  "/veritastaff": {
    title: "VeritaStaff™ | Laboratory Staff Roster and HR Compliance Software",
    description: "Maintain your laboratory staff roster with credentials, training records, and compliance tracking. Stay organized for Joint Commission and CLIA surveys.",
  },
  "/veritapt": {
    title: "VeritaPT\u2122 | Proficiency Testing Gap Analyzer for Clinical Labs",
    description: "Identify PT coverage gaps in your laboratory test menu. Ensure every analyte has a proficiency testing program and stay compliant with CLIA PT requirements.",
  },
  "/veritalab": {
    title: "VeritaLab™ | Laboratory Certificate and Document Storage Software",
    description: "Centralized storage for laboratory accreditation certificates, licenses, and compliance documents. Never scramble for paperwork during a survey again.",
  },
  "/veritapolicy": {
    title: "VeritaPolicy™ | Laboratory Policy and Procedure Management Software",
    description: "Version-controlled policy and procedure management for clinical laboratories. Track staff acknowledgments, manage document review cycles, and stay survey-ready.",
  },
  "/resources": {
    title: "Resources | CLIA Compliance Guides for Clinical Laboratories",
    description: "Free guides and articles on CLIA compliance, performance verification, calibration verification, proficiency testing, and laboratory inspection preparation.",
  },
  "/resources/clia-calibration-verification-method-comparison": {
    title: "CLIA Calibration Verification and Method Comparison Guide | Veritas Lab Services",
    description: "A complete guide to CLIA calibration verification and method comparison requirements for clinical laboratories, including documentation and frequency requirements.",
    jsonLd: [
      articleJsonLd({
        headline: "CLIA Calibration Verification and Method Comparison: What Lab Managers Actually Need to Know",
        description: "A complete guide to CLIA calibration verification and method comparison requirements for clinical laboratories, including documentation and frequency requirements.",
        articleBody: "Most labs are spending money on kits they don't need, performing studies on instruments that don't require them, and missing a built-in 20-day compliance window that would eliminate deadline stress entirely. Here's how to fix all three. Calibration verification is an accuracy study: it measures correctness, not consistency. Correlation/method comparison studies are precision studies: they measure reproducibility across methods. Waived tests and factory-calibrated instruments do NOT require calibration verification. Both requirements can often be satisfied simultaneously using the same specimens. The compliance window is six months PLUS twenty days from the director sign-off date, not the data collection date. Sections: Why This Matters; Precision vs. Accuracy: The Foundation Everything Else Rests On; What Is Calibration Verification Under CLIA?; What Is a Correlation / Method Comparison Study?; The Efficiency Play: Run Both Studies Simultaneously; The Six-Month-Plus-Twenty-Day Rule: The Most Underused Compliance Tool; Designing an Efficient Compliance Program; Frequently Asked Questions; Conclusion.",
        path: "/resources/clia-calibration-verification-method-comparison",
        datePublished: "2026-04-30",
      }),
      faqPageJsonLd(CALVER_ARTICLE_FAQ),
      definedTermJsonLd(
        "Calibration Verification",
        "Calibration verification is an accuracy study: it measures correctness, not consistency.",
        "/resources/clia-calibration-verification-method-comparison",
      ),
    ],
  },
  "/resources/verifying-reference-intervals": {
    title: "How to Verify Reference Intervals Under CLIA: A Practical Guide",
    description: "CLIA requires most laboratories to verify, not establish, reference intervals. The three tiers of establish, verify, and documented review, how to define reference individuals, the CLSI EP28-A3c 20-sample verification, and re-verifying when the method changes.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "Verifying Reference Intervals When You Cannot Establish Them: A Practical Guide for the Real-World Laboratory",
        description: "CLIA requires most laboratories to verify, not establish, reference intervals. How to run the CLSI EP28-A3c 20-sample verification, defend a documented review when you cannot recruit 20, and re-verify when the method changes.",
        image: `${BASE_URL}/og-image.png`,
        author: {
          "@type": "Person",
          name: "Michael Veri",
          jobTitle: "Former Joint Commission Laboratory Surveyor",
          url: `${BASE_URL}/team`,
        },
        publisher: { "@id": `${BASE_URL}/#organization` },
        datePublished: "2026-07-05",
        dateModified: "2026-07-05",
        mainEntityOfPage: `${BASE_URL}/resources/verifying-reference-intervals`,
      },
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How to verify a reference interval under CLSI EP28-A3c",
        description: "The 20-sample procedure for verifying that a manufacturer's or published reference interval is appropriate for your laboratory's patient population.",
        step: [
          { "@type": "HowToStep", name: "Define your reference individuals", text: "Set written inclusion and exclusion criteria before you begin: age range and sex distribution for the analyte, a health-status screen, medication and condition exclusions, and fasting status where required." },
          { "@type": "HowToStep", name: "Test twenty reference individuals", text: "Measure twenty qualified reference individuals from your own patient population on your own method." },
          { "@type": "HowToStep", name: "Compare against the proposed interval", text: "Count how many of the twenty results fall outside the reference interval you intend to adopt." },
          { "@type": "HowToStep", name: "Apply the acceptance criterion", text: "If no more than two of the twenty fall outside, the interval is verified for your population. If three or more fall outside, test a second group of twenty." },
          { "@type": "HowToStep", name: "Escalate on repeated failure", text: "If the second group also fails, adopt a different published interval or, occasionally, establish your own." },
          { "@type": "HowToStep", name: "Re-verify when the method changes", text: "When the analyzer, platform, reagent formulation, or measurement principle changes, re-verify the interval; the prior verification no longer holds." },
        ],
      },
      definedTermJsonLd(
        "Reference Interval Verification",
        "Reference interval verification is the process by which a clinical laboratory confirms that a manufacturer's or published reference interval is appropriate for its own patient population, most commonly by testing 20 reference individuals and accepting the interval if no more than two fall outside it, per CLSI EP28-A3c and 42 CFR 493.1253.",
        "/resources/verifying-reference-intervals",
      ),
      faqPageJsonLd(REFINT_ARTICLE_FAQ),
    ],
  },
  "/resources/ep26-reagent-lot-verification": {
    title: "CLSI EP26 Reagent Lot Verification: Protocol and How-To Guide",
    description: "How clinical laboratories verify a new reagent lot under CLSI EP26 (2nd edition, 2022). The protocol, sample requirements, acceptance criteria, and documentation for lot-to-lot verification.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "CLSI EP26 Reagent Lot Verification: A Working Protocol for Clinical Laboratories",
        description: "How clinical laboratories verify a new reagent lot under CLSI EP26 (2nd edition, 2022): the protocol, sample requirements, acceptance criteria, and documentation for lot-to-lot verification.",
        image: `${BASE_URL}/og-image.png`,
        author: {
          "@type": "Person",
          name: "Michael Veri",
          jobTitle: "Former Joint Commission Laboratory Surveyor",
          url: `${BASE_URL}/team`,
        },
        publisher: { "@id": `${BASE_URL}/#organization` },
        datePublished: "2026-06-16",
        dateModified: "2026-06-16",
        mainEntityOfPage: `${BASE_URL}/resources/ep26-reagent-lot-verification`,
      },
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How to verify a new reagent lot under CLSI EP26",
        description: "The step-by-step protocol for reagent lot-to-lot verification: select patient samples, run both lots, calculate the difference, compare against a TEa-anchored criterion, and document the determination.",
        step: [
          { "@type": "HowToStep", name: "Select patient samples", text: "Choose patient samples that span the analytical measuring range, including values near medical decision points. The medical director or designee sets the count; many laboratories use a minimum near 20." },
          { "@type": "HowToStep", name: "Run each sample on both lots", text: "Test every selected sample on the current reagent lot and the new lot in the same run, under the same conditions, so the lot is the only variable." },
          { "@type": "HowToStep", name: "Calculate the per-specimen difference", text: "For each sample, compute the percent difference between the new lot result and the current lot result." },
          { "@type": "HowToStep", name: "Compare against the acceptance criterion", text: "Evaluate the differences against a pre-defined criterion anchored to total allowable error (TEa)." },
          { "@type": "HowToStep", name: "Accept or investigate", text: "Accept the lot if it meets the criterion. If it does not, treat it as an investigation rather than an automatic rejection." },
          { "@type": "HowToStep", name: "Document and sign off", text: "Record the data, the criterion, the determination, and the medical director or designee approval." },
        ],
      },
      faqPageJsonLd(EP26_ARTICLE_FAQ),
      definedTermJsonLd(
        "CLSI EP26",
        "CLSI EP26, 2nd Edition (User Evaluation of Acceptability of a Reagent Lot Change, 2022) is the consensus guideline for evaluating whether a new reagent lot differs meaningfully from the current lot, using patient samples tested on both the current and new lot. It replaced the 2013 first edition (EP26-A).",
        "/resources/ep26-reagent-lot-verification",
      ),
    ],
  },
  "/resources/clia-tea-what-lab-directors-dont-know": {
    title: "CLIA Total Allowable Error (TEa): 2026 Limits by Specialty",
    description: "The current CLIA total allowable error (TEa) limits by specialty: chemistry, hematology, toxicology, and immunology, with 42 CFR §493 citations.",
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "CLIA Allowable Error (TEa): What It Is, Where to Find It, and Why Most Lab Directors Don't Know About It",
      description: "The current CLIA total allowable error (TEa) limits by specialty: chemistry, hematology, toxicology, and immunology, with 42 CFR §493 citations.",
      image: `${BASE_URL}/og-image.png`,
      author: {
        "@type": "Person",
        name: "Michael Veri",
        jobTitle: "Former Joint Commission Laboratory Surveyor",
        url: `${BASE_URL}/team`,
      },
      publisher: { "@id": `${BASE_URL}/#organization` },
      datePublished: "2026-03-01",
      dateModified: "2026-06-14",
      mainEntityOfPage: `${BASE_URL}/resources/clia-tea-what-lab-directors-dont-know`,
    },
    faqPageJsonLd(TEA_ARTICLE_FAQ),
    definedTermJsonLd(
      "CLIA Total Allowable Error (TEa)",
      "CLIA TEa (Total Allowable Error) is the maximum permissible difference between a laboratory's result and the target value for a given analyte, as defined in 42 CFR Part 493.",
      "/resources/clia-tea-what-lab-directors-dont-know",
    ),
    ],
  },
  "/resources/quality-control-testing-into-compliance": {
    title: "Out-of-Range QC: Investigate, Don't Repeat Into Compliance",
    description: "What to do when a control is out of range: investigate for an assignable cause, document the corrective action, and why repeating a control until it passes is testing into compliance. From a former laboratory surveyor.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "When Quality Control Stops Working: The Out-of-Range Result You Are Supposed to Investigate",
        description: "What to do when a control is out of range: investigate for an assignable cause, document the corrective action, and why repeating a control until it passes is testing into compliance.",
        image: `${BASE_URL}/og-image.png`,
        author: {
          "@type": "Person",
          name: "Michael Veri",
          jobTitle: "Former Joint Commission Laboratory Surveyor",
          url: `${BASE_URL}/team`,
        },
        publisher: { "@id": `${BASE_URL}/#organization` },
        datePublished: "2026-06-26",
        dateModified: "2026-06-26",
        mainEntityOfPage: `${BASE_URL}/resources/quality-control-testing-into-compliance`,
      },
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: "How to respond to an out-of-control quality control result",
        description: "The defensible response when a control falls outside the laboratory's acceptability limits: hold patient results, investigate for an assignable cause, correct and confirm, or treat an unexplained failure as a real signal.",
        step: [
          { "@type": "HowToStep", name: "Hold patient results", text: "Do not report patient results from the affected run." },
          { "@type": "HowToStep", name: "Investigate for an assignable cause", text: "Work a consistent checklist: control material integrity and expiration, reagent lot and expiration, calibration status, instrument maintenance and function, operator technique, and environmental conditions." },
          { "@type": "HowToStep", name: "Correct and confirm", text: "If an assignable cause is found and corrected, document the cause and the corrective action, then rerun controls to confirm the system is back in control before resuming patient testing." },
          { "@type": "HowToStep", name: "Treat an unexplained failure as a real signal", text: "If no assignable cause is found, do not keep repeating until a passing value appears. Move to broader troubleshooting, recalibration, or manufacturer support, and review patient results from the affected period as needed." },
        ],
      },
      faqPageJsonLd(QC_ARTICLE_FAQ),
      definedTermJsonLd(
        "Testing into compliance",
        "Testing into compliance is retesting or repeating a result until it falls within range without finding and documenting an assignable cause for the original failure. The standard was set in United States v. Barr Laboratories (1993).",
        "/resources/quality-control-testing-into-compliance",
      ),
      definedTermJsonLd(
        "Sigma metric",
        "A method's sigma metric is its total allowable error, minus bias, divided by imprecision. A higher sigma means a method needs less quality control to stay safe; a lower sigma needs multirule designs and tighter review.",
        "/resources/quality-control-testing-into-compliance",
      ),
      definedTermJsonLd(
        "Assignable cause",
        "An assignable cause is a specific, identifiable reason a control or test result fell outside expectations, such as a degraded control vial, a reagent or calibration problem, an instrument fault, an operator technique error, or an environmental condition.",
        "/resources/quality-control-testing-into-compliance",
      ),
    ],
  },
  "/resources/how-veritaassure-trains-lab-leaders": {
    title: "How VeritaAssure\u2122 Trains Lab Leaders | Veritas Lab Services",
    description: "How VeritaAssure\u2122 helps laboratory leaders build compliance knowledge and stay current with CLIA, Joint Commission, and COLA requirements.",
    jsonLd: articleJsonLd({
      headline: "How VeritaAssure\u2122 Trains the Next Generation of Lab Leaders",
      description: "How VeritaAssure\u2122 helps laboratory leaders build compliance knowledge and stay current with CLIA, Joint Commission, and COLA requirements.",
      articleBody: "Most lab directors learn compliance the hard way: the first time a surveyor walks in and asks for documentation they don't have. There is no formal curriculum for laboratory leadership. You earn a degree in laboratory science, pass your boards, work the bench for years, and then one day you are handed keys to a department with CLIA obligations, accreditation requirements, and a staff looking to you for direction. Nobody teaches you how to manage a calibration verification program. Nobody explains what a surveyor actually looks for when they pull your competency records. You figure it out, sometimes with the help of a mentor, sometimes the hard way. VeritaAssure\u2122 was built to change that. Each VeritaAssure\u2122 module teaches the regulatory framework it operates within, not just how to fill out forms. New directors can build institutional knowledge in their first 90 days using a structured five-module path. Health systems can use VeritaAssure\u2122 as a shared training environment across multiple labs and supervisors. Lab Management 101 (the book) and VeritaAssure\u2122 (the software) form a complete leadership curriculum. The documentation produced during training is real and audit-ready, not a separate exercise. Sections: The Gap Between Bench Competence and Leadership Competence; Why Software Can Teach; The Curriculum Nobody Offers; Lab Management 101 and the Full Picture; A Practical Development Path; Built for the Leaders Who Come Next.",
      path: "/resources/how-veritaassure-trains-lab-leaders",
      datePublished: "2026-04-25",
    }),
  },
  "/resources/calibration-verification-requirements-clia": {
    title: "Calibration Verification Requirements Under CLIA | Veritas Lab Services",
    description: "Detailed breakdown of CLIA calibration verification requirements including frequency, documentation, acceptable performance criteria, and common surveyor findings.",
    jsonLd: articleJsonLd({
      headline: "Calibration Verification Requirements Under CLIA: What Every Lab Director Needs to Know",
      description: "Detailed breakdown of CLIA calibration verification requirements including frequency, documentation, acceptable performance criteria, and common surveyor findings.",
      articleBody: "Calibration verification is one of the most consistently cited deficiencies in CLIA and CAP laboratory inspections. This article covers what the regulation requires and what your records need to show. Calibration verification must be performed at least every six months for all non-waived quantitative tests. Several events trigger out-of-cycle verification beyond the standard schedule. Documentation completeness is the most common inspection finding, not whether the verification was performed. VeritaCheck™ automates calculations, applies acceptance criteria, and generates inspector-ready PDF reports. Sections: What the Regulation Requires; When You Must Verify Beyond the Six-Month Cycle; What Analytes Require It; What Your Documentation Must Include; Common Inspection Findings; A More Efficient Approach.",
      path: "/resources/calibration-verification-requirements-clia",
      datePublished: "2026-04-25",
    }),
  },
  "/resources/how-to-perform-method-comparison-study": {
    title: "How to Perform a Method Comparison Study for CLIA | Veritas Lab Services",
    description: "Step-by-step guide to performing a CLIA-compliant method comparison study, including sample requirements, statistical analysis, and acceptable bias thresholds.",
    jsonLd: articleJsonLd({
      headline: "How to Perform a Method Comparison Study in Your Clinical Laboratory",
      description: "Step-by-step guide to performing a CLIA-compliant method comparison study, including sample requirements, statistical analysis, and acceptable bias thresholds.",
      articleBody: "A method comparison study, also called a Correlation study, is required whenever your laboratory implements a new test method, adds a new instrument that performs an existing test, or needs to demonstrate equivalence between two instruments running the same analyte. Done correctly, it provides documented evidence that the new method produces results comparable to your existing method across the full analytical range. Done incorrectly or incompletely, it is a finding waiting to appear on your CAP or TJC inspection report. Method comparison is required when placing a new analyzer into service, adding a new reagent system, or comparing two instruments. Use a minimum of 40 patient specimens spanning the full analytical measurement range. Define your acceptance criteria before running the study, not after. VeritaCheck™ handles regression calculations and generates an inspector-ready report automatically. Sections: When a Method Comparison Is Required; Specimen Requirements; Running the Study; What Pass or Fail Means; Common Mistakes; Documentation for Your Inspection File.",
      path: "/resources/how-to-perform-method-comparison-study",
      datePublished: "2026-04-25",
    }),
  },
  "/resources/tjc-laboratory-inspection-checklist-preparation": {
    title: "TJC Laboratory Inspection Checklist and Preparation Guide | Veritas Lab Services",
    description: "Prepare your clinical laboratory for a Joint Commission survey. Common findings, checklist items, and strategies from a former TJC laboratory surveyor.",
    jsonLd: articleJsonLd({
      headline: "Preparing for a TJC Laboratory Inspection: A Practical Checklist for Lab Directors",
      description: "Prepare your clinical laboratory for a Joint Commission survey. Common findings, checklist items, and strategies from a former TJC laboratory surveyor.",
      articleBody: "The laboratories that do well on TJC surveys are not the ones that scrambled the week before. They are the ones that maintain documentation continuously and can retrieve anything in under two minutes. A TJC laboratory survey does not begin with a checklist. It begins with a tracer, and the tracer starts at the patient. A surveyor follows a test result backward through your system: who ordered it, which analyzer ran it, what verification was on file for that analyzer, who performed the test, how their competency was documented, and where your proficiency testing record sits for that analyte. Every link in that chain either holds or does not. TJC surveys follow a tracer methodology, starting at the patient and working backward through your system. Five areas are traced most consistently: performance verification, proficiency testing, competency, instrument documentation, and procedures. Documentation is not paperwork, it is the evidence that your quality practices exist. Conduct a mock survey ninety days before your anticipated survey window. Sections: The Five Areas Surveyors Trace Most Consistently; How VeritaAssure™ Addresses Each Area; The 90-Day Rule.",
      path: "/resources/tjc-laboratory-inspection-checklist-preparation",
      datePublished: "2026-05-17",
    }),
  },
  "/resources/how-to-validate-veritacheck-clia": {
    title: "How to Validate VeritaCheck\u2122 for CLIA Compliance | Veritas Lab Services",
    description: "Software validation documentation for VeritaCheck\u2122 under CLIA requirements. How to validate laboratory information systems and comply with 42 CFR 493.1252.",
    jsonLd: articleJsonLd({
      headline: "How to Validate VeritaCheck\u2122 for Your Clinical Laboratory: A Step-by-Step Guide for Lab Directors",
      description: "Software validation documentation for VeritaCheck\u2122 under CLIA requirements. How to validate laboratory information systems and comply with 42 CFR 493.1252.",
      articleBody: "If you are preparing to use VeritaCheck\u2122 in your clinical laboratory, your first question should be: do we have a validation record on file? For most regulated labs, the answer needs to be yes before you run a single study through any software tool. The good news is that validating VeritaCheck\u2122 is straightforward, and most labs can complete it in under two hours. Software validation is required under CLIA 42 CFR 493.1251 and CAP checklist item COM.01300. The appropriate framework is IQ/OQ/PQ: Installation Qualification, Operational Qualification, Performance Qualification. Most labs complete the full process in under two hours. A free Software Validation Record template is available at veritaslabservices.com. Sections: Why Software Validation Is Required; What Validating VeritaCheck\u2122 Actually Means; Step-by-Step Validation Process; The Software Validation Template; How Long Does It Take?; What to Keep on File.",
      path: "/resources/how-to-validate-veritacheck-clia",
      datePublished: "2026-05-17",
    }),
  },
  "/resources/laboratory-inventory-management": {
    title: "Laboratory Inventory Management Best Practices | Veritas Lab Services",
    description: "Laboratory inventory management guide covering reagent tracking, expiration monitoring, and compliance documentation for CLIA and accreditation surveys.",
    jsonLd: articleJsonLd({
      headline: "Laboratory Inventory Management: Stop Guessing, Start Using the Math",
      description: "Laboratory inventory management guide covering reagent tracking, expiration monitoring, and compliance documentation for CLIA and accreditation surveys.",
      articleBody: "Most labs manage inventory by feel. They order when something looks low, stock extra because they are nervous, and scramble when a standing order misses a delivery. There is a better way - and the formulas are not complicated. The reorder point formula eliminates stockouts - it tells you exactly when to order, not when you feel like ordering. Burn rate is not static - it must be reviewed monthly or your reorder points become meaningless. Standing orders are a tool, not a strategy - they need quarterly review or they silently drift out of alignment. Safety stock is calculated, not guessed - 3 to 5 days covers most situations. Overstocking is not safe - it ties up budget and creates expiration risk. TJC and CLIA surveyors expect documented inventory processes - gut feel is not a documented process. Sections: Why This Is a Quality Issue, Not Just a Logistics Issue; The Core Concepts; The Reorder Point: When to Order; How Much to Order; Building the System: What Every Lab Needs; Quick Reference; Glossary.",
      path: "/resources/laboratory-inventory-management",
      datePublished: "2026-05-10",
    }),
  },
  "/resources/clia-tea-lookup": {
    title: "CLIA TEa Lookup Tool | Total Allowable Error by Analyte | Veritas Lab Services",
    description: "Look up total allowable error (TEa) limits by analyte for CLIA compliance. Reference values from CLIA proficiency testing criteria and RCPA quality specifications.",
  },
  "/calculator": {
    title: "VeritaBench\u2122 | Free Lab Productivity Scorecard | VeritaAssure\u2122",
    description: "Free VeritaBench\u2122 productivity tool. Enter monthly billable volume and paid hours to score your lab against community hospital, large trauma center, and reference lab peer benchmarks.",
  },
  "/veritabench": {
    title: "VeritaPace\u2122 | Monthly Lab Productivity Tracker | VeritaAssure\u2122",
    description: "Track monthly lab productivity with VeritaPace\u2122. Billable tests per paid hour benchmarking, FTE and overtime analysis, and peer comparisons. Included with VeritaAssure\u2122 Suite plans.",
  },
  "/veritabench/staffing": {
    title: "VeritaShift\u2122 | By-Hour Lab Staffing Analyzer | VeritaAssure\u2122",
    description: "Analyze by-hour staffing demand against actual coverage with VeritaShift\u2122. Identify overstaffed and understaffed periods in your clinical laboratory. Included with VeritaAssure\u2122 Suite plans.",
  },
  "/veritabench/pi": {
    title: "VeritaQA\u2122 | Lab Quality Metrics Dashboard | VeritaAssure\u2122",
    description: "Track department-level laboratory quality metrics with VeritaQA\u2122. Performance improvement dashboards aligned to TJC and CAP standards. Included with VeritaAssure\u2122 Suite plans.",
  },
  "/veritastock": {
    title: "VeritaStock\u2122 | Laboratory Inventory & Reagent Management | VeritaAssure\u2122",
    description: "Track reagent and supply inventory with burn rate calculations, automated par levels, and expiration alerts for your clinical laboratory. Included with VeritaAssure\u2122 Suite plans.",
  },
  "/veritatrack": {
    title: "VeritaTrack\u2122 | Laboratory QC Task Tracking & Sign-off | VeritaAssure\u2122",
    description: "Track recurring QC tasks, daily checks, maintenance, and quality sign-offs across your lab. Due-date alerts, full sign-off history, and Excel export. Included with VeritaAssure\u2122 Suite plans.",
  },
  "/veritatrack-app": {
    title: "VeritaTrack\u2122 App | QC Task Sign-off | VeritaAssure\u2122",
    description: "Recurring QC task tracking with sign-off, due-date alerts, and Excel export for your clinical laboratory.",
  },
  "/study-guide": {
    title: "Study Guide | VeritaAssure\u2122 Lab Compliance Software",
    description: "Comprehensive guide to running studies in VeritaAssure\u2122. Step-by-step instructions for performance verification, calibration verification, and EP studies.",
  },
  "/terms": {
    title: "Terms of Service | Veritas Lab Services",
    description: "Terms of service for Veritas Lab Services and the VeritaAssure\u2122 laboratory compliance software platform.",
  },
  "/privacy": {
    title: "Privacy Policy | Veritas Lab Services",
    description: "Privacy policy for Veritas Lab Services and the VeritaAssure\u2122 laboratory compliance software platform.",
  },
  "/trust": {
    title: "Trust & Security | Veritas Lab Services",
    description: "How VeritaAssure\u2122 protects your laboratory data: hosting, encryption, multi-lab isolation, PHI-free design, subprocessors, and HIPAA BAA availability.",
  },
  "/security": {
    title: "Trust & Security | Veritas Lab Services",
    description: "How VeritaAssure\u2122 protects your laboratory data: hosting, encryption, multi-lab isolation, PHI-free design, subprocessors, and HIPAA BAA availability.",
  },
  "/operations": {
    title: "Operations | VeritaAssure\u2122 Lab Productivity & CPRT",
    description: "VeritaOps\u2122 tools for lab operations: cost-per-reportable-test analytics, productivity benchmarking, by-hour staffing, monthly tracking, and quality metrics.",
  },
  "/book/scoping-call": {
    title: "Book a Scoping Call | Veritas Lab Services",
    description: "Schedule a 30-minute scoping call with Michael Veri to plan your VeritaAssure\u2122 rollout, accreditation timeline, or lab operations review.",
  },
  "/founding-lab/apply": {
    title: "Founding Lab Program Application | VeritaAssure\u2122",
    description: "Apply to the VeritaAssure\u2122 Founding Lab Program. Locked rate, annual at-will mutual renewal, priority support Year 1, and named recognition.",
  },
  "/demo/cprt": {
    title: "VeritaOps\u2122 CPRT Demo | Cost Per Reportable Test",
    description: "Interactive demo of the CPRT (Cost-Per-Reportable-Test) four-layer framework built on CLSI GP11-A. Lab director and CFO perspective in one workspace.",
  },
  "/demo/qc": {
    title: "VeritaQC\u2122 Demo | Westgard QC + Monthly Attestation",
    description: "Try the VeritaQC\u2122 demo. Westgard QC rules, monthly attestation, daily review queue, and director sign-off built for clinical laboratories.",
  },
  "/resources/manual-logs-why-most-labs-should-stop": {
    title: "Manual Logs: Why Most Labs Should Stop | Veritas Lab Services",
    description: "Most clinical labs still use paper or Excel logs for QC, maintenance, and competency. Why that fails CLIA, TJC, and CAP audits, and what to do instead.",
    jsonLd: articleJsonLd({
      headline: "Manual Logs: Why We Used Them, and Why Most Labs Should Stop",
      description: "Most clinical labs still use paper or Excel logs for QC, maintenance, and competency. Why that fails CLIA, TJC, and CAP audits, and what to do instead.",
      articleBody: "Manual logs are one of those things in the laboratory that everyone uses, nobody questions, and almost nobody could explain the original reason for. They are a fix for a problem most modern labs no longer have. Manual logs exist to solve a memory problem from an era when computers were scarce in the lab. Every time a result moves from the bench to a log to the computer, a new error mode is introduced: the transcription event. The 24-hour transcribed-result review requirement exists specifically to catch the errors the log itself creates. In a modern lab with a computer on every counter, direct entry from the analyzer to the LIS eliminates both the memory risk and the transcription risk. Removing the log removes the administrative review burden that comes with it. Sections: Why the manual log exists; The hidden cost of the log; What changed; What direct entry buys you; When the log still earns its place.",
      path: "/resources/manual-logs-why-most-labs-should-stop",
      datePublished: "2026-05-13",
    }),
  },
  "/resources/precision-verification-report-interpretation-guide": {
    title: "Interpret EP15 Precision Reports | Veritas Lab Services",
    description: "How to interpret EP15-A3 precision verification reports for CLIA compliance: SD, CV, total imprecision, and what surveyors look for in your documentation.",
    jsonLd: articleJsonLd({
      headline: "Precision Verification Report Interpretation Guide",
      description: "How to interpret EP15-A3 precision verification reports for CLIA compliance: SD, CV, total imprecision, and what surveyors look for in your documentation.",
      articleBody: "How to read every field, table, and chart on a VeritaCheck precision verification report, and how each one maps to 42 CFR §493 and CLSI EP15-A3. Sections: Why precision verification is required; What the simple precision study does; Statistical definitions; Advanced (EP15) mode and ANOVA components; Precision verification goal modes; Pass, Fail, and Uncertain; Reading the VeritaCheck report; References.",
      path: "/resources/precision-verification-report-interpretation-guide",
      datePublished: "2026-05-20",
    }),
  },
  "/resources/cost-per-reportable-test-four-layer-framework": {
    title: "CPRT Four-Layer Framework | Veritas Lab Services",
    description: "The CPRT four-layer framework (reagents, labor, equipment, overhead) built on CLSI GP11-A. How to use it for budget, capital, and contract negotiations.",
    jsonLd: articleJsonLd({
      headline: "What Your Tests Actually Cost: A Four-Layer CPRT Framework for Clinical Laboratories",
      description: "The CPRT four-layer framework (reagents, labor, equipment, overhead) built on CLSI GP11-A. How to use it for budget, capital, and contract negotiations.",
      articleBody: "The CLSI GP11-A four-layer framework for cost-per-reportable-test, which question each layer answers, the discipline required to compare two configurations honestly, and the moves a laboratory director can make this quarter. In twenty-three years of clinical laboratory work and more than two hundred surveys with The Joint Commission, the single most common pattern I have seen at the intersection of the lab director's office and the CFO's office is this. When finance asks what a test costs, the laboratory gives a number that does not match the question being asked. The number is usually right. The question being answered is the wrong one. The decision that follows is made on a wrong premise. The clinical laboratory industry has had a defensible framework for cost-per-reportable-test (CPRT) since the late 1990s, in the form of NCCLS document GP11-A, later continued under CLSI. The framework separates the cost of a single reportable result into four layers, each of which answers a different financial question. The framework is conceptually unchanged in the years since. It is also rarely operationalized inside the laboratories that need it most. This article walks through the four layers, the question each one answers, the discipline required to compare two configurations honestly, and the specific operational moves a laboratory director can make this quarter to put the framework in front of a finance team. Sections: 1. Why most laboratories cannot answer the cost question well; 2. The four-layer model from CLSI GP11-A; 3. Matching the layer to the question; 4. Worked example: sodium under two configurations; 5. What to do this quarter; 6. The CLIA context; 7. Closing: VeritaOps™ and the next step.",
      path: "/resources/cost-per-reportable-test-four-layer-framework",
      datePublished: "2026-05-28",
    }),
  },
  "/resources/why-veritacheck-vs-legacy-verification": {
    title: "VeritaCheck\u2122 vs Legacy Verification | Veritas Lab Services",
    description: "How VeritaCheck\u2122 improves on legacy EP15, EP9, calibration verification, and method comparison workflows. CLIA-compliant PDF output, director sign-off.",
    jsonLd: articleJsonLd({
      headline: "Why VeritaCheck\u2122 vs. Legacy Verification Software",
      description: "How VeritaCheck\u2122 improves on legacy EP15, EP9, calibration verification, and method comparison workflows. CLIA-compliant PDF output, director sign-off.",
      articleBody: "A side-by-side comparison authored for lab directors evaluating a tool change. Four dimensions: cost, time-to-first-study, integration breadth, and compliance defensibility. Most clinical laboratories that run method verification studies today use a legacy desktop verification tool that has been the de facto standard for the better part of two decades. The tool works. It is also priced for an era before browser-based clinical software, structured to assume a single Windows workstation, and integrated only with itself. VeritaCheck\u2122 is a browser-based alternative that produces the same verification studies under the same CLSI EP standards, at a cost that is closer to a consumer SaaS subscription than a per-seat enterprise license, integrated into a broader VeritaAssure\u2122 platform that handles policy, mapping, competency, lab certificates, and cost-per-reportable-test in one login. This page lays out the four dimensions a lab director should compare before switching. Sections: When to switch.",
      path: "/resources/why-veritacheck-vs-legacy-verification",
      datePublished: "2026-06-14",
    }),
  },
};

// AI answer engines and Google read Article.articleBody as the article's body
// text. Our Article nodes carried headline + description but no articleBody, so
// the substance sat only in the sibling FAQPage/HowTo nodes. This pass composes
// an articleBody for every Article node from its own description plus the Q&A and
// step text already present on the same page (imported verbatim from faqContent),
// so the body signal is faithful to the rendered page with zero drift.
function enrichArticleBodies(map: Record<string, SEOMetadata>): void {
  for (const meta of Object.values(map)) {
    const blocks = Array.isArray(meta.jsonLd) ? meta.jsonLd : meta.jsonLd ? [meta.jsonLd] : [];
    const article = blocks.find((b) => (b as any)?.["@type"] === "Article") as any;
    if (!article || article.articleBody) continue;
    const parts: string[] = [];
    if (typeof article.description === "string") parts.push(article.description);
    const faq = blocks.find((b) => (b as any)?.["@type"] === "FAQPage") as any;
    if (faq && Array.isArray(faq.mainEntity)) {
      for (const q of faq.mainEntity) {
        if (q?.name && q?.acceptedAnswer?.text) parts.push(`${q.name} ${q.acceptedAnswer.text}`);
      }
    }
    const howto = blocks.find((b) => (b as any)?.["@type"] === "HowTo") as any;
    if (howto && Array.isArray(howto.step)) {
      for (const s of howto.step) {
        // Take BOTH halves. A HowToStep's `name` is a short label ("Test twenty
        // reference individuals") and its `text` is the actual instruction. The
        // prior `name || text` took the label and discarded the instruction on
        // every step that had a name, which is every step we author, so the
        // substantive half of every HowTo never reached articleBody.
        const name = s?.name ? String(s.name) : "";
        const text = s?.text ? String(s.text) : "";
        if (name) parts.push(name);
        if (text && text !== name) parts.push(text);
      }
    }
    const body = parts.join(" ").replace(/\s+/g, " ").trim();
    if (body) article.articleBody = body;
  }
}
// HowTo nodes composed from the approved FAQ text for the routes that warrant a
// procedural block. Modeled on the EP26 HowTo shape.
const methodComparisonHowTo: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to perform a method comparison study in a clinical laboratory",
  description: "Running a correlation and method comparison study under CLSI EP09-A3 and interpreting the result against total allowable error.",
  step: [
    { "@type": "HowToStep", name: "Confirm a study is required", text: "Run a method comparison when placing a new analyzer into service, adding a new reagent system for an existing test, or demonstrating that two instruments running the same analyte produce equivalent results." },
    { "@type": "HowToStep", name: "Collect the specimens", text: "Use a minimum of 40 patient specimens spanning the full analytical measurement range, deliberately collected at low, mid, and high concentrations. Fresh patient samples reflect the actual matrix; QC materials do not." },
    { "@type": "HowToStep", name: "Set acceptance criteria in advance", text: "Define acceptable limits for slope, intercept, and bias before running the study, with bias at medical decision points within total allowable error." },
    { "@type": "HowToStep", name: "Run both methods and calculate the statistics", text: "Test each specimen on both methods and calculate slope, y-intercept, Pearson correlation coefficient, and bias at decision points using Deming or Passing-Bablok regression, which accounts for error in both methods." },
    { "@type": "HowToStep", name: "Determine pass or fail and document", text: "Compare the results to the pre-defined criteria, record the determination for the inspection file, and have the medical director or designee review it. CLSI EP09-A3 is the reference protocol." },
  ],
};
const tjcSurveyHowTo: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to prepare for a Joint Commission laboratory survey",
  description: "Preparing a clinical laboratory for a TJC tracer survey by maintaining documentation continuously and running a mock survey.",
  step: [
    { "@type": "HowToStep", name: "Maintain documentation continuously", text: "Keep records current as work happens rather than assembling them before a survey. Without a record, a surveyor cannot distinguish a compliant laboratory from a non-compliant one." },
    { "@type": "HowToStep", name: "Make every record retrievable in under two minutes", text: "Organize performance verification, proficiency testing, competency, test menu and instrument documentation, and current approved procedures so any one can be produced quickly." },
    { "@type": "HowToStep", name: "Run a mock survey about ninety days out", text: "Trace a patient result backward through your own documentation about ninety days before the anticipated survey window." },
    { "@type": "HowToStep", name: "Correct gaps before they become findings", text: "Fix anything the mock survey surfaces while there is still time, so it does not appear on the official report." },
  ],
};
const cprtHowTo: Record<string, unknown> = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "How to apply the four-layer cost-per-reportable-test framework",
  description: "Building cost per reportable test in four layers under CLSI GP11-A and matching each layer to the financial decision it answers.",
  step: [
    { "@type": "HowToStep", name: "Build Layer 1", text: "Total the reagents and supplies consumed per reportable result." },
    { "@type": "HowToStep", name: "Add Layer 2 for insource versus send-out", text: "Add direct labor to reagents and supplies when the analyzer is already on the floor; this is usually the layer for an insource versus send-out decision." },
    { "@type": "HowToStep", name: "Add Layer 3 to justify a new analyzer", text: "Add equipment depreciation and maintenance across projected volume when justifying a capital purchase." },
    { "@type": "HowToStep", name: "Add Layer 4 to set a price", text: "Add overhead for the fully loaded cost when setting a charge-master price. 42 CFR §493.1407 and §493.1445 make the laboratory director responsible for defending these decisions." },
  ],
};

// Resource routes whose visible FAQ (rendered from faqContent.ts) should also
// emit FAQPage JSON-LD, plus any DefinedTerm/HowTo nodes for that route.
const ROUTE_FAQ: Record<string, FaqQA[]> = {
  "/resources/clia-tea-lookup": TEA_LOOKUP_FAQ,
  "/resources/calibration-verification-requirements-clia": CALVER_REQ_FAQ,
  "/resources/how-to-perform-method-comparison-study": METHODCOMP_FAQ,
  "/resources/precision-verification-report-interpretation-guide": PRECISION_FAQ,
  "/resources/tjc-laboratory-inspection-checklist-preparation": TJC_INSPECTION_FAQ,
  "/resources/cost-per-reportable-test-four-layer-framework": CPRT_FAQ,
  "/resources/manual-logs-why-most-labs-should-stop": MANUAL_LOGS_FAQ,
};

const ROUTE_EXTRA_JSONLD: Record<string, Record<string, unknown>[]> = {
  "/resources/calibration-verification-requirements-clia": [
    definedTermJsonLd(
      "Calibration verification",
      "Calibration verification is the CLIA process of confirming that an instrument's calibration has not drifted, by testing materials of known value across the reportable range. It is required at least every six months for each non-waived quantitative test system under 42 CFR §493.1255.",
      "/resources/calibration-verification-requirements-clia",
    ),
  ],
  "/resources/how-to-perform-method-comparison-study": [methodComparisonHowTo],
  "/resources/precision-verification-report-interpretation-guide": [
    definedTermJsonLd(
      "Coefficient of variation",
      "The coefficient of variation (CV) is the standard deviation expressed as a percent of the mean, CV = (SD / mean) x 100. It expresses imprecision on a common scale so a laboratory can compare it across analytes and concentration levels.",
      "/resources/precision-verification-report-interpretation-guide",
    ),
  ],
  "/resources/tjc-laboratory-inspection-checklist-preparation": [
    tjcSurveyHowTo,
    definedTermJsonLd(
      "Tracer methodology",
      "Tracer methodology is the survey technique in which a surveyor starts at a single patient result and works backward through the system that produced it: who ordered it, which analyzer ran it, its verification records, who performed it, their competency, and the proficiency testing record for that analyte.",
      "/resources/tjc-laboratory-inspection-checklist-preparation",
    ),
  ],
  "/resources/cost-per-reportable-test-four-layer-framework": [
    definedTermJsonLd(
      "Cost per reportable test",
      "Cost per reportable test (CPRT) is the fully-considered cost of producing one reportable laboratory result, built up in four layers under the CLSI GP11-A framework: reagents and supplies, direct labor, equipment, and overhead.",
      "/resources/cost-per-reportable-test-four-layer-framework",
    ),
    cprtHowTo,
  ],
  "/resources/manual-logs-why-most-labs-should-stop": [
    definedTermJsonLd(
      "Transcription event",
      "A transcription event is the manual copying of a result from a bench log into the laboratory information system. It is an error mode that exists only because the intermediate log exists, and direct analyzer-to-LIS entry eliminates it.",
      "/resources/manual-logs-why-most-labs-should-stop",
    ),
  ],
};

// Attach FAQPage (+ DefinedTerm/HowTo) nodes to each resource route that carries
// a visible FAQ. Normalizes a lone Article object into an array. Idempotent:
// skips a route that already has a FAQPage node.
function attachRouteFaqAndTerms(map: Record<string, SEOMetadata>): void {
  for (const [route, faq] of Object.entries(ROUTE_FAQ)) {
    const meta = map[route];
    if (!meta) continue;
    const blocks: Record<string, unknown>[] = Array.isArray(meta.jsonLd)
      ? meta.jsonLd
      : meta.jsonLd
        ? [meta.jsonLd]
        : [];
    if (!blocks.some((b) => (b as Record<string, unknown>)?.["@type"] === "FAQPage")) {
      blocks.push(faqPageJsonLd(faq));
    }
    for (const extra of ROUTE_EXTRA_JSONLD[route] ?? []) blocks.push(extra);
    meta.jsonLd = blocks;
  }
}

attachRouteFaqAndTerms(seoMetadataMap);
enrichArticleBodies(seoMetadataMap);

export function getBaseUrl(): string {
  return BASE_URL;
}
