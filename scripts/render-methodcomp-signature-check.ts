// Local render check for the method-comparison page-1 signature regression.
// Reproduces the San Carlos troponin study shape (2 charts, long narrative,
// CFR box, SIGNED director block, 2 excluded points) and renders page 1 with
// the REAL puppeteer margins so we can confirm the signature lands on page 1.
// Run: npx tsx scripts/render-methodcomp-signature-check.ts
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import puppeteer from "puppeteer";
import { buildMethodCompHTML } from "../server/pdfReport";

const PRIMARY = "Clyde, Ortho VITROS 5600";
const COMP = "Bonnie, Ortho VITROS 5600";

// 6 included samples (from the real study's page 4 table)
const rows = [
  { level: 3, x: 0.251, y: 0.250, pct: -0.40 },
  { level: 4, x: 0.266, y: 0.273, pct: 2.63 },
  { level: 6, x: 10.400, y: 12.300, pct: 18.27 },
  { level: 7, x: 0.562, y: 0.534, pct: -4.98 },
  { level: 8, x: 11.500, y: 9.910, pct: -13.83 },
  { level: 9, x: 27.500, y: 26.700, pct: -2.91 },
];
const levelResults = rows.map(r => ({
  level: r.level, referenceValue: r.x,
  instruments: { [COMP]: { value: r.y, difference: r.y - r.x, pctDifference: r.pct, passFail: "pass" } },
}));

const results: any = {
  levelResults,
  regression: {
    [`${COMP} (Deming)`]: { slope: 0.9771, intercept: 0.1070, proportionalBias: -0.0229, r2: 0.9885, n: 6, see: 1.2525 },
    [`${COMP} (OLS)`]: { slope: 0.9716, intercept: 0.1532, proportionalBias: -0.0284, r2: 0.9885, n: 6, see: 1.2525, slopeLo: 0.826, slopeHi: 1.117, interceptLo: -1.720, interceptHi: 2.027 },
  },
  blandAltman: { [COMP]: { meanDiff: -0.0853, sdDiff: 1.1606, loa_upper: 2.1895, loa_lower: -2.3602, pctMeanDiff: -0.20 } },
  overallPass: true, passCount: 6, totalCount: 6,
  xRange: { min: 0.251, max: 27.500 },
  yRange: { [COMP]: { min: 0.250, max: 26.700 } },
  summary: "6 of 6 paired results were within TEa. The method comparison PASSED the adopted acceptance criterion.",
};

const dataPoints = [
  ...rows.map(r => ({ level: r.level, expectedValue: r.x, instrumentValues: { [COMP]: r.y }, excluded: false })),
  { level: 1, excluded: true, exclusion_reason: "Analyzer measurement is < 0.012 not 0.012", excluded_at: "2026-08-08" },
  { level: 2, excluded: true, exclusion_reason: "Analyzer measurement is < 0.012 not 0.012", excluded_at: "2026-08-08" },
];

const study: any = {
  id: 99123, userId: 1,
  testName: "TROPONIN-I (cardiac)",
  instrument: "Ortho VITROS 5600 (Clyde)",
  analyst: "RODRIGO GASPAR-TRILLO",
  date: "2026-07-22",
  studyType: "method_comparison",
  cliaAllowableError: 0.30,
  teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: "%", tea_unit: "%",
  cliaAbsoluteFloor: 0.9, clia_absolute_floor: 0.9, cliaAbsoluteUnit: "ng/mL", clia_absolute_unit: "ng/mL",
  dataPoints: JSON.stringify(dataPoints),
  instruments: JSON.stringify([PRIMARY, COMP]),
  status: "pass",
  lifecycle_state: "finalized",
  finalized_signature: "Chineme Swann, Laboratory Administrative Manager",
  finalized_at: "2026-08-07T12:00:00Z",
  _labName: "San Carlos Apache Healthcare Corporation",
  _cliaNumber: "03D0531813",
  _preferredStandards: ["TJC"],
};

// license banner line applyLicenseToPuppeteer prepends on the real PDF (adds ~1 line of page-1 height)
const banner = `<div style="font-size:6pt;color:#8a8a8a;text-align:center;padding:2px 0;">© 2026 Veritas Lab Services, LLC · Licensed to San Carlos Apache Healthcare Corporation (verilabguy@gmail.com) · Issued 2026-09-15 · Single-facility internal use only · Do not redistribute</div>`;
let html = buildMethodCompHTML(study, results);
html = html.replace("<body>", "<body>" + banner);

const outDir = resolve(process.cwd(), "scripts", "out");
mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"], headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  const pdfPath = resolve(outDir, "methodcomp-troponin-check.pdf");
  await page.pdf({
    path: pdfPath, format: "Letter", printBackground: true, displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:7pt;width:100%;text-align:center;color:#646e78">VeritaAssure&trade; | VeritaCheck&trade; | Confidential - For Internal Lab Use Only Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
  });
  // page-1 visual: render inside the real print margins at Letter width so the
  // screenshot approximates the printed page 1 (top 11in worth).
  await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 2 });
  await page.addStyleTag({ content: "body{padding:14mm 15mm 20mm 15mm;box-sizing:border-box;width:816px;}" });
  await page.screenshot({ path: resolve(outDir, "methodcomp-page1.png"), clip: { x: 0, y: 0, width: 816, height: 1056 } });
  await browser.close();
  console.log("WROTE", pdfPath);
})().catch(e => { console.error("render failed:", e); process.exit(1); });
