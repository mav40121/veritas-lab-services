// scripts/verify-veritaresponse-copy-truth.mjs
//
// Receipt for the VeritaResponse public-copy truth batch (audit #10 + #12),
// 2026-07-12:
//   #12 "Renders the federal CMS-2567 PDF" implied the official government form
//       (issued BY the surveyor with deficiencies pre-printed); the artifact
//       itself says "CMS-2567 (compatible) / mirrors the structure". Reworded to
//       "CMS-2567-compatible".
//   #10 "Cross-links to your most recent VeritaCheck study for the cited standard"
//       overstated the endpoint (fires only on 42 CFR 493.xxx and returns the
//       most-recent study of any specialty). Reworded to "Surfaces your most
//       recent VeritaCheck study when the finding cites a 42 CFR 493 standard".
//
//   node scripts/verify-veritaresponse-copy-truth.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const va = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaAssurePage.tsx"), "utf8");
const demo = fs.readFileSync(path.join(ROOT, "client/src/pages/DemoLabPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #12 federal -> compatible
ok("VeritaAssurePage: no 'federal CMS-2567' overstatement", !/federal CMS-2567/i.test(va));
ok("VeritaAssurePage: says 'CMS-2567-compatible'", /CMS-2567-compatible Plan of Correction PDF/.test(va));
ok("DemoLabPage: no 'federal CMS-2567' overstatement", !/[Ff]ederal CMS-2567/.test(demo));
ok("DemoLabPage: says 'CMS-2567-compatible' (both instances)",
  (demo.match(/CMS-2567-compatible Plan of Correction PDF/g) || []).length >= 2);

// #10 cross-link precision
ok("VeritaAssurePage: no 'for the cited standard' overstatement", !/for the cited standard/.test(va));
ok("VeritaAssurePage: scopes the cross-link to a 42 CFR 493 standard",
  /Surfaces your most recent VeritaCheck study when the finding cites a 42 CFR 493 standard/.test(va));
ok("DemoLabPage: no 'for the cited standard' overstatement", !/for the cited standard/.test(demo));
ok("DemoLabPage: scopes the cross-link to a 42 CFR 493 standard",
  (demo.match(/when the finding cites a 42 CFR 493 standard/g) || []).length >= 2);

// no em-dashes introduced (the strings we touched)
ok("no em-dash in the VeritaAssure blurb", !/Renders a CMS-2567-compatible[\s\S]*?—/.test(va));

console.log(fails === 0 ? "\n=== VERITARESPONSE COPY TRUTH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
