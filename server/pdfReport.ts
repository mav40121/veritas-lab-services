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
  const typeLabel = study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : study.studyType === "precision" ? "Precision Verification (EP15)" : "Correlation / Method Comparison";
  return `
  <div class="report-header">
    <div>
      <div class="logo">VeritaCheck®</div>
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

  ${signatureHTML()}

  <div class="stats-section">
    <div class="section-label">Individual Measurements</div>
    ${valuesSection}
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError)}
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

export async function generatePDFBuffer(study: Study, results: any): Promise<Buffer> {
  const html = study.studyType === "cal_ver"
    ? buildCalVerHTML(study, results)
    : study.studyType === "precision"
    ? buildPrecisionHTML(study, results)
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
