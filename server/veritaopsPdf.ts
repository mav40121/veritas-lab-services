// VeritaOps CPRT study PDF. Internal-use report giving a lab director or
// CFO a transparent, defensible cost-per-reportable-test breakdown across
// all four layers. Not a compliance document (no director signature
// required per CLAUDE.md Section 5 - VeritaScan and VeritaLab carry the
// same "internal-use" framing for the same reason).
//
// Conceptual basis: CLSI GP11-A "Basic Cost Accounting for Clinical
// Services". The About paragraph at the bottom of every report cites it
// so a reader can verify the methodology against the source document.
import { getBrowser } from "./pdfReport";

export interface CprtStudyForPdf {
  id: number;
  test_name: string;
  loinc?: string | null;
  department?: string | null;
  annual_volume: number;
  reagent_cost_per_test: number;
  calibrator_kit_cost: number;
  cals_per_year: number;
  qc_cost_per_run: number;
  qc_runs_per_year: number;
  other_supplies_per_test: number;
  tech_minutes_per_test: number;
  tech_loaded_hourly_rate: number;
  include_capital: number;
  instrument_purchase_cost: number;
  instrument_useful_life_years: number;
  annual_maintenance_cost: number;
  include_overhead: number;
  overhead_method: string;
  overhead_value: number;
  cprt_l1: number;
  cprt_l2: number;
  cprt_l3: number;
  cprt_l4: number;
  notes?: string | null;
  updated_at?: string | null;
}

export interface CprtLabContext {
  labName: string;
  cliaNumber: string;
  preparedBy?: string | null;
}

const TEAL = "#01696F";
const TEAL_TINT = "#E6F2F2";
const TEXT_DARK = "#28251D";

function fmtCurrency(n: number | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString("en-US");
}
function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaOps&trade; cost-per-reportable-test reports are internal financial worksheets. Numbers reflect the assumptions entered by the user; final cost decisions are the responsibility of the laboratory director or designee in coordination with finance.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure&trade; | VeritaOps&trade; | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

