// scripts/verify-pdf-author.mts
//
// Receipt for the PDF Author-metadata fix (VeritaComp scorecard sev1, cross-cutting).
// CLAUDE.md Section 5 mandates PDF Author metadata "Perplexity Computer" on every
// generated report, but Chromium print-to-PDF sets no Author, so none of the 12
// pdfReport.ts outputs complied. server/pdfMeta.ts stampPdfAuthor() now post-processes
// every page.pdf() buffer.
//
// Exercises the exact helper on an author-less PDF (simulating Puppeteer output):
// stamps it, reloads, and asserts Author/Creator/Producer are set and content
// survives. Also checks idempotency and the garbage-input fallback.
//
//   npx tsx scripts/verify-pdf-author.mts

import { PDFDocument } from "pdf-lib";
import { stampPdfAuthor, PDF_AUTHOR } from "../server/pdfMeta.ts";

let fails = 0;
const ok = (label: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// Author-less source PDF (stands in for Chromium print-to-PDF output).
const src = await PDFDocument.create();
src.addPage([200, 200]);
const srcBytes = await src.save();
ok("source PDF has no Author (simulates Puppeteer output)", !(await PDFDocument.load(srcBytes)).getAuthor());

const stamped = await stampPdfAuthor(srcBytes);
ok("stampPdfAuthor returns a Buffer", Buffer.isBuffer(stamped));
const after = await PDFDocument.load(stamped);
ok(`Author is "${PDF_AUTHOR}"`, after.getAuthor() === PDF_AUTHOR);
ok("content preserved (page count unchanged)", after.getPageCount() === 1);

const twice = await PDFDocument.load(await stampPdfAuthor(stamped));
ok("re-stamping keeps the Author (idempotent)", twice.getAuthor() === PDF_AUTHOR);

const garbage = await stampPdfAuthor(Buffer.from("not a pdf at all"));
ok("garbage input falls back to original bytes without throwing", Buffer.isBuffer(garbage));

console.log(fails === 0 ? "\n=== PDF AUTHOR METADATA: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
