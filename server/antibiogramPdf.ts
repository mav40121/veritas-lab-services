// server/antibiogramPdf.ts
//
// One antibiogram version as a PDF (parking lot #81). Laid out as the mock Michael approved on 2026-11-23 (option 1,
// Lab\Veritas Lab\Antibiogram Mock\VeritaQA_Antibiogram_MOCK_2026-11-23.pdf, built by mock_antibiogram_pdf.mjs beside it), with
// his one change: the release box is the standard "LABORATORY DIRECTOR OR DESIGNEE REVIEW" block VeritaCheck prints
// (server/pdfReport.ts reviewBlockHTML), on page 1. No SAMPLE banner or watermark.
//
// CLAUDE.md section 5: lab name and CLIA from the live lab record ("CLIA: Not on file. Enter it in account settings." when
// blank), the footer on every page, author metadata Perplexity Computer (stampPdfAuthor), no em dashes, "medical director or
// designee". A released version prints with the rule it was released under (threshold_used, below_threshold_used; loadAntibiogram's
// rule), so a later settings change never moves it; Accepted is marked and the approver's name, title and release date are on their
// lines, the signature line left for ink, the way the IQCP plan prints its approver. A draft prints the lab's current rule, the
// review block blank, and the large diagonal DRAFT mark VeritaCheck puts on a draft study.
//
// Page 1 holds the review block (section 5: never push the signature off page 1). The tables normally fit above it; when a long
// antibiogram would push it off page 1 (measured in the browser, as the compliance digest does), it prints right after the method
// line, above the tables, which then run on to page 2 with their headers repeated.

import { getBrowser, reviewBlockHTML } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import type { AbgGroup, BelowThresholdMode } from "../shared/antibiogramRules";

export const ABG_PDF_CLIA_MISSING = "CLIA: Not on file. Enter it in account settings.";
export const ABG_PDF_FOOTER_TEXT = "VeritaAssure® | VeritaQA™ | Confidential, For Internal Lab Use Only";
export const ABG_PDF_REVIEW_STATEMENT = "I have reviewed this cumulative antibiogram, its totals and its method notes, and approve its release to the hospital's antibiotic stewardship program.";
export const ABG_PDF_ACCEPT_LABEL = "Accepted for release";

