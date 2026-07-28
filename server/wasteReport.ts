// server/wasteReport.ts
//
// VeritaStock Wastage and Losses report. Reads inventory_waste_events (written by
// the write-off endpoint) and produces, grouped by item and ranked by dollars
// lost: an in-app JSON payload, a PDF, and an Excel workbook. Answers "everything
// that expired on the shelf, all losses, by item."
//
// buildWasteReport() is a pure aggregation over already-fetched event rows so the
// endpoint stays the single source of scoping (owner + optional location/reason/
// date) and the math is unit-testable (scripts/verify-waste-report.js). The two
// renderers mirror the Order document chrome (orderDocument.ts) and the Count
// History workbook (countHistoryExcel.ts) so the output sits alongside the other
// VeritaStock deliverables. This is an internal-use loss record, not a director
// approval, so the PDF carries no signature block (same class as VeritaScan).

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";

const STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";

export const WASTE_REASON_ORDER = ["expired", "damaged", "recalled", "lost"] as const;
export type WasteReason = (typeof WASTE_REASON_ORDER)[number];
const REASON_LABEL: Record<string, string> = {
  expired: "Expired", damaged: "Damaged", recalled: "Recalled", lost: "Lost",
};
const reasonLabel = (r: string) => REASON_LABEL[r] || (r ? r.charAt(0).toUpperCase() + r.slice(1) : "Other");

// One raw waste event as read from the endpoint (waste_events joined to item +
// lab + user). unit_cost / waste_value are the values captured at write-off time.
export interface WasteEventRow {
  id: number;
  item_id: number | null;
  item_name: string | null;
  department?: string | null;
  vendor?: string | null;
  catalog_number?: string | null;
  qty: number;
  unit_cost: number;
  waste_value: number;
  reason_code: string;
  note?: string | null;
  event_date: string | null;
  location_name?: string | null;
  actor_name?: string | null;
}

export interface WasteItemGroup {
  item_id: number | null;
  item_name: string;
  department: string | null;
  vendor: string | null;
  reasons: string[];       // distinct reason labels present, in canonical order
  events: number;
  qty: number;
  unit_cost: number | null; // representative (most recent) unit cost
  loss: number;
  share_pct: number;
  last_event_date: string | null;
  locations: string[];
}

