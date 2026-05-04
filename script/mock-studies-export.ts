// Mock VeritaCheck Studies Summary workbook generator.
// Uses the same ExcelJS template as the live /api/my-studies/export route,
// but feeds synthetic-but-realistic studies data so the user can approve the
// layout, color, and copy BEFORE we deploy and wire up the client button.
//
// Run: npx tsx script/mock-studies-export.ts
// Output: /tmp/VeritaCheck_Studies_MOCK.xlsx

import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

// ── Synthetic account ──
const labName = "Veritas Demonstration Laboratory";
const cliaNumber = "99D9999999";

// ── Synthetic studies (mirrors what verilabguy@gmail.com's account would
// look like with a varied mix of study types, instruments, and verdicts) ──
const studies = [
  {
    id: 1042,
    date: "2026-04-22",
    testName: "Glucose",
    studyType: "cal_ver",
    instrument: "Roche cobas c702",
    n: 5,
    teaIsPercentage: 1,
    cliaAllowableError: 0.08,
    cliaAbsoluteFloor: 6,
    cliaAbsoluteUnit: "mg/dL",
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1041,
    date: "2026-04-19",
    testName: "Sodium",
    studyType: "method_comparison",
    instrument: "Roche cobas c702 vs. Abbott Alinity c",
    n: 40,
    teaIsPercentage: 0,
    cliaAllowableError: 4,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: "mmol/L",
    status: "pass",
  },
  {
    id: 1040,
    date: "2026-04-15",
    testName: "Potassium",
    studyType: "precision",
    instrument: "Abbott Alinity c",
    n: 20,
    teaIsPercentage: 1,
    cliaAllowableError: 0.055,
    cliaAbsoluteFloor: 0.2,
    cliaAbsoluteUnit: "mmol/L",
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1039,
    date: "2026-04-10",
    testName: "Hemoglobin A1c",
    studyType: "cal_ver",
    instrument: "Bio-Rad D-100",
    n: 5,
    teaIsPercentage: 1,
    cliaAllowableError: 0.05,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "fail",
  },
  {
    id: 1038,
    date: "2026-04-08",
    testName: "Prothrombin Time",
    studyType: "pt_coag",
    instrument: "Stago STA-R Max",
    n: 30,
    teaIsPercentage: 1,
    cliaAllowableError: 0.15,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1037,
    date: "2026-04-05",
    testName: "TSH",
    studyType: "ref_interval",
    instrument: "Beckman DxI 800",
    n: 20,
    teaIsPercentage: 1,
    cliaAllowableError: 0.20,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1036,
    date: "2026-04-02",
    testName: "Creatinine",
    studyType: "lot_to_lot",
    instrument: "Roche cobas c702",
    n: 20,
    teaIsPercentage: 1,
    cliaAllowableError: 0.08,
    cliaAbsoluteFloor: 0.2,
    cliaAbsoluteUnit: "mg/dL",
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1035,
    date: "2026-03-28",
    testName: "ALT",
    studyType: "cal_ver",
    instrument: "Abbott Alinity c",
    n: 5,
    teaIsPercentage: 1,
    cliaAllowableError: 0.20,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "pass",
  },
  {
    id: 1034,
    date: "2026-03-22",
    testName: "Magnesium",
    studyType: "qc_range",
    instrument: "Roche cobas c702",
    n: 20,
    teaIsPercentage: 1,
    cliaAllowableError: 0.25,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "fail",
  },
  {
    id: 1033,
    date: "2026-03-18",
    testName: "Total Protein",
    studyType: "precision",
    instrument: "Roche cobas c702",
    n: 20,
    teaIsPercentage: 1,
    cliaAllowableError: 0.10,
    cliaAbsoluteFloor: null,
    cliaAbsoluteUnit: null,
    teaUnit: null,
    status: "pass",
  },
];

