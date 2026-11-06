// server/competencyMethodHistory.ts
//
// VeritaComp bulk import, rebuilt around what a lab actually has (Michael 2026-11-04, Q164 = 1): a person, a method and a last date. The
// older import loaded assessments into named programs, made the lab create the programs first and retype names we already hold, and a row
// for a program naming no analyzer moved nobody's due date (BUG-120).
//   Template: one row per testing person and assigned method, pre-filled. The lab types the last date and the evaluator.
//   Preview: what each row will set, worked out by the real clock inside a transaction that is rolled back.
//   Commit: one competency_method_history row per analyzer in the method, and the person's VeritaStaff schedule filled from them.
// A date here is imported history (loadImportedHistory in server/competencyMethodClock.ts): a live per-method sign-off always wins, and it
// is shown as imported, never as signed here.

import type { Express } from "express";
import { db } from "./db";
import { labToday, labLocalDate } from "./dateLocal";
import { loadInstrumentGroups, loadLabMethodClocks } from "./competencyMethodClock";
import { applyImportedSchedules, summarizeScheduleResults } from "./competencyImportSchedule";
import { logAudit } from "./audit";
import { staffOwnScope } from "./competencySelfEntry";

const SHEET = "Past Competencies";
const HEADERS = ["Person", "Title", "Method", "Department", "Complexity", "On file now", "Last competency date", "Type", "Evaluator", "Person key", "Method key"];
const COL = { person: 1, title: 2, method: 3, department: 4, complexity: 5, onFile: 6, date: 7, type: 8, evaluator: 9, personKey: 10, methodKey: 11 };
const TYPE_TO_MILESTONE: Record<string, "initial" | "six_month" | "annual"> = { initial: "initial", "6-month": "six_month", "6 month": "six_month", "6month": "six_month", "six month": "six_month", annual: "annual" };
const MILESTONE_WORDS: Record<string, string> = { initial: "Initial", six_month: "6-month", first_annual: "Annual", annual: "Annual" };
const SCHEDULE_TYPE: Record<string, string> = { initial: "initial", six_month: "6month", annual: "annual" };
const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const personName = (e: any) => `${e.last_name}, ${e.first_name}${e.middle_initial ? ` ${e.middle_initial}` : ""}`.trim();

export interface TemplateRow {
  staffEmployeeId: number; methodId: number; person: string; title: string; method: string; department: string; complexity: string; onFile: string; type: string;
}

// Everyone testing in the lab and the methods assigned to them, leaving out a method already signed here: a live sign-off wins, so a date for it would change nothing.
export function templateData(sqlite: any, labId: number, today: string): { rows: TemplateRow[]; people: number; peopleWithoutMethods: string[] } {
  const clocks = loadLabMethodClocks(sqlite, labId, today);
  const groups = loadInstrumentGroups(sqlite, labId);
  const staff = sqlite.prepare(
    "SELECT id, first_name, last_name, middle_initial, title, hire_date FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND performs_testing = 1 ORDER BY last_name, first_name"
  ).all(labId) as any[];
  const instruments = new Map<number, any>((sqlite.prepare(
    "SELECT i.id, i.instrument_name, i.nickname, i.serial_number, m.name AS map_name FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id WHERE m.lab_id = ?"
  ).all(labId) as any[]).map((i) => [i.id, i]));
  const signedHere = new Set((sqlite.prepare(
    "SELECT DISTINCT staff_employee_id, instrument_id FROM competency_method_signoffs WHERE lab_id = ? AND revoked_at IS NULL"
  ).all(labId) as any[]).map((s) => `${s.staff_employee_id}:${s.instrument_id}`));
  const rows: TemplateRow[] = [];
  const peopleWithoutMethods: string[] = [];
  for (const e of staff) {
    const methods = clocks.get(e.id) || [];
    if (!methods.length) peopleWithoutMethods.push(personName(e));
    // A hire inside the last year may be on their Initial or 6-month, so the lab picks. Anyone else is on Annual unless the lab says otherwise.
    const recentHire = !!e.hire_date && e.hire_date > addYears(today, -1);
    for (const m of methods) {
      const g = groups.get(m.methodId);
      const memberIds = g ? g.memberIds : [m.methodId];
      if (memberIds.some((id) => signedHere.has(`${e.id}:${id}`))) continue;
      const inst = instruments.get(m.methodId);
      const tag = String(inst?.nickname || "").trim() || String(inst?.serial_number || "").trim();
      const last = m.clock.lastPass;
      rows.push({
        staffEmployeeId: e.id, methodId: m.methodId, person: personName(e), title: e.title || "",
        method: g ? m.name : tag ? `${m.name} (${tag})` : m.name, department: inst?.map_name || "", complexity: m.complexity,
        onFile: last?.milestone && last?.signedDate ? `${MILESTONE_WORDS[last.milestone] || last.milestone} ${mdy(last.signedDate)}` : "Nothing on file",
        type: recentHire ? "" : "Annual",
      });
    }
  }
  return { rows, people: staff.length, peopleWithoutMethods };
}

