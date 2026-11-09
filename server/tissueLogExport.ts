// server/tissueLogExport.ts
//
// The tissue perpetual log as a workbook and a printable PDF (server/tissue.ts). One row per unit, built from its recorded
// steps. No patient column exists: the form's "recipient name" and "medical record number" columns are not built (Michael
// Q152 = 1). Workbook per CLAUDE.md section 6: About sheet first, lab identity in three layers, locked, password from env.
// PDF per section 5: CLIA on the header, the footer on every page, author metadata. It's an internal log, not a signed record,
// so it carries an internal-use line and no signature block, the same call as VeritaScan and VeritaLab reports.

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import {
  OTHER_DISPOSITION_LABELS, TISSUE_CFR_CODE_CITATION, TISSUE_CFR_CODE_QUOTE, TISSUE_CFR_TRACKING_CITATION, TISSUE_CFR_TRACKING_QUOTE, TISSUE_STATE_LABELS,
  type OtherDisposition, type TissueState,
} from "../shared/tissueRules";

export interface TissueLogContext {
  labName: string | null;
  cliaNumber: string | null;
  today: string;
  filter: string;
}

const FILTER_LABELS: Record<string, string> = { all: "All units", open: "Open units only: no final disposition yet", card_pending: "Implanted, tissue usage card not recorded as returned" };
const yn = (v: unknown) => (v === 1 ? "Yes" : v === 0 ? "No" : "");
const stateLabel = (s: string) => TISSUE_STATE_LABELS[s as TissueState] || s;
const dt = (d: string | null | undefined, t: string | null | undefined) => [d, t].filter(Boolean).join(" ");
const storedAt = (u: any) => [u.storage_unit_name, u.storage_location].filter(Boolean).join(", ");
// A return to storage moves its issue off the unit's row; server/tissue.ts returnsUnusedByUnit puts each one still standing on
// the row as returns_unused, so the log still shows the unit went out and came back.
const returnText = (r: any) =>
  `${dt(r.returned_date, r.returned_time)}: issued ${dt(r.issued_date, r.issued_time)}${r.delivered_to ? ` to ${r.delivered_to}` : ""}, brought back by ${r.returned_by ?? ""}, received by ${r.received_back_by ?? ""}. Storage conditions maintained: ${yn(r.storage_ok)}. Package integrity acceptable: ${yn(r.package_ok_on_return)}.`;
const returnsUnused = (u: any) => (Array.isArray(u.returns_unused) ? u.returns_unused.map(returnText).join("\n") : "");

