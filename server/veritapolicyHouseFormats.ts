// House DOCX formats for VeritaDC drafts (parking lot #71, 2026-10-07).
//
// Standing VLS courtesy: a client emails a draft policy or policy-on-policies and
// we move the stock policies onto THEIR letterhead and format. SCAHC was done as
// pre-uploaded per-policy artifacts (veritapolicy_lab_artifacts, served
// artifact-first). UMass Milford (labs 4 and 5) is the first renderer-based
// format: the stock template content laid out the way Lisa's house document
// is ("Gen 31 Dress code policy Rev 07-25.docx"). The format is chosen per lab
// by veritapolicy_settings.docx_format, which WE set through
// POST /api/admin/veritapolicy/set-house-format after converting the client's
// sample. There is no customer-facing picker. The stock 'veritadc' renderer in
// veritapolicyDocx.ts is untouched for every other lab.
//
// Michael's four calls (2026-10-07): IV. Personal Safety Requirements defaults
// to the lab's own cross-reference sentence (Milford's sample: "Please refer to
// our lab safety policy: Personal Protective Equipment & General Safety
// Requirements."), stored once per lab; house numbers are entered by the lab,
// never generated; no vendor line in the house footer (provenance stays in the
// document properties and the optional "Downloaded by" line); scoped by the
// per-lab setting.
import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TabStopType, TabStopPosition,
  BorderStyle, WidthType, ShadingType, PageNumber, ImageRun, HeightRule,
} from "docx";
import type { PolicyTemplate, LabContext, AccreditorCrosswalk, PolicyDocxOptions } from "./veritapolicyDocx";
import { REDINGTON_FAIRVIEW_LOGO_PNG_B64, SAMPSON_REGIONAL_LOGO_PNG_B64 } from "./veritapolicyHouseAssets";

export const HOUSE_FORMATS = ["veritadc", "umass_milford", "redington_fairview", "sampson_regional"] as const;
export type HouseFormat = (typeof HOUSE_FORMATS)[number];

export interface HouseFormatContext {
  format: HouseFormat;
  facilityPath?: string | null;      // footer path, e.g. "MRMC/Laboratory/General"
  safetyDefault?: string | null;     // Section IV text when the template has none
  houseNumber?: string | null;       // the lab's own number for this policy, e.g. "Gen 31"
  revision?: string | null;          // the lab's revision tag, e.g. "Rev 07-25"
  draftDate: string;                 // YYYY-MM-DD of this render
  watermark?: Paragraph | null;      // UNCONTROLLED COPY paragraph, built by the caller
  watermarkFirst?: Paragraph | null; // a second UNCONTROLLED COPY paragraph for a separate first-page header
  department?: string | null;        // Redington: the department line; "Laboratory" when unset
}

// Her document: Times New Roman 12, black, Roman-numeral section headings.
const FONT = "Times New Roman";
const BLACK = "000000";
const GRAY = "595959";
const SZ = 24;   // 12 pt
const SZ_SM = 20; // 10 pt
const PAGE_W = 9360; // 6.5 in of a letter page with 1 in margins

const SAFETY_PLACEHOLDER = "[Enter the personal safety requirements that apply to this procedure.]";

function run(text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) {
  return new TextRun({ text, font: FONT, size: o.size ?? SZ, bold: o.bold, italics: o.italics, color: o.color ?? BLACK });
}
function para(children: TextRun[], o: { after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; numbering?: string } = {}) {
  return new Paragraph({
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 276 },
    alignment: o.align,
    numbering: o.numbering ? { reference: o.numbering, level: 0 } : undefined,
    children,
  });
}
function heading(label: string) {
  return para([run(label, { bold: true })], { before: 240, after: 120 });
}
function labelLine(label: string, value: string) {
  return para([run(label + " ", { bold: true }), run(value)], { after: 40 });
}
function sub(s: string | undefined, lab: LabContext): string {
  return (s || "").replace(/<<LAB_NAME>>/g, lab.lab_name);
}
function cell(text: string, width: number, o: { bold?: boolean; shade?: boolean } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: o.shade ? { fill: "F2F2F2", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [para([run(text, { bold: o.bold, size: SZ_SM })], { after: 0 })],
  });
}

