// CMS-116 worksheet PDF (VeritaLab CMS-116 tab, Download PDF).
//
// Prints the lab's saved CMS-116 entries in the order and with the field names of Form CMS-116 (04/2026), OMB
// 0938-0581, expires 04/30/2029, so the director can copy them onto CMS's own form. It is a worksheet prepared in
// VeritaLab, not the CMS form: it carries no CMS seal and says so on its first and last page, and it tells the lab to
// file CMS's current form with their state agency (Michael 2026-11-15, Q339 = 1; before, it was laid out on the 03/24
// form and said to mail this printout). The fields come from shared/cms116Form.ts, which the tab reads too, and a draft
// saved on the tab's earlier layout is read through normalizeCms116 the same way the tab reads it.
//
// Per CLAUDE.md section 5: lab name and CLIA on every page (the page header template), Page X of Y in the footer,
// author metadata "Perplexity Computer". Per section 3, no em dashes in the rendered output.

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";
import { setPdfContent } from "./pdfContent";
import {
  ACCREDITING_ORGS, CERTIFICATE_TYPES, CMS116_FORM_LABEL, CONTROL_TYPES, DAYS, LAB_TYPES, PPM_PROCEDURES,
  SECTION_TITLES, SITE_EXCEPTIONS, SPECIALTY_GROUPS, normalizeCms116, type RawCms116Sections,
} from "@shared/cms116Form";

export interface Cms116DraftForPdf {
  sections: RawCms116Sections;
  director_signature_name: string | null;
  director_signature_date: string | null;
  status: string | null;
  notes: string | null;
}

export interface Cms116LabContext {
  labName: string;
  cliaNumber: string; // the lab record's CLIA; blank prints "Not on file"
}

const TEAL = "#01696F";
const TEXT_DARK = "#28251D";

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

// A bordered box with its label on top; it always prints, empty or not, so the worksheet reads like the form.
function field(label: string, value: string | null | undefined, opts: { wide?: boolean; narrow?: boolean } = {}): string {
  const cls = opts.wide ? "field field-wide" : opts.narrow ? "field field-narrow" : "field";
  const v = escapeHtml(value || "");
  return `<div class="${cls}"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${v || "&nbsp;"}</div></div>`;
}

function checkbox(checked: boolean, label: string): string {
  return `<div class="checkbox-row"><span class="checkbox ${checked ? "checked" : ""}">${checked ? "&#10003;" : ""}</span><span>${escapeHtml(label)}</span></div>`;
}

