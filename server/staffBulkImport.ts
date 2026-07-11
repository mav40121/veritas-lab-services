// server/staffBulkImport.ts
// VeritaStaff™ bulk-import helpers: template generation + row parsing/validation.
//
// Public exports:
//   buildStaffImportWorkbook(ctx) -> Promise<Buffer>
//   parseStaffWorkbook(buffer) -> Promise<{ rows: ParsedRow[]; fatal?: string }>
//   validateRows(rows, ctx) -> ValidatedRow[]
//
// Schema mirrors POST /api/staff/employees handler (server/routes.ts ~7517).
// Roles use one Yes/No column per role + comma-separated specialty numbers
// for TC and TS. Optional Employee ID column enables update-on-reimport.

import type ExcelJSType from "exceljs";

export const CMS_SPECIALTIES: Record<number, string> = {
  1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology",
  5: "Virology", 6: "Diagnostic Immunology", 7: "Chemistry", 8: "Hematology",
  9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
  13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology",
  16: "Histocompatibility", 17: "Clinical Cytogenetics",
};

export type RawCell = string | number | null | undefined;

export interface ParsedRow {
  rowNumber: number;          // 1-indexed Excel row (data starts at row 2)
  raw: Record<string, RawCell>;
  parsed: {
    employeeId: number | null;
    lastName: string;
    firstName: string;
    middleInitial: string | null;
    title: string | null;
    hireDate: string | null;     // YYYY-MM-DD or null
    qualificationsText: string | null;
    highestComplexity: "W" | "M" | "H";
    performsTesting: 0 | 1;
    /** 2026-06-08 Staff Portal access toggles. Y/N in template; 0/1 here. */
    canAdjustInventory: 0 | 1;
    canViewAudit: 0 | 1;
    roles: { role: "LD" | "CC" | "TC" | "TS" | "GS" | "TP"; specialtyNumber: number | null }[];
  };
}

export interface RowIssue {
  field?: string;
  severity: "error" | "warning";
  message: string;
}

export interface ValidatedRow {
  rowNumber: number;
  status: "ok" | "warning" | "error";
  parsed: ParsedRow["parsed"];
  raw: Record<string, RawCell>;
  issues: RowIssue[];
  willInsert: boolean;
  willUpdate: boolean;
  duplicateOfEmployeeId?: number | null;
}

export interface ValidationContext {
  existingEmployees: { id: number; first_name: string; last_name: string }[];
}

// ─── Template generation ─────────────────────────────────────────────

const HEADERS = [
  "Employee ID (leave blank for new)",
  "Last Name *",
  "First Name *",
  "Middle Initial",
  "Title",
  "Hire Date (YYYY-MM-DD)",
  "Qualifications / Credentials",
  "Highest Complexity *",
  "Performs Testing *",
  "Role: LD",
  "Role: CC",
  "Role: TC",
  "Role: TS",
  "Role: GS",
  "Role: TP",
  "TC Specialties (comma-separated, e.g. 7,8)",
  "TS Specialties (comma-separated, e.g. 7,8)",
  // 2026-06-08 Staff Portal access toggles. Y/N. Default N (off) for
  // both. Policies and competencies are universal and have no column.
  "Can Adjust Inventory (Y/N)",
  "Can View Audit (Y/N)",
] as const;

