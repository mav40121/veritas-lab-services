/**
 * Server-side PDF generation using Puppeteer + HTML templates.
 * Replaces client-side jsPDF. Called from POST /api/generate-pdf.
 *
 * The math functions are duplicated here (not imported from client) because
 * this runs in Node - the client calculations.ts uses the same algorithms.
 */

import puppeteer from "puppeteer";
import type { Study } from "@shared/schema";

// ─── Safe number formatting helper ──────────────────────────────────────────
function sf(value: any, digits: number): string {
  return Number(value ?? 0).toFixed(digits);
}

// ─── Safe JSON parse helper ──────────────────────────────────────────────────
function safeJsonParse(value: any, fallback: any = []): any {
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return [value];
  }
}

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

// ─── TEa display helper (absolute vs percentage) ─────────────────────────────
function teaDisplayStr(study: Study): string {
  const isAbsolute = (study as any).teaIsPercentage === 0 || (study as any).tea_is_percentage === 0;
  if (isAbsolute) {
    const unit = (study as any).teaUnit || (study as any).tea_unit || '';
    return `\u00B1${study.cliaAllowableError} ${unit}`.trim();
  }
  return `\u00B1${(study.cliaAllowableError * 100).toFixed(1)}%`;
}
function isAbsoluteTea(study: Study): boolean {
  return (study as any).teaIsPercentage === 0 || (study as any).tea_is_percentage === 0;
}

// ─── CFR URL map ──────────────────────────────────────────────────────────────
const CFR_URLS: Record<string, string> = {
  "42 CFR §493.931": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.931",
  "42 CFR §493.933": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.933",
  "42 CFR §493.935": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.935",
  "42 CFR §493.941": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.941",
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

  /* Signature block - always on page 1 */
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

  /* Footer rendered via Puppeteer displayHeaderFooter - hidden from body */
  .footer { display: none; }
  .page-num { display: none; }

  /* Two-col supporting stats */
  .supp-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 0; font-size: 8pt; margin-bottom: 6px; }
  .supp-stats .key { color: ${MUTED}; font-weight: 700; }
  .supp-stats .val { }
`;

// ─── Shared header HTML ───────────────────────────────────────────────────────
function headerHTML(study: Study, cliaNumber?: string): string {
  const typeLabelMap: Record<string, string> = {
    cal_ver: "Calibration Verification / Linearity",
    precision: "Precision Verification (EP15)",
    method_comparison: "Correlation / Method Comparison",
    lot_to_lot: "Lot-to-Lot Verification",
    ref_interval: "Reference Range Verification",
    pt_coag: "PT/Coag New Lot Validation",
    qc_range: "QC Range Establishment",
    multi_analyte_coag: "Multi-Analyte Lot Comparison (Coag)",
  };
  const typeLabel = typeLabelMap[study.studyType] || "Correlation / Method Comparison";
  const cliaLine = cliaNumber ? `<div style="font-size:8pt;color:#555;margin-top:2px;">CLIA: ${cliaNumber}</div>` : `<div style="font-size:8pt;color:#999;margin-top:2px;">CLIA: Not on file - enter your CLIA number in account settings</div>`;
  const labName = (study as any)._labName;
  const labLine = labName ? `<div style="font-size:8.5pt;font-weight:600;color:#28251D;margin-top:1px;">${labName}</div>` : "";
  return `
  <div class="report-header">
    <div>
      <div class="logo">VeritaAssure\u2122</div>
      <div class="logo-sub">by Veritas Lab Services - veritaslabservices.com</div>
      ${labLine}
      ${cliaLine}
    </div>
    <div class="header-right">Instrument: ${study.instrument}</div>
  </div>
  <div class="report-title">${typeLabel} - ${study.testName}</div>
  <hr class="divider">`;
}

// ─── Supporting data page HTML ────────────────────────────────────────────────
function supportingPageHTML(study: Study, instrumentNames: string[]): string {
  const cliaP = (study.cliaAllowableError * 100).toFixed(1);
  const cfr = (study as any).cfr || "42 CFR §493.931";
  const cfrUrl = CFR_URLS[cfr] || "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.931";

  const specs = [
    ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification / Linearity" : study.studyType === "precision" ? "Precision Verification (EP15)" : study.studyType === "lot_to_lot" ? "Lot-to-Lot Verification" : study.studyType === "ref_interval" ? "Reference Range Verification" : "Correlation / Method Comparison"],
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
    <div class="footer-disclaimer">VeritaCheck is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.</div>
    <div class="footer-bar">
      <span>VeritaCheck by Veritas Lab Services · veritaslabservices.com · Generated ${today}</span>
      <span class="page-num"></span>
    </div>
  </div>`;
}

// ─── Laboratory Director Review block HTML ───────────────────────────────────
function directorReviewHTML(): string {
  return `
  <div style="margin-top:18px;border:1px solid #D4D1CA;border-left:4px solid #01696F;border-radius:5px;padding:12px 14px;background:#FAFAF8;">
    <div style="font-size:8pt;font-weight:700;color:#01696F;margin-bottom:8px;letter-spacing:0.04em;text-transform:uppercase;">Laboratory Director or Designee Review</div>
    <p style="font-size:7.5pt;color:#28251D;line-height:1.5;margin:0 0 10px 0;font-style:italic;">"I have reviewed these results against my laboratory's established performance specifications and applicable regulatory requirements."</p>
    <div style="font-size:8pt;color:#28251D;margin-bottom:4px;">
      <span style="margin-right:18px;">\u25CB Accepted for patient testing</span>
      <span>\u25CB Not accepted</span>
    </div>
    <div style="display:flex;gap:16px;margin-top:14px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:22px;">Signature</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:22px;">Date</div>
      </div>
    </div>
    <div style="display:flex;gap:16px;margin-top:10px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:14px;">Print Name</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:14px;">Title</div>
      </div>
    </div>
  </div>`;
}


// ─── Regulatory Compliance References box ───────────────────────────────────
type StudyTypeKey = "cal_ver" | "method_comparison" | "precision" | "lot_to_lot" | "pt_coag" | "qc_range" | "multi_analyte_coag" | "ref_interval";
export type AccreditationBody = "CAP" | "TJC" | "COLA" | "AABB";

interface RegulatoryRefs {
  cap:  string[];
  tjc:  string[];
  cola: string[];
  aabb: string[];
  clsi: string[];
  cfr:  string[];
}

const REGULATORY_REFS: Record<StudyTypeKey, RegulatoryRefs> = {
  cal_ver: {
    cap:  ["CHM.13700", "CHM.13750", "GEN.40830"],
    tjc:  ["QSA.02.02.01", "QSA.02.03.01"],
    cola: ["LAB.023", "LAB.025"],
    aabb: ["5.7.1", "5.7.2"],
    clsi: ["EP06-Ed3", "EP15-A3"],
    cfr:  ["42 CFR §493.1255(b)(3)", "42 CFR §493.1271(b)"],
  },
  method_comparison: {
    cap:  ["CHM.13820"],
    tjc:  ["QSA.02.08.01"],
    cola: ["LAB.022", "LAB.023"],
    aabb: ["5.7.1", "5.7.3"],
    clsi: ["EP09-A3"],
    cfr:  ["42 CFR §493.1213"],
  },
  precision: {
    cap:  ["CHM.13830"],
    tjc:  ["QSA.02.01.01"],
    cola: ["LAB.021", "LAB.023"],
    aabb: ["5.7.1"],
    clsi: ["EP15-A3"],
    cfr:  ["42 CFR §493.1213(b)(2)"],
  },
  lot_to_lot: {
    cap:  ["CHM.13840"],
    tjc:  ["QSA.02.13.01"],
    cola: ["LAB.024"],
    aabb: ["5.7.2"],
    clsi: ["EP26-A"],
    cfr:  ["42 CFR §493.1255(b)"],
  },
  qc_range: {
    cap:  ["GEN.41316", "CHM.13850"],
    tjc:  ["QSA.02.07.01"],
    cola: ["LAB.030", "LAB.031"],
    aabb: ["5.8.1"],
    clsi: ["EP23-A", "C24-A3"],
    cfr:  ["42 CFR §493.1256"],
  },
  multi_analyte_coag: {
    cap:  ["HEM.36160", "HEM.36180", "GEN.40860"],
    tjc:  ["QSA.02.02.01", "QSA.13.02.01"],
    cola: ["LAB.023", "LAB.024"],
    aabb: ["5.14.1", "5.14.2"],
    clsi: ["EP26-A", "H47-A2", "H21-A5"],
    cfr:  ["42 CFR §493.1255(b)(3)"],
  },
  pt_coag: {
    cap:  ["HEM.37600", "HEM.37800"],
    tjc:  ["QSA.02.08.01", "QSA.02.13.01"],
    cola: ["LAB.023", "LAB.025"],
    aabb: ["5.14.1", "5.14.3"],
    clsi: ["EP26-A", "H21-A5"],
    cfr:  ["42 CFR §493.1255", "42 CFR §493.1213"],
  },
  ref_interval: {
    cap:  ["CHM.13900", "GEN.40460"],
    tjc:  ["QSA.02.01.01", "QSA.02.02.01"],
    cola: ["LAB.021"],
    aabb: ["5.6.2"],
    clsi: ["EP28-A3c", "C28-A3c"],
    cfr:  ["42 CFR §493.1253(b)(2)", "42 CFR §493.1271(a)"],
  },
};

// Default standards shown when no preference is saved
const DEFAULT_PREFERRED_STANDARDS: AccreditationBody[] = ["CAP", "TJC"];

function regulatoryComplianceBoxHTML(studyType: string, preferredStandards?: AccreditationBody[] | null): string {
  const refs = REGULATORY_REFS[studyType as StudyTypeKey];
  if (!refs) return "";

  const standards: AccreditationBody[] = (preferredStandards && preferredStandards.length > 0)
    ? preferredStandards
    : DEFAULT_PREFERRED_STANDARDS;

  const cell = (items: string[]) =>
    items.map(i => `<span style="display:inline-block;margin:1px 4px 1px 0;font-size:7pt;font-weight:600;color:#01696F;background:#E8F4F4;border:1px solid #B0D8D8;border-radius:3px;padding:1px 5px;">${i}</span>`).join("");

  // Build columns based on selected standards, always append CLSI and CFR
  const cols: { label: string; content: string }[] = [];

  if (standards.includes("CAP")) {
    cols.push({ label: "CAP Checklist", content: cell(refs.cap) });
  }
  if (standards.includes("TJC")) {
    cols.push({ label: "TJC Standard", content: cell(refs.tjc) });
  }
  if (standards.includes("COLA")) {
    cols.push({ label: "COLA Criteria", content: cell(refs.cola) });
  }
  if (standards.includes("AABB")) {
    cols.push({ label: "AABB Standard", content: cell(refs.aabb) });
  }
  // CLSI and CFR always shown
  cols.push({ label: "CLSI Guideline", content: cell(refs.clsi) });
  cols.push({
    label: "CLIA / CFR",
    content: `<div style="font-size:6.8pt;color:#444;line-height:1.6;">${refs.cfr.join("<br>")}</div>`,
  });

  const gridCols = `repeat(${cols.length}, 1fr)`;
  const colsHTML = cols.map(c => `
      <div>
        <div style="font-size:6.5pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px;">${c.label}</div>
        <div>${c.content}</div>
      </div>`).join("");

  return `
  <div style="margin-top:14px;border:1px solid #D4D1CA;border-left:4px solid #01696F;border-radius:5px;padding:10px 14px;background:#FAFAF8;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:8px;letter-spacing:0.04em;text-transform:uppercase;">Regulatory Compliance References</div>
    <div style="display:grid;grid-template-columns:${gridCols};gap:6px 12px;">
      ${colsHTML}
    </div>
  </div>`;
}

