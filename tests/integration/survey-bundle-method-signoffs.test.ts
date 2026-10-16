// tests/integration/survey-bundle-method-signoffs.test.ts
//
// BUG-065 (2026-10-16): the VeritaComp Survey Bundle collected only locked assessments, so every competency
// signed method by method (the sign-off model since 10/13) was missing from the zip a lab hands a surveyor.
// Pins:
//   1. a person with a method sign-off gets their competency record PDF in the bundle (real zip, real PDF)
//   2. the index lists it as "Signed by method"
//   3. revoked sign-offs do not count; the 12-month window excludes older sign-offs
//   4. a lab with nothing signed still gets the 404, now worded for both kinds of record
// Run: npm run test:survey-bundle-method-signoffs

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);
const JSZip = require2("jszip");
const ExcelJS = require2("exceljs");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: any, token?: string, lab?: number) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const email = `it-bundle-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: ["Zq", "bundle", "7x!"].join("-"), name: "IT Bundle", hipaa_acknowledged: true });
    const uid = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Bundle Lab", plan: "hospital" })).body.labId);
    const tok = jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });

    // 4) nothing signed yet
    const none = await call("POST", `/api/labs/${L}/competency/survey-bundle`, { periodMonths: 12 }, tok, L);
    check("4. nothing signed: 404 worded for both kinds of record", none.status === 404 && /No signed competencies/.test(none.body?.error || ""), `${none.status} ${JSON.stringify(none.body)}`);

    // seed: two people on the roster; method sign-offs (one current, one revoked, one 2 years old)
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const old = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    const addStaff = (first: string, last: string) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, highest_complexity, performs_testing, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'MLT', 'H', 1, 'active', ?, ?, ?)"
    ).run(L, uid, last, first, L, now, now).lastInsertRowid);
    const casey = addStaff("Casey", "Tech");
    const robin = addStaff("Robin", "Revoked");
    const pat = addStaff("Pat", "Older");
    const sign = (emp: number, date: string, revoked: boolean) => sqlite.prepare(
      "INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, revoked_at, created_at) VALUES (?, ?, 1, 'initial', ?, 'Pat Lead', 'TC', ?, ?)"
    ).run(L, emp, date, revoked ? now : null, now);
    sign(casey, today, false);
    sign(robin, today, true);
    sign(pat, old, false);

    const res = await call("POST", `/api/labs/${L}/competency/survey-bundle`, { periodMonths: 12 }, tok, L);
    check("1a. the bundle builds when only method sign-offs exist (it used to 404)", res.status === 200 && !!res.body?.token && res.body?.count === 1, `${res.status} ${JSON.stringify(res.body)}`);
    if (res.status === 200) {
      const z = await fetch(`${base}/api/zip/${res.body.token}`);
      const zip = await JSZip.loadAsync(Buffer.from(await z.arrayBuffer()));
      const names = Object.keys(zip.files);
      const rec = names.find((n) => /Tech_Casey_Competency_Record\.pdf$/.test(n));
      const recBytes = rec ? await zip.file(rec).async("nodebuffer") : Buffer.alloc(0);
      check("1b. Casey's competency record is in the zip as a real PDF", !!rec && recBytes.subarray(0, 5).toString() === "%PDF-" && recBytes.length > 1000, names.join(", "));
      check("3a. the revoked sign-off and the 2-year-old one are not included", !names.some((n) => /Revoked_Robin|Older_Pat/.test(n)), names.join(", "));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await zip.file("Index.xlsx").async("nodebuffer"));
      const rows: string[] = [];
      wb.getWorksheet("Bundle").eachRow((r: any, i: number) => { if (i > 1) rows.push((r.values as any[]).slice(1).join(" | ")); });
      check("2. the index lists the record as Signed by method, Included", rows.length === 1 && /Casey Tech/.test(rows[0]) && /Signed by method/.test(rows[0]) && /Included/.test(rows[0]), rows.join(" || "));
    }
    const all = await call("POST", `/api/labs/${L}/competency/survey-bundle`, { periodMonths: null }, tok, L);
    check("3b. with no window, the older sign-off is included too (revoked still excluded)", all.status === 200 && all.body?.count === 2, JSON.stringify(all.body));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