export async function buildMethodHistoryWorkbook(identity: { labName: string; cliaNumber: string | null }, data: ReturnType<typeof templateData>, today: string): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "VeritaAssure";
  const teal = "FF01696F", tint = "FFE6F2F2", accent = "FF0A3A3D", ink = "FF28251D", alt = "FFEBF3F8", input = "FFFFF8E1";
  const idLine = `${identity.labName || "Laboratory"}    CLIA: ${identity.cliaNumber || "Not on file"}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const headerFooter = { oddHeader: `&R${idLine}`, oddFooter: `&L${idLine}&RPage &P of &N` };

  const about = wb.addWorksheet("About", { headerFooter, pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  about.getColumn(1).width = 110;
  let r = 1;
  const put = (text: string, kind: "title" | "id" | "h" | "p") => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    if (kind === "title") {
      c.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
      about.getRow(r).height = 30;
    } else if (kind === "id" || kind === "h") {
      c.font = { name: "Calibri", bold: true, size: kind === "id" ? 11 : 12, color: { argb: accent } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      about.getRow(r).height = 22;
    } else {
      c.font = { name: "Calibri", size: 10, color: { argb: ink } };
      about.getRow(r).height = Math.max(18, Math.ceil(text.length / 120) * 15);
    }
    r += 1;
  };
  put("VeritaAssure® | VeritaComp™ Past Competency Dates", "title");
  put(`Prepared for: ${identity.labName || "Laboratory"}    CLIA: ${identity.cliaNumber || "Not on file"}`, "id");
  put("This template records the last competency each testing person completed on each method before your laboratory started recording competencies in VeritaComp. The dates come from your own records. VeritaAssure does not verify them, and the medical director or designee remains responsible for them.", "p");
  put("How to use it", "h");
  put("1. On the Past Competencies sheet, find each person and method. Type the date of their last competency in the yellow column, and who evaluated it.", "p");
  put("2. Check Type. Annual is filled in for most people. For someone hired in the last year Type is blank: pick Initial, 6-month or Annual, because that decides whether the next one is due in 6 or 12 months.", "p");
  put("3. Leave a row blank if you have no record for it. That person still shows that competency as due.", "p");
  put("4. Save the file and upload it in VeritaComp, under Bulk Import. The preview shows what each row will set before anything is saved. The file can be uploaded again later with more dates: a date already loaded is not loaded twice.", "p");
  put("Source", "h");
  put(`The people and methods are your VeritaStaff™ roster and each person's assigned instruments, as of ${mdy(today)}. A method already signed in VeritaComp is left out, because a sign-off recorded there always counts ahead of a date loaded here.`, "p");
  put("42 CFR 493.1451(b)(8) and (b)(9) (high complexity) and 42 CFR 493.1413(b)(8) and (b)(9) (moderate complexity) set out competency assessment and how often it is done. The dates loaded here run the same clock as a competency signed in VeritaComp.", "p");
  put("Coverage gaps", "h");
  put(`${data.peopleWithoutMethods.length ? `${data.peopleWithoutMethods.length} testing ${data.peopleWithoutMethods.length === 1 ? "person has" : "people have"} no instruments assigned and so ${data.peopleWithoutMethods.length === 1 ? "is" : "are"} not listed: ${data.peopleWithoutMethods.join("; ")}. Assign them on the Instruments tab in VeritaStaff, then download this template again. ` : ""}Non-technical programs are not on this template. Their past records use the program template in the same Bulk Import window. If something you expected is missing, write to info@veritaslabservices.com.`, "p");
  await about.protect(exportPwd, { selectLockedCells: false, selectUnlockedCells: false, formatCells: false, formatColumns: false, formatRows: false, insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: false, pivotTables: false });

  const ws = wb.addWorksheet(SHEET, { headerFooter, views: [{ state: "frozen", xSplit: 1, ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const widths = [28, 20, 34, 18, 12, 22, 16, 11, 26, 8, 8];
  ws.columns = HEADERS.map((h, i) => ({ header: h, width: widths[i] }));
  const hr = ws.getRow(1);
  hr.height = 34;
  hr.eachCell((c: any) => {
    c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
    c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    c.border = border;
  });
  data.rows.forEach((row, i) => {
    const n = i + 2;
    const out = ws.getRow(n);
    out.getCell(COL.person).value = row.person;
    out.getCell(COL.title).value = row.title || null;
    out.getCell(COL.method).value = row.method;
    out.getCell(COL.department).value = row.department || null;
    out.getCell(COL.complexity).value = row.complexity === "UNSPECIFIED" ? null : row.complexity;
    out.getCell(COL.onFile).value = row.onFile;
    out.getCell(COL.type).value = row.type || null;
    out.getCell(COL.personKey).value = row.staffEmployeeId;
    out.getCell(COL.methodKey).value = row.methodId;
    for (let c = 1; c <= HEADERS.length; c += 1) {
      const cell = out.getCell(c);
      const isInput = c === COL.date || c === COL.type || c === COL.evaluator;
      cell.font = { name: "Calibri", size: 10, color: { argb: ink } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = border;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isInput ? input : i % 2 ? alt : "FFFFFFFF" } };
      cell.protection = { locked: !isInput };
    }
    out.getCell(COL.date).numFmt = "mm/dd/yyyy";
    out.getCell(COL.date).dataValidation = { type: "date", operator: "lessThanOrEqual", allowBlank: true, formulae: [new Date(`${today}T00:00:00Z`)], showErrorMessage: true, errorTitle: "Date", error: "Enter a date that is not in the future." };
    out.getCell(COL.type).dataValidation = { type: "list", allowBlank: true, formulae: ['"Initial,6-month,Annual"'], showErrorMessage: true, errorTitle: "Type", error: "Pick Initial, 6-month or Annual." };
    out.height = 20;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, data.rows.length + 1), column: COL.evaluator } };
  ws.getColumn(COL.personKey).hidden = true;
  ws.getColumn(COL.methodKey).hidden = true;
  await ws.protect(exportPwd, { selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: true, formatRows: false, insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false, sort: false, autoFilter: true, pivotTables: false });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

export interface FilledRow { rowNumber: number; staffEmployeeId: number; methodId: number; rawDate: any; rawType: string; evaluator: string }

const cellText = (v: any): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text.trim();
    if ("result" in v) return cellText(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text || "").join("").trim();
  }
  return String(v).trim();
};

