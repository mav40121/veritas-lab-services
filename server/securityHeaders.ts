// server/securityHeaders.ts
//
// Content-Security-Policy (Michael 2026-10-16, Q47 = 1: shore up the security-review gaps; a pentest
// flags a missing CSP first). Rolled out in two steps because a wrong CSP silently breaks the React
// app, fonts, GA4 and Stripe Checkout (see the note in server/index.ts):
//   1. Report-Only (default): browsers report what WOULD be blocked to POST /api/csp-report; nothing breaks.
//   2. Enforced by default since 2026-10-16 (reports were clean apart from the GA collect call, now allowed); CSP_REPORT_ONLY=1 reverts.
// Inline scripts are allowed by exact sha256 hash only (the GA4 bootstrap in index.html and the two
// one-line flags server/static.ts injects), never by 'unsafe-inline'.

import crypto from "node:crypto";
import fs from "node:fs";

// Inline <script> bodies server/static.ts may inject into index.html (keep in sync with static.ts).
export const INJECTED_INLINE_SCRIPTS = [
  "window.__STOCK_DEPLOYMENT__=true;",
  "window.__DEMO_SINGLE_SITE__=true;",
];

// Browsers hash the script text AFTER the HTML parser normalizes line endings (CRLF and lone CR become
// LF), so hash the normalized text. A Windows-built index.html has CRLF; the raw hash never matched.
const sha256 = (s: string) => `'sha256-${crypto.createHash("sha256").update(s.replace(/\r\n?/g, "\n"), "utf8").digest("base64")}'`;

// Hashes of every executable inline <script> in the served HTML. JSON-LD and other data blocks are not
// executed, so CSP does not apply to them; scripts with src are covered by the source list.
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text|application)\/(javascript|ecmascript)$|^module$/i.test(type)) continue;
    if (m[2].trim()) out.add(sha256(m[2]));
  }
  for (const s of INJECTED_INLINE_SCRIPTS) out.add(sha256(s));
  return Array.from(out);
}

export function buildCsp(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes.join(" ")} https://www.googletagmanager.com`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.google.com https://*.sentry.io",
    "frame-src 'self' blob:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    // Staff Portal read-and-sign shows policy PDFs in an <object> (StaffPortalPage.tsx), so same-origin
    // and blob: objects stay allowed; everything else (plugins, other origins) is blocked.
    "object-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "report-uri /api/csp-report",
  ].join("; ");
}

// Trial for the OWASP ZAP "CSP: Wildcard Directive" warning (2026-10-26): the enforced img-src allows images from any
// https origin. This report-only policy names the only outside image origins the site itself uses (Google Analytics'
// pixels), so /api/csp-report counts anything else a page loads (for example an image pasted into a customer's
// document) before the enforced img-src is narrowed. Sent next to the enforced policy; it blocks nothing.
export const IMG_SRC_TRIAL = "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com";
export function imgTrialCsp(): string {
  return `${IMG_SRC_TRIAL}; report-uri /api/csp-report`;
}

// Enforced by default since 2026-10-16 (Q56: one would-be block in production Report-Only, Google Analytics' collect
// call to www.google.com, now allowed). CSP_REPORT_ONLY=1 switches back to report-only without a code change.
export function cspHeaderName(): string {
  return process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

// Built once from the production index.html. Null when there is no built index.html (dev server: Vite
// injects its own inline scripts, so no CSP there).
export function loadCsp(indexHtmlPath: string): string | null {
  try {
    if (!fs.existsSync(indexHtmlPath)) return null;
    return buildCsp(inlineScriptHashes(fs.readFileSync(indexHtmlPath, "utf-8")));
  } catch {
    return null;
  }
}

// One violation report (legacy application/csp-report or Reporting API) reduced to what we keep:
// the directive, where the blocked thing came from (origin only, or inline/eval), and the page path
// (no query string, so nothing identifying is stored).
export function summarizeCspReport(body: any): Array<{ directive: string; blocked: string; page: string }> {
  const items: any[] = Array.isArray(body) ? body.map((r) => r?.body || r) : [body?.["csp-report"] || body];
  const out: Array<{ directive: string; blocked: string; page: string }> = [];
  for (const r of items) {
    if (!r || typeof r !== "object") continue;
    const directive = String(r["effective-directive"] || r.effectiveDirective || r["violated-directive"] || r.violatedDirective || "").split(" ")[0].slice(0, 60);
    const rawBlocked = String(r["blocked-uri"] || r.blockedURL || r.blockedUri || "");
    let blocked = rawBlocked.slice(0, 40);
    try { if (/^https?:/i.test(rawBlocked)) blocked = new URL(rawBlocked).origin; } catch {}
    let page = "";
    try { page = new URL(String(r["document-uri"] || r.documentURL || r.documentUri || "")).pathname.replace(/\/\d+(?=\/|$)/g, "/:id").slice(0, 120); } catch {}
    if (directive) out.push({ directive, blocked: blocked || "(none)", page: page || "(unknown)" });
  }
  return out;
}
