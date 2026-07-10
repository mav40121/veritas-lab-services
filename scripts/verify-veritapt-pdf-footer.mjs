// scripts/verify-veritapt-pdf-footer.mjs
//
// Receipt for the VeritaPT PDF footer fix (2026-07-10) — the same class as the
// VeritaPolicy readiness-PDF footer (audit HIGH #3). generateVeritaPTPDF passed
// "" as the running footer, so it held only the license band: no brand line, no
// "Page X of Y", nothing on overflow pages. Fixed with a module-named
// VERITAPT_FOOTER_TEMPLATE; the in-body .footer-note (required "Final approval..."
// determination line + attribution) is kept. Rendered a 70-row report -> 6 pages,
// all carrying the brand footer + "Page N of 6".
//
// CMS 209 shares the "" pattern but is INTENTIONALLY left alone: it is a federal
// FORM CMS-209 replica whose authentic in-body "FORM CMS-209 (09/2025)" footer
// must not be overlaid with a VeritaAssure marketing footer. This guard asserts
// that form footer is still present.
//
//   node scripts/verify-veritapt-pdf-footer.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdf = fs.readFileSync(path.join(ROOT, "server/pdfReport.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("VeritaPT footer template exists", /const VERITAPT_FOOTER_TEMPLATE = `/.test(pdf));
ok("VeritaPT footer carries the brand line (Sec 5)",
  /VeritaAssure&trade; \| VeritaPT&trade; \| Confidential - For Internal Lab Use Only/.test(pdf));
ok("VeritaPT footer carries Page X of Y",
  /const VERITAPT_FOOTER_TEMPLATE = `[\s\S]{0,700}Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/.test(pdf));
ok("generateVeritaPTPDF passes the template (not the empty string)",
  /const html = buildVeritaPTPDFHTML\(data\);[\s\S]{0,200}applyLicenseToPuppeteer\(html, VERITAPT_FOOTER_TEMPLATE, licenseCtx\)/.test(pdf));
ok("VeritaPT in-body .footer-note (required determination line) is kept",
  /Final approval and clinical determination must be made by the laboratory director or designee\./.test(pdf));
ok("no em-dash in the VeritaPT footer (hyphen per Sec 3)",
  !/VERITAPT_FOOTER_TEMPLATE = `[\s\S]{0,700}—/.test(pdf));
// CMS 209 left as a federal form replica (authentic form footer intact)
ok("CMS 209 authentic FORM footer intact (intentionally not VeritaAssure-branded)",
  /FORM CMS-209 \(09\/2025\)/.test(pdf) && /generateCMS209PDF[\s\S]{0,400}applyLicenseToPuppeteer\(html, "", licenseCtx\)/.test(pdf));

console.log(fails === 0 ? "\n=== VERITAPT PDF FOOTER: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
