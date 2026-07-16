// ExcelJS-only license stamp helpers. Imported by both server/licenseStamp.ts
// and client/src/lib/licenseStamp.ts so the same band/About-sheet treatment
// is applied wherever a workbook is built.

import type ExcelJS from "exceljs";
import {
  AUTHOR_META,
  COPYRIGHT_BLOCK,
  LICENSE_TERMS_BLOCK,
  normalizeLicenseContext,
  type LicenseContext,
} from "./licenseText";

const STAMP_FLAG_KEY = "__veritasLicenseStamped";
const TEAL_DARK_ARGB = "FF004F4F";
const AMBER_FILL_ARGB = "FFFFF7E0";
const AMBER_TEXT_ARGB = "FF6E4A00";
const BODY_DARK_ARGB = "FF1A1A1A";
const NOTE_GREY_ARGB = "FF777777";

function maxColumns(ws: ExcelJS.Worksheet): number {
  const cc = ws.columnCount || 0;
  return Math.max(cc, 8);
}

/**
 * Estimate a safe wrapped-cell row height in points for Calibri 11 at the
 * About-sheet column width (~110). Counts explicit newlines and floors
 * char-per-line conservatively to avoid mid-word cutoffs.
 */
function estimateWrappedHeight(
  text: string,
  charsPerLine: number = 88,
  pxPerLine: number = 16,
  minLines: number = 2,
): number {
  const segments = String(text || "").split(/\r?\n/);
  let lines = 0;
  for (const seg of segments) {
    if (seg.length === 0) {
      lines += 1;
      continue;
    }
    lines += Math.ceil(seg.length / charsPerLine);
  }
  return Math.max(minLines, lines) * pxPerLine + 4;
}

function shiftFreezePane(ws: ExcelJS.Worksheet): void {
  const views = ws.views;
  if (!Array.isArray(views) || views.length === 0) return;
  for (const v of views) {
    if (!v) continue;
    if (v.state === "frozen") {
      if (typeof v.ySplit === "number" && v.ySplit > 0) v.ySplit += 1;
      if (typeof v.topLeftCell === "string") {
        const m = v.topLeftCell.match(/^([A-Z]+)(\d+)$/);
        if (m) v.topLeftCell = `${m[1]}${parseInt(m[2], 10) + 1}`;
      }
    }
  }
}

function insertLicenseBand(ws: ExcelJS.Worksheet, ctx: LicenseContext): void {
  const cols = maxColumns(ws);
  ws.spliceRows(1, 0, []);
  const row = ws.getRow(1);
  const top = ws.getCell(1, 1);
  const bandText =
    `\u00A9 2026 Veritas Lab Services, LLC. ${ctx.productName}. All rights reserved. ` +
    `Licensed to: ${ctx.licensee} (${ctx.email}) \u00B7 Issued ${ctx.issueDate} \u00B7 ` +
    `Single-facility internal use only. No redistribution, no derivative works, no resale.`;
  top.value = bandText;
  top.font = { name: "Calibri", size: 9, italic: true, bold: true, color: { argb: AMBER_TEXT_ARGB } };
  top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_FILL_ARGB } };
  top.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, cols);
  // Band spans `cols` merged columns; assume each column is ~16 chars wide on
  // average for the worksheets we ship (data tables are wide). Use a generous
  // chars-per-line so the band stays compact when the sheet has many columns.
  const bandCharsPerLine = Math.max(120, cols * 16);
  row.height = Math.max(30, estimateWrappedHeight(bandText, bandCharsPerLine, 14, 1));
  shiftFreezePane(ws);
}

/**
 * Split an Excel header/footer string into its &L / &C / &R sections.
 *
 * Excel puts every header/footer into three sections marked by &L, &C and &R.
 * Everything else (&P page number, &N page count, &"font,style", &10 size, &D)
 * is formatting INSIDE a section and must be carried through untouched.
 *
 * Two things make a naive split wrong:
 *   1. `&&` is an escaped literal ampersand. In "A && L", scanning for /&[LCR]/
 *      would match the second & followed by L and invent a section break.
 *   2. `&"Calibri,Regular"` starts with &" not &C, so the C inside the font name
 *      must not be read as a section marker.
 * Walking the string two characters at a time handles both: an `&&` consumes
 * both characters, so the second & is never examined as a marker.
 *
 * Text before any marker is Excel's center section, which is where a bare
 * string with no markers lands.
 */
function splitHeaderFooter(s: string | null | undefined): { L: string; C: string; R: string } {
  const out = { L: "", C: "", R: "" };
  const str = String(s || "");
  let section: "L" | "C" | "R" = "C";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "&" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "&") { out[section] += "&&"; i += 2; continue; }   // escaped literal &
      if (next === "L" || next === "C" || next === "R") { section = next; i += 2; continue; }
    }
    out[section] += str[i];
    i += 1;
  }
  return out;
}

function joinHeaderFooter(p: { L: string; C: string; R: string }): string {
  let s = "";
  if (p.L) s += `&L${p.L}`;
  if (p.C) s += `&C${p.C}`;
  if (p.R) s += `&R${p.R}`;
  return s;
}