const COLUMNS: { header: string; width: number; value: (u: any) => string }[] = [
  { header: "Tissue ID", width: 22, value: (u) => u.source_id },
  { header: "Type of tissue", width: 32, value: (u) => u.tissue_type },
  { header: "Source of tissue (supplier)", width: 30, value: (u) => u.supplier_name },
  { header: "Quantity or size", width: 14, value: (u) => u.quantity_or_size ?? "" },
  { header: "Expiration date", width: 12, value: (u) => u.expiration_date ?? "" },
  { header: "Status", width: 22, value: (u) => stateLabel(u.state) },
  { header: "Received MM: date", width: 12, value: (u) => u.received_mm_date ?? "" },
  { header: "Received MM: time", width: 9, value: (u) => u.received_mm_time ?? "" },
  { header: "Received MM: by", width: 18, value: (u) => u.received_mm_by ?? "" },
  { header: "Received BB: date", width: 12, value: (u) => u.received_bb_date ?? "" },
  { header: "Received BB: time", width: 9, value: (u) => u.received_bb_time ?? "" },
  { header: "Received BB: by", width: 18, value: (u) => u.received_bb_by ?? "" },
  { header: "Transport temperature acceptable", width: 12, value: (u) => yn(u.transport_temp_ok) },
  { header: "Package integrity acceptable", width: 12, value: (u) => yn(u.package_ok) },
  { header: "Action taken at receipt", width: 28, value: (u) => u.transport_action ?? "" },
  { header: "Stored at", width: 24, value: storedAt },
  { header: "Returned unused to blood bank", width: 40, value: returnsUnused },
  { header: "Issued: date", width: 12, value: (u) => u.issued_date ?? "" },
  { header: "Issued: time", width: 9, value: (u) => u.issued_time ?? "" },
  { header: "Requesting physician", width: 20, value: (u) => u.requesting_physician ?? "" },
  { header: "Issued to (courier)", width: 18, value: (u) => u.issued_to ?? "" },
  { header: "Tech issuing", width: 18, value: (u) => u.issued_by_tech ?? "" },
  { header: "Delivered to", width: 18, value: (u) => u.delivered_to ?? "" },
  { header: "Source ID read back and acceptable", width: 12, value: (u) => yn(u.readback_id_ok) },
  { header: "Unit expiration acceptable", width: 12, value: (u) => yn(u.readback_expiration_ok) },
  { header: "Integrity at issue acceptable", width: 12, value: (u) => yn(u.readback_integrity_ok) },
  { header: "Date implanted", width: 12, value: (u) => u.implanted_date ?? "" },
  { header: "Time implanted", width: 9, value: (u) => u.implanted_time ?? "" },
  { header: "Implanted by", width: 18, value: (u) => u.implanted_by ?? "" },
  { header: "Reconstituted: time", width: 10, value: (u) => u.reconstituted_time ?? "" },
  { header: "Reconstituted: by", width: 18, value: (u) => u.reconstituted_by ?? "" },
  { header: "Reconstituting solution", width: 20, value: (u) => u.reconstitution_solution ?? "" },
  { header: "Solution lot", width: 14, value: (u) => u.reconstitution_lot ?? "" },
  { header: "Solution expiration", width: 12, value: (u) => u.reconstitution_expiration ?? "" },
  { header: "Tissue usage card returned", width: 12, value: (u) => (u.state === "implanted" ? (u.usage_card_returned === 1 ? "Yes" : "No") : "") },
  { header: "Date card returned", width: 12, value: (u) => u.usage_card_returned_on ?? "" },
  { header: "Other disposition", width: 12, value: (u) => OTHER_DISPOSITION_LABELS[u.state as OtherDisposition] ?? "" },
  { header: "Disposition: date", width: 12, value: (u) => u.disposition_date ?? "" },
  { header: "Disposition: time", width: 9, value: (u) => u.disposition_time ?? "" },
  { header: "Description of disposition", width: 30, value: (u) => u.disposition_description ?? "" },
  { header: "Disposition performed by", width: 18, value: (u) => u.disposition_by ?? "" },
  { header: "Notes", width: 30, value: (u) => u.notes ?? "" },
];
const STATUS_COLUMN = COLUMNS.findIndex((c) => c.header === "Status") + 1;

function statusColor(state: string): string {
  if (state === "implanted") return "FF437A22";
  if (state === "expired") return "FFA12C7B";
  if (state === "wasted" || state === "returned") return "FF7A7974";
  return "FF964219"; // open: pending
}

