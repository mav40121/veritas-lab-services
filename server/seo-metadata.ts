import {
  TEA_ARTICLE_FAQ,
  CALVER_ARTICLE_FAQ,
  EP26_ARTICLE_FAQ,
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
    title: "VeritaCheck\u2122 | CLIA Performance Verification Software for Clinical Labs",
    description: "Run EP studies for accuracy, precision, reportable range, and reference ranges. Generates director-signed, survey-ready verification documentation.",
  },
  "/veritascan": {
    title: "VeritaScan™ | Laboratory Inspection Readiness Checklist Software",
    description: "168-item TJC-standard inspection checklist for clinical laboratories. Track your readiness, identify gaps, and walk into every survey prepared.",
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
      faqPageJsonLd(CALVER_ARTICLE_FAQ),
      definedTermJsonLd(
        "Calibration Verification",
        "Calibration verification is an accuracy study: it measures correctness, not consistency.",
        "/resources/clia-calibration-verification-method-comparison",
      ),
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
    title: "CLIA Total Allowable Error (TEa): 42 CFR §493 Guide",
    description: "2025 CLIA total allowable error (TEa) values for chemistry, hematology, toxicology, and immunology, with 42 CFR §493 citations.",
    jsonLd: [{
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "CLIA Allowable Error (TEa): What It Is, Where to Find It, and Why Most Lab Directors Don't Know About It",
      description: "2025 CLIA total allowable error (TEa) values for chemistry, hematology, toxicology, and immunology, with 42 CFR §493 citations.",
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
  "/resources/how-veritaassure-trains-lab-leaders": {
    title: "How VeritaAssure\u2122 Trains Lab Leaders | Veritas Lab Services",
    description: "How VeritaAssure\u2122 helps laboratory leaders build compliance knowledge and stay current with CLIA, Joint Commission, and COLA requirements.",
  },
  "/resources/calibration-verification-requirements-clia": {
    title: "Calibration Verification Requirements Under CLIA | Veritas Lab Services",
    description: "Detailed breakdown of CLIA calibration verification requirements including frequency, documentation, acceptable performance criteria, and common surveyor findings.",
  },
  "/resources/how-to-perform-method-comparison-study": {
    title: "How to Perform a Method Comparison Study for CLIA | Veritas Lab Services",
    description: "Step-by-step guide to performing a CLIA-compliant method comparison study, including sample requirements, statistical analysis, and acceptable bias thresholds.",
  },
  "/resources/tjc-laboratory-inspection-checklist-preparation": {
    title: "TJC Laboratory Inspection Checklist and Preparation Guide | Veritas Lab Services",
    description: "Prepare your clinical laboratory for a Joint Commission survey. Common findings, checklist items, and strategies from a former TJC laboratory surveyor.",
  },
  "/resources/how-to-validate-veritacheck-clia": {
    title: "How to Validate VeritaCheck\u2122 for CLIA Compliance | Veritas Lab Services",
    description: "Software validation documentation for VeritaCheck\u2122 under CLIA requirements. How to validate laboratory information systems and comply with 42 CFR 493.1252.",
  },
  "/resources/laboratory-inventory-management": {
    title: "Laboratory Inventory Management Best Practices | Veritas Lab Services",
    description: "Laboratory inventory management guide covering reagent tracking, expiration monitoring, and compliance documentation for CLIA and accreditation surveys.",
  },
  "/resources/clia-tea-lookup": {
    title: "CLIA TEa Lookup Tool | Total Allowable Error by Analyte | Veritas Lab Services",
    description: "Look up total allowable error (TEa) limits by analyte for CLIA compliance. Reference values from CLIA proficiency testing criteria and RCPA quality specifications.",
  },
  "/calculator": {
    title: "VeritaBench\u2122 | Free Lab Productivity Scorecard | VeritaAssure\u2122",
    description: "Free VeritaBench\u2122 benchmarking tool. Enter monthly billable volume and paid hours to instantly score your lab's productivity against Clinic, Community, and Hospital peer groups.",
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
  },
  "/resources/precision-verification-report-interpretation-guide": {
    title: "Interpret EP15 Precision Reports | Veritas Lab Services",
    description: "How to interpret EP15-A3 precision verification reports for CLIA compliance: SD, CV, total imprecision, and what surveyors look for in your documentation.",
  },
  "/resources/cost-per-reportable-test-four-layer-framework": {
    title: "CPRT Four-Layer Framework | Veritas Lab Services",
    description: "The CPRT four-layer framework (reagents, labor, equipment, overhead) built on CLSI GP11-A. How to use it for budget, capital, and contract negotiations.",
  },
  "/resources/why-veritacheck-vs-legacy-verification": {
    title: "VeritaCheck\u2122 vs Legacy Verification | Veritas Lab Services",
    description: "How VeritaCheck\u2122 improves on legacy EP15, EP9, calibration verification, and method comparison workflows. CLIA-compliant PDF output, director sign-off.",
  },
};

export function getBaseUrl(): string {
  return BASE_URL;
}
