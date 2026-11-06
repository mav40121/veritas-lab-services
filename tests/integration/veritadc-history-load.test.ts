// tests/integration/veritadc-history-load.test.ts
//
// STANDING integration test for carrying read-and-sign history over from a lab's prior system (Michael 2026-11-06, Q207 = 1):
//   1.  The route is guarded, and a batch naming the wrong lab or owner writes nothing.
//   2.  A bad row is refused on its own: unknown document, bad date or version, a person not on the roster, a name that isn't that roster row.
//   3.  A signed row keeps its original date and version. Nothing else moves: no signature in VeritaAssure, no email, assignment, seat or login.
//   4.  A staff member doesn't owe it, and every screen says where they signed.
//   5.  The tracker, roll-up, Excel report and compliance page count it, and call it carried over.
//   6.  The inspector link lists it apart, in those words.
//   7.  A later major version asks again; a minor one follows the lab's rule; an earlier major than the one loaded is history only.
//   8.  An inactive person is history: no login, no roster row, owing nothing. A person's later choice can link a row.
//   9.  Staff limits (Q182, Q186): a Staff login never reads a coworker's row. A sweep of every VeritaDC read.
//   10. The script: dry run writes nothing and prints no names; unmatched names go on a list, never guessed; --apply and --go; safe to rerun.
//   11. The export, the delete cascade and the counts-only status route.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-history-load

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { readSignMailer } from "../../server/policyReadSign";
import { indexRoster, matchPerson, personKey, priorDate, priorVersionRelation } from "../../shared/policyPriorSignature";

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
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Hist", "ory", "77!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdc-history-"));

  const mail: any[] = [];
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: any) => { mail.push(m); };

  const call = async (method: string, p: string, body?: unknown, token?: string, secret?: string | null) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(secret ? { "x-admin-secret": secret } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, body: json, text };
  };
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);

  const ownerEmail = `history-owner-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Owner Made", hipaa_acknowledged: true });
  const ownerId = Number(reg.body.user?.id);
  const ownerToken = reg.body.token as string;
  const provision = async (labName: string) => (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName, plan: "hospital", isWarehouse: true })).body.labId as number;
  const labA = await provision("Made Up Hospital");
  const labB = await provision("Made Up Clinic");
  const P = `/api/labs/${labA}/veritapolicy`;
  const staffLabFor = (labId: number, name: string) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any)?.id
    ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, '22D0000789', ?, ?, ?)").run(ownerId, name, labId, now, now).lastInsertRowid);
  const slA = staffLabFor(labA, "Made Up Hospital");
  const slB = staffLabFor(labB, "Made Up Clinic");
  const addEmployee = (sl: number, labId: number, first: string, last: string, status = "active", extra = 0) => Number(sqlite.prepare(
    "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, can_view_audit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', ?, ?, ?, ?)"
  ).run(sl, labId, ownerId, last, first, status, extra, now, now).lastInsertRowid);
  const addStaffLogin = async (first: string, last: string, audit = 0) => {
    const email = `history-${first.toLowerCase()}-${stamp}@example.com`;
    const r = await call("POST", "/api/auth/register", { email, password: PW, name: `${first} ${last}`, hipaa_acknowledged: true });
    const userId = Number(r.body.user?.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(labA, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labA, userId);
    const emp = addEmployee(slA, labA, first, last, "active", audit);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')").run(ownerId, email, userId, labA, emp);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = issueSession(sqlite, userId, { headers: { "user-agent": "history-test" }, ip: "127.0.0.1" }).token as string;
    return { email, userId, emp, token, name: `${first} ${last}` };
  };

  // Documents, carried over the real way.
  const loadDoc = async (labId: number, labName: string, docNumber: string, version: string, title: string) => {
    const meta = {
      labId, expectedLabName: labName, ownerUserId: ownerId, batch: "made-up-batch", loadedBy: "Made Up Loader", sourceSystem: "OldSystem", sourceStatus: "approved and current",
      docNumber, title, titleAsExported: title, version, effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20", nextReviewDue: "2027-01-20", reviewIntervalMonths: 12,
      remindersStartOn: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), author: "Made Up Author", approvalRows: 1, reviewRows: 0, versionCount: 1, manualPath: ["Made Up Manual"], alsoFiledIn: [],
    };
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    fd.append("document", new Blob([Buffer.from(`Made-up text ${docNumber}\n`)]), "made-up.txt");
    fd.append("face_page", new Blob([Buffer.from(`<html><head><title>x</title></head><body><h1>${docNumber} ${title}</h1><p>Made-up face page.</p></body></html>`)], { type: "text/html" }), "face-page.html");
    const r = await fetch(`${base}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd });
    const j = (await r.json()) as any;
    if (r.status !== 201) throw new Error(`load failed ${r.status} ${JSON.stringify(j)}`);
    return { id: j.documentId as number, versionId: j.versionId as number };
  };

  const send = (labId: number, labName: string, rows: unknown[], over: Record<string, unknown> = {}, secret: string | null = ADMIN) =>
    call("POST", "/api/admin/veritadc/history-load/rows", { labId, expectedLabName: labName, ownerUserId: ownerId, sourceSystem: "OldSystem", batch: "made-up-history", loadedBy: "Made Up Loader", rows, ...over }, undefined, secret);
  const sendA = (rows: unknown[], over: Record<string, unknown> = {}) => send(labA, "Made Up Hospital", rows, over);

  try {
    // The rules, on their own
    check("0. a name matches with case, spacing, periods, apostrophes and hyphens set aside", personKey(" O'Brien,  Mary-Ann. ") === personKey("obrien, mary ann"));
    check("0. a nickname isn't the same name", personKey("Smith, Mike") !== personKey("Smith, Michael"));
    check("0. a name in brackets isn't stripped", personKey("Smith, Jane (Janie)") !== personKey("Smith, Jane"));
    const ix = indexRoster([{ id: 1, last_name: "Smith", first_name: "Jane" }, { id: 2, last_name: "Smith", first_name: "Jane" }, { id: 3, last_name: "Doe", first_name: "Ann", middle_initial: "B" }]);
    check("0. two roster rows with one name match nobody", matchPerson("Smith, Jane", ix).kind === "many");
    check("0. a middle initial on the roster still matches", (matchPerson("Doe, Ann B", ix) as any).employeeId === 3 && (matchPerson("Doe, Ann", ix) as any).employeeId === 3);
    check("0. dates are real dates", priorDate("9/12/2025") === "2025-09-12" && priorDate("2/30/2025") === null && priorDate("Not signed off") === null);
    check("0. versions compare by major", priorVersionRelation("2.0", "2.1") === "counts" && priorVersionRelation("1.0", "2.1") === "older" && priorVersionRelation("3.0", "2.1") === "newer" && priorVersionRelation("x", "2.1") === "bad");

    const ann = await addStaffLogin("Ann", "Chem", 1);
    const bea = await addStaffLogin("Bea", "Micro");
    const zork = await addStaffLogin("Zork", "Quillfeather");
    const nia = addEmployee(slA, labA, "Nia", "Nologin");
    const gone = addEmployee(slA, labA, "Lee", "Leaving", "terminated");
    const cal = addEmployee(slB, labB, "Cal", "Clinic");
    const mu1 = await loadDoc(labA, "Made Up Hospital", "MU 1", "2.1", "Made-up Glucose procedure");
    const mu2 = await loadDoc(labA, "Made Up Hospital", "MU 2", "1.0", "Made-up Fire plan");
    const mu3 = await loadDoc(labA, "Made Up Hospital", "MU 3", "3.0", "Made-up Gram stain procedure");
    const mu4 = await loadDoc(labA, "Made Up Hospital", "MU 4", "1.0", "Made-up Revised procedure");
    const mu5 = await loadDoc(labA, "Made Up Hospital", "MU 5", "1.0", "Made-up History procedure");
    const clinicDoc = await loadDoc(labB, "Made Up Clinic", "MC 1", "1.0", "Made-up Clinic procedure");
    await call("POST", `${P}/read-sign`, { scope: "lab", everyone: true }, ownerToken);

    const row = (over: Record<string, unknown> = {}) => ({ docNumber: "MU 1", version: "2.0", personName: "Chem, Ann", credentials: "MLS(ASCP)", sourceType: "Performing employee", assignedOn: "2025-02-03", signedOn: "2025-03-12", personState: "on_roster", employeeId: ann.emp, ...over });

    // 1. Guards
    const before = () => n("SELECT COUNT(*) AS n FROM policy_prior_signatures");
    check("1. no secret is refused", (await send(labA, "Made Up Hospital", [row()], {}, null)).status === 403);
    check("1. a wrong secret is refused", (await send(labA, "Made Up Hospital", [row()], {}, "wrong")).status === 403);
    check("1. the status route is guarded", (await call("GET", `/api/admin/veritadc/history-load/status?labId=${labA}`)).status === 403);
    check("1. the reference route is guarded", (await call("GET", `/api/admin/veritadc/history-load/reference?labId=${labA}`)).status === 403);
    check("1. a lab's own login can't use it", (await call("POST", "/api/admin/veritadc/history-load/rows", { labId: labA }, ownerToken)).status === 403);
    const wrongLab = await send(labA, "Some Other Hospital", [row()]);
    check("1. a lab name that doesn't match writes nothing", wrongLab.status === 409 && wrongLab.body.code === "LAB_MISMATCH" && before() === 0);
    const wrongOwner = await sendA([row()], { ownerUserId: ann.userId + 99999 });
    check("1. an owner not on the lab writes nothing", wrongOwner.status === 400 && wrongOwner.body.code === "OWNER_NOT_ON_LAB" && before() === 0);
    check("1. an empty batch is refused", (await sendA([])).status === 400);
    check("1. too many rows at once are refused", (await sendA(Array.from({ length: 1001 }, () => row()))).status === 400);

    // 2. Bad rows
    const bad = await sendA([
      row({ docNumber: "NOPE 1" }),
      row({ signedOn: "not a date" }),
      row({ signedOn: "2099-01-01" }),
      row({ version: "x" }),
      row({ version: "3.0" }),
      row({ employeeId: cal }),
      row({ employeeId: gone, personName: "Leaving, Lee" }),
      row({ personName: "Chem, Annie" }),
      row({ employeeId: bea.emp }),
      row({ personState: "inactive_in_prior_system" }),
      row({ personState: "made-up" }),
      row({ personName: "" }),
    ]);
    const codes = (bad.body.results || []).map((r: any) => r.code);
    check("2. each bad row answers for itself", JSON.stringify(codes) === JSON.stringify(["DOCUMENT_NOT_LOADED", "BAD_DATE", "BAD_DATE", "BAD_VERSION", "VERSION_NEWER_THAN_LOADED", "PERSON_NOT_ON_ROSTER", "PERSON_NOT_ON_ROSTER", "PERSON_NAME_MISMATCH", "PERSON_NAME_MISMATCH", "HISTORY_ROW_NAMES_A_PERSON", "BAD_PERSON_STATE", "NO_NAME"]), JSON.stringify(codes));
    check("2. and nothing was written", before() === 0);
    const selfAdded = await upload(P, ownerToken, "Made-up added here", "MU 9");
    check("2. a document the lab added itself isn't carried history's to touch", (await sendA([row({ docNumber: "MU 9" })])).body.results?.[0]?.code === "DOCUMENT_NOT_LOADED" && !!selfAdded);

    // 3. A signed row
    const moving = () => ({
      sigs: n("SELECT COUNT(*) AS n FROM staff_portal_policy_signatures"),
      attest: n("SELECT COUNT(*) AS n FROM policy_attestations"),
      signoffs: n("SELECT COUNT(*) AS n FROM policy_signoffs"),
      assignments: n("SELECT COUNT(*) AS n FROM policy_read_sign_assignments"),
      seats: n("SELECT COUNT(*) AS n FROM user_seats"),
      users: n("SELECT COUNT(*) AS n FROM users"),
      members: n("SELECT COUNT(*) AS n FROM lab_members"),
      roster: n("SELECT COUNT(*) AS n FROM staff_employees"),
      sessions: n("SELECT COUNT(*) AS n FROM user_sessions"),
    });
    const snap = JSON.stringify(moving());
    const one = await sendA([row()]);
    check("3. a signed row loads", one.status === 200 && one.body.counts?.loaded === 1 && one.body.results[0].counts === true, JSON.stringify(one.body.counts));
    const stored = sqlite.prepare("SELECT * FROM policy_prior_signatures WHERE document_id = ?").get(mu1.id) as any;
    check("3. it keeps the original date, not the load date", stored.signed_on === "2025-03-12" && stored.assigned_on === "2025-02-03");
    check("3. it keeps the version the report named", stored.source_version === "2.0");
    check("3. and counts on the version loaded", stored.version_id === mu1.versionId);
    check("3. it says where it came from", stored.source_system === "OldSystem" && stored.batch === "made-up-history" && stored.loaded_by === "Made Up Loader" && stored.source_number === "MU 1" && stored.source_credentials === "MLS(ASCP)");
    check("3. it's on the roster row", stored.staff_employee_id === ann.emp && stored.person_state === "on_roster");
    check("3. nothing else moved: no signature, attestation, approval, assignment, seat, login or roster row", JSON.stringify(moving()) === snap, JSON.stringify(moving()));
    check("3. no email", mail.length === 0);
    const auditRow = sqlite.prepare("SELECT details, user_id FROM policy_audit_log WHERE document_id = ? AND action = 'prior_signatures_carried_over'").get(mu1.id) as any;
    check("3. the document's trail says it was carried over, with no names", !!auditRow && /Made Up Loader/.test(auditRow.details) && !/Chem/.test(auditRow.details), auditRow?.details);
    const rerun = await sendA([row()]);
    check("3. a rerun leaves it alone", rerun.body.counts?.already_loaded === 1 && n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE document_id = ?", mu1.id) === 1);
    check("3. a rerun adds no trail row", n("SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'prior_signatures_carried_over'", mu1.id) === 1);

    // 4. What a staff member sees
    const list = async (who: { emp: number; token: string }) => (await call("GET", `/api/staff-portal-session/policies?employee_id=${who.emp}`, undefined, who.token)).body.policies as any[];
    const bell = async (who: { token: string }) => ((await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labA}`, undefined, who.token)).body.policies || []).map((p: any) => p.document_id);
    const annRow = (await list(ann)).find((p) => p.document_id === mu1.id);
    check("4. their list reads signed", annRow.signed === true);
    check("4. with the original date", annRow.signed_at === "2025-03-12");
    check("4. and says where", annRow.prior_system?.system === "OldSystem" && annRow.prior_system?.version === "2.0");
    check("4. with no typed signature, because none was made here", annRow.typed_signature === null);
    check("4. it isn't on the bell", !(await bell(ann)).includes(mu1.id));
    check("4. someone who didn't sign it still owes it", (await list(bea)).find((p) => p.document_id === mu1.id).signed === false && (await bell(bea)).includes(mu1.id));
    const annDoc = (await call("GET", `${P}/documents`, undefined, ann.token)).body.documents.find((d: any) => d.id === mu1.id);
    check("4. their document list agrees, and says where", annDoc.my_read_sign === "signed" && annDoc.my_prior_system?.system === "OldSystem");
    const activity = await call("GET", `/api/staff-portal-session/my-activity?employee_id=${ann.emp}`, undefined, ann.token);
    const ev = (activity.body.events || []).find((e: any) => e.document_id === mu1.id);
    check("4. My Activity says it wasn't signed in VeritaAssure, with no made-up time", /Carried over from that system, not signed in VeritaAssure/.test(ev?.detail || "") && ev?.date_only === true && ev?.at === "2025-03-12" && !/Signed as/.test(ev?.detail || ""), JSON.stringify(ev));

    // 5. The tracker, roll-up, report, compliance
    await sendA([row({ personName: "Quillfeather, Zork", employeeId: zork.emp, docNumber: "MU 2", version: "1.0", signedOn: "2025-04-01" })]);
    const st = await call("GET", `${P}/documents/${mu1.id}/signature-status`, undefined, ownerToken);
    const person = (emp: number, s = st) => s.body.people.find((p: any) => p.employee_id === emp);
    check("5. the signature list reads signed, carried over", person(ann.emp).status === "signed" && person(ann.emp).how === "Carried over from OldSystem" && person(ann.emp).owes === false, JSON.stringify(person(ann.emp)));
    check("5. with the original date and the version named", person(ann.emp).signed_at === "2025-03-12" && person(ann.emp).version_label === "2.0" && person(ann.emp).prior_system?.system === "OldSystem");
    check("5. it never reads as a Staff login signature", person(ann.emp).how !== "Staff login");
    check("5. a coworker on the same document still owes it", person(bea.emp).owes === true);
    const tracker = (await call("GET", `${P}/read-sign/tracker?scope=document&id=${mu1.id}`, undefined, ownerToken)).body;
    check("5. the roll-up agrees", tracker.people.find((p: any) => p.employee_id === ann.emp).signed === 1 && tracker.people.find((p: any) => p.employee_id === bea.emp).owes === 1);
    const att = (await call("GET", `${P}/documents/${mu1.id}/attestations`, undefined, ownerToken)).body;
    check("5. the Staff login signature list doesn't hold it", att.staffSignatures.length === 0 && att.summary.staffSigned === 0);
    const xlsx = await fetch(`${base}${P}/documents/${mu1.id}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as any);
    let reportText = "";
    wb.getWorksheet("Signature Report")?.eachRow((r) => r.eachCell((c) => { reportText += ` ${c.text}`; }));
    check("5. the report's signature roster calls it carried over, and says not in VeritaAssure", /Carried over from OldSystem/.test(reportText) && /Signed version 2\.0 in OldSystem, the prior system, not in VeritaAssure/.test(reportText) && /2025-03-12/.test(reportText), reportText.slice(0, 200));
    check("5. the roster sheet says how", (() => {
      let how = "";
      wb.getWorksheet("Everyone on the Roster")?.eachRow((r) => { if (String(r.getCell(1).value).startsWith("Chem")) how = String(r.getCell(7).value); });
      return how === "Carried over from OldSystem";
    })());
    let aboutText = "";
    wb.getWorksheet("About")?.eachRow((r) => r.eachCell((c) => { aboutText += ` ${c.text}`; }));
    check("5. the report's About sheet explains it", /prior system/.test(aboutText) && /Carried over/.test(aboutText));
    const comp = (await call("GET", `${P}/compliance`, undefined, ownerToken)).body;
    const compAnn = comp.perStaffAttest?.find((s: any) => s.staff_employee_id === ann.emp);
    check("5. the compliance page counts it apart", compAnn?.carried_count === 1 && compAnn?.signed_count === 0, JSON.stringify(compAnn));

    // 6. The inspector
    const linkOut = await call("POST", `${P}/surveyor-links`, { label: "Made-up inspector" }, ownerToken);
    const token = linkOut.body.token as string;
    const insp = await call("GET", `/api/surveyor/${token}/policies/${mu1.id}/signoffs`);
    check("6. the inspector sees it listed apart", insp.status === 200 && insp.body.priorSignatures?.length === 1 && insp.body.staffSignatures?.length === 0 && insp.body.signoffs?.length === 0, JSON.stringify(Object.keys(insp.body)));
    const ip = insp.body.priorSignatures?.[0];
    check("6. with the name, version, original date and where", ip?.name === "Chem, Ann" && ip?.version === "2.0" && ip?.signed_on === "2025-03-12" && ip?.how === "Carried over from OldSystem", JSON.stringify(ip));
    check("6. and nothing that looks like a signature here", ip?.typed_signature === undefined && ip?.signed_document_hash === undefined && ip?.ip_address === undefined);

    // 7. Versions
    const newVersion = async (docId: number, major: boolean) => {
      const fd = new FormData();
      fd.append("file", new Blob([Buffer.from(`Made-up revision ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
      if (major) fd.append("is_major_revision", "true");
      await fetch(`${base}${P}/documents/${docId}/versions`, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}` }, body: fd });
      sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(docId);
    };
    await sendA([row({ docNumber: "MU 4", version: "1.0", signedOn: "2025-05-01" })]);
    check("7. it counts before any change", (await list(ann)).find((p) => p.document_id === mu4.id).signed === true);
    await newVersion(mu4.id, false);
    const afterMinor = (await list(ann)).find((p) => p.document_id === mu4.id);
    check("7. a lab that re-signs asks again on a later minor revision", afterMinor.signed === false && (await bell(ann)).includes(mu4.id));
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: true }, ownerToken);
    const carriedOn = (await list(ann)).find((p) => p.document_id === mu4.id);
    check("7. a lab that carries minor revisions doesn't", carriedOn.signed === true && carriedOn.prior_system?.version === "1.0" && !(await bell(ann)).includes(mu4.id), JSON.stringify(carriedOn));
    await newVersion(mu4.id, true);
    const afterMajor = (await list(ann)).find((p) => p.document_id === mu4.id);
    check("7. a later major version asks again, even so", afterMajor.signed === false && afterMajor.version_label === "2.0" && (await bell(ann)).includes(mu4.id), JSON.stringify(afterMajor));
    const stMajor = await call("GET", `${P}/documents/${mu4.id}/signature-status`, undefined, ownerToken);
    check("7. the roster reads an older version, naming what they signed", person(ann.emp, stMajor).status === "older_version" && person(ann.emp, stMajor).version_label === "1.0", JSON.stringify(person(ann.emp, stMajor)));
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: false }, ownerToken);
    const v = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(mu4.id) as any).v;
    const realSign = await call("POST", `/api/staff-portal-session/policies/${mu4.id}/sign`, { employee_id: ann.emp, version_id: v, typed_signature: ann.name, content_hash: "madeup" }, ann.token);
    const stReal = await call("GET", `${P}/documents/${mu4.id}/signature-status`, undefined, ownerToken);
    check("7. signing the new version here reads as a Staff login signature", realSign.status === 200 && person(ann.emp, stReal).status === "signed" && person(ann.emp, stReal).how === "Staff login" && !person(ann.emp, stReal).prior_system, JSON.stringify(person(ann.emp, stReal)));
    const compBoth = (await call("GET", `${P}/compliance`, undefined, ownerToken)).body.perStaffAttest?.find((s: any) => s.staff_employee_id === ann.emp);
    check("7. the compliance page keeps a signature made here apart from one carried over", compBoth?.signed_count === 1 && compBoth?.carried_count === 2, JSON.stringify(compBoth));
    const older = await sendA([row({ docNumber: "MU 3", version: "2.0", signedOn: "2024-06-01" })]);
    check("7. an earlier major than the one loaded is history only", older.body.counts?.loaded === 1 && older.body.results[0].counts === false && (sqlite.prepare("SELECT version_id FROM policy_prior_signatures WHERE document_id = ?").get(mu3.id) as any).version_id === null);
    check("7. and the person still owes the document", (await list(ann)).find((p) => p.document_id === mu3.id).signed === false && (await bell(ann)).includes(mu3.id));
    const stOlder = await call("GET", `${P}/documents/${mu3.id}/signature-status`, undefined, ownerToken);
    check("7. the roster reads an older version", person(ann.emp, stOlder).status === "older_version" && person(ann.emp, stOlder).version_label === "2.0", JSON.stringify(person(ann.emp, stOlder)));

    // 8. History: inactive people and later choices
    const snap8 = JSON.stringify({ ...moving(), sigs: 0 });
    const inactive = await sendA([{ docNumber: "MU 5", version: "1.0", personName: "Oldname, Pat", credentials: "MT", assignedOn: "2025-01-02", signedOn: "2025-02-02", personState: "inactive_in_prior_system" }]);
    check("8. an inactive person's row loads as history", inactive.body.counts?.loaded === 1);
    check("8. it creates no login, seat or roster row", JSON.stringify({ ...moving(), sigs: 0 }) === snap8);
    const stHist = await call("GET", `${P}/documents/${mu5.id}/signature-status`, undefined, ownerToken);
    check("8. they aren't on the roster list", !stHist.body.people.some((p: any) => /Oldname/.test(p.name)));
    check("8. they're listed as history on the document", stHist.body.prior_history?.length === 1 && stHist.body.prior_history[0].name === "Oldname, Pat" && stHist.body.prior_history[0].state === "inactive_in_prior_system", JSON.stringify(stHist.body.prior_history));
    check("8. nobody owes more for it", stHist.body.summary.owes === stHist.body.summary.assigned);
    check("8. the inspector sees it", (await call("GET", `/api/surveyor/${token}/policies/${mu5.id}/signoffs`)).body.priorSignatures?.[0]?.name === "Oldname, Pat");
    const xlsx5 = await fetch(`${base}${P}/documents/${mu5.id}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${ownerToken}` } });
    const wb5 = new ExcelJS.Workbook();
    await wb5.xlsx.load(Buffer.from(await xlsx5.arrayBuffer()) as any);
    let text5 = "";
    wb5.getWorksheet("Signature Report")?.eachRow((r) => r.eachCell((c) => { text5 += ` ${c.text}`; }));
    check("8. the report says they aren't on the active roster", /Oldname, Pat/.test(text5) && /Not on the active roster/.test(text5));
    const held = await sendA([row({ docNumber: "MU 5", version: "1.0", personName: "Micro, Beatrice", personState: "kept_by_a_person", employeeId: null, signedOn: "2025-07-07" })]);
    check("8. a name a person chose to keep as history loads unlinked", held.body.counts?.loaded === 1 && (await list(bea)).find((p) => p.document_id === mu5.id).signed === false);
    const linked = await sendA([row({ docNumber: "MU 5", version: "1.0", personName: "Micro, Beatrice", personState: "on_roster", employeeId: bea.emp, confirmedByPerson: true, signedOn: "2025-07-07" })]);
    check("8. a person's later choice links that row", linked.body.counts?.linked === 1 && (await list(bea)).find((p) => p.document_id === mu5.id).signed === true, JSON.stringify(linked.body.counts));
    check("8. and doesn't add one", n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE document_id = ? AND name_key = ?", mu5.id, personKey("Micro, Beatrice")) === 1);
    const crossLab = await send(labB, "Made Up Clinic", [{ docNumber: "MC 1", version: "1.0", personName: "Chem, Ann", signedOn: "2025-08-08", personState: "not_on_this_lab_roster" }]);
    check("8. someone on another lab's roster stays history on this lab's copy", crossLab.body.counts?.loaded === 1 && (sqlite.prepare("SELECT staff_employee_id FROM policy_prior_signatures WHERE document_id = ?").get(clinicDoc.id) as any).staff_employee_id === null);

    // 9. Staff limits
    for (const url of [`${P}/documents/${mu2.id}/signature-status`, `${P}/documents/${mu2.id}/signature-report.xlsx`, `${P}/compliance`, `${P}/read-sign/tracker?scope=lab`]) {
      check(`9. a Staff login can't read ${url.replace(P, "").replace(/\d+/g, ":id")}`, (await call("GET", url, undefined, ann.token)).status === 403);
    }
    check("9. their list holds only their own", !JSON.stringify(await list(ann)).includes("2025-04-01"));
    const routes: string[] = [];
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) if (typeof p === "string" && (p.startsWith("/api/labs/:labId/veritapolicy") || p.startsWith("/api/staff-portal-session"))) routes.push(p);
    }
    const leaks: string[] = [];
    for (const r of routes) {
      const url = r.replace(/:labId/g, String(labA)).replace(/:employeeId|:employee_id/g, String(ann.emp)).replace(/:[A-Za-z_]+/g, String(mu2.id));
      const joiner = url.includes("?") ? "&" : "?";
      const out = await fetch(`${base}${url}${joiner}employee_id=${ann.emp}&scope=lab`, { headers: { Authorization: `Bearer ${ann.token}` } });
      if (/Quillfeather|Oldname|2025-04-01/.test(await out.text())) leaks.push(`${out.status} ${r}`);
    }
    check(`9. no VeritaDC or staff read (${routes.length}) shows a Staff login a coworker's row`, routes.length > 40 && leaks.length === 0, leaks.join(" | "));

    // 10. The script
    const runScript = (args: string[]) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", path.resolve("scripts/veritadc-history-load.mts"), ...args], {
          env: { ...process.env, ADMIN_SECRET: ADMIN, DB_PATH: path.join(tmp, "never-used.db") },
        });
        let out = "";
        child.stdout.on("data", (x) => (out += x));
        child.stderr.on("data", (x) => (out += x));
        child.on("close", (code) => resolve({ code, out }));
      });
    const L2 = await provision("Made Up Second");
    const L3 = await provision("Made Up Third");
    const sl2 = staffLabFor(L2, "Made Up Second");
    const sl3 = staffLabFor(L3, "Made Up Third");
    const dana = addEmployee(sl2, L2, "Dana", "Scripted");
    const omar = addEmployee(sl3, L3, "Omar", "O'Scripted");
    addEmployee(sl2, L2, "Twin", "Same");
    addEmployee(sl2, L2, "Twin", "Same");
    addEmployee(sl2, L2, "Rae", "Nohistory");
    await loadDoc(L2, "Made Up Second", "S 1", "1.0", "Made-up S one");
    await loadDoc(L2, "Made Up Second", "SYS 1", "2.0", "Made-up systemwide");
    await loadDoc(L3, "Made Up Third", "SYS 1", "2.0", "Made-up systemwide");
    await loadDoc(L3, "Made Up Third", "T 1", "1.1", "Made-up T one");
    const head = "Employee ID,User,Credentials,Number,Document Title,Major Version,Type,Assigned,Effective Date,Date Signed Off,Days To Complete,\n";
    const reportFile = path.join(tmp, "report.csv");
    const line = (user: string, number: string, version: string, signed: string, cred = "MLS") => `,"${user}",${cred},${number},Made-up title,${version},Performing employee,1/2/2025,1/2/2025,${signed},3,\n`;
    fs.writeFileSync(reportFile, "﻿" + head
      + line("Scripted, Dana", "S 1", "1.0", "2/3/2025")          // on the roster, this lab
      + line("Scripted, Dana", "SYS 1", "2.0", "2/4/2025")        // systemwide: only her lab's copy
      + line("Scripted, Dana", "T 1", "1.0", "2/5/2025")          // not in her lab: history on that copy
      + line("OScripted, Omar", "T 1", "1.0", "3/3/2025")         // apostrophe set aside; report says 1.0, loaded 1.1
      + line("Scripted, Dana", "NOTLOADED 9", "1.0", "4/4/2025")  // document not loaded
      + line("Scripted, Dana", "S 1", "1.0", "Not signed off").replace(",Performing", ",Performing") // open, same person
      + line("Gone, Pat", "S 1", "1.0", "5/5/2025")               // inactive
      + line("Gone, Pat", "SYS 1", "2.0", "5/6/2025")             // inactive, both copies
      + line("Scripted, Mikey", "S 1", "1.0", "6/6/2025")         // no roster row: to check
      + line("Scripted, Mikey", "T 1", "1.0", "Not signed off")   // open, to check
      + line("Same, Twin", "S 1", "1.0", "7/7/2025")              // two roster rows: to check
      + line("Scripted, Dana", "S 1", "1.0", "2/3/2025")          // the same row twice
    );
    const activeFile = path.join(tmp, "active.csv");
    fs.writeFileSync(activeFile, "﻿" + head + line("Scripted, Dana", "S 1", "1.0", "2/3/2025") + line("OScripted, Omar", "T 1", "1.0", "3/3/2025") + line("Scripted, Mikey", "S 1", "1.0", "6/6/2025") + line("Same, Twin", "S 1", "1.0", "7/7/2025"));
    const configFile = path.join(tmp, "config.json");
    const config = { batch: "made-up-script", sourceSystem: "OldSystem", loadedBy: "Made Up Loader", ownerUserId: ownerId, labs: { [L2]: { expectedLabName: "Made Up Second" }, [L3]: { expectedLabName: "Made Up Third" } } };
    fs.writeFileSync(configFile, JSON.stringify(config));
    const work = path.join(tmp, "work");
    const labsArg = [L2, L3].sort((a, b) => a - b).join(",");
    const common = ["--report", reportFile, "--active-report", activeFile, "--config", configFile, "--work-dir", work, "--confirm-labs", labsArg, "--base-url", base, "--pause-ms", "0"];
    const scriptRows = () => n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id IN (?, ?)", L2, L3);
    const latest = (prefix: string) => {
      const f = fs.readdirSync(work).filter((x) => x.startsWith(prefix)).sort().pop() as string;
      return path.join(work, f);
    };
    const dry = await runScript(common);
    check("10. the dry run finishes", dry.code === 0, dry.out.slice(-300));
    check("10. it writes nothing", scriptRows() === 0);
    check("10. it prints no names", !/Scripted|Gone|Pat\b|Mikey|Twin/.test(dry.out), dry.out.slice(0, 200));
    const sum = JSON.parse(fs.readFileSync(latest("dryrun_summary_"), "utf8"));
    const by = sum.rows.byResult;
    check("10. counts: the report", sum.report.rows === 12 && sum.report.people === 5 && sum.report.signed === 10 && sum.report.open === 2, JSON.stringify(sum.report));
    check("10. counts: who matched", sum.people.matchedOnARoster === 2 && sum.people.inactiveInPriorSystem === 1 && sum.people.toCheck === 2, JSON.stringify(sum.people));
    check("10. counts: roster people with no history", sum.people.onTheRosterWithNoHistory[L2] === 3, JSON.stringify(sum.people.onTheRosterWithNoHistory));
    check("10. counts: documents", sum.documents.inReport === 4 && sum.documents.matched === 3 && sum.documents.notLoaded === 1, JSON.stringify(sum.documents));
    check("10. a person on one lab's roster gets only that lab's copy of a systemwide document", by.would_load_signed_counts === 3, JSON.stringify(by));
    check("10. a document not in their lab is history on that copy", by.would_load_history_not_on_this_lab_roster === 1);
    check("10. an inactive person is history on every copy", by.would_load_history_inactive_in_prior_system === 3);
    check("10. names it can't place are held, never guessed", by.held_person_to_check === 2 && by.open_person_to_check === 1);
    check("10. an open row is for the lab to assign", by.open_for_lab_to_assign === 1);
    check("10. the same row twice is counted once", by.same_row_twice_in_report === 1);
    check("10. a document that came over at a minor revision is counted", sum.documents.signedRowsWhereTheDocumentCameOverAtAMinorRevision === 1);
    const results = fs.readFileSync(latest("dryrun_results_"), "utf8");
    check("10. names are in the results file", /Scripted, Dana/.test(results) && /Gone, Pat/.test(results));
    const toCheck = fs.readFileSync(latest("dryrun_people_to_check_"), "utf8");
    check("10. the people to check list has both, and why", /Scripted, Mikey/.test(toCheck) && /no roster row has exactly this name/.test(toCheck) && /Same, Twin/.test(toCheck) && /more than one roster row/.test(toCheck));
    check("10. and leaves room to decide", toCheck.includes("name,lab_id,employee_id,decision"));
    check("10. and shows roster people sharing the last name, for the person looking", /Scripted, Dana/.test(toCheck));
    check("10. the documents not loaded are listed", /NOTLOADED 9/.test(fs.readFileSync(latest("dryrun_documents_not_loaded_"), "utf8")));
    check("10. the open rows are listed for the lab", /Scripted, Dana/.test(fs.readFileSync(latest("dryrun_open_rows_for_the_lab_"), "utf8")));

    const noGo = await runScript(["--report", reportFile, "--active-report", activeFile, "--config", configFile, "--work-dir", work, "--confirm-labs", labsArg, "--apply"]);
    check("10. --apply against production needs --go", noGo.code !== 0 && /--go/.test(noGo.out));
    check("10. --confirm-labs must match the config", (await runScript(["--report", reportFile, "--active-report", activeFile, "--config", configFile, "--work-dir", work, "--confirm-labs", "1,2"])).code !== 0);
    const badConfig = path.join(tmp, "bad.json");
    fs.writeFileSync(badConfig, JSON.stringify({ ...config, labs: { [L2]: { expectedLabName: "Wrong Name" }, [L3]: { expectedLabName: "Made Up Third" } } }));
    const refused = await runScript(["--report", reportFile, "--active-report", activeFile, "--config", badConfig, "--work-dir", work, "--confirm-labs", labsArg, "--base-url", base, "--apply"]);
    check("10. a lab name that doesn't match stops before anything is sent", refused.code !== 0 && /name doesn't match/.test(refused.out) && scriptRows() === 0, refused.out.slice(-200));

    const mailBefore = mail.length;
    const seatsBefore = moving();
    const applied = await runScript([...common, "--apply"]);
    check("10. the real load finishes", applied.code === 0, applied.out.slice(-300));
    const appliedSum = JSON.parse(fs.readFileSync(latest("load_summary_"), "utf8"));
    check("10. it loads what the dry run said", appliedSum.outcome.loaded === 7 && scriptRows() === 7, JSON.stringify(appliedSum.outcome));
    check("10. no email, login, seat or assignment", mail.length === mailBefore && JSON.stringify(moving()) === JSON.stringify(seatsBefore));
    check("10. the load prints no names", !/Scripted|Gone, Pat|Mikey|Twin/.test(applied.out));
    const danaRows = sqlite.prepare("SELECT document_id, version_id, person_state FROM policy_prior_signatures WHERE staff_employee_id = ?").all(dana) as any[];
    check("10. Dana has her lab's two copies, linked", danaRows.length === 2 && danaRows.every((r) => r.version_id != null && r.person_state === "on_roster"), JSON.stringify(danaRows));
    const omarRow = sqlite.prepare("SELECT source_version, version_id FROM policy_prior_signatures WHERE staff_employee_id = ?").get(omar) as any;
    check("10. a report of 1.0 on a document loaded at 1.1 counts, and keeps saying 1.0", omarRow?.source_version === "1.0" && omarRow?.version_id != null, JSON.stringify(omarRow));
    check("10. nobody on the to-check list was written", n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE source_name = 'Scripted, Mikey' OR source_name LIKE 'Same%'") === 0);
    const again = await runScript([...common, "--apply"]);
    const againSum = JSON.parse(fs.readFileSync(latest("load_summary_"), "utf8"));
    check("10. a rerun changes nothing", again.code === 0 && againSum.outcome.already_loaded === 7 && !againSum.outcome.loaded && scriptRows() === 7, JSON.stringify(againSum.outcome));
    const mapFile = path.join(tmp, "map.csv");
    const mikeEmp = addEmployee(sl2, L2, "Michael", "Scripted");
    fs.writeFileSync(mapFile, `name,lab_id,employee_id,decision\n"Scripted, Mikey",${L2},${mikeEmp},\n"Same, Twin",,,history\n`);
    const mapped = await runScript([...common, "--apply", "--people-map", mapFile]);
    const mappedSum = JSON.parse(fs.readFileSync(latest("load_summary_"), "utf8"));
    check("10. a person's decision loads those rows", mapped.code === 0 && mappedSum.outcome.loaded === 2 && mappedSum.people.toCheck === 0, JSON.stringify(mappedSum.outcome));
    check("10. the chosen person is linked", n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE staff_employee_id = ?", mikeEmp) === 1);
    check("10. 'history' keeps a name unlinked", (sqlite.prepare("SELECT staff_employee_id, person_state FROM policy_prior_signatures WHERE source_name = 'Same, Twin'").get() as any)?.person_state === "kept_by_a_person");

    // 11. Export, delete, counts
    const { EXPORT_TABLES } = (await import("../../server/exportAllTables")) as any;
    check("11. the table is in the customer's export", !!EXPORT_TABLES?.policy_prior_signatures);
    const status = await call("GET", `/api/admin/veritadc/history-load/status?labId=${labA}`, undefined, undefined, ADMIN);
    check("11. the status route gives counts", status.status === 200 && status.body.rows > 0 && status.body.countAsSigned > 0 && status.body.historyOnly > 0, JSON.stringify(status.body));
    check("11. and no names", !/Chem|Oldname|Quillfeather/.test(status.text));
    const refOut = await call("GET", `/api/admin/veritadc/history-load/reference?labId=${L2}`, undefined, undefined, ADMIN);
    check("11. the reference route gives the script its roster and documents", refOut.status === 200 && refOut.body.roster.length >= 4 && refOut.body.documents.length === 2);
    const load = await call("GET", `/api/admin/veritadc/bulk-load/status?labId=${labA}`, undefined, undefined, ADMIN);
    check("11. the document load's status counts them apart", load.body.forCarried?.priorSignatures > 0 && load.body.forCarried?.signoffs === 0);
    await call("DELETE", `${P}/documents/${mu3.id}`, undefined, ownerToken);
    check("11. deleting a document deletes its carried rows", n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE document_id = ?", mu3.id) === 0);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);

  async function upload(prefix: string, token: string, title: string, docNumber: string) {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from("Made-up text\n")], { type: "text/plain" }), "made-up.txt");
    fd.append("title", title);
    fd.append("doc_number", docNumber);
    const r = await fetch(`${base}${prefix}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    const j = (await r.json()) as any;
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(j.id);
    return j.id as number;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
