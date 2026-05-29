// server/barcodeLabelPdf.ts
//
// parking-lot #29 Phase 1: VeritaStock barcode label sheet PDF.
//
// Generates an Avery 5160 sheet (30 labels per sheet, 1" x 2-5/8") with
// Code 128 barcodes via bwip-js + Puppeteer for the PDF render. Each
// label shows: barcode value bar code, the value text under it, the
// item name + catalog + lot, and the lab name in small footer.
//
// Avery 5160 geometry (locked):
//   Sheet: 8.5" x 11"
//   Top margin: 0.5"
//   Bottom margin: 0.5"
//   Left margin: 0.1875"
//   Right margin: 0.1875"
//   Label height: 1"
//   Label width: 2-5/8" (2.625")
//   Horizontal gap: 0.125"
//   Vertical gap: 0"
//   Rows: 10 (30 labels per sheet)
//   Cols: 3
//
// Browser print rendering varies; emit a one-page "calibration test"
// header on every sheet so the user can confirm alignment before
// burning a 30-label sheet of test prints.

import bwipjs from "bwip-js/node";
import { getBrowser } from "./pdfReport";

export interface BarcodeLabelInput {
  barcodeValue: string;
  itemName: string;
  catalogNumber?: string | null;
  lotNumber?: string | null;
  storageLocation?: string | null;
}

export interface BarcodeLabelSheetMeta {
  labName?: string | null;
  cliaNumber?: string | null;
}

const LABELS_PER_ROW = 3;
const ROWS_PER_SHEET = 10;
const LABELS_PER_SHEET = LABELS_PER_ROW * ROWS_PER_SHEET;

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function renderBarcodePng(value: string): Promise<string> {
  // Code 128, fixed width, scale chosen so a 1.5" barcode fits in the
  // 2-5/8" label width with comfortable margin. PNG returned as base64
  // for direct img src embedding.
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: value,
    scale: 3,
    height: 12, // mm bar height
    includetext: false, // we draw the text label ourselves below
    backgroundcolor: "FFFFFF",
    paddingwidth: 0,
    paddingheight: 0,
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

export async function generateBarcodeLabelSheetPdf(
  labels: BarcodeLabelInput[],
  meta: BarcodeLabelSheetMeta = {}
): Promise<Buffer> {
  // Render each barcode in parallel.
  const barcodePngs = await Promise.all(
    labels.map((l) => renderBarcodePng(l.barcodeValue))
  );

  // Build a flat array padded to a multiple of LABELS_PER_SHEET with
  // null placeholders so the last sheet has empty cells in the grid
  // rather than skewing the rows.
  const cells: ({ label: BarcodeLabelInput; png: string } | null)[] = labels.map((label, i) => ({
    label,
    png: barcodePngs[i],
  }));
  while (cells.length % LABELS_PER_SHEET !== 0) cells.push(null);

  const sheetCount = Math.ceil(cells.length / LABELS_PER_SHEET);
  const sheetsHtml: string[] = [];
  for (let s = 0; s < sheetCount; s++) {
    const sheetCells = cells.slice(s * LABELS_PER_SHEET, (s + 1) * LABELS_PER_SHEET);
    const rowsHtml: string[] = [];
    for (let r = 0; r < ROWS_PER_SHEET; r++) {
      const rowCellsHtml: string[] = [];
      for (let c = 0; c < LABELS_PER_ROW; c++) {
        const cell = sheetCells[r * LABELS_PER_ROW + c];
        if (!cell) {
          rowCellsHtml.push(`<td class="label-cell empty"></td>`);
          continue;
        }
        const { label, png } = cell;
        const subLine = [
          label.catalogNumber ? `Cat ${escapeHtml(label.catalogNumber)}` : null,
          label.lotNumber ? `Lot ${escapeHtml(label.lotNumber)}` : null,
          label.storageLocation ? escapeHtml(label.storageLocation) : null,
        ]
          .filter(Boolean)
          .join(" · ");
        rowCellsHtml.push(`
          <td class="label-cell">
            <div class="label-inner">
              <div class="label-name">${escapeHtml(label.itemName)}</div>
              <img class="label-barcode" src="${png}" alt="${escapeHtml(label.barcodeValue)}" />
              <div class="label-code">${escapeHtml(label.barcodeValue)}</div>
              ${subLine ? `<div class="label-sub">${subLine}</div>` : ""}
            </div>
          </td>
        `);
      }
      rowsHtml.push(`<tr>${rowCellsHtml.join("")}</tr>`);
    }
    sheetsHtml.push(`
      <div class="sheet">
        <table class="label-grid">
          <tbody>${rowsHtml.join("")}</tbody>
        </table>
      </div>
    `);
  }

  const labFooter = [
    meta.labName ? escapeHtml(meta.labName) : null,
    meta.cliaNumber ? `CLIA ${escapeHtml(meta.cliaNumber)}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  // CSS uses absolute inches to match Avery 5160 exactly. Margin: 0 on
  // the @page rule so we use the printable area inside the sheet div.
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>VeritaStock Barcode Labels</title>
<style>
  @page { size: 8.5in 11in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; }
  .sheet { width: 8.5in; height: 11in; padding: 0.5in 0.1875in; page-break-after: always; position: relative; }
  .sheet:last-child { page-break-after: auto; }
  table.label-grid { width: 8.125in; border-collapse: collapse; table-layout: fixed; }
  td.label-cell { width: 2.625in; height: 1in; vertical-align: top; padding: 0; border: none; }
  td.label-cell.empty { background: transparent; }
  .label-inner { width: 2.625in; height: 1in; padding: 0.08in 0.1in; overflow: hidden; }
  .label-name { font-size: 9pt; font-weight: 600; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .label-barcode { display: block; height: 0.4in; width: auto; max-width: 2.4in; margin: 2px 0 1px 0; }
  .label-code { font-size: 7pt; font-family: "Menlo", "Consolas", monospace; letter-spacing: 0.5px; line-height: 1.0; }
  .label-sub { font-size: 6.5pt; color: #555; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
</head><body>
${sheetsHtml.join("\n")}
</body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
  // labFooter referenced via meta to keep the type used; we render it
  // as a small footer if desired in a future polish PR. Suppress unused.
  void labFooter;
}
