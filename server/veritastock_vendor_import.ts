// veritastock_vendor_import.ts
//
// Parses the San Carlos "inventory accounts" xlsx format into vendor +
// contact records for the VeritaStock vendor directory. PR 3 of the
// 6-PR vendor management build.
//
// The San Carlos sheet has columns:
//   A = VENDOR (e.g. "Sysmex Corporation of America - Sysmex Corporation of America")
//   B = PO    (e.g. "PO-0004005-25", "no PO order as needed", or blank)
//   C = ordering pattern free text (e.g. "as needed", "standing order",
//       "reagent/control reserve")
//   D = account (single or multi-site, e.g. "SCAHC 43900   CWHC 43955")
//   E = POINT OF CONTACT (multi-line block with name + role + phone + email)
//   F+ = ordering email / additional contact tracks
//
// Continuation rows have a blank column A and append to the prior vendor's
// notes. Idempotent on commit: skips vendors whose (lab_id, name) already
// exists. Returns a preview shape so the UI can show a dry-run summary
// before writing.

import ExcelJS from "exceljs";

export interface ParsedContact {
  contact_name: string;
  contact_role: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export interface ParsedVendor {
  source_row: number;
  name: string;
  account_number: string | null;
  po_number: string | null;
  ordering_pattern: string | null;
  ordering_email: string | null;
  ordering_phone: string | null;
  ordering_portal_url: string | null;
  notes: string | null;
  contacts: ParsedContact[];
}

export interface VendorImportResult {
  total_rows_seen: number;
  vendors: ParsedVendor[];
  parse_errors: Array<{ row: number; message: string }>;
}

// Normalizes a cell value to a trimmed string or null.
function cellText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    // ExcelJS rich-text or hyperlink shapes
    const obj = v as any;
    if (obj.text) return String(obj.text).trim() || null;
    if (obj.richText && Array.isArray(obj.richText)) {
      return obj.richText.map((r: any) => r.text || "").join("").trim() || null;
    }
    if (obj.hyperlink) return String(obj.hyperlink).trim() || null;
  }
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

// "Sysmex Corporation of America - Sysmex Corporation of America" -> single name.
// Many rows in the source have the pattern "X - X" because the export tool
// duplicated the legal name and the display name. Collapse if both halves
// are identical (case-insensitive), else keep both.
function normalizeName(raw: string): string {
  const m = raw.split(/\s+-\s+/);
  if (m.length === 2 && m[0].toLowerCase().trim() === m[1].toLowerCase().trim()) {
    return m[0].trim();
  }
  return raw.trim();
}

// First email address found in a free-text block.
function extractEmail(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : null;
}

// First phone number found. Permissive: matches common North American
// patterns including parentheses, dashes, spaces, and 1-800 prefixes.
function extractPhone(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (m) return m[0].replace(/\s+/g, " ").trim();
  // Toll-free pattern like 1-800-2BIORAD (224-6723).
  const tf = s.match(/1[-.\s]?\d{3}[-.\s]?\d?[A-Za-z0-9]+/);
  return tf ? tf[0] : null;
}

// First URL found (https/http).
function extractUrl(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/[,;]$/, "") : null;
}

// Parses a POINT OF CONTACT cell into one or more contact records. The
// San Carlos format puts the primary contact's name on the first line,
// then role / phone / email on subsequent lines. Some rows mash two
// contacts together (e.g. Werfen has Sales + Customer Service + Tech
// Support across multiple paragraphs).
function parseContactCell(raw: string | null): ParsedContact[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Split into paragraphs by double-newline first, then fall back to a
  // single-contact treatment.
  const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const contacts: ParsedContact[] = [];

  for (const para of paragraphs) {
    const lines = para.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const nameLine = lines[0];
    // The first line is usually "Name Phone" or just "Name". Strip a
    // trailing phone to get the bare name.
    let name = nameLine.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}.*$/, "").trim();
    name = name.replace(/[(),.]+\s*$/, "").trim();
    if (!name) name = nameLine;
    const remainingLines = lines.slice(1).join(" ");
    const role = lines.length > 1 ? lines.slice(1).find((l) => !/[@\d]/.test(l)) || null : null;
    contacts.push({
      contact_name: name,
      contact_role: role,
      title: role,
      phone: extractPhone(para),
      email: extractEmail(para),
      notes: remainingLines || null,
    });
  }

  return contacts;
}

// Main entry point. Reads a workbook buffer, finds the "inventory
// accounts" sheet (or the first sheet if not present), and parses rows
// into vendor records. Returns a preview shape; the caller decides
// whether to commit.
export async function parseVendorWorkbook(buffer: Buffer): Promise<VendorImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  // Prefer a sheet named like "inventory accounts" (case-insensitive),
  // else fall back to the first sheet.
  let sheet = wb.worksheets.find((s) => /inventory|vendor|account/i.test(s.name));
  if (!sheet) sheet = wb.worksheets[0];
  if (!sheet) {
    return {
      total_rows_seen: 0,
      vendors: [],
      parse_errors: [{ row: 0, message: "No worksheet found in uploaded file." }],
    };
  }

  const vendors: ParsedVendor[] = [];
  const parseErrors: Array<{ row: number; message: string }> = [];
  let totalRowsSeen = 0;
  let currentVendor: ParsedVendor | null = null;

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    totalRowsSeen += 1;
    if (rowNum === 1) return; // skip header

    const colA = cellText(row.getCell(1).value);
    const colB = cellText(row.getCell(2).value);
    const colC = cellText(row.getCell(3).value);
    const colD = cellText(row.getCell(4).value);
    const colE = cellText(row.getCell(5).value);
    const colF = cellText(row.getCell(6).value);
    const colG = cellText(row.getCell(7).value);

    // A row with no column A is either a continuation of the previous
    // vendor or a stray blank. Append any column-F/G content as notes
    // on the prior vendor and move on.
    if (!colA) {
      if (currentVendor) {
        const extra = [colF, colG].filter(Boolean).join(" | ");
        if (extra) {
          currentVendor.notes = currentVendor.notes
            ? `${currentVendor.notes}\n${extra}`
            : extra;
        }
      }
      return;
    }

    // New vendor row. Push the prior one if it exists.
    if (currentVendor) vendors.push(currentVendor);

    try {
      const name = normalizeName(colA);
      // Column E is the primary contact. Cells F and G sometimes carry
      // an alternate ordering email/phone or extra contact text.
      const contacts = parseContactCell(colE);
      const orderingEmail = extractEmail(colF) || extractEmail(colE);
      const orderingPhone = extractPhone(colF) || extractPhone(colE);
      const orderingPortalUrl = extractUrl(colF) || extractUrl(colE);
      // Notes is everything in F/G that wasn't already an email/phone/URL.
      const notesPieces: string[] = [];
      if (colF) notesPieces.push(colF);
      if (colG) notesPieces.push(colG);
      const notes = notesPieces.length ? notesPieces.join("\n") : null;

      currentVendor = {
        source_row: rowNum,
        name,
        account_number: colD,
        po_number: colB,
        ordering_pattern: colC,
        ordering_email: orderingEmail,
        ordering_phone: orderingPhone,
        ordering_portal_url: orderingPortalUrl,
        notes,
        contacts,
      };
    } catch (err: any) {
      parseErrors.push({ row: rowNum, message: err.message || String(err) });
      currentVendor = null;
    }
  });

  if (currentVendor) vendors.push(currentVendor);

  return {
    total_rows_seen: totalRowsSeen,
    vendors,
    parse_errors: parseErrors,
  };
}
