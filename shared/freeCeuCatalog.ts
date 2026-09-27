// shared/freeCeuCatalog.ts
//
// Curated catalog of NO-COST continuing-education sources for clinical
// laboratory professionals, surfaced inside the VeritaCEU tracker so a user who
// still owes credits can find legitimate free ways to earn them.
//
// PROVENANCE (non-negotiable): every URL here is a real provider page that was
// fetched and confirmed to offer free CE for lab professionals on the date in
// FREE_CEU_VERIFIED. No link is invented, guessed, or auto-completed. When a
// link is added or changed, it must be verified live first and the date bumped.
// scripts/verify-free-ceu-catalog.mts enforces the structural guards (https,
// real host, no placeholders, non-empty fields).

export interface FreeCeuProvider {
  /** Provider / program name as it appears to the user. */
  name: string;
  /** Canonical https provider CE page. Verified live; never a hash route or localhost. */
  url: string;
  /** Credit systems the provider is approved to award (as the provider states). */
  creditTypes: string[];
  /** One or two sentences on what the provider offers. Public-facing: no em dashes. */
  description: string;
  /** How the "free" works, including any honest caveat. */
  access: string;
}

/** Date the URLs and free-CE claims below were last verified live. */
export const FREE_CEU_VERIFIED = "2026-09-26";

export const FREE_CEU_CATALOG: FreeCeuProvider[] = [
  {
    name: "CDC OneLab REACH",
    url: "https://reach.cdc.gov/continuing-education-pace",
    creditTypes: ["P.A.C.E.®"],
    description:
      "The CDC Division of Laboratory Systems training hub. On-demand eLearning, job aids, and webinars covering specimen handling, biosafety, quality, and testing readiness.",
    access: "Free. Register for a OneLab REACH account at no cost, then claim P.A.C.E. credit on completed courses.",
  },
  {
    name: "ARUP Laboratories Education",
    url: "https://www.aruplab.com/education",
    creditTypes: ["CME", "P.A.C.E.®", "Florida"],
    description:
      "On-demand courses and webinars authored by ARUP medical directors across chemistry, hematology, microbiology, and molecular testing.",
    access: "Free. ARUP provides these credits to laboratory professionals at no cost.",
  },
  {
    name: "Labroots",
    url: "https://www.labroots.com/continuing-education",
    creditTypes: ["P.A.C.E.®", "Florida"],
    description:
      "Live and on-demand science and laboratory webinars from an ASCLS-approved P.A.C.E. provider running roughly 1,800 sessions a year.",
    access: "Free. Create an account and attend a webinar to claim the credit for that session.",
  },
  {
    name: "American Proficiency Institute",
    url: "https://api-pt.com/continuing-education",
    creditTypes: ["CME", "CMLE"],
    description:
      "Self-assessment CE activities tied to proficiency-testing events, offered through an arrangement with ASCP.",
    access: "Free for laboratories already enrolled in API proficiency testing: up to 20 credits per year.",
  },
];
