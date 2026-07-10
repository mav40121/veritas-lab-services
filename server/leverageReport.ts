// server/leverageReport.ts
//
// VeritaPace Operations Leverage Report (leverage chain, Phase 4): a one-page,
// director-to-CFO PDF that puts the whole chain on a single defensible page and
// frames the gap as the staff-cut-vs-capital trade-off from Michael Veri's 2019
// productivity methodology. Numbers are assembled upstream (buildForecastResponse,
// already verified); this module only renders.
//
// HTML + puppeteer (shared getBrowser), matching server/orderDocument.ts. Operations
// report (internal director-to-CFO), not a compliance PDF: no signature-on-page-1
// mandate. No em-dashes; "auto-verification" not "auto-validation".

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";

const TEAL = "#01696F";
const DEEP = "#0A3A3D";
const DARK = "#28251D";
const MUTED = "#646e78";
const SECTION = "#E6F2F2";

export interface LeverageReportData {
  goalRatio: number | null;
  annualVolume: number | null;
  hoursPerFte: number;
  annualHourAllowance: number | null;
  weeklyHourAllowance: number | null;
  fteBudget: number | null;
  staffingFte: number | null;
  staffingSource: "grid" | "manual" | "none";
  staffingWeeklyHours: number | null;
  fteGap: number | null;
  projectedProductivity: number | null;
}

