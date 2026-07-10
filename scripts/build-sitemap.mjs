// scripts/build-sitemap.mjs
//
// Durable sitemap generator (SEO/GEO package item 2, part A). The public URL set
// is OWNED by this script and derived from server/seo-metadata.ts seoMetadataMap
// (minus app/auth routes), so a new public route can never silently miss the
// sitemap again. Per-URL <changefreq>/<priority> curation and section grouping
// are INHERITED from the existing client/public/sitemap.xml (this file is
// hand-tuned; we do not flatten it). <lastmod> is refreshed from the REAL git
// commit date of each route's page source (resolved via the App.tsx route table,
// including lazy() imports), but only ever moved FORWARD so a curated date is
// never regressed. Supersedes scripts/add-sitemap-lastmod.mjs.
//
// Modes:
//   node scripts/build-sitemap.mjs --write   regenerate and write the sitemap
//   node scripts/build-sitemap.mjs --check    fail (exit 1) if the COMMITTED sitemap
//                                             is missing a public route or carries an
//                                             app/auth route. Absent <lastmod> is warned,
//                                             not failed (some routes have no single
//                                             source file). This is the CI staleness gate.
//   node scripts/build-sitemap.mjs            same as --check (default, non-mutating)
//
// Gate 3 (part A): add a throwaway public route to seoMetadataMap, run --write,
// confirm it appears in the sitemap with a git-derived <lastmod>; run --check on
// the un-regenerated tree and confirm it fails on the missing route.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const SITEMAP = "client/public/sitemap.xml";
const APP = "client/src/App.tsx";
const META = "server/seo-metadata.ts";
const ORIGIN = "https://www.veritaslabservices.com";

// Routes that carry SEO metadata for signed-in landing but must NOT be crawled:
// the authenticated app shells and any auth/kiosk paths. Content only in the sitemap.
const AUTH_DENY = new Set([
  "/login", "/signup", "/register", "/account", "/settings", "/logout",
  "/inventory", "/staff-access", "/reset-password", "/forgot-password", "/verify-email",
]);
const isAppRoute = (p) => AUTH_DENY.has(p) || /-app(\/|$)/.test(p);

// Default curation for a brand-new route (only used until a human tunes it).
function defaultCuration(path) {
  if (path.startsWith("/resources/")) return { changefreq: "monthly", priority: "0.7", section: "Resources / Articles" };
  if (path.startsWith("/demo")) return { changefreq: "monthly", priority: "0.6", section: "Demos" };
  if (path.startsWith("/verita") || path === "/operations") return { changefreq: "monthly", priority: "0.7", section: "Product pages (Compliance stream)" };
  if (path === "/terms" || path === "/privacy" || path === "/security") return { changefreq: "yearly", priority: "0.3", section: "Legal" };
  return { changefreq: "monthly", priority: "0.5", section: "Core marketing pages" };
}

