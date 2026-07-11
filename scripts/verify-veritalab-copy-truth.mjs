// scripts/verify-veritalab-copy-truth.mjs
//
// Receipt for the VeritaLab customer-facing copy-accuracy fixes (audit #5, #6,
// #7, 2026-07-10). All three misdescribed a real capability to customers:
//
//   #5 reminder cadence: the app card, the demo, the suite page said "90, 60,
//   and 30 days" but the real scheduler (server/routes.ts fires 9-month,
//   6-month, 3-month, 30-day, and at expiration) and the PUBLIC VeritaLabPage
//   already say "9 months, 6 months, 3 months, 30 days, and at expiration".
//   Corrected across all surfaces (bug-class sweep found 5, not the 2 the audit
//   first flagged: VeritaAssurePage was a third page carrying the wrong copy).
//
//   #6 stale "Phase 4" copy claimed PDF generation was not built, while the
//   working Download PDF button ships a live generator. Removed from both
//   rendered strings in Cms116FormTab.
//
//   #7 the demo misattributed the CLIA auto-populate source to "your CMS-116
//   application"; CLIA is auto-populated from the account's CLIA verification at
//   signup (the CMS-116 wire-back is a separate path).
//
//   node scripts/verify-veritalab-copy-truth.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const app = read("client/src/pages/VeritaLabAppPage.tsx");
const demo = read("client/src/pages/DemoLabPage.tsx");
const suite = read("client/src/pages/VeritaAssurePage.tsx");
const cms = read("client/src/components/veritalab/Cms116FormTab.tsx");
const CADENCE = "9 months, 6 months, 3 months, 30 days, and at expiration";

// #5 cadence corrected everywhere; the wrong string is gone from all client src
ok("#5 no '90, 60, and 30' remains anywhere in the client",
  ![app, demo, suite].some(s => /90, 60, and 30/.test(s)));
ok("#5 app how-to card states the real 5-point cadence", app.includes(CADENCE));
ok("#5 app tip states the real cadence", /emails you at 9 months, 6 months, 3 months, 30 days, and at expiration/.test(app));
ok("#5 demo paragraph + how-it-works both state the real cadence",
  (demo.match(new RegExp(CADENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length >= 2);
ok("#5 the VeritaAssure suite page states the real cadence", suite.includes(CADENCE));

// #6 no stale "Phase 4" in the rendered CMS-116 copy (the line-6 file comment is internal, not asserted)
ok("#6 Cms116FormTab no longer tells the user 'PDF generation lands in Phase 4'",
  !/PDF generation lands in Phase 4/.test(cms));
ok("#6 Cms116FormTab signature note no longer says 'printed PDF (Phase 4)'",
  !/printed PDF \(Phase 4\)/.test(cms));
ok("#6 Cms116FormTab points the user at the shipped Download PDF flow",
  /Use Download PDF to generate the CMS-116 for wet-ink signature/.test(cms));

// #7 demo CLIA source corrected
ok("#7 demo no longer claims CLIA is auto-populated 'from your CMS-116 application'",
  !/from your CMS-116 application/.test(demo));
ok("#7 demo attributes CLIA auto-populate to the signup CLIA verification",
  /Auto-populated CLIA from your CLIA verification at signup/.test(demo));

console.log(fails === 0 ? "\n=== VERITALAB COPY TRUTH: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