// YYYY-MM-DD from an Excel date, 2026-03-01 or 3/1/2026. Null when it isn't a real date.
export function parseHistoryDate(v: any): string | null {
  let y: number, m: number, d: number;
  if (v instanceof Date) { y = v.getUTCFullYear(); m = v.getUTCMonth() + 1; d = v.getUTCDate(); }
  else {
    const s = cellText(v);
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
    else if (us) { y = +us[3]; m = +us[1]; d = +us[2]; }
    else return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() + 1 !== m || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function parseMethodHistoryWorkbook(buffer: Buffer): Promise<{ rows: FilledRow[]; blank: number; fatal?: string }> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as any); } catch { return { rows: [], blank: 0, fatal: "That file could not be read as an Excel workbook. Download the template and try again." }; }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) return { rows: [], blank: 0, fatal: "This isn't the current template. Download the template here, which comes filled in with your people and methods, and use that." };
  const heads = [COL.date, COL.type, COL.evaluator, COL.personKey, COL.methodKey].map((c) => cellText(ws.getRow(1).getCell(c).value));
  if (heads.join("|") !== "Last competency date|Type|Evaluator|Person key|Method key") return { rows: [], blank: 0, fatal: "The columns in this file have changed. Download the template and try again." };
  const rows: FilledRow[] = [];
  let blank = 0;
  for (let n = 2; n <= ws.rowCount; n += 1) {
    const row = ws.getRow(n);
    const staffEmployeeId = Number(cellText(row.getCell(COL.personKey).value));
    const methodId = Number(cellText(row.getCell(COL.methodKey).value));
    if (!staffEmployeeId && !methodId) continue;
    const rawDate = row.getCell(COL.date).value;
    const evaluator = cellText(row.getCell(COL.evaluator).value);
    // Type is pre-filled, so a row counts as filled in only once someone typed a date or an evaluator.
    if (!cellText(rawDate) && !evaluator) { blank += 1; continue; }
    rows.push({ rowNumber: n, staffEmployeeId, methodId, rawDate, rawType: cellText(row.getCell(COL.type).value), evaluator });
  }
  return { rows, blank };
}

