// server/policyDocumentPrint.ts
//
// One print order for a VeritaDC document and its addenda (B1; server/policySharedDocuments.ts). Page 1 names the laboratory and lists
// each part: its version, dates, who approved it, whether it is in force, and its pages. Then the document's own file and each
// addendum's, every page on Letter paper (turned for a landscape page) with the part's title and version at its top and the page number
// at its foot, so a page taken out of the stack still says what it is. A PDF's pages are reduced to leave that room, with what was
// stamped, signed or filled in on them; a picture fits one page; Word, Excel, web and text files print as the viewer shows them. It is
// a reading copy and changes no stored file.

import {
  PDFArray, PDFContentStream, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, StandardFonts, decodePDFRawStream, degrees, rgb,
  type PDFEmbeddedPage, type PDFObject, type PDFPage,
} from "pdf-lib";
import { getBrowser } from "./pdfReport";
import { setPdfContent } from "./pdfContent";
import { PDF_AUTHOR } from "./pdfMeta";
import { htmlForStoredFormat, renderDocxToHtml } from "./veritapolicyApproval";

export type PrintStatus = "in_force" | "draft" | "archived";
export interface PrintPart {
  heading: string; title: string; number: string | null; version: string | null; systemVersion: string | null;
  status: PrintStatus;
  // The version in force while this one isn't, when there is one.
  inForceVersion: string | null;
  effective: string | null; nextReview: string | null; reviewOverdue: boolean;
  // Who approved this version and when, as VeritaDC records it. Read only for a part in force.
  approvedBy: string[];
  format: string; buffer: Buffer;
  // Our own <<TOKENS>> in a library template, filled as the viewer fills them.
  fill: Record<string, string>;
}
export interface PrintContext { labName: string | null; clia: string | null; from: string | null; printedOn: string }

/** One of the files can't go into a single print copy; the message names it. */
export class CannotCombine extends Error {}

