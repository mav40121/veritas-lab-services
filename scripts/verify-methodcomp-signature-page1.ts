// REGRESSION GUARD (Gate 3): the VeritaCheck method-comparison director
// signature block MUST render on page 1 (PDF rule 5). It regressed silently in
// Sep 2026 when cumulative page-1 growth (long narrative + the taller signed
// block) pushed the atomic signature block onto page 2. Nothing tested actual
// page placement, so it slipped through. This guard renders the worst realistic
// case (a signed, long-narrative troponin method comparison with excluded
// points) and asserts the signature block fits within page 1, with headroom so
// creeping growth is caught BEFORE it tips over.
//
// Run: npx tsx scripts/verify-methodcomp-signature-page1.ts   (exit 1 on FAIL)
import puppeteer from "puppeteer";
import { buildMethodCompHTML } from "../server/pdfReport";

const PRIMARY = "Clyde, Ortho VITROS 5600";
const COMP = "Bonnie, Ortho VITROS 5600";
const rows = [
  { level: 3, x: 0.251, y: 0.250, pct: -0.40 }, { level: 4, x: 0.266, y: 0.273, pct: 2.63 },
  { level: 6, x: 10.4, y: 12.3, pct: 18.27 }, { level: 7, x: 0.562, y: 0.534, pct: -4.98 },
  { level: 8, x: 11.5, y: 9.91, pct: -13.83 }, { level: 9, x: 27.5, y: 26.7, pct: -2.91 },
];
const levelResults = rows.map(r => ({ level: r.level, referenceValue: r.x, instruments: { [COMP]: { value: r.y, difference: r.y - r.x, pctDifference: r.pct, passFail: "pass" } } }));
const results: any = {
  levelResults,
  regression: {
    [`${COMP} (Deming)`]: { slope: 0.9771, intercept: 0.107, proportionalBias: -0.0229, r2: 0.9885, n: 6, see: 1.2525 },
    [`${COMP} (OLS)`]: { slope: 0.9716, intercept: 0.1532, proportionalBias: -0.0284, r2: 0.9885, n: 6, see: 1.2525, slopeLo: 0.826, slopeHi: 1.117, interceptLo: -1.72, interceptHi: 2.027 },
  },
  blandAltman: { [COMP]: { meanDiff: -0.0853, sdDiff: 1.1606, loa_upper: 2.1895, loa_lower: -2.3602, pctMeanDiff: -0.2 } },
  overallPass: true, passCount: 6, totalCount: 6,
  xRange: { min: 0.251, max: 27.5 }, yRange: { [COMP]: { min: 0.25, max: 26.7 } },
  summary: "6 of 6 paired results were within TEa. The method comparison PASSED the adopted acceptance criterion.",
};
const dataPoints = [
  ...rows.map(r => ({ level: r.level, expectedValue: r.x, instrumentValues: { [COMP]: r.y }, excluded: false })),
  { level: 1, excluded: true, exclusion_reason: "Analyzer measurement is < 0.012 not 0.012", excluded_at: "2026-08-08" },
  { level: 2, excluded: true, exclusion_reason: "Analyzer measurement is < 0.012 not 0.012", excluded_at: "2026-08-08" },
];
const study: any = {
  id: 99123, userId: 1, testName: "TROPONIN-I (cardiac)", instrument: "Ortho VITROS 5600 (Clyde)",
  analyst: "RODRIGO GASPAR-TRILLO", date: "2026-07-22", studyType: "method_comparison",
  cliaAllowableError: 0.3, teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: "%", tea_unit: "%",
  cliaAbsoluteFloor: 0.9, clia_absolute_floor: 0.9, cliaAbsoluteUnit: "ng/mL", clia_absolute_unit: "ng/mL",
  dataPoints: JSON.stringify(dataPoints), instruments: JSON.stringify([PRIMARY, COMP]), status: "pass",
  lifecycle_state: "finalized", finalized_signature: "Chineme Swann, Laboratory Administrative Manager",
  finalized_at: "2026-08-07T12:00:00Z", _labName: "San Carlos Apache Healthcare Corporation",
  _cliaNumber: "03D0531813", _preferredStandards: ["TJC"],
};

// Letter page geometry (96 CSS px/in). The real PDF margins are 14mm top / 20mm
// bottom. There are NO page breaks before the signature block (the stats-section
// break is after it), so the block's document-Y maps straight to its printed
// page: it is on page 1 iff its bottom <= (page height - bottom margin).
const PX_PER_MM = 96 / 25.4;
const PAGE_H = 11 * 96;                 // 1056
const TOP_MM = 14, BOT_MM = 20;
const PAGE1_BOTTOM = PAGE_H - BOT_MM * PX_PER_MM;   // ~980.4
const HEADROOM = 24;                    // ~0.25in cushion: fail before it actually tips

const banner = `<div style="font-size:6pt;color:#8a8a8a;text-align:center;padding:2px 0;">© 2026 Veritas Lab Services, LLC · Licensed to San Carlos Apache Healthcare Corporation (verilabguy@gmail.com) · Issued 2026-09-15 · Single-facility internal use only · Do not redistribute</div>`;
let html = buildMethodCompHTML(study, results).replace("<body>", "<body>" + banner);

(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"], headless: true });
  const page = await browser.newPage();
  await page.emulateMediaType("print");
  await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.addStyleTag({ content: `body{padding:${TOP_MM}mm 15mm ${BOT_MM}mm 15mm;box-sizing:border-box;width:8.5in;}` });
  const box = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("div")].find(d => (d.textContent || "").trim().startsWith("Laboratory Director or Designee Review"));
    if (!heading) return null;
    const block = (heading.closest('div[style*="border-left"]') as HTMLElement) || (heading.parentElement as HTMLElement);
    const r = block.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom };
  });
  await browser.close();

  const fail = (msg: string) => { console.log(`FAIL  method-comp signature-on-page-1 -- ${msg}`); process.exit(1); };
  if (!box) fail("signature block not found in rendered method-comparison report");
  const b = box!;
  console.log(`signature block: top=${b.top.toFixed(0)}px bottom=${b.bottom.toFixed(0)}px  page1 usable bottom=${PAGE1_BOTTOM.toFixed(0)}px (headroom ${HEADROOM}px)`);
  if (b.top < 0) fail("signature block has negative offset (layout error)");
  if (b.bottom > PAGE1_BOTTOM) fail(`signature block overflows page 1 (bottom ${b.bottom.toFixed(0)} > ${PAGE1_BOTTOM.toFixed(0)}); it would print on page 2`);
  if (b.bottom > PAGE1_BOTTOM - HEADROOM) fail(`signature block within ${HEADROOM}px of the page-1 edge (bottom ${b.bottom.toFixed(0)}); page 1 is nearly full and will tip over on the next content addition`);
  console.log("PASS  method-comp director signature renders on page 1 with headroom");
})().catch(e => { console.error("guard render failed:", e); process.exit(2); });
