// Client-side jsPDF helper that applies the per-recipient license stamp to
// every page (footer band) and appends a final "Copyright and License Terms"
// page with the canonical legal text. Mirrors stamp_veritas_pdf.py.
//
// Call applyLicenseToPdf(doc, ctx) RIGHT BEFORE doc.save(...) so the footer
// captures every page that has been laid out and the appendix is the last
// page in the document.

import type jsPDF from "jspdf";
import {
  COPYRIGHT_BLOCK,
  LICENSE_BAND,
  LICENSE_TERMS_BLOCK,
  AUTHOR_META,
  normalizeLicenseContext,
  type LicenseContext,
} from "@shared/licenseText";

const FOOTER_FONT_SIZE = 7;
const FOOTER_GREY: [number, number, number] = [85, 85, 85];
const TEAL_DARK: [number, number, number] = [0, 79, 79];
const AMBER: [number, number, number] = [110, 74, 0];
const BODY_DARK: [number, number, number] = [26, 26, 26];

function pageDims(doc: jsPDF): { w: number; h: number; unit: string } {
  const ip = doc.internal.pageSize as any;
  const w = typeof ip.getWidth === "function" ? ip.getWidth() : ip.width;
  const h = typeof ip.getHeight === "function" ? ip.getHeight() : ip.height;
  const unit = (doc as any).internal?.scaleFactor ? "mm" : "mm";
  return { w, h, unit };
}

function drawFooterBand(doc: jsPDF, footerText: string): void {
  const { w, h } = pageDims(doc);
  // Save current font / colour state by re-setting after drawing.
  doc.setFont("helvetica", "italic");
  doc.setFontSize(FOOTER_FONT_SIZE);
  doc.setTextColor(...FOOTER_GREY);
  // ~6mm from bottom edge keeps the band clear of normal page footers.
  const y = h - 4;
  let line = footerText;
  if (line.length > 220) line = line.slice(0, 217) + "...";
  doc.text(line, w / 2, y, { align: "center", maxWidth: w - 12 });
}

function stampAllPages(doc: jsPDF, ctx: LicenseContext): void {
  const footer = LICENSE_BAND(ctx.licensee, ctx.email, ctx.issueDate);
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    drawFooterBand(doc, footer);
  }
}

function appendAppendixPage(doc: jsPDF, ctx: LicenseContext): void {
  doc.addPage();
  const { w, h } = pageDims(doc);
  const margin = 18;
  const contentW = w - margin * 2;
  let y = margin + 4;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...TEAL_DARK);
  doc.text("Copyright and License Terms", margin, y);
  y += 9;

  // Body block helper
  const writeHead = (label: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...TEAL_DARK);
    y += 2;
    doc.text(label, margin, y);
    y += 5;
  };
  const writeBody = (text: string) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...BODY_DARK);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const ln of lines) {
      if (y > h - margin - 14) {
        doc.addPage();
        y = margin + 4;
      }
      doc.text(ln, margin, y);
      y += 5;
    }
    y += 2;
  };
  const writeLicensee = (text: string) => {
    doc.setFont("helvetica", "bolditalic");
    doc.setFontSize(10);
    doc.setTextColor(...AMBER);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    for (const ln of lines) {
      if (y > h - margin - 14) {
        doc.addPage();
        y = margin + 4;
      }
      doc.text(ln, margin, y);
      y += 5;
    }
    y += 2;
  };

  writeHead("Copyright");
  writeBody(COPYRIGHT_BLOCK);

  writeHead("License terms");
  writeBody(LICENSE_TERMS_BLOCK);

  writeHead("Licensed to");
  const licenseeBlock =
    `${ctx.licensee}\n${ctx.email}\n` +
    (ctx.plan ? `Plan: ${ctx.plan}\n` : "") +
    `Issued ${ctx.issueDate}`;
  writeLicensee(licenseeBlock);

  // Footnote
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...FOOTER_GREY);
  const stampLine =
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ` +
    `Veritas Lab Services, LLC · Globe, Arizona`;
  if (y < h - margin - 12) {
    y = h - margin - 8;
  }
  doc.text(stampLine, margin, y, { maxWidth: contentW });

  // Footer band still belongs on the appendix page.
  drawFooterBand(doc, LICENSE_BAND(ctx.licensee, ctx.email, ctx.issueDate));
}

function setDocumentMetadata(doc: jsPDF, ctx: LicenseContext): void {
  try {
    if (typeof (doc as any).setProperties === "function") {
      (doc as any).setProperties({
        author: AUTHOR_META,
        creator: AUTHOR_META,
        producer: "Veritas Lab Services - licenseStamp.ts",
        subject: `Licensed to: ${ctx.licensee}`,
        keywords: `licensee:${ctx.licensee};email:${ctx.email};issued:${ctx.issueDate}`,
      });
    }
  } catch {
    // Metadata is best-effort; do not fail the export over it.
  }
}

const STAMP_FLAG = "__veritasLicenseStamped";

export function applyLicenseToPdf(
  doc: jsPDF,
  ctx: Partial<LicenseContext> | null | undefined,
): void {
  if (!doc) return;
  // Idempotent: avoid double-stamping if the same doc passes through two
  // generator paths (VeritaCheckPage → pdfGenerator, etc.).
  if ((doc as any)[STAMP_FLAG]) return;
  const norm = normalizeLicenseContext(ctx);
  appendAppendixPage(doc, norm);
  stampAllPages(doc, norm);
  setDocumentMetadata(doc, norm);
  (doc as any)[STAMP_FLAG] = true;
}

export type { LicenseContext };

// Re-export so client code can stamp ExcelJS workbooks built in the browser
// (e.g. AdminReportPage) without reaching into shared/.
export { applyLicenseToExcelJSWorkbook as applyLicenseToExcelJS } from "@shared/licenseExceljs";
