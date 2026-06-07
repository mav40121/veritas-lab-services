/**
 * VeritaPolicy per-policy DOCX generator.
 *
 * Reads a JSON template from server/policyTemplates/data/, substitutes the
 * lab identity tokens, and produces a branded Word document suitable for the
 * Laboratory Director or designee to adopt as their lab's policy.
 *
 * Used by the lab-scoped route at
 *   GET /api/labs/:labId/veritapolicy/templates/:policyId/docx
 *
 * Format mirrors scripts/veritapolicy_docx_sample.js (the reviewer mock).
 */

import fs from "node:fs";
import path from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TabStopType, TabStopPosition,
  BorderStyle, WidthType, ShadingType, PageNumber,
} from "docx";

// Brand palette per CLAUDE.md §6.
const TEAL = "01696F";
const TEAL_DARK = "0A3A3D";
const TINT = "E6F2F2";
const TEXT_DARK = "28251D";
const HAIR_GRAY = "D0D0D0";

// Cascade fallbacks: dev (tsx) reads from source tree under server/, while
// Railway-built bundle reads from the data tree copied into dist/. This
// mirrors the pattern used by hospitals.json loaders in server/data.
const TEMPLATE_DIR_CANDIDATES = [
  path.join(process.cwd(), "server", "policyTemplates", "data"),
  path.join(process.cwd(), "dist", "policyTemplates", "data"),
  path.join(process.cwd(), "policyTemplates", "data"),
];

function resolveDataDir(): string | null {
  for (const c of TEMPLATE_DIR_CANDIDATES) {
    try { if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c; } catch {}
  }
  return null;
}

export interface PolicyTemplate {
  policy_id: string;
  slug?: string;
  policy_name: string;
  section?: string;
  purpose?: string;
  scope?: string;
  policy_statements?: string[];
  procedure_steps?: string[];
  definitions?: Array<[string, string] | string>;
  cfr_text_blocks?: Array<{ citation: string; label?: string; verbatim: string }>;
}

export interface LabContext {
  lab_name: string;
  clia_number: string;
}

// Accreditor citations for the policy, filtered to the lab's enabled
// accreditors. Each entry is the raw citation string from the master
// list (e.g. "QSA.05.04.01; QSA.05.05.01" for TJC). Empty/undefined
// entries are skipped at render time.
export interface AccreditorCrosswalk {
  cfr?: string;
  tjc?: string;
  cap?: string;
  cola?: string;
  aabb?: string;
}

export function findTemplatePath(policyId: string): string | null {
  const dataDir = resolveDataDir();
  if (!dataDir) return null;
  const padded = String(policyId).padStart(3, "0");
  try {
    const entries = fs.readdirSync(dataDir);
    const match = entries.find((f) => f.startsWith(padded + "_") && f.endsWith(".json"));
    return match ? path.join(dataDir, match) : null;
  } catch {
    return null;
  }
}

export function loadTemplate(policyId: string): PolicyTemplate | null {
  const p = findTemplatePath(policyId);
  if (!p) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PolicyTemplate;
  } catch {
    return null;
  }
}

function sub(s: string | undefined, lab: LabContext): string {
  return (s || "").replace(/<<LAB_NAME>>/g, lab.lab_name);
}

// ─── Paragraph builders ──────────────────────────────────────────────────────

function brandBar() {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
               left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: TEAL, type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
        children: [new Paragraph({
          children: [new TextRun({ text: "VeritaAssure™  |  VeritaPolicy™", color: "FFFFFF", bold: true, size: 24, font: "Calibri" })],
        })],
      })],
    })],
  });
}

function titleBlock(policyName: string, policyId: string) {
  return [
    new Paragraph({
      spacing: { before: 360, after: 60 },
      children: [new TextRun({ text: `Policy ${policyId}`, color: TEAL, bold: true, size: 22, font: "Calibri" })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun({ text: policyName, color: TEXT_DARK, bold: true, size: 36, font: "Calibri" })],
    }),
  ];
}

function identityRow(lab: LabContext) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: "Prepared for: ", bold: true, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: lab.lab_name, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: "\t" }),
      new TextRun({ text: "CLIA: ", bold: true, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: lab.clia_number, color: TEXT_DARK, size: 22, font: "Calibri" }),
    ],
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
  });
}

