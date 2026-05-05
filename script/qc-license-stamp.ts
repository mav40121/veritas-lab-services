// Local QC script for the license-stamp work. Builds a representative
// stamped artefact for each of the 9 generator paths the task identifies and
// writes them to /home/user/workspace/license-stamp-qc/. Open each in a
// viewer and confirm: (a) footer band on every page, (b) Copyright + License
// Terms section visible (PDF appendix or XLSX About sheet), (c) author
// metadata set, (d) no overlap with existing layout.
//
// Run with: npx tsx script/qc-license-stamp.ts
//
// Skips paths that require a database (VeritaPolicy, VeritaTrack) or live
// session data; for those, use the dev server.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "/home/user/workspace/license-stamp-qc";
const ctx = {
  licensee: "Riverside Regional Medical Center",
  email: "director@riverside.example",
  plan: "hospital",
  issueDate: "2026-05-05",
};

async function qcClientPdf() {
  const { default: jsPDF } = await import("jspdf");
  const { applyLicenseToPdf } = await import("../client/src/lib/licenseStamp");
  const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  doc.setFontSize(20);
  doc.text("VeritaCheck Client PDF Sample", 20, 30);
  doc.setFontSize(11);
  doc.text("This page exercises client/src/lib/pdfGenerator.ts.", 20, 45);
  doc.text("Original layout content occupies the rest of this page,", 20, 53);
  doc.text("with the license footer band painted at the bottom edge.", 20, 61);
  doc.addPage();
  doc.setFontSize(16);
  doc.text("Page 2 of the underlying study report", 20, 30);
  doc.text("(The license appendix is appended after this page.)", 20, 50);
  applyLicenseToPdf(doc, ctx);
  const buf = doc.output("arraybuffer");
  writeFileSync(join(OUT_DIR, "veritacheck_client_post_stamp.pdf"), Buffer.from(buf));
  console.log("wrote veritacheck_client_post_stamp.pdf");
}

async function qcServerPdf() {
  const { generatePDFBuffer } = await import("../server/pdfReport");
  const sample = {
    id: 1,
    studyType: "cal_ver",
    testName: "Glucose",
    instrument: "Roche cobas c513",
    date: "2026-05-05",
    notes: "QC sample",
    units: "mg/dL",
    teaPercent: 6,
    teaAbsolute: null,
    operator: "QC",
    accreditationBodies: ["TJC"],
    levels: 5,
    replicates: 2,
    targets: [50, 100, 200, 300, 400],
    measurements: [
      [50.5, 49.8], [101.3, 100.1], [199.7, 200.2], [300.9, 301.4], [401.0, 399.6],
    ],
    instrumentMeta: '{"0":{"model":"Roche cobas c513","nickname":"Main","sn":"X-1"}}',
  } as any;
  const results = {
    type: "cal_ver",
    overallPass: true,
    levels: 5,
    replicates: 2,
    means: [50.15, 100.7, 199.95, 300.65, 400.3],
    biases: [0.30, 0.70, -0.025, 0.22, 0.075],
    summary: "All five measurements passed.",
    passCount: 5,
    totalCount: 5,
  };
  const buf = await generatePDFBuffer(sample, results, "22D0999999", ["TJC"], ctx);
  writeFileSync(join(OUT_DIR, "veritacheck_server_post_stamp.pdf"), buf);
  console.log("wrote veritacheck_server_post_stamp.pdf");
}

async function qcVeritaScanPdf() {
  const { generateVeritaScanPDF } = await import("../server/pdfReport");
  const data = {
    scanName: "Riverside Regional QC Scan",
    createdAt: "2026-05-01",
    updatedAt: "2026-05-05",
    cliaNumber: "22D0999999",
    items: [
      {
        id: 1, domain: "Pre-analytic", question: "Specimen labels checked at bedside?",
        tjc: "QSA.05.04.01", cap: "GEN.40450", cfr: "493.1241",
        aabb: "", cola: "",
        status: "pass", note: "Verified 2026-05-04",
      },
      {
        id: 2, domain: "Analytic", question: "Daily QC reviewed and accepted?",
        tjc: "QSA.05.10.01", cap: "GEN.20377", cfr: "493.1256",
        aabb: "", cola: "",
        status: "pass", note: "",
      },
    ] as any,
    preferredStandards: ["TJC"] as any,
  };
  const buf = await generateVeritaScanPDF(data, "executive", ctx);
  writeFileSync(join(OUT_DIR, "veritascan_post_stamp.pdf"), buf);
  console.log("wrote veritascan_post_stamp.pdf");
}

