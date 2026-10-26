// scripts/verify-veritaresponse-type-reports.ts
//
// Receipt for the VeritaResponse entry-type reports (Michael 2026-10-26, mock D3, D5, D7): the PT investigation
// report, the alternative-assessment report, the FDA deviation investigation summary and the QC event report.
// For each, with made-up data:
//   - the HTML carries its title, its CFR citation, the lab name and CLIA, the medical director or designee block,
//     no em dash, and escapes what a user typed;
//   - the renderer's layout decision (layoutTypeReport, the production path) keeps the review block on page 1: one report
//     page when it fits, otherwise the block moves under the identification grid and the report continues;
//   - with very long entries the block would fall past page 1 in the default layout, and the page-1 layout (block
//     under the identification grid) keeps it on page 1;
//   - the validator names what is missing.
// Run: npx tsx scripts/verify-veritaresponse-type-reports.ts   (exit 1 on any FAIL)
import puppeteer from "puppeteer";
import { PDFDocument } from "pdf-lib";
import { typeReportHTMLForTest, generateTypeReportPDF, validateTypeReport, layoutTypeReport } from "../server/pdfReport";

let fails = 0;
const ok = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) fails++; };
const user = { lab_name: "Riverside Regional Medical Center", clia_number: "22D0999999" };
const capa = { root_cause: "Control vial left at room temperature.", corrective_action: "Vial discarded; open-vial dating added.", preventive_action: "Start-of-shift check.", monitoring_plan: "QC review at 30, 60 and 90 days." };
const base = { id: 41, status: "open", anchor_date: "2026-10-01", due_date: "2026-10-31", description: "Made-up event <script>alert(1)</script> for the guard.", ...capa };
const cases: Record<string, { finding: any; qc?: any; title: string; cite: string }> = {
  pt_failure: {
    finding: { ...base, source_type: "pt_failure", pt_program: "CAP", pt_event: "2026-B", pt_analyte: "Glucose", pt_score: "60% (3/5)", root_cause_category: "clerical",
      type_details: JSON.stringify({ pt_checklist: { clerical: { answer: "no", note: "Transposed on the form." }, analytic: { answer: "yes", note: "QC fine." } }, evidence_of_correction: "Next event checked." }) },
    title: "PT Investigation Report", cite: "42 CFR 493.1236(a)",
  },
  aaa_escalation: {
    finding: { ...base, source_type: "aaa_escalation", standard_ref: "42 CFR 493.1236(c)(1)", type_details: JSON.stringify({ aaa_method: "Split samples with a reference laboratory.", aaa_criteria: "Within 10 percent.", aaa_results: "2 of 5 outside.", patient_impact: "none", aaa_next_date: "2027-04-01" }) },
    title: "Alternative Assessment Investigation Report", cite: "42 CFR 493.1236(c)",
  },
  fda_deviation: {
    finding: { ...base, source_type: "fda_deviation", fda_product_type: "red_cells", fda_product_id: "W0000 26 012345", fda_event_kind: "deviation", fda_affects_product: 1, fda_in_facility: 1, fda_distributed: 1, fda_info_date: "2026-10-14", fda_report_due: "2026-11-28",
      type_details: JSON.stringify({ fda_disposition: "transfused" }) },
    title: "FDA Deviation Investigation Summary", cite: "21 CFR 606.171(c)",
  },
  qc_escalation: {
    finding: { ...base, source_type: "qc_escalation", finding_number: "QC-1-3s", type_details: JSON.stringify({ qc_rerun: "Reran with a new vial, in range.", qc_cause: "control_material", lookback_runs: "06:10 to 09:42", lookback_results: 38, patient_impact: "none" }) },
    qc: { analyte: "Potassium", level: "Level 2", lot_number: "PWT-2", rule_code: "1-3s", result_value: 5.4, result_date: "2026-10-20", instrument: "Analyzer A" },
    title: "QC Event Report", cite: "42 CFR 493.1282(b)(2)",
  },
};
const long = (s: string) => Array.from({ length: 14 }, () => s).join(" ");

