// Client-side license stamp. The only live client use is the ExcelJS stamp on workbooks built in the browser
// (AdminReportPage). The jsPDF stamp (applyLicenseToPdf and its appendix page) was removed 2026-10-27 together with
// client/src/lib/pdfGenerator.ts, its only caller, which nothing in the app imported; licensed PDFs are stamped on
// the server (server/licenseStamp.ts).

export type { LicenseContext } from "@shared/licenseText";

// Re-export so client code can stamp ExcelJS workbooks built in the browser
// (e.g. AdminReportPage) without reaching into shared/.
export { applyLicenseToExcelJSWorkbook as applyLicenseToExcelJS } from "@shared/licenseExceljs";
