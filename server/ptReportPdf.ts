// server/ptReportPdf.ts
//
// The VeritaPT period report as a PDF (server/ptReport.ts). Laid out as the VeritaPT report PDF (server/pdfReport.ts
// generateVeritaPTPDF): the lab's name and CLIA on the header, the module's footer on every page, the license band, author
// metadata. A report, not a form: no signature line. Every text from the lab is escaped.
import { PT_REVIEW_LABEL, PT_STATUS_LABEL, PT_SUBMISSION_LABEL, type PtSubmission } from "@shared/ptEvents";
import { PT_FLAG_LABEL, ptLast3Text, ptRateText, ptRateWords, type PtReport } from "@shared/ptReport";
import { setPdfContent } from "./pdfContent";
import { stampPdfAuthor } from "./pdfMeta";
import { applyLicenseToPuppeteer, getBrowser } from "./pdfReport";

const TEAL = "#01696F";
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const PT_REPORT_FOOTER = `
<div style="width:100%;padding:0 15mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px">
    <div style="font-size:6px;color:#a0a0a0;line-height:1.4">VeritaPT&trade; tracks proficiency-testing performance. Results require interpretation by a licensed medical director or designee and do not constitute medical advice.</div>
    <div style="display:flex;justify-content:space-between;font-size:7px;color:#646e78;margin-top:2px">
      <span>VeritaAssure&reg; | VeritaPT&trade; | Confidential - For Internal Lab Use Only</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>
  </div>
</div>`;

const table = (heads: string[], rows: unknown[][], none: string): string => rows.length
  ? `<table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  : `<p class="none">${esc(none)}</p>`;

export function buildPtReportHTML(r: PtReport, lab: { labName: string | null; clia: string | null }): string {
  const card = (value: unknown, label: string) => `<div class="kpi"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div></div>`;
  const submission = (k: PtSubmission) => `${r.due.counts[k]} ${PT_SUBMISSION_LABEL[k].toLowerCase()}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>VeritaPT™ Report ${esc(r.period.label)}</title><style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; color: #1a1a1a; background: white; }
    .head { border-bottom: 3px solid ${TEAL}; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
    .title { font-size: 15pt; font-weight: 700; color: ${TEAL}; }
    .sub { font-size: 9pt; color: #555; margin-top: 2px; }
    .lab { text-align: right; font-size: 8pt; color: #555; line-height: 1.4; }
    .lab strong { color: #1a1a1a; }
    .kpis { display: flex; gap: 10px; margin-bottom: 6px; }
    .kpi { flex: 1; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 6px; text-align: center; }
    .kpi .v { font-size: 15pt; font-weight: 700; color: ${TEAL}; }
    .kpi .l { font-size: 7.5pt; color: #6b7280; margin-top: 2px; }
    .words { font-size: 8.5pt; color: #555; margin-bottom: 4px; }
    h2 { font-size: 11pt; font-weight: 700; color: ${TEAL}; margin: 13px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 3px; break-after: avoid; page-break-after: avoid; }
    table { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th { background: ${TEAL}; color: white; padding: 4px 7px; text-align: left; font-weight: 600; font-size: 8pt; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    td { padding: 4px 7px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    .none { font-size: 8.5pt; color: #6b7280; }
    .note { margin-top: 16px; padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 4px; background: #f9fafb; font-size: 7.5pt; color: #555; line-height: 1.5; break-inside: avoid; }
  </style></head><body>
    <div class="head">
      <div><div class="title">VeritaPT™ Report: ${esc(r.period.label)}</div><div class="sub">Proficiency testing, ${esc(r.period.start)} to ${esc(r.period.end)}</div></div>
      <div class="lab"><strong>${esc(lab.labName || "Laboratory Name Not Configured")}</strong><br>CLIA: ${esc(lab.clia || "Not on file - enter in account settings")}<br>Made ${esc(r.as_of)}</div>
    </div>
    <div class="kpis">
      ${card(ptRateText(r.results), "Acceptable rate (acceptable / graded)")}
      ${card(r.results.unacceptable, PT_STATUS_LABEL.unacceptable)}
      ${card(r.results.ungraded, PT_STATUS_LABEL.ungraded)}
      ${card(r.results.not_graded, PT_STATUS_LABEL.not_graded)}
      ${card(r.due.total, "Events due")}
      ${card(r.open_reviews.length, "Open reviews")}
    </div>
    <p class="words">${esc(ptRateWords(r.results))}</p>
    <h2>Events due and their submission</h2>
    <p class="words">${esc(`${submission("on_time")}; ${submission("late")}; ${submission("not_recorded")}; ${submission("not_due")}.`)}</p>
    ${table(["Event", "Program", "Due", "Submitted", "Submission"], r.due.events.map((e) => [e.event, e.program, e.due_date, e.submitted_date ?? "", PT_SUBMISSION_LABEL[e.submission]]), "No event has a due date in this period.")}
    <h2>Unacceptable and ungraded, by analyte</h2>
    ${table(["Analyte", "Unacceptable", "Ungraded"], r.by_analyte.map((a) => [a.name, a.unacceptable, a.ungraded]), "None.")}
    <h2>Unacceptable and ungraded, by department</h2>
    ${table(["Department", "Unacceptable", "Ungraded"], r.by_department.map((a) => [a.name, a.unacceptable, a.ungraded]), "None.")}
    <h2>Open reviews, as of ${esc(r.as_of)}</h2>
    ${table(["Event", "Program", "Event date", "Review", "Evaluations open"], r.open_reviews.map((e) => [e.event, e.program, e.event_date, PT_REVIEW_LABEL[e.state], e.open_evaluations]), "Every event of this period with a status back is reviewed.")}
    <h2>Two of three, as of ${esc(r.period.end)}</h2>
    ${table(["Analyte", "Flag", "Last three graded results"], r.two_of_three.map((t) => [t.analyte, PT_FLAG_LABEL[t.state], ptLast3Text(t.last3)]), "No analyte is at risk or on watch.")}
    <div class="note">
      Results count by event date. Graded means acceptable or unacceptable; ungraded and not yet graded results are never in the rate or in the two-of-three list. Department is the VeritaMap® department of the analyzers that run the analyte. 42 CFR §493.2: unsatisfactory performance in two consecutive or two out of three testing events is unsuccessful participation.<br>
      Final approval and clinical determination must be made by the laboratory director or designee.
    </div>
  </body></html>`;
}

export async function generatePtReportPDF(r: PtReport, lab: { labName: string | null; clia: string | null }, licenseCtx?: any): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    const stamped = applyLicenseToPuppeteer(buildPtReportHTML(r, lab), PT_REPORT_FOOTER, licenseCtx);
    await setPdfContent(page, stamped.html);
    const pdf = await page.pdf({
      format: "Letter", printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: stamped.footerTemplate,
      margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" },
    });
    return stampPdfAuthor(pdf);
  } finally {
    await page.close();
  }
}
