// server/stewardshipExport.ts
//
// One antibiogram version as a workbook (server/stewardship.ts). CLAUDE.md section 6, customer-facing workbook: the About sheet
// first and active, lab identity in three layers (About row, page header, page footer), every sheet locked with the password from
// env, brand colors only, no em dashes. Sheets: About; Antibiogram (percent susceptible, organisms down and antimicrobials
// across, by organism group, as on the approved mock); Totals (the counts as entered or uploaded, one row per organism and
// antimicrobial). No patient information exists to export.

import type { AbgGroup, AbgRow, BelowThresholdMode } from "../shared/antibiogramRules";
import { ORGANISM_GROUP_LABELS, percentSusceptible } from "../shared/antibiogramRules";

export interface AntibiogramExportInput {
  antibiogram: any;
  rows: AbgRow[];
  rule: { threshold: number; mode: BelowThresholdMode; note: string };
  table: AbgGroup[];
}
export interface AntibiogramExportContext { labName: string | null; cliaNumber: string | null; today: string }

const TEAL = "FF01696F", TINT = "FFE6F2F2", ALT = "FFEBF3F8", TEXT = "FF28251D", DARK = "FF0A3A3D";
const GREEN = "FF437A22", AMBER = "FF964219", RED = "FFA12C7B", GRAY = "FF7A7974";

/** The words on the sheet for a cell: the percent, "*" when below the threshold and suppressed, blank when not tested. */
export function antibiogramCellText(cell: { pct: number | null; below: boolean; shown: boolean } | undefined): string {
  if (!cell) return "";
  if (!cell.shown) return "*";
  return cell.pct == null ? "" : `${cell.pct}${cell.below ? " (fewer isolates)" : ""}`;
}