export interface CheckedRow {
  rowNumber: number; status: "ok" | "warning" | "error" | "skip"; issues: string[];
  person: string; method: string; type: string; date: string | null; evaluator: string;
  staffEmployeeId: number; methodId: number; milestone: string | null; memberIds: number[];
  sets?: { label: string; targetDate: string | null; overdue: boolean } | null;
}

export function checkRows(sqlite: any, labId: number, rows: FilledRow[], today: string): CheckedRow[] {
  const clocks = loadLabMethodClocks(sqlite, labId, today);
  const groups = loadInstrumentGroups(sqlite, labId);
  const staff = new Map<number, any>((sqlite.prepare("SELECT id, first_name, last_name, middle_initial, hire_date FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active'").all(labId) as any[]).map((e) => [e.id, e]));
  const signedHere = new Set((sqlite.prepare("SELECT DISTINCT staff_employee_id, instrument_id FROM competency_method_signoffs WHERE lab_id = ? AND revoked_at IS NULL").all(labId) as any[]).map((s) => `${s.staff_employee_id}:${s.instrument_id}`));
  const already = sqlite.prepare("SELECT 1 FROM competency_method_history WHERE lab_id = ? AND staff_employee_id = ? AND instrument_id = ? AND milestone = ? AND completed_date = ? AND removed_at IS NULL");
  const seen = new Set<string>();
  return rows.map((row) => {
    const out: CheckedRow = { rowNumber: row.rowNumber, status: "ok", issues: [], person: "", method: "", type: row.rawType, date: null, evaluator: row.evaluator, staffEmployeeId: row.staffEmployeeId, methodId: row.methodId, milestone: null, memberIds: [] };
    const fail = (msg: string) => { out.status = "error"; out.issues.push(msg); };
    const emp = staff.get(row.staffEmployeeId);
    const method = (clocks.get(row.staffEmployeeId) || []).find((m) => m.methodId === row.methodId);
    if (emp) out.person = personName(emp);
    if (method) out.method = method.name;
    // Nothing from another lab's file reaches the names above: the row only matches this lab's own people and their own methods.
    if (!emp || !method) { fail("This row doesn't match this lab's roster and assigned methods. Download a fresh template."); return out; }
    const g = groups.get(row.methodId);
    out.memberIds = g ? g.memberIds : [row.methodId];
    const date = parseHistoryDate(row.rawDate);
    if (!date) fail(cellText(row.rawDate) ? `"${cellText(row.rawDate)}" isn't a date. Use a date such as 03/15/2026.` : "Type the date of the last competency.");
    else if (date > today) fail("That date is in the future.");
    out.date = date;
    const milestone = TYPE_TO_MILESTONE[row.rawType.toLowerCase()] || null;
    if (!milestone) fail(row.rawType ? `"${row.rawType}" isn't a type. Pick Initial, 6-month or Annual.` : "Pick Initial, 6-month or Annual.");
    else if (milestone === "six_month" && method.complexity === "WAIVED") fail("Waived testing has no 6-month. Pick Initial or Annual.");
    out.milestone = milestone;
    out.type = milestone ? MILESTONE_WORDS[milestone] : row.rawType;
    if (!row.evaluator) fail("Type who evaluated it.");
    if (out.status === "error") return out;
    if (emp.hire_date && date! < emp.hire_date) { out.status = "warning"; out.issues.push(`This date is before the hire date on file (${mdy(emp.hire_date)}).`); }
    if (out.memberIds.some((id) => signedHere.has(`${row.staffEmployeeId}:${id}`))) {
      out.status = "skip"; out.issues = ["Already signed in VeritaComp. A sign-off there counts ahead of this date, so this row isn't loaded."]; return out;
    }
    const k = `${row.staffEmployeeId}:${row.methodId}:${milestone}:${date}`;
    if (seen.has(k) || already.get(labId, row.staffEmployeeId, out.memberIds[0], milestone, date)) {
      out.status = "skip"; out.issues = ["This date is already on file."]; return out;
    }
    seen.add(k);
    return out;
  });
}

