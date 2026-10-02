// Free continuing-education (CE) provider directory for VeritaCEU (parking-lot #55/#53).
//
// A curated "where to find free CE" reference for medical laboratory professionals,
// so a tech who is short on their cycle can act. Seeded from the list Jennifer Small
// (Lifepoint Health) sent Michael (2026-09-25) and verified against each provider's
// current CE page (2026-10-02). This is a starter directory, not exhaustive; many
// more vendors and societies offer free P.A.C.E. CE. All entries below were free at
// verification; vendor and PT offerings can change and some are gated (noted per row).
//
// Static reference content (not per-lab data), so it lives in a TS module like
// veritaScanData.ts rather than the database.

export type CeCategory =
  | "Society & publication"
  | "Government"
  | "Reference laboratory"
  | "Diagnostics vendor"
  | "Proficiency testing"
  | "Webinar aggregator";

export const CE_CATEGORY_ORDER: CeCategory[] = [
  "Society & publication",
  "Government",
  "Reference laboratory",
  "Diagnostics vendor",
  "Proficiency testing",
  "Webinar aggregator",
];

export interface CeProvider {
  name: string;
  url: string;
  category: CeCategory;
  description: string;
  // Optional access caveat (e.g. must be a customer). Omitted when openly free.
  note?: string;
}

export const FREE_CE_PROVIDERS: CeProvider[] = [
  {
    name: "ADLM Learning Lab (formerly AACC)",
    url: "https://myadlm.org/education/learning-lab",
    category: "Society & publication",
    description: "Complimentary subscription with 80+ Medical Laboratory Specialist courses across laboratory medicine; ACCENT continuing-education credit.",
  },
  {
    name: "MLO Continuing Education",
    url: "https://ce.mlo-online.com/",
    category: "Society & publication",
    description: "Medical Laboratory Observer CE: P.A.C.E.-approved online articles and webinars, with new content added monthly. Some CE is free; some tests carry a fee.",
  },
  {
    name: "LabRoots",
    url: "https://www.labroots.com/continuing-education",
    category: "Society & publication",
    description: "Free P.A.C.E.-accredited webinars and virtual events, up to 1 CE per presentation.",
  },
  {
    name: "CDC OneLab REACH",
    url: "https://reach.cdc.gov/",
    category: "Government",
    description: "Free CDC e-learning, job aids, and P.A.C.E. contact hours for the laboratory workforce (quality, safety, core science, preparedness).",
  },
  {
    name: "ARUP Laboratories Education",
    url: "https://www.aruplab.com/education",
    category: "Reference laboratory",
    description: "400+ free video lectures, webinars, and podcasts offering P.A.C.E., CME, and Florida CE at no cost.",
  },
  {
    name: "Bio-Rad Learning Center",
    url: "https://www.bio-rad.com/en-us/r/lc",
    category: "Diagnostics vendor",
    description: "Free P.A.C.E. QC workbooks and clinical webinars (QCLive training, Clinical Immunology Learning Center).",
  },
  {
    name: "Abbott Core Laboratory Knowledge Center",
    url: "https://www.corelaboratory.abbott/int/en/knowledge-center.html",
    category: "Diagnostics vendor",
    description: "Free P.A.C.E. lectures and webinars for laboratory professionals across clinical chemistry, immunoassay, and hematology.",
  },
  {
    name: "Siemens Healthineers Academy (PEPconnect)",
    url: "https://www.siemens-healthineers.com/en-us/education/digital-learning-applications-overview/pepconnect",
    category: "Diagnostics vendor",
    description: "Free laboratory-diagnostics courses and webinars; ASCLS P.A.C.E. provider.",
  },
  {
    name: "Cardinal Health Lab Briefings",
    url: "https://www.cardinalhealth.com/en/medical-affairs/medical-products/continuing-education/laboratory-products.html",
    category: "Diagnostics vendor",
    description: "Free P.A.C.E. webinar series on diagnostics, lab compliance, and reimbursement; live and on-demand.",
  },
  {
    name: "Cepheid Webinars",
    url: "https://www.cepheid.com/en-US/insights/webinars/featured-webinars.html",
    category: "Diagnostics vendor",
    description: "Free on-demand P.A.C.E. webinars on molecular and infectious-disease testing (1 credit each).",
  },
  {
    name: "Fisher Healthcare Webinars",
    url: "https://www.fishersci.com/us/en/healthcare-products/webinars.html",
    category: "Diagnostics vendor",
    description: "Free complimentary clinical webinars offering a P.A.C.E. contact hour; archived recordings available.",
  },
  {
    name: "American Proficiency Institute (API)",
    url: "https://api-pt.com/continuing-education",
    category: "Proficiency testing",
    description: "Free CE tied to API's proficiency-testing program, with educational commentaries on each survey.",
    note: "Free CE account requires your facility to order proficiency testing from API.",
  },
  {
    name: "Whitehat Webinars (Whitehat Communications)",
    url: "https://www.whitehatwebinars.com/",
    category: "Webinar aggregator",
    description: "Free, vendor-funded P.A.C.E. webinars that aggregate many diagnostics vendors in one place (Bio-Rad, Siemens, Cardinal Health, Abbott, Polymedco, and more).",
  },
];

// Tip surfaced in the UI: several paid societies (ASCP and similar) release a free
// CE around Lab Week each spring. Kept as guidance, not a directory row, because the
// free window is intermittent.
export const FREE_CE_TIP =
  "Tip: paid societies such as ASCP often release a free CE or two around Lab Week each spring. This is a starter list; many more vendors and societies offer free P.A.C.E. CE.";