export async function buildStaffImportWorkbook(opts: { labName?: string }): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure\u2122";
  wb.created = new Date();

  // ── Instructions sheet ──
  const inst = wb.addWorksheet("Instructions", { properties: { defaultColWidth: 90 } });
  inst.getColumn(1).width = 110;
  const lines: { text: string; bold?: boolean; size?: number; color?: string }[] = [
    { text: `VeritaStaff\u2122 Bulk Import Template${opts.labName ? "  -  " + opts.labName : ""}`, bold: true, size: 16, color: "FF01696F" },
    { text: "" },
    { text: "How to use this template", bold: true, size: 12 },
    { text: "1. Open the Roster tab and fill in one row per employee." },
    { text: "2. Cells marked with an asterisk are required." },
    { text: "3. Use the dropdowns where shown. Do not rename, reorder, or delete columns." },
    { text: "4. Save the file as .xlsx and upload it back into VeritaStaff." },
    { text: "5. The system will show you a preview before anything is saved." },
    { text: "" },
    { text: "Column legend", bold: true, size: 12 },
    { text: "Employee ID  -  Leave blank for new staff. To update an existing record, paste the Employee ID exported from VeritaStaff." },
    { text: "Last Name / First Name  -  Required. Used to detect duplicates." },
    { text: "Middle Initial  -  Optional. One character." },
    { text: "Title  -  Optional. Free text (e.g. MT, MLS, MD)." },
    { text: "Hire Date  -  Optional. Must be YYYY-MM-DD format (e.g. 2024-03-15)." },
    { text: "Qualifications  -  Optional. Free text. Used in CMS-209 and competency reports." },
    { text: "Highest Complexity  -  Required. W = Waived, M = Moderate, H = High." },
    { text: "Performs Testing  -  Required. Yes or No. If Yes, a competency schedule is created automatically." },
    { text: "" },
    { text: "Roles (Yes / No each)", bold: true, size: 12 },
    { text: "LD  -  Laboratory Director" },
    { text: "CC  -  Clinical Consultant" },
    { text: "TC  -  Technical Consultant (moderate complexity testing)" },
    { text: "TS  -  Technical Supervisor (high complexity testing)" },
    { text: "GS  -  General Supervisor" },
    { text: "TP  -  Testing Personnel" },
    { text: "Reminder: a Laboratory Director does not need to also be listed as CC, TC, TS, or GS." },
    { text: "" },
    { text: "TC and TS specialties", bold: true, size: 12 },
    { text: "If Role: TC = Yes, list the CMS specialty numbers in the TC Specialties column, separated by commas (e.g. 7,8)." },
    { text: "If Role: TS = Yes, list the CMS specialty numbers in the TS Specialties column." },
    { text: "" },
    { text: "CMS specialty numbers", bold: true, size: 12 },
  ];
  for (const num of Object.keys(CMS_SPECIALTIES).map(Number).sort((a, b) => a - b)) {
    lines.push({ text: `${num}  -  ${CMS_SPECIALTIES[num]}` });
  }
  lines.push({ text: "" });
  lines.push({ text: "Notes", bold: true, size: 12 });
  lines.push({ text: "Duplicate first + last name combinations will be flagged in the preview and will not be inserted until corrected." });
  lines.push({ text: "Inactive or terminated staff cannot be imported through this template. Manage status from inside the app." });

  let r = 1;
  for (const ln of lines) {
    const cell = inst.getCell(r, 1);
    cell.value = ln.text;
    cell.font = { name: "Calibri", size: ln.size || 11, bold: !!ln.bold, color: ln.color ? { argb: ln.color } : undefined };
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    r++;
  }

  // ── Lookups sheet (hidden) ──
  const look = wb.addWorksheet("Lookups", { state: "veryHidden" });
  look.getColumn(1).values = ["YesNo", "Yes", "No"];
  look.getColumn(2).values = ["Complexity", "W", "M", "H"];
  // Defined names so the dropdowns reference these by name
  wb.definedNames.add("Lookups!$A$2:$A$3", "YesNoList");
  wb.definedNames.add("Lookups!$B$2:$B$4", "ComplexityList");

  // ── Roster sheet ──
  const ros = wb.addWorksheet("Roster", { views: [{ state: "frozen", ySplit: 1 }] });
  ros.columns = HEADERS.map((h) => {
    const w = h.length < 18 ? 18 : h.length < 30 ? 26 : 36;
    return { header: h, width: w };
  });

  const headerRow = ros.getRow(1);
  headerRow.height = 36;
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" } };
  });

  // Apply data validations to first 500 data rows
  const N = 500;
  for (let i = 2; i <= N + 1; i++) {
    // Highest Complexity (col 8)
    ros.getCell(i, 8).dataValidation = {
      type: "list", allowBlank: false,
      formulae: ["ComplexityList"],
      showErrorMessage: true, errorTitle: "Invalid value", error: "Use W, M, or H.",
    };
    // Performs Testing (col 9)
    ros.getCell(i, 9).dataValidation = {
      type: "list", allowBlank: false,
      formulae: ["YesNoList"],
      showErrorMessage: true, errorTitle: "Invalid value", error: "Use Yes or No.",
    };
    // Role columns 10..15 (LD, CC, TC, TS, GS, TP)
    for (let c = 10; c <= 15; c++) {
      ros.getCell(i, c).dataValidation = {
        type: "list", allowBlank: true,
        formulae: ["YesNoList"],
      };
    }
  }

  // Sample row to show shape (row 2). User can delete it.
  // Sample shows: high complexity tech who is GS + TS for Chemistry and Hematology
  const sample = [
    "", "Smith", "Jane", "A", "MT(ASCP)", "2024-03-15", "BS Medical Technology, MT(ASCP)",
    "H", "Yes", "No", "No", "No", "Yes", "Yes", "No", "", "7,8",
  ];
  const sampleRow = ros.getRow(2);
  sample.forEach((v, idx) => { sampleRow.getCell(idx + 1).value = v; });
  sampleRow.font = { italic: true, color: { argb: "FF888888" } };
  sampleRow.getCell(1).note = "Sample row. Delete or overwrite before uploading.";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─── Workbook parsing ─────────────────────────────────────────────

