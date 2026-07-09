import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { seoMetadataMap, getBaseUrl, type SEOMetadata } from "./seo-metadata";
import { teaData } from "../client/src/lib/cliaTeaData";

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
      const stockTitle = "VeritaStock™ | Multi-Location Inventory Management";
      const stockDesc = "Multi-location supply inventory: burn-rate par levels, lead-time-aware reorder alerts, expiration tracking, valuation by location, and one-click vendor orders.";
      const stockKeywords = "VeritaStock, multi-location inventory management, supply inventory software, par level management, reorder point alerts, expiration date tracking, lead-time verification, vendor purchase orders, barcode inventory, materials management";
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${stockTitle}</title>`)
        .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${stockDesc}"`)
        .replace(/<meta name="keywords" content="[^"]*"/, `<meta name="keywords" content="${stockKeywords}"`)
        .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${stockTitle}"`)
        .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${stockDesc}"`)
        .replace(/<meta property="og:site_name" content="[^"]*"/, `<meta property="og:site_name" content="VeritaStock | Veritas Lab Services"`)
        .replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${stockTitle}"`)
        .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${stockDesc}"`);
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
