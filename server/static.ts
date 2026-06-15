import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { seoMetadataMap, getBaseUrl, type SEOMetadata } from "./seo-metadata";
import { teaData } from "../client/src/lib/cliaTeaData";

let cachedIndexHtml: string | null = null;

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

function getIndexHtml(distPath: string): string {
  if (!cachedIndexHtml) {
    cachedIndexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
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
      const html = getIndexHtml(distPath);
      const injectedHtml = injectSeoTags(html, routePath, meta);
      res.setHeader("Content-Type", "text/html");
      return res.send(injectedHtml);
    }

    next();
  });

  app.use(express.static(distPath));

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
    // Non-public routes get default sendFile behavior
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