export async function generateAntibiogramExcel(input: AntibiogramExportInput, ctx: AntibiogramExportContext): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const a = input.antibiogram;
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure"; wb.lastModifiedBy = "VeritaAssure"; wb.created = new Date(); wb.modified = new Date();
  const labName = ctx.labName || "Lab name not on file";
  const idText = `${labName}    CLIA: ${ctx.cliaNumber || "Not on file"}`;
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const protect = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: true };
  const header = `&L&"Calibri,Regular"&10VeritaQA™ Cumulative Antibiogram&R&"Calibri,Regular"&10${idText}`;
  const footer = `&L&"Calibri,Regular"&9${idText}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  const status = a.status === "released"
    ? `Released ${a.released_day ?? ""}, approved by ${a.released_by_name ?? ""}, ${a.released_by_title ?? ""}`
    : "Draft: not released";

  // ── About ─────────────────────────────────────────────────────────────
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaQA™ Cumulative Antibiogram";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  title.alignment = { vertical: "middle", indent: 1 };
  about.getRow(1).height = 30;
  const id = about.getCell("A2");
  id.value = `Prepared for: ${idText}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: DARK } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
  id.alignment = { vertical: "top", wrapText: true, indent: 1 };
  id.border = border;
  let row = 3;
  const section = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", bold: true, size: 12, color: { argb: DARK } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }; c.alignment = { wrapText: true, indent: 1 }; c.border = border; row += 1; };
  const body = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", size: 11, color: { argb: TEXT } }; c.alignment = { vertical: "top", wrapText: true, indent: 1 }; c.border = border; about.getRow(row).height = Math.max(1, Math.ceil(s.length / 88)) * 16 + 4; row += 1; };
  section("This antibiogram");
  body(`${a.title}, version ${a.version}. Analysis period ${a.period_start} to ${a.period_end}. Specimen sources: ${a.source_filter || "not stated"}. ${status}. Exported ${ctx.today}.`);
  section("How it was built");
  body(`Each percent is the number of isolates susceptible divided by the number tested, as a whole percent. Intermediate results are not counted as susceptible. Isolates counted: ${input.rule.note} A percent is reported only where at least ${input.rule.threshold} isolates were tested; ${input.rule.mode === "flag" ? "below that, the percent is shown and marked (fewer isolates)" : "below that, the percent is not shown and the cell reads *"}. An organism's isolates column is the most tested for any of its antimicrobials.`);
  section("How to use it");
  body("The Antibiogram sheet is the table the laboratory releases to its stewardship committee: organisms down, antimicrobials across. The Totals sheet holds the counts behind every percent, one row per organism and antimicrobial, so any percent can be checked by hand. A blank cell means not tested or not reported. To change a draft, edit it on the VeritaQA™ Stewardship tab; a released version is locked and a change starts a new version.");
  section("Source");
  body(`Totals ${a.data_source ? `from ${a.data_source}` : "entered by the laboratory"}. The laboratory's LIS removes repeat isolates from the same patient before the totals reach VeritaAssure®, which holds no patient records.`);
  section("Disclaimer");
  body("Percent susceptible guides the choice of empiric therapy; it does not replace the patient's own culture and susceptibility result. The release of this antibiogram belongs to the medical director or designee.");
  section("Coverage gaps");
  body("If an organism group, column or layout you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(pwd, { ...protect, autoFilter: false });

  // ── Antibiogram (the matrix) ───────────────────────────────────────────
  const ws = wb.addWorksheet("Antibiogram");
  const maxDrugs = Math.max(1, ...input.table.map((g) => g.drugs.length));
  ws.getColumn(1).width = 40;
  ws.getColumn(2).width = 10;
  for (let c = 3; c < 3 + maxDrugs; c++) ws.getColumn(c).width = 14;
  const hdr = (cells: (string | null)[]) => {
    const r = ws.addRow(cells);
    r.height = 30;
    r.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
    return r;
  };
  const bar = (label: string) => {
    const r = ws.addRow([label]);
    r.height = 20;
    ws.mergeCells(r.number, 1, r.number, 2 + maxDrugs);
    const c = r.getCell(1);
    c.font = { name: "Calibri", bold: true, size: 11, color: { argb: DARK } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }; c.alignment = { vertical: "middle", indent: 1 }; c.border = border;
  };
  hdr(["Organism", "Isolates", ...Array.from({ length: maxDrugs }, () => "")]).getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  let dataRow = 0;
  for (const g of input.table) {
    bar(ORGANISM_GROUP_LABELS[g.group]);
    const dh = ws.addRow(["Antimicrobial", null, ...g.drugs]);
    dh.height = 30;
    dh.eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", bold: true, size: 10, color: { argb: DARK } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
    for (const o of g.organisms) {
      const r = ws.addRow([`${o.organism}${o.below ? ` (fewer than ${input.rule.threshold})` : ""}`, o.isolates, ...g.drugs.map((d) => antibiogramCellText(o.cells[d]) || null)]);
      const bg = dataRow++ % 2 === 1 ? ALT : "FFFFFFFF";
      r.eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: TEXT } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.protection = { locked: true }; });
      r.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      g.drugs.forEach((d, i) => {
        const cell = o.cells[d];
        if (!cell || !cell.shown || cell.pct == null) return;
        const color = cell.pct >= 90 ? GREEN : cell.pct >= 70 ? AMBER : RED;
        r.getCell(3 + i).font = { name: "Calibri", size: 10, bold: true, color: { argb: cell.below ? GRAY : color } };
      });
    }
  }
  const legend = ws.addRow([`Percent susceptible. Blank: not tested or not reported. ${input.rule.mode === "flag" ? `(fewer isolates): under ${input.rule.threshold} isolates tested, shown for reference.` : `*: under ${input.rule.threshold} isolates tested, percent not shown.`}`]);
  ws.mergeCells(legend.number, 1, legend.number, 2 + maxDrugs);
  legend.getCell(1).font = { name: "Calibri", size: 9, italic: true, color: { argb: GRAY } };
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  ws.headerFooter.oddHeader = header;
  ws.headerFooter.oddFooter = footer;
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } as any;
  await ws.protect(pwd, { ...protect, autoFilter: false });

  // ── Totals (the counts) ───────────────────────────────────────────────
  const tot = wb.addWorksheet("Totals");
  const cols = [
    { header: "Organism group", width: 24 }, { header: "Organism", width: 38 }, { header: "Antimicrobial", width: 30 },
    { header: "Number tested", width: 12 }, { header: "Number susceptible", width: 13 }, { header: "Number intermediate", width: 13 },
    { header: "Number resistant", width: 12 }, { header: "Percent susceptible", width: 12 }, { header: "Shown on the antibiogram", width: 16 },
  ];
  tot.columns = cols;
  for (const r of input.rows) {
    const below = r.tested < input.rule.threshold;
    const shown = below ? (input.rule.mode === "flag" ? "Yes, marked fewer isolates" : "No, fewer isolates") : "Yes";
    tot.addRow([ORGANISM_GROUP_LABELS[r.organism_group] ?? r.organism_group, r.organism, r.antimicrobial, r.tested, r.susceptible, r.intermediate ?? null, r.resistant ?? null, percentSusceptible(r.susceptible, r.tested), shown]);
  }
  const th = tot.getRow(1);
  th.height = 20;
  th.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
  for (let r = 2; r <= tot.rowCount; r++) {
    const bg = r % 2 === 0 ? ALT : "FFFFFFFF";
    tot.getRow(r).eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: TEXT } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.protection = { locked: true }; });
  }
  tot.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  tot.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  tot.headerFooter.oddHeader = header;
  tot.headerFooter.oddFooter = footer;
  await tot.protect(pwd, protect);

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }] as any;
  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}