// Same geometry as the renderer: printed width 703 px; page 1 ends at 900 px (943 px printable, CI fonts ~19 px taller).
async function directorBottom(page: any, html: string): Promise<number> {
  await page.setContent(html, { waitUntil: "load" });
  return page.evaluate(() => { const el = document.querySelector(".director-block"); return el ? el.getBoundingClientRect().bottom + window.scrollY : -1; });
}

(async () => {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"], headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 703, height: 943, deviceScaleFactor: 1 });
  for (const [kind, c] of Object.entries(cases)) {
    const html = typeReportHTMLForTest({ finding: c.finding, user, qc: c.qc });
    ok(`${kind}: title, citation, lab identity and review block`, html.includes(c.title) && html.includes(c.cite) && html.includes("Riverside Regional Medical Center") && html.includes("CLIA: 22D0999999") && html.includes("Medical Director or Designee Review"));
    ok(`${kind}: no em dash, user text escaped`, !html.includes("—") && !html.includes("<script>alert(1)</script>") && html.includes("&lt;script&gt;"));
    ok(`${kind}: validator passes a complete entry`, validateTypeReport(c.finding).ok, JSON.stringify(validateTypeReport(c.finding).missing));
    // The renderer's own layout decision, measured in this browser (CI fonts are taller than local, as on the server).
    const lay = await layoutTypeReport(page, { finding: c.finding, user, qc: c.qc });
    const pdf = await generateTypeReportPDF({ finding: c.finding, user, qc: c.qc });
    const pages = (await PDFDocument.load(pdf)).getPageCount();
    // Every VeritaAssure PDF ends with the Copyright and License Terms page (applyLicenseToPuppeteer). A report that
    // fits keeps the review block at its foot on one page; one that does not moves the block under the identification
    // grid and continues on page 2. Either way the block is on page 1 and there is no stray last line on its own page.
    ok(`${kind}: typical entry: review block on page 1, and one report page unless the layout moved the block up`,
      lay.directorBottomPx > 0 && lay.directorBottomPx <= 900 && (lay.directorFirst ? pages >= 3 : pages === 2 && lay.totalPx <= 930),
      `${lay.directorFirst ? "block moved up" : "fits one page"}; total ${Math.round(lay.totalPx)} px, block ${Math.round(lay.directorBottomPx)} px, ${pages} PDF page(s)`);
    const big = { ...c.finding, description: long("A long account of the event, as a laboratory might write it."), root_cause: long("The root cause in detail."), corrective_action: long("The corrective action in detail."), preventive_action: long("Preventive steps in detail."), monitoring_plan: long("Monitoring in detail.") };
    const defaultBottom = await directorBottom(page, typeReportHTMLForTest({ finding: big, user, qc: c.qc }));
    const firstBottom = await directorBottom(page, typeReportHTMLForTest({ finding: big, user, qc: c.qc }, true));
    ok(`${kind}: long entries push the block past page 1 in the default layout, and the page-1 layout keeps it on page 1`, defaultBottom > 900 && firstBottom > 0 && firstBottom <= 900, `default ${Math.round(defaultBottom)} px, page-1 layout ${Math.round(firstBottom)} px`);
    const bigLay = await layoutTypeReport(page, { finding: big, user, qc: c.qc });
    const bigPdf = await generateTypeReportPDF({ finding: big, user, qc: c.qc });
    ok(`${kind}: the long report moves the block up, keeps it on page 1, and renders`, bigLay.directorFirst && bigLay.directorBottomPx <= 900 && (await PDFDocument.load(bigPdf)).getPageCount() >= 3, `block ${Math.round(bigLay.directorBottomPx)} px`);
  }
  const empty = validateTypeReport({ source_type: "qc_escalation", type_details: "{}" });
  ok("validator names what is missing on an empty QC event", empty.missing.join("|") === "What happened|Corrective action|Patient look-back (results evaluated or patient impact)", empty.missing.join("|"));
  await browser.close();
  console.log(fails === 0 ? "\n=== VERITARESPONSE TYPE REPORTS: PASS ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
