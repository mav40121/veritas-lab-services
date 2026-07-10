// scripts/stamp-remaining-pdf-authors.mjs
//
// Codemod: extend the PDF Author-metadata fix (PR #972) to the PDF generators
// OUTSIDE server/pdfReport.ts. Gate 3 on #972 found /api/why-veritacheck-pdf had
// no Author because it renders via server/whyVeritaCheckPdf.ts, not pdfReport.ts.
// A sweep of `page.pdf(` across server/ found 8 more generators. This wraps each
// one's returned buffer in stampPdfAuthor() and adds the import.
//
// Idempotent (skips a file that already imports pdfMeta). Run once:
//   node scripts/stamp-remaining-pdf-authors.mjs

import { readFileSync, writeFileSync } from "node:fs";

const IMPORT = 'import { stampPdfAuthor } from "./pdfMeta";';

// file -> { returns: [[from, to], ...] }. Excel buffers and non-PDF returns are
// left untouched by using PDF-specific return strings.
const EDITS = {
  "server/barcodeLabelPdf.ts": [["return Buffer.from(pdf);", "return stampPdfAuthor(pdf);"]],
  "server/cms116Pdf.ts": [["return Buffer.from(pdfBuffer as ArrayBuffer);", "return stampPdfAuthor(pdfBuffer);"]],
  "server/leverageReport.ts": [["return Buffer.from(pdfBuffer);", "return stampPdfAuthor(pdfBuffer);"]],
  "server/pdfQCMonthly.ts": [["return Buffer.from(buf);", "return stampPdfAuthor(buf);"]],
  "server/veritaopsPdf.ts": [["return Buffer.from(pdfBuffer as ArrayBuffer);", "return stampPdfAuthor(pdfBuffer);"]],
  "server/whyVeritaCheckPdf.ts": [["return Buffer.from(pdfBuffer as ArrayBuffer);", "return stampPdfAuthor(pdfBuffer);"]],
  // orderDocument: two PDF returns (668, 867); line 651 Buffer.from(await wb.xlsx...) is Excel and stays.
  "server/orderDocument.ts": [["return Buffer.from(pdfBuffer);", "return stampPdfAuthor(pdfBuffer);"]],
  // veritacheck_verification: two route handlers send the buffer directly.
  "server/veritacheck_verification.ts": [["res.send(Buffer.from(pdf));", "res.send(await stampPdfAuthor(pdf));"]],
};

let total = 0;
for (const [file, subs] of Object.entries(EDITS)) {
  let src = readFileSync(file, "utf8");
  // add the import after the first import line (once)
  if (!src.includes('from "./pdfMeta"')) {
    src = src.replace(/^(import[^\n]*\n)/m, `$1${IMPORT}\n`);
  }
  let n = 0;
  for (const [from, to] of subs) {
    const before = src;
    src = src.split(from).join(to);
    const hits = (before.length - src.length) === 0 && before !== src ? 0 : before.split(from).length - 1;
    n += hits;
  }
  writeFileSync(file, src);
  console.log(`${file}: ${n} return site(s) stamped`);
  total += n;
}
console.log(`\nTotal: ${total} PDF return sites stamped across ${Object.keys(EDITS).length} files.`);