function revisionHistoryTable(house: HouseFormatContext) {
  const widths = [1500, 1700, 4160, 2000];
  const border = { style: BorderStyle.SINGLE, size: 4, color: BLACK };
  const rows: TableRow[] = [
    new TableRow({ tableHeader: true, children: [
      cell("Revision", widths[0], { bold: true, shade: true }),
      cell("Date", widths[1], { bold: true, shade: true }),
      cell("Description of change", widths[2], { bold: true, shade: true }),
      cell("Approved by", widths[3], { bold: true, shade: true }),
    ] }),
    new TableRow({ children: [
      cell(house.revision || "Draft", widths[0]),
      cell(house.draftDate, widths[1]),
      cell("Initial draft prepared in VeritaDC from the stock policy; content to be reviewed and adopted by the laboratory director or designee.", widths[2]),
      cell("", widths[3]),
    ] }),
    new TableRow({ children: [cell("", widths[0]), cell("", widths[1]), cell("", widths[2]), cell("", widths[3])] }),
    new TableRow({ children: [cell("", widths[0]), cell("", widths[1]), cell("", widths[2]), cell("", widths[3])] }),
  ];
  return new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows,
  });
}

export function buildUmassMilfordDocument(
  tmpl: PolicyTemplate,
  lab: LabContext,
  crosswalk: AccreditorCrosswalk | null,
  opts: PolicyDocxOptions | undefined,
  house: HouseFormatContext,
): Document {
  const children: (Paragraph | Table)[] = [];
  const policyNo = house.houseNumber || "________";
  const revision = house.revision || `Draft ${house.draftDate}`;

  // Header block, in her order: category check-list, folder, sub folder, policy name.
  children.push(para([run("Administrative:")], { after: 0 }));
  children.push(para([run("Administrative/Clinical:")], { after: 0 }));
  children.push(para([run("Clinical:")], { after: 0 }));
  children.push(para([run("Departmental: X")], { after: 160 }));
  children.push(labelLine("Folder Name:", "Laboratory"));
  children.push(labelLine("Sub Folder:", tmpl.section || "General"));
  children.push(labelLine("Policy Name:", tmpl.policy_name));
  children.push(labelLine("Policy No.:", policyNo + "          Revision: " + revision));
  children.push(para([run("")], { after: 120 }));

  // I. PURPOSE
  children.push(heading("I. PURPOSE"));
  if (tmpl.purpose) children.push(para([run(sub(tmpl.purpose, lab))], { numbering: "mil-purpose" }));
  if (tmpl.scope) children.push(para([run(sub(tmpl.scope, lab))], { numbering: "mil-purpose" }));
  if (!tmpl.purpose && !tmpl.scope) children.push(para([run("[Enter the purpose of this policy.]")]));

  // II. POLICY
  children.push(heading("II. POLICY"));
  const statements = tmpl.policy_statements || [];
  if (statements.length) statements.forEach((s) => children.push(para([run(sub(s, lab))], { numbering: "mil-policy" })));
  else children.push(para([run("[Enter the policy statements.]")]));

  // III. GUIDELINES
  children.push(heading("III. GUIDELINES"));
  const steps = tmpl.procedure_steps || [];
  if (steps.length) steps.forEach((s) => children.push(para([run(sub(s, lab))], { numbering: "mil-guidelines" })));
  else children.push(para([run("[Enter the procedure or guideline steps.]")]));
  const defs = (tmpl.definitions || []).filter((d): d is [string, string] => Array.isArray(d) && d.length === 2);
  if (defs.length) {
    children.push(para([run("Definitions:", { bold: true })], { before: 120, after: 60 }));
    defs.forEach(([term, def]) => children.push(para([run(term + ": ", { bold: true }), run(def)], { numbering: "mil-defs" })));
  }

  // IV. PERSONAL SAFETY REQUIREMENTS
  children.push(heading("IV. PERSONAL SAFETY REQUIREMENTS"));
  children.push(para([run((house.safetyDefault || "").trim() || SAFETY_PLACEHOLDER)]));

  // V. REFERENCES
  children.push(heading("V. REFERENCES"));
  const refs: string[] = [];
  for (const b of tmpl.cfr_text_blocks || []) refs.push(b.label ? `${b.citation}, ${b.label}` : b.citation);
  if (crosswalk?.tjc) refs.push(`TJC: ${crosswalk.tjc}`);
  if (crosswalk?.cap) refs.push(`CAP: ${crosswalk.cap}`);
  if (crosswalk?.cola) refs.push(`COLA: ${crosswalk.cola}`);
  if (crosswalk?.aabb) refs.push(`AABB: ${crosswalk.aabb}`);
  if (refs.length) refs.forEach((r) => children.push(para([run(r)], { after: 60 })));
  else children.push(para([run("None cited.")]));

  // Revision history
  children.push(para([run("")], { after: 160 }));
  children.push(para([run("Revision History", { bold: true })], { before: 120, after: 80 }));
  children.push(revisionHistoryTable(house));

  const footerLeft = `${(house.facilityPath || lab.lab_name).replace(/\/+$/, "")}/${policyNo}: ${tmpl.policy_name}`;
  return new Document({
    creator: "Perplexity Computer",
    title: tmpl.policy_name,
    description: "Generated by VeritaPolicy (house format: UMass Milford)",
    styles: { default: { document: { run: { font: FONT, size: SZ } } } },
    numbering: {
      config: [
        { reference: "mil-purpose", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "mil-policy", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "mil-guidelines", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "mil-defs", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      headers: {
        default: new Header({
          children: [
            ...(house.watermark ? [house.watermark] : []),
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [run(lab.lab_name, { size: SZ_SM, color: GRAY }), run("    CLIA: " + lab.clia_number, { size: SZ_SM, color: GRAY })],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
              children: [
                run(footerLeft, { size: SZ_SM }),
                new TextRun({ text: "\t", font: FONT, size: SZ_SM }),
                run(`${revision}    Page `, { size: SZ_SM }),
                new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SZ_SM, color: BLACK }),
                run(" of ", { size: SZ_SM }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: SZ_SM, color: BLACK }),
              ],
            }),
            ...(opts?.downloadedBy
              ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`Downloaded by ${opts.downloadedBy} on ${opts.downloadedAt ?? house.draftDate}`, { size: 16, italics: true, color: GRAY })] })]
              : []),
          ],
        }),
      },
      children,
    }],
  });
}