export const PRINT_STATUS_LABEL: Record<PrintStatus, string> = { in_force: "In force", draft: "Draft, not in force", archived: "Archived, not in force" };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** A stored YYYY-MM-DD as it is written in the US. */
export const usDate = (d: string | null | undefined): string => {
  const m = String(d ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
};

// Letter, and the space between the header line and the footer that a part's page may fill.
const SHORT = 612, LONG = 792;
const BOX = { left: 24, right: 24, bottom: 30, top: 38 };
const paper = (landscape: boolean) => ({ w: landscape ? LONG : SHORT, h: landscape ? SHORT : LONG });
const boxOf = (landscape: boolean) => ({ w: paper(landscape).w - BOX.left - BOX.right, h: paper(landscape).h - BOX.bottom - BOX.top });
const MARGIN = 36, STRIP = { top: 14, height: 18 };

const CSS = `*{box-sizing:border-box}body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:10.5pt;line-height:1.45;color:#28251D;margin:0;overflow-wrap:anywhere}
table{border-collapse:collapse;max-width:100%}td,th{vertical-align:top}tr,img{break-inside:avoid}thead{display:table-header-group}img{max-width:100%}p,li{orphans:2;widows:2}
h1,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}
h2{break-after:avoid;page-break-after:avoid}
pre{white-space:pre-wrap;font-family:inherit}`;
const GRID_CSS = `.part td,.part th{border:1px solid #9aa5a6;padding:3px 6px}.part td p,.part th p{margin:0 0 3pt}.part td p:last-child,.part th p:last-child{margin:0}`;

// A document's own HTML prints with scripts off and nothing fetched from anywhere, so a file can't reach out while it is printed.
// `measure` picks the paper from what was laid out, a picture's own shape.
async function htmlToPdf(html: string, size: { w: number; h: number }, measure?: (shape: { w: number; h: number }) => { w: number; h: number }): Promise<PDFDocument> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (r: any) => { if (/^(data:|about:)/i.test(r.url())) r.continue(); else r.abort(); });
    await setPdfContent(page, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html}</body></html>`, 20000);
    let on = size;
    if (measure) {
      const shape = await page.evaluate(() => { const i = document.images[0]; return i ? { w: i.naturalWidth, h: i.naturalHeight } : { w: 0, h: 0 }; });
      if (!shape.w || !shape.h) throw new Error("the picture didn't load");
      on = measure(shape);
      await page.addStyleTag({ content: `.picture{width:${on.w}pt;height:${on.h}pt}` });
    }
    return await PDFDocument.load(await page.pdf({ width: `${on.w / 72}in`, height: `${on.h / 72}in`, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
  } finally {
    await page.close();
  }
}

const num = (o: PDFObject | undefined): number => (o instanceof PDFNumber ? o.asNumber() : 0);
const rectOf = (a: PDFObject | undefined): { x: number; y: number; w: number; h: number } | null => {
  if (!(a instanceof PDFArray) || a.size() < 4) return null;
  const [x1, y1, x2, y2] = [0, 1, 2, 3].map((i) => num(a.lookup(i)));
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
};

// A page's content on its own, with its resources: whatever it leaves behind in the drawing state can't touch what is drawn after it.
function contentForm(doc: PDFDocument, page: PDFPage, box: { x: number; y: number; w: number; h: number }): PDFRef | null {
  const { Contents, Resources } = page.node.normalizedEntries();
  if (!Contents) return null;
  const chunks: Buffer[] = [];
  for (let i = 0; i < Contents.size(); i++) {
    const s = Contents.lookup(i, PDFStream);
    if (s instanceof PDFRawStream) chunks.push(Buffer.from(decodePDFRawStream(s).decode()));
    else if (s instanceof PDFContentStream) chunks.push(Buffer.from(s.getUnencodedContents()));
    else throw new Error("unreadable page content");
    chunks.push(Buffer.from("\n"));
  }
  return doc.context.register(doc.context.flateStream(Buffer.concat(chunks), {
    Type: "XObject", Subtype: "Form", FormType: 1, BBox: [box.x, box.y, box.x + box.w, box.y + box.h], Resources: Resources as any,
  }));
}

// What is stamped, signed or filled in on a page sits apart from its content, each with its own drawing: what a reader sees there is
// drawn with the page. Links, pop-ups and note icons aren't.
function annotationDrawings(doc: PDFDocument, page: PDFPage): Array<{ ref: PDFRef; matrix: number[] }> {
  const out: Array<{ ref: PDFRef; matrix: number[] }> = [];
  const annots = page.node.Annots();
  for (let i = 0; annots && i < annots.size(); i++) {
    const a = annots.lookup(i);
    if (!(a instanceof PDFDict)) continue;
    const subtype = a.lookup(PDFName.of("Subtype"));
    if (subtype && ["/Link", "/Popup", "/Text"].includes(subtype.toString())) continue;
    if (num(a.lookup(PDFName.of("F"))) & (2 | 32)) continue; // hidden, or not shown
    const ap = a.lookup(PDFName.of("AP"));
    let normal = ap instanceof PDFDict ? ap.get(PDFName.of("N")) : undefined;
    const states = doc.context.lookup(normal);
    if (states instanceof PDFDict) { // a check box: the drawing of the state it is in
      const state = a.lookup(PDFName.of("AS"));
      normal = state instanceof PDFName ? states.get(state) : undefined;
    }
    const stream = normal instanceof PDFRef ? doc.context.lookup(normal) : undefined;
    const rect = rectOf(a.lookup(PDFName.of("Rect")));
    if (!(normal instanceof PDFRef) || !(stream instanceof PDFStream) || !rect) continue;
    const bbox = rectOf(stream.dict.lookup(PDFName.of("BBox")));
    if (!bbox) continue;
    const m = stream.dict.lookup(PDFName.of("Matrix"));
    const [p, q, r, s, e, f] = m instanceof PDFArray && m.size() === 6 ? [0, 1, 2, 3, 4, 5].map((k) => num(m.lookup(k))) : [1, 0, 0, 1, 0, 0];
    const corners = [[bbox.x, bbox.y], [bbox.x + bbox.w, bbox.y], [bbox.x, bbox.y + bbox.h], [bbox.x + bbox.w, bbox.y + bbox.h]].map(([x, y]) => [p * x + r * y + e, q * x + s * y + f]);
    const x0 = Math.min(...corners.map((c) => c[0])), x1 = Math.max(...corners.map((c) => c[0]));
    const y0 = Math.min(...corners.map((c) => c[1])), y1 = Math.max(...corners.map((c) => c[1]));
    if (x1 - x0 <= 0 || y1 - y0 <= 0) continue;
    const sx = rect.w / (x1 - x0), sy = rect.h / (y1 - y0);
    stream.dict.set(PDFName.of("Type"), PDFName.of("XObject"));
    stream.dict.set(PDFName.of("Subtype"), PDFName.of("Form"));
    out.push({ ref: normal, matrix: [sx, 0, 0, sy, rect.x - sx * x0, rect.y - sy * y0] });
  }
  return out;
}

// Put one page on Letter paper between the header line and the footer, upright, and never larger than it was.
function ontoLetter(doc: PDFDocument, page: PDFPage): void {
  const media = page.getMediaBox(), crop = page.getCropBox();
  const norm = (b: { x: number; y: number; width: number; height: number }) => ({ x: Math.min(b.x, b.x + b.width), y: Math.min(b.y, b.y + b.height), w: Math.abs(b.width), h: Math.abs(b.height) });
  const m = norm(media), c = norm(crop);
  const x = Math.max(m.x, c.x), y = Math.max(m.y, c.y);
  const inter = { x, y, w: Math.min(m.x + m.w, c.x + c.w) - x, h: Math.min(m.y + m.h, c.y + c.h) - y };
  const b = inter.w > 1 && inter.h > 1 ? inter : m;
  if (b.w <= 1 || b.h <= 1) throw new Error("a page has no size");
  const turn = ((Math.round(page.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  const unit = num(page.node.lookup(PDFName.of("UserUnit"))) || 1;
  const sideways = turn === 90 || turn === 270;
  const w = sideways ? b.h : b.w, h = sideways ? b.w : b.h;
  const landscape = w > h;
  const size = paper(landscape), box = boxOf(landscape);
  const s = Math.min(unit, box.w / w, box.h / h);
  const ox = BOX.left + (box.w - s * w) / 2, oy = BOX.bottom + (box.h - s * h) / 2;
  const matrix = turn === 0 ? [s, 0, 0, s, ox - s * b.x, oy - s * b.y]
    : turn === 90 ? [0, -s, s, 0, ox - s * b.y, oy + s * (b.x + b.w)]
    : turn === 180 ? [-s, 0, 0, -s, ox + s * (b.x + b.w), oy + s * (b.y + b.h)]
    : [0, s, -s, 0, ox + s * (b.y + b.h), oy - s * b.x];
  const content = contentForm(doc, page, b);
  const marks = annotationDrawings(doc, page);
  const names: Record<string, PDFRef> = {};
  const put = (ref: PDFRef, at?: number[]) => {
    const name = `P${Object.keys(names).length}`;
    names[name] = ref;
    return at ? `q ${at.map((n) => n.toFixed(5)).join(" ")} cm /${name} Do Q` : `/${name} Do`;
  };
  const ops = [
    `q ${matrix.map((n) => n.toFixed(5)).join(" ")} cm`, `${b.x} ${b.y} ${b.w} ${b.h} re W n`,
    ...(content ? [put(content)] : []), ...marks.map((k) => put(k.ref, k.matrix)), "Q",
  ].join("\n");
  for (const key of ["Annots", "BleedBox", "TrimBox", "ArtBox", "UserUnit", "AA", "Thumb", "B", "StructParents", "Tabs", "PieceInfo"]) page.node.delete(PDFName.of(key));
  page.node.set(PDFName.of("Resources"), doc.context.obj({ XObject: names }));
  page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(ops)));
  page.setRotation(degrees(0));
  page.setMediaBox(0, 0, size.w, size.h);
  page.setCropBox(0, 0, size.w, size.h);
}

async function loadPdf(buffer: Buffer): Promise<PDFDocument> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  // A form whose filled-in values were never drawn: draw them, when it can be done.
  if (doc.catalog.getAcroForm()) { try { doc.getForm().updateFieldAppearances(); } catch { /* it prints as it is */ } }
  return doc;
}

const partName = (p: PrintPart) => (p.number ? `${p.number} ${p.title}` : p.title);

async function pagesOf(part: PrintPart): Promise<PDFDocument> {
  const name = partName(part);
  if (part.format === "xls") throw new CannotCombine(`${name} is an older Excel file (.xls), which can't go into one print copy. Download it and print it on its own.`);
  try {
    const inner = (landscape: boolean) => ({ w: paper(landscape).w - 2 * MARGIN, h: boxOf(landscape).h });
    let doc: PDFDocument;
    if (part.format === "pdf") doc = await loadPdf(part.buffer);
    else if (part.format === "png" || part.format === "jpg") {
      // Through the browser, so a photo taken with the phone turned prints the way it shows.
      const src = `data:image/${part.format === "png" ? "png" : "jpeg"};base64,${part.buffer.toString("base64")}`;
      doc = await htmlToPdf(
        `<style>.picture{display:flex;align-items:center;justify-content:center;overflow:hidden}.picture img{max-width:100%;max-height:100%;object-fit:contain}</style><div class="picture"><img src="${src}"></div>`,
        inner(false), (shape) => inner(shape.w > shape.h),
      );
    } else {
      const raw = part.format === "docx" ? (await renderDocxToHtml(part.buffer)).html : await htmlForStoredFormat(part.buffer, part.format);
      const html = Object.entries(part.fill).reduce((h, [k, v]) => h.split(`<<${k}>>`).join(esc(v)).split(`&lt;&lt;${k}&gt;&gt;`).join(esc(v)), raw);
      const wide = part.format === "xlsx" && Math.max(0, ...html.split("</tr>").map((r) => r.split("<td").length - 1)) > 6;
      const grid = part.format === "docx" || part.format === "xlsx";
      doc = await htmlToPdf(grid ? `<style>${GRID_CSS}</style><div class="part">${html}</div>` : html, inner(wide));
    }
    if (doc.getPageCount() === 0) throw new Error("no pages");
    for (const p of doc.getPages()) ontoLetter(doc, p);
    return doc;
  } catch (err: any) {
    console.error("[dc print] part", part.format, err?.message || err);
    throw new CannotCombine(`${name} couldn't be put into one print copy. Download it and print it on its own.`);
  }
}

