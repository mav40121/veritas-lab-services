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

// On the dedicated VeritaStock deployment, suppress CLIA on the order documents:
// VeritaStock is an inventory product, not a CLIA-regulated compliance tool, so
// it never references CLIA. Gated on the same env flag the skin uses; the lab
// deployment (no env var) is unchanged and keeps its CLIA header.
const STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";

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
  order_to_qty: number;        // computed: TARGET inventory level = burn × desired_days
  days_remaining: number | null;
  unit?: string | null;
  unit_cost?: number | null;   // $ per usage unit; powers extended order cost
  order_unit?: string | null;
  units_per_order_unit?: number | null;
  lead_time_days?: number | null;
  needs_reorder: boolean;
  standing_order?: number | null;

  // Server-computed in decorateInventoryItem (veritabench.ts). Renderers
  // MUST consume these directly, never recompute, so the math has a single
  // source of truth.
  suggested_order_packs: number;   // ceil(max(0, target - on_hand) / upu)
  delivered_qty: number;            // suggested_order_packs * upu
  ending_qty: number;               // on_hand + delivered_qty
  ending_days: number | null;       // floor(ending_qty / burn_rate)
}

export interface ReorderLabContext {
  labName?: string | null;
  cliaNumber?: string | null;
  preparedBy?: string | null;  // user.full_name from the requester
  // Active client-side filters at generation time. Surfaces in the PDF/XLSX
  // so readers can tell at a glance whether they are looking at the FULL
  // lab reorder list or a filtered subset (e.g., "Vendor: fisher"). Empty
  // / undefined = full lab; render no filter banner.
  filterDepartment?: string | null;
  filterCategory?: string | null;
  filterVendor?: string | null;
  // Vendor records from VeritaStock vendor directory (PR 4 auto-fill).
  // Keyed by lower-cased vendor name. The vendor-section renderer looks
  // each section's vendor name up and renders a "Send to" panel when a
  // record is found. Optional: when omitted, the PDF renders identically
  // to today's behavior (no panel, no regression for labs that haven't
  // populated their vendor directory).
  vendorRecords?: Map<string, VendorRecordForPdf>;
}

// Shape of a vendor record passed into the PDF generator. Minimal: only
// the fields the PDF actually renders. Keeps the contract loose so future
// columns on stock_vendors don't require touching this file.
export interface VendorRecordForPdf {
  name: string;
  account_number: string | null;
  ordering_email: string | null;
  ordering_phone: string | null;
  ordering_fax: string | null;
  ordering_portal_url: string | null;
  po_number: string | null;
  primary_contact_name: string | null;
  primary_contact_role: string | null;
}

