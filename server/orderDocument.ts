// VeritaStock "Order Now" replenishment document generator.
//
// What it does: takes the inventory items currently flagged needs_reorder
// (qty_on_hand <= burn_rate * (lead_time_days + safety_stock_days)) and
// builds a single PDF grouped by vendor sections, with a director signature
// block on page 1. Mirrors the VeritaCheck PDF chrome (header, footer,
// CSS conventions) so the output sits cleanly alongside other VeritaAssure
// deliverables a lab director already reviews.
//
// Trigger formula and the per-item shape (reorder_point, order_to_qty,
// days_remaining, needs_reorder) come from the GET /api/inventory route in
// server/veritabench.ts. This file does NOT recompute the trigger; it
// consumes an array of already-decorated items. Single source of truth.

import { getBrowser } from "./pdfReport";

export interface ReorderItem {
  id: number;
  item_name: string;
  catalog_number?: string | null;
  lot_number?: string | null;
  vendor?: string | null;
  category?: string | null;
  department?: string | null;
  storage_location?: string | null;
  quantity_on_hand: number;
  reorder_point: number;       // computed: burn_rate * (lead + safety)
  order_to_qty: number;         // computed: burn_rate * desired_days_of_stock
  days_remaining: number | null;
  unit?: string | null;
  order_unit?: string | null;
  units_per_order_unit?: number | null;
  lead_time_days?: number | null;
  needs_reorder: boolean;
  standing_order?: number | null;
}

export interface ReorderLabContext {
  labName?: string | null;
  cliaNumber?: string | null;
  preparedBy?: string | null;  // user.full_name from the requester
}

const TEAL = "#01696F";
const DARK = "#28251D";
const MUTED = "#6B7280";

const today = (): string =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

// Group items by vendor. Items with no vendor go into "Unassigned vendor".
// Stable sort: vendors alphabetical, items inside each vendor alphabetical.
function groupByVendor(items: ReorderItem[]): Array<{ vendor: string; items: ReorderItem[] }> {
  const map = new Map<string, ReorderItem[]>();
  for (const it of items) {
    const v = (it.vendor || "").trim() || "Unassigned vendor";
    if (!map.has(v)) map.set(v, []);
    map.get(v)!.push(it);
  }
  const out = Array.from(map.entries()).map(([vendor, items]) => ({
    vendor,
    items: [...items].sort((a, b) => a.item_name.localeCompare(b.item_name)),
  }));
  // "Unassigned vendor" goes last; everything else alphabetical.
  out.sort((a, b) => {
    if (a.vendor === "Unassigned vendor") return 1;
    if (b.vendor === "Unassigned vendor") return -1;
    return a.vendor.localeCompare(b.vendor);
  });
  return out;
}

// Compute how many "order_unit" packs to suggest, given the unit/packaging.
// Example: order_to_qty = 50 tubes, units_per_order_unit = 24 -> 3 boxes.
// Falls back to "as-is" if no packaging info.
function suggestedOrderText(it: ReorderItem): string {
  const qty = it.order_to_qty || 0;
  const upu = it.units_per_order_unit || 1;
  const orderUnit = it.order_unit || "each";
  if (upu > 1 && qty > 0) {
    const packs = Math.ceil(qty / upu);
    return `${packs} ${orderUnit}${packs === 1 ? "" : "s"} (${qty} ${it.unit || "each"})`;
  }
  return `${qty} ${orderUnit}${qty === 1 ? "" : "s"}`;
}

const escapeHtml = (s: string | null | undefined): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function headerHTML(ctx: ReorderLabContext, totalItems: number, totalVendors: number): string {
  const labLine = ctx.labName
    ? `<div style="font-size:8.5pt;font-weight:600;color:${DARK};margin-top:1px;">${escapeHtml(ctx.labName)}</div>`
    : "";
  const cliaLine = ctx.cliaNumber
    ? `<div style="font-size:8pt;color:#555;margin-top:2px;">CLIA: ${escapeHtml(ctx.cliaNumber)}</div>`
    : `<div style="font-size:8pt;color:#999;margin-top:2px;">CLIA: Not on file - enter in account settings</div>`;
  return `
  <div class="report-header">
    <div>
      <div class="logo">VeritaAssure&trade;</div>
      <div class="logo-sub">by Veritas Lab Services - veritaslabservices.com</div>
      ${labLine}
      ${cliaLine}
    </div>
    <div class="header-right">
      <div style="font-weight:600;color:${DARK};">Generated: ${today()}</div>
      <div>${totalItems} item${totalItems === 1 ? "" : "s"} across ${totalVendors} vendor${totalVendors === 1 ? "" : "s"}</div>
    </div>
  </div>
  <div class="report-title">VeritaStock&trade; Reorder Document</div>
  <div class="report-subtitle">Items at or below reorder point (lead time + safety stock days of supply)</div>
  <hr class="divider">`;
}

