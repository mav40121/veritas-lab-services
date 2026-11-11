// server/digestPdf.ts
//
// The compliance digest's issue PDF (Michael 2026-11-11, Q284 = 1: "approved as shown; the review box is a per-lab option, off
// by default"; PR 5 of 5). Laid out as the approved mock (Product Specs\Compliance Digest\Compliance_Digest_PDF_Mock_DRAFT_2026-11-11.pdf,
// built by Working files\build_digest_pdf_mock.mjs), without its SAMPLE banner and its "Optional: printed only when..." line:
//   the title block (Compliance Digest, the period, the audience version, the lab's name and CLIA from the live lab record);
//   the meta line (numbers as of, published and to whom, counts only, which period the comparison column is);
//   the note from the medical director or designee, when the issue has one;
//   one table of the issue's sections: section, module with its mark, this period's number and unit, the prior period's number,
//     the change in a word (Better, Worse, No change; blank for New tests added, which is information only) and the detail;
//   the "New tests added in <period>" list (test, analyzer, VeritaCheck study on file Yes or Not yet), when there are any;
//   the "Reviewed by the medical director or designee" box (Print name and title, Signature, Date), only when the issue's
//     review_box is 1.
// Every number, unit, detail and change word comes from shared/digestCards.ts (cardBody, headlineNumber, changeLine), the rules
// the issue screen uses, applied to the counts the issue froze at publish and the `previous` GET issues/:id gives the same
// reader, so the PDF and the screen can't disagree. A null section prints "Not available". Counts only: no patient
// information and no person's name (test and analyzer names are the lab's menu). Section 5: CLIA on the header, the footer on
// every page, author metadata "Perplexity Computer" (stampPdfAuthor).
//
// One Letter page for a normal issue. A long new-tests list may run to page 2; the title block, note and table stay on page 1.
// When the review box is on and the list would push it off page 1, the box prints right after the table and the list after it,
// so the signature stays on page 1 (CLAUDE.md section 5: never push the signature off page 1).

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import {
  DIGEST_CARDS, DIGEST_CHANGE_COLORS, DIGEST_CHANGE_WORDS, cardBody, changeLine, digestVersionLabel, formatDay, formatMomentDay,
  headlineNumber, issueCardKeys, periodColumnLabel, periodPhrase, periodTitle, priorColumnLabel, priorPeriodSentence,
  type DigestChangeKind, type DigestCountsLike,
} from "@shared/digestCards";

/** The issue as GET issues/:id gives it to this reader (published only): what the PDF prints. */
export interface DigestPdfIssue {
  id: number;
  period_start: string;
  period_end: string;
  status: string;
  note: string | null;
  sections: string[];
  audience: string;
  audience_groups?: Array<{ id: number; name: string; retired?: boolean }>;
  review_box: boolean;
  published_at: string | null;
  counts: DigestCountsLike | null;
  previous: { id: number; period_start: string; period_end: string; counts: Record<string, any> | null } | null;
}

export interface DigestPdfContext {
  labName: string | null;
  cliaNumber: string | null;
  /** Print the review box right after the table, before the new tests list (set when the list would push it off page 1). */
  reviewBeforeList?: boolean;
}

export const DIGEST_PDF_CLIA_MISSING = "CLIA: Not on file. Enter it in account settings.";
export const DIGEST_PDF_FOOTER_TEXT = "VeritaAssure® | Compliance Digest | Confidential, For Internal Lab Use Only";
export const DIGEST_PDF_REVIEW_TITLE = "Reviewed by the medical director or designee";
export const DIGEST_PDF_NOTE_TITLE = "A note from the medical director or designee";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Who the issue went to, inside the meta line's sentence. */
function sentToPhrase(issue: Pick<DigestPdfIssue, "audience" | "audience_groups">): string {
  if (issue.audience === "leadership") return "the Leadership group";
  if (issue.audience === "staff") return "everyone in the lab";
  const names = (issue.audience_groups || []).map((g) => g.name);
  if (!names.length) return "chosen lab groups";
  return `the lab ${names.length === 1 ? "group" : "groups"} ${names.join(", ")}`;
}

export interface DigestPdfRow {
  key: string;
  title: string;
  module: string;
  available: boolean;
  big: number | null;
  unit: string;
  prior: number | null;
  change: DigestChangeKind | null;
  changeWord: string;
  detail: string;
}

/** The table's rows, one per section the issue includes, in the digest's order: the screen's numbers and change lines. */
export function digestPdfRows(issue: DigestPdfIssue): DigestPdfRow[] {
  const period = { start: issue.period_start, end: issue.period_end, asOf: issue.counts?.asOf ?? null };
  return issueCardKeys(issue.sections).map((k) => {
    const section = issue.counts ? (issue.counts as any)[k] : null;
    const body = cardBody(k, section, period, { newTestsListedBelow: true });
    const change = body.available ? changeLine(k, section, issue.previous, issue) : null;
    const prior = change && issue.previous?.counts ? headlineNumber(k, issue.previous.counts[k]) : null;
    return {
      key: k, title: DIGEST_CARDS[k].title, module: DIGEST_CARDS[k].module, available: body.available, big: body.big, unit: body.unit,
      prior, change: change?.kind ?? null, changeWord: change ? DIGEST_CHANGE_WORDS[change.kind] : "", detail: body.detail,
    };
  });
}