/**
 * Stamp the license into a sheet's header/footer WITHOUT destroying whatever is
 * already there.
 *
 * Parking-lot #43: this used to assign `oddHeader`/`oddFooter` outright. Every
 * customer-facing export sets its own header/footer first, carrying the lab
 * name and CLIA per CLAUDE.md §6 rule 3 so identity survives cell-level
 * copy-paste. Those lines were being silently overwritten twenty lines later,
 * which meant the CLIA appeared in no header or footer of any shipped workbook
 * and the name shown was the licensee rather than the "Prepared for" lab.
 *
 * Rules, in priority order:
 *   - Sheet already has a header  -> leave it alone. It carries §6 identity, and
 *     the licensee is already stated in the row-1 band, the About sheet and the
 *     footer. Three statements is plenty; a fourth is not worth clobbering the
 *     CLIA for.
 *   - Sheet has no header         -> set the license header (prior behavior, so
 *     exports that never set one keep their band).
 *   - Sheet already has a footer  -> append the copyright line UNDER the
 *     existing left section rather than over it, and leave &C/&R (page numbers,
 *     product mark) untouched.
 *   - Sheet has no footer         -> set the license footer including page
 *     numbers (prior behavior).
 */
function setHeaderFooter(ws: ExcelJS.Worksheet, ctx: LicenseContext): void {
  ws.headerFooter = ws.headerFooter || ({} as any);
  const headerRight = `Licensed: ${ctx.licensee}`;
  const footerLeft =
    `© 2026 Veritas Lab Services, LLC | ` +
    `Licensed to: ${ctx.licensee} (${ctx.email}) | ` +
    `Issued ${ctx.issueDate} | Do not redistribute`;

  const existingHeader = String(ws.headerFooter.oddHeader || "");
  if (!existingHeader.trim()) {
    ws.headerFooter.oddHeader = `&R${headerRight}`;
  }

  const existingFooter = String(ws.headerFooter.oddFooter || "");
  if (!existingFooter.trim()) {
    ws.headerFooter.oddFooter = `&L${footerLeft}&RPage &P of &N`;
  } else {
    const parts = splitHeaderFooter(existingFooter);
    // Newline inside a section is a real line break in Excel. Any font/size code
    // already opening the section keeps applying to the appended line.
    parts.L = parts.L ? `${parts.L}\n${footerLeft}` : footerLeft;
    ws.headerFooter.oddFooter = joinHeaderFooter(parts);
  }

  ws.headerFooter.evenHeader = ws.headerFooter.oddHeader;
  ws.headerFooter.evenFooter = ws.headerFooter.oddFooter;
}

function ensureAboutSheet(workbook: ExcelJS.Workbook, ctx: LicenseContext): void {
  let about = workbook.getWorksheet("About");
  let startRow: number;
  if (!about) {
    about = workbook.addWorksheet("About");
    about.getColumn(1).width = 110;
    const titleCell = about.getCell(1, 1);
    titleCell.value = (workbook.properties as any)?.title || "About this workbook";
    titleCell.font = { name: "Calibri", size: 14, bold: true, color: { argb: TEAL_DARK_ARGB } };
    startRow = 3;
  } else {
    startRow = (about.rowCount || 0) + 2;
  }

  const subFont: Partial<ExcelJS.Font> = { name: "Calibri", size: 11, bold: true, color: { argb: TEAL_DARK_ARGB } };
  const bodyFont: Partial<ExcelJS.Font> = { name: "Calibri", size: 10, color: { argb: BODY_DARK_ARGB } };
  const noteFont: Partial<ExcelJS.Font> = { name: "Calibri", size: 9, italic: true, color: { argb: NOTE_GREY_ARGB } };
  const wrap: Partial<ExcelJS.Alignment> = { wrapText: true, vertical: "top", horizontal: "left" };

  const put = (rowIdx: number, value: string, font: Partial<ExcelJS.Font>, height: number) => {
    const c = about!.getCell(rowIdx, 1);
    c.value = value;
    c.font = font;
    c.alignment = wrap;
    about!.getRow(rowIdx).height = height;
  };

  // Column 1 is width 110 in Excel column-units \u2248 ~88 chars of Calibri 11
  // before wrap. Use estimateWrappedHeight() so blocks never clip on long text.
  const licensedTo =
    `${ctx.licensee} | ${ctx.email}` +
    (ctx.plan ? ` | Plan: ${ctx.plan}` : "") +
    ` | Issued ${ctx.issueDate}`;
  const generated =
    `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} \u00B7 ` +
    `Veritas Lab Services, LLC`;

  put(startRow,     "Copyright and license", subFont, 22);
  put(startRow + 1, COPYRIGHT_BLOCK,         bodyFont, estimateWrappedHeight(COPYRIGHT_BLOCK, 88, 16, 4));
  put(startRow + 3, "License terms",         subFont, 22);
  put(startRow + 4, LICENSE_TERMS_BLOCK,     bodyFont, estimateWrappedHeight(LICENSE_TERMS_BLOCK, 88, 16, 4));
  put(startRow + 6, "Licensed to",           subFont, 22);
  put(startRow + 7, licensedTo,              bodyFont, estimateWrappedHeight(licensedTo, 88, 16, 1));
  put(startRow + 9, generated,               noteFont, estimateWrappedHeight(generated, 88, 14, 1));
}

export function applyLicenseToExcelJSWorkbook(
  workbook: ExcelJS.Workbook,
  ctx: Partial<LicenseContext> | null | undefined,
): void {
  if (!workbook) return;
  if ((workbook as any)[STAMP_FLAG_KEY]) return;
  const norm = normalizeLicenseContext(ctx);

  const sheets = workbook.worksheets || [];
  if (sheets.length > 0) {
    insertLicenseBand(sheets[0], norm);
  }
  for (const ws of sheets) {
    setHeaderFooter(ws, norm);
  }

  ensureAboutSheet(workbook, norm);

  workbook.creator = AUTHOR_META;
  workbook.lastModifiedBy = AUTHOR_META;
  workbook.modified = new Date();

  (workbook as any)[STAMP_FLAG_KEY] = true;
}
