// "Why VeritaCheck" comparative one-pager PDF.
//
// Marketing collateral that pairs with the web page at /resources/why-veritacheck.
// Single-page Letter, brand teal, four panels (cost, time-to-first-study,
// integration breadth, compliance defensibility). Static content, no per-user
// or per-lab personalization — this is leave-behind / email-attachment copy
// authored once, not a generated report. Per CLAUDE.md section 3, no
// em-dashes; per section 3, customer-facing copy uses "legacy verification
// software" rather than naming any specific competing product.

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";

const TEAL = "#01696F";
const TEAL_TINT = "#E6F2F2";
const TEXT_DARK = "#28251D";

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&reg; | VeritaCheck&reg; positioning | www.veritaslabservices.com</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

function buildHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Why VeritaCheck</title>
<style>
  @page { size: Letter; margin: 10mm 10mm 14mm 10mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${TEXT_DARK}; font-size: 8.5pt; line-height: 1.3; margin: 0; }
  .title-bar { background: ${TEAL}; color: white; padding: 8px 12px; }
  .title-bar h1 { font-size: 14pt; margin: 0; font-weight: bold; line-height: 1.2; }
  .title-bar .sub { font-size: 8pt; opacity: 0.92; margin-top: 2px; line-height: 1.3; }
  .lede { padding: 6px 12px 4px; font-size: 8pt; line-height: 1.35; color: #303030; }
  .lede p { margin: 0 0 3px 0; }
  .lede p:last-child { margin-bottom: 0; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px 12px; }
  .panel { border: 1px solid #d2d7dc; border-radius: 4px; padding: 7px 10px; background: #fbfdfd; }
  .panel h3 { color: ${TEAL}; font-size: 9.5pt; margin: 0 0 4px 0; font-weight: bold; border-bottom: 1px solid ${TEAL_TINT}; padding-bottom: 2px; }
  .panel p { margin: 0 0 4px 0; font-size: 8pt; line-height: 1.32; }
  .panel p:last-child { margin-bottom: 0; }
  .cta { background: ${TEAL}; color: white; padding: 6px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 8pt; margin-top: 6px; }
  .cta strong { font-size: 9pt; }
  .disclaimer { padding: 5px 12px 3px; font-size: 6pt; color: #7a7a7a; line-height: 1.3; }
</style>
</head>
<body>

<div class="title-bar">
  <h1>Why VeritaCheck&reg; vs. Legacy Verification Software</h1>
  <div class="sub">A side-by-side comparison for lab directors evaluating a tool change.</div>
</div>

<div class="lede">
  <p>Most labs running method verification today use a legacy desktop tool that has been the de facto standard for the better part of two decades. The tool works. It is also installed Windows software, priced for an era before browser-based clinical software, with its statistics kept apart from the rest of the lab's compliance records.</p>
  <p>VeritaCheck&reg; is a browser-based alternative producing the verification studies most CLIA labs need, under the CLSI standards named below, at a cost closer to a SaaS subscription than a per-seat license, integrated into the broader VeritaAssure&reg; platform.</p>
</div>

<div class="grid">

  <div class="panel">
    <h3>1. Cost</h3>
    <p>VeritaCheck&reg; Unlimited is $299 in Year 1, $499 per year after, for a single user. Per-study pricing for occasional use is $25 one-time. A lab with more than one person running studies uses a suite plan: Clinic is $999 per year with 2 active seats, and additional active seats are $500 each. Suite plans include one free medical director seat for the lab's named director, which does not count against your active seats. Other reviewers, such as the technical consultant and technical supervisor, use active seats.</p>
    <p>Legacy verification software is typically licensed per seat at $800 to $3,000 per analyst per year. A community-hospital lab with three technologists and one reviewer pays $2,400 to $9,000 per year before any tech time is spent.</p>
    <p>On VeritaAssure&reg;, a lab with three testing technologists and one reviewer pays $1,499 per year on Clinic if the reviewer is the named medical director, or $1,999 if the reviewer uses an active seat, with the full suite included.</p>
  </div>

  <div class="panel">
    <h3>2. Time to first study</h3>
    <p>VeritaCheck&reg; opens in a browser. No install, no driver, no IT ticket. A technologist with a fresh login can complete a method comparison study end-to-end in under 20 minutes. By the third study the form is muscle memory.</p>
    <p>Legacy verification software is installed on a Windows workstation or network, which brings installation, activation, and IT involvement. A technologist new to the tool typically spends a half-day to a full day before a first defensible report.</p>
    <p>Time matters most onboarding a new analyzer or analyte. Cutting verification from days to hours moves the go-live date.</p>
  </div>

  <div class="panel">
    <h3>3. Integration breadth</h3>
    <p>VeritaCheck&reg; runs fourteen study types under one tool: Precision Verification (EP15-A3), Method Comparison / Multi-Instrument Correlation (EP09), Calibration Verification (EP06), Linearity (EP06), Reagent Lot Verification (EP26), QC Lot Verification (C24-Ed4), PT/INR Geometric Mean Calculator (H47), Multi-Analyte Lot Comparison, Coag (EP26), Reference Range Verification (EP28), Sensitivity Verification (EP17-A2), Carryover Verification (EP10-A3), Accuracy / Bias (EP15-A3), Reportable Range / AMR Verification (42 CFR 493.1253(b)(1)(i)(C)), and Manual Differential (CLSI H20).</p>
    <p>Around it in the same VeritaAssure&reg; platform: VeritaDC&trade;, VeritaMap&reg;, VeritaComp&trade;, VeritaLab&trade;, VeritaOps&trade;, VeritaStock&trade;. One login covers all of them.</p>
    <p>Legacy software covers the statistical studies well, and more of them than VeritaCheck&reg; does. What its public materials do not show is a tie from those studies to the test menu, the regulation, and the rest of the lab's compliance records, so that work tends to stay in separate systems and spreadsheets.</p>
  </div>

  <div class="panel">
    <h3>4. Compliance defensibility</h3>
    <p>Every VeritaCheck&reg; PDF has the laboratory director or designee signature block on page 1, alongside the results, the narrative, and the specialty-correct 42 CFR Part 493 citation (Chemistry 493.931, Hematology 493.941, etc.). The ADLM internal goal is shown beside the CLIA PT limit where applicable.</p>
    <p>Once signed, a study is locked. Any change goes through an amendment, and the signed original is archived rather than overwritten. The signer and timestamp are recorded on the study, and deletions and notes go to the lab's audit log. The lab name and CLIA number are in the report header on page 1, alongside the results and the signature block.</p>
    <p>Legacy reports vary in CFR citation accuracy and signature placement. A surveyor has to do their own regulatory cross-reference.</p>
  </div>

</div>

<div class="cta">
  <span><strong>See it:</strong> www.veritaslabservices.com/demo/compliance</span>
  <span>Veritas Lab Services, LLC | info@veritaslabservices.com</span>
</div>

<div class="disclaimer">
  VeritaAssure&reg; is a statistical calculation tool. Results require interpretation by the laboratory director or designee. Legacy figures are typical operator-reported ranges, not a quote from any specific vendor. Lab tier pricing current as of the most recent Stripe schedule. Final approval and clinical determination must be made by the laboratory director or designee.
</div>

</body></html>`;
}

export async function generateWhyVeritaCheckPdf(): Promise<Buffer> {
  const html = buildHtml();
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await setPdfContent(page, html);
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "0mm", right: "0mm", bottom: "14mm", left: "0mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}
