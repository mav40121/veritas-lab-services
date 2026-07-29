// server/coverageReport.ts
//
// LHF-2: one surveyor-ready Coverage Report from the whole-lab menu. Fuses three
// existing data sources, joined per analyte + instrument:
//   1. the whole-lab test menu (analyte / specialty / complexity / instrument /
//      last cal-ver / method-comp / precision dates)  -- buildLabwideData
//   2. VeritaCheck verification coverage (linearity covered/review/missing/exempt
//      and whether a method comparison is done)        -- computeCoverageForLab
//   3. PT-enrollment status per analyte                -- computePTCoverage
//
// The pure join (buildCoverageReportRows) is unit-tested by
// scripts/verify-coverage-report.js. The Excel builder follows the customer-facing
// workbook standard in CLAUDE.md (About sheet first, lab identity, brand colors,
// protection).

export interface CoverageReportRow {
  analyte: string;
  specialty: string;
  complexity: string;
  department: string;
  instrument: string;
  lastCalVer: string;
  lastMethodComp: string;
  lastPrecision: string;
  linearityStatus: string;   // Covered / Review / Missing / Not required
  methodCompStatus: string;  // Done / Needed / Not applicable
  ptStatus: string;          // Enrolled / Gap / Waived / Alt. assessment / Not regulated
}

type LabwideAnalyte = {
  analyte: string; specialty?: string | null; complexity?: string | null;
  department?: string | null; instrument?: string | null;
  last_cal_ver?: string | null; last_method_comp?: string | null; last_precision?: string | null;
};
type CovRow = { analyte: string; instrument: string; linearityStatus: string; };
type MethodCompRow = { analyte: string; hasStudy: boolean; };
type PtRow = { analyteName: string; status?: string | null };

const norm = (s: string | null | undefined) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const LINEARITY_LABEL: Record<string, string> = {
  covered: "Covered", review: "Review", missing: "Missing", exempt: "Not required",
};
const PT_LABEL: Record<string, string> = {
  enrolled: "Enrolled", covered: "Enrolled", gap: "Gap", missing: "Gap",
  waived: "Waived", aaa_covered: "Alt. assessment", unregulated: "Not regulated",
  unmatched: "Not regulated", recommended_gap: "Gap (recommended)",
};

export function buildCoverageReportRows(input: {
  analytes: LabwideAnalyte[];
  coverageRows: CovRow[];
  methodComparisons: MethodCompRow[];
  ptCoverage: PtRow[];
}): CoverageReportRow[] {
  const { analytes, coverageRows, methodComparisons, ptCoverage } = input;

  // Linearity status by analyte + instrument, then by analyte alone (fallback
  // when the menu instrument name and the study instrument name differ).
  const linByAnalyteInstr = new Map<string, string>();
  const linByAnalyte = new Map<string, string>();
  for (const r of coverageRows || []) {
    if (r.analyte && r.instrument) linByAnalyteInstr.set(`${norm(r.analyte)}|${norm(r.instrument)}`, r.linearityStatus);
    if (r.analyte && !linByAnalyte.has(norm(r.analyte))) linByAnalyte.set(norm(r.analyte), r.linearityStatus);
  }
  const mcByAnalyte = new Map<string, boolean>();
  for (const m of methodComparisons || []) {
    if (m.analyte) mcByAnalyte.set(norm(m.analyte), !!m.hasStudy);
  }
  const ptByAnalyte = new Map<string, string>();
  for (const p of ptCoverage || []) {
    if (p.analyteName) ptByAnalyte.set(norm(p.analyteName), String(p.status || ""));
  }

  return (analytes || []).map((a) => {
    const na = norm(a.analyte);
    const ni = norm(a.instrument);
    const lin = linByAnalyteInstr.get(`${na}|${ni}`) ?? linByAnalyte.get(na);
    const linearityStatus = lin ? (LINEARITY_LABEL[lin] || lin) : "Missing";
    const mc = mcByAnalyte.get(na);
    const methodCompStatus = mc === undefined ? "Not applicable" : (mc ? "Done" : "Needed");
    const ptRaw = ptByAnalyte.get(na);
    const ptStatus = ptRaw ? (PT_LABEL[ptRaw] || ptRaw) : "Not enrolled";
    return {
      analyte: a.analyte || "",
      specialty: a.specialty || "",
      complexity: a.complexity || "",
      department: a.department || "",
      instrument: a.instrument || "",
      lastCalVer: a.last_cal_ver || "",
      lastMethodComp: a.last_method_comp || "",
      lastPrecision: a.last_precision || "",
      linearityStatus,
      methodCompStatus,
      ptStatus,
    };
  });
}

