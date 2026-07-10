// CMS-116 (CLIA Application for Certification) draft PDF.
//
// Renders the lab's CMS-116 draft into a print-ready 5-page facsimile so
// the laboratory director can download, wet-sign, and mail to their
// State Agency. Reproduces the official OMB 0938-0581 section ordering;
// produced output is identified as a draft prepared in VeritaLab, NOT a
// CMS-issued form (we do not use any CMS official seal or claim to be
// the official form).
//
// Per CLAUDE.md section 5, lab name + CLIA stamped on every page header,
// page X of Y in the footer. Author metadata "Perplexity Computer".
// Per CLAUDE.md section 3, no em dashes in the rendered output.

import { getBrowser } from "./pdfReport";
import { stampPdfAuthor } from "./pdfMeta";

export interface Cms116DraftForPdf {
  sections: {
    i?: Record<string, any>;
    ii?: Record<string, any>;
    iii?: Record<string, any>;
    iv?: Record<string, any>;
    v?: Record<string, any>;
    vi?: Record<string, any>;
    vii?: Record<string, any>;
    viii?: Record<string, any>;
    ix?: Record<string, any>;
    x?: Record<string, any>;
  };
  director_signature_name: string | null;
  director_signature_date: string | null;
  status: string | null;
  notes: string | null;
}

export interface Cms116LabContext {
  labName: string;
  cliaNumber: string;
}

const TEAL = "#01696F";
const TEXT_DARK = "#28251D";

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

function v(obj: Record<string, any> | undefined, key: string): string {
  if (!obj) return "";
  const val = obj[key];
  if (val == null) return "";
  return escapeHtml(String(val));
}

// Box renders as a bordered cell with a labeled top and content area below.
// Always shows the labeled top even if value is empty so the printed form
// looks like a fillable form ready for review.
function field(label: string, value: string, opts: { wide?: boolean } = {}): string {
  const widthClass = opts.wide ? "field field-wide" : "field";
  return `
    <div class="${widthClass}">
      <div class="field-label">${escapeHtml(label)}</div>
      <div class="field-value">${value || "&nbsp;"}</div>
    </div>`;
}

// Checkbox row: shows a filled or empty box next to the option label.
function checkbox(checked: boolean, label: string): string {
  return `<div class="checkbox-row"><span class="checkbox ${checked ? "checked" : ""}">${checked ? "&#10003;" : ""}</span><span>${escapeHtml(label)}</span></div>`;
}

const LAB_TYPE_OPTIONS = [
  "Ambulatory Surgical Center",
  "Ancillary Testing Site in Health Care Facility",
  "Assisted Living Facility",
  "Blood Banks",
  "Community Clinic",
  "Comprehensive Outpatient Rehab Facility",
  "End-Stage Renal Disease Dialysis Facility",
  "Federally Qualified Health Center",
  "Health Maintenance Organization",
  "Home Health Agency",
  "Hospice",
  "Hospital",
  "Independent",
  "Industrial",
  "Insurance",
  "Intermediate Care Facility / Individuals with Intellectual Disabilities",
  "Mobile Laboratory",
  "Other Practitioner",
  "Pharmacy",
  "Physician Office",
  "Prison",
  "Public Health Laboratory",
  "Rural Health Clinic",
  "School/Student Health Service",
  "Skilled Nursing/Nursing Facility",
  "Tissue Bank/Repositories",
  "Other",
];

