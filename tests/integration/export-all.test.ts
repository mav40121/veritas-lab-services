// tests/integration/export-all.test.ts
//
// Download all records (server/exportAll.ts; Q47 = 1, Q50 = 1, version 1). Pins:
//   1. every table in the database is classified in server/exportAllTables.ts (a new table cannot drop out)
//   2. the owner of a CANCELLED lab gets a zip: Index, records workbooks, JSON, stored files, reports (BUG-067)
//   3. only this lab's rows: another lab's study, and staff rows whose staff-lab id collides with this lab's id,
//      stay out; rows saved before multi-lab support under the owner's account are in
//   4. no sign-in secrets anywhere in the zip (password hashes, invite tokens, also inside audit JSON)
//   5. a plan-gated report is in the zip, while the same route still refuses the owner outside the export job
//      and refuses a request carrying a wrong job secret
//   6. owner only: an admin member and an outsider are refused; a download link for another lab is refused
//   7. an expired trial lab's owner still gets the zip
//   8. the export context needs the job secret AND a loopback socket
//   9. weekly copy: off by default, owner-only switch; the weekly run builds only for labs that turned it on and
//      emails the owner with no download link; only the newest weekly copy is kept, for 7 days (regular: 24 hours)
// Run: npm run test:export-all

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { unclassifiedTables, runWeeklyExports, setWeeklyExportMailerForTest, cleanupExports, zipPathFor } from "../../server/exportAll";
import { registerExportSecret, revokeExportSecret, exportAllMiddleware, exportAllPlanBypass } from "../../server/exportAllContext";
import { resolveVersionFilePath } from "../../server/veritapolicyApproval";

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
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: any, token?: string, lab?: number, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const register = async (tag: string) => {
    const email = `it-exportall-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: ["Zq", "export", "7x!"].join("-"), name: `IT ${tag}`, hipaa_acknowledged: true });
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    return { id, email, tok: jwt.sign({ svc: true, userId: id }, process.env.JWT_SECRET!, { expiresIn: "20m" }) };
  };
  const provision = async (email: string, name: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: name, plan: "hospital" })).body.labId);

  try {
    // 1) every table classified
    const missing = unclassifiedTables(sqlite);
    check("1. every table is classified for the export", missing.length === 0, missing.join(", ") || "all classified");

    const A = await register("a"), B = await register("b"), C = await register("c"), T = await register("t");
    const LA = await provision(A.email, "IT Export Lab A");
    const LB = await provision(B.email, "IT Export Lab B");
    const LT = await provision(T.email, "IT Export Trial Lab");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, ?, ?, ?)").run(LA, C.id, now, now, now);

    // Lab A data
    const study = (uid: number, lab: number | null, name: string) => sqlite.prepare("INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, created_at, lab_id) VALUES (?, ?, 'XN-1000', 'IT', '2026-10-01', 'precision', 0.1, '[]', '[]', ?, ?)").run(uid, name, now, lab);
    study(A.id, LA, "Sodium Lab A");
    study(B.id, LB, "Sodium Lab B");
    sqlite.prepare("INSERT INTO inventory_items (account_id, item_name, lab_id) VALUES (?, 'Legacy gloves A', NULL)").run(A.id);
    // VeritaStaff: A's staff lab, and B's staff lab created WITH id = LA so its staff rows carry lab_id = LA numerically
    const slA = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'IT Export Lab A', '11D1111111', ?, ?, ?)").run(A.id, now, now, LA).lastInsertRowid);
    const slB = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'IT Export Lab B', '22D2222222', ?, ?, ?)").run(B.id, now, now, LB).lastInsertRowid);
    // A staff lab whose id equals lab A's labs.id but belongs to someone else (the staff_labs / labs id trap).
    if (!sqlite.prepare("SELECT 1 FROM staff_labs WHERE id = ?").get(LA)) {
      sqlite.prepare("INSERT INTO staff_labs (id, user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, ?, 'Colliding staff lab', '33D3333333', ?, ?, NULL)").run(LA, B.id, now, now);
    }
    if (slA === LA) throw new Error("test setup: lab A's staff lab id equals its labs id; the collision check would prove nothing");
    const emp = (sl: number, uid: number, last: string) => sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, status, created_at, updated_at, tier2_lab_id) VALUES (?, ?, ?, 'Pat', 'active', ?, ?, ?)").run(sl, uid, last, now, now, sl === slA ? LA : LB);
    emp(slA, A.id, "Alpha");
    emp(slB, B.id, "Bravo");
    sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, 'Collide', 'Pat', 'active', ?, ?)").run(LA, B.id, now, now);
    // competency chain program -> assessment -> item
    const prog = Number(sqlite.prepare("INSERT INTO competency_programs (user_id, name, type, lab_id, created_at, updated_at) VALUES (?, 'Chem A', 'technical', ?, ?, ?)").run(A.id, LA, now, now).lastInsertRowid);
    const ce = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, status, lab_id, created_at) VALUES (?, 'Pat Alpha', 'active', ?, ?)").run(A.id, LA, now).lastInsertRowid);
    const asmt = Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, status, created_at) VALUES (?, ?, 'initial', '2026-10-01', 'draft', ?)").run(prog, ce, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, element_number, el1_specimen_id, el1_observer_initials) VALUES (?, 1, 1, 'ACC-A-77', 'TS')").run(asmt);
    // policy document with a stored file
    const manual = Number(sqlite.prepare("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Chemistry')").run(LA).lastInsertRowid);
    const doc = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, manual_id, title, owner_user_id, status) VALUES (?, ?, 'Specimen Rejection', ?, 'active')").run(LA, manual, A.id).lastInsertRowid);
    const rel = `${LA}/${doc}/v1/document.txt`;
    fs.mkdirSync(path.dirname(resolveVersionFilePath(rel)), { recursive: true });
    fs.writeFileSync(resolveVersionFilePath(rel), "Reject hemolyzed potassium specimens.");
    sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, 1, ?, 'txt', 37, 'x', ?)").run(doc, rel, A.id);
    // an uploaded certificate (BLOB)
    const cert = Number(sqlite.prepare("INSERT INTO lab_certificates (user_id, cert_name, lab_id, created_at, updated_at) VALUES (?, 'CLIA certificate', ?, ?, ?)").run(A.id, LA, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_certificate_documents (certificate_id, user_id, filename, original_filename, file_data, uploaded_at, lab_id) VALUES (?, ?, 'c.pdf', 'clia-cert.pdf', ?, ?, ?)").run(cert, A.id, Buffer.from("%PDF-1.4 IT CERT"), now, LA);
    // secrets that must never leave
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, invite_token, lab_id) VALUES (?, 'seat@example.com', 'pending', 'INVITE-SECRET-123', ?)").run(A.id, LA);
    sqlite.prepare("INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, after_json, created_at) VALUES (?, ?, 'account', 'create', 'lab_membership', ?, ?)").run(A.id, A.id, JSON.stringify({ role: "admin", invite_token: "AUDIT-SECRET-456" }), now);
    // the subscription ends
    sqlite.prepare("UPDATE labs SET plan = 'free', subscription_status = 'canceled' WHERE id = ?").run(LA);

    // 5a) the gate is real outside the export job
    const gated = `/api/labs/${LA}/staff/competency-register.xlsx`;
    const outside = await call("GET", gated, undefined, A.tok, LA);
    check("5a. after cancellation the register route refuses the owner outside the export", outside.status === 403, String(outside.status));
    const bogus = await call("GET", gated, undefined, A.tok, LA, { "X-Export-All-Job": crypto.randomBytes(24).toString("hex") });
    check("5b. a wrong job secret does not open the gate", bogus.status === 403, String(bogus.status));

    // 6) owner only
    const byAdmin = await call("POST", `/api/labs/${LA}/export-all`, {}, C.tok, LA);
    check("6a. an admin member cannot start it", byAdmin.status === 403, String(byAdmin.status));
    const byOutsider = await call("POST", `/api/labs/${LA}/export-all`, {}, B.tok, LA);
    check("6b. an outsider cannot start it", byOutsider.status === 403, String(byOutsider.status));

    // 2) the owner runs it
    const runExport = async (labId: number, tok: string) => {
      const start = await call("POST", `/api/labs/${labId}/export-all`, {}, tok, labId);
      if (start.status !== 202) return { start, zip: null as any };
      let st: any = null;
      for (let i = 0; i < 240; i++) {
        st = await call("GET", `/api/labs/${labId}/export-all`, undefined, tok, labId);
        if (st.body.job?.status !== "running") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      const ready = st.body.ready?.[0];
      if (!ready) return { start, st, zip: null as any };
      const t = await call("POST", `/api/labs/${labId}/export-all/${ready.id}/download-token`, {}, tok, labId);
      const f = await fetch(base + t.body.url);
      const buf = Buffer.from(await f.arrayBuffer());
      return { start, st, ready, t, f, zip: await JSZip.loadAsync(buf), bytes: buf.length };
    };
    const ex = await runExport(LA, A.tok);
    check("2a. the owner of a cancelled lab starts the export (202) and it finishes", ex.start.status === 202 && ex.st?.body.job?.status === "done", `${ex.start.status} ${JSON.stringify(ex.st?.body.job || {}).slice(0, 160)}`);
    check("2b. the download is a zip named for the lab", !!ex.zip && /IT_Export_Lab_A_VeritaAssure_Records_\d{4}-\d{2}-\d{2}\.zip/.test(ex.t?.body.filename || "") && (ex.f?.headers.get("content-type") || "").includes("zip"), `${ex.t?.body.filename} ${ex.bytes} bytes`);
    const names: string[] = ex.zip ? Object.keys(ex.zip.files) : [];
    check("2c. Index.xlsx, records workbooks and JSON are in the zip", names.includes("Index.xlsx") && names.includes("Records/VeritaCheck records.xlsx") && names.includes("Records/JSON/studies.json"), names.filter((n) => !n.endsWith("/")).slice(0, 8).join(", "));
    check("2d. the policy document file is in the zip", names.some((n) => n.startsWith("Files/VeritaPolicy/") && n.endsWith("v1.txt")), names.filter((n) => n.startsWith("Files/")).join(", "));
    const certFile = names.find((n) => n.startsWith("Files/VeritaLab/lab_certificate_documents/") && n.endsWith("clia-cert.pdf"));
    check("2e. the uploaded certificate (stored in the database) is in the zip", !!certFile && (await ex.zip.file(certFile).async("string")).startsWith("%PDF-1.4 IT CERT"), certFile || "missing");
    const register5 = names.find((n) => n.startsWith("Reports/VeritaStaff/"));
    check("5c. the plan-gated register is in the zip although the subscription ended (BUG-067)", !!register5, register5 || names.filter((n) => n.startsWith("Reports/")).join(", "));

    // 3) scoping
    const json = async (t: string) => (ex.zip?.file(`Records/JSON/${t}.json`) ? JSON.parse(await ex.zip.file(`Records/JSON/${t}.json`).async("string")) : []);
    const studies = await json("studies");
    check("3a. this lab's study is in, the other lab's is out", studies.some((s: any) => s.test_name === "Sodium Lab A") && !studies.some((s: any) => s.test_name === "Sodium Lab B"), studies.map((s: any) => s.test_name).join(", "));
    const staff = await json("staff_employees");
    check("3b. staff from this lab's staff roster only (staff on a staff lab whose id equals this lab's id stay out)", staff.length === 1 && staff[0].last_name === "Alpha", staff.map((s: any) => `${s.last_name}@${s.lab_id}`).join(", ") + ` (lab A ${LA}, A staff lab ${slA}, B staff lab ${slB}, colliding staff lab ${LA})`);
    const inv = await json("inventory_items");
    check("3c. a row saved before multi-lab support under the owner's account is in", inv.some((i: any) => i.item_name === "Legacy gloves A"), inv.map((i: any) => i.item_name).join(", "));
    const items = await json("competency_assessment_items");
    check("3d. child rows follow their parents (program -> assessment -> item)", items.some((i: any) => i.el1_specimen_id === "ACC-A-77"), String(items.length));
    const users = await json("users");
    check("3e. members are listed with id, name and email only", users.length >= 2 && users.every((u: any) => Object.keys(u).sort().join(",") === "email,id,name"), JSON.stringify(users[0] || {}));

    // 4) secrets
    let leak = "";
    for (const n of names) {
      const f = ex.zip.file(n);
      if (!f || !(n.endsWith(".json"))) continue;
      const txt = await f.async("string");
      for (const s of ["INVITE-SECRET-123", "AUDIT-SECRET-456", "password_hash", "invite_token\":\"INV"]) if (txt.includes(s)) leak += `${n}:${s} `;
    }
    const wbx = new ExcelJS.Workbook();
    await wbx.xlsx.load(await ex.zip.file("Records/Lab and members records.xlsx").async("nodebuffer"));
    const seatSheet = wbx.getWorksheet("user_seats");
    const seatHeaders = (seatSheet?.getRow(1).values || []) as any[];
    check("4. no sign-in secrets: no invite token, password hash or audit-embedded token anywhere", !leak && !seatHeaders.includes("invite_token"), leak || `user_seats columns: ${seatHeaders.filter(Boolean).join(",")}`);
    const audit = await json("audit_log");
    check("4b. a token inside audit JSON is replaced with [removed]", audit.some((a: any) => String(a.after_json || "").includes("[removed]")), String(audit.length));

    // Index lists contents
    const idx = new ExcelJS.Workbook();
    await idx.xlsx.load(await ex.zip.file("Index.xlsx").async("nodebuffer"));
    const notIncluded: string[] = [];
    idx.getWorksheet("Contents")?.eachRow((r: any, i: number) => { if (i > 1 && !String(r.getCell(5).value || "").startsWith("Included")) notIncluded.push(`${r.getCell(3).value}: ${r.getCell(5).value}`); });
    console.log(`   reports not included (expected where the lab has no data for them): ${notIncluded.join(" | ") || "none"}`);
    check("2f. Index opens on About, Contents lists the files", idx.worksheets[0].name === "About" && (idx.getWorksheet("Contents")?.rowCount || 0) > 5, `${idx.worksheets.map((w: any) => w.name).join(",")} rows ${idx.getWorksheet("Contents")?.rowCount}`);

    // 6c) another lab's owner cannot use a token for this lab's export
    const forged = jwt.sign({ purpose: "export_all_download", labId: LA, exportId: ex.ready?.id, userId: B.id }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    const fr = await fetch(`${base}/api/export-all/file/${forged}`);
    check("6c. a download link naming someone who does not own the lab is refused", fr.status === 403, String(fr.status));
    const asSession = await call("GET", `/api/labs/${LA}/export-all`, undefined, ex.t?.body.url?.split("/").pop(), LA);
    check("6d. a download link is not a sign-in token", asSession.status === 401, String(asSession.status));

    // 7) an expired trial
    sqlite.prepare("UPDATE labs SET is_trial = 1, subscription_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 86400000).toISOString(), LT);
    study(T.id, LT, "Glucose Trial Lab");
    const locked = await call("GET", `/api/labs/${LT}/staff/competency-register.xlsx`, undefined, T.tok, LT);
    const exT = await runExport(LT, T.tok);
    const tStudies = exT.zip ? JSON.parse(await exT.zip.file("Records/JSON/studies.json").async("string")) : [];
    check("7. an expired trial is locked in the app, but its owner still gets the records", locked.status === 403 && tStudies.some((s: any) => s.test_name === "Glucose Trial Lab"), `${locked.status} ${locked.body.code || ""}; studies ${tStudies.length}`);

    // 8) context needs the secret AND loopback
    const sec = registerExportSecret(LA);
    const probe = (addr: string) => new Promise<boolean>((resolve) => exportAllMiddleware({ headers: { "x-export-all-job": sec }, socket: { remoteAddress: addr } }, {}, () => resolve(exportAllPlanBypass({ id: LA }))));
    const fromLoop = await probe("127.0.0.1");
    const fromOutside = await probe("10.20.30.40");
    revokeExportSecret(sec);
    const afterRevoke = await probe("127.0.0.1");
    check("8. the export context needs the job secret and a loopback socket, and ends when revoked", fromLoop && !fromOutside && !afterRevoke, `loopback ${fromLoop}, outside ${fromOutside}, revoked ${afterRevoke}`);

    // 9) weekly copy
    const wDefault = await call("GET", `/api/labs/${LA}/export-all`, undefined, A.tok, LA);
    const wByAdmin = await call("PUT", `/api/labs/${LA}/export-all/weekly`, { enabled: true }, C.tok, LA);
    const wBad = await call("PUT", `/api/labs/${LA}/export-all/weekly`, { enabled: "yes" }, A.tok, LA);
    const wOn = await call("PUT", `/api/labs/${LA}/export-all/weekly`, { enabled: true }, A.tok, LA);
    check("9a. the weekly copy is off by default and only the owner turns it on", wDefault.body.weekly === false && wByAdmin.status === 403 && wBad.status === 400 && wOn.status === 200 && wOn.body.weekly === true, `${wDefault.body.weekly} ${wByAdmin.status} ${wBad.status} ${wOn.status}`);
    const mails: any[] = [];
    setWeeklyExportMailerForTest(async (m) => { mails.push(m); });
    const run1 = await runWeeklyExports(sqlite, base);
    const run2 = await runWeeklyExports(sqlite, base);
    setWeeklyExportMailerForTest(null);
    check("9b. the weekly run builds a copy only for the lab that turned it on and emails its owner", run1.labs === 1 && run1.built === 1 && run2.built === 1 && mails.length === 2 && mails[0].to === A.email && mails[0].subject === "Your weekly copy of IT Export Lab A records is ready", JSON.stringify({ run1, to: mails[0]?.to, subject: mails[0]?.subject }));
    const html = String(mails[0]?.html || "");
    check("9c. the email carries no download link, points to the signed-in page, has no em dash", !/export-all|download-token|\/api\//.test(html) && html.includes(`/labs/${LA}/members`) && !html.includes("—"), html.match(/href="[^"]+"/g)?.join(" ") || "");
    const readyW = (await call("GET", `/api/labs/${LA}/export-all`, undefined, A.tok, LA)).body.ready.filter((r: any) => r.weekly);
    const days = readyW[0] ? Math.round((Date.parse(readyW[0].expiresAt) - Date.parse(readyW[0].createdAt)) / 86400000) : -1;
    check("9d. only the newest weekly copy is kept, for 7 days", readyW.length === 1 && days === 7, `${readyW.length} weekly copies, ${days} days`);
    const weeklyZip = readyW[0] ? zipPathFor(LA, readyW[0].id) : "";
    const regularZip = ex.ready ? zipPathFor(LA, ex.ready.id) : "";
    cleanupExports(Date.now() + 2 * 86400000);
    const at2d = { weekly: fs.existsSync(weeklyZip), regular: fs.existsSync(regularZip) };
    cleanupExports(Date.now() + 8 * 86400000);
    const at8d = { weekly: fs.existsSync(weeklyZip) };
    check("9e. cleanup keeps a weekly copy 7 days and a regular download 24 hours", !!weeklyZip && !!regularZip && at2d.weekly && !at2d.regular && !at8d.weekly, JSON.stringify({ at2d, at8d }));
    await call("PUT", `/api/labs/${LA}/export-all/weekly`, { enabled: false }, A.tok, LA);
    const run3 = await runWeeklyExports(sqlite, base);
    check("9f. turned off, the weekly run builds nothing", run3.labs === 0 && run3.built === 0, JSON.stringify(run3));
  } catch (e: any) {
    console.error(e);
    failures++;
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main();
