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
// Scope the check to the blurb STRING itself ([^"]* stops at its closing quote).
// The old /Renders...[\s\S]*?—/ spanned the whole file to an unrelated JSX code
// comment's em-dash (allowed per Sec 3), a false positive.
const blurb = (va.match(/Renders a CMS-2567-compatible[^"]*/) || [""])[0];
ok("no em-dash in the VeritaResponse blurb", blurb.length > 0 && !blurb.includes("—"));

// In-app intro card and finding page (Michael 2026-10-26, VeritaResponse review option 1): the card covered surveys
// only, listed stale clocks, claimed a "federal CMS-2567" render and an evidence upload, and offered an extension
// feature that does not exist; the finding page carried a dated TJC label, a "later phase" note for a gate that
// exists, the wrong form name and owner/admin sign-off wording the server no longer allows.
const app = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseAppPage.tsx"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseFindingPage.tsx"), "utf8");
const card = (app.match(/<ModuleHowToCard[\s\S]*?\/>/) || [""])[0];
ok("card: no 'federal CMS-2567' and says CMS-2567-compatible", !/federal CMS-2567/i.test(card) && /CMS-2567-compatible/.test(card));
ok("card: names all four entry types", ["inspection finding", "PT failure", "internal event (NCE)", "FDA product deviation"].every((t) => card.includes(t)));
ok("card: clocks include COLA, AABB 45 and ISO 15189", /COLA \(30\)/.test(card) && /AABB \(45\)/.test(card) && /ISO 15189/.test(card));
ok("card: no 'Attach evidence' (there is no upload)", !/Attach evidence/i.test(card));
ok("card: VeritaCheck link scoped to a 42 CFR 493 standard", /when the finding cites a 42 CFR 493 standard/.test(card));
ok("card: no em dash", card.length > 0 && !card.includes("—"));
ok("overdue banner: no extension offer", !/request an extension/i.test(app));
ok("form name is CMS-2567, never CLIA-2567", !/CLIA-2567/.test(app) && !/CLIA-2567/.test(page));
ok("finding page: no dated TJC label", !/TJC May 2024 update\)/.test(page));
ok("finding page: no 'lands in a later phase'", !/lands in a later phase/.test(page));
ok("finding page: NCE sign-off names the medical director or designee", /Sign off \(medical director or designee\)/.test(page) && !/owner or admin\)/.test(page));
ok("finding page: an internal event is titled as one", /`Internal Event \$\{/.test(page));

console.log(fails === 0 ? "\n=== VERITARESPONSE COPY TRUTH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
