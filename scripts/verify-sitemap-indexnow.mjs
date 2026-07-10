// scripts/verify-sitemap-indexnow.mjs
//
// Receipt for the durable sitemap + auto-IndexNow build (SEO/GEO package item 2).
// Exercises the three moving parts without touching the network:
//   1. build-sitemap --check passes on the committed sitemap (no missing public
//      route, no app/auth leakage).
//   2. The committed sitemap contains /security (the drift the generator fixed)
//      and excludes /veritatrack-app (an app route).
//   3. sitemap-changed-urls emits exactly a new <loc> and a changed <lastmod>,
//      and nothing for an unchanged file. This is what the push-to-main workflow
//      feeds to scripts/ping-indexnow.mts.
//
//   node scripts/verify-sitemap-indexnow.mjs

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// 1. --check passes on the committed sitemap.
let checkExit = 0;
try { execSync("node scripts/build-sitemap.mjs --check", { stdio: "pipe" }); }
catch { checkExit = 1; }
ok("build-sitemap --check exits 0 on committed sitemap", checkExit === 0);

// 2. sitemap content: /security present, /veritatrack-app absent, all have lastmod.
const sm = readFileSync("client/public/sitemap.xml", "utf8");
ok("sitemap contains /security (drift fixed)", /<loc>https:\/\/www\.veritaslabservices\.com\/security<\/loc>/.test(sm));
ok("sitemap excludes the /veritatrack-app app route", !/\/veritatrack-app</.test(sm));
const urlBlocks = sm.match(/<url>[\s\S]*?<\/url>/g) || [];
ok("every <url> carries a well-formed <lastmod>", urlBlocks.every((b) => /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(b)));

// 3. changed-urls extractor on fixtures.
const dir = mkdtempSync(join(tmpdir(), "sitemap-"));
const wrap = (urls) => `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u.loc}</loc>${u.lm ? `<lastmod>${u.lm}</lastmod>` : ""}</url>`).join("")}</urlset>`;
const A = join(dir, "old.xml"), B = join(dir, "new.xml");
writeFileSync(A, wrap([
  { loc: "https://www.veritaslabservices.com/a", lm: "2026-01-01" },
  { loc: "https://www.veritaslabservices.com/b", lm: "2026-01-01" },
]));
writeFileSync(B, wrap([
  { loc: "https://www.veritaslabservices.com/a", lm: "2026-02-02" }, // lastmod changed
  { loc: "https://www.veritaslabservices.com/b", lm: "2026-01-01" }, // unchanged
  { loc: "https://www.veritaslabservices.com/c", lm: "2026-02-02" }, // new
]));
const changed = execSync(`node scripts/sitemap-changed-urls.mjs "${A}" "${B}"`, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
ok("changed-urls emits the new URL (/c)", changed.includes("https://www.veritaslabservices.com/c"));
ok("changed-urls emits the lastmod-changed URL (/a)", changed.includes("https://www.veritaslabservices.com/a"));
ok("changed-urls omits the unchanged URL (/b)", !changed.includes("https://www.veritaslabservices.com/b"));
ok("changed-urls emits exactly the 2 changed URLs", changed.length === 2);
const same = execSync(`node scripts/sitemap-changed-urls.mjs "${B}" "${B}"`, { encoding: "utf8" }).trim();
ok("changed-urls emits nothing when the file is unchanged", same === "");

console.log(fails === 0 ? "\n=== SITEMAP + INDEXNOW: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