function signatureBlockHTML(ctx: ReorderLabContext): string {
  const preparedBy = ctx.preparedBy ? escapeHtml(ctx.preparedBy) : "";
  return `
  <div style="margin-top:8px;border:1px solid #D4D1CA;border-left:4px solid ${TEAL};border-radius:5px;padding:6px 12px;background:#FAFAF8;break-inside:avoid;page-break-inside:avoid;">
    <div style="font-size:8pt;font-weight:700;color:${TEAL};margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Laboratory Director or Designee Approval</div>
    <p style="font-size:7.5pt;color:${DARK};line-height:1.4;margin:0 0 5px 0;font-style:italic;">"I have reviewed this reorder list against current inventory levels and approve placement of these orders."</p>
    <div style="font-size:8pt;color:${DARK};margin-bottom:2px;">
      <span style="margin-right:18px;">&#9675; Approved as listed</span>
      <span style="margin-right:18px;">&#9675; Approved with modifications</span>
      <span>&#9675; Hold for review</span>
    </div>
    <div style="display:flex;gap:16px;margin-top:6px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:12px;">Signature</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:12px;">Date</div>
      </div>
    </div>
    <div style="display:flex;gap:16px;margin-top:4px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:8px;">Print Name</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:8px;">Title</div>
      </div>
    </div>
    ${preparedBy ? `<div style="font-size:7pt;color:${MUTED};margin-top:6px;">Prepared by: ${preparedBy}</div>` : ""}
  </div>`;
}