/** The new tests the list prints: the issue's own frozen items, in the order the counts hold them. */
export function digestPdfNewTests(issue: DigestPdfIssue): Array<{ analyte: string; instrumentName: string; studyOnFile: boolean }> {
  if (!issueCardKeys(issue.sections).includes("newTests")) return [];
  const s = issue.counts ? (issue.counts as any).newTests : null;
  return Array.isArray(s?.items) ? s.items.map((i: any) => ({ analyte: String(i.analyte ?? ""), instrumentName: String(i.instrumentName || "an analyzer"), studyOnFile: !!i.studyOnFile })) : [];
}

/** The PDF as HTML: the approved mock's layout, filled from the issue. Pure, so the tests read it directly. */
export function buildDigestPdfHTML(issue: DigestPdfIssue, ctx: DigestPdfContext): string {
  const tz = issue.counts?.timeZone ?? null;
  const title = periodTitle(issue.period_start, issue.period_end);
  const rows = digestPdfRows(issue);
  const tests = digestPdfNewTests(issue);
  const asOf = issue.counts?.asOf ? `Numbers as of ${formatDay(issue.counts.asOf)} (lab time).` : "";
  const published = issue.published_at ? `Published ${formatMomentDay(issue.published_at, tz)} to ${sentToPhrase(issue)}.` : "";
  const meta = [asOf, published, "Counts only: no patient information and no staff names.", priorPeriodSentence(issue.previous, issue)].filter(Boolean).join(" ");
  const cur = periodColumnLabel(issue.period_start, issue.period_end);
  const last = priorColumnLabel(issue.previous, issue);
  const cls = (k: DigestChangeKind | null) => (k ? ` class="chg ${k}"` : "");

  const table = `<table class="sections" data-block="table">
    <thead><tr><th style="width:19%">Section</th><th style="width:12%">Module</th><th style="width:19%">${esc(cur)}</th><th style="width:8%">${esc(last)}</th><th style="width:8%">Change</th><th>Detail</th></tr></thead>
    <tbody>
      ${rows.map((r) => `<tr data-row="${esc(r.key)}"><td>${esc(r.title)}</td><td>${esc(r.module)}</td>`
        + (r.available ? `<td class="n">${r.big} <span class="u">${esc(r.unit)}</span></td>` : `<td class="n na">Not available</td>`)
        + `<td class="n">${r.prior == null ? "" : r.prior}</td><td${cls(r.change)}>${esc(r.changeWord)}</td><td>${esc(r.detail)}</td></tr>`).join("\n      ")}
    </tbody>
  </table>`;
  const inPeriod = periodPhrase(issue.period_start, issue.period_end); // "October"; a quarter reads as its column heading, "Q3 2026"
  const list = tests.length ? `<h2 data-block="tests-title">New tests added in ${esc(inPeriod === "the quarter" ? cur : inPeriod)}</h2>
  <table class="tests" data-block="tests">
    <thead><tr><th style="width:30%">Test</th><th style="width:40%">Analyzer</th><th>VeritaCheck® study on file</th></tr></thead>
    <tbody>${tests.map((t) => `<tr><td>${esc(t.analyte)}</td><td>${esc(t.instrumentName)}</td><td class="chg ${t.studyOnFile ? "better" : "worse"}">${t.studyOnFile ? "Yes" : "Not yet"}</td></tr>`).join("")}</tbody>
  </table>` : "";
  const review = issue.review_box ? `<div class="review" data-block="review">
    <div class="t">${esc(DIGEST_PDF_REVIEW_TITLE)}</div>
    <div class="lines"><div>Print name and title</div><div>Signature</div><div>Date</div></div>
  </div>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><title>VeritaAssure® Compliance Digest ${esc(title)}</title><style>
  * { box-sizing: border-box; }
  body { font-family: Calibri, "Segoe UI", Arial, sans-serif; color: #28251D; font-size: 10.5pt; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #01696F; padding-bottom: 6px; gap: 12px; }
  .top h1 { margin: 0; font-size: 18pt; color: #01696F; }
  .top .sub { font-size: 10pt; color: #0A3A3D; font-weight: 600; }
  .top .id { text-align: right; font-size: 10pt; }
  .meta { font-size: 9pt; color: #4A4740; margin: 5px 0 8px; }
  .note { background: #E6F2F2; border: 1px solid #C9E2E2; padding: 7px 10px; margin-bottom: 9px; }
  .note b { color: #01696F; }
  .note p { margin: 3px 0 0; white-space: pre-wrap; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th { background: #01696F; color: #fff; text-align: left; padding: 4px 6px; font-weight: 700; white-space: nowrap; }
  td { border-bottom: 1px solid #D0D0D0; padding: 3px 5px; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #EBF3F8; }
  td.n { text-align: right; font-weight: 700; white-space: nowrap; }
  td.n .u { font-weight: 400; white-space: normal; }
  td.na { font-weight: 600; color: #4A4740; white-space: normal; }
  .chg { font-weight: 700; }
  .better { color: ${DIGEST_CHANGE_COLORS.better}; } .worse { color: ${DIGEST_CHANGE_COLORS.worse}; } .same, .info { color: ${DIGEST_CHANGE_COLORS.same}; }
  h2 { font-size: 11pt; color: #0A3A3D; margin: 10px 0 4px; break-after: avoid; page-break-after: avoid; }
  .review { margin-top: 12px; border: 1px solid #0A3A3D; padding: 8px 10px 10px; page-break-inside: avoid; break-inside: avoid; }
  .review .t { font-weight: 700; color: #0A3A3D; margin-bottom: 8px; }
  .lines { display: grid; grid-template-columns: 1.4fr 1.4fr 0.8fr; gap: 18px; }
  .lines div { border-top: 1px solid #28251D; padding-top: 2px; font-size: 8.5pt; color: #4A4740; margin-top: 16px; }
</style></head><body>
  <div class="top" data-block="title">
    <div><h1>Compliance Digest</h1><div class="sub">${esc(title)} | ${esc(digestVersionLabel(issue.audience))}</div></div>
    <div class="id"><b>${esc(ctx.labName || "Lab name not on file")}</b><br>${ctx.cliaNumber ? `CLIA ${esc(ctx.cliaNumber)}` : esc(DIGEST_PDF_CLIA_MISSING)}</div>
  </div>
  <div class="meta" data-block="meta">${esc(meta)}</div>
  ${issue.note ? `<div class="note" data-block="note"><b>${esc(DIGEST_PDF_NOTE_TITLE)}</b><p>${esc(issue.note)}</p></div>` : ""}
  ${table}
  ${ctx.reviewBeforeList ? `${review}\n  ${list}` : `${list}\n  ${review}`}
</body></html>`;
}