export async function generateCoverageReportExcel(
  rows: CoverageReportRow[],
  identity: { labName: string; cliaNumber: string },
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Veritas Lab Services";
  wb.created = new Date();

  const teal = "FF01696F", tealLight = "FFE6F2F2", accent = "FF0A3A3D", ink = "FF28251D";
  const labName = identity.labName || "Laboratory";
  const cliaNumber = identity.cliaNumber || "Not on file";
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";

  // About sheet (sheet 1)
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const t = about.getCell("A1");
  t.value = "VeritaMap Coverage Report";
  t.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idc = about.getCell("A2");
  idc.value = `Prepared for: ${labName}    CLIA: ${cliaNumber}`;
  idc.font = { name: "Calibri", bold: true, size: 11, color: { argb: accent } };
  idc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealLight } };
  idc.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: accent } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tealLight } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: ink } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    about.getRow(r).height = Math.max(2, Math.ceil(String(text).length / 88)) * 16 + 4; r += 1;
  };
  const blank = () => { about.getRow(r).height = 8; r += 1; };
  section("About this report");
  body("This report lists every reportable analyte and instrument on the lab's test menu and shows, for each, its CLIA complexity, the dates of the last calibration verification, method comparison, and precision study, the current verification coverage status, and the proficiency testing status. It is a point-in-time snapshot the lab director can hand to a surveyor.");
  blank();
  section("How to read the coverage columns");
  body("Linearity: Covered means a calibration verification or linearity study is on file; Review means a study exists but needs attention; Missing means none is on file; Not required means the combination is exempt (three or more calibrators, not calibratable, CLIA-waived, or a documented reason). Method comparison: Done or Needed. PT status: Enrolled, Gap, Waived, Alt. assessment, or Not regulated. Statuses come from the live VeritaMap, VeritaCheck, and VeritaPT data at export time.");
  blank();
  section("Disclaimer");
  body("This is a snapshot, not an authoritative record. The live VeritaAssure modules are the audit-grade record. The lab director or designee is responsible for the disposition of any gap and for keeping the underlying data current.");
  blank();
  section("Coverage gaps and questions");
  body("Questions about this report: info@veritaslabservices.com.");
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false, formatCells: false,
    formatColumns: false, formatRows: false, insertRows: false, insertColumns: false,
    insertHyperlinks: false, deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // Coverage Report data sheet
  const sheet = wb.addWorksheet("Coverage Report", {
    headerFooter: {
      oddHeader: `&R${labName}    CLIA: ${cliaNumber}`,
      oddFooter: `&L${labName}    CLIA: ${cliaNumber}`,
    },
  });
  const headers = ["Analyte", "Specialty", "Complexity", "Department", "Instrument", "Last Cal Ver", "Last Method Comp", "Last Precision", "Linearity", "Method Comparison", "PT Status"];
  sheet.addRow(headers);
  const hr = sheet.getRow(1);
  hr.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
  hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: teal } };
  hr.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  hr.height = 22;
  for (const row of rows) {
    sheet.addRow([
      row.analyte, row.specialty, row.complexity, row.department, row.instrument,
      row.lastCalVer, row.lastMethodComp, row.lastPrecision,
      row.linearityStatus, row.methodCompStatus, row.ptStatus,
    ]);
  }
  const widths = [30, 20, 12, 16, 24, 14, 16, 14, 12, 18, 16];
  widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
