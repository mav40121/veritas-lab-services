export interface SEOMetadata {
  title: string;
  description: string;
}

const BASE_URL = "https://www.veritaslabservices.com";

export const seoMetadataMap: Record<string, SEOMetadata> = {
  "/": {
    title: "Veritas Lab Services | Clinical Laboratory Compliance Software",
    description: "VeritaAssure is the all-in-one compliance platform for clinical laboratories. Method validation, inspection readiness, PT gap analysis, competency tracking, and more.",
  },
  "/veritaassure": {
    title: "VeritaAssure | Lab Compliance Software Suite for Clinical Laboratories",
    description: "The complete laboratory compliance platform. VeritaCheck, VeritaMap, VeritaScan, VeritaTrack, VeritaPolicy, and more - built by a lab professional who conducted 200+ Joint Commission surveys.",
  },
  "/pricing": {
    title: "Pricing | VeritaAssure Lab Compliance Software",
    description: "Simple annual pricing for clinical laboratory compliance software. Plans for individual labs, community hospitals, regional hospitals, and enterprise health systems.",
  },
  "/services": {
    title: "Services | Veritas Lab Services Laboratory Consulting",
    description: "Laboratory consulting services including compliance assessments, accreditation preparation, method validation support, and staff education by Michael Veri, MLS(ASCP), CPHQ.",
  },
  "/contact": {
    title: "Contact | Veritas Lab Services",
    description: "Get in touch with Veritas Lab Services. Questions about VeritaAssure, laboratory consulting, or scheduling a demo.",
  },
  "/team": {
    title: "Our Team | Veritas Lab Services",
    description: "Meet Michael Veri, MS, MBA, MLS(ASCP), CPHQ - laboratory compliance expert, former Joint Commission surveyor, and founder of Veritas Lab Services.",
  },
  "/faq": {
    title: "FAQ | VeritaAssure Lab Compliance Software",
    description: "Frequently asked questions about VeritaAssure, CLIA compliance software, method validation, and laboratory inspection readiness tools.",
  },
  "/getting-started": {
    title: "Getting Started | VeritaAssure Lab Compliance Software",
    description: "Get started with VeritaAssure. Follow the step-by-step onboarding guide to set up your laboratory compliance platform.",
  },
  "/book": {
    title: "Book a Consultation | Veritas Lab Services",
    description: "Schedule a consultation or demo with Michael Veri. Learn how VeritaAssure can help your laboratory stay compliant and survey-ready.",
  },
  "/demo": {
    title: "VeritaOps\u2122 Demo - Lab Productivity & Staffing Tools | VeritaAssure\u2122",
    description: "See VeritaOps\u2122 in action. Interactive productivity calculator, monthly tracking, and by-hour staffing analysis built for clinical laboratories.",
  },
  "/demo-lab": {
    title: "Demo | VeritaAssure Lab Compliance Software",
    description: "Try the VeritaAssure demo lab. Explore VeritaCheck method validation, VeritaScan inspection readiness, and the full compliance suite.",
  },
  "/roadmap": {
    title: "Product Roadmap | VeritaAssure Lab Compliance Software",
    description: "See what is coming next for VeritaAssure. Upcoming features for clinical laboratory compliance, quality management, and accreditation readiness.",
  },
  "/veritacheck": {
    title: "VeritaCheck | CLIA Method Validation Software for Clinical Labs",
    description: "Run EP studies for accuracy, precision, reportable range, and reference ranges. Generates director-signed, survey-ready verification documentation.",
  },
  "/veritascan": {
    title: "VeritaScan | Laboratory Inspection Readiness Checklist Software",
    description: "168-item TJC-standard inspection checklist for clinical laboratories. Track your readiness, identify gaps, and walk into every survey prepared.",
  },
  "/veritamap": {
    title: "VeritaMap | Clinical Laboratory Test Menu Mapping Software",
    description: "Map your complete laboratory test menu with instrument assignments, reference ranges, and critical values. Built for CLIA compliance and accreditation surveys.",
  },
  "/veritacomp": {
    title: "VeritaComp | Laboratory Competency Assessment Software",
    description: "Manage the six CLIA competency elements for every lab employee. Track assessments, generate PDF documentation, and stay survey-ready year-round.",
  },
  "/veritastaff": {
    title: "VeritaStaff | Laboratory Staff Roster and HR Compliance Software",
    description: "Maintain your laboratory staff roster with credentials, training records, and compliance tracking. Stay organized for Joint Commission and CLIA surveys.",
  },
  "/veritapt": {
    title: "VeritaPT | Proficiency Testing Gap Analyzer for Clinical Labs",
    description: "Identify PT coverage gaps in your laboratory test menu. Ensure every analyte has a proficiency testing program and stay compliant with CLIA PT requirements.",
  },
  "/veritalab": {
    title: "VeritaLab | Laboratory Certificate and Document Storage Software",
    description: "Centralized storage for laboratory accreditation certificates, licenses, and compliance documents. Never scramble for paperwork during a survey again.",
  },
  "/veritapolicy": {
    title: "VeritaPolicy | Laboratory Policy and Procedure Management Software",
    description: "Version-controlled policy and procedure management for clinical laboratories. Track staff acknowledgments, manage document review cycles, and stay survey-ready.",
  },
  "/resources": {
    title: "Resources | CLIA Compliance Guides for Clinical Laboratories",
    description: "Free guides and articles on CLIA compliance, method validation, calibration verification, proficiency testing, and laboratory inspection preparation.",
  },
  "/resources/clia-calibration-verification-method-comparison": {
    title: "CLIA Calibration Verification and Method Comparison Guide | Veritas Lab Services",
    description: "A complete guide to CLIA calibration verification and method comparison requirements for clinical laboratories, including documentation and frequency requirements.",
  },
  "/resources/clia-tea-what-lab-directors-dont-know": {
    title: "CLIA Total Allowable Error: What Lab Directors Don't Know | Veritas Lab Services",
    description: "Understanding total allowable error (TEa) in CLIA compliance. How to apply TEa to method validation studies and what surveyors look for in your documentation.",
  },
  "/resources/how-veritaassure-trains-lab-leaders": {
    title: "How VeritaAssure Trains Lab Leaders | Veritas Lab Services",
    description: "How VeritaAssure helps laboratory leaders build compliance knowledge and stay current with CLIA, Joint Commission, and COLA requirements.",
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
    title: "How to Validate VeritaCheck for CLIA Compliance | Veritas Lab Services",
    description: "Software validation documentation for VeritaCheck under CLIA requirements. How to validate laboratory information systems and comply with 42 CFR 493.1252.",
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
    title: "Lab Productivity Calculator | VeritaOps Free Benchmarking Tool",
    description: "Instantly benchmark your clinical laboratory's productivity ratio against industry standards. Enter two numbers to get a free scorecard with savings projections.",
  },
  "/study-guide": {
    title: "Study Guide | VeritaAssure Lab Compliance Software",
    description: "Comprehensive guide to running studies in VeritaAssure. Step-by-step instructions for method validation, calibration verification, and EP studies.",
  },
  "/terms": {
    title: "Terms of Service | Veritas Lab Services",
    description: "Terms of service for Veritas Lab Services and the VeritaAssure laboratory compliance software platform.",
  },
  "/privacy": {
    title: "Privacy Policy | Veritas Lab Services",
    description: "Privacy policy for Veritas Lab Services and the VeritaAssure laboratory compliance software platform.",
  },
};

export function getBaseUrl(): string {
  return BASE_URL;
}