function insertHistory(sqlite: any, labId: number, userId: number | null, rows: CheckedRow[], now: string): number {
  const ins = sqlite.prepare(
    `INSERT INTO competency_method_history (lab_id, staff_employee_id, instrument_id, milestone, completed_date, evaluator_name, source, group_history_id, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'bulk_import', ?, ?, ?)`
  );
  let n = 0;
  for (const r of rows) {
    if (r.status !== "ok" && r.status !== "warning") continue;
    // One row per analyzer in the method, so splitting a group later keeps each analyzer's history. The others point at the first.
    let first: number | null = null;
    for (const id of r.memberIds) {
      const made: number = Number(ins.run(labId, r.staffEmployeeId, id, r.milestone, r.date, r.evaluator, first, userId, now).lastInsertRowid);
      if (first == null) first = made;
    }
    n += 1;
  }
  return n;
}

// VeritaStaff's person-level schedule, filled the way the older import does (Michael Q12 = 1).
function scheduleInput(rows: CheckedRow[]) {
  const by = new Map<number, Array<{ assessmentType: string; assessmentDate: string; status: string; evaluatorName: string }>>();
  for (const r of rows) {
    if ((r.status !== "ok" && r.status !== "warning") || !r.milestone || !r.date) continue;
    by.set(r.staffEmployeeId, [...(by.get(r.staffEmployeeId) || []), { assessmentType: SCHEDULE_TYPE[r.milestone], assessmentDate: r.date, status: "pass", evaluatorName: r.evaluator }]);
  }
  return by;
}

class Rollback extends Error {}

