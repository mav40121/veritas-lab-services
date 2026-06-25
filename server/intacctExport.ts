// server/intacctExport.ts
//
// "Export for Sage Intacct" — turn a VeritaStock reorder list into a CSV that
// matches the customer's Sage Intacct "Purchasing transactions" import template,
// so their controller uploads it under Company > Setup > Import Data and Intacct
// creates the requisition/PO without re-keying line items.
//
// HARD CONSTRAINT (verified against Intacct docs): the import is master-data
// bound and tenant-specific — header names must match the customer's template
// EXACTLY, the Vendor ID must match an existing Intacct vendor record, and the
// transaction definition + line dimensions must map to the customer's values.
// Therefore the column set is NOT hardcoded: it is driven by a stored, per-
// location `template_columns` mapping (Intacct header name -> VeritaStock source
// field), so template-version drift is a config edit, not a code change.
//
// This module is framework-free (no DB / Express imports) so the export endpoint
// and scripts/verify-intacct-csv-export.js share one source of truth.

// ── Config shape (persisted as config_json on intacct_export_config) ──────────
export interface IntacctTemplateColumn {
  /** The EXACT Intacct template header (spelling/capitalization/spacing). */
  header: string;
  /** VeritaStock source key (see resolveSource), `literal:<value>`, or `dimension:<key>`. */
  source: string;
  /** Informational: where this field lives in the customer's template. The flat
   *  CSV emits every column on every line row (header fields repeat per line),
   *  which is the standard Intacct Purchasing-transactions format. */
  placement?: "header" | "line" | "both";
}

export interface IntacctExportConfig {
  transaction_definition?: string;
  gl_account?: string;
  /** Date token format, e.g. "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD". */
  date_format?: string;
  /** Dimension defaults: location_id, department_id, project_id, class_id, ... */
  dimensions?: Record<string, string>;
  /** Ordered Intacct-header -> source mapping. The header row is built from this. */
  template_columns?: IntacctTemplateColumn[];
}

// One reorder line (subset of the decorated inventory item the Order PDF/XLSX use).
export interface IntacctReorderLine {
  item_name: string;
  catalog_number?: string | null;
  vendor?: string | null;
  unit_cost?: number | null;
  suggested_order_packs: number;   // order units (boxes/cases)
  delivered_qty: number;            // usage units
  order_unit?: string | null;
  usage_unit?: string | null;
  intacct_item_id?: string | null;  // null => account-based line
}

/** lower-cased vendor name -> the customer's Intacct Vendor ID (null when unset). */
export type VendorIdMap = Map<string, string | null>;

// ── Helpers ──────────────────────────────────────────────────────────────────

// RFC 4180: quote a field only when it contains a comma, quote, CR or LF;
// double any embedded quotes. Minimal quoting keeps picky importers happy.
export function csvEscape(value: string): string {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function formatIntacctDate(d: Date, fmt?: string): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  // Replace longest tokens first so YYYY isn't clobbered by a YY rule.
  return (fmt || "YYYY-MM-DD").replace(/YYYY/g, yyyy).replace(/MM/g, mm).replace(/DD/g, dd);
}

export function vendorIdFor(vendor: string | null | undefined, map: VendorIdMap): string | null {
  if (!vendor) return null;
  const key = vendor.toLowerCase().trim();
  return map.has(key) ? (map.get(key) ?? null) : null;
}

interface ResolveCtx {
  line: IntacctReorderLine;
  vendorId: string | null;
  config: IntacctExportConfig;
  today: string;
}

// Map a template column's `source` key to a string value for this line.
export function resolveSource(source: string, ctx: ResolveCtx): string {
  if (source.startsWith("literal:")) return source.slice("literal:".length);
  if (source.startsWith("dimension:")) {
    const key = source.slice("dimension:".length);
    return (ctx.config.dimensions && ctx.config.dimensions[key]) || "";
  }
  const c = ctx.line.unit_cost;
  switch (source) {
    case "vendor_id": return ctx.vendorId || "";
    case "vendor_name": return ctx.line.vendor || "";
    case "transaction_definition": return ctx.config.transaction_definition || "";
    case "gl_account": return ctx.config.gl_account || "";
    case "item_name":
    case "description": return ctx.line.item_name || "";
    case "catalog_number": return ctx.line.catalog_number || "";
    case "intacct_item_id": return ctx.line.intacct_item_id || "";
    case "quantity":
    case "order_qty": return String(ctx.line.suggested_order_packs ?? 0);
    case "quantity_usage": return String(ctx.line.delivered_qty ?? 0);
    case "unit_cost": return c != null ? Number(c).toFixed(2) : "";
    case "extended_cost":
      return (c != null && ctx.line.delivered_qty != null) ? (Number(c) * Number(ctx.line.delivered_qty)).toFixed(2) : "";
    case "order_unit": return ctx.line.order_unit || "";
    case "usage_unit": return ctx.line.usage_unit || "";
    case "transaction_date":
    case "date": return ctx.today;
    default: return "";
  }
}