export async function generateTissueLogExcel(rows: any[], ctx: TissueLogContext): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure"; wb.lastModifiedBy = "VeritaAssure"; wb.created = new Date(); wb.modified = new Date();
  const labName = ctx.labName || "Lab name not on file";
  const idText = `${labName}    CLIA: ${ctx.cliaNumber || "Not on file"}`;
  const pwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const protect = { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, deleteRows: false, deleteColumns: false, sort: true, autoFilter: true };
  const header = `&L&"Calibri,Regular"&10VeritaStock™ Tissue Perpetual Log&R&"Calibri,Regular"&10${idText}`;
  const footer = `&L&"Calibri,Regular"&9${idText}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaStock™ Tissue Perpetual Log";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", indent: 1 };
  about.getRow(1).height = 30;
  const id = about.getCell("A2");
  id.value = `Prepared for: ${idText}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", wrapText: true, indent: 1 };
  id.border = border;
  let row = 3;
  const section = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } }; c.alignment = { wrapText: true, indent: 1 }; c.border = border; row += 1; };
  const body = (s: string) => { const c = about.getCell(`A${row}`); c.value = s; c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } }; c.alignment = { vertical: "top", wrapText: true, indent: 1 }; c.border = border; about.getRow(row).height = Math.max(1, Math.ceil(s.length / 88)) * 16 + 4; row += 1; };
  section("About this workbook");
  body(`One row per tissue unit on this lab's log, as of ${ctx.today}. ${FILTER_LABELS[ctx.filter] || FILTER_LABELS.all}. Each row is built from the steps recorded on the unit: receipt in Materials Management and the blood bank, storage, issue, implant or other disposition.`);
  section("No patient information");
  body("This log never holds a patient's name or medical record number. A lookback runs tissue ID, then this record, then the hospital's chart, where the link to the patient stays. The supplier's tissue usage card is filled in on paper by the hospital; this log records only that it was completed and returned, and the date.");
  section("How to use it");
  body("Filter the Perpetual Log sheet by tissue ID, supplier or status. A status other than Implanted, Wasted, Returned to supplier or Expired means the unit has no final disposition yet and is open. A unit issued and brought back to the blood bank without being implanted shows each return in the Returned unused to blood bank column; the Issued columns hold only its current issue. To change a record, correct it on the VeritaStock™ tissue page, which keeps the history; this workbook is a read-only copy.");
  section("Source");
  body(`Recorded by this lab in VeritaStock™. The tissue ID is the supplier's "${TISSUE_CFR_CODE_QUOTE}" (${TISSUE_CFR_CODE_CITATION}). ${TISSUE_CFR_TRACKING_CITATION}: a tracking system that "${TISSUE_CFR_TRACKING_QUOTE}". Text read from eCFR, current as of 2026-11-04.`);
  section("Disclaimer");
  body("This workbook lists what the lab recorded. Decisions about a tissue unit belong to the medical director or designee.");
  section("Coverage gaps");
  body("If a column you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(pwd, { ...protect, sort: false, autoFilter: false });

  const log = wb.addWorksheet("Perpetual Log");
  log.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }));
  for (const u of rows) log.addRow(COLUMNS.map((c) => c.value(u) || null));
  const h = log.getRow(1);
  h.height = 20;
  h.eachCell((c: any) => { c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; c.border = border; });
  for (let r = 2; r <= log.rowCount; r++) {
    const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
    log.getRow(r).eachCell({ includeEmpty: true }, (c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = border; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.protection = { locked: true }; });
    const state = rows[r - 2].state;
    log.getRow(r).getCell(STATUS_COLUMN).font = { name: "Calibri", size: 10, bold: true, color: { argb: statusColor(state) } };
  }
  log.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  log.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  log.headerFooter.oddHeader = header;
  log.headerFooter.oddFooter = footer;
  await log.protect(pwd, protect);
  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const line = (label: string, v: unknown) => (v == null || v === "" ? "" : `<div><span class="l">${esc(label)}</span> ${esc(v)}</div>`);