function cellToString(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v).trim();
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // ExcelJS rich text / hyperlink cells
  if (typeof v === "object") {
    if ("text" in v && typeof (v as any).text === "string") return String((v as any).text).trim();
    if ("result" in v) return cellToString((v as any).result);
    if ("richText" in v && Array.isArray((v as any).richText)) {
      return (v as any).richText.map((r: any) => r.text || "").join("").trim();
    }
  }
  return String(v).trim();
}

function parseYesNo(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  if (["yes", "y", "true", "1", "x"].includes(t)) return true;
  if (["no", "n", "false", "0"].includes(t)) return false;
  return null;
}

function parseHireDate(raw: any): { value: string | null; error?: string } {
  if (raw === null || raw === undefined || raw === "") return { value: null };
  if (raw instanceof Date) {
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return { value: `${y}-${m}-${d}` };
  }
  const s = cellToString(raw);
  if (!s) return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return { value: null, error: `Hire Date '${s}' is not YYYY-MM-DD` };
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return { value: null, error: `Hire Date '${s}' is not a valid calendar date` };
  }
  return { value: s };
}

function parseSpecialties(s: string): { nums: number[]; bad: string[] } {
  if (!s) return { nums: [], bad: [] };
  const nums: number[] = [];
  const bad: string[] = [];
  for (const part of s.split(/[,;\s]+/)) {
    const p = part.trim();
    if (!p) continue;
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > 17) { bad.push(p); continue; }
    nums.push(n);
  }
  return { nums, bad };
}

