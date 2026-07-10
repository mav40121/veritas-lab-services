// scripts/verify-pdf-author-coverage.mjs
//
// Bug-class guard for the PDF Author-metadata requirement (CLAUDE.md Section 5).
// PR #972 stamped only server/pdfReport.ts; Gate 3 found that other generators
// (whyVeritaCheckPdf, veritacheck_verification, cms116Pdf, orderDocument,
// pdfQCMonthly, veritaopsPdf, leverageReport, barcodeLabelPdf) render their own
// PDFs and were missing the Author. This asserts that EVERY server file which
// calls page.pdf() routes its output through stampPdfAuthor, so a new generator
// added later cannot silently ship without the Author.
//
//   node scripts/verify-pdf-author-coverage.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(ROOT, "server");
let fails = 0;
let checked = 0;

for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".ts") || f === "pdfMeta.ts") continue; // pdfMeta defines the helper; its comment mentions page.pdf
  const src = fs.readFileSync(path.join(dir, f), "utf8");
  if (!/\bpage\.pdf\(/.test(src)) continue; // only files that actually render a PDF
  checked++;
  const stamped = /stampPdfAuthor/.test(src);
  console.log(`${stamped ? "PASS" : "FAIL"}: ${f} routes page.pdf() output through stampPdfAuthor`);
  if (!stamped) fails++;
}

console.log(fails === 0
  ? `\n=== PDF AUTHOR COVERAGE: PASS (${checked} generators, all stamped) ===`
  : `\n=== ${fails} generator(s) NOT stamped ===`);
process.exit(fails === 0 ? 0 : 1);
