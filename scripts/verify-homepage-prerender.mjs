// scripts/verify-homepage-prerender.mjs
//
// Receipt for the homepage SEO prerender: the site's most authoritative page ("/")
// was a ~512-char shell (title + description + nav), invisible to crawlers for the
// contested commercial queries. renderHomepageContent() must exist, be wired into
// injectSeoTags for routePath === "/", carry the category terms, link to the buyer
// guide (cluster target), state the accurate module count, and contain no em dash.
//
// Static check (reads server/static.ts) so it runs without a server, like
// verify-seo-product-prerender.mjs.
//
// Run: node scripts/verify-homepage-prerender.mjs

import { readFileSync } from "fs";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
};

const src = readFileSync(new URL("../server/static.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

check("renderHomepageContent() is defined", /function renderHomepageContent\(\)/.test(src));
check('wired into injectSeoTags for routePath === "/"',
  /if \(routePath === "\/"\) \{\s*noscriptInner \+= renderHomepageContent\(\);/.test(src));

// Isolate the function body so the term checks are about the homepage copy.
const m = src.match(/function renderHomepageContent\(\)[^{]*\{([\s\S]*?)\n\}/);
const body = m ? m[1] : "";
check("homepage copy present", body.length > 800, `len=${body.length}`);
check('contains "lab compliance software" (contested query)', /lab compliance software/i.test(body));
check('contains "laboratory compliance software"', /laboratory compliance software/i.test(body));
check('contains "laboratory compliance platform"', /laboratory compliance platform/i.test(body));
check("links to the buyer-guide cluster target",
  body.includes('href="/resources/how-to-choose-lab-compliance-software"'));
check('states "eighteen modules" (accurate count)', /eighteen modules/.test(body));
check("no em dash in homepage copy", !body.includes("—"));
check("no hash-route or localhost URL", !/\/#\/|localhost|127\.0\.0\.1/.test(body));

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
