// scripts/verify-free-ceu-catalog.mts
//
// Structural guard for the free-CE catalog surfaced in VeritaCEU. It does NOT
// re-verify that each URL is live (that is a human step recorded in
// FREE_CEU_VERIFIED); it enforces the shape so a future edit cannot silently
// ship a placeholder, a hash route, a localhost link, or an empty field. Pairs
// with the anti-fabrication rule: every entry must be a real https provider page.
//
// Run: npx tsx scripts/verify-free-ceu-catalog.mts   (exits non-zero on fail)

import { FREE_CEU_CATALOG, FREE_CEU_VERIFIED } from "../shared/freeCeuCatalog";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

check("catalog is non-empty", FREE_CEU_CATALOG.length > 0, String(FREE_CEU_CATALOG.length));
check("verified date is ISO yyyy-mm-dd", /^\d{4}-\d{2}-\d{2}$/.test(FREE_CEU_VERIFIED), FREE_CEU_VERIFIED);

// Forbidden URL shapes (URL-canonicalization rule + anti-placeholder).
const FORBIDDEN = ["/#/", "localhost", "127.0.0.1", "example.com", "TODO", "insert", "staging", "preview"];
const seen = new Set<string>();

for (const p of FREE_CEU_CATALOG) {
  const tag = p.name || p.url || "(unnamed)";
  check(`${tag}: has a name`, !!p.name && p.name.trim().length > 1);
  check(`${tag}: https url`, /^https:\/\//i.test(p.url || ""), p.url);
  // A real host has a dot and is not a placeholder.
  let host = "";
  try { host = new URL(p.url).hostname; } catch { /* leaves host empty -> fails next */ }
  check(`${tag}: url parses to a real host`, host.includes("."), host);
  check(`${tag}: url has no forbidden fragment`, !FORBIDDEN.some((f) => (p.url || "").toLowerCase().includes(f.toLowerCase())), p.url);
  check(`${tag}: no duplicate url`, !seen.has(p.url), p.url);
  seen.add(p.url);
  check(`${tag}: has >=1 credit type`, Array.isArray(p.creditTypes) && p.creditTypes.length > 0);
  check(`${tag}: credit types non-empty`, (p.creditTypes || []).every((c) => typeof c === "string" && c.trim().length > 0));
  check(`${tag}: description present`, !!p.description && p.description.trim().length >= 20);
  check(`${tag}: access note present`, !!p.access && p.access.trim().length >= 10);
  // Public-facing copy: no em dash in description or access.
  check(`${tag}: no em dash in copy`, !`${p.description} ${p.access}`.includes("—"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
