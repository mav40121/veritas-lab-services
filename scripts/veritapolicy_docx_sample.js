/**
 * VeritaPolicy DOCX sample generator.
 *
 * Reads a JSON template from server/policyTemplates/data/ and renders a
 * branded Word document for one combined policy. Used as the mock that
 * Michael reviews before the server-side endpoint is wired up.
 *
 * Same logic ports to server/veritapolicyDocx.ts; this script keeps the
 * shape of the document under version control.
 *
 * Usage:
 *   node scripts/veritapolicy_docx_sample.js <policyId> <outputPath>
 *
 * Default: builds #110 to the user's desktop sample location.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TabStopType, TabStopPosition,
  HeadingLevel, BorderStyle, WidthType, ShadingType, PageNumber,
} from "docx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLICY_ID = process.argv[2] || "110";
const OUT_PATH = process.argv[3] || "C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products\\VeritaPolicy_Sample_110_InfectionPrevention.docx";

// Demo lab fixture per CLAUDE.md §7.
const LAB_NAME = "Riverside Regional Medical Center";
const CLIA = "22D0999999";

// Brand palette per CLAUDE.md §6.
const TEAL = "01696F";
const TEAL_DARK = "0A3A3D";
const TINT = "E6F2F2";
const TEXT_DARK = "28251D";
const ALT_ROW = "EBF3F8";
const HAIR_GRAY = "D0D0D0";

const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "server", "policyTemplates", "data");

function findTemplate(policyId) {
  const padded = String(policyId).padStart(3, "0");
  const match = fs.readdirSync(DATA_DIR).find((f) => f.startsWith(padded + "_") && f.endsWith(".json"));
  if (!match) throw new Error(`Template not found for policy_id=${policyId}`);
  return path.join(DATA_DIR, match);
}

function loadTemplate(policyId) {
  const tmpl = JSON.parse(fs.readFileSync(findTemplate(policyId), "utf-8"));
  const sub = (s) => (s || "").replace(/<<LAB_NAME>>/g, LAB_NAME);
  return {
    ...tmpl,
    purpose: sub(tmpl.purpose),
    scope: sub(tmpl.scope),
    policy_statements: (tmpl.policy_statements || []).map(sub),
    procedure_steps: (tmpl.procedure_steps || []).map(sub),
  };
}

// ─── Paragraph builders ──────────────────────────────────────────────────────

function brandBar() {
  // Full-width single-cell table with teal fill carries the wordmark.
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

function titleBlock(policyName, policyId) {
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

function identityRow() {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: "Prepared for: ", bold: true, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: LAB_NAME, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: "\t" }),
      new TextRun({ text: "CLIA: ", bold: true, color: TEXT_DARK, size: 22, font: "Calibri" }),
      new TextRun({ text: CLIA, color: TEXT_DARK, size: 22, font: "Calibri" }),
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
  // Tinted cell to draw the eye to the director verdict per CLAUDE.md §5.
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
              new TextRun({ text: "Signature:   ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Date:           ", bold: true, color: TEXT_DARK, size: 20, font: "Calibri" }),
              new TextRun({ text: "______________________________________", color: TEXT_DARK, size: 20, font: "Calibri" }),
            ],
          }),
        ],
      })],
    })],
  });
}

function sectionHeading(label) {
  return new Paragraph({
    spacing: { before: 360, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL, space: 4 } },
    children: [new TextRun({ text: label, color: TEAL_DARK, bold: true, size: 28, font: "Calibri" })],
  });
}

function bodyPara(text) {
  return new Paragraph({
    spacing: { after: 160, line: 300 },
    children: [new TextRun({ text, color: TEXT_DARK, size: 22, font: "Calibri" })],
  });
}

function numberedItem(text, ref) {
  return new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 120, line: 300 },
    children: [new TextRun({ text, color: TEXT_DARK, size: 22, font: "Calibri" })],
  });
}

function bulletedDefinition(term, definition) {
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

function cfrExcerpt(block) {
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

// ─── Document assembly ───────────────────────────────────────────────────────

function buildDoc(tmpl) {
  const children = [];

  children.push(brandBar());
  children.push(...titleBlock(tmpl.policy_name, tmpl.policy_id));
  children.push(identityRow());
  children.push(dateLines());
  children.push(signatureBlock());

  children.push(sectionHeading("Purpose"));
  children.push(bodyPara(tmpl.purpose));

  children.push(sectionHeading("Scope"));
  children.push(bodyPara(tmpl.scope));

  children.push(sectionHeading("Policy Statements"));
  (tmpl.policy_statements || []).forEach((s) => children.push(numberedItem(s, "policy-statements")));

  children.push(sectionHeading("Procedure Steps"));
  (tmpl.procedure_steps || []).forEach((s) => children.push(numberedItem(s, "procedure-steps")));

  children.push(sectionHeading("Definitions"));
  (tmpl.definitions || []).forEach((d) => {
    if (Array.isArray(d) && d.length === 2) {
      children.push(bulletedDefinition(d[0], d[1]));
    }
  });

  children.push(sectionHeading("Federal Regulation Excerpts"));
  children.push(bodyPara("The following federal regulation language is reproduced verbatim from the Code of Federal Regulations as source for the obligations carried in this policy."));
  (tmpl.cfr_text_blocks || []).forEach((b) => {
    children.push(cfrExcerpt(b));
    children.push(gap(120));
  });

  // The footer text below is fixed brand boilerplate per CLAUDE.md §5 and uses an em-dash
  // intentionally. The em-dash ban in CLAUDE.md §3 does not apply to this boilerplate string.
  return new Document({
    creator: "Perplexity Computer",
    title: tmpl.policy_name,
    description: "Generated by VeritaPolicy",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
    },
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
          size: { width: 12240, height: 15840 }, // US Letter
          margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [
              new TextRun({ text: LAB_NAME, color: TEAL_DARK, size: 18, font: "Calibri" }),
              new TextRun({ text: "    CLIA: " + CLIA, color: TEAL_DARK, size: 18, font: "Calibri" }),
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const tmpl = loadTemplate(POLICY_ID);
  console.log(`Loaded template #${POLICY_ID}: ${tmpl.policy_name}`);
  console.log(`  ${tmpl.policy_statements.length} statements, ${tmpl.procedure_steps.length} steps, ${tmpl.definitions.length} defs, ${tmpl.cfr_text_blocks.length} CFR blocks`);

  const doc = buildDoc(tmpl);
  const buffer = await Packer.toBuffer(doc);

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, buffer);
  console.log(`Wrote ${OUT_PATH}  (${buffer.length.toLocaleString()} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
