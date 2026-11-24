// server/ptEventsExport.ts
//
// The VeritaPT event list as a workbook (server/ptEvents.ts), and the workbook frame the period report uses too
// (server/ptReportExport.ts). CLAUDE.md section 6, customer-facing: About first and active, the lab's name and CLIA on About
// and in every header and footer, every sheet protected, brand colors, blank cells for nothing, no em dashes.
import { PT_CONCLUSION_LABEL, PT_STATUS_LABEL, PT_SUBMISSION_LABEL, ptMethodLabel, ptStatusText, ptUngradedReasonText, type PtEvent, type PtEventFilters, type PtResult } from "@shared/ptEvents";

const TEAL = "FF01696F", TINT = "FFE6F2F2", ALT = "FFEBF3F8", TEXT = "FF28251D", DARK = "FF0A3A3D";
export const PT_XLSX_COLORS = { green: "FF437A22", red: "FFA12C7B", amber: "FF964219", gray: "FF7A7974" } as const;
/** The color of a status word in a cell, or none. */
export const ptCellColor = (v: unknown): string | undefined => ({
  [PT_STATUS_LABEL.acceptable]: PT_XLSX_COLORS.green, [PT_STATUS_LABEL.unacceptable]: PT_XLSX_COLORS.red,
  [PT_STATUS_LABEL.ungraded]: PT_XLSX_COLORS.amber, [PT_STATUS_LABEL.not_graded]: PT_XLSX_COLORS.gray,
  [PT_SUBMISSION_LABEL.on_time]: PT_XLSX_COLORS.green, [PT_SUBMISSION_LABEL.late]: PT_XLSX_COLORS.red, [PT_SUBMISSION_LABEL.not_recorded]: PT_XLSX_COLORS.amber,
} as Record<string, string>)[String(v)];

export interface PtSheet { name: string; columns: Array<[string, number]>; rows: any[][] }
export interface PtWorkbookInput {
  title: string;
  labName: string | null;
  clia: string | null;
  about: Array<{ heading: string; lines: string[] }>;
  sheets: PtSheet[];
}

