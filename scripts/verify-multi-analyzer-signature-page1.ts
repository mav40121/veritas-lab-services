// REGRESSION GUARD (Gate 3, PDF rule 5): with two or more analyzers, the Calibration Verification (BUG-058) and
// Correlation / Method Comparison (BUG-056) page 1 adds a key-statistics row and a narrative clause per analyzer.
// This renders the worst realistic case for each, six analyzers (one per legend color), signed, with a dual TEa
// criterion and a long analyte name, and asserts the director signature block still ends on page 1 with headroom.
// Same page geometry as scripts/verify-methodcomp-signature-page1.ts.
// Also two-cohort Reagent Lot Verification, whose review block printed alone on page 2 until 2026-11-05, and the longest
// narrative a study can carry: a lab's own number on the analyte with the longest CLIA criterion in the table (CK-MB).
//
// Run: npx tsx scripts/verify-multi-analyzer-signature-page1.ts   (exit 1 on FAIL)
import puppeteer from "puppeteer";
import { buildCalVerHTML, buildCalVerCorrelationHTML, buildLotToLotHTML, buildMethodCompHTML } from "../server/pdfReport";
import { calculateCalVer, calculateCalVerCorrelation, calculateLotToLot, calculateMethodComparison, type DataPoint, type LotToLotDataPoint } from "../client/src/lib/calculations";

const NAMES = ["Fred", "Barney", "Wilma", "Betty", "Pebbles", "Bamm-Bamm"].map((n) => `${n}, Roche cobas 8000 (c702 module)`);
const signed = {
  status: "pass", lifecycle_state: "finalized", finalized_signature: "Chineme Swann, Laboratory Administrative Manager",
  finalized_at: "2026-10-14T12:00:00Z", _labName: "San Carlos Apache Healthcare Corporation", _cliaNumber: "03D0531813", _preferredStandards: ["TJC"],
};
const tea = { cliaAllowableError: 0.1, teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: "%", tea_unit: "%", cliaAbsoluteFloor: 0.2, clia_absolute_floor: 0.2, cliaAbsoluteUnit: "mg/dL", clia_absolute_unit: "mg/dL" };
const display = Object.fromEntries(NAMES.map((n, k) => [String(k), { model: "Roche cobas 8000 (c702 module)", nickname: n.split(", ")[0], serial_number: String(1000 + k) }]));
const assigned = [0.3, 7, 13.8, 20.5, 27.3, 34.1, 40.9];
const offs = [0.01, 0.37, 0.45, 0.38, -0.08, 0.2, -0.3];

// Calibration verification: 7 levels on 6 analyzers.
const cvDp: DataPoint[] = assigned.map((a, i) => ({ level: i + 1, expectedValue: a, instrumentValues: Object.fromEntries(NAMES.map((n, k) => [n, +(a + offs[i] * (1 + k * 0.1)).toFixed(2)])) } as any));
const cvRes = calculateCalVer(cvDp, NAMES, 0.1, true, 0.2);
const cvStudy: any = { id: 99124, userId: 1, testName: "Creatinine, enzymatic (serum/plasma)", instrument: NAMES.join(", "), instruments: JSON.stringify(NAMES),
  analyst: "RODRIGO GASPAR-TRILLO", date: "2026-10-14", studyType: "cal_ver", dataPoints: JSON.stringify(cvDp), _instrumentDisplay: display, ...tea, ...signed };

// Method comparison: primary + 5 comparisons, 7 specimens.
const mcDp: DataPoint[] = assigned.map((a, i) => ({ level: i + 1, expectedValue: a, instrumentValues: Object.fromEntries(NAMES.slice(1).map((n, k) => [n, +(a + offs[i] * (1 + k * 0.1)).toFixed(2)])) } as any));
const mcRes = calculateMethodComparison(mcDp, NAMES.slice(1), 0.1, true, 0.2);
const mcStudy: any = { id: 99125, userId: 1, testName: "Creatinine, enzymatic (serum/plasma)", instrument: NAMES.join(", "), instruments: JSON.stringify(NAMES),
  analyst: "RODRIGO GASPAR-TRILLO", date: "2026-10-14", studyType: "method_comparison",
  dataPoints: JSON.stringify(assigned.map((a, i) => ({ level: i + 1, instrumentValues: { [NAMES[0]]: a, ...mcDp[i].instrumentValues } }))), _instrumentDisplay: display, ...tea, ...signed };

// Calibration Verification + Correlation (Q12 = 2): the same 7 known levels on 6 analyzers, both halves on page 1.
const ccRes = calculateCalVerCorrelation(cvDp, NAMES, 0.1, true, 0.2);
const ccStudy: any = { ...cvStudy, id: 99126, studyType: "cal_ver_correlation", material: "Bio-Rad Liquichek Linearity set, lot 12345" };

