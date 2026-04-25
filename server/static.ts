import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { seoMetadataMap, getBaseUrl, type SEOMetadata } from "./seo-metadata";

let cachedIndexHtml: string | null = null;

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

  // Inject noscript content inside <div id="root">
  const noscriptBlock = `<noscript><h1>${meta.title}</h1><p>${meta.description}</p><nav><a href="/">Home</a> | <a href="/veritaassure">VeritaAssure&#8482;</a> | <a href="/veritacheck">VeritaCheck&#8482;</a> | <a href="/veritascan">VeritaScan&#8482;</a> | <a href="/veritamap">VeritaMap&#8482;</a> | <a href="/pricing">Pricing</a> | <a href="/contact">Contact</a></nav></noscript>`;
  html = html.replace('<div id="root"></div>', `<div id="root">${noscriptBlock}</div>`);

  return html;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

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