const versionWords = (p: PrintPart) => p.systemVersion && p.systemVersion === p.version ? `${p.version} (the system's version ${p.systemVersion})`
  : [p.version ?? "", p.systemVersion ? `(the system's version ${p.systemVersion})` : ""].filter(Boolean).join(" ");

function coverHtml(parts: Array<{ part: PrintPart; first: number; pages: number }>, ctx: PrintContext): string {
  const main = parts[0].part;
  const cards = parts.map(({ part: p, first, pages }) => {
    const live = p.status === "in_force";
    const facts: Array<[string, string]> = [
      ["Version", esc(versionWords(p))],
      ["Status", `<b style="color:${live ? "#437A22" : "#964219"}">${PRINT_STATUS_LABEL[p.status]}</b>${!live && p.inForceVersion ? `. Version ${esc(p.inForceVersion)} is in force.` : ""}`],
      ["Effective", live ? esc(usDate(p.effective) || "Not on file") : p.status === "draft" ? "Set when approved" : esc(usDate(p.effective) || "Not on file")],
      ["Next review", live ? `${esc(usDate(p.nextReview) || "None set")}${p.reviewOverdue ? ` <b style="color:#A12C7B">Review overdue</b>` : ""}` : p.status === "draft" ? "Set when approved" : esc(usDate(p.nextReview) || "None set")],
    ];
    const by = !live ? "" : p.approvedBy.length ? p.approvedBy.map(esc).join("<br>") : "No approval signature is on file in VeritaDC&trade;";
    return `<div class="card"><div class="top"><span class="kind">${esc(p.heading)}</span><span class="pages">${pages === 1 ? `page ${first}` : `pages ${first} to ${first + pages - 1}`}</span></div>
      <div class="name">${esc(partName(p))}</div><table><tr>${facts.slice(0, 2).map(([k, v]) => `<th>${k}</th><td>${v}</td>`).join("")}</tr><tr>${facts.slice(2).map(([k, v]) => `<th>${k}</th><td>${v}</td>`).join("")}</tr>${by ? `<tr><th>Approved by</th><td colspan="3">${by}</td></tr>` : ""}</table></div>`;
  }).join("");
  return `<style>
    .head{display:flex;justify-content:space-between;align-items:flex-end;gap:16pt;border-bottom:1.5pt solid #01696F;padding-bottom:7pt}
    .brand{font-size:16pt;font-weight:700;color:#01696F;white-space:nowrap}.lab{text-align:right;font-size:9.5pt}.lab b{font-size:11pt}
    h1{font-size:17pt;line-height:1.25;margin:18pt 0 3pt}.sub{color:#4b5a5b}
    h2{font-size:11pt;margin:16pt 0 6pt;color:#01696F;break-after:avoid;page-break-after:avoid}
    .card{border:1px solid #d0d7d8;border-radius:4pt;padding:8pt 10pt;margin:0 0 8pt;break-inside:avoid;page-break-inside:avoid}
    .top{display:flex;justify-content:space-between;gap:12pt;font-size:9pt;color:#4b5a5b}.pages{white-space:nowrap}.name{font-weight:700;font-size:11.5pt;margin:1pt 0 3pt}
    .card table{width:100%;table-layout:fixed;font-size:9.5pt}.card th{text-align:left;font-weight:400;color:#4b5a5b;width:66pt;padding:1pt 6pt 1pt 0}.card td{padding:1pt 8pt 1pt 0}
    .printed{margin-top:12pt;color:#4b5a5b;font-size:9.5pt}</style>
    <div class="head"><div class="brand">VeritaDC&trade;</div><div class="lab"><b>${esc(ctx.labName || "Laboratory")}</b><br>CLIA: ${esc(ctx.clia || "Not on file. Enter it in account settings.")}</div></div>
    <h1>${esc(main.title)}</h1>
    <div class="sub">${[main.number ? `Document ${esc(main.number)}` : "", ctx.from ? `From ${esc(ctx.from)}` : ""].filter(Boolean).join(" &middot; ")}</div>
    <h2>In this copy, in order</h2>${cards}
    <p class="printed">Printed ${esc(usDate(ctx.printedOn))}. The current version is the one in VeritaDC&trade;.</p>`;
}

