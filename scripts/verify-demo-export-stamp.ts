// Receipt for the USON demo-export stamp (feat/demo-export-stamp).
//
// A lab flagged is_demo must add a sample-data mark to every export; a non-demo
// lab's export must be byte-for-byte the prior behavior (the flag is additive
// and default-false). This exercises BOTH branches of the shared PDF and Excel
// license-stamp helpers and asserts the mark appears iff isDemo. Exit non-zero
// on any failure. Run: npx tsx scripts/verify-demo-export-stamp.ts
import ExcelJS from "exceljs";
import {
  normalizeLicenseContext,
  SAMPLE_DATA_BANNER,
  SAMPLE_DATA_FOOTER,
  type LicenseContext,
} from "../shared/licenseText";
import {
  licenseHtmlBandTop,
  licenseAugmentedFooterTemplate,
  injectLicenseHtml,
} from "../server/licenseStamp";
import { applyLicenseToExcelJSWorkbook } from "../shared/licenseExceljs";

let failures = 0;
function ok(label: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}`);
  if (!cond) failures++;
}

const demoCtx: Partial<LicenseContext> = { licensee: "USON System Lab", email: "uson-demo@example.com", isDemo: true };
const realCtx: Partial<LicenseContext> = { licensee: "Riverside Regional", email: "rrmc@example.com", isDemo: false };

// 1. normalizeLicenseContext defaults isDemo to false when omitted.
ok("normalize: isDemo defaults false when omitted", normalizeLicenseContext({ licensee: "x", email: "y" }).isDemo === false);
ok("normalize: isDemo true passes through", normalizeLicenseContext(demoCtx).isDemo === true);

// 2. PDF top band: banner present iff isDemo.
ok("pdf band: demo shows sample banner", licenseHtmlBandTop(demoCtx).includes(SAMPLE_DATA_BANNER));
ok("pdf band: real omits sample banner", !licenseHtmlBandTop(realCtx).includes(SAMPLE_DATA_BANNER));

// 3. PDF footer template: footer mark present iff isDemo.
const baseFooter = `<div style="font-size:6px">VeritaAssure | VeritaCheck | Confidential</div>`;
ok("pdf footer: demo shows sample footer", licenseAugmentedFooterTemplate(baseFooter, demoCtx).includes(SAMPLE_DATA_FOOTER));
ok("pdf footer: real omits sample footer", !licenseAugmentedFooterTemplate(baseFooter, realCtx).includes(SAMPLE_DATA_FOOTER));
ok("pdf footer: base footer preserved (demo)", licenseAugmentedFooterTemplate(baseFooter, demoCtx).includes("VeritaCheck"));

// 4. injectLicenseHtml: body carries the banner iff isDemo.
const html = `<html><body><h1>Study</h1></body></html>`;
ok("pdf inject: demo body carries banner", injectLicenseHtml(html, demoCtx).includes(SAMPLE_DATA_BANNER));
ok("pdf inject: real body has no banner", !injectLicenseHtml(html, realCtx).includes(SAMPLE_DATA_BANNER));

// 5. Excel workbook: demo lab stamps row-1 band + About notice + footer.
async function excelChecks() {
  // Demo workbook.
  const wbDemo = new ExcelJS.Workbook();
  const wsD = wbDemo.addWorksheet("Data");
  wsD.getCell("A1").value = "Analyte";
  wsD.getCell("B1").value = "Result";
  applyLicenseToExcelJSWorkbook(wbDemo, demoCtx);
  const dataSheetD = wbDemo.getWorksheet("Data")!;
  const row1D = String(dataSheetD.getCell(1, 1).value || "");
  ok("excel demo: row 1 of sheet 1 is the sample-data band", row1D === SAMPLE_DATA_BANNER);
  const aboutD = wbDemo.getWorksheet("About")!;
  let aboutHasBanner = false;
  aboutD.eachRow((r) => { if (String(r.getCell(1).value || "").includes(SAMPLE_DATA_BANNER)) aboutHasBanner = true; });
  ok("excel demo: About sheet carries the sample-data notice", aboutHasBanner);
  ok("excel demo: footer carries the sample-data mark", String(dataSheetD.headerFooter?.oddFooter || "").includes(SAMPLE_DATA_FOOTER));

  // Real workbook: no sample-data mark anywhere.
  const wbReal = new ExcelJS.Workbook();
  const wsR = wbReal.addWorksheet("Data");
  wsR.getCell("A1").value = "Analyte";
  applyLicenseToExcelJSWorkbook(wbReal, realCtx);
  const dataSheetR = wbReal.getWorksheet("Data")!;
  const row1R = String(dataSheetR.getCell(1, 1).value || "");
  ok("excel real: row 1 is the license band, not the sample band", row1R !== SAMPLE_DATA_BANNER && row1R.includes("Licensed to"));
  const aboutR = wbReal.getWorksheet("About")!;
  let realHasBanner = false;
  aboutR.eachRow((r) => { if (String(r.getCell(1).value || "").includes(SAMPLE_DATA_BANNER)) realHasBanner = true; });
  ok("excel real: About sheet has no sample-data notice", !realHasBanner);
  ok("excel real: footer has no sample-data mark", !String(dataSheetR.headerFooter?.oddFooter || "").includes(SAMPLE_DATA_FOOTER));
}

await excelChecks();

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
