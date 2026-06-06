/**
 * Server-side PDF generation using Puppeteer + HTML templates.
 * Replaces client-side jsPDF. Called from POST /api/generate-pdf.
 *
 * The math functions are duplicated here (not imported from client) because
 * this runs in Node - the client calculations.ts uses the same algorithms.
 */

import puppeteer from "puppeteer";
import type { Study } from "@shared/schema";
import { existsSync as _teaExistsSync, readFileSync as _teaReadFileSync } from "fs";
import { resolve as _teaResolve } from "path";
import {
  injectLicenseHtml,
  licenseAugmentedFooterTemplate,
  type LicenseContext,
} from "./licenseStamp";
import { hasCanonicalTea } from "./backfillAbsoluteFloor";

// HTML-escape user-provided strings before they land in the rendered
// PDF body. Used for customLabel and any other field that originates
// in the data-entry form. Kept local to avoid a server-wide helper
// import for one call site.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Acceptance-criterion wording helpers (parking-lot #1) ───────────────────
// For analytes with a canonical 42 CFR §493 Subpart I PT criterion, narratives
// say "adopted ... CLIA TEa" and cite §493. For analytes without one (Lipase,
// Vitamin D 25-OH, Bilirubin Direct/Unbound, Iron Sat, Procalcitonin, and any
// other test not in the canonical teaData list), the acceptance criterion is
// laboratory-defined per the lab director or designee, and citing a §493 PT
// number that does not exist is a real compliance error. These helpers keep
// the two phrasings co-located.
function criterionLabel(testName: string): string {
  return hasCanonicalTea(testName) ? "CLIA TEa" : "Lab-Set Internal Goal";
}
function criterionAdjective(testName: string): string {
  return hasCanonicalTea(testName) ? "adopted" : "laboratory-defined";
}
function criterionSourcePhrase(testName: string, cfrAdoptedUnder: string): string {
  return hasCanonicalTea(testName)
    ? `§493 PT TEa for this analyte; adopted under ${cfrAdoptedUnder}`
    : `Lab-Set Internal Goal per laboratory director or designee policy; no canonical CLIA PT criterion exists for this analyte under 42 CFR §493 Subpart I`;
}
function criterionAuthorityPhrase(testName: string, cfrSection: string): string {
  return hasCanonicalTea(testName)
    ? `per ${cfrSection}`
    : `per laboratory director or designee policy`;
}

// Used by every page.pdf() call below: takes the original HTML + footer
// template and the request's license context, returns the augmented pair.
function applyLicenseToPuppeteer(
  html: string,
  baseFooter: string,
  ctx?: Partial<LicenseContext> | null,
): { html: string; footerTemplate: string } {
  return {
    html: injectLicenseHtml(html, ctx),
    footerTemplate: licenseAugmentedFooterTemplate(baseFooter, ctx),
  };
}

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

// ─── Inline SVG icon helpers (font-independent) ───────────────────────────────
// Production Railway containers do not ship Symbola/DejaVu Sans, so the
// Unicode glyphs U+2713 (check) and U+2717 (ballot-x) render as blank boxes
// or null bytes. Inline SVG paths render identically everywhere because they
// rely only on Puppeteer's vector renderer, never on installed fonts.
// Both icons inherit color via currentColor so existing style="color:#..."
// or .pass-badge / .fail-badge CSS continues to control the rendered hue.
function iconCheck(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="0.95em" height="0.95em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';
}
function iconCross(): string {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="0.95em" height="0.95em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
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

// ─── Precision plot (Levey-Jennings SDI vs specimen index) ───────────────────
// Phase 2 simple-precision parity (2026-05-20). Matches the layout EP
// Evaluator uses on the simple precision report: SDI on Y, specimen index on
// X, horizontal reference bands at +/- 1, 2, 3 SDI. SDI = (value - center) /
// scale, where center/scale defaults to observed mean/SD but switches to
// target mean / target SD when the caller provides both (so zero on the Y
// axis represents the target, as EE does when a target is supplied).
function precisionPlotSVG(
  values: number[], mean: number, sd: number,
  targetMean: number | null, targetSD: number | null,
  w = 320, h = 220
): string {
  if (!values.length || !(sd > 0)) return `<svg width="${w}" height="${h}"></svg>`;
  const center = targetMean != null && targetSD != null && targetSD > 0 ? targetMean : mean;
  const scale = targetMean != null && targetSD != null && targetSD > 0 ? targetSD : sd;
  const sdi = values.map(v => (v - center) / scale);
  const ml = 48, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const yMin = Math.min(-3.2, Math.min(...sdi) - 0.2);
  const yMax = Math.max(3.2, Math.max(...sdi) + 0.2);
  const xMin = 0.5, xMax = values.length + 0.5;
  const cx = (v: number) => ml + ((v - xMin) / (xMax - xMin)) * pw;
  const cy = (v: number) => mt + ph - ((v - yMin) / (yMax - yMin)) * ph;
  const refs = [-3, -2, -1, 0, 1, 2, 3].filter(y => y >= yMin && y <= yMax);
  const refLines = refs.map(y => {
    const color = y === 0 ? "#646e78" : Math.abs(y) === 3 ? "#dc5050" : Math.abs(y) === 2 ? "#c69b3f" : "#dde1e6";
    const w2 = Math.abs(y) === 0 ? 1.2 : 0.8;
    return `<line x1="${ml}" y1="${cy(y)}" x2="${ml + pw}" y2="${cy(y)}" stroke="${color}" stroke-width="${w2}"/>` +
      `<text x="${ml - 4}" y="${cy(y) + 3}" text-anchor="end" font-size="7" fill="${MUTED}">${y >= 0 ? "+" : ""}${y}</text>`;
  }).join("");
  const dots = sdi.map((y, i) => `<circle cx="${cx(i + 1)}" cy="${cy(y)}" r="2.5" fill="#1e3a8a" opacity="0.85"/>`).join("");
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">Precision Plot</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${refLines}${dots}
  <text x="${ml + pw / 2}" y="${h - 4}" text-anchor="middle" font-size="9" fill="${MUTED}">Specimen Index</text>
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="9" fill="${MUTED}" transform="rotate(-90,10,${mt + ph / 2})">SD Index (${targetMean != null ? "Target" : "Mean"})</text>
</svg>`;
}

// ─── Histogram with normal curve overlay ─────────────────────────────────────
// Counts each value into integer-rounded bins, overlays the Gaussian PDF
// scaled to the bar height of the modal bin. Vertical lines mark observed
// mean (blue) and target mean (red, when provided), matching other evaluation tools.
function histogramSVG(
  values: number[], mean: number, sd: number, targetMean: number | null,
  w = 320, h = 220
): string {
  if (!values.length || !(sd > 0)) return `<svg width="${w}" height="${h}"></svg>`;
  // Build integer bins centered on whole units (works well for the typical
  // chemistry / hematology resolution; ALT in the Pfizer report is reported
  // to whole U/L).
  const lo = Math.floor(Math.min(...values));
  const hi = Math.ceil(Math.max(...values));
  const targetLo = targetMean != null ? Math.floor(targetMean) : lo;
  const targetHi = targetMean != null ? Math.ceil(targetMean) : hi;
  const binLo = Math.min(lo, targetLo) - 1;
  const binHi = Math.max(hi, targetHi) + 1;
  const counts: Record<number, number> = {};
  for (let b = binLo; b <= binHi; b++) counts[b] = 0;
  for (const v of values) {
    const b = Math.round(v);
    if (counts[b] != null) counts[b] += 1;
  }
  const bins = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const totalN = values.length;
  const pct = bins.map(b => (counts[b] / totalN) * 100);
  const maxPct = Math.max(...pct, 10);
  const ml = 36, mr = 16, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  const cx = (b: number) => ml + ((b - binLo) / (binHi - binLo)) * pw;
  const cy = (p: number) => mt + ph - (p / maxPct) * ph;
  const barWidth = pw / (binHi - binLo + 1) * 0.85;
  const bars = bins.map((b, i) => {
    if (pct[i] === 0) return "";
    const x = cx(b) - barWidth / 2;
    const y = cy(pct[i]);
    return `<rect x="${x}" y="${y}" width="${barWidth}" height="${mt + ph - y}" fill="#1e3a8a" opacity="0.85"/>`;
  }).join("");
  // Normal curve overlay: PDF height = (1 / (sd*sqrt(2*pi))) * exp(-((x-mean)^2)/(2*sd^2)).
  // Scale so the peak matches the modal bar height visually.
  const pdfAt = (x: number) => (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mean) ** 2) / (2 * sd * sd));
  const peakPdf = pdfAt(mean);
  const peakBarPct = Math.max(...pct);
  const pdfScale = peakBarPct > 0 ? peakBarPct / peakPdf : 0;
  let curve = "";
  const steps = 80;
  for (let i = 0; i <= steps; i++) {
    const x = binLo + (i / steps) * (binHi - binLo);
    const yPct = pdfAt(x) * pdfScale;
    const px = cx(x), py = cy(yPct);
    curve += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
  }
  const curvePath = `<path d="${curve}" fill="none" stroke="#646e78" stroke-width="1.2"/>`;
  const obsMeanLine = `<line x1="${cx(mean)}" y1="${mt}" x2="${cx(mean)}" y2="${mt + ph}" stroke="#1e3a8a" stroke-width="1.4"/>`;
  const targetLine = targetMean != null
    ? `<line x1="${cx(targetMean)}" y1="${mt}" x2="${cx(targetMean)}" y2="${mt + ph}" stroke="#dc5050" stroke-width="1.4"/>`
    : "";
  // Y-axis ticks at 10% intervals up to maxPct
  let yTicks = "";
  for (let p = 0; p <= maxPct; p += 10) {
    yTicks += `<line x1="${ml}" y1="${cy(p)}" x2="${ml + pw}" y2="${cy(p)}" stroke="#dde1e6" stroke-width="0.5"/>` +
      `<text x="${ml - 4}" y="${cy(p) + 3}" text-anchor="end" font-size="7" fill="${MUTED}">${p}%</text>`;
  }
  // X-axis ticks at each integer bin
  let xTicks = "";
  for (const b of bins) {
    if ((b - binLo) % Math.max(1, Math.floor((binHi - binLo) / 8)) === 0) {
      xTicks += `<text x="${cx(b)}" y="${mt + ph + 12}" text-anchor="middle" font-size="7" fill="${MUTED}">${b}</text>`;
    }
  }
  const legend = targetMean != null
    ? `<g transform="translate(${ml + 6}, ${mt + 4})">
        <line x1="0" y1="3" x2="12" y2="3" stroke="#dc5050" stroke-width="1.4"/>
        <text x="16" y="6" font-size="7" fill="${MUTED}">Target Mean</text>
        <line x1="0" y1="13" x2="12" y2="13" stroke="#1e3a8a" stroke-width="1.4"/>
        <text x="16" y="16" font-size="7" fill="${MUTED}">Obs Mean</text>
      </g>`
    : `<g transform="translate(${ml + 6}, ${mt + 4})">
        <line x1="0" y1="3" x2="12" y2="3" stroke="#1e3a8a" stroke-width="1.4"/>
        <text x="16" y="6" font-size="7" fill="${MUTED}">Obs Mean</text>
      </g>`;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">Histogram</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${yTicks}${bars}${curvePath}${obsMeanLine}${targetLine}${legend}${xTicks}
</svg>`;
}

// ─── SD vs Goal verdict bar ──────────────────────────────────────────────────
// At-a-glance verdict graphic for the vendor-SD comparison: vertical bar at
// the observed SD height (colored by verdict), horizontal fence whiskers at
// the 95% CI bounds, and a dashed goal line at the vendor SD. Conditional
// render (only when a vendor SD goal is set). Visual design is our own; we
// match the FUNCTIONAL pattern of an SD-vs-goal indicator (a generic concept)
// not the pixel layout of any specific competitor tool. Built 2026-05-20 as
// part of the EE-parity buildout.
function vendorSDBarSVG(
  sd: number, sdCiLower: number | null, sdCiUpper: number | null,
  vendorSD: number, verdict: "Pass" | "Fail" | "Uncertain",
  unitLabel: string = "",
  w = 220, h = 230
): string {
  if (!(sd > 0) || !(vendorSD > 0)) return `<svg width="${w}" height="${h}"></svg>`;
  const ml = 44, mr = 18, mt = 28, mb = 36;
  const pw = w - ml - mr, ph = h - mt - mb;
  // Y-axis range: 0 to max(vendorSD, sdCiUpper, sd) * 1.3 to give headroom for
  // the goal line label even when SD is well above goal.
  const top = (sdCiUpper && sdCiUpper > 0 ? sdCiUpper : sd);
  const yMax = Math.max(vendorSD, top, sd) * 1.3;
  const yMin = 0;
  const cy = (v: number) => mt + ph - ((v - yMin) / (yMax - yMin)) * ph;
  // Color per CLAUDE.md status palette.
  const fill = verdict === "Pass" ? "#437A22"
    : verdict === "Fail" ? "#A12C7B"
    : "#964219"; // Uncertain (amber)
  const fillLight = verdict === "Pass" ? "#5e9b3a"
    : verdict === "Fail" ? "#bf4a96"
    : "#b35d33";
  // Bar geometry: vertical bar centered horizontally, 56px wide.
  const barW = 56;
  const barX = ml + (pw - barW) / 2;
  const barTopY = cy(sd);
  const barBottomY = cy(0);
  const barH = barBottomY - barTopY;
  // CI fences: horizontal whiskers extending slightly beyond the bar edges.
  const fenceW = barW + 18;
  const fenceX = ml + (pw - fenceW) / 2;
  const fences = (sdCiLower != null && sdCiUpper != null && sdCiLower > 0 && sdCiUpper > 0) ? `
    <line x1="${fenceX}" y1="${cy(sdCiLower)}" x2="${fenceX + fenceW}" y2="${cy(sdCiLower)}" stroke="#28251D" stroke-width="1.1" stroke-linecap="round"/>
    <line x1="${fenceX}" y1="${cy(sdCiUpper)}" x2="${fenceX + fenceW}" y2="${cy(sdCiUpper)}" stroke="#28251D" stroke-width="1.1" stroke-linecap="round"/>
    <line x1="${ml + pw / 2}" y1="${cy(sdCiLower)}" x2="${ml + pw / 2}" y2="${cy(sdCiUpper)}" stroke="#28251D" stroke-width="0.9" stroke-dasharray="2,2" opacity="0.55"/>` : "";
  // Goal line: dashed teal-grey horizontal line at vendor SD, labeled on right.
  const goalY = cy(vendorSD);
  const goalLine = `
    <line x1="${ml - 4}" y1="${goalY}" x2="${ml + pw + 4}" y2="${goalY}" stroke="#0A3A3D" stroke-width="1.4" stroke-dasharray="5,3"/>
    <text x="${ml + pw + 6}" y="${goalY - 3}" text-anchor="end" font-size="8" font-weight="700" fill="#0A3A3D">Goal: ${vendorSD.toFixed(2)}${unitLabel ? " " + unitLabel : ""}</text>`;
  // Y-axis tick marks at 0, max/4, max/2, 3max/4 (rounded).
  let yTicks = "";
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    const ty = cy(v);
    yTicks += `<line x1="${ml - 3}" y1="${ty}" x2="${ml}" y2="${ty}" stroke="#646e78" stroke-width="0.7"/>` +
      `<text x="${ml - 6}" y="${ty + 3}" text-anchor="end" font-size="7" fill="#646e78">${v.toFixed(2)}</text>`;
  }
  // Verdict label at top.
  const verdictBadge = `
    <text x="${ml + pw / 2}" y="${mt + ph + 22}" text-anchor="middle" font-size="9" font-weight="700" fill="${fill}">${verdict.toUpperCase()}</text>`;
  // SD value label inside the bar (white) if bar tall enough, else above.
  const labelText = `${sd.toFixed(2)}`;
  const labelInside = barH > 28;
  const sdLabel = labelInside
    ? `<text x="${ml + pw / 2}" y="${barTopY + 14}" text-anchor="middle" font-size="9" font-weight="700" fill="white">${labelText}</text>`
    : `<text x="${ml + pw / 2}" y="${barTopY - 4}" text-anchor="middle" font-size="9" font-weight="700" fill="${fill}">${labelText}</text>`;
  return `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="background:#f8fafc;border:1px solid #cdd1d6;border-radius:4px">
  <text x="${w / 2}" y="16" text-anchor="middle" font-size="10" font-weight="600" fill="#14141e">SD vs Goal</text>
  <rect x="${ml}" y="${mt}" width="${pw}" height="${ph}" fill="white" stroke="#cdd1d6" stroke-width="0.5"/>
  ${yTicks}
  <defs>
    <linearGradient id="vsd-grad-${verdict}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${fillLight}"/>
      <stop offset="100%" stop-color="${fill}"/>
    </linearGradient>
  </defs>
  <rect x="${barX}" y="${barTopY}" width="${barW}" height="${barH}" fill="url(#vsd-grad-${verdict})" stroke="${fill}" stroke-width="0.8"/>
  ${fences}
  ${goalLine}
  ${sdLabel}
  ${verdictBadge}
  <text x="10" y="${mt + ph / 2}" text-anchor="middle" font-size="8" fill="#646e78" transform="rotate(-90,10,${mt + ph / 2})">SD${unitLabel ? " (" + unitLabel + ")" : ""}</text>
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

// ─── TEa display helper (absolute vs percentage, with dual-criterion support) ─
export function teaDisplayStr(study: Study): string {
  const isAbsolute = (study as any).teaIsPercentage === 0 || (study as any).tea_is_percentage === 0;
  const absFloor = (study as any).cliaAbsoluteFloor ?? (study as any).clia_absolute_floor ?? null;
  const absUnit = (study as any).cliaAbsoluteUnit ?? (study as any).clia_absolute_unit ?? '';
  if (isAbsolute && absFloor == null) {
    const unit = (study as any).teaUnit || (study as any).tea_unit || '';
    return `\u00B1${study.cliaAllowableError} ${unit}`.trim();
  }
  const pctStr = `\u00B1${(study.cliaAllowableError * 100).toFixed(1)}%`;
  if (absFloor != null && !isAbsolute) {
    return `${pctStr} or \u00B1${absFloor} ${absUnit} (greater)`.trim();
  }
  return pctStr;
}
function isAbsoluteTea(study: Study): boolean {
  return (study as any).teaIsPercentage === 0 || (study as any).tea_is_percentage === 0;
}

// ─── CFR URL map ──────────────────────────────────────────────────────────────
const CFR_URLS: Record<string, string> = {
  // Subpart I (PT-analyte sections)
  "42 CFR §493.927": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.927",
  "42 CFR §493.931": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.931",
  "42 CFR §493.933": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.933",
  "42 CFR §493.937": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.937",
  "42 CFR §493.941": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.941",
  "42 CFR §493.959": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.959",
  // Subpart K (quality-system regs -- page-1 references block).
  // Note on §493.1213: this section is "Condition: Toxicology", not a verification
  // authority. Kept here only so an existing reference to it links to the real
  // section page. The invalid §493.1213(b)(2) variant was removed; that paragraph
  // structure does not exist in the current CFR.
  "42 CFR §493.1213":          "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1213",
  "42 CFR §493.1253(b)(2)":    "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1253(b)(2)(i)": "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1253(b)(2)(ii)":"https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1253(b)(2)(iii)":"https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1253(b)(1)":    "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1253(b)(1)(iii)":"https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
  "42 CFR §493.1255":          "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1255",
  "42 CFR §493.1255(b)":       "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1255",
  "42 CFR §493.1255(b)(3)":    "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1255",
  "42 CFR §493.1256":          "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1256",
  "42 CFR §493.1271":          "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1271",
  "42 CFR §493.1271(a)":       "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1271",
  "42 CFR §493.1271(b)":       "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1271",
  "42 CFR §493.1281":          "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1281",
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
  .section-heading { font-size: 13pt; font-weight: 700; color: ${DARK}; margin: 4px 0 6px; }

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
  .eval-section { margin-top: 4px; }
  .eval-title { font-size: 10pt; font-weight: 700; text-align: center; margin-bottom: 3px; }
  .eval-text { font-size: 7.5pt; line-height: 1.4; margin-bottom: 6px; }
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

  /* Supporting data page - flow naturally onto stats page if room, else fresh page as a whole unit */
  .supporting-page { page-break-before: auto; page-break-inside: avoid; break-inside: avoid; margin-top: 8px; }
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

// ─── Instrument display helpers ──────────────────────────────────────────────
// Builds the instrument string for reports using VeritaMap-linked data when available.
// Compact format for page headers: "Model (Nickname)" -- omits S/N to save vertical space
function instrumentDisplayInline(study: Study): string {
  const display = (study as any)._instrumentDisplay as Record<string, { model: string; nickname: string | null; serial_number: string | null }> | undefined;
  if (display && display["0"]) {
    const d = display["0"];
    return d.nickname ? `${d.model} (${d.nickname})` : d.model;
  }
  return study.instrument;
}

// Abbreviate an instrument name from study.instruments for compact page-1 display.
// Input forms: "NICKNAME, Model Name" or "Model Name" -> abbreviated to shorter form
function abbreviateInstrumentName(name: string): string {
  // If name contains a comma, the part before is likely a nickname from VeritaMap
  // e.g. "CLYDE, Ortho VITROS 5600" -> "VITROS 5600 (CLYDE)"
  const commaIdx = name.indexOf(", ");
  if (commaIdx > 0 && commaIdx < name.length - 2) {
    const nickname = name.substring(0, commaIdx).trim();
    const model = name.substring(commaIdx + 2).trim();
    // If nickname is short (likely a label), show "Model (Nickname)"
    if (nickname.length <= 20) return `${model} (${nickname})`;
    return model;
  }
  return name;
}

// Multi-line format for supporting data: "Model (Nickname)\nS/N: serial" or "Model\nS/N: serial"
function instrumentDisplayMultiline(study: Study): string {
  const display = (study as any)._instrumentDisplay as Record<string, { model: string; nickname: string | null; serial_number: string | null }> | undefined;
  if (display && display["0"]) {
    const d = display["0"];
    let line1 = d.nickname ? `${d.model} (${d.nickname})` : d.model;
    if (d.serial_number) return `${line1}<br/>S/N: ${d.serial_number}`;
    return line1;
  }
  return study.instrument;
}

// ─── Shared header HTML ───────────────────────────────────────────────────────
function headerHTML(study: Study, cliaNumber?: string): string {
  const typeLabelMap: Record<string, string> = {
    cal_ver: "Calibration Verification (CLSI EP06)",
    precision: "Precision Verification (EP15)",
    method_comparison: "Correlation / Method Comparison",
    lot_to_lot: "Reagent Lot Verification (CLSI EP26-A)",
    ref_interval: "Reference Range Verification",
    pt_coag: "PT/INR Geometric Mean Calculator (CLSI H47)",
    qc_range: "QC Lot Verification (CLSI C24-Ed4)",
    multi_analyte_coag: "Multi-Analyte Lot Comparison (Coag)",
    sensitivity: "Sensitivity Verification (EP17)",
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
    <div class="header-right">Instrument: ${instrumentDisplayInline(study)}</div>
  </div>
  <div class="report-title">${typeLabel} - ${study.testName}</div>
  <hr class="divider">`;
}

