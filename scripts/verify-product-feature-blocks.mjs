// scripts/verify-product-feature-blocks.mjs
//
// Receipt for the product-page SEO/GEO build (2026-07-10, SEO agent, same pattern
// as PR #969's /veritacheck fix): crawlable server-rendered feature blocks +
// SoftwareApplication featureList for /veritascan, /veritamap, /veritacomp. Those
// pages had no dedicated SoftwareApplication node, so this adds one per product
// (isPartOf the VeritaAssure suite) and a server-render block in static.ts.
//
//   node scripts/verify-product-feature-blocks.mjs           source assertions
//   BASE=https://www.veritaslabservices.com node ...          + Googlebot curl per page

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// --- index.html: SoftwareApplication nodes + featureList ---
const indexHtml = read("client/index.html");
const graph = JSON.parse(indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"];
const apps = graph.filter((n) => n["@type"] === "SoftwareApplication");
for (const [name, len] of [["VeritaScan", 7], ["VeritaMap", 7], ["VeritaComp", 8]]) {
  const n = apps.find((a) => a.name === name);
  ok(`${name}: SoftwareApplication node exists`, !!n);
  ok(`${name}: featureList has ${len} items`, !!n && Array.isArray(n.featureList) && n.featureList.length === len);
  ok(`${name}: isPartOf the VeritaAssure suite`, !!n && n.isPartOf && n.isPartOf["@id"] === "https://www.veritaslabservices.com/#veritaassure");
}

// --- static.ts: crawlable feature blocks + wiring + key grounded terms ---
const staticTs = read("server/static.ts");
for (const fn of ["renderVeritaScanContent", "renderVeritaMapContent", "renderVeritaCompContent"]) {
  ok(`static.ts: ${fn} defined`, new RegExp(`function ${fn}\\(\\)`).test(staticTs));
}
for (const route of ["/veritascan", "/veritamap", "/veritacomp"]) {
  ok(`static.ts: ${route} wired into the noscript chain`, new RegExp(`routePath === "${route}"`).test(staticTs));
}
const blockTerms = [
  "168 compliance questions across 10 laboratory domains",
  "blood bank / transfusion service",
  "master regulatory map",
  "IQCP status",
  "all three types",
  "six CLIA-required assessment methods",
  "medical director or designee",
];
for (const t of blockTerms) ok(`static.ts: block mentions "${t}"`, staticTs.includes(t));
ok("static.ts: no em dashes in the product blocks", !/—/.test(staticTs));

// --- optional live curl (post-deploy Gate 3) ---
const BASE = process.env.BASE || "";
if (!BASE) {
  console.log("\n(skip live curl: set BASE to check shipped HTML)");
  console.log(fails === 0 ? "\n=== PRODUCT FEATURE BLOCKS (source): PASS ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}
const marker = {
  "/veritascan": "168 compliance questions",
  "/veritamap": "master regulatory map",
  "/veritacomp": "manages laboratory competency assessment across all three types",
};
for (const [route, mk] of Object.entries(marker)) {
  const res = await fetch(`${BASE}${route}`, { headers: { "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" } });
  const html = await res.text();
  ok(`live ${route}: 200`, res.status === 200);
  ok(`live ${route}: feature block in raw HTML`, html.includes(mk));
  ok(`live ${route}: SoftwareApplication featureList in schema`, /"featureList"/.test(html) && html.includes(`/#${route.slice(1)}`));
}
console.log(fails === 0 ? "\n=== PRODUCT FEATURE BLOCKS (source + live): PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
