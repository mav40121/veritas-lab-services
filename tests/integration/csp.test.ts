// tests/integration/csp.test.ts
//
// Content-Security-Policy (2026-10-16, Q47 = 1; server/securityHeaders.ts). Pins:
//   1. inline-script hashes: executable inline scripts only (no src, no JSON-LD), plus the two snippets
//      server/static.ts injects; hashed after CRLF -> LF normalization, as browsers do (a Windows-built
//      index.html has CRLF and the raw hash never matched: the first enforced crawl blocked GA4)
//   2. the policy: no 'unsafe-inline' / 'unsafe-eval' in script-src, frame-ancestors, base-uri, report-uri
//   3. enforced by default; Report-Only with CSP_REPORT_ONLY=1
//   4. report parsing keeps only directive, blocked origin and the page path (no query, ids collapsed)
//   5. POST /api/csp-report counts by (directive, blocked, page) and returns 204; the admin read is secret-gated
// Run: npm run test:csp

import http from "node:http";
import express from "express";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { inlineScriptHashes, buildCsp, cspHeaderName, summarizeCspReport, INJECTED_INLINE_SCRIPTS } from "../../server/securityHeaders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const h = (s: string) => `'sha256-${crypto.createHash("sha256").update(s, "utf8").digest("base64")}'`;

async function main() {
  // 1) hashes
  const ga = "\n      window.dataLayer = window.dataLayer || [];\n      gtag('js', new Date());\n    ";
  const html = [
    "<html><head>",
    '<script type="application/ld+json">{"@context":"https://schema.org"}</script>',
    '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>',
    `<script>${ga.replace(/\n/g, "\r\n")}</script>`,
    '<script type="module" src="/src/main.tsx"></script>',
    "</head></html>",
  ].join("\n");
  const hashes = inlineScriptHashes(html);
  check("1a. the CRLF inline script is hashed as the browser sees it (LF)", hashes.includes(h(ga)), hashes.join(" "));
  check("1b. JSON-LD and src scripts are not hashed; the two injected snippets are", hashes.length === 1 + INJECTED_INLINE_SCRIPTS.length && INJECTED_INLINE_SCRIPTS.every((s) => hashes.includes(h(s))), String(hashes.length));

  // 2) policy
  const csp = buildCsp(hashes);
  const scriptSrc = (csp.split("; ").find((d) => d.startsWith("script-src")) || "");
  check("2a. script-src allows only self, the hashes and GA4; no 'unsafe-inline' or 'unsafe-eval'", !/unsafe-(inline|eval)/.test(scriptSrc) && scriptSrc.includes("https://www.googletagmanager.com") && scriptSrc.includes(h(ga)));
  check("2b. clickjacking, base-tag and form hijack are closed; reports go to /api/csp-report", ["frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "default-src 'self'", "report-uri /api/csp-report"].every((d) => csp.includes(d)));

  // 3) mode
  delete process.env.CSP_REPORT_ONLY;
  check("3a. enforced by default", cspHeaderName() === "Content-Security-Policy");
  process.env.CSP_REPORT_ONLY = "1";
  check("3b. Report-Only with CSP_REPORT_ONLY=1", cspHeaderName() === "Content-Security-Policy-Report-Only");
  delete process.env.CSP_REPORT_ONLY;
  check("3c. Google Analytics' www.google.com collect call is allowed", buildCsp([]).includes("connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://www.google.com"));

  // 4) parsing
  const legacy = { "csp-report": { "document-uri": "https://www.veritaslabservices.com/labs/34/veritacomp-app/102?tab=x&email=a@b.com", "effective-directive": "script-src-elem", "blocked-uri": "https://evil.example.com/x.js?token=123" } };
  const api = [{ type: "csp-violation", body: { documentURL: "https://www.veritaslabservices.com/pricing", effectiveDirective: "img-src", blockedURL: "inline" } }];
  const a = summarizeCspReport(legacy)[0], b = summarizeCspReport(api)[0];
  check("4a. legacy report: directive, origin only, path with ids collapsed and no query", a?.directive === "script-src-elem" && a?.blocked === "https://evil.example.com" && a?.page === "/labs/:id/veritacomp-app/:id", JSON.stringify(a));
  check("4b. Reporting API report parsed", b?.directive === "img-src" && b?.blocked === "inline" && b?.page === "/pricing", JSON.stringify(b));
  check("4c. junk bodies yield nothing", summarizeCspReport(null).length === 0 && summarizeCspReport("x").length === 0);

  // 5) endpoints
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  try {
    const post = (body: any, type: string) => fetch(base + "/api/csp-report", { method: "POST", headers: { "Content-Type": type }, body: JSON.stringify(body) });
    const r1 = await post(legacy, "application/csp-report");
    const r2 = await post(legacy, "application/csp-report");
    const r3 = await post(api, "application/reports+json");
    const rows = sqlite.prepare("SELECT directive, blocked, page, count FROM csp_reports ORDER BY id").all() as any[];
    check("5a. reports accepted with 204 (legacy and Reporting API content types)", r1.status === 204 && r2.status === 204 && r3.status === 204, `${r1.status}/${r2.status}/${r3.status}`);
    check("5b. one row per (directive, blocked, page), counted", rows.length === 2 && rows[0].count === 2 && rows[1].count === 1, JSON.stringify(rows));
    check("5c. nothing identifying stored (no query string, email or token)", !JSON.stringify(rows).match(/@|token|tab=|\?/));
    const no = await fetch(base + "/api/admin/csp-reports");
    const yes = await fetch(base + `/api/admin/csp-reports?secret=${process.env.ADMIN_SECRET}`);
    const body = await yes.json() as any;
    check("5d. admin read needs the secret", no.status === 403 && yes.status === 200 && body.rows?.length === 2 && body.mode === "Content-Security-Policy", `${no.status}/${yes.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