// ─── Supporting data page HTML ────────────────────────────────────────────────
function supportingPageHTML(study: Study, instrumentNames: string[]): string {
  const teaStr = teaDisplayStr(study);
  const cfr = (study as any).cfr || "42 CFR §493.931";
  const cfrUrl = CFR_URLS[cfr] || "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.931";

  const isCanonical = hasCanonicalTea(study.testName);
  const criterionRowLabel = isCanonical
    ? "Adopted Acceptance Criterion (TEa)"
    : "Lab-Set Internal Goal (no CLIA TEa)";
  const cfrReferenceLabel = isCanonical
    ? "CFR Reference (PT TEa, adopted)"
    : "Source";
  const cfrReferenceValue = isCanonical
    ? `<a href="${cfrUrl}" class="teal-link">${cfr}</a>`
    : "Laboratory-defined per director or designee policy. No CLIA PT criterion exists for this analyte under 42 CFR §493 Subpart I.";
  // Append the picked CLIA preset name to the criterion row so a preset
  // crosswire (e.g. picking pCO2 8% / 5 mm Hg thinking it was Carbon Dioxide
  // 20%) is visible at report-review time. Customer report 2026-06-04.
  // NULL on legacy studies = render the value alone (the old way).
  const presetLabel: string | null = (study as any).cliaPresetLabel ?? null;
  const teaStrWithPreset = presetLabel ? `${teaStr} (${presetLabel})` : teaStr;
  const specs: any[][] = [
    ["Study Type", study.studyType === "cal_ver" ? "Calibration Verification (CLSI EP06)" : study.studyType === "precision" ? "Precision Verification (EP15)" : study.studyType === "lot_to_lot" ? "Reagent Lot Verification (CLSI EP26-A)" : study.studyType === "ref_interval" ? "Reference Range Verification" : study.studyType === "sensitivity" ? "Analytical Sensitivity (CLSI EP17-A2)" : study.studyType === "accuracy_bias" ? "Accuracy / Bias: Single Instrument vs Target (CLSI EP15-A3)" : study.studyType === "linearity" ? "Linearity (CLSI EP06)" : study.studyType === "reportable_range" ? "Reportable Range (CLIA §493.1255)" : "Method Comparison: Multi-Instrument Correlation (CLSI EP09 + EP15-A3)"],
    ["Test Name", study.testName],
    [criterionRowLabel, teaStrWithPreset],
    [cfrReferenceLabel, cfrReferenceValue],
    ["Allowable Systematic Error", teaStr],
  ];
  // Phase 2 parity: surface optional precision-study inputs in User
  // Specifications so the supporting data table matches EE's panel when the
  // operator entered a vendor SD goal or a target mean.
  if (study.studyType === "precision") {
    const vSD = (study as any).vendorSd ?? (study as any).vendor_sd;
    const vConc = (study as any).vendorSdConcentration ?? (study as any).vendor_sd_concentration;
    const tMean = (study as any).targetMean ?? (study as any).target_mean;
    const tCV = (study as any).targetCv ?? (study as any).target_cv;
    if (vSD != null) {
      specs.push(["Precision Verification Goal", "Vendor SD"]);
      specs.push(["Within-Run SD (Vendor)", String(vSD)]);
      if (vConc != null) specs.push(["Concentration at Vendor SD", String(vConc)]);
    }
    if (tMean != null) specs.push(["Target Mean", String(tMean)]);
    if (tCV != null) specs.push(["Target CV", `${tCV}%`]);
    // EE Day 2 QC traceability rows.
    const controlLot = (study as any).controlLot ?? (study as any).control_lot;
    const reagentLot = (study as any).reagentLot ?? (study as any).reagent_lot;
    const comment = (study as any).comment;
    const resultUnits = (study as any).resultUnits ?? (study as any).result_units;
    if (resultUnits) specs.push(["Units", String(resultUnits)]);
    if (controlLot) specs.push(["Control Lot", String(controlLot)]);
    if (reagentLot) specs.push(["Reagent Lot", String(reagentLot)]);
    if (comment) specs.push(["Comment", String(comment)]);
    // EE Day 3: link to the standalone Report Interpretation Guide so the
    // PDF stays compact while educational content lives at a stable URL.
    specs.push([
      "Report Interpretation Guide",
      `<a href="https://www.veritaslabservices.com/resources/precision-verification-report-interpretation-guide" class="teal-link">veritaslabservices.com/resources/precision-verification-report-interpretation-guide</a>`,
    ]);
  }
  const supporting = [
    ["Analyst", study.analyst],
    ["Date", study.date],
    ["Instrument(s)", instrumentDisplayMultiline(study)],
    ["Test Methods", instrumentNames.join(", ")],
    ["Generated by", "VeritaCheck\u2122 · Veritas Lab Services"],
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
    <div class="footer-disclaimer">VeritaCheck\u2122 is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.</div>
    <div class="footer-bar">
      <span>VeritaCheck\u2122 by Veritas Lab Services · veritaslabservices.com · Generated ${today}</span>
      <span class="page-num"></span>
    </div>
  </div>`;
}

// ─── Laboratory Director Review block HTML ───────────────────────────────────
function directorReviewHTML(): string {
  return `
  <div style="margin-top:4px;border:1px solid #D4D1CA;border-left:4px solid #01696F;border-radius:5px;padding:6px 12px;background:#FAFAF8;break-inside:avoid;page-break-inside:avoid;">
    <div style="font-size:8pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Laboratory Director or Designee Review</div>
    <p style="font-size:7.5pt;color:#28251D;line-height:1.4;margin:0 0 5px 0;font-style:italic;">"I have reviewed these results against my laboratory's established performance specifications and applicable regulatory requirements."</p>
    <div style="font-size:8pt;color:#28251D;margin-bottom:2px;">
      <span style="margin-right:18px;">\u25CB Accepted for patient testing</span>
      <span>\u25CB Not accepted</span>
    </div>
    <div style="display:flex;gap:16px;margin-top:6px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:12px;">Signature</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:12px;">Date</div>
      </div>
    </div>
    <div style="display:flex;gap:16px;margin-top:4px;">
      <div style="flex:3;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:8px;">Print Name</div>
      </div>
      <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2px;">
        <div style="font-size:6.5pt;color:#888;margin-top:8px;">Title</div>
      </div>
    </div>
  </div>`;
}


// ─── Regulatory Compliance References box ───────────────────────────────────
type StudyTypeKey = "cal_ver" | "method_comparison" | "precision" | "lot_to_lot" | "pt_coag" | "qc_range" | "multi_analyte_coag" | "ref_interval" | "sensitivity" | "carryover" | "accuracy_bias" | "linearity" | "reportable_range";
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
    cfr:  ["42 CFR §493.1281"],
  },
  precision: {
    cap:  ["CHM.13830"],
    tjc:  ["QSA.02.01.01"],
    cola: ["LAB.021", "LAB.023"],
    aabb: ["5.7.1"],
    clsi: ["EP15-A3"],
    cfr:  ["42 CFR §493.1253(b)(2)(ii)"],
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
    cfr:  ["42 CFR §493.1255", "42 CFR §493.1281"],
  },
  ref_interval: {
    cap:  ["CHM.13900", "GEN.40460"],
    tjc:  ["QSA.02.01.01", "QSA.02.02.01"],
    cola: ["LAB.021"],
    aabb: ["5.6.2"],
    clsi: ["EP28-A3c", "C28-A3c"],
    cfr:  ["42 CFR §493.1253(b)(2)", "42 CFR §493.1271(a)"],
  },
  sensitivity: {
    cap:  ["CHM.13845", "GEN.41036"],
    tjc:  ["QSA.02.01.01"],
    cola: ["LAB.021"],
    aabb: ["5.6.1"],
    clsi: ["EP17-A2"],
    cfr:  ["42 CFR §493.1253(b)(2)(iii)", "42 CFR §493.1253(b)(1)"],
  },
  carryover: {
    cap:  ["COM.40000", "GEN.40455"],
    tjc:  ["QSA.02.02.01"],
    cola: ["LAB.022"],
    aabb: ["5.6.3"],
    clsi: ["EP10-A3"],
    cfr:  ["42 CFR §493.1253(b)(2)"],
  },
  // ── cal_ver split (PR 1: skeleton entries) ───────────────────────────────
  // Three new study types replacing the bundled cal_ver. Regulatory refs
  // match the CLSI standard each subtype was always supposed to cite.
  // Per-type PDF builders ship in PR 2 / PR 3 / PR 4.
  accuracy_bias: {
    cap:  ["COM.40000", "GEN.40460"],
    tjc:  ["QSA.02.02.01"],
    cola: ["LAB.020"],
    aabb: ["5.6.1"],
    clsi: ["EP15-A3"],
    cfr:  ["42 CFR §493.1253(b)(1)(i)"],
  },
  linearity: {
    cap:  ["COM.40000", "COM.40620"],
    tjc:  ["QSA.02.02.01"],
    cola: ["LAB.020"],
    aabb: ["5.6.1"],
    clsi: ["EP06"],
    cfr:  ["42 CFR §493.1253(b)(2)"],
  },
  reportable_range: {
    cap:  ["COM.40620", "GEN.40450"],
    tjc:  ["QSA.02.02.01"],
    cola: ["LAB.020"],
    aabb: ["5.6.1"],
    clsi: ["EP06"],
    cfr:  ["42 CFR §493.1253(b)(2)"],
  },
};

// Phase 3 (2026-05-01): empty default = CLIA-only mode. Previously hardcoded to
// ["CAP", "TJC"], which spuriously rendered TJC and CAP columns on PDFs for
// CLIA-only, AABB-only, or COLA-only labs. With the empty default, when no
// accreditor flag is set on the labs row, only CLSI + CLIA/CFR columns render
// in the regulatory box, which is correct for a CLIA-only lab.
const DEFAULT_PREFERRED_STANDARDS: AccreditationBody[] = [];

// ─── TEa audit freshness loader ──────────────────────────────────────────────
// Reads the artifact written by script/teaCanonicalRenderAudit.ts at build
// time. Falls back to the bundle build date if the artifact is unavailable.
let _teaAuditCache: { verifiedAt: string | null; loaded: boolean } = { verifiedAt: null, loaded: false };
function getTeaAuditVerifiedAt(): string | null {
  if (_teaAuditCache.loaded) return _teaAuditCache.verifiedAt;
  _teaAuditCache.loaded = true;
  const candidates = [
    _teaResolve(process.cwd(), "dist", "data", "tea_audit.json"),
    _teaResolve(process.cwd(), "server", "data", "tea_audit.json"),
  ];
  for (const p of candidates) {
    try {
      if (_teaExistsSync(p)) {
        const raw = _teaReadFileSync(p, "utf-8");
        const j = JSON.parse(raw);
        if (j && j.verifiedAt) {
          _teaAuditCache.verifiedAt = String(j.verifiedAt);
          return _teaAuditCache.verifiedAt;
        }
      }
    } catch {
      /* keep trying */
    }
  }
  return null;
}
function teaAuditFreshnessLine(): string {
  const ts = getTeaAuditVerifiedAt();
  if (!ts) return "";
  // Format YYYY-MM-DD from ISO timestamp.
  const date = ts.slice(0, 10);
  return `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed #D4D1CA;font-size:6.5pt;color:#888;">Canonical TEa list verified against 42 CFR \u00A7493 on ${date}.</div>`;
}

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
  // Static 3x2 sub-grid for CLIA / CFR -- Subpart I PT acceptance-criterion sections
  const cfrLink = (c: string) => `<a href="${CFR_URLS[c]}" class="teal-link">${c}</a>`;
  cols.push({
    label: "CLIA / CFR",
    content: `<div>
      <div style="font-size:5.5pt;font-weight:400;color:#999;margin-bottom:2px;">PT acceptance criteria (§493 Subpart I)</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 10px;font-size:6.8pt;color:#444;line-height:1.6;">
        <div>${cfrLink("42 CFR \u00A7493.927")}</div>
        <div>${cfrLink("42 CFR \u00A7493.937")}</div>
        <div>${cfrLink("42 CFR \u00A7493.931")}</div>
        <div>${cfrLink("42 CFR \u00A7493.941")}</div>
        <div>${cfrLink("42 CFR \u00A7493.933")}</div>
        <div>${cfrLink("42 CFR \u00A7493.959")}</div>
      </div>
    </div>`,
  });

  const gridCols = `repeat(${cols.length}, 1fr)`;
  const colsHTML = cols.map(c => `
      <div>
        <div style="font-size:6.5pt;font-weight:700;color:#888;text-transform:uppercase;margin-bottom:4px;">${c.label}</div>
        <div>${c.content}</div>
      </div>`).join("");

  return `
  <div style="margin-top:4px;border:1px solid #D4D1CA;border-left:4px solid #01696F;border-radius:5px;padding:6px 12px;background:#FAFAF8;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Regulatory Compliance References</div>
    <div style="display:grid;grid-template-columns:${gridCols};gap:4px 12px;">
      ${colsHTML}
    </div>
    ${teaAuditFreshnessLine()}
  </div>`;
}

