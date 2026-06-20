// server/inventoryCountExcel.ts
//
// Inventory Count workbook for the periodic physical inventory.
// Counter takes the workbook (printed or on a tablet) into the lab,
// walks the shelves writing counted quantity / counted by / count
// date / notes next to the system-of-record quantity, then comes
// back to the bench to reconcile.
//
// Design choices (locked):
//
//   Sort: Storage Location ASC -> Department ASC -> Item Name ASC
//   so the counter walks one shelf at a time instead of bouncing
//   between rooms chasing alphabetical order.
//
//   Freeze pane: C2. Columns A (Storage Location) and B (Department)
//   stay visible while scrolling right so the counter never loses
//   context for which shelf they are looking at.
//
//   Discrepancy column: in-cell formula = IF(ISBLANK(K2), "", K2-I2).
//   Blank when the counter has not entered a count, so the workbook
//   does not render fake "0 - System = negative system" values.
//
//   Sheet protection: locks every identity / system column, unlocks
//   only the counter-input columns (Counted Qty, Counted By, Count
//   Date, Notes). Discrepancy is locked because it is a formula the
//   counter should not have to touch.
//
// Per CLAUDE.md §6 (Customer-facing workbooks): About sheet first,
// lab identity stamped in three layers, sheet password from env,
// no em-dashes anywhere in the workbook content.

// The standalone VeritaStock product is a supply-chain platform, not a lab
// tool. On that deployment the count workbook drops all lab / CLIA / accreditor
// framing so a CFO or materials manager sees neutral supply language.
const STOCK_DEPLOYMENT =
  process.env.VITE_STOCK_DEPLOYMENT === "true" || process.env.STOCK_DEPLOYMENT === "true";

export interface InventoryCountItem {
  storage_location: string | null;
  department: string | null;
  item_name: string;
  category: string | null;
  catalog_number: string | null;
  lot_number: string | null;
  expiration_date: string | null;
  vendor: string | null;
  quantity_on_hand: number;
  unit: string | null;
}

export interface InventoryCountContext {
  labName?: string | null;
  cliaNumber?: string | null;
  preparedBy?: string | null;
  filterLabel?: string | null;   // e.g. "Chemistry / Bio-Rad"
}