// The line at the top of a part's pages, in the browser's fonts because a title can hold letters a PDF's own font doesn't have.
async function headerStrips(out: PDFDocument, lines: Array<{ left: string; right: string; alert: string; landscape: boolean }>): Promise<PDFEmbeddedPage[]> {
  const width = (landscape: boolean) => paper(landscape).w - 2 * MARGIN;
  const doc = await htmlToPdf(
    `<style>.sheet{height:${SHORT - 12}pt;overflow:hidden;break-after:page;padding:${STRIP.top}pt 0 0 ${MARGIN}pt}.sheet:last-child{break-after:auto}
      .line{height:${STRIP.height}pt;display:flex;align-items:center;gap:10pt;font-size:8pt;line-height:1;color:#4b5a5b;border-bottom:.75pt solid #c3cccd;white-space:nowrap;overflow-wrap:normal}
      .title{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;font-weight:700;color:#28251D;line-height:1.3}.right{margin-left:auto}.alert{color:#964219;font-weight:700}</style>
      ${lines.map((l) => `<div class="sheet"><div class="line" style="width:${width(l.landscape)}pt"><span class="title">${esc(l.left)}</span><span class="right">${esc(l.right)}</span>${l.alert ? `<span class="alert">${esc(l.alert)}</span>` : ""}</div></div>`).join("")}`,
    { w: LONG, h: SHORT },
  );
  const top = SHORT - STRIP.top;
  return out.embedPages(doc.getPages().slice(0, lines.length), lines.map((l) => ({ left: MARGIN, right: MARGIN + width(l.landscape), top, bottom: top - STRIP.height })));
}