async function qcCompetencyPdf() {
  const { generateCompetencyPDF } = await import("../server/pdfReport");
  const buf = await generateCompetencyPDF({
    assessment: {
      id: 1, employee_name: "Sample Tech",
      employee_title: "MLS(ASCP)",
      assessment_date: "2026-05-05",
      assessment_year: 2026,
      assessment_type: "annual",
      complexity: "high",
      program_type: "technical",
      observer_initials: "AB",
      evaluator_initials: "CD",
      evaluator_title: "Technical Supervisor",
      method_groups: "Chemistry",
    } as any,
    items: [], methodGroups: [], checklistItems: [],
    labName: "Riverside Regional Medical Center",
    quizResults: [], cliaNumber: "22D0999999",
  } as any, ctx);
  writeFileSync(join(OUT_DIR, "veritacomp_post_stamp.pdf"), buf);
  console.log("wrote veritacomp_post_stamp.pdf");
}

async function qcCms209Pdf() {
  const { generateCMS209PDF } = await import("../server/pdfReport");
  const buf = await generateCMS209PDF({
    lab: { lab_name: "Riverside Regional Medical Center", clia_number: "22D0999999",
           lab_address_street: "100 Medical Center Drive", lab_address_city: "Riverside",
           lab_address_state: "CA", lab_address_zip: "92501" },
    employees: [
      { last_name: "Tech", first_name: "Sample", middle_initial: null,
        highest_complexity: "H", performs_testing: 1, qualifications_text: "MLS(ASCP)",
        roles: [{ role: "TP", specialty_number: null }] },
    ],
    specialties: { 7: "Chemistry", 8: "Hematology" },
  } as any, ctx);
  writeFileSync(join(OUT_DIR, "cms209_post_stamp.pdf"), buf);
  console.log("wrote cms209_post_stamp.pdf");
}

async function qcVeritaPtPdf() {
  const { generateVeritaPTPDF } = await import("../server/pdfReport");
  const buf = await generateVeritaPTPDF({
    labName: "Riverside Regional Medical Center",
    cliaNumber: "22D0999999",
    generatedAt: "May 5, 2026",
    summary: { totalEnrollments: 1, eventsThisYear: 1, passRate: 100, openCorrectiveActions: 0 },
    enrollments: [], events: [], correctiveActions: [],
  } as any, ctx);
  writeFileSync(join(OUT_DIR, "veritapt_post_stamp.pdf"), buf);
  console.log("wrote veritapt_post_stamp.pdf");
}

async function qcCumsumPdf() {
  const { generateCumsumPDF } = await import("../server/pdfReport");
  const tracker = { instrument_name: "Stago Compact Max", analyte: "Heparin Response" };
  const entries = [
    { year: 2026, old_lot_number: "L1", new_lot_number: "L2",
      old_lot_geomean: 90.1, new_lot_geomean: 91.0, difference: 0.9, cumsum: 0.9, verdict: "ACCEPT" },
  ];
  const buf = await generateCumsumPDF(tracker as any, entries as any, [], "22D0999999", "Riverside Regional Medical Center", ctx);
  writeFileSync(join(OUT_DIR, "veritacheck_cumsum_post_stamp.pdf"), buf);
  console.log("wrote veritacheck_cumsum_post_stamp.pdf");
}

async function qcExcelJs() {
  const { default: ExcelJS } = await import("exceljs");
  const { applyLicenseToExcelJS } = await import("../server/licenseStamp");
  const wb = new ExcelJS.Workbook();
  wb.creator = "QC";
  const ws = wb.addWorksheet("Data");
  ws.columns = [
    { header: "Analyte", key: "a", width: 18 },
    { header: "Mean", key: "m", width: 12 },
    { header: "Status", key: "s", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow(["Glucose", 100.4, "Pass"]);
  ws.addRow(["Sodium", 140.1, "Pass"]);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  applyLicenseToExcelJS(wb, ctx);
  const buf = await wb.xlsx.writeBuffer();
  writeFileSync(join(OUT_DIR, "exceljs_post_stamp.xlsx"), Buffer.from(buf as ArrayBuffer));
  console.log("wrote exceljs_post_stamp.xlsx");
}

async function main() {
  await qcClientPdf();
  await qcServerPdf();
  await qcVeritaScanPdf();
  await qcCompetencyPdf();
  await qcCms209Pdf();
  await qcVeritaPtPdf();
  await qcCumsumPdf();
  await qcExcelJs();
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
