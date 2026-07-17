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
  return `<h2>CLIA Total Allowable Error (TEa) by analyte</h2><p>Acceptable performance criteria from 42 CFR Part 493, Subpart I (CLIA proficiency testing final rule CMS-3355-F, effective July 11, 2024, implemented January 1, 2025).</p><table><thead><tr><th>Analyte</th><th>Acceptable performance (TEa)</th><th>Specialty</th><th>42 CFR section</th></tr></thead><tbody>${rows}</tbody></table>`;
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
    { plan: "Per Study", price: "$25 one-time", seats: "No account required", addl: "Single VeritaCheck study" },
    { plan: "VeritaCheck Unlimited", price: "$299 first year, then $499/yr", seats: "Unlimited studies", addl: "" },
    { plan: "Clinic", price: "$999/yr", seats: "2 active seats included", addl: "Additional seats $500 each" },
    { plan: "Community (most popular)", price: "$2,125/yr", seats: "5 active seats included", addl: "Additional seats $425 each" },
    { plan: "Hospital", price: "$4,995/yr", seats: "15 active seats included", addl: "Additional seats $333 each" },
    { plan: "System", price: "Custom quote", seats: "Multi-lab, 16+ seats, SSO, BAA, or SLA", addl: "Contact sales" },
  ];
  const rows = tiers
    .map((t) => `<tr><td>${escHtml(t.plan)}</td><td>${escHtml(t.price)}</td><td>${escHtml(t.seats)}</td><td>${escHtml(t.addl)}</td></tr>`)
    .join("");
  return `<h2>VeritaAssure&#8482; pricing</h2><p>Simple, published annual pricing for clinical laboratory compliance software. Your tier is set by the number of active (writer) seats you need; additional active seats above the included count are billed at that tier per-seat rate. Read-and-sign staff access is handled by the Staff Portal add-on, not per seat.</p><table><thead><tr><th>Plan</th><th>Price</th><th>Included seats</th><th>Additional seats</th></tr></thead><tbody>${rows}</tbody></table><p>Every new account includes 2 free VeritaCheck&#8482; study credits. System-tier pricing (more than one CLIA lab, 16 or more seats, or SSO, BAA, and SLA requirements) is a custom quote via info@veritaslabservices.com.</p>`;
}

// Crawlable prerender body for /veritacheck. The page is JS-rendered, so its
// feature detail (study types, CLSI methods, CFR criteria) was absent from the
// raw HTML crawlers and AI answer engines read. This emits the positioning and
// capabilities as real text: VeritaCheck is the performance-verification module
// of the VeritaAssure platform, not a standalone "EP evaluation tool". Copy
// mirrors the VeritaCheck SoftwareApplication featureList in client/index.html.
function renderVeritaCheckContent(): string {
  return `<h2>VeritaCheck&#8482; performance verification</h2><p>VeritaCheck&#8482; is the performance-verification module of the VeritaAssure&#8482; compliance platform, built by a former Joint Commission laboratory surveyor. It runs the studies a clinical laboratory needs to verify performance specifications under 42 CFR Part 493 and generates surveyor-ready, CFR-cited PDF reports with a laboratory director or designee signature block on page 1.</p><p>Study types: Calibration Verification / Linearity (reportable range and analytical measurement range), Correlation / Method Comparison with Deming regression, precision per CLSI EP15, lot-to-lot comparison per CLSI EP26, reference interval verification, and qualitative and sensitivity studies. Each quantitative study applies the 42 CFR Part 493 total allowable error criteria automatically and cites the specialty-specific CFR section in the narrative.</p><p>Every report carries the regulatory determination, the statistical appendix, the CLIA number, and the director signature block. Studies are stored and retrievable for the next inspection. VeritaCheck&#8482; is one module of VeritaAssure&#8482;, which also manages inspection readiness, proficiency testing, competency, and test-menu mapping.</p>`;
}

