// server/qualityReportFiles.ts
//
// The VeritaQA reports as files (B15): the report across an organization's laboratories (server/orgQuality.ts) and one
// laboratory's report across all of its indicators (server/labQualityReport.ts), each as a PDF and a workbook. Management
// reports for internal use, so there is no signature line. CLAUDE.md section 5 (header with name and CLIA from the live records,
// footer on every page, author stamp) and section 6 (About first, identity in three layers, protected, brand colors).
import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import type { SystemReport, SystemReportIndicator } from "./orgQuality";
import type { LabReport, LabReportRow } from "./labQualityReport";
import { MONTH_SHORT, ORG_FREQUENCY_LABEL, ORG_KIND_LABEL, monthKey, trimNumber, valueText, type OrgFrequency, type OrgIndicatorKind } from "@shared/qualityIndicators";

export const QUALITY_PDF_CLIA_MISSING = "CLIA: Not on file. Enter it in account settings.";
export const QUALITY_PDF_FOOTER_TEXT = "VeritaAssure® | VeritaQA™ | Confidential, For Internal Lab Use Only";
const TEAL = "#01696F", TINT = "#E6F2F2", ALT = "#EBF3F8", TEXT = "#28251D", DARK = "#0A3A3D", GREEN = "#437A22", AMBER = "#964219", RED = "#A12C7B", GRAY = "#7A7974";
const argb = (hex: string) => `FF${hex.slice(1)}`;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const n = (x: number | null | undefined) => (x == null ? "" : Number(x).toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** Green for met, amber for watch and not judged, plum for missed, gray for nothing entered. */
export function resultColor(text: string): string {
  if (text === "Met") return GREEN;
  if (text === "Missed") return RED;
  if (text === "Watch") return AMBER;
  if (text === "No entry" || text === "Not judged") return GRAY;
  const m = /^Met (\d+) of (\d+)$/.exec(text);
  return m ? (m[1] === m[2] ? GREEN : AMBER) : TEXT;
}

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: ${TEXT}; margin: 0; font-size: 8.5pt; }
  .bar { background: ${TEAL}; color: #fff; padding: 10px 12px; border-radius: 4px; }
  .bar h1 { font-size: 15pt; margin: 0; } .bar div { font-size: 9pt; opacity: .95; margin-top: 2px; }
  .meta { margin: 8px 6px 4px 0; font-size: 8.5pt; line-height: 1.45; }
  h2 { color: ${DARK}; font-size: 11pt; margin: 12px 0 4px; padding: 4px 8px; background: ${TINT}; break-after: avoid; }
  /* Every table of a report has the same columns at the same widths, so they line up down the page. */
  table { border-collapse: collapse; width: 100%; table-layout: fixed; margin-bottom: 8px; } thead { display: table-header-group; }
  th { background: ${TEAL}; color: #fff; font-size: 8pt; padding: 3px 5px; text-align: left; border: .5px solid #D0D0D0; overflow-wrap: break-word; }
  th.r, td.r { text-align: right; font-variant-numeric: tabular-nums; } th.c, td.c { text-align: center; }
  /* The table's name repeats with its headings on every page it runs to. */
  th.cap { background: #fff; color: ${TEAL}; font-size: 9.5pt; padding: 4px 0 2px; border: 0; }
  td { padding: 3px 5px; border: .5px solid #D0D0D0; vertical-align: top; overflow-wrap: break-word; }
  tr { break-inside: avoid; } tr.alt td { background: ${ALT}; }
  tr.def td { font-size: 8pt; border: 0; padding: 0 0 4px; break-after: avoid; } tr.def { break-after: avoid; }
  tr.total td { font-weight: 700; background: ${TINT}; } tr.total { break-before: avoid; }
  .muted, th.cap .muted { color: ${GRAY}; font-weight: 400; } .note { font-size: 7.5pt; color: ${GRAY}; }
  /* A month cell keeps room for its letter whether or not it has one, so the numbers line up under the month's name. */
  .m td.mo { font-size: 8pt; text-align: right; font-variant-numeric: tabular-nums; padding-left: 1px; padding-right: 2px; white-space: nowrap; }
  .m th.mo { text-align: right; padding-left: 1px; padding-right: 17px; }
  .m td.mo i { display: inline-block; width: 15px; white-space: pre; text-align: left; font-style: normal; font-weight: 700; font-size: 7pt; }
  .m td.mo.ne { font-size: 6.5pt; color: ${GRAY}; text-align: center; }
  .m.wide td.mo.ne { font-size: 8pt; text-align: right; padding-right: 17px; }
  /* A short table stays on one page; a long one breaks between rows, with its name and headings again on the next page. */
  .block, table.keep { break-inside: avoid-page; }
`;
const FOOTER_TEMPLATE = `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:${GRAY};padding:0 12mm;">${esc(QUALITY_PDF_FOOTER_TEXT)} | Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

async function renderPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await setPdfContent(page, html);
    const pdf = await page.pdf({ format: "Letter", landscape: true, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: FOOTER_TEMPLATE, margin: { top: "11mm", right: "12mm", bottom: "15mm", left: "12mm" } });
    return await stampPdfAuthor(pdf);
  } finally {
    await page.close();
  }
}

const doc = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
const changeText = (i: SystemReportIndicator) => i.changes.map((c) => `The definition changed from ${c.effective_from} (version ${c.version}).`).join(" ");
const kindLine = (i: SystemReportIndicator) => `${ORG_KIND_LABEL[i.kind as OrgIndicatorKind] ?? i.kind}. Entered ${ORG_FREQUENCY_LABEL[i.frequency as OrgFrequency]?.toLowerCase() ?? i.frequency}.`;
const numLine = (i: SystemReportIndicator) => i.kind === "count" ? `Counts: ${i.numerator_text ?? ""}` : `Numerator: ${i.numerator_text ?? ""}. Denominator: ${i.denominator_text ?? ""}`;
export const totalText = (i: SystemReportIndicator): string =>
  i.total.shown ? `${valueText(i.total.value, i.total.unit)}` : i.total.reason ?? "";

// ── Across an organization's laboratories ────────────────────────────────────

export const SYSTEM_REPORT_NOTE = "Totals add up numerators and denominators; percents are never averaged. A laboratory with no entry is shown as No entry and counts as neither met nor missed. Targets are the organization's own.";

const cols = (widths: number[]) => widths.map((w) => `<col style="width:${w}%">`).join("");
const SYSTEM_COLUMNS = cols([25, 9, 10, 11, 14, 8, 7, 16]);

export function systemReportHTML(r: SystemReport): string {
  const filters = [r.group ? `Group: ${r.group.name}` : "All laboratories", r.department ? `Department: ${r.department}` : "All departments"].join(". ");
  const blocks = r.indicators.map((i) => `
    <table${i.rows.length <= 12 ? ` class="keep"` : ""}><colgroup>${SYSTEM_COLUMNS}</colgroup><thead><tr><th class="cap" colspan="8">${esc(i.name)} <span class="muted">(${esc(i.department)})</span></th></tr>
    <tr><th>Laboratory</th><th class="r">${i.kind === "count" ? "Count" : "Numerator"}</th><th class="r">Denominator</th><th class="r">Value</th><th>Target</th><th>Result</th><th class="c">Entries</th><th>Note</th></tr></thead><tbody>
    <tr class="def"><td colspan="8">${i.definition ? `${esc(i.definition)} ` : ""}${esc(numLine(i))}. ${esc(kindLine(i))}${i.changes.length ? ` <b>${esc(changeText(i))}</b>` : ""}</td></tr>
    ${i.rows.map((x, k) => `<tr${k % 2 ? ` class="alt"` : ""}><td>${esc(x.lab_name)}${x.off_since ? ` <span class="note">off since ${esc(x.off_since)}</span>` : ""}</td><td class="r">${n(x.result.numerator)}</td><td class="r">${n(x.result.denominator)}</td><td class="r">${x.result.state === "no_entry" ? `<span class="muted">No entry</span>` : esc(valueText(x.result.value, x.result.unit))}</td><td>${esc(x.target_text)}</td><td style="font-weight:700;color:${resultColor(x.result_text)}">${esc(x.result_text)}</td><td class="c">${x.result.entered} of ${x.result.expected}</td><td class="note">${esc(x.result.note ?? "")}</td></tr>`).join("")}
    <tr class="total"><td>Total, ${i.total.labs_counted} of ${i.rows.length} ${i.rows.length === 1 ? "laboratory" : "laboratories"} with an entry</td>${i.total.shown ? `<td class="r">${n(i.total.numerator)}</td><td class="r">${n(i.total.denominator)}</td><td class="r">${esc(valueText(i.total.value, i.total.unit))}</td><td colspan="4"></td>` : `<td colspan="7">${esc(i.total.reason ?? "")}</td>`}</tr>
    </tbody></table>`).join("");
  return doc(`
    <div class="bar"><h1>Quality Indicators Across Laboratories</h1><div>Prepared for: ${esc(r.organization.name)}, ${r.labs.length} ${r.labs.length === 1 ? "laboratory" : "laboratories"}</div></div>
    <p class="meta"><b>${esc(r.period.label)}</b>. ${esc(filters)}. Generated ${esc(r.generated)}.<br>${esc(SYSTEM_REPORT_NOTE)}</p>
    ${blocks || `<p class="meta">No organization indicator is turned on in these laboratories${r.department ? " for this department" : ""}.</p>`}
    <div${r.labs.length <= 12 ? ` class="block"` : ""}>
    <table><colgroup><col style="width:62%"><col></colgroup><thead><tr><th class="cap" colspan="2">Laboratories in this report</th></tr><tr><th>Laboratory</th><th>CLIA</th></tr></thead><tbody>${r.labs.map((l, k) => `<tr${k % 2 ? ` class="alt"` : ""}><td>${esc(l.lab_name)}</td><td>${l.clia_number ? esc(l.clia_number) : "Not on file. Enter it in account settings."}</td></tr>`).join("")}</tbody></table></div>`);
}

export const systemReportPDF = (r: SystemReport) => renderPdf(systemReportHTML(r));
const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "Report";
export const systemReportFilename = (r: SystemReport, ext: "pdf" | "xlsx") => `VeritaQA_System_Report_${safe(r.organization.name)}_${r.period.fileTag}.${ext}`;

// ── One laboratory ──────────────────────────────────────────────────────────

export const LAB_REPORT_NOTE = "Met: within the target. Watch: outside the target, within the laboratory's yellow threshold. Missed: beyond it. No entry: nothing was entered that month; it counts as neither met nor missed. Not judged: no single target applies. A period total is shown only for an indicator entered as a numerator and a denominator; values entered alone are listed by month and not averaged. Targets are the laboratory's own.";
/** The month columns of a quarter or a year say it in a letter as well as a color, so a black and white print reads the same. */
export const LAB_REPORT_KEY = "Month columns: W after a number is Watch, M is Missed. A number with no letter met its target, or has no target set.";
export const STATUS_LETTER: Record<string, string> = { yellow: "W", red: "M" };

const rowName = (x: LabReportRow) => `${esc(x.name)}${x.organization ? ` <span class="note">${esc(x.organization)}</span>` : ""}${x.off_since ? ` <span class="note">turned off ${esc(x.off_since)}</span>` : x.inactive ? ` <span class="note">inactive</span>` : ""}`;

export function labReportHTML(r: LabReport): string {
  const month = r.period.kind === "month", months = r.period.months.length;
  const columns = month ? cols([24, 13, 10, 9, 11, 8, 25]) : months === 12 ? cols([15, 9, ...Array(12).fill(5.1), 7.3, 7.5]) : cols([30, 17, 11, 11, 11, 10, 10]);
  const width = month ? 7 : months + 4;
  const head = month
    ? `<th>Indicator</th><th>Target</th><th class="r">Value</th><th class="r">Numerator</th><th class="r">Denominator or volume</th><th>Result</th><th>Notes, root cause and linked findings</th>`
    : `<th>Indicator</th><th>Target</th>${r.period.months.map((m) => `<th class="mo">${MONTH_SHORT[m - 1]}</th>`).join("")}<th class="r">Period total</th><th>Result</th>`;
  const colorOf = (s: string | null) => (s === "green" ? GREEN : s === "yellow" ? AMBER : s === "red" ? RED : TEXT);
  // Twelve columns leave room for five characters at the table's size; a longer number is set smaller rather than run over its border.
  const monthCell = (m: LabReportRow["months"][number]) => {
    if (m.value == null) return `<td class="mo ne">${m.due ? "No entry" : ""}</td>`;
    const t = trimNumber(m.value), size = months < 12 || t.length <= 5 ? "" : `;font-size:${Math.floor(160 / t.length) / 4}pt`;
    const mark = `${(m.status && STATUS_LETTER[m.status]) || ""}${m.findings.length ? "*" : ""}`;
    return `<td class="mo" style="color:${colorOf(m.status)}${size}">${esc(t)}<i>${mark ? ` ${mark}` : ""}</i></td>`;
  };
  const row = (x: LabReportRow, k: number) => {
    const tr = `<tr${k % 2 ? ` class="alt"` : ""}>`;
    if (month) {
      const m = x.months[0];
      const notes = [m.notes, m.root_cause ? `Root cause: ${m.root_cause}` : "", m.corrective_action ? `Corrective action: ${m.corrective_action}` : "", m.findings.length ? `Linked: ${m.findings.map((f) => f.label).join("; ")}` : ""].filter(Boolean);
      return `${tr}<td>${rowName(x)}</td><td>${esc(x.target_text)}</td><td class="r">${m.value == null ? `<span class="muted">No entry</span>` : esc(m.value_text)}</td><td class="r">${n(m.numerator)}</td><td class="r">${n(m.denominator ?? m.volume)}</td><td style="font-weight:700;color:${resultColor(x.result_text)}">${esc(x.result_text)}</td><td class="note" style="color:${TEXT}">${notes.map(esc).join("<br>")}</td></tr>`;
    }
    return `${tr}<td>${rowName(x)}</td><td>${esc(x.target_text)}</td>${x.months.map(monthCell).join("")}<td class="r"><b>${esc(x.period_text)}</b></td><td style="font-weight:700;color:${resultColor(x.result_text)}">${esc(x.result_text)}</td></tr>`;
  };
  const anyLinked = r.sections.some((s) => s.departments.some((d) => d.rows.some((x) => x.months.some((m) => m.findings.length))));
  const linkedList = !month && anyLinked ? `<table><colgroup>${cols([40, 15, 45])}</colgroup><thead><tr><th class="cap" colspan="3">Linked findings</th></tr><tr><th>Indicator</th><th>Month</th><th>VeritaResponse&#8482; entry</th></tr></thead><tbody>${
    r.sections.flatMap((s) => s.departments.flatMap((d) => d.rows.flatMap((x) => x.months.flatMap((m) => m.findings.map((f) => [x.name, monthKey(r.period.year, m.month), f.label]))))).map((c, k) => `<tr${k % 2 ? ` class="alt"` : ""}>${c.map((t) => `<td>${esc(t)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : "";
  return doc(`
    <div class="bar"><h1>Quality Indicator Report</h1><div>Prepared for: ${esc(r.lab.name || "Lab name not on file")} &nbsp;&nbsp; ${r.lab.clia ? `CLIA: ${esc(r.lab.clia)}` : QUALITY_PDF_CLIA_MISSING}</div></div>
    <p class="meta"><b>${esc(r.period.label)}</b>. ${r.counts.indicators} ${r.counts.indicators === 1 ? "indicator" : "indicators"}: ${r.counts.with_entries} with an entry, ${r.counts.no_entry} with no entry. Generated ${esc(r.generated)}.<br>${esc(LAB_REPORT_NOTE)}${month ? "" : `<br><b>${esc(LAB_REPORT_KEY)}</b>`}</p>
    ${r.sections.map((s) => `<h2>${esc(s.title)}</h2>${s.departments.map((d) => `<table class="${month ? "" : months === 12 ? "m" : "m wide"}${d.rows.length <= 4 ? " keep" : ""}"><colgroup>${columns}</colgroup><thead><tr><th class="cap" colspan="${width}">${esc(d.name)} <span class="muted">(${d.rows.length})</span></th></tr><tr>${head}</tr></thead><tbody>${d.rows.map(row).join("")}</tbody></table>`).join("")}`).join("") || `<p class="meta">No indicators yet.</p>`}
    ${!month && anyLinked ? `<p class="note">* A VeritaResponse&#8482; entry is linked to that month; see Linked findings.</p>` : ""}${linkedList}`);
}

export const labReportPDF = (r: LabReport) => renderPdf(labReportHTML(r));
export const labReportFilename = (r: LabReport, ext: "pdf" | "xlsx") => `VeritaQA_Report_${safe(r.lab.name || "Laboratory")}_${r.period.fileTag}.${ext}`;

// ── Workbooks ───────────────────────────────────────────────────────────────

const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
const border: any = { top: thin, bottom: thin, left: thin, right: thin };
const PROTECT = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: true };

async function workbook(o: { product: string; identity: string; about: [string, string][]; sheets: { name: string; columns: { header: string; width: number; align?: "right" | "center" }[]; rows: (string | number | null)[][]; resultColumn?: number; freeze: number }[] }): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure"; wb.lastModifiedBy = "VeritaAssure"; wb.created = new Date(); wb.modified = new Date();
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const amp = (s: string) => s.replace(/&/g, "&&");
  const header = `&L&"Calibri,Regular"&10${amp(o.product)}&R&"Calibri,Regular"&10${amp(o.identity)}`;
  const footer = `&L&"Calibri,Regular"&9${amp(o.identity)}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = o.product;
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(TEAL) } };
  title.alignment = { vertical: "middle", indent: 1 };
  about.getRow(1).height = 30;
  const id = about.getCell("A2");
  id.value = `Prepared for: ${o.identity}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: argb(DARK) } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(TINT) } };
  id.alignment = { vertical: "top", wrapText: true, indent: 1 };
  id.border = border;
  let row = 3;
  for (const [head, body] of o.about) {
    const h = about.getCell(`A${row++}`);
    h.value = head; h.font = { name: "Calibri", bold: true, size: 12, color: { argb: argb(DARK) } }; h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(TINT) } }; h.alignment = { wrapText: true, indent: 1 }; h.border = border;
    const b = about.getCell(`A${row}`);
    b.value = body; b.font = { name: "Calibri", size: 11, color: { argb: argb(TEXT) } }; b.alignment = { vertical: "top", wrapText: true, indent: 1 }; b.border = border;
    about.getRow(row++).height = Math.max(1, Math.ceil(body.length / 88)) * 16 + 4;
  }
  about.headerFooter.oddHeader = header; about.headerFooter.oddFooter = footer;
  await about.protect(pwd, { ...PROTECT, autoFilter: false });

  for (const s of o.sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.columns = s.columns.map((c) => ({ header: c.header, width: c.width }));
    for (const r of s.rows) ws.addRow(r);
    const th = ws.getRow(1);
    th.height = 20;
    th.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(TEAL) } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
    for (let i = 2; i <= ws.rowCount; i++) {
      const bg = i % 2 === 0 ? "FFFFFFFF" : argb(ALT);
      ws.getRow(i).eachCell({ includeEmpty: true }, (c: any, col: number) => {
        c.font = { name: "Calibri", size: 10, color: { argb: argb(TEXT) } };
        c.alignment = { vertical: "middle", wrapText: true, horizontal: s.columns[col - 1]?.align ?? "left" };
        c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.protection = { locked: true };
      });
      if (s.resultColumn) {
        const c = ws.getRow(i).getCell(s.resultColumn);
        c.font = { name: "Calibri", size: 10, bold: true, color: { argb: argb(resultColor(String(c.value ?? ""))) } };
      }
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    ws.views = [{ state: "frozen", xSplit: s.freeze, ySplit: 1 }];
    ws.headerFooter.oddHeader = header; ws.headerFooter.oddFooter = footer;
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } as any;
    await ws.protect(pwd, PROTECT);
  }
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }] as any;
  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

const COVERAGE_GAPS = "If a number, a column or a layout you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.";
const round = (x: number | null | undefined) => (x == null ? null : Math.round((x + Number.EPSILON) * 100) / 100);

export function systemReportExcel(r: SystemReport): Promise<Buffer> {
  const identity = `${r.organization.name}, ${r.labs.length} ${r.labs.length === 1 ? "laboratory" : "laboratories"}`;
  return workbook({
    product: "VeritaQA™ Quality Indicators Across Laboratories", identity,
    about: [
      ["Disclaimer", "Internal quality management report. The numbers are what each laboratory entered; their review and any action belong to the laboratory's medical director or designee and the organization."],
      ["This report", `${r.period.label}. ${r.group ? `Group: ${r.group.name}.` : "All laboratories."} ${r.department ? `Department: ${r.department}.` : "All departments."} Generated ${r.generated}.`],
      ["How to use it", "By laboratory holds one row for each indicator and laboratory. Totals holds one row for each indicator. Definitions says what each indicator counts. Filter any column with the arrows in its heading."],
      ["Source", `Entered by each laboratory in VeritaQA™. ${SYSTEM_REPORT_NOTE} A total is blank, with the reason, when the laboratories entered different kinds of indicator.`],
      ["Coverage gaps", COVERAGE_GAPS],
    ],
    sheets: [
      {
        name: "By laboratory", freeze: 2, resultColumn: 10,
        columns: [{ header: "Indicator", width: 34 }, { header: "Laboratory", width: 30 }, { header: "CLIA", width: 14 }, { header: "Department", width: 20 }, { header: "Numerator or count", width: 13, align: "right" }, { header: "Denominator", width: 13, align: "right" }, { header: "Value", width: 11, align: "right" }, { header: "Unit", width: 11 }, { header: "Target", width: 20 }, { header: "Result", width: 12, align: "center" }, { header: "Entries", width: 10, align: "center" }, { header: "Expected entries", width: 11, align: "center" }, { header: "Note", width: 40 }],
        rows: r.indicators.flatMap((i) => i.rows.map((x) => [i.name, x.lab_name, x.clia_number ?? "Not on file", i.department, x.result.numerator, x.result.denominator, round(x.result.value), x.result.unit ?? i.unit, x.target_text, x.result_text, x.result.entered, x.result.expected, [x.off_since ? `Off since ${x.off_since}.` : "", x.result.note ?? ""].filter(Boolean).join(" ") || null])),
      },
      {
        name: "Totals", freeze: 1,
        columns: [{ header: "Indicator", width: 34 }, { header: "Department", width: 20 }, { header: "Laboratories turned on", width: 13, align: "center" }, { header: "Laboratories with an entry", width: 14, align: "center" }, { header: "Numerator or count", width: 13, align: "right" }, { header: "Denominator", width: 13, align: "right" }, { header: "Total", width: 11, align: "right" }, { header: "Unit", width: 11 }, { header: "Note", width: 52 }],
        rows: r.indicators.map((i) => [i.name, i.department, i.labs_on, i.total.labs_counted, i.total.numerator, i.total.denominator, round(i.total.value), i.total.shown ? i.total.unit : null, i.total.reason]),
      },
      {
        name: "Definitions", freeze: 1,
        columns: [{ header: "Indicator", width: 34 }, { header: "Definition", width: 44 }, { header: "Numerator or count", width: 34 }, { header: "Denominator", width: 34 }, { header: "Kind", width: 26 }, { header: "Entered", width: 12 }, { header: "Version", width: 9, align: "center" }, { header: "Changed in this period", width: 34 }],
        rows: r.indicators.map((i) => [i.name, i.definition, i.numerator_text, i.denominator_text, ORG_KIND_LABEL[i.kind as OrgIndicatorKind] ?? i.kind, ORG_FREQUENCY_LABEL[i.frequency as OrgFrequency] ?? i.frequency, i.version, changeText(i) || null]),
      },
    ],
  });
}

export function labReportExcel(r: LabReport): Promise<Buffer> {
  const identity = `${r.lab.name || "Lab name not on file"}    CLIA: ${r.lab.clia || "Not on file"}`;
  const all = r.sections.flatMap((s) => s.departments.flatMap((d) => d.rows.map((x) => ({ s, d, x }))));
  return workbook({
    product: "VeritaQA™ Quality Indicator Report", identity,
    about: [
      ["Disclaimer", "Internal quality management report. The numbers are what the laboratory entered; their review and any action belong to the medical director or designee."],
      ["This report", `${r.period.label}. ${r.counts.indicators} indicators: ${r.counts.with_entries} with an entry, ${r.counts.no_entry} with no entry. Generated ${r.generated}.`],
      ["How to use it", "Indicators holds one row for each indicator. Months holds one row for each indicator and month, with the notes, root cause, corrective action and linked VeritaResponse™ entries. Filter any column with the arrows in its heading."],
      ["Source", `Entered by the laboratory in VeritaQA™. ${LAB_REPORT_NOTE}`],
      ["Coverage gaps", COVERAGE_GAPS],
    ],
    sheets: [
      {
        name: "Indicators", freeze: 1, resultColumn: 8,
        columns: [{ header: "Indicator", width: 36 }, { header: "Department", width: 22 }, { header: "Belongs to", width: 26 }, { header: "Unit", width: 10 }, { header: "Target", width: 20 }, { header: "Numerator or count", width: 13, align: "right" }, { header: "Denominator", width: 13, align: "right" }, { header: "Result", width: 14, align: "center" }, { header: "Period total", width: 13, align: "right" }, { header: "Months entered", width: 11, align: "center" }, { header: "Months met", width: 11, align: "center" }, { header: "Note", width: 40 }],
        rows: all.map(({ s, d, x }) => [x.name, d.name, s.account_wide ? s.title : x.organization ? `Organization: ${x.organization}` : "This laboratory", x.unit || null, x.target_text, x.period?.numerator ?? null, x.period?.denominator ?? null, x.result_text, round(x.period?.value ?? null), x.entered, x.met, [x.off_since ? `Turned off ${x.off_since}.` : "", x.period?.note ?? ""].filter(Boolean).join(" ") || null]),
      },
      {
        name: "Months", freeze: 2, resultColumn: 9,
        columns: [{ header: "Indicator", width: 36 }, { header: "Month", width: 11, align: "center" }, { header: "Department", width: 22 }, { header: "Value", width: 11, align: "right" }, { header: "Unit", width: 10 }, { header: "Numerator or count", width: 13, align: "right" }, { header: "Denominator", width: 13, align: "right" }, { header: "Volume", width: 11, align: "right" }, { header: "Result", width: 12, align: "center" }, { header: "Notes", width: 36 }, { header: "Root cause", width: 30 }, { header: "Corrective action", width: 30 }, { header: "Linked findings", width: 30 }],
        rows: all.flatMap(({ d, x }) => x.months.filter((m) => m.due || m.value != null).map((m) => [x.name, monthKey(r.period.year, m.month), d.name, round(m.value), x.unit || null, m.numerator, m.denominator, m.denominator == null ? m.volume : null, m.value == null ? "No entry" : m.status === "green" ? "Met" : m.status === "yellow" ? "Watch" : m.status === "red" ? "Missed" : "Not judged", m.notes, m.root_cause, m.corrective_action, m.findings.map((f) => f.label).join("; ") || null])),
      },
    ],
  });
}