// Section VIII checkbox groups mirror 42 CFR 493.5 specialty/subspecialty
// categories. Keys correspond to the Cms116FormTab type field names.
const SECTION_VIII_GROUPS: Array<{ label: string; items: Array<[string, string]> }> = [
  { label: "Histocompatibility", items: [
    ["histocompatibility", "Histocompatibility"],
  ]},
  { label: "Microbiology", items: [
    ["micro_bacteriology", "Bacteriology"],
    ["micro_mycobacteriology", "Mycobacteriology"],
    ["micro_mycology", "Mycology"],
    ["micro_parasitology", "Parasitology"],
    ["micro_virology", "Virology"],
  ]},
  { label: "Diagnostic Immunology", items: [
    ["immuno_syphilis_serology", "Syphilis Serology"],
    ["immuno_general", "General Immunology"],
  ]},
  { label: "Chemistry", items: [
    ["chem_routine", "Routine Chemistry"],
    ["chem_urinalysis", "Urinalysis"],
    ["chem_endocrinology", "Endocrinology"],
    ["chem_toxicology", "Toxicology"],
  ]},
  { label: "Hematology", items: [
    ["hematology", "Hematology"],
  ]},
  { label: "Immunohematology", items: [
    ["immunohem_abo_rh", "ABO Group and Rh"],
    ["immunohem_antibody_detection", "Antibody Detection"],
    ["immunohem_antibody_id", "Antibody Identification"],
    ["immunohem_compatibility", "Compatibility Testing"],
  ]},
  { label: "Pathology", items: [
    ["pathology_histopathology", "Histopathology"],
    ["pathology_oral", "Oral Pathology"],
    ["pathology_cytology", "Cytology"],
  ]},
  { label: "Other", items: [
    ["radiobioassay", "Radiobioassay"],
    ["clinical_cytogenetics", "Clinical Cytogenetics"],
  ]},
];

const FOOTER_TEMPLATE = `
<div style="width:100%;padding:0 14mm;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif">
  <div style="border-top:1px solid #d2d7dc;padding-top:3px;display:flex;justify-content:space-between;font-size:7px;color:#646e78">
    <span>VeritaAssure&trade; | VeritaLab&trade; | CMS-116 Draft</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>
</div>`;

