// scripts/add-sitemap-lastmod.mjs
//
// Adds <lastmod> to client/public/sitemap.xml, derived from the REAL last git
// commit date of each page's source component. Google's guidance is "accurate
// lastmod or omit it" — uniform build-date stamps get a sitemap distrusted —
// so this resolves each <loc> to its page file via the App.tsx route table and
// uses `git log -1 --format=%cs`. URLs that can't be mapped to a single file
// (dynamic/shared routes) are left without lastmod rather than given a guess.
//
// Re-run after route or page changes. Run: node scripts/add-sitemap-lastmod.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const SITEMAP = "client/public/sitemap.xml";
const APP = "client/src/App.tsx";
const ORIGIN = "https://www.veritaslabservices.com";

const app = readFileSync(APP, "utf8");

// component name -> file path
const compToFile = {};
for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["']@\/pages\/([^"']+)["']/g)) {
  compToFile[m[1]] = `client/src/pages/${m[2]}.tsx`;
}
// route path -> component name. Two route syntaxes are used in App.tsx:
//   <Route path="/x" component={XPage} />
//   <Route path="/x">{wrapLegacy(XPage)}</Route>   (children-render)
const pathToComp = {};
for (const m of app.matchAll(/<Route\s+path=["']([^"']+)["']\s+component=\{(\w+)\}/g)) {
  pathToComp[m[1]] = m[2];
}
for (const m of app.matchAll(/<Route\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/Route>/g)) {
  const p = m[1];
  if (pathToComp[p]) continue;
  const id = [...m[2].matchAll(/\b([A-Z]\w+)\b/g)].map((x) => x[1]).find((c) => compToFile[c]);
  if (id) pathToComp[p] = id;
}

const gitDate = (file) => {
  if (!existsSync(file)) return null;
  try {
    return execSync(`git log -1 --format=%cs -- "${file}"`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
};

let mapped = 0;
let unmapped = [];
const sitemap = readFileSync(SITEMAP, "utf8");
const out = sitemap.replace(/<url>([\s\S]*?)<\/url>/g, (full, inner) => {
  if (inner.includes("<lastmod>")) return full; // idempotent
  const loc = inner.match(/<loc>([^<]+)<\/loc>/);
  if (!loc) return full;
  let p = loc[1].replace(ORIGIN, "");
  p = p.replace(/\/$/, "") || "/";
  const comp = pathToComp[p];
  const file = comp ? compToFile[comp] : null;
  const date = file ? gitDate(file) : null;
  if (!date) {
    unmapped.push(p);
    return full;
  }
  mapped++;
  return full.replace("</url>", `<lastmod>${date}</lastmod></url>`);
});

writeFileSync(SITEMAP, out);
console.log(`lastmod added to ${mapped} URLs (git-derived).`);
if (unmapped.length) console.log(`left without lastmod (unmapped to a single page file): ${unmapped.join(", ")}`);
