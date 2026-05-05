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
  top.value =
    `© 2026 Veritas Lab Services, LLC. VeritaPolicy™. All rights reserved. ` +
    `Licensed to: ${ctx.licensee} (${ctx.email}) · Issued ${ctx.issueDate} · ` +
    `Single-facility internal use only. No redistribution, no derivative works, no resale.`;
  top.font = { name: "Calibri", size: 9, italic: true, bold: true, color: { argb: AMBER_TEXT_ARGB } };
  top.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER_FILL_ARGB } };
  top.alignment = { wrapText: true, vertical: "middle", horizontal: "left" };
  ws.mergeCells(1, 1, 1, cols);
  row.height = 30;
  shiftFreezePane(ws);
}

function setHeaderFooter(ws: ExcelJS.Worksheet, ctx: LicenseContext): void {
  ws.headerFooter = ws.headerFooter || ({} as any);
  const headerRight = `Licensed: ${ctx.licensee}`;
  const footerLeft =
    `© 2026 Veritas Lab Services, LLC | ` +
    `Licensed to: ${ctx.licensee} (${ctx.email}) | ` +
    `Issued ${ctx.issueDate} | Do not redistribute`;
  ws.headerFooter.oddHeader = `&R${headerRight}`;
  ws.headerFooter.oddFooter = `&L${footerLeft}&RPage &P of &N`;
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

  put(startRow,     "Copyright and license", subFont, 18);
  put(startRow + 1, COPYRIGHT_BLOCK,         bodyFont, 110);
  put(startRow + 3, "License terms",         subFont, 18);
  put(startRow + 4, LICENSE_TERMS_BLOCK,     bodyFont, 110);
  put(startRow + 6, "Licensed to",           subFont, 18);
  put(startRow + 7,
      `${ctx.licensee} | ${ctx.email}` +
      (ctx.plan ? ` | Plan: ${ctx.plan}` : "") +
      ` | Issued ${ctx.issueDate}`,
      bodyFont, 24);
  put(startRow + 9,
      `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ` +
      `Veritas Lab Services, LLC`,
      noteFont, 18);
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
