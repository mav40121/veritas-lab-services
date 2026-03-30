/**
 * Server-side PDF generation using Puppeteer + HTML templates.
 * Replaces client-side jsPDF. Called from POST /api/generate-pdf.
 *
 * The math functions are duplicated here (not imported from client) because
 * this runs in Node — the client calculations.ts uses the same algorithms.
 */

import puppeteer from "puppeteer";
import type { Study } from "@shared/schema";

// ─── Math helpers (mirrors client/src/lib/calculations.ts) ────────────────────
function mean(v: number[]) { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
function slopeFn(x: number[], y: number[]) {
  const n = x.length; if (n < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0);
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0);
  return den === 0 ? 1 : num / den;
}
function interceptFn(x: number[], y: number[]) { return mean(y) - slopeFn(x, y) * mean(x); }
function rsq(x: number[], y: number[]) {
  if (x.length < 2) return 1;
  const xm = mean(x), ym = mean(y);
  const num = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) ** 2;
  const den = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) * y.reduce((s, yi) => s + (yi - ym) ** 2, 0);
  return den === 0 ? 1 : num / den;
}
function stddev(v: number[]) {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}
function seeFn(x: number[], y: number[]) {
  const n = x.length; if (n < 3) return 0;
  const s = slopeFn(x, y), b = interceptFn(x, y);
  const sse = y.reduce((sum, yi, i) => sum + (yi - (s * x[i] + b)) ** 2, 0);
  return Math.sqrt(sse / (n - 2));
}
function demingRegression(x: number[], y: number[]) {
  const n = x.length; if (n < 2) return { slope: 1, intercept: 0 };
  const xm = mean(x), ym = mean(y);
  const Sxx = x.reduce((s, xi) => s + (xi - xm) ** 2, 0) / (n - 1);
  const Syy = y.reduce((s, yi) => s + (yi - ym) ** 2, 0) / (n - 1);
  const Sxy = x.reduce((s, xi, i) => s + (xi - xm) * (y[i] - ym), 0) / (n - 1);
  const slope = (Syy - Sxx + Math.sqrt((Syy - Sxx) ** 2 + 4 * Sxy ** 2)) / (2 * Sxy);
  return { slope, intercept: ym - slope * xm };
}
function tCritical(df: number) {
  if (df <= 1) return 12.706; if (df <= 2) return 4.303; if (df <= 3) return 3.182;
  if (df <= 4) return 2.776;  if (df <= 5) return 2.571; if (df <= 6) return 2.447;
  if (df <= 7) return 2.365;  if (df <= 8) return 2.306; if (df <= 9) return 2.262;
  if (df <= 10) return 2.228; if (df <= 15) return 2.131; if (df <= 20) return 2.086;
  if (df <= 25) return 2.060; if (df <= 30) return 2.042; if (df <= 40) return 2.021;
  if (df <= 60) return 2.000; if (df <= 120) return 1.980; return 1.960;
}
function olsCI(x: number[], y: number[]) {
  const n = x.length; if (n < 3) return { slopeLo: 0, slopeHi: 0, interceptLo: 0, interceptHi: 0 };
  const xm = mean(x), s = slopeFn(x, y), b = interceptFn(x, y), see = seeFn(x, y);
  const Sxx = x.reduce((sum, xi) => sum + (xi - xm) ** 2, 0);
  const t = tCritical(n - 2);
  const seSlopeNum = see / Math.sqrt(Sxx);
  const seIntercept = see * Math.sqrt(x.reduce((sum, xi) => sum + xi ** 2, 0) / (n * Sxx));
  return { slopeLo: s - t * seSlopeNum, slopeHi: s + t * seSlopeNum, interceptLo: b - t * seIntercept, interceptHi: b + t * seIntercept };
}

// ─── SVG Chart helpers ────────────────────────────────────────────────────────

function scatterSVG(
  xVals: number[], yVals: number[], xLabel: string, yLabel: string,
  title: string, showIdentity: boolean, w = 320, h = 220
): string {
  if (!xVals.length) return `<svg width="${w}" height="${h}"></svg>`;
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const padX = (Math.max(...xVals) - Math.min(...xVals)) * 0.1 || 1;
  const padY = (Math.max(...yVals) - Math.min(...yVals)) * 0.1 || 1;
  const xMin = Math.min(...xVals) - padX, xMax = Math.max(...xVals) + padX;
  const yMin = Math.min(...yVals) - padY, yMax = Math.max(...yVals) + padY;
  const cx = (v: number) => ml + ((v - xMin) / (xMax - xMin)) * pw;
  const cy = (v: number) => mt + ph - ((v - yMin) / (yMax - yMin)) * ph;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const gx = ml + (i / 4) * pw, gy = mt + (i / 4) * ph;
    grid += `<line x1="${gx}" y1="${mt}" x2="${gx}" y2="${mt + ph}" stroke="#dde1e6" stroke-width="0.6"/>`;
    grid += `<line x1="${ml}" y1="${gy}" x2="${ml + pw}" y2="${gy}" stroke="#dde1e6" stroke-width="0.6"/>`;
  }

  let identity = "";
  if (showIdentity) {
    identity = `<line x1="${cx(xMin)}" y1="${cy(xMin)}" x2="${cx(xMax)}" y2="${cy(xMax)}" stroke="#a0a8b0" stroke-width="1.2"/>`;
  }

  // Regression line
  const slope = slopeFn(xVals, yVals), intercept = interceptFn(xVals, yVals);
  const ry1 = slope * xMin + intercept, ry2 = slope * xMax + intercept;
  const regLine = `<line x1="${cx(xMin)}" y1="${cy(ry1)}" x2="${cx(xMax)}" y2="${cy(ry2)}" stroke="#0ea5a0" stroke-width="1.2" stroke-dasharray="4,2"/>`;

  const dots = xVals.map((x, i) => `<circle cx="${cx(x)}" cy="${cy(yVals[i])}" r="4" fill="#0e8a82" opacity="0.85"/>`).join("");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">${title}</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${grid}${identity}${regLine}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#646e78">${xLabel}</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">${yLabel}</text>
</svg>`;
}

function recoveryPlotSVG(assignedVals: number[], recoveries: number[], cliaError: number, w = 320, h = 220): string {
  if (!recoveries.length) return `<svg width="${w}" height="${h}"></svg>`;
  const cliaP = cliaError * 100;
  const upper = 100 + cliaP, lower = 100 - cliaP;
  const minR = Math.min(...recoveries, lower - 2), maxR = Math.max(...recoveries, upper + 2);
  const minX = Math.min(...assignedVals), maxX = Math.max(...assignedVals);
  const padX = (maxX - minX) * 0.1 || 1;
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const cx = (v: number) => ml + ((v - (minX - padX)) / (maxX - minX + 2 * padX)) * pw;
  const cy = (v: number) => mt + ph - ((v - minR) / (maxR - minR)) * ph;

  let grid = "";
  for (let i = 0; i <= 4; i++) grid += `<line x1="${ml}" y1="${mt + (i / 4) * ph}" x2="${ml + pw}" y2="${mt + (i / 4) * ph}" stroke="#dde1e6" stroke-width="0.6"/>`;

  const bandH = cy(lower) - cy(upper);
  const band = `<rect x="${ml}" y="${cy(upper)}" width="${pw}" height="${bandH}" fill="#e8f5e9" opacity="0.6"/>`;
  const midLine = `<line x1="${ml}" y1="${cy(100)}" x2="${ml + pw}" y2="${cy(100)}" stroke="#a0a8b0" stroke-width="0.8"/>`;
  const upperLine = `<line x1="${ml}" y1="${cy(upper)}" x2="${ml + pw}" y2="${cy(upper)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const lowerLine = `<line x1="${ml}" y1="${cy(lower)}" x2="${ml + pw}" y2="${cy(lower)}" stroke="#dc5050" stroke-width="1.2"/>`;

  let linePath = "";
  for (let i = 1; i < recoveries.length; i++) linePath += `<line x1="${cx(assignedVals[i-1])}" y1="${cy(recoveries[i-1])}" x2="${cx(assignedVals[i])}" y2="${cy(recoveries[i])}" stroke="#0e8a82" stroke-width="1.2"/>`;
  const dots = recoveries.map((r, i) => `<circle cx="${cx(assignedVals[i])}" cy="${cy(r)}" r="4" fill="#0e8a82" opacity="0.85"/>`).join("");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">Percent Recovery</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${grid}${band}${midLine}${upperLine}${lowerLine}${linePath}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#646e78">Assigned Value</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">% Rec</text>
</svg>`;
}

function blandAltmanSVG(avgs: number[], pctDiffs: number[], cliaError: number, meanBias: number, instName: string, w = 320, h = 220): string {
  if (!avgs.length) return `<svg width="${w}" height="${h}"></svg>`;
  const cliaP = cliaError * 100;
  const minY = Math.min(...pctDiffs, -cliaP - 2), maxY = Math.max(...pctDiffs, cliaP + 2);
  const minX = Math.min(...avgs), maxX = Math.max(...avgs);
  const padX = (maxX - minX) * 0.1 || 1;
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const cx = (v: number) => ml + ((v - minX + padX) / (maxX - minX + 2 * padX)) * pw;
  const cy = (v: number) => mt + ph - ((v - minY) / (maxY - minY)) * ph;

  let grid = "";
  for (let i = 0; i <= 4; i++) grid += `<line x1="${ml}" y1="${mt + (i / 4) * ph}" x2="${ml + pw}" y2="${mt + (i / 4) * ph}" stroke="#dde1e6" stroke-width="0.6"/>`;

  const zeroLine = `<line x1="${ml}" y1="${cy(0)}" x2="${ml + pw}" y2="${cy(0)}" stroke="#a0a8b0" stroke-width="0.8"/>`;
  const biasLine = `<line x1="${ml}" y1="${cy(meanBias)}" x2="${ml + pw}" y2="${cy(meanBias)}" stroke="#28a74f" stroke-width="1.2"/>`;
  const upper = `<line x1="${ml}" y1="${cy(cliaP)}" x2="${ml + pw}" y2="${cy(cliaP)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const lower = `<line x1="${ml}" y1="${cy(-cliaP)}" x2="${ml + pw}" y2="${cy(-cliaP)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const dots = avgs.map((a, i) => `<circle cx="${cx(a)}" cy="${cy(pctDiffs[i])}" r="4" fill="#0e8a82" opacity="0.85"/>`).join("");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">Bland-Altman</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${grid}${zeroLine}${biasLine}${upper}${lower}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#646e78">Mean of Methods</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">% Diff</text>
</svg>`;
}

// ─── Color helpers ────────────────────────────────────────────────────────────
const TEAL   = "#0e8a82";
const PASS   = "#28a74f";
const FAIL   = "#c8323c";
const MUTED  = "#646e78";
const DARK   = "#14141e";

// ─── CFR URL map ──────────────────────────────────────────────────────────────
const CFR_URLS: Record<string, string> = {
  "42 CFR §493.931": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.931",
  "42 CFR §493.933": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.933",
  "42 CFR §493.935": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.935",
  "42 CFR §493.941": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.941",
};

// ─── Shared CSS ───────────────────────────────────────────────────────────────
const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: ${DARK}; background: white; }
  @page { size: letter; margin: 14mm 15mm 18mm 15mm; }

  /* Header */
  .report-header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6px; border-bottom: 1px solid #d2d7dc; margin-bottom: 8px; }
  .logo { font-size: 18pt; font-weight: 700; color: ${TEAL}; line-height: 1; }
  .logo-sub { font-size: 7.5pt; color: ${MUTED}; margin-top: 2px; }
  .header-right { text-align: right; font-size: 8pt; color: ${MUTED}; }
  .report-title { font-size: 11pt; font-weight: 700; text-align: center; margin: 6px 0 2px; }
  .report-title-sub { font-size: 7pt; text-align: center; color: ${MUTED}; margin-bottom: 8px; }
  .section-heading { font-size: 13pt; font-weight: 700; color: ${DARK}; margin: 6px 0 8px; }

  /* Charts */
  .charts { display: flex; gap: 8px; margin-bottom: 10px; }
  .charts svg { flex: 1; }

  /* Tables */
  .section-label { font-size: 8.5pt; font-weight: 700; text-align: center; color: ${DARK}; margin: 8px 0 4px; }
  .divider { border: none; border-top: 1px solid #d2d7dc; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #f0f2f5; color: ${MUTED}; font-weight: 700; padding: 3px 6px; font-size: 7.5pt; }
  td { padding: 2.5px 6px; }
  tr.stripe { background: #fafbfd; }
  .text-right { text-align: right; }
  .text-center { text-align: center; }
  .pass { color: ${PASS}; font-weight: 600; }
  .fail { color: ${FAIL}; font-weight: 600; }
  .warn { color: #d97706; font-weight: 600; }
  .teal-link { color: ${TEAL}; font-weight: 700; text-decoration: underline; }

  /* Eval + verdict */
  .eval-section { margin-top: 10px; }
  .eval-title { font-size: 10pt; font-weight: 700; text-align: center; margin-bottom: 4px; }
  .eval-text { font-size: 7.5pt; line-height: 1.5; margin-bottom: 8px; }
  .verdict { border-radius: 4px; padding: 7px 12px; text-align: center; font-size: 9pt; font-weight: 700; color: white; }
  .verdict.pass-bg { background: ${PASS}; }
  .verdict.fail-bg { background: ${FAIL}; }

  /* Signature block — always on page 1 */
  .signature-block { margin-top: 20px; }
  .accepted-label { font-size: 9pt; font-weight: 700; margin-bottom: 8px; }
  .sig-lines { display: flex; gap: 40px; }
  .sig-line { flex: 1; }
  .sig-line .line { border-bottom: 1px solid ${DARK}; height: 24px; margin-bottom: 3px; }
  .sig-line .label { font-size: 7.5pt; color: ${MUTED}; }
  .sig-date { flex: 0 0 30%; }

  /* Supporting data page */
  .supporting-page { page-break-before: always; }
  .supporting-title { font-size: 11pt; font-weight: 700; text-align: center; margin-bottom: 8px; }
  .supporting-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 24px; }
  .spec-section-label { font-size: 8pt; font-weight: 700; margin-bottom: 6px; color: ${DARK}; }
  .spec-row { display: flex; justify-content: space-between; font-size: 7.5pt; margin-bottom: 4px; }
  .spec-label { color: ${MUTED}; }
  .spec-value { font-weight: 500; text-align: right; max-width: 60%; }

  /* Statistical table page break */
  .stats-section { page-break-before: always; }

  /* Footer rendered via Puppeteer displayHeaderFooter — hidden from body */
  .footer { display: none; }
  .page-num { display: none; }

  /* Two-col supporting stats */
  .supp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 0; font-size: 8pt; margin-bottom: 6px; }
  .supp-stats .key { color: ${MUTED}; font-weight: 700; }
  .supp-stats .val { }
`;

// ─── Shared header HTML ───────────────────────────────────────────────────────
function headerHTML(study: Study): string {
  const typeLabelMap: Record<string, string> = {
    cal_ver: "Calibration Verification / Linearity",
    precision: "Precision Verification (EP15)",
    method_comparison: "Correlation / Method Comparison",
    lot_to_lot: "Lot-to-Lot Verification",
    pt_coag: "PT/Coag New Lot Validation",
    qc_range: "QC Range Establishment",
    multi_analyte_coag: "Multi-Analyte Lot Comparison (Coag)",
  };
  const typeLabel = typeLabelMap[study.studyType] || "Correlation / Method Comparison";
  return `
  <div class="report-header">
    <div>
      <div class="logo">VeritaCheck™</div>
      <div class="logo-sub">by Veritas Lab Services · veritaslabservices.com</div>
    </div>
    <div class="header-right">Instrument: ${study.instrument}</div>
  </div>
  <div class="report-title">${typeLabel} — ${study.testName}</div>
  <hr class="divider">`;
}

// ─── Supporting data page HTML ────────────────────────────────────────────────
function supportingPageHTML(study: Study, instrumentNames: string[]): string {
  const cliaP = (study.cliaAllowableError * 100).toFixed(1);
  const cfr = (study as any).cfr || "42 CFR §493 Subpart I";
  const cfrUrl = CFR_URLS[cfr] || "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I";

  const specs = [
    ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : study.studyType === "precision" ? "Precision Verification (EP15)" : "Correlation / Method Comparison"],
    ["Test Name", study.testName],
    ["CLIA Total Allowable Error", `±${cliaP}%`],
    ["CLIA CFR Reference", `<a href="${cfrUrl}" class="teal-link">${cfr}</a>`],
    ["Allowable Systematic Error", `±${cliaP}%`],
  ];
  const supporting = [
    ["Analyst", study.analyst],
    ["Date", study.date],
    ["Instrument(s)", study.instrument],
    ["Test Methods", instrumentNames.join(", ")],
    ["Generated by", "VeritaCheck · Veritas Lab Services"],
  ];

  const leftRows = specs.map(([k, v]) => `<div class="spec-row"><span class="spec-label">${k}</span><span class="spec-value">${v}</span></div>`).join("");
  const rightRows = supporting.map(([k, v]) => `<div class="spec-row"><span class="spec-label">${k}</span><span class="spec-value">${v}</span></div>`).join("");

  return `
  <div class="supporting-page">
    <div class="supporting-title">Supporting Data &amp; User Specifications</div>
    <hr class="divider">
    <div class="supporting-grid">
      <div>
        <div class="spec-section-label">User's Specifications</div>
        ${leftRows}
      </div>
      <div>
        <div class="spec-section-label">Supporting Data</div>
        ${rightRows}
      </div>
    </div>
    <hr class="divider" style="margin-top:10px">
  </div>`;
}