function vendorSectionHTML(vendor: string, items: ReorderItem[]): string {
  const rows = items.map((it, idx) => {
    const stripe = idx % 2 === 1 ? "background:#FAFBFD;" : "";
    const standing = it.standing_order
      ? ` <span style="background:#FEF3C7;color:#92400E;font-size:6.5pt;font-weight:700;padding:1px 4px;border-radius:3px;margin-left:4px;">STANDING</span>`
      : "";
    const days = it.days_remaining == null
      ? "—"
      : it.days_remaining <= 0
      ? `<span style="color:#A12C7B;font-weight:700;">OUT</span>`
      : `${it.days_remaining}d`;
    return `<tr style="${stripe}">
      <td>${escapeHtml(it.item_name)}${standing}</td>
      <td>${escapeHtml(it.catalog_number || "—")}</td>
      <td style="text-align:right;">${it.quantity_on_hand} ${escapeHtml(it.unit || "")}</td>
      <td style="text-align:right;">${it.reorder_point}</td>
      <td style="text-align:right;">${days}</td>
      <td style="text-align:right;font-weight:700;color:${TEAL};">${suggestedOrderText(it)}</td>
      <td style="text-align:center;width:60px;border:1px solid #D4D1CA;background:white;">&nbsp;</td>
    </tr>`;
  }).join("");
  return `
  <div class="vendor-section">
    <div class="vendor-header">
      <span class="vendor-name">${escapeHtml(vendor)}</span>
      <span class="vendor-count">${items.length} item${items.length === 1 ? "" : "s"}</span>
    </div>
    <table class="reorder-table">
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th style="text-align:left;">Catalog #</th>
          <th style="text-align:right;">On Hand</th>
          <th style="text-align:right;">Reorder Pt</th>
          <th style="text-align:right;">Days Left</th>
          <th style="text-align:right;">Suggested Order</th>
          <th style="text-align:center;">Confirmed Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function emptyStateHTML(): string {
  return `
  <div style="border:2px dashed #C7D2DE;border-radius:6px;padding:32px;text-align:center;margin-top:16px;">
    <div style="font-size:13pt;font-weight:700;color:${DARK};">No items currently need reorder</div>
    <div style="font-size:9pt;color:${MUTED};margin-top:6px;">
      Every tracked item is above its reorder point.
    </div>
    <div style="font-size:8pt;color:${MUTED};margin-top:8px;">
      Reorder point per item is computed as burn rate &times; (lead time + safety stock).
    </div>
  </div>`;
}

export function buildReorderListHTML(items: ReorderItem[], ctx: ReorderLabContext): string {
  const groups = groupByVendor(items);
  const totalItems = items.length;
  const totalVendors = groups.length;
  const body = totalItems === 0
    ? emptyStateHTML()
    : groups.map(g => vendorSectionHTML(g.vendor, g.items)).join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaStock Reorder Document</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: ${DARK}; background: white; }
    @page { size: letter; margin: 14mm 15mm 18mm 15mm; }
    .report-header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6px; border-bottom: 1px solid #d2d7dc; margin-bottom: 8px; }
    .logo { font-size: 18pt; font-weight: 700; color: ${TEAL}; line-height: 1; }
    .logo-sub { font-size: 7.5pt; color: ${MUTED}; margin-top: 2px; }
    .header-right { text-align: right; font-size: 8pt; color: ${MUTED}; }
    .report-title { font-size: 13pt; font-weight: 700; text-align: center; margin: 6px 0 2px; color: ${DARK}; }
    .report-subtitle { font-size: 8pt; text-align: center; color: ${MUTED}; margin-bottom: 6px; }
    .divider { border: none; border-top: 1px solid #d2d7dc; margin: 6px 0; }

    .vendor-section { margin-top: 10px; page-break-inside: auto; }
    .vendor-header { background: #E6F2F2; border-left: 4px solid ${TEAL}; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; }
    .vendor-name { font-size: 10pt; font-weight: 700; color: ${TEAL}; }
    .vendor-count { font-size: 8pt; color: ${MUTED}; font-weight: 600; }

    table.reorder-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 8pt; }
    table.reorder-table th { background: #f0f2f5; color: ${MUTED}; font-weight: 700; padding: 4px 6px; font-size: 7.5pt; border-bottom: 1px solid #d2d7dc; }
    table.reorder-table td { padding: 3px 6px; border-bottom: 1px solid #EEF1F4; }
  </style></head><body>
  ${headerHTML(ctx, totalItems, totalVendors)}
  ${signatureBlockHTML(ctx)}
  ${body}
  </body></html>`;
}

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaStock&trade; reorder documents are generated from current inventory levels and burn-rate metrics. Final order quantities and vendor placement are the responsibility of the laboratory director or designee.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure&trade; | VeritaStock&trade; | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