// ── Preflight: block a known-bad file with a NAMED list of what is missing ────
export function preflightIntacct(
  lines: IntacctReorderLine[],
  config: IntacctExportConfig,
  vendorMap: VendorIdMap,
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  const cols = config.template_columns || [];

  if (cols.length === 0) {
    missing.push("No Sage Intacct column mapping is configured. Set up the export template before exporting.");
    return { ok: false, missing }; // nothing else is meaningful without columns
  }
  if (!config.transaction_definition || !config.transaction_definition.trim()) {
    missing.push("Transaction definition is not set (e.g. your Purchase Requisition definition). Set it in Sage Intacct export settings.");
  }

  // Vendors on the reorder list with no Intacct Vendor ID.
  const missingVendors = new Set<string>();
  for (const ln of lines) {
    if (!vendorIdFor(ln.vendor, vendorMap)) missingVendors.add((ln.vendor || "Unassigned vendor").trim());
  }
  if (missingVendors.size > 0) {
    const names = Array.from(missingVendors).sort();
    missing.push(`${names.length} vendor${names.length === 1 ? "" : "s"} missing a Sage Intacct Vendor ID: ${names.join(", ")}. Set these under Vendor Directory before exporting.`);
  }

  // Dimension columns mapped but with no configured value.
  const dims = config.dimensions || {};
  for (const col of cols) {
    if (col.source.startsWith("dimension:")) {
      const key = col.source.slice("dimension:".length);
      if (!dims[key] || !String(dims[key]).trim()) {
        missing.push(`Dimension "${key}" (column "${col.header}") has no value set. Add it in Sage Intacct export settings.`);
      }
    }
  }

  // GL account is required for account-based lines (no Intacct item id) when the
  // template maps a GL-account column.
  const mapsGl = cols.some((c) => c.source === "gl_account");
  const hasAccountBased = lines.some((ln) => !ln.intacct_item_id);
  if (mapsGl && hasAccountBased && (!config.gl_account || !config.gl_account.trim())) {
    missing.push("Default GL account is not set, but the template maps a GL Account column and some items have no Intacct Item ID (account-based lines). Set the GL account in Sage Intacct export settings.");
  }

  return { ok: missing.length === 0, missing };
}

// ── Build the CSV ─────────────────────────────────────────────────────────────
// Flat format: one row per reorder line, every mapped column emitted on every
// row (header fields repeat). Rows are sorted by vendor then item so each
// vendor's lines are contiguous (one purchasing document per vendor in Intacct).
// Assumes preflight has passed; callers should run preflightIntacct first.
export function buildIntacctCSV(
  lines: IntacctReorderLine[],
  config: IntacctExportConfig,
  vendorMap: VendorIdMap,
  opts?: { today?: Date },
): string {
  const cols = config.template_columns || [];
  if (cols.length === 0) return "";
  const today = formatIntacctDate(opts?.today || new Date(), config.date_format);

  const enriched = lines.map((line) => ({ line, vendorId: vendorIdFor(line.vendor, vendorMap) }));
  enriched.sort((a, b) => {
    const va = (a.vendorId || a.line.vendor || "").toLowerCase();
    const vb = (b.vendorId || b.line.vendor || "").toLowerCase();
    if (va !== vb) return va < vb ? -1 : 1;
    return (a.line.item_name || "").localeCompare(b.line.item_name || "");
  });

  const headerRow = cols.map((c) => csvEscape(c.header)).join(",");
  const dataRows = enriched.map(({ line, vendorId }) => {
    const ctx: ResolveCtx = { line, vendorId, config, today };
    return cols.map((c) => csvEscape(resolveSource(c.source, ctx))).join(",");
  });
  // CRLF line endings per RFC 4180; trailing CRLF so the last line is terminated.
  return [headerRow, ...dataRows].join("\r\n") + "\r\n";
}

// A sensible starter mapping a customer can edit, used to pre-fill the config UI
// the first time. NOT applied automatically — headers must still be confirmed
// against the customer's real template.
export const DEFAULT_TEMPLATE_COLUMNS: IntacctTemplateColumn[] = [
  { header: "Vendor ID", source: "vendor_id", placement: "both" },
  { header: "Transaction Definition", source: "transaction_definition", placement: "header" },
  { header: "Transaction Date", source: "transaction_date", placement: "header" },
  { header: "GL Account", source: "gl_account", placement: "line" },
  { header: "Location ID", source: "dimension:location_id", placement: "line" },
  { header: "Department ID", source: "dimension:department_id", placement: "line" },
  { header: "Item Description", source: "item_name", placement: "line" },
  { header: "Quantity", source: "order_qty", placement: "line" },
  { header: "Unit Price", source: "unit_cost", placement: "line" },
];