// ─── Footer HTML (fixed position, repeats on all pages) ───────────────────────
function footerHTML(): string {
  const today = new Date().toLocaleDateString();
  return `
  <div class="footer">
    <div class="footer-disclaimer">VeritaCheck is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed laboratory director and do not constitute medical advice.</div>
    <div class="footer-bar">
      <span>VeritaCheck by Veritas Lab Services · veritaslabservices.com · Generated ${today}</span>
      <span class="page-num"></span>
    </div>
  </div>`;
}

// ─── Signature block HTML ─────────────────────────────────────────────────────
function signatureHTML(): string {
  return `
  <div class="signature-block">
    <div class="accepted-label">Accepted by:</div>
    <div class="sig-lines">
      <div class="sig-line" style="flex:2">
        <div class="line"></div>
        <div class="label">Signature / Name &amp; Title</div>
      </div>
      <div class="sig-line sig-date">
        <div class="line"></div>
        <div class="label">Date</div>
      </div>
    </div>
  </div>`;
}

// ─── Evaluation section HTML ──────────────────────────────────────────────────
function evalHTML(summary: string, overallPass: boolean, passCount: number, totalCount: number, cliaError: number): string {
  const cliaP = (cliaError * 100).toFixed(1);
  const verdictText = overallPass
    ? `PASS — ${passCount}/${totalCount} results within TEa of ±${cliaP}%`
    : `FAIL — ${passCount}/${totalCount} results within TEa of ±${cliaP}%`;
  return `
  <div class="eval-section">
    <hr class="divider">
    <div class="eval-title">Evaluation of Results</div>
    <div class="eval-text">${summary}</div>
    <div class="verdict ${overallPass ? "pass-bg" : "fail-bg"}">${verdictText}</div>
  </div>`;
}

