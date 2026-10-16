// tests/integration/document-formats.test.ts
//
// More document file types (2026-10-16, Q47 = 1: "we accept fewer document file types"). VeritaPolicy /
// VeritaDC now takes Excel (.xlsx, .xls), PNG/JPG images and plain text, besides DOCX, PDF and HTML. Pins:
//   1. the format comes from the file's own bytes (a renamed file is stored as what it really is; DOCX vs
//      XLSX told apart inside the ZIP; text must be UTF-8 with no NUL bytes; unknown binaries refused)
//   2. previews: XLSX as an escaped table, text escaped in <pre>, XLS a download note
//   3. upload -> render -> download through the real routes for every new format, with the right
//      content types; a refused file gets a 400 naming what is accepted
// Run: npm run test:document-formats

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { canonicalFormatFromMimeAndName, htmlForStoredFormat } from "../../server/veritapolicyApproval";

(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);
const ExcelJS = require2("exceljs");
const JSZip = require2("jszip");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function samples() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("QC Log");
  ws.addRow(["Date", "Level", "Result"]);
  ws.addRow(["2026-10-01", "L1", "<script>alert(1)</script>"]);
  // A temperature log like St. Charles' QC forms: reading + the NIST thermometer offset found by VLOOKUP.
  const t = wb.addWorksheet("Temp Log");
  t.addRow(["Thermometer", "Reading C", "Corrected C"]);
  t.addRow(["T-12", 4.2, { formula: "B2+VLOOKUP(A2,Offsets!A:B,2,FALSE)" }]);
  const off = wb.addWorksheet("Offsets");
  off.addRow(["T-12", -0.3]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  const z = new JSZip();
  z.file("[Content_Types].xml", "<Types/>");
  z.file("word/document.xml", "<w:document/>");
  const docx = Buffer.from(await z.generateAsync({ type: "nodebuffer" }));
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5d20000000049454e44ae426082", "hex");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504, 0)]);
  const txt = Buffer.from("Line 1: CLIA 493.1253\nLine 2: <b>not bold</b> & more\n", "utf-8");
  return { xlsx, docx, png, jpg, pdf, xls, txt };
}

