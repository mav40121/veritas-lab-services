// shared/termsOfUse.ts
//
// The VeritaAssure(R) Terms of Use and Confidentiality Agreement (Michael 2026-11-03, Q141 = 1): one versioned text that
// the public /terms page shows and every user accepts, with their typed name, before using the Service
// (server/termsOfUse.ts records it; client/src/components/TermsAcceptance.tsx asks for it). A lab owner's acceptance
// also binds the organization that holds the account. A signed customer agreement controls where it conflicts.
//
// Changing ANY word here means a new TERMS_VERSION: the server stores a hash of this text with each acceptance, and a
// new version is only asked of users after an admin activates it (POST /api/admin/terms/activate).
// Public-facing copy: no em dashes; registered marks per script/audit.py.

// Revision 2 (VLS Legal review 2026-11-03, VLS_Legal_Review_Terms_of_Use_2026-11-03.md): section 8(a) defines
// "competitor"; section 10 keeps the lab's data, including the data in its reports, the lab's; section 13 moves the
// indemnity from every individual user to the account holder, for third-party claims from use in violation.
export const TERMS_VERSION = "2026-11-03.2";
export const TERMS_TITLE = "Terms of Use and Confidentiality Agreement";
export const TERMS_VERSION_LABEL = "Version of November 3, 2026 (revision 2)";

export type TermsSection = { title: string; paragraphs: string[] };