// ─── Narrative generator ─────────────────────────────────────────────────────
function narrativeHTML(
  studyType: "cal_ver" | "method_comp" | "precision",
  results: any,
  cliaError: number,
  analyteName: string
): string {
  const cliaPct = (cliaError * 100).toFixed(1);
  const adlmPct = (cliaError * 50).toFixed(1); // ADLM = half of CLIA TEa
  let narrative = "";

  if (studyType === "cal_ver") {
    const maxErr = Math.max(...results.levelResults.map((r: any) => Math.abs(r.obsError * 100)));
    const meetsAdlm = maxErr <= cliaError * 50;
    const slope = Object.values(results.regression as any)[0] as any;
    const slopeVal: number = slope?.slope ?? 1;
    const interceptVal: number = slope?.intercept ?? 0;
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias"
      : slopeVal > 1
        ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional bias — results trend slightly high at upper concentrations`
        : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional bias — results trend slightly low at upper concentrations`;
    const interceptInterp = Math.abs(interceptVal) < cliaError * 100 * 0.1
      ? "a negligible constant offset"
      : interceptVal > 0
        ? `a small positive constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`
        : `a small negative constant offset of ${Math.abs(interceptVal).toFixed(3)} units at low concentrations`;

    if (results.overallPass) {
      narrative = `All ${results.totalCount} calibration levels for ${analyteName} fell within the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      if (meetsAdlm) {
        narrative += `The maximum observed error of ${maxErr.toFixed(1)}% also meets the ADLM-recommended internal goal of ±${adlmPct}%, indicating performance well above the regulatory minimum. `;
      } else {
        narrative += `The maximum observed error of ${maxErr.toFixed(1)}% meets CLIA requirements; the ADLM recommends an internal goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      narrative += `The regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) and intercept of ${interceptVal.toFixed(3)} (ideal: 0) indicate ${slopeInterp} and ${interceptInterp}. This instrument is performing within required limits across its reportable range.`;
    } else {
      const failCount = results.totalCount - results.passCount;
      narrative = `${failCount} of ${results.totalCount} calibration level${failCount > 1 ? "s" : ""} for ${analyteName} exceeded the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      narrative += `Do not report patient results until the cause has been identified, corrective action has been taken, and the study is repeated with passing results. `;
      narrative += `The regression slope of ${slopeVal.toFixed(3)} and intercept of ${interceptVal.toFixed(3)} suggest ${slopeInterp} and ${interceptInterp}. Review calibration, reagent lot, and instrument maintenance records.`;
    }
  }

  if (studyType === "method_comp") {
    const firstReg: any = Object.values(results.regression as any).find((r: any) => (r as any).regressionType === "Deming") ||
      Object.values(results.regression as any)[0];
    const slopeVal: number = firstReg?.slope ?? 1;
    const interceptVal: number = firstReg?.intercept ?? 0;
    const r2Val: number = firstReg?.r2 ?? 1;
    const rVal = Math.sqrt(r2Val);
    const ba: any = results.blandAltman ? Object.values(results.blandAltman)[0] : null;
    const meanBiasPct: number = ba?.pctMeanDiff ?? ba?.meanPctBias ?? 0;

    const correlationInterp = rVal >= 0.99 ? "excellent" : rVal >= 0.975 ? "acceptable" : "borderline — review carefully";
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias between methods"
      : slopeVal > 1
        ? `a ${((slopeVal - 1) * 100).toFixed(1)}% upward proportional difference — the test method reads slightly higher than the reference at upper concentrations`
        : `a ${((1 - slopeVal) * 100).toFixed(1)}% downward proportional difference — the test method reads slightly lower than the reference at upper concentrations`;
    const biasInterp = Math.abs(meanBiasPct) <= cliaError * 100
      ? `within the CLIA total allowable error of ±${cliaPct}%`
      : `exceeds the CLIA total allowable error of ±${cliaPct}% and requires investigation`;

    if (results.overallPass) {
      narrative = `The Pearson correlation coefficient of ${rVal.toFixed(3)} indicates ${correlationInterp} agreement between the two methods for ${analyteName}. `;
      narrative += `The Deming regression slope of ${slopeVal.toFixed(3)} (ideal: 1.000) indicates ${slopeInterp}. `;
      narrative += `The mean bias of ${meanBiasPct >= 0 ? "+" : ""}${meanBiasPct.toFixed(1)}% is ${biasInterp}. `;
      narrative += `The Bland-Altman analysis confirms no clinically significant systematic difference between methods. This method/instrument may be used for patient reporting.`;
    } else {
      narrative = `The method comparison for ${analyteName} did not meet acceptance criteria. `;
      narrative += `The correlation of ${rVal.toFixed(3)} and a mean bias of ${meanBiasPct >= 0 ? "+" : ""}${meanBiasPct.toFixed(1)}% (CLIA limit: ±${cliaPct}%) indicate unacceptable agreement between methods. `;
      narrative += `Do not report patient results from the test method until bias has been investigated, corrective action taken, and the study repeated with passing results.`;
    }
  }

  if (studyType === "precision") {
    const levels = results.levelResults;
    const maxCV: number = Math.max(...levels.map((r: any) => r.totalCV ?? r.cv ?? 0));
    const meetsAdlm = maxCV <= cliaError * 50;
    const isAdvanced = results.mode === "advanced";

    if (results.overallPass) {
      narrative = `The precision study for ${analyteName} demonstrated a maximum observed CV of ${maxCV.toFixed(2)}%, which is within the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      if (meetsAdlm) {
        narrative += `The result also meets the ADLM-recommended internal precision goal of ±${adlmPct}%, indicating performance well above the regulatory minimum. `;
      } else {
        narrative += `The ADLM recommends an internal precision goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      if (isAdvanced && levels[0]?.withinRunCV !== undefined) {
        const wrCV = levels[0].withinRunCV?.toFixed(2) ?? "—";
        const bdCV = levels[0].betweenDayCV?.toFixed(2) ?? "—";
        narrative += `ANOVA components show within-run CV of ${wrCV}% and between-day CV of ${bdCV}%, indicating a stable analytical system with consistent day-to-day performance. `;
      }
      narrative += `Manufacturer precision claims are verified. This instrument is performing with acceptable reproducibility.`;
    } else {
      narrative = `The precision study for ${analyteName} did not meet acceptance criteria. The maximum observed CV of ${maxCV.toFixed(2)}% exceeds the CLIA total allowable error of ±${cliaPct}%. `;
      narrative += `Do not rely on this instrument for patient reporting until the cause of imprecision has been identified, corrective action has been taken, and the study is repeated with passing results. `;
      narrative += `Review reagent lot, instrument maintenance, and QC trends for contributing factors.`;
    }
  }

  return `
  <div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${narrative}</p>
  </div>`;
}

// ─── CAL VER HTML report ──────────────────────────────────────────────────────
interface CalVerData {
  levelResults: Array<{
    level: number; assignedValue: number; mean: number;
    pctRecovery: number; obsError: number; passFailMean: string;
    instruments: { [name: string]: { value: number; obsError: number; passFail: string } };
  }>;
  regression: { [key: string]: { slope: number; intercept: number; proportionalBias: number; r2: number; n: number } };
  overallPass: boolean; passCount: number; totalCount: number; summary: string;
}

function buildCalVerHTML(study: Study, results: CalVerData): string {
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const assignedVals = results.levelResults.map(r => r.assignedValue);
  const recoveries   = results.levelResults.map(r => r.pctRecovery);

  // Charts
  const scatterPoints = results.levelResults.map(r => ({
    x: r.assignedValue,
    y: instrumentNames[0] && r.instruments[instrumentNames[0]] ? r.instruments[instrumentNames[0]].value : r.mean
  }));
  const scatterSvg = scatterSVG(scatterPoints.map(p => p.x), scatterPoints.map(p => p.y), "Assigned Value", "Measured", "Scatter Plot", true);
  const recoverySvg = recoveryPlotSVG(assignedVals, recoveries, study.cliaAllowableError);

  // Linearity summary table
  const linRows = Object.entries(results.regression).map(([name, reg]) => {
    const r = Math.sqrt(reg.r2);
    const biasColor = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? PASS : FAIL;
    const biasClass = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "pass" : "fail";
    return `<tr>
      <td>${name}</td>
      <td class="text-right">${reg.n}</td>
      <td class="text-right">${reg.slope.toFixed(4)}</td>
      <td class="text-right">${reg.intercept.toFixed(4)}</td>
      <td class="text-right ${biasClass}">${(reg.proportionalBias * 100).toFixed(2)}%</td>
      <td class="text-right">${r.toFixed(4)}</td>
      <td class="text-right">${reg.r2.toFixed(4)}</td>
    </tr>`;
  }).join("");

  // Statistical table
  const instrHeaders = instrumentNames.map(n => `<th class="text-right">${n}</th>`).join("");
  const dataRows = results.levelResults.map((r, ri) => {
    const instrCells = instrumentNames.map(n => {
      const v = r.instruments[n];
      return v ? `<td class="text-right">${v.value.toFixed(3)}</td>` : `<td class="text-right">—</td>`;
    }).join("");
    const pfClass = r.passFailMean === "Pass" ? "pass" : "fail";
    return `<tr class="${ri % 2 === 1 ? "stripe" : ""}">
      <td>L${r.level}</td>
      <td class="text-right">${r.assignedValue.toFixed(3)}</td>
      <td class="text-right">${r.mean.toFixed(3)}</td>
      <td class="text-right">${r.pctRecovery.toFixed(1)}%</td>
      <td class="text-right">${(r.obsError * 100).toFixed(2)}%</td>
      <td class="text-right ${pfClass}">${r.passFailMean}</td>
      ${instrCells}
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  /* Page numbering */
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study)}

  <div class="section-heading">Calibration Verification / Linearity</div>
  <div class="charts">${scatterSvg}${recoverySvg}</div>

  <hr class="divider">
  <div class="section-label">Linearity Summary</div>
  <table>
    <thead><tr>
      <th></th><th class="text-right">N</th><th class="text-right">Slope</th>
      <th class="text-right">Intercept</th><th class="text-right">Prop. Bias</th>
      <th class="text-right">R</th><th class="text-right">R²</th>
    </tr></thead>
    <tbody>${linRows}</tbody>
  </table>

  ${narrativeHTML("cal_ver", results, study.cliaAllowableError, study.testName)}

  ${signatureHTML()}

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results</div>
    <table>
      <thead><tr>
        <th></th><th class="text-right">Assigned</th><th class="text-right">Mean</th>
        <th class="text-right">% Rec</th><th class="text-right">Obs Err</th>
        <th class="text-right">Pass?</th>${instrHeaders}
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError)}
  </div>

  ${supportingPageHTML(study, instrumentNames)}
  </body></html>`;
}

// ─── METHOD COMP HTML report ──────────────────────────────────────────────────
interface MethodCompData {
  levelResults: Array<{
    level: number; referenceValue: number;
    instruments: { [name: string]: { value: number; difference: number; pctDifference: number; passFail: string } };
  }>;
  regression: { [key: string]: { slope: number; intercept: number; proportionalBias: number; r2: number; n: number; see: number; slopeLo?: number; slopeHi?: number; interceptLo?: number; interceptHi?: number } };
  blandAltman: { [key: string]: { meanDiff: number; sdDiff: number; loa_upper: number; loa_lower: number; pctMeanDiff: number } };
  overallPass: boolean; passCount: number; totalCount: number;
  xRange: { min: number; max: number };
  yRange: { [name: string]: { min: number; max: number } };
  summary: string;
}

function buildMethodCompHTML(study: Study, results: MethodCompData): string {
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const firstInst = instrumentNames[0];

  // Chart data
  const xVals = results.levelResults.map(r => r.referenceValue);
  const yVals = results.levelResults.filter(r => r.instruments[firstInst]).map(r => r.instruments[firstInst].value);
  const corrSvg = scatterSVG(xVals, yVals.length ? yVals : xVals, "Reference Method", "Test Method", "Correlation", true);

  const baEntry = results.blandAltman[firstInst];
  const avgs = results.levelResults.filter(r => r.instruments[firstInst]).map(r => (r.referenceValue + r.instruments[firstInst].value) / 2);
  const pctDiffs = results.levelResults.filter(r => r.instruments[firstInst]).map(r => r.instruments[firstInst].pctDifference);
  const baSvg = blandAltmanSVG(avgs, pctDiffs, study.cliaAllowableError, baEntry?.pctMeanDiff ?? 0, firstInst);

  // Supporting statistics (left col / right col layout)
  const demEntry = Object.entries(results.regression).find(([k]) => k.includes("Deming"))?.[1];
  const corrCoef = demEntry ? Math.sqrt(demEntry.r2).toFixed(4) : "—";
  const xMeanVal = ((results.xRange.min + results.xRange.max) / 2).toFixed(3);

  const suppStatsLeft = [
    ["Corr Coef (R):", corrCoef],
    ["Bias:", baEntry ? baEntry.meanDiff.toFixed(3) : "—"],
    ["X Mean ± SD:", xMeanVal],
    ["Std Dev Diffs:", baEntry ? baEntry.sdDiff.toFixed(3) : "—"],
  ];
  const suppStatsRight = [
    ["Points (Plotted/Total):", `${results.levelResults.length}/${results.levelResults.length}`],
    ["X Result Range:", `${results.xRange.min.toFixed(3)} to ${results.xRange.max.toFixed(3)}`],
    ...instrumentNames.filter(n => results.yRange[n]).map(n => [`${n} Range:`, `${results.yRange[n].min.toFixed(3)} to ${results.yRange[n].max.toFixed(3)}`]),
  ];

  const maxRows = Math.max(suppStatsLeft.length, suppStatsRight.length);
  let suppRows = "";
  for (let i = 0; i < maxRows; i++) {
    const l = suppStatsLeft[i] || ["", ""];
    const r = suppStatsRight[i] || ["", ""];
    suppRows += `<tr>
      <td style="color:${MUTED};font-weight:700;width:22%">${l[0]}</td><td style="width:26%">${l[1]}</td>
      <td style="color:${MUTED};font-weight:700;width:22%">${r[0]}</td><td>${r[1]}</td>
    </tr>`;
  }

  // Regression table
  const regRows = Object.entries(results.regression).map(([name, reg]) => {
    const shortName = name.includes("Deming") ? "Deming" : "OLS";
    const slopeStr = reg.slopeLo !== undefined ? `${reg.slope.toFixed(4)} (${reg.slopeLo.toFixed(3)}-${reg.slopeHi!.toFixed(3)})` : reg.slope.toFixed(4);
    const intStr = reg.interceptLo !== undefined ? `${reg.intercept.toFixed(4)} (${reg.interceptLo.toFixed(3)}-${reg.interceptHi!.toFixed(3)})` : reg.intercept.toFixed(4);
    const biasClass = Math.abs(reg.proportionalBias) < study.cliaAllowableError ? "pass" : "fail";
    return `<tr>
      <td>${shortName}</td>
      <td class="text-right">${reg.n}</td>
      <td class="text-right">${slopeStr}</td>
      <td class="text-right">${intStr}</td>
      <td class="text-right">${reg.see.toFixed(4)}</td>
      <td class="text-right ${biasClass}">${(reg.proportionalBias * 100).toFixed(2)}%</td>
      <td class="text-right">${Math.sqrt(reg.r2).toFixed(4)}</td>
      <td class="text-right">${reg.r2.toFixed(4)}</td>
    </tr>`;
  }).join("");

  // Bland-Altman summary table
  const baRows = Object.entries(results.blandAltman).map(([name, ba], bi) => {
    const biasClass = Math.abs(ba.pctMeanDiff) < study.cliaAllowableError * 100 ? "pass" : "fail";
    return `<tr class="${bi % 2 === 1 ? "stripe" : ""}">
      <td>${name}</td>
      <td class="text-right">${ba.meanDiff.toFixed(4)}</td>
      <td class="text-right ${biasClass}">${ba.pctMeanDiff.toFixed(2)}%</td>
      <td class="text-right">${ba.sdDiff.toFixed(4)}</td>
      <td class="text-right">${ba.loa_lower.toFixed(4)}</td>
      <td class="text-right">${ba.loa_upper.toFixed(4)}</td>
    </tr>`;
  }).join("");

  // Level-by-level table
  const instrHeaders = instrumentNames.flatMap(n => [
    `<th class="text-right">${n}</th>`,
    `<th class="text-right">Bias</th>`,
    `<th class="text-right">% Diff</th>`,
    `<th class="text-right">Pass?</th>`,
  ]).join("");

  const levelRows = results.levelResults.map((r, ri) => {
    const instrCells = instrumentNames.flatMap(n => {
      const v = r.instruments[n];
      if (!v) return [`<td>—</td>`, `<td>—</td>`, `<td>—</td>`, `<td>—</td>`];
      const pfClass = v.passFail === "Pass" ? "pass" : "fail";
      return [
        `<td class="text-right">${v.value.toFixed(3)}</td>`,
        `<td class="text-right">${v.difference.toFixed(3)}</td>`,
        `<td class="text-right">${v.pctDifference.toFixed(2)}%</td>`,
        `<td class="text-right ${pfClass}">${v.passFail}</td>`,
      ];
    }).join("");
    return `<tr class="${ri % 2 === 1 ? "stripe" : ""}">
      <td>L${r.level}</td>
      <td class="text-right">${r.referenceValue.toFixed(3)}</td>
      ${instrCells}
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study)}

  <div class="section-heading">Correlation / Method Comparison</div>
  <div class="charts">${corrSvg}${baSvg}</div>

  <hr class="divider">
  <div class="section-label">Supporting Statistics</div>
  <table style="font-size:8pt"><tbody>${suppRows}</tbody></table>

  <hr class="divider" style="margin-top:8px">
  <div class="section-label">Regression Analysis</div>
  <table>
    <thead><tr>
      <th>Method</th><th class="text-right">N</th><th class="text-right">Slope (95% CI)</th>
      <th class="text-right">Intercept (95% CI)</th><th class="text-right">SEE</th>
      <th class="text-right">Prop. Bias</th><th class="text-right">R</th><th class="text-right">R²</th>
    </tr></thead>
    <tbody>${regRows}</tbody>
  </table>
  <div style="font-size:6.5pt;color:${MUTED};margin-top:3px">95% Confidence Intervals shown in parentheses (OLS only)</div>

  <hr class="divider" style="margin-top:8px">
  <div class="section-label">Bland-Altman Bias Summary</div>
  <table>
    <thead><tr>
      <th>Instrument</th><th class="text-right">Mean Bias</th><th class="text-right">Mean % Bias</th>
      <th class="text-right">SD of Diff</th><th class="text-right">95% LoA Lower</th><th class="text-right">95% LoA Upper</th>
    </tr></thead>
    <tbody>${baRows}</tbody>
  </table>

  ${narrativeHTML("method_comp", results, study.cliaAllowableError, study.testName)}

  ${signatureHTML()}

  <div class="stats-section">
    <div class="section-label">Level-by-Level Comparison Results</div>
    <div style="font-size:7pt;font-weight:700;color:${MUTED};margin-bottom:3px">${firstInst}</div>
    <table>
      <thead><tr>
        <th>Level</th><th class="text-right">Reference</th>${instrHeaders}
      </tr></thead>
      <tbody>${levelRows}</tbody>
    </table>
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError)}
  </div>

  ${supportingPageHTML(study, instrumentNames)}
  </body></html>`;
}

// ─── PRECISION HTML report ───────────────────────────────────────────────────
function buildPrecisionHTML(study: Study, results: any): string {
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const cliaCV = (study.cliaAllowableError * 100).toFixed(1);
  const isAdvanced = results.mode === "advanced";

  const summaryRows = results.levelResults.map((r: any, i: number) => {
    const pfClass = r.passFail === "Pass" ? "pass" : "fail";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${r.levelName}</td>
      <td class="text-right">${r.n}</td>
      <td class="text-right">${r.mean.toFixed(3)}</td>
      <td class="text-right">${r.sd.toFixed(3)}</td>
      <td class="text-right">${r.cv.toFixed(2)}%</td>
      <td class="text-right">±${cliaCV}%</td>
      <td class="text-right ${pfClass}">${r.passFail}</td>
    </tr>`;
  }).join("");

  const anovaSection = isAdvanced ? `
    <hr class="divider" style="margin-top:8px">
    <div class="section-label">ANOVA Precision Components</div>
    <table>
      <thead><tr>
        <th>Level</th>
        <th class="text-right">Within-Run SD</th><th class="text-right">Within-Run CV%</th>
        <th class="text-right">Between-Run CV%</th>
        <th class="text-right">Between-Day CV%</th>
        <th class="text-right">Total CV%</th>
      </tr></thead>
      <tbody>${results.levelResults.map((r: any, i: number) => `
        <tr class="${i % 2 === 1 ? "stripe" : ""}">
          <td>${r.levelName}</td>
          <td class="text-right">${r.withinRunSD?.toFixed(4) ?? "—"}</td>
          <td class="text-right">${r.withinRunCV?.toFixed(2) ?? "—"}%</td>
          <td class="text-right">${r.betweenRunCV?.toFixed(2) ?? "—"}%</td>
          <td class="text-right">${r.betweenDayCV?.toFixed(2) ?? "—"}%</td>
          <td class="text-right" style="font-weight:700">${r.totalCV?.toFixed(2) ?? "—"}%</td>
        </tr>`).join("")}
      </tbody>
    </table>` : "";

  const dataPoints = JSON.parse((study as any).dataPoints || "[]");
  const valuesSection = results.levelResults.map((r: any, li: number) => {
    const vals: number[] = dataPoints[li]?.values || [];
    const filtered = vals.filter((v: number) => !isNaN(v));
    if (!filtered.length) return "";
    const rows = [];
    for (let i = 0; i < filtered.length; i += 10) {
      const chunk = filtered.slice(i, i + 10);
      rows.push(`<tr class="${(i / 10) % 2 === 1 ? "stripe" : ""}">${chunk.map((v: number) => `<td class="text-right" style="font-size:7pt">${v}</td>`).join("")}</tr>`);
    }
    return `
      <div style="margin-bottom:8px">
        <div style="font-size:7.5pt;font-weight:700;color:${MUTED};margin-bottom:3px">${r.levelName}</div>
        <table style="font-size:7pt"><tbody>${rows.join("")}</tbody></table>
      </div>`;
  }).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study)}

  <div class="section-heading">Precision Verification (EP15)</div>

  <hr class="divider">
  <div class="section-label">Precision Summary</div>
  <table>
    <thead><tr>
      <th>Level</th><th class="text-right">N</th><th class="text-right">Mean</th>
      <th class="text-right">SD</th><th class="text-right">CV%</th>
      <th class="text-right">Allow CV%</th><th class="text-right">Pass?</th>
    </tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>

  ${anovaSection}

  ${narrativeHTML("precision", results, study.cliaAllowableError, study.testName)}

  ${signatureHTML()}

  <div class="stats-section">
    <div class="section-label">Individual Measurements</div>
    ${valuesSection}
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError)}
  </div>

  ${supportingPageHTML(study, instrumentNames)}
  </body></html>`;
}

// ─── Error Index Plot SVG ────────────────────────────────────────────────────
function errorIndexSVG(
  xVals: number[], eiVals: number[], title: string, xLabel: string, w = 320, h = 220
): string {
  if (!xVals.length) return `<svg width="${w}" height="${h}"></svg>`;
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const padX = (Math.max(...xVals) - Math.min(...xVals)) * 0.1 || 1;
  const minEI = Math.min(...eiVals, -1.5), maxEI = Math.max(...eiVals, 1.5);
  const xMin = Math.min(...xVals) - padX, xMax = Math.max(...xVals) + padX;
  const cx = (v: number) => ml + ((v - xMin) / (xMax - xMin)) * pw;
  const cy = (v: number) => mt + ph - ((v - minEI) / (maxEI - minEI)) * ph;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const gx = ml + (i / 4) * pw, gy = mt + (i / 4) * ph;
    grid += `<line x1="${gx}" y1="${mt}" x2="${gx}" y2="${mt + ph}" stroke="#dde1e6" stroke-width="0.6"/>`;
    grid += `<line x1="${ml}" y1="${gy}" x2="${ml + pw}" y2="${gy}" stroke="#dde1e6" stroke-width="0.6"/>`;
  }

  const zeroLine = `<line x1="${ml}" y1="${cy(0)}" x2="${ml + pw}" y2="${cy(0)}" stroke="#a0a8b0" stroke-width="0.8"/>`;
  const upper = `<line x1="${ml}" y1="${cy(1)}" x2="${ml + pw}" y2="${cy(1)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const lower = `<line x1="${ml}" y1="${cy(-1)}" x2="${ml + pw}" y2="${cy(-1)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const dots = xVals.map((x, i) => {
    const pass = Math.abs(eiVals[i]) <= 1.0;
    return `<circle cx="${cx(x)}" cy="${cy(eiVals[i])}" r="4" fill="${pass ? "#0e8a82" : "#dc5050"}" opacity="0.85"/>`;
  }).join("");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">${title}</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${grid}${zeroLine}${upper}${lower}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#646e78">${xLabel}</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">Error Index</text>
  <text x="${ml + pw + 4}" y="${cy(1) + 3}" font-size="7" fill="#dc5050">+1.0</text>
  <text x="${ml + pw + 4}" y="${cy(-1) + 3}" font-size="7" fill="#dc5050">-1.0</text>
</svg>`;
}

// ─── Difference Plot SVG (for Lot-to-Lot) ────────────────────────────────────
function differencePlotSVG(
  specimens: number[], pctDiffs: number[], tea: number, w = 320, h = 220
): string {
  if (!specimens.length) return `<svg width="${w}" height="${h}"></svg>`;
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const teaPct = tea * 100;
  const minY = Math.min(...pctDiffs, -teaPct - 2), maxY = Math.max(...pctDiffs, teaPct + 2);
  const cx = (v: number) => ml + ((v - 0.5) / (specimens.length + 0.5)) * pw;
  const cy = (v: number) => mt + ph - ((v - minY) / (maxY - minY)) * ph;

  let grid = "";
  for (let i = 0; i <= 4; i++) grid += `<line x1="${ml}" y1="${mt + (i / 4) * ph}" x2="${ml + pw}" y2="${mt + (i / 4) * ph}" stroke="#dde1e6" stroke-width="0.6"/>`;

  const zeroLine = `<line x1="${ml}" y1="${cy(0)}" x2="${ml + pw}" y2="${cy(0)}" stroke="#a0a8b0" stroke-width="0.8"/>`;
  const upper = `<line x1="${ml}" y1="${cy(teaPct)}" x2="${ml + pw}" y2="${cy(teaPct)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const lower = `<line x1="${ml}" y1="${cy(-teaPct)}" x2="${ml + pw}" y2="${cy(-teaPct)}" stroke="#dc5050" stroke-width="1.2"/>`;
  const dots = specimens.map((s, i) => {
    const pass = Math.abs(pctDiffs[i]) <= teaPct;
    return `<circle cx="${cx(s)}" cy="${cy(pctDiffs[i])}" r="4" fill="${pass ? "#0e8a82" : "#dc5050"}" opacity="0.85"/>`;
  }).join("");

  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">Difference Plot</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${grid}${zeroLine}${upper}${lower}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="#646e78">Specimen Number</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">% Diff</text>
</svg>`;
}

// ─── LOT-TO-LOT HTML report ──────────────────────────────────────────────────
function buildLotToLotHTML(study: Study, results: any): string {
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const rawData = JSON.parse(study.dataPoints);
  const teaPct = (study.cliaAllowableError * 100).toFixed(1);

  let cohortSections = "";
  for (const cohort of results.cohorts) {
    const currentVals = cohort.specimens.map((s: any) => s.currentLot);
    const newVals = cohort.specimens.map((s: any) => s.newLot);
    const pctDiffs = cohort.specimens.map((s: any) => s.pctDifference);
    const specimenNums = cohort.specimens.map((_: any, i: number) => i + 1);

    const scatter = scatterSVG(currentVals, newVals, "Current Lot", "New Lot", `${cohort.cohort} — Scatter`, true);
    const diffPlot = differencePlotSVG(specimenNums, pctDiffs, study.cliaAllowableError);

    const summaryRows = `
      <tr><td style="color:${MUTED};font-weight:700">N</td><td>${cohort.n}</td>
          <td style="color:${MUTED};font-weight:700">Mean Bias</td><td>${cohort.meanPctDiff.toFixed(2)}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">SD</td><td>${cohort.sdPctDiff.toFixed(2)}%</td>
          <td style="color:${MUTED};font-weight:700">Mean |%Diff|</td><td>${cohort.meanAbsPctDiff.toFixed(2)}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Max |%Diff|</td><td>${cohort.maxAbsPctDiff.toFixed(2)}%</td>
          <td style="color:${MUTED};font-weight:700">Coverage</td><td class="${cohort.coverage >= 90 ? "pass" : "fail"}">${cohort.coverage.toFixed(0)}%</td></tr>
    `;

    const dataRows = cohort.specimens.map((s: any, i: number) => {
      const pfClass = s.passFail === "Pass" ? "pass" : "fail";
      return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
        <td>${s.specimenId}</td>
        <td class="text-right">${s.currentLot.toFixed(3)}</td>
        <td class="text-right">${s.newLot.toFixed(3)}</td>
        <td class="text-right">${s.pctDifference.toFixed(2)}%</td>
        <td class="text-right ${pfClass}">${s.passFail}</td>
      </tr>`;
    }).join("");

    cohortSections += `
      <div class="section-label">${cohort.cohort} Cohort</div>
      <div class="charts">${scatter}${diffPlot}</div>
      <hr class="divider">
      <table style="font-size:8pt;margin-bottom:8px"><tbody>${summaryRows}</tbody></table>
      <div class="section-label">${cohort.cohort} — ${cohort.pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'}</div>
    `;

    cohortSections += `
      <div class="stats-section">
        <div class="section-label">${cohort.cohort} Cohort — Individual Results</div>
        <table>
          <thead><tr><th>Specimen</th><th class="text-right">Current Lot</th><th class="text-right">New Lot</th><th class="text-right">% Diff</th><th class="text-right">Pass?</th></tr></thead>
          <tbody>${dataRows}</tbody>
        </table>
      </div>
    `;
  }

  const lotInfo = rawData.currentLot ? `<div style="font-size:8pt;margin-bottom:6px">Current Lot: ${rawData.currentLot} · New Lot: ${rawData.newLot} · Analyte: ${rawData.analyte || study.testName} ${rawData.units ? `(${rawData.units})` : ""}</div>` : "";

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study)}
  <div class="section-heading">Lot-to-Lot Verification</div>
  ${lotInfo}
  ${cohortSections}
  ${narrative}
  ${signatureHTML()}
  ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError)}
  ${supportingPageHTML(study, instrumentNames)}
  </body></html>`;
}

// ─── PT/COAG HTML report ─────────────────────────────────────────────────────
function geometricMean(values: number[]): number {
  if (values.length === 0) return 0;
  const logSum = values.reduce((s: number, v: number) => s + Math.log(v), 0);
  return Math.exp(logSum / values.length);
}

function buildPTCoagHTML(study: Study, results: any): string {
  const instrumentNames: string[] = JSON.parse(study.instruments);
  const rawData = JSON.parse(study.dataPoints);
  const { module1, module2, module3 } = results;

  // Module 1 section
  const m1DataRows = module1.specimens.map((s: any, i: number) => {
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${s.id}</td>
      <td class="text-right">${s.pt.toFixed(1)}</td>
      <td class="text-right">${s.inr.toFixed(2)}</td>
      <td class="text-right ${s.ptInRI ? "pass" : "fail"}">${s.ptInRI ? "Yes" : "No"}</td>
      <td class="text-right ${s.inrInRI ? "pass" : "fail"}">${s.inrInRI ? "Yes" : "No"}</td>
    </tr>`;
  }).join("");

  const m1Section = `
    <div class="section-heading">Module 1: Normal Patient Mean & Reference Interval Verification</div>
    <div class="supp-stats">
      <span class="key">N:</span><span>${module1.n}</span>
      <span class="key">Geometric Mean PT:</span><span>${module1.geoMeanPT.toFixed(2)} sec</span>
      <span class="key">Geometric Mean INR:</span><span>${module1.geoMeanINR.toFixed(3)}</span>
      <span class="key">ISI:</span><span>${rawData.module1?.isi ?? "—"}</span>
      <span class="key">PT RI:</span><span>${module1.ptRI.low}–${module1.ptRI.high} sec</span>
      <span class="key">INR RI:</span><span>${module1.inrRI.low}–${module1.inrRI.high}</span>
      <span class="key">PT Outside RI:</span><span class="${module1.ptRIPass ? "pass" : "fail"}">${module1.ptOutsideRI}/${module1.n} (${module1.ptRIPass ? "PASS" : "FAIL"})</span>
      <span class="key">INR Outside RI:</span><span class="${module1.inrRIPass ? "pass" : "fail"}">${module1.inrOutsideRI}/${module1.n} (${module1.inrRIPass ? "PASS" : "FAIL"})</span>
    </div>
  `;

  // Module 2 section — Deming with Error Index
  const m2 = module2;
  const m2Scatter = scatterSVG(
    m2.errorIndexResults.map((r: any) => r.x),
    m2.errorIndexResults.map((r: any) => r.y),
    rawData.module2?.inst1 || instrumentNames[0] || "Inst 1",
    rawData.module2?.inst2 || instrumentNames[1] || "Inst 2",
    "Two-Instrument Correlation", true
  );
  const m2EI = errorIndexSVG(
    m2.errorIndexResults.map((r: any) => r.x),
    m2.errorIndexResults.map((r: any) => r.errorIndex),
    "Error Index Plot", "Concentration (X)"
  );

  const m2DataRows = m2.errorIndexResults.map((r: any, i: number) => {
    const pfClass = r.pass ? "pass" : "fail";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${r.specimenId}</td>
      <td class="text-right">${r.x.toFixed(1)}</td>
      <td class="text-right">${r.y.toFixed(1)}</td>
      <td class="text-right">${r.errorIndex.toFixed(3)}</td>
      <td class="text-right ${pfClass}">${r.pass ? "Pass" : "Fail"}</td>
    </tr>`;
  }).join("");

  const m2Section = `
    <div class="section-heading" style="page-break-before:always">Module 2: Two-Instrument Comparison (Deming Regression)</div>
    <div class="charts">${m2Scatter}${m2EI}</div>
    <hr class="divider">
    <div class="section-label">Deming Regression Statistics</div>
    <table>
      <thead><tr><th>Statistic</th><th class="text-right">Value</th></tr></thead>
      <tbody>
        <tr><td>R (Correlation)</td><td class="text-right">${m2.regression.r.toFixed(4)}</td></tr>
        <tr class="stripe"><td>Slope</td><td class="text-right">${m2.regression.slope.toFixed(4)}</td></tr>
        <tr><td>Intercept</td><td class="text-right">${m2.regression.intercept.toFixed(4)}</td></tr>
        <tr class="stripe"><td>Std Error of Estimate</td><td class="text-right">${m2.regression.see.toFixed(4)}</td></tr>
        <tr><td>N</td><td class="text-right">${m2.regression.n}</td></tr>
        <tr class="stripe"><td>Average Error Index</td><td class="text-right">${m2.averageErrorIndex.toFixed(3)}</td></tr>
        <tr><td>Error Index Range</td><td class="text-right">${m2.errorIndexRange.min.toFixed(3)} to ${m2.errorIndexRange.max.toFixed(3)}</td></tr>
        <tr class="stripe"><td>Coverage (|EI| ≤ 1.0)</td><td class="text-right ${m2.pass ? "pass" : "fail"}">${m2.coverage.toFixed(0)}% (${m2.pass ? "PASS" : "FAIL"})</td></tr>
        <tr><td>TEa</td><td class="text-right">±${(m2.tea * 100).toFixed(0)}%</td></tr>
      </tbody>
    </table>
  `;

  // Module 3 section (if present)
  let m3Section = "";
  if (module3) {
    const m3 = module3;
    const m3Scatter = scatterSVG(
      m3.errorIndexResults.map((r: any) => r.x),
      m3.errorIndexResults.map((r: any) => r.y),
      "Old Lot", "New Lot", "Old vs New Lot Correlation", true
    );
    const m3EI = errorIndexSVG(
      m3.errorIndexResults.map((r: any) => r.x),
      m3.errorIndexResults.map((r: any) => r.errorIndex),
      "Error Index Plot", "Concentration (X)"
    );

    const m3DataRows = m3.errorIndexResults.map((r: any, i: number) => {
      const pfClass = r.pass ? "pass" : "fail";
      return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
        <td>${r.specimenId}</td>
        <td class="text-right">${r.x.toFixed(1)}</td>
        <td class="text-right">${r.y.toFixed(1)}</td>
        <td class="text-right">${r.errorIndex.toFixed(3)}</td>
        <td class="text-right ${pfClass}">${r.pass ? "Pass" : "Fail"}</td>
      </tr>`;
    }).join("");

    m3Section = `
      <div class="section-heading" style="page-break-before:always">Module 3: Old Lot vs New Lot Comparison (Deming Regression)</div>
      <div class="charts">${m3Scatter}${m3EI}</div>
      <hr class="divider">
      <div class="section-label">Deming Regression Statistics</div>
      <table>
        <thead><tr><th>Statistic</th><th class="text-right">Value</th></tr></thead>
        <tbody>
          <tr><td>R (Correlation)</td><td class="text-right">${m3.regression.r.toFixed(4)}</td></tr>
          <tr class="stripe"><td>Slope</td><td class="text-right">${m3.regression.slope.toFixed(4)}</td></tr>
          <tr><td>Intercept</td><td class="text-right">${m3.regression.intercept.toFixed(4)}</td></tr>
          <tr class="stripe"><td>Std Error of Estimate</td><td class="text-right">${m3.regression.see.toFixed(4)}</td></tr>
          <tr><td>N</td><td class="text-right">${m3.regression.n}</td></tr>
          <tr class="stripe"><td>Coverage (|EI| ≤ 1.0)</td><td class="text-right ${m3.pass ? "pass" : "fail"}">${m3.coverage.toFixed(0)}% (${m3.pass ? "PASS" : "FAIL"})</td></tr>
        </tbody>
      </table>
      <div class="stats-section">
        <div class="section-label">Module 3 — Experimental Results</div>
        <table>
          <thead><tr><th>Specimen</th><th class="text-right">Old Lot</th><th class="text-right">New Lot</th><th class="text-right">Error Index</th><th class="text-right">Pass?</th></tr></thead>
          <tbody>${m3DataRows}</tbody>
        </table>
      </div>
    `;
  } else {
    m3Section = `<div class="section-heading" style="page-break-before:always">Module 3: Old Lot vs New Lot Comparison</div>
      <p style="font-size:9pt;color:${MUTED};margin:8px 0">Module 3 skipped — single analyzer lab.</p>`;
  }

  // Narrative
  const overallVerdict = results.overallPass ? "PASS" : "FAIL";
  const narrativeText = results.summary;
  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${narrativeText}</p>
  </div>`;

  // Overall verdict
  const verdictHtml = `<div class="verdict ${results.overallPass ? "pass-bg" : "fail-bg"}" style="margin-top:12px">
    Overall: ${overallVerdict} — Module 1: ${module1.pass ? "PASS" : "FAIL"}, Module 2: ${module2.pass ? "PASS" : "FAIL"}${module3 ? `, Module 3: ${module3.pass ? "PASS" : "FAIL"}` : ""}
  </div>`;

  const reagentInfo = rawData.reagentLot ? `<div style="font-size:8pt;margin-bottom:6px">Reagent Lot: ${rawData.reagentLot} · Expiration: ${rawData.reagentExp || "—"} · ISI: ${rawData.module1?.isi ?? "—"}</div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study)}
  <div class="section-heading">PT/Coag New Lot Validation</div>
  ${reagentInfo}

  ${m1Section}

  ${narrative}
  ${signatureHTML()}

  ${m2Section}
  <div class="stats-section">
    <div class="section-label">Module 2 — Experimental Results</div>
    <table>
      <thead><tr><th>Specimen</th><th class="text-right">Inst 1</th><th class="text-right">Inst 2</th><th class="text-right">Error Index</th><th class="text-right">Pass?</th></tr></thead>
      <tbody>${m2DataRows}</tbody>
    </table>
  </div>

  ${m3Section}

  <div class="stats-section">
    <div class="section-label">Module 1 — Individual Results</div>
    <table>
      <thead><tr><th>Specimen</th><th class="text-right">PT (sec)</th><th class="text-right">INR</th><th class="text-right">PT in RI?</th><th class="text-right">INR in RI?</th></tr></thead>
      <tbody>${m1DataRows}</tbody>
    </table>
    ${verdictHtml}
  </div>

  ${supportingPageHTML(study, instrumentNames)}
  </body></html>`;
}

// ─── Puppeteer renderer ───────────────────────────────────────────────────────
let _browser: any = null;
async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      headless: true,
    });
  }
  return _browser;
}

const today = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaCheck is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed laboratory director and do not constitute medical advice.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaCheck by Veritas Lab Services &middot; veritaslabservices.com &middot; Generated <span class="date"></span></span>
      <span>Page <span class="pageNumber"></span></span>
    </div>
  </div>
</div>`;