// What each row will set: the real insert and the real clock, inside a transaction that is rolled back.
export function previewRows(sqlite: any, labId: number, rows: CheckedRow[], today: string): void {
  try {
    sqlite.transaction(() => {
      insertHistory(sqlite, labId, null, rows, new Date().toISOString());
      const clocks = loadLabMethodClocks(sqlite, labId, today);
      for (const r of rows) {
        if (r.status !== "ok" && r.status !== "warning") continue;
        const c = (clocks.get(r.staffEmployeeId) || []).find((m) => m.methodId === r.methodId)?.clock;
        if (c) r.sets = { label: MILESTONE_WORDS[c.nextMilestone] || c.nextMilestone, targetDate: c.nextDue?.targetDate || null, overdue: c.overdue };
      }
      throw new Rollback();
    })();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
}

export function registerCompetencyMethodHistoryRoutes(app: Express, deps: { authMiddleware: any; requireWriteAccess: any; requireModuleEdit: any; hasCompetencyAccess: (user: any, lab?: any) => boolean }) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerCompetencyMethodHistoryRoutes: labScopeMiddleware not registered");
  const { authMiddleware, requireWriteAccess, requireModuleEdit, hasCompetencyAccess } = deps;
  const sqlite = () => (db as any).$client;
  const gate = (req: any, res: any, next: any) => {
    if (!hasCompetencyAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaComp™ subscription required" });
    next();
  };
  const upload = (req: any, res: any, next: any) => {
    import("multer").then(({ default: m }) => {
      m({ storage: m.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single("file")(req, res, (err: any) => {
        if (err) return res.status(400).json({ error: err.message || "Upload failed" });
        if (!req.file?.buffer) return res.status(400).json({ error: "No file uploaded" });
        next();
      });
    });
  };

  // Who the template will list, for the import window.
  // The template and its summary list every testing person, for the evaluator's import. Not for a Staff login (Michael Q182 = 1).
  const notForStaffLogin = (req: any, res: any, next: any) =>
    (staffOwnScope(sqlite(), req.userId, req.scope.labId) ? res.status(403).json({ error: "A staff login can only open their own competency record.", code: "STAFF_OWN_ONLY" }) : next());
  app.get("/api/labs/:labId/competency/method-history/summary", authMiddleware, labScopeMiddleware, notForStaffLogin, gate, (req: any, res: any) => {
    const d = templateData(sqlite(), req.scope.labId, labToday());
    res.json({ people: d.people, methods: d.rows.length, peopleListed: new Set(d.rows.map((r) => r.staffEmployeeId)).size, peopleWithoutMethods: d.peopleWithoutMethods });
  });

  app.get("/api/labs/:labId/competency/method-history/template.xlsx", authMiddleware, labScopeMiddleware, notForStaffLogin, gate, async (req: any, res: any) => {
    try {
      const today = labToday();
      const lab = sqlite().prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
      const buf = await buildMethodHistoryWorkbook({ labName: lab?.lab_name || "", cliaNumber: lab?.clia_number || null }, templateData(sqlite(), req.scope.labId, today), today);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="VeritaComp_Past_Competency_Dates.xlsx"`);
      res.send(buf);
    } catch (err: any) {
      console.error("[competency/method-history/template] error:", err);
      res.status(500).json({ error: "Could not build the template" });
    }
  });

  const readUpload = async (req: any, today: string) => {
    const parsed = await parseMethodHistoryWorkbook(req.file.buffer);
    if (parsed.fatal) return { fatal: parsed.fatal };
    return { rows: checkRows(sqlite(), req.scope.labId, parsed.rows, today), blank: parsed.blank };
  };
  const counts = (rows: CheckedRow[], blank: number) => ({
    total: rows.length, ok: rows.filter((r) => r.status === "ok").length, warning: rows.filter((r) => r.status === "warning").length,
    error: rows.filter((r) => r.status === "error").length, skip: rows.filter((r) => r.status === "skip").length, blank,
  });

  app.post("/api/labs/:labId/competency/method-history/preview", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritacomp"), gate, upload, async (req: any, res: any) => {
    try {
      const today = labToday();
      const read = await readUpload(req, today);
      if (read.fatal) return res.status(400).json({ fatal: read.fatal });
      previewRows(sqlite(), req.scope.labId, read.rows!, today);
      const schedules = summarizeScheduleResults(applyImportedSchedules(sqlite(), scheduleInput(read.rows!) as any, { dryRun: true, labId: req.scope.labId }));
      res.json({ rows: read.rows!.map(({ memberIds, ...r }) => r), summary: counts(read.rows!, read.blank!), schedules });
    } catch (err: any) {
      console.error("[competency/method-history/preview] error:", err);
      res.status(500).json({ error: "Could not read this file" });
    }
  });

  app.post("/api/labs/:labId/competency/method-history/commit", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritacomp"), gate, upload, async (req: any, res: any) => {
    try {
      const today = labToday();
      const labId = req.scope.labId;
      const read = await readUpload(req, today);
      if (read.fatal) return res.status(400).json({ fatal: read.fatal });
      const errors = read.rows!.filter((r) => r.status === "error");
      if (errors.length) return res.status(400).json({ error: "validation_errors", message: `${errors.length} row(s) need fixing. Nothing was saved.`, errorRows: errors.map((r) => ({ rowNumber: r.rowNumber, issues: r.issues })) });
      const ownerUserId = req.scope.lab?.owner_user_id ?? req.userId;
      let imported = 0;
      let schedules: ReturnType<typeof applyImportedSchedules> = [];
      sqlite().transaction(() => {
        imported = insertHistory(sqlite(), labId, req.userId ?? null, read.rows!, new Date().toISOString());
        schedules = applyImportedSchedules(sqlite(), scheduleInput(read.rows!) as any, { dryRun: false, labId });
      })();
      logAudit({
        userId: req.userId, ownerUserId, module: "veritacomp", action: "create", entityType: "method_history_import", entityId: String(labId),
        entityLabel: `Past competency dates (${imported} loaded)`, before: null,
        after: { loaded: imported, rows: read.rows!.filter((r) => r.status === "ok" || r.status === "warning").map((r) => ({ staff_employee_id: r.staffEmployeeId, method_id: r.methodId, milestone: r.milestone, date: r.date, evaluator: r.evaluator })) },
        ipAddress: req.ip,
      });
      for (const s of schedules) {
        if (!s.after || !Object.keys(s.after).length) continue;
        logAudit({ userId: req.userId, ownerUserId, module: "veritastaff", action: s.created ? "create" : "update", entityType: "competency_schedule", entityId: s.staffEmployeeId, entityLabel: `${s.name} (from past competency dates)`, before: s.before, after: s.after, ipAddress: req.ip });
      }
      res.json({ ok: true, imported, skipped: read.rows!.filter((r) => r.status === "skip").length, schedules: summarizeScheduleResults(schedules) });
    } catch (err: any) {
      console.error("[competency/method-history/commit] error:", err);
      res.status(500).json({ error: "Could not save these dates" });
    }
  });

  // Take back a date loaded by mistake. The row is kept and marked removed, so the record of what was loaded stays.
  app.delete("/api/labs/:labId/competency/method-history/:id", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritacomp"), gate, (req: any, res: any) => {
    const id = Number(req.params.id);
    const row = sqlite().prepare("SELECT * FROM competency_method_history WHERE id = ? AND lab_id = ? AND removed_at IS NULL").get(id, req.scope.labId) as any;
    if (!row) return res.status(404).json({ error: "Not found" });
    const lead = row.group_history_id ?? row.id;
    const now = new Date().toISOString();
    sqlite().prepare("UPDATE competency_method_history SET removed_at = ?, removed_by_user_id = ? WHERE lab_id = ? AND removed_at IS NULL AND (id = ? OR group_history_id = ?)").run(now, req.userId ?? null, req.scope.labId, lead, lead);
    logAudit({
      userId: req.userId, ownerUserId: req.scope.lab?.owner_user_id ?? req.userId, module: "veritacomp", action: "delete", entityType: "method_history", entityId: String(lead),
      entityLabel: `Past competency date removed (${row.completed_date})`, before: { staff_employee_id: row.staff_employee_id, instrument_id: row.instrument_id, milestone: row.milestone, completed_date: row.completed_date, evaluator_name: row.evaluator_name }, after: null, ipAddress: req.ip,
    });
    res.json({ ok: true, on: labLocalDate(now) });
  });
}