// ─── Evaluation section HTML ──────────────────────────────────────────────────
function evalHTML(summary: string, overallPass: boolean, passCount: number, totalCount: number, cliaError: number, study?: Study): string {
  const teaStr = study ? teaDisplayStr(study) : `\u00B1${(cliaError * 100).toFixed(1)}%`;
  const failCount = totalCount - passCount;
  const verdictText = overallPass
    ? `Meets CLIA criteria - ${passCount}/${totalCount} results within TEa of ${teaStr}`
    : `Does not meet CLIA criteria - ${failCount}/${totalCount} results exceeded TEa of ${teaStr}`;
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
  analyteName: string,
  study?: Study
): string {
  const isAbsolute = study ? isAbsoluteTea(study) : false;
  const teaStr = study ? teaDisplayStr(study) : `\u00B1${(cliaError * 100).toFixed(1)}%`;
  const cliaPct = (cliaError * 100).toFixed(1);
  const adlmPct = (cliaError * 50).toFixed(1); // ADLM = half of CLIA TEa
  let narrative = "";

  if (studyType === "cal_ver") {
    const calLevelResults = results.levelResults || [];
    const maxErr = calLevelResults.length > 0 ? Math.max(...calLevelResults.map((r: any) => Math.abs((r.obsError ?? 0) * 100))) : 0;
    const meetsAdlm = maxErr <= cliaError * 50;
    const slope = Object.values((results.regression || {}) as any)[0] as any;
    const slopeVal: number = slope?.slope ?? 1;
    const interceptVal: number = slope?.intercept ?? 0;
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias"
      : slopeVal > 1
        ? `a ${sf((slopeVal - 1) * 100, 1)}% upward proportional bias - results trend slightly high at upper concentrations`
        : `a ${sf((1 - slopeVal) * 100, 1)}% downward proportional bias - results trend slightly low at upper concentrations`;
    const interceptInterp = Math.abs(interceptVal) < cliaError * 100 * 0.1
      ? "a negligible constant offset"
      : interceptVal > 0
        ? `a small positive constant offset of ${sf(Math.abs(interceptVal), 3)} units at low concentrations`
        : `a small negative constant offset of ${sf(Math.abs(interceptVal), 3)} units at low concentrations`;

    if (results.overallPass) {
      narrative = `All ${results.totalCount} calibration levels for ${analyteName} fell within the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      if (meetsAdlm) {
        narrative += `The maximum observed error of ${sf(maxErr, 1)}% also meets the ADLM-recommended internal goal of ±${adlmPct}%, indicating performance well above the regulatory minimum. `;
      } else {
        narrative += `The maximum observed error of ${sf(maxErr, 1)}% meets CLIA requirements; the ADLM recommends an internal goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      narrative += `The regression slope of ${sf(slopeVal, 3)} (ideal: 1.000) and intercept of ${sf(interceptVal, 3)} (ideal: 0) indicate ${slopeInterp} and ${interceptInterp}. This instrument is performing within required limits across its reportable range. `;
      narrative += `<b>The results for ${analyteName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      const failCount = results.totalCount - results.passCount;
      narrative = `${failCount} of ${results.totalCount} calibration level${failCount > 1 ? "s" : ""} for ${analyteName} exceeded the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      narrative += `The regression slope of ${sf(slopeVal, 3)} and intercept of ${sf(interceptVal, 3)} suggest ${slopeInterp} and ${interceptInterp}. `;
      narrative += `<b>The results for ${analyteName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  }

  if (studyType === "method_comp") {
    const regEntries = results.regression ? Object.values(results.regression as any) : [];
    const firstReg: any = regEntries.find((r: any) => (r as any).regressionType === "Deming") || regEntries[0];
    const slopeVal: number = firstReg?.slope ?? 1;
    const interceptVal: number = firstReg?.intercept ?? 0;
    const r2Val: number = firstReg?.r2 ?? 1;
    const rVal = Math.sqrt(r2Val);
    const ba: any = results.blandAltman ? Object.values(results.blandAltman)[0] : null;
    const meanBiasPct: number = ba?.pctMeanDiff ?? ba?.meanPctBias ?? 0;
    const meanBiasAbs: number = ba?.meanDiff ?? 0;

    const correlationInterp = rVal >= 0.99 ? "excellent" : rVal >= 0.975 ? "acceptable" : "borderline, review carefully";
    const slopeInterp = Math.abs(slopeVal - 1) < 0.02
      ? "minimal proportional bias between methods"
      : slopeVal > 1
        ? `a ${sf((slopeVal - 1) * 100, 1)}% upward proportional difference, the comparison method reads slightly higher than the primary at upper concentrations`
        : `a ${sf((1 - slopeVal) * 100, 1)}% downward proportional difference, the comparison method reads slightly lower than the primary at upper concentrations`;

    const biasDescr = isAbsolute
      ? `${meanBiasAbs >= 0 ? "+" : ""}${sf(meanBiasAbs, 2)} ${(study as any)?.teaUnit || (study as any)?.tea_unit || ''}`
      : `${meanBiasPct >= 0 ? "+" : ""}${sf(meanBiasPct, 1)}%`;
    const biasInterp = isAbsolute
      ? (Math.abs(meanBiasAbs) <= cliaError
        ? `within the CLIA total allowable error of ${teaStr}`
        : `exceeds the CLIA total allowable error of ${teaStr} and requires investigation`)
      : (Math.abs(meanBiasPct) <= cliaError * 100
        ? `within the CLIA total allowable error of ${teaStr}`
        : `exceeds the CLIA total allowable error of ${teaStr} and requires investigation`);

    if (results.overallPass) {
      narrative = `The Pearson correlation coefficient of ${sf(rVal, 3)} indicates ${correlationInterp} agreement between methods for ${analyteName}. `;
      narrative += `The Deming regression slope of ${sf(slopeVal, 3)} (ideal: 1.000) indicates ${slopeInterp}. `;
      narrative += `The mean bias of ${biasDescr} is ${biasInterp}. `;
      narrative += `The Bland-Altman analysis confirms no clinically significant systematic difference between the primary and comparison methods. This method/instrument may be used for patient reporting. `;
      narrative += `<b>The results for ${analyteName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `The method comparison for ${analyteName} did not meet acceptance criteria. `;
      narrative += `The correlation of ${sf(rVal, 3)} and a mean bias of ${biasDescr} (CLIA limit: ${teaStr}) indicate unacceptable agreement between methods. `;
      narrative += `<b>The results for ${analyteName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  }

  if (studyType === "precision") {
    const levels = results.levelResults || [];
    const maxCV: number = levels.length > 0 ? Math.max(...levels.map((r: any) => r.totalCV ?? r.cv ?? 0)) : 0;
    const meetsAdlm = maxCV <= cliaError * 50;
    const isAdvanced = results.mode === "advanced";

    if (results.overallPass) {
      narrative = `The precision study for ${analyteName} demonstrated a maximum observed CV of ${sf(maxCV, 2)}%, which is within the CLIA total allowable error of ±${cliaPct}% (42 CFR §493). `;
      if (meetsAdlm) {
        narrative += `The result also meets the ADLM-recommended internal precision goal of ±${adlmPct}%, indicating performance well above the regulatory minimum. `;
      } else {
        narrative += `The ADLM recommends an internal precision goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      if (isAdvanced && levels[0]?.withinRunCV !== undefined) {
        const wrCV = levels[0].withinRunCV?.toFixed(2) ?? "-";
        const bdCV = levels[0].betweenDayCV?.toFixed(2) ?? "-";
        narrative += `ANOVA components show within-run CV of ${wrCV}% and between-day CV of ${bdCV}%, indicating a stable analytical system with consistent day-to-day performance. `;
      }
      narrative += `Manufacturer precision claims are verified. This instrument is performing with acceptable reproducibility. `;
      narrative += `<b>The results for ${analyteName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `The precision study for ${analyteName} did not meet acceptance criteria. The maximum observed CV of ${sf(maxCV, 2)}% exceeds the CLIA total allowable error of ±${cliaPct}%. `;
      narrative += `<b>The results for ${analyteName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
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
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const levelResults = results.levelResults || [];
  const assignedVals = levelResults.map(r => r.assignedValue);
  const recoveries   = levelResults.map(r => r.pctRecovery);

  // Charts
  const scatterPoints = levelResults.map(r => ({
    x: r.assignedValue,
    y: instrumentNames[0] && r.instruments[instrumentNames[0]] ? r.instruments[instrumentNames[0]].value : r.mean
  }));
  const scatterSvg = scatterSVG(scatterPoints.map(p => p.x), scatterPoints.map(p => p.y), "Assigned Value", "Measured", "Scatter Plot", true);
  const recoverySvg = recoveryPlotSVG(assignedVals, recoveries, study.cliaAllowableError);

  // Linearity summary table
  const linRows = Object.entries(results.regression || {}).map(([name, reg]) => {
    const r = Math.sqrt(reg.r2 ?? 0);
    const biasColor = Math.abs(reg.proportionalBias ?? 0) <= study.cliaAllowableError ? PASS : FAIL;
    const biasClass = Math.abs(reg.proportionalBias ?? 0) <= study.cliaAllowableError ? "pass" : "fail";
    return `<tr>
      <td>${name}</td>
      <td class="text-right">${reg.n ?? 0}</td>
      <td class="text-right">${sf(reg.slope, 4)}</td>
      <td class="text-right">${sf(reg.intercept, 4)}</td>
      <td class="text-right ${biasClass}">${sf((reg.proportionalBias ?? 0) * 100, 2)}%</td>
      <td class="text-right">${sf(r, 4)}</td>
      <td class="text-right">${sf(reg.r2, 4)}</td>
    </tr>`;
  }).join("");

  // Statistical table
  const instrHeaders = instrumentNames.map(n => `<th class="text-right">${n}</th>`).join("");
  const dataRows = levelResults.map((r, ri) => {
    const instrCells = instrumentNames.map(n => {
      const v = r.instruments[n];
      return v ? `<td class="text-right">${sf(v.value, 3)}</td>` : `<td class="text-right">-</td>`;
    }).join("");
    const pfClass = r.passFailMean === "Pass" ? "pass" : "fail";
    return `<tr class="${ri % 2 === 1 ? "stripe" : ""}">
      <td>L${r.level}</td>
      <td class="text-right">${sf(r.assignedValue, 3)}</td>
      <td class="text-right">${sf(r.mean, 3)}</td>
      <td class="text-right">${sf(r.pctRecovery, 1)}%</td>
      <td class="text-right">${sf((r.obsError ?? 0) * 100, 2)}%</td>
      <td class="text-right ${pfClass}">${r.passFailMean ?? "---"}</td>
      ${instrCells}
    </tr>`;
  }).join("");

  // Compact summary stats for page 1
  const firstReg = Object.values(results.regression || {})[0] as any;
  const compactSlope = firstReg ? sf(firstReg.slope, 4) : "---";
  const compactR2 = firstReg ? sf(firstReg.r2, 4) : "---";
  const maxRecovery = recoveries.length > 0 ? sf(Math.max(...recoveries), 1) + "%" : "---";
  const minRecovery = recoveries.length > 0 ? sf(Math.min(...recoveries), 1) + "%" : "---";
  const compactPassCount = `${results.passCount}/${results.totalCount}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Calibration Verification / Linearity - ${study.testName}</title><style>${CSS}
  /* Page numbering */
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="section-heading">Calibration Verification / Linearity</div>
  <div class="charts">${scatterSvg}${recoverySvg}</div>

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Slope</td><td style="width:25%">${compactSlope}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">R²</td><td style="width:25%">${compactR2}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Max % Recovery</td><td>${maxRecovery}</td>
          <td style="color:${MUTED};font-weight:700">Min % Recovery</td><td>${minRecovery}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Points Passing</td><td>${compactPassCount}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${results.overallPass ? "PASS" : "FAIL"}</td></tr>
    </tbody>
  </table>

  ${narrativeHTML("cal_ver", results, study.cliaAllowableError, study.testName, study)}

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}

  ${directorReviewHTML()}

  <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    <div class="section-label" style="margin-top:8px">Linearity Summary</div>
    <table>
      <thead><tr>
        <th></th><th class="text-right">N</th><th class="text-right">Slope</th>
        <th class="text-right">Intercept</th><th class="text-right">Prop. Bias</th>
        <th class="text-right">R</th><th class="text-right">R²</th>
      </tr></thead>
      <tbody>${linRows}</tbody>
    </table>

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Sample-by-Sample Results</div>
    <table>
      <thead><tr>
        <th></th><th class="text-right">Assigned</th><th class="text-right">Mean</th>
        <th class="text-right">% Rec</th><th class="text-right">Obs Err</th>
        <th class="text-right">Pass?</th>${instrHeaders}
      </tr></thead>
      <tbody>${dataRows}</tbody>
    </table>
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError, study)}
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

// ─── Kappa interpretation (mirrors client) ──────────────────────────────────
function interpretKappa(k: number): string {
  if (k < 0.20) return "Poor";
  if (k <= 0.40) return "Fair";
  if (k <= 0.60) return "Moderate";
  if (k <= 0.80) return "Substantial";
  return "Almost Perfect";
}

// ─── QUALITATIVE METHOD COMPARISON HTML ─────────────────────────────────────
function buildQualitativeHTML(study: Study, results: any): string {
  const allInstrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const primaryName = allInstrumentNames[0] || "Reference";
  const compName = allInstrumentNames[1] || "Comparison";

  const categories: string[] = results.categories || [];
  const matrix: { [ref: string]: { [comp: string]: number } } = results.concordanceMatrix || {};
  const totalSamples: number = results.totalSamples || 0;
  const pctAgreement: number = results.percentAgreement || 0;
  const kappa: number = results.cohensKappa || 0;
  const kappaInterp = interpretKappa(kappa);
  const sensitivity: number = results.sensitivity || 0;
  const specificity: number = results.specificity || 0;
  const passThreshold: number = results.passThreshold || 90;
  const overallPass: boolean = results.overallPass ?? (pctAgreement >= passThreshold);

  // Build concordance matrix table
  const matrixHeaders = categories.map(c => `<th class="text-center">${c}</th>`).join("");
  const matrixRows = categories.map((ref, ri) => {
    const cells = categories.map(comp => {
      const count = (matrix[ref] && matrix[ref][comp]) || 0;
      const isAgreement = ref === comp;
      const bgColor = isAgreement ? "#dcfce7" : (count > 0 ? "#fee2e2" : "transparent");
      return `<td class="text-center" style="background:${bgColor};font-weight:${count > 0 ? '600' : '400'}">${count}</td>`;
    }).join("");
    return `<tr class="${ri % 2 === 1 ? 'stripe' : ''}"><td style="font-weight:600">${ref}</td>${cells}</tr>`;
  }).join("");

  const verdictText = overallPass
    ? `Qualitative method comparison meets acceptance criteria — ${sf(pctAgreement, 1)}% agreement (threshold: ≥${passThreshold}%)`
    : `Qualitative method comparison does not meet acceptance criteria — ${sf(pctAgreement, 1)}% agreement (threshold: ≥${passThreshold}%)`;

  const narrative = overallPass
    ? `The qualitative method comparison for ${study.testName} demonstrated ${sf(pctAgreement, 1)}% overall agreement between ${primaryName} and ${compName} across ${totalSamples} samples. Cohen's kappa of ${sf(kappa, 3)} indicates "${kappaInterp}" agreement beyond chance. ${categories.length === 2 ? `Sensitivity was ${sf(sensitivity * 100, 1)}% and specificity was ${sf(specificity * 100, 1)}%. ` : ''}These results meet the acceptance threshold of ≥${passThreshold}% agreement. <b>Final approval and clinical determination must be made by the laboratory director or designee.</b>`
    : `The qualitative method comparison for ${study.testName} showed ${sf(pctAgreement, 1)}% overall agreement between ${primaryName} and ${compName} across ${totalSamples} samples. Cohen's kappa of ${sf(kappa, 3)} indicates "${kappaInterp}" agreement beyond chance. ${categories.length === 2 ? `Sensitivity was ${sf(sensitivity * 100, 1)}% and specificity was ${sf(specificity * 100, 1)}%. ` : ''}These results do not meet the acceptance threshold of ≥${passThreshold}% agreement. <b>Investigation and corrective action are recommended. Final determination must be made by the laboratory director or designee.</b>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Qualitative Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="section-heading">Qualitative Method Comparison Study</div>
  <div class="report-title-sub">Reference Method: ${primaryName} | Comparison Method: ${compName}</div>

  <hr class="divider">
  <div class="section-label">Concordance Matrix</div>
  <table>
    <thead><tr><th>${primaryName} \\ ${compName}</th>${matrixHeaders}</tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
  <div style="font-size:6.5pt;color:${MUTED};margin-top:3px"><span style="background:#dcfce7;padding:1px 4px;border-radius:2px">Green</span> = agreement &nbsp; <span style="background:#fee2e2;padding:1px 4px;border-radius:2px">Red</span> = discordant</div>

  <hr class="divider" style="margin-top:8px">
  <div class="section-label">Key Statistics</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Total Samples</td><td style="width:25%">${totalSamples}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">% Agreement</td><td style="width:25%" class="${overallPass ? 'pass' : 'fail'}">${sf(pctAgreement, 1)}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Cohen's Kappa (\u03BA)</td><td>${sf(kappa, 3)} (${kappaInterp})</td>
          <td style="color:${MUTED};font-weight:700">Acceptance Threshold</td><td>\u2265${passThreshold}%</td></tr>
      ${categories.length === 2 ? `<tr><td style="color:${MUTED};font-weight:700">Sensitivity</td><td>${sf(sensitivity * 100, 1)}%</td>
          <td style="color:${MUTED};font-weight:700">Specificity</td><td>${sf(specificity * 100, 1)}%</td></tr>` : ''}
      <tr><td style="color:${MUTED};font-weight:700">Overall</td><td class="${overallPass ? 'pass' : 'fail'}">${overallPass ? 'PASS' : 'FAIL'}</td>
          <td></td><td></td></tr>
    </tbody>
  </table>

  <div class="eval-section">
    <hr class="divider">
    <div class="eval-title">Evaluation of Results</div>
    <div class="eval-text">${narrative}</div>
    <div class="verdict ${overallPass ? 'pass-bg' : 'fail-bg'}">${verdictText}</div>
  </div>

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  ${supportingPageHTML(study, allInstrumentNames)}
  </body></html>`;
}

// ─── SEMI-QUANTITATIVE METHOD COMPARISON HTML ───────────────────────────────
function buildSemiQuantHTML(study: Study, results: any): string {
  const allInstrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const primaryName = allInstrumentNames[0] || "Reference";
  const compName = allInstrumentNames[1] || "Comparison";

  const gradeScale: string[] = results.gradeScale || [];
  const matrix: { [ref: string]: { [comp: string]: number } } = results.concordanceMatrix || {};
  const totalSamples: number = results.totalSamples || 0;
  const pctExact: number = results.percentExactAgreement || 0;
  const pctWithinOne: number = results.percentWithinOneGrade || 0;
  const wKappa: number = results.weightedKappa || 0;
  const wKappaInterp = interpretKappa(wKappa);
  const maxDiscrep: number = results.maxDiscrepancy || 0;
  const passThreshold: number = results.passThreshold || 80;
  const overallPass: boolean = results.overallPass ?? (pctWithinOne >= passThreshold);
  const sampleDetails: any[] = results.sampleDetails || [];

  // Build concordance matrix with color coding
  const matrixHeaders = gradeScale.map(g => `<th class="text-center">${g}</th>`).join("");
  const matrixRows = gradeScale.map((ref, ri) => {
    const refIdx = gradeScale.indexOf(ref);
    const cells = gradeScale.map(comp => {
      const compIdx = gradeScale.indexOf(comp);
      const count = (matrix[ref] && matrix[ref][comp]) || 0;
      const diff = Math.abs(refIdx - compIdx);
      const bgColor = diff === 0 ? "#dcfce7" : diff === 1 ? "#fef9c3" : (count > 0 ? "#fee2e2" : "transparent");
      return `<td class="text-center" style="background:${bgColor};font-weight:${count > 0 ? '600' : '400'}">${count}</td>`;
    }).join("");
    return `<tr class="${ri % 2 === 1 ? 'stripe' : ''}"><td style="font-weight:600">${ref}</td>${cells}</tr>`;
  }).join("");

  // Sample-by-sample detail table
  const detailRows = sampleDetails.map((s: any, i: number) => {
    const diff = Math.abs(s.refIndex - s.compIndex);
    const statusClass = diff === 0 ? "pass" : diff === 1 ? "warn" : "fail";
    const statusText = diff === 0 ? "Exact" : diff === 1 ? "\u00B11" : `\u00B1${diff}`;
    return `<tr class="${i % 2 === 1 ? 'stripe' : ''}">
      <td>S${s.sampleNum || i + 1}</td>
      <td class="text-center">${s.refGrade}</td>
      <td class="text-center">${s.compGrade}</td>
      <td class="text-center ${statusClass}">${statusText}</td>
    </tr>`;
  }).join("");

  const verdictText = overallPass
    ? `Semi-quantitative method comparison meets acceptance criteria — ${sf(pctWithinOne, 1)}% within \u00B11 grade (threshold: \u2265${passThreshold}%)`
    : `Semi-quantitative method comparison does not meet acceptance criteria — ${sf(pctWithinOne, 1)}% within \u00B11 grade (threshold: \u2265${passThreshold}%)`;

  const narrative = overallPass
    ? `The semi-quantitative method comparison for ${study.testName} demonstrated ${sf(pctExact, 1)}% exact agreement and ${sf(pctWithinOne, 1)}% agreement within \u00B11 grade between ${primaryName} and ${compName} across ${totalSamples} samples. The weighted kappa of ${sf(wKappa, 3)} indicates "${wKappaInterp}" ordinal agreement. The maximum discrepancy observed was ${maxDiscrep} grade${maxDiscrep !== 1 ? 's' : ''}. These results meet the acceptance threshold of \u2265${passThreshold}% within \u00B11 grade. <b>Final approval and clinical determination must be made by the laboratory director or designee.</b>`
    : `The semi-quantitative method comparison for ${study.testName} showed ${sf(pctExact, 1)}% exact agreement and ${sf(pctWithinOne, 1)}% agreement within \u00B11 grade between ${primaryName} and ${compName} across ${totalSamples} samples. The weighted kappa of ${sf(wKappa, 3)} indicates "${wKappaInterp}" ordinal agreement. The maximum discrepancy was ${maxDiscrep} grade${maxDiscrep !== 1 ? 's' : ''}. These results do not meet the acceptance threshold of \u2265${passThreshold}% within \u00B11 grade. <b>Investigation and corrective action are recommended. Final determination must be made by the laboratory director or designee.</b>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Semi-Quantitative Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="section-heading">Semi-Quantitative Method Comparison Study</div>
  <div class="report-title-sub">Reference Method: ${primaryName} | Comparison Method: ${compName} | Scale: ${gradeScale.join(" \u2192 ")}</div>

  <hr class="divider">
  <div class="section-label">Concordance Matrix</div>
  <table>
    <thead><tr><th>${primaryName} \\ ${compName}</th>${matrixHeaders}</tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>
  <div style="font-size:6.5pt;color:${MUTED};margin-top:3px"><span style="background:#dcfce7;padding:1px 4px;border-radius:2px">Green</span> = exact &nbsp; <span style="background:#fef9c3;padding:1px 4px;border-radius:2px">Yellow</span> = \u00B11 grade &nbsp; <span style="background:#fee2e2;padding:1px 4px;border-radius:2px">Red</span> = >\u00B11 grade</div>

  <hr class="divider" style="margin-top:8px">
  <div class="section-label">Key Statistics</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Total Samples</td><td style="width:25%">${totalSamples}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">Exact Agreement</td><td style="width:25%">${sf(pctExact, 1)}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Within \u00B11 Grade</td><td class="${overallPass ? 'pass' : 'fail'}">${sf(pctWithinOne, 1)}%</td>
          <td style="color:${MUTED};font-weight:700">Acceptance Threshold</td><td>\u2265${passThreshold}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Weighted Kappa (\u03BA<sub>w</sub>)</td><td>${sf(wKappa, 3)} (${wKappaInterp})</td>
          <td style="color:${MUTED};font-weight:700">Max Discrepancy</td><td>${maxDiscrep} grade${maxDiscrep !== 1 ? 's' : ''}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Overall</td><td class="${overallPass ? 'pass' : 'fail'}">${overallPass ? 'PASS' : 'FAIL'}</td>
          <td></td><td></td></tr>
    </tbody>
  </table>

  <div class="eval-section">
    <hr class="divider">
    <div class="eval-title">Evaluation of Results</div>
    <div class="eval-text">${narrative}</div>
    <div class="verdict ${overallPass ? 'pass-bg' : 'fail-bg'}">${verdictText}</div>
  </div>

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
  ${directorReviewHTML()}

  <div class="stats-section">
    <div class="section-label">Sample-by-Sample Detail</div>
    <table>
      <thead><tr>
        <th>Sample</th><th class="text-center">${primaryName} (Ref)</th><th class="text-center">${compName}</th><th class="text-center">Status</th>
      </tr></thead>
      <tbody>${detailRows}</tbody>
    </table>
  </div>

  ${supportingPageHTML(study, allInstrumentNames)}
  </body></html>`;
}

function buildMethodCompHTML(study: Study, results: MethodCompData): string {
  const allInstrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const primaryName = allInstrumentNames[0] || "Primary";
  const levelResults = results.levelResults || [];
  // Comparison instruments are those that appear in the results' instruments
  const comparisonNames = levelResults.length > 0
    ? Object.keys(levelResults[0].instruments || {})
    : allInstrumentNames.slice(1);

  // Build per-comparison sections
  let comparisonSections = "";
  for (const compName of comparisonNames) {
    // Chart data for this comparison
    const xVals = levelResults.map(r => r.referenceValue);
    const yVals = levelResults.filter(r => r.instruments?.[compName]).map(r => r.instruments[compName].value);
    const corrSvg = scatterSVG(xVals, yVals.length ? yVals : xVals, `${primaryName} (Primary)`, compName, `${compName} vs. ${primaryName}`, true);

    const baEntry = (results.blandAltman || {})[compName];
    const avgs = levelResults.filter(r => r.instruments?.[compName]).map(r => (r.referenceValue + r.instruments[compName].value) / 2);
    const pctDiffs = levelResults.filter(r => r.instruments?.[compName]).map(r => r.instruments[compName].pctDifference);
    const baSvg = blandAltmanSVG(avgs, pctDiffs, study.cliaAllowableError, baEntry?.pctMeanDiff ?? 0, compName);

    // Supporting statistics
    const demKey = Object.keys(results.regression || {}).find(k => k.includes(compName) && k.includes("Deming"));
    const demEntry = demKey ? (results.regression || {})[demKey] : undefined;
    const corrCoef = demEntry ? sf(Math.sqrt(demEntry.r2 ?? 0), 4) : "---";
    const xRange = results.xRange || { min: 0, max: 0 };
    const xMeanVal = sf(((xRange.min ?? 0) + (xRange.max ?? 0)) / 2, 3);

    const suppStatsLeft = [
      ["Corr Coef (R):", corrCoef],
      ["Mean Bias:", baEntry ? sf(baEntry.meanDiff, 3) : "---"],
      ["Primary Mean:", xMeanVal],
      ["Std Dev Diffs:", baEntry ? sf(baEntry.sdDiff, 3) : "---"],
    ];
    const yRange = results.yRange || {};
    const suppStatsRight = [
      ["Points (Plotted/Total):", `${levelResults.length}/${levelResults.length}`],
      ["Primary Range:", `${sf(xRange.min, 3)} to ${sf(xRange.max, 3)}`],
      ...(yRange[compName] ? [[`${compName} Range:`, `${sf(yRange[compName].min, 3)} to ${sf(yRange[compName].max, 3)}`]] : []),
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

    // Regression rows for this comparison only
    const regRowsForComp = Object.entries(results.regression || {})
      .filter(([name]) => name.includes(compName))
      .map(([name, reg]) => {
        const shortName = name.includes("Deming") ? "Deming" : "OLS";
        const slopeStr = reg.slopeLo !== undefined ? `${sf(reg.slope, 4)} (${sf(reg.slopeLo, 3)}-${sf(reg.slopeHi, 3)})` : sf(reg.slope, 4);
        const intStr = reg.interceptLo !== undefined ? `${sf(reg.intercept, 4)} (${sf(reg.interceptLo, 3)}-${sf(reg.interceptHi, 3)})` : sf(reg.intercept, 4);
        const biasClass = Math.abs(reg.proportionalBias ?? 0) <= study.cliaAllowableError ? "pass" : "fail";
        return `<tr>
          <td>${shortName}</td>
          <td class="text-right">${reg.n ?? 0}</td>
          <td class="text-right">${slopeStr}</td>
          <td class="text-right">${intStr}</td>
          <td class="text-right">${sf(reg.see, 4)}</td>
          <td class="text-right ${biasClass}">${sf((reg.proportionalBias ?? 0) * 100, 2)}%</td>
          <td class="text-right">${sf(Math.sqrt(reg.r2 ?? 0), 4)}</td>
          <td class="text-right">${sf(reg.r2, 4)}</td>
        </tr>`;
      }).join("");

    // Bland-Altman row for this comparison
    const baRow = baEntry ? (() => {
      const biasClass = isAbsoluteTea(study)
        ? (Math.abs(baEntry.meanDiff ?? 0) <= study.cliaAllowableError ? "pass" : "fail")
        : (Math.abs(baEntry.pctMeanDiff ?? 0) <= study.cliaAllowableError * 100 ? "pass" : "fail");
      return `<tr>
        <td>${compName}</td>
        <td class="text-right">${sf(baEntry.meanDiff, 4)}</td>
        <td class="text-right ${biasClass}">${sf(baEntry.pctMeanDiff, 2)}%</td>
        <td class="text-right">${sf(baEntry.sdDiff, 4)}</td>
        <td class="text-right">${sf(baEntry.loa_lower, 4)}</td>
        <td class="text-right">${sf(baEntry.loa_upper, 4)}</td>
      </tr>`;
    })() : "";

    comparisonSections += `
    <div class="section-heading" style="margin-top:14px">${compName} vs. ${primaryName} - Method Comparison</div>

    <hr class="divider">
    <div class="section-label">Supporting Statistics</div>
    <table style="font-size:8pt"><tbody>${suppRows}</tbody></table>

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Deming Regression: ${compName} vs. ${primaryName}</div>
    <table>
      <thead><tr>
        <th>Method</th><th class="text-right">N</th><th class="text-right">Slope (95% CI)</th>
        <th class="text-right">Intercept (95% CI)</th><th class="text-right">SEE</th>
        <th class="text-right">Prop. Bias</th><th class="text-right">R</th><th class="text-right">R\u00B2</th>
      </tr></thead>
      <tbody>${regRowsForComp}</tbody>
    </table>
    <div style="font-size:6.5pt;color:${MUTED};margin-top:3px">95% Confidence Intervals shown in parentheses (OLS only)</div>

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Bland-Altman Bias Summary</div>
    <table>
      <thead><tr>
        <th>Comparison Method</th><th class="text-right">Mean Bias</th><th class="text-right">Mean % Bias</th>
        <th class="text-right">SD of Diff</th><th class="text-right">95% LoA Lower</th><th class="text-right">95% LoA Upper</th>
      </tr></thead>
      <tbody>${baRow}</tbody>
    </table>
    `;
  }

  // Level-by-level table
  const instrHeaders = comparisonNames.flatMap(n => [
    `<th class="text-right">${n}</th>`,
    `<th class="text-right">Bias</th>`,
    `<th class="text-right">% Diff</th>`,
    `<th class="text-right">Pass?</th>`,
  ]).join("");

  const levelRows = levelResults.map((r, ri) => {
    const instrCells = comparisonNames.flatMap(n => {
      const v = r.instruments[n];
      if (!v) return [`<td>---</td>`, `<td>---</td>`, `<td>---</td>`, `<td>---</td>`];
      const pfClass = v.passFail === "Pass" ? "pass" : "fail";
      return [
        `<td class="text-right">${sf(v.value, 3)}</td>`,
        `<td class="text-right">${sf(v.difference, 3)}</td>`,
        `<td class="text-right">${sf(v.pctDifference, 2)}%</td>`,
        `<td class="text-right ${pfClass}">${v.passFail}</td>`,
      ];
    }).join("");
    return `<tr class="${ri % 2 === 1 ? "stripe" : ""}">
      <td>S${r.level}</td>
      <td class="text-right">${sf(r.referenceValue, 3)}</td>
      ${instrCells}
    </tr>`;
  }).join("");

  // Compact key stats for page 1 — use the first comparison instrument
  const firstCompName = comparisonNames[0] || "";
  const firstDemKey = Object.keys(results.regression || {}).find(k => k.includes(firstCompName) && k.includes("Deming"));
  const firstDemEntry = firstDemKey ? (results.regression || {})[firstDemKey] : undefined;
  const firstBAEntry = (results.blandAltman || {})[firstCompName];
  const compactCorrCoef = firstDemEntry ? sf(Math.sqrt(firstDemEntry.r2 ?? 0), 4) : "---";
  const compactDemSlope = firstDemEntry ? sf(firstDemEntry.slope, 4) : "---";
  const compactMeanBias = firstBAEntry ? sf(firstBAEntry.meanDiff, 3) : "---";
  const compactMeanPctBias = firstBAEntry ? sf(firstBAEntry.pctMeanDiff, 2) + "%" : "---";
  const compactMCPassCount = `${results.passCount}/${results.totalCount}`;

  // Build charts for just the first comparison for page 1
  const p1xVals = levelResults.map(r => r.referenceValue);
  const p1yVals = levelResults.filter(r => r.instruments?.[firstCompName]).map(r => r.instruments[firstCompName].value);
  const p1CorrSvg = scatterSVG(p1xVals, p1yVals.length ? p1yVals : p1xVals, `${primaryName} (Primary)`, firstCompName, `${firstCompName} vs. ${primaryName}`, true);
  const p1avgs = levelResults.filter(r => r.instruments?.[firstCompName]).map(r => (r.referenceValue + r.instruments[firstCompName].value) / 2);
  const p1pctDiffs = levelResults.filter(r => r.instruments?.[firstCompName]).map(r => r.instruments[firstCompName].pctDifference);
  const p1BaSvg = blandAltmanSVG(p1avgs, p1pctDiffs, study.cliaAllowableError, firstBAEntry?.pctMeanDiff ?? 0, firstCompName);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Correlation / Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="section-heading">Correlation / Method Comparison Study</div>
  <div class="report-title-sub">Primary Method: ${primaryName} | Comparison Method${comparisonNames.length > 1 ? "s" : ""}: ${comparisonNames.join(", ")}</div>

  <div class="charts">${p1CorrSvg}${p1BaSvg}</div>

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Corr Coef (R)</td><td style="width:25%">${compactCorrCoef}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">Deming Slope</td><td style="width:25%">${compactDemSlope}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Mean Bias</td><td>${compactMeanBias}</td>
          <td style="color:${MUTED};font-weight:700">Mean % Bias</td><td>${compactMeanPctBias}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Points Passing</td><td>${compactMCPassCount}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${results.overallPass ? "PASS" : "FAIL"}</td></tr>
    </tbody>
  </table>

  ${narrativeHTML("method_comp", results, study.cliaAllowableError, study.testName, study)}

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}

  ${directorReviewHTML()}

  <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    ${comparisonSections}

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Sample-by-Sample Comparison Results</div>
    <table>
      <thead><tr>
        <th>Sample</th><th class="text-right">${primaryName} (Primary)</th>${instrHeaders}
      </tr></thead>
      <tbody>${levelRows}</tbody>
    </table>
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError, study)}
  </div>

  ${supportingPageHTML(study, allInstrumentNames)}
  </body></html>`;
}

// ─── PRECISION HTML report ───────────────────────────────────────────────────
function buildPrecisionHTML(study: Study, results: any): string {
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const cliaCV = (study.cliaAllowableError * 100).toFixed(1);
  const isAdvanced = results.mode === "advanced";
  const levelResults = results.levelResults || [];

  const summaryRows = levelResults.map((r: any, i: number) => {
    const pfClass = r.passFail === "Pass" ? "pass" : "fail";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${r.levelName}</td>
      <td class="text-right">${r.n}</td>
      <td class="text-right">${sf(r.mean, 3)}</td>
      <td class="text-right">${sf(r.sd, 3)}</td>
      <td class="text-right">${sf(r.cv, 2)}%</td>
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
      <tbody>${levelResults.map((r: any, i: number) => `
        <tr class="${i % 2 === 1 ? "stripe" : ""}">
          <td>${r.levelName}</td>
          <td class="text-right">${r.withinRunSD?.toFixed(4) ?? "-"}</td>
          <td class="text-right">${r.withinRunCV?.toFixed(2) ?? "-"}%</td>
          <td class="text-right">${r.betweenRunCV?.toFixed(2) ?? "-"}%</td>
          <td class="text-right">${r.betweenDayCV?.toFixed(2) ?? "-"}%</td>
          <td class="text-right" style="font-weight:700">${r.totalCV?.toFixed(2) ?? "-"}%</td>
        </tr>`).join("")}
      </tbody>
    </table>` : "";

  const dataPoints = safeJsonParse((study as any).dataPoints, []) || [];
  const valuesSection = levelResults.map((r: any, li: number) => {
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

  // Compact key stats for page 1
  const precMean = levelResults.length > 0 ? sf(levelResults[0].mean, 3) : "---";
  const precSD = levelResults.length > 0 ? sf(levelResults[0].sd, 3) : "---";
  const precMaxCV = levelResults.length > 0 ? sf(Math.max(...levelResults.map((r: any) => r.cv ?? 0)), 2) + "%" : "---";
  const precPassCount = `${results.passCount}/${results.totalCount}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Precision Verification (EP15) - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="section-heading">Precision Verification (EP15)</div>

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Mean</td><td style="width:25%">${precMean}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">SD</td><td style="width:25%">${precSD}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">CV%</td><td>${precMaxCV}</td>
          <td style="color:${MUTED};font-weight:700">Allowable CV%</td><td>±${cliaCV}%</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Points Passing</td><td>${precPassCount}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${results.overallPass ? "PASS" : "FAIL"}</td></tr>
    </tbody>
  </table>

  ${narrativeHTML("precision", results, study.cliaAllowableError, study.testName, study)}

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}

  ${directorReviewHTML()}

  <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    <div class="section-label" style="margin-top:8px">Precision Summary</div>
    <table>
      <thead><tr>
        <th>Level</th><th class="text-right">N</th><th class="text-right">Mean</th>
        <th class="text-right">SD</th><th class="text-right">CV%</th>
        <th class="text-right">Allow CV%</th><th class="text-right">Pass?</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>

    ${anovaSection}

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Individual Measurements</div>
    ${valuesSection}
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError, study)}
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
function buildRefIntervalHTML(study: Study, results: any): string {
  const analyte = results.analyte || study.testName;
  const units = results.units || "";
  const refLow = results.refLow;
  const refHigh = results.refHigh;
  const n = results.n;
  const outsideCount = results.outsideCount;
  const outsidePct = typeof results.outsidePct === "number" ? results.outsidePct.toFixed(1) : "0.0";
  const overallPass = results.overallPass;

  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass ? "Meets CLSI EP28-A3c criteria" : "Does not meet CLSI EP28-A3c criteria";

  const cliaStatement = overallPass
    ? `<b>The reference range verification for ${analyte} meets the criteria per 42 CFR \u00A7493.1253(b)(2) and CLSI EP28-A3c.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The reference range verification for ${analyte} does not meet the criteria per 42 CFR \u00A7493.1253(b)(2) and CLSI EP28-A3c.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const specimens = (results.specimens || []) as { specimenId: string; value: number; inRange: boolean }[];
  const dataRows = specimens.map((s, i) => {
    const pfClass = s.inRange ? "pass" : "fail";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${s.specimenId}</td>
      <td class="text-right">${sf(s.value, 4)}</td>
      <td class="text-right">${refLow} – ${refHigh}</td>
      <td class="text-right ${pfClass}">${s.inRange ? "In Range" : "Outside"}</td>
    </tr>`;
  }).join("");

  // Distribution bar chart SVG
  const values = specimens.map(s => s.value);
  const minVal = Math.min(...values, refLow);
  const maxVal = Math.max(...values, refHigh);
  const range = maxVal - minVal || 1;
  const W = 400; const H = 80;
  const toX = (v: number) => ((v - minVal) / range) * (W - 40) + 20;
  const lowX = toX(refLow); const highX = toX(refHigh);
  const dots = specimens.map(s => {
    const x = toX(s.value);
    const color = s.inRange ? "#01696F" : "#C0392B";
    return `<circle cx="${x}" cy="40" r="4" fill="${color}" opacity="0.8"/>`;
  }).join("");
  const chartSVG = `<svg width="${W}" height="${H}" style="display:block;margin:0 auto;">
    <rect x="${lowX}" y="20" width="${highX - lowX}" height="40" fill="#01696F" opacity="0.12" rx="3"/>
    <line x1="${lowX}" y1="15" x2="${lowX}" y2="65" stroke="#01696F" stroke-width="1.5" stroke-dasharray="4,2"/>
    <line x1="${highX}" y1="15" x2="${highX}" y2="65" stroke="#01696F" stroke-width="1.5" stroke-dasharray="4,2"/>
    <text x="${lowX}" y="12" text-anchor="middle" font-size="7" fill="#01696F">${refLow}</text>
    <text x="${highX}" y="12" text-anchor="middle" font-size="7" fill="#01696F">${refHigh}</text>
    <text x="${(lowX + highX) / 2}" y="72" text-anchor="middle" font-size="7" fill="#01696F">Reference Range</text>
    ${dots}
  </svg>`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary} ${cliaStatement}</p>
  </div>`;

  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Reference Range</div><div class="stat-value">${refLow} – ${refHigh} ${units}</div></div>
      <div class="stat-item"><div class="stat-label">Specimens Tested</div><div class="stat-value">${n}</div></div>
      <div class="stat-item"><div class="stat-label">Outside Range</div><div class="stat-value">${outsideCount} (${outsidePct}%)</div></div>
      <div class="stat-item"><div class="stat-label">CLSI EP28-A3c Criterion</div><div class="stat-value">≤10% outside</div></div>
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Reference Range Verification - ${study.testName}</title><style>${CSS}</style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="section-heading">Reference Range Verification</div>
  <div class="verdict-banner ${passClass}">${overallPass ? "\u2714" : "\u2718"} ${verdictText}</div>
  ${summaryStats}
  <div style="margin:12px 0 6px;font-size:8pt;font-weight:600;color:#01696F;">Distribution Plot</div>
  <div style="margin-bottom:12px;">${chartSVG}</div>
  ${narrative}
  ${regulatoryComplianceBoxHTML("ref_interval", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  <div class="page-break"></div>
  <div class="section-heading">Individual Specimen Results</div>
  <table>
    <thead><tr><th>Specimen ID</th><th class="text-right">Result (${units})</th><th class="text-right">Ref Range</th><th class="text-right">In Range?</th></tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </body></html>`;
}

function buildLotToLotHTML(study: Study, results: any): string {
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const rawData = safeJsonParse(study.dataPoints) || {};
  const teaPct = (study.cliaAllowableError * 100).toFixed(1);

  // Split cohort sections: page 1 gets charts + compact summary, page 2 gets full data tables
  let cohortChartSections = "";
  let cohortDataSections = "";
  for (const cohort of (results.cohorts || [])) {
    const specimens = cohort.specimens || [];
    const currentVals = specimens.map((s: any) => s.currentLot);
    const newVals = specimens.map((s: any) => s.newLot);
    const pctDiffs = specimens.map((s: any) => s.pctDifference);
    const specimenNums = specimens.map((_: any, i: number) => i + 1);

    const scatter = scatterSVG(currentVals, newVals, "Current Lot", "New Lot", `${cohort.cohort} - Scatter`, true);
    const diffPlot = differencePlotSVG(specimenNums, pctDiffs, study.cliaAllowableError);

    const dataRows = specimens.map((s: any, i: number) => {
      const pfClass = s.passFail === "Pass" ? "pass" : "fail";
      return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
        <td>${s.specimenId}</td>
        <td class="text-right">${sf(s.currentLot, 3)}</td>
        <td class="text-right">${sf(s.newLot, 3)}</td>
        <td class="text-right">${sf(s.pctDifference, 2)}%</td>
        <td class="text-right ${pfClass}">${s.passFail}</td>
      </tr>`;
    }).join("");

    // Page 1: charts only
    cohortChartSections += `
      <div class="section-label">${cohort.cohort} Cohort</div>
      <div class="charts">${scatter}${diffPlot}</div>
    `;

    // Page 2: full data tables
    cohortDataSections += `
      <div class="section-label">${cohort.cohort} Cohort - Individual Results</div>
      <table>
        <thead><tr><th>Specimen</th><th class="text-right">Current Lot</th><th class="text-right">New Lot</th><th class="text-right">% Diff</th><th class="text-right">Pass?</th></tr></thead>
        <tbody>${dataRows}</tbody>
      </table>
    `;
  }

  const lotInfo = rawData.currentLot ? `<div style="font-size:8pt;margin-bottom:6px">Current Lot: ${rawData.currentLot} · New Lot: ${rawData.newLot} · Analyte: ${rawData.analyte || study.testName} ${rawData.units ? `(${rawData.units})` : ""}</div>` : "";

  // Compact key stats for page 1
  const firstCohort = (results.cohorts || [])[0];
  const l2lMeanPctDiff = firstCohort ? sf(firstCohort.meanPctDiff, 2) + "%" : "---";
  const l2lMaxAbsPctDiff = firstCohort ? sf(firstCohort.maxAbsPctDiff, 2) + "%" : "---";
  const l2lPassCount = `${results.passCount}/${results.totalCount}`;

  const cliaStatement = results.overallPass
    ? `<b>The results for ${study.testName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The results for ${study.testName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Lot-to-Lot Verification - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="section-heading">Lot-to-Lot Verification</div>
  ${lotInfo}
  ${cohortChartSections}

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Mean % Diff</td><td style="width:25%">${l2lMeanPctDiff}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">Max |% Diff|</td><td style="width:25%">${l2lMaxAbsPctDiff}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Points Passing</td><td>${l2lPassCount}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${results.overallPass ? "PASS" : "FAIL"}</td></tr>
    </tbody>
  </table>

  ${narrative}
  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
  ${directorReviewHTML()}

  <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>
    ${cohortDataSections}
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError, study)}
  </div>

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
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const rawData = safeJsonParse(study.dataPoints) || {};
  const { module1 = { specimens: [], n: 0, geoMeanPT: 0, geoMeanINR: 0, ptRI: { low: 0, high: 0 }, inrRI: { low: 0, high: 0 }, ptRIPass: true, inrRIPass: true, ptOutsideRI: 0, inrOutsideRI: 0, pass: true }, module2 = { errorIndexResults: [], regression: { slope: 0, intercept: 0, r2: 0 }, pass: true, meanEI: 0, sdEI: 0, n: 0 }, module3 } = results;

  // Module 1 section
  const m1DataRows = (module1.specimens || []).map((s: any, i: number) => {
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${s.id}</td>
      <td class="text-right">${s.pt.toFixed(1)}</td>
      <td class="text-right">${s.inr.toFixed(2)}</td>
      <td class="text-right ${s.ptInRI ? "pass" : "fail"}">${s.ptInRI ? "Yes" : "No"}</td>
      <td class="text-right ${s.inrInRI ? "pass" : "fail"}">${s.inrInRI ? "Yes" : "No"}</td>
    </tr>`;
  }).join("");

  const m1Section = `
    <div class="section-heading">Module 1: Normal Patient Mean & Reference Range Verification</div>
    <div class="supp-stats">
      <span class="key">N:</span><span>${module1.n}</span>
      <span class="key">Geometric Mean PT:</span><span>${module1.geoMeanPT.toFixed(2)} sec</span>
      <span class="key">Geometric Mean INR:</span><span>${module1.geoMeanINR.toFixed(3)}</span>
      <span class="key">ISI:</span><span>${rawData.module1?.isi ?? "-"}</span>
      <span class="key">PT RI:</span><span>${module1.ptRI.low}–${module1.ptRI.high} sec</span>
      <span class="key">INR RI:</span><span>${module1.inrRI.low}–${module1.inrRI.high}</span>
      <span class="key">PT Outside RI:</span><span class="${module1.ptRIPass ? "pass" : "fail"}">${module1.ptOutsideRI}/${module1.n} (${module1.ptRIPass ? "PASS" : "FAIL"})</span>
      <span class="key">INR Outside RI:</span><span class="${module1.inrRIPass ? "pass" : "fail"}">${module1.inrOutsideRI}/${module1.n} (${module1.inrRIPass ? "PASS" : "FAIL"})</span>
    </div>
  `;

  // Module 2 section - Deming with Error Index
  const m2 = module2 || { errorIndexResults: [], regression: { r: 0, slope: 1, intercept: 0, see: 0, n: 0 }, averageErrorIndex: 0, errorIndexRange: { min: 0, max: 0 }, pass: true, coverage: 100, tea: 0 };
  const m2EIResults = m2.errorIndexResults || [];
  const m2Scatter = scatterSVG(
    m2EIResults.map((r: any) => r.x),
    m2EIResults.map((r: any) => r.y),
    rawData.module2?.inst1 || instrumentNames[0] || "Inst 1",
    rawData.module2?.inst2 || instrumentNames[1] || "Inst 2",
    "Two-Instrument Correlation", true
  );
  const m2EI = errorIndexSVG(
    m2EIResults.map((r: any) => r.x),
    m2EIResults.map((r: any) => r.errorIndex),
    "Error Index Plot", "Concentration (X)"
  );

  const m2DataRows = m2EIResults.map((r: any, i: number) => {
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
    const m3EIResults = m3.errorIndexResults || [];
    const m3Scatter = scatterSVG(
      m3EIResults.map((r: any) => r.x),
      m3EIResults.map((r: any) => r.y),
      "Old Lot", "New Lot", "Old vs New Lot Correlation", true
    );
    const m3EI = errorIndexSVG(
      m3EIResults.map((r: any) => r.x),
      m3EIResults.map((r: any) => r.errorIndex),
      "Error Index Plot", "Concentration (X)"
    );

    const m3DataRows = m3EIResults.map((r: any, i: number) => {
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
        <div class="section-label">Module 3 - Experimental Results</div>
        <table>
          <thead><tr><th>Specimen</th><th class="text-right">Old Lot</th><th class="text-right">New Lot</th><th class="text-right">Error Index</th><th class="text-right">Pass?</th></tr></thead>
          <tbody>${m3DataRows}</tbody>
        </table>
      </div>
    `;
  } else {
    m3Section = `<div class="section-heading" style="page-break-before:always">Module 3: Old Lot vs New Lot Comparison</div>
      <p style="font-size:9pt;color:${MUTED};margin:8px 0">Module 3 skipped - single analyzer lab.</p>`;
  }

  // Narrative
  const overallVerdict = results.overallPass ? "Meets CLIA criteria" : "Does not meet CLIA criteria";
  const narrativeText = results.summary;
  const ptCoagCliaStatement = results.overallPass
    ? `<b>The results for ${study.testName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The results for ${study.testName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${narrativeText} ${ptCoagCliaStatement}</p>
  </div>`;

  // Overall verdict
  const verdictHtml = `<div class="verdict ${results.overallPass ? "pass-bg" : "fail-bg"}" style="margin-top:12px">
    ${overallVerdict} - Module 1: ${module1.pass ? "Meets criteria" : "Does not meet criteria"}, Module 2: ${module2.pass ? "Meets criteria" : "Does not meet criteria"}${module3 ? `, Module 3: ${module3.pass ? "Meets criteria" : "Does not meet criteria"}` : ""}
  </div>`;

  const reagentInfo = rawData.reagentLot ? `<div style="font-size:8pt;margin-bottom:6px">Reagent Lot: ${rawData.reagentLot} · Expiration: ${rawData.reagentExp || "-"} · ISI: ${rawData.module1?.isi ?? "-"}</div>` : "";

  // Page 1 compact key stats
  const ptCompactM1Pass = module1.pass ? "PASS" : "FAIL";
  const ptCompactM2Pass = module2.pass ? "PASS" : "FAIL";
  const ptCompactM3Pass = module3 ? (module3.pass ? "PASS" : "FAIL") : "N/A";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - PT Coag New Lot Validation - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="section-heading">PT/Coag New Lot Validation</div>
  ${reagentInfo}

  <div class="charts">${m2Scatter}${m2EI}</div>

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Module 1 (Normal Mean/RI)</td><td style="width:25%" class="${module1.pass ? "pass" : "fail"}">${ptCompactM1Pass}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">Module 2 (Two-Instrument)</td><td style="width:25%" class="${module2.pass ? "pass" : "fail"}">${ptCompactM2Pass}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Module 3 (Lot Comparison)</td><td class="${module3 ? (module3.pass ? "pass" : "fail") : ""}">${ptCompactM3Pass}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${overallVerdict}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Geo Mean PT</td><td>${module1.geoMeanPT.toFixed(2)} sec</td>
          <td style="color:${MUTED};font-weight:700">Geo Mean INR</td><td>${module1.geoMeanINR.toFixed(3)}</td></tr>
    </tbody>
  </table>

  ${narrative}
  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
  ${directorReviewHTML()}

  <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    ${m1Section}

    ${m2Section}
    <div class="section-label">Module 2 - Experimental Results</div>
    <table>
      <thead><tr><th>Specimen</th><th class="text-right">Inst 1</th><th class="text-right">Inst 2</th><th class="text-right">Error Index</th><th class="text-right">Pass?</th></tr></thead>
      <tbody>${m2DataRows}</tbody>
    </table>

    ${m3Section}

    <div class="section-label" style="margin-top:12px">Module 1 - Individual Results</div>
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
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaCheck is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure&trade; | VeritaCheck&trade; | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
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
      <td style="text-align:right">${lr.oldMean != null ? lr.oldMean.toFixed(2) : '-'}</td>
      <td style="text-align:right;${lr.flagShift ? 'color:#dc2626;font-weight:600;' : ''}">${lr.pctDiffFromOld != null ? lr.pctDiffFromOld.toFixed(1) + '%' : '-'}${lr.flagShift ? ' ⚠' : ''}</td>
    </tr>`).join("");

  const qcCliaStatement = r.overallPass
    ? `<b>The results for ${study.testName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The results for ${study.testName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
  const narrative = `New QC ranges have been established for ${analytes.join(", ")}. ` +
    `Runs were performed across ${r.dateRange?.start || ''} to ${r.dateRange?.end || ''} on ${study.instrument}. ` +
    (r.overallShiftCount > 0 ? `${r.overallShiftCount} of ${r.totalLevels} analyte-level combinations showed >10% shift from previous lot.` : `All means are within 10% of previous lot values.`) +
    ` ${qcCliaStatement}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - QC Range Establishment - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
    ${headerHTML(study, (study as any)._cliaNumber)}
    <div class="narrative-section">
      <div class="eval-title">Narrative Summary</div>
      <div class="eval-text">${narrative}</div>
    </div>
    ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
    ${directorReviewHTML()}
    <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>
    <div style="page-break-before:always"></div>
    ${headerHTML(study, (study as any)._cliaNumber)}
    <div class="eval-title" style="margin-top:8px">Statistical Analysis and Experimental Results (Continued from page 1)</div>
    <table class="data-table"><thead><tr>
      <th>Analyzer</th><th>Analyte</th><th>Level</th><th style="text-align:right">N</th>
      <th style="text-align:right">New Mean</th><th style="text-align:right">New SD</th><th style="text-align:right">CV%</th>
      <th style="text-align:right">Old Mean</th><th style="text-align:right">% Diff</th>
    </tr></thead><tbody>${tableRows}</tbody></table>
    ${evalHTML(r.summary, r.overallPass, r.passCount, r.totalCount, study.cliaAllowableError)}
    <div class="eval-text" style="font-size:7.5px;color:#888;margin:8px 0;font-style:italic">Per policy, SD does not change lot to lot - the historical/peer-derived SD should be used for control limits.</div>
    ${supportingPageHTML(study, safeJsonParse(study.instruments))}
  </body></html>`;
}

// ─── MULTI-ANALYTE LOT COMPARISON HTML ────────────────────────────────────────
function buildMultiAnalyteCoagHTML(study: Study, results: any): string {
  const r = results;
  const rawDP = safeJsonParse(study.dataPoints);
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
      <td style="text-align:right">${s.ptNew != null ? s.ptNew.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.ptNewINR != null ? s.ptNewINR.toFixed(2) : '-'}</td>
      <td style="text-align:right">${s.ptOld != null ? s.ptOld.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.ptPctDiff != null ? s.ptPctDiff.toFixed(1) + '%' : '-'}</td>
      <td style="text-align:right">${s.apttNew != null ? s.apttNew.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.apttOld != null ? s.apttOld.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.apttPctDiff != null ? s.apttPctDiff.toFixed(1) + '%' : '-'}</td>
      <td style="text-align:right">${s.fibNew != null ? s.fibNew.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.fibOld != null ? s.fibOld.toFixed(1) : '-'}</td>
      <td style="text-align:right">${s.fibPctDiff != null ? s.fibPctDiff.toFixed(1) + '%' : '-'}</td>
    </tr>`).join("");

  const sampleLabel = rawDP.sampleType === "normal" ? "normal" : "random";
  const validAnalytes = (r.analyteResults || []).filter((ar: any) => ar.n > 0);
  const maCoagCliaStatement = r.overallPass
    ? `<b>The results for ${study.testName} meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The results for ${study.testName} do not meet the CLIA minimum total allowable error criteria per 42 CFR \u00A7493.931.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
  const narrative = `${(r.specimens || []).length} ${sampleLabel} specimens were compared between old lot and new lot on ${study.instrument}. ` +
    validAnalytes.map((ar: any) => `${ar.analyte} showed a mean difference of ${ar.meanPctDiff.toFixed(1)}% (${ar.pass ? 'PASS' : 'FAIL'} at ${(ar.tea * 100).toFixed(0)}% TEa).`).join(" ") +
    ` ${maCoagCliaStatement}`;

  const isiNote = r.ptINRValidation ? `<div class="eval-text" style="margin:8px 0;font-size:7.5px">${r.ptINRValidation.isiCheck}</div>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Multi-Analyte Lot Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  body { counter-reset: page; }
  </style></head><body>
    ${headerHTML(study, (study as any)._cliaNumber)}
    <div class="narrative-section">
      <div class="eval-title">Narrative Summary</div>
      <div class="eval-text">${narrative}</div>
    </div>
    ${isiNote}
    ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}
    ${directorReviewHTML()}
    <div style="font-size:7pt;color:${MUTED};text-align:center;margin-top:8px;font-style:italic;">Detailed results continued on page 2.</div>
    <div style="page-break-before:always"></div>
    ${headerHTML(study, (study as any)._cliaNumber)}
    <div class="eval-title" style="margin-top:8px">Statistical Analysis and Experimental Results (Continued from page 1)</div>
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
    ${evalHTML(r.summary, r.overallPass, r.passCount, r.totalCount, study.cliaAllowableError)}
    ${supportingPageHTML(study, safeJsonParse(study.instruments))}
  </body></html>`;
}

// ─── CUMSUM PDF GENERATOR ─────────────────────────────────────────────────────
export async function generateCumsumPDF(tracker: any, entries: any[], currentSpecimens?: any[], cliaNumber?: string, labName?: string): Promise<Buffer> {
  const historyRows = (entries || []).map((e: any) => `
    <tr style="${e.verdict === 'ACTION REQUIRED' ? 'background:#fef2f2;' : e.verdict === 'ACCEPT' ? 'background:#f0fdf4;' : ''}">
      <td>${e.year}</td>
      <td>${e.old_lot_number || '-'}</td>
      <td>${e.new_lot_number || '-'}</td>
      <td style="text-align:right">${e.old_lot_geomean != null ? Number(e.old_lot_geomean).toFixed(1) : '-'}</td>
      <td style="text-align:right">${e.new_lot_geomean != null ? Number(e.new_lot_geomean).toFixed(1) : '-'}</td>
      <td style="text-align:right">${e.difference != null ? (e.difference >= 0 ? '+' : '') + Number(e.difference).toFixed(1) : '-'}</td>
      <td style="text-align:right;font-weight:600">${e.cumsum != null ? Number(e.cumsum).toFixed(1) : '-'}</td>
      <td style="${e.verdict === 'ACTION REQUIRED' ? 'color:#dc2626;font-weight:600' : e.verdict === 'ACCEPT' ? 'color:#059669;font-weight:600' : ''}">${e.verdict || '-'}</td>
    </tr>`).join("");

  let specimenSection = '';
  if (currentSpecimens && currentSpecimens.length > 0) {
    const specRows = currentSpecimens.map((s: any) => `<tr><td>${s.specimenId}</td><td style="text-align:right">${s.oldLot || '-'}</td><td style="text-align:right">${s.newLot || '-'}</td></tr>`).join("");
    specimenSection = `
      <div style="page-break-before:always"></div>
      <div style="font-size:9px;font-weight:600;margin:10px 0 6px">Current Lot Change - Specimen Data</div>
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
        <div class="logo">VeritaCheck\u2122</div>
        <div class="logo-sub">by Veritas Lab Services - veritaslabservices.com</div>
        ${labName ? `<div style="font-size:8.5pt;font-weight:600;color:#28251D;margin-top:1px;">${labName}</div>` : ""}
        <div style="font-size:8pt;color:${cliaNumber ? '#555' : '#999'};margin-top:2px;">CLIA: ${cliaNumber || 'Not on file - enter your CLIA number in account settings'}</div>
      </div>
      <div class="header-right">Instrument: ${tracker.instrument_name}</div>
    </div>
    <div class="report-title">CUMSUM Tracker - ${tracker.instrument_name} (${tracker.analyte})</div>
    <hr class="divider">
    <div class="eval-section">
      <hr class="divider">
      <div class="eval-title">Current Status</div>
      <div class="eval-text">Current CumSum: <strong>${currentCumsum} sec</strong> - Verdict: <strong style="${currentVerdict === 'ACTION REQUIRED' ? 'color:#dc2626' : currentVerdict === 'ACCEPT' ? 'color:#059669' : ''}">${currentVerdict}</strong></div>
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

export async function generatePDFBuffer(study: Study, results: any, cliaNumber?: string, preferredStandards?: AccreditationBody[] | null): Promise<Buffer> {
  if (!study || typeof study !== "object") {
    throw new Error("generatePDFBuffer: study must be a valid object, received " + typeof study);
  }
  // Attach cliaNumber and preferredStandards to study object for internal builder use
  (study as any)._cliaNumber = cliaNumber || null;
  (study as any)._preferredStandards = preferredStandards || null;
  // For method_comparison, check if results indicate qualitative or semi-quantitative type
  const isQualResult = study.studyType === "method_comparison" && results?.type === "qualitative";
  const isSemiQuantResult = study.studyType === "method_comparison" && results?.type === "semi_quantitative";

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
    : study.studyType === "ref_interval"
    ? buildRefIntervalHTML(study, results)
    : isQualResult
    ? buildQualitativeHTML(study, results)
    : isSemiQuantResult
    ? buildSemiQuantHTML(study, results)
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
  cliaNumber?: string;
  labName?: string;
  preferredStandards?: AccreditationBody[] | null;
}

const SCAN_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  "Compliant":        { bg: "#dcfce7", fg: "#166534" },
  "Needs Attention":  { bg: "#fef9c3", fg: "#854d0e" },
  "Immediate Action": { bg: "#fee2e2", fg: "#991b1b" },
  "N/A":              { bg: "#f1f5f9", fg: "#475569" },
  "Not Assessed":     { bg: "#f8fafc", fg: "#94a3b8" },
};

function scanStandardsBadgesHTML(preferredStandards?: AccreditationBody[] | null): string {
  const standards = (preferredStandards && preferredStandards.length > 0)
    ? preferredStandards
    : ["CAP", "TJC"] as AccreditationBody[];
  const allBodies: AccreditationBody[] = [...standards, "CLSI", "CLIA"] as AccreditationBody[];
  const badges = allBodies.map(s =>
    `<span style="display:inline-block;margin:1px 4px 1px 0;font-size:6.5pt;font-weight:600;color:#01696F;background:#E8F4F4;border:1px solid #B0D8D8;border-radius:3px;padding:1px 5px;">${s}</span>`
  ).join("");
  return `<div style="font-size:7pt;color:#888;margin-top:3px;">Accreditation frameworks: ${badges}</div>`;
}

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

  // Action items - only Needs Attention and Immediate Action
  const actionItems = items.filter(i => i.status === "Needs Attention" || i.status === "Immediate Action");
  const actionRows = actionItems.length > 0
    ? actionItems.map((item, idx) => {
        const sc = SCAN_STATUS_COLORS[item.status] || SCAN_STATUS_COLORS["Not Assessed"];
        return `<tr class="${idx % 2 === 1 ? "stripe" : ""}">
          <td>${item.id}</td>
          <td style="max-width:220px;word-wrap:break-word">${item.question}</td>
          <td><span style="background:${sc.bg};color:${sc.fg};padding:1px 6px;border-radius:3px;font-size:7pt;font-weight:600">${item.status}</span></td>
          <td>${item.owner || "-"}</td>
          <td>${item.due_date || "-"}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="text-center" style="color:${MUTED};padding:12px">No action items - all assessed items are compliant.</td></tr>`;

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
        <div class="logo">VeritaScan\u2122</div>
        <div class="logo-sub">by Veritas Lab Services - veritaslabservices.com</div>
        ${data.labName ? `<div style="font-size:8.5pt;font-weight:600;color:#28251D;margin-top:1px;">${data.labName}</div>` : ""}
        <div style="font-size:8pt;color:${data.cliaNumber ? '#555' : '#999'};margin-top:2px;">CLIA: ${data.cliaNumber || 'Not on file - enter your CLIA number in account settings'}</div>
        ${scanStandardsBadgesHTML(data.preferredStandards)}
      </div>
      <div class="header-right">Generated ${today()}</div>
    </div>
    <div class="report-title">Executive Summary Report</div>
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

    <div style="margin-top:14px;font-size:7.5pt;color:${MUTED};font-style:italic;line-height:1.5;">This report is for internal use only. It is designed to assist the laboratory in identifying compliance gaps before an inspection. It does not constitute an accreditation submission or regulatory filing.</div>
  </body></html>`;
}

function buildVeritaScanFullHTML(data: VeritaScanPDFData): string {
  const { scanName, createdAt, updatedAt, items } = data;
  const total = items.length;
  const notAssessed = items.filter(i => i.status === "Not Assessed").length;
  const na = items.filter(i => i.status === "N/A").length;
  const compliant = items.filter(i => i.status === "Compliant").length;
  const applicableItems = total - na;
  const complianceRate = applicableItems > 0 ? Math.round((compliant / applicableItems) * 100) : 0;
  const overallColor = complianceRate >= 90 ? PASS : complianceRate >= 70 ? "#d97706" : FAIL;

  // Group by domain
  const domainMap = new Map<string, VeritaScanPDFItem[]>();
  for (const item of items) {
    const arr = domainMap.get(item.domain) || [];
    arr.push(item);
    domainMap.set(item.domain, arr);
  }

  // Domain summary rows for page 1 compact table
  const domainSummaryRows = Array.from(domainMap.entries()).map(([domain, domItems]) => {
    const dTotal = domItems.length;
    const dCompliant = domItems.filter(i => i.status === "Compliant").length;
    const dNA = domItems.filter(i => i.status === "N/A").length;
    const dApplicable = dTotal - dNA;
    const dRate = dApplicable > 0 ? Math.round((dCompliant / dApplicable) * 100) : 100;
    const rateColor = dRate >= 90 ? PASS : dRate >= 70 ? "#d97706" : FAIL;
    return `<tr><td style="font-weight:600;font-size:7.5pt">${domain}</td><td class="text-center" style="font-size:7.5pt;color:${rateColor};font-weight:700">${dRate}%</td></tr>`;
  }).join("");

  // Domain detail sections - natural flow, no forced page breaks
  let domainSections = "";
  for (const [domain, domItems] of Array.from(domainMap.entries())) {
    const rows = domItems.map((item, idx) => {
      const sc = SCAN_STATUS_COLORS[item.status] || SCAN_STATUS_COLORS["Not Assessed"];
      return `<tr class="${idx % 2 === 1 ? "stripe" : ""}" style="page-break-inside:avoid">
        <td>${item.id}</td>
        <td style="max-width:200px;word-wrap:break-word;font-size:7pt">${item.question}</td>
        <td style="font-size:6.5pt">${item.tjc || "-"}</td>
        <td style="font-size:6.5pt">${item.cap || "-"}</td>
        <td style="font-size:6.5pt">${item.cfr || "-"}</td>
        <td><span style="background:${sc.bg};color:${sc.fg};padding:1px 5px;border-radius:3px;font-size:6.5pt;font-weight:600;white-space:nowrap">${item.status}</span></td>
        <td style="font-size:7pt">${item.owner || ""}</td>
        <td style="font-size:7pt">${item.due_date || ""}</td>
        <td style="font-size:6.5pt;max-width:100px;word-wrap:break-word">${item.notes || ""}</td>
      </tr>`;
    }).join("");

    domainSections += `
      <div style="border-top:2px solid #B0D8D8;margin-top:14px;padding-top:6px;page-break-after:avoid">
        <div class="section-label" style="font-size:10pt;margin:0 0 6px;color:${TEAL};page-break-after:avoid">${domain}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Compliance Question</th><th>TJC</th><th>CAP</th><th>CFR</th><th>Status</th><th>Owner</th><th>Due</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}
    .page-num::after { content: "Page " counter(page); }
    body { counter-reset: page; }
  </style></head><body>
    <div class="report-header">
      <div>
        <div class="logo">VeritaScan\u2122</div>
        <div class="logo-sub">by Veritas Lab Services - veritaslabservices.com</div>
        ${data.labName ? `<div style="font-size:8.5pt;font-weight:600;color:#28251D;margin-top:1px;">${data.labName}</div>` : ""}
        <div style="font-size:8pt;color:${data.cliaNumber ? '#555' : '#999'};margin-top:2px;">CLIA: ${data.cliaNumber || 'Not on file - enter your CLIA number in account settings'}</div>
        ${scanStandardsBadgesHTML(data.preferredStandards)}
      </div>
      <div class="header-right">Generated ${today()}</div>
    </div>
    <div class="report-title">Full Compliance Report</div>
    <div class="report-title-sub">${scanName} · Created ${new Date(createdAt).toLocaleDateString("en-US")} · Last Updated ${new Date(updatedAt).toLocaleDateString("en-US")}</div>
    <hr class="divider">

    <!-- Overall compliance summary -->
    <div style="display:flex;gap:18px;align-items:flex-start;margin:6px 0 8px;">
      <div style="flex:0 0 auto;text-align:center;padding:6px 16px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;">
        <div style="font-size:20pt;font-weight:700;color:${overallColor};line-height:1.2">${complianceRate}%</div>
        <div style="font-size:7pt;color:${MUTED};text-transform:uppercase;letter-spacing:0.04em">Overall</div>
      </div>
      <div style="flex:1;">
        <div style="font-size:7.5pt;color:${MUTED};margin-bottom:3px;">${total} total items, ${compliant} compliant, ${na} N/A, ${notAssessed} unassessed</div>
        <table style="font-size:7.5pt;">
          <thead><tr><th style="text-align:left;padding:2px 10px 2px 4px">Domain</th><th class="text-center" style="padding:2px 4px">Score</th></tr></thead>
          <tbody>${domainSummaryRows}</tbody>
        </table>
      </div>
    </div>

    <div style="margin-top:14px;font-size:7.5pt;color:${MUTED};font-style:italic;line-height:1.5;">This report is for internal use only. It is designed to assist the laboratory in identifying compliance gaps before an inspection. It does not constitute an accreditation submission or regulatory filing.</div>

    <div style="text-align:center;font-size:7.5pt;color:${MUTED};margin-top:10px;font-style:italic;">Detailed results continued on page 2.</div>

    <!-- Page 2+: domain detail sections, natural flow -->
    <div style="page-break-before:always"></div>
    ${domainSections}
  </body></html>`;
}

const VERITASCAN_FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaScan\u2122 is a compliance assessment tool for qualified laboratory professionals. Results require review by laboratory leadership and do not constitute legal or regulatory advice.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure\u2122 | VeritaScan\u2122 | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
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
  cliaNumber?: string;
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
    ${labName ? `<div style="font-size:9.5pt;font-weight:600;color:rgba(255,255,255,0.95);margin-top:2px;">${esc(labName)}</div>` : ""}
    <div style="font-size:9pt;color:rgba(255,255,255,0.8);margin-top:2px;">CLIA: ${input.cliaNumber || 'Not on file - enter your CLIA number in account settings'}</div>
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
      <div class="row"><span class="lbl">Type:</span><span class="val">${({initial:"Initial",["6month"]:"6-Month",annual:"Annual",reassessment:"Reassessment",orientation:"Orientation",duty_change:"Duty Change"} as Record<string,string>)[(assessment.assessment_type || "initial")] || (assessment.assessment_type || "initial").replace("_", " ").toUpperCase()}</span></div>
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
    <div class="note">Evaluator must be Lab Director or designee, Technical Consultant (moderate complexity), or Technical Supervisor (high complexity) as appropriate for this employee's testing category.</div>
  </div>`;

  // ─── Assessment Summary Table (compact, page 1) ───
  if (isTechnical) {
    const summaryElements = [
      { num: 1, name: "Direct Observation of Routine Patient Test Performance" },
      { num: 2, name: "Monitoring, Recording and Reporting of Test Results" },
      { num: 3, name: "QC Performance" },
      { num: 4, name: "Direct Observation of Instrument Maintenance" },
      { num: 5, name: "Blind / PT Sample Performance" },
      { num: 6, name: "Problem-Solving Assessment (Quiz)" },
    ];
    const summaryRows = summaryElements.map(el => {
      const elItems = items.filter((i: any) => (i.element_number || i.method_number) === el.num);
      const naKey = `el${el.num}_na` as string;
      const naJustKey = `el${el.num}_na_justification` as string;
      const isNa = elItems.length > 0 && elItems.every((i: any) => i[naKey]);
      const allPass = !isNa && elItems.length > 0 && elItems.every((i: any) => i.passed);
      const statusLabel = isNa ? "N/A" : elItems.length === 0 ? "N/A" : allPass ? "PASS" : "FAIL";
      const statusColor = statusLabel === "PASS" ? "#437A22" : statusLabel === "FAIL" ? "#A12C7B" : "#888";
      const justification = isNa ? elItems.map((i: any) => i[naJustKey]).filter(Boolean).join("; ") : "";
      return `<tr>
        <td style="text-align:center;width:5%;font-weight:600;">${el.num}</td>
        <td style="width:80%;">${el.name}${justification ? `<br><span style="font-size:7pt;color:#666;font-style:italic;">N/A Justification: ${esc(justification)}</span>` : ""}</td>
        <td style="text-align:center;width:15%;font-weight:700;color:${statusColor}">${statusLabel}</td>
      </tr>`;
    }).join("");

    html += `<div style="margin:10px 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:9pt;">
        <tr style="background:#01696F;color:white;">
          <th style="padding:4px 6px;text-align:center;font-size:7.5pt;font-weight:600;width:5%;">#</th>
          <th style="padding:4px 6px;text-align:left;font-size:7.5pt;font-weight:600;width:80%;">Element</th>
          <th style="padding:4px 6px;text-align:center;font-size:7.5pt;font-weight:600;width:15%;">Status</th>
        </tr>
        ${summaryRows}
      </table>
    </div>`;
  }

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
      <li>The laboratory director or designee documents that staff have completed orientation and have demonstrated competence in performing their required duties.</li>
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
        note: "Observer must be Lab Director or designee, Technical Consultant (moderate complexity), or Technical Supervisor (high complexity) as appropriate. Documents that the observer watched the employee process and test a specimen.",
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
          <td style="word-break:break-word;white-space:normal;max-width:280px;font-size:7.5pt;line-height:1.4;">${esc(item.el2_evidence || item.evidence || "")}</td>
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
        note: "Observer must be Lab Director or designee, Technical Consultant (moderate complexity), or Technical Supervisor (high complexity) as appropriate. The lab's signed maintenance records for the date observed serve as the supporting documentation.",
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

    // Single page break before all elements, then they flow naturally
    html += `<div class="page-break"></div>`;
    for (const elDef of elementDefs) {
      const naKey = `el${elDef.num}_na` as string;
      const naJustKey = `el${elDef.num}_na_justification` as string;
      html += `<div class="section" style="margin-bottom:6px;">
        <div class="section-header">${elDef.title}</div>
        <div class="section-note">${elDef.note}</div>
        <table>
          <tr>${elDef.cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
      const elItems = items.filter((i: any) => (i.element_number || i.method_number) === elDef.num);
      // Check if all items for this element are N/A
      const allNa = elItems.length > 0 && elItems.every((i: any) => i[naKey]);
      if (allNa) {
        const justifications = elItems.map((i: any) => {
          const mgName = i.method_group_name || methodGroups.find((g: any) => g.id === i.method_group_id)?.name || "";
          return mgName ? `${mgName}: ${esc(i[naJustKey] || "")}` : esc(i[naJustKey] || "");
        }).filter(Boolean);
        html += `<tr><td colspan="${elDef.cols.length}" style="text-align:center;color:#888;font-weight:600;">N/A</td></tr>`;
        if (justifications.length > 0) {
          html += `<tr><td colspan="${elDef.cols.length}" style="font-size:7.5pt;color:#666;font-style:italic;">Justification: ${justifications.join("; ")}</td></tr>`;
        }
      } else if (elItems.length === 0) {
        // Fallback: show items by method_number for backward compatibility
        const fallbackItems = items.filter((i: any) => i.method_number === elDef.num);
        for (const item of fallbackItems) {
          const mg = methodGroups.find((g: any) => g.id === item.method_group_id);
          const augmented = { ...item, method_group_name: item.method_group_name || mg?.name || "" };
          html += `<tr>${elDef.render(augmented)}</tr>`;
        }
        if (fallbackItems.length === 0) {
          html += `<tr><td colspan="${elDef.cols.length}" style="text-align:center;color:#888;font-style:italic">No data recorded</td></tr>`;
        }
      } else {
        for (const item of elItems) {
          const mg = methodGroups.find((g: any) => g.id === item.method_group_id);
          const augmented = { ...item, method_group_name: item.method_group_name || mg?.name || "" };
          if (item[naKey]) {
            // Individual N/A row within a mixed element
            html += `<tr><td>${esc(augmented.method_group_name)}</td><td colspan="${elDef.cols.length - 1}" style="color:#888;font-style:italic;">N/A - ${esc(item[naJustKey] || "")}</td></tr>`;
          } else {
            html += `<tr>${elDef.render(augmented)}</tr>`;
          }
        }
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

  // ─── EVALUATOR SIGN-OFF ───
  const evalName = esc(assessment.evaluator_name) || "M. Veri";
  const evalTitle = esc(assessment.evaluator_title) || "Technical Consultant";
  const evalInitials = esc(assessment.evaluator_initials) || "MV";
  const signOffDate = assessment.assessment_date || dateStr;
  html += `<div class="page-break"></div>`;
  html += `<div class="section">
    <div class="section-header">Evaluator Sign-Off</div>
    <div style="border:1.5px solid #01696F;border-radius:6px;padding:16px 18px;background:#f8fafb;margin-top:8px;">
      <div style="font-size:9pt;font-weight:700;color:#01696F;margin-bottom:10px;text-align:center;">COMPETENCY ASSESSMENT COMPLETION</div>
      <div style="font-size:8.5pt;margin-bottom:12px;text-align:center;">All required elements have been assessed and documented above.</div>
      <div style="text-align:center;margin-bottom:14px;">
        <span style="font-size:10pt;font-weight:800;color:#437A22;letter-spacing:1px;">Overall Determination: PASS</span>
      </div>
      <div style="font-size:8pt;margin-bottom:6px;font-weight:600;">Evaluator Certification:</div>
      <div style="font-size:7.5pt;font-style:italic;line-height:1.6;margin-bottom:14px;color:#333;">
        &ldquo;I certify that I have directly assessed this employee&rsquo;s competency using the methods documented above and that the results accurately reflect the employee&rsquo;s performance.&rdquo;
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:10px;">
        <div>
          <div style="border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;font-size:8.5pt;font-weight:600;">${evalName}</div>
          <div style="font-size:6.5pt;color:#888;margin-top:2px;">Evaluator Print Name</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;font-size:8.5pt;font-weight:600;">${evalTitle}</div>
          <div style="font-size:6.5pt;color:#888;margin-top:2px;">Title</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;font-size:8.5pt;font-weight:600;">${signOffDate}</div>
          <div style="font-size:6.5pt;color:#888;margin-top:2px;">Date</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
          <div style="border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;font-size:8.5pt;font-weight:600;">${evalInitials}</div>
          <div style="font-size:6.5pt;color:#888;margin-top:2px;">Initials</div>
        </div>
        <div>
          <div style="border-bottom:1px solid #999;padding-bottom:2px;min-height:18px;font-size:8.5pt;">&nbsp;</div>
          <div style="font-size:6.5pt;color:#888;margin-top:2px;">Signature</div>
        </div>
      </div>
    </div>
  </div>`;

  // ─── QUIZ ADDENDUM ───
  if (quizResults && quizResults.length > 0) {
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Appendix A: Problem-Solving Quiz Results</div>`;

    for (const qr of quizResults) {
      const questions = safeJsonParse(qr.quiz_questions, []);
      const answers = safeJsonParse(qr.answers, []);

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
  for (const emp of (employees || [])) {
    const empRoles = emp.roles || [];
    if (!emp.performs_testing && !empRoles.some(r => ["LD", "CC", "TC", "TS", "GS"].includes(r.role))) continue;

    const roleSet = new Set(empRoles.map(r => r.role));
    const tcSpecs = empRoles.filter(r => r.role === "TC" && r.specialty_number).map(r => r.specialty_number!);
    const tsSpecs = empRoles.filter(r => r.role === "TS" && r.specialty_number).map(r => r.specialty_number!);

    // If the employee has TC or TS with specialties, create one row per specialty
    const specRows: { tc: string; ts: string }[] = [];

    if (tcSpecs.length > 0 || tsSpecs.length > 0) {
      // Combine: for each specialty, show which role(s) apply
      const allSpecs = Array.from(new Set([...tcSpecs, ...tsSpecs]));
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
        <div class="sig-label">Laboratory Director or Designee Signature</div>
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

// ─── VeritaPT PDF ────────────────────────────────────────────────────────────

interface VeritaPTPDFData {
  labName: string;
  cliaNumber: string;
  generatedAt: string;
  summary: { totalEnrollments: number; eventsThisYear: number; passRate: number; openCorrectiveActions: number };
  enrollments: Array<{ analyte: string; specialty: string; pt_provider: string; program_code: string | null; enrollment_year: number; status: string }>;
  events: Array<{ analyte: string; event_id: string | null; event_date: string; your_result: number | null; peer_mean: number | null; sdi: number | null; pass_fail: string; notes: string | null }>;
  correctiveActions: Array<{ analyte: string; event_date: string; root_cause: string | null; corrective_action: string; status: string; verified_by: string | null }>;
}

function buildVeritaPTPDFHTML(data: VeritaPTPDFData): string {
  const teal = "#01696F";

  const enrollmentRows = data.enrollments.map(e => `
    <tr>
      <td>${e.analyte}</td>
      <td>${e.specialty}</td>
      <td>${e.pt_provider}</td>
      <td>${e.program_code || "-"}</td>
      <td>${e.enrollment_year}</td>
      <td class="ctr">${e.status.charAt(0).toUpperCase() + e.status.slice(1)}</td>
    </tr>`).join("");

  const eventRows = data.events.map(e => `
    <tr>
      <td>${e.event_date}</td>
      <td>${e.analyte}</td>
      <td>${e.event_id || "-"}</td>
      <td class="ctr">${e.your_result != null ? e.your_result : "-"}</td>
      <td class="ctr">${e.peer_mean != null ? e.peer_mean : "-"}</td>
      <td class="ctr">${e.sdi != null ? Number(e.sdi).toFixed(2) : "-"}</td>
      <td class="ctr" style="font-weight:700; color:${e.pass_fail === "pass" ? "#166534" : e.pass_fail === "fail" ? "#991b1b" : "#6b7280"}">${e.pass_fail.toUpperCase()}</td>
    </tr>`).join("");

  const caRows = data.correctiveActions.map(ca => `
    <tr>
      <td>${ca.analyte}</td>
      <td>${ca.event_date}</td>
      <td>${ca.root_cause || "-"}</td>
      <td>${ca.corrective_action}</td>
      <td class="ctr">${ca.status.charAt(0).toUpperCase() + ca.status.slice(1)}</td>
      <td>${ca.verified_by || "-"}</td>
    </tr>`).join("");

  const caSection = data.correctiveActions.length > 0 ? `
    <h2>Corrective Actions</h2>
    <table>
      <thead><tr>
        <th>Analyte</th><th>Event Date</th><th>Root Cause</th><th>Corrective Action</th><th class="ctr">Status</th><th>Verified By</th>
      </tr></thead>
      <tbody>${caRows}</tbody>
    </table>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; font-size:9.5pt; color:#1a1a1a; background:white; }
    @page { size:letter; margin:14mm 15mm 20mm 15mm; }
    .page-header { border-bottom:3px solid ${teal}; padding-bottom:8px; margin-bottom:14px; }
    .page-header-top { display:flex; justify-content:space-between; align-items:flex-end; }
    .page-title { font-size:15pt; font-weight:700; color:${teal}; }
    .page-subtitle { font-size:9pt; color:#555; margin-top:2px; }
    .lab-block { text-align:right; font-size:8pt; color:#555; line-height:1.4; }
    .lab-block strong { color:#1a1a1a; }
    .kpi-row { display:flex; gap:12px; margin-bottom:16px; }
    .kpi-card { flex:1; border:1px solid #e5e7eb; border-radius:6px; padding:10px 12px; text-align:center; }
    .kpi-val { font-size:18pt; font-weight:700; color:${teal}; }
    .kpi-label { font-size:7.5pt; color:#6b7280; margin-top:2px; }
    h2 { font-size:11pt; font-weight:700; color:${teal}; margin:16px 0 8px 0; border-bottom:1px solid #e5e7eb; padding-bottom:4px; }
    table { width:100%; border-collapse:collapse; font-size:8.5pt; margin-bottom:10px; }
    table thead tr { background:${teal}; color:white; }
    table thead th { padding:5px 7px; text-align:left; font-weight:600; font-size:8pt; }
    table thead th.ctr { text-align:center; }
    table tbody tr:nth-child(even) { background:#f9fafb; }
    table tbody td { padding:4px 7px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
    table tbody td.ctr { text-align:center; }
    .footer-note { margin-top:20px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:4px; background:#f9fafb; font-size:7.5pt; color:#555; line-height:1.5; }
  </style></head><body>
    <div class="page-header">
      <div class="page-header-top">
        <div>
          <div class="page-title">VeritaPT\u2122 - Proficiency Testing Summary Report</div>
          <div class="page-subtitle">VeritaAssure\u2122 Platform | Veritas Lab Services, LLC</div>
        </div>
        <div class="lab-block">
          <strong>${data.labName || "Laboratory Name Not Configured"}</strong><br>
          CLIA: ${data.cliaNumber || "Not on file - enter in account settings"}<br>
          Generated: ${data.generatedAt}
        </div>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi-card"><div class="kpi-val">${data.summary.totalEnrollments}</div><div class="kpi-label">Active Enrollments</div></div>
      <div class="kpi-card"><div class="kpi-val">${data.summary.eventsThisYear}</div><div class="kpi-label">Events This Year</div></div>
      <div class="kpi-card"><div class="kpi-val">${data.summary.passRate.toFixed(1)}%</div><div class="kpi-label">Pass Rate</div></div>
      <div class="kpi-card"><div class="kpi-val" style="color:${data.summary.openCorrectiveActions > 0 ? "#991b1b" : "#01696F"}">${data.summary.openCorrectiveActions}</div><div class="kpi-label">Open Corrective Actions</div></div>
    </div>

    <h2>PT Enrollments</h2>
    <table>
      <thead><tr>
        <th>Analyte</th><th>Specialty</th><th>PT Provider</th><th>Program Code</th><th>Year</th><th class="ctr">Status</th>
      </tr></thead>
      <tbody>${enrollmentRows || "<tr><td colspan='6' style='text-align:center;color:#6b7280'>No enrollments recorded</td></tr>"}</tbody>
    </table>

    <h2>PT Survey Events</h2>
    <table>
      <thead><tr>
        <th>Date</th><th>Analyte</th><th>Event ID</th><th class="ctr">Your Result</th><th class="ctr">Peer Mean</th><th class="ctr">SDI</th><th class="ctr">Result</th>
      </tr></thead>
      <tbody>${eventRows || "<tr><td colspan='7' style='text-align:center;color:#6b7280'>No events recorded</td></tr>"}</tbody>
    </table>

    ${caSection}

    <div class="footer-note">
      Final approval and clinical determination must be made by the laboratory director or designee.<br>
      VeritaPT\u2122 is a component of VeritaAssure\u2122 | Veritas Lab Services, LLC | veritaslabservices.com
    </div>
  </body></html>`;
}

export async function generateVeritaPTPDF(data: VeritaPTPDFData): Promise<Buffer> {
  const html = buildVeritaPTPDFHTML(data);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ─── VeritaPolicy™ PDF ────────────────────────────────────────────────────────

interface VeritaPolicyPDFInput {
  user: any;
  settings: any;
  requirements: any[];
  statusMap: Record<number, any>;
  policyMap: Record<number, any>;
  policies: any[];
}

function escHtml(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildVeritaPolicyPDFHTML(input: VeritaPolicyPDFInput): string {
  const { user, settings, requirements, statusMap, policyMap, policies } = input;

  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file - enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Compute summary -- requirements come pre-enriched with status and policy_name
  let total = 0, complete = 0, inProgress = 0, notStarted = 0, na = 0;
  const reqWithStatus = requirements.map((req: any) => {
    const isNa = req.is_na || false;
    const status = req.status || "not_started";
    if (isNa) { na++; }
    else {
      total++;
      if (status === "complete") complete++;
      else if (status === "in_progress") inProgress++;
      else notStarted++;
    }
    return { ...req, status, is_na: isNa };
  });

  const score = total > 0 ? Math.round((complete / total) * 100) : 0;

  // Group by chapter
  const chapters: Record<string, { label: string; reqs: any[] }> = {};
  for (const r of reqWithStatus) {
    if (!chapters[r.chapter]) chapters[r.chapter] = { label: r.chapter_label, reqs: [] };
    chapters[r.chapter].reqs.push(r);
  }

  // Service line settings display
  const serviceLines = [
    { key: "has_blood_bank", label: "Blood Bank / Transfusion Service" },
    { key: "has_transplant", label: "Transplant Testing" },
    { key: "has_microbiology", label: "Microbiology" },
    { key: "has_maternal_serum", label: "Maternal Serum Marker Screening" },
    { key: "is_independent", label: "Independent Laboratory" },
    { key: "waived_only", label: "Waived Testing Only" },
  ];

  function statusColor(s: string) {
    if (s === "complete") return "#437A22";
    if (s === "in_progress") return "#964219";
    if (s === "na") return "#7A7974";
    return "#7A7974";
  }
  function statusLabel(s: string) {
    if (s === "complete") return "Complete";
    if (s === "in_progress") return "In Progress";
    if (s === "na") return "N/A";
    return "Not Started";
  }

  // Build chapter sections
  const chapterSections = Object.entries(chapters).map(([ch, data]) => {
    const rows = data.reqs.map((r: any) => {
      const rowStyle = r.is_na ? "opacity: 0.55;" : "";
      const stdStyle = r.is_na ? "text-decoration: line-through;" : "";
      const lpText = r.policy_name ? escHtml(r.policy_name) : "<em style=\"color:#999\">Not entered</em>";
      return `
        <tr style="${rowStyle}">
          <td style="font-family:monospace;font-size:7pt;${stdStyle}">${escHtml(r.standard.length > 30 ? r.standard.slice(0, 30) + "..." : r.standard)}</td>
          <td>${escHtml(r.name)}</td>
          <td style="text-align:center"><span style="color:${statusColor(r.status)};font-weight:700">${statusLabel(r.status)}</span></td>
          <td>${lpText}</td>
        </tr>`;
    }).join("");

    return `
      <div class="chapter-section">
        <div class="chapter-header">${escHtml(ch)} - ${escHtml(data.label)}</div>
        <table class="req-table">
          <thead>
            <tr>
              <th style="width:22%">Standard</th>
              <th style="width:38%">Requirement</th>
              <th style="width:14%;text-align:center">Status</th>
              <th style="width:26%">Our Policy Name</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  // Policy library table
  function policyReviewBadge(nextReview: string | null): string {
    if (!nextReview) return "";
    const d = new Date(nextReview);
    const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `<span style="color:#A12C7B;font-weight:700"> (OVERDUE)</span>`;
    if (diff <= 90) return `<span style="color:#964219;font-weight:700"> (Due Soon)</span>`;
    return "";
  }

  const policyRows = policies.map((p: any, i: number) => {
    const bg = i % 2 === 0 ? "#FFFFFF" : "#EBF3F8";
    const countMap: Record<number, number> = {};
    // count from statusMap
    for (const s of Object.values(statusMap) as any[]) {
      if (s.lab_policy_id) countMap[s.lab_policy_id] = (countMap[s.lab_policy_id] || 0) + 1;
    }
    const covered = countMap[p.id] || 0;
    const nr = p.next_review ? new Date(p.next_review).toLocaleDateString() : "-";
    const lr = p.last_reviewed ? new Date(p.last_reviewed).toLocaleDateString() : "-";
    return `
      <tr style="background:${bg}">
        <td style="font-family:monospace">${escHtml(p.policy_number) || "-"}</td>
        <td><strong>${escHtml(p.policy_name)}</strong></td>
        <td>${escHtml(p.owner) || "-"}</td>
        <td><span style="color:${statusColor(p.status)};font-weight:700">${statusLabel(p.status)}</span></td>
        <td>${lr}</td>
        <td>${nr}${policyReviewBadge(p.next_review)}</td>
        <td style="text-align:center">${covered}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="7" style="text-align:center;color:#7A7974;padding:12px">No policies in library</td></tr>`;

  // Service line summary rows
  const slRows = serviceLines.map(sl => {
    const active = settings && settings[sl.key] ? true : false;
    return `<tr>
      <td>${sl.label}</td>
      <td style="text-align:center;color:${active ? "#437A22" : "#7A7974"};font-weight:700">${active ? "Yes" : "No"}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9pt; color: #1a1a1a; background: white; }

/* Page 1 only styles */
.page1 { min-height: 100vh; page-break-after: always; }
.page-break { page-break-before: always; }

h1.report-title { font-size: 18pt; font-weight: 700; color: #01696F; margin-bottom: 2px; }
h2.report-subtitle { font-size: 10pt; font-weight: 400; color: #555; margin-bottom: 0; }

.header-block { border-bottom: 2px solid #01696F; padding-bottom: 10px; margin-bottom: 16px; }
.meta-row { display: flex; gap: 20px; font-size: 8pt; color: #555; margin-top: 6px; flex-wrap: wrap; }
.meta-row span { display: flex; gap: 4px; }
.meta-row strong { color: #1a1a1a; }

/* Score box */
.score-section { display: flex; gap: 16px; margin-bottom: 16px; align-items: flex-start; }
.score-circle { text-align: center; flex-shrink: 0; }
.score-num { font-size: 28pt; font-weight: 700; color: #01696F; line-height: 1; }
.score-label { font-size: 7pt; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; flex: 1; }
.stat-box { border: 1px solid #D0D0D0; border-radius: 6px; padding: 8px 10px; text-align: center; }
.stat-val { font-size: 18pt; font-weight: 700; }
.stat-lbl { font-size: 7pt; color: #888; margin-top: 2px; }
.stat-complete .stat-val { color: #437A22; }
.stat-progress .stat-val { color: #964219; }
.stat-ns .stat-val { color: #7A7974; }
.stat-total .stat-val { color: #01696F; }

/* Summary table */
.summary-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 14px; }
.summary-table th { background: #01696F; color: white; font-weight: 700; padding: 4px 8px; text-align: center; }
.summary-table td { padding: 3px 8px; border: 0.5px solid #D0D0D0; text-align: center; font-weight: 600; }
.summary-table tr:nth-child(even) td { background: #EBF3F8; }

/* Service lines */
.service-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 14px; }
.service-table th { background: #01696F; color: white; font-weight: 700; padding: 3px 8px; text-align: left; }
.service-table td { padding: 3px 8px; border: 0.5px solid #D0D0D0; }
.service-table tr:nth-child(even) td { background: #EBF3F8; }

/* Signature */
.sig-block { border: 1px solid #D0D0D0; border-radius: 6px; padding: 14px 16px; margin-top: 20px; background: #fafafa; }
.sig-title { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #01696F; border-bottom: 1px solid #D0D0D0; padding-bottom: 8px; margin-bottom: 12px; }
.sig-row { display: flex; gap: 16px; margin-bottom: 10px; }
.sig-field { flex: 1; }
.sig-line { border-bottom: 1px solid #1a1a1a; height: 22px; margin-bottom: 2px; }
.sig-lbl { font-size: 7pt; color: #888; }
.check-row { display: flex; gap: 24px; margin-bottom: 12px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 8.5pt; }
.check-box { width: 14px; height: 14px; border: 1px solid #888; display: inline-block; }

/* Chapter sections */
.section-heading { font-size: 10pt; font-weight: 700; color: #01696F; margin: 18px 0 10px 0; border-bottom: 1px solid #D0D0D0; padding-bottom: 4px; }
.chapter-section { margin-bottom: 18px; }
.chapter-header { font-size: 9pt; font-weight: 700; color: white; background: #01696F; padding: 5px 8px; border-radius: 3px 3px 0 0; margin-bottom: 0; }

/* Requirements table */
.req-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; }
.req-table th { background: #4a9a9f; color: white; font-weight: 600; padding: 3px 6px; text-align: left; font-size: 7pt; }
.req-table td { padding: 3px 6px; border-bottom: 0.5px solid #D0D0D0; vertical-align: top; }
.req-table tr:nth-child(even) td { background: #EBF3F8; }
.req-table tr:nth-child(odd) td { background: #FFFFFF; }

/* Policy table */
.policy-table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-top: 10px; }
.policy-table th { background: #01696F; color: white; font-weight: 700; padding: 4px 6px; text-align: left; font-size: 7pt; }
.policy-table td { padding: 3px 6px; border-bottom: 0.5px solid #D0D0D0; vertical-align: top; }

.footer-line { font-size: 7pt; color: #888; text-align: center; margin-top: 14px; padding-top: 6px; border-top: 1px solid #D0D0D0; }
.page-section-title { font-size: 12pt; font-weight: 700; color: #01696F; margin-bottom: 12px; }
</style>
</head>
<body>

<!-- PAGE 1: Summary + Signature -->
<div class="page1">
  <div class="header-block">
    <h1 class="report-title">VeritaPolicy&#8482; Compliance Report</h1>
    <h2 class="report-subtitle">TJC Laboratory Policy Tracker - 88 Required Policies</h2>
    <div class="meta-row">
      <span><strong>Laboratory:</strong> ${labName}</span>
      <span><strong>CLIA:</strong> ${clia}</span>
      <span><strong>Generated:</strong> ${dateGen}</span>
    </div>
  </div>

  <!-- Score + Stat boxes -->
  <div class="score-section">
    <div class="score-circle">
      <div class="score-num">${score}%</div>
      <div class="score-label">Readiness</div>
    </div>
    <div class="stat-grid">
      <div class="stat-box stat-total">
        <div class="stat-val">${total}</div>
        <div class="stat-lbl">Total Applicable</div>
      </div>
      <div class="stat-box stat-complete">
        <div class="stat-val">${complete}</div>
        <div class="stat-lbl">Complete</div>
      </div>
      <div class="stat-box stat-progress">
        <div class="stat-val">${inProgress}</div>
        <div class="stat-lbl">In Progress</div>
      </div>
      <div class="stat-box stat-ns">
        <div class="stat-val">${notStarted}</div>
        <div class="stat-lbl">Not Started</div>
      </div>
    </div>
  </div>

  <!-- Summary table -->
  <table class="summary-table">
    <thead>
      <tr>
        <th>Total Applicable</th>
        <th>Complete</th>
        <th>In Progress</th>
        <th>Not Started</th>
        <th>N/A (Excluded)</th>
        <th>Readiness Score</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${total}</td>
        <td style="color:#437A22">${complete}</td>
        <td style="color:#964219">${inProgress}</td>
        <td style="color:#7A7974">${notStarted}</td>
        <td>${na}</td>
        <td style="color:#01696F">${score}%</td>
      </tr>
    </tbody>
  </table>

  <!-- Service line settings -->
  <div style="font-size:8.5pt;font-weight:700;margin-bottom:6px;color:#1a1a1a">Service Line Settings</div>
  <table class="service-table">
    <thead>
      <tr>
        <th style="width:70%">Service Line</th>
        <th style="width:30%;text-align:center">Active</th>
      </tr>
    </thead>
    <tbody>${slRows}</tbody>
  </table>

  <!-- Signature block -->
  <div class="sig-block">
    <div class="sig-title">LABORATORY DIRECTOR OR DESIGNEE REVIEW</div>
    <div style="font-size:8pt;margin-bottom:10px">
      Final approval and clinical determination must be made by the laboratory director or designee. Review this report and indicate your determination below.
    </div>
    <div class="check-row">
      <div class="check-item"><span class="check-box"></span> Accepted - Readiness status reviewed and approved</div>
      <div class="check-item"><span class="check-box"></span> Not Accepted - Corrective action required</div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2">
        <div class="sig-line"></div>
        <div class="sig-lbl">Print Name</div>
      </div>
      <div class="sig-field" style="flex:1">
        <div class="sig-line"></div>
        <div class="sig-lbl">Initials</div>
      </div>
      <div class="sig-field" style="flex:1">
        <div class="sig-line"></div>
        <div class="sig-lbl">Date</div>
      </div>
    </div>
    <div class="sig-row">
      <div class="sig-field" style="flex:2">
        <div class="sig-line"></div>
        <div class="sig-lbl">Signature</div>
      </div>
      <div class="sig-field" style="flex:2">
        <div class="sig-line"></div>
        <div class="sig-lbl">Title</div>
      </div>
    </div>
  </div>

  <div class="footer-line">VeritaAssure&#8482; | VeritaPolicy&#8482; | Confidential - For Internal Lab Use Only</div>
</div>

<!-- PAGE 2+: Requirements by Chapter -->
<div class="page-break">
  <div class="header-block">
    <h1 class="report-title">VeritaPolicy&#8482; - Requirements Detail</h1>
    <div class="meta-row">
      <span><strong>Laboratory:</strong> ${labName}</span>
      <span><strong>CLIA:</strong> ${clia}</span>
      <span><strong>Generated:</strong> ${dateGen}</span>
    </div>
  </div>

  ${chapterSections}

  <div class="footer-line">VeritaAssure&#8482; | VeritaPolicy&#8482; | Confidential - For Internal Lab Use Only | Detailed results continued from page 1</div>
</div>

<!-- FINAL PAGE: Policy Library -->
<div class="page-break">
  <div class="header-block">
    <h1 class="report-title">VeritaPolicy&#8482; - Policy Library Index</h1>
    <div class="meta-row">
      <span><strong>Laboratory:</strong> ${labName}</span>
      <span><strong>CLIA:</strong> ${clia}</span>
      <span><strong>Generated:</strong> ${dateGen}</span>
    </div>
  </div>

  <table class="policy-table">
    <thead>
      <tr>
        <th style="width:10%">Policy #</th>
        <th style="width:28%">Policy Name</th>
        <th style="width:14%">Owner</th>
        <th style="width:10%">Status</th>
        <th style="width:12%">Last Reviewed</th>
        <th style="width:14%">Next Review</th>
        <th style="width:12%;text-align:center">Req. Covered</th>
      </tr>
    </thead>
    <tbody>${policyRows}</tbody>
  </table>

  <div class="footer-line">VeritaAssure&#8482; | VeritaPolicy&#8482; | Confidential - For Internal Lab Use Only</div>
</div>

</body>
</html>`;
}

export async function generateVeritaPolicyPDF(input: VeritaPolicyPDFInput): Promise<Buffer> {
  const html = buildVeritaPolicyPDFHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
