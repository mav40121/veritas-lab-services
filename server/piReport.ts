// server/piReport.ts
//
// VeritaBench per-PI monthly Performance Indicator report: a one-page PDF for a
// single quality indicator, showing each month's value against the lab's
// benchmark bands, the trend, YTD unweighted + volume-weighted pooled rate, and
// a laboratory-director-or-designee review line. HTML + puppeteer (shared
// getBrowser), matching server/leverageReport.ts. No em-dashes (public artifact).

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";

const TEAL = "#01696F";
const DARK = "#28251D";
const MUTED = "#646e78";
const GREEN = "#437A22";
const AMBER = "#964219";
const RED = "#A12C7B";
const TINT = "#E6F2F2";
const ALT = "#EBF3F8";

export interface PiMetric {
  name: string;
  unit: string | null;
  direction: string | null; // "lower_is_better" | "higher_is_better"
  benchmark_green: number | null;
  benchmark_yellow: number | null;
  benchmark_red: number | null;
  department?: string | null;
}
export interface PiEntry { year: number; month: number; value: number | null; volume: number | null; notes: string | null; }
export interface PiReportCtx { labName: string | null; cliaNumber: string | null; preparedBy: string | null; year: number; }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number | null | undefined, d = 1) => (n == null || !isFinite(n) ? "" : n.toFixed(d));

type Status = { label: string; color: string } | null;

function statusFor(m: PiMetric, v: number | null): Status {
  if (v == null || m.benchmark_green == null) return null;
  const higher = (m.direction || "lower_is_better") === "higher_is_better";
  const g = m.benchmark_green, y = m.benchmark_yellow;
  if (higher) {
    if (v >= g) return { label: "On target", color: GREEN };
    if (y != null && v >= y) return { label: "Watch", color: AMBER };
    return { label: "Action", color: RED };
  }
  if (v <= g) return { label: "On target", color: GREEN };
  if (y != null && v <= y) return { label: "Watch", color: AMBER };
  return { label: "Action", color: RED };
}