// Reagent lot: 10 Normal and 10 Abnormal specimens, signed.
const lotDp: LotToLotDataPoint[] = Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${i + 1}`, currentLot: 3 + i * 0.1, newLot: +((3 + i * 0.1) * (i % 2 ? 1.01 : 0.99)).toFixed(3), cohort: i < 10 ? "Normal" : "Abnormal" }));
const lotStudy: any = { id: 99127, userId: 1, testName: "Albumin Reagent Lot Verification (EP26)", instrument: NAMES[0], instruments: JSON.stringify([NAMES[0]]), analyst: "RODRIGO GASPAR-TRILLO", date: "2026-10-14", studyType: "lot_to_lot",
  dataPoints: JSON.stringify(lotDp), cliaAllowableError: 0.08, teaIsPercentage: 1, tea_is_percentage: 1, teaUnit: "%", tea_unit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, ...signed };
const lotRes = calculateLotToLot(lotDp, 0.08, "both");

// The wordiest label: a lab's own number on CK-MB, so the narrative states the whole CLIA criterion.
const labSet = { testName: "CK-MB Isoenzymes", cliaAllowableError: 0.2, cliaAbsoluteFloor: 2, clia_absolute_floor: 2, cliaAbsoluteUnit: "ng/mL", clia_absolute_unit: "ng/mL", cliaPresetLabel: "Lab-defined" };

const PX_PER_MM = 96 / 25.4, PAGE_H = 11 * 96, TOP_MM = 14, BOT_MM = 20;
const PAGE1_BOTTOM = PAGE_H - BOT_MM * PX_PER_MM, HEADROOM = 24;
const banner = `<div style="font-size:6pt;color:#8a8a8a;text-align:center;padding:2px 0;">© 2026 Veritas Lab Services, LLC · Licensed to San Carlos Apache Healthcare Corporation (verilabguy@gmail.com) · Issued 2026-10-15 · Single-facility internal use only · Do not redistribute</div>`;

let fails = 0;
(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"], headless: true });
  const cases: [string, string, number?][] = [
    ["cal ver, 6 analyzers", buildCalVerHTML(cvStudy, cvRes as any)],
    ["method comparison, 5 comparisons", buildMethodCompHTML(mcStudy, mcRes as any)],
    ["cal ver + correlation, 6 analyzers", buildCalVerCorrelationHTML(ccStudy, ccRes as any)],
    ["reagent lot, 2 cohorts, signed", buildLotToLotHTML(lotStudy, lotRes as any)],
    // The longest narrative on the fullest pages. Rare enough to run with less to spare, but it has to stay on page 1.
    ["reagent lot, 2 cohorts, signed, lab's own number on CK-MB", buildLotToLotHTML({ ...lotStudy, ...labSet, testName: "CK-MB Isoenzymes Reagent Lot Verification (EP26)" }, lotRes as any), 8],
    ["cal ver, 6 analyzers, lab's own number on CK-MB", buildCalVerHTML({ ...cvStudy, ...labSet }, cvRes as any), 8],
    ["method comparison, 5 comparisons, lab's own number on CK-MB", buildMethodCompHTML({ ...mcStudy, ...labSet }, mcRes as any), 8],
  ];
  for (const [label, html, room] of cases) {
    const page = await browser.newPage();
    await page.emulateMediaType("print");
    await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
    await page.setContent(html.replace("<body>", "<body>" + banner), { waitUntil: "networkidle0" });
    await page.addStyleTag({ content: `body{padding:${TOP_MM}mm 15mm ${BOT_MM}mm 15mm;box-sizing:border-box;width:8.5in;}` });
    const box = await page.evaluate(() => {
      const heading = [...document.querySelectorAll("div")].find(d => (d.textContent || "").trim().startsWith("Laboratory Director or Designee Review"));
      if (!heading) return null;
      const block = (heading.closest('div[style*="border-left"]') as HTMLElement) || (heading.parentElement as HTMLElement);
      const r = block.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });
    await page.close();
    const headroom = room ?? HEADROOM;
    const ok = !!box && box.top >= 0 && box.bottom <= PAGE1_BOTTOM - headroom;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: signature block bottom=${box ? box.bottom.toFixed(0) : "missing"}px, page-1 usable bottom=${PAGE1_BOTTOM.toFixed(0)}px (headroom ${headroom}px)`);
    if (!ok) fails++;
  }
  await browser.close();
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error("guard render failed:", e); process.exit(2); });
