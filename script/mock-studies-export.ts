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

  const buffer = await wb.xlsx.writeBuffer();
  const out = "/tmp/VeritaCheck_Studies_MOCK.xlsx";
  writeFileSync(out, Buffer.from(buffer as ArrayBuffer));
  console.log("Wrote:", out, "(", studies.length, "studies)");
}

main().catch((e) => { console.error(e); process.exit(1); });
