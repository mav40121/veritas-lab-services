// tests/integration/system-repository-download.test.ts
//
// BUG-186 (2026-11-24): GET /api/labs/:labId/repository/documents/:docId/download failed for every file. Its query has two
// placeholders (document, organization) and the route passed only the document. Boots the REAL routes on a scratch DB with
// two organizations and proves:
//   1. a file uploaded to the System Repository downloads byte for byte, from the uploading lab and from its sister lab
//   2. another organization's lab gets 404 for the same id, and an unknown or removed id gets 404
//
// Run (Windows, from bash): DB_PATH=.tmp-repodl.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/system-repository-download.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const register = async (tag: string) => {
    const email = `repodl-${tag}-${stamp}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Repo ${tag}`, hipaa_acknowledged: true }) }));
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id), token: reg.token as string };
  };
  const provision = async (ownerEmail: string, labName: string) =>
    Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail, labName, plan: "hospital" }) }))).labId);
  const A = await register("a"), SIS = await register("sis"), B = await register("b");
  const labA = await provision(A.email, "Repo Lab A"), labSis = await provision(SIS.email, "Repo Lab Sister"), labB = await provision(B.email, "Repo Lab B");
  const org = (name: string, ownerId: number) => Number(sqlite.prepare(
    "INSERT INTO organizations (name, billing_owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run(name, ownerId, now, now).lastInsertRowid);
  const orgOne = org("Repo Org One", A.id), orgTwo = org("Repo Org Two", B.id);
  sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)").run(orgOne, labA, labSis);
  sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(orgTwo, labB);
  check("setup: two organizations, three labs", labA > 0 && labSis > 0 && labB > 0 && orgOne > 0 && orgTwo > 0, JSON.stringify({ labA, labSis, labB, orgOne, orgTwo }));

  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xff, 0x10, 0x80, 0x0a]);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/pdf" }), "shared policy (v2).pdf");
  form.append("title", "Shared policy");
  form.append("hipaaAcknowledged", "true");
  const up = await fetch(`${base}/api/labs/${labA}/repository/documents/upload`, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: form });
  const docId = Number((await j(up)).document?.id);
  check("1a an owner uploads a file to the System Repository", up.status === 200 && docId > 0, String(up.status));

  const dl = async (lab: number, id: number, token: string) => {
    const r = await fetch(`${base}/api/labs/${lab}/repository/documents/${id}/download`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, type: r.headers.get("content-type") || "", name: r.headers.get("content-disposition") || "", body: Buffer.from(await r.arrayBuffer()) };
  };
  const own = await dl(labA, docId, A.token);
  check("1b the uploading lab downloads it", own.status === 200 && own.body.equals(bytes), `${own.status} ${own.body.length} bytes`);
  check("1c with its type and file name", own.type.startsWith("application/pdf") && /shared policy _v2_\.pdf/.test(own.name), `${own.type} | ${own.name}`);
  const sis = await dl(labSis, docId, SIS.token);
  check("1d the sister lab in the same organization downloads the same bytes", sis.status === 200 && sis.body.equals(bytes), String(sis.status));

  const other = await dl(labB, docId, B.token);
  check("2a a lab in another organization gets 404 and no bytes of the file", other.status === 404 && !other.body.includes(bytes), String(other.status));
  check("2b an unknown id gets 404", (await dl(labA, 999999, A.token)).status === 404);
  const del = await fetch(`${base}/api/labs/${labA}/repository/documents/${docId}`, { method: "DELETE", headers: { Authorization: `Bearer ${A.token}` } });
  check("2c after it is removed the download gets 404", del.status === 200 && (await dl(labA, docId, A.token)).status === 404, String(del.status));

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
