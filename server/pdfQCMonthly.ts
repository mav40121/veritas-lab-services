/**
 * VeritaQC Phase 1D monthly review PDF.
 * Pattern mirrors server/pdfReport.ts (Puppeteer + HTML template).
 * One PDF per (lab, control_lot, year, month). Single lot per PDF — lab can
 * generate one for each lot at month end. Signature/attestation block is on
 * page 1 per CLAUDE.md §5.
 */

import puppeteer from "puppeteer";
import { stampPdfAuthor } from "./pdfMeta";

export interface MonthlyReviewLot {
  id: number;
  analyte: string;
  level: string;
  lot_number: string;
  manufacturer: string | null;
  mfr_mean: number;
  mfr_sd: number;
  mfr_sd_interval: number;
}

export interface MonthlyReviewResult {
  id: number;
  result_value: number;
  result_date: string;
  run_time: string | null;
  instrument: string | null;
  accepted_for_reporting: number;
  violations: { rule_code: string; severity: string; detail: string | null }[];
  corrective_actions: { action_taken: string; status: string; taken_at: string }[];
}

export interface MonthlyReviewPayload {
  lab: { id: number; lab_name: string; clia_number: string | null };
  lot: MonthlyReviewLot;
  periodYear: number;
  periodMonth: number; // 1-12
  results: MonthlyReviewResult[];
  baselineMean: number | null; // null if no accepted history; falls back to mfr_mean
  baselineSD: number | null;
  reviewerName: string;
  reviewerTitle: string;
  reviewerDate: string; // ISO date
  attestationAcknowledged: boolean;
}

const CSS = `
  body { font-family: Helvetica, Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 16mm 14mm 22mm; font-size: 9pt; }
  h1 { font-size: 14pt; margin: 0 0 2pt; color: #01696F; }
  h2 { font-size: 11pt; margin: 12pt 0 4pt; color: #01696F; border-bottom: 1px solid #d0d0d0; padding-bottom: 2pt; }
  .meta { font-size: 8pt; color: #555; margin-bottom: 6pt; }
  .meta b { color: #1a1a1a; }
  .narrative { font-size: 9pt; line-height: 1.35; margin: 4pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  th, td { border-bottom: 1px solid #e0e0e0; padding: 3pt 4pt; text-align: left; vertical-align: top; }
  th { background: #01696F; color: #fff; font-weight: 600; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.4pt; }
  tr:nth-child(even) td { background: #f7fafc; }
  .text-right { text-align: right; }
  .num { font-variant-numeric: tabular-nums; }
  .rule { display: inline-block; padding: 0 4pt; border-radius: 3pt; font-size: 7pt; font-weight: 600; margin-right: 3pt; }
  .rule.rejection { background: #fde2e2; color: #a12c7b; }
  .rule.warning { background: #fef2cc; color: #964219; }
  .pill { display: inline-block; padding: 1pt 5pt; border-radius: 8pt; font-size: 7pt; font-weight: 600; background: #e6f2f2; color: #01696F; }
  .ack { border: 1px solid #01696F; border-radius: 4pt; padding: 8pt 10pt; margin-top: 8pt; background: #f4fafa; }
  .ack-row { display: flex; gap: 12pt; align-items: flex-end; margin-top: 6pt; font-size: 9pt; }
  .ack-label { font-size: 7.5pt; color: #555; text-transform: uppercase; letter-spacing: 0.5pt; }
  .ack-value { border-bottom: 1px solid #1a1a1a; min-width: 110pt; padding-bottom: 1pt; min-height: 12pt; }
  .footer-disclaim { font-size: 7pt; color: #777; margin-top: 6pt; }
  svg { display: block; }
`;

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&trade; | VeritaQC&trade; | Confidential - For Internal Lab Use Only</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

