// scripts/verify-bundle-graph-svgs.mjs
//
// Receipts for the bundle graph embedding (Michael L feedback,
// 2026-06-09). Exercises each SVG generator with known inputs and
// asserts the SVG string is non-empty and contains the geometry
// markers the printable PDF needs.
//
// Each helper is now exported from server/pdfReport.ts (previously
// module-private). The bundle's renderStudyAppendix imports them
// and embeds the SVG above the existing statistical table.
//
// Run: npx tsx scripts/verify-bundle-graph-svgs.mjs

import * as report from "../server/pdfReport.ts";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

// ── Test 1: scatterSVG returns a valid SVG with circles and a regression line ──
{
  const xs = [10, 20, 30, 40, 50];
  const ys = [11, 19, 31, 39, 51];
  const svg = report.scatterSVG(xs, ys, "X", "Y", "Test scatter", true);
  check("scatterSVG: non-empty", svg.length > 100);
  check("scatterSVG: <svg> tag", /<svg /.test(svg));
  check("scatterSVG: circles for each point", (svg.match(/<circle /g) || []).length === xs.length);
  check("scatterSVG: identity line present", svg.includes('<line') && svg.includes('stroke="#a0a8b0"'));
  check("scatterSVG: regression line present", svg.includes('stroke-dasharray'));
  check("scatterSVG: title rendered", svg.includes("Test scatter"));
}

// ── Test 2: precisionPlotSVG renders SDI dots and reference bands ─────────
{
  const values = [100, 101, 99, 100, 102, 98, 100, 101, 99, 100, 100, 100, 101, 99];
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
  const svg = report.precisionPlotSVG(values, m, s, null, null);
  check("precisionPlotSVG: non-empty", svg.length > 100);
  check("precisionPlotSVG: title 'Precision Plot'", svg.includes("Precision Plot"));
  check("precisionPlotSVG: dots for each value", (svg.match(/<circle /g) || []).length === values.length);
  check("precisionPlotSVG: SDI reference lines (+/- 3)", svg.includes(">+3<") && svg.includes(">-3<"));
}

// ── Test 3: precisionPlotSVG with target overrides center ──────────────────
{
  const values = [99, 100, 101];
  const svg = report.precisionPlotSVG(values, 100, 1, 100, 1);
  check("precisionPlotSVG: with target axis label", svg.includes("SD Index (Target)"));
}

// ── Test 4: precisionPlotSVG bails on insufficient data ────────────────────
{
  const svg = report.precisionPlotSVG([], 0, 0, null, null);
  check("precisionPlotSVG: empty values returns empty svg", svg.length < 100, `len=${svg.length}`);
}

// ── Test 5: histogramSVG returns a histogram with bars ─────────────────────
{
  const values = [10, 11, 12, 12, 13, 13, 13, 14, 14, 15];
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
  const svg = report.histogramSVG(values, m, s, null);
  check("histogramSVG: non-empty", svg.length > 100);
  check("histogramSVG: rect bars present", /<rect /.test(svg));
}

// ── Test 6: recoveryPlotSVG renders percent recovery with TEa band ─────────
{
  const assigned = [50, 100, 200, 400];
  const recoveries = [98, 99.5, 100.8, 101.5];
  const svg = report.recoveryPlotSVG(assigned, recoveries, 0.10); // 10% TEa
  check("recoveryPlotSVG: non-empty", svg.length > 100);
  check("recoveryPlotSVG: title 'Percent Recovery'", svg.includes("Percent Recovery"));
  check("recoveryPlotSVG: dot per level", (svg.match(/<circle /g) || []).length === assigned.length);
  check("recoveryPlotSVG: TEa band rendered", svg.includes('fill="#e8f5e9"'));
}

// ── Test 7: blandAltmanSVG renders mean vs % diff scatter with bias line ───
{
  const avgs = [10, 50, 100, 200];
  const pctDiffs = [1.0, 0.5, -0.2, 0.3];
  const svg = report.blandAltmanSVG(avgs, pctDiffs, 0.10, 0.4, "Comparator");
  check("blandAltmanSVG: non-empty", svg.length > 100);
  check("blandAltmanSVG: title 'Bland-Altman'", svg.includes("Bland-Altman"));
  check("blandAltmanSVG: dot per point", (svg.match(/<circle /g) || []).length === avgs.length);
}

// ── Test 8: helpers bail gracefully on empty input ─────────────────────────
{
  check("scatterSVG empty: short svg", report.scatterSVG([], [], "x", "y", "t", false).length < 100);
  check("histogramSVG empty: short svg", report.histogramSVG([], 0, 0, null).length < 100);
  check("recoveryPlotSVG empty: short svg", report.recoveryPlotSVG([], [], 0.1).length < 100);
  check("blandAltmanSVG empty: short svg", report.blandAltmanSVG([], [], 0.1, 0, "x").length < 100);
}

// ── Test 9: SVG output stays within reasonable size for inline embed ───────
{
  // A 20-point precision plot should be small (<5kB) so the bundle
  // does not bloat the PDF unduly when 6 elements each carry 1-2 SVGs.
  const values = Array.from({ length: 20 }, (_, i) => 100 + Math.sin(i) * 2);
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const s = Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
  const svg = report.precisionPlotSVG(values, m, s, null, null);
  check("precisionPlotSVG: 20-point output < 5kB", svg.length < 5000, `len=${svg.length}`);
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