// --- route -> page source file, from App.tsx (import X and lazy(() => import(X))) ---
const app = readFileSync(APP, "utf8");
const compToFile = {};
for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["']@\/pages\/([^"']+)["']/g)) compToFile[m[1]] = `client/src/pages/${m[2]}.tsx`;
for (const m of app.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/pages\/([^"']+)["']/g)) compToFile[m[1]] = `client/src/pages/${m[2]}.tsx`;
const pathToComp = {};
for (const m of app.matchAll(/<Route\s+path=["']([^"']+)["']\s+component=\{(\w+)\}/g)) pathToComp[m[1]] = m[2];
for (const m of app.matchAll(/<Route\s+path=["']([^"']+)["']\s*>([\s\S]*?)<\/Route>/g)) {
  if (pathToComp[m[1]]) continue;
  const id = [...m[2].matchAll(/\b([A-Z]\w+)\b/g)].map((x) => x[1]).find((c) => compToFile[c]);
  if (id) pathToComp[m[1]] = id;
}
const gitDate = (file) => {
  if (!file || !existsSync(file)) return null;
  try { return execSync(`git log -1 --format=%cs -- "${file}"`, { encoding: "utf8" }).trim() || null; }
  catch { return null; }
};
const lastmodFor = (path) => gitDate(compToFile[pathToComp[path]]);

// --- public route set from seoMetadataMap ---
const meta = readFileSync(META, "utf8");
const metaKeys = [...meta.matchAll(/^\s*"(\/[^"]*)":\s*\{/gm)].map((m) => m[1]);
const publicRoutes = metaKeys.filter((p) => !isAppRoute(p));

// --- parse the existing sitemap into ordered sections, preserving curation ---
const existing = existsSync(SITEMAP) ? readFileSync(SITEMAP, "utf8") : "";
const sections = []; // { title, entries: [{ path, changefreq, priority, lastmod }] }
let cur = null;
for (const l of existing.split(/\r?\n/)) {
  const sec = l.match(/^\s*<!--\s*(.*?)\s*-->\s*$/);
  if (sec) { cur = { title: sec[1], entries: [] }; sections.push(cur); continue; }
  const u = l.match(/<loc>([^<]+)<\/loc>/);
  if (!u) continue;
  if (!cur) { cur = { title: "Core marketing pages", entries: [] }; sections.push(cur); }
  const path = u[1].replace(ORIGIN, "").replace(/\/$/, "") || "/";
  const cf = l.match(/<changefreq>([^<]+)<\/changefreq>/);
  const pr = l.match(/<priority>([^<]+)<\/priority>/);
  const lm = l.match(/<lastmod>([^<]+)<\/lastmod>/);
  cur.entries.push({ path, changefreq: cf ? cf[1] : "monthly", priority: pr ? pr[1] : "0.5", lastmod: lm ? lm[1] : null });
}

// Snapshot the COMMITTED state before any write-mode reconciliation.
const committedPaths = new Set(sections.flatMap((s) => s.entries.map((e) => e.path)));

// --- CHECK MODE: validate the committed file, do not mutate ---
const mode = process.argv.includes("--write") ? "write" : "check";
if (mode === "check") {
  const problems = [];
  const warnings = [];
  for (const p of publicRoutes) if (!committedPaths.has(p)) problems.push(`MISSING public route (run --write): ${p}`);
  for (const s of sections) for (const e of s.entries) {
    if (isAppRoute(e.path)) problems.push(`APP/AUTH route must not be in the sitemap: ${e.path}`);
    if (!e.lastmod || !/^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)) warnings.push(`no <lastmod>: ${e.path}`);
  }
  warnings.forEach((w) => console.warn("  (warn) " + w));
  if (problems.length) {
    console.error("Sitemap staleness gate FAILED:");
    problems.forEach((p) => console.error("  - " + p));
    console.error(`\nFix: node scripts/build-sitemap.mjs --write   (then commit client/public/sitemap.xml)`);
    process.exit(1);
  }
  console.log(`Sitemap OK: ${publicRoutes.length} public routes present, no app/auth leakage${warnings.length ? `, ${warnings.length} without lastmod` : ""}.`);
  process.exit(0);
}

// --- WRITE MODE: reconcile (drop app routes, move lastmod forward, add missing) ---
const maxDate = (a, b) => (!a ? b : !b ? a : b > a ? b : a);
const dropped = [];
for (const s of sections) {
  s.entries = s.entries.filter((e) => {
    if (isAppRoute(e.path)) { dropped.push(e.path); return false; }
    e.lastmod = maxDate(e.lastmod, lastmodFor(e.path)); // only ever forward
    return true;
  });
}
const seen = new Set(sections.flatMap((s) => s.entries.map((e) => e.path)));
const added = [];
for (const path of publicRoutes) {
  if (seen.has(path)) continue;
  const c = defaultCuration(path);
  let target = sections.find((s) => s.title === c.section) || (sections.push({ title: c.section, entries: [] }), sections[sections.length - 1]);
  target.entries.push({ path, changefreq: c.changefreq, priority: c.priority, lastmod: lastmodFor(path) });
  added.push(path);
}

const loc = (p) => `${ORIGIN}${p === "/" ? "/" : p}`;
const line = (e) => `  <url><loc>${loc(e.path)}</loc><changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ""}</url>`;
let out = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
for (const s of sections) {
  if (!s.entries.length) continue;
  out += `\n  <!-- ${s.title} -->\n`;
  for (const e of s.entries) out += line(e) + "\n";
}
out += `\n</urlset>\n`;
writeFileSync(SITEMAP, out);
console.log(`Wrote ${SITEMAP}: ${sections.reduce((n, s) => n + s.entries.length, 0)} URLs.`);
if (added.length) console.log(`Added: ${added.join(", ")}`);
if (dropped.length) console.log(`Dropped app/auth routes: ${dropped.join(", ")}`);