function escapeHtml(s: any): string {
  return String(s ?? "").replace(/[<>&"]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[ch] || ch));
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// SVG Levey-Jennings chart. Width 540px, height 180px. X axis = run index
// (positional, not date-spaced), Y axis = SDI from -4 to +4 using the
// baseline mean/SD. Bands shaded per Westgard convention: green within
// 2SD, amber 2-3SD, red beyond 3SD. Points are colored by their SDI band.
function renderLJSVG(results: MonthlyReviewResult[], mean: number, sd: number): string {
  if (results.length === 0 || sd <= 0) {
    return `<div style="text-align:center;color:#888;padding:18pt 0;font-size:8pt">No accepted results to plot.</div>`;
  }
  const W = 540, H = 180, PL = 36, PR = 8, PT = 10, PB = 22;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  // Newest first arrives from caller; reverse to chronological left-to-right.
  const points = [...results].reverse();
  const n = points.length;
  const sdMin = -4, sdMax = 4;
  const yFor = (sdi: number) => PT + innerH * (1 - (sdi - sdMin) / (sdMax - sdMin));
  const xFor = (i: number) => PL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  // Background SDI bands (full chart width).
  const bandHtml = [
    { y1: -4, y2: -3, fill: "#fde2e2" },
    { y1: -3, y2: -2, fill: "#fef2cc" },
    { y1: -2,  y2:  2, fill: "#e3f2e1" },
    { y1:  2,  y2:  3, fill: "#fef2cc" },
    { y1:  3,  y2:  4, fill: "#fde2e2" },
  ].map(b => `<rect x="${PL}" y="${yFor(b.y2)}" width="${innerW}" height="${yFor(b.y1) - yFor(b.y2)}" fill="${b.fill}" />`).join("");
  // Reference lines at 0, ±1, ±2, ±3.
  const refLines = [-3, -2, -1, 0, 1, 2, 3].map(sdi => {
    const y = yFor(sdi);
    const stroke = sdi === 0 ? "#01696F" : "#a0a0a0";
    const sw = sdi === 0 ? 1.2 : 0.5;
    const dash = sdi === 0 ? "" : "stroke-dasharray=\"2,2\"";
    return `<line x1="${PL}" y1="${y}" x2="${PL + innerW}" y2="${y}" stroke="${stroke}" stroke-width="${sw}" ${dash} />`;
  }).join("");
  // Y axis labels.
  const yLabels = [-3, -2, -1, 0, 1, 2, 3].map(sdi => {
    const y = yFor(sdi);
    return `<text x="${PL - 4}" y="${y + 3}" font-size="7" fill="#555" text-anchor="end">${sdi > 0 ? "+" : ""}${sdi}</text>`;
  }).join("");
  // Point + connecting polyline.
  const sdis = points.map(r => (r.result_value - mean) / sd);
  const polyPts = sdis.map((s, i) => `${xFor(i)},${yFor(s)}`).join(" ");
  const polyline = `<polyline points="${polyPts}" fill="none" stroke="#1a1a1a" stroke-width="0.7" />`;
  const dots = sdis.map((s, i) => {
    const color = Math.abs(s) > 3 ? "#dc2626" : Math.abs(s) > 2 ? "#d97706" : "#16a34a";
    return `<circle cx="${xFor(i)}" cy="${yFor(s)}" r="2.5" fill="${color}" stroke="#fff" stroke-width="0.5" />`;
  }).join("");
  const xLabel = `<text x="${PL + innerW / 2}" y="${H - 4}" font-size="7" fill="#555" text-anchor="middle">Run sequence (oldest left to newest right, n=${n})</text>`;
  const yAxisLabel = `<text x="10" y="${PT + innerH / 2}" font-size="7" fill="#555" text-anchor="middle" transform="rotate(-90,10,${PT + innerH / 2})">SDI from baseline mean</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">${bandHtml}${refLines}${yLabels}${polyline}${dots}${xLabel}${yAxisLabel}</svg>`;
}

export function buildMonthlyReviewHTML(p: MonthlyReviewPayload): string {
  const periodLabel = `${MONTH_NAMES[p.periodMonth]} ${p.periodYear}`;
  const mean = p.baselineMean ?? p.lot.mfr_mean;
  const sd = p.baselineSD ?? p.lot.mfr_sd;
  const sdSource = p.baselineSD !== null ? "Lab cumulative" : "Manufacturer (lab baseline not yet established)";

  // Aggregate violation + CA counts for the narrative
  let totalRejections = 0, totalWarnings = 0, missingCA = 0;
  for (const r of p.results) {
    for (const v of r.violations) {
      if (v.severity === "rejection") totalRejections++;
      else if (v.severity === "warning") totalWarnings++;
    }
    if (r.violations.some(v => v.severity === "rejection") && r.corrective_actions.length === 0) missingCA++;
  }

  // Wave A7 (2026-06-07): Westgard rule glossary block.
  // Surveyors do not all read "1-3s" and "R-4s" fluently. Listing the
  // plain-English description for every rule that fired in this period
  // removes the jargon barrier without changing evaluator logic. Rule
  // descriptions match the conditions in routes.ts evaluator (lines
  // ~2086-2128). Source: Westgard JO, Barry PL, Hunt MR, Groth T (1981)
  // "A multi-rule Shewhart chart for quality control in clinical chemistry."
  // Clin Chem 27(3):493-501; CLSI EP23-A.
  function ruleDescription(code: string): string {
    if (code === "1-3s") return "One control result outside +/- 3 SD from the baseline mean. Rejection rule.";
    if (code === "1-2s") return "One control result outside +/- 2 SD from the baseline mean. Warning only; investigate before reporting.";
    if (code === "2-2s") return "Two consecutive results outside the same +2 SD or -2 SD limit. Rejection rule.";
    if (code === "R-4s") return "Range between two consecutive results exceeds 4 SD. Rejection rule.";
    if (code === "4-1s") return "Four consecutive results outside the same +1 SD or -1 SD limit on the same side of the mean. Rejection rule.";
    const biasMatch = code.match(/^(\d+)-x$/);
    if (biasMatch) return `${biasMatch[1]} consecutive results on the same side of the baseline mean (bias). Rejection rule.`;
    const trendMatch = code.match(/^(\d+)-T$/);
    if (trendMatch) return `${trendMatch[1]} consecutive results all trending in the same direction. Rejection rule.`;
    return "";
  }
  const seenRules = new Set<string>();
  for (const r of p.results) {
    for (const v of r.violations) {
      if (!seenRules.has(v.rule_code)) seenRules.add(v.rule_code);
    }
  }
  const glossaryRows = Array.from(seenRules)
    .sort()
    .map(code => {
      const desc = ruleDescription(code);
      if (!desc) return "";
      return `<tr><td style="white-space:nowrap;font-weight:600">${escapeHtml(code)}</td><td>${escapeHtml(desc)}</td></tr>`;
    })
    .filter(Boolean)
    .join("");
  const ruleGlossaryHtml = glossaryRows.length === 0
    ? ""
    : `<h2>Westgard Rule Reference</h2>
       <div style="font-size:7.5pt;color:#555;margin-bottom:4pt">Plain-English description of every rule that fired in this period. Reference: Westgard JO et al. (1981), Clin Chem 27(3):493-501; CLSI EP23-A.</div>
       <table>
         <thead><tr><th style="width:18%">Rule</th><th>Description</th></tr></thead>
         <tbody>${glossaryRows}</tbody>
       </table>`;

  const rowsHtml = p.results.length === 0
    ? `<tr><td colspan="6" style="text-align:center;color:#888;padding:8pt">No results logged for this period.</td></tr>`
    : p.results.map(r => {
        const sdi = sd > 0 ? ((r.result_value - mean) / sd).toFixed(2) : "n/a";
        const rulesHtml = r.violations.length === 0
          ? `<span style="color:#888;font-size:7pt">none</span>`
          : r.violations.map(v => `<span class="rule ${v.severity === "rejection" ? "rejection" : "warning"}">${escapeHtml(v.rule_code)}</span>`).join("");
        return `<tr>
          <td>${escapeHtml(r.result_date)}</td>
          <td class="num">${r.result_value}</td>
          <td class="num">${sdi}</td>
          <td>${escapeHtml(r.instrument || "-")}</td>
          <td>${rulesHtml}</td>
          <td>${r.accepted_for_reporting === 1 ? "Accepted" : "Excluded"}</td>
        </tr>`;
      }).join("");

  const caRows: string[] = [];
  for (const r of p.results) {
    for (const ca of r.corrective_actions) {
      caRows.push(`<tr>
        <td>${escapeHtml(r.result_date)}</td>
        <td class="num">${r.result_value}</td>
        <td>${escapeHtml(ca.taken_at.slice(0, 10))}</td>
        <td>${escapeHtml(ca.status)}</td>
        <td>${escapeHtml(ca.action_taken)}</td>
      </tr>`);
    }
  }
  const caTableHtml = caRows.length === 0
    ? `<div style="font-size:8pt;color:#666;padding:4pt 0">No corrective actions filed for this period.</div>`
    : `<table><thead><tr><th>QC Date</th><th>Value</th><th>CA Filed</th><th>Status</th><th>Action Taken</th></tr></thead><tbody>${caRows.join("")}</tbody></table>`;

  const narrative = `Monthly QC review for <b>${escapeHtml(p.lot.analyte)}</b> (Lot ${escapeHtml(p.lot.lot_number)}, ${escapeHtml(p.lot.level)} level) covering ${periodLabel}. ${p.results.length} run${p.results.length === 1 ? "" : "s"} logged: ${totalRejections} rejection-rule fire${totalRejections === 1 ? "" : "s"}, ${totalWarnings} warning${totalWarnings === 1 ? "" : "s"}, ${missingCA} result${missingCA === 1 ? "" : "s"} with a rejection but no corrective action filed. Baseline mean ${mean.toFixed(3)}, SD ${sd.toFixed(3)} (${sdSource}). Final review and any clinical determination must be made by the laboratory director or designee.`;

  const ackBox = `
    <div class="ack">
      <div style="font-weight:600;color:#01696F;font-size:9pt;margin-bottom:4pt">MONTHLY REVIEW ATTESTATION</div>
      <div style="font-size:8pt;line-height:1.4">
        The reviewer attests that all QC runs in this period have been reviewed, that corrective actions taken at the time of each event are appropriately documented above, and that any unresolved issues have been escalated to the laboratory director or designee under the lab's non-conformance event process.
      </div>
      <div class="ack-row">
        <div>
          <div class="ack-label">Reviewer (medical director or designee)</div>
          <div class="ack-value">${escapeHtml(p.reviewerName)}</div>
        </div>
        <div>
          <div class="ack-label">Title</div>
          <div class="ack-value">${escapeHtml(p.reviewerTitle)}</div>
        </div>
        <div>
          <div class="ack-label">Date</div>
          <div class="ack-value">${escapeHtml(p.reviewerDate)}</div>
        </div>
        <div>
          <div class="ack-label">Acknowledged</div>
          <div class="ack-value">${p.attestationAcknowledged ? "YES" : "____"}</div>
        </div>
      </div>
      <div style="margin-top:14pt">
        <div class="ack-label">Signature</div>
        <div style="border-bottom:1px solid #333;height:22pt"></div>
      </div>
    </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VeritaQC Monthly Review</title><style>${CSS}</style></head><body>
    <h1>VeritaQC&trade; Monthly Review</h1>
    <div class="meta">
      <b>${escapeHtml(p.lab.lab_name)}</b>${p.lab.clia_number ? ` &middot; CLIA ${escapeHtml(p.lab.clia_number)}` : ` &middot; CLIA: Not on file - enter in account settings`}<br/>
      Analyte <b>${escapeHtml(p.lot.analyte)}</b> &middot; Lot ${escapeHtml(p.lot.lot_number)} (${escapeHtml(p.lot.level)} level) &middot; ${escapeHtml(p.lot.manufacturer || "Manufacturer not on file")}<br/>
      Period: <b>${periodLabel}</b>
    </div>
    <div class="narrative">${narrative}</div>
    ${ackBox}

    <h2>Levey-Jennings Chart (SDI from baseline mean)</h2>
    ${renderLJSVG(p.results, mean, sd)}

    <h2>QC Runs (${p.results.length})</h2>
    <table>
      <thead><tr><th>Date</th><th>Value</th><th>SDI</th><th>Instrument</th><th>Rules</th><th>Reporting</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>

    ${ruleGlossaryHtml}

    <h2>Corrective Actions Log</h2>
    ${caTableHtml}

    <div class="footer-disclaim">
      VeritaQC&trade; is a statistical tool for qualified laboratory professionals. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.
    </div>
  </body></html>`;
}

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

export async function renderMonthlyReviewPDF(payload: MonthlyReviewPayload): Promise<Buffer> {
  const html = buildMonthlyReviewHTML(payload);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const buf = await page.pdf({
      format: "letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "16mm", right: "14mm", bottom: "22mm", left: "14mm" },
    });
    return stampPdfAuthor(buf);
  } finally {
    await page.close();
  }
}
