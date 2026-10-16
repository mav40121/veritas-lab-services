// tests/integration/phi-guard.test.ts
//
// PHI guard (Q56 item 4, 2026-10-16). Pins:
//   1. the shared detectors: SSN, labeled MRN, labeled date of birth and labeled patient name are caught; ordinary
//      compliance text (review dates, "patient results", phone numbers) is not
//   2. uploads: a Word, Excel or text file containing patient identifiers saves AND returns a warning; a form
//      template with "Patient Name: ______" blanks returns no warning; a PDF is saved without being read
//   3. the nightly scan logs a row to phi_scan_log and counts a planted identifier; a clean database logs zero
//   4. the database scan and the upload check use the same detectors (one source)
//   5. every other route that stores an uploaded file runs the same check: the format comes from the file's bytes, the
//      VeritaLab certificate route returns the warning, and no server route stores req.file.buffer without the check
// Run: npm run test:phi-guard

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { detectPhi, detectPhiInDocumentText, PHI_DETECTORS } from "../../shared/phiPatterns";
import { PHI_DETECTORS as SCAN_DETECTORS } from "../../server/phiScan";
import { runNightlyPhiScan } from "../../server/phiNightly";
import { checkUploadedFileForPhi } from "../../server/phiUploadCheck";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);
const ExcelJS = require2("exceljs");
const docx = require2("docx");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) detectors
  check("1a. SSN caught", detectPhi("ssn on file 123-45-6789").includes("Social Security number"));
  check("1b. labeled MRN caught", detectPhi("MRN: 00482913").includes("Medical record number"));
  check("1c. labeled date of birth caught", detectPhi("DOB 03/14/1961").includes("Date of birth"));
  check("1d. labeled patient name caught in free text", detectPhi("Patient name: Jane Doe").includes("Labeled patient name"));
  const clean = ["Next review date 10/16/2027", "Verify patient results before release", "Call the lab at 541-706-2913", "Lot 2026-10-118 expires 12/31/2026"];
  check("1e. ordinary compliance text is not flagged", clean.every((t) => detectPhi(t).length === 0), JSON.stringify(clean.map(detectPhi)));
  check("1f. a template blank 'Patient Name: ______' is not flagged in a document", detectPhiInDocumentText("Patient Name: ____________   Date: ______").length === 0);
  check("1g. a filled-in patient name IS flagged in a document", detectPhiInDocumentText("Patient Name: Jane Doe").includes("Labeled patient name"));
  check("4. the database scan and the upload check share one set of detectors", SCAN_DETECTORS === PHI_DETECTORS);

  // 2) uploads
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  try {
    const email = `it-phi-${Date.now()}@example.com`;
    await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: ["Zq", "phi", "7x!"].join("-"), name: "IT Phi", hipaa_acknowledged: true }) });
    const uid = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const pr = await fetch(`${base}/api/admin/provision-demo-lab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT PHI Lab", plan: "hospital" }) });
    const L = Number(((await pr.json()) as any).labId);
    const tok = jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const upload = async (buf: Buffer, name: string, type: string, title: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type }), name);
      fd.append("title", title);
      const r = await fetch(`${base}/api/labs/${L}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "X-Active-Lab-Id": String(L) }, body: fd });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    const txt = await upload(Buffer.from("Specimen log\nPatient SSN 123-45-6789 rejected for hemolysis\n"), "log.txt", "text/plain", "IT txt with SSN");
    check("2a. a text file with an SSN saves and warns", txt.status === 201 && /Social Security number/.test(txt.body.phiWarning || ""), `${txt.status} ${txt.body.phiWarning}`);
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("QC"); ws.addRow(["Run", "Result", "Note"]); ws.addRow([1, 4.1, "MRN: 7734120 repeat"]);
    const xl = await upload(Buffer.from(await wb.xlsx.writeBuffer()), "qc.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "IT xlsx with MRN");
    check("2b. an Excel file with a labeled MRN saves and warns", xl.status === 201 && /Medical record number/.test(xl.body.phiWarning || ""), `${xl.status} ${xl.body.phiWarning}`);
    const d = new docx.Document({ sections: [{ children: [new docx.Paragraph("Critical value call log"), new docx.Paragraph("DOB: 03/14/1961 potassium 6.8 called to RN")] }] });
    const wd = await upload(Buffer.from(await docx.Packer.toBuffer(d)), "calls.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "IT docx with DOB");
    check("2c. a Word file with a labeled date of birth saves and warns", wd.status === 201 && /Date of birth/.test(wd.body.phiWarning || ""), `${wd.status} ${wd.body.phiWarning}`);
    const tpl = new docx.Document({ sections: [{ children: [new docx.Paragraph("Specimen Rejection Form"), new docx.Paragraph("Patient Name: ______________   Collection date: ________")] }] });
    const tp = await upload(Buffer.from(await docx.Packer.toBuffer(tpl)), "form.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "IT template");
    check("2d. a form template with blank patient-name fields saves with no warning", tp.status === 201 && !tp.body.phiWarning, `${tp.status} ${tp.body.phiWarning}`);
    const pdf = await upload(Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"), "p.pdf", "application/pdf", "IT pdf");
    check("2e. a PDF saves (not read, no warning)", pdf.status === 201 && !pdf.body.phiWarning, `${pdf.status}`);

    // 5) the other upload routes
    const ssnTxt = Buffer.from("Courier log\nPatient SSN 123-45-6789 left at front desk\n");
    const byBytes = await checkUploadedFileForPhi({ buffer: ssnTxt, mimetype: "text/plain", originalname: "log.txt" });
    const disguised = await checkUploadedFileForPhi({ buffer: Buffer.from(await docx.Packer.toBuffer(d)), mimetype: "application/pdf", originalname: "calls.pdf" });
    const realPdf = await checkUploadedFileForPhi({ buffer: Buffer.from("%PDF-1.4\n%%EOF"), mimetype: "application/pdf", originalname: "c.pdf" });
    check("5a. the format comes from the file's bytes: a text file warns, a Word file named .pdf is still read, a real PDF is not read",
      byBytes.found.includes("Social Security number") && disguised.found.includes("Date of birth") && realPdf.checked === false,
      JSON.stringify([byBytes.found, disguised.found, realPdf.checked]));
    const hdr = { Authorization: `Bearer ${tok}`, "X-Active-Lab-Id": String(L) };
    const cr = await fetch(`${base}/api/veritalab/certificates`, { method: "POST", headers: { ...hdr, "Content-Type": "application/json" }, body: JSON.stringify({ cert_name: "IT CLIA certificate", cert_type: "clia" }) });
    const certId = Number(((await cr.json().catch(() => ({}))) as any).id);
    const certUpload = async (buf: Buffer, name: string) => {
      const fd = new FormData();
      fd.append("file", new Blob([buf], { type: "text/plain" }), name);
      const r = await fetch(`${base}/api/veritalab/certificates/${certId}/documents`, { method: "POST", headers: hdr, body: fd });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    const certPhi = await certUpload(ssnTxt, "courier.txt");
    const certClean = await certUpload(Buffer.from("CLIA certificate renewal receipt\n"), "receipt.txt");
    check("5b. a VeritaLab certificate document with an SSN saves and warns; a clean one does not",
      certId > 0 && certPhi.status === 201 && /Social Security number/.test(certPhi.body.phiWarning || "") && certClean.status === 201 && !certClean.body.phiWarning,
      `cert ${certId}: ${certPhi.status} ${certPhi.body.phiWarning ? "warned" : "no warning"} / ${certClean.status} ${certClean.body.phiWarning ? "warned" : "no warning"}`);
    // Class guard: any server line that stores an uploaded file's bytes (".run(... req.file.buffer") must be followed by the
    // PHI check within its handler, and the admin bundle loader must check each document it loads.
    const serverDir = fileURLToPath(new URL("../../server/", import.meta.url));
    const unchecked: string[] = [];
    let storing = 0;
    for (const f of fs.readdirSync(serverDir).filter((n) => n.endsWith(".ts"))) {
      const lines = fs.readFileSync(path.join(serverDir, f), "utf-8").split(/\r?\n/);
      lines.forEach((ln, i) => {
        if (!/\.run\(.*req\.file\.buffer/.test(ln)) return;
        storing++;
        if (!lines.slice(i, i + 25).some((l) => /checkUpload(ed)?(File)?ForPhi\(/.test(l))) unchecked.push(`${f}:${i + 1}`);
      });
    }
    const routesSrc = fs.readFileSync(path.join(serverDir, "routes.ts"), "utf-8");
    check("5c. every route that stores an uploaded file runs the PHI check (repository, certificates, recalls, admin loader)",
      storing >= 3 && unchecked.length === 0 && /checkUploadForPhi\(e\.buf, 'docx'\)/.test(routesSrc),
      `${storing} storing lines; unchecked: ${unchecked.join(", ") || "none"}`);

    // 3) nightly scan
    const now = new Date().toISOString();
    const r0 = await runNightlyPhiScan(sqlite);
    const clean0 = sqlite.prepare("SELECT finding_count FROM phi_scan_log ORDER BY id DESC LIMIT 1").get() as any;
    sqlite.prepare("INSERT INTO lab_site_contacts (lab_id, name, role, notes, created_at, updated_at) VALUES (?, 'IT Contact', 'Courier', 'pt ssn 987-65-4321', ?, ?)").run(L, now, now);
    const r1 = await runNightlyPhiScan(sqlite);
    const logged = sqlite.prepare("SELECT finding_count, by_detector_json FROM phi_scan_log ORDER BY id DESC LIMIT 1").get() as any;
    check("3a. the nightly scan writes a log row (clean database: zero)", r0.findingCount === 0 && clean0?.finding_count === 0, JSON.stringify(r0));
    check("3b. a planted SSN is counted and logged, never the value itself", r1.findingCount >= 1 && logged.finding_count >= 1 && !String(logged.by_detector_json).includes("987-65-4321"), `${r1.findingCount} ${logged.by_detector_json}`);
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
