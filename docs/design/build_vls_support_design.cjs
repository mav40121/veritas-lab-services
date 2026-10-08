// Generates docs/design/VLS_Support_Access_Design.docx (one-page design for Michael's review).
const fs = require("fs");
const path = require("path");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, AlignmentType, LevelFormat } = require("docx");

const TEAL = "01696F", INK = "28251D";
const p = (runs, opts = {}) => new Paragraph({ spacing: { after: 60 }, ...opts, children: (Array.isArray(runs) ? runs : [runs]).map((r) => typeof r === "string" ? new TextRun({ text: r, size: 19, color: INK, font: "Calibri" }) : r) });
const b = (t) => new TextRun({ text: t, bold: true, size: 19, color: INK, font: "Calibri" });
const h = (t) => new Paragraph({ spacing: { before: 100, after: 40 }, children: [new TextRun({ text: t, bold: true, size: 21, color: TEAL, font: "Calibri" })] });
const bullet = (runs) => new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 30 }, children: (Array.isArray(runs) ? runs : [runs]).map((r) => typeof r === "string" ? new TextRun({ text: r, size: 19, color: INK, font: "Calibri" }) : r) });

const border = { style: BorderStyle.SINGLE, size: 4, color: "D0D0D0" };
const cell = (txt, w, head = false) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders: { top: border, bottom: border, left: border, right: border },
  shading: head ? { fill: TEAL, type: ShadingType.CLEAR } : undefined,
  margins: { top: 50, bottom: 50, left: 90, right: 90 },
  children: [new Paragraph({ children: [new TextRun({ text: txt, size: 18, bold: head, color: head ? "FFFFFF" : INK, font: "Calibri" })] })],
});
const W1 = 4680, W2 = 4680;
const table = new Table({
  width: { size: W1 + W2, type: WidthType.DXA }, columnWidths: [W1, W2],
  rows: [
    new TableRow({ children: [cell("Veritas support CAN (setup help)", W1, true), cell("Veritas support CANNOT (the lab's own people sign)", W2, true)] }),
    new TableRow({ children: [cell("Read everything in the lab", W1), cell("Sign or attest anything: policies, QC monthly review, QC co-sign", W2)] }),
    new TableRow({ children: [cell("Build maps, add control lots, set QC rules and baselines", W1), cell("Competency evaluator or employee signatures; Sign & Complete", W2)] }),
    new TableRow({ children: [cell("Fix settings, names, emails; enter the CLIA once the lab provides it", W1), cell("Director or designee approvals; study acceptance", W2)] }),
    new TableRow({ children: [cell("Invite users the lab asks for", W1), cell("Be named medical director; transfer ownership; delete the lab", W2)] }),
    new TableRow({ children: [cell("Run imports and re-scores the lab has approved", W1), cell("Change billing, the plan or the subscription", W2)] }),
  ],
});

const doc = new Document({
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 220 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 900, right: 1080, bottom: 900, left: 1080 } } },
    children: [
      new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: "Veritas Support Access", bold: true, size: 30, color: TEAL, font: "Calibri" })] }),
      p([new TextRun({ text: "Design for approval  |  Veritas Lab Services  |  October 8, 2026  |  Internal", size: 17, color: "7A7974", font: "Calibri" })]),

      h("Why"),
      p("Veritas people need to get into client labs to help with setup and fixes. Today that happens three improvised ways, and none of them records \"Veritas did this\": Michael owns a client's lab (Redington-Fairview), Michael is an organization admin (Gameday), or the Coding agent signs in as Michael with the server key. The lab cannot see who from Veritas has access, and every change reads as if Michael were one of their admins."),

      h("What it is"),
      bullet([b("A Veritas flag, not a seat. "), "A Veritas user (Michael, David, Lisa, and one automation identity for the Coding agent) is marked as Veritas support by an admin-only switch. It is never one of the lab's seats, never billed, never counted against their seat limit, and never on their staff roster."]),
      bullet([b("Visible to the lab, with an off switch. "), "Lab Members shows a separate line: \"Veritas support access: On (Michael Veri, David McCormick)\". The lab owner can turn it off; Veritas can ask to have it turned back on."]),
      bullet([b("Logged as Veritas. "), "Every change is recorded as \"Veritas support: <name>\", and the owner can open a short list of what Veritas changed and when."]),
      bullet([b("Easy to reach the lab. "), "Veritas users see a \"Client labs\" list in the lab switcher (only labs with access on)."]),

      h("What it can and cannot do"),
      table,
      p([new TextRun({ text: "Signatures stay with the lab because CLIA puts them on the director and the lab's qualified staff, and a surveyor will ask who signed.", italics: true, size: 18, color: INK, font: "Calibri" })], { spacing: { before: 60, after: 60 } }),

      h("What it replaces"),
      bullet("Redington-Fairview: ownership transfers to Lindsay Webber once she is ready; Michael keeps access through Veritas support."),
      bullet("Gameday: Michael's organization-admin access becomes Veritas support access (Mike Hiltunen sees it and controls it)."),
      bullet("The Coding agent stops signing in as Michael; it uses the automation identity, so its changes are labeled as Veritas automation."),

      h("Decisions for Michael"),
      bullet([b("Default for labs we already support: "), "On, with a one-line note to each owner (recommended), or Off until each owner turns it on."]),
      bullet([b("Who gets it now: "), "Michael and the automation identity (recommended); add David and Lisa when they need it."]),
      bullet([b("Owner alerts: "), "an activity list only (recommended), or an email on every Veritas change."]),

      h("Effort"),
      p("About two days: the flag and per-lab switch, the access rules above enforced on the server, the Members line and activity list, the lab switcher, and browser tests that prove a Veritas user can do setup and is refused on every signature."),
    ],
  }],
});

const out = path.join(__dirname, "VLS_Support_Access_Design.docx");
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(out, buf); console.log("wrote", out); });