export interface AntibiogramPdfInput {
  antibiogram: any;
  rule: { threshold: number; mode: BelowThresholdMode; note: string };
  table: AbgGroup[];
}
export interface AntibiogramPdfContext {
  labName: string | null;
  cliaNumber: string | null;
  /** The lab's today, the day the PDF was generated. */
  generated: string;
  /** Print the review block above the tables (set when the tables would push it off page 1). */
  reviewFirst?: boolean;
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const cellClass = (pct: number | null) => (pct == null ? "" : pct >= 90 ? "hi" : pct >= 70 ? "mid" : "lo");

function groupTable(g: AbgGroup, threshold: number): string {
  const head = `<tr><th class="org">Organism</th><th class="n">Isolates</th>${g.drugs.map((d) => `<th class="drug">${esc(d)}</th>`).join("")}</tr>`;
  const body = g.organisms.map((o) => {
    const cells = g.drugs.map((d) => {
      const c = o.cells[d];
      if (!c) return `<td class="nt"></td>`;
      if (!c.shown) return `<td class="sup">*</td>`;
      return `<td class="${cellClass(c.pct)}${c.below ? " fl" : ""}">${c.pct ?? ""}${c.below ? "&dagger;" : ""}</td>`;
    }).join("");
    return `<tr><td class="org">${esc(o.organism)}${o.below ? ` <span class="flag">fewer than ${threshold}</span>` : ""}</td><td class="n">${o.isolates}</td>${cells}</tr>`;
  }).join("");
  return `<div class="tt">${esc(g.label)}</div><table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export function buildAntibiogramHTML(input: AntibiogramPdfInput, ctx: AntibiogramPdfContext): string {
  const a = input.antibiogram;
  const released = a.status === "released";
  const { threshold, mode, note } = input.rule;
  const labName = ctx.labName ? esc(ctx.labName) : "Lab name not on file";
  const clia = ctx.cliaNumber ? `CLIA: ${esc(ctx.cliaNumber)}` : ABG_PDF_CLIA_MISSING;
  const anyFlagged = input.table.some((g) => g.organisms.some((o) => Object.values(o.cells).some((c) => c.below && c.shown)));
  const anySuppressed = input.table.some((g) => g.organisms.some((o) => Object.values(o.cells).some((c) => !c.shown)));
  const status = released ? `Released ${esc(a.released_day)}` : "Draft, not released";
  const review = `<div data-block="review">${reviewBlockHTML({
    statement: `"${ABG_PDF_REVIEW_STATEMENT}"`,
    acceptLabel: ABG_PDF_ACCEPT_LABEL,
    accepted: released,
    date: released ? a.released_day : null,
    printName: released ? a.released_by_name : null,
    title: released ? a.released_by_title : null,
  })}</div>`;
  const legend = `<div class="legend">
    <span><span class="sw" style="background:#E7F1E1"></span>90% or more susceptible</span>
    <span><span class="sw" style="background:#FFF4E0"></span>70% to 89%</span>
    <span><span class="sw" style="background:#F9E3EE"></span>Under 70%</span>
    <span><span class="sw" style="background:#F2F2F2"></span>Not tested or not reported</span>
    ${mode === "suppress" || anySuppressed ? `<span><b>*</b> Fewer than ${threshold} isolates in the period: percent not shown</span>` : ""}
    ${anyFlagged ? `<span><b>&dagger;</b> Fewer than ${threshold} isolates in the period: shown for reference</span>` : ""}
  </div>`;
  const notes = `<div class="notes"><b>How to read this table.</b> Each number is the percent of the organism's isolates that tested susceptible: number susceptible divided by number tested. Intermediate results are not counted as susceptible. The isolates column is the number of first isolates tested for that organism in the analysis period. Totals come from the laboratory's LIS antibiogram report, which removes repeat isolates from the same patient before upload; VeritaAssure&reg; holds no patient records. Percent susceptible guides the choice of empiric therapy; it does not replace the patient's own culture and susceptibility result. Release of this antibiogram belongs to the medical director or designee.</div>`;
  const tables = input.table.length
    ? input.table.map((g) => groupTable(g, threshold)).join("")
    : `<p class="empty">No totals have been entered for this antibiogram.</p>`;
  const draftMark = released ? "" : `<div class="draft-mark">DRAFT</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(a.title)}</title><style>
  * { box-sizing:border-box; } body { margin:0; font-family:Arial,Helvetica,sans-serif; font-size:9px; color:#28251D; }
  .draft-mark { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); font-size:130pt; font-weight:900; color:rgba(220,80,80,0.10); z-index:9999; pointer-events:none; letter-spacing:8pt; }
  .band { background:#01696F; color:#fff; padding:8px 12px; border-radius:4px 4px 0 0; display:flex; justify-content:space-between; }
  .band h1 { margin:0; font-size:15px; } .band .sub { font-size:9px; opacity:.9; margin-top:2px; } .band .lab { text-align:right; font-size:9px; } .band .lab b { display:block; font-size:11px; }
  .meta { border:1px solid #D0D0D0; border-top:none; display:flex; }
  .meta .f { flex:1; padding:5px 8px; border-right:1px solid #D0D0D0; } .meta .f:last-child { border-right:none; }
  .meta span { display:block; font-size:7.5px; color:#6b6b6b; text-transform:uppercase; letter-spacing:.3px; } .meta b { font-size:9.5px; }
  .tt { margin:7px 0 3px; font-size:9px; font-weight:700; color:#01696F; text-transform:uppercase; letter-spacing:.4px; break-after:avoid; page-break-after:avoid; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; } thead { display:table-header-group; } tr { page-break-inside:avoid; break-inside:avoid; }
  th, td { border:1px solid #D0D0D0; padding:2px 3px; text-align:center; }
  th { background:#E6F2F2; color:#0A3A3D; font-size:7.5px; font-weight:700; vertical-align:bottom; } th.drug { height:30px; line-height:1.15; }
  th.org, td.org { text-align:left; width:21%; } th.n, td.n { width:6%; } td { font-size:10px; height:17px; }
  td.hi { background:#E7F1E1; } td.mid { background:#FFF4E0; } td.lo { background:#F9E3EE; } td.nt { background:#F2F2F2; } td.sup { color:#7A7974; font-weight:700; } td.fl { font-style:italic; color:#7A7974; }
  .flag { font-size:7px; color:#964219; font-weight:700; }
  .legend { margin-top:4px; font-size:7.5px; color:#555; display:flex; gap:12px; flex-wrap:wrap; } .sw { display:inline-block; width:9px; height:9px; border:1px solid #D0D0D0; vertical-align:middle; margin-right:3px; }
  .notes { margin-top:6px; border:1px solid #D0D0D0; padding:5px 8px; font-size:7.8px; line-height:1.35; break-inside:avoid; } .notes b { color:#0A3A3D; }
  .empty { font-size:9px; color:#7A7974; margin:8px 0; }
  .review-wrap { margin-top:6px; }
</style></head><body>
  ${draftMark}
  <div data-block="head">
  <div class="band"><div><h1>VeritaQA&trade; Cumulative Antibiogram</h1><div class="sub">${esc(a.title)}: percent of isolates susceptible, from the laboratory's own susceptibility totals</div></div>
    <div class="lab"><b>${labName}</b>${clia}<br>Version ${esc(a.version)}, generated ${esc(ctx.generated)}</div></div>
  <div class="meta">
    <div class="f"><span>Analysis period</span><b>${esc(a.period_start)} to ${esc(a.period_end)}</b></div>
    <div class="f"><span>Specimen sources</span><b>${esc(a.source_filter || "Not stated")}</b></div>
    <div class="f"><span>Isolates counted</span><b>${esc(note)}</b></div>
    <div class="f"><span>Fewest isolates to report a percent</span><b>${threshold}</b></div>
    <div class="f"><span>Data source</span><b>${esc(a.data_source || "Entered by the laboratory")}</b></div>
    <div class="f"><span>Status</span><b>${status}</b></div>
  </div>
  </div>
  ${ctx.reviewFirst ? `<div class="review-wrap">${review}</div>` : ""}
  <div data-block="tables">${tables}${legend}${notes}</div>
  ${ctx.reviewFirst ? "" : `<div class="review-wrap">${review}</div>`}
</body></html>`;
}

export const ABG_PDF_FOOTER_TEMPLATE = `<div style="width:100%;font-family:Arial,Helvetica,sans-serif;font-size:7px;color:#555;padding:0 12mm;">VeritaAssure&reg; | VeritaQA&trade; | Confidential, For Internal Lab Use Only | Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`;

// Letter landscape with the mock's margins. Page 1's printable box in CSS pixels (96 per inch), for the review block check.
const MARGIN = { top: 10, bottom: 14, left: 12, right: 12 }; // mm
const MM = 96 / 25.4;
const CONTENT_WIDTH_PX = Math.round((11 * 96) - (MARGIN.left + MARGIN.right) * MM);
const PAGE1_HEIGHT_PX = Math.floor((8.5 * 96) - (MARGIN.top + MARGIN.bottom) * MM);

async function reviewBottom(page: any): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-block="review"]');
    return el ? el.getBoundingClientRect().bottom - document.body.getBoundingClientRect().top : 0;
  });
}

