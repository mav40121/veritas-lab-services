// scripts/verify-calver-multi-analyzer-pdf.mts
//
// BUG-058 (2026-10-15, found in the BUG-056 class sweep): a Calibration Verification / Linearity study run on two or more
// analyzers printed page 1 for the first analyzer only (scatter), a slope/R² for the mean of all analyzers, and a narrative
// that counted levels x analyzers as levels ("All 10 calibration levels" for 5 levels on 2 analyzers) and said
// "This instrument". BUG-059 (BUG-057 class): the recovery chart drew an absolute TEa (Sodium ±4 mmol/L) as 100 ± 400%.
// Builds the report HTML with the same calculation the results page runs and checks:
//   1. two analyzers: page 1 plots a series per analyzer (legend names both)
//   2. two analyzers: page 1 key statistics have a row per analyzer with its own slope, plus Overall
//   3. two analyzers: the narrative counts 5 levels on 2 analyzers and describes each analyzer
//   4. two analyzers, one level out of range on one analyzer: the narrative names the failing analyzer, FAIL in key statistics
//   5. absolute TEa (Sodium ±4 mmol/L): the recovery chart reads "Difference from Assigned (limits ±4 mmol/L)", never 400%
//   6. absolute TEa: both limit lines sit inside the plot area and the points are not flattened onto the centre line
//   7. one analyzer, percentage TEa: page 1 keeps "Percent Recovery", the compact key statistics and "All 5 calibration levels"
//   8. the verification package plots an absolute TEa in units
// Usage: npx tsx scripts/verify-calver-multi-analyzer-pdf.mts
import fs from "node:fs";
import { buildCalVerHTML, recoverySeriesSVG } from "../server/pdfReport";
import { calculateCalVer, type DataPoint } from "../client/src/lib/calculations";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };

// Study 1769 as saved (GC1 CREAT, two analyzers, TEa 10% or 0.2 mg/dL) and study 1832 (Sodium, TEa 4 mmol/L).
const R1 = "ATELLICA 2 Run 1", R2 = "ATELLICA 2 Run 2";
const s1769 = [[0.3, 0.31, 0.29], [7, 7.37, 7.37], [13.8, 14.25, 14.21], [20.5, 20.88, 20.91], [27.3, 27.22, 27.11]];
const s1832 = [[118, 119], [130, 128], [142, 143], [153, 155], [165, 164]];

function build(testName: string, names: string[], rows: number[][], tea: number, teaIsPct: 0 | 1, unit: string, floor: number | null) {
  const dp: DataPoint[] = rows.map((r, i) => ({ level: i + 1, expectedValue: r[0], instrumentValues: Object.fromEntries(names.map((n, k) => [n, r[k + 1]])) } as any));
  const results = calculateCalVer(dp, names, tea, teaIsPct !== 0, floor);
  const study: any = {
    testName, studyType: "cal_ver", instrument: names.join(", "), instruments: JSON.stringify(names),
    analyst: "Michael Veri", date: "2026-10-07", cliaAllowableError: tea, teaIsPercentage: teaIsPct, tea_is_percentage: teaIsPct,
    teaUnit: unit, tea_unit: unit, cliaAbsoluteFloor: floor, clia_absolute_floor: floor, dataPoints: dp, status: results.overallPass ? "pass" : "fail",
  };
  const html = buildCalVerHTML(study, results as any);
  const page1 = html.split("Continued from page 1")[0];
  const keyStats = page1.slice(page1.indexOf("Key Statistics Summary"), page1.indexOf("STUDY NARRATIVE") > 0 ? page1.indexOf("STUDY NARRATIVE") : undefined);
  return { html, page1, keyStats, results };
}

const a = build("GC1 CREAT", [R1, R2], s1769, 0.1, 1, "%", 0.2);
const charts = a.page1.slice(a.page1.indexOf('<div class="charts">'), a.page1.indexOf("Key Statistics Summary"));
check("1. two analyzers: page 1 plots a series per analyzer",
  charts.includes("Measured vs. Assigned") && charts.includes(`● ${R1}`) && charts.includes(`● ${R2}`));
