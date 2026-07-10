// server/veritascanDocumentLibraryExcel.ts
//
// VeritaScan Evidence Library xlsx export.
//
// Wave A1.4 (2026-06-06). Surveyor-defensibility move 2 — the export
// IS the artifact that explains the URL-pointer architecture to a
// surveyor opening it cold. The About sheet hammers three things:
//
//   1. VeritaScan never receives or stores the document content. The
//      lab's documents live in SharePoint, Drive, OneDrive, or another
//      external store the lab controls; VeritaAssure stores only the
//      URL + metadata.
//   2. No PHI architecture: the module never accepts file content,
//      which means it cannot accidentally hold patient data even if a
//      lab pasted the wrong URL.
//   3. Every row carries a per-link director attestation (owner_name +
//      owner_attested_at) and an effective/review window so the
//      surveyor can see who in the lab signed off on each document
//      and when.
//
// Per CLAUDE.md §6 (Customer-facing workbooks): About sheet first, lab
// identity stamped in three layers (visible row + page header + page
// footer), sheet password from env, no em-dashes anywhere, brand
// colors only.

export interface VeritascanLibraryRow {
  id: number;
  title: string;
  display_label: string | null;
  document_type: string;
  external_url: string;
  storage_provider: string | null;
  version: string | null;
  status: string;
  effective_date: string | null;
  review_due_date: string | null;
  owner_user_id: number | null;
  owner_name: string | null;
  owner_attested_at: string | null;
  linked_at: string;
}

export interface VeritascanLibraryContext {
  labName?: string | null;
  cliaNumber?: string | null;
  preparedBy?: string | null;
}

export async function generateVeritascanLibraryExcel(
  rows: VeritascanLibraryRow[],
  ctx: VeritascanLibraryContext
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure";
  wb.lastModifiedBy = "VeritaAssure";
  wb.created = new Date();
  wb.modified = new Date();

  const labName = ctx.labName || "Lab name not on file";
  const cliaNumber = ctx.cliaNumber || "Not on file";
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
  title.value = "VeritaScan Evidence Library";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;

  const id = about.getCell("A2");
  id.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  id.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  id.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  id.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  id.border = thinBorder;
  about.getRow(2).height = 24;

  let row = 3;
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

  section("What this workbook is");
  body("This workbook is a directory of the laboratory's accreditation-evidence documents. Each row is one document the lab has linked: its title, document type, the URL where the document is stored, the lab member who attests the URL is the authoritative version, the effective date, and the next review date.");
  blank();

  section("URL pointers only. The lab keeps the documents.");
  body("VeritaAssure stores only the URL and metadata for each entry. The document files themselves stay in the laboratory's own document storage, typically SharePoint, Google Drive, OneDrive, Dropbox, Box, a network share, or a similar service. VeritaAssure has never received and does not retain a copy of the document content. If you need to read a document, follow the URL in the External URL column to the lab's storage location. Access is governed by the lab's own permissions on that storage system.");
  blank();

  section("No PHI by architecture");
  body("VeritaScan does not accept file uploads. This is a deliberate architectural boundary. Because the module cannot ingest document content, it cannot accidentally hold patient identifiers, specimen records, or test results even if a lab pasted a URL pointing to a document that contains such content. PHI never reaches VeritaAssure.");
  blank();

  section("Per-document attestation");
  body("Each row carries an Owner column with the name of the lab member who attests that the linked URL points to the lab's authoritative version of that document. Attested-on records the timestamp of that attestation. Changing the Owner on a row in the application updates both the name captured at attestation time and the timestamp; previous attestations are recorded in the application's audit trail.");
  blank();

  section("Effective and review dates");
  body("Effective Date records when the lab adopted the current version of the document. Review Due records the next time the document is scheduled for review against the lab's procedures. Rows past their Review Due date or missing dates are surfaced in the Document Library page under the Needs review filter and on the Owner's dashboard.");
  blank();

  section("Lab identity");
  body(`This workbook was prepared for ${labName} (CLIA ${cliaNumber}). The lab name and CLIA appear on every printed page header and footer for chain-of-custody.`);
  blank();
  if (ctx.preparedBy) { section("Prepared by"); body(ctx.preparedBy); blank(); }

  section("Coverage gaps");
  body("If a column you need is missing from this workbook (for example a second attester, an accreditor-citation column, or a content-class tag), please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");

  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaScan Evidence Library&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ── Documents sheet ───────────────────────────────────────────────────────
  const ws = wb.addWorksheet("Documents");

  const COLS = [
    { key: "title",             header: "Title",            width: 36 },
    { key: "display_label",     header: "Display Label",    width: 22 },
    { key: "document_type",     header: "Type",             width: 18 },
    { key: "version",           header: "Version",          width: 10 },
    { key: "effective_date",    header: "Effective Date",   width: 14 },
    { key: "review_due_date",   header: "Review Due",       width: 14 },
    { key: "status",            header: "Status",           width: 11 },
    { key: "storage_provider",  header: "Storage Provider", width: 16 },
    { key: "external_url",      header: "External URL",     width: 50 },
    { key: "owner_name",        header: "Owner",            width: 20 },
    { key: "owner_attested_at", header: "Attested On",      width: 20 },
    { key: "linked_at",         header: "Linked On",        width: 20 },
  ] as const;
  ws.columns = COLS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  ws.getRow(1).eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = thinBorder;
  });
  ws.getRow(1).height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };

  const fmtDate = (s: string | null) => s ? s.slice(0, 10) : "";
  const fmtDt = (s: string | null) => s ? s.slice(0, 10) + " " + (s.slice(11, 16) || "") : "";

  const sorted = [...rows].sort((a, b) => {
    return (b.linked_at || "").localeCompare(a.linked_at || "");
  });

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const dataRow = ws.addRow({
      title: r.title,
      display_label: r.display_label || "",
      document_type: r.document_type,
      version: r.version || "",
      effective_date: fmtDate(r.effective_date),
      review_due_date: fmtDate(r.review_due_date),
      status: r.status,
      storage_provider: r.storage_provider || "",
      external_url: r.external_url,
      owner_name: r.owner_name || "",
      owner_attested_at: fmtDt(r.owner_attested_at),
      linked_at: fmtDt(r.linked_at),
    });
    const altFill = i % 2 === 0 ? "FFFFFFFF" : "FFEBF3F8";
    dataRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true, indent: 1 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: altFill } };
      cell.border = thinBorder;
    });
    dataRow.height = 20;
  }

  ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaScan Evidence Library&R&"Calibri,Regular"&10${labName}    CLIA: ${cliaNumber}`;
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName}    CLIA: ${cliaNumber}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;
  await ws.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  // Open on the About sheet (sheet 0) per the customer-facing workbook standard.
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                firstSheet: 0, activeTab: 0, visibility: "visible" }];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as any);
}
