// scripts/verify-veritamap-mayo-removed.mjs
//
// Receipt for removing the Mayo Clinic critical-values feature from VeritaMap
// (Michael, 2026-07-10: "The mayo clinic portion should be removed. It never
// worked as intended. Provide a link to Mayo criticals in the resource tab, but
// take that mention out of veritamap. Leave the ability for the lab to record
// their critical values if they so choose.")
//
// Asserts the Mayo layer is gone from the VeritaMap surface, the Resources-tab
// reference LINK is preserved, and the lab-entered critical-value columns remain.
//
//   node scripts/verify-veritamap-mayo-removed.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const data = read("server/veritamapData.ts");
const routes = read("server/routes.ts");

// 1. The dead lookup table is gone, and its import with it.
ok("MAYO_CRITICAL_VALUES table removed from veritamapData.ts", !/MAYO_CRITICAL_VALUES/.test(data));
ok("MAYO_CRITICAL_VALUES no longer imported in routes.ts", !/MAYO_CRITICAL_VALUES/.test(routes));
ok("no 'Mayo' anywhere in veritamapData.ts", !/mayo/i.test(data));

// 2. Export headers are plain (no Mayo / no "starting point").
ok('export headers are plain "Critical Low", "Critical High"',
  /"Critical Low", "Critical High",/.test(routes));
ok("no 'Mayo' left in the VeritaMap export header/note copy of routes.ts",
  !/Critical (Low|High) \(Mayo/.test(routes) && !/Mayo Clinic Laboratories are a STARTING POINT/.test(routes));

// 3. Client How-To copy: Mayo critical-value promise gone from all 5 VeritaMap pages.
const pages = ["VeritaMapAppPage", "VeritaMapBuildPage", "VeritaMapLabwidePage", "VeritaMapMapPage", "VeritaMapResourcesPage"];
for (const p of pages) {
  const src = read(`client/src/pages/${p}.tsx`);
  ok(`${p}: How-To no longer sources critical values "from Mayo Clinic Laboratories"`,
    !/from Mayo Clinic Laboratories/.test(src));
}

// 4. Only the Resources page may still mention Mayo, and ONLY as the reference link.
for (const p of pages) {
  const src = read(`client/src/pages/${p}.tsx`);
  if (p === "VeritaMapResourcesPage") continue;
  ok(`${p}: no 'Mayo' mention at all`, !/mayo/i.test(src));
}
const resources = read("client/src/pages/VeritaMapResourcesPage.tsx");
ok("Resources tab STILL links the Mayo critical-values reference (kept per Michael)",
  /mayocliniclabs\.com\/test-catalog\/overview\/63264/.test(resources));

// 5. Lab-entered critical-value capability is preserved (columns + How-To step).
ok("export still has lab-entered Critical Low/High + MEC Reviewed/Approved columns",
  /"Critical Low", "Critical High",/.test(routes) && /"MEC Reviewed\/Approved",/.test(routes));
ok("How-To still invites the lab to record its own MEC-adopted critical values",
  pages.some((p) => /MEC-adopted critical values/.test(read(`client/src/pages/${p}.tsx`))));

console.log(fails === 0 ? "\n=== VERITAMAP MAYO REMOVAL: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