// ── Redington-Fairview General Hospital (lab 34) ────────────────────────────
// Lindsay Webber sent "Phlebotomy Policy Template.docx" (10/12) and asked that every draft policy use their header and
// format. Matched to the .docx itself on 2026-10-13 (the 10/12 version was built from its text only):
//   first-page header: hospital logo centered, then "Laboratory Department" (Arial Black 12) centered; later pages: none
//   body: labels Arial Black 11, values Arial 11, single spacing, no space after
//   Title, Department, Effective Date, Authorization ___ Date ___, then the sections as a list numbered 01. to 06.
//   (decimalZero, indent 735 / hanging 375): Principle, Policy, Procedure, References, Revised,
//   Biannual Approval/Review Documentation, followed by a blank 5-column x 2-row grid (1870 DXA columns)
//   footer: "Pg. <page>" right-aligned, Calibri 11 (the template's theme font)
// The template's sections are empty; the stock policy content goes under them in Arial 11.
const RF_LABEL_FONT = "Arial Black";
const RF_BODY_FONT = "Arial";
const RF_FOOTER_FONT = "Calibri";
const RF_SZ = 22;            // 11 pt
const RF_HEADER_SZ = 24;     // 12 pt, "Laboratory Department"
const RF_TEXT_INDENT = 735;  // where the numbered section labels' text starts
const RF_ITEM_INDENT = 1095; // numbered / bulleted items under a section