// ───────────────────────────────────────────────────────────────────────────
// Excel export — matches the customer-facing workbook standard in
// CLAUDE.md §6. About sheet is sheet 1 with lab identity stamped in three
// independent layers (visible row, page-setup header, page-setup footer).
// Sheet protection is on with a server-side password so columns the lab
// shouldn't edit (Item, Catalog, On Hand, etc.) are locked while the
// Confirmed Qty + Notes columns stay unlocked for purchasing to mark up.
export async function generateReorderListExcel(items: ReorderItem[], ctx: ReorderLabContext): Promise<Buffer> {
  // Dynamic import keeps the cold-start cheap when the endpoint isn't hit.
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure";
  wb.lastModifiedBy = "VeritaAssure";
  wb.created = new Date();
  wb.modified = new Date();

  const labName = ctx.labName || "Lab name not on file";
  const cliaNumber = ctx.cliaNumber || "Not on file";
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

  const aboutBorder: any = {
    top:    { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left:   { style: "thin", color: { argb: "FFD0D0D0" } },
    right:  { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const thinBorder = aboutBorder;

  // ── About sheet ──────────────────────────────────────────────────────────
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const t = about.getCell("A1");
  t.value = "VeritaStock Reorder Document";
  t.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;

  const id = about.getCell("A2");
  id.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  id.border = aboutBorder;
  about.getRow(2).height = 24;

  let row = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${row}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = aboutBorder;
    about.getRow(row).height = 22; row += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${row}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = aboutBorder;
    const segs = String(text || "").split(/\r?\n/);
    let estLines = 0;
    for (const seg of segs) estLines += Math.max(1, Math.ceil(seg.length / 88));
    about.getRow(row).height = Math.max(2, estLines) * 16 + 4; row += 1;
  };
  const blank = () => { about.getRow(row).height = 8; row += 1; };

  section("About this product");
  body("This workbook is a snapshot of inventory items currently at or below their reorder point, grouped by vendor for purchasing. Reorder point per item is computed as burn rate multiplied by the sum of lead time and safety stock days; items appear here when on-hand quantity has fallen to or below that threshold. The Suggested Order column gives the quantity that, when delivered, will bring the item up to the desired days-of-stock target.");
  blank();
  section("How to use this workbook");
  body("Each vendor has its own tab. Within a tab, rows are inventory items currently flagged for reorder. The Confirmed Qty and Notes columns are unlocked for purchasing to fill in; every other column is locked to preserve the underlying calculation. After the lab director signs the PDF version of this document, the workbook can be edited and sent to vendors as the formal order.");
  blank();
  section("Disclaimer");
  body("This workbook is a computed projection from the lab's own inventory entries; it is not an audit, a guarantee of vendor availability, or a clinical or financial recommendation. Lead times, burn rates, and reorder points are only as accurate as the data the lab has entered into VeritaStock. Final order quantities and vendor placement are the responsibility of the laboratory director or designee. VeritaAssure does not place orders with vendors; it produces the documents the lab uses to do so.");
  blank();
  section("Lab identity");
  body(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  if (ctx.preparedBy) { section("Prepared by"); body(ctx.preparedBy); blank(); }
  section("Coverage gaps");
  body("If the workbook is missing a vendor field, a packaging unit, or a column you need for your purchasing workflow, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ── Per-vendor data tabs ─────────────────────────────────────────────────
  const groups = groupByVendor(items);
  if (groups.length === 0) {
    // Edge case: no items currently need reorder. Still produce a usable
    // workbook with an empty-state tab so the lab can keep a dated record
    // that nothing was due.
    const ws = wb.addWorksheet("No items due");
    ws.getColumn(1).width = 80;
    const c = ws.getCell("A1");
    c.value = "No items currently at or below reorder point.";
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 24;
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  }

  for (const g of groups) {
    // Sheet names cap at 31 chars and ban / \ ? * [ ] :
    const safe = g.vendor.replace(/[\/\\?*\[\]:]/g, "-").slice(0, 31);
    const ws = wb.addWorksheet(safe);
    const headers = [
      "Item", "Catalog #", "Lot #", "On Hand", "Unit", "Reorder Pt", "Days Left",
      "Suggested Order", "Order Unit", "Standing?", "Confirmed Qty", "Notes",
    ];
    const widths  = [38, 18, 14, 10, 10, 12, 11, 22, 14, 12, 16, 36];
    ws.columns = headers.map((h, i) => ({ header: h, key: `col${i}`, width: widths[i] }));

    for (const it of g.items) {
      ws.addRow([
        it.item_name,
        it.catalog_number || "",
        it.lot_number || "",
        it.quantity_on_hand,
        it.unit || "",
        it.reorder_point,
        it.days_remaining == null ? "" : it.days_remaining,
        it.order_to_qty,
        it.order_unit || "",
        it.standing_order ? "Yes" : "",
        "",  // Confirmed Qty — unlocked
        "",  // Notes — unlocked
      ]);
    }

    // Header row styling
    const headerRow = ws.getRow(1);
    headerRow.height = 20;
    headerRow.eachCell((cell) => {
      cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = thinBorder;
    });

    // Data row styling — alt-row + lock/unlock per CLAUDE.md §6.4
    const confirmedCol = headers.indexOf("Confirmed Qty") + 1;
    const notesCol = headers.indexOf("Notes") + 1;
    for (let r = 2; r <= g.items.length + 1; r++) {
      const dataRow = ws.getRow(r);
      const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
      dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
        cell.alignment = { vertical: "middle", wrapText: true };
        cell.border = thinBorder;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        // Unlock the two columns purchasing needs to edit; lock everything else.
        const locked = !(colNumber === confirmedCol || colNumber === notesCol);
        cell.protection = { locked };
      });
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
    await ws.protect(exportPwd, {
      selectLockedCells: false, selectUnlockedCells: true,
      formatCells: false, formatColumns: false, formatRows: false,
      insertRows: false, insertColumns: false, insertHyperlinks: false,
      deleteRows: false, deleteColumns: false,
      sort: false, autoFilter: true, pivotTables: false,
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

export async function generateReorderListPDF(items: ReorderItem[], ctx: ReorderLabContext): Promise<Buffer> {
  const html = buildReorderListHTML(items, ctx);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