/** A VeritaPT workbook: the About sheet from the caller's own words, then one table per sheet. */
export async function buildPtWorkbook(input: PtWorkbookInput, applyLicense: (wb: any) => void): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = new Date();
  const identity = `${input.labName || "Lab name not on file"}    CLIA: ${input.clia || "Not on file"}`;
  const hf = identity.replace(/&/g, "&&");
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const protect = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: true, pivotTables: false };
  // A space after each size code: a lab name starting with a digit would otherwise read as part of it.
  const frame = (ws: any) => {
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10 ${input.title}&R&"Calibri,Regular"&10 ${hf}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9 ${hf}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9 VeritaAssure`;
  };

  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const cell = (r: number, value: string, font: any, fill?: string, height?: number) => {
    const c = about.getCell(`A${r}`);
    c.value = value;
    c.font = { name: "Calibri", ...font };
    if (fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    c.alignment = { vertical: "top", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = height ?? Math.max(20, (Math.floor(value.length / 100) + 1) * 16);
  };
  cell(1, input.title, { bold: true, size: 14, color: { argb: "FFFFFFFF" } }, TEAL, 30);
  cell(2, `Prepared for: ${identity}`, { bold: true, size: 11, color: { argb: DARK } }, TINT, 24);
  let row = 3;
  for (const s of input.about) {
    cell(row++, s.heading, { bold: true, size: 12, color: { argb: DARK } }, TINT, 22);
    for (const line of s.lines) cell(row++, line, { size: 11, color: { argb: TEXT } });
  }
  frame(about);
  await about.protect(pwd, { ...protect, autoFilter: false });

  for (const s of input.sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.columns.map(([header, width], i) => ({ header, key: `c${i}`, width }));
    const head = ws.getRow(1);
    head.height = 32;
    head.eachCell((c: any) => {
      c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      c.border = border;
    });
    s.rows.forEach((values, i) => {
      const r = ws.addRow(values.map((v) => (v === undefined || v === "" ? null : v)));
      r.eachCell({ includeEmpty: true }, (c: any) => {
        const color = ptCellColor(c.value);
        c.font = { name: "Calibri", size: 10, bold: !!color, color: { argb: color ?? TEXT } };
        c.alignment = { vertical: "middle", wrapText: true };
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 1 ? ALT : "FFFFFFFF" } };
        c.border = border;
      });
    });
    ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 1, topLeftCell: "B2" }];
    ws.autoFilter = { from: "A1", to: ws.getCell(1, s.columns.length).address };
    ws.pageSetup = { paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1", margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } } as any;
    frame(ws);
    await ws.protect(pwd, protect);
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  applyLicense(wb);
  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

/** The newest evaluation of an ungraded result in words, or that it is still open. */
function evaluationWords(r: PtResult): string {
  if (r.status !== "ungraded") return "";
  const e = r.evaluations[0];
  return e ? `${PT_CONCLUSION_LABEL[e.conclusion]} on ${e.performed_date}. ${ptMethodLabel(e.method)}; ${e.acceptance_criteria}. Recorded by ${e.recorded_by_name ?? "name not on file"}.` : "Open";
}

/** The filters in words, for the About sheet. */
function filterWords(f: PtEventFilters): string {
  const parts = [
    f.program ? `program ${f.program}` : "", f.analyte ? `analyte ${f.analyte}` : "", f.department ? `department ${f.department}` : "",
    f.status ? `status ${PT_STATUS_LABEL[f.status as keyof typeof PT_STATUS_LABEL] ?? f.status}` : "", f.from ? `from ${f.from}` : "", f.to ? `to ${f.to}` : "",
  ].filter(Boolean);
  return parts.length ? `Cut to: ${parts.join(", ")}.` : "Every event on file.";
}

export function buildPtEventsWorkbook(
  input: { labName: string | null; clia: string | null; today: string; events: PtEvent[]; filters: PtEventFilters },
  applyLicense: (wb: any) => void,
): Promise<Buffer> {
  const results = input.events.reduce((n, e) => n + e.results.length, 0);
  return buildPtWorkbook({
    title: "VeritaPT™ Event List", labName: input.labName, clia: input.clia,
    about: [
      { heading: "About this workbook", lines: ["The Events sheet lists this laboratory's proficiency testing events, one row per event of a program, as the Events tab shows them. The Results sheet lists every result of those events, one row per result.", "This workbook repeats what the laboratory recorded in VeritaPT. It does not grade a result and it does not replace the program's own report. Review of proficiency testing results belongs to the laboratory director or designee."] },
      { heading: "How to use this workbook", lines: ["Filter any column. A status is the program's grade as the laboratory recorded it: Acceptable, Unacceptable, Ungraded or Not yet graded. An event's submission reads On time or Late only when the laboratory entered both its due date and its submitted date."] },
      { heading: "What it covers and where it comes from", lines: [`${filterWords(input.filters)} ${input.events.length} ${input.events.length === 1 ? "event" : "events"}, ${results} ${results === 1 ? "result" : "results"}. Exported ${input.today}.`, "Entered by the laboratory in VeritaPT. Department is the VeritaMap® department of the analyzers that run the analyte. An event is the results of one program that share an event code or name, or an event date when neither is entered."] },
      { heading: "Coverage gaps", lines: ["If your laboratory needs a column or view not represented here, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision."] },
    ],
    sheets: [
      {
        name: "Events",
        columns: [["Event", 26], ["Program", 34], ["Analytes", 40], ["Department", 20], ["Event Date", 13], ["Due Date", 13], ["Submitted Date", 14], ["Submission", 20], ["Results", 9], ["Status", 34]],
        rows: input.events.map((e) => [e.name, e.program, e.analytes.join(", "), e.departments.join(", "), e.event_date, e.due_date, e.submitted_date, PT_SUBMISSION_LABEL[e.submission], e.results.length, ptStatusText(e.counts)]),
      },
      {
        name: "Results",
        columns: [["Event", 26], ["Program", 34], ["Analyte", 24], ["Department", 20], ["Event Date", 13], ["Method", 20], ["Result", 11], ["Peer Mean", 11], ["Peer SD", 11], ["Peer Group Size", 11], ["SDI", 9], ["Lowest Acceptable", 12], ["Highest Acceptable", 12], ["Status", 16], ["Why Ungraded", 24], ["Laboratory's Evaluation", 34], ["Tested By", 22], ["Due Date", 13], ["Submitted Date", 14], ["Notes", 40]],
        rows: input.events.flatMap((e) => e.results.map((r) => [e.name, e.program, r.analyte, r.department, r.event_date, r.your_method, r.your_result, r.peer_mean, r.peer_sd, r.peer_n, r.sdi, r.acceptable_low, r.acceptable_high, PT_STATUS_LABEL[r.status], ptUngradedReasonText(r.ungraded_reason, r.ungraded_reason_text), evaluationWords(r), r.tested_by, r.submission_due_date, r.submitted_date, r.notes])),
      },
    ],
  }, applyLicense);
}
