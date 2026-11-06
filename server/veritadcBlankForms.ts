// server/veritadcBlankForms.ts
//
// Blank paper forms a lab can bring into VeritaDC as controlled documents (Michael Q178 = 1, 2026-11-06). Rapid on-site evaluation (ROSE)
// carries a patient label, so it can't be a screen in VeritaAssure: it stays a blank form the lab prints and fills in by hand, and nothing
// from it comes back into the system. This only builds the Word file. The lab adds it through the normal VeritaDC upload (the Use the blank
// ROSE form button fills the upload dialog), so it gets its number, version, approval route and history like any other document, and the lab
// can change it and upload a new version. The lab's name and CLIA come from the live lab record.
import type { Express } from "express";
import {
  AlignmentType, BorderStyle, Document, Footer, HeightRule, Packer, PageNumber, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign, WidthType,
} from "docx";
import { db } from "./db";
import { exportAllPlanBypass } from "./exportAllContext";

const TEAL = "01696F";
const TINT = "E6F2F2";
const INK = "28251D";
const GRID = "A0A0A0";
const FONT = "Calibri";
const CONTENT_WIDTH = 10440; // Letter, 0.6 inch margins

const border = { style: BorderStyle.SINGLE, size: 4, color: GRID };
const borders = { top: border, bottom: border, left: border, right: border };
const text = (t: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) =>
  new TextRun({ text: t, font: FONT, bold: o.bold, size: o.size ?? 20, color: o.color ?? INK, italics: o.italics });
const para = (t: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) =>
  new Paragraph({ children: [text(t, o)], alignment: o.align, spacing: { before: 0, after: o.after ?? 0 } });

type CellOpts = { width: number; shade?: boolean; bold?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] };
const cell = (t: string, o: CellOpts) => new TableCell({
  width: { size: o.width, type: WidthType.DXA },
  borders,
  verticalAlign: VerticalAlign.CENTER,
  shading: o.shade ? { type: ShadingType.CLEAR, fill: TINT, color: "auto" } : undefined,
  margins: { top: 30, bottom: 30, left: 80, right: 80 },
  children: [para(t, { bold: o.bold, align: o.align })],
});

const PASS_W = 800, CODE_W = 1100, INTERP_W = CONTENT_WIDTH - PASS_W - CODE_W;

/** One site: a line to name it, then five passes. The first evaluation of a site is 88172 and each one after it 88177. */
function siteTable(label: string): Table {
  const name = new TableRow({
    children: [new TableCell({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnSpan: 3,
      borders,
      verticalAlign: VerticalAlign.CENTER,
      shading: { type: ShadingType.CLEAR, fill: TINT, color: "auto" },
      margins: { top: 30, bottom: 30, left: 80, right: 80 },
      children: [para(`${label}:`, { bold: true })],
    })],
  });
  const head = new TableRow({
    children: [
      cell("Pass", { width: PASS_W, bold: true, align: AlignmentType.CENTER }),
      cell("Interpretation", { width: INTERP_W, bold: true }),
      cell("Code", { width: CODE_W, bold: true, align: AlignmentType.CENTER }),
    ],
  });
  const rows = [1, 2, 3, 4, 5].map((pass) => new TableRow({
    height: { value: 280, rule: HeightRule.ATLEAST },
    children: [
      cell(String(pass), { width: PASS_W, align: AlignmentType.CENTER }),
      cell("", { width: INTERP_W }),
      cell(pass === 1 ? "88172" : "88177", { width: CODE_W, align: AlignmentType.CENTER }),
    ],
  }));
  return new Table({ width: { size: CONTENT_WIDTH, type: WidthType.DXA }, columnWidths: [PASS_W, INTERP_W, CODE_W], rows: [name, head, ...rows] });
}

