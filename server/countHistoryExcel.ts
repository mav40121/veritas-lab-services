// server/countHistoryExcel.ts
//
// The Count History workbook: every recorded physical count per item, plus a
// per-item true burn rate reconciled against the recounts. Read-only report
// (all sheets locked); the counter-input count sheet is a separate deliverable
// (inventoryCountExcel.ts). Per CLAUDE.md §6: About sheet first, lab identity in
// three layers, sheet password from env, no em-dashes anywhere.

import type { CountHistoryReport } from "./countHistoryReport";

const STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";

export interface CountHistoryContext {
  labName?: string | null;
  cliaNumber?: string | null;
  filterLabel?: string | null;
}

function columnLetter(n: number): string {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const dateOnly = (iso: string | null) => (iso ? String(iso).slice(0, 10) : "");

export async function generateCountHistoryExcel(report: CountHistoryReport, ctx: CountHistoryContext): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const brand = STOCK_DEPLOYMENT ? "VeritaStock" : "VeritaAssure";
  const wb = new ExcelJS.Workbook();
  wb.creator = brand; wb.lastModifiedBy = brand; wb.created = new Date(); wb.modified = new Date();

  const labName = ctx.labName || (STOCK_DEPLOYMENT ? "Organization name not on file" : "Lab name not on file");
  const cliaNumber = ctx.cliaNumber || "Not on file";
  const cliaSuffix = STOCK_DEPLOYMENT ? "" : `    CLIA: ${cliaNumber}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

  const thinBorder: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } }, bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } }, right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const lockedProtect = {
    selectLockedCells: false, selectUnlockedCells: false, formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false,
    sort: true, autoFilter: true, pivotTables: false,
  };

  // ── About sheet ──────────────────────────────────────────────────────────
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaStock Count History";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idCell = about.getCell("A2");
  idCell.value = `Prepared for: ${labName}${cliaSuffix}`;
  idCell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  idCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  idCell.border = thinBorder; about.getRow(2).height = 24;

  let row = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${row}`); c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = thinBorder; about.getRow(row).height = 22; row += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${row}`); c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = thinBorder;
    about.getRow(row).height = Math.max(1, Math.ceil(String(text).length / 88)) * 16 + 4; row += 1;
  };
  const blank = () => { about.getRow(row).height = 8; row += 1; };

  section("About this workbook");
  body(`This workbook lists every physical count recorded in VeritaStock for the last ${report.windowDays} days, item by item, with the date each count was taken and who took it. The Count History sheet has one row per count. The True Burn sheet summarizes each item and shows a burn rate calculated from the counts themselves.`);
  blank();
  section("How the true burn rate is calculated");
  body("For each item, between two consecutive counts the used quantity is the prior count plus anything received in that window minus the new count. That used quantity is divided by the number of days between the two counts to get a per-day burn. Because it is anchored on physical recounts, it captures shrinkage and unlogged waste that an estimate would miss. A negative value means the recounts found more than expected, usually a correction or stock found in another location; it is shown as is, not hidden.");
  blank();
  section("What it needs to be meaningful");
  body("An item needs at least two counts before a burn rate can be calculated; items with a single count show a blank burn. The more regularly the lab counts, the tighter the number. Count history only exists from the date this feature went live; earlier counts were not recorded and cannot be shown.");
  blank();
  section("Disclaimer");
  body(STOCK_DEPLOYMENT
    ? "This workbook reports counts as they were entered into VeritaStock. It is not an audit or a financial record. The materials manager or designee is responsible for any action taken on the basis of these counts and burn rates."
    : "This workbook reports counts as they were entered into VeritaStock. It is not an audit, not a financial record, and not a certification of physical inventory to any regulatory or accrediting body. The laboratory director or designee is responsible for any action taken on the basis of these counts and burn rates.");
  blank();
  section("Coverage gaps");
  body("If a column you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.");

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Count History&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`;
  await about.protect(exportPwd, { ...lockedProtect, sort: false, autoFilter: false });

  // ── Count History sheet (one row per count event) ────────────────────────
  const hist = wb.addWorksheet("Count History");
  const HCOLS = [
    { header: "Item Name", key: "item", width: 34 },
    { header: "Catalog #", key: "cat", width: 16 },
    { header: "Storage Location", key: "loc", width: 20 },
    { header: "Department", key: "dept", width: 14 },
    { header: "Count Date", key: "date", width: 13 },
    { header: "Counted Qty", key: "qty", width: 12 },
    { header: "Prior Qty", key: "prior", width: 11 },
    { header: "Change", key: "delta", width: 10 },
    { header: "Counted By", key: "by", width: 18 },
    { header: "Source", key: "src", width: 14 },
  ];
  hist.columns = HCOLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const sourceLabel = (s: string) => (s === "kiosk" ? "Count kiosk" : s === "staff_portal" ? "Staff portal" : s === "director" ? "Director" : s);
  for (const it of report.items) {
    for (const c of it.counts) {
      hist.addRow([
        it.item_name, it.catalog_number ?? "", it.storage_location ?? "", it.department ?? "",
        dateOnly(c.occurred_at), Number(c.counted_qty),
        c.previous_qty == null ? "" : Number(c.previous_qty),
        c.delta == null ? "" : Number(c.delta),
        c.counted_by ?? "", sourceLabel(c.source),
      ]);
    }
  }
  styleSheet(hist, HCOLS.length, thinBorder);
  hist.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Count History&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  hist.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`;
  await hist.protect(exportPwd, lockedProtect);

  // ── True Burn sheet (per-item summary) ───────────────────────────────────
  const burn = wb.addWorksheet("True Burn");
  const BCOLS = [
    { header: "Item Name", key: "item", width: 34 },
    { header: "Catalog #", key: "cat", width: 16 },
    { header: "Count Unit", key: "unit", width: 14 },
    { header: "# Counts", key: "n", width: 10 },
    { header: "Last Count", key: "last", width: 13 },
    { header: "True Burn / day (usage units)", key: "burnU", width: 26 },
    { header: "True Burn / day (count units)", key: "burnC", width: 26 },
  ];
  burn.columns = BCOLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  for (const it of report.items) {
    burn.addRow([
      it.item_name, it.catalog_number ?? "", it.count_unit ?? "each", it.count_count,
      dateOnly(it.last_counted_at),
      it.true_burn_per_day == null ? "" : it.true_burn_per_day,
      it.true_burn_per_day_count_unit == null ? "" : it.true_burn_per_day_count_unit,
    ]);
  }
  styleSheet(burn, BCOLS.length, thinBorder);
  burn.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Count History&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  burn.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`;
  await burn.protect(exportPwd, lockedProtect);

  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

// Shared header + zebra styling for a data sheet, all cells locked.
function styleSheet(ws: any, colCount: number, thinBorder: any) {
  const header = ws.getRow(1); header.height = 20;
  header.eachCell((cell: any) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });
  const last = ws.rowCount;
  for (let r = 2; r <= last; r++) {
    const dataRow = ws.getRow(r);
    const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
    dataRow.eachCell({ includeEmpty: true }, (cell: any) => {
      cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = thinBorder;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.protection = { locked: true };
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}