async function main() {
  const f = await samples();
  const fmt = (b: Buffer, name: string, mime = "application/octet-stream") => canonicalFormatFromMimeAndName(mime, name, b);
  // 1) detection
  check("1a. each format detected from its bytes", [fmt(f.xlsx, "a.xlsx"), fmt(f.docx, "a.docx"), fmt(f.png, "a.png"), fmt(f.jpg, "a.jpg"), fmt(f.pdf, "a.pdf"), fmt(f.xls, "a.xls"), fmt(f.txt, "a.txt"), fmt(Buffer.from("<p>x</p>"), "a.html")].join(",") === "xlsx,docx,png,jpg,pdf,xls,txt,html");
  check("1b. a renamed file is stored as what it really is (PNG named .pdf, DOCX named .xlsx)", fmt(f.png, "policy.pdf") === "png" && fmt(f.docx, "sheet.xlsx") === "docx");
  check("1c. refused: unknown binary, text with NUL bytes, invalid UTF-8 text, OLE file not named .xls", fmt(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "setup.exe") === null && fmt(Buffer.from("a\u0000b"), "a.txt") === null && fmt(Buffer.from([0xc3, 0x28]), "a.txt") === null && fmt(f.xls, "old.doc") === null);

  // 2) previews
  const xh = await htmlForStoredFormat(f.xlsx, "xlsx");
  check("2a. XLSX preview: sheet name and a table; cell text escaped", xh.includes("<h3>QC Log</h3>") && xh.includes("<table") && xh.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && !xh.includes("<script>"), xh.slice(0, 160));
  const th = await htmlForStoredFormat(f.txt, "txt");
  check("2b. text preview escaped in <pre>", th.startsWith("<pre") && th.includes("&lt;b&gt;not bold&lt;/b&gt; &amp; more") && !th.includes("<b>"));
  check("2c. XLS preview is a download note", (await htmlForStoredFormat(f.xls, "xls")).includes("Use Download"));

  // 3) routes
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: any) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const email = `it-docfmt-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: ["Zq", "doc", "7x!"].join("-"), name: "IT Docs", hipaa_acknowledged: true });
    const uid = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Doc Formats", plan: "hospital" })).body.labId);
    const tok = jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const auth = { Authorization: `Bearer ${tok}`, "X-Active-Lab-Id": String(L) };
    const upload = async (buf: Buffer, name: string, type: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type }), name);
      const r = await fetch(`${base}/api/labs/${L}/veritapolicy/documents`, { method: "POST", headers: auth, body: fd });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    const want: Array<[string, Buffer, string, string, string]> = [
      // name, bytes, upload mime, render expectation, download content type
      ["qc-log.xlsx", f.xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "json-table", "spreadsheetml"],
      ["legacy.xls", f.xls, "application/vnd.ms-excel", "json-note", "application/vnd.ms-excel"],
      ["flowchart.png", f.png, "image/png", "image/png", "image/png"],
      ["photo.jpg", f.jpg, "image/jpeg", "image/jpeg", "image/jpeg"],
      ["notes.txt", f.txt, "text/plain", "json-pre", "text/plain"],
    ];
    for (const [name, buf, mime, renderWant, dlWant] of want) {
      const up = await upload(buf, name, mime);
      const id = up.body?.id || up.body?.document?.id || up.body?.documentId;
      const row = sqlite.prepare("SELECT v.file_format FROM policy_documents d JOIN policy_versions v ON v.document_id = d.id WHERE d.lab_id = ? ORDER BY v.id DESC LIMIT 1").get(L) as any;
      const r = await fetch(`${base}/api/labs/${L}/veritapolicy/documents/${id}/render`, { headers: auth });
      const ct = r.headers.get("content-type") || "";
      let ok = r.status === 200;
      if (renderWant.startsWith("json")) {
        const j: any = await r.json();
        ok = ok && ct.includes("application/json") && (renderWant === "json-table" ? j.html.includes("<table") : renderWant === "json-pre" ? j.html.startsWith("<pre") : j.html.includes("Use Download"));
      } else {
        const bytes = Buffer.from(await r.arrayBuffer());
        ok = ok && ct.startsWith(renderWant) && bytes.equals(buf);
      }
      const d = await fetch(`${base}/api/labs/${L}/veritapolicy/documents/${id}/download`, { headers: auth });
      const dct = d.headers.get("content-type") || "";
      const dbytes = Buffer.from(await d.arrayBuffer());
      check(`3. ${name}: upload 201, stored as ${row?.file_format}, preview ${renderWant}, download ${dlWant} with the same bytes`, up.status === 201 && !!id && row?.file_format === name.split(".").pop()?.replace("jpeg","jpg") && ok && d.status === 200 && dct.includes(dlWant) && dbytes.equals(buf), `up ${up.status} fmt ${row?.file_format} render ${r.status} ${ct} dl ${d.status} ${dct}`);
      if (name.endsWith(".xlsx")) {
        // What we tell customers: a workbook keeps its formulas (lookups included) and works in Excel after download.
        const back = new ExcelJS.Workbook();
        await back.xlsx.load(dbytes as any);
        const cell: any = back.getWorksheet("Temp Log")?.getCell("C2").value;
        check("3g. the downloaded Excel workbook keeps its formula, VLOOKUP included", String(cell?.formula || "") === "B2+VLOOKUP(A2,Offsets!A:B,2,FALSE)", JSON.stringify(cell));
      }
    }
    const bad = await upload(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "tool.exe", "application/octet-stream");
    check("3f. an unsupported file is refused with a 400 that names the accepted types", bad.status === 400 && /Excel/.test(bad.body?.error || "") && /PNG or JPG/.test(bad.body?.error || ""), JSON.stringify(bad.body));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