export async function parseStaffWorkbook(buffer: Buffer): Promise<{ rows: ParsedRow[]; fatal?: string }> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch (e: any) {
    return { rows: [], fatal: `Could not read the file: ${e?.message || "invalid .xlsx"}` };
  }
  const ros = wb.getWorksheet("Roster");
  if (!ros) {
    return { rows: [], fatal: "The uploaded file is missing a 'Roster' tab. Re-download the template and try again." };
  }
  const headerRow = ros.getRow(1);
  const expected = HEADERS.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  const got: string[] = [];
  for (let c = 1; c <= HEADERS.length; c++) {
    got.push(cellToString(headerRow.getCell(c).value).toLowerCase().replace(/\s+/g, " ").trim());
  }
  for (let i = 0; i < expected.length; i++) {
    if (got[i] !== expected[i]) {
      return { rows: [], fatal: `Column ${i + 1} should be '${HEADERS[i]}' but was '${got[i] || "(empty)"}'. Re-download the template.` };
    }
  }

  const rows: ParsedRow[] = [];
  ros.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: RawCell[] = [];
    for (let c = 1; c <= HEADERS.length; c++) {
      cells.push(cellToString(row.getCell(c).value) as any);
    }
    // Skip fully blank rows
    if (cells.every((v) => v === null || v === undefined || v === "")) return;

    const raw: Record<string, RawCell> = {};
    HEADERS.forEach((h, i) => { raw[h] = cells[i]; });

    const lastName = cellToString(cells[1]);
    const firstName = cellToString(cells[2]);
    const middleInitial = cellToString(cells[3]) || null;
    const title = cellToString(cells[4]) || null;
    const hireDate = parseHireDate(row.getCell(6).value);
    const qualificationsText = cellToString(cells[6]) || null;
    const complexityRaw = cellToString(cells[7]).toUpperCase();
    const performs = parseYesNo(cellToString(cells[8]));
    const empIdRaw = cellToString(cells[0]);

    const roles: ParsedRow["parsed"]["roles"] = [];
    const roleCodes: ("LD" | "CC" | "TC" | "TS" | "GS" | "TP")[] = ["LD", "CC", "TC", "TS", "GS", "TP"];
    roleCodes.forEach((code, idx) => {
      const yes = parseYesNo(cellToString(cells[9 + idx]));
      if (yes) roles.push({ role: code, specialtyNumber: null });
    });
    const tcSpecsRaw = cellToString(cells[15]);
    const tsSpecsRaw = cellToString(cells[16]);
    const tcSpecs = parseSpecialties(tcSpecsRaw);
    const tsSpecs = parseSpecialties(tsSpecsRaw);
    // 2026-06-08 Staff Portal toggles. Both default OFF when blank,
    // omitted, or unparseable, so an old template missing these columns
    // does not flip toggles on inadvertently.
    const canAdjustInventoryRaw = cellToString(cells[17]);
    const canViewAuditRaw = cellToString(cells[18]);
    const canAdjustInventory: 0 | 1 = parseYesNo(canAdjustInventoryRaw) === true ? 1 : 0;
    const canViewAudit: 0 | 1 = parseYesNo(canViewAuditRaw) === true ? 1 : 0;
    // Expand TC and TS into per-specialty role rows (matches existing UI behavior)
    const expanded: ParsedRow["parsed"]["roles"] = [];
    for (const r of roles) {
      if (r.role === "TC") {
        if (tcSpecs.nums.length === 0) expanded.push({ role: "TC", specialtyNumber: null });
        else for (const n of tcSpecs.nums) expanded.push({ role: "TC", specialtyNumber: n });
      } else if (r.role === "TS") {
        if (tsSpecs.nums.length === 0) expanded.push({ role: "TS", specialtyNumber: null });
        else for (const n of tsSpecs.nums) expanded.push({ role: "TS", specialtyNumber: n });
      } else {
        expanded.push(r);
      }
    }

    rows.push({
      rowNumber,
      raw,
      parsed: {
        employeeId: empIdRaw && /^\d+$/.test(empIdRaw) ? Number(empIdRaw) : null,
        lastName,
        firstName,
        middleInitial,
        title,
        hireDate: hireDate.value,
        qualificationsText,
        highestComplexity: (complexityRaw === "W" || complexityRaw === "M" || complexityRaw === "H") ? complexityRaw : "H",
        performsTesting: performs ? 1 : 0,
        canAdjustInventory,
        canViewAudit,
        roles: expanded,
      },
    });

    // Stash any parse-time hints so validateRows can surface them (we use a sentinel via the raw map)
    if (hireDate.error) (raw as any).__hireDateError = hireDate.error;
    if (tcSpecs.bad.length) (raw as any).__tcBad = tcSpecs.bad.join(", ");
    if (tsSpecs.bad.length) (raw as any).__tsBad = tsSpecs.bad.join(", ");
  });

  return { rows };
}

// ─── Validation ─────────────────────────────────────────────

function nameKey(first: string, last: string): string {
  return `${last.trim().toLowerCase()}\u0001${first.trim().toLowerCase()}`;
}