function rfLabel(text: string) {
  return new TextRun({ text, font: RF_LABEL_FONT, size: RF_SZ, color: BLACK });
}
function rfText(text: string, o: { bold?: boolean } = {}) {
  return new TextRun({ text, font: RF_BODY_FONT, size: RF_SZ, bold: o.bold, color: BLACK });
}
function rfPara(children: TextRun[], o: { indent?: number; numbering?: string; after?: number } = {}) {
  return new Paragraph({
    spacing: { before: 0, after: o.after ?? 0, line: 240 },
    indent: o.numbering ? undefined : (o.indent ? { left: o.indent } : undefined),
    numbering: o.numbering ? { reference: o.numbering, level: 0 } : undefined,
    children,
  });
}
// "Title: <value>" lines: label in Arial Black, value in Arial.
function rfField(label: string, value: string) {
  return rfPara(value ? [rfLabel(label + " "), rfText(value)] : [rfLabel(label + " ")]);
}
// "01. Principle:" ... "06. Biannual Approval/Review Documentation:" (one numbering instance, so 01-06 run on).
// The leading space is in their file too: the Arial Black "01." fills the hanging indent, and the space separates it.
function rfSection(label: string) {
  return rfPara([rfLabel(" " + label)], { numbering: "rf-sections" });
}
// Section content, aligned with the section label's text.
function rfBody(text: string, o: { bold?: boolean; after?: number } = {}) {
  return rfPara([rfText(text, { bold: o.bold })], { indent: RF_TEXT_INDENT, after: o.after ?? 60 });
}
// The template's blank grid under section 06: 5 equal columns, 2 rows, single black borders (Table Grid).
function rfReviewTable() {
  const widths = [1870, 1870, 1870, 1870, 1870];
  const border = { style: BorderStyle.SINGLE, size: 4, color: "auto" };
  const row = (h: number) => new TableRow({
    height: { value: h, rule: HeightRule.ATLEAST },
    children: widths.map((w) => new TableCell({ width: { size: w, type: WidthType.DXA }, children: [rfPara([])] })),
  });
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [row(503), row(440)],
  });
}
function rfFooter(opts: PolicyDocxOptions | undefined, house: HouseFormatContext) {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: "Pg. ", font: RF_FOOTER_FONT, size: RF_SZ }),
          new TextRun({ children: [PageNumber.CURRENT], font: RF_FOOTER_FONT, size: RF_SZ }),
        ],
      }),
      ...(opts?.downloadedBy
        ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Downloaded by ${opts.downloadedBy} on ${opts.downloadedAt ?? house.draftDate}`, font: RF_FOOTER_FONT, size: 16, italics: true, color: GRAY })] })]
        : []),
    ],
  });
}

export function buildRedingtonFairviewDocument(
  tmpl: PolicyTemplate,
  lab: LabContext,
  crosswalk: AccreditorCrosswalk | null,
  opts: PolicyDocxOptions | undefined,
  house: HouseFormatContext,
): Document {
  const children: (Paragraph | Table)[] = [];
  const subst = (s: string | undefined) => (s || "").replace(/<<LAB_NAME>>/g, lab.lab_name);

  children.push(rfPara([])); // the template's blank line under the header
  children.push(rfField("Title:", tmpl.policy_name));
  // Their template reads "Department: Phlebotomy" (the lab section that owns the policy). Our template sections
  // ("Specialty Services", "Testing") are VeritaPolicy categories, not their sections, so the default is "Laboratory".
  children.push(rfField("Department:", (house.department || "").trim() || "Laboratory"));
  children.push(rfField("Effective Date:", ""));
  children.push(rfPara([rfLabel("Authorization: ________________________     Date: ______________")]));

  children.push(rfSection("Principle:"));
  if (tmpl.purpose) children.push(rfBody(subst(tmpl.purpose)));
  if (tmpl.scope) children.push(rfBody(subst(tmpl.scope)));
  if (!tmpl.purpose && !tmpl.scope) children.push(rfBody("[Enter the principle of this policy.]"));

  children.push(rfSection("Policy:"));
  const statements = tmpl.policy_statements || [];
  if (statements.length) statements.forEach((s) => children.push(rfPara([rfText(subst(s))], { numbering: "rf-policy", after: 60 })));
  else children.push(rfBody("[Enter the policy statements.]"));

  children.push(rfSection("Procedure:"));
  const steps = tmpl.procedure_steps || [];
  if (steps.length) steps.forEach((s) => children.push(rfPara([rfText(subst(s))], { numbering: "rf-procedure", after: 60 })));
  else children.push(rfBody("[Enter the procedure steps.]"));
  const defs = (tmpl.definitions || []).filter((d): d is [string, string] => Array.isArray(d) && d.length === 2);
  if (defs.length) {
    children.push(rfBody("Definitions:", { bold: true }));
    defs.forEach(([term, def]) => children.push(rfPara([rfText(term + ": ", { bold: true }), rfText(def)], { numbering: "rf-defs", after: 60 })));
  }

  children.push(rfSection("References:"));
  const refs: string[] = [];
  for (const b of tmpl.cfr_text_blocks || []) refs.push(b.label ? `${b.citation}, ${b.label}` : b.citation);
  if (crosswalk?.tjc) refs.push(`TJC: ${crosswalk.tjc}`);
  if (crosswalk?.cap) refs.push(`CAP: ${crosswalk.cap}`);
  if (crosswalk?.cola) refs.push(`COLA: ${crosswalk.cola}`);
  if (crosswalk?.aabb) refs.push(`AABB: ${crosswalk.aabb}`);
  if (refs.length) refs.forEach((r) => children.push(rfBody(r, { after: 40 })));
  else children.push(rfBody("None cited."));

  children.push(rfSection("Revised:"));
  children.push(rfBody(house.revision || `Draft ${house.draftDate}, prepared in VeritaDC from the stock policy for review and adoption by the laboratory director or designee.`));

  children.push(rfSection("Biannual Approval/Review Documentation:"));
  children.push(rfReviewTable());

  const logo = new ImageRun({
    type: "png",
    data: Buffer.from(REDINGTON_FAIRVIEW_LOGO_PNG_B64, "base64"),
    transformation: { width: 167, height: 72 }, // 1590093 x 683740 EMU, as placed in their template
    altText: { title: lab.lab_name, description: `${lab.lab_name} logo`, name: "Logo" },
  });
  const item = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string) =>
    ({ reference, levels: [{ level: 0, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: RF_ITEM_INDENT, hanging: 360 } }, run: { font: RF_BODY_FONT, size: RF_SZ } } }] });

  return new Document({
    creator: "Perplexity Computer",
    title: tmpl.policy_name,
    description: "Generated by VeritaPolicy (house format: Redington-Fairview)",
    styles: { default: { document: { run: { font: RF_FOOTER_FONT, size: RF_SZ } } } },
    numbering: {
      config: [
        { reference: "rf-sections", levels: [{ level: 0, format: LevelFormat.DECIMAL_ZERO, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: RF_TEXT_INDENT, hanging: 375 } }, run: { font: RF_LABEL_FONT, size: RF_SZ } } }] },
        item("rf-policy", LevelFormat.DECIMAL, "%1."),
        item("rf-procedure", LevelFormat.DECIMAL, "%1."),
        item("rf-defs", LevelFormat.BULLET, "•"),
      ],
    },
    sections: [{
      properties: {
        titlePage: true,
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 } },
      },
      headers: {
        first: new Header({
          children: [
            ...(house.watermarkFirst ? [house.watermarkFirst] : []),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [logo] }),
            new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Laboratory Department", font: RF_LABEL_FONT, size: RF_HEADER_SZ, color: BLACK })] }),
          ],
        }),
        default: new Header({ children: [...(house.watermark ? [house.watermark] : []), new Paragraph({ children: [] })] }),
      },
      footers: { first: rfFooter(opts, house), default: rfFooter(opts, house) },
      children,
    }],
  });
}

// ─── Sampson Regional Medical Center (lab 36), REQ-019 ─────────────────────────────────────────────────────────
// Natalie Lamb sent a PolicyStat printout on 2026-10-08 ("Instituting New Laboratory Test Methods and Ongoing QC
// Assessment") and we told her we would put our stock policies in that format. Layout, from her printout and the
// 10/10 mock (VLS Leads\Sampson Regional\house_format_mock): logo | Origination, Last Approved, Effective, Last
// Revised, Next Review | Owner, Area; centered title over a rule; "Policy:" (purpose, then numbered statements),
// "Scope:", "Procedure:" (Roman-numeral steps), "REFERENCES:" numbered, the "Printed copies are for reference only"
// line, an "Approval Signatures" table; footer "<title>. Copyright (c) <year> <lab>" and "Page X of Y".
// Owner and approvers are role titles from her printout, never a person's name; the approval dates stay blank for
// their document system to fill. Definitions (not in her sample) follow Scope. No vendor line in the footer
// (Michael's 2026-10-07 house-format call).
const SR_FONT = "Arial";
const SR_NAVY = "1B2A47";
const SR_SZ = 21;        // 10.5 pt body
const SR_SZ_SM = 18;     // 9 pt header block, table
const SR_SZ_FOOT = 16;   // 8 pt footer
const SR_ITEM_INDENT = 432; // 0.3 in

function srRun(text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) {
  return new TextRun({ text, font: SR_FONT, size: o.size ?? SR_SZ, bold: o.bold, italics: o.italics, color: o.color ?? BLACK });
}
function srPara(children: TextRun[], o: { indent?: number; numbering?: string; after?: number; before?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) {
  return new Paragraph({
    children,
    alignment: o.align,
    spacing: { after: o.after ?? 100, before: o.before ?? 0 },
    ...(o.numbering ? { numbering: { reference: o.numbering, level: 0 } } : {}),
    ...(o.indent != null && !o.numbering ? { indent: { left: o.indent } } : {}),
  });
}
function srHeading(text: string) {
  return srPara([srRun(text, { bold: true, size: 36, color: SR_NAVY })], { before: 200, after: 40 });
}
function srFmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${m}/${d}/${y}` : iso;
}
const SR_NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
function srNoBorders() {
  return { top: SR_NO_BORDER, bottom: SR_NO_BORDER, left: SR_NO_BORDER, right: SR_NO_BORDER, insideHorizontal: SR_NO_BORDER, insideVertical: SR_NO_BORDER };
}
function srLabelValue(label: string, value: string) {
  return new Paragraph({ spacing: { after: 20 }, children: [srRun(`${label}  `, { size: SR_SZ_SM, color: GRAY }), srRun(value || "________", { size: SR_SZ_SM })] });
}