export const DIGEST_PDF_FOOTER_TEMPLATE = `<div style="width:100%;font-family:Calibri,Arial,sans-serif;font-size:7.5pt;color:#7A7974;padding:0 0.6in;display:flex;justify-content:space-between;"><span>VeritaAssure&reg; | Compliance Digest | Confidential, For Internal Lab Use Only</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

// Letter, with the mock's margins. Page 1's printable box, in CSS pixels (96 per inch), for the review box check.
const MARGIN = { top: 0.55, bottom: 0.7, left: 0.6, right: 0.6 };
const CONTENT_WIDTH_PX = Math.round((8.5 - MARGIN.left - MARGIN.right) * 96);
const PAGE1_HEIGHT_PX = Math.floor((11 - MARGIN.top - MARGIN.bottom) * 96);

/** Where each block ends on the laid-out page, in CSS pixels from the top of page 1's printable box. */
async function blockBottoms(page: any): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const out: Record<string, number> = {};
    const top = document.body.getBoundingClientRect().top;
    document.querySelectorAll("[data-block]").forEach((el) => { out[(el as HTMLElement).dataset.block as string] = el.getBoundingClientRect().bottom - top; });
    return out;
  });
}

export interface DigestPdfResult { pdf: Buffer; reviewBeforeList: boolean; html: string }

export async function generateDigestPDF(issue: DigestPdfIssue, ctx: DigestPdfContext): Promise<DigestPdfResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Laid out at the printed page's width with print styles, so the measure below is what the PDF will hold.
    await page.setViewport({ width: CONTENT_WIDTH_PX, height: PAGE1_HEIGHT_PX });
    await page.emulateMediaType("print");
    let html = buildDigestPdfHTML(issue, { ...ctx, reviewBeforeList: false });
    await setPdfContent(page, html);
    let reviewBeforeList = false;
    if (issue.review_box && digestPdfNewTests(issue).length) {
      const at = await blockBottoms(page);
      // A few pixels' allowance for rounding between the screen layout and the printed one.
      if ((at.review ?? 0) > PAGE1_HEIGHT_PX - 8) {
        reviewBeforeList = true;
        html = buildDigestPdfHTML(issue, { ...ctx, reviewBeforeList: true });
        await setPdfContent(page, html);
      }
    }
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: DIGEST_PDF_FOOTER_TEMPLATE,
      margin: { top: `${MARGIN.top}in`, right: `${MARGIN.right}in`, bottom: `${MARGIN.bottom}in`, left: `${MARGIN.left}in` },
    });
    return { pdf: await stampPdfAuthor(pdf), reviewBeforeList, html };
  } finally {
    await page.close();
  }
}

/** The file's name: Compliance_Digest_2026-10.pdf for a month, Compliance_Digest_2026-Q3.pdf for a quarter. */
export function digestPdfFilename(issue: { period_start: string; period_end: string }): string {
  const label = periodColumnLabel(issue.period_start, issue.period_end);
  if (/^Q\d /.test(label)) return `Compliance_Digest_${issue.period_start.slice(0, 4)}-${label.slice(0, 2)}.pdf`;
  if (label === "This period") return `Compliance_Digest_${issue.period_start}_to_${issue.period_end}.pdf`;
  return `Compliance_Digest_${issue.period_start.slice(0, 7)}.pdf`;
}