/** The blank ROSE form, one Letter page, with the lab's name and CLIA on it. */
export async function generateRoseBlankForm(identity: { labName: string; cliaNumber: string }): Promise<Buffer> {
  const half = CONTENT_WIDTH / 2;
  const spacer = (after = 100) => new Paragraph({ children: [], spacing: { before: 0, after } });
  const labelBox = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [half, half],
    rows: [new TableRow({
      height: { value: 1000, rule: HeightRule.ATLEAST },
      children: [
        cell("Patient ID label (on the paper copy only)", { width: half }),
        new TableCell({
          width: { size: half, type: WidthType.DXA },
          borders,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [para("Date:", { after: 200 }), para("Pathologist:")],
        }),
      ],
    })],
  });
  const totalLabel = CONTENT_WIDTH - 1400;
  const totals = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [totalLabel, 1400],
    rows: [
      new TableRow({ children: [cell("Totals", { width: totalLabel, shade: true, bold: true }), cell("Total", { width: 1400, shade: true, bold: true, align: AlignmentType.CENTER })] }),
      new TableRow({ children: [cell("88172: initial sampling", { width: totalLabel }), cell("", { width: 1400 })] }),
      new TableRow({ children: [cell("88177: additional samples", { width: totalLabel }), cell("", { width: 1400 })] }),
    ],
  });
  const signW = CONTENT_WIDTH - 2400;
  const signature = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [signW, 2400],
    rows: [
      new TableRow({ children: [cell("Pathologist signature", { width: signW, shade: true, bold: true }), cell("Date", { width: 2400, shade: true, bold: true })] }),
      new TableRow({ height: { value: 460, rule: HeightRule.ATLEAST }, children: [cell("", { width: signW }), cell("", { width: 2400 })] }),
    ],
  });
  const doc = new Document({
    creator: "Veritas Lab Services",
    title: "Rapid On-Site Evaluation (ROSE)",
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, bottom: 720, left: 900, right: 900 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              text("VeritaAssure® | VeritaDC™ | Confidential, for internal lab use only | Page ", { size: 16, color: "6B6B6B" }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "6B6B6B" }),
              text(" of ", { size: 16, color: "6B6B6B" }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "6B6B6B" }),
            ],
          })],
        }),
      },
      children: [
        para(`${identity.labName}    CLIA: ${identity.cliaNumber}`, { size: 18, color: "6B6B6B", after: 40 }),
        para("Rapid On-Site Evaluation (ROSE)", { bold: true, size: 30, color: TEAL, after: 40 }),
        para("Blank paper form, controlled in VeritaDC™. Print a fresh copy for each procedure. Patient information stays on the paper copy and is never entered in VeritaAssure®.", { size: 17, italics: true, after: 100 }),
        labelBox,
        spacer(),
        siteTable("First site"),
        spacer(),
        siteTable("Second site"),
        spacer(),
        siteTable("Third site"),
        spacer(),
        totals,
        spacer(),
        signature,
      ],
    }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// Same explicit plan allowlist as VeritaMaintain; VeritaDC's editors reach it through requireModuleEdit below.
function hasBlankFormAccess(user: any, lab?: any): boolean {
  if (exportAllPlanBypass(lab)) return true;
  const plan = lab?.plan ?? user?.plan;
  return ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(plan);
}

export function registerBlankFormRoutes(app: Express, authMiddleware: any, requireModuleEdit: (mod: string) => any) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerBlankFormRoutes: labScopeMiddleware not registered");
  app.get("/api/labs/:labId/veritapolicy/blank-forms/rose.docx", authMiddleware, labScopeMiddleware, requireModuleEdit("veritapolicy"), async (req: any, res: any) => {
    if (!hasBlankFormAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "Blank forms require a suite subscription" });
    const lab = (db as any).$client.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    const buf = await generateRoseBlankForm({ labName: lab?.lab_name || "Laboratory", cliaNumber: lab?.clia_number || "Not on file" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="Rapid_On_Site_Evaluation_Blank_Form.docx"');
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  });
}