export interface LeverageReportCtx {
  labName: string | null;
  cliaNumber: string | null;
  preparedBy: string | null;
  date: string; // YYYY-MM-DD
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const fmtN = (n: number) => Math.round(n).toLocaleString();
const fmt1 = (n: number) => n.toFixed(1);
const fmt3 = (n: number) => n.toFixed(3);

function chainRow(label: string, value: string, opts: { bold?: boolean; color?: string; rule?: boolean } = {}): string {
  const top = opts.rule ? `border-top:1px solid #d2d7dc;` : "";
  const weight = opts.bold ? "700" : "500";
  const color = opts.color || DARK;
  return `<tr><td style="padding:5px 0;${top}font-size:9.5pt;color:${MUTED};">${esc(label)}</td>
    <td style="padding:5px 0;${top}font-size:10pt;font-weight:${weight};color:${color};text-align:right;font-variant-numeric:tabular-nums;">${value}</td></tr>`;
}

export function buildLeverageReportHTML(d: LeverageReportData, ctx: LeverageReportCtx): string {
  const labName = ctx.labName || "Lab name not on file";
  const clia = ctx.cliaNumber || "Not on file - enter in account settings";
  const hasGoal = d.goalRatio != null && d.fteBudget != null && d.annualVolume != null && d.annualVolume > 0;
  const hasStaffing = d.staffingFte != null && d.staffingSource !== "none";

  // Chain table rows.
  let chain = "";
  if (hasGoal) {
    chain += chainRow("Productivity goal (CFO target)", `${(d.goalRatio as number).toFixed(3)} productive hr / test`);
    chain += chainRow("Forecasted annual volume", `${fmtN(d.annualVolume as number)} billable tests`);
    chain += chainRow("Budgeted hour allowance", `${fmtN(d.annualHourAllowance as number)} hr/yr (${fmtN(d.weeklyHourAllowance as number)}/wk)`, { rule: true });
    chain += chainRow("FTE budget at goal", `${fmt1(d.fteBudget as number)} FTE`, { bold: true, color: TEAL });
    if (hasStaffing) {
      const srcLabel = d.staffingSource === "grid" ? "staffing-model FTE need (shift grid)" : "staffing-model FTE need (entered)";
      chain += chainRow(srcLabel, `${fmt1(d.staffingFte as number)} FTE`);
    }
    if (hasStaffing && d.fteGap != null) {
      const gap = d.fteGap as number;
      const gapStr = `${gap > 0 ? "+ " : gap < 0 ? "- " : ""}${fmt1(Math.abs(gap))} FTE`;
      const gapColor = gap > 0.5 ? "#A12C7B" : gap < -0.5 ? "#437A22" : DARK;
      chain += chainRow("GAP (need minus budget)", gapStr, { bold: true, color: gapColor, rule: true });
    }
    if (hasStaffing && d.projectedProductivity != null) {
      chain += chainRow("Projected productivity at the model", fmt3(d.projectedProductivity as number));
    }
  }

  // Grid-only: no saved goal, but a staffing model exists. Show the staffing side of
  // the chain so a director who has built the shift grid but not yet entered a goal
  // gets a useful report instead of an empty page.
  if (!hasGoal && hasStaffing) {
    const srcLabel = d.staffingSource === "grid" ? "Staffing-model FTE need (shift grid)" : "Staffing-model FTE need (entered)";
    chain += chainRow(srcLabel, `${fmt1(d.staffingFte as number)} FTE`, { bold: true, color: TEAL });
    if (d.staffingSource === "grid" && d.staffingWeeklyHours != null && d.staffingWeeklyHours > 0) {
      chain += chainRow("Weekly staffed hours (shift grid)", `${fmtN(d.staffingWeeklyHours as number)} hr/wk`);
      chain += chainRow("Hours per FTE / year (basis)", `${fmtN(d.hoursPerFte)} hr/yr`);
    }
  }

  const chainLabel = hasGoal ? "The leverage chain" : hasStaffing ? "Staffing model" : "The leverage chain";

  const goalNotice = hasGoal
    ? ""
    : hasStaffing
    ? `<div style="margin:8px 0;padding:8px 10px;background:#FCEFE7;border-left:4px solid #964219;font-size:9pt;color:${DARK};">
    A productivity goal is not set yet. The staffing model below is from your shift grid. Enter a goal and forecasted volume in VeritaPace to add the FTE budget and the gap against this model.</div>`
    : `<div style="margin:8px 0;padding:8px 10px;background:#FCEFE7;border-left:4px solid #964219;font-size:9pt;color:${DARK};">
    No productivity goal and volume are set yet. Enter a goal and forecasted volume in VeritaPace to generate the full leverage chain.</div>`;

  // Narrative + trade-off, conditional on the gap.
  let interpretation = "";
  let tradeoff = "";
  if (hasGoal && hasStaffing && d.fteGap != null) {
    const gap = d.fteGap as number;
    if (gap > 0.5) {
      interpretation = `At the ${(d.goalRatio as number).toFixed(3)} productivity target on ${fmtN(d.annualVolume as number)} forecasted billable tests, the budget supports ${fmt1(d.fteBudget as number)} FTE. The staffing model, built from the shifts that cover the lab, needs ${fmt1(d.staffingFte as number)} FTE and projects a productivity of ${fmt3(d.projectedProductivity as number)}. The ${fmt1(gap)} FTE gap is not waste; it is the cost of coverage. Closing it by reducing staff alone risks the consequences below.`;
      tradeoff = `
        <div style="margin-top:6px;">
          <div style="font-weight:700;color:${DARK};font-size:9.5pt;">Option A. Reduce staff to the budget (${fmt1(d.fteBudget as number)} FTE)</div>
          <div style="font-size:9pt;color:${MUTED};margin:2px 0 8px;">Saves roughly ${fmt1(gap)} FTE of labor cost. Risk: night and weekend coverage gaps, overtime spikes, and burnout-driven turnover that can erase the savings.</div>
          <div style="font-weight:700;color:${DARK};font-size:9.5pt;">Option B. Invest to close the gap</div>
          <div style="font-size:9pt;color:${MUTED};margin:2px 0 0;">Automation, auto-verification, and instrument consolidation reduce the labor hours each test requires, lowering the model toward the budget while protecting coverage and staff.</div>
        </div>`;
    } else if (gap < -0.5) {
      interpretation = `At the ${(d.goalRatio as number).toFixed(3)} target on ${fmtN(d.annualVolume as number)} tests, the budget supports ${fmt1(d.fteBudget as number)} FTE while the staffing model needs only ${fmt1(d.staffingFte as number)} FTE. The model is below the budget by ${fmt1(Math.abs(gap))} FTE, a headroom position: the lab is staffed at or under the productivity target. Confirm coverage holds at this level before reallocating the headroom.`;
    } else {
      interpretation = `At the ${(d.goalRatio as number).toFixed(3)} target on ${fmtN(d.annualVolume as number)} tests, the staffing model (${fmt1(d.staffingFte as number)} FTE) is essentially at the budget (${fmt1(d.fteBudget as number)} FTE). The lab is operating close to the productivity target with the current shift build.`;
    }
  } else if (!hasGoal && hasStaffing) {
    const basis = d.staffingSource === "grid" && d.staffingWeeklyHours != null && d.staffingWeeklyHours > 0
      ? `based on ${fmtN(d.staffingWeeklyHours as number)} weekly staffed hours from the shift grid`
      : "as currently entered for the lab";
    interpretation = `The staffing model needs ${fmt1(d.staffingFte as number)} FTE ${basis}. This is the staffing side of the leverage chain. Enter a productivity goal and forecasted annual volume in VeritaPace to compute the FTE budget at that goal and the gap between the budget and this staffing model.`;
  }

  const interpHeading = hasGoal ? "What the gap means" : "What this shows";
  const interpSection = interpretation ? `
    <div style="margin-top:14px;">
      <div style="font-size:10pt;font-weight:700;color:${DEEP};border-bottom:1px solid #d2d7dc;padding-bottom:3px;margin-bottom:6px;">${esc(interpHeading)}</div>
      <div style="font-size:9pt;color:${DARK};line-height:1.5;">${esc(interpretation)}</div>
    </div>` : "";
  const tradeoffSection = tradeoff ? `
    <div style="margin-top:14px;">
      <div style="font-size:10pt;font-weight:700;color:${DEEP};border-bottom:1px solid #d2d7dc;padding-bottom:3px;margin-bottom:6px;">The trade-off</div>
      ${tradeoff}
    </div>` : "";

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Operations Leverage Report</title><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Helvetica Neue', Helvetica, Arial, sans-serif; color:${DARK}; background:white; }
    @page { size:letter; margin:14mm 16mm 18mm 16mm; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid ${TEAL}; padding-bottom:6px; }
    .lab { font-size:14pt; font-weight:700; color:${DEEP}; }
    .clia { font-size:8.5pt; color:${MUTED}; margin-top:2px; }
    .title { font-size:15pt; font-weight:700; color:${TEAL}; margin-top:12px; }
    .subtitle { font-size:8.5pt; color:${MUTED}; margin-top:2px; }
    .chainbox { margin-top:12px; background:#FAFBFC; border:1px solid #e3e7ea; border-left:4px solid ${TEAL}; padding:10px 14px; }
    .chainlabel { font-size:9pt; font-weight:700; color:${DEEP}; text-transform:uppercase; letter-spacing:0.4px; margin-bottom:4px; }
    table.chain { width:100%; border-collapse:collapse; }
    .sign { margin-top:20px; border-top:1px solid #d2d7dc; padding-top:10px; font-size:9pt; color:${DARK}; }
    .sign .line { display:inline-block; border-bottom:1px solid #9aa3ab; min-width:230px; height:1px; vertical-align:bottom; margin:0 6px; }
  </style></head><body>
    <div class="hdr">
      <div><div class="lab">${esc(labName)}</div><div class="clia">CLIA: ${esc(clia)}</div></div>
      <div style="text-align:right;font-size:8.5pt;color:${MUTED};">Prepared ${esc(ctx.date)}${ctx.preparedBy ? `<br>by ${esc(ctx.preparedBy)}` : ""}<br>For laboratory director to CFO review</div>
    </div>
    <div class="title">Operations Leverage Report</div>
    <div class="subtitle">Staffing and productivity forecast</div>
    ${goalNotice}
    <div class="chainbox">
      <div class="chainlabel">${esc(chainLabel)}</div>
      <table class="chain">${chain || `<tr><td style="font-size:9pt;color:${MUTED};padding:4px 0;">Set a goal in VeritaPace to populate the chain.</td></tr>`}</table>
    </div>
    ${interpSection}
    ${tradeoffSection}
    <div class="sign">
      Director recommendation: <span class="line"></span><br><br>
      Signature: <span class="line"></span> &nbsp; Date: <span class="line" style="min-width:120px;"></span>
    </div>
  </body></html>`;
}

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 16mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaPace&trade; leverage reports are generated from the lab's saved productivity goal, volume forecast, and staffing grid. Final staffing and capital decisions are the responsibility of the laboratory director or designee.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure&trade; | VeritaPace&trade; | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

export async function generateLeverageReportPDF(d: LeverageReportData, ctx: LeverageReportCtx): Promise<Buffer> {
  const html = buildLeverageReportHTML(d, ctx);
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
      margin: { top: "14mm", right: "16mm", bottom: "18mm", left: "16mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}
