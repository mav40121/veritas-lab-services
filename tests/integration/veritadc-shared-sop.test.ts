// tests/integration/veritadc-shared-sop.test.ts
//
// STANDING integration test for one controlled procedure sent to several laboratories (B1; server/policySharedDocuments.ts):
//   0. The tables exist and are classified for the export and the purge.
//   1. The master is an ordinary VeritaDC document of the organization's repository lab; only its approved version can be sent, by
//      people who can edit VeritaDC there. A lab that isn't a repository sends nothing.
//   2. A laboratory gets its own draft, in its own manual and on its own route, with the same file fingerprint. No signature is
//      carried, nothing is submitted, and staff, an inspector and a share link read nothing until that laboratory approves it.
//   3. The author rule: the laboratory's document owner may sign a version nobody there wrote; the person who wrote it may not.
//   4. Who can't: another organization's lab (even when its id is sent), someone who isn't a member of the receiving lab, a view-only
//      seat, a Staff login, a support login.
//   5. A new master version: a draft revision with the change summary and the opt-in notice; staff keep the approved version; an open
//      draft or review is never overwritten, the newer version waits and then comes in, or is taken on request.
//   6. A laboratory's own document in place of the received draft; declining a document or one version; stopping and following again.
//   7. Addenda: their own document, versions and approval; one view, one print order; the master's file can't be replaced.
//   8. Retiring the master; a laboratory leaving the organization; deleting; the same send twice and two at once; a lab with no route;
//      a plan without VeritaDC; a closed or read-only lab.
//   9. The organization's view: counts only, only labs the reader's roll-up shows, group filter, Excel.
//  10. A lab that receives nothing answers exactly as before, the System Repository's loose files included.
//  11. The addenda in the other readers (VeritaScan, a finding, VeritaMaintain, the staff approval screen), in read-and-sign, and on
//      paper: Word, PDF, picture, landscape and turned pages, and a part that can't go in. The PDF's words are read with PyMuPDF.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only); no email leaves (readSignMailer is swapped out).
// Run: npm run test:veritadc-shared-sop

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { readSignMailer, readSignTracker } from "../../server/policyReadSign";
import { EXPORT_TABLES } from "../../server/exportAllTables";
import { planCustomerPurge, purgeRule } from "../../server/customerPurge";
import { VLS_SUPPORT_REFUSED_ROUTES } from "../../server/vlsSupport";

(globalThis as any).require ??= createRequire(import.meta.url);
delete process.env.RESEND_API_KEY; // belt and braces: the mailer is swapped out below

