// server/competencyRegisterExcel.ts
//
// Testing Personnel Competency Register (Michael Q74 = 1, plan part C, 2026-10-11): "an excel download for all
// testing personnel that includes hire date, initial training/orientation completion date, initial comp date, etc."
// One row per active testing person with every competency date the lab has recorded, the server's own reading of
// what is next (the same walk the dashboard tile, owed list, reminders and compliance score use), and a second sheet
// of duty-change reevaluations. Follows the customer-facing workbook standard in CLAUDE.md §6 (About sheet first,
// lab identity in three layers, brand colors, protection). The row builder (buildCompetencyRegisterRows) is pure and
// exercised by scripts/verify-competency-register.ts.

import { deriveCompetencyStatus, patientTestingClearance } from "./competencyReminders";
import { addMonthsIso, isWaivedComplexity } from "./competencySchedule";

export interface RegisterEmployeeInput {
  id: number;
  first_name: string | null;
  last_name: string | null;
  middle_initial?: string | null;
  title?: string | null;
  highest_complexity?: string | null;
  hire_date?: string | null;
  created_at?: string | null;
  // staff_competency_schedules columns (null when the person has no schedule row)
  recorded_as?: string | null;
  training_completed_at?: string | null;
  training_documented_by?: string | null;
  training_record_url?: string | null;
  initial_completed_at?: string | null;
  initial_signed_by?: string | null;
  six_month_due_at?: string | null;
  six_month_completed_at?: string | null;
  six_month_signed_by?: string | null;
  first_annual_due_at?: string | null;
  first_annual_completed_at?: string | null;
  first_annual_signed_by?: string | null;
  annual_due_at?: string | null;
  last_annual_completed_at?: string | null;
  last_annual_signed_by?: string | null;
}

export interface RegisterEventInput {
  employee_id: number;
  test_system: string;
  detected_at: string;
  resolved_at?: string | null;
  resolution_type?: string | null;   // 'assessment' | 'not_a_change' | 'setup' | null (open)
  resolution_reason?: string | null;
  closed_by?: string | null;         // user who closed it as not a change, or the evaluator on the reassessment
}

export interface RegisterRow {
  name: string;
  title: string;
  complexity: string;
  hireDate: string | null;
  recordedAs: string;
  trainingCompleted: string | null;
  trainingBy: string;
  trainingUrl: string | null;
  initialCompleted: string | null;
  initialEvaluator: string;
  cleared: string;
  sixMonthDue: string | null;       // "N/A (waived)" for waived testers
  sixMonthCompleted: string | null;
  firstAnnualDue: string | null;    // "N/A (waived)" for waived testers
  firstAnnualCompleted: string | null;
  lastAnnualCompleted: string | null;
  nextAnnualDue: string | null;
  nextItem: string;
  nextDue: string | null;
  status: string;                   // Overdue | Not cleared | Due in 30 days | Due in 90 days | Compliant
  testSystems: string;
  openReevaluations: number;
}

export interface ReevaluationRow {
  name: string;
  testSystem: string;
  addedOn: string | null;
  status: string;                   // Open | Reevaluated | Closed: not a change
  closedOn: string | null;
  closedBy: string;
  note: string;
}