function buildCprtHtml(study: CprtStudyForPdf, ctx: CprtLabContext): string {
  const labName = escapeHtml(ctx.labName);
  const cliaNumber = escapeHtml(ctx.cliaNumber);
  const generatedOn = new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });
  const deepestLayer = study.include_overhead === 1 ? "L4 (fully loaded with overhead)"
    : study.include_capital === 1 ? "L3 (with equipment depreciation)"
    : "L2 (reagents + labor)";
  const deepestValue = study.include_overhead === 1 ? study.cprt_l4
    : study.include_capital === 1 ? study.cprt_l3
    : study.cprt_l2;
  const annualAtDeepest = study.annual_volume > 0 ? deepestValue * study.annual_volume : null;

  const overheadDescriptor = study.include_overhead === 1
    ? (study.overhead_method === "markup"
        ? `${(Number(study.overhead_value || 0) * 100).toFixed(1)}% markup on prior layer`
        : `${fmtCurrency(study.overhead_value)} per test (flat)`)
    : "Not included";

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CPRT Study - ${escapeHtml(study.test_name)}</title>
<style>
  @page { size: Letter; margin: 16mm 14mm 18mm 14mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${TEXT_DARK}; font-size: 10pt; line-height: 1.4; margin: 0; }
  .header-bar { background: ${TEAL}; color: white; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; }
  .header-bar h1 { font-size: 14pt; margin: 0; font-weight: bold; }
  .header-bar .lab { font-size: 9pt; }
  h2 { color: ${TEAL}; font-size: 12pt; margin: 14px 0 6px 0; border-bottom: 1px solid ${TEAL_TINT}; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 8px; }
  th, td { border: 1px solid #d0d0d0; padding: 5px 8px; text-align: left; vertical-align: top; }
  th { background: ${TEAL_TINT}; color: #0A3A3D; font-weight: 600; }
  td.num { text-align: right; font-family: 'Courier New', monospace; }
  td.label { font-weight: 600; }
  .layer-box { background: ${TEAL_TINT}; border: 2px solid ${TEAL}; border-radius: 6px; padding: 14px; margin: 12px 0; }
  .layer-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
  .layer-cell { text-align: center; }
  .layer-label { font-size: 8pt; color: #5a5a5a; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .layer-value { font-size: 18pt; font-weight: bold; color: ${TEAL}; font-family: 'Courier New', monospace; }
  .layer-off { font-size: 16pt; color: #999; font-style: italic; }
  .annual { background: white; border: 1px solid ${TEAL}; border-radius: 4px; padding: 10px; margin-top: 8px; }
  .annual-label { font-size: 9pt; color: #5a5a5a; }
  .annual-value { font-size: 14pt; font-weight: bold; color: ${TEAL}; }
  .notes { background: #fafafa; border-left: 3px solid ${TEAL}; padding: 8px 12px; font-size: 9pt; font-style: italic; color: #4a4a4a; margin: 8px 0; }
  .methodology { background: #fafafa; border: 1px solid #e0e0e0; border-radius: 4px; padding: 10px 12px; margin-top: 14px; font-size: 8pt; color: #555; line-height: 1.5; }
  .methodology strong { color: ${TEAL}; }
  .meta-row { display: flex; gap: 16px; font-size: 9pt; margin: 8px 0; color: #5a5a5a; }
  .meta-row span strong { color: ${TEXT_DARK}; }
</style></head>
<body>

  <div class="header-bar">
    <div>
      <h1>VeritaOps&trade; CPRT Study</h1>
      <div class="lab">${labName} &nbsp;|&nbsp; CLIA: ${cliaNumber}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:11pt;font-weight:bold">${escapeHtml(study.test_name)}</div>
      <div style="font-size:8pt">${escapeHtml(study.department || "Core Lab")}${study.loinc ? ` &nbsp;|&nbsp; LOINC ${escapeHtml(study.loinc)}` : ""}</div>
    </div>
  </div>

  <div style="padding: 12px 14px">

    <div class="meta-row">
      <span><strong>Annual volume:</strong> ${fmtInt(study.annual_volume)} tests</span>
      <span><strong>Generated:</strong> ${generatedOn}</span>
      ${ctx.preparedBy ? `<span><strong>Prepared by:</strong> ${escapeHtml(ctx.preparedBy)}</span>` : ""}
    </div>

    <h2>CPRT Result</h2>
    <div class="layer-box">
      <div class="layer-grid">
        <div class="layer-cell">
          <div class="layer-label">L1: Reagents and supplies</div>
          <div class="layer-value">${fmtCurrency(study.cprt_l1)}</div>
        </div>
        <div class="layer-cell">
          <div class="layer-label">L2: + Direct labor</div>
          <div class="layer-value">${fmtCurrency(study.cprt_l2)}</div>
        </div>
        <div class="layer-cell">
          <div class="layer-label">L3: + Equipment depreciation</div>
          ${study.include_capital === 1
            ? `<div class="layer-value">${fmtCurrency(study.cprt_l3)}</div>`
            : `<div class="layer-off">not included</div>`}
        </div>
        <div class="layer-cell">
          <div class="layer-label">L4: + Overhead</div>
          ${study.include_overhead === 1
            ? `<div class="layer-value">${fmtCurrency(study.cprt_l4)}</div>`
            : `<div class="layer-off">not included</div>`}
        </div>
      </div>
      ${annualAtDeepest != null ? `
        <div class="annual">
          <div class="annual-label">Annual cost at ${deepestLayer}, based on ${fmtInt(study.annual_volume)} tests/year:</div>
          <div class="annual-value">${fmtCurrency(annualAtDeepest)}</div>
        </div>` : ""}
    </div>

    <h2>Assumptions and inputs</h2>
    <table>
      <thead><tr><th>Category</th><th>Input</th><th style="text-align:right">Value</th></tr></thead>
      <tbody>
        <tr><td class="label" rowspan="6">L1: Reagents and supplies</td><td>Reagent cost per test</td><td class="num">${fmtCurrency(study.reagent_cost_per_test)}</td></tr>
        <tr><td>Other supplies per test</td><td class="num">${fmtCurrency(study.other_supplies_per_test)}</td></tr>
        <tr><td>Calibrator kit cost</td><td class="num">${fmtCurrency(study.calibrator_kit_cost)}</td></tr>
        <tr><td>Calibrations per year</td><td class="num">${fmtInt(study.cals_per_year)}</td></tr>
        <tr><td>QC cost per run (all levels)</td><td class="num">${fmtCurrency(study.qc_cost_per_run)}</td></tr>
        <tr><td>QC runs per year</td><td class="num">${fmtInt(study.qc_runs_per_year)}</td></tr>
        <tr><td class="label" rowspan="2">L2: Direct labor</td><td>Tech minutes per test</td><td class="num">${(Number(study.tech_minutes_per_test) || 0).toFixed(2)}</td></tr>
        <tr><td>Tech loaded hourly rate</td><td class="num">${fmtCurrency(study.tech_loaded_hourly_rate)}</td></tr>
        ${study.include_capital === 1 ? `
        <tr><td class="label" rowspan="3">L3: Equipment depreciation</td><td>Instrument purchase cost</td><td class="num">${fmtCurrency(study.instrument_purchase_cost)}</td></tr>
        <tr><td>Useful life (years)</td><td class="num">${fmtInt(study.instrument_useful_life_years)}</td></tr>
        <tr><td>Annual maintenance contract</td><td class="num">${fmtCurrency(study.annual_maintenance_cost)}</td></tr>
        ` : ""}
        ${study.include_overhead === 1 ? `
        <tr><td class="label">L4: Overhead</td><td>Method and value</td><td class="num">${escapeHtml(overheadDescriptor)}</td></tr>
        ` : ""}
      </tbody>
    </table>

    ${study.notes ? `<h2>Notes</h2><div class="notes">${escapeHtml(study.notes)}</div>` : ""}

    <div class="methodology">
      <strong>Methodology.</strong> Cost per reportable test (CPRT) is computed in four layers per the conceptual framework in <strong>CLSI GP11-A "Basic Cost Accounting for Clinical Services"</strong>. L1 = reagents and supplies plus amortized calibrators and QC. L2 = L1 + (tech minutes / 60) &times; loaded hourly rate. L3 = L2 + (instrument purchase / useful life + annual maintenance) / annual volume. L4 = (L3 or L2) + overhead, either as a flat per-test dollar amount or as a percentage markup on the prior layer. The number to use depends on the decision being made: marginal-cost questions (insource vs send-out) use L1 or L2; capital justification uses L3; fully-loaded charge-master pricing uses L4. The lab director or designee should validate inputs and select the appropriate layer for the question at hand.
    </div>

  </div>
</body></html>`;
}

export async function generateCprtPdf(study: CprtStudyForPdf, ctx: CprtLabContext): Promise<Buffer> {
  const html = buildCprtHtml(study, ctx);
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
    return Buffer.from(pdfBuffer as ArrayBuffer);
  } finally {
    await page.close();
  }
}
