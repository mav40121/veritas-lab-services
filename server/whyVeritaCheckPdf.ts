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

const TEAL = "#01696F";
const TEAL_TINT = "#E6F2F2";
const TEXT_DARK = "#28251D";

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&trade; | VeritaCheck&trade; positioning | www.veritaslabservices.com</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

function buildHtml(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Why VeritaCheck</title>
<style>
  @page { size: Letter; margin: 12mm 12mm 16mm 12mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${TEXT_DARK}; font-size: 9pt; line-height: 1.35; margin: 0; }
  .title-bar { background: ${TEAL}; color: white; padding: 10px 14px; }
  .title-bar h1 { font-size: 16pt; margin: 0; font-weight: bold; }
  .title-bar .sub { font-size: 9pt; opacity: 0.92; margin-top: 2px; }
  .lede { padding: 10px 14px 6px; font-size: 9pt; line-height: 1.45; color: #303030; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px 14px; }
  .panel { border: 1px solid #d2d7dc; border-radius: 4px; padding: 9px 11px; background: #fbfdfd; }
  .panel h3 { color: ${TEAL}; font-size: 10pt; margin: 0 0 5px 0; font-weight: bold; border-bottom: 1px solid ${TEAL_TINT}; padding-bottom: 3px; }
  .panel p { margin: 0 0 5px 0; font-size: 8.5pt; line-height: 1.4; }
  .panel p:last-child { margin-bottom: 0; }
  .closing { background: ${TEAL_TINT}; border-top: 2px solid ${TEAL}; padding: 9px 14px; margin-top: 6px; }
  .closing h3 { color: ${TEAL}; font-size: 10pt; margin: 0 0 4px 0; }
  .closing p { margin: 0 0 4px 0; font-size: 8.5pt; line-height: 1.4; }
  .closing p:last-child { margin-bottom: 0; }
  .cta { background: ${TEAL}; color: white; padding: 8px 14px; display: flex; justify-content: space-between; align-items: center; font-size: 9pt; }
  .cta strong { font-size: 10pt; }
  .disclaimer { padding: 8px 14px; font-size: 6.5pt; color: #7a7a7a; line-height: 1.35; }
</style>
</head>
<body>

<div class="title-bar">
  <h1>Why VeritaCheck&trade; vs. Legacy Verification Software</h1>
  <div class="sub">A side-by-side comparison for lab directors evaluating a tool change. Four dimensions: cost, time-to-first-study, integration breadth, compliance defensibility.</div>
</div>

<div class="lede">
  <p style="margin:0 0 5px 0">Most clinical laboratories that run method verification studies today use a legacy desktop verification tool that has been the de facto standard for the better part of two decades. The tool works. It is also priced for an era before browser-based clinical software, structured to assume a single Windows workstation, and integrated only with itself.</p>
  <p style="margin:0">VeritaCheck&trade; is a browser-based alternative that produces the same verification studies under the same CLSI EP standards, at a cost that is closer to a consumer SaaS subscription than a per-seat enterprise license, integrated into a broader VeritaAssure&trade; platform that handles policy, mapping, competency, lab certificates, and cost-per-reportable-test in one login.</p>
</div>

<div class="grid">

  <div class="panel">
    <h3>1. Cost</h3>
    <p>VeritaCheck&trade; Unlimited is $299 in Year 1, $499 per year after, for the entire lab. Per-study pricing for occasional users is $25 per study, one-time. Reviewer seats (medical director or designee, technical consultant, technical supervisor) are unlimited and free on every paid plan.</p>
    <p>Legacy verification software is typically licensed per seat at $800 to $3,000 per analyst per year, with the medical director sometimes counted as a billable seat. A community-hospital lab with three testing technologists and one reviewer pays the legacy tool between $2,400 and $9,000 per year before any tech time is spent on a study.</p>
    <p>The CFO sees a $499 line as a rounding error. A $5,000 line gets reviewed every renewal cycle.</p>
  </div>

  <div class="panel">
    <h3>2. Time to first study</h3>
    <p>VeritaCheck&trade; opens in a browser. No install, no driver, no IT ticket. A technologist with a fresh login completes a method comparison study end-to-end (data entry, calculation, PDF) in under 20 minutes. By the third study the form is muscle memory.</p>
    <p>Legacy verification software requires installation on a Windows workstation, training on the spreadsheet-style data entry, and IT involvement when the workstation changes. A new user typically spends a half-day to a full day before producing a first defensible report.</p>
    <p>Time matters most onboarding a new analyzer or analyte. Verification studies are on the critical path to go-live. Cutting them from days to hours moves the date.</p>
  </div>

  <div class="panel">
    <h3>3. Integration breadth</h3>
    <p>VeritaCheck&trade; runs nine study types under one tool: Precision Verification (EP15), Correlation / Method Comparison, Calibration Verification / Linearity, Reagent Lot Verification (EP26-A), QC Lot Verification (C24-Ed4), PT/INR Geometric Mean (H47), Multi-Analyte Lot Comparison (Coag), Reference Range Verification, and Analytical Sensitivity (EP17-A2).</p>
    <p>Around it in the same VeritaAssure&trade; platform: VeritaPolicy&trade; for required policies, VeritaMap&trade; for the test menu, VeritaComp&trade; for competency, VeritaLab&trade; for certificates and CMS-116, VeritaOps&trade; for cost-per-reportable-test, VeritaStock&trade; for inventory. One login covers all of them.</p>
    <p>Legacy verification software covers method comparison and precision well. The other study types are scattered across separate vendors or spreadsheets. Director time is the cost the customer rarely tallies.</p>
  </div>

  <div class="panel">
    <h3>4. Compliance defensibility</h3>
    <p>Every VeritaCheck&trade; PDF has the laboratory director or designee signature block on page 1, alongside the results, the narrative, and the specialty-correct 42 CFR Part 493 citation (Chemistry 493.931, Hematology 493.927, etc.). ADLM internal goals appear alongside CLIA Total Allowable Error where applicable.</p>
    <p>Every change to a study is captured in the lab's audit log with timestamp and user identity. The lab name and CLIA number are stamped on every page header, so the document survives copy, photocopy, and PDF combination without losing identifying context.</p>
    <p>Legacy verification reports vary in CFR citation accuracy and signature placement. A surveyor reviewing the report has to do their own regulatory cross-reference.</p>
  </div>

</div>

<div class="closing">
  <h3>When to switch</h3>
  <p><strong>Strongest case:</strong> a license renewal coming due, an analyzer being added or replaced, a new lab director taking over, or a survey approaching. The verification studies needed at each of those moments are the studies VeritaCheck&trade; was designed to streamline.</p>
  <p><strong>Weakest case:</strong> mid-project. If the lab is in the middle of a multi-analyte verification campaign on the legacy tool, finish it on the legacy tool and re-evaluate at the next natural break.</p>
  <p>VeritaCheck&trade; is included in every VeritaAssure&trade; paid plan from Clinic ($999 / year) upward. Standalone VeritaCheck&trade; Unlimited is $299 Year 1, $499 / year after. Per-Study at $25 one-time exists for labs that want to test against a single planned study before committing.</p>
</div>

<div class="cta">
  <span><strong>See it:</strong> open the demo at www.veritaslabservices.com/demo/compliance</span>
  <span>Veritas Lab Services, LLC | info@veritaslabservices.com</span>
</div>

<div class="disclaimer">
  VeritaAssure&trade; is a statistical calculation tool. All results require interpretation by the laboratory director or designee. The figures cited for legacy verification software are typical operator-reported ranges, not a quote from a specific vendor. Lab tier pricing is current as of the most recent Stripe schedule. The Clinical Laboratory Improvement Amendments of 1988 (42 CFR Part 493) and the CLSI EP standards cited are the regulatory and procedural authorities a laboratory should reference for verification of performance specifications. Final approval and clinical determination must be made by the laboratory director or designee.
</div>

</body></html>`;
}

export async function generateWhyVeritaCheckPdf(): Promise<Buffer> {
  const html = buildHtml();
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
      margin: { top: "0mm", right: "0mm", bottom: "14mm", left: "0mm" },
    });
    return Buffer.from(pdfBuffer as ArrayBuffer);
  } finally {
    await page.close();
  }
}