export interface WasteReport {
  summary: {
    total_loss: number;
    event_count: number;
    item_count: number;
    by_reason: Array<{ reason: string; label: string; value: number; events: number }>;
    top_item: { item_name: string; loss: number; reason: string } | null;
  };
  by_item: WasteItemGroup[];
  events: WasteEventRow[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Pure aggregation. Groups by item_id (falling back to item_name when the item
// was later deleted), ranks by dollars lost descending, and rolls up per-reason
// totals. Every dollar figure is rounded to cents; share_pct sums to ~100.
export function buildWasteReport(events: WasteEventRow[]): WasteReport {
  const total_loss = round2(events.reduce((s, e) => s + (Number(e.waste_value) || 0), 0));

  const byReasonMap = new Map<string, { value: number; events: number }>();
  for (const e of events) {
    const r = (e.reason_code || "other").toLowerCase();
    const cur = byReasonMap.get(r) || { value: 0, events: 0 };
    cur.value += Number(e.waste_value) || 0;
    cur.events += 1;
    byReasonMap.set(r, cur);
  }
  const knownFirst = [...WASTE_REASON_ORDER, ...[...byReasonMap.keys()].filter((r) => !WASTE_REASON_ORDER.includes(r as WasteReason))];
  const by_reason = knownFirst
    .filter((r) => byReasonMap.has(r))
    .map((r) => ({ reason: r, label: reasonLabel(r), value: round2(byReasonMap.get(r)!.value), events: byReasonMap.get(r)!.events }));

  const groups = new Map<string, WasteItemGroup & { _reasonSet: Set<string>; _locSet: Set<string> }>();
  for (const e of events) {
    const key = e.item_id != null ? `id:${e.item_id}` : `name:${(e.item_name || "Unknown item").toLowerCase()}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        item_id: e.item_id ?? null,
        item_name: e.item_name || "Unknown item",
        department: e.department ?? null,
        vendor: e.vendor ?? null,
        reasons: [], events: 0, qty: 0, unit_cost: null, loss: 0, share_pct: 0,
        last_event_date: null, locations: [],
        _reasonSet: new Set<string>(), _locSet: new Set<string>(),
      };
      groups.set(key, g);
    }
    g.events += 1;
    g.qty += Number(e.qty) || 0;
    g.loss += Number(e.waste_value) || 0;
    if (Number(e.unit_cost) > 0 && g.unit_cost == null) g.unit_cost = round2(Number(e.unit_cost));
    g._reasonSet.add((e.reason_code || "other").toLowerCase());
    if (e.location_name) g._locSet.add(e.location_name);
    // event_date is YYYY-MM-DD; lexical max is chronological max.
    if (e.event_date && (!g.last_event_date || e.event_date > g.last_event_date)) g.last_event_date = e.event_date;
  }

  const by_item: WasteItemGroup[] = [...groups.values()]
    .map((g) => {
      const reasons = WASTE_REASON_ORDER.filter((r) => g._reasonSet.has(r)).map(reasonLabel)
        .concat([...g._reasonSet].filter((r) => !WASTE_REASON_ORDER.includes(r as WasteReason)).map(reasonLabel));
      return {
        item_id: g.item_id, item_name: g.item_name, department: g.department, vendor: g.vendor,
        reasons, events: g.events, qty: round2(g.qty), unit_cost: g.unit_cost,
        loss: round2(g.loss),
        share_pct: total_loss > 0 ? Math.round((g.loss / total_loss) * 1000) / 10 : 0,
        last_event_date: g.last_event_date, locations: [...g._locSet].sort(),
      };
    })
    .sort((a, b) => b.loss - a.loss || a.item_name.localeCompare(b.item_name));

  const top = by_item[0] || null;
  return {
    summary: {
      total_loss,
      event_count: events.length,
      item_count: by_item.length,
      by_reason,
      top_item: top ? { item_name: top.item_name, loss: top.loss, reason: top.reasons[0] || "" } : null,
    },
    by_item,
    events,
  };
}

export interface WasteReportContext {
  labName?: string | null;
  cliaNumber?: string | null;
  preparedBy?: string | null;
  rangeLabel?: string | null;   // e.g. "May 1, 2026 to Jul 28, 2026"
  reasonLabel?: string | null;  // e.g. "Expired only" when a reason filter is on
  locationLabel?: string | null; // e.g. "Michaels Lab" when scoped to one location
}

// ── formatting helpers ─────────────────────────────────────────────────────
const TEAL = "#01696F";
const DARK = "#28251D";
const MUTED = "#6B7280";
const money = (n: number) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHtml = (s: any) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const prettyDate = (ymd: string | null) => {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00Z`);
  if (isNaN(d.getTime())) return String(ymd);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};
const todayLong = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

const WASTE_FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaStock&trade; wastage reports summarize inventory written off in the period shown. This is an internal operations record, not an audit or a financial statement. Action taken on the basis of this report is the responsibility of the ${STOCK_DEPLOYMENT ? "materials manager or designee" : "laboratory director or designee"}.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>${STOCK_DEPLOYMENT ? "VeritaStock&trade; | Confidential - For Internal Use Only" : "VeritaAssure&trade; | VeritaStock&trade; | Confidential - For Internal Lab Use Only"}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

function wasteHeaderHTML(ctx: WasteReportContext, report: WasteReport): string {
  const labName = ctx.labName || (STOCK_DEPLOYMENT ? "" : "Lab name not on file");
  const labLine = labName ? `<div style="font-size:10pt;font-weight:600;color:${DARK};margin-top:4px;">${escapeHtml(labName)}</div>` : "";
  const cliaLine = STOCK_DEPLOYMENT
    ? ""
    : ctx.cliaNumber
    ? `<div style="font-size:8pt;color:#555;margin-top:2px;">CLIA: ${escapeHtml(ctx.cliaNumber)}</div>`
    : "";
  const scopeBits = [ctx.rangeLabel, ctx.locationLabel, ctx.reasonLabel].filter(Boolean).map(escapeHtml).join(" &nbsp;&middot;&nbsp; ");
  const scopeLine = scopeBits ? `<div style="margin-top:6px;font-size:9pt;color:${MUTED};">${scopeBits}</div>` : "";
  const s = report.summary;
  const reasonLine = s.by_reason.map((r) => `${escapeHtml(r.label)} ${money(r.value)} (${r.events})`).join("  &middot;  ");
  return `
  <div class="report-header">
    <div>
      <div class="logo">${STOCK_DEPLOYMENT ? "VeritaStock&trade;" : "VeritaAssure&trade;"}</div>
      <div class="logo-sub">${STOCK_DEPLOYMENT ? "Multi-Location Inventory - veritastock.com" : "by Veritas Lab Services - veritaslabservices.com"}</div>
      ${labLine}
      ${cliaLine}
    </div>
    <div class="header-right">
      <div style="font-weight:600;color:${DARK};">Generated: ${todayLong()}</div>
      <div>${s.item_count} item${s.item_count === 1 ? "" : "s"}, ${s.event_count} write-off${s.event_count === 1 ? "" : "s"}</div>
    </div>
  </div>
  <div class="report-title">VeritaStock&trade; Wastage and Losses Report</div>
  <div class="report-subtitle">Inventory written off in the period, grouped by item and ranked by loss</div>
  ${scopeLine}
  <div class="summary-band">
    <div class="summary-cell"><div class="summary-label">Total loss</div><div class="summary-value">${money(s.total_loss)}</div></div>
    <div class="summary-cell"><div class="summary-label">Write-off events</div><div class="summary-value">${s.event_count}</div></div>
    <div class="summary-cell"><div class="summary-label">Items affected</div><div class="summary-value">${s.item_count}</div></div>
  </div>
  ${reasonLine ? `<div class="reason-line">By reason: ${reasonLine}</div>` : ""}
  <hr class="divider">`;
}

function wasteTableHTML(report: WasteReport): string {
  if (report.by_item.length === 0) {
    return `<div style="margin-top:24px;text-align:center;color:${MUTED};font-size:10pt;">No write-off events recorded in this period.</div>`;
  }
  const rows = report.by_item.map((g) => `
    <tr>
      <td>${escapeHtml(g.item_name)}</td>
      <td>${escapeHtml(g.department || "")}</td>
      <td>${escapeHtml(g.vendor || "")}</td>
      <td>${escapeHtml(g.reasons.join(", "))}</td>
      <td style="text-align:right;">${g.events}</td>
      <td style="text-align:right;">${g.qty}</td>
      <td style="text-align:right;">${g.unit_cost == null ? "" : money(g.unit_cost)}</td>
      <td style="text-align:right;font-weight:700;">${money(g.loss)}</td>
      <td style="text-align:right;">${g.share_pct}%</td>
    </tr>`).join("");
  return `
    <table class="waste-table">
      <thead>
        <tr>
          <th>Item</th><th>Department</th><th>Vendor</th><th>Reason(s)</th>
          <th style="text-align:right;">Events</th><th style="text-align:right;">Qty</th>
          <th style="text-align:right;">Unit cost</th><th style="text-align:right;">Total loss</th><th style="text-align:right;">Share</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="font-weight:700;">Total</td>
          <td style="text-align:right;font-weight:700;">${report.summary.event_count}</td>
          <td></td><td></td>
          <td style="text-align:right;font-weight:700;">${money(report.summary.total_loss)}</td>
          <td style="text-align:right;font-weight:700;">100%</td>
        </tr>
      </tfoot>
    </table>`;
}

export function buildWasteReportHTML(report: WasteReport, ctx: WasteReportContext): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaStock Wastage Report</title><style>
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: ${DARK}; background: white; }
    @page { size: letter; margin: 14mm 15mm 20mm 15mm; }
    .report-header { display: flex; justify-content: space-between; align-items: flex-start; }
    .logo { font-size: 18pt; font-weight: 700; color: ${TEAL}; line-height: 1; }
    .logo-sub { font-size: 7.5pt; color: ${MUTED}; margin-top: 2px; }
    .header-right { text-align: right; font-size: 8pt; color: ${MUTED}; }
    .report-title { font-size: 15pt; font-weight: 700; color: ${DARK}; margin-top: 10px; }
    .report-subtitle { font-size: 9pt; color: ${MUTED}; margin-top: 2px; }
    .summary-band { display: flex; gap: 10px; margin-top: 10px; }
    .summary-cell { flex: 1; background: #E6F2F2; border-left: 4px solid ${TEAL}; border-radius: 4px; padding: 6px 10px; }
    .summary-label { font-size: 7.5pt; color: ${MUTED}; }
    .summary-value { font-size: 14pt; font-weight: 700; color: ${DARK}; }
    .reason-line { margin-top: 8px; font-size: 8.5pt; color: ${DARK}; }
    hr.divider { border: none; border-top: 1px solid #d2d7dc; margin: 10px 0 6px 0; }
    table.waste-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 8pt; }
    table.waste-table th { background: #f0f2f5; color: ${MUTED}; font-weight: 700; padding: 5px 6px; font-size: 7.5pt; border-bottom: 1px solid #d2d7dc; text-align: left; }
    table.waste-table td { padding: 4px 6px; border-bottom: 1px solid #EEF1F4; }
    table.waste-table tfoot td { border-top: 2px solid #d2d7dc; border-bottom: none; }
  </style></head><body>
    ${wasteHeaderHTML(ctx, report)}
    ${wasteTableHTML(report)}
  </body></html>`;
}

export async function generateWasteReportPDF(report: WasteReport, ctx: WasteReportContext): Promise<Buffer> {
  const html = buildWasteReportHTML(report, ctx);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: WASTE_FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ── Excel workbook (customer-facing standard, CLAUDE.md §6) ─────────────────
export async function generateWasteReportExcel(report: WasteReport, ctx: WasteReportContext): Promise<Buffer> {
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
  const hdrFtr = (sheetTitle: string) => ({
    oddHeader: `&L&"Calibri,Regular"&10${sheetTitle}&R&"Calibri,Regular"&10${labName}${cliaSuffix}`,
    oddFooter: `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`,
  });

  // ── About sheet ──
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaStock Wastage and Losses";
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

  const scopeParts = [ctx.rangeLabel, ctx.locationLabel, ctx.reasonLabel].filter(Boolean).join("; ");
  section("About this workbook");
  body(`This workbook lists inventory written off in VeritaStock for the period shown${scopeParts ? ` (${scopeParts})` : ""}. The Losses by item sheet has one row per item, ranked by dollars lost, with the reasons, the number of write-off events, the quantity, and the total loss. The Events sheet has one row per individual write-off with its date, reason, note, and who recorded it.`);
  blank();
  section("How the loss is calculated");
  body("Each write-off records the quantity removed and the unit cost captured at the moment of the write-off. The loss for a write-off is that quantity times that unit cost. The item total is the sum of its write-offs, and the report total is the sum of all items. Because the unit cost is captured at write-off time, later price changes do not restate a past loss.");
  blank();
  section("What the reasons mean");
  body("Expired: removed because the lot passed its expiration date. Damaged: removed because it was broken, contaminated, or otherwise unusable. Recalled: removed on a manufacturer or regulatory recall. Lost: unaccounted for at a physical count. Each write-off carries exactly one reason.");
  blank();
  section("Disclaimer");
  body(STOCK_DEPLOYMENT
    ? "This workbook reports write-offs as they were entered into VeritaStock. It is an internal operations record, not an audit or a financial statement. The materials manager or designee is responsible for any action taken on the basis of it."
    : "This workbook reports write-offs as they were entered into VeritaStock. It is an internal operations record, not an audit, not a financial statement, and not a certification to any regulatory or accrediting body. The laboratory director or designee is responsible for any action taken on the basis of it.");
  blank();
  section("Coverage gaps");
  body("If a column you need is missing, please email info@veritaslabservices.com so it can be evaluated for a future revision.");
  Object.assign(about.headerFooter, hdrFtr("VeritaStock Wastage and Losses"));
  await about.protect(exportPwd, { ...lockedProtect, sort: false, autoFilter: false });

  // ── Losses by item ──
  const items = wb.addWorksheet("Losses by item");
  const ICOLS = [
    { header: "Item Name", width: 36 }, { header: "Department", width: 16 }, { header: "Vendor", width: 18 },
    { header: "Reason(s)", width: 20 }, { header: "Events", width: 10 }, { header: "Qty", width: 10 },
    { header: "Unit Cost", width: 12 }, { header: "Total Loss", width: 14 }, { header: "Share %", width: 10 },
    { header: "Last Event", width: 13 },
  ];
  items.columns = ICOLS.map((c) => ({ header: c.header, width: c.width }));
  for (const g of report.by_item) {
    items.addRow([
      g.item_name, g.department ?? "", g.vendor ?? "", g.reasons.join(", "),
      g.events, g.qty, g.unit_cost == null ? "" : g.unit_cost, round2(g.loss), g.share_pct, prettyDate(g.last_event_date),
    ]);
  }
  const itemTotalRow = items.addRow(["Total", "", "", "", report.summary.event_count, "", "", round2(report.summary.total_loss), 100, ""]);
  styleSheet(items, ICOLS.length, thinBorder, { moneyCols: [7, 8], totalRow: itemTotalRow.number });
  Object.assign(items.headerFooter, hdrFtr("VeritaStock Wastage and Losses"));
  await items.protect(exportPwd, lockedProtect);

  // ── Events (one row per write-off) ──
  const evs = wb.addWorksheet("Events");
  const ECOLS = [
    { header: "Date", width: 13 }, { header: "Item Name", width: 36 }, { header: "Department", width: 16 },
    { header: "Vendor", width: 18 }, { header: "Location", width: 18 }, { header: "Reason", width: 12 },
    { header: "Qty", width: 10 }, { header: "Unit Cost", width: 12 }, { header: "Loss", width: 14 },
    { header: "Note", width: 28 }, { header: "Recorded By", width: 20 },
  ];
  evs.columns = ECOLS.map((c) => ({ header: c.header, width: c.width }));
  for (const e of report.events) {
    evs.addRow([
      prettyDate(e.event_date), e.item_name ?? "", e.department ?? "", e.vendor ?? "", e.location_name ?? "",
      reasonLabel((e.reason_code || "").toLowerCase()), Number(e.qty) || 0,
      Number(e.unit_cost) > 0 ? round2(Number(e.unit_cost)) : "", round2(Number(e.waste_value) || 0),
      e.note ?? "", e.actor_name ?? "",
    ]);
  }
  styleSheet(evs, ECOLS.length, thinBorder, { moneyCols: [8, 9] });
  Object.assign(evs.headerFooter, hdrFtr("VeritaStock Wastage and Losses"));
  await evs.protect(exportPwd, lockedProtect);

  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

function styleSheet(ws: any, colCount: number, thinBorder: any, opts?: { moneyCols?: number[]; totalRow?: number }) {
  const header = ws.getRow(1); header.height = 20;
  header.eachCell((cell: any) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });
  const moneyCols = new Set(opts?.moneyCols || []);
  const last = ws.rowCount;
  for (let r = 2; r <= last; r++) {
    const dataRow = ws.getRow(r);
    const isTotal = opts?.totalRow === r;
    const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
    dataRow.eachCell({ includeEmpty: true }, (cell: any, col: number) => {
      cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10, bold: !!isTotal };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = thinBorder;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isTotal ? "FFE6F2F2" : bg } };
      cell.protection = { locked: true };
      if (moneyCols.has(col) && typeof cell.value === "number") cell.numFmt = '"$"#,##0.00';
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colCount } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}