// Inline SVG trend: benchmark band shading + threshold lines + monthly points.
function trendSvg(m: PiMetric, points: { month: number; value: number }[]): string {
  const W = 660, H = 210, padL = 40, padR = 12, padT = 22, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = points.map((p) => p.value);
  const thr = [m.benchmark_green, m.benchmark_yellow, m.benchmark_red].filter((x): x is number => x != null);
  const lo = Math.min(0, ...vals, ...thr);
  const hi = Math.max(...vals, ...thr, lo + 1) * 1.12 || 1;
  const x = (mo: number) => padL + (plotW * (mo - 1)) / 11;
  const y = (v: number) => padT + plotH - (plotH * (v - lo)) / (hi - lo);
  const higher = (m.direction || "lower_is_better") === "higher_is_better";
  const g = m.benchmark_green, yv = m.benchmark_yellow;
  let bands = "";
  if (g != null) {
    // green zone (good side of green), red zone (bad side of yellow), amber between
    if (higher) {
      bands += `<rect x="${padL}" y="${y(hi)}" width="${plotW}" height="${y(g) - y(hi)}" fill="${GREEN}" opacity="0.09"/>`;
      if (yv != null) bands += `<rect x="${padL}" y="${y(yv)}" width="${plotW}" height="${padT + plotH - y(yv)}" fill="${RED}" opacity="0.07"/>`;
    } else {
      bands += `<rect x="${padL}" y="${y(g)}" width="${plotW}" height="${padT + plotH - y(g)}" fill="${GREEN}" opacity="0.09"/>`;
      if (yv != null) bands += `<rect x="${padL}" y="${y(hi)}" width="${plotW}" height="${y(yv) - y(hi)}" fill="${RED}" opacity="0.07"/>`;
    }
  }
  const line = (v: number, col: string) => `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" stroke="${col}" stroke-width="1" stroke-dasharray="4 3"/>`;
  const thrLines = (g != null ? line(g, GREEN) : "") + (yv != null ? line(yv, RED) : "");
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.month).toFixed(1)} ${y(p.value).toFixed(1)}`).join(" ");
  const dots = points.map((p) => `<circle cx="${x(p.month).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.2" fill="${TEAL}"/>` +
    `<text x="${x(p.month).toFixed(1)}" y="${(y(p.value) - 7).toFixed(1)}" font-size="8" fill="${DARK}" text-anchor="middle">${num(p.value)}</text>`).join("");
  const xlabels = MONTHS.map((mo, i) => `<text x="${x(i + 1).toFixed(1)}" y="${H - 8}" font-size="8" fill="${MUTED}" text-anchor="middle">${mo}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif">
    ${bands}${thrLines}
    <path d="${path}" fill="none" stroke="${TEAL}" stroke-width="2"/>
    ${dots}${xlabels}
  </svg>`;
}

export function buildPiReportHTML(m: PiMetric, entries: PiEntry[], ctx: PiReportCtx): string {
  const unit = m.unit || "";
  const byMonth = new Map<number, PiEntry>();
  for (const e of entries) if (e.value != null) byMonth.set(e.month, e);
  const present = [...byMonth.values()].sort((a, b) => a.month - b.month);
  const points = present.map((e) => ({ month: e.month, value: e.value as number }));

  const vals = present.map((e) => e.value as number);
  const ytdAvg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const withVol = present.filter((e) => e.volume != null && (e.volume as number) > 0);
  const volSum = withVol.reduce((a, e) => a + (e.volume as number), 0);
  const pooled = volSum > 0 ? withVol.reduce((a, e) => a + (e.value as number) * (e.volume as number), 0) / volSum : null;
  const onTarget = present.filter((e) => statusFor(m, e.value)?.label === "On target").length;
  const last = present[present.length - 1];
  const lastStatus = last ? statusFor(m, last.value) : null;

  const dir = (m.direction || "lower_is_better") === "higher_is_better" ? "Higher is better" : "Lower is better";
  const bench = m.benchmark_green != null
    ? `Target ${(m.direction === "higher_is_better") ? ">=" : "<="} ${num(m.benchmark_green)}${unit}` +
      (m.benchmark_yellow != null ? ` ; Watch to ${num(m.benchmark_yellow)}${unit}` : "") +
      (m.benchmark_red != null ? ` ; Action beyond ${num(m.benchmark_red)}${unit}` : "")
    : "Not set";

  const rows = present.map((e, i) => {
    const st = statusFor(m, e.value);
    const bg = i % 2 === 1 ? ALT : "#fff";
    return `<tr style="background:${bg}">
      <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${MONTHS[e.month - 1]} ${ctx.year}</td>
      <td style="padding:4px 6px;border:0.5px solid #d0d0d0;text-align:right;font-variant-numeric:tabular-nums;">${num(e.value)}${unit}</td>
      <td style="padding:4px 6px;border:0.5px solid #d0d0d0;text-align:right;">${e.volume != null ? Number(e.volume).toLocaleString() : ""}</td>
      <td style="padding:4px 6px;border:0.5px solid #d0d0d0;font-weight:700;color:${st ? st.color : MUTED};">${st ? st.label : ""}</td>
      <td style="padding:4px 6px;border:0.5px solid #d0d0d0;font-size:8.5pt;">${esc(e.notes || "")}</td>
    </tr>`;
  }).join("");

  const chart = points.length ? trendSvg(m, points) : `<div style="color:${MUTED};font-size:9pt;padding:24px 0;">No monthly values entered for ${ctx.year} yet.</div>`;

  const summaryParts: string[] = [];
  if (ytdAvg != null) summaryParts.push(`Year-to-date average (unweighted): <b>${num(ytdAvg, 2)}${unit}</b>.`);
  if (pooled != null) summaryParts.push(`Year-to-date pooled rate (volume-weighted across ${volSum.toLocaleString()}): <b>${num(pooled, 2)}${unit}</b>.`);
  if (m.benchmark_green != null) summaryParts.push(`Months on target: <b>${onTarget} of ${present.length}</b>.`);
  if (last && lastStatus) summaryParts.push(`Most recent (${MONTHS[last.month - 1]} ${ctx.year}): <b>${num(last.value)}${unit}, ${lastStatus.label}</b>.`);
  if (pooled != null) summaryParts.push("The pooled rate weights each month by its volume and is the surveyor-facing figure.");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; color: ${DARK}; margin: 0; font-size: 10pt; }
    h2 { color: ${TEAL}; font-size: 12pt; margin: 14px 0 5px; }
    table { border-collapse: collapse; width: 100%; }
  </style></head><body>
    <div style="background:${TEAL};color:#fff;padding:12px 14px;border-radius:6px;">
      <div style="font-size:16pt;font-weight:700;">Performance Indicator Report</div>
      <div style="font-size:9.5pt;opacity:0.92;">Prepared for: ${esc(ctx.labName || "Lab name not on file")}    CLIA: ${esc(ctx.cliaNumber || "Not on file - enter in account settings")}</div>
    </div>
    <table style="margin-top:12px;font-size:9pt;">
      <tr>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;width:120px;">Indicator</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${esc(m.name)}</td>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;width:95px;">Department</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${esc(m.department || "Not specified")}</td>
      </tr>
      <tr>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;">Unit</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${esc(unit || "count")}</td>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;">Direction</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${dir}</td>
      </tr>
      <tr>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;">Reporting period</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">Calendar year ${ctx.year}</td>
        <td style="background:${TINT};font-weight:700;padding:4px 6px;border:0.5px solid #d0d0d0;">Benchmark</td>
        <td style="padding:4px 6px;border:0.5px solid #d0d0d0;">${esc(bench)}</td>
      </tr>
    </table>
    <div style="margin-top:14px;">${chart}</div>
    <table style="margin-top:6px;font-size:9pt;">
      <thead><tr style="background:${TEAL};color:#fff;">
        <th style="padding:5px 6px;text-align:left;">Month</th>
        <th style="padding:5px 6px;text-align:right;">Value</th>
        <th style="padding:5px 6px;text-align:right;">Volume</th>
        <th style="padding:5px 6px;text-align:left;">Status</th>
        <th style="padding:5px 6px;text-align:left;">Notes</th>
      </tr></thead>
      <tbody>${rows || `<tr><td colspan="5" style="padding:8px;color:${MUTED};border:0.5px solid #d0d0d0;">No entries for ${ctx.year}.</td></tr>`}</tbody>
    </table>
    <h2>Summary</h2>
    <div style="font-size:9.5pt;line-height:1.5;">${summaryParts.join(" ") || "No data entered for this indicator yet."}</div>
    <h2>Review</h2>
    <div style="font-size:9.5pt;margin-top:2px;">
      Reviewed by (laboratory director or designee): ________________________&nbsp;&nbsp;
      Title: ____________&nbsp;&nbsp; Date: __________
    </div>
  </body></html>`;
}

const FOOTER_TEMPLATE =
  `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#7A7974;padding:0 16mm;">` +
  `VeritaAssure&#8482; | VeritaBench&#8482; | Confidential - For Internal Lab Use Only | Page <span class="pageNumber"></span> of <span class="totalPages"></span>` +
  `</div>`;

export async function generatePiReportPDF(m: PiMetric, entries: PiEntry[], ctx: PiReportCtx): Promise<Buffer> {
  const html = buildPiReportHTML(m, entries, ctx);
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
      margin: { top: "12mm", right: "14mm", bottom: "16mm", left: "14mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}
