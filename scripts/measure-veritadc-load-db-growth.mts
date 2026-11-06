// scripts/measure-veritadc-load-db-growth.mts
//
// How much the database grows, and how long the server takes, per document in a VeritaDC bulk load. Scratch database and
// made-up documents only: the title, number, path and date lengths are set long on purpose so the answer errs high. Files
// go to a scratch folder. It also times the documents list once a lab holds that many documents.
//   DB_PATH=.tmp-growth.db POLICY_STORAGE_ROOT=.tmp-growth-policies JWT_SECRET=x ADMIN_SECRET=x STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy \
//     tsx scripts/measure-veritadc-load-db-growth.mts [placements=763] [manuals=95]
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";

const placements = Number(process.argv[2] || 763);
const manualCount = Number(process.argv[3] || 95);

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const json = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await r.json()) as any;
  };
  const email = `growth-${Date.now()}@example.com`;
  const reg = await json("POST", "/api/auth/register", { email, password: "Testpass123", name: "Growth Owner", hipaa_acknowledged: true });
  const labId = (await json("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Growth Lab", plan: "hospital", isWarehouse: true })).labId as number;
  const ownerId = Number((sqlite.prepare("SELECT owner_user_id AS o FROM labs WHERE id = ?").get(labId) as any).o);

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = Array.from({ length: 1500 }, (_, i) => `<w:p><w:r><w:t>Made-up procedure paragraph number ${i} with a line of ordinary length to give the parser real work.</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  zip.file("word/media/image1.png", crypto.randomBytes(300 * 1024));
  const docx = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const face = Buffer.from(`<html><head><style>td{border:1px solid}</style></head><body><h1>made up</h1>${"<table><tr><td>Approval</td><td>Made Up</td><td>01/01/2026</td></tr></table>".repeat(60)}</body></html>`);

  const measure = () => {
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    return Number((sqlite.prepare("SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()").get() as any).n);
  };
  const before = measure();
  const long = (s: string, n: number) => s.padEnd(n, "x");
  const started = Date.now();
  const timings: number[] = [];
  for (let i = 0; i < placements; i++) {
    const m = i % manualCount;
    const fd = new FormData();
    fd.append("meta", JSON.stringify({
      labId, expectedLabName: "Growth Lab", ownerUserId: ownerId, batch: "made-up-growth-batch-2026", loadedBy: "Made Up Loader", sourceSystem: "OldSystem",
      sourceStatus: "approved and current", docNumber: `MADEUP GROWTH ${i}`, title: long(`Made-up title ${i} `, 124), titleAsExported: long(`Made-up title ${i} (2) `, 130),
      version: "2.1", effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20", nextReviewDue: "2027-01-20", reviewIntervalMonths: 12, remindersStartOn: "2027-01-01",
      author: long("Made Up Author ", 40), approvalRows: 5, reviewRows: 3, versionCount: 4,
      manualPath: ["Made Up Hospital", "Made Up Department", long(`Made Up Section ${m} `, 50), long(`Made Up Sub Section ${m} `, 50)],
      alsoFiledIn: [long("Other Hospital / Other Department / Other Section ", 120)],
    }));
    fd.append("document", new Blob([docx]), "made-up.docx");
    fd.append("face_page", new Blob([face]), "face-page.html");
    const t0 = Date.now();
    const r = await fetch(`${base}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd });
    timings.push(Date.now() - t0);
    if (r.status !== 201) throw new Error(`document ${i}: HTTP ${r.status} ${await r.text()}`);
  }
  const elapsed = Date.now() - started;
  const after = measure();
  const sorted = [...timings].sort((a, b) => a - b);
  const t1 = Date.now();
  const list = await json("GET", `/api/labs/${labId}/veritapolicy/documents`, undefined, reg.token);
  const listMs = Date.now() - t1;
  console.log(JSON.stringify({
    placements,
    manuals: manualCount,
    documentBytes: docx.length,
    faceBytes: face.length,
    databaseBytesBefore: before,
    databaseBytesAfter: after,
    databaseGrowthBytes: after - before,
    bytesPerPlacement: Math.round((after - before) / placements),
    secondsTotal: Math.round(elapsed / 1000),
    msPerDocument: { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] },
    documentsListMsAtThisSize: listMs,
    documentsListed: list.documents?.length,
  }));
  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
