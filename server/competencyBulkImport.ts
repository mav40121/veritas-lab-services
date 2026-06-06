// server/competencyBulkImport.ts
// VeritaComp bulk-import helpers: template generation + parsing + validation.
//
// Wave I PR I4 (2026-06-06). Headline-only schema (6 cols):
//   Employee Name, Program Name, Assessment Type, Assessment Date,
//   Status, Evaluator Name.
//
// Inserts only — there's no "update existing assessment" path because
// historical records that already exist would be re-imported as
// duplicates; the lab director's expectation is "load my paper records
// once". Duplicate-detection by (employee_id, program_id, date, type)
// would belong here in a future iteration.
//
// Lock-on-import: every successfully-committed row lands with
// locked = 1 and completion_date = assessment_date so the records read
// as historical (already-signed-on-paper) rather than as draft.

import type ExcelJSType from "exceljs";

export const HEADERS = [
  "Employee Name",
  "Program Name",
  "Assessment Type",
  "Assessment Date",
  "Status",
  "Evaluator Name",
];

export const ALLOWED_TYPES = ["initial", "6month", "annual", "reassessment", "orientation", "duty_change"] as const;
export const ALLOWED_STATUSES = ["pass", "fail", "remediation"] as const;

export type RawCell = string | number | null | undefined;

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, RawCell>;
  parsed: {
    employeeName: string;
    programName: string;
    assessmentType: string;
    assessmentDate: string; // YYYY-MM-DD
    status: string;
    evaluatorName: string;
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
  // Resolution results
  resolvedEmployeeId: number | null;       // competency_employees.id (existing or to-create)
  resolvedProgramId: number | null;        // competency_programs.id
  willCreateCompEmployee: boolean;         // true when only staff_employees match exists
  resolvedStaffEmployeeId: number | null;  // staff_employees.id for FK linkage when creating
}

export interface ValidationContext {
  competencyEmployees: Array<{ id: number; name: string; staff_employee_id: number | null }>;
  staffEmployees: Array<{ id: number; first_name: string; last_name: string }>;
  programs: Array<{ id: number; name: string }>;
}

// ─── Template generation ─────────────────────────────────────────

const INSTRUCTIONS: Array<{ text: string; bold?: boolean; size?: number; color?: string }> = [
  { text: "VeritaComp Bulk Import: Historical Assessments", bold: true, size: 16, color: "FF01696F" },
  { text: "" },
  { text: "Fill in one row per historical competency assessment. All six columns are required.", size: 11 },
  { text: "" },
  { text: "Column reference", bold: true, size: 12 },
  { text: "Employee Name: First Last OR Last, First. Case-insensitive match against existing roster." },
  { text: "Program Name: must exactly match an existing program in VeritaComp." },
  { text: "Assessment Type: initial, 6month, annual, reassessment, orientation, or duty_change." },
  { text: "Assessment Date: YYYY-MM-DD." },
  { text: "Status: pass, fail, or remediation." },
  { text: "Evaluator Name: free text. Used for the printed evaluator line on the surveyor PDF." },
  { text: "" },
  { text: "What happens on import", bold: true, size: 12 },
  { text: "Each row creates one locked competency assessment with completion_date = assessment_date." },
  { text: "Imported assessments have no per-element data (Elements 1 through 6 render as 'No data recorded' on the surveyor PDF). This is the expected shape for historical paper-record migration." },
  { text: "Employees not found in the roster are flagged in the preview as Unmatched. Add them in VeritaStaff first, then re-upload." },
  { text: "Programs not found are flagged as errors. Create them in VeritaComp first." },
];

