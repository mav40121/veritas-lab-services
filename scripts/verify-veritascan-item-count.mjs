// scripts/verify-veritascan-item-count.mjs
//
// Receipt for the VeritaScan item-count accuracy fix (scorecard #1, 2026-07-10).
// Michael confirmed the advertised count must equal the actual number of items
// (173). This verifies: the checklist is 173 items, the public page is data-driven
// (count + domains computed from veritaScanData.ts), the stale "168" is gone
// everywhere except the persisted item id 168, the public/prerender taxonomy now
// matches the real domains, and the server demo denominators are 173 not 168.
//
//   node scripts/verify-veritascan-item-count.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const data = read("client/src/lib/veritaScanData.ts");
const page = read("client/src/pages/VeritaScanPage.tsx");
const app = read("client/src/pages/VeritaScanAppPage.tsx");
const seo = read("server/seo-metadata.ts");
const stat = read("server/static.ts");
const routes = read("server/routes.ts");

// The 10 real domains (source of truth).
const REAL_DOMAINS = [
  "Quality Systems & QC", "Calibration & Verification", "Proficiency Testing",
  "Personnel & Competency", "Test Management & Procedures", "Equipment & Maintenance",
  "Safety & Environment", "Blood Bank & Transfusion", "Point of Care Testing",
  "Leadership & Governance",
];

// 1. The checklist actually has 173 items, and they cover exactly the 10 domains.
const itemCount = (data.match(/^\s*\{\s*id:\s*\d+,/gm) || []).length;
ok(`checklist has 173 items (found ${itemCount})`, itemCount === 173);
let domainSum = 0;
for (const d of REAL_DOMAINS) {
  const c = (data.match(new RegExp(`domain: "${d.replace(/[&]/g, "\\&")}"`, "g")) || []).length;
  domainSum += c;
  ok(`domain present with items: ${d} (${c})`, c > 0);
}
ok(`per-domain counts sum to 173 (got ${domainSum})`, domainSum === 173);

// 2. Public page is data-driven.
ok("public page imports SCAN_ITEMS + DOMAINS from the data file",
  /import \{ SCAN_ITEMS, DOMAINS as SCAN_DOMAINS \} from "@\/lib\/veritaScanData"/.test(page));
ok("public page derives TOTAL_ITEMS from SCAN_ITEMS.length", /const TOTAL_ITEMS = SCAN_ITEMS\.length/.test(page));
ok("public page computes per-domain counts from the data", /SCAN_ITEMS\.filter\(\(it\) => it\.domain === label\)\.length/.test(page));
ok("public page DOMAIN_DESC covers all 10 real domains",
  REAL_DOMAINS.every((d) => page.includes(`"${d}":`)));

// 3. No stale 168 count anywhere (item id 168 in the data file is the only allowed 168).
ok("no '168' count string on the public page", !/168/.test(page));
ok("AppPage ModuleHowToCard is dynamic, no 168", !/168/.test(app) && /\$\{SCAN_ITEMS\.length\} inspection-readiness items/.test(app));
ok("data-file header comment says 173-item", /173-item compliance checklist/.test(data) && !/168-item/.test(data));

// 4. SEO + prerender corrected (count + real taxonomy).
ok("SEO description is 173-item", /173-item TJC-standard/.test(seo) && !/168-item/.test(seo));
ok("prerender says 173 compliance questions", /173 compliance questions/.test(stat) && !/168 compliance questions/.test(stat));
ok("prerender lists the real domains, not the stale taxonomy",
  /quality systems and QC/.test(stat) && !/lab administration, facility and safety/.test(stat));

// 5. Server demo denominators are 173, not 168 (fixes the scan-% math bug).
ok("no 'assessed / 168' demo denominator", !/assessed \/ 168/.test(routes));
ok("no 'const total = 168' left", !/const total = 168;/.test(routes));
ok("no 'items.length || 168' fallback", !/items\.length \|\| 168/.test(routes));
ok("Excel About walks 173 compliance questions", /walks 173 compliance questions/.test(routes) && !/walks 168 compliance questions/.test(routes));

// 6. index.html JSON-LD advertises 173, and NO count-context 168 survives anywhere
// in client/ or server/. The first pass was source-scoped and missed index.html
// plus several marketing files (faq, demo, roadmap, book, etc.); the live /veritascan
// curl caught it, so the guard now walks the whole tree instead of a hand-list.
const indexHtml = read("client/index.html");
ok("index.html JSON-LD advertises 173-item + 173 compliance questions",
  /173-item TJC-standard/.test(indexHtml) && /173 compliance questions/.test(indexHtml));

const STALE = /168[ -]?(item|compliance|standard|checklist|inspection|readiness|Item|Compliance|Items)|totalItems *= *168|total *= *168/;
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "build"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|html)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const offenders = [path.join(ROOT, "client"), path.join(ROOT, "server")]
  .flatMap((r) => walk(r))
  .filter((f) => STALE.test(fs.readFileSync(f, "utf8")))
  .map((f) => path.relative(ROOT, f));
ok(`no stale count-context 168 anywhere in client/ or server/ (offenders: ${offenders.join(", ") || "none"})`,
  offenders.length === 0);

console.log(fails === 0 ? "\n=== VERITASCAN ITEM COUNT: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
