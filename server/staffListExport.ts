// VeritaStaff staff list download (Heywood, Ancel Nelson 2026-11-13: "Other than the C209 form is there any way to
// print an employee list"). GET /api/labs/:labId/staff/employees/export.xlsx in routes.ts calls these. The rows are
// the Staff tab's: the lab's active roster (tier2_lab_id = the lab, status 'active'), ordered last name then first,
// with each person's CLIA roles, complexity and the same competency badge (shared/staffListLabels.ts). The workbook
// is customer-facing (CLAUDE.md section 6): About first, the lab's name and CLIA in every page header and footer,
// sheets protected, laid out to print landscape one page wide with the headings on every page.

import { competencyView, labMethodClocks } from "./competencyReminders";
import { competencyBadgeLabel, complexityLabel, formatStaffRoles, type CompetencyBadgeLabel } from "../shared/staffListLabels";

export interface StaffListRow {
  last_name: string;
  first_name: string;
  middle_initial: string;
  title: string;
  roles: string;
  complexity: string;
  performs_testing: boolean;
  competency: CompetencyBadgeLabel | "";
  next_due: string;
  hire_date: string;
}

export const STAFF_LIST_COLUMNS: Array<[string, number]> = [
  ["Last Name", 18], ["First Name", 16], ["MI", 5], ["Title", 30], ["CLIA Roles", 34],
  ["Highest Complexity", 13], ["Performs Testing", 10], ["Competency", 13], ["Next Competency Due", 18], ["Hire Date", 12],
];

/** The lab's active roster as the Staff tab lists it. */
export function staffListRows(sqlite: any, labId: number, specialtyName: (n: number) => string | undefined): StaffListRow[] {
  const employees = sqlite.prepare(
    "SELECT * FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' ORDER BY last_name, first_name"
  ).all(labId) as any[];
  const clocks = labMethodClocks(sqlite, labId);
  const rolesOf = sqlite.prepare("SELECT role, specialty_number, all_specialties FROM staff_roles WHERE employee_id = ? ORDER BY id");
  const scheduleOf = sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?");
  return employees.map((emp) => {
    const schedule = scheduleOf.get(emp.id);
    const view = competencyView(emp, schedule, clocks.get(emp.id));
    const tests = emp.performs_testing === 1;
    return {
      last_name: emp.last_name ?? "",
      first_name: emp.first_name ?? "",
      middle_initial: emp.middle_initial ? String(emp.middle_initial).replace(/\.$/, "") : "",
      title: emp.title ?? "",
      roles: formatStaffRoles(rolesOf.all(emp.id) as any[], specialtyName),
      complexity: complexityLabel(emp.highest_complexity),
      performs_testing: tests,
      competency: tests ? competencyBadgeLabel(view.competencyStatus, !!view.competencySchedule) : "",
      next_due: tests ? view.competencyStatus?.nextDue ?? "" : "",
      hire_date: emp.hire_date ?? "",
    };
  });
}

// Header and footer codes treat & as a control character.
const hf = (s: string) => s.replace(/&/g, "&&");

export async function buildStaffListWorkbook(
  input: { labName: string; clia: string; today: string; rows: StaffListRow[] },
  applyLicense: (wb: any) => void,
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = new Date();
  const { labName, clia, today, rows } = input;
  const identity = `${labName}    CLIA: ${clia}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const border: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const header = `&L&"Calibri,Regular"&10VeritaStaff Staff List&R&"Calibri,Regular"&10${hf(identity)}`;
  const footer = `&L&"Calibri,Regular"&9${hf(identity)}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  // ===== About (sheet 1), written for this workbook =====
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaStaff™ Staff List";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idCell = about.getCell("A2");
  idCell.value = `Prepared for: ${identity}`;
  idCell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  idCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  idCell.border = border;
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = Math.max(20, (Math.floor(text.length / 100) + 1) * 16); r += 1;
  };
  const blank = () => { about.getRow(r).height = 8; r += 1; };
  const testers = rows.filter((x) => x.performs_testing).length;
  section("About this workbook");
  body("The Staff List sheet lists every active person on this laboratory's VeritaStaff roster, one row per person, as the Staff tab shows them: name, title, CLIA roles with their specialty, highest test complexity, whether the person performs testing, their competency status and next competency due date, and hire date. People marked inactive are not listed.");
  blank();
  section("What this export covers");
  body(`Active staff: ${rows.length} (${testers} perform testing). Exported ${today}.`);
  blank();
  section("How to use this workbook");
  body("Print the Staff List sheet: it prints landscape, one page wide, with the column headings repeated on every page. Filter CLIA Roles or Competency to answer a question about one role or status. Competency and Next Competency Due are shown only for people who perform testing, and read the same as the badges on the Staff tab on the day of export. The CMS 209 Laboratory Personnel Report remains the form for CMS; this list is for the laboratory's own use.");
  blank();
  section("Disclaimer");
  body("This workbook lists what is entered in VeritaStaff. It does not verify anyone's education, licenses, qualifications or competency; the laboratory's personnel records remain the source if they differ from this list. VeritaAssure does not certify regulatory compliance and does not advise on whether a given person meets a specific CLIA or accreditation requirement.");
  blank();
  section("Lab identity");
  body(`This workbook was prepared for ${labName} (CLIA ${clia}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  section("Coverage gaps");
  body("If your laboratory needs a column or view not represented here, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ===== Staff List =====
  const ws = wb.addWorksheet("Staff List");
  ws.columns = STAFF_LIST_COLUMNS.map(([h, w], i) => ({ header: h, key: `c${i}`, width: w }));
  const head = ws.getRow(1);
  head.height = 32; // two lines: "Highest Complexity", "Performs Testing" and "Next Competency Due" wrap (seen in the print)
  head.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });
  const GREEN = "FF437A22", RED = "FFA12C7B", AMBER = "FF964219", GRAY = "FF7A7974";
  const statusColor: Record<string, string> = { Current: GREEN, Overdue: RED, "Due Soon": AMBER, "Not cleared": AMBER, "Not set": GRAY };
  rows.forEach((row, i) => {
    const out = ws.addRow([
      row.last_name, row.first_name, row.middle_initial, row.title, row.roles,
      row.complexity, row.performs_testing ? "Yes" : "No", row.competency, row.next_due, row.hire_date,
    ]);
    const even = (i + 2) % 2 === 0;
    out.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFEBF3F8" : "FFFFFFFF" } };
      cell.border = border;
      if (col === 8 && row.competency && statusColor[row.competency]) {
        cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: statusColor[row.competency] } };
      }
    });
  });
  ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];
  ws.autoFilter = { from: "A1", to: ws.getCell(1, STAFF_LIST_COLUMNS.length).address };
  ws.pageSetup = {
    paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1",
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  } as any;
  ws.headerFooter.oddHeader = header;
  ws.headerFooter.oddFooter = footer;
  await ws.protect(exportPwd, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  applyLicense(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
