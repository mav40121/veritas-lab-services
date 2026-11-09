import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { seoMetadataMap, getBaseUrl, type SEOMetadata } from "./seo-metadata";
import { teaData } from "../client/src/lib/cliaTeaData";
import { applyStockBranding } from "@shared/stockBranding";

let cachedIndexHtml: string | null = null;

// The dedicated VeritaStock deployment sets this; veritaslabservices.com does not.
const STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";



function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Server-rendered, crawlable copy of the full CLIA TEa table for the lookup
// tool. The interactive table is client-rendered, so the raw HTML is otherwise
// empty (the page sat "crawled, currently not indexed"). This puts every
// analyte, its acceptable-performance (TEa) value, specialty, and CFR section
// into the raw HTML so search engines see the content without running JS. The
// React app replaces #root on mount, so real users still get the interactive
// table.
function renderTeaLookupTable(): string {
  const rows = teaData
    .map(
      (a) =>
        `<tr><td>${escHtml(a.analyte)}</td><td>${escHtml(a.criteria)}</td><td>${escHtml(a.specialty)}</td><td>42 CFR ${escHtml(a.cfr)}</td></tr>`,
    )
    .join("");
  return `<h2>CLIA Total Allowable Error (TEa) by analyte</h2><p>CLIA proficiency testing acceptance limits from 42 CFR Part 493, Subpart I (final rule CMS-3355-F, published July 11, 2022, effective July 11, 2024). These limits grade proficiency testing. A medical director or designee who adopts one as a laboratory criterion should document why it fits the clinical need.</p><table><thead><tr><th>Analyte</th><th>Acceptable performance (TEa)</th><th>Specialty</th><th>42 CFR section</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Crawlable prerender body for /calculator (the VeritaBench Lab Productivity
// Scorecard). The page is otherwise 100% JS-rendered, so Google left it
// "Discovered, never crawled"; this emits real content for the noscript block.
// Benchmark bands mirror client/src/pages/ProductivityCalculatorPage.tsx
// BENCHMARKS (the source of truth); keep in sync if those bands change.
function renderProductivityCalculatorContent(): string {
  const bands = [
    { group: "Community Hospital", volume: "200K to 500K billables/yr", low: "0.15", high: "0.22" },
    { group: "Large Trauma Center", volume: "750K to 1.5M billables/yr", low: "0.09", high: "0.13" },
    { group: "Reference Lab", volume: "2M+ billables/yr", low: "0.06", high: "0.09" },
  ];
  const rows = bands
    .map(
      (b) =>
        `<tr><td>${escHtml(b.group)}</td><td>${escHtml(b.volume)}</td><td>${escHtml(b.low)} to ${escHtml(b.high)}</td></tr>`,
    )
    .join("");
  return `<h2>Lab productivity benchmark ranges</h2><p>The VeritaBench Lab Productivity Scorecard computes one ratio, productive labor hours divided by billable tests, and scores it against the peer group for your lab's annual volume. A lower ratio means fewer labor hours per test, so a result below your peer band is outperforming, within the band is on target, and above the band points to a staffing or workflow savings opportunity.</p><p>Methodology: enter monthly productive hours (or estimate them from FTE count and a productive-time percentage) and monthly billable tests. The tool divides hours by tests, compares the ratio to the midpoint of your peer band, and converts any gap into productive hours, full-time-equivalent staff, and annual labor dollars at your hourly rate.</p><table><thead><tr><th>Peer group</th><th>Annual billable volume</th><th>Target ratio (productive hours per billable test)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// Crawlable prerender body for /pricing. The page is JS-rendered, so the tier
// dollar figures were absent from the raw HTML that crawlers and AI answer
// engines read (they do not run React), which made the pricing look "not
// exposed / contact sales" even though the tiers are published. This emits the
// published tiers as real text. Figures mirror client/src/pages/PricingPage.tsx
// PLANS (the source of truth); keep in sync if those change.
function renderPricingContent(): string {
  const tiers = [
    { plan: "Per Study", price: "$25 one-time", seats: "Free account required", addl: "Single VeritaCheck study" },
    { plan: "VeritaCheck Unlimited", price: "$299 first year, then $499/yr", seats: "Unlimited studies", addl: "" },
    { plan: "Clinic", price: "$999/yr", seats: "2 active seats included", addl: "Additional seats $500 each" },
    { plan: "Community (most popular)", price: "$2,125/yr", seats: "5 active seats included", addl: "Additional seats $425 each" },
    { plan: "Hospital", price: "$4,995/yr", seats: "15 active seats included", addl: "Additional seats $333 each" },
    { plan: "System", price: "Custom quote", seats: "Multi-lab, 16+ seats, SSO (on request), BAA, or SLA", addl: "Contact sales" },
  ];
  const rows = tiers
    .map((t) => `<tr><td>${escHtml(t.plan)}</td><td>${escHtml(t.price)}</td><td>${escHtml(t.seats)}</td><td>${escHtml(t.addl)}</td></tr>`)
    .join("");
  return `<h2>VeritaAssure&#174; pricing</h2><p>Simple, published annual pricing for clinical laboratory compliance software. Your tier is set by the number of active (writer) seats you need; additional active seats above the included count are billed at that tier per-seat rate. Read-and-sign staff access is handled by the staff seats add-on, not per seat.</p><table><thead><tr><th>Plan</th><th>Price</th><th>Included seats</th><th>Additional seats</th></tr></thead><tbody>${rows}</tbody></table><p>Every new account includes 2 free VeritaCheck&#174; study credits. System-tier pricing (more than one CLIA lab, 16 or more seats, or SSO (on request), BAA, and SLA requirements) is a custom quote via info@veritaslabservices.com.</p>`;
}

// Crawlable prerender body for /veritacheck. The page is JS-rendered, so its
// feature detail (study types, CLSI methods, CFR criteria) was absent from the
// raw HTML crawlers and AI answer engines read. This emits the positioning and
// capabilities as real text: VeritaCheck is the performance-verification module
// of the VeritaAssure platform, not a standalone "EP evaluation tool". Copy
// mirrors the VeritaCheck SoftwareApplication featureList in client/index.html.
function renderVeritaCheckContent(): string {
  return `<h2>VeritaCheck&#174; performance verification</h2><p>VeritaCheck&#174; is the performance-verification module of the VeritaAssure&#174; compliance platform, built by a former Joint Commission laboratory surveyor. It runs the studies a clinical laboratory needs to verify performance specifications under 42 CFR Part 493 and generates surveyor-ready, CFR-cited PDF reports with a laboratory director or designee signature block on page 1.</p><p>Study types: Calibration Verification / Linearity (reportable range and analytical measurement range), Correlation / Method Comparison with Deming regression, precision per CLSI EP15, lot-to-lot comparison per CLSI EP26, reference interval verification, and qualitative and sensitivity studies. Each quantitative study is evaluated against the acceptance criterion the laboratory adopts, which can be a CLIA proficiency testing limit (42 CFR Part 493 total allowable error) or a criterion the medical director or designee sets, and the narrative cites the specialty-specific CFR section.</p><p>Every report carries the regulatory determination, the statistical appendix, the CLIA number, and the laboratory director or designee signature block. Studies are stored and retrievable for the next inspection. VeritaCheck&#174; is one module of VeritaAssure&#174;, which also manages inspection readiness, proficiency testing, competency, and test-menu mapping.</p>`;
}

// Crawlable prerender bodies for the JS-rendered product pages (same pattern as
// /veritacheck): the raw HTML was a ~310-char shell, so crawlers and AI answer
// engines saw no feature detail. Copy mirrors each page's own content and the
// SoftwareApplication featureList in client/index.html.
function renderVeritaScanContent(): string {
  return `<h2>VeritaScan&#174; inspection readiness</h2><p>VeritaScan&#174; is laboratory inspection readiness software: a self-inspection and compliance audit tool. It presents 173 compliance questions across 10 laboratory domains, quality systems and QC, calibration and verification, proficiency testing, personnel and competency, test management and procedures, equipment and maintenance, safety and environment, blood bank and transfusion, point of care testing, and leadership and governance, each cross-referenced to TJC standards, CAP checklists, and the CFR where one applies. A live dashboard scores readiness by domain, findings are tracked with owner assignment and due dates (Compliant, Needs Attention, Immediate Action, or N/A), and results export to share with the medical director or designee. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections. Included in the Clinic plan and above.</p>`;
}
function renderVeritaMapContent(): string {
  return `<h2>VeritaMap&#174; test-menu regulatory map</h2><p>VeritaMap&#174; is the regulatory map for a laboratory's test menu. One row per test, with its instruments, specialty, CLIA complexity, the 42 CFR Part 493 section for that specialty, correlation requirements, and the last-completed dates for calibration verification, method comparison, precision, and SOP review. Laboratories can filter by specialty, sort by complexity to surface every high-complexity test, and link an SOP to a VeritaDC&#8482; policy. Free for up to 4 instruments and 10 analytes lab-wide; included in the Clinic plan and above. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaCompContent(): string {
  return `<h2>VeritaComp&#8482; competency assessment</h2><p>VeritaComp&#8482; manages laboratory competency assessment across all three types in one system: technical competency (the six CLIA-required assessment methods per method group for non-waived testing staff, semiannual in year one and annual thereafter), waived testing competency (two of four methods per test, the TJC rule), and non-technical competency for phlebotomy, specimen processing, LIS, and other non-testing duties. It integrates with VeritaMap&#174; to import instruments and suggest method groups. Each employee carries an assessment history and remediation plans, with due-date tracking for testing competency, and every completed assessment generates a PDF with the medical director or designee signature on page 1. Whether the laboratory is accredited by TJC, CAP, or COLA, or operates under CLIA only, VeritaComp&#8482; provides the documentation framework surveyors expect. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
// Batch 2 (2026-07-17): the last two product pages. Requirement counts and
// chapter lists below are the live page's own ACCREDITOR_PROFILES values
// (client/src/pages/VeritaPolicyPage.tsx), not restated from memory.
function renderVeritaPolicyContent(): string {
  return `<h2>VeritaDC&#8482; policy and document control</h2><p>VeritaDC&#8482; (formerly VeritaPolicy&#8482;) is document control for clinical laboratories: policies, procedures, and forms with version history, director approval, and periodic reviews. It pre-loads a master list of 58 laboratory policies, organized by section, each listed with its 42 CFR Part 493 citations and related citations for your accreditor. A reference set of citations follows your laboratory's accreditation choice: 88 for The Joint Commission (APR, DC, EC, EM, HR, IC, IM, LD, PI, QSA, TS, WT), 65 for the College of American Pathologists (GEN, COM, CHM, HEM, MIC, IMM, TRM, MOL), 81 for COLA (QC, GLS, PRE, PT, PST, VER, CA), and, for CLIA-only laboratories, 286 citations from 42 CFR Part 493 and related federal rules (21 CFR, 29 CFR, 45 CFR, and 42 CFR 482 and 483). Not every policy applies to every laboratory, so any requirement or a whole section can be marked N/A, with bulk actions to configure your scope quickly. Track staff acknowledgments and document review cycles so the policy manual stays survey-ready. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaStaffContent(): string {
  return `<h2>VeritaStaff&#8482; laboratory personnel management</h2><p>VeritaStaff&#8482; is laboratory personnel management: staff roster, CLIA role assignments, competency scheduling, and CMS 209 generation in one place. Every laboratory performing nonwaived testing must maintain accurate personnel records and demonstrate that staff qualifications match their assigned roles and testing responsibilities. VeritaStaff&#8482; maintains the complete roster with credentials, hire dates, and qualification tracking; assigns the CLIA roles (laboratory director, clinical consultant, technical consultant, technical supervisor, general supervisor, and testing personnel) with specialty coverage across all 17 CMS specialty categories; and auto-generates a pre-filled CMS 209 Laboratory Personnel Report, one row per specialty per person. Its competency timeline engine calculates the Initial, 6-month, 1st Annual, and Annual milestones, with one CLIA timeline for every lab and TJC's late tolerances and New York State's hire-anchored schedule built in. Due dates follow the competency actually recorded, and the 1st Annual stays 12 months from the initial. It integrates with VeritaMap&#174; to import departments and suggest technical consultant and technical supervisor specialties. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}

// Batch 3 (2026-07-17): the remaining product pages that were still a ~520-char
// shell. Copy is each page's own content (hero, FEATURES arrays), not restated
// from memory.
//
// VeritaBench is absent from THIS list because it is not a batch-3 page: its
// page is /calculator, prerendered above by renderProductivityCalculatorContent().
// /veritabench is a legacy slug that renders VeritaPace (h1, useSEO title and
// hero all say VeritaPace), which is why no "VeritaBench is..." block belongs
// there. See VeritaAssurePage.tsx OPERATIONS_MODULES for the authoritative route map:
// VeritaBench=/calculator, VeritaPace=/veritabench, VeritaShift=/veritabench/staffing,
// VeritaQA=/veritabench/pi, VeritaStock=/veritastock, VeritaOps=/veritaops-app.
//
// No VeritaStock host branch needed: on STOCK_DEPLOYMENT the route handler
// returns the shell WITHOUT calling injectSeoTags (see the handler below), so
// these bodies only ever render on veritaslabservices.com.
function renderVeritaTrackContent(): string {
  return `<h2>VeritaTrack&#8482; regulatory calendar and sign-off</h2><p>VeritaTrack&#8482; replaces the binders and clipboards a laboratory uses to track recurring regulatory tasks. It builds itself from the test menu rather than from data entry: one click imports VeritaMap&#174;, and every analyte that is not waived gets its calibration verification, its precision verification, and its SOP review, plus a correlation when two or more nonwaived instruments run it, each on its own frequency and each tied back to the analyte and the instrument it runs on. Waived analytes are skipped automatically, because each test's complexity comes from the map rather than being decided again by hand.</p><p>Configure recurring weekly, monthly, quarterly, biannual, annual, and biennial tasks across instruments and departments. Status is color-coded Current, Due Soon, Overdue, and Not Started, with due-date alerts so nothing slips through the cracks. Capture sign-offs with timestamps and analyst initials, keep the complete history with notes, and export to Excel in a regulatory-calendar layout. A sign-off sets the next due date from that task's own frequency and writes the completion date back into VeritaMap&#174;, so the menu and the calendar stay in step. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaPTContent(): string {
  return `<h2>VeritaPT&#8482; proficiency testing coverage and tracking</h2><p>VeritaPT&#8482; reads your VeritaMap&#174; test menu and shows which analytes have required proficiency testing gaps, recommended programs, or current coverage. Record each PT program you are enrolled in, with its provider, program code, and category. Log your result for each PT event along with the peer mean and peer standard deviation, and mark it pass or fail; the standard deviation index is calculated for you. For an unacceptable result, open a VeritaResponse&#8482; PT failure finding for root cause, corrective action, preventive action, and a monitoring plan. Review and remedial action are required under 42 CFR 493.1236, 493.1407(e)(4), and 493.1445(e)(4), and by CAP checklist requirements. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaLabContent(): string {
  return `<h2>VeritaLab&#8482; certificate and accreditation tracking</h2><p>VeritaLab&#8482; is centralized storage for a laboratory's accreditation certificates, licenses, and supporting documents. The CLIA certificate is auto-populated from the CLIA number on your account; add CAP accreditation, TJC accreditation, ISO 15189, state licenses, laboratory director licenses, and vendor agreements alongside it, with COLA and others under Other. Automatic expiration reminders go out at 9 months, 6 months, 3 months, 30 days, and at expiration, delivered by email to the account owner, and the system auto-detects missing expiration dates on the auto-populated CLIA records so a blank does not read as a pass.</p><p>Upload and archive the actual certificate PDFs, scanned images, and supporting documents, so during a survey or a renewal you retrieve them instead of scrambling for paperwork. Status is color-coded expired, expiring soon, current, or no date entered, with certificate type badges for CLIA, CAP, TJC, state, and other, and the whole register exports to Excel with the status colors and days-until-expiration calculations intact. Built by a former Joint Commission laboratory surveyor who has reviewed certificate records at more than 200 facilities.</p>`;
}
// Batch 4 (2026-07-17): /veritaassure is the suite's own landing page and carries
// the only node in the graph with no isPartOf (it IS the suite). /operations has
// no prerender and no node: it 301s here from server/index.ts.
function renderVeritaAssureContent(): string {
  return `<h2>VeritaAssure&#174; laboratory compliance platform</h2><p>VeritaAssure&#174; is the integrated compliance platform for clinical laboratories from Veritas Lab Services, LLC, built by a former Joint Commission laboratory surveyor with more than 200 facility inspections. It unites performance verification, inspection readiness, test menu mapping, competency assessment, policy control, personnel records, and certificate monitoring in one browser-based system. No desktop software, no installation, and no protected health information is stored.</p><p>The suite is eighteen modules in two streams. Twelve compliance modules: VeritaCheck&#174; runs the performance verification studies laboratories use to meet 42 CFR Part 493 (Calibration Verification / Linearity, Correlation / Method Comparison, precision, and reagent and QC lot verification) and generates CFR-cited PDF reports with a laboratory director or designee signature block on page 1. VeritaMap&#174; maps every instrument and analyte to its CLIA complexity and specialty. VeritaScan&#174; scores self-inspection readiness across 173 compliance items in 10 domains, cross-referenced to the current TJC standard and the CAP checklist. VeritaComp&#8482; manages technical competency using all six CLIA assessment elements on the Initial, 6-month, and annual timeline, plus waived and non-technical programs. VeritaDC&#8482; tracks the policies required under CLIA and crosswalks each one to your accreditor. VeritaStaff&#8482; holds the personnel roster with CLIA role assignments and auto-generates the CMS 209 Laboratory Personnel Report. VeritaLab&#8482; tracks CLIA, CAP, TJC, ISO 15189, state license, lab director license, and vendor agreement records, with COLA and others under Other, and sends advance expiration reminders. VeritaPT&#8482; checks the test menu against CLIA proficiency testing requirements and surfaces gaps. VeritaTrack&#8482; is the regulatory compliance calendar. VeritaQC&#8482; evaluates daily quality control against Westgard multi-rules. VeritaResponse&#8482; turns a survey citation into a tracked finding with a per-accreditor due-date clock and renders a plan of correction. VeritaMaintain&#8482; logs instrument maintenance and function checks against a schedule and flags what is overdue.</p><p>Six operations modules extend the platform: VeritaBench&#8482;, VeritaPace&#8482;, VeritaShift&#8482;, VeritaQA&#8482;, VeritaStock&#8482;, and VeritaOps&#8482;. Modules share data, so the test menu in VeritaMap&#174; feeds VeritaCheck&#174; instrument selection, VeritaComp&#8482; competency programs, and VeritaPT&#8482; coverage. VeritaAssure&#174; states the regulatory result; final approval and clinical determination rest with the laboratory director or designee.</p>`;
}
// Batch 7 (2026-07-17): the two pages that sell the consultant rather than the
// software. Every product page was made crawlable in batches 3 and 4 while
// /services and /team sat at ~530 and ~478 chars, which meant the site's whole
// consulting proposition, and the credential the resource articles trade on, was
// invisible to the crawler that sent the reader. Copy is each page's own content
// (ServicesPage.tsx and TeamPage.tsx), not restated from memory.
function renderServicesContent(): string {
  return `<h2>Laboratory consulting services</h2><p>Veritas Lab Services provides laboratory consulting delivered by Michael Veri, MS, MBA, MLS(ASCP), CPHQ, a former Joint Commission surveyor with more than 200 facility inspections. Three service lines: regulatory readiness and mock inspections, productivity and workflow optimization, and leadership coaching and education.</p><p><strong>Regulatory readiness and mock inspections.</strong> Structured regulatory reviews and mock inspections that mirror real survey conditions, so your team identifies and corrects issues before they become findings. On-site inspection readiness is an expert-led walkthrough emulating real regulatory inspections across CLIA, TJC, CAP, COLA, and FDA, with a detailed review of policies, procedures, and quality documentation, hands-on staff education and direct troubleshooting, workflow and regulatory compliance review, and a post-survey written report with findings and recommendations.</p><p><strong>Productivity and workflow optimization.</strong> On-site assessments that connect operational performance with regulatory expectations, helping you optimize staffing, processes, and turnaround times without compromising compliance. Includes industry-standard benchmarking of staffing and workflows, identification of inefficiencies arising from staffing gaps, outdated processes, or resource misallocation, customized analysis reports with clear and actionable recommendations, and C-suite communication support with data-driven staffing rationales.</p><p><strong>Leadership coaching and education.</strong> Coaching for laboratory leaders and frontline staff on how to think like surveyors, communicate with administration, and build a culture where compliance is sustainable rather than reactive. Single one-hour sessions or blocks of ten, with topics entirely chosen by you: C-suite relationship building and communication, laboratory leadership career development, and mentorship for directors and managers who are the most senior in their organizations. Interactive online sessions cover a full spectrum of laboratory and hospital topics tailored to specific educational needs, including blood administration co-owned across laboratory, nursing, and providers, QC and QA review and implementation, and an introduction to the laboratory survey process for nursing.</p>`;
}
function renderTeamContent(): string {
  return `<h2>Michael Veri, MS, MBA, MLS(ASCP), CPHQ</h2><p>Veritas Lab Services, LLC is led by Michael Veri, a laboratory operations consultant and the founder of the VeritaAssure&#174; compliance software suite. He served as a Joint Commission surveyor for four years and has conducted more than 200 facility inspections, and he is the author of Lab Management 101: A Guide to Laboratory Leadership, forthcoming.</p><p>Credentials: MS, Master of Science in Chemistry. MBA, Master of Business Administration. MLS(ASCP), Medical Laboratory Scientist. CPHQ, Certified Professional in Healthcare Quality. Former Joint Commission surveyor, four years. Founder of the VeritaAssure&#174; compliance software suite.</p><p>Published work and speaking topics include co-owning blood administration among laboratory, nursing, and providers; laboratory leadership's view of accreditation; forming a blood utilization and management program; and capturing productivity in the laboratory. The same surveyor perspective behind that work is what VeritaAssure&#174; automates and what the laboratory consulting engagements deliver on site.</p><h2>David McCormick, Sales Partner</h2><p>David McCormick co-founded Medical Lab Management magazine in 2012, after five years writing and editing for a trade magazine covering clinical pharmacy operations, to give laboratorians of all ranks a peer-to-peer outlet for their work. He met Michael Veri in 2015, when Michael became an author and advisor for the magazine. David joined Veritas Lab Services in 2026 and edited Michael's forthcoming book, Lab Management 101.</p>`;
}
function renderVeritaStockContent(): string {
  return `<h2>VeritaStock&#8482; inventory and reagent management</h2><p>VeritaStock&#8482; tracks reagent and supply inventory across departments with burn-rate par levels, lead-time-aware reorder alerts, and expiration tracking. Days on hand and reorder points are calculated from your burn rate and vendor lead times, and the Learned Burn Advisor suggests a burn rate from actual usage. Expiration tracking carries 30, 60, and 90 day flags on every item, and standing orders are tracked with a next-review date and a Standing Orders Due flag. Status is color-coded Reorder Now, Expiring lot, and OK, plus expiration and Standing Orders Due flags, so a shelf that is about to bite you is visible before it does. Included with VeritaAssure&#174; Suite plans on Clinic, Community, Hospital, and System.</p>`;
}

// Crawlable prerender body for the homepage ("/"). The homepage was a ~512-char
// shell (title + description + nav), so crawlers and AI answer engines saw almost
// no content on the site's most authoritative page for the contested commercial
// queries (lab compliance software, laboratory compliance platform). Copy mirrors
// the suite's own positioning (see renderVeritaAssureContent) and links to the
// buyer guide so the homepage passes authority to the cluster target.
function renderHomepageContent(): string {
  return `<h2>Lab compliance software for clinical laboratories</h2><p>VeritaAssure&#174; is all-in-one laboratory compliance software from Veritas Lab Services, LLC: performance verification, inspection readiness, proficiency testing, competency assessment, policy and document control, personnel records, certificate tracking, daily quality control, and post-survey deficiency response in one browser-based platform. It is built by a former Joint Commission laboratory surveyor with more than 200 facility inspections, for CLIA-certified laboratories accredited by The Joint Commission, the College of American Pathologists, or COLA, and for CLIA-only laboratories. No desktop install, and no protected health information is stored.</p><p>The laboratory compliance platform is eighteen modules in two streams. The twelve compliance modules are VeritaCheck&#174; (performance verification studies with CFR-cited PDF reports), VeritaMap&#174; (the test-menu regulatory map), VeritaScan&#174; (self-inspection readiness across 173 items in 10 domains), VeritaComp&#8482; (competency assessment on the CLIA six-element timeline), VeritaDC&#8482; (policy and document control), VeritaStaff&#8482; (personnel roster and CMS 209), VeritaLab&#8482; (certificate and accreditation tracking), VeritaPT&#8482; (proficiency testing tracking), VeritaTrack&#8482; (the regulatory compliance calendar), VeritaQC&#8482; (daily quality control against Westgard multi-rules), VeritaResponse&#8482; (plan-of-correction tracking), and VeritaMaintain&#8482; (equipment maintenance). Six operations modules cover laboratory productivity, staffing, quality metrics, inventory, and cost per reportable test. The modules share data, so the test menu drives performance verification, competency assignment, and proficiency testing checks in one place.</p><p>Choosing a laboratory compliance platform? Read the guide on <a href="/resources/how-to-choose-lab-compliance-software">how to choose lab compliance software</a>, compare <a href="/pricing">pricing</a>, or explore the <a href="/veritaassure">VeritaAssure&#174; suite</a>. VeritaAssure&#174; states the regulatory result; final approval and clinical determination rest with the laboratory director or designee.</p>`;
}

function getIndexHtml(distPath: string): string {
  if (!cachedIndexHtml) {
    let html = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
    // Dedicated VeritaStock deployment: inject a runtime flag the client reads
    // (client/src/lib/host.ts) so the whole service presents as VeritaStock on
    // every URL, regardless of hostname or whether the Vite build baked the env
    // var. Read from the env at boot; this service has VITE_STOCK_DEPLOYMENT=true,
    // veritaslabservices.com does not, so it stays VeritaAssure.
    if (STOCK_DEPLOYMENT) {
      html = html.replace("</head>", `<script>window.__STOCK_DEPLOYMENT__=true;</script></head>`);
      // Temporary single-site demo mode (e.g. the "Pfizer Proposed" walkthrough).
      // Purely presentational: the client collapses the location switcher to one
      // site, relabels it, and hides the multi-location nav. Mutates NO data, so
      // the underlying five-location demo is untouched and revert is just removing
      // the DEMO_SINGLE_SITE env var and redeploying.
      if (process.env.DEMO_SINGLE_SITE === "on") {
        html = html.replace("</head>", `<script>window.__DEMO_SINGLE_SITE__=true;</script></head>`);
      }
      // VeritaStock is its own product: the default <title>/meta is VeritaStock,
      // never the VeritaAssure compliance branding. Pages with their own useSEO
      // still override this; pages without it (login, account, members) now read
      // VeritaStock instead of the lab default.
      //
      // Lives in shared/stockBranding.ts so the de-lab rule is testable: the
      // rule is a property of the RENDERED page, so a test has to run the real
      // transform over the real index.html rather than re-implement it. That
      // module also swaps the ld+json graph, which used to ship the suite's
      // laboratory wording to crawlers on veritastock.com.
      html = applyStockBranding(html);
    }
    cachedIndexHtml = html;
  }
  return cachedIndexHtml;
}

function injectSeoTags(html: string, routePath: string, meta: SEOMetadata): string {
  const baseUrl = getBaseUrl();
  const canonicalUrl = routePath === "/" ? `${baseUrl}/` : `${baseUrl}${routePath}`;

  // Replace title
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*"/,
    `<meta name="description" content="${meta.description}"`,
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:title" content="[^"]*"/,
    `<meta property="og:title" content="${meta.title}"`,
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*"/,
    `<meta property="og:description" content="${meta.description}"`,
  );
  html = html.replace(
    /<meta property="og:url" content="[^"]*"/,
    `<meta property="og:url" content="${canonicalUrl}"`,
  );

  // Per-route OG / Twitter image override. The default og-image.png stays for
  // every route that does not set ogImage; a route (e.g. /demo) that sets it
  // gets its own social share card, fixing the link preview on shared URLs.
  if (meta.ogImage) {
    html = html.replace(
      /<meta property="og:image" content="[^"]*"/,
      `<meta property="og:image" content="${meta.ogImage}"`,
    );
    html = html.replace(
      /<meta name="twitter:image" content="[^"]*"/,
      `<meta name="twitter:image" content="${meta.ogImage}"`,
    );
  }

  // Replace canonical
  html = html.replace(
    /<link rel="canonical" href="[^"]*"/,
    `<link rel="canonical" href="${canonicalUrl}"`,
  );

  // Replace Twitter Card tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*"/,
    `<meta name="twitter:title" content="${meta.title}"`,
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*"/,
    `<meta name="twitter:description" content="${meta.description}"`,
  );

  // Inject noscript content inside <div id="root"> so crawlers and no-JS clients
  // see real content. For data-heavy SPA routes whose rendered body is otherwise
  // absent from the raw HTML, append the full dataset so it is crawlable without
  // running JS.
  let noscriptInner = `<h1>${meta.title}</h1><p>${meta.description}</p><nav><a href="/">Home</a> | <a href="/veritaassure">VeritaAssure&#174;</a> | <a href="/veritacheck">VeritaCheck&#174;</a> | <a href="/veritascan">VeritaScan&#174;</a> | <a href="/veritamap">VeritaMap&#174;</a> | <a href="/pricing">Pricing</a> | <a href="/contact">Contact</a></nav>`;
  if (routePath === "/") {
    noscriptInner += renderHomepageContent();
  } else if (routePath === "/resources/clia-tea-lookup") {
    noscriptInner += renderTeaLookupTable();
  } else if (routePath === "/calculator") {
    noscriptInner += renderProductivityCalculatorContent();
  } else if (routePath === "/pricing") {
    noscriptInner += renderPricingContent();
  } else if (routePath === "/veritacheck") {
    noscriptInner += renderVeritaCheckContent();
  } else if (routePath === "/veritascan") {
    noscriptInner += renderVeritaScanContent();
  } else if (routePath === "/veritamap") {
    noscriptInner += renderVeritaMapContent();
  } else if (routePath === "/veritacomp") {
    noscriptInner += renderVeritaCompContent();
  } else if (routePath === "/veritadc" || routePath === "/veritapolicy") {
    noscriptInner += renderVeritaPolicyContent();
  } else if (routePath === "/veritastaff") {
    noscriptInner += renderVeritaStaffContent();
  } else if (routePath === "/veritatrack") {
    noscriptInner += renderVeritaTrackContent();
  } else if (routePath === "/veritapt") {
    noscriptInner += renderVeritaPTContent();
  } else if (routePath === "/veritalab") {
    noscriptInner += renderVeritaLabContent();
  } else if (routePath === "/veritastock") {
    noscriptInner += renderVeritaStockContent();
  } else if (routePath === "/veritaassure") {
    noscriptInner += renderVeritaAssureContent();
  } else if (routePath === "/services") {
    noscriptInner += renderServicesContent();
  } else if (routePath === "/team") {
    noscriptInner += renderTeamContent();
  }
  // If this route carries a FAQPage node, expose its Q&A in the noscript body so
  // crawlers and AI answer engines read the questions and answers as page text,
  // matching the on-page FAQ and the FAQPage JSON-LD (single source: faqContent).
  const jsonLdBlocks = Array.isArray(meta.jsonLd) ? meta.jsonLd : meta.jsonLd ? [meta.jsonLd] : [];
  const faqNode = jsonLdBlocks.find(
    (b) => (b as Record<string, unknown>)?.["@type"] === "FAQPage",
  ) as { mainEntity?: Array<{ name?: string; acceptedAnswer?: { text?: string } }> } | undefined;
  if (faqNode && Array.isArray(faqNode.mainEntity)) {
    const qa = faqNode.mainEntity
      .map((q) => `<h3>${escHtml(q?.name ?? "")}</h3><p>${escHtml(q?.acceptedAnswer?.text ?? "")}</p>`)
      .join("");
    if (qa) noscriptInner += `<section><h2>Frequently Asked Questions</h2>${qa}</section>`;
  }
  // Soft-404 fix: FAQ-less article routes otherwise get only the generic shell in
  // the noscript. Render the Article node's articleBody so the raw HTML carries real
  // crawlable content. Guarded on "no FAQ node" because FAQ'd articles already fold
  // the FAQ text into articleBody (enrichArticleBodies), which would double-render.
  if (!faqNode) {
    const articleNode = jsonLdBlocks.find(
      (b) => (b as Record<string, unknown>)?.["@type"] === "Article",
    ) as { articleBody?: string } | undefined;
    if (articleNode?.articleBody && articleNode.articleBody.length > 0) {
      noscriptInner += `<article>${articleNode.articleBody}</article>`;
    }
  }
  html = html.replace('<div id="root"></div>', `<div id="root"><noscript>${noscriptInner}</noscript></div>`);

  // Inject per-route JSON-LD (e.g. Article, FAQPage, DefinedTerm) when provided,
  // alongside the site-wide @graph already in index.html. A route may supply a
  // single object or an array of objects (e.g. Article + FAQPage + DefinedTerm
  // on one page); each becomes its own <script>. Escape "<" so a stray sequence
  // in the data can't break out of the <script> element.
  if (meta.jsonLd) {
    const blocks = Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd];
    for (const block of blocks) {
      const json = JSON.stringify(block).replace(/</g, "\\u003c");
      html = html.replace("</head>", `<script type="application/ld+json">${json}</script></head>`);
    }
  }

  return html;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Legacy URL 301 redirects. Google Search Console still has these old
  // URLs indexed and returns 404 on each. Server-side 301 preserves SEO
  // link equity (a client-side wouter redirect would render the page and
  // lose the 301 signal Google needs). Add new entries here as old
  // marketing or auth URLs are renamed.
  const LEGACY_REDIRECTS: Record<string, string> = {
    "/meet-our-team": "/team",
    "/our-services": "/services",
    "/m/login": "/login",
    "/m/create-account": "/register",
    "/m/reset": "/reset-password",
    // The checklist/preparation article is superseded by the more comprehensive
    // "what to expect" cornerstone (same topic, phase-by-phase + mock inspection).
    // 301 consolidates the two into one page so they stop cannibalizing each other.
    "/resources/tjc-laboratory-inspection-checklist-preparation": "/resources/tjc-laboratory-inspection-what-to-expect",
  };
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    const normalized = req.path.replace(/\/$/, "") || "/";
    const target = LEGACY_REDIRECTS[normalized];
    if (target) return res.redirect(301, target);
    next();
  });

  // Serve static assets with proper MIME types and long cache
  app.use("/assets", express.static(path.join(distPath, "assets"), {
    maxAge: "1y",
    immutable: true,
    fallthrough: false,
  }));

  // SEO pre-rendering: intercept public marketing routes BEFORE static middleware
  // so that even "/" gets injected metadata instead of the raw index.html
  app.use((req, res, next) => {
    // Only handle GET requests for HTML pages
    if (req.method !== "GET") return next();
    // Skip API routes
    if (req.path.startsWith("/api")) return next();
    // Skip file requests (has extension)
    if (req.path.match(/\.[a-zA-Z0-9]+$/)) return next();

    const routePath = req.path.replace(/\/$/, "") || "/";
    const meta = seoMetadataMap[routePath];
    if (meta) {
      // On the VeritaStock deployment, never inject the lab marketing metadata;
      // serve the VeritaStock-default shell so no route carries VeritaAssure
      // compliance branding in its title/description/OG tags.
      if (STOCK_DEPLOYMENT) {
        res.setHeader("Content-Type", "text/html");
        // Never cache the HTML shell: after a redeploy the browser must
        // revalidate and pick up the new hashed chunk references, or it renders
        // a stale bundle (e.g. a toolbar missing a later-added button).
        res.setHeader("Cache-Control", "no-cache");
        return res.send(getIndexHtml(distPath));
      }
      const html = getIndexHtml(distPath);
      const injectedHtml = injectSeoTags(html, routePath, meta);
      res.setHeader("Content-Type", "text/html");
      res.setHeader("Cache-Control", "no-cache");
      return res.send(injectedHtml);
    }

    next();
  });

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      // The HTML shell must always revalidate (so a redeploy's new chunk
      // hashes load); hashed /assets above stay immutable for a year.
      if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    },
  }));

  // SPA catch-all: only for routes that are NOT API requests or static asset requests
  app.use("/{*path}", (req, res, next) => {
    // 2026-10-09: read the FULL path. Inside app.use("/{*path}") Express 5 makes
    // req.path relative to the mount (it is "/" here), so the old
    // req.path.startsWith("/api") never matched and every unknown /api address
    // got the website's HTML with a 200, which hid broken or removed API calls.
    const fullPath = String(req.originalUrl || req.url || "").split("?")[0];
    // An /api address that no route matched is a real 404, as JSON.
    if (fullPath.startsWith("/api/") || fullPath === "/api") {
      return res.status(404).json({ error: "Not found", path: fullPath });
    }
    // If the request looks like a file (has an extension), return 404 instead of index.html
    if (fullPath.match(/\.[a-zA-Z0-9]+$/)) {
      return next();
    }
    // Serve the index shell via getIndexHtml so the VeritaStock deployment flag
    // is injected on app routes too (not just the SEO-prerendered marketing ones).
    res.setHeader("Cache-Control", "no-cache");
    // A VeritaDC document share link (server/policyShareLinks.ts) is never indexed, even by a crawler that runs no JS.
    if (/^\/policy\/[^/]+\/?$/.test(fullPath)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Cache-Control", "no-store");
      return res.type("html").send(getIndexHtml(distPath).replace(/<meta name="robots" content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex, nofollow" />'));
    }
    res.type("html").send(getIndexHtml(distPath));
  });
}