// ── Same helpers as the live route ──
function studyTypeLabel(st: string): string {
  switch (st) {
    case "cal_ver": return "Calibration Verification / Linearity";
    case "method_comparison":
    case "correlation": return "Correlation / Method Comparison";
    case "precision": return "Precision (EP15)";
    case "ref_interval": return "Reference Interval Verification";
    case "pt_coag": return "PT/Coag New Lot Validation";
    case "lot_to_lot": return "Lot-to-Lot Verification";
    case "qc_range": return "QC Range";
    case "multi_analyte_coag": return "Multi-Analyte Lot Comparison";
    case "cumsum": return "CUMSUM";
    default: return st;
  }
}

function teaApplied(s: any): string {
  const isPercent = s.teaIsPercentage !== 0;
  const tea = s.cliaAllowableError;
  if (isPercent) {
    const pct = (tea * 100).toFixed(1);
    if (s.cliaAbsoluteFloor != null && s.cliaAbsoluteUnit) {
      return `\u00B1${pct}% or ${s.cliaAbsoluteFloor} ${s.cliaAbsoluteUnit} (greater)`;
    }
    return `\u00B1${pct}%`;
  }
  const unit = s.teaUnit || "";
  return `\u00B1${tea} ${unit}`.trim();
}

function verdictLabel(s: any): string {
  const st = (s.status || "").toLowerCase();
  if (st === "pass") return "Pass";
  if (st === "fail") return "Fail";
  if (st === "completed") return "Completed";
  return s.status || "";
}

const reportLink = (s: any) => `https://www.veritaslabservices.com/study/${s.id}/results`;