export function validateRows(rows: ParsedRow[], ctx: ValidationContext): ValidatedRow[] {
  // Build name -> id index for existing employees
  const existingByName = new Map<string, number>();
  for (const e of ctx.existingEmployees) {
    existingByName.set(nameKey(e.first_name, e.last_name), e.id);
  }
  const existingIds = new Set(ctx.existingEmployees.map((e) => e.id));

  // First pass: parse-time issues + per-row checks
  const out: ValidatedRow[] = rows.map((r) => {
    const issues: RowIssue[] = [];
    const p = r.parsed;

    if (!p.lastName) issues.push({ field: "Last Name", severity: "error", message: "Last Name is required" });
    if (!p.firstName) issues.push({ field: "First Name", severity: "error", message: "First Name is required" });
    const complexRawCell = cellToString(r.raw["Highest Complexity *"] as any).toUpperCase();
    if (!complexRawCell) {
      issues.push({ field: "Highest Complexity", severity: "error", message: "Highest Complexity is required (W, M, or H)" });
    } else if (!["W", "M", "H"].includes(complexRawCell)) {
      issues.push({ field: "Highest Complexity", severity: "error", message: `Highest Complexity '${complexRawCell}' must be W, M, or H` });
    }
    const performsRaw = cellToString(r.raw["Performs Testing *"] as any);
    if (!performsRaw) issues.push({ field: "Performs Testing", severity: "error", message: "Performs Testing is required (Yes or No)" });
    else if (parseYesNo(performsRaw) === null) issues.push({ field: "Performs Testing", severity: "error", message: `Performs Testing '${performsRaw}' must be Yes or No` });

    if (p.middleInitial && p.middleInitial.length > 1) {
      issues.push({ field: "Middle Initial", severity: "warning", message: "Middle Initial is longer than 1 character; only the first character will be saved" });
    }
    if ((r.raw as any).__hireDateError) {
      issues.push({ field: "Hire Date", severity: "error", message: String((r.raw as any).__hireDateError) });
    }
    if ((r.raw as any).__tcBad) {
      issues.push({ field: "TC Specialties", severity: "error", message: `Invalid TC specialty numbers: ${(r.raw as any).__tcBad}. Use 1-17.` });
    }
    if ((r.raw as any).__tsBad) {
      issues.push({ field: "TS Specialties", severity: "error", message: `Invalid TS specialty numbers: ${(r.raw as any).__tsBad}. Use 1-17.` });
    }

    // Role / complexity coherence
    const roleCodes = new Set(p.roles.map((x) => x.role));
    if (roleCodes.has("TC") && !p.roles.some((x) => x.role === "TC" && x.specialtyNumber !== null)) {
      issues.push({ field: "TC Specialties", severity: "warning", message: "Role TC is Yes but no TC specialties were listed" });
    }
    if (roleCodes.has("TS") && !p.roles.some((x) => x.role === "TS" && x.specialtyNumber !== null)) {
      issues.push({ field: "TS Specialties", severity: "warning", message: "Role TS is Yes but no TS specialties were listed" });
    }
    if (roleCodes.has("TS") && p.highestComplexity === "M") {
      issues.push({ field: "Role: TS", severity: "warning", message: "TS is a high-complexity role but Highest Complexity is Moderate" });
    }
    if (roleCodes.has("TC") && p.highestComplexity === "H" && !roleCodes.has("TS") && !roleCodes.has("LD")) {
      // soft note only
    }
    if (p.roles.length === 0 && p.performsTesting === 1) {
      issues.push({ field: "Roles", severity: "warning", message: "Performs Testing is Yes but no role flag is set; consider checking Role: TP" });
    }

    let willInsert = true;
    let willUpdate = false;
    let dupId: number | null | undefined = null;

    if (p.employeeId !== null) {
      if (!existingIds.has(p.employeeId)) {
        issues.push({ field: "Employee ID", severity: "error", message: `Employee ID ${p.employeeId} does not exist in this lab` });
        willInsert = false;
      } else {
        willInsert = false;
        willUpdate = true;
      }
    } else if (p.lastName && p.firstName) {
      const matchId = existingByName.get(nameKey(p.firstName, p.lastName));
      if (matchId !== undefined) {
        dupId = matchId;
        issues.push({
          field: "Name",
          severity: "error",
          message: `Duplicate of existing employee #${matchId}. To update, paste ${matchId} into the Employee ID column.`,
        });
        willInsert = false;
      }
    }

    const errCount = issues.filter((i) => i.severity === "error").length;
    const warnCount = issues.filter((i) => i.severity === "warning").length;
    const status: ValidatedRow["status"] = errCount > 0 ? "error" : warnCount > 0 ? "warning" : "ok";

    return {
      rowNumber: r.rowNumber,
      status,
      parsed: p,
      raw: r.raw,
      issues,
      willInsert,
      willUpdate,
      duplicateOfEmployeeId: dupId,
    };
  });

  // Second pass: in-file duplicates (two rows with same first+last)
  const seenInFile = new Map<string, number>();
  for (const r of out) {
    if (r.parsed.employeeId !== null) continue;
    if (!r.parsed.firstName || !r.parsed.lastName) continue;
    const key = nameKey(r.parsed.firstName, r.parsed.lastName);
    const prior = seenInFile.get(key);
    if (prior !== undefined) {
      r.issues.push({
        field: "Name",
        severity: "error",
        message: `Same name appears earlier in this file at row ${prior}. Each row must be unique.`,
      });
      r.willInsert = false;
      if (r.status !== "error") r.status = "error";
    } else {
      seenInFile.set(key, r.rowNumber);
    }
  }

  return out;
}
