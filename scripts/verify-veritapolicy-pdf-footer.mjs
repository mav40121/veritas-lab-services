// scripts/verify-veritapolicy-pdf-footer.mjs
//
// Receipt for the VeritaPolicy readiness-PDF footer fix (2026-07-10, audit HIGH
// #3). generateVeritaPolicyPDF passed "" as the Puppeteer running footer, so the
// footer held only the license band: no brand line, no "Page X of Y" on any page
// (the only brand text was 3 in-body .footer-line divs that never paginated, so
// requirements-table overflow pages had no footer at all). CLAUDE.md Sec 5
// requires the footer on EVERY page. Fix: a module-named VERITAPOLICY_FOOTER_
// TEMPLATE (brand + Page X of Y) wired through applyLicenseToPuppeteer, and the
// redundant in-body brand lines removed.
//
// Rendered locally (90 requirements -> 6 pages): ALL 6 pages carry
// "VeritaAssure | VeritaPolicy | Confidential" + "Page N of 6". This source guard
// pins the wiring so it cannot silently regress to "".
//
//   node scripts/verify-veritapolicy-pdf-footer.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdf = fs.readFileSync(path.join(ROOT, "server/pdfReport.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("footer template exists (VERITAPOLICY_FOOTER_TEMPLATE)", /const VERITAPOLICY_FOOTER_TEMPLATE = `/.test(pdf));
ok("footer carries the VeritaPolicy brand line (Sec 5)",
  /VeritaAssure&trade; \| VeritaPolicy&trade; \| Confidential - For Internal Lab Use Only/.test(pdf));
ok("footer carries Page X of Y (pageNumber + totalPages spans)",
  /const VERITAPOLICY_FOOTER_TEMPLATE = `[\s\S]{0,1200}Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/.test(pdf));
ok("generateVeritaPolicyPDF passes the template (not the empty string)",
  /const stamped = applyLicenseToPuppeteer\(html, VERITAPOLICY_FOOTER_TEMPLATE, licenseCtx\)/.test(pdf));
ok("the redundant in-body .footer-line brand divs are removed",
  !/class="footer-line">VeritaAssure&#8482; \| VeritaPolicy/.test(pdf));
ok("no em-dash in the new footer (hyphen per Sec 3)",
  !/VERITAPOLICY_FOOTER_TEMPLATE[\s\S]{0,600}—/.test(pdf));

console.log(fails === 0 ? "\n=== VERITAPOLICY PDF FOOTER: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