export function buildTissueLogHTML(rows: any[], ctx: TissueLogContext): string {
  const cliaLine = ctx.cliaNumber ? `CLIA: ${esc(ctx.cliaNumber)}` : "CLIA: Not on file - enter in account settings";
  const body = rows.map((u) => {
    const final = u.state === "implanted"
      ? `${line("Implanted", dt(u.implanted_date, u.implanted_time))}${line("By", u.implanted_by)}${line("Reconstituted", [u.reconstituted_time, u.reconstituted_by, u.reconstitution_solution, u.reconstitution_lot && `lot ${u.reconstitution_lot}`, u.reconstitution_expiration && `exp ${u.reconstitution_expiration}`].filter(Boolean).join(", "))}${line("Usage card returned", u.usage_card_returned === 1 ? `Yes, ${u.usage_card_returned_on}` : "No")}`
      : u.disposition_date
        ? `${line(OTHER_DISPOSITION_LABELS[u.state as OtherDisposition] || "Disposition", dt(u.disposition_date, u.disposition_time))}${line("By", u.disposition_by)}${line("Description", u.disposition_description)}`
        : `<span class="open">Open: no final disposition</span>`;
    return `<tr>
      <td><strong>${esc(u.source_id)}</strong>${u.quantity_or_size ? `<div class="m">${esc(u.quantity_or_size)}</div>` : ""}</td>
      <td>${esc(u.tissue_type)}<div class="m">${esc(u.supplier_name)}</div></td>
      <td style="white-space:nowrap">${esc(u.expiration_date)}</td>
      <td>${line("MM", [dt(u.received_mm_date, u.received_mm_time), u.received_mm_by].filter(Boolean).join(", "))}${line("BB", [dt(u.received_bb_date, u.received_bb_time), u.received_bb_by].filter(Boolean).join(", "))}${line("Stored", storedAt(u))}</td>
      <td>${u.received_bb_date ? `${line("Temp", yn(u.transport_temp_ok))}${line("Package", yn(u.package_ok))}${line("Action", u.transport_action)}` : ""}</td>
      <td>${Array.isArray(u.returns_unused) ? u.returns_unused.map((r: any) => line("Returned unused", returnText(r))).join("") : ""}${u.issued_date ? `${line("Issued", dt(u.issued_date, u.issued_time))}${line("Physician", u.requesting_physician)}${line("To", u.issued_to)}${line("Tech", u.issued_by_tech)}${line("Delivered to", u.delivered_to)}` : ""}</td>
      <td>${u.issued_date ? `${line("ID", yn(u.readback_id_ok))}${line("Exp", yn(u.readback_expiration_ok))}${line("Integrity", yn(u.readback_integrity_ok))}` : ""}</td>
      <td>${final}${u.notes ? line("Notes", u.notes) : ""}</td>
      <td><strong>${esc(stateLabel(u.state))}</strong></td>
    </tr>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>VeritaStock&trade; Tissue Perpetual Log</title><style>
    body { font-family: Helvetica, Arial, sans-serif; color: #28251D; font-size: 7.5pt; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #01696F; padding-bottom: 6px; margin-bottom: 8px; }
    .brand { color: #01696F; font-weight: 700; font-size: 13pt; }
    .sub { font-size: 8pt; color: #555; margin-top: 2px; }
    .title { text-align: right; font-size: 11pt; font-weight: 700; color: #0A3A3D; }
    .notice { background: #E6F2F2; border: 1px solid #B8D8D8; padding: 5px 8px; margin-bottom: 8px; font-size: 7.5pt; color: #0A3A3D; }
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    th { background: #01696F; color: #fff; font-size: 7pt; text-align: left; padding: 3px 4px; border: 1px solid #D0D0D0; }
    td { padding: 3px 4px; border: 1px solid #D0D0D0; vertical-align: top; word-break: break-word; }
    tr { break-inside: avoid; }
    tbody tr:nth-child(even) td { background: #EBF3F8; }
    .l { color: #6B7280; }
    .m { color: #6B7280; margin-top: 1px; }
    .open { color: #964219; font-weight: 700; }
    .src { margin-top: 8px; font-size: 6.5pt; color: #6B7280; }
    .empty { padding: 14px; text-align: center; color: #6B7280; }
  </style></head><body>
    <div class="head">
      <div><div class="brand">VeritaAssure&reg;</div><div class="sub">${esc(ctx.labName || "Lab name not on file")}</div><div class="sub">${cliaLine}</div></div>
      <div><div class="title">Tissue Perpetual Log</div><div class="sub" style="text-align:right">VeritaStock&trade; | As of ${esc(ctx.today)} | ${rows.length} unit${rows.length === 1 ? "" : "s"}</div><div class="sub" style="text-align:right">${esc(FILTER_LABELS[ctx.filter] || FILTER_LABELS.all)}</div></div>
    </div>
    <div class="notice">No patient information is held here. A lookback runs tissue ID, then this record, then the hospital's chart, where the link to the patient stays.</div>
    ${rows.length === 0 ? `<div class="empty">No units on this view.</div>` : `<table>
      <colgroup><col style="width:11%"><col style="width:16%"><col style="width:7%"><col style="width:14%"><col style="width:7%"><col style="width:15%"><col style="width:6%"><col style="width:16%"><col style="width:8%"></colgroup>
      <thead><tr><th>Tissue ID / size</th><th>Type of tissue / supplier</th><th>Expires</th><th>Received and stored</th><th>Receipt checks</th><th>Issue</th><th>Read-backs</th><th>Implant or disposition</th><th>Status</th></tr></thead>
      <tbody>${body}</tbody></table>`}
    <div class="src">The tissue ID is the supplier's "${esc(TISSUE_CFR_CODE_QUOTE)}" (${esc(TISSUE_CFR_CODE_CITATION)}). Internal use document, not a signed record. Decisions about a tissue unit belong to the medical director or designee.</div>
  </body></html>`;
}

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 12mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&reg; | VeritaStock&trade; | Confidential - For Internal Lab Use Only</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

export async function generateTissueLogPDF(rows: any[], ctx: TissueLogContext): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await setPdfContent(page, buildTissueLogHTML(rows, ctx));
    const pdf = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "12mm", right: "12mm", bottom: "16mm", left: "12mm" },
    });
    return stampPdfAuthor(pdf);
  } finally {
    await page.close();
  }
}