export async function generateInventoryCountExcel(
  items: InventoryCountItem[],
  ctx: InventoryCountContext
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const brand = STOCK_DEPLOYMENT ? "VeritaStock" : "VeritaAssure";
  const wb = new ExcelJS.Workbook();
  wb.creator = brand;
  wb.lastModifiedBy = brand;
  wb.created = new Date();
  wb.modified = new Date();

  const labName = ctx.labName || (STOCK_DEPLOYMENT ? "Organization name not on file" : "Lab name not on file");
  const cliaNumber = ctx.cliaNumber || "Not on file";
  // VeritaStock deployment carries no CLIA on the inventory workbook.
  const cliaSuffix = STOCK_DEPLOYMENT ? "" : `    CLIA: ${cliaNumber}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

  const thinBorder: any = {
    top:    { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left:   { style: "thin", color: { argb: "FFD0D0D0" } },
    right:  { style: "thin", color: { argb: "FFD0D0D0" } },
  };

  // ── About sheet ──────────────────────────────────────────────────────────
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaStock Inventory Count";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;

  const id = about.getCell("A2");
  id.value = `Prepared for: ${labName}${cliaSuffix}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  id.border = thinBorder;
  about.getRow(2).height = 24;

  let row = 3;
  if (ctx.filterLabel) {
    const f = about.getCell(`A${row}`);
    f.value = `FILTERED VIEW: this workbook does not include ${STOCK_DEPLOYMENT ? "every location" : "the full lab"}. Scope: ${ctx.filterLabel}.`;
    f.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF7A5A00" } };
    f.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8E1" } };
    f.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
    f.border = thinBorder;
    about.getRow(row).height = 28; row += 1;
  }
  const section = (text: string) => {
    const c = about.getCell(`A${row}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = thinBorder;
    about.getRow(row).height = 22; row += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${row}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = thinBorder;
    const segs = String(text || "").split(/\r?\n/);
    let estLines = 0;
    for (const seg of segs) estLines += Math.max(1, Math.ceil(seg.length / 88));
    about.getRow(row).height = Math.max(2, estLines) * 16 + 4; row += 1;
  };
  const blank = () => { about.getRow(row).height = 8; row += 1; };

  // Per CLAUDE.md §6.5: every About tab is hand-written for its product.
  // No shared content helper. Authored for the inventory-count workflow.
  section("About this workbook");
  body("This workbook supports a physical inventory count. Each row is one inventory item from VeritaStock. The first ten columns are read-only and come from the system of record. The Counted Qty, Counted By, Count Date, and Notes columns are unlocked for the counter to fill in. The Discrepancy column is a formula that compares the counted quantity to the system quantity and is updated automatically as Counted Qty is entered.");
  blank();
  section("How to use this workbook");
  body("Sort order is Storage Location, then Department, then Item Name, so a counter walks one shelf at a time. Open the Count sheet, walk to the first storage location, find each item listed, enter the physical quantity in Counted Qty, write your initials in Counted By, and enter the date counted in Count Date. Use the Notes column for anything the count needs to flag, such as damaged stock, items found in a different location, or recount needed. When the count is complete, return to the bench and use the Discrepancy column to investigate any non-zero rows.");
  blank();
  section("How to reconcile");
  body("Sort the Count sheet by Discrepancy after counting to surface every non-zero row at the top. Investigate each one: confirm the count, check for in-progress receipts or recent open kits, verify the lot number on the shelf matches the lot number in the system, then update the inventory record in VeritaStock to match the corrected quantity. Keep this workbook with the count records; do not edit Discrepancy directly.");
  blank();
  section("Disclaimer");
  body(STOCK_DEPLOYMENT
    ? "This workbook is a tool to help take a physical inventory. It is not an audit, not a financial record, and not a substitute for whatever reconciliation process you have on file. Lot numbers, expiration dates, vendors, and storage locations reflect the data entered into VeritaStock; if those fields are out of date, the workbook will be out of date for them too. The materials manager or designee is responsible for any corrective action taken on the basis of the counted quantities and the discrepancies they reveal."
    : "This workbook is a tool to help the laboratory take a physical inventory. It is not an audit, not a financial record, and not a substitute for whatever reconciliation process the laboratory has on file. Lot numbers, expiration dates, vendors, and storage locations reflect the data the lab has entered into VeritaStock; if those fields are out of date, the workbook will be out of date for them too. The laboratory director or designee is responsible for any corrective action taken on the basis of the counted quantities and the discrepancies they reveal. VeritaAssure does not certify physical inventory counts to any regulatory or accrediting body.");
  blank();
  section(STOCK_DEPLOYMENT ? "Organization identity" : "Lab identity");
  body(STOCK_DEPLOYMENT
    ? `This workbook was prepared for ${labName}. The organization name appears on every printed page header and footer.`
    : `This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  if (ctx.preparedBy) { section("Prepared by"); body(ctx.preparedBy); blank(); }
  section("Coverage gaps");
  body("If a column you need for your count is missing, for example a second counter initial, a barcode column, or a recount-date column, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Inventory Count&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ── Count sheet ──────────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Count");

  // Column layout. Index numbers used below to compute the discrepancy
  // formula and the locked/unlocked map without magic numbers drifting.
  const COLS = [
    { key: "storage_location", header: "Storage Location",   width: 22 },
    { key: "department",       header: "Department",          width: 14 },
    { key: "item_name",        header: "Item Name",           width: 34 },
    { key: "category",         header: "Category",            width: 12 },
    { key: "catalog_number",   header: "Catalog #",           width: 16 },
    { key: "lot_number",       header: "Lot #",               width: 14 },
    { key: "expiration_date",  header: "Expiration",          width: 13 },
    { key: "vendor",           header: "Vendor",              width: 16 },
    { key: "quantity_on_hand", header: "System Qty",          width: 11 },
    { key: "unit",             header: "Unit",                width: 9 },
    { key: "counted_qty",      header: "Counted Qty",         width: 12 },  // UNLOCKED
    { key: "counted_by",       header: "Counted By (initials)", width: 16 }, // UNLOCKED
    { key: "count_date",       header: "Count Date",          width: 12 },  // UNLOCKED
    { key: "notes",            header: "Notes",               width: 30 },  // UNLOCKED
    { key: "discrepancy",      header: "Discrepancy",         width: 12 },  // FORMULA (locked)
  ] as const;
  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const systemQtyCol = COLS.findIndex((c) => c.key === "quantity_on_hand") + 1;  // I
  const countedQtyCol = COLS.findIndex((c) => c.key === "counted_qty") + 1;      // K
  const countedByCol  = COLS.findIndex((c) => c.key === "counted_by")  + 1;      // L
  const countDateCol  = COLS.findIndex((c) => c.key === "count_date")  + 1;      // M
  const notesCol      = COLS.findIndex((c) => c.key === "notes")       + 1;      // N
  const discrepancyCol = COLS.findIndex((c) => c.key === "discrepancy") + 1;     // O
  const unlockedSet = new Set([countedQtyCol, countedByCol, countDateCol, notesCol]);

  // Sort: Storage Location ASC, Department ASC, Item Name ASC. Nulls sort last
  // within each tier so unassigned-location rows do not steal the top of the
  // workbook.
  const norm = (s: string | null | undefined) => (s == null ? "" : String(s));
  const sorted = [...items].sort((a, b) => {
    const sa = norm(a.storage_location), sb = norm(b.storage_location);
    if (!sa && sb) return 1; if (sa && !sb) return -1;
    if (sa !== sb) return sa.localeCompare(sb);
    const da = norm(a.department), db = norm(b.department);
    if (da !== db) return da.localeCompare(db);
    return norm(a.item_name).localeCompare(norm(b.item_name));
  });

  // Helper: classify expiration to drive cell color at build time.
  const expClass = (s: string | null): "expired" | "soon" | "ok" | "none" => {
    if (!s) return "none";
    const exp = new Date(s + "T00:00:00");
    if (isNaN(exp.getTime())) return "none";
    const diffDays = Math.ceil((exp.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return "expired";
    if (diffDays <= 30) return "soon";
    return "ok";
  };

  // Rows.
  for (const it of sorted) {
    const dataRow = ws.addRow([
      it.storage_location ?? "",
      it.department ?? "",
      it.item_name,
      it.category ?? "",
      it.catalog_number ?? "",
      it.lot_number ?? "",
      it.expiration_date ?? "",
      it.vendor ?? "",
      Number(it.quantity_on_hand ?? 0),
      it.unit ?? "",
      "",      // Counted Qty (unlocked)
      "",      // Counted By (unlocked)
      "",      // Count Date (unlocked)
      "",      // Notes (unlocked)
      "",      // Discrepancy filled in below as a formula
    ]);
    // In-cell discrepancy formula. Blank until the counter enters a count.
    const r = dataRow.number;
    const cQtyCell = `${columnLetter(countedQtyCol)}${r}`;
    const sQtyCell = `${columnLetter(systemQtyCol)}${r}`;
    dataRow.getCell(discrepancyCol).value = {
      formula: `IF(ISBLANK(${cQtyCell}),"",${cQtyCell}-${sQtyCell})`,
      result: "" as any,
    };
  }

  // Header row styling (teal, white bold, height 20).
  const headerRow = ws.getRow(1);
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });

  // Data row styling + per-cell lock/unlock + expiration color.
  for (let r = 2; r <= sorted.length + 1; r++) {
    const dataRow = ws.getRow(r);
    const bg = r % 2 === 0 ? "FFEBF3F8" : "FFFFFFFF";
    const expCls = expClass(sorted[r - 2].expiration_date);
    dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = thinBorder;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.protection = { locked: !unlockedSet.has(colNumber) };
    });
    if (expCls === "expired") {
      const c = dataRow.getCell(COLS.findIndex((c) => c.key === "expiration_date") + 1);
      c.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
    } else if (expCls === "soon") {
      const c = dataRow.getCell(COLS.findIndex((c) => c.key === "expiration_date") + 1);
      c.font = { name: "Calibri", bold: true, color: { argb: "FF964219" }, size: 10 };
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
  // Freeze C2: Storage Location and Department stay visible while scrolling right.
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaStock Inventory Count&R&"Calibri,Regular"&10${labName}${cliaSuffix}`;
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}${cliaSuffix}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9${brand}`;
  await ws.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: true, autoFilter: true, pivotTables: false,
  });

  return Buffer.from(await wb.xlsx.writeBuffer()) as Buffer;
}

// Convert 1-based column index to its Excel letter (1 -> A, 11 -> K, 27 -> AA).
function columnLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
