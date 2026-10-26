// tests/integration/veritalab-export-columns.test.ts
//
// STANDING integration test for parking lot #103 (2026-10-26): the VeritaLab certificate Excel export carries the
// CLIA certificate type and the certificate link, before Notes, and the Status column stays column 8 (its colors key
// on that position). Downloads the real workbook and reads it back with ExcelJS.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritalab-export-columns

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const PW = ["Vl", "ex", "7x!"].join("-");
  const email = `it-vlx-${Date.now()}@example.com`;
  const post = async (p: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  try {
    const reg = await (await post("/api/auth/register", { email, password: PW, name: "IT Export", hipaa_acknowledged: true })).json() as any;
    const labId = Number(((await (await post("/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Export Lab", plan: "hospital" })).json()) as any).labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(Number(reg?.user?.id));
    const token = ((await (await post("/api/auth/login", { email, password: PW })).json()) as any).token as string;
    const H = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
    const made = await post(`/api/labs/${labId}/veritalab/certificates`, {
      cert_type: "clia", cert_name: "CLIA Certificate", cert_number: "33D0000003", expiration_date: "2027-06-30",
      clia_certificate_type: "accreditation", link_url: "https://example.org/clia-certificate.pdf", notes: "Main lab",
    }, H);
    check("0. certificate saved with type and link", made.status === 201, `status=${made.status}`);

    const r = await post("/api/veritalab/certificates/excel", {}, H);
    const buf = Buffer.from(await r.arrayBuffer());
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("Certificates")!;
    const headers = (ws.getRow(1).values as any[]).slice(1).map(String);
    const row = (ws.getRow(2).values as any[]).slice(1).map((v) => (v == null ? "" : String(v)));
    const col = (h: string) => headers.indexOf(h);
    check("1. export downloads", r.status === 200 && headers.length > 0, `status=${r.status}`);
    check("2. the two new columns sit before Notes", col("CLIA Certificate Type") === 10 && col("Certificate Link") === 11 && col("Notes") === 12, JSON.stringify(headers));
    check("3. Status is still column 8", col("Status") === 7);
    check("4. the row carries the type label and the link", row[col("CLIA Certificate Type")] === "Accreditation" && row[col("Certificate Link")] === "https://example.org/clia-certificate.pdf" && row[col("Notes")] === "Main lab", JSON.stringify(row));
    const af = (ws as any).autoFilter;
    check("5. the autofilter spans every column (A to M)", (typeof af === "string" ? af : `A1:${af?.to}`) === "A1:M1", JSON.stringify(af));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