const ymd = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const m = String(s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const WAIVED_NA = "N/A (waived)";
const personName = (e: { first_name?: string | null; last_name?: string | null; middle_initial?: string | null }) =>
  `${e.last_name || ""}, ${e.first_name || ""}${e.middle_initial ? ` ${e.middle_initial}.` : ""}`.replace(/^, |, $/g, "").trim() || "(no name)";
const complexityLabel = (c?: string | null): string => {
  const s = String(c ?? "").trim().toUpperCase();
  if (s === "H" || s === "HIGH") return "High";
  if (s === "M" || s === "MODERATE") return "Moderate";
  if (s === "W" || s === "WAIVED") return "Waived";
  return c ? String(c) : "";
};

export function buildCompetencyRegisterRows(
  input: { employees: RegisterEmployeeInput[]; testSystems: Map<number, string[]>; events: RegisterEventInput[]; nys: boolean },
  today: Date,
): { personnel: RegisterRow[]; reevaluations: ReevaluationRow[] } {
  const openByEmp = new Map<number, number>();
  for (const ev of input.events) {
    if (!ev.resolved_at) openByEmp.set(ev.employee_id, (openByEmp.get(ev.employee_id) || 0) + 1);
  }
  const nameById = new Map<number, string>();
  const personnel: RegisterRow[] = input.employees.map((e) => {
    const name = personName(e);
    nameById.set(e.id, name);
    const waived = isWaivedComplexity(e.highest_complexity);
    const st = deriveCompetencyStatus(e, today);
    const clr = patientTestingClearance(e);
    const initial = ymd(e.initial_completed_at);
    // The 1st annual is due 12 months after the initial (the first year of patient testing). The stored column is
    // only filled once the 6-month is recorded, so the register figures it from the initial until then. NYS labs
    // run hire-anchored dates and keep the stored value.
    const firstAnnualDue = waived ? WAIVED_NA
      : ymd(e.first_annual_due_at) ?? (initial && !input.nys ? addMonthsIso(initial, 12) : null);
    let status: string;
    if (st.bucket === "overdue") status = "Overdue";
    else if (!clr.cleared) status = "Not cleared";
    else if (st.bucket === "dueSoon30") status = "Due in 30 days";
    else if (st.bucket === "dueSoon90") status = "Due in 90 days";
    else status = "Compliant";
    const recordedAs = e.recorded_as === "existing" ? "Existing staff" : e.recorded_as === "new_hire" ? "New hire" : "Not set";
    return {
      name,
      title: e.title || "",
      complexity: complexityLabel(e.highest_complexity),
      hireDate: ymd(e.hire_date),
      recordedAs,
      trainingCompleted: ymd(e.training_completed_at),
      trainingBy: e.training_documented_by || "",
      trainingUrl: e.training_record_url || null,
      initialCompleted: initial,
      initialEvaluator: e.initial_signed_by || "",
      cleared: clr.cleared ? (initial ? "Yes" : "Existing staff") : "No",
      sixMonthDue: waived ? WAIVED_NA : ymd(e.six_month_due_at),
      sixMonthCompleted: waived ? null : ymd(e.six_month_completed_at),
      firstAnnualDue,
      firstAnnualCompleted: waived ? null : ymd(e.first_annual_completed_at),
      lastAnnualCompleted: ymd(e.last_annual_completed_at),
      nextAnnualDue: ymd(e.annual_due_at),
      nextItem: st.reason || "",
      nextDue: st.nextDue,
      status,
      testSystems: (input.testSystems.get(e.id) || []).join("; "),
      openReevaluations: openByEmp.get(e.id) || 0,
    };
  });
  personnel.sort((a, b) => a.name.localeCompare(b.name));

  // Real duty changes only: items closed as "recorded at setup" were never a change in duties.
  const reevaluations: ReevaluationRow[] = input.events
    .filter((ev) => ev.resolution_type !== "setup" && nameById.has(ev.employee_id))
    .map((ev) => ({
      name: nameById.get(ev.employee_id)!,
      testSystem: ev.test_system,
      addedOn: ymd(ev.detected_at),
      status: !ev.resolved_at ? "Open" : ev.resolution_type === "not_a_change" ? "Closed: not a change" : "Reevaluated",
      closedOn: ymd(ev.resolved_at),
      closedBy: ev.closed_by || "",
      note: !ev.resolved_at
        ? "Added after setup: reevaluate before this person reports patient results on it."
        : ev.resolution_type === "not_a_change" ? (ev.resolution_reason || "") : "Reevaluated (competency assessment on file).",
    }))
    .sort((a, b) => (a.status === "Open" ? 0 : 1) - (b.status === "Open" ? 0 : 1) || a.name.localeCompare(b.name) || String(a.addedOn).localeCompare(String(b.addedOn)));
  return { personnel, reevaluations };
}

export async function generateCompetencyRegisterExcel(
  rows: { personnel: RegisterRow[]; reevaluations: ReevaluationRow[] },
  identity: { labName: string; cliaNumber: string },
  exportedOn: Date,
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = exportedOn;

  const teal = "FF01696F", tint = "FFE6F2F2", accent = "FF0A3A3D", ink = "FF28251D", alt = "FFEBF3F8";
  const green = "FF437A22", red = "FFA12C7B", amber = "FF964219", gray = "FF7A7974";
  const labName = identity.labName || "Laboratory";
  const cliaNumber = identity.cliaNumber || "Not on file";
  const idLine = `${labName}    CLIA: ${cliaNumber}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
  const border: any = { top: thin, bottom: thin, left: thin, right: thin };
  const lockedProtect: any = {
    selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false,
    sort: true, autoFilter: true, pivotTables: false,
  };
  const headerFooter = { oddHeader: `&R${idLine}`, oddFooter: `&L${idLine}&RPage &P of &N` };
  const toDate = (s: string | null): Date | null => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null);
  const mdy = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  // ── About (sheet 1) ──
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
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      about.getRow(r).height = 30;
    } else if (kind === "id" || kind === "h") {
      c.font = { name: "Calibri", bold: true, size: kind === "id" ? 11 : 12, color: { argb: accent } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tint } };
      about.getRow(r).height = 22;
    } else {
      c.font = { name: "Calibri", size: 11, color: { argb: ink } };
      about.getRow(r).height = Math.max(1, Math.ceil(text.length / 92)) * 16 + 4;
    }
    r += 1;
  };
  put("VeritaAssure® | Testing Personnel Competency Register", "title");
  put(`Prepared for: ${labName}    CLIA: ${cliaNumber}    Exported: ${mdy(exportedOn)}`, "id");
  put("This register lists every active testing person on the laboratory's VeritaStaff™ roster and the dates of each competency milestone the laboratory has recorded, with what is due next. It is the laboratory's own record, built from data entered in VeritaStaff™ and VeritaComp™. It is not a regulatory determination; the laboratory director or designee is responsible for its accuracy.", "p");
  put("How to use it", "h");
  put("Testing Personnel: one row per person. Hire date, whether the person was recorded as a new hire or as existing staff, orientation/training (date, who documented it, a link to the record), the initial competency and its evaluator, whether the person is cleared for patient testing, each due and completed date, what is due next, and the test systems assigned. Filter the Status column to see who is overdue or coming due.", "p");
  put("Duty-Change Reevaluations: each test system added to a person after their setup, whether they have been reevaluated on it, and items the laboratory closed as not a change with its reason.", "p");
  put("How the timing works", "h");
  put("1. Orientation and training are completed and documented before the initial competency.", "p");
  put("2. The initial competency is completed before the person tests patient specimens. There is no deadline from the hire date; the person does not test patients until it is done.", "p");
  put("3. The 6-month competency is due 6 months after the initial and the first annual 12 months after the initial, then annually. Year one therefore has three competencies. Waived testing: initial, then annually.", "p");
  put("4. When a test method or instrument is added to a person after their setup, they are reevaluated on it before reporting patient results on it.", "p");
  put("5. Staff recorded as existing staff were testing before these records. Their schedule runs from the most recent competency the laboratory entered, and their test systems at setup are existing duties, not duty changes.", "p");
  put("Sources", "h");
  put("42 CFR §493.1445(e)(12) (high complexity) and §493.1407(e)(11) (moderate complexity): \"Ensure that prior to testing patients' specimens, all personnel have the appropriate education and experience, receive the appropriate training for the type and complexity of the services offered, and have demonstrated that they can perform all testing operations reliably to provide and report accurate results\".", "p");
  put("42 CFR §493.1451(b)(9) (high complexity) and §493.1413(b)(9) (moderate complexity): competency is evaluated \"at least semiannually during the first year the individual tests patient specimens. Thereafter, evaluations must be performed at least annually unless test methodology or instrumentation changes, in which case, prior to reporting patient test results, the individual's performance must be reevaluated to include the use of the new test methodology or instrumentation.\"", "p");
  put("The Joint Commission: HR.01.04.01 (orientation and initial competency before patient testing) and HR.01.06.01 (competency assessment: semiannual in the first year, annual thereafter). Cited by number; see the current TJC standard for the text.", "p");
  put("Coverage gaps", "h");
  put("Dates appear only where the laboratory recorded them; a blank cell means not recorded, not not done. Status and next due come from the same rules the VeritaAssure® dashboard uses. To report a problem or a missing field, write info@veritaslabservices.com.", "p");
  await about.protect(exportPwd, { ...lockedProtect, sort: false, autoFilter: false, selectLockedCells: false, selectUnlockedCells: false });

  const styleHeader = (ws: any, headers: string[], widths: number[]) => {
    ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }));
    const hr = ws.getRow(1);
    hr.height = 46;
    hr.eachCell((c: any) => {
      c.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
      c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      c.border = border;
    });
  };
  const styleBody = (ws: any, nCols: number, dateCols: number[], statusCol: number, statusColor: (v: string) => string) => {
    for (let i = 2; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      for (let c = 1; c <= nCols; c++) {
        const cell = row.getCell(c);
        cell.font = { name: "Calibri", size: 10, color: { argb: ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = border;
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: alt } };
        if (dateCols.includes(c) && cell.value instanceof Date) cell.numFmt = "mm/dd/yyyy";
        if (cell.value === WAIVED_NA) cell.font = { name: "Calibri", size: 10, color: { argb: gray } };
      }
      const sc = row.getCell(statusCol);
      sc.font = { name: "Calibri", size: 10, bold: true, color: { argb: statusColor(String(sc.value ?? "")) } };
    }
  };

  // ── Testing Personnel ──
  // 22 columns: printed two pages wide with the header row and the name column repeated on each page.
  const ws = wb.addWorksheet("Testing Personnel", { headerFooter, views: [{ state: "frozen", xSplit: 1, ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 2, fitToHeight: 0, printTitlesRow: "1:1", printTitlesColumn: "A:A" } as any });
  const headers = ["Name", "Title", "Highest complexity", "Hire date", "Recorded as", "Orientation / training completed", "Training documented by", "Training record",
    "Initial competency", "Initial evaluator", "Cleared for patient testing", "6-month due", "6-month completed", "1st annual due", "1st annual completed",
    "Last annual completed", "Next annual due", "Next item", "Next due", "Status", "Test systems assigned", "Open reevaluations"];
  styleHeader(ws, headers, [24, 20, 11, 11, 13, 14, 22, 14, 12, 22, 14, 12, 12, 12, 12, 12, 12, 24, 11, 14, 40, 12]);
  for (const p of rows.personnel) {
    ws.addRow([p.name, p.title, p.complexity, toDate(p.hireDate), p.recordedAs, toDate(p.trainingCompleted), p.trainingBy || null,
      p.trainingUrl ? { text: "Open record", hyperlink: p.trainingUrl } : null,
      toDate(p.initialCompleted), p.initialEvaluator || null, p.cleared,
      p.sixMonthDue === WAIVED_NA ? WAIVED_NA : toDate(p.sixMonthDue), toDate(p.sixMonthCompleted),
      p.firstAnnualDue === WAIVED_NA ? WAIVED_NA : toDate(p.firstAnnualDue), toDate(p.firstAnnualCompleted),
      toDate(p.lastAnnualCompleted), toDate(p.nextAnnualDue), p.nextItem || null, toDate(p.nextDue), p.status, p.testSystems || null, p.openReevaluations]);
  }
  styleBody(ws, headers.length, [4, 6, 9, 12, 13, 14, 15, 16, 17, 19], 20, (v) =>
    v === "Compliant" ? green : v === "Overdue" ? red : v === "Not cleared" || v.startsWith("Due in") ? amber : gray);
  for (let i = 2; i <= ws.rowCount; i++) {
    const link = ws.getRow(i).getCell(8);
    if (link.value && typeof link.value === "object") link.font = { name: "Calibri", size: 10, color: { argb: teal }, underline: true };
  }
  if (rows.personnel.length === 0) {
    ws.getCell("A2").value = "No active testing personnel on the VeritaStaff roster.";
    ws.getCell("A2").font = { name: "Calibri", size: 10, italic: true, color: { argb: gray } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  await ws.protect(exportPwd, lockedProtect);

  // ── Duty-Change Reevaluations ──
  const dc = wb.addWorksheet("Duty-Change Reevaluations", { headerFooter, views: [{ state: "frozen", xSplit: 1, ySplit: 1 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  const dh = ["Name", "Test system added", "Added on", "Status", "Closed on", "Closed by", "Note"];
  styleHeader(dc, dh, [24, 44, 12, 20, 12, 24, 60]);
  for (const e of rows.reevaluations) {
    dc.addRow([e.name, e.testSystem, toDate(e.addedOn), e.status, toDate(e.closedOn), e.closedBy || null, e.note || null]);
  }
  styleBody(dc, dh.length, [3, 5], 4, (v) => (v === "Open" ? amber : v === "Reevaluated" ? green : gray));
  if (rows.reevaluations.length === 0) {
    dc.getCell("A2").value = "No test systems have been added to anyone after their setup.";
    dc.getCell("A2").font = { name: "Calibri", size: 10, italic: true, color: { argb: gray } };
  }
  dc.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: dh.length } };
  await dc.protect(exportPwd, lockedProtect);

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: "visible" } as any];
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