function buildCms116Html(draft: Cms116DraftForPdf, ctx: Cms116LabContext): string {
  const s = draft.sections || {};
  const labName = escapeHtml(ctx.labName || "");
  const cliaNumber = escapeHtml(ctx.cliaNumber || "Pending");

  // Section II — certificate type checkboxes
  const certType = (s.ii?.certificate_type as string) || "";
  const accreditingOrg = escapeHtml(s.ii?.accrediting_org || "");

  // Section III — lab type
  const labType = (s.iii?.lab_type as string) || "";
  const labTypeOther = escapeHtml(s.iii?.lab_type_other || "");

  // Section IV — hours
  const hoursPerWeek = escapeHtml(s.iv?.hours_per_week || "");

  // Section V — multiple sites
  const multipleSites = (s.v?.multiple_sites as string) || "";
  const sitesText = escapeHtml(s.v?.sites_text || "");

  // Section VI — waived testing
  const hasWaived = (s.vi?.has_waived_testing as string) || "";
  const waivedVolume = escapeHtml(s.vi?.estimated_annual_volume || "");

  // Section VII — PPM
  const hasPpm = (s.vii?.has_ppm as string) || "";
  const ppmVolume = escapeHtml(s.vii?.estimated_annual_volume || "");

  // Section VIII — specialty/subspecialty checkboxes
  const sectionVIII = s.viii || {};

  // Section IX — total volume
  const totalAnnualVolume = escapeHtml(s.ix?.total_annual_volume || "");

  // Section X — control + director
  const controlType = (s.x?.control_type as string) || "";
  const controlOther = escapeHtml(s.x?.control_other || "");
  const directorName = escapeHtml(s.x?.director_name || "");
  const directorCredentials = escapeHtml(s.x?.director_credentials || "");
  const directorNpi = escapeHtml(s.x?.director_npi || "");
  const directorCliaId = escapeHtml(s.x?.director_clia_director_number || "");

  // Director signature block
  const signatureName = escapeHtml(draft.director_signature_name || "");
  const signatureDate = escapeHtml(draft.director_signature_date || "");

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CMS-116 Draft</title>
<style>
  @page { size: Letter; margin: 14mm 14mm 18mm 14mm; }
  body { font-family: Helvetica, Arial, sans-serif; color: ${TEXT_DARK}; font-size: 9.5pt; line-height: 1.35; margin: 0; }
  .page { page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  .page-header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid ${TEAL}; padding-bottom: 6px; margin-bottom: 10px; }
  .page-header .lab { font-size: 8pt; color: #5a5a5a; text-align: right; }
  .page-header .lab strong { color: ${TEXT_DARK}; }
  .form-title { font-size: 9pt; color: #5a5a5a; line-height: 1.3; }
  .form-title h2 { font-size: 12pt; color: ${TEAL}; margin: 0 0 2px 0; }
  .form-title .omb { font-size: 7.5pt; color: #777; margin-top: 2px; }

  h3.section { color: ${TEAL}; font-size: 11pt; margin: 12px 0 6px 0; padding-bottom: 3px; border-bottom: 1px solid #d2d7dc; }
  .field-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
  .field { flex: 1; min-width: 220px; border: 1px solid #c4c4c4; border-radius: 3px; padding: 4px 6px; background: #fcfcfc; }
  .field-wide { flex-basis: 100%; }
  .field-label { font-size: 7.5pt; color: #5a5a5a; text-transform: uppercase; letter-spacing: 0.3px; }
  .field-value { font-size: 10pt; min-height: 16px; padding-top: 2px; }

  .checkbox-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; font-size: 9.5pt; }
  .checkbox { display: inline-block; width: 13px; height: 13px; border: 1px solid #888; text-align: center; line-height: 12px; font-size: 11px; color: ${TEAL}; background: white; }
  .checkbox.checked { background: ${TEAL}; color: white; }

  .checkbox-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; }
  .specialty-group { border: 1px solid #d2d7dc; padding: 5px 8px; border-radius: 3px; margin-bottom: 6px; }
  .specialty-group .group-label { font-size: 8pt; font-weight: bold; color: ${TEAL}; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 3px; }

  .signature-block { border: 2px solid ${TEAL}; border-radius: 4px; padding: 14px; margin-top: 14px; }
  .signature-block .affirmation { font-size: 9pt; line-height: 1.4; margin-bottom: 14px; }
  .signature-row { display: flex; gap: 16px; align-items: flex-end; }
  .signature-row .sig-line { flex: 2; border-bottom: 1.5px solid ${TEXT_DARK}; padding-bottom: 2px; min-height: 24px; font-size: 10.5pt; font-family: 'Times New Roman', serif; font-style: italic; }
  .signature-row .sig-date { flex: 1; border-bottom: 1.5px solid ${TEXT_DARK}; padding-bottom: 2px; min-height: 24px; font-size: 10pt; }
  .signature-row .sig-printed { flex: 2; border-bottom: 1.5px solid ${TEXT_DARK}; padding-bottom: 2px; min-height: 24px; font-size: 10pt; }
  .signature-caption { font-size: 7.5pt; color: #5a5a5a; margin-top: 3px; text-transform: uppercase; letter-spacing: 0.3px; }

  .mail-block { background: #fff8e1; border: 1px solid #f0c674; border-radius: 4px; padding: 10px 12px; margin-top: 12px; font-size: 9pt; line-height: 1.4; }
  .mail-block strong { color: #8a6d3b; }
  .mail-block .url { font-family: 'Courier New', monospace; }
</style>
</head>
<body>

<!-- ── Page 1 ───────────────────────────────────────────────────────────── -->
<div class="page">
  <div class="page-header">
    <div class="form-title">
      <h2>Form CMS-116</h2>
      <div>Department of Health and Human Services / Centers for Medicare and Medicaid Services</div>
      <div>CLINICAL LABORATORY IMPROVEMENT AMENDMENTS (CLIA) APPLICATION FOR CERTIFICATION</div>
      <div class="omb">OMB No. 0938-0581</div>
    </div>
    <div class="lab">
      <div><strong>${labName || "&nbsp;"}</strong></div>
      <div>CLIA: ${cliaNumber}</div>
    </div>
  </div>

  <h3 class="section">Section I. General Information</h3>
  <div class="field-row">
    ${field("Legal Name of Laboratory", v(s.i, "legal_name"), { wide: true })}
  </div>
  <div class="field-row">
    ${field("Doing Business As (DBA)", v(s.i, "dba"))}
    ${field("Federal Tax ID", v(s.i, "federal_tax_id"))}
  </div>
  <div class="field-row">
    ${field("Street Address", v(s.i, "street"), { wide: true })}
  </div>
  <div class="field-row">
    ${field("City", v(s.i, "city"))}
    ${field("State", v(s.i, "state"))}
    ${field("ZIP", v(s.i, "zip"))}
  </div>
  <div class="field-row">
    ${field("County", v(s.i, "county"))}
    ${field("Telephone", v(s.i, "telephone"))}
    ${field("Fax", v(s.i, "fax"))}
  </div>
  <div class="field-row">
    ${field("Email", v(s.i, "email"), { wide: true })}
  </div>

  <h3 class="section">Section II. Type of Certificate Requested</h3>
  <div>
    ${checkbox(certType === "waiver", "Certificate of Waiver")}
    ${checkbox(certType === "ppm", "Certificate for Provider-Performed Microscopy (PPM)")}
    ${checkbox(certType === "compliance", "Certificate of Compliance")}
    ${checkbox(certType === "accreditation", "Certificate of Accreditation")}
  </div>
  ${certType === "accreditation" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Accrediting Organization", accreditingOrg, { wide: true })}
    </div>
  ` : ""}
</div>

<!-- ── Page 2 ───────────────────────────────────────────────────────────── -->
<div class="page">
  <div class="page-header">
    <div class="form-title">
      <h2>Form CMS-116 (continued)</h2>
    </div>
    <div class="lab">
      <div><strong>${labName || "&nbsp;"}</strong></div>
      <div>CLIA: ${cliaNumber}</div>
    </div>
  </div>

  <h3 class="section">Section III. Type of Laboratory</h3>
  <div class="checkbox-grid">
    ${LAB_TYPE_OPTIONS.map((opt) => checkbox(labType === opt, opt)).join("")}
  </div>
  ${labType === "Other" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Specify Other Laboratory Type", labTypeOther, { wide: true })}
    </div>
  ` : ""}

  <h3 class="section">Section IV. Hours of Laboratory Testing</h3>
  <div class="field-row">
    ${field("Total Hours per Week of Laboratory Testing", hoursPerWeek)}
  </div>

  <h3 class="section">Section V. Multiple Sites</h3>
  <div>
    ${checkbox(multipleSites === "no", "No")}
    ${checkbox(multipleSites === "yes", "Yes")}
  </div>
  ${multipleSites === "yes" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Address of Each Site", sitesText.replace(/\n/g, "<br>"), { wide: true })}
    </div>
  ` : ""}
</div>

<!-- ── Page 3 ───────────────────────────────────────────────────────────── -->
<div class="page">
  <div class="page-header">
    <div class="form-title">
      <h2>Form CMS-116 (continued)</h2>
    </div>
    <div class="lab">
      <div><strong>${labName || "&nbsp;"}</strong></div>
      <div>CLIA: ${cliaNumber}</div>
    </div>
  </div>

  <h3 class="section">Section VI. Waived Testing</h3>
  <div>
    ${checkbox(hasWaived === "no", "No")}
    ${checkbox(hasWaived === "yes", "Yes")}
  </div>
  ${hasWaived === "yes" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Estimated Annual Waived Test Volume", waivedVolume)}
    </div>
  ` : ""}

  <h3 class="section">Section VII. Provider-Performed Microscopy Procedures</h3>
  <div>
    ${checkbox(hasPpm === "no", "No")}
    ${checkbox(hasPpm === "yes", "Yes")}
  </div>
  ${hasPpm === "yes" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Estimated Annual PPM Test Volume", ppmVolume)}
    </div>
  ` : ""}

  <h3 class="section">Section VIII. Non-Waived Testing</h3>
  <div style="font-size:8.5pt;color:#5a5a5a;margin-bottom:6px">
    Check every specialty and subspecialty the laboratory performs. Categories mirror 42 CFR 493.5.
  </div>
  ${SECTION_VIII_GROUPS.map((g) => `
    <div class="specialty-group">
      <div class="group-label">${escapeHtml(g.label)}</div>
      ${g.items.map(([key, label]) => checkbox(Boolean(sectionVIII[key]), label)).join("")}
    </div>
  `).join("")}
</div>

<!-- ── Page 4 ───────────────────────────────────────────────────────────── -->
<div class="page">
  <div class="page-header">
    <div class="form-title">
      <h2>Form CMS-116 (continued)</h2>
    </div>
    <div class="lab">
      <div><strong>${labName || "&nbsp;"}</strong></div>
      <div>CLIA: ${cliaNumber}</div>
    </div>
  </div>

  <h3 class="section">Section IX. Total Annual Test Volume</h3>
  <div class="field-row">
    ${field("Total Annual Non-Waived Test Volume (Estimate)", totalAnnualVolume)}
  </div>
  <div style="font-size:8.5pt;color:#5a5a5a;margin-top:2px">
    Used by CMS to calculate the certificate fee per the published CLIA fee schedule.
  </div>

  <h3 class="section">Section X. Type of Control</h3>
  <div>
    ${checkbox(controlType === "sole_proprietorship", "Sole Proprietorship")}
    ${checkbox(controlType === "partnership", "Partnership")}
    ${checkbox(controlType === "corporation", "Corporation")}
    ${checkbox(controlType === "government", "Government")}
    ${checkbox(controlType === "other", "Other")}
  </div>
  ${controlType === "other" ? `
    <div class="field-row" style="margin-top:8px">
      ${field("Specify Other Control Type", controlOther, { wide: true })}
    </div>
  ` : ""}

  <h3 class="section">Laboratory Director</h3>
  <div class="field-row">
    ${field("Director Name", directorName)}
    ${field("Credentials (MD, DO, PhD, etc.)", directorCredentials)}
  </div>
  <div class="field-row">
    ${field("Director NPI", directorNpi)}
    ${field("CLIA Director ID (if previously assigned)", directorCliaId)}
  </div>
</div>

<!-- ── Page 5: Director Affirmation + Signature ────────────────────────── -->
<div class="page">
  <div class="page-header">
    <div class="form-title">
      <h2>Form CMS-116: Director Affirmation</h2>
    </div>
    <div class="lab">
      <div><strong>${labName || "&nbsp;"}</strong></div>
      <div>CLIA: ${cliaNumber}</div>
    </div>
  </div>

  <div class="signature-block">
    <div class="affirmation">
      <strong>Director Affirmation.</strong> I certify that the information provided in this application is true and accurate to the best of my knowledge. I understand that this laboratory will operate in compliance with the Clinical Laboratory Improvement Amendments of 1988 (42 CFR Part 493) and with the regulations of the state regulatory authority where the laboratory is located. The laboratory director or designee assumes the responsibilities specified at 42 CFR 493.1407 (high-complexity) or 42 CFR 493.1445 (moderate-complexity) for the overall operation and administration of the laboratory.
    </div>
    <div class="signature-row">
      <div>
        <div class="sig-line">${signatureName || "&nbsp;"}</div>
        <div class="signature-caption">Director Signature (wet ink required at submission)</div>
      </div>
      <div>
        <div class="sig-line">${signatureName || "&nbsp;"}</div>
        <div class="signature-caption">Director Printed Name</div>
      </div>
      <div>
        <div class="sig-date">${signatureDate || "&nbsp;"}</div>
        <div class="signature-caption">Date</div>
      </div>
    </div>
  </div>

  <div class="mail-block">
    <strong>To submit.</strong> Print this completed form. The laboratory director signs in wet ink on the Director Signature line above. Mail the signed packet to your State Agency. Find your State Agency contact information at the CMS CLIA program page on www.cms.gov.
  </div>

  <div style="margin-top:16px;font-size:8pt;color:#5a5a5a;line-height:1.4">
    This draft was prepared in VeritaLab&trade; on behalf of the laboratory director. Field values reflect the entries saved at draft time and do not constitute a CMS-issued document. The official CMS-116 form is published by the Centers for Medicare and Medicaid Services at www.cms.gov.
  </div>
</div>

</body></html>`;
}

export async function generateCms116Pdf(draft: Cms116DraftForPdf, ctx: Cms116LabContext): Promise<Buffer> {
  const html = buildCms116Html(draft, ctx);
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
      margin: { top: "14mm", right: "14mm", bottom: "18mm", left: "14mm" },
    });
    return stampPdfAuthor(pdfBuffer);
  } finally {
    await page.close();
  }
}
