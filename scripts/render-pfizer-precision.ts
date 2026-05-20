// Ad-hoc render (2026-05-20). Generates a VeritaCheck simple precision PDF
// against Pfizer's exact A-ALT dataset (35 replicates) so we can drop it
// alongside EE's report for a true side-by-side. Run from the repo root:
//
//   tsx scripts/render-pfizer-precision.ts
//
// Output: scripts/out/pfizer-A-ALT-veritacheck.pdf
//
// Independent of the Railway deploy — uses the local repo's calculator and
// PDF builder directly so we can ship the comparison without waiting on
// the deploy queue to clear.

import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import puppeteer from "puppeteer";
import { calculatePrecision, type PrecisionDataPoint } from "../client/src/lib/calculations";
import { buildPrecisionHTML } from "../server/pdfReport";

// ────────────────── Pfizer A-ALT dataset (from EE report) ──────────────────
const replicates = [
  21, 23, 22, 22, 22, 21, 23, 23, 21,
  21, 21, 21, 22, 21, 22, 22, 22, 21,
  23, 21, 22, 22, 21, 21, 22, 21, 22,
  19, 21, 20, 19, 21, 19, 19, 21,
];

const VENDOR_SD = 1.57;
const TARGET_MEAN = 23.6;
const TARGET_CV = 7.5;

// Acceptance criterion (CLIA TEa). ALT is in 42 CFR §493.931 Chemistry at
// 20% per the 2024 PT acceptance limit; using as the percent gate so the
// CLIA pass/fail still renders alongside the vendor verdict.
const CLIA_ALLOWABLE_ALT = 0.20; // 20%

const dataPoints: PrecisionDataPoint[] = [
  { level: 1, levelName: "Level 1", values: replicates },
];

const results = calculatePrecision(dataPoints, CLIA_ALLOWABLE_ALT, "simple", {
  vendorSD: VENDOR_SD,
  targetMean: TARGET_MEAN,
  targetCV: TARGET_CV,
});

// Synthesize the study row the PDF builder expects. Only fields buildPrecisionHTML
// reads need to be populated.
const study: any = {
  id: 99001,
  userId: 1,
  createdByUserId: 1,
  testName: "ALT",
  instrument: "Alinity c",
  analyst: "BW",
  date: "2024-10-16",
  studyType: "precision",
  cliaAllowableError: CLIA_ALLOWABLE_ALT,
  dataPoints: JSON.stringify(dataPoints),
  instruments: JSON.stringify(["Alinity c"]),
  status: results.overallPass ? "pass" : "fail",
  teaIsPercentage: 1,
  teaUnit: "%",
  cliaAbsoluteFloor: null,
  cliaAbsoluteUnit: null,
  instrumentMeta: null,
  vendorSd: VENDOR_SD,
  vendorSdConcentration: null,
  targetMean: TARGET_MEAN,
  targetCv: TARGET_CV,
  createdAt: "2024-10-16T00:00:00.000Z",
  // Optional hints buildPrecisionHTML / headerHTML read via (study as any):
  _labName: "Safefy Lab -- Pfizer",
  _cliaNumber: "Demo / Side-by-Side",
  _preferredStandards: ["CAP", "TJC"],
};

console.log("=== Computed results ===");
const r0: any = (results.levelResults as any[])[0];
console.log(`N                 : ${r0.n}`);
console.log(`Mean              : ${r0.mean.toFixed(2)}`);
console.log(`SD                : ${r0.sd.toFixed(2)}`);
console.log(`CV%               : ${r0.cv.toFixed(2)}`);
console.log(`95% CI for SD     : ${r0.sdCiLower?.toFixed(2)} to ${r0.sdCiUpper?.toFixed(2)}`);
console.log(`95% CI for Mean   : ${r0.meanCiLower?.toFixed(2)} to ${r0.meanCiUpper?.toFixed(2)}`);
console.log(`2 SD Range        : ${r0.twoSDRangeLower?.toFixed(2)} to ${r0.twoSDRangeUpper?.toFixed(2)}`);
console.log(`Vendor verdict    : ${r0.vendorVerdict}`);
console.log(`Bias              : ${r0.bias?.toFixed(2)}`);
console.log(`% Bias            : ${r0.percentBias?.toFixed(2)}%`);

const html = buildPrecisionHTML(study, results);
const outDir = resolve(process.cwd(), "scripts", "out");
mkdirSync(outDir, { recursive: true });
const htmlPath = resolve(outDir, "pfizer-A-ALT-veritacheck.html");
writeFileSync(htmlPath, html, "utf-8");
console.log(`\nHTML written to ${htmlPath}`);

(async () => {
  console.log("Launching puppeteer...");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    headless: true,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfPath = resolve(outDir, "pfizer-A-ALT-veritacheck.pdf");
  await page.pdf({
    path: pdfPath,
    format: "Letter",
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:7pt;width:100%;text-align:center;color:#646e78">
      VeritaCheck&trade; | Precision | Confidential - For Internal Lab Use Only | Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>`,
    margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
  });
  console.log(`PDF written to ${pdfPath}`);
  await browser.close();
})().catch(err => {
  console.error("PDF render failed:", err);
  process.exit(1);
});