export async function documentPrintPdf(parts: PrintPart[], ctx: PrintContext): Promise<Buffer> {
  const loaded: Array<{ part: PrintPart; doc: PDFDocument }> = [];
  for (const part of parts) loaded.push({ part, doc: await pagesOf(part) });
  // The cover says which pages each part is on, so it is made again when it runs past one page itself.
  const cover = async (length: number) => {
    let at = length + 1;
    const doc = await htmlToPdf(coverHtml(loaded.map(({ part, doc: d }) => { const first = at; at += d.getPageCount(); return { part, first, pages: d.getPageCount() }; }), ctx), { w: SHORT - 2 * MARGIN, h: boxOf(false).h });
    for (const p of doc.getPages()) ontoLetter(doc, p);
    return doc;
  };
  let front = await cover(1);
  for (let tries = 0, length = 1; front.getPageCount() !== length && tries < 3; tries++) { length = front.getPageCount(); front = await cover(length); }

  const out = await PDFDocument.create();
  const lineOf: Array<{ left: string; right: string; alert: string } | null> = [];
  for (const { doc, part } of [{ doc: front, part: null }, ...loaded]) {
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p, i) => {
      out.addPage(p);
      lineOf.push(part
        ? { left: `${part.heading.startsWith("Site addendum") ? `${part.heading}: ` : ""}${partName(part)}`, right: part.version ? `Version ${versionWords(part)}` : "", alert: part.status === "in_force" ? "" : PRINT_STATUS_LABEL[part.status] }
        : i === 0 ? null : { left: partName(parts[0]), right: "In this copy, in order (continued)", alert: "" });
    });
  }
  // One strip for each part and way round, drawn on every page it belongs to.
  const pages = out.getPages();
  const keyOf = (i: number) => (lineOf[i] ? JSON.stringify([lineOf[i], pages[i].getWidth() > pages[i].getHeight()]) : null);
  const keys = [...new Set(pages.map((_, i) => keyOf(i)).filter((k): k is string => !!k))];
  const strips = keys.length ? await headerStrips(out, keys.map((k) => { const [line, landscape] = JSON.parse(k); return { ...line, landscape }; })) : [];
  const font = await out.embedFont(StandardFonts.Helvetica);
  pages.forEach((p, i) => {
    const k = keyOf(i);
    if (k) p.drawPage(strips[keys.indexOf(k)], { x: MARGIN, y: p.getHeight() - STRIP.top - STRIP.height });
    const text = `VeritaAssure® | VeritaDC™ | Confidential, For Internal Lab Use Only | Page ${i + 1} of ${pages.length}`;
    p.drawText(text, { x: (p.getWidth() - font.widthOfTextAtSize(text, 7)) / 2, y: 13, size: 7, font, color: rgb(0.39, 0.43, 0.47) });
  });
  out.setAuthor(PDF_AUTHOR);
  out.setTitle(parts[0].title);
  return Buffer.from(await out.save());
}