export function buildSampsonRegionalDocument(
  tmpl: PolicyTemplate,
  lab: LabContext,
  crosswalk: AccreditorCrosswalk | null,
  opts: PolicyDocxOptions | undefined,
  house: HouseFormatContext,
): Document {
  const subst = (s: string | undefined) => (s || "").replace(/<<LAB_NAME>>/g, lab.lab_name);
  const draft = srFmtDate(house.draftDate);
  const children: (Paragraph | Table)[] = [];

  // Header block (page 1 body, as in the PolicyStat printout): logo | dates | owner and area.
  const logo = new ImageRun({
    type: "png",
    data: Buffer.from(SAMPSON_REGIONAL_LOGO_PNG_B64, "base64"),
    transformation: { width: 240, height: 120 }, // 2.5 x 1.25 in, as on her printout
    altText: { title: lab.lab_name, description: `${lab.lab_name} logo`, name: "Logo" },
  });
  const cellOf = (paras: Paragraph[], width: number) => new TableCell({ children: paras, width: { size: width, type: WidthType.DXA }, borders: srNoBorders() });
  children.push(new Table({
    width: { size: 9936, type: WidthType.DXA },
    columnWidths: [3888, 3024, 3024],
    borders: srNoBorders(),
    rows: [new TableRow({ children: [
      cellOf([new Paragraph({ children: [logo] })], 3888),
      cellOf([
        srLabelValue("Origination", draft),
        srLabelValue("Last Approved", ""),
        srLabelValue("Effective", ""),
        srLabelValue("Last Revised", house.revision ? house.revision : draft),
        srLabelValue("Next Review", ""),
      ], 3024),
      cellOf([
        srLabelValue("Owner", "Director of Laboratory Services"),
        srLabelValue("Area", (house.department || "").trim() || "Laboratory"),
        ...(house.houseNumber ? [srLabelValue("Document", house.houseNumber)] : []),
      ], 3024),
    ] })],
  }));

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BFBFBF", space: 8 } },
    children: [srRun(tmpl.policy_name, { bold: true, size: 34 })],
  }));

  children.push(srHeading("Policy:"));
  if (tmpl.purpose) children.push(srPara([srRun(subst(tmpl.purpose))]));
  const statements = tmpl.policy_statements || [];
  statements.forEach((s) => children.push(srPara([srRun(subst(s))], { numbering: "sr-policy" })));
  if (!tmpl.purpose && !statements.length) children.push(srPara([srRun("[Enter the policy statements.]")]));

  children.push(srHeading("Scope:"));
  children.push(srPara([srRun(subst(tmpl.scope) || "[Enter the scope of this policy.]")]));

  const defs = (tmpl.definitions || []).filter((d): d is [string, string] => Array.isArray(d) && d.length === 2);
  if (defs.length) {
    children.push(srHeading("Definitions:"));
    defs.forEach(([term, def]) => children.push(srPara([srRun(`${term}: `, { bold: true }), srRun(subst(def))], { indent: SR_ITEM_INDENT })));
  }

  children.push(srHeading("Procedure:"));
  const steps = tmpl.procedure_steps || [];
  if (steps.length) steps.forEach((s) => children.push(srPara([srRun(subst(s))], { numbering: "sr-procedure" })));
  else children.push(srPara([srRun("[Enter the procedure steps.]")]));

  children.push(srPara([srRun("REFERENCES:", { bold: true })], { before: 200 }));
  const refs: string[] = [];
  for (const b of tmpl.cfr_text_blocks || []) refs.push(b.label ? `${b.citation}, ${b.label}` : b.citation);
  if (crosswalk?.tjc) refs.push(`TJC: ${crosswalk.tjc}`);
  if (crosswalk?.cap) refs.push(`CAP: ${crosswalk.cap}`);
  if (crosswalk?.cola) refs.push(`COLA: ${crosswalk.cola}`);
  if (crosswalk?.aabb) refs.push(`AABB: ${crosswalk.aabb}`);
  if (refs.length) refs.forEach((r) => children.push(srPara([srRun(r)], { numbering: "sr-refs", after: 60 })));
  else children.push(srPara([srRun("None cited.")]));
  children.push(srPara([srRun("Printed copies are for reference only. Please refer to the electronic copy for the latest version.", { size: 19 })], { before: 160 }));

  children.push(srHeading("Approval Signatures"));
  const gridBorder = { style: BorderStyle.SINGLE, size: 4, color: "7F7F7F" };
  const grid = { top: gridBorder, bottom: gridBorder, left: gridBorder, right: gridBorder };
  const sigCell = (text: string, width: number, bold = false) => new TableCell({
    width: { size: width, type: WidthType.DXA }, borders: grid,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: [srRun(text, { size: 19, bold })] })],
  });
  children.push(new Table({
    width: { size: 9936, type: WidthType.DXA },
    columnWidths: [3312, 4320, 2304],
    rows: [
      new TableRow({ children: [sigCell("Step Description", 3312, true), sigCell("Approver", 4320, true), sigCell("Date", 2304, true)] }),
      new TableRow({ children: [sigCell("", 3312), sigCell("Medical Director or Designee", 4320), sigCell("", 2304)] }),
      new TableRow({ children: [sigCell("", 3312), sigCell("Director of Laboratory Services", 4320), sigCell("", 2304)] }),
    ],
  }));

  const year = house.draftDate.slice(0, 4);
  const footer = new Footer({
    children: [
      new Paragraph({ children: [srRun(`${tmpl.policy_name}. Copyright \u00A9 ${year} ${lab.lab_name}`, { size: SR_SZ_FOOT })] }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          srRun("Page ", { size: SR_SZ_FOOT }),
          new TextRun({ children: [PageNumber.CURRENT], font: SR_FONT, size: SR_SZ_FOOT }),
          srRun(" of ", { size: SR_SZ_FOOT }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SR_FONT, size: SR_SZ_FOOT }),
        ],
      }),
      ...(opts?.downloadedBy
        ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [srRun(`Downloaded by ${opts.downloadedBy} on ${opts.downloadedAt ?? house.draftDate}`, { size: SR_SZ_FOOT, italics: true, color: GRAY })] })]
        : []),
    ],
  });
  const list = (reference: string, format: (typeof LevelFormat)[keyof typeof LevelFormat], text: string, bold = false) =>
    ({ reference, levels: [{ level: 0, format, text, alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: SR_ITEM_INDENT + 360, hanging: 360 } }, run: { font: SR_FONT, size: SR_SZ, bold } } }] });

  return new Document({
    creator: "Perplexity Computer",
    title: tmpl.policy_name,
    description: "Generated by VeritaPolicy (house format: Sampson Regional)",
    styles: { default: { document: { run: { font: SR_FONT, size: SR_SZ } } } },
    numbering: {
      config: [
        list("sr-policy", LevelFormat.DECIMAL, "%1."),
        list("sr-procedure", LevelFormat.UPPER_ROMAN, "%1.", true),
        list("sr-refs", LevelFormat.DECIMAL, "%1."),
      ],
    },
    sections: [{
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1008, right: 1152, bottom: 1152, left: 1152, header: 576, footer: 576 } },
      },
      headers: { default: new Header({ children: house.watermark ? [house.watermark] : [new Paragraph({ children: [] })] }) },
      footers: { default: footer },
      children,
    }],
  });
}