export async function buildCompetencyBulkImportWorkbook(): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure";

  // Instructions sheet
  const inst = wb.addWorksheet("Instructions");
  inst.getColumn(1).width = 110;
  let r = 1;
  for (const ln of INSTRUCTIONS) {
    const cell = inst.getCell(r, 1);
    cell.value = ln.text;
    cell.font = { name: "Calibri", size: ln.size || 11, bold: !!ln.bold, color: ln.color ? { argb: ln.color } : undefined };
    cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    r++;
  }

  // Lookups (very hidden) for data-validation dropdowns
  const look = wb.addWorksheet("Lookups", { state: "veryHidden" });
  look.getColumn(1).values = ["AssessmentType", ...ALLOWED_TYPES];
  look.getColumn(2).values = ["Status", ...ALLOWED_STATUSES];
  wb.definedNames.add(`Lookups!$A$2:$A$${1 + ALLOWED_TYPES.length}`, "AssessmentTypeList");
  wb.definedNames.add(`Lookups!$B$2:$B$${1 + ALLOWED_STATUSES.length}`, "StatusList");

  // Assessments sheet
  const sheet = wb.addWorksheet("Assessments", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = HEADERS.map((h) => ({ header: h, width: h.length < 18 ? 22 : 32 }));
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" }, bottom: { style: "thin" } };
  });

  // Data validation for the first 500 data rows
  const N = 500;
  for (let i = 2; i <= N + 1; i++) {
    sheet.getCell(i, 3).dataValidation = {
      type: "list", allowBlank: false,
      formulae: ["AssessmentTypeList"],
      showErrorMessage: true, errorTitle: "Invalid value", error: "Use one of the allowed assessment types.",
    };
    sheet.getCell(i, 5).dataValidation = {
      type: "list", allowBlank: false,
      formulae: ["StatusList"],
      showErrorMessage: true, errorTitle: "Invalid value", error: "Use pass, fail, or remediation.",
    };
  }

  // Sample row
  const sample = ["Smith, Jane", "Chemistry Annual Competency", "annual", "2024-06-15", "pass", "M. Director"];
  const sampleRow = sheet.getRow(2);
  sample.forEach((v, idx) => { sampleRow.getCell(idx + 1).value = v; });
  sampleRow.font = { italic: true, color: { argb: "FF888888" } };
  sampleRow.getCell(1).note = "Sample row. Delete or overwrite before uploading.";

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ─── Parsing ─────────────────────────────────────────────────────

function cellToString(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v).trim();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, "0");
    const d = String(v.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "object") {
    if ("text" in v && typeof (v as any).text === "string") return String((v as any).text).trim();
    if ("result" in v) return cellToString((v as any).result);
    if ("richText" in v && Array.isArray((v as any).richText)) {
      return (v as any).richText.map((r: any) => r.text || "").join("").trim();
    }
  }
  return String(v).trim();
}

function parseDate(raw: any): { value: string | null; error?: string } {
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
    return { value: null, error: `'${s}' is not YYYY-MM-DD` };
  }
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) {
    return { value: null, error: `'${s}' is not a valid calendar date` };
  }
  return { value: s };
}

export async function parseAssessmentWorkbook(buffer: Buffer): Promise<{ rows: ParsedRow[]; fatal?: string }> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch (e: any) {
    return { rows: [], fatal: `Could not read the file: ${e?.message || "invalid .xlsx"}` };
  }
  const sheet = wb.getWorksheet("Assessments");
  if (!sheet) {
    return { rows: [], fatal: "The uploaded file is missing an 'Assessments' tab. Re-download the template and try again." };
  }
  const headerRow = sheet.getRow(1);
  const expected = HEADERS.map((h) => h.toLowerCase().replace(/\s+/g, " ").trim());
  for (let c = 1; c <= HEADERS.length; c++) {
    const got = cellToString(headerRow.getCell(c).value).toLowerCase().replace(/\s+/g, " ").trim();
    if (got !== expected[c - 1]) {
      return { rows: [], fatal: `Column ${c} should be '${HEADERS[c - 1]}' but was '${got || "(empty)"}'. Re-download the template.` };
    }
  }

  const rows: ParsedRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells: string[] = [];
    for (let c = 1; c <= HEADERS.length; c++) {
      cells.push(cellToString(row.getCell(c).value));
    }
    if (cells.every((v) => !v)) return; // skip blank rows

    const dateResult = parseDate(row.getCell(4).value);
    const parsed: ParsedRow["parsed"] = {
      employeeName: cells[0],
      programName: cells[1],
      assessmentType: cells[2].toLowerCase(),
      assessmentDate: dateResult.value || cells[3],
      status: cells[4].toLowerCase(),
      evaluatorName: cells[5],
    };
    rows.push({
      rowNumber,
      raw: HEADERS.reduce((acc: any, h, i) => { acc[h] = cells[i]; return acc; }, {}),
      parsed,
    });
  });
  return { rows };
}

// ─── Validation ──────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Normalize an arbitrary "First Last" or "Last, First" string into both
 * canonical forms so comparison is direction-agnostic.
 */