export const TERMS_SECTIONS: TermsSection[] = [
  {
    title: "1. Agreement",
    paragraphs: [
      "These Terms of Use and Confidentiality Agreement (the \"Terms\") are between Veritas Lab Services, LLC (\"Veritas\", \"we\" or \"us\") and you. You accept them by typing your name and selecting \"I agree\", and you must accept them before you use the Service.",
      "If you are the owner of a laboratory account, you also accept these Terms on behalf of the organization that holds the account, and you confirm that you are authorized to do so. The organization is then responsible for its users following these Terms.",
      "If your organization has a signed agreement with Veritas, that agreement controls wherever it conflicts with these Terms.",
    ],
  },
  {
    title: "2. The Service",
    paragraphs: [
      "The \"Service\" means the VeritaAssure® suite of laboratory compliance and operations software, including VeritaCheck®, VeritaMap®, VeritaScan® and the other modules in the suite, staff logins, and the related documentation, training material and support.",
      "VeritaScan® citations reference TJC standards (copyright © The Joint Commission) and CAP checklist numbers (copyright © College of American Pathologists) for educational and navigational purposes only. The Service does not reproduce the text of those standards and is not affiliated with, endorsed by, or sponsored by The Joint Commission or the College of American Pathologists.",
    ],
  },
  {
    title: "3. Intended Users",
    paragraphs: [
      "The Service is intended exclusively for use by qualified laboratory professionals and the staff of the laboratories they lead, including laboratory directors, clinical laboratory scientists, medical technologists, technicians and laboratory managers, operating under applicable federal and state regulations.",
    ],
  },
  {
    title: "4. Not Medical or Regulatory Advice",
    paragraphs: [
      "The Service is a professional reference and statistical computation tool only. Nothing it produces constitutes medical advice, diagnosis, treatment, a clinical recommendation, or a substitute for official accreditation review or regulatory inspection of any kind. All output must be reviewed and interpreted by a qualified laboratory director or designee before being used to make any clinical, regulatory, or operational decision. Veritas expressly disclaims any liability for clinical or regulatory decisions made in reliance on Service output.",
    ],
  },
  {
    title: "5. Your Responsibilities",
    paragraphs: [
      "You are solely responsible for: (a) the accuracy and completeness of data entered into the Service; (b) the interpretation of results; (c) compliance with all applicable laws, regulations, and accreditation standards; and (d) maintaining appropriate oversight by a qualified laboratory director or designee.",
      "You will not enter protected health information (PHI) into the Service. The Service is not designed to store, process, or transmit PHI.",
    ],
  },
  {
    title: "6. Your Login",
    paragraphs: [
      "Each login belongs to one person. Do not share your login, lend it, or let anyone else use it, and do not use anyone else's. Keep your password and sign-in codes confidential, and tell us at once at info@veritaslabservices.com if you think someone else has used your login. Veritas may suspend a login that is shared or misused.",
    ],
  },
  {
    title: "7. Confidentiality",
    paragraphs: [
      "(a) The Service's non-public features, screens, workflows, designs, calculations, documentation, training material and pricing, and any other information Veritas marks or describes as confidential, are \"Veritas Confidential Information\".",
      "(b) You will use Veritas Confidential Information only to run your organization's own laboratory programs. You will not disclose it to anyone outside your organization, except to your accreditors, inspectors and regulators when they need it to review your laboratory, and to your employees and contractors who need it for that purpose and are bound to keep it confidential. You will protect it with at least reasonable care.",
      "(c) This section does not cover information that is or becomes public through no fault of yours, that you knew before we shared it, that you lawfully receive from someone else without a duty of confidence, or that you develop independently without using Veritas Confidential Information. If the law requires you to disclose Veritas Confidential Information, you may do so after telling us, where the law allows, so that we can seek protection.",
      "(d) Your laboratory's own data stays yours. Veritas keeps it confidential as described in our Privacy Policy.",
      "(e) These duties continue while you use the Service and for five years after your access ends, and for as long as any trade secret remains a trade secret.",
    ],
  },
  {
    title: "8. Acceptable Use",
    paragraphs: [
      "You will not, and will not help anyone else to: (a) use the Service for, or on behalf of, a competitor of Veritas (a business that offers laboratory compliance, quality, or operations software or services), or to design, build or improve a competing product; (b) benchmark, evaluate or study the Service for competitive purposes, or publish such results, without Veritas's written consent; (c) copy, reverse engineer, decompile, scrape, or use automated tools to extract the Service, its content or its design; (d) record, screenshot or otherwise capture the Service for anyone outside your organization, except as section 7 allows; (e) resell, sublicense, or give access to the Service to anyone who is not a user on your organization's account; or (f) get around the Service's security, sign-in, seat or plan limits.",
    ],
  },
  {
    title: "9. Payment, Subscriptions, and Refunds",
    paragraphs: [
      "Paid features require a valid payment method. Subscription fees are billed in advance. Per-study purchases are one-time charges. We reserve the right to modify pricing with 30 days' notice.",
      "30-Day Money-Back Guarantee. For subscription plans only, we will refund your first subscription charge in full if you request a refund within 30 days of that first charge. The guarantee is limited to one refund per customer and applies to the initial subscription charge only, not to subsequent renewals. Per-study purchases, seat add-on charges, and any charges beyond the first subscription charge are non-refundable. To request a refund, contact info@veritaslabservices.com from the email address on the account. All other fees are non-refundable except as required by law.",
    ],
  },
  {
    title: "10. Intellectual Property",
    paragraphs: [
      "Veritas owns the Service, including its software, design, content, and report formats. Your laboratory's data, including the data shown in reports the Service generates, remains yours, and you may download, keep, and use those reports for your laboratory's own professional, accreditation, and regulatory purposes. You may not reproduce, resell, or redistribute the Service or its outputs for commercial purposes without written consent.",
    ],
  },
  {
    title: "11. Suspension and Remedies",
    paragraphs: [
      "A breach of section 6, 7 or 8 may cause Veritas harm that money cannot fully repair. Veritas may suspend or end the access involved, and may ask a court for an injunction in addition to any other remedy.",
    ],
  },
  {
    title: "12. Limitation of Liability",
    paragraphs: [
      "To the maximum extent permitted by applicable law, Veritas Lab Services, LLC shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of data, revenue, or patient harm, arising out of or related to your use of the Service. Our total liability for any claim shall not exceed the amount you paid us in the 12 months preceding the claim.",
    ],
  },
  {
    title: "13. Indemnification",
    paragraphs: [
      "The person or organization that holds the account agrees to indemnify and hold harmless Veritas Lab Services, LLC and its officers, directors, employees, and agents from any third-party claims, damages, or expenses arising from use of the Service under that account in violation of these Terms or of applicable laws or regulations.",
    ],
  },
  {
    title: "14. Changes",
    paragraphs: [
      "We may update these Terms. When we do, we will ask you to read and accept the new version before you continue to use the Service.",
    ],
  },
  {
    title: "15. Governing Law",
    paragraphs: [
      "These Terms are governed by the laws of the Commonwealth of Massachusetts, without regard to conflict of law principles. Any disputes shall be resolved in the state or federal courts located in Massachusetts, and each party consents to the personal jurisdiction of such courts.",
    ],
  },
  {
    title: "16. Contact",
    paragraphs: ["Questions regarding these Terms may be directed to info@veritaslabservices.com."],
  },
];

/** The exact text a person accepts, as one string: hashed with each acceptance so the record proves which words were shown. */
export function termsPlainText(): string {
  return [TERMS_TITLE, TERMS_VERSION_LABEL, ...TERMS_SECTIONS.flatMap((s) => [s.title, ...s.paragraphs])].join("\n");
}
