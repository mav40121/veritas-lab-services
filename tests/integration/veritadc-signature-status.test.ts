// tests/integration/veritadc-signature-status.test.ts
//
// STANDING integration test for who has signed a VeritaDC document (Michael 2026-11-04, Q161 = 1; CAP GEN.75400):
//   1. The roster view lists every active person, nobody-assigned included, and leaves out people who left.
//   2. A Staff login's signature closes their assignment, with what they signed and when, and it is audited.
//   3. Signing first and being assigned later closes at once; an older open assignment closes when anyone reads it.
//   4. Someone who attested in VeritaDC reads as signed on the roster, and on their own My sign-offs list if they have a Staff login.
//   5. The bell lists what a Staff login has to sign, by the same rules as My sign-offs.
//   6. Limits: a signature doesn't answer a required quiz, an old version doesn't answer a new assignment, and nobody signs for someone else.
//   7. Versions: a new version reads "older version"; a lab that carries minor revisions reads a minor one as signed, never a major one.
//   8. A type with no read-and-sign says so, a draft says it isn't approved, another lab can't read it, and the Excel report has the roster.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-signature-status

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";

(globalThis as any).require ??= createRequire(import.meta.url);

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
  const PW = ["Sign", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `signstatus-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Sign Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const upload = async (L: { token: string; labId: number }, fields: Record<string, string>, p = `/api/labs/${L.labId}/veritapolicy/documents`) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };

  try {
    const A = await mkLab("a");
    const B = await mkLab("b");
    const P = `/api/labs/${A.labId}/veritapolicy`;
    const existingStaffLab = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any;
    const staffLab = existingStaffLab?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Sign Lab', '22D0000123', ?, ?, ?)").run(A.userId, A.labId, now, now).lastInsertRowid);
    const addEmployee = (first: string, last: string, loginUserId: number | null = null, status = "active") => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, login_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Histotechnologist', ?, ?, ?, ?)"
    ).run(staffLab, A.labId, A.userId, last, first, status, loginUserId, now, now).lastInsertRowid);
    const addUser = async (tag: string) => {
      const email = `signstatus-${tag}-${Date.now()}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Person ${tag}`, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(A.labId, userId);
      return { email, userId };
    };
    const addStaffLogin = async (first: string, last: string) => {
      const u = await addUser(first.toLowerCase());
      const emp = addEmployee(first, last);
      sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(A.userId, u.email, u.userId, A.labId, emp);
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.userId);
      const token = issueSession(sqlite, u.userId, { headers: { "user-agent": "sign-status-test" }, ip: "127.0.0.1" }).token as string;
      return { ...u, emp, token, name: `${first} ${last}` };
    };
    const ann = await addStaffLogin("Ann", "Signer");
    const bea = await addStaffLogin("Bea", "Signer");
    const cal = await addStaffLogin("Cal", "Signer");
    const noLogin = addEmployee("Nia", "Nologin");
    const left = addEmployee("Lee", "Leaving", null, "terminated");

    const mkDoc = async (title: string, fields: Record<string, string> = {}) => {
      const d = await upload(A, { title, ...fields });
      sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(d.id);
      return d.id as number;
    };
    const status = async (id: number, token = A.token) => call("GET", `${P}/documents/${id}/signature-status`, undefined, token);
    const person = (s: any, emp: number) => s.body.people?.find((p: any) => p.employee_id === emp);
    const staffRow = async (id: number, who: { emp: number; token: string }) => (await call("GET", `/api/staff-portal-session/policies?employee_id=${who.emp}`, undefined, who.token)).body.policies?.find((p: any) => p.document_id === id);
    const signAs = async (id: number, who: { emp: number; token: string; name: string }) => {
      const row = await staffRow(id, who);
      return call("POST", `/api/staff-portal-session/policies/${id}/sign`, { employee_id: who.emp, version_id: row?.version_id, typed_signature: who.name, content_hash: "madeuphash" }, who.token);
    };
    const assign = (id: number, userId: number) => call("POST", `${P}/documents/${id}/attestations`, { assignedToUserIds: [userId] }, A.token);
    const tracker = async (id: number) => (await call("GET", `${P}/documents/${id}/attestations`, undefined, A.token)).body;
    const pendingIds = async (who: { token: string }) => ((await call("GET", `${P}/pending-attestations`, undefined, who.token)).body.pending || []).map((p: any) => p.document_id);
    const attRow = (id: number, userId: number) => sqlite.prepare("SELECT * FROM policy_attestations WHERE document_id = ? AND assigned_to_user_id = ? ORDER BY id DESC LIMIT 1").get(id, userId) as any;

    // 1. The roster view
    const doc1 = await mkDoc("Made-up fire plan");
    const s0 = await status(doc1);
    check("1. the route answers", s0.status === 200 && s0.body.read_and_sign_required === true && s0.body.approved === true, `HTTP ${s0.status}`);
    check("1. every active person is listed, nobody assigned", s0.body.summary?.total === 4 && s0.body.summary?.not_signed === 4 && s0.body.summary?.signed === 0, JSON.stringify(s0.body.summary));
    check("1. someone who left isn't listed", !person(s0, left));
    check("1. someone with no login is flagged", person(s0, noLogin)?.has_login === false && s0.body.summary.no_login === 1 && person(s0, ann.emp)?.has_login === true);

    // 2. A Staff login's signature closes their assignment
    await assign(doc1, ann.userId);
    check("2. the assignment starts open", (await pendingIds(ann)).includes(doc1) && (await tracker(doc1)).summary.outstanding === 1);
    const signed = await signAs(doc1, ann);
    check("2. the signature saves", signed.status === 200 && signed.body.already_signed === false, `HTTP ${signed.status}`);
    const att = attRow(doc1, ann.userId);
    check("2. it closes the assignment with what they signed", !!att.completed_at && att.typed_signature === ann.name && att.attested_document_hash === "madeuphash", JSON.stringify({ c: att.completed_at, t: att.typed_signature, h: att.attested_document_hash }));
    const staffSig = sqlite.prepare("SELECT signed_at FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?").get(doc1, ann.emp) as any;
    check("2. the completed time is when they signed", att.completed_at === staffSig.signed_at, `${att.completed_at} / ${staffSig.signed_at}`);
    check("2. it is gone from their pending list and the tracker counts it", !(await pendingIds(ann)).includes(doc1) && (await tracker(doc1)).summary.completed === 1 && (await tracker(doc1)).summary.outstanding === 0);
    const audit = sqlite.prepare("SELECT details FROM policy_audit_log WHERE document_id = ? AND action = 'attestation_completed'").all(doc1) as any[];
    check("2. it is audited once as a Staff login signature", audit.length === 1 && JSON.parse(audit[0].details).via === "staff_login", JSON.stringify(audit));
    const s1 = await status(doc1);
    check("2. the roster reads signed, with the date and how", person(s1, ann.emp)?.status === "signed" && person(s1, ann.emp)?.how === "Staff login" && !!person(s1, ann.emp)?.signed_at, JSON.stringify(person(s1, ann.emp)));
    check("2. not signed comes first in the list", s1.body.people[0].status === "not_signed" && s1.body.people[s1.body.people.length - 1].status === "signed");
    const again = await signAs(doc1, ann);
    check("2. signing again changes nothing", again.body.already_signed === true && (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'attestation_completed'").get(doc1) as any).n === 1);

    // 3. Signed first, assigned later; older open assignments
    await signAs(doc1, bea);
    await assign(doc1, bea.userId);
    check("3. signed first and assigned later closes at once", !!attRow(doc1, bea.userId).completed_at && !(await pendingIds(bea)).includes(doc1));
    const doc2 = await mkDoc("Made-up older assignment");
    await signAs(doc2, ann);
    const v2 = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(doc2) as any).v;
    sqlite.prepare("INSERT INTO policy_attestations (document_id, version_id, assigned_to_user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, datetime('now'))").run(doc2, v2, ann.userId, A.userId);
    check("3. an assignment left open from before closes when they read their list", !(await pendingIds(ann)).includes(doc2) && !!attRow(doc2, ann.userId).completed_at);
    await signAs(doc2, bea);
    sqlite.prepare("INSERT INTO policy_attestations (document_id, version_id, assigned_to_user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?, datetime('now'))").run(doc2, v2, bea.userId, A.userId);
    check("3. and when the director opens the tracker", (await tracker(doc2)).attestations.find((r: any) => r.assigned_to_user_id === bea.userId)?.completed_at != null);

    // 4. Attested in VeritaDC
    const doc3 = await mkDoc("Made-up attested document");
    await assign(doc3, cal.userId);
    const open3 = attRow(doc3, cal.userId);
    const done3 = await call("POST", `${P}/attestations/${open3.id}/complete`, { typedSignature: cal.name, password: PW }, cal.token);
    check("4. the attestation saves", done3.status === 200, `HTTP ${done3.status} ${done3.body.error || ""}`);
    const s3 = await status(doc3);
    check("4. the roster reads signed by attestation", person(s3, cal.emp)?.status === "signed" && person(s3, cal.emp)?.how === "Attestation", JSON.stringify(person(s3, cal.emp)));
    const row3 = await staffRow(doc3, cal);
    check("4. their My sign-offs list doesn't ask again", row3?.signed === true && !!row3?.signed_at, JSON.stringify(row3));
    const editor = await addUser("editor");
    const empEditor = addEmployee("Eddie", "Editor", editor.userId);
    await assign(doc3, editor.userId);
    sqlite.prepare("UPDATE policy_attestations SET completed_at = datetime('now'), typed_signature = 'Eddie Editor' WHERE document_id = ? AND assigned_to_user_id = ?").run(doc3, editor.userId);
    check("4. an editor on the roster counts through their login", person(await status(doc3), empEditor)?.status === "signed");

    // 5. The bell
    const bell = async (who: { token: string }) => ((await call("GET", `/api/me/pending-staff-portal-items?lab_id=${A.labId}`, undefined, who.token)).body.policies || []).map((p: any) => p.document_id);
    const bellCal = await bell(cal);
    check("5. the bell lists what they haven't signed", bellCal.includes(doc1) && bellCal.includes(doc2), JSON.stringify(bellCal));
    check("5. and leaves out what they attested to", !bellCal.includes(doc3));
    check("5. and what they signed", !(await bell(ann)).includes(doc1));

    // 6. Limits
    const doc4 = await mkDoc("Made-up quiz document");
    sqlite.prepare("UPDATE policy_documents SET quiz_requires_pass = 1, quiz_pass_threshold = 80 WHERE id = ?").run(doc4);
    await assign(doc4, ann.userId);
    await signAs(doc4, ann);
    check("6. a signature doesn't answer a required quiz", attRow(doc4, ann.userId).completed_at == null && (await pendingIds(ann)).includes(doc4));
    sqlite.prepare("UPDATE policy_attestations SET quiz_score = 90 WHERE document_id = ? AND assigned_to_user_id = ?").run(doc4, ann.userId);
    check("6. once the quiz is passed the signature closes it", !(await pendingIds(ann)).includes(doc4) && attRow(doc4, ann.userId).completed_at != null);
    const asOther = await call("POST", `/api/staff-portal-session/policies/${doc1}/sign`, { employee_id: noLogin, version_id: 1, typed_signature: "Someone Else" }, cal.token);
    check("6. nobody signs for someone else", asOther.status === 403, `HTTP ${asOther.status}`);

    // 7. New versions
    const doc5 = await mkDoc("Made-up revised document");
    await signAs(doc5, ann);
    const D5 = `${P}/documents/${doc5}`;
    const approve5 = () => sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(doc5);
    await upload(A, {}, `${D5}/versions`);
    approve5();
    const m1 = person(await status(doc5), ann.emp);
    check("7. in a re-sign lab a minor revision reads as an older version", m1?.status === "older_version" && m1?.version_label === "1.0", JSON.stringify(m1));
    await assign(doc5, ann.userId);
    check("7. the old signature doesn't answer an assignment on the new version", attRow(doc5, ann.userId).completed_at == null && (await pendingIds(ann)).includes(doc5));
    await call("DELETE", `${D5}/attestations/${attRow(doc5, ann.userId).id}`, undefined, A.token);
    const set = await call("PUT", `${P}/settings/minor-revisions`, { carryForward: true }, A.token);
    const m2 = person(await status(doc5), ann.emp);
    check("7. a lab that carries minor revisions reads it as signed", set.status === 200 && m2?.status === "signed" && m2?.carried_forward === true && m2?.version_label === "1.0", JSON.stringify(m2));
    await upload(A, { is_major_revision: "true" }, `${D5}/versions`);
    approve5();
    const m3 = person(await status(doc5), ann.emp);
    check("7. a major revision never carries", m3?.status === "older_version", JSON.stringify(m3));
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: false }, A.token);

    // 8. Edges
    const doc6 = await mkDoc("Made-up form");
    sqlite.prepare("UPDATE policy_documents SET doc_type = 'form' WHERE id = ?").run(doc6);
    sqlite.prepare("INSERT OR REPLACE INTO policy_doc_type_settings (lab_id, doc_type, requires_read_and_sign, requires_periodic_review, updated_at) VALUES (?, 'form', 0, 0, ?)").run(A.labId, now);
    check("8. a type with no read-and-sign says so", (await status(doc6)).body.read_and_sign_required === false);
    check("8. and isn't on the bell", !(await bell(cal)).includes(doc6));
    const draft = await upload(A, { title: "Made-up draft" });
    check("8. a draft says it isn't approved", (await status(draft.id)).body.approved === false);
    const other = await status(doc1, B.token);
    check("8. another lab can't read it", [403, 404].includes(other.status), `HTTP ${other.status}`);
    check("8. a made-up document is not found", (await status(99999999)).status === 404);

    const xlsx = await fetch(`${base}${P}/documents/${doc1}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${A.token}` } });
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as any);
    const sheet = wb.getWorksheet("Everyone on the Roster");
    const statuses: string[] = [];
    sheet?.eachRow((r, n) => { if (n > 1) statuses.push(String(r.getCell(4).value)); });
    check("8. the Excel report has everyone on the roster", xlsx.status === 200 && statuses.length === 5, JSON.stringify(statuses));
    check("8. with signed and not signed in plain words", statuses.includes("Signed") && statuses.includes("Not signed"));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