// ─── Evaluation section HTML ──────────────────────────────────────────────────
function evalHTML(summary: string, overallPass: boolean, passCount: number, totalCount: number, cliaError: number, study?: Study): string {
  const teaStr = study ? teaDisplayStr(study) : `\u00B1${(cliaError * 100).toFixed(1)}%`;
  const failCount = totalCount - passCount;
  const verdictText = overallPass
    ? `Meets adopted acceptance criterion - ${passCount}/${totalCount} results within TEa of ${teaStr}`
    : `Does not meet adopted acceptance criterion - ${failCount}/${totalCount} results exceeded TEa of ${teaStr}`;
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
  const cfrSection = (study as any)?.cfr || "42 CFR \u00A7493.931";
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

    const calAdj = criterionAdjective(analyteName);
    const calSource = criterionSourcePhrase(analyteName, "42 CFR §493.1255(b)(3) and §493.1253(b)(2)");
    const calAuthority = criterionAuthorityPhrase(analyteName, cfrSection);
    const calLabel = criterionLabel(analyteName);
    if (results.overallPass) {
      narrative = `All ${results.totalCount} calibration levels for ${analyteName} fell within the ${calAdj} calibration verification acceptance criterion of ±${cliaPct}% (${calSource}). `;
      if (meetsAdlm) {
        narrative += `The maximum observed error of ${sf(maxErr, 1)}% also meets the ADLM-recommended internal goal of ±${adlmPct}%, indicating performance well above the ${calAdj} acceptance criterion. `;
      } else {
        narrative += `The maximum observed error of ${sf(maxErr, 1)}% meets the ${calAdj} acceptance criterion; the ADLM recommends an internal goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      narrative += `The regression slope of ${sf(slopeVal, 3)} (ideal: 1.000) and intercept of ${sf(interceptVal, 3)} (ideal: 0) indicate ${slopeInterp} and ${interceptInterp}. This instrument is performing within the ${calAdj} limits across its reportable range. `;
      narrative += `<b>Each calibration level was individually evaluated against the ${calAdj} acceptance criterion (${calLabel}) of ${teaStr} ${calAuthority}. All levels satisfied this criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      const failCount = results.totalCount - results.passCount;
      narrative = `${failCount} of ${results.totalCount} calibration level${failCount > 1 ? "s" : ""} for ${analyteName} exceeded the ${calAdj} calibration verification acceptance criterion of ±${cliaPct}% (${calSource}). `;
      narrative += `The regression slope of ${sf(slopeVal, 3)} and intercept of ${sf(interceptVal, 3)} suggest ${slopeInterp} and ${interceptInterp}. `;
      narrative += `<b>Each calibration level was individually evaluated against the ${calAdj} acceptance criterion (${calLabel}) of ${teaStr} ${calAuthority}. One or more levels did not satisfy this criterion; see the per-level table for details.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
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
    const mcAdj = criterionAdjective(analyteName);
    const mcSource = criterionSourcePhrase(analyteName, "42 CFR §493.1253(b)(2)");
    const mcAuthority = criterionAuthorityPhrase(analyteName, cfrSection);
    const mcLabel = criterionLabel(analyteName);

    const biasInterp = isAbsolute
      ? (Math.abs(meanBiasAbs) <= cliaError
        ? `within the ${mcAdj} method comparison acceptance criterion of ${teaStr}`
        : `exceeds the ${mcAdj} method comparison acceptance criterion of ${teaStr} and requires investigation`)
      : (Math.abs(meanBiasPct) <= cliaError * 100
        ? `within the ${mcAdj} method comparison acceptance criterion of ${teaStr}`
        : `exceeds the ${mcAdj} method comparison acceptance criterion of ${teaStr} and requires investigation`);

    const nPairs: number = firstReg?.n ?? 0;
    const decisionRuleSentence = `Decision rule: with N=${nPairs} paired specimens, every specimen must fall within the acceptance criterion for the comparison to pass. Any single specimen exceeding the criterion fails the comparison and triggers investigation; this all-or-nothing per-specimen criterion is more conservative than a percentage-tolerance rule.`;
    const equivalenceSentence = `This study evaluates clinical equivalence per the ${mcAdj} Allowable Total Error, not statistical equivalence: two methods can be statistically different yet clinically equivalent when their bias is well within the criterion, and statistically indistinguishable yet clinically unacceptable when bias approaches it.`;

    if (results.overallPass) {
      narrative = `The Pearson correlation coefficient of ${sf(rVal, 3)} indicates ${correlationInterp} agreement between methods for ${analyteName}. `;
      narrative += `The Deming regression slope of ${sf(slopeVal, 3)} (ideal: 1.000) indicates ${slopeInterp}. `;
      narrative += `The mean bias is ${biasDescr} (supporting statistic; not the verdict criterion). `;
      narrative += `The Bland-Altman analysis confirms no clinically significant systematic difference between the primary and comparison methods. `;
      narrative += `${equivalenceSentence} ${decisionRuleSentence} `;
      narrative += `<b>Each paired specimen was individually evaluated against the ${mcAdj} acceptance criterion (${mcLabel}) of ${teaStr} ${mcAuthority} (${mcSource}). All paired specimens satisfied this criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = `The method comparison for ${analyteName} did not meet the ${mcAdj} acceptance criterion. `;
      narrative += `The correlation of ${sf(rVal, 3)} and a mean bias of ${biasDescr} (${mcAdj} limit: ${teaStr}) indicate unacceptable agreement between methods. `;
      narrative += `${equivalenceSentence} ${decisionRuleSentence} `;
      narrative += `<b>Each paired specimen was individually evaluated against the ${mcAdj} acceptance criterion (${mcLabel}) of ${teaStr} ${mcAuthority} (${mcSource}). One or more paired specimens did not satisfy this criterion; see the per-sample table for details.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  }

  if (studyType === "precision") {
    const levels = results.levelResults || [];
    const maxCV: number = levels.length > 0 ? Math.max(...levels.map((r: any) => r.totalCV ?? r.cv ?? 0)) : 0;
    const meetsAdlm = maxCV <= cliaError * 50;
    const isAdvanced = results.mode === "advanced";

    const prAdj = criterionAdjective(analyteName);
    const prSource = criterionSourcePhrase(analyteName, "42 CFR §493.1253(b)(2)(ii)");
    const prAuthority = criterionAuthorityPhrase(analyteName, cfrSection);
    const prLabel = criterionLabel(analyteName);
    // Methodology note prepended to both pass and fail narratives so the
    // printed report names the path (Simple aggregate CV vs Advanced EP15
    // ANOVA) and surfaces the CV formula. Cites CLSI EP15-A3 alongside
    // the existing 42 CFR §493.1253 reference.
    const methodologyNote = isAdvanced
      ? `Methodology: CLSI EP15-A3 Advanced (ANOVA-decomposed precision). The study estimates within-run, between-day, and total CV across multiple days, runs, and replicates per run. `
      : `Methodology: CLSI EP15-A3 Simple (aggregate precision). For each level, mean and standard deviation (n-1) are computed across all replicates, and the coefficient of variation (CV) is calculated as SD divided by mean, expressed as a percent. `;
    if (results.overallPass) {
      narrative = methodologyNote;
      narrative += `The precision study for ${analyteName} demonstrated a maximum observed CV of ${sf(maxCV, 2)}%, which is within the ${prAdj} precision acceptance criterion of ±${cliaPct}% (${prSource}). `;
      if (meetsAdlm) {
        narrative += `The result also meets the ADLM-recommended internal precision goal of ±${adlmPct}%, indicating performance well above the ${prAdj} acceptance criterion. `;
      } else {
        narrative += `The ADLM recommends an internal precision goal of ±${adlmPct}% for enhanced quality assurance. `;
      }
      if (isAdvanced && levels[0]?.withinRunCV !== undefined) {
        const wrCV = levels[0].withinRunCV?.toFixed(2) ?? "-";
        const bdCV = levels[0].betweenDayCV?.toFixed(2) ?? "-";
        narrative += `ANOVA components show within-run CV of ${wrCV}% and between-day CV of ${bdCV}%, indicating a stable analytical system with consistent day-to-day performance. `;
      }
      narrative += `Manufacturer precision claims are verified. This instrument is performing with acceptable reproducibility. `;
      narrative += `<b>Each precision level was individually evaluated against the ${prAdj} acceptance criterion (${prLabel}) of ${teaStr} ${prAuthority}. All levels satisfied this criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    } else {
      narrative = methodologyNote;
      narrative += `The precision study for ${analyteName} did not meet the ${prAdj} acceptance criterion. The maximum observed CV of ${sf(maxCV, 2)}% exceeds the ${prAdj} precision acceptance criterion of ±${cliaPct}% (${prSource}). `;
      narrative += `<b>Each precision level was individually evaluated against the ${prAdj} acceptance criterion (${prLabel}) of ${teaStr} ${prAuthority}. One or more levels did not satisfy this criterion; see the per-level table for details.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
    }
  }

  return `
  <div style="margin-top:6px;padding:8px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:3px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
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
      <td>${(r as any).customLabel ? escapeHtml(String((r as any).customLabel)) : `L${r.level}`}</td>
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
    ? `Qualitative method comparison meets acceptance criteria: ${sf(pctAgreement, 1)}% agreement (threshold: ≥${passThreshold}%)`
    : `Qualitative method comparison does not meet acceptance criteria: ${sf(pctAgreement, 1)}% agreement (threshold: ≥${passThreshold}%)`;

  const narrative = overallPass
    ? `The qualitative method comparison for ${study.testName} demonstrated ${sf(pctAgreement, 1)}% overall agreement between ${primaryName} and ${compName} across ${totalSamples} samples. Cohen's kappa of ${sf(kappa, 3)} indicates "${kappaInterp}" agreement beyond chance. ${categories.length === 2 ? `Sensitivity was ${sf(sensitivity * 100, 1)}% and specificity was ${sf(specificity * 100, 1)}%. ` : ''}These results meet the acceptance threshold of ≥${passThreshold}% agreement. <b>Final approval and clinical determination must be made by the laboratory director or designee.</b>`
    : `The qualitative method comparison for ${study.testName} showed ${sf(pctAgreement, 1)}% overall agreement between ${primaryName} and ${compName} across ${totalSamples} samples. Cohen's kappa of ${sf(kappa, 3)} indicates "${kappaInterp}" agreement beyond chance. ${categories.length === 2 ? `Sensitivity was ${sf(sensitivity * 100, 1)}% and specificity was ${sf(specificity * 100, 1)}%. ` : ''}These results do not meet the acceptance threshold of ≥${passThreshold}% agreement. <b>Investigation and corrective action are recommended. Final approval and clinical determination must be made by the laboratory director or designee.</b>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Qualitative Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="report-title-sub">Reference: ${abbreviateInstrumentName(primaryName)} | Comparison: ${abbreviateInstrumentName(compName)}</div>

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
    ? `Semi-quantitative method comparison meets acceptance criteria: ${sf(pctWithinOne, 1)}% within \u00B11 grade (threshold: \u2265${passThreshold}%)`
    : `Semi-quantitative method comparison does not meet acceptance criteria: ${sf(pctWithinOne, 1)}% within \u00B11 grade (threshold: \u2265${passThreshold}%)`;

  const narrative = overallPass
    ? `The semi-quantitative method comparison for ${study.testName} demonstrated ${sf(pctExact, 1)}% exact agreement and ${sf(pctWithinOne, 1)}% agreement within \u00B11 grade between ${primaryName} and ${compName} across ${totalSamples} samples. The weighted kappa of ${sf(wKappa, 3)} indicates "${wKappaInterp}" ordinal agreement. The maximum discrepancy observed was ${maxDiscrep} grade${maxDiscrep !== 1 ? 's' : ''}. These results meet the acceptance threshold of \u2265${passThreshold}% within \u00B11 grade. <b>Final approval and clinical determination must be made by the laboratory director or designee.</b>`
    : `The semi-quantitative method comparison for ${study.testName} showed ${sf(pctExact, 1)}% exact agreement and ${sf(pctWithinOne, 1)}% agreement within \u00B11 grade between ${primaryName} and ${compName} across ${totalSamples} samples. The weighted kappa of ${sf(wKappa, 3)} indicates "${wKappaInterp}" ordinal agreement. The maximum discrepancy was ${maxDiscrep} grade${maxDiscrep !== 1 ? 's' : ''}. These results do not meet the acceptance threshold of \u2265${passThreshold}% within \u00B11 grade. <b>Investigation and corrective action are recommended. Final approval and clinical determination must be made by the laboratory director or designee.</b>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Semi-Quantitative Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="report-title-sub">Reference: ${abbreviateInstrumentName(primaryName)} | Comparison: ${abbreviateInstrumentName(compName)} | Scale: ${gradeScale.join(" \u2192 ")}</div>

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

  // ── TEa criterion extraction for per-sample detail columns ──
  const _isAbsTea = isAbsoluteTea(study);
  const _absFloor = (study as any).cliaAbsoluteFloor ?? (study as any).clia_absolute_floor ?? null;
  const _absUnit  = (study as any).cliaAbsoluteUnit ?? (study as any).clia_absolute_unit ?? '';
  // Determine which criteria apply:
  //   pure-absolute (teaIsPercentage=0, no absFloor): only absolute, no %
  //   pure-percentage (teaIsPercentage=1, no absFloor): only %, no absolute
  //   dual-criterion (teaIsPercentage=1, absFloor set): both % and absolute ("greater of")
  const hasPctCriterion = !_isAbsTea;
  const hasAbsCriterion = _isAbsTea || (_absFloor != null);
  const teaPctDisplay = hasPctCriterion ? `\u00B1${(study.cliaAllowableError * 100).toFixed(1)}%` : '-';
  const teaAbsDisplay = hasAbsCriterion
    ? (_isAbsTea
        ? `\u00B1${study.cliaAllowableError} ${((study as any).teaUnit || (study as any).tea_unit || '').trim()}`
        : `\u00B1${_absFloor} ${_absUnit}`.trim())
    : '-';
  // Numeric thresholds for per-row evaluation
  const teaPctThreshold = hasPctCriterion ? study.cliaAllowableError * 100 : null;   // e.g. 15.0
  const teaAbsThreshold = hasAbsCriterion
    ? (_isAbsTea ? study.cliaAllowableError : _absFloor as number)
    : null;

  // Styling constants for sub-criterion indicator cells
  const SUB_PASS_COLOR  = '#437A22';
  const SUB_PASS_BG     = '#E8F0E1';
  const SUB_NA_COLOR    = '#7A7974';

  // Level-by-level table
  const instrHeaders = comparisonNames.flatMap(n => [
    `<th class="text-right" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n}</th>`,
    `<th class="text-right">Bias</th>`,
    `<th class="text-right">% Diff</th>`,
    `<th class="text-center">TEa %</th>`,
    `<th class="text-center">TEa abs</th>`,
    `<th class="text-center">% Met</th>`,
    `<th class="text-center">Abs Met</th>`,
    `<th class="text-right">Pass?</th>`,
  ]).join("");

  const levelRows = levelResults.map((r, ri) => {
    const instrCells = comparisonNames.flatMap(n => {
      const v = r.instruments[n];
      if (!v) return [`<td>---</td>`, `<td>---</td>`, `<td>---</td>`, `<td class="text-center">-</td>`, `<td class="text-center">-</td>`, `<td class="text-center">-</td>`, `<td class="text-center">-</td>`, `<td>---</td>`];
      const pfClass = v.passFail === "Pass" ? "pass" : "fail";

      // Per-row sub-criterion evaluation
      const pctMet = teaPctThreshold != null ? Math.abs(v.pctDifference) <= teaPctThreshold : null;
      const absMet = teaAbsThreshold != null ? Math.abs(v.difference) <= teaAbsThreshold : null;

      const pctMetCell = pctMet === null
        ? `<td class="text-center" style="color:${SUB_NA_COLOR}">-</td>`
        : pctMet
          ? `<td class="text-center" style="color:${SUB_PASS_COLOR};background:${SUB_PASS_BG};font-weight:600">${iconCheck()}</td>`
          : `<td class="text-center" style="color:${SUB_NA_COLOR}">${iconCross()}</td>`;
      const absMetCell = absMet === null
        ? `<td class="text-center" style="color:${SUB_NA_COLOR}">-</td>`
        : absMet
          ? `<td class="text-center" style="color:${SUB_PASS_COLOR};background:${SUB_PASS_BG};font-weight:600">${iconCheck()}</td>`
          : `<td class="text-center" style="color:${SUB_NA_COLOR}">${iconCross()}</td>`;

      return [
        `<td class="text-right">${sf(v.value, 3)}</td>`,
        `<td class="text-right">${sf(v.difference, 3)}</td>`,
        `<td class="text-right">${sf(v.pctDifference, 2)}%</td>`,
        `<td class="text-center" style="color:${SUB_NA_COLOR};font-size:7pt">${teaPctDisplay}</td>`,
        `<td class="text-center" style="color:${SUB_NA_COLOR};font-size:7pt">${teaAbsDisplay}</td>`,
        pctMetCell,
        absMetCell,
        `<td class="text-right ${pfClass}">${v.passFail}</td>`,
      ];
    }).join("");
    return `<tr class="${ri % 2 === 1 ? "stripe" : ""}">
      <td>${(r as any).customLabel ? escapeHtml(String((r as any).customLabel)) : `S${r.level}`}</td>
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
  const p1CorrSvg = scatterSVG(p1xVals, p1yVals.length ? p1yVals : p1xVals, `${abbreviateInstrumentName(primaryName)} (Primary)`, abbreviateInstrumentName(firstCompName), `${abbreviateInstrumentName(firstCompName)} vs. ${abbreviateInstrumentName(primaryName)}`, true);
  const p1avgs = levelResults.filter(r => r.instruments?.[firstCompName]).map(r => (r.referenceValue + r.instruments[firstCompName].value) / 2);
  const p1pctDiffs = levelResults.filter(r => r.instruments?.[firstCompName]).map(r => r.instruments[firstCompName].pctDifference);
  const p1BaSvg = blandAltmanSVG(p1avgs, p1pctDiffs, study.cliaAllowableError, firstBAEntry?.pctMeanDiff ?? 0, firstCompName);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Correlation / Method Comparison - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <div class="report-title-sub">Primary: ${abbreviateInstrumentName(primaryName)} | Comparison: ${comparisonNames.map(abbreviateInstrumentName).join(", ")}</div>

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

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    ${comparisonSections}

    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Sample-by-Sample Comparison Results</div>
    <table style="font-size:7pt">
      <thead><tr>
        <th>Sample</th><th class="text-right" style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${primaryName} (Primary)</th>${instrHeaders}
      </tr></thead>
      <tbody>${levelRows}</tbody>
    </table>
    ${evalHTML(results.summary, results.overallPass, results.passCount, results.totalCount, study.cliaAllowableError, study)}
  </div>

  ${supportingPageHTML(study, allInstrumentNames)}
  </body></html>`;
}

// ─── PRECISION HTML report ───────────────────────────────────────────────────
export function buildPrecisionHTML(study: Study, results: any): string {
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const cliaCV = (study.cliaAllowableError * 100).toFixed(1);
  const isAdvanced = results.mode === "advanced";
  const levelResults = results.levelResults || [];

  // Dual-criterion CLIA §493 PT TEa support for precision
  const _absFloor = (study as any).cliaAbsoluteFloor ?? (study as any).clia_absolute_floor ?? null;
  const _absUnit  = (study as any).cliaAbsoluteUnit ?? (study as any).clia_absolute_unit ?? '';
  const hasDual = _absFloor != null && _absUnit;
  const teaStrFull = teaDisplayStr(study);
  const allowCVHeader = hasDual ? `Allow CV% / Floor` : `Allow CV%`;

  const summaryRows = levelResults.map((r: any, i: number) => {
    const pfClass = r.passFail === "Pass" ? "pass" : "fail";
    // For dual-criterion analytes, show both the percent rule and the absolute floor as an SD threshold (k=2)
    const allowCellHTML = hasDual
      ? `±${cliaCV}%<br><span style="color:${MUTED};font-size:7pt">or SD≤${(((_absFloor as number)/2)).toFixed(3)} ${_absUnit}</span>`
      : `±${cliaCV}%`;
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${r.levelName}</td>
      <td class="text-right">${r.n}</td>
      <td class="text-right">${sf(r.mean, 3)}</td>
      <td class="text-right">${sf(r.sd, 3)}</td>
      <td class="text-right">${sf(r.cv, 2)}%</td>
      <td class="text-right">${allowCellHTML}</td>
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

  // ─── Phase 2 parity: CIs, 2 SD range, vendor verdict, plots ────────────────
  const studyAny = study as any;
  const studyVendorSD = studyAny.vendorSd ?? studyAny.vendor_sd ?? results.vendorSD ?? null;
  const studyTargetMean = studyAny.targetMean ?? studyAny.target_mean ?? results.targetMean ?? null;
  const hasParityFields = levelResults.some((r: any) =>
    r.sdCiLower != null || r.meanCiLower != null || r.twoSDRangeLower != null
    || r.vendorVerdict != null || r.bias != null,
  );
  // Render the new statistical detail table only when the calculator has
  // populated parity fields (n >= 2). For legacy studies that pre-date the
  // Phase 1 backfill the levelResults won't carry these fields and the
  // section stays hidden, matching prior behavior.
  const ciSection = hasParityFields ? `
    <hr class="divider" style="margin-top:8px">
    <div class="section-label">Confidence Intervals and Distribution</div>
    <table>
      <thead><tr>
        <th>Level</th>
        <th class="text-right">95% CI for SD</th>
        <th class="text-right">95% CI for Mean</th>
        <th class="text-right">Obs 2 SD Range</th>
        ${studyTargetMean != null ? `<th class="text-right">Bias</th><th class="text-right">% Bias</th>` : ``}
        ${studyVendorSD != null ? `<th class="text-right">Vendor SD Goal</th><th class="text-right">Vendor Verdict</th>` : ``}
      </tr></thead>
      <tbody>${levelResults.map((r: any, i: number) => {
        const ciSD = (r.sdCiLower != null && r.sdCiUpper != null)
          ? `${sf(r.sdCiLower, 3)} to ${sf(r.sdCiUpper, 3)}` : "-";
        const ciMean = (r.meanCiLower != null && r.meanCiUpper != null)
          ? `${sf(r.meanCiLower, 3)} to ${sf(r.meanCiUpper, 3)}` : "-";
        const twoSD = (r.twoSDRangeLower != null && r.twoSDRangeUpper != null)
          ? `${sf(r.twoSDRangeLower, 3)} to ${sf(r.twoSDRangeUpper, 3)}` : "-";
        const biasCol = studyTargetMean != null
          ? `<td class="text-right">${r.bias != null ? sf(r.bias, 3) : "-"}</td>
             <td class="text-right">${r.percentBias != null ? sf(r.percentBias, 2) + "%" : "-"}</td>` : ``;
        let vendorCols = ``;
        if (studyVendorSD != null) {
          const verdict = r.vendorVerdict ?? "-";
          const vColor = verdict === "Pass" ? "#437A22" : verdict === "Fail" ? "#A12C7B" : verdict === "Uncertain" ? "#964219" : MUTED;
          vendorCols = `<td class="text-right">${sf(studyVendorSD, 3)}</td>
            <td class="text-right" style="color:${vColor};font-weight:700">${verdict}</td>`;
        }
        return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
          <td>${r.levelName}</td>
          <td class="text-right">${ciSD}</td>
          <td class="text-right">${ciMean}</td>
          <td class="text-right">${twoSD}</td>
          ${biasCol}${vendorCols}
        </tr>`;
      }).join("")}</tbody>
    </table>` : "";

  // Embed Precision Plot + Histogram for the first level (matches EE which
  // emits one of each per Sample / Level report). Both plots are skipped
  // when n < 2 or SD == 0. Target SD derives from target CV when both target
  // mean and target CV are populated; otherwise the Levey-Jennings uses the
  // observed SD as the SDI scaling (matches EE default behavior).
  const studyTargetCV = studyAny.targetCv ?? studyAny.target_cv ?? null;
  const targetSDForPlot = (studyTargetMean != null && studyTargetCV != null && studyTargetCV > 0)
    ? Number(studyTargetMean) * (Number(studyTargetCV) / 100) : null;
  const firstLevel = levelResults[0];
  const firstValues: number[] = (dataPoints[0]?.values || [])
    .filter((v: any) => v != null && !isNaN(v));
  // Vendor-SD verdict bar: at-a-glance graphic showing observed SD with 95% CI
  // fences against the vendor goal. Conditional — only when vendor SD set.
  // Derive a display unit from teaUnit when it's an actual measurement unit
  // (not "%"); fall back to empty string. Same units shown on the Goal label.
  const vendorVerdictForBar = firstLevel?.vendorVerdict as ("Pass" | "Fail" | "Uncertain" | undefined);
  const vendorSDForBar = studyAny.vendorSd ?? studyAny.vendor_sd ?? null;
  const rawTeaUnit = (study as any).teaUnit ?? (study as any).tea_unit ?? "";
  const unitForBar = rawTeaUnit && rawTeaUnit !== "%" ? rawTeaUnit : "";
  const vendorBarSVG = (firstLevel && vendorSDForBar != null && vendorSDForBar > 0 && vendorVerdictForBar)
    ? vendorSDBarSVG(
        firstLevel.sd,
        firstLevel.sdCiLower ?? null,
        firstLevel.sdCiUpper ?? null,
        Number(vendorSDForBar),
        vendorVerdictForBar,
        unitForBar,
      )
    : "";

  const plotsSection = firstLevel && firstValues.length >= 2 && firstLevel.sd > 0 ? `
    <hr class="divider" style="margin-top:8px">
    <div class="section-label">${vendorBarSVG ? "Precision Plot, Histogram, and Vendor SD Verdict" : "Precision Plot and Histogram"}</div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:4px;flex-wrap:wrap">
      <div>${precisionPlotSVG(firstValues, firstLevel.mean, firstLevel.sd, studyTargetMean, targetSDForPlot ?? (studyTargetMean != null ? firstLevel.sd : null))}</div>
      <div>${histogramSVG(firstValues, firstLevel.mean, firstLevel.sd, studyTargetMean)}</div>
      ${vendorBarSVG ? `<div>${vendorBarSVG}</div>` : ""}
    </div>` : "";

  // Compact key stats for page 1
  const precMean = levelResults.length > 0 ? sf(levelResults[0].mean, 3) : "---";
  const precSD = levelResults.length > 0 ? sf(levelResults[0].sd, 3) : "---";
  const precMaxCV = levelResults.length > 0 ? sf(Math.max(...levelResults.map((r: any) => r.cv ?? 0)), 2) + "%" : "---";
  const precPassCount = `${results.passCount}/${results.totalCount}`;
  // Phase 2 parity: optional rows that appear on page 1 only when the
  // calculator has populated the corresponding fields.
  const precL0 = levelResults[0] || {};
  const precCiMeanStr = (precL0.meanCiLower != null && precL0.meanCiUpper != null)
    ? `${sf(precL0.meanCiLower, 3)} to ${sf(precL0.meanCiUpper, 3)}` : null;
  const precCiSdStr = (precL0.sdCiLower != null && precL0.sdCiUpper != null)
    ? `${sf(precL0.sdCiLower, 3)} to ${sf(precL0.sdCiUpper, 3)}` : null;
  const precTwoSDStr = (precL0.twoSDRangeLower != null && precL0.twoSDRangeUpper != null)
    ? `${sf(precL0.twoSDRangeLower, 3)} to ${sf(precL0.twoSDRangeUpper, 3)}` : null;
  const precVendorVerdict = precL0.vendorVerdict ?? null;
  const precVendorColor = precVendorVerdict === "Pass" ? "#437A22"
    : precVendorVerdict === "Fail" ? "#A12C7B"
    : precVendorVerdict === "Uncertain" ? "#964219" : MUTED;
  const precVendorSDVal = studyAny.vendorSd ?? studyAny.vendor_sd ?? null;
  const precTargetMeanVal = studyAny.targetMean ?? studyAny.target_mean ?? null;
  const precBiasStr = (precL0.bias != null && precL0.percentBias != null)
    ? `${sf(precL0.bias, 3)} (${sf(precL0.percentBias, 2)}%)` : null;
  const ciAndDistRows = (precCiMeanStr || precCiSdStr || precTwoSDStr) ? `
      <tr><td style="color:${MUTED};font-weight:700">95% CI for Mean</td><td>${precCiMeanStr ?? "-"}</td>
          <td style="color:${MUTED};font-weight:700">95% CI for SD</td><td>${precCiSdStr ?? "-"}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Obs 2 SD Range</td><td>${precTwoSDStr ?? "-"}</td>
          <td style="color:${MUTED};font-weight:700">N</td><td>${precL0.n ?? "-"}</td></tr>` : ``;
  const vendorRow = precVendorSDVal != null ? `
      <tr><td style="color:${MUTED};font-weight:700">Vendor SD Goal</td><td>${sf(precVendorSDVal, 3)}</td>
          <td style="color:${MUTED};font-weight:700">Vendor Verdict</td>
          <td style="color:${precVendorColor};font-weight:700">${precVendorVerdict ?? "-"}</td></tr>` : ``;
  const targetRow = precTargetMeanVal != null ? `
      <tr><td style="color:${MUTED};font-weight:700">Target Mean</td><td>${sf(precTargetMeanVal, 3)}</td>
          <td style="color:${MUTED};font-weight:700">Bias (% Bias)</td><td>${precBiasStr ?? "-"}</td></tr>` : ``;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Precision Verification (EP15) - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}

  <hr class="divider">
  <div class="section-label">Key Statistics Summary</div>
  <table style="font-size:8pt;margin-bottom:6px">
    <tbody>
      <tr><td style="color:${MUTED};font-weight:700;width:25%">Mean</td><td style="width:25%">${precMean}</td>
          <td style="color:${MUTED};font-weight:700;width:25%">SD</td><td style="width:25%">${precSD}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">CV%</td><td>${precMaxCV}</td>
          <td style="color:${MUTED};font-weight:700">Allowable TEa</td><td>${teaStrFull}</td></tr>
      <tr><td style="color:${MUTED};font-weight:700">Points Passing</td><td>${precPassCount}</td>
          <td style="color:${MUTED};font-weight:700">Overall</td><td class="${results.overallPass ? "pass" : "fail"}">${results.overallPass ? "PASS" : "FAIL"}</td></tr>
      ${ciAndDistRows}
      ${vendorRow}
      ${targetRow}
    </tbody>
  </table>

  ${narrativeHTML("precision", results, study.cliaAllowableError, study.testName, study)}

  ${regulatoryComplianceBoxHTML(study.studyType, (study as any)._preferredStandards)}

  ${directorReviewHTML()}

  <div class="stats-section">
    <div class="section-label">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    <div class="section-label" style="margin-top:8px">Precision Summary</div>
    <table>
      <thead><tr>
        <th>Level</th><th class="text-right">N</th><th class="text-right">Mean</th>
        <th class="text-right">SD</th><th class="text-right">CV%</th>
        <th class="text-right">${allowCVHeader}</th><th class="text-right">Pass?</th>
      </tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>

    ${anovaSection}

    ${ciSection}

    ${plotsSection}

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

// CLSI EP15-A3 § 6 Accuracy / Bias verification PDF builder.
// Results shape (computed client-side from data_points {analyte, units, levels}):
//   { type: "accuracy_bias", analyte, units,
//     levels: [{ name, assignedValue, mean, sd, pctRecovery, absBias, pass }],
//     maxPctRecovery, minPctRecovery, overallPass, passCount, totalCount, summary }
function buildAccuracyBiasHTML(study: Study, results: any): string {
  const analyte = results.analyte || study.testName;
  const units = results.units || "";
  // Shape produced by StudyResultsPage compute branch and VeritaCheckPage
  // handleSubmit: per level we get name / assigned_value / n / mean / sd /
  // pctRecovery / absBiasPct / absBias / allowance / verdict.
  const levels = (results.levels || []) as Array<{
    name: string;
    assigned_value: number | null;
    n: number;
    mean: number | null;
    sd: number | null;
    pctRecovery: number | null;
    absBiasPct: number | null;
    absBias: number | null;
    allowance: number | null;
    verdict: "pass" | "fail" | "incomplete";
  }>;
  const overallPass = !!results.overallPass;
  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass ? "Meets CLSI EP15-A3 criteria" : "Does not meet CLSI EP15-A3 criteria";

  const cliaStatement = overallPass
    ? `<b>The Accuracy / Bias verification for ${analyte} meets the criteria per 42 CFR §493.1253(b)(1)(i) and CLSI EP15-A3 § 6.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The Accuracy / Bias verification for ${analyte} does not meet the criteria per 42 CFR §493.1253(b)(1)(i) and CLSI EP15-A3 § 6.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const teaIsPercentage = results.teaIsPercentage !== false;
  const absFloor: number | null = results.absoluteFloor ?? (study as any).cliaAbsoluteFloor ?? null;
  const absUnit: string = results.absoluteUnit || (study as any).cliaAbsoluteUnit || "";
  const teaRaw = study.cliaAllowableError ?? 0;
  const teaPctTxt = teaIsPercentage
    ? `±${(teaRaw * 100).toFixed(1)}%${absFloor ? ` or ±${absFloor} ${absUnit}` : ""}`
    : `±${teaRaw} ${absUnit}`;

  const recoveries = levels.map(l => l.pctRecovery).filter((v): v is number => v !== null && !isNaN(v));
  const maxRecovery = recoveries.length ? Math.max(...recoveries) : 0;
  const minRecovery = recoveries.length ? Math.min(...recoveries) : 0;

  const dataRows = levels.map((l, i) => {
    const pfClass = l.verdict === "pass" ? "pass" : l.verdict === "fail" ? "fail" : "";
    const verdictLabel = l.verdict === "pass" ? "Pass" : l.verdict === "fail" ? "Fail" : "Incomplete";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${l.name || `L${i + 1}`}</td>
      <td class="text-right">${l.assigned_value === null ? "-" : sf(l.assigned_value, 3)}</td>
      <td class="text-right">${l.mean === null ? "-" : sf(l.mean, 3)}</td>
      <td class="text-right">${l.sd === null ? "-" : sf(l.sd, 4)}</td>
      <td class="text-right">${l.pctRecovery === null ? "-" : sf(l.pctRecovery, 2) + "%"}</td>
      <td class="text-right">${l.absBiasPct === null ? "-" : sf(l.absBiasPct, 2) + "%"}</td>
      <td class="text-right ${pfClass}">${verdictLabel}</td>
    </tr>`;
  }).join("");

  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Levels</div><div class="stat-value">${levels.length}</div></div>
      <div class="stat-item"><div class="stat-label">Max % Recovery</div><div class="stat-value">${sf(maxRecovery, 2)}%</div></div>
      <div class="stat-item"><div class="stat-label">Min % Recovery</div><div class="stat-value">${sf(minRecovery, 2)}%</div></div>
      <div class="stat-item"><div class="stat-label">CLIA TEa</div><div class="stat-value">${teaPctTxt}${(study as any).cliaPresetLabel ? ` (${(study as any).cliaPresetLabel})` : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary || ""} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck™ - Accuracy / Bias Verification - ${study.testName}</title><style>${CSS}</style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="verdict-banner ${passClass}">${overallPass ? "✔" : "✘"} ${verdictText}</div>
  ${summaryStats}
  ${narrative}
  ${regulatoryComplianceBoxHTML("accuracy_bias", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  <div class="page-break"></div>
  <div class="section-heading">Per-Level Accuracy / Bias Results</div>
  <p style="font-size:8pt;color:#666;margin:0 0 8px;">EP15-A3 § 6: bias estimation by comparison of mean measured value to the assigned reference value. Pass criterion: |observed bias| ≤ stated allowable error (TEa).</p>
  <table>
    <thead><tr>
      <th>Level</th>
      <th class="text-right">Assigned${units ? " (" + units + ")" : ""}</th>
      <th class="text-right">Mean</th>
      <th class="text-right">SD</th>
      <th class="text-right">% Recovery</th>
      <th class="text-right">|Bias|</th>
      <th class="text-right">Verdict</th>
    </tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </body></html>`;
}

// CLSI EP06 verification: linearity of the analytical measurement range via
// OLS regression of per-level measured-mean vs assigned target. Results shape
// matches what StudyResultsPage computes + handleSubmit persists. Acceptance:
// |slope - 1| * 100 <= TEa% AND r^2 >= 0.95.
// ─── SVG chart helpers (shared by linearity / reportable_range) ─────────────
// Self-contained inline SVG so the same string renders identically in the
// browser (StudyResultsPage) and in Puppeteer-generated PDFs. All sizing,
// colors, and line weights are inline so no external CSS dependency.
// 700x440 viewBox; 70/20/40/60 left/right/top/bottom padding.

interface ChartPoint { x: number; y: number; verdict: "pass" | "fail" | "incomplete"; name: string }

function pointColor(v: "pass" | "fail" | "incomplete"): string {
  return v === "pass" ? "#437A22" : v === "fail" ? "#A12C7B" : "#7A7974";
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!isFinite(min) || !isFinite(max) || max === min) return [min];
  const step = (max - min) / count;
  return Array.from({ length: count + 1 }, (_, i) => min + step * i);
}

function fmtTick(v: number): string {
  if (!isFinite(v)) return "";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function linearityChartSVG(
  points: ChartPoint[],
  slope: number,
  intercept: number,
  r2: number,
  units: string,
): string {
  if (points.length === 0) return "";
  const padL = 70, padR = 20, padT = 40, padB = 60;
  const W = 700, H = 440;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys, xMin), yMax = Math.max(...ys, xMax);
  // 5% padding around data so points aren't on the axis
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const xLo = xMin - xRange * 0.05, xHi = xMax + xRange * 0.05;
  const yLo = yMin - yRange * 0.05, yHi = yMax + yRange * 0.05;
  const sx = (x: number) => padL + ((x - xLo) / (xHi - xLo)) * plotW;
  const sy = (y: number) => padT + plotH - ((y - yLo) / (yHi - yLo)) * plotH;

  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(yLo, yHi, 5);

  const xAxis = `
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#28251D" stroke-width="1"/>
    ${xTicks.map(t => `<line x1="${sx(t)}" y1="${padT + plotH}" x2="${sx(t)}" y2="${padT + plotH + 4}" stroke="#28251D" stroke-width="1"/><text x="${sx(t)}" y="${padT + plotH + 18}" text-anchor="middle" font-size="10" fill="#28251D" font-family="Arial">${fmtTick(t)}</text>`).join("")}
    <text x="${padL + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#28251D" font-family="Arial" font-weight="600">Assigned${units ? " (" + units + ")" : ""}</text>
  `;
  const yAxis = `
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#28251D" stroke-width="1"/>
    ${yTicks.map(t => `<line x1="${padL - 4}" y1="${sy(t)}" x2="${padL}" y2="${sy(t)}" stroke="#28251D" stroke-width="1"/><text x="${padL - 8}" y="${sy(t) + 3}" text-anchor="end" font-size="10" fill="#28251D" font-family="Arial">${fmtTick(t)}</text>`).join("")}
    <text x="20" y="${padT + plotH / 2}" text-anchor="middle" font-size="11" fill="#28251D" font-family="Arial" font-weight="600" transform="rotate(-90, 20, ${padT + plotH / 2})">Measured Mean${units ? " (" + units + ")" : ""}</text>
  `;
  // Identity line y=x clipped to plot area
  const identityXa = Math.max(xLo, yLo);
  const identityXb = Math.min(xHi, yHi);
  const identityLine = identityXa < identityXb
    ? `<line x1="${sx(identityXa)}" y1="${sy(identityXa)}" x2="${sx(identityXb)}" y2="${sy(identityXb)}" stroke="#7A7974" stroke-width="1.2" stroke-dasharray="4,3"/>`
    : "";
  // Regression line y = slope * x + intercept, clipped to plot area
  const regYa = slope * xLo + intercept;
  const regYb = slope * xHi + intercept;
  const regLine = `<line x1="${sx(xLo)}" y1="${sy(regYa)}" x2="${sx(xHi)}" y2="${sy(regYb)}" stroke="#01696F" stroke-width="2"/>`;

  const dots = points.map(p =>
    `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" fill="${pointColor(p.verdict)}" stroke="#28251D" stroke-width="1"/>
     <title>${p.name}: assigned ${p.x.toFixed(2)}, measured ${p.y.toFixed(2)}</title>`
  ).join("");

  const legend = `
    <g transform="translate(${padL + plotW - 180}, ${padT + 8})">
      <rect x="0" y="0" width="170" height="64" fill="white" fill-opacity="0.9" stroke="#D4D1CA" stroke-width="1" rx="3"/>
      <line x1="8" y1="14" x2="28" y2="14" stroke="#01696F" stroke-width="2"/><text x="34" y="17" font-size="10" font-family="Arial" fill="#28251D">Regression line</text>
      <line x1="8" y1="30" x2="28" y2="30" stroke="#7A7974" stroke-width="1.2" stroke-dasharray="4,3"/><text x="34" y="33" font-size="10" font-family="Arial" fill="#28251D">Identity (y = x)</text>
      <text x="8" y="50" font-size="10" font-family="Arial" fill="#28251D">Slope: ${slope.toFixed(4)}, r²: ${r2.toFixed(4)}</text>
    </g>
  `;

  return `
    <div style="margin:14px 0;page-break-inside:avoid;">
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:700px;display:block;">
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#FAFAF8" stroke="#D4D1CA" stroke-width="1"/>
        ${xAxis}
        ${yAxis}
        ${identityLine}
        ${regLine}
        ${dots}
        ${legend}
      </svg>
    </div>`;
}

function reportableRangeChartSVG(
  points: ChartPoint[],
  teaIsPercentage: boolean,
  tea: number,
  absoluteFloor: number | null,
  absoluteUnit: string,
  claimedLow: number | null,
  claimedHigh: number | null,
  units: string,
): string {
  if (points.length === 0) return "";
  const padL = 70, padR = 20, padT = 40, padB = 60;
  const W = 700, H = 440;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  // Extend bounds to include claimed range so the vertical markers always land in-frame
  const allX = [...xs, ...(claimedLow !== null ? [claimedLow] : []), ...(claimedHigh !== null ? [claimedHigh] : [])];
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...ys, xMin), yMax = Math.max(...ys, xMax);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  const xLo = xMin - xRange * 0.05, xHi = xMax + xRange * 0.05;
  const yLo = yMin - yRange * 0.05, yHi = yMax + yRange * 0.05;
  const sx = (x: number) => padL + ((x - xLo) / (xHi - xLo)) * plotW;
  const sy = (y: number) => padT + plotH - ((y - yLo) / (yHi - yLo)) * plotH;

  // TEa band around y=x. At each x, the allowed y is x ± max(pctAllowance, absFloor).
  // Render as a polygon: upper edge first, lower edge reversed.
  const bandX = niceTicks(Math.max(xLo, 0), xHi, 20);
  const upperPts: string[] = [];
  const lowerPts: string[] = [];
  for (const x of bandX) {
    const pctAllow = teaIsPercentage ? Math.abs(x) * tea : 0;
    const absAllow = teaIsPercentage ? (absoluteFloor ?? 0) : tea;
    const allow = Math.max(pctAllow, absAllow);
    upperPts.push(`${sx(x)},${sy(x + allow)}`);
    lowerPts.unshift(`${sx(x)},${sy(x - allow)}`);
  }
  const band = `<polygon points="${upperPts.join(" ")} ${lowerPts.join(" ")}" fill="#01696F" fill-opacity="0.10" stroke="none"/>`;

  // Identity line y=x
  const identityXa = Math.max(xLo, yLo);
  const identityXb = Math.min(xHi, yHi);
  const identityLine = identityXa < identityXb
    ? `<line x1="${sx(identityXa)}" y1="${sy(identityXa)}" x2="${sx(identityXb)}" y2="${sy(identityXb)}" stroke="#01696F" stroke-width="1.5" stroke-dasharray="4,3"/>`
    : "";

  // Vertical claimed-range markers
  const clMarker = claimedLow !== null
    ? `<line x1="${sx(claimedLow)}" y1="${padT}" x2="${sx(claimedLow)}" y2="${padT + plotH}" stroke="#964219" stroke-width="1.2" stroke-dasharray="2,3"/>
       <text x="${sx(claimedLow)}" y="${padT - 6}" text-anchor="middle" font-size="9" fill="#964219" font-family="Arial">Claimed Low: ${claimedLow}</text>`
    : "";
  const chMarker = claimedHigh !== null
    ? `<line x1="${sx(claimedHigh)}" y1="${padT}" x2="${sx(claimedHigh)}" y2="${padT + plotH}" stroke="#964219" stroke-width="1.2" stroke-dasharray="2,3"/>
       <text x="${sx(claimedHigh)}" y="${padT - 6}" text-anchor="middle" font-size="9" fill="#964219" font-family="Arial">Claimed High: ${claimedHigh}</text>`
    : "";

  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(yLo, yHi, 5);
  const xAxis = `
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#28251D" stroke-width="1"/>
    ${xTicks.map(t => `<line x1="${sx(t)}" y1="${padT + plotH}" x2="${sx(t)}" y2="${padT + plotH + 4}" stroke="#28251D" stroke-width="1"/><text x="${sx(t)}" y="${padT + plotH + 18}" text-anchor="middle" font-size="10" fill="#28251D" font-family="Arial">${fmtTick(t)}</text>`).join("")}
    <text x="${padL + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#28251D" font-family="Arial" font-weight="600">Assigned${units ? " (" + units + ")" : ""}</text>
  `;
  const yAxis = `
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#28251D" stroke-width="1"/>
    ${yTicks.map(t => `<line x1="${padL - 4}" y1="${sy(t)}" x2="${padL}" y2="${sy(t)}" stroke="#28251D" stroke-width="1"/><text x="${padL - 8}" y="${sy(t) + 3}" text-anchor="end" font-size="10" fill="#28251D" font-family="Arial">${fmtTick(t)}</text>`).join("")}
    <text x="20" y="${padT + plotH / 2}" text-anchor="middle" font-size="11" fill="#28251D" font-family="Arial" font-weight="600" transform="rotate(-90, 20, ${padT + plotH / 2})">Measured Mean${units ? " (" + units + ")" : ""}</text>
  `;

  const dots = points.map(p =>
    `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="5" fill="${pointColor(p.verdict)}" stroke="#28251D" stroke-width="1"/>
     <title>${p.name}: assigned ${p.x.toFixed(2)}, measured ${p.y.toFixed(2)}</title>`
  ).join("");

  const teaLabel = teaIsPercentage
    ? `±${(tea * 100).toFixed(1)}%${absoluteFloor ? ` or ±${absoluteFloor} ${absoluteUnit}` : ""}`
    : `±${tea} ${absoluteUnit}`;
  const legend = `
    <g transform="translate(${padL + plotW - 190}, ${padT + 8})">
      <rect x="0" y="0" width="180" height="62" fill="white" fill-opacity="0.92" stroke="#D4D1CA" stroke-width="1" rx="3"/>
      <rect x="8" y="6" width="20" height="10" fill="#01696F" fill-opacity="0.10" stroke="#01696F" stroke-width="0.5"/><text x="34" y="15" font-size="10" font-family="Arial" fill="#28251D">TEa band: ${teaLabel}</text>
      <line x1="8" y1="30" x2="28" y2="30" stroke="#964219" stroke-width="1.2" stroke-dasharray="2,3"/><text x="34" y="33" font-size="10" font-family="Arial" fill="#28251D">Claimed range</text>
      <line x1="8" y1="46" x2="28" y2="46" stroke="#01696F" stroke-width="1.5" stroke-dasharray="4,3"/><text x="34" y="49" font-size="10" font-family="Arial" fill="#28251D">Identity (y = x)</text>
    </g>
  `;

  return `
    <div style="margin:14px 0;page-break-inside:avoid;">
      <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:700px;display:block;">
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="#FAFAF8" stroke="#D4D1CA" stroke-width="1"/>
        ${band}
        ${xAxis}
        ${yAxis}
        ${identityLine}
        ${clMarker}
        ${chMarker}
        ${dots}
        ${legend}
      </svg>
    </div>`;
}

function buildLinearityHTML(study: Study, results: any): string {
  const analyte = results.analyte || study.testName;
  const units = results.units || "";
  const levels = (results.levels || []) as Array<{
    name: string;
    assigned_value: number | null;
    n: number;
    mean: number | null;
    sd: number | null;
    pctRecovery: number | null;
    verdict: "pass" | "fail" | "incomplete";
  }>;
  const overallPass = !!results.overallPass;
  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass ? "Meets CLSI EP06 criteria" : "Does not meet CLSI EP06 criteria";

  const cliaStatement = overallPass
    ? `<b>The Linearity verification for ${analyte} meets the criteria per 42 CFR §493.1253(b)(1)(ii) and CLSI EP06.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The Linearity verification for ${analyte} does not meet the criteria per 42 CFR §493.1253(b)(1)(ii) and CLSI EP06.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const slope = Number(results.slope ?? 0);
  const intercept = Number(results.intercept ?? 0);
  const r2 = Number(results.r2 ?? 0);
  const slopeBiasPct = Number(results.slopeBiasPct ?? 0);
  const teaIsPercentage = results.teaIsPercentage !== false;
  const teaRaw = study.cliaAllowableError ?? 0;
  const teaPctTxt = teaIsPercentage ? `${(teaRaw * 100).toFixed(1)}%` : `${teaRaw} ${units}`;

  const dataRows = levels.map((l, i) => {
    const pfClass = l.verdict === "pass" ? "pass" : l.verdict === "fail" ? "fail" : "";
    const verdictLabel = l.verdict === "pass" ? "Pass" : l.verdict === "fail" ? "Fail" : "Incomplete";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${l.name || `L${i + 1}`}</td>
      <td class="text-right">${l.assigned_value === null ? "-" : sf(l.assigned_value, 3)}</td>
      <td class="text-right">${l.n}</td>
      <td class="text-right">${l.mean === null ? "-" : sf(l.mean, 3)}</td>
      <td class="text-right">${l.sd === null ? "-" : sf(l.sd, 4)}</td>
      <td class="text-right">${l.pctRecovery === null ? "-" : sf(l.pctRecovery, 2) + "%"}</td>
      <td class="text-right ${pfClass}">${verdictLabel}</td>
    </tr>`;
  }).join("");

  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Levels</div><div class="stat-value">${levels.length}</div></div>
      <div class="stat-item"><div class="stat-label">Slope</div><div class="stat-value">${sf(slope, 4)}</div></div>
      <div class="stat-item"><div class="stat-label">Intercept</div><div class="stat-value">${sf(intercept, 3)}</div></div>
      <div class="stat-item"><div class="stat-label">r²</div><div class="stat-value">${sf(r2, 4)}</div></div>
      <div class="stat-item"><div class="stat-label">|Slope - 1|</div><div class="stat-value">${sf(slopeBiasPct, 2)}%</div></div>
      <div class="stat-item"><div class="stat-label">CLIA TEa</div><div class="stat-value">±${teaPctTxt}${(study as any).cliaPresetLabel ? ` (${(study as any).cliaPresetLabel})` : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  // Coverage Summary block (informational, only when claimed AMR provided).
  // Surfaces verified range vs claimed AMR plus the unverified gap so the
  // director's adjudication on coverage adequacy is visible on the signed
  // page. Per 42 CFR §493.1255 + CLSI EP06: CLIA does not impose a numerical
  // coverage threshold; the lab may report to a narrower verified range
  // than the manufacturer's claim with director sign-off.
  const cov = (results as any).coverage;
  let coverageBlock = "";
  if (cov && typeof cov === "object"
      && Number.isFinite(cov.claimed_low) && Number.isFinite(cov.claimed_high)
      && Number.isFinite(cov.verified_low) && Number.isFinite(cov.verified_high)) {
    const cLowTxt = sf(cov.claimed_low, 3);
    const cHighTxt = sf(cov.claimed_high, 3);
    const vLowTxt = sf(cov.verified_low, 3);
    const vHighTxt = sf(cov.verified_high, 3);
    const upperGapPct = Number(cov.upper_gap_pct ?? 0);
    const lowerGapPct = Number(cov.lower_gap_pct ?? 0);
    const totalGapPct = upperGapPct + lowerGapPct;
    const gapBadge = totalGapPct <= 0
      ? `<span style="color:#437A22;font-weight:700">Full claimed AMR verified</span>`
      : `<span style="color:#964219;font-weight:700">${sf(totalGapPct, 1)}% of claimed AMR not verified by this study</span>`;
    const gapDetail = totalGapPct <= 0
      ? `The verified range matches or exceeds the manufacturer's claimed AMR. No coverage gap to adjudicate.`
      : `Verified range is ${vLowTxt} to ${vHighTxt} ${units || "units"}; manufacturer's claimed AMR is ${cLowTxt} to ${cHighTxt} ${units || "units"}. Upper unverified portion: ${sf(upperGapPct, 1)}%. Lower unverified portion: ${sf(lowerGapPct, 1)}%. The medical director or designee adjudicates whether the verified range is acceptable for clinical reporting, whether the lab's reportable range should be narrowed to match the verified bounds, or whether a follow-up study with material spanning the gap is needed. CLIA (42 CFR §493.1255) and CLSI EP06 do not impose a numerical coverage threshold; coverage adequacy is a clinical judgment.`;
    coverageBlock = `<div style="margin-top:10px;padding:10px 12px;background:#EBF3F8;border:1px solid #01696F;border-radius:5px;">
      <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Coverage Summary</div>
      <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0 0 4px;">${gapBadge}</p>
      <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${gapDetail}</p>
    </div>`;
  }

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary || ""} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck™ - Linearity Verification - ${study.testName}</title><style>${CSS}</style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="verdict-banner ${passClass}">${overallPass ? "✔" : "✘"} ${verdictText}</div>
  ${summaryStats}
  ${coverageBlock}
  ${narrative}
  ${regulatoryComplianceBoxHTML("linearity", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  <div class="page-break"></div>
  <div class="section-heading">Per-Level Linearity Results</div>
  <p style="font-size:8pt;color:#666;margin:0 0 8px;">EP06: linearity of the analytical measurement range. Acceptance: |slope - 1| × 100 ≤ TEa% AND r² ≥ 0.95. Per-level verdict reflects bias against TEa at the level mean.</p>
  ${linearityChartSVG(
    levels.filter(l => l.assigned_value !== null && l.mean !== null).map(l => ({ x: l.assigned_value as number, y: l.mean as number, verdict: l.verdict, name: l.name })),
    slope,
    intercept,
    r2,
    units,
  )}
  <table>
    <thead><tr>
      <th>Level</th>
      <th class="text-right">Assigned${units ? " (" + units + ")" : ""}</th>
      <th class="text-right">N</th>
      <th class="text-right">Mean</th>
      <th class="text-right">SD</th>
      <th class="text-right">% Recovery</th>
      <th class="text-right">Verdict</th>
    </tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </body></html>`;
}

// Reportable Range / AMR Verification per CLIA 493.1255. Reports the lab's
// declared claimed range alongside per-level recovery/bias. Acceptance is the
// dual-criterion S493 allowance at every level.
function buildReportableRangeHTML(study: Study, results: any): string {
  const analyte = results.analyte || study.testName;
  const units = results.units || "";
  const levels = (results.levels || []) as Array<{
    name: string;
    assigned_value: number | null;
    n: number;
    mean: number | null;
    sd: number | null;
    pctRecovery: number | null;
    absBiasPct: number | null;
    verdict: "pass" | "fail" | "incomplete";
  }>;
  const overallPass = !!results.overallPass;
  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass ? "Meets CLIA §493.1255 criteria" : "Does not meet CLIA §493.1255 criteria";
  const claimedLow = results.claimed_range_low;
  const claimedHigh = results.claimed_range_high;
  const claimedRangeTxt = (claimedLow !== null && claimedLow !== undefined && claimedHigh !== null && claimedHigh !== undefined)
    ? `${claimedLow} to ${claimedHigh}${units ? " " + units : ""}`
    : "Not specified";

  const cliaStatement = overallPass
    ? `<b>The Reportable Range verification for ${analyte} meets the criteria per 42 CFR §493.1255 and verifies the laboratory's claimed analytical measurement range of ${claimedRangeTxt}.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The Reportable Range verification for ${analyte} does not meet the criteria per 42 CFR §493.1255 against the laboratory's claimed analytical measurement range of ${claimedRangeTxt}.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const teaIsPercentage = results.teaIsPercentage !== false;
  const absFloor: number | null = results.absoluteFloor ?? (study as any).cliaAbsoluteFloor ?? null;
  const absUnit: string = results.absoluteUnit || (study as any).cliaAbsoluteUnit || "";
  const teaRaw = study.cliaAllowableError ?? 0;
  const teaPctTxt = teaIsPercentage
    ? `±${(teaRaw * 100).toFixed(1)}%${absFloor ? ` or ±${absFloor} ${absUnit}` : ""}`
    : `±${teaRaw} ${absUnit}`;

  const dataRows = levels.map((l, i) => {
    const pfClass = l.verdict === "pass" ? "pass" : l.verdict === "fail" ? "fail" : "";
    const verdictLabel = l.verdict === "pass" ? "Pass" : l.verdict === "fail" ? "Fail" : "Incomplete";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${l.name || `L${i + 1}`}</td>
      <td class="text-right">${l.assigned_value === null ? "-" : sf(l.assigned_value, 3)}</td>
      <td class="text-right">${l.n}</td>
      <td class="text-right">${l.mean === null ? "-" : sf(l.mean, 3)}</td>
      <td class="text-right">${l.sd === null ? "-" : sf(l.sd, 4)}</td>
      <td class="text-right">${l.pctRecovery === null ? "-" : sf(l.pctRecovery, 2) + "%"}</td>
      <td class="text-right">${l.absBiasPct === null ? "-" : sf(l.absBiasPct, 2) + "%"}</td>
      <td class="text-right ${pfClass}">${verdictLabel}</td>
    </tr>`;
  }).join("");

  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Claimed Reportable Range</div><div class="stat-value">${claimedRangeTxt}</div></div>
      <div class="stat-item"><div class="stat-label">Levels Tested</div><div class="stat-value">${levels.length}</div></div>
      <div class="stat-item"><div class="stat-label">CLIA TEa</div><div class="stat-value">${teaPctTxt}${(study as any).cliaPresetLabel ? ` (${(study as any).cliaPresetLabel})` : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary || ""} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck™ - Reportable Range Verification - ${study.testName}</title><style>${CSS}</style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="verdict-banner ${passClass}">${overallPass ? "✔" : "✘"} ${verdictText}</div>
  ${summaryStats}
  ${narrative}
  ${regulatoryComplianceBoxHTML("reportable_range", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  <div class="page-break"></div>
  <div class="section-heading">Per-Level Reportable Range Results</div>
  <p style="font-size:8pt;color:#666;margin:0 0 8px;">CLIA §493.1255: verification of the analytical measurement range claimed by the laboratory. Acceptance: per-level |observed bias| ≤ stated allowable error (TEa) using the dual-criterion (percent or absolute) allowance.</p>
  ${reportableRangeChartSVG(
    levels.filter(l => l.assigned_value !== null && l.mean !== null).map(l => ({ x: l.assigned_value as number, y: l.mean as number, verdict: l.verdict, name: l.name })),
    teaIsPercentage,
    teaRaw,
    absFloor,
    absUnit,
    typeof claimedLow === "number" ? claimedLow : null,
    typeof claimedHigh === "number" ? claimedHigh : null,
    units,
  )}
  <table>
    <thead><tr>
      <th>Level</th>
      <th class="text-right">Assigned${units ? " (" + units + ")" : ""}</th>
      <th class="text-right">N</th>
      <th class="text-right">Mean</th>
      <th class="text-right">SD</th>
      <th class="text-right">% Recovery</th>
      <th class="text-right">|Bias| %</th>
      <th class="text-right">Verdict</th>
    </tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </body></html>`;
}

function buildCarryoverHTML(study: Study, results: any): string {
  // Results shape: { specimens: [{sequence, sample_type, value, classification}],
  //   mean_L, mean_H, n_LL, n_LH, mean_LL, mean_LH, sd_LL, sd_LH,
  //   carryover_absolute, carryover_pct, error_limit, overallPass, summary,
  //   units }
  const units = results.units || "";
  const analyte = study.testName;
  const specimens = (results.specimens || []) as { sequence: number; sample_type: "L" | "H"; value: number; classification?: string }[];
  const overallPass = !!results.overallPass;
  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass ? "Meets CLSI EP10-A3 criteria" : "Does not meet CLSI EP10-A3 criteria";

  const cliaStatement = overallPass
    ? `<b>The carryover verification for ${analyte} meets the criteria per 42 CFR §493.1253(b)(2) and CLSI EP10-A3.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The carryover verification for ${analyte} does not meet the criteria per 42 CFR §493.1253(b)(2) and CLSI EP10-A3.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const dataRows = specimens.map((s, i) => {
    const cls = s.classification || "";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td class="text-right">${s.sequence}</td>
      <td>${s.sample_type === "L" ? "Low" : "High"}</td>
      <td class="text-right">${sf(s.value, 4)}${units ? " " + units : ""}</td>
      <td>${cls}</td>
    </tr>`;
  }).join("");

  const fmtNum = (v: any, d = 3) => (v === null || v === undefined || isNaN(v)) ? "&mdash;" : Number(v).toFixed(d);
  const fmtPct = (v: any) => (v === null || v === undefined || isNaN(v)) ? "&mdash;" : Number(v).toFixed(3) + "%";

  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Specimens Run</div><div class="stat-value">${specimens.length}</div></div>
      <div class="stat-item"><div class="stat-label">Low Material Mean</div><div class="stat-value">${fmtNum(results.mean_L)}</div></div>
      <div class="stat-item"><div class="stat-label">High Material Mean</div><div class="stat-value">${fmtNum(results.mean_H)}</div></div>
      <div class="stat-item"><div class="stat-label">N (L-after-L)</div><div class="stat-value">${results.n_LL || 0}</div></div>
      <div class="stat-item"><div class="stat-label">N (L-after-H)</div><div class="stat-value">${results.n_LH || 0}</div></div>
      <div class="stat-item"><div class="stat-label">Mean L-after-L</div><div class="stat-value">${fmtNum(results.mean_LL)}</div></div>
      <div class="stat-item"><div class="stat-label">Mean L-after-H</div><div class="stat-value">${fmtNum(results.mean_LH)}</div></div>
      <div class="stat-item"><div class="stat-label">SD L-after-L</div><div class="stat-value">${fmtNum(results.sd_LL)}</div></div>
      <div class="stat-item"><div class="stat-label">SD L-after-H</div><div class="stat-value">${fmtNum(results.sd_LH)}</div></div>
      <div class="stat-item"><div class="stat-label">Carryover (absolute)</div><div class="stat-value">${fmtNum(results.carryover_absolute)}</div></div>
      <div class="stat-item"><div class="stat-label">Carryover (%)</div><div class="stat-value">${fmtPct(results.carryover_pct)}</div></div>
      <div class="stat-item"><div class="stat-label">Error Limit (3 x SD-LL)</div><div class="stat-value">${fmtNum(results.error_limit)}</div></div>
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary || ""} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck™ - Carryover Verification - ${study.testName}</title><style>${CSS}</style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="verdict-banner ${passClass}">${overallPass ? "✔" : "✘"} ${verdictText}</div>
  ${summaryStats}
  ${narrative}
  ${regulatoryComplianceBoxHTML("carryover", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  <div class="page-break"></div>
  <div class="section-heading">Individual Specimen Sequence</div>
  <p style="font-size:8pt;color:#666;margin:0 0 8px;">EP10-A3 protocol: 21 alternating Low/High specimens. Each Low specimen is classified by the type of the immediately preceding specimen. L-after-L specimens reflect intrinsic precision; L-after-H specimens capture any carryover contamination from the preceding High aspiration.</p>
  <table>
    <thead><tr><th class="text-right">#</th><th>Material</th><th class="text-right">Value</th><th>Classification</th></tr></thead>
    <tbody>${dataRows}</tbody>
  </table>
  </body></html>`;
}

function buildSensitivityHTML(study: Study, results: any): string {
  // EP17-A2 results shape: { mode, lob: {parametric, nonParametric, meanBlank, sdBlank,
  // nBlank, byLot?}, lod: {value, lobUsed, cBeta, sdLowLevel, nLowLevel}, loq: {value,
  // byLevel[], cvThreshold, biasThreshold} | null, manufacturerClaim?, overallPass, summary }
  const mode: "establishment" | "verification" = results.mode || "establishment";
  const analyte = (study as any).testName || "Analyte";
  const units = study.teaUnit || "";
  const overallPass = results.overallPass;
  const passClass = overallPass ? "pass" : "fail";
  const verdictText = overallPass
    ? (mode === "establishment" ? "Meets CLSI EP17-A2 establishment criteria" : "Verifies manufacturer's sensitivity claims per CLSI EP17-A2")
    : (mode === "establishment" ? "Does not meet CLSI EP17-A2 establishment criteria" : "Does not verify manufacturer's sensitivity claims per CLSI EP17-A2");

  const lob = results.lob || {};
  const lod = results.lod || {};
  const loq = results.loq || null;
  const mfg = results.manufacturerClaim || {};

  const cfrCite = mode === "establishment"
    ? "42 CFR §493.1253(b)(2)(iii)"
    : "42 CFR §493.1253(b)(1)";

  const cliaStatement = overallPass
    ? (mode === "establishment"
        ? `<b>The analytical sensitivity for ${analyte} meets the criteria for establishment of performance specifications per ${cfrCite} and CLSI EP17-A2.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
        : `<b>The analytical sensitivity for ${analyte} verifies the manufacturer's published claims per ${cfrCite} and CLSI EP17-A2.</b> Final approval and clinical determination must be made by the laboratory director or designee.`)
    : (mode === "establishment"
        ? `<b>The analytical sensitivity for ${analyte} does not meet the criteria for establishment of performance specifications per ${cfrCite} and CLSI EP17-A2.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
        : `<b>The analytical sensitivity for ${analyte} does not verify the manufacturer's published claims per ${cfrCite} and CLSI EP17-A2.</b> Final approval and clinical determination must be made by the laboratory director or designee.`);

  // Per-lot LoB breakdown (only if byLot present)
  const byLotRows = lob.byLot ? Object.entries(lob.byLot).map(([lot, v], i) => {
    const data: any = v;
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td>${lot}</td>
      <td class="text-right">${data.n}</td>
      <td class="text-right">${sf(data.mean, 4)}</td>
      <td class="text-right">${sf(data.sd, 4)}</td>
      <td class="text-right">${sf(data.lobParametric, 4)}</td>
      <td class="text-right">${sf(data.lobNonParametric, 4)}</td>
    </tr>`;
  }).join("") : "";

  // LoQ levels table (only if loq present)
  const loqRows = loq ? (loq.byLevel || []).map((lvl: any, i: number) => {
    const precClass = lvl.meetsPrecision ? "pass" : "fail";
    const biasClass = lvl.meetsBias ? "pass" : "fail";
    return `<tr class="${i % 2 === 1 ? "stripe" : ""}">
      <td class="text-right">${sf(lvl.expectedConcentration, 4)}</td>
      <td class="text-right">${sf(lvl.meanObserved, 4)}</td>
      <td class="text-right">${sf(lvl.sd, 4)}</td>
      <td class="text-right">${sf(lvl.cv, 2)}%</td>
      <td class="text-right">${lvl.biasPct >= 0 ? "+" : ""}${sf(lvl.biasPct, 2)}%</td>
      <td class="text-right ${precClass}">${lvl.meetsPrecision ? "Pass" : "Fail"}</td>
      <td class="text-right ${biasClass}">${lvl.meetsBias ? "Pass" : "Fail"}</td>
    </tr>`;
  }).join("") : "";

  // Key stats panel — varies by mode
  const summaryStats = `
    <div class="key-stats">
      <div class="stat-item"><div class="stat-label">Analyte</div><div class="stat-value">${analyte}${units ? " (" + units + ")" : ""}</div></div>
      <div class="stat-item"><div class="stat-label">Study Mode</div><div class="stat-value">${mode === "establishment" ? "Establishment (full EP17-A2)" : "Verification (mfg claim)"}</div></div>
      <div class="stat-item"><div class="stat-label">LoB (parametric)</div><div class="stat-value">${sf(lob.parametric, 4)} ${units}</div></div>
      <div class="stat-item"><div class="stat-label">LoB (non-parametric)</div><div class="stat-value">${sf(lob.nonParametric, 4)} ${units}</div></div>
      <div class="stat-item"><div class="stat-label">LoD</div><div class="stat-value">${sf(lod.value, 4)} ${units}</div></div>
      <div class="stat-item"><div class="stat-label">LoQ</div><div class="stat-value">${loq && loq.value !== null ? sf(loq.value, 4) + " " + units : "Not assessed"}</div></div>
      <div class="stat-item"><div class="stat-label">Blank Replicates (n)</div><div class="stat-value">${lob.nBlank || 0}</div></div>
      <div class="stat-item"><div class="stat-label">Low-Level Replicates (n)</div><div class="stat-value">${lod.nLowLevel || 0}</div></div>
      <div class="stat-item"><div class="stat-label">Cβ (finite-sample correction)</div><div class="stat-value">${sf(lod.cBeta, 3)}</div></div>
      ${mode === "verification" && mfg.lob !== undefined ? `<div class="stat-item"><div class="stat-label">Claimed LoB</div><div class="stat-value">${sf(mfg.lob, 4)} ${units}</div></div>` : ""}
      ${mode === "verification" && mfg.lod !== undefined ? `<div class="stat-item"><div class="stat-label">Claimed LoD</div><div class="stat-value">${sf(mfg.lod, 4)} ${units}</div></div>` : ""}
      ${mode === "verification" && mfg.loq !== undefined ? `<div class="stat-item"><div class="stat-label">Claimed LoQ</div><div class="stat-value">${sf(mfg.loq, 4)} ${units}</div></div>` : ""}
      <div class="stat-item"><div class="stat-label">Result</div><div class="stat-value ${passClass}">${verdictText}</div></div>
    </div>`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary || ""} ${cliaStatement}</p>
  </div>`;

  // Detailed-results page only when there's something to show: per-lot breakdown or LoQ levels.
  const hasDetail = byLotRows.length > 0 || loqRows.length > 0;
  const detailSection = hasDetail ? `
  <div class="page-break"></div>
  ${byLotRows.length > 0 ? `
    <div class="section-heading">Per-Reagent-Lot LoB Breakdown</div>
    <table>
      <thead><tr><th>Lot</th><th class="text-right">N</th><th class="text-right">Mean</th><th class="text-right">SD</th><th class="text-right">LoB (param)</th><th class="text-right">LoB (non-param)</th></tr></thead>
      <tbody>${byLotRows}</tbody>
    </table>` : ""}
  ${loqRows.length > 0 ? `
    <div class="section-heading" style="margin-top:14px;">LoQ Concentration Levels</div>
    <table>
      <thead><tr><th class="text-right">Expected</th><th class="text-right">Observed Mean</th><th class="text-right">SD</th><th class="text-right">CV%</th><th class="text-right">Bias%</th><th class="text-right">Precision (CV ≤ ${sf(loq.cvThreshold, 0)}%)</th><th class="text-right">Bias (|bias| ≤ ${sf(loq.biasThreshold, 0)}%)</th></tr></thead>
      <tbody>${loqRows}</tbody>
    </table>
    <p style="font-size:8pt;color:#28251D;margin-top:8px;">LoQ identified at: <b>${loq.value !== null ? sf(loq.value, 4) + " " + units : "Not identified"}</b> (lowest concentration meeting both criteria).</p>` : ""}
  ` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck™ - Sensitivity Verification (EP17) - ${(study as any).testName || "Study"}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
  <div class="verdict-banner ${passClass}">${overallPass ? "✔" : "✘"} ${verdictText}</div>
  ${summaryStats}
  ${narrative}
  ${regulatoryComplianceBoxHTML("sensitivity", (study as any)._preferredStandards)}
  ${directorReviewHTML()}
  ${detailSection}
  </body></html>`;
}

function buildLotToLotHTML(study: Study, results: any): string {
  const instrumentNames: string[] = safeJsonParse(study.instruments) || [];
  const rawData = safeJsonParse(study.dataPoints) || {};
  const teaPct = (study.cliaAllowableError * 100).toFixed(1);

  // Split cohort sections: page 1 gets charts + compact summary, page 2 gets full data tables
  // Compress chart heights when there are 2 cohorts so director sign-off block fits on page 1
  const cohortCount = (results.cohorts || []).length;
  const chartW = cohortCount >= 2 ? 280 : 320;
  const chartH = cohortCount >= 2 ? 150 : 220;
  let cohortChartSections = "";
  let cohortDataSections = "";
  for (const cohort of (results.cohorts || [])) {
    const specimens = cohort.specimens || [];
    const currentVals = specimens.map((s: any) => s.currentLot);
    const newVals = specimens.map((s: any) => s.newLot);
    const pctDiffs = specimens.map((s: any) => s.pctDifference);
    const specimenNums = specimens.map((_: any, i: number) => i + 1);

    const scatter = scatterSVG(currentVals, newVals, "Current Lot", "New Lot", `${cohort.cohort} - Scatter`, true, chartW, chartH);
    const diffPlot = differencePlotSVG(specimenNums, pctDiffs, study.cliaAllowableError, chartW, chartH);

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

  const l2lTeaStr = teaDisplayStr(study);
  const l2lCfr = (study as any).cfr || "42 CFR \u00A7493.931";
  const l2lAdj = criterionAdjective(study.testName);
  const l2lLabel = criterionLabel(study.testName);
  const l2lAuthority = criterionAuthorityPhrase(study.testName, l2lCfr);
  const l2lSource = criterionSourcePhrase(study.testName, "42 CFR §493.1253(b)(2)");
  // The lot-to-lot pass rule (calculations.ts:821) requires both: mean absolute
  // percent difference within TEa AND at least 90% of paired specimens within
  // TEa. The narrative must describe the actual rule; a prior wording said "All
  // specimens satisfied" on PASS, which over-stated the test (the rule allows
  // up to 10% of specimens to fall outside TEa on a PASS).
  const cliaStatement = results.overallPass
    ? `<b>The lot-to-lot comparison met the ${l2lAdj} acceptance criterion (${l2lLabel}) of ${l2lTeaStr} ${l2lAuthority} (${l2lSource}): the mean absolute percent difference did not exceed the criterion, and at least 90% of paired specimens fell within it. Specimens outside the criterion, if any, are documented in the per-sample table.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The lot-to-lot comparison did not meet the ${l2lAdj} acceptance criterion (${l2lLabel}) of ${l2lTeaStr} ${l2lAuthority} (${l2lSource}): either the mean absolute percent difference exceeded the criterion or fewer than 90% of paired specimens fell within it. See the per-sample table for the failure pattern.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;

  const narrative = `<div style="margin-top:12px;padding:10px 12px;background:#F7F6F2;border:1px solid #D4D1CA;border-radius:5px;">
    <div style="font-size:7.5pt;font-weight:700;color:#01696F;margin-bottom:4px;letter-spacing:0.04em;text-transform:uppercase;">Study Narrative Summary</div>
    <p style="font-size:8pt;color:#28251D;line-height:1.55;margin:0;">${results.summary} ${cliaStatement}</p>
  </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - Reagent Lot Verification (EP26-A) - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
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
  const overallVerdict = results.overallPass ? "Meets adopted acceptance criterion" : "Does not meet adopted acceptance criterion";
  const narrativeText = results.summary;
  const ptCoagTeaStr = teaDisplayStr(study);
  const ptCoagCfr = (study as any).cfr || "42 CFR \u00A7493.941";
  const ptCoagAdj = criterionAdjective(study.testName);
  const ptCoagLabel = criterionLabel(study.testName);
  const ptCoagAuthority = criterionAuthorityPhrase(study.testName, ptCoagCfr);
  const ptCoagSource = criterionSourcePhrase(study.testName, "42 CFR §493.1253(b)(2)");
  const ptCoagCliaStatement = results.overallPass
    ? `<b>Each module was individually evaluated against the ${ptCoagAdj} acceptance criterion (${ptCoagLabel}) of ${ptCoagTeaStr} ${ptCoagAuthority} (${ptCoagSource}). All modules satisfied this criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>Each module was individually evaluated against the ${ptCoagAdj} acceptance criterion (${ptCoagLabel}) of ${ptCoagTeaStr} ${ptCoagAuthority} (${ptCoagSource}). One or more modules did not satisfy this criterion; see the module results for details.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
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

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - PT/INR Geometric Mean Calculator (H47) - ${study.testName}</title><style>${CSS}
  .page-num::after { content: "Page " counter(page); }
  </style></head><body>
  ${footerHTML()}
  ${headerHTML(study, (study as any)._cliaNumber)}
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
export async function getBrowser() {
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
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaCheck\u2122 is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.</div>
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
  const anyBias = (r.levelResults || []).some((lr: any) => lr.biasCheck);
  const anyVendor = (r.levelResults || []).some((lr: any) => lr.vendorComparison);

  // Section 1 — new lot range establishment
  const rangeRows = (r.levelResults || []).map((lr: any) => `
    <tr>
      <td>${lr.analyzer}</td><td>${lr.analyte}</td><td>${lr.level}</td>
      <td style="text-align:right">${lr.n}</td>
      <td style="text-align:right">${lr.newMean.toFixed(3)}</td>
      <td style="text-align:right">${lr.newSD.toFixed(3)}</td>
      <td style="text-align:right">${lr.cv.toFixed(2)}%</td>
    </tr>`).join("");

  // Section 2 — crossover bias check (Accept / Caution / Fail per pooled SD)
  const biasCellStyle = (cls: string): string => {
    if (cls === "accept") return "color:#16a34a;";
    if (cls === "caution") return "color:#d97706;font-weight:600;";
    return "color:#dc2626;font-weight:600;";
  };
  const biasLabel = (cls: string): string => cls === "accept" ? "Accept" : cls === "caution" ? "Caution" : "Fail";
  const biasRows = anyBias ? (r.levelResults || []).map((lr: any) => `
    <tr>
      <td>${lr.analyzer}</td><td>${lr.analyte}</td><td>${lr.level}</td>
      <td style="text-align:right">${lr.priorLot ? lr.priorLot.mean.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.priorLot ? lr.priorLot.sd.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.biasCheck ? (lr.biasCheck.deltaMean >= 0 ? '+' : '') + lr.biasCheck.deltaMean.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.biasCheck ? lr.biasCheck.pctDiffFromPrior.toFixed(2) + '%' : '-'}</td>
      <td style="text-align:right">${lr.biasCheck ? lr.biasCheck.pooledSD.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.biasCheck ? lr.biasCheck.sdiVsPriorLot.toFixed(2) : '-'}</td>
      <td style="${lr.biasCheck ? biasCellStyle(lr.biasCheck.classification) : ''}">${lr.biasCheck ? biasLabel(lr.biasCheck.classification) : '-'}</td>
    </tr>`).join("") : "";

  // Section 3 — vendor SDI comparison (Westgard, informational only)
  const vendorCellStyle = (cls: string): string => {
    if (cls === "excellent" || cls === "acceptable") return "color:#16a34a;";
    if (cls === "investigate") return "color:#d97706;font-weight:600;";
    return "color:#dc2626;font-weight:600;";
  };
  const vendorRows = anyVendor ? (r.levelResults || []).map((lr: any) => `
    <tr>
      <td>${lr.analyzer}</td><td>${lr.analyte}</td><td>${lr.level}</td>
      <td style="text-align:right">${lr.vendorComparison ? lr.vendorComparison.vendorMean.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.vendorComparison ? lr.vendorComparison.vendorSD.toFixed(3) : '-'}</td>
      <td style="text-align:right">${lr.vendorComparison ? (lr.vendorComparison.sdi >= 0 ? '+' : '') + lr.vendorComparison.sdi.toFixed(2) : '-'}</td>
      <td style="${lr.vendorComparison ? vendorCellStyle(lr.vendorComparison.classification) : ''}">${lr.vendorComparison ? lr.vendorComparison.classification.charAt(0).toUpperCase() + lr.vendorComparison.classification.slice(1) : '-'}</td>
    </tr>`).join("") : "";

  const qcCliaStatement = r.overallPass
    ? `<b>The lab's calculated mean and SD become the operating values on the Levey-Jennings chart, per 42 CFR \u00A7493.1256.${anyBias ? " The crossover bias check accepted all analyte-level combinations." : ""}</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>The lab's calculated mean and SD become the operating values on the Levey-Jennings chart, per 42 CFR \u00A7493.1256. ${anyBias ? "One or more analyte-level combinations failed the crossover bias check; see the bias check table." : "One or more analyte-level combinations exceeded the legacy 10% shift heuristic; see the table."}</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
  const narrative = (r.summary || `New QC ranges have been established for ${analytes.join(", ")} per CLSI C24-Ed4.`) + ` ${qcCliaStatement}`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaCheck\u2122 - QC Lot Verification (C24-Ed4) - ${study.testName}</title><style>${CSS}
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
    <div style="page-break-before:always"></div>
    ${headerHTML(study, (study as any)._cliaNumber)}
    <div class="eval-title" style="margin-top:8px">Statistical Analysis and Experimental Results (Continued from page 1)</div>

    <div style="font-size:8pt;font-weight:600;color:#01696F;margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.04em;">New lot range establishment (CLSI C24-Ed4)</div>
    <table class="data-table"><thead><tr>
      <th>Analyzer</th><th>Analyte</th><th>Level</th><th style="text-align:right">N</th>
      <th style="text-align:right">New Mean</th><th style="text-align:right">New SD</th><th style="text-align:right">CV%</th>
    </tr></thead><tbody>${rangeRows}</tbody></table>

    ${anyBias ? `
    <div style="font-size:8pt;font-weight:600;color:#01696F;margin:12px 0 4px;text-transform:uppercase;letter-spacing:0.04em;">Crossover bias check vs prior lot</div>
    <table class="data-table"><thead><tr>
      <th>Analyzer</th><th>Analyte</th><th>Level</th>
      <th style="text-align:right">Prior Mean</th><th style="text-align:right">Prior SD</th>
      <th style="text-align:right">Delta Mean</th><th style="text-align:right">% Diff</th>
      <th style="text-align:right">Pooled SD</th><th style="text-align:right">SDI</th>
      <th>Verdict</th>
    </tr></thead><tbody>${biasRows}</tbody></table>
    <div class="eval-text" style="font-size:7.5px;color:#666;margin:4px 0;font-style:italic">Verdict thresholds: |Delta| within 1 pooled SD = Accept; 1 to 2 SD = Caution; greater than or equal to 2 SD = Fail.</div>
    ` : ""}

    ${anyVendor ? `
    <div style="font-size:8pt;font-weight:600;color:#01696F;margin:12px 0 4px;text-transform:uppercase;letter-spacing:0.04em;">Vendor SDI comparison (informational only)</div>
    <table class="data-table"><thead><tr>
      <th>Analyzer</th><th>Analyte</th><th>Level</th>
      <th style="text-align:right">Vendor Mean</th><th style="text-align:right">Vendor SD</th>
      <th style="text-align:right">SDI</th><th>Westgard</th>
    </tr></thead><tbody>${vendorRows}</tbody></table>
    <div class="eval-text" style="font-size:7.5px;color:#666;margin:4px 0;font-style:italic">SDI = (lab mean minus vendor mean) divided by vendor SD. Westgard thresholds: |SDI| less than 1 excellent, less than 2 acceptable, less than 3 investigate, 3 or greater unacceptable. Vendor SD is reference only; the lab uses its own calculated SD on the Levey-Jennings chart per 42 CFR §493.1256.</div>
    ` : ""}

    ${evalHTML(r.summary, r.overallPass, r.passCount, r.totalCount, study.cliaAllowableError)}
    <div class="eval-text" style="font-size:7.5px;color:#666;margin:8px 0;font-style:italic">Per 42 CFR §493.1256, the laboratory must determine its own mean and SD for the QC materials it uses. The lab's calculated values from this study become the operating mean and SD on the Levey-Jennings chart. Vendor (package-insert) SD is reference only.</div>
    ${supportingPageHTML(study, safeJsonParse(study.instruments))}
  </body></html>`;
}

// ─── MULTI-ANALYTE LOT COMPARISON HTML ────────────────────────────────────────
function buildMultiAnalyteCoagHTML(study: Study, results: any): string {
  const r = results;
  const rawDP = safeJsonParse(study.dataPoints);
  // Defensive dual-criterion handling: if a per-analyte floor is provided on the result object
  // (ar.absFloor / ar.absUnit), include it in the per-analyte narrative; otherwise show only %.
  const maAnalyteTeaStr = (ar: any): string => {
    const pct = `\u00B1${(ar.tea * 100).toFixed(0)}%`;
    if (ar.absFloor != null && ar.absUnit) {
      return `${pct} or \u00B1${ar.absFloor} ${ar.absUnit} (greater)`;
    }
    return pct;
  };
  const summaryRows = (r.analyteResults || []).filter((ar: any) => ar.n > 0).map((ar: any) => `
    <tr style="${!ar.pass ? 'background:#fef2f2;' : ''}">
      <td>${ar.analyte}</td><td style="text-align:right">${ar.n}</td>
      <td style="text-align:right">${ar.meanNew.toFixed(2)}</td>
      <td style="text-align:right">${ar.meanOld.toFixed(2)}</td>
      <td style="text-align:right">${ar.meanPctDiff.toFixed(1)}%</td>
      <td style="text-align:right">${ar.sdPctDiff.toFixed(2)}</td>
      <td style="text-align:right">${ar.r.toFixed(4)}</td>
      <td style="text-align:right">${maAnalyteTeaStr(ar)}</td>
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
  const maCfr = (study as any).cfr || "42 CFR \u00A7493.941";
  // Multi-analyte study: aggregate phrasing must cover the case where some
  // analytes have canonical CLIA TEa and others use a lab-set internal goal.
  const maCoagCliaStatement = r.overallPass
    ? `<b>Each analyte was individually evaluated against its acceptance criterion per ${maCfr} where a canonical 42 CFR §493 PT criterion exists, and per laboratory director or designee policy where the criterion is lab-defined; see the per-analyte results for the source applied to each. All analytes satisfied their respective criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`
    : `<b>Each analyte was individually evaluated against its acceptance criterion per ${maCfr} where a canonical 42 CFR §493 PT criterion exists, and per laboratory director or designee policy where the criterion is lab-defined; see the per-analyte results for the source applied to each. One or more analytes did not satisfy this criterion.</b> Final approval and clinical determination must be made by the laboratory director or designee.`;
  const narrative = `${(r.specimens || []).length} ${sampleLabel} specimens were compared between old lot and new lot on ${study.instrument}. ` +
    validAnalytes.map((ar: any) => `${ar.analyte} showed a mean difference of ${ar.meanPctDiff.toFixed(1)}% (${ar.pass ? 'PASS' : 'FAIL'} at ${maAnalyteTeaStr(ar)} TEa).`).join(" ") +
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
export async function generateCumsumPDF(tracker: any, entries: any[], currentSpecimens?: any[], cliaNumber?: string, labName?: string, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
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
      <div class="verdict" style="background:${currentVerdict === 'ACTION REQUIRED' ? '#fef2f2;border-color:#fca5a5;color:#dc2626' : '#f0fdf4;border-color:#86efac;color:#059669'}">${currentVerdict === 'ACTION REQUIRED' ? iconCross() + ' ACTION REQUIRED' : currentVerdict === 'ACCEPT' ? iconCheck() + ' ACCEPT' : currentVerdict}</div>
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
    const stamped = applyLicenseToPuppeteer(html, FOOTER_TEMPLATE, licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

export async function generatePDFBuffer(study: Study, results: any, cliaNumber?: string, preferredStandards?: AccreditationBody[] | null, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
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
    : study.studyType === "sensitivity"
    ? buildSensitivityHTML(study, results)
    : study.studyType === "carryover"
    ? buildCarryoverHTML(study, results)
    // ── cal_ver split (PR 1: skeleton dispatch) ─────────────────────────
    // Per-type builders ship in PR 2 / PR 3 / PR 4. Explicit throws here
    // are intentional. Forward-safe: any caller (admin API, demo seed,
    // future codepath) creating a study with one of these types before
    // its builder is wired fails loudly instead of silently rendering as
    // a method comparison via the default fallthrough below.
    : study.studyType === "accuracy_bias"
    ? buildAccuracyBiasHTML(study, results)
    : study.studyType === "linearity"
    ? buildLinearityHTML(study, results)
    : study.studyType === "reportable_range"
    ? buildReportableRangeHTML(study, results)
    : isQualResult
    ? buildQualitativeHTML(study, results)
    : isSemiQuantResult
    ? buildSemiQuantHTML(study, results)
    : buildMethodCompHTML(study, results);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, FOOTER_TEMPLATE, licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
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
  // Phase 3.5 (2026-05-01): aabb + cola added so the PDF data shape matches
  // ScanItem in client/src/lib/veritaScanData.ts. Per-row badges are still
  // rendered as TJC/CAP/CFR columns in the PDF table; aabb/cola pass-through
  // is wired now so a future PDF-side accreditor gating change has the data.
  aabb?: string;
  cola?: string;
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
  // Phase 3 (2026-05-01): empty default = CLIA-only mode. Previously hardcoded
  // to ["CAP", "TJC"], which printed TJC/CAP framework badges on the VeritaScan
  // PDF cover for labs that selected CLIA only, AABB only, or COLA only.
  const standards = (preferredStandards && preferredStandards.length > 0)
    ? preferredStandards
    : [] as AccreditationBody[];
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

  // Phase 3.6 (2026-05-03): dynamic accreditor columns. Column order is
  // # / Question / CFR / <accreditor(s) by lab selection> / Status / Owner / Due / Notes.
  // CFR is always rendered (every CLIA lab is bound by it). Accreditor columns
  // (TJC, CAP, AABB, COLA) render only when the lab's accreditation_choice
  // includes that body. CLIA-only labs see CFR alone.
  const selectedAccreditors: Array<{ key: "tjc" | "cap" | "aabb" | "cola"; label: string }> = [];
  const ps = data.preferredStandards || [];
  if (ps.includes("TJC" as AccreditationBody)) selectedAccreditors.push({ key: "tjc", label: "TJC" });
  if (ps.includes("CAP" as AccreditationBody)) selectedAccreditors.push({ key: "cap", label: "CAP" });
  if (ps.includes("AABB" as AccreditationBody)) selectedAccreditors.push({ key: "aabb", label: "AABB" });
  if (ps.includes("COLA" as AccreditationBody)) selectedAccreditors.push({ key: "cola", label: "COLA" });

  // Domain detail sections - natural flow, no forced page breaks
  let domainSections = "";
  for (const [domain, domItems] of Array.from(domainMap.entries())) {
    const rows = domItems.map((item, idx) => {
      const sc = SCAN_STATUS_COLORS[item.status] || SCAN_STATUS_COLORS["Not Assessed"];
      const accreditorCells = selectedAccreditors.map((a) => {
        const v = (item as any)[a.key] as string | undefined;
        const display = v && v !== "N/A" ? v : "-";
        return `<td style="font-size:6.5pt">${display}</td>`;
      }).join("");
      return `<tr class="${idx % 2 === 1 ? "stripe" : ""}" style="page-break-inside:avoid">
        <td>${item.id}</td>
        <td style="max-width:200px;word-wrap:break-word;font-size:7pt">${item.question}</td>
        <td style="font-size:6.5pt">${item.cfr || "-"}</td>
        ${accreditorCells}
        <td><span style="background:${sc.bg};color:${sc.fg};padding:1px 5px;border-radius:3px;font-size:6.5pt;font-weight:600;white-space:nowrap">${item.status}</span></td>
        <td style="font-size:7pt">${item.owner || ""}</td>
        <td style="font-size:7pt">${item.due_date || ""}</td>
        <td style="font-size:6.5pt;max-width:100px;word-wrap:break-word">${item.notes || ""}</td>
      </tr>`;
    }).join("");

    const accreditorHeaders = selectedAccreditors.map((a) => `<th>${a.label}</th>`).join("");
    domainSections += `
      <div style="border-top:2px solid #B0D8D8;margin-top:14px;padding-top:6px;page-break-after:avoid">
        <div class="section-label" style="font-size:10pt;margin:0 0 6px;color:${TEAL};page-break-after:avoid">${domain}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Compliance Question</th><th>CFR</th>${accreditorHeaders}<th>Status</th><th>Owner</th><th>Due</th><th>Notes</th></tr></thead>
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

export async function generateVeritaScanPDF(data: VeritaScanPDFData, type: "executive" | "full", licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const html = type === "executive"
    ? buildVeritaScanExecutiveHTML(data)
    : buildVeritaScanFullHTML(data);

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, VERITASCAN_FOOTER_TEMPLATE, licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
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

interface CompetencyElementDocument {
  element_number: number;
  doc_type: string;
  title: string | null;
  url: string;
}

interface CompetencyPDFInput {
  assessment: any;
  items: any[];
  methodGroups: any[];
  checklistItems: any[];
  labName: string;
  quizResults?: any[];
  cliaNumber?: string;
  // PR C+ of the VeritaComp customer-blockers wave (2026-06-05). Per-element
  // URL-pointer documents linked via PR #558. Rendered as a subsection at
  // the end of each element's table in the PDF so a TJC surveyor reading
  // the printed competency PDF sees the citation chain inline, not just
  // in the survey bundle's Index workbook.
  elementDocuments?: CompetencyElementDocument[];
  // Wave G PR G1 (2026-06-06). When true, render the paper-completion
  // worksheet variant: PASS/FAIL verdict swapped for a "BLANK ASSESSMENT
  // TEMPLATE" header, employee + evaluator fill-line strings empty,
  // each element table contains one blank row per method group with
  // empty cells + an unchecked "[ ] Pass  [ ] Fail" placeholder column.
  // Lab director prints, hands to tech for paper completion, transcribes
  // back into VeritaComp using the normal New Assessment dialog.
  blank?: boolean;
}

// Human-readable label for the doc_type enum from competency_element_documents.
// Kept in this file so the PDF generator does not need to import client code.
const COMP_DOC_TYPE_LABELS: Record<string, string> = {
  quiz_scan: "Quiz scan",
  observation_notes: "Observation notes",
  qc_record: "QC record",
  pt_report: "PT report",
  blind_sample_record: "Blind sample record",
  evidence_other: "Other evidence",
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildCompetencyHTML(input: CompetencyPDFInput): string {
  const { assessment, items, methodGroups, checklistItems, labName, quizResults } = input;
  const elementDocuments: CompetencyElementDocument[] = input.elementDocuments || [];
  const dateStr = assessment.assessment_date || new Date().toISOString().split("T")[0];
  const isTechnical = assessment.competency_type === "technical";
  const isWaived = assessment.competency_type === "waived";
  const isNonTech = assessment.competency_type === "nontechnical";

  const typeLabel = isTechnical ? "Technical Competency Assessment" : isWaived ? "Waived Testing Competency Assessment" : "Non-Technical Competency Assessment";
  // Wave F PR F1 (2026-06-06). Cite §493.1235 (competency assessment) rather
  // than §493.1451 (high-complexity testing personnel responsibilities). The
  // six-element framework rendered on pages 2+ flows directly from
  // §493.1235(a)(1)-(6); citing the personnel CFR mis-targets the survey
  // defense. TJC HR.01.06.01 EP 18 (observer qualification) is retained.
  const standardRef = isTechnical ? "HR.01.06.01 EP 18 &middot; 42 CFR &sect;493.1235" : isWaived ? "WT.03.01.01 EP 5 &middot; 42 CFR &sect;493.15" : "HR.01.06.01 EP 5/6";

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

  // PASS/FAIL/REMEDIATION box. Wave G PR G1: in blank mode the verdict
  // doesn't exist yet (the tech hasn't been assessed) — render a paper-
  // worksheet header instead.
  if (input.blank) {
    html += `<div class="verdict-box" style="background:#f3f4f6;border:1px dashed #888;">
      <div class="label">Worksheet</div>
      <div class="verdict" style="color:#444;letter-spacing:1px;">BLANK ASSESSMENT TEMPLATE</div>
      <div style="font-size:7.5pt;color:#555;margin-top:4px;">Print, complete on paper, then transcribe into VeritaComp.</div>
    </div>`;
  } else {
    const verdictBg = assessment.status === "pass" ? "#dcfce7" : assessment.status === "fail" ? "#fce7f3" : "#fef3c7";
    html += `<div class="verdict-box" style="background:${verdictBg}">
      <div class="label">Overall Determination</div>
      <div class="verdict" style="color:${passColor}">${passLabel}</div>
    </div>`;
  }

  // Remediation box
  if (assessment.status === "remediation" || assessment.status === "fail") {
    html += `<div class="remediation-box">
      <strong>Remediation Required:</strong> This employee requires additional training and may not perform patient testing unsupervised until remediation is complete.
      ${assessment.remediation_plan ? "<br><strong>Action Plan:</strong> " + esc(assessment.remediation_plan) : ""}
    </div>`;
  }

  // Employee Acknowledgement box with TJC language (on page 1 - non-negotiable)
  //
  // PR B of the VeritaComp customer-blockers wave (2026-06-05, item #3 path A,
  // wet-signature workflow). The previous layout printed the employee's name
  // ON the signature line, which left nowhere for the employee to physically
  // sign. The customer asked "how does the employee sign?" because the
  // workflow had no terminal artifact they could sign with a pen. This change
  // separates the signature line (now blank, ~24px tall) from the printed
  // name (below the line) and the date (blank line below the name), so the
  // supervisor prints the PDF, hands it to the employee, the employee wet-
  // signs, and the lab scans the signed page back in via VeritaScan as the
  // evidence document. Same shape on the supervisor side.
  //
  // The supervisor's "Sign & Complete" button (PR #553) still electronically
  // stamps completion_date and locks the assessment record; this PDF region
  // is the paper-trail companion. The auto-stamped assessment date stays in
  // the assessment header up top so the assessment_date is still surveyor-
  // visible without the employee having to fill it in.
  const employeePrintLine = `${esc(assessment.employee_name) || ""}${assessment.employee_lis_initials ? " (" + esc(assessment.employee_lis_initials) + ")" : ""}`;
  const supervisorPrintLine = `${esc(assessment.evaluator_name) || ""}${assessment.evaluator_initials ? " (" + esc(assessment.evaluator_initials) + ")" : ""}`;
  html += `<div class="ack-box">
    <div class="title">Employee Acknowledgement</div>
    <div class="text">Prior to performing laboratory duties, the following are completed:</div>
    <ul>
      <li>The laboratory director or designee documents that staff have completed orientation and have demonstrated competence in performing their required duties.</li>
      <li>The staff member affirms, in writing, that they can perform the duties for which orientation was provided.</li>
    </ul>
    <div class="text" style="margin-top:6px;">By signing below, the employee acknowledges that this competency assessment has been reviewed with them and that they understand the duties for which they have been assessed competent.</div>
    <div class="sig-grid" style="margin-top:10px;">
      <div>
        <div class="sig-line" style="min-height:24px;border-bottom:1px solid #1a1a1a;"></div>
        <div class="sig-label" style="margin-top:2px;">Employee Signature</div>
        <div style="font-size:7.5pt;margin-top:6px;">Print: <strong>${employeePrintLine || "______________________"}</strong></div>
        <div style="font-size:7.5pt;margin-top:4px;display:flex;align-items:baseline;gap:6px;">Date: <span style="flex:1;border-bottom:1px solid #1a1a1a;min-height:12px;">&nbsp;</span></div>
      </div>
      <div>
        <div class="sig-line" style="min-height:24px;border-bottom:1px solid #1a1a1a;"></div>
        <div class="sig-label" style="margin-top:2px;">Supervisor Signature</div>
        <div style="font-size:7.5pt;margin-top:6px;">Print: <strong>${supervisorPrintLine || "______________________"}</strong></div>
        <div style="font-size:7.5pt;margin-top:4px;display:flex;align-items:baseline;gap:6px;">Date: <span style="flex:1;border-bottom:1px solid #1a1a1a;min-height:12px;">&nbsp;</span></div>
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
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
      },
      {
        num: 2,
        title: "Element 2: Monitoring, Recording and Reporting of Test Results",
        note: "Documents the employee's ability to monitor, record, and report results including critical values.",
        cols: ["Method Group", "Evidence", "Date", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td style="word-break:break-word;white-space:normal;max-width:280px;font-size:7.5pt;line-height:1.4;">${esc(item.el2_evidence || item.evidence || "")}</td>
          <td>${esc(item.el2_date || item.date_met || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
      },
      {
        num: 3,
        title: "Element 3: QC Performance",
        note: "Enter the date the employee personally ran QC on this instrument. The surveyor will pull the QC records for that date to confirm.",
        cols: ["Method Group", "Date Tech Ran QC", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el3_qc_date || item.date_met || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
      },
      {
        num: 4,
        title: "Element 4: Direct Observation of Instrument Maintenance",
        note: "Observer must be Lab Director or designee, Technical Consultant (moderate complexity), or Technical Supervisor (high complexity) as appropriate. The lab's signed maintenance records for the date observed serve as the supporting documentation.",
        cols: ["Method Group", "Date Observed", "Observer Initials", "Pass"],
        render: (item: any) => `<td>${esc(item.method_group_name || "")}</td>
          <td>${esc(item.el4_date_observed || item.date_met || "")}</td>
          <td>${esc(item.el4_observer_initials || item.supervisor_initials || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
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
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
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
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>`,
      },
    ];

    // Single page break before all elements, then they flow naturally
    html += `<div class="page-break"></div>`;
    for (const elDef of elementDefs) {
      const naKey = `el${elDef.num}_na` as string;
      const naJustKey = `el${elDef.num}_na_justification` as string;
      // Wave F PR F1: each element gets the matching §493.1235 subsection cited
      // inline so a surveyor reading the printed PDF sees the regulatory anchor
      // alongside the activity, not just on page 1.
      html += `<div class="section" style="margin-bottom:6px;">
        <div class="section-header">${elDef.title}</div>
        <div class="section-note">${elDef.note} <span style="color:#888;font-size:7pt;">(42 CFR &sect;493.1235(a)(${elDef.num}))</span></div>
        <table>
          <tr>${elDef.cols.map(c => `<th>${c}</th>`).join("")}</tr>`;

      // Wave G PR G1: blank-worksheet branch. Render one placeholder row
      // per method group with empty cells + a "[ ] Pass  [ ] Fail" column
      // so the tech can hand-write entries and check the verdict box.
      // The first column is always the method group name so the tech
      // knows which row maps to which analyte/instrument.
      if (input.blank) {
        const groups = methodGroups.length > 0 ? methodGroups : [{ id: 0, name: "" }];
        for (const mg of groups) {
          const blankCells = elDef.cols.map((c, idx) => {
            if (idx === 0) return `<td>${esc(mg.name || "")}</td>`;
            if (c === "Pass") {
              return `<td style="font-size:9pt;letter-spacing:1px;">&#9744; Pass &nbsp; &#9744; Fail</td>`;
            }
            // Underline cells with non-breaking spaces so the cell has
            // a visible fill line in print preview.
            return `<td>&nbsp;</td>`;
          }).join("");
          html += `<tr style="height:22px;">${blankCells}</tr>`;
        }
        html += `</table></div>`;
        continue;
      }

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
      html += `</table>`;

      // PR C+ (2026-06-05): per-element linked documents subsection.
      // Surveyor-defensible citation chain. URL-pointer architecture only;
      // the file content is never embedded, only its URL is printed.
      // Hidden when this element has zero linked docs.
      const elDocs = elementDocuments
        .filter(d => d.element_number === elDef.num)
        .slice()
        .sort((a, b) => 0); // server already sorts by created_at; preserve.
      if (elDocs.length > 0) {
        html += `<div style="margin-top:6px;">
          <div style="font-size:7.5pt;font-weight:600;color:#555;margin-bottom:3px;">Linked documents (${elDocs.length})</div>
          <table style="font-size:7.5pt;">
            <tr><th style="width:20%;">Type</th><th style="width:30%;">Title</th><th>URL</th></tr>`;
        for (const d of elDocs) {
          const typeLabel = COMP_DOC_TYPE_LABELS[d.doc_type] || d.doc_type;
          const titleText = d.title && d.title.trim() ? d.title.trim() : "(no title)";
          // Title truncated visually to 80 chars; word-break on the URL
          // cell so a long SharePoint link wraps inside the cell without
          // overflowing the page width.
          const titleDisplay = titleText.length > 80 ? titleText.slice(0, 77) + "..." : titleText;
          html += `<tr>
            <td>${esc(typeLabel)}</td>
            <td title="${esc(titleText)}">${esc(titleDisplay)}</td>
            <td style="word-break:break-all;font-family:monospace;font-size:7pt;"><a href="${esc(d.url)}" style="color:#01696F;text-decoration:underline;">${esc(d.url)}</a></td>
          </tr>`;
        }
        html += `</table></div>`;
      }

      html += `</div>`;
    }

  } else if (isWaived) {
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Waived Testing Competency - 2 of 4 Methods Required Per Test</div>
      <table>
        <tr><th>Assessment Method</th><th>Instrument/Test</th><th>Evidence</th><th>Date</th><th>Initials</th><th>Pass</th></tr>`;
    // Wave G PR G1: blank-worksheet branch for waived programs. Render
    // one row per WAIVED_METHOD with empty cells so the lab can hand-
    // complete on paper. Otherwise iterate the real items.
    if (input.blank) {
      for (let i = 0; i < WAIVED_METHODS.length; i++) {
        const methodLabel = WAIVED_METHODS[i];
        html += `<tr style="height:22px;">
          <td>${methodLabel}</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td style="font-size:9pt;letter-spacing:1px;">&#9744; Pass &nbsp; &#9744; Fail</td>
        </tr>`;
      }
    } else {
      for (const item of items) {
        const methodLabel = WAIVED_METHODS[(item.method_number || item.waived_method_number || 1) - 1] || `Method ${item.method_number}`;
        html += `<tr>
          <td>${methodLabel}</td>
          <td>${esc(item.waived_instrument || "")} ${esc(item.waived_test || "")}</td>
          <td>${esc(item.waived_evidence || item.evidence || "")}</td>
          <td>${esc(item.waived_date || item.date_met || "")}</td>
          <td>${esc(item.waived_initials || item.supervisor_initials || "")}</td>
          <td class="${item.passed ? 'pass-badge' : 'fail-badge'}">${item.passed ? iconCheck() + ' Pass' : iconCross() + ' Fail'}</td>
        </tr>`;
      }
    }
    html += `</table></div>`;

  } else {
    // Non-technical checklist
    html += `<div class="page-break"></div>`;
    html += `<div class="section">
      <div class="section-header">Non-Technical Competency Checklist - ${esc(assessment.department)}</div>
      <table>
        <tr><th style="width:5%">#</th><th>Competency Item</th><th style="width:12%">Date Met</th><th style="width:10%">Emp Init</th><th style="width:10%">Sup Init</th></tr>`;
    // Wave G PR G1: blank-worksheet branch for nontechnical programs.
    // Render one row per checklist item from the program with blank
    // date/initials cells so the supervisor can hand-complete on paper.
    if (input.blank) {
      for (const ci of checklistItems) {
        html += `<tr style="height:22px;">
          <td><strong>${esc(ci.label || "")}</strong></td>
          <td>${esc(ci.description || "")}</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
          <td>&nbsp;</td>
        </tr>`;
      }
    } else {
      for (const item of items) {
        html += `<tr>
          <td><strong>${esc(item.nt_item_label || item.item_label || "")}</strong></td>
          <td>${esc(item.nt_item_description || item.item_description || "")}</td>
          <td>${esc(item.nt_date_met || item.date_met || "")}</td>
          <td>${esc(item.nt_employee_initials || item.employee_initials || "")}</td>
          <td>${esc(item.nt_supervisor_initials || item.supervisor_initials || "")}</td>
        </tr>`;
      }
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
            ${isCorrect ? ' <span style="color:#437A22;font-weight:600;">' + iconCheck() + ' Correct</span>' : ""}
            ${isSelected && !isCorrect ? ' <span style="color:#A12C7B;font-weight:600;">' + iconCross() + ' Selected</span>' : ""}
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

export async function generateCompetencyPDF(input: CompetencyPDFInput, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const html = buildCompetencyHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, COMPETENCY_FOOTER, licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
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

export async function generateCMS209PDF(input: CMS209Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const html = buildCMS209HTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
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

export async function generateVeritaPTPDF(data: VeritaPTPDFData, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const html = buildVeritaPTPDFHTML(data);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
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
  accreditationBody?: string;
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
  const { user, settings, requirements, statusMap, policyMap, policies, accreditationBody } = input;

  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file - enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Build dynamic subtitle based on accreditation body and actual requirement count.
  // Phase 1 (2026-05-01): six-option model. Values: TJC, CAP, AABB, COLA,
  // CAP+AABB, CLIA. Legacy values ('tjc', 'cap', 'both') still tolerated for
  // any older caller that might pass them.
  const body = accreditationBody || settings?.accreditation_body || 'CLIA';
  const reqCount = requirements.length;
  let subtitleText: string;
  switch (body) {
    case 'TJC':
    case 'tjc':
      subtitleText = `${reqCount} Required Policies (TJC + CFR)`;
      break;
    case 'CAP':
    case 'cap':
      subtitleText = `${reqCount} Required Policies (CAP + CFR)`;
      break;
    case 'AABB':
    case 'aabb':
      subtitleText = `${reqCount} Required Policies (AABB + CFR)`;
      break;
    case 'COLA':
    case 'cola':
      subtitleText = `${reqCount} Required Policies (COLA + CFR)`;
      break;
    case 'CAP+AABB':
      subtitleText = `${reqCount} Required Policies (CAP + AABB + CFR)`;
      break;
    case 'CLIA':
    case 'clia':
      subtitleText = `${reqCount} Required Policies (CFR / CLIA)`;
      break;
    case 'both':
      // Legacy compatibility for any old caller
      subtitleText = `${reqCount} Required Policies (TJC + CAP)`;
      break;
    default:
      subtitleText = `${reqCount} ${body.toUpperCase()} Required Policies`;
  }

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
    <h2 class="report-subtitle">Laboratory Policy Tracker - ${subtitleText}</h2>
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

  <div class="footer-line">VeritaAssure&#8482; | VeritaPolicy&#8482; | Confidential - For Internal Lab Use Only</div>
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

export async function generateVeritaPolicyPDF(input: VeritaPolicyPDFInput, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const html = buildVeritaPolicyPDFHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// ─── VeritaResponse™ CMS-2567 PDF (parking-lot #17 Phase 3) ───────────────────
// Renders a CMS Statement of Deficiencies and Plan of Correction in the
// federal-form two-column shape: left = surveyor's deficiency narrative,
// right = the lab's plan of correction with the 5 POC elements explicitly
// labeled per State Operations Manual section 7314.

export interface Cms2567Input {
  finding: any; // row from `findings` table
  user: any;    // row from `users` (for lab identity)
}

// Server-side validation of the 5 POC elements required by CMS-2567.
// Mirrors the client-side guard so a direct API hit cannot bypass it.
export function validateCms2567POC(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) {
    return { ok: false, missing: ["finding"] };
  }
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action (POC element 1)");
  if (!finding.preventive_action || !String(finding.preventive_action).trim()) missing.push("Preventive / system-level action (POC elements 2 + 3)");
  if (!finding.monitoring_plan || !String(finding.monitoring_plan).trim()) missing.push("Monitoring plan (POC element 4)");
  if (!finding.completion_date || !String(finding.completion_date).trim()) missing.push("Completion date (POC element 5)");
  return { ok: missing.length === 0, missing };
}

function buildCms2567HTML(input: Cms2567Input): string {
  const { finding, user } = input;
  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file - enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const findingNum = escHtml(finding.finding_number || `#${finding.id}`);
  const standardRef = escHtml(finding.standard_ref || "Not recorded");
  const phase = escHtml(finding.phase_or_severity || "Not classified");
  const anchor = escHtml(finding.anchor_date || "Not set");
  const due = escHtml(finding.due_date || "Not computed");
  const inspectionId = escHtml(finding.inspection_id || "");

  const description = escHtml(finding.description || "").replace(/\n/g, "<br>");
  const surveyorNotes = escHtml(finding.surveyor_notes || "").replace(/\n/g, "<br>");

  const immediateAction = escHtml(finding.immediate_action || "").replace(/\n/g, "<br>");
  const containment = escHtml(finding.containment || "").replace(/\n/g, "<br>");
  const rootCause = escHtml(finding.root_cause || "").replace(/\n/g, "<br>");
  const correctiveAction = escHtml(finding.corrective_action || "").replace(/\n/g, "<br>");
  const preventiveAction = escHtml(finding.preventive_action || "").replace(/\n/g, "<br>");
  const monitoringPlan = escHtml(finding.monitoring_plan || "").replace(/\n/g, "<br>");
  const completionDate = escHtml(finding.completion_date || "");
  const signedBy = escHtml(finding.signed_by || "");
  const signedAt = finding.signed_at ? escHtml(String(finding.signed_at).slice(0, 16).replace("T", " ")) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CMS-2567 Plan of Correction - ${findingNum}</title>
<style>
  @page { size: Letter; margin: 14mm 15mm 16mm 15mm; }
  body { font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif; color: #28251D; font-size: 9pt; line-height: 1.4; margin: 0; }
  .header { border-bottom: 2px solid #01696F; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: baseline; }
  .form-id { font-size: 7.5pt; color: #7A7974; letter-spacing: 0.05em; }
  .title { font-size: 14pt; font-weight: 700; color: #01696F; margin-top: 4px; }
  .subtitle { font-size: 9pt; color: #28251D; margin-top: 2px; }
  .lab-row { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 6px; color: #0A3A3D; font-weight: 600; }

  .ident-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; font-size: 8pt; }
  .ident-grid .label { color: #7A7974; text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt; }
  .ident-grid .value { color: #28251D; font-weight: 600; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .col-head { background: #01696F; color: #FFFFFF; font-weight: 700; font-size: 9pt; padding: 5px 8px; letter-spacing: 0.03em; }
  .col-sub { font-size: 7.5pt; font-weight: 500; opacity: 0.85; margin-top: 1px; }
  .col-body { border: 1px solid #D4D1CA; border-top: none; padding: 8px 10px; min-height: 220px; font-size: 8.5pt; }

  .poc-element { margin-top: 6px; padding-top: 4px; border-top: 1px dashed #D4D1CA; }
  .poc-element:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .poc-label { font-size: 7pt; color: #01696F; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
  .poc-content { font-size: 8.5pt; color: #28251D; }
  .poc-content em { color: #7A7974; font-style: italic; }

  .director-block { margin-top: 14px; border: 1.5px solid #01696F; padding: 10px 12px; background: #F7F6F2; }
  .director-title { font-size: 8pt; font-weight: 700; color: #01696F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
  .director-checkbox { display: inline-block; margin-right: 14px; font-size: 8.5pt; }
  .director-checkbox .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #28251D; margin-right: 4px; vertical-align: middle; }
  .director-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8pt; }
  .director-field-label { color: #7A7974; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .director-field-value { border-bottom: 1px solid #28251D; min-height: 16px; padding: 2px 0; font-weight: 600; }
  .director-attestation { margin-top: 8px; font-size: 7.5pt; color: #28251D; font-style: italic; }

  .footer-note { margin-top: 12px; font-size: 7pt; color: #7A7974; border-top: 1px dashed #D4D1CA; padding-top: 6px; }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="form-id">FORM CMS-2567 (compatible) - STATEMENT OF DEFICIENCIES AND PLAN OF CORRECTION</div>
        <div class="title">Plan of Correction</div>
        <div class="subtitle">42 CFR &sect;493 - Clinical Laboratory Improvement Amendments (CLIA)</div>
      </div>
      <div style="text-align:right;font-size:7.5pt;color:#7A7974;">
        Generated ${escHtml(dateGen)}<br>
        Finding ${findingNum}
      </div>
    </div>
    <div class="lab-row"><span>${labName}</span><span>${clia}</span></div>
  </div>

  <div class="ident-grid">
    <div><div class="label">Citation / Standard</div><div class="value">${standardRef}</div></div>
    <div><div class="label">Phase / Severity</div><div class="value">${phase}</div></div>
    <div><div class="label">Receipt Date</div><div class="value">${anchor}</div></div>
    <div><div class="label">Response Due</div><div class="value">${due}</div></div>
    ${inspectionId ? `<div style="grid-column: 1 / span 4;"><div class="label">Inspection / Survey Reference</div><div class="value">${inspectionId}</div></div>` : ""}
  </div>

  <div class="two-col">
    <div>
      <div class="col-head">
        Statement of Deficiencies
        <div class="col-sub">(Surveyor narrative)</div>
      </div>
      <div class="col-body">
        ${description || "<em>No deficiency description recorded.</em>"}
        ${surveyorNotes ? `<div style="margin-top:10px;padding-top:6px;border-top:1px dashed #D4D1CA;"><div class="poc-label">Surveyor Notes</div><div class="poc-content">${surveyorNotes}</div></div>` : ""}
      </div>
    </div>
    <div>
      <div class="col-head">
        Plan of Correction
        <div class="col-sub">(5 POC elements per SOM section 7314)</div>
      </div>
      <div class="col-body">
        ${immediateAction ? `<div class="poc-element"><div class="poc-label">Immediate Action</div><div class="poc-content">${immediateAction}</div></div>` : ""}
        ${containment ? `<div class="poc-element"><div class="poc-label">Containment</div><div class="poc-content">${containment}</div></div>` : ""}
        ${rootCause ? `<div class="poc-element"><div class="poc-label">Root Cause</div><div class="poc-content">${rootCause}</div></div>` : ""}
        <div class="poc-element"><div class="poc-label">1. Corrective Action (for affected patients or items)</div><div class="poc-content">${correctiveAction || "<em>Not recorded.</em>"}</div></div>
        <div class="poc-element"><div class="poc-label">2 + 3. Identify Others Affected and Prevent Recurrence</div><div class="poc-content">${preventiveAction || "<em>Not recorded.</em>"}</div></div>
        <div class="poc-element"><div class="poc-label">4. Ongoing Monitoring</div><div class="poc-content">${monitoringPlan || "<em>Not recorded.</em>"}</div></div>
        <div class="poc-element"><div class="poc-label">5. Completion Date</div><div class="poc-content">${completionDate || "<em>Not recorded.</em>"}</div></div>
      </div>
    </div>
  </div>

  <div class="director-block">
    <div class="director-title">Laboratory Director or Designee Review</div>
    <div>
      <span class="director-checkbox"><span class="box"></span>Accepted</span>
      <span class="director-checkbox"><span class="box"></span>Not accepted, returned for revision</span>
    </div>
    <div class="director-fields">
      <div>
        <div class="director-field-label">Print Name / Initials</div>
        <div class="director-field-value">${signedBy || "&nbsp;"}</div>
      </div>
      <div>
        <div class="director-field-label">Signature</div>
        <div class="director-field-value">&nbsp;</div>
      </div>
      <div>
        <div class="director-field-label">Date</div>
        <div class="director-field-value">${signedAt || "&nbsp;"}</div>
      </div>
    </div>
    <div class="director-attestation">
      Final approval and clinical determination of the Plan of Correction must be made by the laboratory director or designee. The signature above attests that the corrective and preventive actions described are accurate and will be implemented as documented.
    </div>
  </div>

  <div class="footer-note">
    Generated by VeritaResponse&trade; from VeritaAssure&trade;. This document mirrors the structure of CMS Form 2567 and the five Plan of Correction elements required by the State Operations Manual section 7314 (42 CFR &sect;493). Submit through CMS, state, or regional CLIA channels per your facility's standard procedure. Public release of the underlying Statement of Deficiencies follows CMS QSO-25-19-ALL (14 days post-receipt).
  </div>
</body></html>`;
}

export async function generateCms2567PDF(input: Cms2567Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const validation = validateCms2567POC(input.finding);
  if (!validation.ok) {
    throw new Error(`CMS-2567 cannot be rendered: missing ${validation.missing.join(", ")}`);
  }
  const html = buildCms2567HTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// CAP response renderer. Per docs/scoping-veritaresponse.md, CAP has no
// federal-equivalent of CMS's 5 POC elements gate, but consulting judgment
// (per operator) requires at minimum a deficiency description plus a
// corrective action before a response can be submitted to the e-LAB
// Solutions Suite. Validator below mirrors the validateCms2567POC shape
// so the per-accreditor block strategy is uniform across renderers.
export function validateCapResponse(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) {
    return { ok: false, missing: ["finding"] };
  }
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

function buildCapResponseHTML(input: Cms2567Input): string {
  const { finding, user } = input;
  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file, enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const findingNum = escHtml(finding.finding_number || `#${finding.id}`);
  const standardRef = escHtml(finding.standard_ref || "Not recorded");
  const phase = escHtml(finding.phase_or_severity || "Not classified");
  const anchor = escHtml(finding.anchor_date || "Not set");
  const due = escHtml(finding.due_date || "Not computed");
  const inspectionId = escHtml(finding.inspection_id || "");

  const description = escHtml(finding.description || "").replace(/\n/g, "<br>");
  const surveyorNotes = escHtml(finding.surveyor_notes || "").replace(/\n/g, "<br>");

  const immediateAction = escHtml(finding.immediate_action || "").replace(/\n/g, "<br>");
  const containment = escHtml(finding.containment || "").replace(/\n/g, "<br>");
  const rootCause = escHtml(finding.root_cause || "").replace(/\n/g, "<br>");
  const correctiveAction = escHtml(finding.corrective_action || "").replace(/\n/g, "<br>");
  const preventiveAction = escHtml(finding.preventive_action || "").replace(/\n/g, "<br>");
  const monitoringPlan = escHtml(finding.monitoring_plan || "").replace(/\n/g, "<br>");
  const completionDate = escHtml(finding.completion_date || "");
  const signedBy = escHtml(finding.signed_by || "");
  const signedAt = finding.signed_at ? escHtml(String(finding.signed_at).slice(0, 16).replace("T", " ")) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>CAP Plan of Correction Response - ${findingNum}</title>
<style>
  @page { size: Letter; margin: 14mm 15mm 16mm 15mm; }
  body { font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif; color: #28251D; font-size: 9pt; line-height: 1.4; margin: 0; }
  .header { border-bottom: 2px solid #01696F; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: baseline; }
  .form-id { font-size: 7.5pt; color: #7A7974; letter-spacing: 0.05em; }
  .title { font-size: 14pt; font-weight: 700; color: #01696F; margin-top: 4px; }
  .subtitle { font-size: 9pt; color: #28251D; margin-top: 2px; }
  .lab-row { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 6px; color: #0A3A3D; font-weight: 600; }

  .ident-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; font-size: 8pt; }
  .ident-grid .label { color: #7A7974; text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt; }
  .ident-grid .value { color: #28251D; font-weight: 600; }

  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .col-head { background: #01696F; color: #FFFFFF; font-weight: 700; font-size: 9pt; padding: 5px 8px; letter-spacing: 0.03em; }
  .col-sub { font-size: 7.5pt; font-weight: 500; opacity: 0.85; margin-top: 1px; }
  .col-body { border: 1px solid #D4D1CA; border-top: none; padding: 8px 10px; min-height: 220px; font-size: 8.5pt; }

  .resp-element { margin-top: 6px; padding-top: 4px; border-top: 1px dashed #D4D1CA; }
  .resp-element:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .resp-label { font-size: 7pt; color: #01696F; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
  .resp-content { font-size: 8.5pt; color: #28251D; }
  .resp-content em { color: #7A7974; font-style: italic; }

  .director-block { margin-top: 14px; border: 1.5px solid #01696F; padding: 10px 12px; background: #F7F6F2; }
  .director-title { font-size: 8pt; font-weight: 700; color: #01696F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
  .director-checkbox { display: inline-block; margin-right: 14px; font-size: 8.5pt; }
  .director-checkbox .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #28251D; margin-right: 4px; vertical-align: middle; }
  .director-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8pt; }
  .director-field-label { color: #7A7974; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .director-field-value { border-bottom: 1px solid #28251D; min-height: 16px; padding: 2px 0; font-weight: 600; }
  .director-attestation { margin-top: 8px; font-size: 7.5pt; color: #28251D; font-style: italic; }

  .footer-note { margin-top: 12px; font-size: 7pt; color: #7A7974; border-top: 1px dashed #D4D1CA; padding-top: 6px; }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="form-id">CAP CHECKLIST RESPONSE, PLAN OF CORRECTION</div>
        <div class="title">CAP Plan of Correction Response</div>
        <div class="subtitle">Submitted per CAP checklist requirement for the cited item</div>
      </div>
      <div style="text-align:right;font-size:7.5pt;color:#7A7974;">
        Generated ${escHtml(dateGen)}<br>
        Finding ${findingNum}
      </div>
    </div>
    <div class="lab-row"><span>${labName}</span><span>${clia}</span></div>
  </div>

  <div class="ident-grid">
    <div><div class="label">Checklist Item</div><div class="value">${standardRef}</div></div>
    <div><div class="label">Phase / Severity</div><div class="value">${phase}</div></div>
    <div><div class="label">Inspection Date</div><div class="value">${anchor}</div></div>
    <div><div class="label">Response Due</div><div class="value">${due}</div></div>
    ${inspectionId ? `<div style="grid-column: 1 / span 4;"><div class="label">Inspection / Survey Reference</div><div class="value">${inspectionId}</div></div>` : ""}
  </div>

  <div class="two-col">
    <div>
      <div class="col-head">
        CAP Finding
        <div class="col-sub">(Inspector narrative for the cited checklist item)</div>
      </div>
      <div class="col-body">
        ${description || "<em>No deficiency description recorded.</em>"}
        ${surveyorNotes ? `<div style="margin-top:10px;padding-top:6px;border-top:1px dashed #D4D1CA;"><div class="resp-label">Inspector Notes</div><div class="resp-content">${surveyorNotes}</div></div>` : ""}
      </div>
    </div>
    <div>
      <div class="col-head">
        Laboratory Response
        <div class="col-sub">(Required minimum: deficiency description and corrective action)</div>
      </div>
      <div class="col-body">
        ${immediateAction ? `<div class="resp-element"><div class="resp-label">Immediate Action</div><div class="resp-content">${immediateAction}</div></div>` : ""}
        ${containment ? `<div class="resp-element"><div class="resp-label">Containment</div><div class="resp-content">${containment}</div></div>` : ""}
        ${rootCause ? `<div class="resp-element"><div class="resp-label">Root Cause</div><div class="resp-content">${rootCause}</div></div>` : ""}
        <div class="resp-element"><div class="resp-label">Corrective Action</div><div class="resp-content">${correctiveAction || "<em>Not recorded.</em>"}</div></div>
        ${preventiveAction ? `<div class="resp-element"><div class="resp-label">Preventive / System-Level Action</div><div class="resp-content">${preventiveAction}</div></div>` : ""}
        ${monitoringPlan ? `<div class="resp-element"><div class="resp-label">Effectiveness Monitoring</div><div class="resp-content">${monitoringPlan}</div></div>` : ""}
        ${completionDate ? `<div class="resp-element"><div class="resp-label">Completion Date</div><div class="resp-content">${completionDate}</div></div>` : ""}
      </div>
    </div>
  </div>

  <div class="director-block">
    <div class="director-title">Laboratory Director or Designee Review</div>
    <div>
      <span class="director-checkbox"><span class="box"></span>Accepted</span>
      <span class="director-checkbox"><span class="box"></span>Not accepted, returned for revision</span>
    </div>
    <div class="director-fields">
      <div>
        <div class="director-field-label">Print Name / Initials</div>
        <div class="director-field-value">${signedBy || "&nbsp;"}</div>
      </div>
      <div>
        <div class="director-field-label">Signature</div>
        <div class="director-field-value">&nbsp;</div>
      </div>
      <div>
        <div class="director-field-label">Date</div>
        <div class="director-field-value">${signedAt || "&nbsp;"}</div>
      </div>
    </div>
    <div class="director-attestation">
      Final approval and clinical determination of the Plan of Correction rests with the laboratory director or designee. The signature above attests that the corrective and preventive actions described are accurate and will be implemented as documented.
    </div>
  </div>

  <div class="footer-note">
    Generated by VeritaResponse&trade; from VeritaAssure&trade;. This document captures the laboratory's response to a CAP checklist citation. Submit through the CAP e-LAB Solutions Suite per your facility's standard procedure. Tech-specialist follow-up from CAP may extend the review cycle; the response decision target is typically 50 to 75 days from submission.
  </div>
</body></html>`;
}

export async function generateCapResponsePDF(input: Cms2567Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const validation = validateCapResponse(input.finding);
  if (!validation.ok) {
    throw new Error(`CAP response cannot be rendered: missing ${validation.missing.join(", ")}`);
  }
  const html = buildCapResponseHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// TJC Evidence of Standards Compliance (ESC) renderer. Per the May 2024
// TJC update, ESC documentation must include factors impacting patient
// care found during root-cause analysis; the findings schema's common
// spine has no dedicated patient-impact column, so root_cause is the
// catch-all and the PDF labels that section to prompt the user. Minimum
// floor for TJC: description + root_cause + corrective_action.
export function validateTjcEsc(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) {
    return { ok: false, missing: ["finding"] };
  }
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.root_cause || !String(finding.root_cause).trim()) missing.push("Root cause analysis (including patient-impact factors)");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

function buildTjcEscHTML(input: Cms2567Input): string {
  const { finding, user } = input;
  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file, enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const findingNum = escHtml(finding.finding_number || `#${finding.id}`);
  const standardRef = escHtml(finding.standard_ref || "Not recorded");
  const phase = escHtml(finding.phase_or_severity || "Not classified");
  const anchor = escHtml(finding.anchor_date || "Not set");
  const due = escHtml(finding.due_date || "Not computed");
  const inspectionId = escHtml(finding.inspection_id || "");

  const description = escHtml(finding.description || "").replace(/\n/g, "<br>");
  const surveyorNotes = escHtml(finding.surveyor_notes || "").replace(/\n/g, "<br>");

  const immediateAction = escHtml(finding.immediate_action || "").replace(/\n/g, "<br>");
  const containment = escHtml(finding.containment || "").replace(/\n/g, "<br>");
  const rootCause = escHtml(finding.root_cause || "").replace(/\n/g, "<br>");
  const correctiveAction = escHtml(finding.corrective_action || "").replace(/\n/g, "<br>");
  const preventiveAction = escHtml(finding.preventive_action || "").replace(/\n/g, "<br>");
  const monitoringPlan = escHtml(finding.monitoring_plan || "").replace(/\n/g, "<br>");
  const completionDate = escHtml(finding.completion_date || "");
  const signedBy = escHtml(finding.signed_by || "");
  const signedAt = finding.signed_at ? escHtml(String(finding.signed_at).slice(0, 16).replace("T", " ")) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TJC Evidence of Standards Compliance - ${findingNum}</title>
<style>
  @page { size: Letter; margin: 14mm 15mm 16mm 15mm; }
  body { font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif; color: #28251D; font-size: 9pt; line-height: 1.4; margin: 0; }
  .header { border-bottom: 2px solid #01696F; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: baseline; }
  .form-id { font-size: 7.5pt; color: #7A7974; letter-spacing: 0.05em; }
  .title { font-size: 14pt; font-weight: 700; color: #01696F; margin-top: 4px; }
  .subtitle { font-size: 9pt; color: #28251D; margin-top: 2px; }
  .lab-row { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 6px; color: #0A3A3D; font-weight: 600; }

  .ident-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; font-size: 8pt; }
  .ident-grid .label { color: #7A7974; text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt; }
  .ident-grid .value { color: #28251D; font-weight: 600; }

  .section { margin-top: 10px; }
  .section-head { background: #01696F; color: #FFFFFF; font-weight: 700; font-size: 9pt; padding: 5px 8px; letter-spacing: 0.03em; }
  .section-sub { font-size: 7.5pt; font-weight: 500; opacity: 0.85; margin-top: 1px; }
  .section-body { border: 1px solid #D4D1CA; border-top: none; padding: 8px 10px; font-size: 8.5pt; }

  .resp-element { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #D4D1CA; }
  .resp-element:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .resp-label { font-size: 7pt; color: #01696F; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
  .resp-content { font-size: 8.5pt; color: #28251D; }
  .resp-content em { color: #7A7974; font-style: italic; }
  .resp-hint { font-size: 7pt; color: #7A7974; font-style: italic; margin-top: 2px; margin-bottom: 4px; }

  .director-block { margin-top: 14px; border: 1.5px solid #01696F; padding: 10px 12px; background: #F7F6F2; }
  .director-title { font-size: 8pt; font-weight: 700; color: #01696F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
  .director-checkbox { display: inline-block; margin-right: 14px; font-size: 8.5pt; }
  .director-checkbox .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #28251D; margin-right: 4px; vertical-align: middle; }
  .director-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8pt; }
  .director-field-label { color: #7A7974; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .director-field-value { border-bottom: 1px solid #28251D; min-height: 16px; padding: 2px 0; font-weight: 600; }
  .director-attestation { margin-top: 8px; font-size: 7.5pt; color: #28251D; font-style: italic; }

  .footer-note { margin-top: 12px; font-size: 7pt; color: #7A7974; border-top: 1px dashed #D4D1CA; padding-top: 6px; }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="form-id">TJC EVIDENCE OF STANDARDS COMPLIANCE</div>
        <div class="title">TJC ESC Response</div>
        <div class="subtitle">Submitted per TJC standard for the cited Requirement for Improvement</div>
      </div>
      <div style="text-align:right;font-size:7.5pt;color:#7A7974;">
        Generated ${escHtml(dateGen)}<br>
        Finding ${findingNum}
      </div>
    </div>
    <div class="lab-row"><span>${labName}</span><span>${clia}</span></div>
  </div>

  <div class="ident-grid">
    <div><div class="label">RFI / Standard</div><div class="value">${standardRef}</div></div>
    <div><div class="label">Phase / Severity</div><div class="value">${phase}</div></div>
    <div><div class="label">Final Report Posted</div><div class="value">${anchor}</div></div>
    <div><div class="label">Response Due</div><div class="value">${due}</div></div>
    ${inspectionId ? `<div style="grid-column: 1 / span 4;"><div class="label">Inspection / Survey Reference</div><div class="value">${inspectionId}</div></div>` : ""}
  </div>

  <div class="section">
    <div class="section-head">
      Requirement for Improvement
      <div class="section-sub">(Surveyor narrative for the cited standard)</div>
    </div>
    <div class="section-body">
      ${description || "<em>No deficiency description recorded.</em>"}
      ${surveyorNotes ? `<div style="margin-top:10px;padding-top:6px;border-top:1px dashed #D4D1CA;"><div class="resp-label">Surveyor Notes</div><div class="resp-content">${surveyorNotes}</div></div>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      Evidence of Standards Compliance
      <div class="section-sub">(Required minimum: description, root cause with patient-impact factors, corrective action)</div>
    </div>
    <div class="section-body">
      ${immediateAction ? `<div class="resp-element"><div class="resp-label">Immediate Action</div><div class="resp-content">${immediateAction}</div></div>` : ""}
      ${containment ? `<div class="resp-element"><div class="resp-label">Containment</div><div class="resp-content">${containment}</div></div>` : ""}
      <div class="resp-element">
        <div class="resp-label">Root Cause Analysis</div>
        <div class="resp-hint">Per the May 2024 TJC ESC update, document factors impacting patient care found during root-cause analysis.</div>
        <div class="resp-content">${rootCause || "<em>Not recorded.</em>"}</div>
      </div>
      <div class="resp-element"><div class="resp-label">Corrective Action</div><div class="resp-content">${correctiveAction || "<em>Not recorded.</em>"}</div></div>
      ${preventiveAction ? `<div class="resp-element"><div class="resp-label">Preventive / System-Level Action</div><div class="resp-content">${preventiveAction}</div></div>` : ""}
      ${monitoringPlan ? `<div class="resp-element"><div class="resp-label">Effectiveness Monitoring</div><div class="resp-content">${monitoringPlan}</div></div>` : ""}
      ${completionDate ? `<div class="resp-element"><div class="resp-label">Completion Date</div><div class="resp-content">${completionDate}</div></div>` : ""}
    </div>
  </div>

  <div class="director-block">
    <div class="director-title">Laboratory Director or Designee Review</div>
    <div>
      <span class="director-checkbox"><span class="box"></span>Accepted</span>
      <span class="director-checkbox"><span class="box"></span>Not accepted, returned for revision</span>
    </div>
    <div class="director-fields">
      <div>
        <div class="director-field-label">Print Name / Initials</div>
        <div class="director-field-value">${signedBy || "&nbsp;"}</div>
      </div>
      <div>
        <div class="director-field-label">Signature</div>
        <div class="director-field-value">&nbsp;</div>
      </div>
      <div>
        <div class="director-field-label">Date</div>
        <div class="director-field-value">${signedAt || "&nbsp;"}</div>
      </div>
    </div>
    <div class="director-attestation">
      Final approval and clinical determination of the Evidence of Standards Compliance rests with the laboratory director or designee. The signature above attests that the corrective and preventive actions described are accurate and will be implemented as documented.
    </div>
  </div>

  <div class="footer-note">
    Generated by VeritaResponse&trade; from VeritaAssure&trade;. This document captures the laboratory's Evidence of Standards Compliance for a TJC Requirement for Improvement. Submit through Joint Commission Connect under the Survey Process post-survey workflow per your facility's standard procedure. TJC deadline is 60 days from posted final report.
  </div>
</body></html>`;
}

export async function generateTjcEscPDF(input: Cms2567Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const validation = validateTjcEsc(input.finding);
  if (!validation.ok) {
    throw new Error(`TJC ESC cannot be rendered: missing ${validation.missing.join(", ")}`);
  }
  const html = buildTjcEscHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// COLA consultative-narrative renderer. Per docs/scoping-veritaresponse.md
// section 4, COLA is consultative with no hard deadline; the lab's response
// is more about explaining "why this happened and what we changed" than
// hitting a federal regulatory minimum. Minimum gate is just description
// (sanity check, not a regulatory floor) — the lab can iterate on the
// other sections with COLA's free tech support before finalizing.
export function validateColaResponse(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) {
    return { ok: false, missing: ["finding"] };
  }
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  return { ok: missing.length === 0, missing };
}

function buildColaResponseHTML(input: Cms2567Input): string {
  const { finding, user } = input;
  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file, enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const findingNum = escHtml(finding.finding_number || `#${finding.id}`);
  const standardRef = escHtml(finding.standard_ref || "Not recorded");
  const phase = escHtml(finding.phase_or_severity || "Not classified");
  const anchor = escHtml(finding.anchor_date || "Not set");
  const due = escHtml(finding.due_date || "Soft check-in target");
  const inspectionId = escHtml(finding.inspection_id || "");

  const description = escHtml(finding.description || "").replace(/\n/g, "<br>");
  const surveyorNotes = escHtml(finding.surveyor_notes || "").replace(/\n/g, "<br>");

  const immediateAction = escHtml(finding.immediate_action || "").replace(/\n/g, "<br>");
  const containment = escHtml(finding.containment || "").replace(/\n/g, "<br>");
  const rootCause = escHtml(finding.root_cause || "").replace(/\n/g, "<br>");
  const correctiveAction = escHtml(finding.corrective_action || "").replace(/\n/g, "<br>");
  const preventiveAction = escHtml(finding.preventive_action || "").replace(/\n/g, "<br>");
  const monitoringPlan = escHtml(finding.monitoring_plan || "").replace(/\n/g, "<br>");
  const completionDate = escHtml(finding.completion_date || "");
  const signedBy = escHtml(finding.signed_by || "");
  const signedAt = finding.signed_at ? escHtml(String(finding.signed_at).slice(0, 16).replace("T", " ")) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>COLA Consultative Response - ${findingNum}</title>
<style>
  @page { size: Letter; margin: 14mm 15mm 16mm 15mm; }
  body { font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif; color: #28251D; font-size: 9pt; line-height: 1.4; margin: 0; }
  .header { border-bottom: 2px solid #01696F; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: baseline; }
  .form-id { font-size: 7.5pt; color: #7A7974; letter-spacing: 0.05em; }
  .title { font-size: 14pt; font-weight: 700; color: #01696F; margin-top: 4px; }
  .subtitle { font-size: 9pt; color: #28251D; margin-top: 2px; }
  .lab-row { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 6px; color: #0A3A3D; font-weight: 600; }

  .ident-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; font-size: 8pt; }
  .ident-grid .label { color: #7A7974; text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt; }
  .ident-grid .value { color: #28251D; font-weight: 600; }

  .section { margin-top: 10px; }
  .section-head { background: #01696F; color: #FFFFFF; font-weight: 700; font-size: 9pt; padding: 5px 8px; letter-spacing: 0.03em; }
  .section-sub { font-size: 7.5pt; font-weight: 500; opacity: 0.85; margin-top: 1px; }
  .section-body { border: 1px solid #D4D1CA; border-top: none; padding: 8px 10px; font-size: 8.5pt; }

  .resp-element { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #D4D1CA; }
  .resp-element:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .resp-label { font-size: 7pt; color: #01696F; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
  .resp-content { font-size: 8.5pt; color: #28251D; }
  .resp-content em { color: #7A7974; font-style: italic; }
  .resp-hint { font-size: 7pt; color: #7A7974; font-style: italic; margin-top: 2px; margin-bottom: 4px; }

  .director-block { margin-top: 14px; border: 1.5px solid #01696F; padding: 10px 12px; background: #F7F6F2; }
  .director-title { font-size: 8pt; font-weight: 700; color: #01696F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
  .director-checkbox { display: inline-block; margin-right: 14px; font-size: 8.5pt; }
  .director-checkbox .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #28251D; margin-right: 4px; vertical-align: middle; }
  .director-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8pt; }
  .director-field-label { color: #7A7974; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .director-field-value { border-bottom: 1px solid #28251D; min-height: 16px; padding: 2px 0; font-weight: 600; }
  .director-attestation { margin-top: 8px; font-size: 7.5pt; color: #28251D; font-style: italic; }

  .footer-note { margin-top: 12px; font-size: 7pt; color: #7A7974; border-top: 1px dashed #D4D1CA; padding-top: 6px; }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="form-id">COLA CONSULTATIVE RESPONSE</div>
        <div class="title">COLA Response Narrative</div>
        <div class="subtitle">Submitted per COLA consultative model for the cited item</div>
      </div>
      <div style="text-align:right;font-size:7.5pt;color:#7A7974;">
        Generated ${escHtml(dateGen)}<br>
        Finding ${findingNum}
      </div>
    </div>
    <div class="lab-row"><span>${labName}</span><span>${clia}</span></div>
  </div>

  <div class="ident-grid">
    <div><div class="label">Citation</div><div class="value">${standardRef}</div></div>
    <div><div class="label">Severity / Note</div><div class="value">${phase}</div></div>
    <div><div class="label">Notice Date</div><div class="value">${anchor}</div></div>
    <div><div class="label">Soft Check-in Target</div><div class="value">${due}</div></div>
    ${inspectionId ? `<div style="grid-column: 1 / span 4;"><div class="label">Inspection / Survey Reference</div><div class="value">${inspectionId}</div></div>` : ""}
  </div>

  <div class="section">
    <div class="section-head">
      Item Cited by COLA
      <div class="section-sub">(Surveyor or consultant narrative)</div>
    </div>
    <div class="section-body">
      ${description || "<em>No deficiency description recorded.</em>"}
      ${surveyorNotes ? `<div style="margin-top:10px;padding-top:6px;border-top:1px dashed #D4D1CA;"><div class="resp-label">Additional Notes</div><div class="resp-content">${surveyorNotes}</div></div>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      Laboratory Response Narrative
      <div class="section-sub">(Consultative; COLA emphasizes "why this happened and what we learned" over a fixed POC template)</div>
    </div>
    <div class="section-body">
      ${immediateAction ? `<div class="resp-element"><div class="resp-label">Immediate Action Taken</div><div class="resp-content">${immediateAction}</div></div>` : ""}
      ${containment ? `<div class="resp-element"><div class="resp-label">Containment</div><div class="resp-content">${containment}</div></div>` : ""}
      ${rootCause ? `<div class="resp-element"><div class="resp-label">Why This Happened (root cause and lessons learned)</div><div class="resp-content">${rootCause}</div></div>` : `<div class="resp-element"><div class="resp-label">Why This Happened</div><div class="resp-hint">COLA reviewers emphasize the "why" rather than the "what was fixed." Drafting this section is recommended before submission.</div><div class="resp-content"><em>Not yet drafted.</em></div></div>`}
      ${correctiveAction ? `<div class="resp-element"><div class="resp-label">What We Changed</div><div class="resp-content">${correctiveAction}</div></div>` : `<div class="resp-element"><div class="resp-label">What We Changed</div><div class="resp-content"><em>Not yet drafted.</em></div></div>`}
      ${preventiveAction ? `<div class="resp-element"><div class="resp-label">How We Prevent Recurrence</div><div class="resp-content">${preventiveAction}</div></div>` : ""}
      ${monitoringPlan ? `<div class="resp-element"><div class="resp-label">How We'll Watch It Going Forward</div><div class="resp-content">${monitoringPlan}</div></div>` : ""}
      ${completionDate ? `<div class="resp-element"><div class="resp-label">Completion Date</div><div class="resp-content">${completionDate}</div></div>` : ""}
    </div>
  </div>

  <div class="director-block">
    <div class="director-title">Laboratory Director or Designee Review</div>
    <div>
      <span class="director-checkbox"><span class="box"></span>Accepted</span>
      <span class="director-checkbox"><span class="box"></span>Not accepted, returned for revision</span>
    </div>
    <div class="director-fields">
      <div>
        <div class="director-field-label">Print Name / Initials</div>
        <div class="director-field-value">${signedBy || "&nbsp;"}</div>
      </div>
      <div>
        <div class="director-field-label">Signature</div>
        <div class="director-field-value">&nbsp;</div>
      </div>
      <div>
        <div class="director-field-label">Date</div>
        <div class="director-field-value">${signedAt || "&nbsp;"}</div>
      </div>
    </div>
    <div class="director-attestation">
      Final approval and clinical determination of the response narrative rests with the laboratory director or designee. The signature above attests that the corrective and preventive actions described are accurate and will be implemented as documented.
    </div>
  </div>

  <div class="footer-note">
    Generated by VeritaResponse&trade; from VeritaAssure&trade;. COLA operates a consultative accreditation model: there is no hard regulatory deadline for the response, and COLA technical support is available at no extra cost while the lab develops the plan. Use this document as a working draft to share with the COLA consultant; iterate on the "why this happened" section in particular before final submission.
  </div>
</body></html>`;
}

export async function generateColaResponsePDF(input: Cms2567Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const validation = validateColaResponse(input.finding);
  if (!validation.ok) {
    throw new Error(`COLA response cannot be rendered: missing ${validation.missing.join(", ")}`);
  }
  const html = buildColaResponseHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}

// AABB Nonconforming Event Report (NER) working-draft renderer. The
// scoping doc (section 4) notes AABB NER has specific Sections A-M in
// the official form, but section labels aren't authoritatively pinned
// here; the PDF mirrors the established generic-section layout and is
// framed as a working draft the lab transcribes into AABB's actual
// NER form. Minimum gate: description + phase_or_severity (used to
// carry the AABB risk level 1-5) + corrective_action.
export function validateAabbNer(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) {
    return { ok: false, missing: ["finding"] };
  }
  if (!finding.description || !String(finding.description).trim()) missing.push("Nonconformance description");
  if (!finding.phase_or_severity || !String(finding.phase_or_severity).trim()) missing.push("Risk level (1 through 5)");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

function buildAabbNerHTML(input: Cms2567Input): string {
  const { finding, user } = input;
  const labName = escHtml(user?.lab_name || user?.name || "Laboratory");
  const cliaRaw = user?.clia_number || user?.cliaNumber || "";
  const clia = cliaRaw ? escHtml(cliaRaw) : "CLIA: Not on file, enter in account settings";
  const dateGen = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const findingNum = escHtml(finding.finding_number || `#${finding.id}`);
  const standardRef = escHtml(finding.standard_ref || "Not recorded");
  const phase = escHtml(finding.phase_or_severity || "Not classified");
  const anchor = escHtml(finding.anchor_date || "Not set");
  const due = escHtml(finding.due_date || "Event-dependent");
  const inspectionId = escHtml(finding.inspection_id || "");

  const description = escHtml(finding.description || "").replace(/\n/g, "<br>");
  const surveyorNotes = escHtml(finding.surveyor_notes || "").replace(/\n/g, "<br>");

  const immediateAction = escHtml(finding.immediate_action || "").replace(/\n/g, "<br>");
  const containment = escHtml(finding.containment || "").replace(/\n/g, "<br>");
  const rootCause = escHtml(finding.root_cause || "").replace(/\n/g, "<br>");
  const correctiveAction = escHtml(finding.corrective_action || "").replace(/\n/g, "<br>");
  const preventiveAction = escHtml(finding.preventive_action || "").replace(/\n/g, "<br>");
  const monitoringPlan = escHtml(finding.monitoring_plan || "").replace(/\n/g, "<br>");
  const completionDate = escHtml(finding.completion_date || "");
  const signedBy = escHtml(finding.signed_by || "");
  const signedAt = finding.signed_at ? escHtml(String(finding.signed_at).slice(0, 16).replace("T", " ")) : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>AABB Nonconforming Event Report - ${findingNum}</title>
<style>
  @page { size: Letter; margin: 14mm 15mm 16mm 15mm; }
  body { font-family: 'Calibri', 'Helvetica Neue', Arial, sans-serif; color: #28251D; font-size: 9pt; line-height: 1.4; margin: 0; }
  .header { border-bottom: 2px solid #01696F; padding-bottom: 8px; margin-bottom: 10px; }
  .header-top { display: flex; justify-content: space-between; align-items: baseline; }
  .form-id { font-size: 7.5pt; color: #7A7974; letter-spacing: 0.05em; }
  .title { font-size: 14pt; font-weight: 700; color: #01696F; margin-top: 4px; }
  .subtitle { font-size: 9pt; color: #28251D; margin-top: 2px; }
  .lab-row { display: flex; justify-content: space-between; font-size: 8.5pt; margin-top: 6px; color: #0A3A3D; font-weight: 600; }

  .ident-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 4px 12px; margin-bottom: 10px; font-size: 8pt; }
  .ident-grid .label { color: #7A7974; text-transform: uppercase; letter-spacing: 0.04em; font-size: 7pt; }
  .ident-grid .value { color: #28251D; font-weight: 600; }

  .section { margin-top: 10px; }
  .section-head { background: #01696F; color: #FFFFFF; font-weight: 700; font-size: 9pt; padding: 5px 8px; letter-spacing: 0.03em; }
  .section-sub { font-size: 7.5pt; font-weight: 500; opacity: 0.85; margin-top: 1px; }
  .section-body { border: 1px solid #D4D1CA; border-top: none; padding: 8px 10px; font-size: 8.5pt; }

  .resp-element { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #D4D1CA; }
  .resp-element:first-child { margin-top: 0; padding-top: 0; border-top: none; }
  .resp-label { font-size: 7pt; color: #01696F; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 2px; }
  .resp-content { font-size: 8.5pt; color: #28251D; }
  .resp-content em { color: #7A7974; font-style: italic; }
  .resp-hint { font-size: 7pt; color: #7A7974; font-style: italic; margin-top: 2px; margin-bottom: 4px; }

  .working-draft-banner { margin-top: 8px; padding: 6px 10px; background: #FFF3CD; border: 1px solid #E5C97A; border-radius: 3px; font-size: 8pt; color: #6B5A1E; }

  .director-block { margin-top: 14px; border: 1.5px solid #01696F; padding: 10px 12px; background: #F7F6F2; }
  .director-title { font-size: 8pt; font-weight: 700; color: #01696F; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; }
  .director-checkbox { display: inline-block; margin-right: 14px; font-size: 8.5pt; }
  .director-checkbox .box { display: inline-block; width: 10px; height: 10px; border: 1.5px solid #28251D; margin-right: 4px; vertical-align: middle; }
  .director-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; margin-top: 8px; font-size: 8pt; }
  .director-field-label { color: #7A7974; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .director-field-value { border-bottom: 1px solid #28251D; min-height: 16px; padding: 2px 0; font-weight: 600; }
  .director-attestation { margin-top: 8px; font-size: 7.5pt; color: #28251D; font-style: italic; }

  .footer-note { margin-top: 12px; font-size: 7pt; color: #7A7974; border-top: 1px dashed #D4D1CA; padding-top: 6px; }
</style></head><body>
  <div class="header">
    <div class="header-top">
      <div>
        <div class="form-id">AABB NONCONFORMING EVENT REPORT, WORKING DRAFT</div>
        <div class="title">AABB NER Response</div>
        <div class="subtitle">Working draft to transcribe into the official AABB Nonconforming Event Report form</div>
      </div>
      <div style="text-align:right;font-size:7.5pt;color:#7A7974;">
        Generated ${escHtml(dateGen)}<br>
        Event ${findingNum}
      </div>
    </div>
    <div class="lab-row"><span>${labName}</span><span>${clia}</span></div>
  </div>

  <div class="working-draft-banner">
    This document is a working draft of the laboratory's response. Transcribe the final content into the official AABB Nonconforming Event Report (Sections A through M) for submission per your facility's AABB procedure. If this event meets FDA reportable-event criteria, separate FDA notification is required within 45 days of discovery.
  </div>

  <div class="ident-grid">
    <div><div class="label">Event Reference</div><div class="value">${standardRef}</div></div>
    <div><div class="label">Risk Level (1 through 5)</div><div class="value">${phase}</div></div>
    <div><div class="label">Event Date</div><div class="value">${anchor}</div></div>
    <div><div class="label">Target Closure</div><div class="value">${due}</div></div>
    ${inspectionId ? `<div style="grid-column: 1 / span 4;"><div class="label">Inspection / Survey Reference</div><div class="value">${inspectionId}</div></div>` : ""}
  </div>

  <div class="section">
    <div class="section-head">
      Cited Nonconformance
      <div class="section-sub">(Event narrative, surveyor or internal reviewer notes)</div>
    </div>
    <div class="section-body">
      ${description || "<em>No nonconformance description recorded.</em>"}
      ${surveyorNotes ? `<div style="margin-top:10px;padding-top:6px;border-top:1px dashed #D4D1CA;"><div class="resp-label">Reviewer Notes</div><div class="resp-content">${surveyorNotes}</div></div>` : ""}
    </div>
  </div>

  <div class="section">
    <div class="section-head">
      Laboratory Response
      <div class="section-sub">(Required minimum: nonconformance description, risk level, corrective action)</div>
    </div>
    <div class="section-body">
      ${immediateAction ? `<div class="resp-element"><div class="resp-label">Immediate Action</div><div class="resp-content">${immediateAction}</div></div>` : ""}
      ${containment ? `<div class="resp-element"><div class="resp-label">Containment</div><div class="resp-content">${containment}</div></div>` : ""}
      ${rootCause ? `<div class="resp-element"><div class="resp-label">Root Cause Analysis</div><div class="resp-content">${rootCause}</div></div>` : ""}
      <div class="resp-element"><div class="resp-label">Corrective Action (CAPA)</div><div class="resp-content">${correctiveAction || "<em>Not recorded.</em>"}</div></div>
      ${preventiveAction ? `<div class="resp-element"><div class="resp-label">Preventive / System-Level Action</div><div class="resp-content">${preventiveAction}</div></div>` : ""}
      ${monitoringPlan ? `<div class="resp-element"><div class="resp-label">Effectiveness Monitoring</div><div class="resp-content">${monitoringPlan}</div></div>` : ""}
      ${completionDate ? `<div class="resp-element"><div class="resp-label">Completion Date</div><div class="resp-content">${completionDate}</div></div>` : ""}
    </div>
  </div>

  <div class="director-block">
    <div class="director-title">Laboratory Director or Designee Review</div>
    <div>
      <span class="director-checkbox"><span class="box"></span>Accepted</span>
      <span class="director-checkbox"><span class="box"></span>Not accepted, returned for revision</span>
    </div>
    <div class="director-fields">
      <div>
        <div class="director-field-label">Print Name / Initials</div>
        <div class="director-field-value">${signedBy || "&nbsp;"}</div>
      </div>
      <div>
        <div class="director-field-label">Signature</div>
        <div class="director-field-value">&nbsp;</div>
      </div>
      <div>
        <div class="director-field-label">Date</div>
        <div class="director-field-value">${signedAt || "&nbsp;"}</div>
      </div>
    </div>
    <div class="director-attestation">
      Final approval and clinical determination of the response rests with the laboratory director or designee. The signature above attests that the corrective and preventive actions described are accurate and will be implemented as documented before transcription into the official AABB NER form.
    </div>
  </div>

  <div class="footer-note">
    Generated by VeritaResponse&trade; from VeritaAssure&trade;. AABB uses a Nonconforming Event Report (NER) with structured Sections A through M; this PDF captures the response content as a working draft for transcription into the official form. Lead-staff review and CAPA evaluation per your facility's AABB procedure. FDA notification within 45 days is a parallel obligation when the event meets reportable criteria.
  </div>
</body></html>`;
}

export async function generateAabbNerPDF(input: Cms2567Input, licenseCtx?: Partial<LicenseContext> | null): Promise<Buffer> {
  const validation = validateAabbNer(input.finding);
  if (!validation.ok) {
    throw new Error(`AABB NER cannot be rendered: missing ${validation.missing.join(", ")}`);
  }
  const html = buildAabbNerHTML(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(html, "", licenseCtx);
    await page.setContent(stamped.html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "16mm", left: "15mm" },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