let failures = 0, passes = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (cond) passes++; else failures++;
}
const EM_DASH = String.fromCharCode(0x2014);
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const keysOf = (o: any) => Object.keys(o || {}).sort().join(",");

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
  const PW = ["Shared", "sop", "1!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();
  const one = (sql: string, ...a: any[]) => sqlite.prepare(sql).get(...a) as any;
  const all = (sql: string, ...a: any[]) => sqlite.prepare(sql).all(...a) as any[];
  const run = (sql: string, ...a: any[]) => sqlite.prepare(sql).run(...a);

  const mail: Array<{ to: string; subject: string; html: string }> = [];
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: any) => { mail.push(m); };
  const taken = async () => { await new Promise((r) => setTimeout(r, 60)); return mail.splice(0); };

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString("utf8");
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: json, text, buf, headers: r.headers };
  };

  type Lab = { email: string; token: string; labId: number; userId: number; P: string; name: string; owner: string };
  type Person = { email: string; userId: number; token: string; emp: number | null; name: string };
  const register = async (tag: string, name: string) => {
    const email = `ssop-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    return { email, userId, token: reg.body.token as string, name };
  };
  const mkLab = async (tag: string, labName: string): Promise<Lab> => {
    const o = await register(tag, `Owner ${tag.toUpperCase()}`);
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: o.email, labName, plan: "hospital", isWarehouse: true });
    run("UPDATE users SET plan = 'hospital' WHERE id = ?", o.userId);
    return { email: o.email, token: o.token, labId: prov.body.labId, userId: o.userId, P: `/api/labs/${prov.body.labId}/veritapolicy`, name: labName, owner: o.name };
  };
  const session = (userId: number) => issueSession(sqlite, userId, { headers: { "user-agent": "shared-sop-test" }, ip: "127.0.0.1" }).token as string;
  const roster = (L: Lab, first: string, last: string) => {
    const staffLab = one("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", L.labId)?.id
      ?? Number(run("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', ?, ?, ?, ?)", L.userId, `22D0B1${String(L.labId).padStart(4, "0")}`, L.labId, now, now).lastInsertRowid);
    return Number(run("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', '2020-01-01', ?)",
      staffLab, L.labId, L.userId, last, first, now).lastInsertRowid);
  };
  const person = async (L: Lab, tag: string, name: string, seat: "active" | "view_only" | "staff_portal", role = "staff"): Promise<Person> => {
    const r = await register(tag, name);
    run("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)", L.labId, r.userId, role, now, now, now);
    run("UPDATE users SET lab_id = ?, plan = 'hospital' WHERE id = ?", L.labId, r.userId);
    const [first, last] = name.split(" ");
    const emp = seat === "staff_portal" ? roster(L, first, last) : null;
    run("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
      L.userId, r.email, r.userId, now, now, seat, L.labId, emp, seat === "active" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}');
    run("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", r.userId);
    return { email: r.email, userId: r.userId, token: session(r.userId), emp, name };
  };
  const file = async (path: string, fields: Record<string, string>, text: string, token: string, name = "made-up.txt", type = "text/plain") => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(text)], { type }), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const doc = async (L: Lab, title: string, text: string, extra: Record<string, string> = {}, token = L.token) => Number((await file(`${L.P}/documents`, { title, ...extra }, text, token)).body.id);
  const newVersion = async (L: Lab, id: number, text: string, extra: Record<string, string> = {}, token = L.token) => file(`${L.P}/documents/${id}/versions`, extra, text, token);
  const row = (id: number) => one("SELECT * FROM policy_documents WHERE id = ?", id);
  const route = async (L: Lab, name: string, signer: number, makeDefault = true) => {
    const wf = await call("POST", `${L.P}/workflows`, { name }, L.token);
    await call("POST", `${L.P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer }, L.token);
    if (makeDefault) await call("PUT", `${L.P}/workflows/${wf.body.id}`, { isDefault: true }, L.token);
    return Number(wf.body.id);
  };
  const submit = (L: Lab, id: number, workflowId: number, token = L.token) => call("POST", `${L.P}/documents/${id}/submit`, { workflowId }, token);
  const decide = (L: Lab, id: number, who: { token: string; name: string }, verb = "approve") => call("POST", `${L.P}/documents/${id}/${verb}`, { typedSignature: who.name, password: PW }, who.token);
  const approve = async (L: Lab, id: number, wf: number, who: { token: string; name: string }) => { await submit(L, id, wf); return (await decide(L, id, who)).body.status; };
  const copyOf = (master: number, L: Lab) => one("SELECT * FROM policy_shared_copies WHERE master_document_id = ? AND lab_id = ?", master, L.labId);
  const audits = (id: number, action: string) => all("SELECT * FROM policy_audit_log WHERE document_id = ? AND action = ? ORDER BY id", id, action);
  const received = async (L: Lab, token = L.token) => (await call("GET", `${L.P}/shared/received`, undefined, token)).body;
  const act = (L: Lab, copyId: number, verb: string, body: unknown = {}, token = L.token) => call("POST", `${L.P}/shared/received/${copyId}/${verb}`, body, token);

  try {
    // ── The made-up organization ──
    const R = await mkLab("repo", "Made-up System Library");
    const A = await mkLab("a", "Made-up North Laboratory");
    const B = await mkLab("b", "Made-up South Laboratory");
    const C = await mkLab("c", "Made-up Coast Laboratory");
    const Z = await mkLab("z", "Made-up Quiet Laboratory"); // in the organization, receives nothing
    const X = await mkLab("x", "Made-up Other System Laboratory"); // another organization
    const S = await mkLab("s", "Made-up Standalone Laboratory"); // no organization
    const ORG = Number(run("INSERT INTO organizations (name, billing_owner_user_id, plan, created_at, updated_at) VALUES ('Made-up Health System', ?, 'hospital', ?, ?)", R.userId, now, now).lastInsertRowid);
    const ORGX = Number(run("INSERT INTO organizations (name, billing_owner_user_id, plan, created_at, updated_at) VALUES ('Made-up Other System', ?, 'hospital', ?, ?)", X.userId, now, now).lastInsertRowid);
    for (const L of [R, A, B, C, Z]) run("UPDATE labs SET organization_id = ? WHERE id = ?", ORG, L.labId);
    run("UPDATE labs SET is_repository = 1 WHERE id = ?", R.labId);
    run("UPDATE labs SET organization_id = ? WHERE id = ?", ORGX, X.labId);
    const orgAdminReg = await register("orgadmin", "Oda Admin");
    run("INSERT INTO organization_members (organization_id, user_id, org_role, status, created_at, updated_at) VALUES (?, ?, 'org_admin', 'active', ?, ?)", ORG, orgAdminReg.userId, now, now);
    run("UPDATE users SET plan = 'hospital' WHERE id = ?", orgAdminReg.userId);
    const orgAdmin = { ...orgAdminReg };
    const writer = await person(R, "writer", "Wren Writer", "active"); // named as an editor in the repository
    const rSigner = await person(R, "rsigner", "Rae Signer", "active");
    const rViewer = await person(R, "rviewer", "Vic Viewer", "view_only");
    const aSigner = await person(A, "asigner", "Ann Signer", "active");
    const aEditor = await person(A, "aeditor", "Ed Editor", "active");
    const aViewer = await person(A, "aviewer", "Val Viewer", "view_only");
    const aStaff = await person(A, "astaff", "Rowan Quillby", "staff_portal");
    const bSigner = await person(B, "bsigner", "Bea Signer", "active");
    const cSigner = await person(C, "csigner", "Cal Signer", "active");
    const bStaff = await person(B, "bstaff", "Robin Quillby", "staff_portal");
    const supReg = await register("support", "Val Support");
    run("UPDATE users SET vls_support = 1 WHERE id = ?", supReg.userId);
    const support = supReg;

    for (const L of [R, A, B, C, Z]) await call("GET", `${L.P}/manuals`, undefined, L.token); // the module's own first-visit manuals
    const chem = (L: Lab) => one("SELECT id FROM policy_manuals WHERE lab_id = ? AND name = 'Chemistry'", L.labId).id as number;
    const rWf = await route(R, "Library approval", rSigner.userId);
    const aWf = await route(A, "North approval", aSigner.userId);
    const bWf = await route(B, "South approval", bSigner.userId);
    // C has no approval route yet.
    run("UPDATE policy_approval_workflows SET archived_at = datetime('now') WHERE lab_id = ?", C.labId);

    // ── 0. Schema ──
    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    const mine = ["policy_shared_copies", "policy_shared_versions", "policy_addenda"];
    check("0. the three tables exist", mine.every((t) => tables.includes(t)));
    check("0. they are classified for the export (the receiving lab) and the purge", mine.every((t) => EXPORT_TABLES[t]?.scope.kind === "lab" && purgeRule(t)?.kind === "delete"));
    check("0. every column is added by the migration as well as the create", (() => {
      const cols = (t: string) => all(`PRAGMA table_info(${t})`).map((c) => c.name);
      return cols("policy_shared_copies").length === 22 && cols("policy_shared_versions").length === 10 && cols("policy_addenda").length === 8;
    })(), mine.map((t) => all(`PRAGMA table_info(${t})`).length).join(","));
    const refused = VLS_SUPPORT_REFUSED_ROUTES.filter((r) => /shared\/|addenda/.test(r));
    check("0. every write here is on the list a support login is refused", refused.length === 9, refused.join(" | "));

    // ── 10 (before). What a lab that receives nothing answers now ──
    const zDoc = await doc(Z, "Quiet lab procedure", "QUIET made up", { doc_number: "QZ 1", manual_id: String(chem(Z)) });
    const zWf = await route(Z, "Quiet approval", Z.userId);
    await call("PATCH", `${Z.P}/workflows/${zWf}/steps/${one("SELECT id FROM policy_approval_steps WHERE workflow_id = ?", zWf).id}`, { allowSelfApproval: true }, Z.token);
    check("10. setup: the quiet lab approves its own procedure", (await approve(Z, zDoc, zWf, { token: Z.token, name: Z.owner })) === "approved");
    await call("POST", `/api/labs/${Z.labId}/repository/documents`, { title: "A loose link", url: "https://example.com/loose", category: "Forms" }, Z.token);
    const zSurveyor = (await call("POST", `${Z.P}/surveyor-links`, { label: "Made-up visit" }, Z.token)).body.token as string;
    const zShare = (await call("POST", `${Z.P}/documents/${zDoc}/share-links`, { label: "Made-up share" }, Z.token)).body.token as string;
    const quiet = async () => {
      const out: Record<string, string> = {};
      for (const p of [
        `${Z.P}/documents`, `${Z.P}/documents/${zDoc}`, `${Z.P}/documents/${zDoc}/render`, `${Z.P}/documents/${zDoc}/signoffs`, `${Z.P}/documents/${zDoc}/links`, `${Z.P}/documents/${zDoc}/notes`,
        `${Z.P}/manuals`, `${Z.P}/workflows`, `${Z.P}/doc-types`, `${Z.P}/archived-documents`, `${Z.P}/pending-reviews`, `${Z.P}/search?q=Quiet`, `${Z.P}/settings/email-notices`,
        `${Z.P}/read-sign?scope=document&id=${zDoc}`, `${Z.P}/compliance`, `/api/labs/${Z.labId}/repository/documents`, `/api/surveyor/${zSurveyor}/policies`, `/api/surveyor/${zSurveyor}/policies/${zDoc}/render`,
        `/api/public/policy-share/${zShare}/file`,
      ]) {
        const r = await call("GET", p, undefined, Z.token);
        out[p] = `${r.status} ${r.text}`;
      }
      const meta = (await call("GET", `/api/public/policy-share/${zShare}`)).body;
      out["share meta"] = JSON.stringify(meta);
      return out;
    };
    const quietBefore = await quiet();
    const LIST_KEYS = ["carried_over", "created_at", "current_file_format", "current_uploaded_at", "current_version_id", "current_version_label", "current_version_major", "current_version_minor", "current_version_number", "description", "doc_number", "doc_type", "effective_date", "id", "lab_id", "manual_id", "manual_name", "manual_path", "next_review_date", "note_count", "owner_user_id", "read_sign_targets", "review_interval_months", "status", "title", "updated_at", "workflow_id"];
    const zList = JSON.parse(quietBefore[`${Z.P}/documents`].slice(4)).documents.find((d: any) => d.id === zDoc);
    check("10. its document list row has the keys it always had", keysOf(zList) === LIST_KEYS.join(","), keysOf(zList));
    check("10. its document has the keys it always had", keysOf(JSON.parse(quietBefore[`${Z.P}/documents/${zDoc}`].slice(4))) === "can_open_versions,carried,document,versions", keysOf(JSON.parse(quietBefore[`${Z.P}/documents/${zDoc}`].slice(4))));
    check("10. the share link's answer has the keys it always had", keysOf(JSON.parse(quietBefore["share meta"])) === "approved_date,clia_number,doc_number,effective_date,lab_name,revision_in_progress,title,version", keysOf(JSON.parse(quietBefore["share meta"])));

    // ── 1. The master ──
    const M = await doc(R, "Specimen labeling", "MASTER-ONE made up", { doc_number: "SYS 1", doc_type: "procedure", manual_id: String(chem(R)), description: "Made-up description" }, writer.token);
    const T = `${R.P}/shared/masters/${M}`;
    const send = (body: unknown, token = writer.token, master = M) => call("POST", `${R.P}/shared/masters/${master}/send`, body, token);
    check("1. a draft can't be sent", (await send({ labIds: [A.labId] })).body.code === "NOT_APPROVED" && !copyOf(M, A));
    await submit(R, M, rWf, writer.token);
    check("1. nor one in review", (await send({ labIds: [A.labId] })).body.code === "NOT_APPROVED");
    check("1. the master goes through the repository's own route", (await decide(R, M, rSigner)).body.status === "approved");
    check("1. a lab that isn't the repository sends nothing", (await call("POST", `${A.P}/shared/masters/${M}/send`, { labIds: [B.labId] }, A.token)).body.code === "NOT_A_REPOSITORY");
    check("1. nor does it send the repository's document as its own", (await call("POST", `${A.P}/shared/masters/${M}/send`, { all: true }, A.token)).status === 409 && all("SELECT 1 FROM policy_shared_copies").length === 0);
    const targets = await call("GET", `${T}/targets`, undefined, writer.token);
    check("1. the sender sees the organization's laboratories, not the repository, not another organization's", targets.status === 200
      && JSON.stringify(targets.body.labs.map((l: any) => l.lab_id).sort((a: number, b: number) => a - b)) === JSON.stringify([A, B, C, Z].map((L) => L.labId).sort((a, b) => a - b)), JSON.stringify(targets.body.labs?.map((l: any) => l.lab_id)));
    check("1. and nobody's name or address", !/@|Signer|Owner/.test(JSON.stringify(targets.body)), targets.text.slice(0, 200));

    // ── 4. Who can't send ──
    const before4 = all("SELECT * FROM policy_shared_copies").length;
    check("4. a lab of another organization refuses the whole request, and nothing is sent", (await send({ labIds: [A.labId, X.labId] })).body.code === "LAB_NOT_IN_ORGANIZATION" && all("SELECT 1 FROM policy_shared_copies").length === before4 && !one("SELECT 1 FROM policy_documents WHERE lab_id = ? AND title = 'Specimen labeling'", A.labId));
    check("4. nor can a standalone lab, the repository itself, or an id that doesn't exist be chosen", (await Promise.all([S.labId, R.labId, 999999].map((id) => send({ labIds: [id] })))).every((r) => r.status === 400 && r.body.code === "LAB_NOT_IN_ORGANIZATION"));
    check("4. a view-only seat in the repository can't send", (await send({ labIds: [A.labId] }, rViewer.token)).status === 403);
    check("4. a member of a receiving lab only can't send from the repository", (await send({ labIds: [B.labId] }, A.token)).status === 403);
    check("4. another organization's owner can't", (await send({ labIds: [A.labId] }, X.token)).status === 403);
    check("4. a support login can't, though it reaches the lab", (await call("GET", `${R.P}/documents`, undefined, support.token)).status === 200 && (await send({ labIds: [A.labId] }, support.token)).body.code === "VLS_SUPPORT_CANNOT_SIGN");
    check("4. nobody signed out can", (await send({ labIds: [A.labId] }, "")).status === 401);
    check("4. nothing was made by any of it", all("SELECT 1 FROM policy_shared_copies").length === before4);

    // ── 2. Received as a draft ──
    const sent = await send({ labIds: [A.labId, B.labId] });
    check("2. an editor named in the repository sends it to two laboratories", sent.status === 200 && sent.body.sent === 2 && sent.body.results.every((r: any) => r.outcome === "sent"), sent.text.slice(0, 200));
    const aCopy = () => copyOf(M, A);
    const aDoc = aCopy().document_id as number;
    const bDoc = copyOf(M, B).document_id as number;
    const mv = row(M).approved_version_id;
    const aRow = row(aDoc);
    check("2. each has its own document, a draft, in its own matching manual, on its own route", aRow.lab_id === A.labId && aDoc !== bDoc && aRow.status === "draft" && aRow.approved_version_id == null && aRow.manual_id === chem(A) && aRow.workflow_id === aWf && row(bDoc).workflow_id === bWf, JSON.stringify(aRow));
    check("2. with the system's title, number, type and description, owned by that laboratory's owner", aRow.title === "Specimen labeling" && aRow.doc_number === "SYS 1" && aRow.doc_type === "procedure" && aRow.description === "Made-up description" && aRow.owner_user_id === A.userId);
    const aV = one("SELECT * FROM policy_versions WHERE id = ?", aRow.current_version_id);
    const mV = one("SELECT * FROM policy_versions WHERE id = ?", mv);
    check("2. its own stored file, the same fingerprint, the system's version number", aV.file_hash_sha256 === mV.file_hash_sha256 && aV.file_path !== mV.file_path && aV.file_path.startsWith(`${A.labId}/`) && aV.version_major === 1 && aV.version_minor === 0);
    const link = one("SELECT * FROM policy_shared_versions WHERE version_id = ?", aV.id);
    check("2. linked to the master: which document, which version, who sent it, when", aCopy().master_document_id === M && aCopy().organization_id === ORG && link.master_version_id === mv && link.received_by === writer.userId && aCopy().sent_by === writer.userId && !!aCopy().sent_at);
    check("2. no signature came with it, and nothing was submitted", all("SELECT 1 FROM policy_signoffs WHERE document_id IN (?, ?)", aDoc, bDoc).length === 0 && audits(aDoc, "workflow_assigned").length === 0);
    const got = audits(aDoc, "system_version_received")[0];
    check("2. the laboratory's trail says who, when, before and after", got?.lab_id === A.labId && got.user_id === writer.userId && JSON.parse(got.details).system_version === "1.0" && JSON.parse(got.details).after.status === "draft");
    check("2. the master's trail names the laboratories by id, no names", (() => { const d = audits(M, "system_document_sent")[0]; return d?.user_id === writer.userId && JSON.parse(d.details).lab_ids.length === 2 && !/Made-up/.test(d.details); })());
    const aList = (await call("GET", `${A.P}/documents`, undefined, A.token)).body.documents.find((d: any) => d.id === aDoc);
    check("2. the list says System document, which version and from where", aList.system_document?.state === "following" && aList.system_document.version_label === "1.0" && aList.system_document.organization_name === "Made-up Health System", JSON.stringify(aList.system_document));
    const recv = await received(A);
    check("2. and a notice that one is waiting", recv.waiting === 1 && recv.can_act === true && recv.items[0].open === true && recv.items[0].sent_by === "Wren Writer", JSON.stringify(recv).slice(0, 300));
    check("2. a lab with nothing received has an empty list", (await received(Z)).items.length === 0 && (await received(Z)).waiting === 0);
    const aSurveyor = (await call("POST", `${A.P}/surveyor-links`, { label: "Made-up visit" }, A.token)).body.token as string;
    const survey = async () => (await call("GET", `/api/surveyor/${aSurveyor}/policies`)).body.documents as any[];
    check("2. not in force: a Staff login, an inspector and a share link read nothing", (await call("GET", `${A.P}/documents/${aDoc}`, undefined, aStaff.token)).status === 404 && (await call("GET", `/api/staff-portal-session/policies/${aDoc}/render`, undefined, aStaff.token)).status === 404
      && !(await survey()).some((d) => d.id === aDoc) && (await call("POST", `${A.P}/documents/${aDoc}/share-links`, {}, A.token)).body.code === "NO_APPROVED_VERSION");
    check("2. the laboratory's editor reads the draft", (await call("GET", `${A.P}/documents/${aDoc}/render`, undefined, aEditor.token)).text.includes("MASTER-ONE"));

    // Same send again, and two at once.
    const again = await send({ labIds: [A.labId] });
    check("8. the same send twice changes nothing and says so", again.body.results[0].outcome === "already" && all("SELECT 1 FROM policy_documents WHERE lab_id = ? AND title = 'Specimen labeling'", A.labId).length === 1);
    const M2 = await doc(R, "Two at once", "TWICE made up", { doc_number: "SYS 2" }, writer.token);
    await approve(R, M2, rWf, rSigner);
    const pair = await Promise.all([send({ labIds: [A.labId, B.labId] }, writer.token, M2), send({ labIds: [B.labId, A.labId] }, orgAdmin.token, M2)]);
    const outcomes = pair.flatMap((p) => p.body.results.map((r: any) => r.outcome)).sort().join(",");
    check("8. two sends at once make one document per laboratory", outcomes === "already,already,sent,sent" && [A, B].every((L) => all("SELECT 1 FROM policy_documents WHERE lab_id = ? AND title = 'Two at once'", L.labId).length === 1), outcomes);

    // ── 4. Reaching a laboratory's copy ──
    const probes = [`${A.P}/documents/${aDoc}`, `${A.P}/documents/${aDoc}/render`, `${A.P}/documents/${aDoc}/download`, `${A.P}/documents/${aDoc}/print.pdf`, `${A.P}/shared/received`];
    const writerProbe = await Promise.all(probes.map((p) => call("GET", p, undefined, writer.token)));
    check("4. the sender, not a member of that laboratory, reads none of its copy", writerProbe.every((r) => r.status === 403), writerProbe.map((r) => r.status).join(","));
    check("4. nor by asking for it through the repository's own routes", (await Promise.all([`${R.P}/documents/${aDoc}`, `${R.P}/documents/${aDoc}/render`, `${R.P}/documents/${aDoc}/versions/${aV.id}/render`, `${R.P}/documents/${aDoc}/print.pdf`].map((p) => call("GET", p, undefined, writer.token)))).every((r) => r.status === 403 || r.status === 404));
    check("4. nor act on it", (await Promise.all(["decline", "own-copy", "take", "resume", "use-existing"].map((v) => act(A, aCopy().id, v, { reason: "made up" }, writer.token)))).every((r) => r.status === 403));
    check("4. another laboratory of the organization can't act on it by its number", (await Promise.all(["decline", "own-copy"].map((v) => act(B, aCopy().id, v, { reason: "made up" }, B.token)))).every((r) => r.status === 404));
    check("4. a view-only seat reads the list and acts on nothing", (await received(A, aViewer.token)).can_act === false && (await act(A, aCopy().id, "decline", { reason: "made up" }, aViewer.token)).status === 403);
    check("4. a Staff login gets 404 on all of it", (await call("GET", `${A.P}/shared/received`, undefined, aStaff.token)).status === 404 && (await act(A, aCopy().id, "decline", { reason: "made up" }, aStaff.token)).status === 404);
    const supportTries = await Promise.all([
      ...["decline", "resume", "own-copy", "use-existing", "take"].map((v) => act(A, aCopy().id, v, { reason: "made up", documentId: aDoc }, support.token)),
      call("PUT", `${A.P}/shared/received/${aCopy().id}/owner`, { userId: aEditor.userId }, support.token),
      call("POST", `${A.P}/documents/${aDoc}/addenda`, { title: "x", text: "made up" }, support.token),
      call("DELETE", `${A.P}/documents/${aDoc}/addenda/1`, undefined, support.token),
      call("POST", `${A.P}/documents/${aDoc}/approve`, { typedSignature: "Val Support", password: PW }, support.token),
    ]);
    check("4. a support login can't decline, follow, stop, link, take, choose an owner, add or remove an addendum, or approve", supportTries.every((r) => r.status === 403 && r.body.code === "VLS_SUPPORT_CANNOT_SIGN"), supportTries.map((r) => `${r.status} ${r.body.code}`).join(" | "));
    check("4. and sees it can't act", (await received(A, support.token)).can_act === false);
    check("4. after all of it, the laboratory's copy is untouched", row(aDoc).status === "draft" && aCopy().status === "following");

    // ── 3. The author rule, and approving locally ──
    check("3. nobody here wrote it, so the laboratory's document owner may sign it", await (async () => {
      const wf = await route(A, "Owner signs", A.userId, false);
      await submit(A, aDoc, wf, aEditor.token);
      const p = (await call("GET", `${A.P}/documents/${aDoc}/pending-step`, undefined, A.token)).body;
      return p.canCurrentUserApprove === true && (await call("GET", `${A.P}/pending-reviews`, undefined, A.token)).body.pending.some((d: any) => d.document_id === aDoc);
    })());
    // The person who wrote it is also a member of A: still its author there.
    run("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 0, ?, ?, ?)", A.labId, writer.userId, now, now, now);
    run("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'active', ?, '{\"mode\":\"edit_all\"}')", A.userId, writer.email, writer.userId, now, now, A.labId);
    run("UPDATE policy_approval_steps SET specific_user_id = ? WHERE workflow_id = ?", writer.userId, row(aDoc).workflow_id);
    const own = await decide(A, aDoc, writer);
    check("3. the person who wrote the version can't approve it in the laboratory", own.status === 403 && /Self-approval/.test(own.body.error || ""), `${own.status} ${own.text.slice(0, 120)}`);
    run("DELETE FROM lab_members WHERE lab_id = ? AND user_id = ?", A.labId, writer.userId);
    run("DELETE FROM user_seats WHERE lab_id = ? AND seat_user_id = ?", A.labId, writer.userId);
    run("UPDATE policy_approval_steps SET specific_user_id = ? WHERE workflow_id = ?", A.userId, row(aDoc).workflow_id);
    check("2. it takes effect when the laboratory approves it by its own route", (await decide(A, aDoc, { token: A.token, name: A.owner })).body.status === "approved" && row(aDoc).approved_version_id === aV.id && !!row(aDoc).next_review_date);
    check("2. its signature is its own signer's, on its own document only", all("SELECT user_id FROM policy_signoffs WHERE document_id = ?", aDoc).every((s) => s.user_id === A.userId) && all("SELECT 1 FROM policy_signoffs WHERE document_id = ?", bDoc).length === 0);
    check("2. now a Staff login and an inspector read it, and the other laboratory still doesn't have it in force", (await call("GET", `/api/staff-portal-session/policies/${aDoc}/render`, undefined, aStaff.token)).text.includes("MASTER-ONE") && (await survey()).some((d) => d.id === aDoc) && row(bDoc).status === "draft");
    check("2. search and the exports' rows treat it as any document", (await call("GET", `${A.P}/search?q=Specimen`, undefined, A.token)).body.results.some((r: any) => r.id === aDoc) && (await received(A)).items.find((i: any) => i.document_id === aDoc).in_force_label === "1.0");

    // ── 5. A new master version ──
    const on = await call("PUT", `${A.P}/settings/email-notices`, { approvalEmails: true }, A.token);
    check("5. setup: laboratory A turned approval notices on, B did not", on.status === 200);
    run("UPDATE policy_documents SET workflow_id = ? WHERE id = ?", aWf, aDoc);
    await taken();
    await newVersion(R, M, "MASTER-TWO made up", { change_summary: "Two identifiers on every tube" }, writer.token);
    check("5. a revision in progress on the master changes nothing anywhere", row(aDoc).status === "approved" && copyOf(M, B).waiting_master_version_id == null);
    check("5. and what would be sent is still the approved version", (await call("GET", `${T}/targets`, undefined, writer.token)).body.document.approved_label === "1.0");
    await approve(R, M, rWf, rSigner);
    const a2 = row(aDoc);
    const a2v = one("SELECT * FROM policy_versions WHERE id = ?", a2.current_version_id);
    check("5. the following laboratory gets a draft revision with the change summary", a2.status === "draft" && a2v.id !== aV.id && a2v.change_summary === "System version 1.1: Two identifiers on every tube" && a2v.version_minor === 1, JSON.stringify(a2v));
    check("5. its approved version stays the recorded one, and staff and the inspector keep reading it", a2.approved_version_id === aV.id && (await call("GET", `/api/staff-portal-session/policies/${aDoc}/render`, undefined, aStaff.token)).text.includes("MASTER-ONE") && (await call("GET", `/api/surveyor/${aSurveyor}/policies/${aDoc}/render`)).text.includes("MASTER-ONE"));
    check("5. nothing was approved, submitted or signed for it", all("SELECT 1 FROM policy_signoffs WHERE version_id = ?", a2v.id).length === 0 && audits(aDoc, "workflow_assigned").length === 1 && audits(aDoc, "system_version_received")[1].user_id === -1);
    const notices = await taken();
    check("5. the approver of the laboratory that turned notices on is told once; the other laboratory's is not", notices.length === 1 && notices[0].to === aSigner.email && /System document received/.test(notices[0].subject) && /draft/.test(notices[0].html) && !notices[0].html.includes(EM_DASH), JSON.stringify(notices.map((m) => [m.to, m.subject])));
    const bCopy = copyOf(M, B);
    check("5. a laboratory whose first draft is still open keeps it; the new version waits and says so", row(bDoc).current_version_id === one("SELECT version_id FROM policy_shared_versions WHERE copy_id = ?", bCopy.id).version_id && bCopy.waiting_master_label === "1.1" && !!bCopy.waiting_since && (await received(B)).items.find((i: any) => i.document_id === bDoc).waiting_label === "1.1", JSON.stringify(bCopy));
    await submit(B, bDoc, bWf);
    const inReview = row(bDoc).current_version_id;
    check("5. while it's in review the waiting version can't be taken", (await act(B, bCopy.id, "take")).body.code === "IN_REVIEW" && row(bDoc).current_version_id === inReview);
    check("5. nor is it disturbed by the system sending again", (await send({ labIds: [B.labId] })).body.results[0].outcome === "waiting" && row(bDoc).current_version_id === inReview && row(bDoc).status === "in_review");
    const bApproved = await decide(B, bDoc, bSigner);
    check("5. once it approves the open one, the waiting version comes in as a draft over it", bApproved.body.status === "approved" && row(bDoc).status === "draft" && row(bDoc).approved_version_id === inReview && copyOf(M, B).waiting_master_version_id == null && one("SELECT change_summary FROM policy_versions WHERE id = ?", row(bDoc).current_version_id).change_summary.startsWith("System version 1.1"));
    check("5. and nobody there is emailed, because that laboratory left the notice off", (await taken()).filter((m) => m.to === bSigner.email || m.to === B.email).length === 0);
    await newVersion(R, M, "MASTER-THREE made up", { change_summary: "New tube colors", is_major_revision: "1" }, writer.token);
    await approve(R, M, rWf, rSigner);
    check("5. a third version while 1.1 is still a draft there waits", copyOf(M, A).waiting_master_label === "2.0" && row(aDoc).current_version_id === a2v.id);
    const took = await act(A, aCopy().id, "take", {}, aEditor.token);
    const a3v = one("SELECT * FROM policy_versions WHERE id = ?", row(aDoc).current_version_id);
    check("5. the laboratory may take it in place of the draft nobody there wrote", took.status === 200 && a3v.version_major === 2 && a3v.is_major_revision === 1 && row(aDoc).approved_version_id === aV.id && !!one("SELECT 1 FROM policy_versions WHERE id = ?", a2v.id) && copyOf(M, A).waiting_master_version_id == null, took.text.slice(0, 200));
    check("5. nothing is waiting after that", (await act(A, aCopy().id, "take")).body.code === "NOTHING_WAITING");
    run("UPDATE policy_versions SET is_major_revision = 0 WHERE id = ?", a3v.id); // made-up lab has no designated director
    check("5. it approves 2.0 and the list says so", (await approve(A, aDoc, aWf, aSigner)) === "approved" && (await call("GET", `${A.P}/documents`, undefined, A.token)).body.documents.find((d: any) => d.id === aDoc).system_document.version_label === "2.0");

    // ── 7. The master's file, and addenda ──
    const up = await newVersion(A, aDoc, "OUR OWN made up");
    check("7. the laboratory can't replace the file of a document it follows", up.status === 409 && up.body.code === "SYSTEM_DOCUMENT" && row(aDoc).status === "approved" && row(aDoc).current_version_id === a3v.id, JSON.stringify(up.body));
    const ad = await call("POST", `${A.P}/documents/${aDoc}/addenda`, { title: "North site addendum", text: "ADDENDUM-ONE made up: use the blue rack." }, aEditor.token);
    const adId = Number(ad.body.id);
    check("7. it adds an addendum as typed text: its own document, a draft in the same manual", ad.status === 201 && row(adId).lab_id === A.labId && row(adId).status === "draft" && row(adId).manual_id === chem(A) && row(adId).workflow_id === aWf && row(adId).owner_user_id === aEditor.userId);
    check("7. the master's file and the laboratory's copy are unchanged", one("SELECT file_hash_sha256 AS h FROM policy_versions WHERE id = ?", row(aDoc).current_version_id).h === one("SELECT file_hash_sha256 AS h FROM policy_versions WHERE id = ?", row(M).current_version_id).h);
    const detail = async (token: string, id = aDoc) => (await call("GET", `${A.P}/documents/${id}`, undefined, token)).body;
    check("7. the document's own view lists it in order; staff and an inspector don't see it until it is approved", (await detail(A.token)).addenda?.length === 1 && (await detail(A.token)).addenda[0].in_force === false && (await detail(aStaff.token)).addenda === undefined
      && (await call("GET", `/api/staff-portal-session/policies/${aDoc}`, undefined, aStaff.token)).body.addenda === undefined && !(await survey()).find((d) => d.id === aDoc).addenda);
    check("7. the list marks the addendum as one", (await call("GET", `${A.P}/documents`, undefined, A.token)).body.documents.find((d: any) => d.id === adId).addendum_to?.document_id === aDoc);
    check("7. it has its own approval: its author can't sign it, the route's signer can", await (async () => {
      const wf = await route(A, "Editor signs", aEditor.userId, false);
      await submit(A, adId, wf, aEditor.token);
      const refusedSelf = await decide(A, adId, aEditor);
      run("UPDATE policy_approval_steps SET specific_user_id = ? WHERE workflow_id = ?", aSigner.userId, wf);
      return refusedSelf.status === 403 && (await decide(A, adId, aSigner)).body.status === "approved";
    })());
    check("7. now staff and an inspector read it with the document", (await detail(aStaff.token)).addenda?.[0]?.document_id === adId && (await call("GET", `/api/staff-portal-session/policies/${aDoc}`, undefined, aStaff.token)).body.addenda?.[0]?.title === "North site addendum"
      && (await call("GET", `/api/staff-portal-session/policies/${adId}/render`, undefined, aStaff.token)).text.includes("ADDENDUM-ONE") && (await survey()).find((d) => d.id === aDoc).addenda?.[0]?.document_id === adId);
    check("7. its own versions: a new one is a draft and the approved one stays in the view", (await newVersion(A, adId, "ADDENDUM-TWO made up", {}, aEditor.token)).status === 201 && (await detail(A.token)).addenda[0].in_force === false && (await detail(aStaff.token)).addenda[0].version_label === "1.0" && (await call("GET", `/api/staff-portal-session/policies/${adId}/render`, undefined, aStaff.token)).text.includes("ADDENDUM-ONE"));
    const aShare = (await call("POST", `${A.P}/documents/${aDoc}/share-links`, { label: "Made-up nursing" }, A.token)).body.token as string;
    const shareMeta = (await call("GET", `/api/public/policy-share/${aShare}`)).body;
    check("7. a share link of the document carries its approved addendum, by place and not by id", shareMeta.addenda?.length === 1 && keysOf(shareMeta.addenda[0]) === "title,version" && (await call("GET", `/api/public/policy-share/${aShare}/file?addendum=1`)).text.includes("ADDENDUM-ONE"));
    check("7. and no other document by any number", (await Promise.all(["0", "2", "-1", "x", String(adId), "1.5"].map((n) => call("GET", `/api/public/policy-share/${aShare}/file?addendum=${n}`)))).every((r) => r.status === 404));
    const pdf = await call("GET", `${A.P}/documents/${aDoc}/print.pdf`, undefined, A.token);
    check("7. one print order: one PDF of a first page, the document, then the addendum", pdf.status === 200 && pdf.buf.subarray(0, 5).toString() === "%PDF-" && pdf.headers.get("content-type") === "application/pdf", `${pdf.status} ${pdf.text.slice(0, 120)}`);
    const { PDFDocument } = await import("pdf-lib");
    check("7. it has the three pages", (await PDFDocument.load(pdf.buf)).getPageCount() === 3 && (await PDFDocument.load(pdf.buf)).getAuthor() === "Perplexity Computer");
    const staffPdf = await call("GET", `${A.P}/documents/${aDoc}/print.pdf`, undefined, aStaff.token);
    check("7. a Staff login prints the approved versions", staffPdf.status === 200 && (await PDFDocument.load(staffPdf.buf)).getPageCount() === 3);
    // A PDF's own pages go in, a web page prints with nothing fetched and no script run, and an old Excel file is refused by name.
    const twoPages = await PDFDocument.create();
    twoPages.addPage([612, 792]); twoPages.addPage([612, 792]);
    const pdfAd = await file(`${A.P}/documents/${aDoc}/addenda`, { title: "Drawn map" }, Buffer.from(await twoPages.save()).toString("latin1"), aEditor.token);
    const raw = new FormData();
    raw.append("file", new Blob([Buffer.from(await twoPages.save())], { type: "application/pdf" }), "map.pdf");
    raw.append("title", "Drawn map");
    const pdfAdded = await fetch(`${base}${A.P}/documents/${aDoc}/addenda`, { method: "POST", headers: { Authorization: `Bearer ${aEditor.token}` }, body: raw });
    const pdfAdId = Number(((await pdfAdded.json()) as any).id);
    if (pdfAd.body.id) await call("DELETE", `${A.P}/documents/${aDoc}/addenda/${pdfAd.body.id}`, undefined, aEditor.token);
    let hits = 0;
    const listener = http.createServer((_q, s) => { hits++; s.end("x"); });
    await new Promise<void>((r) => listener.listen(0, r));
    const port = (listener.address() as any).port;
    const htmlAd = await file(`${A.P}/documents/${aDoc}/addenda`, { title: "Web page" }, `<html><body><h1>WEB made up</h1><img src="http://127.0.0.1:${port}/a.png"><iframe src="http://127.0.0.1:${port}/b"></iframe><link rel="stylesheet" href="http://127.0.0.1:${port}/c.css"><script>fetch("http://127.0.0.1:${port}/d")</script></body></html>`, aEditor.token, "page.html", "text/html");
    const combined = await call("GET", `${A.P}/documents/${aDoc}/print.pdf`, undefined, A.token);
    check("7. a PDF addendum's own pages and a web page's go in, in order", combined.status === 200 && (await PDFDocument.load(combined.buf)).getPageCount() === 6, `${combined.status} ${combined.status === 200 ? (await PDFDocument.load(combined.buf)).getPageCount() : combined.text.slice(0, 160)}`);
    check("7. printing a web page fetches nothing from anywhere and runs no script", hits === 0, String(hits));
    listener.close();
    const oldXls = new FormData();
    oldXls.append("file", new Blob([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 1, 2, 3])], { type: "application/vnd.ms-excel" }), "old.xls");
    oldXls.append("title", "Old sheet");
    const xlsId = Number(((await (await fetch(`${base}${A.P}/documents/${aDoc}/addenda`, { method: "POST", headers: { Authorization: `Bearer ${aEditor.token}` }, body: oldXls })).json()) as any).id);
    const cannot = await call("GET", `${A.P}/documents/${aDoc}/print.pdf`, undefined, A.token);
    check("7. an older Excel file can't go into one print copy, and the answer names it", cannot.status === 409 && cannot.body.code === "CANNOT_COMBINE" && /Old sheet/.test(cannot.body.error), cannot.text.slice(0, 160));
    for (const x of [pdfAdId, Number(htmlAd.body.id), xlsId]) await call("DELETE", `${A.P}/documents/${aDoc}/addenda/${x}`, undefined, aEditor.token);
    run("DELETE FROM policy_audit_log WHERE document_id = ? AND action = 'printed' AND id = (SELECT MAX(id) FROM policy_audit_log WHERE document_id = ? AND action = 'printed')", aDoc, aDoc);
    check("7. printing is on the trail", audits(aDoc, "printed").length === 2);
    check("7. a document that didn't come from the system takes no addendum", (await call("POST", `${Z.P}/documents/${zDoc}/addenda`, { text: "made up" }, Z.token)).body.code === "NOT_A_SYSTEM_DOCUMENT");
    check("7. another laboratory can't add one here, or take it off", (await call("POST", `${A.P}/documents/${aDoc}/addenda`, { text: "made up" }, B.token)).status === 403 && (await call("POST", `${B.P}/documents/${aDoc}/addenda`, { text: "made up" }, B.token)).status === 404 && (await call("DELETE", `${B.P}/documents/${aDoc}/addenda/${adId}`, undefined, B.token)).status === 404);
    const phiAd = await call("POST", `${A.P}/documents/${aDoc}/addenda`, { title: "Second", text: "MRN: 00123456 DOB 01/02/1950" }, aEditor.token);
    check("7. text that looks like patient information is warned about, as any upload is", phiAd.status === 201 && /patient information/.test(phiAd.body.phiWarning || ""), JSON.stringify(phiAd.body));
    check("7. taking an addendum off keeps it as the laboratory's own document", (await call("DELETE", `${A.P}/documents/${aDoc}/addenda/${phiAd.body.id}`, undefined, aEditor.token)).status === 200 && !!row(phiAd.body.id) && (await detail(A.token)).addenda.length === 1);

    // ── 6. A laboratory's own document; declining; stopping and following again ──
    const own1 = await doc(B, "Our labeling procedure", "B-OWN made up", { doc_number: "B 12" });
    await approve(B, own1, bWf, bSigner);
    const ownVersion = row(own1).approved_version_id;
    const b2 = copyOf(M2, B);
    const placeholder = b2.document_id as number;
    const openOwn = await doc(B, "Half-written", "B-DRAFT made up");
    check("6. a document with an open draft can't be used: nobody's work is replaced", (await act(B, b2.id, "use-existing", { documentId: openOwn })).body.code === "REVISION_OPEN");
    check("6. nor another laboratory's, nor one that already came from the system", (await act(B, b2.id, "use-existing", { documentId: zDoc })).body.code === "DOCUMENT_NOT_FOUND" && (await act(B, b2.id, "use-existing", { documentId: bDoc })).body.code !== undefined);
    const bAd = Number((await call("POST", `${B.P}/documents/${placeholder}/addenda`, { title: "South addendum", text: "SOUTH made up" }, B.token)).body.id);
    check("6. nor a site addendum", await (async () => { await approve(B, bAd, bWf, bSigner); return (await act(B, b2.id, "use-existing", { documentId: bAd })).body.code === "IS_ADDENDUM"; })());
    const used = await act(B, b2.id, "use-existing", { documentId: own1 });
    check("6. an addendum written on the received draft goes with its own document", (await call("GET", `${B.P}/documents/${own1}`, undefined, B.token)).body.addenda?.[0]?.document_id === bAd);
    await call("DELETE", `${B.P}/documents/${own1}/addenda/${bAd}`, undefined, B.token);
    check("6. its own document takes the received version as a draft revision", used.status === 200 && copyOf(M2, B).document_id === own1 && row(own1).status === "draft" && row(own1).approved_version_id === ownVersion && row(own1).doc_number === "B 12", used.text.slice(0, 200));
    check("6. its own approved version stays in force, and the received draft is archived with its history", (await call("GET", `/api/staff-portal-session/policies/${own1}/render`, undefined, bStaff.token)).text.includes("B-OWN made up") && !!row(placeholder).archived_at && audits(placeholder, "archived").length === 1 && audits(own1, "system_document_linked").length === 1);
    check("6. the version list keeps the laboratory's own numbering", one("SELECT version_major AS a, version_minor AS b FROM policy_versions WHERE id = ?", row(own1).current_version_id).b === 1);
    check("6. the draft can be declined with a reason: the laboratory's own version stands again, and it keeps following", await (async () => {
      const bad = await act(B, b2.id, "decline", { reason: " " });
      const phi = await act(B, b2.id, "decline", { reason: "Patient MRN 00123456 says no" });
      const ok = await act(B, b2.id, "decline", { reason: "Our tubes differ; see the site note." });
      return bad.body.code === "REASON_REQUIRED" && phi.body.code === "PHI_REFUSED" && ok.status === 200 && row(own1).status === "approved" && row(own1).current_version_id === ownVersion && copyOf(M2, B).status === "following" && copyOf(M2, B).declined_reason === "Our tubes differ; see the site note." && audits(own1, "system_version_declined").length === 1;
    })(), JSON.stringify(copyOf(M2, B)));
    check("6. there's nothing left to decline", (await act(B, b2.id, "decline", { reason: "again please" })).body.code === "NOTHING_TO_DECLINE");
    const a2copy = copyOf(M2, A);
    const a2doc = a2copy.document_id as number;
    const dec = await act(A, a2copy.id, "decline", { reason: "Not performed at this site." }, aEditor.token);
    check("6. a document never approved here is declined whole: archived, with the reason, who and when", dec.status === 200 && !!row(a2doc).archived_at && copyOf(M2, A).status === "declined" && copyOf(M2, A).declined_by === aEditor.userId && audits(a2doc, "system_document_declined")[0]?.user_id === aEditor.userId);
    check("6. the system sending again is told it declined", (await send({ labIds: [A.labId] }, writer.token, M2)).body.results[0].outcome === "refused");
    await newVersion(R, M2, "TWICE-TWO made up", { change_summary: "Second" }, writer.token);
    await approve(R, M2, rWf, rSigner);
    check("6. a newer version isn't sent to a laboratory that declined, and is to the one that follows", copyOf(M2, A).waiting_master_version_id == null && !!row(a2doc).archived_at && row(own1).status === "draft" && copyOf(M2, B).declined_reason == null);
    const back = await act(A, a2copy.id, "resume", {}, aEditor.token);
    check("6. it can take it up after all, at the system's version now, still a draft", back.status === 200 && row(a2doc).archived_at == null && row(a2doc).status === "draft" && copyOf(M2, A).status === "following" && back.body.copy.version_label === "1.1", JSON.stringify(back.body).slice(0, 300));
    const ownCopy = await act(B, b2.id, "own-copy", {});
    check("6. make it our own copy: stops following and keeps its history", ownCopy.status === 200 && copyOf(M2, B).status === "own_copy" && copyOf(M2, B).detached_by === B.userId && all("SELECT 1 FROM policy_versions WHERE document_id = ?", own1).length === 3);
    check("6. the file is the laboratory's to change then", (await newVersion(B, own1, "B-OWN-AGAIN made up")).status === 201);
    const ownDraft = row(own1).current_version_id;
    await newVersion(R, M2, "TWICE-THREE made up", {}, writer.token);
    await approve(R, M2, rWf, rSigner);
    check("6. and new system versions don't arrive", row(own1).current_version_id === ownDraft && copyOf(M2, B).waiting_master_version_id == null);
    await act(A, a2copy.id, "decline", { reason: "Changed our mind." }, aEditor.token);
    await call("POST", `${A.P}/documents/${a2doc}/restore`, {}, A.token);
    const aOwnDraft = (await newVersion(A, a2doc, "A-OWN-WORK made up")).body.version_id;
    check("6. a declined document the laboratory restored and worked on is never overwritten by following again", (await act(A, a2copy.id, "resume", {}, aEditor.token)).status === 200 && row(a2doc).current_version_id === aOwnDraft && copyOf(M2, A).status === "following" && copyOf(M2, A).waiting_master_label === "1.2");
    const refollow = await act(B, b2.id, "resume");
    check("6. following again never overwrites its open draft: the version waits", refollow.status === 200 && row(own1).current_version_id === ownDraft && copyOf(M2, B).waiting_master_label === "1.2");
    check("6. and can't be taken over the laboratory's own draft", (await act(B, b2.id, "take")).body.code === "REVISION_OPEN" && row(own1).current_version_id === ownDraft);
    const owners = (await call("GET", `${A.P}/shared/received/${a2copy.id}/owners`, undefined, A.token)).body.people;
    check("6. the laboratory chooses who owns it here, among its own editors", owners.some((p: any) => p.user_id === aEditor.userId) && !owners.some((p: any) => p.user_id === aViewer.userId || p.user_id === aStaff.userId || p.user_id === writer.userId)
      && (await call("PUT", `${A.P}/shared/received/${a2copy.id}/owner`, { userId: aEditor.userId }, A.token)).status === 200 && row(a2doc).owner_user_id === aEditor.userId && (await call("PUT", `${A.P}/shared/received/${a2copy.id}/owner`, { userId: writer.userId }, A.token)).body.code === "NOT_AN_EDITOR" && audits(a2doc, "document_owner_changed").length === 1);

    // ── 8. A lab with no route; a plan without VeritaDC; closed; read-only; a group ──
    const toC = await send({ labIds: [C.labId] });
    const cDoc = copyOf(M, C).document_id as number;
    check("8. a lab with no approval route gets its draft, on no route, and nothing is in force", toC.body.results[0].outcome === "sent" && row(cDoc).status === "draft" && row(cDoc).workflow_id == null && row(cDoc).approved_version_id == null, toC.text.slice(0, 200));
    check("8. it can't be approved until that lab sets a route and submits it", (await decide(C, cDoc, { token: C.token, name: C.owner })).status === 409);
    const cWf = await route(C, "Coast approval", cSigner.userId);
    check("8. then it can", (await approve(C, cDoc, cWf, cSigner)) === "approved");
    const M3 = await doc(R, "Third system procedure", "THIRD made up", {}, writer.token);
    await approve(R, M3, rWf, rSigner);
    run("UPDATE labs SET plan = 'free' WHERE id = ?", Z.labId);
    run("UPDATE organizations SET plan = NULL WHERE id = ?", ORG);
    const noPlan = await send({ labIds: [Z.labId] }, writer.token, M3);
    check("8. a plan without VeritaDC is refused, with the reason, and nothing is made there", noPlan.body.results[0].outcome === "refused" && /plan doesn't include VeritaDC/.test(noPlan.body.results[0].message) && !copyOf(M3, Z));
    run("UPDATE labs SET plan = 'hospital' WHERE id = ?", Z.labId);
    run("UPDATE organizations SET plan = 'hospital' WHERE id = ?", ORG);
    run("UPDATE labs SET subscription_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", Z.labId);
    check("8. nor is a lab whose subscription ended", /read-only/.test((await send({ labIds: [Z.labId] }, writer.token, M3)).body.results[0].message) && !copyOf(M3, Z));
    run("UPDATE labs SET subscription_expires_at = NULL, retired_at = ? WHERE id = ?", now, Z.labId);
    check("8. nor a closed lab, and the others still get it", await (async () => {
      const r = await send({ labIds: [Z.labId, C.labId] }, writer.token, M3);
      return r.body.sent === 1 && r.body.results.find((x: any) => x.lab_id === Z.labId).outcome === "refused" && !!copyOf(M3, C);
    })());
    run("UPDATE labs SET retired_at = NULL WHERE id = ?", Z.labId);
    const north = await call("POST", "/api/rollup-groups", { name: "North region", kind: "region", organizationId: ORG, labIds: [A.labId, B.labId] }, orgAdmin.token);
    const groupSend = await send({ groupId: north.body.id }, orgAdmin.token, M3);
    check("8. a roll-up group sends to its laboratories and no other", groupSend.body.sent === 2 && JSON.stringify(groupSend.body.results.map((r: any) => r.lab_id).sort()) === JSON.stringify([A.labId, B.labId].sort()), groupSend.text.slice(0, 200));
    check("8. a group that isn't the sender's is not found", (await send({ groupId: north.body.id }, writer.token, M3)).body.code === "GROUP_NOT_FOUND");
    run("UPDATE policy_versions SET file_hash_sha256 = 'made-up' WHERE id = ?", row(M3).approved_version_id);
    check("8. a file that no longer matches its fingerprint is sent to nobody", (await send({ labIds: [Z.labId] }, writer.token, M3)).body.code === "FILE_CHANGED" && !copyOf(M3, Z));

    // ── 9. The organization's view ──
    const anna = roster(A, "Anna", "Reader"), ben = roster(A, "Ben", "Reader");
    await call("POST", `${A.P}/read-sign`, { scope: "document", id: aDoc, employee_ids: [anna, ben, aStaff.emp] }, A.token);
    run("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, signed_document_hash, typed_signature) VALUES (?, ?, ?, ?, 'x', 'Anna Reader')", A.labId, aDoc, row(aDoc).current_version_id, anna);
    const view = async (token: string) => call("GET", "/api/system-documents", undefined, token);
    const v = await view(orgAdmin.token);
    const md = v.body.documents?.find((d: any) => d.master_document_id === M);
    const la = md?.labs.find((l: any) => l.lab_id === A.labId);
    check("9. the organization's admin sees each shared document, its version and each laboratory", v.status === 200 && md?.version_label === "2.0" && md.labs.map((l: any) => l.lab_id).sort().join() === [A.labId, B.labId, C.labId].sort().join(), JSON.stringify(md)?.slice(0, 400));
    check("9. a laboratory on the system's version reads as approved, with its review date", la?.state === "current" && la.approved_label === "2.0" && !!la.next_review_date && la.addenda === 1, JSON.stringify(la));
    const lb = md?.labs.find((l: any) => l.lab_id === B.labId);
    check("9. one with a draft waiting says which version it has approved, which waits, and since when", lb?.state === "waiting" && lb.approved_label === "1.0" && lb.open_label === "1.1" && !!lb.waiting_since && lb.queued_label === "2.0", JSON.stringify(lb));
    const tracker = readSignTracker(sqlite, A.labId, { type: "document", id: aDoc });
    check("9. read-and-sign is counts only, the same as the laboratory's own tracker", la.signed === 1 && la.owed === 2 && tracker.totals.signed === 1 && tracker.totals.owes === 2, JSON.stringify([la.signed, la.owed, tracker.totals]));
    check("9. no person is named anywhere in it", !/Signer|Reader|Quillby|Writer|Editor|Owner|@/.test(v.text), (v.text.match(/.{20}(Signer|Reader|Quillby|Writer|Editor|Owner|@).{20}/) || [])[0]);
    const m2b = v.body.documents.find((d: any) => d.master_document_id === M2)?.labs.find((l: any) => l.lab_id === B.labId);
    check("9. a laboratory on its own version says so, and what is in line behind its draft", m2b?.state === "behind" && m2b.approved_own === true && m2b.approved_label === null && m2b.queued_label === "1.2", JSON.stringify(m2b));
    check("9. a declined document shows with its reason", await (async () => {
      const c3 = copyOf(M3, C);
      await act(C, c3.id, "decline", { reason: "Not performed at the coast." });
      const l = (await view(orgAdmin.token)).body.documents.find((d: any) => d.master_document_id === M3).labs.find((x: any) => x.lab_id === C.labId);
      return l.state === "declined" && l.declined_reason === "Not performed at the coast." && l.declined_label === "1.0";
    })());
    const av = await view(A.token);
    check("9. a laboratory's owner sees only its own laboratory", av.status === 200 && av.body.documents.length > 0 && av.body.documents.every((d: any) => d.labs.every((l: any) => l.lab_id === A.labId)) && !av.text.includes("South"), av.text.slice(0, 200));
    check("9. the repository's editor, who belongs to no laboratory, sees none", (await view(writer.token)).body.documents?.length === 0);
    check("9. a Staff login sees none", (await view(aStaff.token)).body.documents?.length === 0);
    check("9. another organization's owner, and a support login, see none of it", (await view(X.token)).body.documents?.length === 0 && !((await view(support.token)).body.documents?.length));
    check("9. a free account is told it needs a subscription", await (async () => { const f = await register("free", "Fay Free"); return (await view(f.token)).body.code === "PLAN_REQUIRED"; })());
    check("9. the repository is named only to someone who can work in it", v.body.repositories.some((r: any) => r.lab_id === R.labId) && av.body.repositories.length === 0 && (await view(writer.token)).body.repositories.length === 0);
    const { default: ExcelJS } = await import("exceljs");
    const sheet = async (q: string, token = orgAdmin.token) => {
      const r = await call("GET", `/api/system-documents/export.xlsx${q}`, undefined, token);
      if (r.status !== 200) return { status: r.status, rows: [] as any[][], names: [] as string[], body: r.body };
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.buf as any);
      const ws = wb.getWorksheet("System documents")!;
      const rows: any[][] = [];
      ws.eachRow((rw) => rows.push((rw.values as any[]).slice(1)));
      return { status: 200, rows, names: wb.worksheets.map((w) => w.name), body: {} as any };
    };
    const full = await sheet("");
    const text = JSON.stringify(full.rows);
    check("9. the Excel file opens on About, then one row per document and laboratory", full.names[0] === "About" && full.names[1] === "System documents" && text.includes("Made-up North Laboratory") && text.includes("Made-up South Laboratory") && text.includes("Made-up Coast Laboratory"), full.names.join(","));
    check("9. no person, no em dash in it", !/Signer|Reader|Quillby|Writer/.test(text) && !text.includes(EM_DASH));
    const grouped = JSON.stringify((await sheet(`?group=${north.body.id}`)).rows);
    check("9. the group filter cuts it", grouped.includes("North Laboratory") && !grouped.includes("Coast Laboratory") && JSON.stringify((await sheet("?group=none")).rows).includes("Coast Laboratory"));
    check("9. a group that isn't the reader's is not found", (await sheet(`?group=${north.body.id}`, A.token)).status === 404);
    const masters = (await call("GET", `${R.P}/shared/masters`, undefined, writer.token)).body;
    check("9. in the repository, each master says how far it got, in counts", masters.repository === true && masters.documents[M].sent === 3 && masters.documents[M].approved === 2, JSON.stringify(masters.documents?.[M]));
    check("9. any other lab is told it isn't a repository", (await call("GET", `${A.P}/shared/masters`, undefined, A.token)).body.repository === false);

    // ── 8. Retiring, leaving, deleting ──
    check("8. a master that was sent can't be deleted, only retired", (await call("DELETE", `${R.P}/documents/${M}`, undefined, writer.token)).body.code === "SYSTEM_DOCUMENT_SENT");
    await call("POST", `${R.P}/documents/${M}/archive`, {}, writer.token);
    const retired = (await received(A)).items.find((i: any) => i.document_id === aDoc);
    check("8. retiring the master tells each laboratory and leaves its approved copy in use", retired.state === "retired" && row(aDoc).status === "approved" && audits(aDoc, "system_document_retired").length === 1 && (await call("GET", `/api/staff-portal-session/policies/${aDoc}/render`, undefined, aStaff.token)).status === 200 && (await received(A)).waiting >= 1);
    check("8. an archived master can't be sent", (await send({ labIds: [Z.labId] })).body.code === "ARCHIVED");
    await call("POST", `${R.P}/documents/${M}/restore`, {}, writer.token);
    check("8. restoring it says so there too", (await received(A)).items.find((i: any) => i.document_id === aDoc).state === "following" && audits(aDoc, "system_document_back_in_use").length === 1);
    run("UPDATE labs SET organization_id = NULL WHERE id = ?", A.labId);
    check("8. a laboratory that leaves keeps its copies and their approval", row(aDoc).status === "approved" && (await received(A)).items.find((i: any) => i.document_id === aDoc).state === "left" && (await detail(A.token)).addenda.length === 1);
    const aAt = row(aDoc).current_version_id;
    const fourth = await newVersion(R, M, "MASTER-FOUR made up", {}, writer.token);
    await approve(R, M, rWf, rSigner);
    check("8. it gets no new ones, and the others do", fourth.status === 201 && row(aDoc).current_version_id === aAt && copyOf(M, A).waiting_master_version_id == null && row(cDoc).status === "draft");
    check("8. the system can't send to it or see it any more", (await send({ labIds: [A.labId] })).body.code === "LAB_NOT_IN_ORGANIZATION" && !(await view(orgAdmin.token)).text.includes("North Laboratory"));
    check("8. its file is its own to change", (await newVersion(A, aDoc, "LEFT made up")).status === 201);
    run("UPDATE labs SET organization_id = ? WHERE id = ?", ORG, A.labId);
    const b3 = copyOf(M3, B);
    await call("DELETE", `${B.P}/documents/${b3.document_id}`, undefined, B.token);
    check("8. a laboratory deleting its draft leaves the system a row that says so, and no dangling link", copyOf(M3, B).document_id == null && all("SELECT 1 FROM policy_shared_versions WHERE copy_id = ?", b3.id).length === 0 && (await view(orgAdmin.token)).body.documents.find((d: any) => d.master_document_id === M3).labs.find((l: any) => l.lab_id === B.labId).state === "removed");

    // ── 8. The purge ──
    const plan = planCustomerPurge(sqlite, { organizationId: ORG }) as any;
    check("8. purging the organization takes every shared row with it", plan.plan?.rowsByTable?.policy_shared_copies === all("SELECT 1 FROM policy_shared_copies").length && plan.plan.rowsByTable.policy_addenda === all("SELECT 1 FROM policy_addenda").length && plan.plan.rowsByTable.policy_shared_versions === all("SELECT 1 FROM policy_shared_versions").length, JSON.stringify(plan.plan?.rowsByTable ?? plan).slice(0, 300));
    run("UPDATE labs SET organization_id = NULL WHERE id = ?", A.labId);
    const left = planCustomerPurge(sqlite, { organizationId: ORG }) as any;
    check("8. a laboratory that left keeps its documents; only the rows naming that organization go", left.plan?.rowsByTable?.policy_shared_copies === all("SELECT 1 FROM policy_shared_copies").length && left.plan.rowsByTable.policy_addenda === all("SELECT 1 FROM policy_addenda WHERE lab_id <> ?", A.labId).length && !left.internal.rowids.policy_documents?.includes(aDoc), JSON.stringify(left.plan?.rowsByTable ?? left).slice(0, 300));
    run("UPDATE labs SET organization_id = ? WHERE id = ?", ORG, A.labId);

    // ── 10 (after). The quiet lab ──
    const quietAfter = await quiet();
    const differs = Object.keys(quietBefore).filter((k) => quietBefore[k] !== quietAfter[k]);
    check("10. a lab of the same organization that received nothing answers exactly as before, the loose files included", differs.length === 0, differs.map((k) => `${k}: ${quietBefore[k].slice(0, 160)} >> ${quietAfter[k].slice(0, 160)}`).join(" | "));
    check("10. and holds no row of this feature", mine.every((t) => all(`SELECT 1 FROM ${t} WHERE lab_id = ?`, Z.labId).length === 0));

    // ── 11. Addenda in the other readers, in read-and-sign, and on paper ──
    const D = await mkLab("d", "Made-up Harbor Laboratory");
    run("UPDATE labs SET organization_id = ?, is_demo = 0, clia_number = '22D9990011' WHERE id = ?", ORG, D.labId);
    await call("GET", `${D.P}/manuals`, undefined, D.token);
    const dSigner = await person(D, "dsigner", "Dee Signer", "active");
    const dEditor = await person(D, "deditor", "Dov Editor", "active");
    const dViewer = await person(D, "dviewer", "Dru Viewer", "view_only");
    const dStaff = await person(D, "dstaff", "Remy Quillby", "staff_portal");
    const dApprover = await person(D, "dapprover", "Reese Quillby", "staff_portal");
    const dWf = await route(D, "Harbor approval", dSigner.userId);
    const M6 = await doc(R, "Cold chain", "COLD made up", { doc_number: "SYS 30" }, writer.token);
    await approve(R, M6, rWf, rSigner);
    await send({ labIds: [D.labId] }, writer.token, M6);
    const dDoc = copyOf(M6, D).document_id as number;
    await approve(D, dDoc, dWf, dSigner);
    const addendum = async (title: string, text: string, parent = dDoc) => Number((await call("POST", `${D.P}/documents/${parent}/addenda`, { title, text }, dEditor.token)).body.id);
    const ad1 = await addendum("Harbor freezer list", "HARBOR-ONE made up");
    await approve(D, ad1, dWf, dSigner);
    await newVersion(D, ad1, "HARBOR-TWO made up", {}, dEditor.token);
    await addendum("Never approved", "HARBOR-DRAFT made up");
    const plain = await doc(D, "Plain procedure", "PLAIN made up");
    await approve(D, plain, dWf, dSigner);
    const dShown = (r: { status: number; text: string }) => r.status === 200 && r.text.includes("HARBOR-ONE") && !r.text.includes("HARBOR-TWO");
    const NUMBERS = ["0", "2", "-1", "x", "1.5", String(ad1)];
    const LAB = `/api/labs/${D.labId}`;

    // VeritaScan and a finding: the list names them, and each opens through VeritaDC's own routes.
    await call("POST", `${LAB}/veritascan/checklist/items/12/policy-links`, { document_id: dDoc }, D.token);
    await call("POST", `${LAB}/veritascan/checklist/items/12/policy-links`, { document_id: plain }, D.token);
    const finding = Number((await call("POST", `${LAB}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01" }, D.token)).body.id);
    const linkedNow = await call("POST", `${LAB}/findings/${finding}/documents`, { document_id: dDoc }, D.token);
    await call("POST", `${LAB}/findings/${finding}/documents`, { document_id: plain }, D.token);
    const scanLinks = async (token: string) => (await call("GET", `${LAB}/veritascan/policy-links`, undefined, token)).body as any[];
    const findingLinks = async (token: string) => (await call("GET", `${LAB}/findings/${finding}/documents`, undefined, token)).body.documents as any[];
    for (const [where, get] of [["VeritaScan", scanLinks], ["a finding", findingLinks]] as const) {
      for (const [who, p] of [["the owner", D], ["an editor", dEditor], ["a view-only seat", dViewer], ["a Staff login", dStaff]] as const) {
        const rows = await get(p.token);
        const l = rows?.find?.((x: any) => x.document_id === dDoc);
        const a = l?.addenda?.[0];
        const opened = a && await call("GET", `${D.P}/documents/${a.document_id}/${p === dStaff ? "render" : `versions/${a.open_version_id}/render`}`, undefined, p.token);
        check(`11. ${where}, ${who}: the approved addendum is named with the document and opens at its approved version`, l?.addenda?.length === 1 && a.document_id === ad1 && a.title === "Harbor freezer list" && a.version_label === "1.0" && a.open_version_id === row(ad1).approved_version_id && keysOf(a) === "document_id,open_version_id,title,version_label" && dShown(opened), JSON.stringify(l));
        check(`11. ${where}, ${who}: a document with none carries no list`, rows?.some?.((x: any) => x.document_id === plain && !("addenda" in x)) === true);
      }
      check(`11. ${where}: another laboratory reads nothing of it`, !(JSON.stringify(await get(B.token)) ?? "").includes("Harbor"));
    }
    check("11. a link just made carries it too", linkedNow.body.addenda?.[0]?.document_id === ad1);
    check("11. a Staff login can't open the addendum's draft through the link's route", (await call("GET", `${D.P}/documents/${ad1}/versions/${row(ad1).current_version_id}/render`, undefined, dStaff.token)).status === 403);

    // VeritaMaintain: the instrument's IFU and a schedule's SOP, through the link only.
    const eq = Number((await call("POST", `${LAB}/equipment`, { instrument_name: "Made-up freezer", pm_interval_days: 90, next_due_date: "2099-01-01" }, D.token)).body.id);
    await call("PUT", `${LAB}/equipment/${eq}`, { ifu_document_id: dDoc }, D.token);
    const sch = Number((await call("GET", `${LAB}/equipment/${eq}/schedules`, undefined, D.token)).body.schedules[0].id);
    await call("PUT", `${LAB}/equipment/${eq}/schedules/${sch}`, { sop_document_id: dDoc }, D.token);
    for (const [where, url, surface] of [["the IFU", `${LAB}/equipment/${eq}/ifu-document`, "equipment_ifu"], ["a schedule's SOP", `${LAB}/equipment/${eq}/schedules/${sch}/sop`, "equipment_schedule_sop"]] as const) {
      for (const [who, p] of [["a view-only seat", dViewer], ["a Staff login", dStaff]] as const) {
        const main = await call("GET", url, undefined, p.token);
        const list = await call("GET", `${url}?addenda=1`, undefined, p.token);
        check(`11. ${where}, ${who}: it says how many, lists them by place and not by id, and opens the approved version`, main.body.addenda_count === 1 && main.text.includes("COLD made up") && JSON.stringify(list.body) === JSON.stringify({ addenda: [{ title: "Harbor freezer list", version: "1.0" }] }) && dShown(await call("GET", `${url}?addendum=1`, undefined, p.token)), main.text.slice(0, 200) + list.text.slice(0, 200));
      }
      check(`11. ${where}: and no other document by any number`, (await Promise.all(NUMBERS.map((n) => call("GET", `${url}?addendum=${n}`, undefined, dViewer.token)))).every((r) => r.status === 404));
      check(`11. ${where}: another laboratory, and nobody signed in, get nothing`, (await Promise.all(["", "?addenda=1", "?addendum=1"].flatMap((q) => [call("GET", url + q, undefined, B.token), call("GET", url + q)]))).every((r) => r.status >= 400 && !r.text.includes("HARBOR") && !r.text.includes("Harbor freezer")));
      check(`11. ${where}: reading one is on the addendum's own trail, saying which document it came with`, audits(ad1, "viewed").some((x) => { const t = JSON.parse(x.details || "{}"); return t.surface === surface && t.addendum_to_document_id === dDoc && t.version_id === row(ad1).approved_version_id; }));
    }
    await call("PUT", `${LAB}/equipment/${eq}`, { ifu_document_id: plain }, D.token);
    check("11. a document with none is sent as before", await (async () => { const r = await call("GET", `${LAB}/equipment/${eq}/ifu-document`, undefined, dStaff.token); return r.status === 200 && keysOf(r.body) === "doc_number,format,html,revision_in_progress,tampered,title,version" && keysOf(JSON.parse(decodeURIComponent(r.headers.get("X-Document")!))) === "doc_number,revision_in_progress,title,version"; })());

    // The approval screen: someone asked to sign a document nobody else may read yet opens it and its addenda there, and nowhere else.
    const M7 = await doc(R, "Cold chain, part two", "COLD-TWO made up", {}, writer.token);
    await approve(R, M7, rWf, rSigner);
    await send({ labIds: [D.labId] }, writer.token, M7);
    const dWait = copyOf(M7, D).document_id as number;
    const ad2 = await addendum("Harbor pickup times", "HARBOR-ONE pickup made up", dWait);
    await approve(D, ad2, dWf, dSigner);
    await newVersion(D, ad2, "HARBOR-TWO pickup made up", {}, dEditor.token);
    await addendum("Not approved here either", "HARBOR-DRAFT made up", dWait);
    const apWf = await route(D, "Reese approves", dApprover.userId, false);
    await submit(D, dWait, apWf);
    const AP = `/api/staff-portal-session/approvals/${dWait}`;
    const item = await call("GET", AP, undefined, dApprover.token);
    check("11. the approval screen: its approver reads the document and its approved addendum, at its approved version", item.status === 200 && JSON.stringify(item.body.addenda) === JSON.stringify([{ title: "Harbor pickup times", version: "1.0" }]) && (await call("GET", `${AP}/render`, undefined, dApprover.token)).text.includes("COLD-TWO") && dShown(await call("GET", `${AP}/addenda/1/render`, undefined, dApprover.token)), item.text.slice(0, 300));
    check("11. the approval screen: and no other document by any number", (await Promise.all([...NUMBERS, String(ad2)].map((n) => call("GET", `${AP}/addenda/${n}/render`, undefined, dApprover.token)))).every((r) => r.status === 404));
    check("11. the approver may not open the document anywhere else", (await Promise.all([`${D.P}/documents/${dWait}`, `${D.P}/documents/${dWait}/render`, `${D.P}/documents/${dWait}/print.pdf`, `/api/staff-portal-session/policies/${dWait}`, `/api/staff-portal-session/policies/${dWait}/render`].map((u) => call("GET", u, undefined, dApprover.token)))).every((r) => r.status === 404));
    check("11. someone who isn't asked opens neither there", (await call("GET", AP, undefined, dStaff.token)).status === 404 && (await call("GET", `${AP}/addenda/1/render`, undefined, dStaff.token)).status === 404 && (await call("GET", `${AP}/addenda/1/render`, undefined, bStaff.token)).status === 404 && (await call("GET", `${AP}/addenda/1/render`)).status === 401);
    check("11. a document with no addendum says nothing there", await (async () => { const p = await doc(D, "Plain waiting", "PLAIN made up"); await submit(D, p, apWf); const r = await call("GET", `/api/staff-portal-session/approvals/${p}`, undefined, dApprover.token); return r.status === 200 && !("addenda" in r.body); })());
    await call("POST", `${AP}/approve`, { typed_signature: dApprover.name, password: PW, version_id: item.body.version_id }, dApprover.token);
    check("11. once it is signed, that way in closes", row(dWait).status === "approved" && (await call("GET", `${AP}/addenda/1/render`, undefined, dApprover.token)).status === 404);

    // Read-and-sign.
    const RS = `${D.P}/read-sign`;
    const dana = roster(D, "Dana", "Reader");
    const rsRows = (id: number) => all("SELECT * FROM policy_read_sign_assignments WHERE lab_id = ? AND document_id = ?", D.labId, id);
    const ad3 = await addendum("Harbor courier sheet", "HARBOR courier made up");
    await approve(D, ad3, dWf, dSigner);
    const offer = async (token: string, q = `scope=document&id=${dDoc}`) => (await call("GET", `${RS}?${q}`, undefined, token)).body;
    const offered = (await offer(dEditor.token)).addenda;
    check("11. read-and-sign: whoever assigns is told its addenda; nobody else, and no other scope, is", offered?.length === 3 && keysOf(offered[0]) === "document_id,in_force,title" && offered.find((a: any) => a.document_id === ad3).in_force === true && !("addenda" in (await offer(dViewer.token))) && !("addenda" in (await offer(dEditor.token, `scope=document&id=${plain}`))) && !("addenda" in (await offer(dEditor.token, "scope=lab"))), JSON.stringify(offered));
    await taken();
    const alone = await call("POST", RS, { scope: "document", id: dDoc, employee_ids: [dana] }, dEditor.token);
    check("11. read-and-sign: off leaves them out", alone.status === 201 && alone.body.added === 1 && !("addenda_assigned" in alone.body) && rsRows(dDoc).length === 1 && rsRows(ad1).length === 0 && rsRows(ad3).length === 0);
    for (const [what, ids] of [["another document of the laboratory", [plain]], ["the document itself", [dDoc]], ["another laboratory's", [adId]], ["one that isn't there", [999999]], ["one of them wrong", [ad3, plain]], ["not numbers", ["x"]]] as const) {
      const r = await call("POST", RS, { scope: "document", id: dDoc, employee_ids: [dStaff.emp], addendum_ids: ids }, dEditor.token);
      check(`11. read-and-sign: ${what}: refused, and nothing is assigned`, r.status === 409 && r.body.code === "ADDENDA_CHANGED" && rsRows(dDoc).length === 1 && rsRows(plain).length === 0 && rsRows(ad3).length === 0, r.text.slice(0, 120));
    }
    check("11. read-and-sign: a manual takes none", (await call("POST", RS, { scope: "manual", id: one("SELECT id FROM policy_manuals WHERE lab_id = ? AND archived_at IS NULL LIMIT 1", D.labId).id, employee_ids: [dana], addendum_ids: [ad3] }, dEditor.token)).body.code === "ADDENDA_CHANGED");
    const withThem = await call("POST", RS, { scope: "document", id: dDoc, employee_ids: [dana, dStaff.emp], addendum_ids: offered.map((a: any) => a.document_id) }, dEditor.token);
    const shape = (r: any) => JSON.stringify({ ...r, id: 0, document_id: 0, assigned_at: 0 });
    check("11. read-and-sign: on gives each the ordinary rows the document gets, and nothing else", withThem.status === 201 && withThem.body.added === 1 && withThem.body.addenda_assigned === 3 && rsRows(dDoc).length === 2 && offered.every((a: any) => JSON.stringify(rsRows(a.document_id).map(shape)) === JSON.stringify(rsRows(dDoc).map(shape))), withThem.text.slice(0, 160));
    check("11. read-and-sign: each is on its own document's trail, and no email goes out", offered.every((a: any) => audits(a.document_id, "read_sign_assigned").length === 1) && (await taken()).length === 0);
    const owes = (await call("GET", `/api/staff-portal-session/policies?employee_id=${dStaff.emp}`, undefined, dStaff.token)).body.policies.map((p: any) => p.document_id);
    check("11. read-and-sign: they owe the approved one; one whose new version isn't approved waits", owes.includes(ad3) && owes.includes(dDoc), owes.join());
    const ad4 = await addendum("Added later", "HARBOR later made up");
    await approve(D, ad4, dWf, dSigner);
    check("11. read-and-sign: one added later isn't assigned by itself", rsRows(ad4).length === 0 && !(await call("GET", `/api/staff-portal-session/policies?employee_id=${dStaff.emp}`, undefined, dStaff.token)).body.policies.some((p: any) => p.document_id === ad4));
    check("11. read-and-sign: one of a type nobody signs isn't offered", await (async () => {
      run("UPDATE policy_documents SET doc_type = 'form' WHERE id = ?", ad4);
      run("INSERT OR REPLACE INTO policy_doc_type_settings (lab_id, doc_type, requires_read_and_sign) VALUES (?, 'form', 0)", D.labId);
      const left = !(await offer(dEditor.token)).addenda.some((a: any) => a.document_id === ad4);
      const refused = (await call("POST", RS, { scope: "document", id: dDoc, employee_ids: [dana], addendum_ids: [ad4] }, dEditor.token)).body.code === "ADDENDA_CHANGED";
      run("DELETE FROM policy_doc_type_settings WHERE lab_id = ? AND doc_type = 'form'", D.labId);
      return left && refused;
    })());
    check("11. read-and-sign: a Staff login and a view-only seat still assign nothing", (await Promise.all([dStaff, dViewer].map((p) => call("POST", RS, { scope: "document", id: dDoc, everyone: true, addendum_ids: [ad3] }, p.token)))).every((r) => r.status === 403) && rsRows(ad3).length === 2);

    // On paper: a Word part, a PDF with a landscape page and turned pages, a picture, and one that can't go in.
    const upload = async (title: string, buf: Buffer, name: string, type: string, approveIt = true) => {
      const fd = new FormData();
      fd.append("file", new Blob([new Uint8Array(buf)], { type }), name);
      fd.append("title", title);
      const r = await fetch(`${base}${D.P}/documents/${dPrint}/addenda`, { method: "POST", headers: { Authorization: `Bearer ${dEditor.token}` }, body: fd });
      const id = Number(((await r.json()) as any).id);
      if (approveIt) await approve(D, id, dWf, dSigner);
      return id;
    };
    const { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow } = await import("docx");
    const wordFile = async (words: string, lines: number) => Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [
      new Paragraph({ text: words, heading: HeadingLevel.HEADING_1 }),
      ...Array.from({ length: lines }, (_, i) => new Paragraph(`Made-up step ${i + 1}: check the storage unit, write the reading on the log and tell the supervisor when it is out of range.`)),
      new Table({ rows: [new TableRow({ children: ["CELL-A", "CELL-B"].map((t) => new TableCell({ children: [new Paragraph(t)] })) })] }),
    ] }] })));
    const { StandardFonts, degrees, rgb, PDFName } = await import("pdf-lib");
    const pages = await PDFDocument.create();
    const helv = await pages.embedFont(StandardFonts.Helvetica);
    const addPage = (w: number, h: number, words: string, turn = 0) => {
      const p = pages.addPage([w, h]);
      p.drawRectangle({ x: 2, y: 2, width: w - 4, height: h - 4, borderColor: rgb(0.8, 0, 0), borderWidth: 2 });
      p.drawText(`${words} TOP`, { x: 30, y: h - 14, size: 9, font: helv });
      p.drawText(`${words} BOTTOM`, { x: 30, y: 6, size: 9, font: helv });
      if (turn) p.setRotation(degrees(turn));
      return p;
    };
    addPage(612, 792, "PORTRAIT");
    addPage(792, 612, "LANDSCAPE");
    addPage(792, 612, "TURNED", 90);
    const cut = addPage(612, 792, "CUT");
    cut.drawText("OUTSIDE THE CUT", { x: 30, y: 780, size: 9, font: helv });
    cut.setCropBox(0, 0, 612, 776);
    const filled = addPage(612, 792, "FORM");
    const field = pages.getForm().createTextField("made.up");
    field.setText("FILLED IN");
    field.addToPage(filled, { x: 60, y: 400, width: 160, height: 20 });
    addPage(612, 792, "UPSIDE", 180);
    addPage(792, 612, "OTHERWAY", 270);
    const stamp = (text: string, flags: number) => {
      const look = pages.context.register(pages.context.flateStream(`0 g BT /F1 12 Tf 4 8 Td (${text}) Tj ET`, { Type: "XObject", Subtype: "Form", BBox: [0, 0, 140, 24], Resources: { Font: { F1: helv.ref } } }));
      return pages.context.register(pages.context.obj({ Type: "Annot", Subtype: "Stamp", Rect: [60, 300, 200, 324], F: flags, AP: { N: look } }));
    };
    cut.node.set(PDFName.of("Annots"), pages.context.obj([stamp("STAMPED ON", 4), stamp("HIDDEN STAMP", 2)]));
    // A plain gray PNG, wider than tall.
    const chunk = (type: string, data: Buffer) => {
      const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
      const len = Buffer.alloc(4), crc = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const head = Buffer.alloc(13);
    head.writeUInt32BE(900, 0); head.writeUInt32BE(500, 4); head[8] = 8; head[9] = 0;
    const rowsOfGray = Buffer.alloc(500 * 901, 200);
    for (let y = 0; y < 500; y++) rowsOfGray[y * 901] = 0;
    const picture = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", head), chunk("IDAT", deflateSync(rowsOfGray)), chunk("IEND", Buffer.alloc(0))]);
    const M8 = await doc(R, "Print sample", "replaced below", { doc_number: "SYS 40" }, writer.token);
    const masterFile = new FormData();
    masterFile.append("file", new Blob([new Uint8Array(await wordFile("WORD-MASTER made up", 60))], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), "master.docx");
    await fetch(`${base}${R.P}/documents/${M8}/versions`, { method: "POST", headers: { Authorization: `Bearer ${writer.token}` }, body: masterFile });
    await approve(R, M8, rWf, rSigner);
    await send({ labIds: [D.labId] }, writer.token, M8);
    const dPrint = copyOf(M8, D).document_id as number;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "ssop-print-"));
    const read = (buf: Buffer): { size: [number, number]; text: string; words: [number, number, number, number, string][] }[] => {
      const f = path.join(work, "p.pdf");
      fs.writeFileSync(f, buf);
      return JSON.parse(execFileSync("python", ["-E", "-c", "import sys, json, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(json.dumps([{'size': [p.rect.width, p.rect.height], 'text': p.get_text(), 'words': [w[:5] for w in p.get_text('words')]} for p in fitz.open(sys.argv[1])]))", f], { maxBuffer: 64 * 1024 * 1024 }).toString("utf-8"));
    };
    const print = async (token = D.token, id = dPrint) => call("GET", `${D.P}/documents/${id}/print.pdf`, undefined, token);
    const flat = (t: string) => t.replace(/\s+/g, " ");
    const draftCover = flat(read((await print()).buf)[0].text);
    check("11. paper: a document not approved here says so, with no approver, and its dates are set when it is approved", /Status Draft, not in force/.test(draftCover) && !/Approved by/.test(draftCover) && /Effective Set when approved Next review Set when approved/.test(draftCover), draftCover);
    await approve(D, dPrint, dWf, dSigner);
    const pdfAddendum = await upload("Harbor map", Buffer.from(await pages.save()), "map.pdf", "application/pdf");
    const picAddendum = await upload("Harbor picture", picture, "shelf.png", "image/png");
    const wordAddendum = await upload("Harbor notes", await wordFile("WORD-ADDENDUM made up", 4), "notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", false);
    const us = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return `${m}/${dd}/${y}`; };
    const paper = await print();
    const pp = read(paper.buf);
    const cover = flat(pp[0].text);
    const eff = us(row(dPrint).effective_date), next = us(row(dPrint).next_review_date);
    check("11. paper: page 1 names the laboratory and its CLIA", paper.status === 200 && cover.includes("Made-up Harbor Laboratory CLIA: 22D9990011"), cover);
    check("11. paper: page 1 lists every part in order with its pages", /System document pages 2 to \d+ SYS 40 Print sample .*Site addendum 1 pages \d+ to \d+ Harbor map .*Site addendum 2 page \d+ Harbor picture .*Site addendum 3 page \d+ Harbor notes/.test(cover), cover);
    check("11. paper: a part in force says so, with its version, dates, and who approved it and when", cover.includes(`Version 1.1 (the system's version 1.1) Status In force Effective ${eff} Next review ${next} Approved by Dee Signer, ${eff} (Made-up approval)`), cover);
    check("11. paper: the one that isn't approved says Draft, not in force and names no approver", /Harbor notes Version 1\.0 Status Draft, not in force Effective Set when approved Next review Set when approved Printed/.test(cover), cover);
    const wordPages = pp.findIndex((p) => p.text.includes("PORTRAIT TOP")) - 1;
    check("11. paper: the Word part prints as its words, over its own pages", wordPages >= 2 && pp.slice(1, 1 + wordPages).map((p) => p.text).join("").includes("WORD-MASTER") && pp.slice(1, 1 + wordPages).map((p) => p.text).join("").includes("CELL-B"), String(wordPages));
    check("11. paper: every page after the first carries its part's title and version, and Draft where it is one", pp.slice(1).every((p, i) => {
      const t = flat(p.text);
      const n = i + 1;
      return n <= wordPages ? /SYS 40 Print sample Version 1\.\d/.test(t) && !/not in force/.test(t)
        : n <= wordPages + 7 ? t.includes("Site addendum 1: Harbor map Version 1.0") && !/not in force/.test(t)
        : n === wordPages + 8 ? t.includes("Site addendum 2: Harbor picture Version 1.0") : t.includes("Site addendum 3: Harbor notes Version 1.0") && t.includes("Draft, not in force");
    }), pp.map((p) => flat(p.text).slice(-160)).join(" | "));
    check("11. paper: page X of Y and the footer on every page", pp.every((p, i) => flat(p.text).includes(`VeritaAssure® | VeritaDC™ | Confidential, For Internal Lab Use Only | Page ${i + 1} of ${pp.length}`)));
    check("11. paper: every page is Letter, a landscape page and a page turned on its side the right way round", pp.every((p) => p.size.join() === "612,792" || p.size.join() === "792,612") && JSON.stringify(pp.slice(1 + wordPages, 8 + wordPages).map((p) => p.size.join())) === JSON.stringify(["612,792", "792,612", "612,792", "612,792", "612,792", "612,792", "612,792"]) && pp[8 + wordPages].size.join() === "792,612");
    const at = (words: string, which: string) => { const p = pp.find((x) => x.words.some((w) => w[4] === words))!; return { p, w: p.words.filter((w) => w[4] === which).map((w) => [w[0] / p.size[0], w[1] / p.size[1], w[2] - w[0] > w[3] - w[1]] as const)[0] }; };
    check("11. paper: a turned page prints the way its own viewer shows it", (() => {
      const t = at("TURNED", "TOP").w, tb = at("TURNED", "BOTTOM").w, u = at("UPSIDE", "TOP").w, ub = at("UPSIDE", "BOTTOM").w, o = at("OTHERWAY", "TOP").w, ob = at("OTHERWAY", "BOTTOM").w;
      return t[0] > 0.8 && tb[0] < 0.2 && !tb[2] && u[1] > 0.8 && ub[1] < 0.2 && ub[2] && o[0] < 0.2 && ob[0] > 0.8 && !ob[2];
    })(), JSON.stringify(["TURNED", "UPSIDE", "OTHERWAY"].map((x) => [at(x, "TOP").w, at(x, "BOTTOM").w])));
    const inside = (p: (typeof pp)[number], words: string) => p.words.filter((w) => words.split(" ").includes(w[4])).every((w) => w[1] >= 37 && w[3] <= p.size[1] - 29 && w[0] >= 20 && w[2] <= p.size[0] - 20);
    check("11. paper: nothing in a part reaches the header line or the footer, however close to the edge it was", ["PORTRAIT", "LANDSCAPE", "TURNED", "CUT", "FORM", "UPSIDE", "OTHERWAY"].every((w, i) => { const p = pp[1 + wordPages + i]; return p.text.includes(`${w} BOTTOM`) && inside(p, `${w} TOP BOTTOM`); }));
    check("11. paper: what was filled in or stamped on a page prints; what was hidden or cut off doesn't", pp.some((p) => p.text.includes("FILLED IN")) && pp.some((p) => p.text.includes("STAMPED ON")) && !pp.some((p) => p.text.includes("HIDDEN STAMP")) && !read(paper.buf)[1 + wordPages + 3].words.some((w) => w[4] === "OUTSIDE" && w[1] > 37));
    check("11. paper: the fitted PDF opens cleanly and says who made it", (await PDFDocument.load(paper.buf)).getAuthor() === "Perplexity Computer" && (await PDFDocument.load(paper.buf)).getTitle() === "Print sample");
    const staffPaper = flat(read((await print(dStaff.token)).buf)[0].text);
    check("11. paper: a Staff login's copy holds the approved parts only", staffPaper.includes("Harbor picture") && !staffPaper.includes("Harbor notes") && !staffPaper.includes("Draft"), staffPaper);
    run("UPDATE labs SET clia_number = NULL WHERE id = ?", D.labId);
    run("UPDATE policy_documents SET next_review_date = '2020-02-03' WHERE id = ?", pdfAddendum);
    const blank = flat(read((await print()).buf)[0].text);
    check("11. paper: with no CLIA on file it says so", blank.includes("CLIA: Not on file. Enter it in account settings."));
    check("11. paper: a part past its review date is still in force and says the review is overdue", /Harbor map Version 1\.0 Status In force Effective \S+ Next review 2\/3\/2020 Review overdue/.test(blank), blank);
    await newVersion(D, picAddendum, "a new one, typed", {}, dEditor.token);
    check("11. paper: a new version waiting over an approved one names the version in force", /Harbor picture Version 1\.1 Status Draft, not in force\. Version 1\.0 is in force\./.test(flat(read((await print()).buf)[0].text)));
    run("INSERT INTO policy_carried_records (lab_id, document_id, version_id, source_system, source_number, last_approval_or_review, loaded_at) VALUES (?, ?, ?, 'Made-up old system', 'X 1', '2025-05-06', ?)", D.labId, wordAddendum, row(wordAddendum).current_version_id, now);
    run("UPDATE policy_documents SET status = 'approved', approved_version_id = current_version_id WHERE id = ?", wordAddendum);
    const carriedCover = flat(read((await print()).buf)[0].text);
    check("11. paper: one approved in a prior system says so and sends the reader to its signature face page", carriedCover.includes("Approved in Made-up old system, last approval or review 5/6/2025. The signature face page on this document's VeritaDC™ record shows who signed and when."), carriedCover);
    const many: number[] = [];
    for (let i = 0; i < 5; i++) many.push(await (async () => { const id = Number((await call("POST", `${D.P}/documents/${dPrint}/addenda`, { title: `Extra ${i + 1}`, text: `EXTRA-${i + 1} made up` }, dEditor.token)).body.id); return id; })());
    const long = read((await print()).buf);
    const listed = flat(long[0].text + long[1].text);
    check("11. paper: a list that runs to a second page still gives each part's own page", long[1].text.includes("In this copy, in order (continued)") && many.every((_, i) => { const m = listed.match(new RegExp(`Site addendum ${i + 4} page (\\d+) Extra ${i + 1}`)); return !!m && long[Number(m[1]) - 1].text.includes(`EXTRA-${i + 1}`); }), listed);
    const sealed = Buffer.from(await pages.save());
    const broken = await upload("Harbor sealed file", Buffer.concat([sealed.subarray(0, 400), Buffer.from("made up and cut short")]), "sealed.pdf", "application/pdf", false);
    const cannotPrint = await print();
    check("11. paper: a part that can't be combined is named, and nothing is printed", cannotPrint.status === 409 && cannotPrint.body.code === "CANNOT_COMBINE" && cannotPrint.body.error.startsWith("Harbor sealed file couldn't be put into one print copy."), cannotPrint.text.slice(0, 200));
    check("11. paper: a Staff login, who doesn't get that part, still prints", (await print(dStaff.token)).status === 200 && row(broken).status === "draft");
    fs.rmSync(work, { recursive: true, force: true });
  } finally {
    server.close();
  }
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
