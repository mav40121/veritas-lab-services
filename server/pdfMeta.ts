// server/pdfMeta.ts
//
// Stamp the required author metadata onto every generated PDF. CLAUDE.md Section 5
// mandates PDF Author metadata "Perplexity Computer", but Chromium's print-to-PDF
// (Puppeteer page.pdf()) does not set an Author, and there is no HTML mechanism to
// supply one. So we post-process the rendered buffer through pdf-lib: load, set the
// author/creator/producer, and re-serialize. Applied at every page.pdf() return
// site in server/pdfReport.ts (VeritaCheck, VeritaComp, CMS 209, VeritaPT, etc.).
//
// Section 5 mandates the Author only; pdf-lib rewrites Producer to its own signature
// on save, which is harmless (Producer just names the serializer). Content (text,
// tables, embedded fonts, barcode images) round-trips unchanged.

import { PDFDocument } from "pdf-lib";

export const PDF_AUTHOR = "Perplexity Computer";

// Takes the raw bytes from page.pdf() (a Uint8Array) and returns a Buffer with the
// Author metadata set. Kept tolerant: if a buffer somehow fails to parse, fall back
// to the original bytes so a metadata step can never break a report download.
export async function stampPdfAuthor(pdfBytes: Uint8Array | Buffer): Promise<Buffer> {
  try {
    const doc = await PDFDocument.load(pdfBytes);
    doc.setAuthor(PDF_AUTHOR);
    const out = await doc.save();
    return Buffer.from(out);
  } catch {
    return Buffer.from(pdfBytes);
  }
}
