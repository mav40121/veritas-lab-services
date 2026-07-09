// scripts/verify-veritacheck-seo.mjs
//
// Receipt for the VeritaCheck SEO/GEO repositioning (2026-07-09, SEO agent
// package item 1). VeritaCheck was described as a standalone "EP evaluation
// tool"; it is now positioned as the performance-verification module of the
// VeritaAssure compliance platform, built by a former Joint Commission surveyor,
// with a crawlable server-rendered feature block and a SoftwareApplication
// featureList.
//
// Two modes:
//   node scripts/verify-veritacheck-seo.mjs           -> source assertions (pre-merge)
//   BASE=https://www.veritaslabservices.com node scripts/verify-veritacheck-seo.mjs
//                                                      -> also curls /veritacheck as
//                                                         Googlebot and checks the raw HTML
//
// Source of truth: client/index.html (site-wide JSON-LD + keywords),
// server/seo-metadata.ts (server-injected per-route title/description),
// server/static.ts (crawlable noscript body). Repo = intended, curl = shipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let fails = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) fails++;
}

// --- client/index.html: site-wide SoftwareApplication + keywords ---
const indexHtml = read("client/index.html");
check("index.html: no 'EP evaluation' string remains", !/EP evaluation/i.test(indexHtml));
check("index.html: VeritaCheck node has featureList", /"featureList"\s*:\s*\[/.test(indexHtml));
check("index.html: featureList cites CLSI EP15", /Precision verification per CLSI EP15/.test(indexHtml));
check("index.html: featureList cites Deming regression", /Deming regression/.test(indexHtml));
check("index.html: featureList cites 42 CFR Part 493 TEa", /42 CFR Part 493 total allowable error/.test(indexHtml));
check("index.html: SoftwareApplication description repositions to platform module", /performance-verification and compliance software from VeritaAssure/.test(indexHtml));
check("index.html: keywords carry performance verification terms", /laboratory performance verification software/.test(indexHtml));

// --- server/seo-metadata.ts: server-injected /veritacheck title + description ---
const seoMeta = read("server/seo-metadata.ts");
const vcEntry = seoMeta.slice(seoMeta.indexOf('"/veritacheck"'), seoMeta.indexOf('"/veritascan"'));
check("seo-metadata: /veritacheck title repositioned", /Performance Verification \| CLIA Calibration Verification and Method Comparison/.test(vcEntry));
check("seo-metadata: /veritacheck description cites CLSI EP15 + surveyor", /CLSI EP15/.test(vcEntry) && /former Joint Commission surveyor/.test(vcEntry));
check("seo-metadata: /veritacheck description drops generic 'EP studies' framing", !/Run EP studies/.test(vcEntry));

// --- server/static.ts: crawlable noscript feature block ---
const staticTs = read("server/static.ts");
check("static.ts: renderVeritaCheckContent defined", /function renderVeritaCheckContent\(\)/.test(staticTs));
check("static.ts: /veritacheck wired into noscript chain", /routePath === "\/veritacheck"[\s\S]{0,80}renderVeritaCheckContent\(\)/.test(staticTs));
for (const term of [
  "Calibration Verification / Linearity",
  "Correlation / Method Comparison with Deming regression",
  "CLSI EP15",
  "CLSI EP26",
  "42 CFR Part 493 total allowable error",
  "former Joint Commission laboratory surveyor",
  "module of the VeritaAssure",
]) {
  check(`static.ts: feature block mentions "${term}"`, staticTs.includes(term));
}
check("static.ts: feature block keeps 'verify' not 'validate' framing", !/\bvalidate performance\b/i.test(staticTs));

// --- optional live check (post-deploy Gate 3) ---
const BASE = process.env.BASE || "";
if (!BASE) {
  console.log("\n(skip live curl: set BASE=https://www.veritaslabservices.com to check shipped HTML)");
  console.log(fails === 0 ? "\n=== VERITACHECK SEO (source): PASS ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}

const res = await fetch(`${BASE}/veritacheck`, { headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
const html = await res.text();
check(`live: GET ${BASE}/veritacheck -> 200`, res.status === 200);
check("live: raw HTML contains the crawlable feature block (CLSI present)", /CLSI/.test(html));
check("live: raw HTML contains 'Correlation / Method Comparison'", /Correlation \/ Method Comparison/.test(html));
check("live: raw HTML SoftwareApplication carries featureList", /"featureList"/.test(html));
check("live: raw HTML no longer says 'EP evaluation'", !/EP evaluation/i.test(html));

console.log(fails === 0 ? "\n=== VERITACHECK SEO (source + live): PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