function dateLines() {
  return new Paragraph({
    spacing: { after: 240 },
    children: [
      new TextRun({ text: "Effective Date: ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
      new TextRun({ text: "________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
      new TextRun({ text: "\t" }),
      new TextRun({ text: "Next Review Due: ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
      new TextRun({ text: "________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
    ],
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
  });
}

function signatureBlock() {
  // Wave A2.1 (2026-06-07): surveyor-defensibility hardening.
  // Adds three move-2 elements to the existing review block:
  //   1. Title line with controlled-vocab hint so surveyors can confirm
  //      the signer holds a role authorized to adopt the policy
  //      (Laboratory Director or designee per CLIA §493.1251).
  //   2. Annual review-due-date line for the lab to mark forward when
  //      the next review is required (matches §493.1251(b)(13) annual
  //      review cycle).
  //   3. Footnote citing 42 CFR §493.1251(b)(13) so the regulatory
  //      basis for the signature is on the printed page itself.
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: TEAL },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: TEAL },
      left: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      right: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
    },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: TINT, type: ShadingType.CLEAR },
        margins: { top: 200, bottom: 200, left: 240, right: 240 },
        children: [
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: "LABORATORY DIRECTOR OR DESIGNEE REVIEW", bold: true, color: TEAL_DARK, size: 24, font: "Calibri" })],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "☐  Accepted        ", color: TEXT_DARK, size: 22, font: "Calibri" }),
              new TextRun({ text: "☐  Not Accepted", color: TEXT_DARK, size: 22, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Print Name: ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Title:           ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "  (Laboratory Director or designee)", italics: true, color: TEXT_DARK, size: 18, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Signature:   ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 80 },
            children: [
              new TextRun({ text: "Date:           ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({ text: "Annual review due: ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "Per 42 CFR §493.1251(b)(13), the laboratory director is responsible for ensuring procedures are reviewed and approved at least annually by the director or designee.",
                italics: true,
                color: TEXT_DARK,
                size: 16,
                font: "Calibri",
              }),
            ],
          }),
        ],
      })],
    })],
  });
}

function sectionHeading(label: string) {
  return new Paragraph({
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 4 } },
    children: [new TextRun({ text: label, color: TEAL_DARK, bold: true, size: 28, font: "Calibri" })],
  });
}

function bodyPara(text: string) {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    children: [new TextRun({ text, color: TEXT_DARK, size: 22, font: "Calibri" })],
  });
}

function numberedItem(text: string, ref: string) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 120, line: 300 },
    children: [new TextRun({ text, color: TEXT_DARK, size: 22, font: "Calibri" })],
  });
}

function bulletedDefinition(term: string, definition: string) {
  return new Paragraph({
    numbering: { reference: "defs", level: 0 },
    spacing: { after: 120, line: 300 },
    children: [
      new TextRun({ text: term, bold: true, color: TEAL_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: ":  ", color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: definition, color: TEXT_DARK, size: 22, font: "Calibri" }),
    ],
  });
}

function cfrExcerpt(block: { citation: string; label?: string; verbatim: string }) {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: HAIR_GRAY },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: HAIR_GRAY },
      left: { style: BorderStyle.SINGLE, size: 8, color: TEAL },
      right: { style: BorderStyle.SINGLE, size: 2, color: HAIR_GRAY },
    },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: TINT, type: ShadingType.CLEAR },
        margins: { top: 160, bottom: 160, left: 200, right: 200 },
        children: [
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: block.citation, bold: true, color: TEAL_DARK, size: 22, font: "Calibri" }),
              new TextRun({ text: "   " + (block.label || ""), italics: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            spacing: { after: 0, line: 280 },
            children: [new TextRun({ text: block.verbatim, color: TEXT_DARK, size: 20, font: "Calibri" })],
          }),
        ],
      })],
    })],
  });
}

function gap(after = 120) {
  return new Paragraph({ spacing: { after }, children: [new TextRun({ text: "", size: 2 })] });
}

// Crosswalk row: accreditor label in bold teal in the left cell, citation
// string in the right cell. Skips rows where citation is empty.
function crosswalkRow(label: string, citation: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 1440, type: WidthType.DXA },
        shading: { fill: TINT, type: ShadingType.CLEAR },
        margins: { top: 100, bottom: 100, left: 200, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, color: TEAL_DARK, size: 22, font: "Calibri" })],
        })],
      }),
      new TableCell({
        width: { size: 7920, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 200, right: 200 },
        children: [new Paragraph({
          children: [new TextRun({ text: citation, color: TEXT_DARK, size: 22, font: "Calibri" })],
        })],
      }),
    ],
  });
}

function crosswalkTable(cw: AccreditorCrosswalk): Table {
  const rows: TableRow[] = [];
  if (cw.cfr)  rows.push(crosswalkRow("CFR",  cw.cfr));
  if (cw.tjc)  rows.push(crosswalkRow("TJC",  cw.tjc));
  if (cw.cap)  rows.push(crosswalkRow("CAP",  cw.cap));
  if (cw.cola) rows.push(crosswalkRow("COLA", cw.cola));
  if (cw.aabb) rows.push(crosswalkRow("AABB", cw.aabb));
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1440, 7920],
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      left:   { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      right:  { style: BorderStyle.SINGLE, size: 4, color: TEAL },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: HAIR_GRAY },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: HAIR_GRAY },
    },
    rows,
  });
}

