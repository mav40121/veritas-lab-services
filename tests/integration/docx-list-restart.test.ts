// tests/integration/docx-list-restart.test.ts
//
// Receipt for BUG-088 (2026-10-27): Word's PDF export restarted the Redington-Fairview section numbers (01-03, then
// 01-03 again on page 3) because every list instance carried <w:startOverride w:val="1"/> (server/docxListRestart.ts).
//   1. the rule: an override on a list definition used once is removed; overrides on a definition used by two or more
//      instances (a deliberate restart) and overrides to another number are kept
//   2. a real Redington-Fairview house-format download (policy 100, four pages in Word) has no single-instance start
//      override left, keeps every list instance and every numbered paragraph, and still opens
//   3. the stock VeritaDC download is cleaned the same way and keeps its numbered lists
// Set HOUSE_SAMPLE_DIR to also write the Redington file for a Word PDF check (vls-ops/docx_to_pdf.ps1).
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:docx-list-restart
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { stripSingleInstanceStartOverrides } = await import("../../server/docxListRestart");
  const num = (id: number, a: number, start: number | null) =>
    `<w:num w:numId="${id}"><w:abstractNumId w:val="${a}"/>${start === null ? "" : `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride>`}</w:num>`;
  const xml = `<w:numbering>${num(1, 1, 1)}${num(2, 2, 1)}${num(3, 2, 1)}${num(4, 3, 5)}${num(5, 4, null)}</w:numbering>`;
  const r = stripSingleInstanceStartOverrides(xml);
  check("1a. a definition used once loses its start override", !/<w:num w:numId="1">[^]*?startOverride[^]*?<\/w:num>/.test(r.xml.split('<w:num w:numId="2"')[0]));
  check("1b. a definition used by two instances keeps both overrides (a deliberate restart)", (r.xml.match(/<w:abstractNumId w:val="2"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/>/g) || []).length === 2);
  check("1c. an override to another number is kept", r.xml.includes('<w:startOverride w:val="5"/>'));
  check("1d. every list instance is still there", (r.xml.match(/<w:num w:numId=/g) || []).length === 5 && r.removed === 1 && r.kept === 2, JSON.stringify({ removed: r.removed, kept: r.kept }));

  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const JSZip = (await import("jszip")).default;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, p: string, body?: unknown, token?: string) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (res: Response) => { try { return await res.json(); } catch { return {}; } };
  const email = `docx-restart-${Date.now()}@example.com`;
  const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Docx Restart", hipaa_acknowledged: true }));
  const labId = Number((await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Restart Lab", plan: "hospital", isWarehouse: true }))).labId);
  sqlite.prepare("UPDATE labs SET lab_name = ?, clia_number = ? WHERE id = ?").run("Made-Up General Hospital Laboratory", "22D0000002", labId);
  const token = reg.token as string;

  const download = async (policy: string) => {
    const res = await fetch(`${base}/api/labs/${labId}/veritapolicy/templates/${policy}/docx`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    const zip = await JSZip.loadAsync(buf);
    return { status: res.status, source: res.headers.get("x-veritapolicy-source"), buf,
      numbering: (await zip.file("word/numbering.xml")?.async("string")) || "", document: (await zip.file("word/document.xml")!.async("string")) };
  };
  const singleOverrides = (numbering: string) => stripSingleInstanceStartOverrides(numbering).removed;

  // 3 first: the lab starts on the stock format.
  const stock = await download("100");
  check("3. stock VeritaDC: downloads, keeps its numbered lists, no single-instance override left", stock.status === 200 && (stock.numbering.match(/<w:num w:numId=/g) || []).length > 0 && singleOverrides(stock.numbering) === 0,
    JSON.stringify({ status: stock.status, nums: (stock.numbering.match(/<w:num w:numId=/g) || []).length }));

  const set = await j(await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId, format: "redington_fairview" }));
  const rf = await download("100");
  const nums = (rf.numbering.match(/<w:num w:numId=/g) || []).length;
  const used = new Set([...rf.document.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]));
  const defined = new Set([...rf.numbering.matchAll(/<w:num w:numId="(\d+)"/g)].map((m) => m[1]));
  check("2a. Redington-Fairview format download answers 200", set.ok === true && rf.status === 200 && rf.source === "house_format:redington_fairview", JSON.stringify({ set: set.ok, status: rf.status, source: rf.source }));
  check("2b. no single-instance start override is left (the cause of the PDF restart)", singleOverrides(rf.numbering) === 0 && nums > 0, `instances=${nums}`);
  check("2c. every list the document uses is still defined, and the six sections are numbered paragraphs", [...used].every((u) => defined.has(u)) && (rf.document.match(/<w:numPr>/g) || []).length >= 6,
    JSON.stringify({ used: [...used], defined: [...defined] }));
  if (process.env.HOUSE_SAMPLE_DIR) {
    const out = path.join(process.env.HOUSE_SAMPLE_DIR, "redington_policy100_fixed.docx");
    fs.writeFileSync(out, rf.buf);
    console.log("INFO  wrote", out);
  }

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