const reg = a.results.regression as any;
const sl1 = reg[`${R1} vs. Assigned`].slope.toFixed(4), sl2 = reg[`${R2} vs. Assigned`].slope.toFixed(4);
check("2. two analyzers: key statistics row per analyzer with its own slope, plus Overall",
  a.keyStats.includes(`> ${R1}</td>`) && a.keyStats.includes(`> ${R2}</td>`) && a.keyStats.includes(sl1) && a.keyStats.includes(sl2) && /Overall<\/td><td class="text-right pass">PASS \(10\/10\)/.test(a.keyStats),
  `slopes ${sl1} / ${sl2}`);
check("3. two analyzers: narrative counts 5 levels on 2 analyzers and describes each",
  a.page1.includes("5 calibration levels for GC1 CREAT were run on 2 analyzers") && !a.page1.includes("All 10 calibration levels")
  && !a.page1.includes("This instrument") && a.page1.includes(`${R1}: slope`) && a.page1.includes(`${R2}: slope`)
  && a.page1.includes("All levels on every analyzer satisfied this criterion."));

const failRows = s1769.map((r) => [...r]); failRows[2][2] = 16.0; // level 3 on Run 2 reads 16.0 against 13.8 (+15.9%)
const f = build("GC1 CREAT", [R1, R2], failRows, 0.1, 1, "%", 0.2);
check("4. one level out of range on one analyzer: narrative names it, key statistics FAIL",
  f.page1.includes(`did not satisfy this criterion (${R2})`) && !f.page1.includes(`(${R1}, `) && /Overall<\/td><td class="text-right fail">FAIL \(9\/10\)/.test(f.keyStats)
  && f.keyStats.includes("fail\">4/5</td>"));

const b = build("Sodium", ["Ortho 5600 Backup"], s1832, 4, 0, "mmol/L", null);
check("5. absolute TEa: recovery chart reads limits ±4 mmol/L, never 400%",
  b.page1.includes("Difference from Assigned (limits ±4 mmol/L)") && b.page1.includes("Difference (mmol/L)") && !/±400|400%/.test(b.html));

// 6. Read the limit lines and points back out of the absolute-TEa chart.
const svg = recoverySeriesSVG([{ name: "Ortho 5600 Backup", x: s1832.map((r) => r[0]), y: s1832.map((r) => r[1]) }], 4, true, "mmol/L");
const mt = 28, ph = 220 - 28 - 36;
const red = [...svg.matchAll(/y1="([\d.]+)"[^>]*stroke="#dc5050"/g)].map((m) => Number(m[1]));
const dots = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
const spread = Math.max(...dots) - Math.min(...dots);
check("6. absolute TEa: limit lines inside the plot, points spread over the band",
  red.length === 2 && red.every((y) => y > mt && y < mt + ph) && spread > ph * 0.3,
  `limits ${red.map((y) => y.toFixed(1))} plot ${mt}-${mt + ph}, point spread ${spread.toFixed(1)}`);

const c = build("GC1 CREAT", [R1], s1769.map((r) => [r[0], r[1]]), 0.1, 1, "%", 0.2);
check("7. one analyzer, percentage TEa: page 1 unchanged (Percent Recovery, compact statistics, All 5 levels)",
  c.page1.includes(">Percent Recovery</text>") && c.page1.includes(">Scatter Plot</text>") && !c.keyStats.includes("<th>Analyzer</th>")
  && !c.keyStats.includes("display:none") && c.page1.includes("All 5 calibration levels for GC1 CREAT"));

const vsrc = fs.readFileSync(new URL("../server/veritacheck_verification.ts", import.meta.url), "utf-8");
check("8. verification package plots an absolute TEa in units",
  /const rp = teaIsPct\s*\?\s*recoveryPlotSVG\(assignedVals, recoveries, tea\)\s*:\s*recoverySeriesSVG\(\[\{ name: "Mean", x: assignedVals, y: measuredMeans \}\], tea, true, teaUnit\)/.test(vsrc));

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
