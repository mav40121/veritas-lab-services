// scripts/sitemap-changed-urls.mjs
//
// Emit the content URLs that CHANGED between two sitemap versions: a <loc> that
// is new, or whose <lastmod> moved. Used by the push-to-main IndexNow workflow
// so we submit exactly the URLs that changed, never the whole sitemap.
//
// Usage:
//   node scripts/sitemap-changed-urls.mjs <old-sitemap.xml> <new-sitemap.xml>
// Prints one URL per line to stdout (empty output = nothing changed). An
// unreadable/empty OLD file is treated as "no prior sitemap": every URL is new.

import { readFileSync, existsSync } from "node:fs";

function locMap(file) {
  const m = new Map();
  if (!file || !existsSync(file)) return m;
  const xml = readFileSync(file, "utf8");
  for (const block of xml.match(/<url>[\s\S]*?<\/url>/g) || []) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/);
    if (!loc) continue;
    const lm = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    m.set(loc[1].trim(), lm ? lm[1].trim() : "");
  }
  return m;
}

const [oldFile, newFile] = process.argv.slice(2);
if (!newFile) {
  console.error("Usage: node scripts/sitemap-changed-urls.mjs <old-sitemap.xml> <new-sitemap.xml>");
  process.exit(2);
}

const oldM = locMap(oldFile);
const newM = locMap(newFile);
const changed = [];
for (const [loc, lm] of newM) {
  if (!oldM.has(loc) || oldM.get(loc) !== lm) changed.push(loc);
}
// stable, deterministic order
changed.sort();
for (const u of changed) console.log(u);
