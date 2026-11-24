// server/policyDocumentPrint.ts
//
// One print order for a VeritaDC document and its addenda (B1; server/policySharedDocuments.ts): a first page that lists what follows
// and in what order, then the document's own file, then each addendum's. A PDF's pages go in as they are and a picture fits one
// page; Word, Excel, web and text files print as the viewer shows them. It is a reading copy and changes no stored file.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBrowser } from "./pdfReport";
import { setPdfContent } from "./pdfContent";
import { PDF_AUTHOR } from "./pdfMeta";
import { htmlForStoredFormat, renderDocxToHtml } from "./veritapolicyApproval";

export interface PrintPart {
  heading: string; title: string; number: string | null; version: string | null; systemVersion: string | null; approved: boolean;
  format: string; buffer: Buffer;
  // Our own <<TOKENS>> in a library template, filled as the viewer fills them.
  fill: Record<string, string>;
}
export interface PrintContext { labName: string | null; clia: string | null; effective: string | null; nextReview: string | null; from: string | null; printedOn: string }

/** One of the files can't go into a single print copy; the message names it. */
export class CannotCombine extends Error {}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LETTER: [number, number] = [612, 792];
const CSS = `*{box-sizing:border-box}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#28251D;margin:0;overflow-wrap:anywhere}
table{border-collapse:collapse;max-width:100%}td,th{vertical-align:top}img{max-width:100%}pre{white-space:pre-wrap;font-family:inherit}`;

// A document's own HTML prints with scripts off and nothing fetched from anywhere, so a file can't reach out while it is printed.
async function htmlToPdf(html: string): Promise<Uint8Array> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (r: any) => { if (/^(data:|about:)/i.test(r.url())) r.continue(); else r.abort(); });
    await setPdfContent(page, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`, 15000);
    return await page.pdf({ format: "Letter", printBackground: true, margin: { top: "16mm", right: "16mm", bottom: "18mm", left: "16mm" } });
  } finally {
    await page.close();
  }
}

async function pagesOf(part: PrintPart): Promise<PDFDocument> {
  const name = part.number ? `${part.number} ${part.title}` : part.title;
  if (part.format === "xls") throw new CannotCombine(`${name} is an older Excel file (.xls), which can't go into one print copy. Download it and print it on its own.`);
  try {
    if (part.format === "pdf") return await PDFDocument.load(part.buffer);
    if (part.format === "png" || part.format === "jpg") {
      const doc = await PDFDocument.create();
      const img = part.format === "png" ? await doc.embedPng(part.buffer) : await doc.embedJpg(part.buffer);
      const page = doc.addPage(LETTER);
      const fit = img.scaleToFit(LETTER[0] - 72, LETTER[1] - 96);
      page.drawImage(img, { x: (LETTER[0] - fit.width) / 2, y: (LETTER[1] - fit.height) / 2, width: fit.width, height: fit.height });
      return doc;
    }
    const raw = part.format === "docx" ? (await renderDocxToHtml(part.buffer)).html : await htmlForStoredFormat(part.buffer, part.format);
    const html = Object.entries(part.fill).reduce((h, [k, v]) => h.split(`<<${k}>>`).join(esc(v)).split(`&lt;&lt;${k}&gt;&gt;`).join(esc(v)), raw);
    return await PDFDocument.load(await htmlToPdf(html));
  } catch (err: any) {
    console.error("[dc print] part", part.format, err?.message || err);
    throw new CannotCombine(`${name} couldn't be put into one print copy. Download it and print it on its own.`);
  }
}

export async function documentPrintPdf(parts: PrintPart[], ctx: PrintContext): Promise<Buffer> {
  const loaded: Array<{ part: PrintPart; doc: PDFDocument }> = [];
  for (const part of parts) loaded.push({ part, doc: await pagesOf(part) });
  let at = 2;
  const rows = loaded.map(({ part, doc }) => {
    const first = at;
    at += doc.getPageCount();
    const version = part.systemVersion && part.systemVersion === part.version ? `system version ${part.version}`
      : [part.version ? `version ${part.version}` : "", part.systemVersion ? `system version ${part.systemVersion}` : ""].filter(Boolean).join(", ");
    return `<tr><td style="padding:6px 10px 6px 0;white-space:nowrap;color:#4b5a5b">${esc(part.heading)}</td><td style="padding:6px 10px 6px 0"><b>${part.number ? `${esc(part.number)} ` : ""}${esc(part.title)}</b><br>${esc(version)}${part.approved ? "" : `${version ? ". " : ""}<b style="color:#964219">Draft, not approved in this laboratory</b>`}</td><td style="padding:6px 0;text-align:right;white-space:nowrap">page ${first}</td></tr>`;
  });
  const cover = await PDFDocument.load(await htmlToPdf(
    `<div style="border-bottom:1px solid #d2d7dc;padding-bottom:8px;display:flex;justify-content:space-between;align-items:flex-end"><div style="font-size:16pt;font-weight:700;color:#01696F">VeritaDC&trade;</div>
     <div style="text-align:right;font-size:9pt;color:#4b5a5b">${esc(ctx.labName || "Laboratory")}<br>CLIA: ${esc(ctx.clia || "Not on file. Enter it in account settings.")}</div></div>
     <h1 style="font-size:17pt;margin:20px 0 4px">${esc(parts[0].title)}</h1>
     <div style="color:#4b5a5b">${[parts[0].number ? `Document ${esc(parts[0].number)}` : "", ctx.effective ? `Effective ${esc(ctx.effective)}` : "", ctx.nextReview ? `Next review ${esc(ctx.nextReview)}` : "", ctx.from ? `From ${esc(ctx.from)}` : ""].filter(Boolean).join(" &middot; ")}</div>
     <h2 style="font-size:11pt;margin:22px 0 4px;color:#01696F">In this copy, in order</h2>
     <table style="width:100%;border-top:1px solid #d2d7dc">${rows.join("")}</table>
     <p style="margin-top:22px;color:#4b5a5b">Printed ${esc(ctx.printedOn)}. Printed copies are uncontrolled. The current version is the one in VeritaDC&trade;.</p>`
  ));
  const out = await PDFDocument.create();
  const draft: boolean[] = [];
  for (const { doc, part } of [{ doc: cover, part: null }, ...loaded]) {
    for (const p of await out.copyPages(doc, doc.getPageIndices())) { out.addPage(p); draft.push(!!part && !part.approved); }
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const total = out.getPageCount();
  out.getPages().forEach((p, i) => {
    const text = `VeritaAssure® | VeritaDC™ | Confidential, For Internal Lab Use Only | Page ${i + 1} of ${total}`;
    p.drawText(text, { x: (p.getWidth() - font.widthOfTextAtSize(text, 7)) / 2, y: 12, size: 7, font, color: rgb(0.39, 0.43, 0.47) });
    if (draft[i]) {
      const mark = "DRAFT, NOT APPROVED";
      p.drawText(mark, { x: (p.getWidth() - font.widthOfTextAtSize(mark, 9)) / 2, y: p.getHeight() - 18, size: 9, font, color: rgb(0.59, 0.26, 0.1) });
    }
  });
  out.setAuthor(PDF_AUTHOR);
  out.setTitle(parts[0].title);
  return Buffer.from(await out.save());
}