function nameVariants(s: string): string[] {
  const n = normalizeName(s);
  if (!n) return [];
  const variants = new Set<string>([n]);
  if (n.includes(",")) {
    const [last, first] = n.split(",").map((p) => p.trim()).filter(Boolean);
    if (last && first) variants.add(`${first} ${last}`);
  } else {
    const parts = n.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(" ");
      variants.add(`${last}, ${first}`);
    }
  }
  return Array.from(variants);
}

export function validateRows(rows: ParsedRow[], ctx: ValidationContext): ValidatedRow[] {
  // Pre-index lookups for O(1) name match.
  const compByName = new Map<string, { id: number; staff_employee_id: number | null }>();
  for (const e of ctx.competencyEmployees) {
    for (const v of nameVariants(e.name)) compByName.set(v, { id: e.id, staff_employee_id: e.staff_employee_id });
  }
  const staffByName = new Map<string, number>();
  for (const e of ctx.staffEmployees) {
    const full = `${e.first_name} ${e.last_name}`;
    for (const v of nameVariants(full)) staffByName.set(v, e.id);
  }
  const programByName = new Map<string, number>();
  for (const p of ctx.programs) programByName.set(normalizeName(p.name), p.id);

  const out: ValidatedRow[] = [];
  for (const r of rows) {
    const issues: RowIssue[] = [];
    let resolvedEmployeeId: number | null = null;
    let resolvedProgramId: number | null = null;
    let willCreateCompEmployee = false;
    let resolvedStaffEmployeeId: number | null = null;

    // Field-shape checks
    if (!r.parsed.employeeName) issues.push({ field: "Employee Name", severity: "error", message: "Employee Name is required" });
    if (!r.parsed.programName) issues.push({ field: "Program Name", severity: "error", message: "Program Name is required" });
    if (!ALLOWED_TYPES.includes(r.parsed.assessmentType as any)) {
      issues.push({ field: "Assessment Type", severity: "error", message: `Assessment Type '${r.parsed.assessmentType}' is not one of ${ALLOWED_TYPES.join(", ")}` });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.parsed.assessmentDate)) {
      issues.push({ field: "Assessment Date", severity: "error", message: `Assessment Date '${r.parsed.assessmentDate}' must be YYYY-MM-DD` });
    }
    if (!ALLOWED_STATUSES.includes(r.parsed.status as any)) {
      issues.push({ field: "Status", severity: "error", message: `Status '${r.parsed.status}' is not one of ${ALLOWED_STATUSES.join(", ")}` });
    }
    if (!r.parsed.evaluatorName) issues.push({ field: "Evaluator Name", severity: "warning", message: "Evaluator Name is blank" });

    // Resolution
    if (r.parsed.employeeName) {
      const variants = nameVariants(r.parsed.employeeName);
      for (const v of variants) {
        const hit = compByName.get(v);
        if (hit) { resolvedEmployeeId = hit.id; resolvedStaffEmployeeId = hit.staff_employee_id; break; }
      }
      if (resolvedEmployeeId === null) {
        // Fall back to staff_employees match
        for (const v of variants) {
          const sid = staffByName.get(v);
          if (sid) { resolvedStaffEmployeeId = sid; willCreateCompEmployee = true; break; }
        }
        if (!willCreateCompEmployee) {
          issues.push({ field: "Employee Name", severity: "error", message: `Employee '${r.parsed.employeeName}' not found. Add them in VeritaStaff first.` });
        }
      }
    }

    if (r.parsed.programName) {
      const pid = programByName.get(normalizeName(r.parsed.programName));
      if (pid) resolvedProgramId = pid;
      else issues.push({ field: "Program Name", severity: "error", message: `Program '${r.parsed.programName}' not found. Create it in VeritaComp first.` });
    }

    let status: "ok" | "warning" | "error" = "ok";
    if (issues.some((i) => i.severity === "error")) status = "error";
    else if (issues.some((i) => i.severity === "warning")) status = "warning";

    out.push({
      rowNumber: r.rowNumber,
      status,
      parsed: r.parsed,
      raw: r.raw,
      issues,
      resolvedEmployeeId,
      resolvedProgramId,
      willCreateCompEmployee,
      resolvedStaffEmployeeId,
    });
  }
  return out;
}

// Suppress unused-type warning for ExcelJSType reference.
type _Unused = ExcelJSType.Workbook;