export interface AntibiogramPdfResult { pdf: Buffer; reviewFirst: boolean; html: string }

export async function generateAntibiogramPDF(input: AntibiogramPdfInput, ctx: AntibiogramPdfContext): Promise<AntibiogramPdfResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Laid out at the printed page's width with print styles, so the measure below is what the PDF will hold.
    await page.setViewport({ width: CONTENT_WIDTH_PX, height: PAGE1_HEIGHT_PX });
    await page.emulateMediaType("print");
    let html = buildAntibiogramHTML(input, { ...ctx, reviewFirst: false });
    await setPdfContent(page, html);
    let reviewFirst = false;
    // A few pixels' allowance for rounding between the screen layout and the printed one.
    if ((await reviewBottom(page)) > PAGE1_HEIGHT_PX - 8) {
      reviewFirst = true;
      html = buildAntibiogramHTML(input, { ...ctx, reviewFirst: true });
      await setPdfContent(page, html);
    }
    const pdf = await page.pdf({
      format: "Letter",
      landscape: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: ABG_PDF_FOOTER_TEMPLATE,
      margin: { top: `${MARGIN.top}mm`, right: `${MARGIN.right}mm`, bottom: `${MARGIN.bottom}mm`, left: `${MARGIN.left}mm` },
    });
    return { pdf: await stampPdfAuthor(pdf), reviewFirst, html };
  } finally {
    await page.close();
  }
}

/** VeritaQA_Antibiogram_<title>_v<version>.pdf, with _DRAFT on a draft. */
export function antibiogramPdfFilename(a: { title: string; version: number; status: string }): string {
  const safe = String(a.title).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "Antibiogram";
  return `VeritaQA_Antibiogram_${safe}_v${a.version}${a.status === "released" ? "" : "_DRAFT"}.pdf`;
}