function table(headers: string[], rows: string[][], emptyText: string, cls = ""): string {
  if (rows.length === 0) return `<div class="empty-note">${escapeHtml(emptyText)}</div>`;
  return `<table class="grid ${cls}"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c) || "&nbsp;"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

const filled = (o: Record<string, string>) => Object.values(o).some((v) => String(v || "").trim() !== "");

export function cms116HeaderTemplate(labName: string, clia: string): string {
  const cliaText = clia ? `CLIA: ${escapeHtml(clia)}` : "CLIA: Not on file. Enter it in account settings.";
  return `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-bottom:1px solid #d2d7dc;padding-bottom:3px;display:flex;justify-content:space-between;font-size:7.5px;color:#646e78">
    <span>${escapeHtml(CMS116_FORM_LABEL)} worksheet</span>
    <span><strong style="color:${TEXT_DARK}">${escapeHtml(labName) || "&nbsp;"}</strong> &nbsp; ${cliaText}</span>
  </div>
</div>`;
}

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&reg; | VeritaLab&trade; | CMS-116 worksheet | Confidential, For Internal Lab Use Only</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

export function buildCms116Html(draft: Cms116DraftForPdf, ctx: Cms116LabContext): string {
  const { sections: s } = normalizeCms116(draft.sections || {});
  const labName = escapeHtml(ctx.labName || "");
  const a = s.i;

  const certRows = CERTIFICATE_TYPES.map((c) => checkbox(s.ii.certificate_type === c.value, `${c.label} (complete ${c.sections})`)).join("");
  const orgRows = ACCREDITING_ORGS.map((o) => checkbox(s.ii.accrediting_orgs.includes(o), o)).join("");

  const labTypeGrid = LAB_TYPES.map((t) => {
    const other = t.specify && s.iii.lab_type === t.code && s.iii.lab_type_other ? `: ${s.iii.lab_type_other}` : "";
    return checkbox(s.iii.lab_type === t.code, `${t.code} ${t.label}${t.cms ? "*" : ""}${other}`);
  }).join("");

  const hoursRows = DAYS.map((d) => [d.label, s.iv.hours[d.key].from, s.iv.hours[d.key].to]);

  const siteRows = s.v.sites.filter(filled as any).map((x, n) => [String(n + 1), x.name, [x.address, x.city, x.state, x.zip].filter(Boolean).join(", "), x.phone, x.tests]);
  const waivedRows = s.vi.tests.filter(filled as any).map((t) => [t.analyte, t.test_name, t.manufacturer]);
  const nonWaivedRows = s.viii.tests.filter(filled as any).map((t) => [t.analyte, t.test_name, t.manufacturer, t.complexity]);
  const specialtyRows = SPECIALTY_GROUPS.flatMap((g) => g.items.map((it) => {
    const sp = s.viii.specialties[it.key];
    const name = g.label === it.label ? `${it.label} (${it.code})` : `${g.label}: ${it.label} (${it.code})`;
    return [sp.checked ? "Yes" : "", name, sp.accrediting_org, sp.volume];
  }));
  const otherLabRows = s.x.other_labs.filter(filled as any).map((l) => [l.clia_number, l.lab_name]);

  const controlGroups = ["Voluntary Nonprofit", "For Profit", "Government"].map((g) => `
    <div class="control-group"><div class="group-label">${escapeHtml(g)}</div>
      ${CONTROL_TYPES.filter((c) => c.group === g).map((c) => {
        const other = c.specify && s.ix.control_type === c.code && s.ix.control_other ? `: ${s.ix.control_other}` : "";
        return checkbox(s.ix.control_type === c.code, `${c.code} ${c.label}${other}`);
      }).join("")}
    </div>`).join("");

  const yesNo = (v: string) => `${checkbox(v === "yes", "Yes")}${checkbox(v === "no", "No")}`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CMS-116 worksheet</title>
<style>
  @page { size: Letter; margin: 18mm 14mm 18mm 14mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${TEXT_DARK}; font-size: 9pt; line-height: 1.35; margin: 0; }
  h1 { font-size: 13pt; color: ${TEAL}; margin: 0 0 2px 0; }
  .sub { font-size: 8.5pt; color: #5a5a5a; margin-bottom: 8px; }
  .notice { background: #f2f7f7; border: 1px solid #c9dcdc; border-radius: 4px; padding: 8px 10px; font-size: 8.5pt; line-height: 1.4; margin-bottom: 8px; }
  h3.section { color: ${TEAL}; font-size: 10.5pt; margin: 12px 0 6px 0; padding-bottom: 3px; border-bottom: 1px solid #d2d7dc; break-after: avoid; page-break-after: avoid; }
  .block { break-inside: avoid; page-break-inside: avoid; }
  .field-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 5px; }
  .field { flex: 1; min-width: 150px; border: 1px solid #c4c4c4; border-radius: 3px; padding: 3px 6px; background: #fcfcfc; }
  .field-wide { flex-basis: 100%; }
  .field-narrow { flex: 0 0 90px; min-width: 90px; }
  .field-label { font-size: 7pt; color: #5a5a5a; text-transform: uppercase; letter-spacing: 0.3px; }
  .field-value { font-size: 9.5pt; min-height: 14px; padding-top: 1px; }
  .checkbox-row { display: flex; align-items: flex-start; gap: 6px; padding: 1.5px 0; font-size: 8.5pt; }
  .checkbox { flex: 0 0 auto; display: inline-block; width: 11px; height: 11px; border: 1px solid #888; text-align: center; line-height: 10px; font-size: 9px; color: white; background: white; margin-top: 1px; }
  .checkbox.checked { background: ${TEAL}; border-color: ${TEAL}; }
  .cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .cols-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0 12px; }
  .inline { display: flex; gap: 14px; align-items: center; }
  .q { font-size: 8.5pt; margin: 4px 0 2px 0; }
  .group-label { font-size: 7.5pt; font-weight: bold; color: ${TEAL}; text-transform: uppercase; letter-spacing: 0.3px; margin: 3px 0 2px 0; }
  table.grid { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin: 3px 0 6px 0; }
  table.grid th { background: ${TEAL}; color: white; text-align: left; font-weight: bold; padding: 3px 5px; font-size: 7.5pt; }
  table.grid td { border-bottom: 1px solid #e0e3e6; padding: 3px 5px; vertical-align: top; }
  table.grid tr { break-inside: avoid; page-break-inside: avoid; }
  table.sites td:nth-child(4) { white-space: nowrap; }
  .field, .field-row, .checkbox-row, .signature-block, .submit { break-inside: avoid; page-break-inside: avoid; }
  .empty-note { font-size: 8.5pt; color: #7a7974; font-style: italic; margin: 2px 0 6px 0; }
  .signature-block { border: 2px solid ${TEAL}; border-radius: 4px; padding: 10px 12px; margin-top: 10px; }
  .sig-row { display: flex; gap: 14px; align-items: flex-end; margin-top: 8px; }
  .sig-line { flex: 2; border-bottom: 1.5px solid ${TEXT_DARK}; min-height: 20px; font-size: 10pt; padding-bottom: 2px; }
  .sig-date { flex: 1; border-bottom: 1.5px solid ${TEXT_DARK}; min-height: 20px; font-size: 10pt; padding-bottom: 2px; }
  .sig-caption { font-size: 7pt; color: #5a5a5a; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.3px; }
  .submit { background: #fff8e1; border: 1px solid #f0c674; border-radius: 4px; padding: 8px 10px; margin-top: 10px; font-size: 8.5pt; line-height: 1.4; }
</style>
</head>
<body>

<h1>${escapeHtml(CMS116_FORM_LABEL)} worksheet</h1>
<div class="sub">${labName || "&nbsp;"}. Clinical Laboratory Improvement Amendments (CLIA) Application, OMB No. 0938-0581.</div>
<div class="notice">This worksheet lists the entries saved in VeritaLab&trade;, in the order and with the field names of ${escapeHtml(CMS116_FORM_LABEL)}. It is not a CMS form. Copy these entries onto CMS's current Form CMS-116 to file it.</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.i)}</h3>
<div class="block">
  <div class="cols-2">
    <div>
      ${checkbox(a.app_initial, `Initial application${a.anticipated_start_date ? `, anticipated start date ${a.anticipated_start_date}` : ""}`)}
      ${checkbox(a.app_survey, "Survey")}
      ${checkbox(a.app_change_cert_type, "Change in certificate type")}
    </div>
    <div>
      ${checkbox(a.app_change_director, "Change in laboratory director")}
      ${checkbox(a.app_other_changes, `Other changes${a.other_changes_text ? `: ${a.other_changes_text}` : ""}`)}
      <div class="q">Effective date: ${escapeHtml(a.effective_date) || "&nbsp;"}</div>
    </div>
  </div>
  <div class="field-row" style="margin-top:4px">
    ${field("CLIA Identification Number (blank for an initial application)", a.clia_number)}
    ${field("Federal Tax Identification Number (TIN)", a.federal_tax_id)}
  </div>
  <div class="field-row">${field("Facility name", a.facility_name, { wide: true })}</div>
  <div class="field-row">
    ${field("Email address 1", a.email_1)}
    ${field("Email address 2 (optional)", a.email_2)}
  </div>
  <div class="field-row">
    ${field("Email address 3 (optional)", a.email_3)}
    ${field("Email address for CLIA fee coupons (if applicable)", a.email_fee_coupons)}
  </div>
  <div class="field-row">
    ${field("Phone number", a.phone)}
    ${field("Fax number", a.fax)}
  </div>
  <div class="field-row">${field("Facility address (physical location, no P.O. boxes)", a.street, { wide: true })}</div>
  <div class="field-row">${field("Facility address line 2 (building, floor, suite, if applicable)", a.street_2, { wide: true })}</div>
  <div class="field-row">
    ${field("City", a.city)}
    ${field("State", a.state, { narrow: true })}
    ${field("ZIP code", a.zip, { narrow: true })}
  </div>
  <div class="field-row">
    ${field("Name of Laboratory Director (Last, First, Middle initial)", a.director_name)}
    ${field("Laboratory Director phone number", a.director_phone)}
  </div>
  <div class="field-row">
    ${field("Name of Owner", a.owner_name)}
    ${field("Owner phone number", a.owner_phone)}
  </div>
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.ii)}</h3>
<div class="block">
  ${certRows}
  <div class="q">Accreditation organization(s) for CLIA purposes (accredited by, or applied to):</div>
  <div class="cols-3">${orgRows}</div>
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.iii)}</h3>
<div class="block">
  <div class="cols-3">${labTypeGrid}</div>
  <div class="q">Is the laboratory located within a CMS-certified health care facility (facility types marked *)?</div>
  <div class="inline">${yesNo(s.iii.in_cms_certified_facility)}</div>
  <div class="field-row" style="margin-top:4px">${field("If yes, CMS Certification Numbers (CCNs)", s.iii.ccns, { wide: true })}</div>
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.iv)}</h3>
<div class="block">
  ${checkbox(s.iv.testing_24_7, "Testing 24/7")}
  ${s.iv.testing_24_7 ? "" : table(["Day", "From (HH:MM)", "To (HH:MM)"], hoursRows, "")}
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.v)}</h3>
<div class="block">
  <div class="q">Applying for a single site CLIA certificate to cover multiple testing locations?</div>
  <div class="inline">${checkbox(s.v.multiple_sites === "no", "No")}${checkbox(s.v.multiple_sites === "yes", "Yes")}</div>
  ${s.v.multiple_sites === "yes" ? `
    <div class="q">Regulatory exception that applies:</div>
    ${SITE_EXCEPTIONS.map((e) => checkbox(s.v.exception === e.value, e.label)).join("")}
    <div class="field-row" style="margin-top:4px">${field("Number of sites under this certificate", s.v.site_count)}</div>
    ${table(["#", "Laboratory or hospital department", "Address or location", "Phone", "Tests performed / specialty / subspecialty"], siteRows, "No sites entered.", "sites")}
  ` : ""}
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.vi)}</h3>
<div class="block">
  ${checkbox(s.vi.none_performed, "No waived tests are performed")}
  ${s.vi.none_performed ? "" : `
    ${table(["Analyte/Test", "Test Name", "Manufacturer"], waivedRows, "No waived tests entered.")}
    <div class="field-row">${field("Estimated total annual test volume for all waived tests", s.vi.total_volume)}</div>
  `}
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.vii)}</h3>
<div class="block">
  ${checkbox(s.vii.none_performed, "No PPM tests are performed")}
  ${s.vii.none_performed ? "" : `
    ${PPM_PROCEDURES.map((p) => checkbox(Boolean(s.vii.procedures[p.key]), p.label)).join("")}
    <div class="field-row" style="margin-top:4px">${field("Estimated total annual test volume for all PPM tests", s.vii.total_volume)}</div>
  `}
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.viii)}</h3>
<div class="sub" style="margin-bottom:4px">For a Certificate of Compliance or a Certificate of Accreditation. M = moderate complexity, H = high complexity.</div>
${table(["Analyte/Test", "Test Name", "Manufacturer", "M or H"], nonWaivedRows, "No non-waived tests entered.")}
${table(["Performed", "Specialty / subspecialty (code)", "Accrediting organization", "Annual test volume"], specialtyRows, "")}
<div class="field-row">${field("Total estimated annual test volume (all non-waived testing, PPM included)", s.viii.total_volume)}</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.ix)}</h3>
<div class="block">
  <div class="cols-3">${controlGroups}</div>
  <div class="q">Does this facility have partial or full ownership or control by a non-United States-based government or entity?</div>
  <div class="inline">${yesNo(s.ix.foreign_ownership)}</div>
  ${s.ix.foreign_ownership === "yes" ? `<div class="field-row" style="margin-top:4px">${field("Country of origin of the foreign entity", s.ix.foreign_country, { wide: true })}</div>` : ""}
</div>

<h3 class="section">${escapeHtml(SECTION_TITLES.x)}</h3>
<div class="block">
  <div class="sub" style="margin-bottom:4px">Other separately certified laboratories this director directs.</div>
  ${table(["CLIA Number", "Name of Laboratory"], otherLabRows, "None entered.")}
</div>

<div class="block">
  <div class="signature-block">
    <strong>Laboratory Director or Owner</strong>
    <div class="sig-row">
      <div style="flex:2"><div class="sig-line">${escapeHtml(draft.director_signature_name || "") || "&nbsp;"}</div><div class="sig-caption">Print name of Laboratory Director/Owner</div></div>
      <div style="flex:1"><div class="sig-date">${escapeHtml(draft.director_signature_date || "") || "&nbsp;"}</div><div class="sig-caption">Date</div></div>
    </div>
    <div style="font-size:8pt;color:#5a5a5a;margin-top:8px">The laboratory director or owner signs CMS's Form CMS-116, in ink or with a secure electronic signature, not this worksheet.</div>
  </div>
  <div class="submit">
    <strong>To file.</strong> Copy these entries onto CMS's current Form CMS-116 (www.cms.gov). For a PPM, compliance or accreditation certificate, send proof of the laboratory director's qualifications with it. Send the signed form to your state agency, with no payment; the state agency sends a fee coupon after processing it. Your state agency's contact information is on CMS's CLIA state agency list at www.cms.gov.
  </div>
  <div style="margin-top:10px;font-size:7.5pt;color:#5a5a5a;line-height:1.4">
    Prepared in VeritaLab&trade; from the entries saved for this laboratory. This worksheet is not a CMS-issued document. The official Form CMS-116 is published by the Centers for Medicare &amp; Medicaid Services at www.cms.gov.
  </div>
</div>

</body></html>`;
}

export async function generateCms116Pdf(draft: Cms116DraftForPdf, ctx: Cms116LabContext): Promise<Buffer> {
  const html = buildCms116Html(draft, ctx);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await setPdfContent(page, html);
    const pdfBuffer = await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: cms116HeaderTemplate(ctx.labName || "", (ctx.cliaNumber || "").trim()),
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "18mm", right: "14mm", bottom: "18mm", left: "14mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}