// Case-insensitive lookup with two-stage fallback:
//   1. exact match on lower-cased full name
//   2. substring scan: if exactly one record's name contains the section
//      name (or vice versa), use it. Multiple matches are ambiguous so
//      no auto-fill happens (better empty than wrong).
//
// Inventory's vendor field is free-text; the vendor record name is the
// canonical version. "Sysmex" in inventory should still resolve to
// "Sysmex Corporation of America" in the directory.
function resolveVendorRecord(
  sectionVendor: string,
  records: Map<string, VendorRecordForPdf> | undefined,
): VendorRecordForPdf | null {
  if (!records || records.size === 0) return null;
  const key = sectionVendor.toLowerCase().trim();
  const exact = records.get(key);
  if (exact) return exact;
  const candidates: VendorRecordForPdf[] = [];
  for (const rec of records.values()) {
    const recLower = rec.name.toLowerCase();
    if (recLower.includes(key) || key.includes(recLower)) {
      candidates.push(rec);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

// Compose a single human-readable filter label string for the header
// banner. Empty when no filters are active.
function filterBannerText(ctx: ReorderLabContext): string {
  const parts: string[] = [];
  if (ctx.filterVendor) parts.push(`Vendor: ${ctx.filterVendor}`);
  if (ctx.filterDepartment) parts.push(`Department: ${ctx.filterDepartment}`);
  if (ctx.filterCategory) parts.push(`Category: ${ctx.filterCategory}`);
  return parts.join("   |   ");
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

// Suggested order display. Consumes the server-computed
// suggested_order_packs and delivered_qty so the math is the single source
// of truth in decorateInventoryItem (veritabench.ts), not duplicated here.
//
// Two display modes:
//   - Multi-pack packaging (upu > 1): "{packs} {orderUnit}s ({delivered} {unit})"
//     Example: cool reagent, target 60, on-hand 13, 24-per-box
//              shortfall 47 -> 2 boxes -> 48 each delivered
//              Display: "2 boxes (48 each)"
//   - Single-unit packaging (upu == 1): "{packs} {orderUnit}s"
//     Example: target 100, on-hand 30, 1-per-order_unit
//              shortfall 70 -> 70 eachs
//              Display: "70 eachs"
//   - Zero shortfall (already at/above target): "—"
function suggestedOrderText(it: ReorderItem): string {
  const packs = it.suggested_order_packs || 0;
  const delivered = it.delivered_qty || 0;
  const upu = it.units_per_order_unit || 1;
  const orderUnit = it.order_unit || "each";
  const usageUnit = it.unit || "each";
  if (packs === 0) return "—";
  if (upu > 1) {
    return `${packs} ${orderUnit}${packs === 1 ? "" : "s"} (${delivered} ${usageUnit})`;
  }
  return `${packs} ${orderUnit}${packs === 1 ? "" : "s"}`;
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
  const cliaLine = STOCK_DEPLOYMENT
    ? ""
    : ctx.cliaNumber
    ? `<div style="font-size:8pt;color:#555;margin-top:2px;">CLIA: ${escapeHtml(ctx.cliaNumber)}</div>`
    : `<div style="font-size:8pt;color:#999;margin-top:2px;">CLIA: Not on file - enter in account settings</div>`;
  // Filter banner: rendered as a prominent amber callout under the title
  // when ANY filter is active. Makes it obvious at a glance that the
  // document is a scoped subset rather than the full lab reorder list.
  const bannerText = filterBannerText(ctx);
  const filterBanner = bannerText
    ? `<div style="margin:6px 0 0 0;padding:6px 12px;border:1px solid #D4A017;background:#FFF8E1;border-radius:4px;font-size:9pt;color:#7A5A00;text-align:center;">
        <span style="font-weight:700;">FILTERED VIEW: this is not the full lab reorder list.</span>
        &nbsp; ${escapeHtml(bannerText)}
      </div>`
    : "";
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
      <div>${totalItems} item${totalItems === 1 ? "" : "s"} across ${totalVendors} vendor${totalVendors === 1 ? "" : "s"}${bannerText ? " (filtered)" : ""}</div>
    </div>
  </div>
  <div class="report-title">VeritaStock&trade; Reorder Document</div>
  <div class="report-subtitle">Items at or below reorder point (lead time + safety stock days of supply)</div>
  ${filterBanner}
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

// Renders the auto-fill "Send to" panel that sits under the vendor name
// when the lab has populated a stock_vendors record for this vendor.
// Returns empty string when no record found, so the existing vendor
// header layout is unchanged for labs that haven't filled the directory.
function vendorAutofillPanelHTML(rec: VendorRecordForPdf | null): string {
  if (!rec) return "";
  const fields: Array<[string, string | null]> = [
    ["Send to", rec.ordering_email],
    ["Phone", rec.ordering_phone],
    ["Fax", rec.ordering_fax],
    ["Portal", rec.ordering_portal_url],
    ["Account", rec.account_number],
    ["PO", rec.po_number],
    ["Contact", rec.primary_contact_name ? `${rec.primary_contact_name}${rec.primary_contact_role ? ` (${rec.primary_contact_role})` : ""}` : null],
  ];
  const rendered = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<span style="margin-right:14px;"><strong style="color:${DARK};">${escapeHtml(k)}:</strong> <span style="color:${MUTED};">${escapeHtml(v!)}</span></span>`)
    .join("");
  if (!rendered) return "";
  return `
    <div style="font-size:7.5pt;padding:4px 8px;background:#F2F7F7;border:1px solid #D4E0E1;border-radius:3px;margin-top:2px;margin-bottom:4px;line-height:1.6;">
      ${rendered}
    </div>`;
}

function vendorSectionHTML(vendor: string, items: ReorderItem[], ctx?: ReorderLabContext): string {
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
    // After-delivery hint shows the case-pack overshoot in context so the
    // director can see "ordering 2 boxes will leave us at 61 each, ~30
    // days of supply" without doing the arithmetic themselves.
    const endingHint = it.suggested_order_packs > 0
      ? `${it.ending_qty}${it.ending_days != null ? ` <span style="color:${MUTED};">(${it.ending_days}d)</span>` : ""}`
      : "—";
    return `<tr style="${stripe}">
      <td>${escapeHtml(it.item_name)}${standing}</td>
      <td>${escapeHtml(it.catalog_number || "—")}</td>
      <td style="text-align:right;">${it.quantity_on_hand} ${escapeHtml(it.unit || "")}</td>
      <td style="text-align:right;">${it.reorder_point}</td>
      <td style="text-align:right;">${days}</td>
      <td style="text-align:right;font-weight:700;color:${TEAL};">${suggestedOrderText(it)}</td>
      <td style="text-align:right;">${endingHint}</td>
      <td style="text-align:right;">${(it.unit_cost && it.delivered_qty) ? `$${(it.delivered_qty * it.unit_cost).toFixed(2)}` : "—"}</td>
      <td style="text-align:center;width:60px;border:1px solid #D4D1CA;background:white;">&nbsp;</td>
    </tr>`;
  }).join("");
  // PR 4 auto-fill: render the "Send to" panel under the vendor name when
  // the lab has a stock_vendors record for this vendor. resolveVendorRecord
  // does case-insensitive lookup with single-match substring fallback.
  const vendorRecord = resolveVendorRecord(vendor, ctx?.vendorRecords);
  return `
  <div class="vendor-section">
    <div class="vendor-header">
      <span class="vendor-name">${escapeHtml(vendor)}</span>
      <span class="vendor-count">${items.length} item${items.length === 1 ? "" : "s"}</span>
    </div>
    ${vendorAutofillPanelHTML(vendorRecord)}
    <table class="reorder-table">
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th style="text-align:left;">Catalog #</th>
          <th style="text-align:right;">On Hand</th>
          <th style="text-align:right;">Reorder Pt</th>
          <th style="text-align:right;">Days Left</th>
          <th style="text-align:right;">Suggested Order</th>
          <th style="text-align:right;">After Delivery</th>
          <th style="text-align:right;">Est. Cost</th>
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
    : groups.map(g => vendorSectionHTML(g.vendor, g.items, ctx)).join("\n");
  // CFO line: estimated total cost of the suggested order across all vendors,
  // from current unit costs. Buyers confirm final pricing with each vendor.
  const estTotal = items.reduce((s, it) => s + (Number(it.delivered_qty) || 0) * (Number(it.unit_cost) || 0), 0);
  const totalHTML = totalItems > 0 && estTotal > 0
    ? `<div style="margin-top:12px;text-align:right;font-size:10.5pt;font-weight:700;color:${TEAL};">Estimated order total: $${estTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
       <div style="text-align:right;font-size:7pt;color:${MUTED};margin-top:1px;">Estimated from current unit costs; confirm final pricing with each vendor.</div>`
    : "";

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
  ${totalHTML}
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
  // VeritaStock deployment carries no CLIA on the inventory workbook (see STOCK_DEPLOYMENT).
  const cliaSuffix = STOCK_DEPLOYMENT ? "" : `    CLIA: ${cliaNumber}`;
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
  id.value = `Prepared for: ${labName}${cliaSuffix}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  id.border = aboutBorder;
  about.getRow(2).height = 24;

  let row = 3;
  // Filter banner: same scope-disclosure as the PDF. Renders as a bold
  // amber row so opening the workbook makes the scope obvious before
  // anyone reads the data tabs. Skipped when no filter is active.
  const filterText = filterBannerText(ctx);
  if (filterText) {
    const f = about.getCell(`A${row}`);
    f.value = `FILTERED VIEW: this workbook does not include the full lab. ${filterText}`;
    f.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF7A5A00" } };
    f.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
    f.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    f.border = aboutBorder;
    about.getRow(row).height = 28; row += 1;
  }
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
  body(STOCK_DEPLOYMENT
    ? `This workbook was prepared for ${labName}. The lab name appears on every printed page header and footer.`
    : `This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  if (ctx.preparedBy) { section("Prepared by"); body(ctx.preparedBy); blank(); }
  section("Coverage gaps");
  body("If the workbook is missing a vendor field, a packaging unit, or a column you need for your purchasing workflow, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
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
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  }

  for (const g of groups) {
    // Sheet names cap at 31 chars and ban / \ ? * [ ] :
    const safe = g.vendor.replace(/[\/\\?*\[\]:]/g, "-").slice(0, 31);
    const ws = wb.addWorksheet(safe);
    // Column meanings:
    //   On Hand        current inventory in usage units (eachs, tubes, etc.)
    //   Reorder Pt     trigger threshold in usage units
    //   Days Left      floor(on_hand / burn_rate) at current consumption
    //   Order Qty      number of ORDER UNITS to buy (e.g., 2 boxes)
    //   Order Unit     the packaging unit (e.g., "box")
    //   Delivered      eachs delivered if Order Qty is purchased (e.g., 48)
    //   Ending Qty     on_hand + delivered = inventory after delivery
    //   Ending Days    days of supply after delivery; sanity check
    // The "Order Qty + Order Unit + Delivered" trio explicitly shows the
    // case-pack overshoot so purchasing can see exactly what they'll
    // receive vs. what was strictly needed.
    const headers = [
      "Item", "Catalog #", "Lot #", "On Hand", "Unit", "Reorder Pt", "Days Left",
      "Order Qty", "Order Unit", "Delivered", "Ending Qty", "Ending Days",
      "Standing?", "Confirmed Qty", "Notes",
    ];
    const widths  = [38, 18, 14, 10, 10, 12, 11, 11, 14, 11, 12, 12, 12, 16, 36];
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
        it.suggested_order_packs,
        it.order_unit || "",
        it.delivered_qty,
        it.ending_qty,
        it.ending_days == null ? "" : it.ending_days,
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
    ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Reorder Document&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
    ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
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

// ───────────────────────────────────────────────────────────────────────────
// Snap Order: emergency manual-order PDF. Bypasses the calculated reorder
// logic entirely. User enters quantities by hand for items they want to
// order RIGHT NOW (e.g., respiratory outbreak surge, supply-chain shock
// preemptive stocking, audit-driven extra inventory).
//
// Item shape is intentionally minimal compared to ReorderItem -- no burn
// rate / reorder point / suggested order / ending days context. The
// director isn't reviewing a calculation; they're confirming a manual
// decision. Surface only what helps the rep place the order.

export interface SnapOrderItem {
  id: number;
  item_name: string;
  catalog_number?: string | null;
  lot_number?: string | null;
  vendor?: string | null;
  department?: string | null;
  unit?: string | null;
  order_unit?: string | null;
  quantity_on_hand: number;
  snap_qty: number;          // The manual order quantity entered by the user
  snap_unit: string;          // Unit the order is expressed in (defaults to order_unit, falls back to unit, then "each")
}

function snapVendorSectionHTML(vendor: string, items: SnapOrderItem[], ctx?: ReorderLabContext): string {
  const rows = items.map((it, idx) => {
    const stripe = idx % 2 === 1 ? "background:#FAFBFD;" : "";
    return `<tr style="${stripe}">
      <td>${escapeHtml(it.item_name)}</td>
      <td>${escapeHtml(it.catalog_number || "—")}</td>
      <td>${escapeHtml(it.lot_number || "—")}</td>
      <td>${escapeHtml(it.department || "—")}</td>
      <td style="text-align:right;">${it.quantity_on_hand} ${escapeHtml(it.unit || "")}</td>
      <td style="text-align:right;font-weight:700;color:${TEAL};">${it.snap_qty} ${escapeHtml(it.snap_unit)}</td>
      <td style="text-align:center;width:60px;border:1px solid #D4D1CA;background:white;">&nbsp;</td>
    </tr>`;
  }).join("");
  const vendorRecord = resolveVendorRecord(vendor, ctx?.vendorRecords);
  return `
  <div class="vendor-section">
    <div class="vendor-header">
      <span class="vendor-name">${escapeHtml(vendor)}</span>
      <span class="vendor-count">${items.length} item${items.length === 1 ? "" : "s"}</span>
    </div>
    ${vendorAutofillPanelHTML(vendorRecord)}
    <table class="reorder-table">
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th style="text-align:left;">Catalog #</th>
          <th style="text-align:left;">Lot #</th>
          <th style="text-align:left;">Department</th>
          <th style="text-align:right;">On Hand</th>
          <th style="text-align:right;">Order Qty</th>
          <th style="text-align:center;">Confirmed Qty</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function snapHeaderHTML(ctx: ReorderLabContext, totalItems: number, totalVendors: number): string {
  const labLine = ctx.labName
    ? `<div style="font-size:8.5pt;font-weight:600;color:${DARK};margin-top:1px;">${escapeHtml(ctx.labName)}</div>`
    : "";
  const cliaLine = STOCK_DEPLOYMENT
    ? ""
    : ctx.cliaNumber
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
  <div class="report-title" style="color:#92400E;">VeritaStock&trade; Snap Order</div>
  <div class="report-subtitle">Manual emergency order. Quantities entered by the operator, not calculated from reorder points.</div>
  <div style="margin:6px 0 0 0;padding:6px 12px;border:1px solid #D4A017;background:#FFF8E1;border-radius:4px;font-size:9pt;color:#7A5A00;text-align:center;">
    <span style="font-weight:700;">MANUAL ORDER:</span>
    this is NOT the calculated reorder document. Quantities below were entered by hand to handle a specific event (e.g., outbreak surge, supply-chain disruption).
  </div>
  <hr class="divider">`;
}

function snapSignatureBlockHTML(ctx: ReorderLabContext): string {
  const preparedBy = ctx.preparedBy ? escapeHtml(ctx.preparedBy) : "";
  return `
  <div style="margin-top:8px;border:1px solid #D4D1CA;border-left:4px solid #92400E;border-radius:5px;padding:6px 12px;background:#FFF8E1;break-inside:avoid;page-break-inside:avoid;">
    <div style="font-size:8pt;font-weight:700;color:#92400E;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Laboratory Director or Designee Approval (Manual Order)</div>
    <p style="font-size:7.5pt;color:${DARK};line-height:1.4;margin:0 0 5px 0;font-style:italic;">"I have reviewed this manual order. The quantities below were entered by hand to address a specific event and intentionally bypass the calculated reorder thresholds."</p>
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
    <div style="display:flex;gap:16px;margin-top:4px;">
      <div style="flex:4;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:8px;">Reason for snap order</div>
      </div>
    </div>
    ${preparedBy ? `<div style="font-size:7pt;color:${MUTED};margin-top:6px;">Prepared by: ${preparedBy}</div>` : ""}
  </div>`;
}

export function buildSnapOrderHTML(items: SnapOrderItem[], ctx: ReorderLabContext): string {
  // Group by vendor; same convention as reorder doc (unassigned vendor last).
  const map = new Map<string, SnapOrderItem[]>();
  for (const it of items) {
    const v = (it.vendor || "").trim() || "Unassigned vendor";
    if (!map.has(v)) map.set(v, []);
    map.get(v)!.push(it);
  }
  const groups = Array.from(map.entries()).map(([vendor, items]) => ({
    vendor,
    items: [...items].sort((a, b) => a.item_name.localeCompare(b.item_name)),
  }));
  groups.sort((a, b) => {
    if (a.vendor === "Unassigned vendor") return 1;
    if (b.vendor === "Unassigned vendor") return -1;
    return a.vendor.localeCompare(b.vendor);
  });

  const totalItems = items.length;
  const totalVendors = groups.length;
  const body = totalItems === 0
    ? `<div style="border:2px dashed #C7D2DE;border-radius:6px;padding:32px;text-align:center;margin-top:16px;"><div style="font-size:13pt;font-weight:700;color:${DARK};">No items selected for snap order</div></div>`
    : groups.map(g => snapVendorSectionHTML(g.vendor, g.items, ctx)).join("\n");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaStock Snap Order</title><style>
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
    .vendor-header { background: #FFF8E1; border-left: 4px solid #92400E; padding: 4px 8px; display: flex; justify-content: space-between; align-items: center; }
    .vendor-name { font-size: 10pt; font-weight: 700; color: #92400E; }
    .vendor-count { font-size: 8pt; color: ${MUTED}; font-weight: 600; }
    table.reorder-table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 8pt; }
    table.reorder-table th { background: #f0f2f5; color: ${MUTED}; font-weight: 700; padding: 4px 6px; font-size: 7.5pt; border-bottom: 1px solid #d2d7dc; }
    table.reorder-table td { padding: 3px 6px; border-bottom: 1px solid #EEF1F4; }
  </style></head><body>
  ${snapHeaderHTML(ctx, totalItems, totalVendors)}
  ${snapSignatureBlockHTML(ctx)}
  ${body}
  </body></html>`;
}

export async function generateSnapOrderPDF(items: SnapOrderItem[], ctx: ReorderLabContext): Promise<Buffer> {
  const html = buildSnapOrderHTML(items, ctx);
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
