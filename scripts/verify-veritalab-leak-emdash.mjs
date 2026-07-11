// scripts/verify-veritalab-leak-emdash.mjs
//
// Receipt for the VeritaLab hygiene fixes (audit #8 + #10, 2026-07-10).
//
//   #8: the certificate Excel About sheet contained an em-dash ("...on file in
//   VeritaLab — CLIA..."), which violates the CLAUDE.md Sec 3 public-facing
//   em-dash ban (Sec 6.6 applies it to every About paragraph). Replaced with a
//   colon.
//
//   #10: the State Registry empty state leaked an internal admin endpoint to the
//   customer ("An administrator can run the seed via POST /api/admin/seed-state-
//   registry"). Replaced with a customer-appropriate "contact us" message.
//
//   node scripts/verify-veritalab-leak-emdash.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const routes = read("server/routes.ts");
const registry = read("client/src/components/veritalab/StateRegistryTab.tsx");

// #8 em-dash removed from the cert Excel About paragraph
ok("#8 cert Excel About no longer contains an em-dash in the register sentence",
  /on file in VeritaLab: CLIA certificate/.test(routes) &&
  !/on file in VeritaLab — CLIA/.test(routes) &&
  !/on file in VeritaLab — CLIA/.test(routes));

// #10 admin endpoint removed from the customer-facing empty state
ok("#10 State Registry empty state no longer leaks the admin seed endpoint",
  !/seed-state-registry/.test(registry) && !/An administrator can run the seed/.test(registry));
ok("#10 State Registry empty state gives a customer-appropriate contact message",
  /being finalized for this environment/.test(registry) && /info@veritaslabservices\.com/.test(registry));

console.log(fails === 0 ? "\n=== VERITALAB LEAK/EMDASH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