// ─── QC RANGE ESTABLISHMENT HTML ──────────────────────────────────────────────
function buildQCRangeHTML(study: Study, results: any): string {
  const r = results;
  const analytes = Array.from(new Set((r.levelResults || []).map((lr: any) => lr.analyte)));
  const tableRows = (r.levelResults || []).map((lr: any) => `
    <tr style="${lr.flagShift ? 'background:#fef2f2;' : ''}">
      <td>${lr.analyzer}</td><td>${lr.analyte}</td><td>${lr.level}</td>
      <td style="text-align:right">${lr.n}</td>
      <td style="text-align:right">${lr.newMean.toFixed(2)}</td>
      <td style="text-align:right">${lr.newSD.toFixed(3)}</td>
      <td style="text-align:right">${lr.cv.toFixed(1)}%</td>
      <td style="text-align:right">${lr.oldMean != null ? lr.oldMean.toFixed(2) : '—'}</td>
      <td style="text-align:right;${lr.flagShift ? 'color:#dc2626;font-weight:600;' : ''}">${lr.pctDiffFromOld != null ? lr.pctDiffFromOld.toFixed(1) + '%' : '—'}${lr.flagShift ? ' ⚠' : ''}</td>
    </tr>`).join("");

  const narrative = `New QC ranges have been established for ${analytes.join(", ")}. ` +
    `Runs were performed across ${r.dateRange?.start || ''} to ${r.dateRange?.end || ''} on ${study.instrument}. ` +
    (r.overallShiftCount > 0 ? `${r.overallShiftCount} of ${r.totalLevels} analyte-level combinations showed >10% shift from previous lot.` : `All means are within 10% of previous lot values.`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
    ${headerHTML(study)}
    ${signatureHTML()}
    ${evalHTML(r.summary, r.overallPass, r.passCount, r.totalCount, study.cliaAllowableError)}
    <div class="narrative-section">
      <div class="eval-title">Narrative Summary</div>
      <div class="eval-text">${narrative}</div>
    </div>
    <div class="eval-text" style="font-size:7.5px;color:#888;margin:8px 0;font-style:italic">Per policy, SD does not change lot to lot — the historical/peer-derived SD should be used for control limits.</div>
    <div style="page-break-before:always"></div>
    ${headerHTML(study)}
    <div class="eval-title" style="margin-top:8px">Statistical Results</div>
    <table class="data-table"><thead><tr>
      <th>Analyzer</th><th>Analyte</th><th>Level</th><th style="text-align:right">N</th>
      <th style="text-align:right">New Mean</th><th style="text-align:right">New SD</th><th style="text-align:right">CV%</th>
      <th style="text-align:right">Old Mean</th><th style="text-align:right">% Diff</th>
    </tr></thead><tbody>${tableRows}</tbody></table>
    ${supportingPageHTML(study, JSON.parse(study.instruments))}
  </body></html>`;
}

// ─── MULTI-ANALYTE LOT COMPARISON HTML ────────────────────────────────────────
function buildMultiAnalyteCoagHTML(study: Study, results: any): string {
  const r = results;
  const rawDP = JSON.parse(study.dataPoints);
  const summaryRows = (r.analyteResults || []).filter((ar: any) => ar.n > 0).map((ar: any) => `
    <tr style="${!ar.pass ? 'background:#fef2f2;' : ''}">
      <td>${ar.analyte}</td><td style="text-align:right">${ar.n}</td>
      <td style="text-align:right">${ar.meanNew.toFixed(2)}</td>
      <td style="text-align:right">${ar.meanOld.toFixed(2)}</td>
      <td style="text-align:right">${ar.meanPctDiff.toFixed(1)}%</td>
      <td style="text-align:right">${ar.sdPctDiff.toFixed(2)}</td>
      <td style="text-align:right">${ar.r.toFixed(4)}</td>
      <td style="text-align:right">${(ar.tea * 100).toFixed(0)}%</td>
      <td style="text-align:center;${ar.pass ? 'color:#059669;' : 'color:#dc2626;'}font-weight:600">${ar.pass ? 'PASS' : 'FAIL'}</td>
    </tr>`).join("");

  const specimenRows = (r.specimens || []).map((s: any) => `
    <tr>
      <td>${s.specimenId}</td>
      <td style="text-align:right">${s.ptNew != null ? s.ptNew.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.ptNewINR != null ? s.ptNewINR.toFixed(2) : '—'}</td>
      <td style="text-align:right">${s.ptOld != null ? s.ptOld.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.ptPctDiff != null ? s.ptPctDiff.toFixed(1) + '%' : '—'}</td>
      <td style="text-align:right">${s.apttNew != null ? s.apttNew.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.apttOld != null ? s.apttOld.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.apttPctDiff != null ? s.apttPctDiff.toFixed(1) + '%' : '—'}</td>
      <td style="text-align:right">${s.fibNew != null ? s.fibNew.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.fibOld != null ? s.fibOld.toFixed(1) : '—'}</td>
      <td style="text-align:right">${s.fibPctDiff != null ? s.fibPctDiff.toFixed(1) + '%' : '—'}</td>
    </tr>`).join("");

  const sampleLabel = rawDP.sampleType === "normal" ? "normal" : "random";
  const validAnalytes = (r.analyteResults || []).filter((ar: any) => ar.n > 0);
  const narrative = `${(r.specimens || []).length} ${sampleLabel} specimens were compared between old lot and new lot on ${study.instrument}. ` +
    validAnalytes.map((ar: any) => `${ar.analyte} showed a mean difference of ${ar.meanPctDiff.toFixed(1)}% (${ar.pass ? 'PASS' : 'FAIL'} at ${(ar.tea * 100).toFixed(0)}% TEa).`).join(" ");

  const isiNote = r.ptINRValidation ? `<div class="eval-text" style="margin:8px 0;font-size:7.5px">${r.ptINRValidation.isiCheck}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
    ${headerHTML(study)}
    ${signatureHTML()}
    ${evalHTML(r.summary, r.overallPass, r.passCount, r.totalCount, study.cliaAllowableError)}
    <div class="narrative-section">
      <div class="eval-title">Narrative Summary</div>
      <div class="eval-text">${narrative}</div>
    </div>
    ${isiNote}
    <div style="page-break-before:always"></div>
    ${headerHTML(study)}
    <div class="eval-title" style="margin-top:8px">Per-Analyte Summary</div>
    <table class="data-table"><thead><tr>
      <th>Analyte</th><th style="text-align:right">N</th><th style="text-align:right">Mean New</th>
      <th style="text-align:right">Mean Old</th><th style="text-align:right">Mean %Diff</th>
      <th style="text-align:right">SD</th><th style="text-align:right">R</th>
      <th style="text-align:right">TEa</th><th style="text-align:center">Result</th>
    </tr></thead><tbody>${summaryRows}</tbody></table>
    <div class="eval-title" style="margin-top:12px">Specimen Data</div>
    <table class="data-table" style="font-size:6.5px"><thead><tr>
      <th>ID</th><th style="text-align:right">New PT</th><th style="text-align:right">INR</th>
      <th style="text-align:right">Old PT</th><th style="text-align:right">PT %Diff</th>
      <th style="text-align:right">New APTT</th><th style="text-align:right">Old APTT</th>
      <th style="text-align:right">APTT %Diff</th><th style="text-align:right">New Fib</th>
      <th style="text-align:right">Old Fib</th><th style="text-align:right">Fib %Diff</th>
    </tr></thead><tbody>${specimenRows}</tbody></table>
    ${supportingPageHTML(study, JSON.parse(study.instruments))}
  </body></html>`;
}

// ─── CUMSUM PDF GENERATOR ─────────────────────────────────────────────────────
export async function generateCumsumPDF(tracker: any, entries: any[], currentSpecimens?: any[]): Promise<Buffer> {
  const historyRows = entries.map((e: any) => `
    <tr style="${e.verdict === 'ACTION REQUIRED' ? 'background:#fef2f2;' : e.verdict === 'ACCEPT' ? 'background:#f0fdf4;' : ''}">
      <td>${e.year}</td>
      <td>${e.old_lot_number || '—'}</td>
      <td>${e.new_lot_number || '—'}</td>
      <td style="text-align:right">${e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : '—'}</td>
      <td style="text-align:right">${e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : '—'}</td>
      <td style="text-align:right">${e.difference != null ? (e.difference >= 0 ? '+' : '') + Number(e.difference).toFixed(1) : '—'}</td>
      <td style="text-align:right;font-weight:600">${e.cumsum != null ? Number(e.cumsum).toFixed(1) : '—'}</td>
      <td style="${e.verdict === 'ACTION REQUIRED' ? 'color:#dc2626;font-weight:600' : e.verdict === 'ACCEPT' ? 'color:#059669;font-weight:600' : ''}">${e.verdict || '—'}</td>
    </tr>`).join("");

  let specimenSection = '';
  if (currentSpecimens && currentSpecimens.length > 0) {
    const specRows = currentSpecimens.map((s: any) => `<tr><td>${s.specimenId}</td><td style="text-align:right">${s.oldLot || '—'}</td><td style="text-align:right">${s.newLot || '—'}</td></tr>`).join("");
    specimenSection = `
      <div style="page-break-before:always"></div>
      <div style="font-size:9px;font-weight:600;margin:10px 0 6px">Current Lot Change — Specimen Data</div>
      <table class="data-table"><thead><tr><th>Specimen ID</th><th style="text-align:right">Old Lot (sec)</th><th style="text-align:right">New Lot (sec)</th></tr></thead><tbody>${specRows}</tbody></table>`;
  }

  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const currentVerdict = lastEntry ? lastEntry.verdict : 'N/A';
  const currentCumsum = lastEntry ? Number(lastEntry.cumsum).toFixed(1) : '0.0';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
    <div class="report-header">
      <div>
        <div class="logo">VeritaCheck™</div>
        <div class="logo-sub">by Veritas Lab Services · veritaslabservices.com</div>
      </div>
      <div class="header-right">Instrument: ${tracker.instrument_name}</div>
    </div>
    <div class="report-title">CUMSUM Tracker — ${tracker.instrument_name} (${tracker.analyte})</div>
    <hr class="divider">
    <div class="signature-block">
      <div class="accepted-label">Accepted by:</div>
      <div class="sig-lines">
        <div class="sig-line" style="flex:2"><div class="line"></div><div class="label">Signature / Name &amp; Title</div></div>
        <div class="sig-line sig-date"><div class="line"></div><div class="label">Date</div></div>
      </div>
    </div>
    <div class="eval-section">
      <hr class="divider">
      <div class="eval-title">Current Status</div>
      <div class="eval-text">Current CumSum: <strong>${currentCumsum} sec</strong> — Verdict: <strong style="${currentVerdict === 'ACTION REQUIRED' ? 'color:#dc2626' : currentVerdict === 'ACCEPT' ? 'color:#059669' : ''}">${currentVerdict}</strong></div>
      <div class="eval-text" style="margin-top:4px">Threshold: |CumSum| ≤ 7.0 seconds → ACCEPT. Exceeds threshold → ACTION REQUIRED (new Heparin Response Curve needed).</div>
      <div class="verdict" style="background:${currentVerdict === 'ACTION REQUIRED' ? '#fef2f2;border-color:#fca5a5;color:#dc2626' : '#f0fdf4;border-color:#86efac;color:#059669'}">${currentVerdict === 'ACTION REQUIRED' ? '✗ ACTION REQUIRED' : currentVerdict === 'ACCEPT' ? '✓ ACCEPT' : currentVerdict}</div>
    </div>
    <div class="eval-title" style="margin-top:12px">CUMSUM History</div>
    <table class="data-table"><thead><tr>
      <th>Year</th><th>Old Lot</th><th>New Lot</th>
      <th style="text-align:right">Old GeoMean</th><th style="text-align:right">New GeoMean</th>
      <th style="text-align:right">New−Old</th><th style="text-align:right">CumSum</th><th>Verdict</th>
    </tr></thead><tbody>${historyRows}</tbody></table>
    ${specimenSection}
  </body></html>`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

export async function generatePDFBuffer(study: Study, results: any): Promise<Buffer> {
  const html = study.studyType === "cal_ver"
    ? buildCalVerHTML(study, results)
    : study.studyType === "precision"
    ? buildPrecisionHTML(study, results)
    : study.studyType === "lot_to_lot"
    ? buildLotToLotHTML(study, results)
    : study.studyType === "pt_coag"
    ? buildPTCoagHTML(study, results)
    : study.studyType === "qc_range"
    ? buildQCRangeHTML(study, results)
    : study.studyType === "multi_analyte_coag"
    ? buildMultiAnalyteCoagHTML(study, results)
    : buildMethodCompHTML(study, results);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ─── VERITASCAN PDF GENERATOR ────────────────────────────────────────────────

interface VeritaScanPDFItem {
  id: number;
  domain: string;
  question: string;
  tjc: string;
  cap: string;
  cfr: string;
  status: string;
  notes?: string;
  owner?: string;
  due_date?: string;
}

interface VeritaScanPDFData {
  scanName: string;
  createdAt: string;
  updatedAt: string;
  items: VeritaScanPDFItem[];
}

const SCAN_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  "Compliant":        { bg: "#dcfce7", fg: "#166534" },
  "Needs Attention":  { bg: "#fef9c3", fg: "#854d0e" },
  "Immediate Action": { bg: "#fee2e2", fg: "#991b1b" },
  "N/A":              { bg: "#f1f5f9", fg: "#475569" },
  "Not Assessed":     { bg: "#f8fafc", fg: "#94a3b8" },
};

function buildVeritaScanExecutiveHTML(data: VeritaScanPDFData): string {
  const { scanName, createdAt, updatedAt, items } = data;
  const total = items.length;
  const compliant = items.filter(i => i.status === "Compliant").length;
  const needsAttention = items.filter(i => i.status === "Needs Attention").length;
  const immediateAction = items.filter(i => i.status === "Immediate Action").length;
  const na = items.filter(i => i.status === "N/A").length;
  const notAssessed = items.filter(i => i.status === "Not Assessed").length;
  const assessed = total - notAssessed;
  const pctComplete = total > 0 ? Math.round((assessed / total) * 100) : 0;
  const applicableItems = total - na;
  const complianceRate = applicableItems > 0 ? Math.round((compliant / applicableItems) * 100) : 0;

  // Group by domain
  const domainMap = new Map<string, VeritaScanPDFItem[]>();
  for (const item of items) {
    const arr = domainMap.get(item.domain) || [];
    arr.push(item);
    domainMap.set(item.domain, arr);
  }

  const domainSummaryRows = Array.from(domainMap.entries()).map(([domain, domItems]) => {
    const dTotal = domItems.length;
    const dCompliant = domItems.filter(i => i.status === "Compliant").length;
    const dNeeds = domItems.filter(i => i.status === "Needs Attention").length;
    const dImmediate = domItems.filter(i => i.status === "Immediate Action").length;
    const dNA = domItems.filter(i => i.status === "N/A").length;
    const dNotAssessed = domItems.filter(i => i.status === "Not Assessed").length;
    const dApplicable = dTotal - dNA;
    const dRate = dApplicable > 0 ? Math.round((dCompliant / dApplicable) * 100) : 100;
    const rateColor = dRate >= 90 ? PASS : dRate >= 70 ? "#d97706" : FAIL;
    return `<tr>
      <td style="font-weight:600">${domain}</td>
      <td class="text-center">${dTotal}</td>
      <td class="text-center" style="color:${PASS};font-weight:600">${dCompliant}</td>
      <td class="text-center" style="color:#d97706;font-weight:600">${dNeeds}</td>
      <td class="text-center" style="color:${FAIL};font-weight:600">${dImmediate}</td>
      <td class="text-center">${dNA}</td>
      <td class="text-center">${dNotAssessed}</td>
      <td class="text-center" style="color:${rateColor};font-weight:700">${dRate}%</td>
    </tr>`;
  }).join("");

  // Action items — only Needs Attention and Immediate Action
  const actionItems = items.filter(i => i.status === "Needs Attention" || i.status === "Immediate Action");
  const actionRows = actionItems.length > 0
    ? actionItems.map((item, idx) => {
        const sc = SCAN_STATUS_COLORS[item.status] || SCAN_STATUS_COLORS["Not Assessed"];
        return `<tr class="${idx % 2 === 1 ? "stripe" : ""}">
          <td>${item.id}</td>
          <td style="max-width:220px;word-wrap:break-word">${item.question}</td>
          <td><span style="background:${sc.bg};color:${sc.fg};padding:1px 6px;border-radius:3px;font-size:7pt;font-weight:600">${item.status}</span></td>
          <td>${item.owner || "—"}</td>
          <td>${item.due_date || "—"}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="text-center" style="color:${MUTED};padding:12px">No action items — all assessed items are compliant.</td></tr>`;

  const overallColor = complianceRate >= 90 ? PASS : complianceRate >= 70 ? "#d97706" : FAIL;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
    .page-num::after { content: "Page " counter(page); }
    body { counter-reset: page; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: center; }
    .kpi-value { font-size: 20pt; font-weight: 700; line-height: 1.2; }
    .kpi-label { font-size: 7pt; color: ${MUTED}; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px; }
  </style></head><body>
    <div class="report-header">
      <div>
        <div class="logo">VeritaScan™</div>
        <div class="logo-sub">by Veritas Lab Services · veritaslabservices.com</div>
      </div>
      <div class="header-right">Generated ${today()}</div>
    </div>
    <div class="report-title">Executive Compliance Summary</div>
    <div class="report-title-sub">${scanName} · Created ${new Date(createdAt).toLocaleDateString("en-US")} · Last Updated ${new Date(updatedAt).toLocaleDateString("en-US")}</div>
    <hr class="divider">

    <!-- KPI cards -->
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value" style="color:${overallColor}">${complianceRate}%</div><div class="kpi-label">Compliance Rate</div></div>
      <div class="kpi-card"><div class="kpi-value">${pctComplete}%</div><div class="kpi-label">Assessment Complete</div></div>
      <div class="kpi-card"><div class="kpi-value" style="color:#d97706">${needsAttention}</div><div class="kpi-label">Needs Attention</div></div>
      <div class="kpi-card"><div class="kpi-value" style="color:${FAIL}">${immediateAction}</div><div class="kpi-label">Immediate Action</div></div>
    </div>

    <!-- Domain summary -->
    <div class="section-label">Compliance by Domain</div>
    <table>
      <thead><tr><th>Domain</th><th class="text-center">Items</th><th class="text-center">Compliant</th><th class="text-center">Needs Attn</th><th class="text-center">Immediate</th><th class="text-center">N/A</th><th class="text-center">Unassessed</th><th class="text-center">Rate</th></tr></thead>
      <tbody>${domainSummaryRows}</tbody>
    </table>

    <hr class="divider">

    <!-- Action items -->
    <div class="section-label">Action Items Requiring Follow-Up</div>
    <table>
      <thead><tr><th>#</th><th>Compliance Question</th><th>Status</th><th>Owner</th><th>Due Date</th></tr></thead>
      <tbody>${actionRows}</tbody>
    </table>

    <!-- Signature -->
    <div class="signature-block" style="margin-top:24px">
      <div class="accepted-label">Reviewed by:</div>
      <div class="sig-lines">
        <div class="sig-line" style="flex:2"><div class="line"></div><div class="label">Signature / Name &amp; Title</div></div>
        <div class="sig-line sig-date"><div class="line"></div><div class="label">Date</div></div>
      </div>
    </div>
  </body></html>`;
}

function buildVeritaScanFullHTML(data: VeritaScanPDFData): string {
  const { scanName, createdAt, updatedAt, items } = data;

  // Group by domain
  const domainMap = new Map<string, VeritaScanPDFItem[]>();
  for (const item of items) {
    const arr = domainMap.get(item.domain) || [];
    arr.push(item);
    domainMap.set(item.domain, arr);
  }

  let domainSections = "";
  let domainIndex = 0;
  for (const [domain, domItems] of domainMap.entries()) {
    const rows = domItems.map((item, idx) => {
      const sc = SCAN_STATUS_COLORS[item.status] || SCAN_STATUS_COLORS["Not Assessed"];
      return `<tr class="${idx % 2 === 1 ? "stripe" : ""}">
        <td>${item.id}</td>
        <td style="max-width:200px;word-wrap:break-word;font-size:7pt">${item.question}</td>
        <td style="font-size:6.5pt">${item.tjc || "—"}</td>
        <td style="font-size:6.5pt">${item.cap || "—"}</td>
        <td style="font-size:6.5pt">${item.cfr || "—"}</td>
        <td><span style="background:${sc.bg};color:${sc.fg};padding:1px 5px;border-radius:3px;font-size:6.5pt;font-weight:600;white-space:nowrap">${item.status}</span></td>
        <td style="font-size:7pt">${item.owner || ""}</td>
        <td style="font-size:7pt">${item.due_date || ""}</td>
        <td style="font-size:6.5pt;max-width:100px;word-wrap:break-word">${item.notes || ""}</td>
      </tr>`;
    }).join("");

    domainSections += `
      ${domainIndex > 0 ? '<div style="page-break-before:always"></div>' : ""}
      <div class="section-label" style="font-size:10pt;margin:10px 0 6px;color:${TEAL}">${domain}</div>
      <table>
        <thead><tr><th>#</th><th>Compliance Question</th><th>TJC</th><th>CAP</th><th>CFR</th><th>Status</th><th>Owner</th><th>Due</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    domainIndex++;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
    .page-num::after { content: "Page " counter(page); }
    body { counter-reset: page; }
  </style></head><body>
    <div class="report-header">
      <div>
        <div class="logo">VeritaScan™</div>
        <div class="logo-sub">by Veritas Lab Services · veritaslabservices.com</div>
      </div>
      <div class="header-right">Generated ${today()}</div>
    </div>
    <div class="report-title">Full Compliance Report</div>
    <div class="report-title-sub">${scanName} · Created ${new Date(createdAt).toLocaleDateString("en-US")} · Last Updated ${new Date(updatedAt).toLocaleDateString("en-US")}</div>
    <hr class="divider">
    ${domainSections}

    <div class="signature-block" style="margin-top:24px;page-break-before:always">
      <div class="accepted-label">Reviewed by:</div>
      <div class="sig-lines">
        <div class="sig-line" style="flex:2"><div class="line"></div><div class="label">Signature / Name &amp; Title</div></div>
        <div class="sig-line sig-date"><div class="line"></div><div class="label">Date</div></div>
      </div>
    </div>
  </body></html>`;
}

const VERITASCAN_FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaScan is a compliance assessment tool for qualified laboratory professionals. Results require review by laboratory leadership and do not constitute legal or regulatory advice.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaScan by Veritas Lab Services &middot; veritaslabservices.com &middot; Generated <span class="date"></span></span>
      <span>Page <span class="pageNumber"></span></span>
    </div>
  </div>
</div>`;

export async function generateVeritaScanPDF(data: VeritaScanPDFData, type: "executive" | "full"): Promise<Buffer> {
  const html = type === "executive"
    ? buildVeritaScanExecutiveHTML(data)
    : buildVeritaScanFullHTML(data);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: VERITASCAN_FOOTER_TEMPLATE,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ─── VeritaComp PDF ────────────────────────────────────────────────────

const CLIA_METHODS = [
  "1. Direct observations of routine patient test performance, including, as applicable, patient identification and preparation; specimen collection, handling, processing and testing",
  "2. Monitoring the recording and reporting of test results, including, as applicable, reporting critical results",
  "3. Review of intermediate test results or worksheets, quality control records, proficiency testing results, and preventive maintenance records",
  "4. Direct observation of performance of instrument maintenance function checks and calibration",
  "5. Assessment of test performance through testing previously analyzed specimens, internal blind testing samples or external proficiency testing samples",
  "6. Evaluation of problem-solving skills",
];

const WAIVED_METHODS = [
  "1. Performance of a test on a blind specimen",
  "2. Periodic observation of routine work by the supervisor or qualified designee",
  "3. Monitoring of each user's quality control performance",
  "4. Use of a written test specific to the test assessed",
];

interface CompetencyPDFInput {
  assessment: any;
  items: any[];
  methodGroups: any[];
  checklistItems: any[];
  labName: string;
  quizResults?: any[];
}

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCompetencyHTML(input: CompetencyPDFInput): string {
  const { assessment, items, methodGroups, checklistItems, labName, quizResults } = input;
  const dateStr = assessment.assessment_date || new Date().toISOString().split("T")[0];
  const isTechnical = assessment.competency_type === "technical";
  const isWaived = assessment.competency_type === "waived";
  const isNonTech = assessment.competency_type === "nontechnical";

  const typeLabel = isTechnical ? "Technical Competency Assessment" : isWaived ? "Waived Testing Competency Assessment" : "Non-Technical Competency Assessment";
  const standardRef = isTechnical ? "HR.01.06.01 EP 18 &middot; 42 CFR &sect;493.1451" : isWaived ? "WT.03.01.01 EP 5 &middot; 42 CFR &sect;493.15" : "HR.01.06.01 EP 5/6";

  const passColor = assessment.status === "pass" ? "#437A22" : assessment.status === "fail" ? "#A12C7B" : "#d97706";
  const passLabel = assessment.status === "pass" ? "PASS" : assessment.status === "fail" ? "FAIL" : "REMEDIATION REQUIRED";

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Inter', 'Segoe UI', Roboto, sans-serif; font-size: 9pt; color: #1a1a1a; line-height: 1.5; }
  .header { background: #01696F; color: white; padding: 18px 24px; }
  .header h1 { font-size: 15pt; font-weight: 700; margin-bottom: 2px; }
  .header .sub { font-size: 9.5pt; opacity: 0.9; font-weight: 500; }
  .header .divider { height: 1px; background: rgba(255,255,255,0.3); margin: 8px 0 4px 0; }
  .info-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; margin: 14px 24px; }
  .info-2col .col { }
  .info-2col .row { display: flex; gap: 6px; font-size: 8.5pt; margin-bottom: 3px; }
  .info-2col .row .lbl { color: #888; min-width: 90px; font-size: 7.5pt; }
  .info-2col .row .val { font-weight: 600; }
  .evaluator-block { margin: 10px 24px; padding: 8px 12px; border: 1px solid #e0e4e8; border-radius: 4px; background: #f8fafb; }
  .evaluator-block .note { font-size: 7pt; font-style: italic; color: #666; margin-top: 4px; }
  .verdict-box { margin: 12px 24px; padding: 10px 16px; border-radius: 6px; text-align: center; }
  .verdict-box .label { font-size: 8pt; color: #666; margin-bottom: 2px; }
  .verdict-box .verdict { font-size: 16pt; font-weight: 800; letter-spacing: 1.5px; }
  .ack-box { margin: 12px 24px; border: 1.5px solid #01696F; border-radius: 6px; padding: 12px 16px; background: #f0fdfa; }
  .ack-box .title { font-size: 9pt; font-weight: 700; color: #01696F; margin-bottom: 6px; }
  .ack-box .text { font-size: 7.5pt; line-height: 1.5; margin-bottom: 8px; }
  .ack-box ul { font-size: 7.5pt; margin-left: 14px; margin-bottom: 8px; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .sig-line { border-bottom: 1px solid #999; padding-bottom: 2px; min-height: 18px; font-size: 8pt; }
  .sig-label { font-size: 6.5pt; color: #888; margin-top: 1px; }
  .section { padding: 12px 24px; }
  .section-header { background: #01696F; color: white; padding: 6px 12px; font-size: 9pt; font-weight: 700; margin-bottom: 8px; border-radius: 3px; }
  .section-note { font-size: 7.5pt; font-style: italic; color: #555; margin-bottom: 8px; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th { background: #01696F; color: white; padding: 5px 6px; text-align: left; font-size: 7pt; font-weight: 600; }
  td { border: 0.5px solid #ddd; padding: 4px 6px; vertical-align: top; }
  tr:nth-child(even) td { background: #F5F5F5; }
  .pass-badge { color: #437A22; font-weight: 700; }
  .fail-badge { color: #A12C7B; font-weight: 700; }
  .remediation-box { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px; padding: 10px 14px; margin: 8px 24px; font-size: 8.5pt; }
  .page-break { page-break-before: always; }
  .quiz-correct { background: #dcfce7; }
  .quiz-incorrect { background: #fee2e2; }
  .quiz-banner { text-align: center; padding: 6px; border-radius: 4px; font-weight: 700; font-size: 9pt; margin-top: 8px; }
</style></head><body>`;

  // ─── PAGE 1 ───

  // Header
  html += `<div class="header">
    <h1>VeritaAssure\u2122</h1>
    <div class="sub">${typeLabel}</div>
    <div class="divider"></div>
  </div>`;

  // Two-column info block
  html += `<div class="info-2col">
    <div class="col">
      <div class="row"><span class="lbl">Laboratory:</span><span class="val">${esc(labName)}</span></div>
      <div class="row"><span class="lbl">Program:</span><span class="val">${esc(assessment.program_name)}</span></div>
      <div class="row"><span class="lbl">Department:</span><span class="val">${esc(assessment.department)}</span></div>
    </div>
    <div class="col">
      <div class="row"><span class="lbl">Employee:</span><span class="val">${esc(assessment.employee_name)}</span></div>
      <div class="row"><span class="lbl">Date of Hire:</span><span class="val">${esc(assessment.employee_hire_date) || "-"}</span></div>
      <div class="row"><span class="lbl">Type:</span><span class="val">${(assessment.assessment_type || "initial").replace("_", " ").toUpperCase()}</span></div>
      <div class="row"><span class="lbl">Date:</span><span class="val">${dateStr}</span></div>
    </div>
  </div>`;

  // Evaluator block
  html += `<div class="evaluator-block">
    <div style="display:flex;gap:24px;font-size:8.5pt;">
      <div><span style="color:#888;font-size:7pt;">Evaluator:</span> <strong>${esc(assessment.evaluator_name) || "-"}</strong></div>
      <div><span style="color:#888;font-size:7pt;">Title:</span> <strong>${esc(assessment.evaluator_title) || "-"}</strong></div>
      <div><span style="color:#888;font-size:7pt;">Initials:</span> <strong>${esc(assessment.evaluator_initials) || "-"}</strong></div>
    </div>
    <div class="note">Evaluator must be Lab Director, Technical Consultant (moderate complexity), or Technical Supervisor (high complexity) as appropriate for this employee's testing category.</div>
  </div>`;

  // PASS/FAIL/REMEDIATION box
  const verdictBg = assessment.status === "pass" ? "#dcfce7" : assessment.status === "fail" ? "#fce7f3" : "#fef3c7";
  html += `<div class="verdict-box" style="background:${verdictBg}">
    <div class="label">Overall Determination</div>
    <div class="verdict" style="color:${passColor}">${passLabel}</div>
  </div>`;

  // Remediation box
  if (assessment.status === "remediation" || assessment.status === "fail") {
    html += `<div class="remediation-box">
      <strong>Remediation Required:</strong> This employee requires additional training and may not perform patient testing unsupervised until remediation is complete.
      ${assessment.remediation_plan ? "<br><strong>Action Plan:</strong> " + esc(assessment.remediation_plan) : ""}
    </div>`;
  }

  // Employee Acknowledgement box with TJC language (on page 1 - non-negotiable)
  html += `<div class="ack-box">
    <div class="title">Employee Acknowledgement</div>
    <div class="text">Prior to performing laboratory duties, the following are completed:</div>
    <ul>
      <li>The laboratory director or supervisor documents that staff have completed orientation and have demonstrated competence in performing their required duties.</li>
      <li>The staff member affirms, in writing, that they can perform the duties for which orientation was provided.</li>
    </ul>
    <div class="sig-grid">
      <div>
        <div class="sig-line">${esc(assessment.employee_name) || ""}</div>
        <div class="sig-label">Employee Print Name / Initials / Date: ${dateStr}</div>
      </div>
      <div>
        <div class="sig-line">${esc(assessment.evaluator_name) || ""} ${assessment.evaluator_initials ? "(" + esc(assessment.evaluator_initials) + ")" : ""}</div>
        <div class="sig-label">Supervisor Print Name / Initials / Date: ${dateStr}</div>
      </div>
    </div>
  </div>`;

  // ─── PAGES 2+ ───

  if (isTechnical) {
    // Each element gets its own section
    const elementDefs = [
      {
        num: 1,
        title: "Element 1: Direct Observation of Routine Patient Test Performance",
        note: "Observer must be Lab Director or Technical Consultant (moderate complexity) or Technical Supervisor (high complexity) as appropriate. Documents that the observer watched the employee process and test a specimen.",
        cols: ["Method Group", "Specimen ID", "Observer Initials", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || item.specimen_info || "")}</td>
          <td>${esc(item.el1_specimen_id || item.specimen_info || "")}</td>
          <td>${esc(item.el1_observer_initials || item.supervisor_initials || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
      {
        num: 2,
        title: "Element 2: Monitoring, Recording and Reporting of Test Results",
        note: "Documents the employee's ability to monitor, record, and report results including critical values.",
        cols: ["Method Group", "Evidence", "Date", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el2_evidence || item.evidence || "")}</td>
          <td>${esc(item.el2_date || item.date_met || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
      {
        num: 3,
        title: "Element 3: QC Performance",
        note: "Enter the date the employee personally ran QC on this instrument. The surveyor will pull the QC records for that date to confirm.",
        cols: ["Method Group", "Date Tech Ran QC", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el3_qc_date || item.date_met || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
      {
        num: 4,
        title: "Element 4: Direct Observation of Instrument Maintenance",
        note: "Observer must be Lab Director or Technical Consultant (moderate complexity) or Technical Supervisor (high complexity) as appropriate. The lab's signed maintenance records for the date observed serve as the supporting documentation.",
        cols: ["Method Group", "Date Observed", "Observer Initials", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el4_date_observed || item.date_met || "")}</td>
          <td>${esc(item.el4_observer_initials || item.supervisor_initials || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
      {
        num: 5,
        title: "Element 5: Blind / PT Sample Performance",
        note: "The PT report or blind sample log serves as the supporting record. Do not enter patient specimen data here.",
        cols: ["Method Group", "Sample Type", "Sample ID", "Acceptable", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el5_sample_type || "")}</td>
          <td>${esc(item.el5_sample_id || item.specimen_info || "")}</td>
          <td>${item.el5_acceptable ? "Yes" : item.el5_acceptable === 0 ? "No" : "-"}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
      {
        num: 6,
        title: "Element 6: Problem-Solving Assessment (Quiz)",
        note: "A short quiz (1-2 questions per method group) is required. Score must be 100% to pass. The quiz and all answers are appended to this competency record.",
        cols: ["Method Group", "Quiz ID", "Score", "Date Taken", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el6_quiz_id || "")}</td>
          <td>${item.el6_score != null ? item.el6_score + "%" : "-"}</td>
          <td>${esc(item.el6_date_taken || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>`,
      },
    ];

    for (const elDef of elementDefs) {
      html += `<div class="page-break"></div>`;
      html += `<div class="section">
        <div class="section-header">${elDef.title}</div>
        <div class="section-note">${elDef.note}</div>
        <table>
          <tr>${elDef.cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
      const elItems = items.filter((i: any) => (i.element_number || i.method_number) === elDef.num);
      if (elItems.length === 0) {
        // Fallback: show items by method_number for backward compatibility
        const fallbackItems = items.filter((i: any) => i.method_number === elDef.num);
        for (const item of fallbackItems) {
          const mg = methodGroups.find((g: any) => g.id === item.method_group_id);
          const augmented = { ...item, method_group_name: item.method_group_name || mg?.name || "" };
          html += `<tr>${elDef.render(augmented)}</tr>`;
        }
      } else {
        for (const item of elItems) {
          const mg = methodGroups.find((g: any) => g.id === item.method_group_id);
          const augmented = { ...item, method_group_name: item.method_group_name || mg?.name || "" };
          html += `<tr>${elDef.render(augmented)}</tr>`;
        }
      }
      if (elItems.length === 0 && items.filter((i: any) => i.method_number === elDef.num).length === 0) {
        html += `<tr><td colspan="${elDef.cols.length}" style="text-align:center;color:#888;font-style:italic">No data recorded</td></tr>`;
      }
      html += `</table></div>`;
    }

  } else if (isWaived) {
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Waived Testing Competency - 2 of 4 Methods Required Per Test</div>
      <table>
        <tr><th>Assessment Method</th><th>Instrument/Test</th><th>Evidence</th><th>Date</th><th>Initials</th><th>Pass</th></tr>`;
    for (const item of items) {
      const methodLabel = WAIVED_METHODS[(item.method_number || item.waived_method_number || 1) - 1] || `Method ${item.method_number}`;
      html += `<tr>
        <td>${methodLabel}</td>
        <td>${esc(item.waived_instrument || "")} ${esc(item.waived_test || "")}</td>
        <td>${esc(item.waived_evidence || item.evidence || "")}</td>
        <td>${esc(item.waived_date || item.date_met || "")}</td>
        <td>${esc(item.waived_initials || item.supervisor_initials || "")}</td>
        <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? '\u2713 Pass' : '\u2717 Fail'}</td>
      </tr>`;
    }
    html += `</table></div>`;

  } else {
    // Non-technical checklist
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Non-Technical Competency Checklist - ${esc(assessment.department)}</div>
      <table>
        <tr><th style="width:5%">#</th><th>Competency Item</th><th style="width:12%">Date Met</th><th style="width:10%">Emp Init</th><th style="width:10%">Sup Init</th></tr>`;
    for (const item of items) {
      html += `<tr>
        <td><strong>${esc(item.nt_item_label || item.item_label || "")}</strong></td>
        <td>${esc(item.nt_item_description || item.item_description || "")}</td>
        <td>${esc(item.nt_date_met || item.date_met || "")}</td>
        <td>${esc(item.nt_employee_initials || item.employee_initials || "")}</td>
        <td>${esc(item.nt_supervisor_initials || item.supervisor_initials || "")}</td>
      </tr>`;
    }
    html += `</table></div>`;
  }

  // ─── QUIZ ADDENDUM ───
  if (quizResults && quizResults.length > 0) {
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Appendix A: Problem-Solving Quiz Results</div>`;

    for (const qr of quizResults) {
      const questions = JSON.parse(qr.quiz_questions || "[]");
      const answers = JSON.parse(qr.answers || "[]");

      html += `<div style="margin-bottom:16px;">
        <div style="font-size:8.5pt;font-weight:600;margin-bottom:4px;">${esc(qr.method_group_name) || "Quiz"}</div>
        <div style="font-size:7.5pt;color:#666;margin-bottom:6px;">
          Quiz ID: ${qr.quiz_id} | Date Taken: ${esc(qr.date_taken)} | Score: ${qr.score}% |
          <span class="${qr.passed ? 'pass-badge' : 'fail-badge'}">${qr.passed ? 'PASS' : 'FAIL'}</span>
        </div>`;

      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        const a = answers.find((ans: any) => ans.question_id === q.id);
        html += `<div style="margin-bottom:10px;border:1px solid #e0e4e8;border-radius:4px;padding:8px;">
          <div style="font-size:8pt;font-weight:600;margin-bottom:4px;">Q${qi + 1}: ${esc(q.question)}</div>`;
        for (const opt of (q.options || [])) {
          const optLetter = opt.charAt(0);
          const isSelected = a?.selected_answer === optLetter;
          const isCorrect = q.correct_answer === optLetter;
          const bgClass = isSelected && isCorrect ? "quiz-correct" : isSelected && !isCorrect ? "quiz-incorrect" : isCorrect ? "quiz-correct" : "";
          html += `<div class="${bgClass}" style="font-size:7.5pt;padding:2px 6px;margin:1px 0;border-radius:2px;">
            ${isSelected ? "\u25CF" : "\u25CB"} ${esc(opt)}
            ${isCorrect ? ' <span style="color:#437A22;font-weight:600;">\u2713 Correct</span>' : ""}
            ${isSelected && !isCorrect ? ' <span style="color:#A12C7B;font-weight:600;">\u2717 Selected</span>' : ""}
          </div>`;
        }
        if (q.explanation) {
          html += `<div style="font-size:7pt;color:#555;margin-top:4px;font-style:italic;"><strong>Explanation:</strong> ${esc(q.explanation)}</div>`;
        }
        html += `</div>`;
      }

      if (qr.score === 100) {
        html += `<div class="quiz-banner" style="background:#dcfce7;color:#437A22;">ALL ANSWERS CORRECT</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
  }

  html += `</body></html>`;
  return html;
}

const COMPETENCY_FOOTER = `<div style="width:100%;padding:4px 15mm;font-family:sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure\u2122 | VeritaComp\u2122 | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

export async function generateCompetencyPDF(input: CompetencyPDFInput): Promise<Buffer> {
  const html = buildCompetencyHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: COMPETENCY_FOOTER,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ─── CMS 209 Laboratory Personnel Report ────────────────────────────────────

interface CMS209Input {
  lab: {
    lab_name: string;
    clia_number: string;
    lab_address_street: string;
    lab_address_city: string;
    lab_address_state: string;
    lab_address_zip: string;
  };
  employees: {
    last_name: string;
    first_name: string;
    middle_initial: string | null;
    highest_complexity: string;
    performs_testing: number;
    qualifications_text: string | null;
    roles: { role: string; specialty_number: number | null }[];
  }[];
  specialties: Record<number, string>;
}

function buildCMS209HTML(input: CMS209Input): string {
  const { lab, employees, specialties } = input;
  const address = [lab.lab_address_street, lab.lab_address_city, lab.lab_address_state, lab.lab_address_zip].filter(Boolean).join(", ");

  // Build rows: one row per person, but TC/TS get separate rows per specialty
  interface Row {
    lastName: string;
    firstName: string;
    mi: string;
    ld: boolean;
    cc: boolean;
    tc: string; // specialty number or empty
    ts: string; // specialty number or empty
    gs: boolean;
    tp: boolean;
    ctGs: boolean;
    ct: boolean;
    mh: string; // M or H
    quals: string;
  }

  const rows: Row[] = [];
  for (const emp of employees) {
    if (!emp.performs_testing && !emp.roles.some(r => ["LD", "CC", "TC", "TS", "GS"].includes(r.role))) continue;

    const roleSet = new Set(emp.roles.map(r => r.role));
    const tcSpecs = emp.roles.filter(r => r.role === "TC" && r.specialty_number).map(r => r.specialty_number!);
    const tsSpecs = emp.roles.filter(r => r.role === "TS" && r.specialty_number).map(r => r.specialty_number!);

    // If the employee has TC or TS with specialties, create one row per specialty
    const specRows: { tc: string; ts: string }[] = [];

    if (tcSpecs.length > 0 || tsSpecs.length > 0) {
      // Combine: for each specialty, show which role(s) apply
      const allSpecs = new Set([...tcSpecs, ...tsSpecs]);
      for (const spec of allSpecs) {
        specRows.push({
          tc: tcSpecs.includes(spec) ? String(spec) : "",
          ts: tsSpecs.includes(spec) ? String(spec) : "",
        });
      }
    }

    if (specRows.length === 0) {
      // Single row (no TC/TS specialties)
      rows.push({
        lastName: emp.last_name,
        firstName: emp.first_name,
        mi: emp.middle_initial || "",
        ld: roleSet.has("LD"),
        cc: roleSet.has("CC"),
        tc: "",
        ts: "",
        gs: roleSet.has("GS"),
        tp: roleSet.has("TP") || emp.performs_testing === 1,
        ctGs: roleSet.has("CT_GS"),
        ct: roleSet.has("CT"),
        mh: emp.highest_complexity === "M" ? "M" : "H",
        quals: emp.qualifications_text || "",
      });
    } else {
      for (let i = 0; i < specRows.length; i++) {
        rows.push({
          lastName: i === 0 ? emp.last_name : "",
          firstName: i === 0 ? emp.first_name : "",
          mi: i === 0 ? (emp.middle_initial || "") : "",
          ld: i === 0 ? roleSet.has("LD") : false,
          cc: i === 0 ? roleSet.has("CC") : false,
          tc: specRows[i].tc,
          ts: specRows[i].ts,
          gs: i === 0 ? roleSet.has("GS") : false,
          tp: i === 0 ? (roleSet.has("TP") || emp.performs_testing === 1) : false,
          ctGs: i === 0 ? roleSet.has("CT_GS") : false,
          ct: i === 0 ? roleSet.has("CT") : false,
          mh: i === 0 ? (emp.highest_complexity === "M" ? "M" : "H") : "",
          quals: i === 0 ? (emp.qualifications_text || "") : "",
        });
      }
    }
  }

  const check = (v: boolean) => v ? "X" : "";
  const dataRows = rows.map(r => `
    <tr>
      <td>${r.lastName}</td>
      <td>${r.firstName}</td>
      <td class="ctr">${r.mi}</td>
      <td class="ctr">${check(r.ld)}</td>
      <td class="ctr">${check(r.cc)}</td>
      <td class="ctr">${r.tc}</td>
      <td class="ctr">${r.ts}</td>
      <td class="ctr">${check(r.gs)}</td>
      <td class="ctr">${check(r.tp)}</td>
      <td class="ctr">${check(r.ctGs)}</td>
      <td class="ctr">${check(r.ct)}</td>
      <td class="ctr">${r.mh}</td>
      <td class="quals">${r.quals}</td>
    </tr>`).join("");

  // Add empty rows to fill at least 20 total
  const emptyCount = Math.max(0, 20 - rows.length);
  const emptyRows = Array.from({ length: emptyCount }, () => `
    <tr>
      <td>&nbsp;</td><td></td><td class="ctr"></td>
      <td class="ctr"></td><td class="ctr"></td><td class="ctr"></td>
      <td class="ctr"></td><td class="ctr"></td><td class="ctr"></td>
      <td class="ctr"></td><td class="ctr"></td><td class="ctr"></td>
      <td class="quals"></td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: #1a1a1a; background: white; }
    @page { size: letter landscape; margin: 10mm 12mm 14mm 12mm; }

    .header { margin-bottom: 8px; }
    .form-title { font-size: 13pt; font-weight: 700; text-align: center; margin-bottom: 4px; }
    .form-subtitle { font-size: 8pt; text-align: center; color: #555; margin-bottom: 10px; }
    .lab-info { display: flex; gap: 20px; margin-bottom: 8px; font-size: 8.5pt; }
    .lab-info .field { display: flex; gap: 4px; }
    .lab-info .label { font-weight: 700; }

    table.cms209 { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 6px; }
    table.cms209 th { background: #f0f2f5; font-weight: 700; padding: 3px 4px; border: 0.5px solid #ccc; font-size: 6.5pt; text-align: center; vertical-align: bottom; }
    table.cms209 td { padding: 2px 4px; border: 0.5px solid #ccc; vertical-align: top; }
    table.cms209 td.ctr { text-align: center; font-weight: 600; }
    table.cms209 td.quals { font-size: 6.5pt; }

    .col-header-group { text-align: center; font-weight: 700; font-size: 7pt; padding: 2px 0; }

    .specialty-legend { margin-top: 10px; font-size: 6.5pt; color: #555; columns: 3; column-gap: 16px; }
    .specialty-legend div { margin-bottom: 1px; }

    .certification { margin-top: 16px; font-size: 7.5pt; line-height: 1.5; }
    .sig-section { margin-top: 20px; display: flex; gap: 30px; }
    .sig-block { flex: 1; }
    .sig-line { border-bottom: 1px solid #1a1a1a; height: 22px; margin-bottom: 2px; }
    .sig-label { font-size: 7pt; color: #666; }

    .footer-form { margin-top: 16px; text-align: center; font-size: 7pt; color: #888; }
  </style></head><body>
    <div class="header">
      <div class="form-title">DEPARTMENT OF HEALTH AND HUMAN SERVICES</div>
      <div class="form-subtitle">CENTERS FOR MEDICARE &amp; MEDICAID SERVICES / LABORATORY PERSONNEL REPORT</div>

      <div class="lab-info">
        <div class="field"><span class="label">Laboratory Name:</span> ${lab.lab_name}</div>
        <div class="field"><span class="label">CLIA Number:</span> ${lab.clia_number}</div>
        <div class="field"><span class="label">Address:</span> ${address}</div>
      </div>
    </div>

    <table class="cms209">
      <thead>
        <tr>
          <th rowspan="2" style="width:12%">Last Name</th>
          <th rowspan="2" style="width:10%">First Name</th>
          <th rowspan="2" style="width:3%">MI</th>
          <th colspan="9" class="col-header-group">Position/Duties (Check applicable)</th>
          <th rowspan="2" style="width:3%">M/H</th>
          <th rowspan="2" style="width:20%">Qualifications</th>
        </tr>
        <tr>
          <th style="width:3%">LD</th>
          <th style="width:3%">CC</th>
          <th style="width:3%">TC</th>
          <th style="width:3%">TS</th>
          <th style="width:3%">GS</th>
          <th style="width:3%">TP</th>
          <th style="width:4%">CT/GS</th>
          <th style="width:3%">CT</th>
        </tr>
      </thead>
      <tbody>
        ${dataRows}
        ${emptyRows}
      </tbody>
    </table>

    <div class="specialty-legend">
      <div style="font-weight:700;margin-bottom:3px;column-span:all">CMS Specialty Numbers (for TC/TS columns):</div>
      ${Object.entries(specialties).map(([n, name]) => `<div>${n} = ${name}</div>`).join("")}
    </div>

    <div class="certification">
      <strong>Certification:</strong> I certify that the information provided on this form is accurate and complete to the best of my knowledge. I understand that this information is required for compliance with CLIA regulations (42 CFR Part 493) and that falsification of this information may result in sanctions.
    </div>

    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Laboratory Director Signature</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Printed Name</div>
      </div>
      <div class="sig-block" style="flex:0 0 25%">
        <div class="sig-line"></div>
        <div class="sig-label">Date</div>
      </div>
    </div>

    <div class="footer-form">FORM CMS-209 (09/2025)</div>
  </body></html>`;
}

export async function generateCMS209PDF(input: CMS209Input): Promise<Buffer> {
  const html = buildCMS209HTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", right: "12mm", bottom: "14mm", left: "12mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