function hasCrosswalk(cw?: AccreditorCrosswalk | null): boolean {
  if (!cw) return false;
  return !!(cw.cfr || cw.tjc || cw.cap || cw.cola || cw.aabb);
}

// ─── Document assembly ───────────────────────────────────────────────────────

function buildDocument(tmpl: PolicyTemplate, lab: LabContext, crosswalk?: AccreditorCrosswalk | null): Document {
  const children: (Paragraph | Table)[] = [];

  children.push(brandBar());
  children.push(...titleBlock(tmpl.policy_name, tmpl.policy_id));
  children.push(identityRow(lab));
  children.push(dateLines());
  children.push(signatureBlock());

  if (tmpl.purpose) {
    children.push(sectionHeading("Purpose"));
    children.push(bodyPara(sub(tmpl.purpose, lab)));
  }

  if (tmpl.scope) {
    children.push(sectionHeading("Scope"));
    children.push(bodyPara(sub(tmpl.scope, lab)));
  }

  if (hasCrosswalk(crosswalk)) {
    children.push(sectionHeading("Accreditor Crosswalk"));
    children.push(bodyPara("This policy addresses the following regulatory and accreditor obligations. Citations shown reflect the accreditors selected for this laboratory; refer to the source documents for full requirement text."));
    children.push(crosswalkTable(crosswalk!));
    children.push(gap(160));
  }

  if (tmpl.policy_statements && tmpl.policy_statements.length) {
    children.push(sectionHeading("Policy Statements"));
    tmpl.policy_statements.forEach((s) => children.push(numberedItem(sub(s, lab), "policy-statements")));
  }

  if (tmpl.procedure_steps && tmpl.procedure_steps.length) {
    children.push(sectionHeading("Procedure Steps"));
    tmpl.procedure_steps.forEach((s) => children.push(numberedItem(sub(s, lab), "procedure-steps")));
  }

  if (tmpl.definitions && tmpl.definitions.length) {
    children.push(sectionHeading("Definitions"));
    tmpl.definitions.forEach((d) => {
      if (Array.isArray(d) && d.length === 2) {
        children.push(bulletedDefinition(d[0], d[1]));
      }
    });
  }

  if (tmpl.cfr_text_blocks && tmpl.cfr_text_blocks.length) {
    children.push(sectionHeading("Federal Regulation Excerpts"));
    children.push(bodyPara("The following federal regulation language is reproduced verbatim from the Code of Federal Regulations as source for the obligations carried in this policy."));
    tmpl.cfr_text_blocks.forEach((b) => {
      children.push(cfrExcerpt(b));
      children.push(gap(120));
    });
  }

  // Footer below uses em-dash intentionally per CLAUDE.md §5 brand boilerplate.
  return new Document({
    creator: "Perplexity Computer",
    title: tmpl.policy_name,
    description: "Generated by VeritaPolicy",
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        { reference: "policy-statements",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600, hanging: 360 } } } }] },
        { reference: "procedure-steps",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600, hanging: 360 } } } }] },
        { reference: "defs",
          levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 600, hanging: 360 } } } }] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: lab.lab_name, color: TEAL_DARK, size: 18, font: "Calibri" }),
              new TextRun({ text: "    CLIA: " + lab.clia_number, color: TEAL_DARK, size: 18, font: "Calibri" }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "VeritaAssure™  |  VeritaPolicy™  |  Confidential — For Internal Lab Use Only  |  Page ", color: TEXT_DARK, size: 16, font: "Calibri" }),
              new TextRun({ children: [PageNumber.CURRENT], color: TEXT_DARK, size: 16, font: "Calibri" }),
              new TextRun({ text: " of ", color: TEXT_DARK, size: 16, font: "Calibri" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], color: TEXT_DARK, size: 16, font: "Calibri" }),
            ],
          })],
        }),
      },
      children,
    }],
  });
}

export async function generatePolicyDocxBuffer(
  policyId: string,
  lab: LabContext,
  crosswalk?: AccreditorCrosswalk | null,
): Promise<Buffer | null> {
  const tmpl = loadTemplate(policyId);
  if (!tmpl) return null;
  const doc = buildDocument(tmpl, lab, crosswalk ?? null);
  const buf = await Packer.toBuffer(doc);
  return buf;
}