// Crawlable prerender bodies for the JS-rendered product pages (same pattern as
// /veritacheck): the raw HTML was a ~310-char shell, so crawlers and AI answer
// engines saw no feature detail. Copy mirrors each page's own content and the
// SoftwareApplication featureList in client/index.html.
function renderVeritaScanContent(): string {
  return `<h2>VeritaScan&#8482; inspection readiness</h2><p>VeritaScan&#8482; is a laboratory self-inspection and compliance audit tool. It presents 173 compliance questions across 10 laboratory domains, quality systems and QC, calibration and verification, proficiency testing, personnel and competency, test management and procedures, equipment and maintenance, safety and environment, blood bank and transfusion, point of care testing, and leadership and governance, each triple-mapped to the current TJC standards, the CAP checklist requirement, and the specific 42 CFR Part 493 section. A live dashboard scores readiness by domain, findings are tracked with owner assignment and due dates (Compliant, Needs Attention, Immediate Action, or N/A), and results export to share with the medical director or designee. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections. Included in the Clinic plan and above.</p>`;
}
function renderVeritaMapContent(): string {
  return `<h2>VeritaMap&#8482; test-menu regulatory map</h2><p>VeritaMap&#8482; is the master regulatory map for a laboratory's test menu. For every test the laboratory performs, VeritaMap&#8482; documents the CLIA complexity, proficiency testing enrollment, competency assignment, linearity and correlation requirements, quality control obligations and IQCP status, reference range source, and SOP location, each mapped to the exact 42 CFR Part 493 and TJC standard that requires it. Laboratories can filter by specialty, sort by complexity to surface every high-complexity test, and track review cycles with Last Verified and Verified By columns. The regulatory-gap column links directly to VeritaScan&#8482; findings, so menu-level gaps connect to the self-inspection. Free for up to 4 instruments and 10 analytes; included in the Clinic plan and above. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaCompContent(): string {
  return `<h2>VeritaComp&#8482; competency assessment</h2><p>VeritaComp&#8482; manages laboratory competency assessment across all three types in one system: technical competency (the six CLIA-required assessment methods per method group for non-waived testing staff, semiannual in year one and annual thereafter), waived testing competency (two of four methods per test), and non-technical competency for phlebotomy, specimen processing, LIS, and other non-testing duties. It integrates with VeritaMap&#8482; to auto-import instruments and suggest method groups, and with VeritaScan&#8482; so completed assessments auto-check the competency domain of the self-inspection. Each employee carries an assessment history with due-date tracking and remediation plans, and every completed assessment generates a PDF with the medical director or designee signature on page 1. Whether the laboratory is accredited by TJC, CAP, or COLA, or operates under CLIA only, VeritaComp&#8482; provides the documentation framework surveyors expect. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
// Batch 2 (2026-07-17): the last two product pages. Requirement counts and
// chapter lists below are the live page's own ACCREDITOR_PROFILES values
// (client/src/pages/VeritaPolicyPage.tsx), not restated from memory.
function renderVeritaPolicyContent(): string {
  return `<h2>VeritaPolicy&#8482; policy and procedure management</h2><p>VeritaPolicy&#8482; is version-controlled policy and procedure management for clinical laboratories. It pre-loads every policy requirement your accreditor expects, organized by chapter and mapped to the current standard for laboratory accreditation: 88 requirements for The Joint Commission (APR, DC, EC, EM, HR, IC, IM, LD, PI, QSA, SE, TS, WT), 65 for the College of American Pathologists (GEN, COM, CHM, HEM, MIC, IMM, TRM, MOL), 81 for COLA (QC, GLS, PRE, PT, PST, VER, CA), and 286 for CLIA-only laboratories (42 CFR Part 493, Subparts H, J, K, and M). The requirement set shown matches your laboratory's accreditation choice, and the counts are generated from the master citation index. Not every policy applies to every laboratory, so any requirement or whole category can be marked N/A, with bulk actions to configure your scope quickly. Track staff acknowledgments and document review cycles so the policy manual stays survey-ready. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaStaffContent(): string {
  return `<h2>VeritaStaff&#8482; laboratory personnel management</h2><p>VeritaStaff&#8482; is laboratory personnel management: staff roster, CLIA role assignments, competency scheduling, and CMS 209 generation in one place. Every CLIA-certified laboratory must maintain accurate personnel records and demonstrate that staff qualifications match their assigned roles and testing responsibilities. VeritaStaff&#8482; maintains the complete roster with credentials, hire dates, and qualification tracking; assigns the CLIA roles (laboratory director, clinical consultant, technical consultant, technical supervisor, general supervisor, and testing personnel) with specialty coverage across all 17 CMS specialty categories; and auto-generates a pre-filled CMS 209 Laboratory Personnel Report, one row per specialty per person. Its competency timeline engine calculates the Initial, 6-month, 1st Annual, and Annual milestones, with rule sets built in for TJC, CAP, COLA, CLIA-only, and New York State, and early completion recalculates due dates from the actual completion date. It integrates with VeritaMap&#8482; to import departments and suggest technical consultant and technical supervisor specialties. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}

// Batch 3 (2026-07-17): the remaining product pages that were still a ~520-char
// shell. Copy is each page's own content (hero, FEATURES arrays), not restated
// from memory.
//
// VeritaBench is deliberately absent. /veritabench renders VeritaPace: the h1,
// the useSEO title and the hero all say VeritaPace, and there is no /veritapace
// route. A "VeritaBench is..." block there would publish a product identity the
// page itself contradicts. Blocked on a product decision, not a copy one.
//
// No VeritaStock host branch needed: on STOCK_DEPLOYMENT the route handler
// returns the shell WITHOUT calling injectSeoTags (see the handler below), so
// these bodies only ever render on veritaslabservices.com.
function renderVeritaTrackContent(): string {
  return `<h2>VeritaTrack&#8482; regulatory calendar and sign-off</h2><p>VeritaTrack&#8482; replaces the binders and clipboards a laboratory uses to document daily, weekly, and monthly QC. It builds itself from the test menu rather than from data entry: one click imports VeritaMap&#8482;, and every analyte that is not waived gets its calibration verification, its correlation, its precision verification, and its SOP review, each on its own frequency and each tied back to the analyte and the instrument it runs on. Waived analytes are skipped automatically, because complexity arrives with the test from its FDA classification rather than being decided by hand.</p><p>Configure recurring daily, weekly, monthly, and custom-cadence tasks across instruments and departments. Status is color-coded Done, Due Soon, Overdue, and Not Started, with due-date alerts so nothing slips through the cracks. Capture sign-offs with timestamps and analyst initials, keep the complete history with notes, and export any date range to Excel for inspector documentation. A sign-off sets the next due date from that task's own frequency and writes the completion date back into VeritaMap&#8482;, so the menu and the calendar cannot drift apart. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaPTContent(): string {
  return `<h2>VeritaPT&#8482; proficiency testing tracking</h2><p>VeritaPT&#8482; tracks proficiency testing enrollment, survey results, and corrective actions by analyte. Record each analyte you are enrolled for with its PT provider, program code, and specialty. Log the result for each event alongside the peer mean, the peer standard deviation, and the acceptable range; the standard deviation index is calculated for you. For any unacceptable result, close the loop in the record itself: root cause, action taken, and verification, which is what 42 CFR 493.801 and the CAP checklist require. Download a surveyor-ready PDF covering every enrollment, every event, and every corrective action, with full PT history by analyte, and have it in hand before the survey window opens. VeritaPT&#8482; integrates with VeritaScan&#8482; to auto-complete the proficiency testing items on the self-inspection checklist. Built by a former Joint Commission laboratory surveyor with more than 200 facility inspections.</p>`;
}
function renderVeritaLabContent(): string {
  return `<h2>VeritaLab&#8482; certificate and accreditation tracking</h2><p>VeritaLab&#8482; is centralized storage for a laboratory's accreditation certificates, licenses, and supporting documents. The CLIA certificate is auto-populated from your account lookup data; add CAP accreditation, TJC accreditation, state licenses, and laboratory director licenses alongside it. Configurable expiration reminders go out at 9 months, 6 months, 3 months, 30 days, and at expiration, delivered by email to the account owner, and the system auto-detects missing expiration dates on the auto-populated CLIA records so a blank does not read as a pass.</p><p>Upload and archive the actual certificate PDFs, scanned images, and supporting documents, so during a survey or a renewal you retrieve them instead of scrambling for paperwork. Status is color-coded expired, expiring soon, current, or no date entered, with certificate type badges for CLIA, CAP, TJC, state, and other, and the whole register exports to Excel with the status colors and days-until-expiration calculations intact. Built by a former Joint Commission laboratory surveyor who has reviewed certificate records at more than 200 facilities.</p>`;
}
function renderVeritaStockContent(): string {
  return `<h2>VeritaStock&#8482; inventory and reagent management</h2><p>VeritaStock&#8482; tracks reagent and supply inventory across departments with burn-rate par levels, lead-time-aware reorder alerts, and expiration tracking. Days on hand and reorder points are calculated from real consumption and real vendor lead times rather than from a number somebody typed once, so the reorder point moves when the burn rate moves. Expiration tracking carries a configurable warning window per item, and standing orders are managed with quarterly review reminders. Status is color-coded Reorder Now, Expiring Soon, OK, and Standing Order, so a shelf that is about to bite you is visible before it does. Included with VeritaAssure&#8482; Suite plans on Clinic, Community, Hospital, and Enterprise.</p>`;
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
  let noscriptInner = `<h1>${meta.title}</h1><p>${meta.description}</p><nav><a href="/">Home</a> | <a href="/veritaassure">VeritaAssure&#8482;</a> | <a href="/veritacheck">VeritaCheck&#8482;</a> | <a href="/veritascan">VeritaScan&#8482;</a> | <a href="/veritamap">VeritaMap&#8482;</a> | <a href="/pricing">Pricing</a> | <a href="/contact">Contact</a></nav>`;
  if (routePath === "/resources/clia-tea-lookup") {
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
  } else if (routePath === "/veritapolicy") {
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
    // Never intercept API routes - let Express route handlers handle them
    if (req.path.startsWith("/api")) {
      return next();
    }
    // If the request looks like a file (has an extension), return 404 instead of index.html
    if (req.path.match(/\.[a-zA-Z0-9]+$/)) {
      return next();
    }
    // Serve the index shell via getIndexHtml so the VeritaStock deployment flag
    // is injected on app routes too (not just the SEO-prerendered marketing ones).
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(getIndexHtml(distPath));
  });
}