async function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = new Date();

  // ===== About sheet (sheet 1) =====
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const aboutBorder: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const aboutTitle = about.getCell("A1");
  aboutTitle.value = "VeritaCheck Studies Summary (MOCK)";
  aboutTitle.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  aboutTitle.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  aboutTitle.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const aboutIdentity = about.getCell("A2");
  aboutIdentity.value = `MOCK DATA \u2014 Prepared for: ${labName} (synthetic)    CLIA: ${cliaNumber} (synthetic)`;
  aboutIdentity.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFA12C7B" } };
  aboutIdentity.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  aboutIdentity.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  aboutIdentity.border = aboutBorder;
  about.getRow(2).height = 24;
  let aboutRow = 3;
  const aboutSection = (text: string) => {
    const c = about.getCell(`A${aboutRow}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = aboutBorder;
    about.getRow(aboutRow).height = 22; aboutRow += 1;
  };
  const aboutBody = (text: string) => {
    const c = about.getCell(`A${aboutRow}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = aboutBorder;
    const estLines = Math.max(1, Math.floor(text.length / 100) + 1);
    about.getRow(aboutRow).height = Math.max(20, estLines * 16); aboutRow += 1;
  };
  const aboutBlank = () => { about.getRow(aboutRow).height = 8; aboutRow += 1; };
  aboutSection("MOCK / DEMO WORKBOOK \u2014 NOT REAL DATA");
  aboutBody("This workbook is a MOCK generated by script/mock-studies-export.ts so the team can preview the layout, color, and copy of the live VeritaCheck Studies Summary export before the production button is wired up. Every study, instrument, analyte, lab name, and CLIA number on this sheet is synthetic. Do not file, distribute, or treat any row as a real laboratory record.");
  aboutBlank();
  aboutSection("About this product (when run for real)");
  aboutBody("In production, this workbook is the VeritaCheck Studies Summary \u2014 a single-sheet roll-up of every validation, verification, and ongoing-monitoring study the laboratory has run in VeritaCheck. Each row is one study (calibration verification, method comparison, precision, reference interval, PT/coag, lot-to-lot, QC range, multi-analyte coag, CUMSUM) with the analyte, instrument, sample size N, the Total Allowable Error rule applied, the Pass/Fail/Completed verdict, and a hyperlink to the full per-study PDF report on veritaslabservices.com.");
  aboutBlank();
  aboutSection("How to use this workbook");
  aboutBody("The Studies tab is sorted newest-to-oldest. Filter the Verdict column to surface failing studies first, or filter Study Type to look at only one validation lane. The TEa Applied column shows the actual rule used (percentage, absolute, or 'percentage or absolute floor (greater)') so a reviewer can see at a glance how strict the acceptance criterion was. The Report Link column opens the per-study PDF, which is the audit-grade record. Freeze pane keeps the Study # column and the title/header rows visible while you scroll.");
  aboutBlank();
  aboutSection("Disclaimer");
  aboutBody("This workbook is an operational summary, not an audit-grade validation record, not a regulatory submission, and not a substitute for the per-study PDF. The per-study PDF (linked in the Report Link column) is the audit-grade documentation, signed off by the lab director, and is what should be presented to CLIA, CAP, TJC, AABB, or state inspectors; if there is a conflict between this summary and the underlying PDF, the PDF governs. The TEa rule shown reflects what was selected at the time of the study; CLIA, CAP, and other source rules may have changed since. Verdicts (Pass/Fail) reflect mechanical comparison of measured performance to the selected TEa rule and N \u2014 they do not represent VeritaAssure's certification of validation, fitness for clinical use, or readiness for inspection. The lab director is responsible for accepting or rejecting any study and for clinical-use decisions. VeritaAssure does not perform validation on the lab's behalf, does not file with any accrediting body, and does not warrant that completing studies in VeritaCheck satisfies any specific accreditation standard.");
  aboutBlank();
  aboutSection("Lab identity (synthetic)");
  aboutBody(`This MOCK workbook was prepared for ${labName} (synthetic) with CLIA ${cliaNumber} (synthetic). When generated by the live route, the lab name and CLIA come from the authenticated user's account profile. The lab name and CLIA appear on every printed page header and footer.`);
  aboutBlank();
  aboutSection("Coverage gaps");
  aboutBody("If your laboratory needs additional columns in this summary \u2014 for example, lab director sign-off date, instrument serial number, lot numbers, or analyst initials \u2014 please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
  about.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaCheck Studies Summary (MOCK)&R&"Calibri,Regular"&10${labName} (synthetic)    CLIA: ${cliaNumber} (synthetic)`;
  about.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName} (synthetic)    CLIA: ${cliaNumber} (synthetic)&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure \u2014 MOCK`;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  const ws = wb.addWorksheet("Studies");

  // Title block (rows 1-3)
  ws.mergeCells("A1:I1");
  ws.getCell("A1").value = `VeritaCheck\u2122 Studies Summary: ${labName}`;
  ws.getCell("A1").font = { name: "Calibri", bold: true, size: 14, color: { argb: "FF01696F" } };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  ws.getRow(1).height = 22;

  ws.mergeCells("A2:I2");
  const exportDate = new Date().toISOString().split("T")[0];
  ws.getCell("A2").value = `CLIA: ${cliaNumber}    \u2022    Exported: ${exportDate}    \u2022    ${studies.length} stud${studies.length === 1 ? "y" : "ies"}`;
  ws.getCell("A2").font = { name: "Calibri", italic: true, size: 10, color: { argb: "FF7A7974" } };
  ws.getCell("A2").alignment = { vertical: "middle", horizontal: "left" };

  ws.mergeCells("A3:I3");
  ws.getCell("A3").value = "Operational summary, not for regulatory submission. See per-study PDFs for audit-grade documentation.";
  ws.getCell("A3").font = { name: "Calibri", italic: true, size: 9, color: { argb: "FF7A7974" } };
  ws.getCell("A3").alignment = { vertical: "middle", horizontal: "left" };

  // Header row (row 4)
  const headers = ["Study #", "Date", "Analyte", "Study Type", "Instrument(s)", "N", "TEa Applied", "Verdict", "Report Link"];
  const colWidths = [10, 12, 28, 32, 36, 6, 28, 12, 56];
  const headerRow = ws.getRow(4);
  headers.forEach((h, i) => { headerRow.getCell(i + 1).value = h; });
  ws.columns = headers.map((_, i) => ({ width: colWidths[i] }));
  headerRow.height = 20;

  const thinBorder: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };

  headerRow.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = thinBorder;
  });

  // Data rows
  studies.forEach((s, idx) => {
    const r = 5 + idx;
    const row = ws.getRow(r);
    row.getCell(1).value = s.id;
    row.getCell(2).value = s.date;
    row.getCell(3).value = s.testName;
    row.getCell(4).value = studyTypeLabel(s.studyType);
    row.getCell(5).value = s.instrument;
    row.getCell(6).value = s.n;
    row.getCell(7).value = teaApplied(s);
    row.getCell(8).value = verdictLabel(s);
    const link = reportLink(s);
    row.getCell(9).value = { text: "View Report", hyperlink: link };

    const isEvenRow = (r % 2) === 0;
    const bgColor = isEvenRow ? "FFEBF3F8" : "FFFFFFFF";

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = cell.font || { name: "Calibri", color: { argb: "FF28251D" }, size: 10 };
      if (!cell.font.name) cell.font = { ...cell.font, name: "Calibri", size: 10 };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = thinBorder;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };

      if (colNumber === 8) {
        const v = String(cell.value || "");
        if (v === "Pass") {
          cell.font = { name: "Calibri", bold: true, color: { argb: "FF437A22" }, size: 10 };
        } else if (v === "Fail") {
          cell.font = { name: "Calibri", bold: true, color: { argb: "FFA12C7B" }, size: 10 };
        } else {
          cell.font = { name: "Calibri", color: { argb: "FF7A7974" }, size: 10 };
        }
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }

      if (colNumber === 9) {
        cell.font = { name: "Calibri", color: { argb: "FF01696F" }, underline: true, size: 10 };
      }

      if (colNumber === 6) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }

      if (colNumber === 1 || colNumber === 2) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  ws.views = [{ state: "frozen" as const, xSplit: 1, ySplit: 4, topLeftCell: "B5" }];
  ws.autoFilter = { from: "A4", to: "I4" };

  const footerRowNum = 5 + studies.length + 1;
  ws.mergeCells(`A${footerRowNum}:I${footerRowNum}`);
  ws.getCell(`A${footerRowNum}`).value = "VeritaAssure\u2122 | VeritaCheck\u2122 | Confidential, For Internal Lab Use Only";
  ws.getCell(`A${footerRowNum}`).font = { name: "Calibri", italic: true, size: 8, color: { argb: "FF7A7974" } };
  ws.getCell(`A${footerRowNum}`).alignment = { vertical: "middle", horizontal: "center" };

  // Page-setup header/footer carry lab identity (synthetic) on every printed page.
  ws.headerFooter.oddHeader = `&L&"Calibri,Regular"&10VeritaCheck Studies Summary (MOCK)&R&"Calibri,Regular"&10${labName} (synthetic)    CLIA: ${cliaNumber} (synthetic)`;
  ws.headerFooter.oddFooter = `&L&"Calibri,Regular"&9${labName} (synthetic)    CLIA: ${cliaNumber} (synthetic)&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure \u2014 MOCK`;

  await ws.protect(exportPwd, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  // Workbook opens to the About sheet (sheet 1, activeTab 0).
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000,
                firstSheet: 0, activeTab: 0, visibility: "visible" }];

  const buffer = await wb.xlsx.writeBuffer();
  const out = "/tmp/VeritaCheck_Studies_MOCK.xlsx";
  writeFileSync(out, Buffer.from(buffer as ArrayBuffer));
  console.log("Wrote:", out, "(", studies.length, "studies)");
}

main().catch((e) => { console.error(e); process.exit(1); });
