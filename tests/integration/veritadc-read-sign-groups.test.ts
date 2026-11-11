// tests/integration/veritadc-read-sign-groups.test.ts
//
// STANDING integration test for VeritaDC read-and-sign by group (Step D of Heywood's move out of MediaLab; server/policyReadSign.ts):
//   0.  A new lab has no groups and nothing assigned: the groups are data the lab enters.
//   1.  A Staff login sees and signs only what's assigned. Nothing assigned means nothing listed, on any screen.
//   2.  A document goes to groups, named people or everyone. Assigning twice adds nothing, and assigning sends no email.
//   3.  A manual covers its sub-manuals, new documents inherit it, a moved document follows its manual, a new group member picks it up.
//   4.  The read-only lookup: approved documents by search, current version only, never a draft, nothing to sign.
//   5.  Signing records who, when and the version, on the roster row. A major version asks again; a minor one follows the lab's rule.
//   6.  Staff limits (Q182, Q186): a Staff login never reads who else signed or owes. A sweep of every VeritaDC read, including new routes.
//   7.  Who stays unlimited: owner, a Staff seat with edit on VeritaDC, a view-only reviewer. A deactivated seat sees nothing.
//   8.  The tracker and signature list, by group; the fast roll-up agrees with the per-document list; the Excel report carries both.
//   9.  The notice is separate and says what it does: one email per person, the count they saw, not twice in a day.
//   10. Taking an assignment off, retiring a group, other labs, document types, deleting a document, the export.
//   11. The one-time seed: a lab already working the old way keeps it; a lab with carried-over documents does not; a later boot adds nothing.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-read-sign-groups

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import express from "express";
import Database from "better-sqlite3";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { readSignMailer } from "../../server/policyReadSign";
import { seedLabsAlreadyWorkingTheOldWay } from "../../server/policyReadSignSeed";

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
  const PW = ["Read", "sign", "77!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();

  const mail: { to: string; subject: string; html: string }[] = [];
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: { to: string; subject: string; html: string }) => { mail.push(m); };

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `readsign-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Read Sign Lab ${tag}`, plan: "hospital", isWarehouse: true });
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
    const staffLabFor = (L: { labId: number; userId: number }) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(L.labId) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Read Sign Lab', '22D0000456', ?, ?, ?)").run(L.userId, L.labId, now, now).lastInsertRowid);
    const addEmployee = (L: { labId: number; userId: number }, first: string, last: string) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', ?, ?)"
    ).run(staffLabFor(L), L.labId, L.userId, last, first, now, now).lastInsertRowid);
    const addStaffLogin = async (L: { labId: number; userId: number }, first: string, last: string, permissions = '{"mode":"view_all"}') => {
      const email = `readsign-${first.toLowerCase()}-${stamp}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `${first} ${last}`, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(L.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
      const emp = addEmployee(L, first, last);
      sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, ?)").run(L.userId, email, userId, L.labId, emp, permissions);
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
      const token = issueSession(sqlite, userId, { headers: { "user-agent": "read-sign-test" }, ip: "127.0.0.1" }).token as string;
      return { email, userId, emp, token, name: `${first} ${last}` };
    };

    // 0. Groups are data the lab enters
    check("0. a new lab has no groups", (await call("GET", `${P}/groups`, undefined, A.token)).body.groups?.length === 0);
    check("0. a new lab has no assignments", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ?").get(A.labId) as any).n === 0);

    // People, in made-up groups entered through the same screen a lab uses
    const ann = await addStaffLogin(A, "Ann", "Chem");
    const bea = await addStaffLogin(A, "Bea", "Micro");
    const cal = await addStaffLogin(A, "Cal", "Both");
    const dee = await addStaffLogin(A, "Dee", "Nogroup");
    const zork = await addStaffLogin(A, "Zork", "Quillfeather");
    const nia = addEmployee(A, "Nia", "Nologin");
    const mkGroup = async (name: string) => {
      const out = await call("POST", `${P}/groups`, { name }, A.token);
      return out.body.groups.find((g: any) => g.name === name).id as number;
    };
    const addMember = (groupId: number, body: any) => call("POST", `${P}/groups/${groupId}/members`, body, A.token);
    const chem = await mkGroup("Made-up Chemistry");
    const micro = await mkGroup("Made-up Micro");
    const empty = await mkGroup("Made-up Empty");
    for (const p of [ann, cal, zork]) await addMember(chem, { employee_id: p.emp });
    await addMember(chem, { employee_id: nia });
    for (const p of [bea, cal]) await addMember(micro, { employee_id: p.emp });
    check("0. sixteen groups can be entered as data, on a scratch lab", await (async () => {
      const L = await mkLab("sixteen");
      for (let i = 1; i <= 16; i++) await call("POST", `/api/labs/${L.labId}/veritapolicy/groups`, { name: `Made-up group ${i}` }, L.token);
      return (await call("GET", `/api/labs/${L.labId}/veritapolicy/groups`, undefined, L.token)).body.groups?.length === 16;
    })());

    // Manuals: Hospital > Chemistry > Analyzers; Hospital > Micro; Safety
    const mkManual = async (name: string, parentId?: number) => (await call("POST", `${P}/manuals`, { name, ...(parentId ? { parentId } : {}) }, A.token)).body.id as number;
    const hospital = await mkManual("Made-up Hospital");
    const chemManual = await mkManual("Made-up Chemistry Manual", hospital);
    const analyzers = await mkManual("Made-up Analyzers", chemManual);
    const microManual = await mkManual("Made-up Micro Manual", hospital);
    const safety = await mkManual("Made-up Safety");
    const mkDoc = async (title: string, manualId: number | null, fields: Record<string, string> = {}) => {
      const d = await upload(A, { title, ...(manualId ? { manual_id: String(manualId) } : {}), ...fields });
      sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(d.id);
      return d.id as number;
    };
    const docChem = await mkDoc("Made-up Glucose procedure", chemManual, { doc_number: "CH 1" });
    const docAnalyzer = await mkDoc("Made-up Cobas procedure", analyzers);
    const docMicro = await mkDoc("Made-up Gram stain procedure", microManual);
    const docSafety = await mkDoc("Made-up Fire plan", safety);
    const draft = await upload(A, { title: "Made-up SECRETDRAFT plan", manual_id: String(chemManual) });

    const listIds = async (who: { emp: number; token: string }) => ((await call("GET", `/api/staff-portal-session/policies?employee_id=${who.emp}`, undefined, who.token)).body.policies || []).map((p: any) => p.document_id).sort((a: number, b: number) => a - b);
    const docIds = async (who: { token: string }) => ((await call("GET", `${P}/documents`, undefined, who.token)).body.documents || []).map((d: any) => d.id).sort((a: number, b: number) => a - b);
    const bellIds = async (who: { token: string }) => ((await call("GET", `/api/me/pending-staff-portal-items?lab_id=${A.labId}`, undefined, who.token)).body.policies || []).map((p: any) => p.document_id);
    const signAs = async (id: number, who: { emp: number; token: string; name: string }) => {
      const version = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(id) as any).v;
      return call("POST", `/api/staff-portal-session/policies/${id}/sign`, { employee_id: who.emp, version_id: version, typed_signature: who.name, content_hash: "madeuphash" }, who.token);
    };
    const assign = (body: any, token = A.token, prefix = P) => call("POST", `${prefix}/read-sign`, body, token);
    const eq = (a: number[], b: number[]) => JSON.stringify([...a].sort((x, y) => x - y)) === JSON.stringify([...b].sort((x, y) => x - y));

    // 1. Nothing assigned, nothing listed
    check("1. a Staff login with nothing assigned has an empty My sign-offs", (await listIds(ann)).length === 0);
    check("1. and an empty document list", (await docIds(ann)).length === 0);
    check("1. and an empty bell", (await bellIds(ann)).length === 0);
    const refused = await signAs(docChem, ann);
    check("1. and can't sign", refused.status === 403 && refused.body.code === "NOT_ASSIGNED", `HTTP ${refused.status} ${refused.body.code}`);
    check("1. no signature row was written", !(sqlite.prepare("SELECT 1 FROM staff_portal_policy_signatures WHERE document_id = ?").get(docChem)));
    const ownerDocs = (await call("GET", `${P}/documents`, undefined, A.token)).body.documents;
    check("1. the owner still sees every document, drafts too", ownerDocs.length >= 5 && ownerDocs.some((d: any) => d.id === draft.id));
    check("1. the owner sees it goes to nobody yet", ownerDocs.find((d: any) => d.id === docChem).read_sign_targets.length === 0);

    // 2. To a group, named people, everyone
    const oneGroup = await assign({ scope: "document", id: docSafety, group_ids: [chem] });
    check("2. a document goes to a group", oneGroup.status === 201 && oneGroup.body.added === 1 && oneGroup.body.emails_sent === 0, `HTTP ${oneGroup.status}`);
    check("2. group members see it", eq(await listIds(ann), [docSafety]) && eq(await listIds(cal), [docSafety]));
    check("2. everyone else doesn't", (await listIds(bea)).length === 0 && (await listIds(dee)).length === 0);
    check("2. their document list and bell match", eq(await docIds(ann), [docSafety]) && (await bellIds(ann)).includes(docSafety) && !(await bellIds(bea)).includes(docSafety));
    const again = await assign({ scope: "document", id: docSafety, group_ids: [chem] });
    check("2. assigning twice adds nothing", again.status === 201 && again.body.added === 0);
    const named = await assign({ scope: "document", id: docSafety, employee_ids: [dee.emp], group_ids: [micro] });
    check("2. one assign takes people and groups together", named.body.added === 2 && eq(await listIds(dee), [docSafety]) && eq(await listIds(bea), [docSafety]));
    const someDoc = await mkDoc("Made-up Everyone notice", null);
    await assign({ scope: "document", id: someDoc, everyone: true });
    check("2. everyone in the lab reaches everyone", (await listIds(ann)).includes(someDoc) && (await listIds(bea)).includes(someDoc) && (await listIds(dee)).includes(someDoc));
    check("2. the empty ask is refused", (await assign({ scope: "document", id: docSafety })).status === 400);
    check("2. assigning sent no email", mail.length === 0, `${mail.length} sent`);
    const auditRow = sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'read_sign_assigned' ORDER BY id DESC LIMIT 1").get(A.labId) as any;
    check("2. it is on the audit trail, with no email", JSON.parse(auditRow.details).emails_sent === 0);
    check("2. the owner's list says who it goes to", (await call("GET", `${P}/documents`, undefined, A.token)).body.documents.find((d: any) => d.id === docSafety).read_sign_targets.includes("Made-up Chemistry"));

    // 3. Manual-level
    const manualOut = await assign({ scope: "manual", id: chemManual, group_ids: [chem] });
    check("3. a manual goes to a group", manualOut.status === 201 && manualOut.body.added === 1 && manualOut.body.documents >= 2, JSON.stringify({ s: manualOut.status, d: manualOut.body.documents }));
    check("3. it covers its documents and its sub-manuals'", (await listIds(ann)).includes(docChem) && (await listIds(ann)).includes(docAnalyzer));
    check("3. but not a sibling manual", !(await listIds(ann)).includes(docMicro));
    check("3. and sends no email at manual level", mail.length === 0);
    await assign({ scope: "manual", id: hospital, group_ids: [micro] });
    check("3. a top manual reaches two levels down", (await listIds(bea)).includes(docAnalyzer) && (await listIds(bea)).includes(docMicro));
    check("3. a draft in the manual isn't listed", !(await listIds(ann)).includes(draft.id) && !(await docIds(ann)).includes(draft.id));
    const later = await mkDoc("Made-up Added later", analyzers);
    check("3. a new document in the manual inherits it", (await listIds(ann)).includes(later) && (await bellIds(ann)).includes(later));
    await call("PATCH", `${P}/documents/${later}`, { manualId: safety }, A.token);
    check("3. a document moved out stops", !(await listIds(ann)).includes(later) && !(await bellIds(ann)).includes(later));
    await call("PATCH", `${P}/documents/${later}`, { manualId: analyzers }, A.token);
    check("3. moved back, it is owed again", (await listIds(ann)).includes(later));
    const eve = await addStaffLogin(A, "Eve", "New");
    check("3. someone new owes nothing yet", !(await listIds(eve)).includes(docChem));
    const eveMember = await addMember(chem, { employee_id: eve.emp });
    check("3. added to the group, they pick up what it owes", eveMember.status === 200 && (await listIds(eve)).includes(docChem) && (await listIds(eve)).includes(docAnalyzer) && (await bellIds(eve)).includes(docChem));
    const eveRow = (await call("GET", `${P}/groups`, undefined, A.token)).body.groups.find((g: any) => g.id === chem).members.find((m: any) => m.employee_id === eve.emp);
    await call("DELETE", `${P}/groups/${chem}/members/${eveRow.id}`, undefined, A.token);
    check("3. taken out of the group, they stop owing it", !(await listIds(eve)).includes(docChem));
    // A typed address in a group counts as the login behind it.
    await addMember(chem, { email: eve.email, name: "Eve New" });
    check("3. a typed address counts as the person behind it", (await listIds(eve)).includes(docChem));
    const eveTyped = (await call("GET", `${P}/groups`, undefined, A.token)).body.groups.find((g: any) => g.id === chem).members.find((m: any) => m.email === eve.email && m.employee_id == null);
    await call("DELETE", `${P}/groups/${chem}/members/${eveTyped.id}`, undefined, A.token);
    sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(dee.emp);
    check("3. someone off the active roster owes nothing", (await call("GET", `/api/me/pending-staff-portal-items?lab_id=${A.labId}`, undefined, dee.token)).body.policies?.length === 0);
    sqlite.prepare("UPDATE staff_employees SET status = 'active' WHERE id = ?").run(dee.emp);

    // 4. The read-only lookup
    const notMine = (await call("GET", `/api/staff-portal-session/policies/lookup?q=Gram`, undefined, ann.token)).body.results;
    check("4. a Staff login can look up an approved document not assigned to them", notMine?.length === 1 && notMine[0].document_id === docMicro && notMine[0].assigned === false, JSON.stringify(notMine));
    check("4. it never finds a draft", (await call("GET", `/api/staff-portal-session/policies/lookup?q=SECRETDRAFT`, undefined, ann.token)).body.results.length === 0);
    check("4. under two letters finds nothing, so it isn't a list", (await call("GET", `/api/staff-portal-session/policies/lookup?q=M`, undefined, ann.token)).body.results.length === 0);
    check("4. a wildcard doesn't list everything", (await call("GET", `/api/staff-portal-session/policies/lookup?q=${encodeURIComponent("%%")}`, undefined, ann.token)).body.results.length === 0);
    const asMeta = await call("GET", `/api/staff-portal-session/policies/${docMicro}`, undefined, ann.token);
    check("4. it opens with nothing to sign", asMeta.status === 200 && asMeta.body.assigned === false);
    check("4. and reads", (await fetch(`${base}/api/staff-portal-session/policies/${docMicro}/render`, { headers: { Authorization: `Bearer ${ann.token}` } })).status === 200);
    check("4. the read is on the document's trail", !!sqlite.prepare("SELECT 1 FROM policy_audit_log WHERE document_id = ? AND user_id = ? AND action = 'viewed'").get(docMicro, ann.userId));
    check("4. signing it is refused", (await signAs(docMicro, ann)).status === 403);
    check("4. a draft is not found", (await call("GET", `/api/staff-portal-session/policies/${draft.id}`, undefined, ann.token)).status === 404);
    const mainSearch = (await call("GET", `${P}/search?q=Made-up`, undefined, ann.token)).body.results;
    check("4. the main app's search finds approved documents only", mainSearch.length >= 4 && !mainSearch.some((r: any) => r.id === draft.id) && mainSearch.every((r: any) => r.status === "approved"), `${mainSearch.length}`);
    const ownerSearch = (await call("GET", `${P}/search?q=SECRETDRAFT`, undefined, A.token)).body.results;
    check("4. the owner's search is unchanged", ownerSearch.length === 1);
    check("4. the main app opens an approved document", (await call("GET", `${P}/documents/${docMicro}`, undefined, ann.token)).status === 200);
    check("4. never a draft", (await call("GET", `${P}/documents/${draft.id}`, undefined, ann.token)).status === 404 && (await call("GET", `${P}/documents/${draft.id}/render`, undefined, ann.token)).status === 404);
    const otherLabDoc = await upload(B, { title: "Made-up other lab document" });
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(otherLabDoc.id);
    check("4. not another lab's", (await call("GET", `/api/staff-portal-session/policies/${otherLabDoc.id}`, undefined, ann.token)).status === 404
      && (await call("GET", `/api/staff-portal-session/policies/lookup?q=other%20lab`, undefined, ann.token)).body.results.length === 0);
    const expiredDoc = await mkDoc("Made-up Overdue procedure", chemManual);
    sqlite.prepare("UPDATE policy_documents SET status = 'expired' WHERE id = ?").run(expiredDoc);
    check("4. a document past its review can still be read at the bench", (await call("GET", `/api/staff-portal-session/policies/${expiredDoc}`, undefined, ann.token)).status === 200 && (await call("GET", `${P}/documents/${expiredDoc}`, undefined, ann.token)).status === 200);
    check("4. but not signed", (await signAs(expiredDoc, ann)).status === 404 && !(await listIds(ann)).includes(expiredDoc));

    // 5. Signing
    const signed = await signAs(docChem, ann);
    check("5. an assigned document can be signed", signed.status === 200 && signed.body.already_signed === false, `HTTP ${signed.status}`);
    const sigRow = sqlite.prepare("SELECT * FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?").get(docChem, ann.emp) as any;
    const curV = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docChem) as any).v;
    check("5. it records who, when and the version, on the roster row", sigRow.version_id === curV && sigRow.typed_signature === ann.name && !!sigRow.signed_at && sigRow.lab_id === A.labId && sigRow.signed_document_hash === "madeuphash", JSON.stringify({ v: sigRow.version_id, at: sigRow.signed_at }));
    const row = (await call("GET", `/api/staff-portal-session/policies?employee_id=${ann.emp}`, undefined, ann.token)).body.policies.find((p: any) => p.document_id === docChem);
    check("5. their list reads signed, and the bell drops it", row.signed === true && !(await bellIds(ann)).includes(docChem));
    check("5. their document list agrees", (await call("GET", `${P}/documents`, undefined, ann.token)).body.documents.find((d: any) => d.id === docChem).my_read_sign === "signed");
    check("5. nobody signs for someone else", (await call("POST", `/api/staff-portal-session/policies/${docChem}/sign`, { employee_id: bea.emp, version_id: curV, typed_signature: "Someone" }, ann.token)).status === 403);
    const D = `${P}/documents/${docChem}`;
    await upload(A, {}, `${D}/versions`);
    check("5. a new version in review leaves their list until approved", !(await listIds(ann)).includes(docChem));
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(docChem);
    const afterMinor = (await call("GET", `/api/staff-portal-session/policies?employee_id=${ann.emp}`, undefined, ann.token)).body.policies.find((p: any) => p.document_id === docChem);
    check("5. a re-sign lab asks again on a minor revision (the default)", afterMinor.signed === false && (await bellIds(ann)).includes(docChem));
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: true }, A.token);
    const carried = (await call("GET", `/api/staff-portal-session/policies?employee_id=${ann.emp}`, undefined, ann.token)).body.policies.find((p: any) => p.document_id === docChem);
    check("5. a lab that carries minor revisions doesn't ask", carried.signed === true && carried.carried_forward === true && !(await bellIds(ann)).includes(docChem));
    await upload(A, { is_major_revision: "true" }, `${D}/versions`);
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(docChem);
    const afterMajor = (await call("GET", `/api/staff-portal-session/policies?employee_id=${ann.emp}`, undefined, ann.token)).body.policies.find((p: any) => p.document_id === docChem);
    check("5. a major version asks again, even so", afterMajor.signed === false && afterMajor.version_label === "2.0" && (await bellIds(ann)).includes(docChem), JSON.stringify({ s: afterMajor.signed, l: afterMajor.version_label }));
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: false }, A.token);
    check("5. the second signature is on the new version", (await signAs(docChem, ann)).status === 200 && (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?").get(docChem, ann.emp) as any).n === 2);
    // An older per-person assignment still reaches a Staff login who has no rule.
    const solo = await mkDoc("Made-up One person document", safety);
    const fixed = await call("POST", `${P}/documents/${solo}/attestations`, { assignedToUserIds: [dee.userId] }, A.token);
    check("5. an older per-person assignment still shows for that person", fixed.status === 201 && (await listIds(dee)).includes(solo) && (await signAs(solo, dee)).status === 200);
    check("5. and their signature closes it", !!(sqlite.prepare("SELECT completed_at FROM policy_attestations WHERE document_id = ? AND assigned_to_user_id = ?").get(solo, dee.userId) as any).completed_at);
    check("5. nobody else sees it", !(await listIds(ann)).includes(solo));

    // 6. Staff limits
    await signAs(docSafety, zork); // the coworker has signed something
    const REFUSED = [
      `${P}/documents/${docSafety}/attestations`,
      `${P}/documents/${docSafety}/signature-status`,
      `${P}/documents/${docSafety}/signature-report.xlsx`,
      `${P}/documents/${docSafety}/signoffs`,
      `${P}/documents/${docSafety}/audit-trail`,
      `${P}/documents/${docSafety}/pending-step`,
      `${P}/compliance`,
      `${P}/compliance/xlsx`,
      `${P}/read-sign?scope=lab`,
      `${P}/read-sign/tracker?scope=lab`,
      `${P}/read-sign/notice?scope=lab`,
      `${P}/delegations`,
      `${P}/surveyor-links`,
      `${P}/manuals/${chemManual}/approvers`,
    ];
    for (const url of REFUSED) {
      const r = await call("GET", url, undefined, ann.token);
      check(`6. a Staff login can't read ${url.replace(P, "").replace(/\d+/g, ":id")}`, r.status === 403 && r.body.code === "STAFF_OWN_ONLY", `HTTP ${r.status}`);
    }
    const sneaky = [
      `/api/labs/${A.labId}/VERITAPOLICY/documents/${docSafety}/signature-status`,
      `${P}/documents/${docSafety}/signature-status/`,
      `${P}/Documents/${docSafety}/Signature-Status`,
    ];
    for (const url of sneaky) {
      const r = await call("GET", url, undefined, ann.token);
      check(`6. the same read by another spelling is refused: ${url.replace(/\d+/g, ":id").slice(-46)}`, r.status === 403 || r.status === 404, `HTTP ${r.status}`);
    }
    check("6. assigning is refused", (await assign({ scope: "document", id: docSafety, group_ids: [micro] }, ann.token)).status === 403);
    const zorkVersions = await call("GET", `${P}/documents/${docChem}`, undefined, ann.token);
    check("6. they read the current version only", zorkVersions.body.versions?.length === 1, `${zorkVersions.body.versions?.length} versions`);
    const oldV = (sqlite.prepare("SELECT id FROM policy_versions WHERE document_id = ? AND id != ? ORDER BY id LIMIT 1").get(docChem, (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(docChem) as any).v) as any).id;
    check("6. an older version doesn't open", (await call("GET", `${P}/documents/${docChem}/versions/${oldV}/render`, undefined, ann.token)).status === 403);
    const links = await call("GET", `${P}/documents/${docSafety}/links`, undefined, ann.token);
    check("6. the link picker doesn't list drafts", links.status === 200 && links.body.candidates.length === 0);

    // The sweep: every VeritaDC read, including any added after this was written.
    const routes: string[] = [];
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) if (typeof p === "string" && p.startsWith("/api/labs/:labId/veritapolicy")) routes.push(p);
    }
    const fill = (p: string, docId: number) => p.replace(/:labId/g, String(A.labId)).replace(/:versionId/g, String(oldV)).replace(/:manualId/g, String(chemManual)).replace(/:[A-Za-z_]+/g, String(docId));
    const leaks: string[] = [];
    for (const r of routes) {
      for (const id of [docSafety, draft.id]) {
        const out = await fetch(base + fill(r, id) + (r.endsWith("/read-sign") || r.includes("/read-sign/") ? "?scope=lab" : ""), { headers: { Authorization: `Bearer ${ann.token}` } });
        const text = await out.text();
        if (/Quillfeather|SECRETDRAFT/.test(text)) leaks.push(`${out.status} ${r}`);
      }
    }
    check(`6. no VeritaDC read (${routes.length} routes) shows a Staff login a coworker's name or a draft`, routes.length > 40 && leaks.length === 0, leaks.join(" | "));
    // Every lab-wide read in the app, for the draft's title.
    const labReads: string[] = [];
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) {
        if (typeof p === "string" && p.startsWith("/api/labs/:labId/") && p.split(":").length === 2 && !/export|backup|\.zip|pdf/i.test(p)) labReads.push(p);
      }
    }
    const draftLeaks: string[] = [];
    for (const r of labReads) {
      const out = await fetch(base + r.replace(":labId", String(A.labId)), { headers: { Authorization: `Bearer ${ann.token}` } });
      if (/SECRETDRAFT/.test(await out.text())) draftLeaks.push(`${out.status} ${r}`);
    }
    check(`6. no lab-wide read (${labReads.length} tried) shows a Staff login a draft's title`, labReads.length > 100 && draftLeaks.length === 0, draftLeaks.join(" | "));

    // 7. Who stays unlimited
    const editor = await addStaffLogin(A, "Edna", "Editor", '{"mode":"custom","overrides":{"veritapolicy":"edit"}}');
    check("7. a Staff seat given edit on VeritaDC sees every document", (await docIds(editor)).includes(draft.id));
    check("7. and the tracker", (await call("GET", `${P}/documents/${docSafety}/signature-status`, undefined, editor.token)).status === 200);
    // Michael 2026-11-11: a Staff seat never edits, whatever its stored permissions say (shared/seatEditRule.ts), so the edit
    // stored on this seat no longer assigns. Its reads above are left as they were (tests/integration/staff-seat-no-edit.test.ts).
    const editorAssign = await assign({ scope: "document", id: docMicro, group_ids: [chem] }, editor.token);
    check("7. but can't assign: a Staff seat never edits", editorAssign.status === 403, `HTTP ${editorAssign.status} ${editorAssign.body.error || ""}`);
    check("7. the owner reads the tracker", (await call("GET", `${P}/documents/${docSafety}/signature-status`, undefined, A.token)).status === 200);
    const viewer = await call("POST", "/api/auth/register", { email: `readsign-viewer-${stamp}@example.com`, password: PW, name: "View Only", hipaa_acknowledged: true });
    const viewerId = Number(viewer.body.user?.id ?? viewer.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(A.labId, viewerId, now, now, now);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, 'active', 'view_only', ?, '{\"mode\":\"view_all\"}')").run(A.userId, `readsign-viewer-${stamp}@example.com`, viewerId, A.labId);
    check("7. a view-only reviewer isn't limited", (await call("GET", `${P}/documents/${draft.id}`, undefined, viewer.body.token)).status === 200);
    check("7. the bell and list say a limited person is limited", ((await call("GET", "/api/labs/me", undefined, ann.token)).body as any[]).find((m) => m.labId === A.labId)?.documentsOwnOnly === true
      && ((await call("GET", "/api/labs/me", undefined, A.token)).body as any[]).find((m) => m.labId === A.labId)?.documentsOwnOnly === false
      && ((await call("GET", "/api/labs/me", undefined, editor.token)).body as any[]).find((m) => m.labId === A.labId)?.documentsOwnOnly === false);
    const fay = await addStaffLogin(A, "Fay", "Former");
    await addMember(chem, { employee_id: fay.emp });
    check("7. before deactivation she sees the group's documents", (await docIds(fay)).length > 0);
    sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ?").run(fay.userId);
    check("7. a deactivated seat sees nobody's documents", (await docIds(fay)).length === 0 && (await call("GET", `${P}/documents/${docSafety}/signature-status`, undefined, fay.token)).status === 403);
    const faytbl = (await call("GET", `${P}/groups`, undefined, A.token)).body.groups.find((g: any) => g.id === chem).members.find((m: any) => m.employee_id === fay.emp);
    await call("DELETE", `${P}/groups/${chem}/members/${faytbl.id}`, undefined, A.token);
    sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(fay.emp);

    // 8. The tracker and signature list, by group
    const st = await call("GET", `${P}/documents/${docSafety}/signature-status`, undefined, A.token);
    const person = (emp: number) => st.body.people.find((p: any) => p.employee_id === emp);
    check("8. the signature list says who is assigned", person(ann.emp)?.assigned === true && person(nia)?.assigned === true && person(eve.emp)?.assigned === false, JSON.stringify(person(eve.emp)));
    check("8. who owes it", person(zork.emp)?.owes === false && person(zork.emp)?.status === "signed" && person(ann.emp)?.owes === true);
    check("8. someone nobody assigned doesn't owe it", person(eve.emp)?.owes === false && person(eve.emp)?.status === "not_signed");
    check("8. and each person's groups", person(cal.emp)?.groups?.join() === "Made-up Chemistry,Made-up Micro", JSON.stringify(person(cal.emp)?.groups));
    const chemRow = st.body.groups.find((g: any) => g.id === chem);
    check("8. each group's standing", chemRow?.assigned === true && chemRow?.total === 4 && chemRow?.signed === 1, JSON.stringify(chemRow));
    check("8. a group with nobody in it isn't listed", !st.body.groups.some((g: any) => g.id === empty));
    check("8. a summary of who owes it", st.body.summary.assigned === 6 && st.body.summary.assigned_signed === 1 && st.body.summary.owes === 5, JSON.stringify(st.body.summary));
    check("8. no login is flagged", person(nia)?.has_login === false);
    const track = await call("GET", `${P}/read-sign/tracker?scope=manual&id=${chemManual}`, undefined, A.token);
    const bucket = (key: string) => track.body.groups?.find((g: any) => g.key === key);
    check("8. the roll-up answers by group", track.status === 200 && bucket(`group:${chem}`)?.people === 4 && bucket(`group:${micro}`)?.people === 2, JSON.stringify(track.body.groups?.map((g: any) => [g.key, g.people, g.documents, g.signed, g.owes])));
    check("8. a group's sign-offs are its people times its documents", bucket(`group:${chem}`).signed + bucket(`group:${chem}`).owes === bucket(`group:${chem}`).people * bucket(`group:${chem}`).documents);
    check("8. and names the document count", track.body.documents >= 2);
    const labTrack = await call("GET", `${P}/read-sign/tracker?scope=lab`, undefined, A.token);
    await mkDoc("Made-up Nobody has this", safety);
    check("8. unassigned documents are counted", (await call("GET", `${P}/read-sign/tracker?scope=lab`, undefined, A.token)).body.unassigned_documents === labTrack.body.unassigned_documents + 1);
    // A signature on 1.0 of a document now at 1.1: counted in a lab that carries minor revisions, not in one that doesn't.
    await signAs(docAnalyzer, cal);
    await upload(A, {}, `${P}/documents/${docAnalyzer}/versions`);
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(docAnalyzer);
    // The fast roll-up and the per-document list agree, person by person, with minor revisions off and on.
    for (const carry of [false, true]) {
      await call("PUT", `${P}/settings/minor-revisions`, { carryForward: carry }, A.token);
      const roll = (await call("GET", `${P}/read-sign/tracker?scope=lab`, undefined, A.token)).body;
      const approved = (await call("GET", `${P}/documents`, undefined, A.token)).body.documents.filter((d: any) => d.status === "approved");
      const count = new Map<number, { documents: number; signed: number; owes: number }>();
      for (const d of approved) {
        const one = (await call("GET", `${P}/documents/${d.id}/signature-status`, undefined, A.token)).body;
        if (one.read_and_sign_required === false) continue;
        for (const p of one.people) {
          if (!p.assigned) continue;
          const c = count.get(p.employee_id) ?? { documents: 0, signed: 0, owes: 0 };
          c.documents += 1;
          if (p.status === "signed") c.signed += 1; else c.owes += 1;
          count.set(p.employee_id, c);
        }
      }
      const mismatches = roll.people.filter((p: any) => {
        const c = count.get(p.employee_id);
        return !c || c.documents !== p.documents || c.signed !== p.signed || c.owes !== p.owes;
      }).map((p: any) => p.name);
      check(`8. the roll-up agrees with each document's list, person by person (carry forward ${carry})`, mismatches.length === 0 && roll.people.length === count.size, `${mismatches.join(", ")} (${roll.people.length} / ${count.size})`);
    }
    await call("PUT", `${P}/settings/minor-revisions`, { carryForward: false }, A.token);
    const xlsx = await fetch(`${base}${P}/documents/${docSafety}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${A.token}` } });
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()) as any);
    const roster = wb.getWorksheet("Everyone on the Roster");
    const byName = new Map<string, any>();
    roster?.eachRow((r, n) => { if (n > 1) byName.set(String(r.getCell(1).value), r); });
    check("8. the Excel roster says who is assigned and their groups", byName.get("Chem, Ann")?.getCell(8).value === "Yes" && byName.get("Chem, Ann")?.getCell(9).value === "Made-up Chemistry", String(byName.get("Chem, Ann")?.getCell(9).value));
    const bySheet = wb.getWorksheet("By Group");
    const groupLines: string[] = [];
    bySheet?.eachRow((r, n) => { if (n > 1) groupLines.push(`${r.getCell(1).value}:${r.getCell(2).value}:${r.getCell(3).value}:${r.getCell(4).value}:${r.getCell(5).value}`); });
    check("8. the Excel report has a by-group sheet", groupLines.includes("Made-up Chemistry:Yes:4:1:3"), JSON.stringify(groupLines));
    check("8. another lab can't read the tracker", [403, 404].includes((await call("GET", `${P}/read-sign/tracker?scope=lab`, undefined, B.token)).status));

    // 9. The notice
    const noticeQ = `scope=manual&id=${microManual}`;
    const plan = await call("GET", `${P}/read-sign/notice?${noticeQ}`, undefined, A.token);
    check("9. the notice says how many it will reach before it sends", plan.status === 200 && plan.body.recipients === 2 && plan.body.no_login_or_address === 0, JSON.stringify(plan.body));
    check("9. looking sent nothing", mail.length === 0);
    const wrong = await call("POST", `${P}/read-sign/notice`, { scope: "manual", id: microManual, confirm_count: 99 }, A.token);
    check("9. a count that doesn't match sends nothing", wrong.status === 409 && wrong.body.code === "COUNT_CHANGED" && mail.length === 0, `HTTP ${wrong.status}`);
    check("9. a Staff login can't send one", (await call("POST", `${P}/read-sign/notice`, { scope: "manual", id: microManual, confirm_count: 2 }, ann.token)).status === 403);
    const sent = await call("POST", `${P}/read-sign/notice`, { scope: "manual", id: microManual, confirm_count: 2 }, A.token);
    check("9. the send answers at once", sent.status === 202 && sent.body.sending === 2, `HTTP ${sent.status}`);
    for (let i = 0; i < 40 && !(sqlite.prepare("SELECT 1 FROM policy_audit_log WHERE lab_id = ? AND action = 'read_sign_notice_finished'").get(A.labId)); i++) await new Promise((done) => setTimeout(done, 50));
    check("9. one email per person", mail.length === 2 && new Set(mail.map((m) => m.to)).size === 2, JSON.stringify(mail.map((m) => m.to)));
    check("9. each to one address", mail.every((m) => !m.to.includes(",") && !m.to.includes(";")));
    check("9. saying how many documents, with no em dash", mail.every((m) => /\d+ documents? to read and sign/.test(m.subject) && !/[—–]/.test(m.subject + m.html) && /my-signoffs/.test(m.html)), mail[0]?.subject);
    check("9. the audit says what went out", (JSON.parse((sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'read_sign_notice_finished'").get(A.labId) as any).details)).sent === 2);
    const twice = await call("POST", `${P}/read-sign/notice`, { scope: "manual", id: microManual, confirm_count: 2 }, A.token);
    check("9. the same notice can't go twice in a day", twice.status === 409 && twice.body.code === "NOTICE_RECENT" && mail.length === 2, `HTTP ${twice.status}`);
    const planChem = await call("GET", `${P}/read-sign/notice?scope=manual&id=${chemManual}`, undefined, A.token);
    check("9. someone with no login isn't on the list, and is counted", planChem.body.no_login_or_address === 1 && planChem.body.recipients >= 3, JSON.stringify(planChem.body));

    // 10. Taking off, retiring, other labs, types, delete, export
    const onSafety = (await call("GET", `${P}/read-sign?scope=document&id=${docSafety}`, undefined, A.token)).body;
    const chemOnSafety = onSafety.rows.find((r: any) => r.direct && r.group_id === chem);
    check("10. the assignment names who it reaches", chemOnSafety?.people === 4 && chemOnSafety?.label === "Made-up Chemistry", JSON.stringify(chemOnSafety));
    const onAnalyzer = (await call("GET", `${P}/read-sign?scope=document&id=${docAnalyzer}`, undefined, A.token)).body;
    const fromManual = onAnalyzer.rows.find((r: any) => !r.direct && r.group_id === chem);
    check("10. a document shows what it inherits, and from where", fromManual?.scope_label === "Made-up Hospital › Made-up Chemistry Manual", JSON.stringify(fromManual));
    const retireWhile = await call("PUT", `${P}/groups/${chem}`, { retired: true }, A.token);
    check("10. a group on an assignment can't be retired", retireWhile.status === 409 && retireWhile.body.code === "GROUP_ON_READ_SIGN", `HTTP ${retireWhile.status}`);
    const beforeRemove = (await listIds(zork)).includes(docSafety);
    const removed = await call("DELETE", `${P}/read-sign/${chemOnSafety.id}`, undefined, A.token);
    check("10. taking it off stops it being owed", beforeRemove && removed.status === 200 && !(await listIds(ann)).includes(docSafety));
    check("10. the signature stays", !!sqlite.prepare("SELECT 1 FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?").get(docSafety, zork.emp));
    check("10. and the row stays as history", !!(sqlite.prepare("SELECT removed_at FROM policy_read_sign_assignments WHERE id = ?").get(chemOnSafety.id) as any).removed_at);
    const reassign = await assign({ scope: "document", id: docSafety, group_ids: [chem] });
    check("10. it can be assigned again", reassign.body.added === 1 && (await listIds(ann)).includes(docSafety));
    await call("DELETE", `${P}/read-sign/${reassign.body.rows.find((r: any) => r.direct && r.group_id === chem).id}`, undefined, A.token);
    check("10. a Staff login can't take one off", (await call("DELETE", `${P}/read-sign/${chemOnSafety.id}`, undefined, ann.token)).status === 403);
    const gB = (await call("POST", `/api/labs/${B.labId}/veritapolicy/groups`, { name: "Other lab group" }, B.token)).body.groups[0].id;
    const empB = addEmployee(B, "Other", "Person");
    const manualB = (await call("POST", `/api/labs/${B.labId}/veritapolicy/manuals`, { name: "Other lab manual" }, B.token)).body.id;
    check("10. another lab's group is refused", (await assign({ scope: "document", id: docSafety, group_ids: [gB] })).status === 400);
    check("10. another lab's person is refused", (await assign({ scope: "document", id: docSafety, employee_ids: [empB] })).status === 400);
    check("10. another lab's manual is refused", (await assign({ scope: "manual", id: manualB, everyone: true })).status === 404);
    check("10. another lab's document is refused", (await assign({ scope: "document", id: otherLabDoc.id, everyone: true })).status === 404);
    check("10. another lab can't assign here", [403, 404].includes((await assign({ scope: "document", id: docSafety, everyone: true }, B.token)).status));
    check("10. another lab's assignment can't be taken off from here", (await call("DELETE", `/api/labs/${B.labId}/veritapolicy/read-sign/${chemOnSafety.id}`, undefined, B.token)).status === 404);
    const form = await mkDoc("Made-up Request form", chemManual, { doc_type: "form" });
    sqlite.prepare("INSERT OR REPLACE INTO policy_doc_type_settings (lab_id, doc_type, requires_read_and_sign, requires_periodic_review, updated_at) VALUES (?, 'form', 0, 0, ?)").run(A.labId, now);
    const typed = await assign({ scope: "document", id: form, group_ids: [chem] });
    check("10. a type with no read-and-sign can't be assigned on its own", typed.status === 409 && typed.body.code === "TYPE_NO_READ_AND_SIGN", `HTTP ${typed.status}`);
    check("10. under an assigned manual it asks for no signature", !(await listIds(ann)).includes(form) && !(await bellIds(ann)).includes(form));
    const asDoc = (await call("GET", `${P}/documents`, undefined, ann.token)).body.documents.find((d: any) => d.id === form);
    check("10. but it is in their document list, with nothing to sign", asDoc?.my_read_sign === "none", JSON.stringify(asDoc?.my_read_sign));
    const signForm = await signAs(form, ann);
    check("10. and signing it is refused", signForm.status === 409 && signForm.body.code === "TYPE_NO_READ_AND_SIGN", `HTTP ${signForm.status}`);
    const doomed = await mkDoc("Made-up Deleted document", safety);
    await assign({ scope: "document", id: doomed, everyone: true });
    await call("DELETE", `${P}/documents/${doomed}`, undefined, A.token);
    check("10. deleting a document deletes its assignment", !sqlite.prepare("SELECT 1 FROM policy_read_sign_assignments WHERE document_id = ?").get(doomed));
    const { EXPORT_TABLES } = await import("../../server/exportAllTables") as any;
    check("10. the table is in the customer's export", !!EXPORT_TABLES?.policy_read_sign_assignments, Object.keys(EXPORT_TABLES || {}).length + " tables");
    const adminAll = await fetch(`${base}/api/admin/veritadc/read-sign/status`, { headers: { "x-admin-secret": ADMIN } });
    const adminOne = await fetch(`${base}/api/admin/veritadc/read-sign/status?labId=${A.labId}`, { headers: { "x-admin-secret": ADMIN } });
    check("10. the admin status route is secret-gated and counts only", (await fetch(`${base}/api/admin/veritadc/read-sign/status`)).status === 403 && adminAll.status === 200 && !/Made-up/.test(await adminOne.text()));

    // 11. The one-time seed
    const fresh = await Promise.all(["keep", "carried", "nodocs", "nostaff", "signedonly"].map((t) => mkLab(`seed-${t}-x`)));
    const [keep, carriedLab, noDocs, noStaff, signedOnly] = fresh;
    const seatFor = async (L: any, first: string) => addStaffLogin(L, `${first}`, "Seeded");
    await seatFor(keep, "Kay");
    await seatFor(carriedLab, "Cat");
    await seatFor(noDocs, "Nat");
    const seedDoc = async (L: any) => {
      const d = await upload(L, { title: "Made-up seed document" });
      sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(d.id);
      return d.id as number;
    };
    await seedDoc(keep);
    const carriedDoc = await seedDoc(carriedLab);
    sqlite.prepare("INSERT INTO policy_carried_records (lab_id, document_id, version_id, source_system, source_number) SELECT lab_id, id, current_version_id, 'Made-up prior system', 'X1' FROM policy_documents WHERE id = ?").run(carriedDoc);
    await seedDoc(noStaff);
    const signedDoc = await seedDoc(signedOnly);
    const signedVersion = (sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(signedDoc) as any).v;
    sqlite.prepare("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, typed_signature) VALUES (?, ?, ?, ?, 'Made-up')").run(signedOnly.labId, signedDoc, signedVersion, addEmployee(signedOnly, "Sid", "Signed"));
    // Lab A has its own assignments and would be seeded too; only these five are looked at.
    const dbPath = process.env.DB_PATH as string;
    const copy = path.resolve(path.dirname(dbPath), `.tmp-readsign-seed-${stamp}.db`);
    sqlite.prepare("VACUUM INTO ?").run(copy);
    const c1 = new Database(copy);
    c1.exec("DROP TABLE policy_read_sign_assignments");
    c1.close();
    const boot = () => spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./server/db.ts').then(()=>process.exit(0))"], {
      env: { ...process.env, DB_PATH: copy }, encoding: "utf8", timeout: 180000, cwd: process.cwd(),
    });
    const first = boot();
    check("11. the boot that creates the table runs", first.status === 0, (first.stderr || "").slice(-300));
    const c2 = new Database(copy);
    const seeded = (labId: number) => c2.prepare("SELECT scope_type, target_type, origin FROM policy_read_sign_assignments WHERE lab_id = ? AND removed_at IS NULL").all(labId) as any[];
    const kept = seeded(keep.labId);
    check("11. a lab with staff and approved documents keeps what it had", kept.length === 1 && kept[0].scope_type === "lab" && kept[0].target_type === "everyone" && kept[0].origin === "kept_as_it_was", JSON.stringify(kept));
    check("11. a lab where staff already signed keeps it too", seeded(signedOnly.labId).length === 1);
    check("11. a lab with carried-over documents does not", seeded(carriedLab.labId).length === 0);
    check("11. a lab with no approved documents does not", seeded(noDocs.labId).length === 0);
    check("11. a lab with no staff does not", seeded(noStaff.labId).length === 0);
    // An editor takes it off; a later boot must not put it back.
    c2.prepare("UPDATE policy_read_sign_assignments SET removed_at = datetime('now') WHERE lab_id = ?").run(keep.labId);
    c2.close();
    const second = boot();
    const c3 = new Database(copy);
    check("11. a later boot adds nothing back", second.status === 0 && (c3.prepare("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ? AND removed_at IS NULL").get(keep.labId) as any).n === 0);
    c3.close();
    for (const suffix of ["", "-wal", "-shm"]) { try { fs.unlinkSync(copy + suffix); } catch { /* not there */ } }
    // On the running DB: once the same row exists, the kept lab's staff list what they listed before.
    seedLabsAlreadyWorkingTheOldWay(sqlite);
    check("11. run twice, it adds no second row", (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ?").get(keep.labId) as any).n === 1 && (seedLabsAlreadyWorkingTheOldWay(sqlite), (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ?").get(keep.labId) as any).n === 1));
    const kay = sqlite.prepare("SELECT seat_user_id AS u, staff_employee_id AS e FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal'").get(keep.labId) as any;
    const kayToken = issueSession(sqlite, kay.u, { headers: { "user-agent": "read-sign-test" }, ip: "127.0.0.1" }).token as string;
    check("11. a kept lab's Staff login lists its document", ((await call("GET", `/api/staff-portal-session/policies?employee_id=${kay.e}`, undefined, kayToken)).body.policies || []).length === 1);
    const catRow = sqlite.prepare("SELECT seat_user_id AS u, staff_employee_id AS e FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal'").get(carriedLab.labId) as any;
    const catToken = issueSession(sqlite, catRow.u, { headers: { "user-agent": "read-sign-test" }, ip: "127.0.0.1" }).token as string;
    check("11. a carried-over lab's Staff login lists nothing", ((await call("GET", `/api/staff-portal-session/policies?employee_id=${catRow.e}`, undefined, catToken)).body.policies || []).length === 0);
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
