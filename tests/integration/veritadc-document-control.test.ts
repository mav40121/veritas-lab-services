// tests/integration/veritadc-document-control.test.ts
//
// STANDING integration test for VeritaDC document control, B13 part 1 (server/policyDocumentControl.ts, policyVersionStanding.ts,
// policyNotices.ts):
//   0. The tables and settings exist, and both notices are off in a new lab.
//   1. Editors and the approvers on a document's route open its earlier versions read-only, and each says what it is (current,
//      approved version in effect, superseded, draft never approved). A limited Staff login reads the approved version only, with
//      nothing added to any answer (BUG-151); a view-only reviewer and a surveyor link see what they saw.
//   2. Archived documents: editors list, open and restore them; a reviewer, a Staff login and another lab read none, by any
//      spelling of the number. A restored document comes back as it was, with no new signature. Support can't restore.
//   3. Bulk approval: one name and password, one signature and audit row per document exactly as a single approval writes them.
//      What moved since the list was shown is refused and the rest still go. Wrong password, wrong role, wrong lab, a Staff login
//      and a support login sign nothing. There is no bulk reject.
//   4. Approval emails: off by default; only the lab's owner or an admin turns them on (not support). Once per submission per
//      step, to each member of a group step, honoring delegation, an author the step blocks, and live logins.
//   5. Overdue read-and-sign: off by default; one email per person in 7 days across every lab, to live logins only, with the
//      owner's part; what counts as overdue.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only); no email leaves (readSignMailer is swapped out).
// Run: npm run test:veritadc-document-control

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { readSignMailer } from "../../server/policyReadSign";
import { notifyStepSigners, runOverdueSignNotices } from "../../server/policyNotices";
import { EXPORT_TABLES } from "../../server/exportAllTables";
import { purgeRule } from "../../server/customerPurge";

(globalThis as any).require ??= createRequire(import.meta.url);
delete process.env.RESEND_API_KEY; // belt and braces: the mailer is swapped out below

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const EM_DASH = String.fromCharCode(0x2014);
const DAY = 86400000;

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
  const PW = ["Control", "doc", "13!"].join("-");
  const now = new Date().toISOString();
  const stamp = Date.now();
  const one = (sql: string, ...a: any[]) => sqlite.prepare(sql).get(...a) as any;
  const all = (sql: string, ...a: any[]) => sqlite.prepare(sql).all(...a) as any[];
  const run = (sql: string, ...a: any[]) => sqlite.prepare(sql).run(...a);

  const mail: Array<{ to: string; subject: string; html: string }> = [];
  let mailFails = false;
  readSignMailer.pauseMs = 0;
  readSignMailer.send = async (m: any) => { if (mailFails) throw new Error("made-up mail outage"); mail.push(m); };
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const taken = async () => { await settle(); return mail.splice(0); };

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json, text, headers: r.headers };
  };

  type Lab = { email: string; token: string; labId: number; userId: number; P: string; name: string };
  type Person = { email: string; userId: number; token: string; emp: number | null; name: string };
  const mkLab = async (tag: string): Promise<Lab> => {
    const email = `dctl-${tag}-${stamp}@example.com`;
    const name = `Owner ${tag.toUpperCase()}`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Control Lab ${tag.toUpperCase()}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token, labId: prov.body.labId, userId: Number(reg.body.user?.id ?? reg.body.id), P: `/api/labs/${prov.body.labId}/veritapolicy`, name };
  };
  const roster = (L: Lab, first: string, last: string, createdAt = "2020-01-01T00:00:00.000Z") => {
    const staffLab = one("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", L.labId)?.id
      ?? Number(run("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Control Lab', ?, ?, ?, ?)", L.userId, `22D00013${L.labId}`, L.labId, now, now).lastInsertRowid);
    return Number(run("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', ?, ?)",
      staffLab, L.labId, L.userId, last, first, createdAt, now).lastInsertRowid);
  };
  // seat: 'active' (VeritaDC edit), 'view_only' (a reviewer), 'staff_portal' (a limited Staff login on the roster).
  const person = async (L: Lab, tag: string, name: string, seat: "active" | "view_only" | "staff_portal", role = "staff"): Promise<Person> => {
    const email = `dctl-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    run("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)", L.labId, userId, role, now, now, now);
    run("UPDATE users SET lab_id = ? WHERE id = ?", L.labId, userId);
    const [first, last] = name.split(" ");
    const emp = seat === "staff_portal" ? roster(L, first, last) : null;
    run("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
      L.userId, email, userId, now, now, seat, L.labId, emp, seat === "active" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}');
    run("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", userId);
    return { email, userId, token: issueSession(sqlite, userId, { headers: { "user-agent": "document-control-test" }, ip: "127.0.0.1" }).token as string, emp, name };
  };
  const file = async (L: Lab, path: string, fields: Record<string, string>, text: string, token = L.token) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "made-up.txt");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const doc = async (L: Lab, title: string, text = `Made-up text for ${title}`, extra: Record<string, string> = {}, token = L.token) => Number((await file(L, `${L.P}/documents`, { title, ...extra }, text, token)).body.id);
  const newVersion = async (L: Lab, id: number, text: string) => Number((await file(L, `${L.P}/documents/${id}/versions`, {}, text)).body.version_id);
  const row = (id: number) => one("SELECT * FROM policy_documents WHERE id = ?", id);
  const submit = (L: Lab, id: number, workflowId: number) => call("POST", `${L.P}/documents/${id}/submit`, { workflowId }, L.token);
  const decide = (L: Lab, id: number, who: { token: string; name: string }, verb = "approve") => call("POST", `${L.P}/documents/${id}/${verb}`, { typedSignature: who.name, password: PW }, who.token);
  const signoffs = (id: number) => all("SELECT * FROM policy_signoffs WHERE document_id = ? ORDER BY id", id);
  const audits = (id: number, action: string) => all("SELECT * FROM policy_audit_log WHERE document_id = ? AND action = ? ORDER BY id", id, action);

  try {
    const A = await mkLab("a");
    const B = await mkLab("b");
    const signer = await person(A, "signer", "Sam Signer", "active");
    const second = await person(A, "second", "Sue Second", "active");
    const editor = await person(A, "editor", "Edna Editor", "active");
    const reviewer = await person(A, "reviewer", "Vic Reviewer", "view_only");
    const staff = await person(A, "staff", "Rowan Quillby", "staff_portal");
    const admin = await person(A, "admin", "Ada Admin", "active", "admin");
    // A Veritas support login: no membership, no seat.
    const supReg = await call("POST", "/api/auth/register", { email: `dctl-support-${stamp}@example.com`, password: PW, name: "Val Support", hipaa_acknowledged: true });
    const support = { token: supReg.body.token as string, userId: Number(supReg.body.user?.id ?? supReg.body.id), name: "Val Support" };
    run("UPDATE users SET vls_support = 1 WHERE id = ?", support.userId);
    check("0. setup: the support login reaches the lab", (await call("GET", `${A.P}/documents`, undefined, support.token)).status === 200);

    const route = async (L: Lab, name: string, steps: any[]) => {
      const wf = await call("POST", `${L.P}/workflows`, { name }, L.token);
      for (const s of steps) {
        const r = await call("POST", `${L.P}/workflows/${wf.body.id}/steps`, s, L.token);
        if (r.status !== 201) console.log("step failed", r.status, r.body);
      }
      return Number(wf.body.id);
    };
    const oneStep = await route(A, "One step", [{ stepName: "Signer approval", requiredRole: "specific_user", specificUserId: signer.userId }]);
    const twoSteps = await route(A, "Two steps", [
      { stepName: "First look", requiredRole: "specific_user", specificUserId: signer.userId },
      { stepName: "Second look", requiredRole: "specific_user", specificUserId: second.userId },
    ]);

    // 0. Schema and defaults
    const tables = all("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => t.name);
    check("0. the notice tables exist", tables.includes("policy_approval_notices") && tables.includes("policy_sign_notices"));
    check("0. they are classified for the export and the purge", ["policy_approval_notices", "policy_sign_notices"].every((t) => EXPORT_TABLES[t]?.scope.kind === "lab" && purgeRule(t)?.kind === "delete"));
    const off = await call("GET", `${A.P}/settings/email-notices`, undefined, A.token);
    check("0. both notices are off in a new lab, 30 days", off.status === 200 && off.body.approvalEmails === false && off.body.overdueEmails === false && off.body.overdueDays === 30 && off.body.canEdit === true, JSON.stringify(off.body));

    // ── 1. Earlier versions ──
    const D = await doc(A, "Made-up Specimen SOP", "MARKER-ONE made up", { doc_number: "SC 13" });
    await call("POST", `${A.P}/read-sign`, { scope: "document", id: D, everyone: true }, A.token);
    await submit(A, D, oneStep);
    check("1. setup: v1 approved", (await decide(A, D, signer)).body.status === "approved");
    const v1 = row(D).current_version_id;
    const v2 = await newVersion(A, D, "MARKER-TWO made up, rejected");
    await submit(A, D, oneStep);
    await decide(A, D, signer, "reject");
    const v3 = await newVersion(A, D, "MARKER-THREE made up");
    await submit(A, D, oneStep);
    check("1. setup: v2 rejected, v3 approved", (await decide(A, D, signer)).body.status === "approved" && row(D).approved_version_id === v3);

    const detail = async (token: string, id = D) => (await call("GET", `${A.P}/documents/${id}`, undefined, token)).body;
    const standings = (d: any) => Object.fromEntries((d.versions || []).map((v: any) => [v.id, v]));
    let s = standings(await detail(A.token));
    check("1. v3 is current, v2 and v1 are superseded", s[v3]?.standing === "current" && s[v2]?.standing === "superseded" && s[v1]?.standing === "superseded", JSON.stringify(s));
    check("1. each says which version is in use now", s[v1]?.in_use_label === s[v3]?.version_label, JSON.stringify(s[v1]));
    check("1. the editor is told they can open them", (await detail(A.token)).can_open_versions === true && (await detail(editor.token)).can_open_versions === true);
    const openV = (v: number, token?: string, L = A, id = D) => call("GET", `${L.P}/documents/${id}/versions/${v}/render`, undefined, token);
    const r1 = await openV(v1, A.token);
    check("1. an editor opens v1: its own text, labelled superseded", r1.status === 200 && r1.text.includes("MARKER-ONE") && !r1.text.includes("MARKER-THREE") && r1.body.standing === "superseded" && r1.body.archived === false, `HTTP ${r1.status} ${r1.text.slice(0, 120)}`);
    const viewed = audits(D, "version_viewed").pop();
    check("1. opening it is on the audit trail: who, when, which version", viewed?.user_id === A.userId && JSON.parse(viewed.details).version_id === v1 && !!viewed.created_at, JSON.stringify(viewed));
    check("1. opening it changes nothing", row(D).current_version_id === v3 && row(D).status === "approved");
    check("1. the approver named on the route opens it", (await openV(v1, signer.token)).body.standing === "superseded");

    // A limited Staff login reads the approved version only (BUG-151), exactly as before B13.
    const MAIN_VERSION_KEYS = ["change_summary", "file_format", "file_hash_sha256", "file_size_bytes", "id", "uploaded_at", "uploaded_by", "version_label", "version_major", "version_minor", "version_number"];
    const keysOf = (o: any) => Object.keys(o || {}).sort().join(",");
    const staffReadsOnly = async (label: string, readId: number, others: number[], text: string) => {
      const d = await detail(staff.token);
      check(`1. ${label}: a Staff login's document lists the approved version alone, with nothing added`, d.versions?.length === 1 && d.versions[0].id === readId && keysOf(d.versions[0]) === MAIN_VERSION_KEYS.join(",") && keysOf(d) === "carried,document,versions", `${keysOf(d)} / ${keysOf(d.versions?.[0])}`);
      const own = await openV(readId, staff.token);
      check(`1. ${label}: the approved version opens, unlabelled`, own.status === 200 && own.text.includes(text) && keysOf(own.body) === "format,html,messages,tampered", `HTTP ${own.status} ${keysOf(own.body)}`);
      const refused = await Promise.all(others.map((v) => openV(v, staff.token)));
      check(`1. ${label}: every other version is refused, as on main`, refused.every((r) => r.status === 403 && r.body.code === "STAFF_OWN_ONLY"), refused.map((r) => `${r.status} ${r.body.code}`).join(" | "));
      for (const path of [`${A.P}/documents/${D}/render`, `${A.P}/documents/${D}/download`, `/api/staff-portal-session/policies/${D}/render`]) {
        const r = await call("GET", path, undefined, staff.token);
        check(`1. ${label}: ${path.replace(/\d+/g, ":id").slice(-40)} gives the approved version only`, r.status === 200 && r.text.includes(text) && !others.some((v) => r.text.includes(MARKERS[v])), `HTTP ${r.status} ${r.text.slice(0, 80)}`);
      }
      const found = await call("GET", `${A.P}/search?q=Specimen`, undefined, staff.token);
      const portal = await call("GET", `/api/staff-portal-session/policies/lookup?q=Specimen`, undefined, staff.token);
      check(`1. ${label}: search and the lookup name the approved version`, found.body.results?.find((r: any) => r.id === D)?.current_version_id === readId && portal.body.results?.find((r: any) => r.document_id === D)?.version_id === readId);
      const links = await call("GET", `${A.P}/documents/${D}/links`, undefined, staff.token);
      check(`1. ${label}: related documents carry no version`, links.status === 200 && !/version/.test(links.text), links.text.slice(0, 120));
    };
    const MARKERS: Record<number, string> = { [v1]: "MARKER-ONE", [v2]: "MARKER-TWO", [v3]: "MARKER-THREE" };
    await staffReadsOnly("approved", v3, [v1, v2], "MARKER-THREE");

    // A view-only reviewer and a surveyor link see what they saw.
    const reviewerSees = async (label: string, current: number, approved: number, others: number[]) => {
      const d = await detail(reviewer.token);
      check(`1. ${label}: a view-only reviewer's list is as it was, with nothing added`, d.versions?.length === others.length + new Set([current, approved]).size && d.versions.every((v: any) => keysOf(v) === MAIN_VERSION_KEYS.join(",")) && keysOf(d) === "carried,document,versions", `${keysOf(d)} / ${keysOf(d.versions?.[0])}`);
      const opened = await openV(current, reviewer.token);
      const refused = await Promise.all(others.map((v) => openV(v, reviewer.token)));
      // B8: the approved version is the procedure in use, so it opens for them while a newer revision is a draft or in review.
      const inUse = await openV(approved, reviewer.token);
      check(`1. ${label}: the approved version opens, unlabelled`, inUse.status === 200 && inUse.text.includes(MARKERS[approved]) && keysOf(inUse.body) === "format,html,messages,tampered", `HTTP ${inUse.status} ${keysOf(inUse.body)}`);
      check(`1. ${label}: they read the document's own version and the approved one, and open no other`, opened.status === 200 && keysOf(opened.body) === "format,html,messages,tampered" && refused.every((r) => r.status === 403 && r.body.code === "EARLIER_VERSION" && !/MARKER/.test(r.text)), `${opened.status} ${refused.map((r) => r.status).join(",")}`);
    };
    await reviewerSees("approved", v3, v3, [v1, v2]);
    const surv = (await call("POST", `${A.P}/surveyor-links`, { label: "Made-up visit" }, A.token)).body.token as string;
    const surveyorSees = async (label: string) => {
      const listed = (await call("GET", `/api/surveyor/${surv}/policies`)).body.documents?.find((d: any) => d.id === D);
      const r = await call("GET", `/api/surveyor/${surv}/policies/${D}/render`);
      const old = await call("GET", `/api/surveyor/${surv}/policies/${D}/versions/${v1}/render`);
      check(`1. ${label}: a surveyor link shows the approved version and has no way to another`, listed?.current_version_number === 3 && r.status === 200 && r.text.includes("MARKER-THREE") && keysOf(r.body) === "format,html,messages,tampered" && old.status !== 200 && !/MARKER/.test(old.text), `${listed?.current_version_number} HTTP ${r.status} ${keysOf(r.body)} old ${old.status}`);
    };
    await surveyorSees("approved");

    // Approvers who aren't editors sign from My sign-offs. One who isn't a limited Staff login (they also hold a reviewer seat) opens
    // earlier versions of documents on a route they sign; a limited Staff login named on the same route still doesn't.
    const both = await person(A, "both", "Bo Both", "staff_portal");
    run("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'view_only', ?, '{\"mode\":\"view_all\"}')", A.userId, both.email, both.userId, now, now, A.labId);
    check("1. before they are on a route, they open none", (await openV(v1, both.token)).status === 403 && (await detail(both.token)).can_open_versions === undefined);
    for (const p of [both, staff]) await call("POST", `${A.P}/workflows/${oneStep}/steps`, { stepName: `${p.name} step`, requiredRole: "specific_user", specificUserId: p.userId }, A.token);
    check("1. an approver on the document's route, not a limited Staff login, opens v1", (await openV(v1, both.token)).body.standing === "superseded" && (await detail(both.token)).can_open_versions === true, `HTTP ${(await openV(v1, both.token)).status}`);
    const named = await detail(staff.token);
    check("1. a limited Staff login named on the route still opens none, and its answers gain nothing", (await openV(v1, staff.token)).status === 403 && named.versions.length === 1 && keysOf(named) === "carried,document,versions" && keysOf(named.versions[0]) === MAIN_VERSION_KEYS.join(",") && keysOf((await openV(v3, staff.token)).body) === "format,html,messages,tampered", keysOf(named));
    for (const st of all("SELECT id FROM policy_approval_steps WHERE workflow_id = ? AND specific_user_id IN (?, ?)", oneStep, both.userId, staff.userId)) await call("DELETE", `${A.P}/workflows/${oneStep}/steps/${st.id}`, undefined, A.token);
    check("1. off the route, they open none again", (await openV(v1, both.token)).status === 403);

    // A revision in progress: v4 replaced by v5, both drafts.
    const v4 = await newVersion(A, D, "MARKER-FOUR made up draft");
    const v5 = await newVersion(A, D, "MARKER-FIVE made up draft");
    MARKERS[v4] = "MARKER-FOUR"; MARKERS[v5] = "MARKER-FIVE";
    s = standings(await detail(A.token));
    check("1. during a revision the approved version is in effect, not superseded", s[v3]?.standing === "in_effect" && s[v5]?.standing === "current", JSON.stringify({ v3: s[v3]?.standing, v5: s[v5]?.standing }));
    check("1. a draft replaced before approval reads never approved", s[v4]?.standing === "not_approved", s[v4]?.standing);
    check("1. v1 still names v3 as the version in use", s[v1]?.in_use_label === s[v3]?.version_label);
    await staffReadsOnly("revision in progress", v3, [v1, v2, v4, v5], "MARKER-THREE");
    await reviewerSees("revision in progress", v5, v3, [v1, v2, v4]);
    await surveyorSees("revision in progress");
    const neverApproved = await doc(A, "Made-up never approved", "MARKER-NEVER one");
    const na1 = row(neverApproved).current_version_id;
    await newVersion(A, neverApproved, "MARKER-NEVER two");
    check("1. a document a Staff login can't read: its versions are closed too", (await openV(na1, staff.token, A, neverApproved)).status === 404);
    // Wrong lab, wrong document, signed out
    check("1. another lab's owner is refused", (await openV(v1, B.token)).status === 403 && (await openV(v1, B.token, B)).status === 403, `${(await openV(v1, B.token, B)).status}`);
    check("1. a version asked for under another document is not found", (await openV(v1, A.token, A, neverApproved)).status === 404);
    check("1. signed out is refused", (await openV(v1)).status === 401);
    check("1. support reads a version, as it reads the document", (await openV(v1, support.token)).status === 200);

    // ── 2. Archived documents ──
    const ar = await doc(A, "Made-up retired SOP", "MARKER-RETIRED one", { doc_number: "RT 13" });
    await submit(A, ar, oneStep);
    await decide(A, ar, signer);
    run("UPDATE policy_documents SET effective_date = '2025-02-03', next_review_date = '2027-02-03' WHERE id = ?", ar);
    const before = row(ar);
    check("2. setup: archived", (await call("POST", `${A.P}/documents/${ar}/archive`, {}, editor.token)).status === 200 && !!row(ar).archived_at);
    const list = (token: string, L = A) => call("GET", `${L.P}/archived-documents`, undefined, token);
    const edList = await list(editor.token);
    const listed = edList.body.documents?.find((d: any) => d.id === ar);
    check("2. an editor lists it: status, version, when and by whom", edList.status === 200 && listed?.status === "approved" && listed?.current_version_label === "1.0" && !!listed?.archived_at && listed?.archived_by === editor.name && edList.body.can_restore === true, JSON.stringify(listed));
    check("2. the list holds archived documents only", edList.body.documents.every((d: any) => !!d.archived_at) && !edList.body.documents.some((d: any) => d.id === D));
    const reads = (id: string | number) => ["", "/render", "/download", `/versions/${before.current_version_id}/render`, "/signoffs", "/audit-trail", "/notes", "/links"].map((x) => `${A.P}/documents/${id}${x}`);
    for (const url of reads(ar)) check(`2. an editor opens it: ${url.slice(A.P.length).replace(/\d+/g, ":id")}`, (await call("GET", url, undefined, editor.token)).status === 200);
    check("2. the open version says archived", (await openV(before.current_version_id, editor.token, A, ar)).body.archived === true);
    const refusedReviewer: string[] = [], refusedStaff: string[] = [];
    for (const url of [...reads(ar), ...reads(`${ar}.0`), ...reads(`0${ar}`)]) {
      const r = await call("GET", url, undefined, reviewer.token);
      if (r.status === 200 || /MARKER-RETIRED|retired SOP/.test(r.text)) refusedReviewer.push(`${r.status} ${url}`);
      const t = await call("GET", url, undefined, staff.token);
      if (t.status === 200 || /MARKER-RETIRED|retired SOP/.test(t.text)) refusedStaff.push(`${t.status} ${url}`);
    }
    check("2. a reviewer who can't edit reads none of it, by any spelling of its number", refusedReviewer.length === 0, refusedReviewer.join(" | "));
    check("2. a Staff login reads none of it", refusedStaff.length === 0, refusedStaff.join(" | "));
    check("2. a reviewer can't list archived documents", (await list(reviewer.token)).status === 403);
    check("2. to a Staff login the list isn't there", (await list(staff.token)).status === 404);
    check("2. nor another lab, under either lab's path", (await list(B.token)).status === 403 && !(await list(B.token, B)).body.documents.some((d: any) => d.id === ar));
    check("2. the active list, as before, doesn't show it", !(await call("GET", `${A.P}/documents`, undefined, A.token)).body.documents.some((d: any) => d.id === ar));
    const restore = (id: number, token: string, L = A) => call("POST", `${L.P}/documents/${id}/restore`, {}, token);
    check("2. a reviewer, a Staff login and another lab can't restore it", (await restore(ar, reviewer.token)).status === 403 && (await restore(ar, staff.token)).status === 404 && (await restore(ar, B.token)).status === 403 && (await restore(ar, B.token, B)).status === 403 && !!row(ar).archived_at);
    const supRestore = await restore(ar, support.token);
    check("2. support sees the list, offered no restore, and is refused one", (await list(support.token)).body.can_restore === false && supRestore.status === 403 && supRestore.body.code === "VLS_SUPPORT_CANNOT_SIGN" && !!row(ar).archived_at, `${supRestore.status} ${supRestore.body.code}`);
    const signedBefore = signoffs(ar).length;
    const back = await restore(ar, editor.token);
    const after = row(ar);
    const same = ["status", "current_version_id", "approved_version_id", "effective_date", "next_review_date", "workflow_id", "manual_id", "doc_number", "title", "owner_user_id"].filter((k) => before[k] !== after[k]);
    check("2. an editor restores it", back.status === 200 && after.archived_at === null && back.body.status === "approved", JSON.stringify(back.body));
    check("2. it comes back exactly as it was", same.length === 0, same.join(", "));
    check("2. and nothing was approved again", signoffs(ar).length === signedBefore && audits(ar, "approved").length === 1);
    const restored = audits(ar, "restored");
    check("2. one audit row says who, when, before and after", restored.length === 1 && restored[0].user_id === editor.userId && JSON.parse(restored[0].details).from.archived_at && JSON.parse(restored[0].details).to.archived_at === null && JSON.parse(restored[0].details).status === "approved", JSON.stringify(restored));
    check("2. Staff reads it again", (await call("GET", `${A.P}/documents/${ar}`, undefined, staff.token)).status === 200);
    check("2. it can't be restored twice", (await restore(ar, editor.token)).status === 409 && audits(ar, "restored").length === 1);
    // Its number was taken meanwhile
    await call("POST", `${A.P}/documents/${ar}/archive`, {}, A.token);
    const taker = await doc(A, "Made-up number taker", "x", { doc_number: "rt 13" });
    const clash = await restore(ar, A.token);
    check("2. a number used meanwhile refuses the restore and says where", clash.status === 409 && clash.body.code === "DOC_NUMBER_TAKEN" && /number taker/.test(clash.body.error) && !!row(ar).archived_at, JSON.stringify(clash.body));
    await call("PATCH", `${A.P}/documents/${taker}`, { docNumber: null }, A.token);
    check("2. and it restores once the number is free", (await restore(ar, A.token)).status === 200);
    // A draft and an in-review document come back as they were.
    const inRev = await doc(A, "Made-up in review", "y");
    await submit(A, inRev, oneStep);
    await call("POST", `${A.P}/documents/${inRev}/archive`, {}, A.token);
    const archivedSign = await decide(A, inRev, signer);
    check("2. an archived document can't be approved", archivedSign.status === 409 && signoffs(inRev).length === 0 && row(inRev).status === "in_review", `HTTP ${archivedSign.status}`);
    await restore(inRev, A.token);
    check("2. an in-review document comes back in review, on the same route", row(inRev).status === "in_review" && row(inRev).workflow_id === oneStep && (await decide(A, inRev, signer)).body.status === "approved");

    // ── 3. Bulk approval ──
    const bulk = (token: string | undefined, body: any, L = A) => call("POST", `${L.P}/approvals/bulk`, body, token);
    const queue = async (who: { token: string }) => (await call("GET", `${A.P}/pending-reviews`, undefined, who.token)).body.pending as any[];
    const ids: number[] = [];
    for (let i = 1; i <= 8; i++) { const id = await doc(A, `Made-up bulk ${i}`, `MARKER-BULK-${i}`); await submit(A, id, i <= 2 ? oneStep : twoSteps); ids.push(id); }
    const [b1, b2, b3, b4, b5, b6, b7, b8] = ids;
    const shown = (await queue(signer)).filter((p) => ids.includes(p.document_id));
    check("3. the list shows each document waiting on them, with its version and step", shown.length === 8 && shown.every((p) => Number.isInteger(p.version_id) && Number.isInteger(p.step_id) && p.version_label === "1.0" && p.delegator_name === null), JSON.stringify(shown[0]));
    const item = (id: number) => { const p = shown.find((x) => x.document_id === id)!; return { documentId: id, versionId: p.version_id, stepId: p.step_id }; };
    const signedSoFar = () => ids.reduce((n, id) => n + signoffs(id).length, 0);
    const good = { typedSignature: signer.name, password: PW };
    check("3. a wrong password signs nothing", (await bulk(signer.token, { ...good, password: ["not", "it"].join("-"), items: [item(b1), item(b2)] })).status === 401 && signedSoFar() === 0);
    check("3. no typed name signs nothing", (await bulk(signer.token, { ...good, typedSignature: " ", items: [item(b1)] })).status === 400 && signedSoFar() === 0);
    check("3. someone else's password doesn't work", (await bulk(signer.token, { ...good, password: ["Owner", "password", "1!"].join("-"), items: [item(b1)] })).status === 401 && signedSoFar() === 0);
    check("3. no documents, a document twice, or one without its version is refused", (await bulk(signer.token, { ...good, items: [] })).status === 400
      && (await bulk(signer.token, { ...good, items: [item(b1), item(b1)] })).body.code === "DUPLICATE"
      && (await bulk(signer.token, { ...good, items: [{ documentId: b1 }] })).body.code === "BAD_ITEM"
      && (await bulk(signer.token, { ...good, items: Array.from({ length: 101 }, (_, i) => ({ documentId: i + 1, versionId: 1, stepId: 1 })) })).body.code === "TOO_MANY" && signedSoFar() === 0);
    check("3. signed out, a reviewer and a Staff login are refused", (await bulk(undefined, { ...good, items: [item(b1)] })).status === 401 && (await bulk(reviewer.token, { typedSignature: reviewer.name, password: PW, items: [item(b1)] })).status === 403 && (await bulk(staff.token, { typedSignature: staff.name, password: PW, items: [item(b1)] })).status === 404 && signedSoFar() === 0);
    const sup = await bulk(support.token, { typedSignature: support.name, password: PW, items: [item(b1)] });
    check("3. support can't sign", sup.status === 403 && sup.body.code === "VLS_SUPPORT_CANNOT_SIGN" && signedSoFar() === 0, `${sup.status} ${sup.body.code}`);
    check("3. another lab's owner can't reach it", (await bulk(B.token, { typedSignature: B.name, password: PW, items: [item(b1)] })).status === 403 && signedSoFar() === 0);
    const viaB = await bulk(B.token, { typedSignature: B.name, password: PW, items: [item(b1)] }, B);
    check("3. nor through its own lab, and learns no title", viaB.status === 200 && viaB.body.signed === 0 && viaB.body.results[0].ok === false && viaB.body.results[0].title === null && signedSoFar() === 0, JSON.stringify(viaB.body));
    const notTheirs = await bulk(editor.token, { typedSignature: editor.name, password: PW, items: [item(b1), item(b2)] });
    check("3. an editor the step doesn't name is refused, document by document", notTheirs.body.signed === 0 && notTheirs.body.refused === 2 && notTheirs.body.results.every((r: any) => !r.ok && /specific user/.test(r.message)) && signedSoFar() === 0, JSON.stringify(notTheirs.body.results));
    // Since the list was shown: b4 got a new version, b5 was recalled, b6's step was signed by this person elsewhere, b7 archived.
    await newVersion(A, b4, "MARKER-BULK-4 revised");
    await submit(A, b4, twoSteps);
    await call("POST", `${A.P}/documents/${b5}/recall`, {}, A.token);
    await decide(A, b6, signer);
    await call("POST", `${A.P}/documents/${b7}/archive`, {}, A.token);
    const otherLabDoc = await doc(B, "Made-up lab B secret", "z");
    const single = await decide(A, b1, signer); // the yardstick: a single approval
    check("3. setup: one approved the ordinary way", single.body.status === "approved");
    const out = await bulk(signer.token, { ...good, items: [item(b2), item(b3), item(b4), item(b5), item(b6), item(b7), item(b8), { documentId: otherLabDoc, versionId: row(otherLabDoc).current_version_id, stepId: item(b2).stepId }] });
    const res = Object.fromEntries((out.body.results || []).map((r: any) => [r.documentId, r]));
    check("3. what didn't move is signed, what moved is refused, and it says so for each", out.status === 200 && out.body.signed === 3 && out.body.refused === 5 && out.body.results.length === 8, JSON.stringify(out.body));
    check("3. the one-step document is approved; the two-step ones go to their next step", res[b2].status === "approved" && row(b2).status === "approved" && res[b3].status === "in_review" && res[b3].nextStep === "Second look" && res[b8].nextStep === "Second look");
    check("3. a new version since the list is refused", res[b4].ok === false && res[b4].code === "MOVED" && signoffs(b4).length === 0, JSON.stringify(res[b4]));
    check("3. a recall since the list is refused", res[b5].code === "MOVED" && signoffs(b5).length === 0);
    check("3. a step already signed is refused, not signed twice", res[b6].code === "MOVED" && signoffs(b6).length === 1);
    check("3. an archive since the list is refused", res[b7].code === "MOVED" && signoffs(b7).length === 0);
    check("3. another lab's document is refused with no title", res[otherLabDoc].ok === false && res[otherLabDoc].title === null && signoffs(otherLabDoc).length === 0);
    const pick = (r: any) => ({ user: r.user_id, action: r.action, typed: r.typed_signature, comment: r.comment, step: r.workflow_step_id });
    const sigSingle = signoffs(b1)[0], sigBulk = signoffs(b2)[0];
    const hashOf = (id: number) => one("SELECT file_hash_sha256 AS h FROM policy_versions WHERE id = ?", row(id).current_version_id).h;
    check("3. each has one signature row, the same as a single approval's", signoffs(b2).length === 1 && JSON.stringify(pick(sigSingle)) === JSON.stringify(pick(sigBulk)) && sigBulk.version_id === row(b2).current_version_id, JSON.stringify({ single: pick(sigSingle), bulk: pick(sigBulk) }));
    check("3. each signature holds its own version's hash", sigBulk.signed_document_hash === hashOf(b2) && sigSingle.signed_document_hash === hashOf(b1) && signoffs(b3)[0].signed_document_hash === hashOf(b3) && sigBulk.signed_document_hash !== signoffs(b3)[0].signed_document_hash);
    check("3. and the address and agent it came from", !!sigBulk.ip_address && !!sigBulk.user_agent);
    const auditSingle = audits(b1, "approved")[0], auditBulk = audits(b2, "approved")[0];
    check("3. each has the same audit row a single approval writes", audits(b2, "approved").length === 1 && auditSingle.details === auditBulk.details && auditBulk.user_id === signer.userId, JSON.stringify({ single: auditSingle?.details, bulk: auditBulk?.details }));
    check("3. the approved one records its version and review date, as a single approval does", row(b2).approved_version_id === row(b2).current_version_id && row(b2).next_review_date === row(b1).next_review_date);
    check("3. sending the same list again signs nothing", (await bulk(signer.token, { ...good, items: [item(b2), item(b3)] })).body.signed === 0 && signoffs(b2).length === 1 && signoffs(b3).length === 1);
    const before3 = signedSoFar();
    const noReject = [await call("POST", `${A.P}/approvals/bulk-reject`, { ...good, items: [item(b8)] }, signer.token), await bulk(second.token, { typedSignature: second.name, password: PW, action: "rejected", items: (await queue(second)).filter((p) => p.document_id === b8).map((p) => ({ documentId: p.document_id, versionId: p.version_id, stepId: p.step_id })) })];
    check("3. there is no bulk reject: no such route, and asking for one approves nothing but what it names", noReject[0].status === 404 && noReject[1].body.results[0].status === "approved" && signoffs(b8).every((x) => x.action === "approved") && signedSoFar() === before3 + 1);
    // A delegate signs in bulk as they would one at a time.
    const today = one("SELECT date('now') AS d").d as string;
    const shift = (d: number) => new Date(Date.parse(`${today}T00:00:00Z`) + d * DAY).toISOString().slice(0, 10);
    const del = await call("POST", `${A.P}/delegations`, { fromUserId: second.userId, toUserId: editor.userId, startsOn: shift(-2), endsOn: shift(2) }, A.token);
    const dq = (await queue(editor)).find((p) => p.document_id === b3);
    check("3. a delegate's list says who they stand in for", del.status === 201 && dq?.delegator_name === second.name, JSON.stringify(dq));
    const dOut = await bulk(editor.token, { typedSignature: editor.name, password: PW, items: [{ documentId: b3, versionId: dq.version_id, stepId: dq.step_id }] });
    check("3. and the signature says so, as a single one does", dOut.body.signed === 1 && /Signed as delegate for Sue Second/.test(signoffs(b3)[1].comment) && JSON.parse(audits(b3, "approved")[1].details).delegator_user_id === second.userId, JSON.stringify(dOut.body));
    await call("POST", `${A.P}/delegations/${del.body.id}/revoke`, {}, A.token);
    check("3. no email went out for any of it: the notice is off", (await taken()).length === 0 && one("SELECT COUNT(*) AS n FROM policy_approval_notices").n === 0);

    // ── 4. Approval emails ──
    const set = (token: string, body: any, L = A) => call("PUT", `${L.P}/settings/email-notices`, body, token);
    check("4. an editor who isn't an owner or admin can't turn it on", (await set(editor.token, { approvalEmails: true })).status === 403);
    check("4. nor a reviewer or a Staff login", (await set(reviewer.token, { approvalEmails: true })).status === 403 && (await set(staff.token, { approvalEmails: true })).status === 404 && (await call("GET", `${A.P}/settings/email-notices`, undefined, staff.token)).status === 404);
    check("4. nor another lab's owner", (await set(B.token, { approvalEmails: true })).status === 403);
    const supSet = await set(support.token, { approvalEmails: true });
    check("4. nor support, who is an admin for setup", supSet.status === 403 && supSet.body.code === "VLS_SUPPORT_CANNOT_SIGN" && (await call("GET", `${A.P}/settings/email-notices`, undefined, support.token)).body.canEdit === false, `${supSet.status} ${supSet.body.code}`);
    check("4. a bad value is refused", (await set(A.token, { approvalEmails: "yes" })).status === 400 && (await set(A.token, { overdueDays: 5 })).status === 400);
    check("4. it is still off", (await call("GET", `${A.P}/settings/email-notices`, undefined, editor.token)).body.approvalEmails === false);
    const on = await set(admin.token, { approvalEmails: true });
    const settingAudit = all("SELECT * FROM policy_audit_log WHERE lab_id = ? AND action = 'email_notices_changed' ORDER BY id", A.labId);
    check("4. an admin turns it on, and only that", on.status === 200 && on.body.approvalEmails === true && on.body.overdueEmails === false && on.body.overdueDays === 30, JSON.stringify(on.body));
    check("4. one audit row: who, when, before and after", settingAudit.length === 1 && settingAudit[0].user_id === admin.userId && JSON.parse(settingAudit[0].details).from.approvalEmails === false && JSON.parse(settingAudit[0].details).to.approvalEmails === true);
    await set(admin.token, { approvalEmails: true });
    check("4. saving the same choice writes no second audit row", all("SELECT id FROM policy_audit_log WHERE lab_id = ? AND action = 'email_notices_changed'", A.labId).length === 1);

    const e1 = await doc(A, "Made-up <b>titled</b> & SOP", "e1", { doc_number: "E 1" });
    await submit(A, e1, twoSteps);
    let m = await taken();
    check("4. submitting emails the first step's person, once", m.length === 1 && m[0].to === signer.email, JSON.stringify(m.map((x) => x.to)));
    check("4. it names the document, its number, version and step, escaped", m[0].html.includes("E 1 Made-up &lt;b&gt;titled&lt;/b&gt; &amp; SOP, version 1.0") && m[0].html.includes("Step: First look.") && !m[0].html.includes("<b>titled"), m[0].html);
    check("4. it links to VeritaDC and has no em dash", m[0].html.includes(`/labs/${A.labId}/veritapolicy-app/my-policies`) && !`${m[0].subject}${m[0].html}`.includes(EM_DASH));
    check("4. the audit trail says a notice went", JSON.parse(audits(e1, "approval_notice_sent")[0]?.details || "{}").sent === 1);
    await notifyStepSigners(sqlite, { labId: A.labId, documentIds: [e1], actorUserId: A.userId, canEdit: () => true }).done;
    check("4. asked again for the same submission and step, nobody is emailed twice", (await taken()).length === 0);
    await decide(A, e1, signer);
    m = await taken();
    check("4. signing a step emails the next step's person", m.length === 1 && m[0].to === second.email && m[0].html.includes("Step: Second look."), JSON.stringify(m.map((x) => x.to)));
    await decide(A, e1, second, "reject");
    check("4. a rejection emails no approver", (await taken()).length === 0);
    await submit(A, e1, twoSteps);
    m = await taken();
    check("4. submitting it again is a new submission: the step it waits on is told", m.length === 1 && m[0].to === second.email, JSON.stringify(m.map((x) => x.to)));
    // Group step: each member with a login, not the author, not a deactivated seat, not a person with no login.
    const gone = await person(A, "gone", "Gil Gone", "active");
    const noLogin = roster(A, "Nia", "Nologin");
    const gUsers = { signer: roster(A, "Sam", "Signer"), second: roster(A, "Sue", "Second"), gone: roster(A, "Gil", "Gone") };
    run("UPDATE staff_employees SET login_user_id = ? WHERE id = ?", signer.userId, gUsers.signer);
    run("UPDATE staff_employees SET login_user_id = ? WHERE id = ?", second.userId, gUsers.second);
    run("UPDATE staff_employees SET login_user_id = ? WHERE id = ?", gone.userId, gUsers.gone);
    const groupId = (await call("POST", `${A.P}/groups`, { name: "Made-up reviewers" }, A.token)).body.groups.find((g: any) => g.name === "Made-up reviewers").id;
    for (const employee_id of [gUsers.signer, gUsers.second, gUsers.gone, noLogin, staff.emp]) await call("POST", `${A.P}/groups/${groupId}/members`, { employee_id }, A.token);
    run("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ?", gone.userId);
    const groupRoute = await route(A, "Group route", [{ stepName: "Any reviewer", requiredRole: "group", approverGroupId: groupId }]);
    const g1 = await doc(A, "Made-up group SOP", "g1", {}, signer.token); // signer is the author, and the step doesn't let the author sign
    await submit(A, g1, groupRoute);
    m = await taken();
    check("4. a group step emails each member who can sign: not the author, a deactivated seat, or someone with no login", JSON.stringify(m.map((x) => x.to).sort()) === JSON.stringify([second.email, staff.email].sort()), JSON.stringify(m.map((x) => x.to)));
    check("4. a Staff login's email opens My sign-offs, an editor's opens VeritaDC", m.find((x) => x.to === staff.email)!.html.includes(`/labs/${A.labId}/my-signoffs`) && m.find((x) => x.to === second.email)!.html.includes("veritapolicy-app/my-policies"));
    // Delegation
    await call("POST", `${A.P}/documents/${g1}/recall`, {}, signer.token);
    const dNow = await call("POST", `${A.P}/delegations`, { fromUserId: signer.userId, toUserId: editor.userId, startsOn: shift(-1), endsOn: shift(1) }, A.token);
    await call("POST", `${A.P}/delegations`, { fromUserId: signer.userId, toUserId: admin.userId, startsOn: shift(10), endsOn: shift(12) }, A.token); // not yet
    const dl1 = await doc(A, "Made-up delegated SOP", "dl1");
    await submit(A, dl1, oneStep);
    m = await taken();
    check("4. a delegate is emailed while the delegation runs, and told who for; one not yet running isn't", JSON.stringify(m.map((x) => x.to).sort()) === JSON.stringify([editor.email, signer.email].sort()) && m.find((x) => x.to === editor.email)!.html.includes("standing in for Sam Signer") && !m.find((x) => x.to === signer.email)!.html.includes("standing in"), JSON.stringify(m.map((x) => x.to)));
    const dl2 = await doc(A, "Made-up delegate's own SOP", "dl2", {}, editor.token);
    await submit(A, dl2, oneStep);
    m = await taken();
    check("4. a delegate who wrote the document isn't emailed: they couldn't sign it", JSON.stringify(m.map((x) => x.to)) === JSON.stringify([signer.email]), JSON.stringify(m.map((x) => x.to)));
    await call("POST", `${A.P}/delegations/${dNow.body.id}/revoke`, {}, A.token);
    const dl3 = await doc(A, "Made-up after revoke", "dl3");
    await submit(A, dl3, oneStep);
    check("4. a revoked delegation is honored at once", JSON.stringify((await taken()).map((x) => x.to)) === JSON.stringify([signer.email]));
    // Medical director: the designated director, not every admin who may sign as designee.
    const mdRoute = await route(A, "Director route", [{ stepName: "Director", requiredRole: "medical_director" }]);
    run("UPDATE labs SET medical_director_email = ? WHERE id = ?", second.email, A.labId);
    const md1 = await doc(A, "Made-up director SOP", "md1");
    await submit(A, md1, mdRoute);
    check("4. a medical director step goes to the designated director alone", JSON.stringify((await taken()).map((x) => x.to)) === JSON.stringify([second.email]));
    run("UPDATE labs SET medical_director_email = NULL WHERE id = ?", A.labId);
    // Bulk: several documents reaching one person come in one email.
    const bk = [await doc(A, "Made-up together 1", "t1"), await doc(A, "Made-up together 2", "t2"), await doc(A, "Made-up together 3", "t3")];
    for (const id of bk) await submit(A, id, twoSteps);
    await taken();
    const tq = (await queue(signer)).filter((p) => bk.includes(p.document_id));
    const tOut = await bulk(signer.token, { ...good, items: tq.map((p) => ({ documentId: p.document_id, versionId: p.version_id, stepId: p.step_id })) });
    m = await taken();
    check("4. a bulk approval tells the next signer once, in one email naming all three", tOut.body.signed === 3 && m.length === 1 && m[0].to === second.email && m[0].subject === "Approval needed: 3 documents" && [1, 2, 3].every((i) => m[0].html.includes(`Made-up together ${i}`)), JSON.stringify(m));
    // The staff login path tells the next step too.
    const staffFirst = await route(A, "Staff first", [{ stepName: "Bench", requiredRole: "specific_user", specificUserId: staff.userId }, { stepName: "Then second", requiredRole: "specific_user", specificUserId: second.userId }]);
    const sf = await doc(A, "Made-up staff first", "sf");
    await submit(A, sf, staffFirst);
    check("4. a Staff login named on a step is emailed", JSON.stringify((await taken()).map((x) => x.to)) === JSON.stringify([staff.email]));
    const tile = (await call("GET", "/api/staff-portal-session/approvals", undefined, staff.token)).body.approvals;
    check("4. their approvals tile answers as it did, with nothing added", keysOf(tile[0]) === "doc_number,document_id,is_major_revision,manual_id,step_id,step_name,step_order,title,total_steps,updated_at,version_id", keysOf(tile[0]));
    await call("POST", `/api/staff-portal-session/approvals/${sf}/approve`, { typed_signature: staff.name, password: PW, version_id: row(sf).current_version_id }, staff.token);
    check("4. and when they sign, the next step's person is", JSON.stringify((await taken()).map((x) => x.to)) === JSON.stringify([second.email]));
    // A mail outage fails nothing and isn't retried into a second email.
    mailFails = true;
    const mf = await doc(A, "Made-up outage", "mf");
    const mfSubmit = await submit(A, mf, oneStep);
    await settle();
    mailFails = false;
    const failed = one("SELECT * FROM policy_approval_notices WHERE document_id = ?", mf);
    check("4. a mail outage doesn't fail the submit, and the row says what happened", mfSubmit.status === 200 && row(mf).status === "in_review" && failed?.sent_at === null && /outage/.test(failed?.error || ""), JSON.stringify(failed));
    check("4. a sent one records when", !!one("SELECT sent_at FROM policy_approval_notices WHERE document_id = ? AND user_id = ?", dl3, signer.userId)?.sent_at);
    const gone2 = await doc(A, "Made-up deleted", "gone2");
    await submit(A, gone2, oneStep);
    await taken();
    await call("DELETE", `${A.P}/documents/${gone2}`, undefined, A.token);
    check("4. deleting a document takes its notice rows", one("SELECT COUNT(*) AS n FROM policy_approval_notices WHERE document_id = ?", gone2).n === 0);
    await set(A.token, { approvalEmails: false });
    const quiet = await doc(A, "Made-up quiet", "q");
    await submit(A, quiet, oneStep);
    check("4. turned off again, nobody is emailed", (await taken()).length === 0);
    check("4. the other lab, which never turned it on, has sent nothing", one("SELECT COUNT(*) AS n FROM policy_approval_notices WHERE lab_id = ?", B.labId).n === 0);

    // ── 5. Overdue read-and-sign ──
    // A lab of its own, so every date is set on purpose. "At" is the run's clock.
    const C = await mkLab("c");
    const at = new Date(Math.floor(Date.now() / 60000) * 60000);
    const ago = (d: number) => new Date(at.getTime() - d * DAY).toISOString().replace("T", " ").slice(0, 19);
    const dayAgo = (d: number) => new Date(at.getTime() - d * DAY).toISOString().slice(0, 10);
    const cSigner = await person(C, "csigner", "Cass Signer", "active");
    const ann = await person(C, "ann", "Ann Bench", "staff_portal");
    const bea = await person(C, "bea", "Bea Bench", "staff_portal");
    const newHire = await person(C, "newhire", "Nell Newhire", "staff_portal");
    const left = await person(C, "left", "Lou Left", "staff_portal");
    const unsure = await person(C, "unsure", "Una Unsure", "staff_portal");
    // Still a member and still the login on a roster entry, but the only seat they held here was deactivated.
    const exEditor = await person(C, "exeditor", "Exa Editor", "active");
    run("UPDATE staff_employees SET login_user_id = ? WHERE id = ?", exEditor.userId, roster(C, "Exa", "Editor"));
    run("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ?", exEditor.userId);
    roster(C, "Nat", "Nologin");
    run("UPDATE staff_employees SET created_at = ? WHERE id = ?", ago(5), newHire.emp);
    run("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ?", left.userId);
    run("UPDATE users SET email_verification_pending = 1 WHERE id = ?", unsure.userId);
    const cRoute = await route(C, "C route", [{ stepName: "Sign", requiredRole: "specific_user", specificUserId: cSigner.userId }]);
    const approvedAt = async (title: string, days: number, extra: Record<string, string> = {}) => {
      const id = await doc(C, title, `text ${title}`, extra);
      await submit(C, id, cRoute);
      await decide(C, id, cSigner);
      run("UPDATE policy_signoffs SET signed_at = ? WHERE document_id = ?", ago(days), id);
      return id;
    };
    const assign = async (body: any, days: number) => {
      const r = await call("POST", `${C.P}/read-sign`, body, C.token);
      run("UPDATE policy_read_sign_assignments SET assigned_at = ? WHERE lab_id = ? AND id = (SELECT MAX(id) FROM policy_read_sign_assignments)", ago(days), C.labId);
      return r;
    };
    const old = await approvedAt("Made-up old SOP", 60, { doc_number: "OLD 1" });
    await assign({ scope: "document", id: old, everyone: true }, 60);
    const fresh = await approvedAt("Made-up fresh SOP", 10);
    await assign({ scope: "document", id: fresh, everyone: true }, 60); // assigned long ago, but this version took effect 10 days ago
    const signedDoc = await approvedAt("Made-up signed SOP", 60);
    await assign({ scope: "document", id: signedDoc, everyone: true }, 60);
    run("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, typed_signature) VALUES (?, ?, ?, ?, 'Ann Bench')", C.labId, signedDoc, row(signedDoc).current_version_id, ann.emp);
    const dated = await approvedAt("Made-up dated SOP", 60);
    await call("POST", `${C.P}/documents/${dated}/attestations`, { assignedToUserIds: [ann.userId], dueDate: dayAgo(3) }, C.token);
    await call("POST", `${C.P}/documents/${dated}/attestations`, { assignedToUserIds: [bea.userId], dueDate: dayAgo(-3) }, C.token);
    await assign({ scope: "document", id: dated, employee_ids: [bea.emp] }, 60); // a due date set for Bea decides over the 30 days
    const formDoc = await approvedAt("Made-up form", 60, { doc_type: "form" });
    await assign({ scope: "document", id: formDoc, everyone: true }, 60);
    await call("PUT", `${C.P}/doc-types/form`, { requiresReadAndSign: false }, C.token);
    const retired = await approvedAt("Made-up retired C", 60);
    await assign({ scope: "document", id: retired, everyone: true }, 60);
    await call("POST", `${C.P}/documents/${retired}/archive`, {}, C.token);
    await taken();
    check("5. off by default: a run sends nothing", (await runOverdueSignNotices(sqlite, at)).people === 0 && (await taken()).length === 0);
    check("5. an editor can't turn it on; the owner can", (await set(cSigner.token, { overdueEmails: true }, C)).status === 403 && (await set(C.token, { overdueEmails: true }, C)).status === 200);
    const r5 = await runOverdueSignNotices(sqlite, at);
    let w = await taken();
    const to = (p: { email: string }) => w.find((x) => x.to === p.email);
    check("5. one email to each person who owes something and can sign in, and to the owner", JSON.stringify(w.map((x) => x.to).sort()) === JSON.stringify([ann.email, bea.email, C.email].sort()) && r5.sent === 3 && r5.labs === 1, `${JSON.stringify(w.map((x) => x.to))} ${JSON.stringify(r5)}`);
    check("5. Ann: the old one with its due date, and the dated one", to(ann)!.subject === "Read and sign: 2 documents overdue" && to(ann)!.html.includes("OLD 1 Made-up old SOP (was due ") && to(ann)!.html.includes("Made-up dated SOP"), to(ann)?.html);
    check("5. not what she signed, what isn't due, a form that needs no signature, or an archived document", !/signed SOP|fresh SOP|Made-up form|retired C/.test(to(ann)!.html));
    check("5. Bea: the old one and the one she hasn't signed; the date set for her hasn't passed", to(bea)!.html.includes("Made-up old SOP") && to(bea)!.html.includes("Made-up signed SOP") && !to(bea)!.html.includes("dated SOP"), to(bea)?.html);
    check("5. someone hired 5 days ago isn't overdue on it yet", !to(newHire));
    check("5. a deactivated login, an unconfirmed one and someone with no login are never emailed", !to(left) && !to(unsure) && !to(exEditor));
    check("5. the owner's email counts people per document, with nobody's name", /Made-up old SOP: \d people/.test(to(C as any)!.html) && !/Ann|Bea|Nat|Nologin/.test(to(C as any)!.html) && to(C as any)!.subject.startsWith("Overdue signatures on "), to(C as any)?.html);
    const oldPeople = Number(/Made-up old SOP: (\d+) pe/.exec(to(C as any)!.html)?.[1]);
    check("5. and counts those with no login, who still owe it", oldPeople === 6, `${oldPeople}`); // Ann, Bea, Lou, Una, Exa (no live login) and Nat
    check("5. the link signs a Staff login in to My sign-offs", to(ann)!.html.includes(`/labs/${C.labId}/my-signoffs`) && to(C as any)!.html.includes(`/labs/${C.labId}/veritapolicy-app/my-policies`));
    check("5. no em dash, and the product mark is right", w.every((x) => !`${x.subject}${x.html}`.includes(EM_DASH) && x.html.includes("VeritaDC&trade;")));
    check("5. the lab's audit log records the run", JSON.parse(one("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'overdue_sign_notice_sent' ORDER BY id DESC LIMIT 1", C.labId)?.details || "{}").sent === 3);
    check("5. run again at once, the next day and at 6 days 23 hours: nobody", (await runOverdueSignNotices(sqlite, at)).waiting === 3 && (await runOverdueSignNotices(sqlite, new Date(at.getTime() + DAY))).sent === 0 && (await runOverdueSignNotices(sqlite, new Date(at.getTime() + 7 * DAY - 3600000))).people <= 1);
    w = await taken();
    check("5. (only someone who hadn't had one yet could be emailed in that week)", w.every((x) => ![ann.email, bea.email, C.email].includes(x.to)), JSON.stringify(w.map((x) => x.to)));
    run("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, typed_signature) VALUES (?, ?, ?, ?, 'Bea Bench')", C.labId, old, row(old).current_version_id, bea.emp);
    run("UPDATE policy_documents SET owner_user_id = ? WHERE id = ?", ann.userId, dated); // owned by someone who is now a limited Staff login
    run("UPDATE policy_attestations SET due_date = ? WHERE document_id = ? AND assigned_to_user_id = ?", dayAgo(1), dated, bea.userId);
    await runOverdueSignNotices(sqlite, new Date(at.getTime() + 7 * DAY));
    w = await taken();
    check("5. a limited Staff login gets no owner part: it doesn't read who owes", !!to(ann) && !to(ann)!.html.includes("Documents you own") && to(bea)!.html.includes("dated SOP"), to(ann)?.html);
    check("5. seven days on, whoever still owes gets the next one, without what they signed", !!to(ann) && !!to(bea) && !to(bea)!.html.includes("Made-up old SOP"), JSON.stringify(w.map((x) => x.to)));
    // One person, two labs: one email for both.
    const E = await mkLab("e");
    run("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',0,?,?,?)", E.labId, ann.userId, now, now, now);
    const eEmp = roster(E, "Ann", "Bench");
    run("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')", E.userId, ann.email, ann.userId, now, now, E.labId, eEmp);
    const eDoc = await doc(E, "Made-up lab E SOP", "e");
    run("UPDATE policy_documents SET status = 'approved', approved_version_id = current_version_id WHERE id = ?", eDoc);
    run("UPDATE policy_versions SET uploaded_at = ? WHERE document_id = ?", ago(90), eDoc);
    await call("POST", `${E.P}/read-sign`, { scope: "document", id: eDoc, everyone: true }, E.token);
    run("UPDATE policy_read_sign_assignments SET assigned_at = ? WHERE lab_id = ?", ago(90), E.labId);
    const later = new Date(at.getTime() + 14 * DAY);
    await runOverdueSignNotices(sqlite, later);
    w = await taken();
    check("5. a lab that hasn't turned it on is in nobody's email", !!to(ann) && !to(ann)!.html.includes("lab E SOP") && !to(E as any));
    await set(E.token, { overdueEmails: true }, E);
    await runOverdueSignNotices(sqlite, new Date(later.getTime() + 2 * DAY));
    w = await taken();
    check("5. turning it on in a second lab doesn't break the 7 days for someone already emailed", !to(ann) && !!to(E as any), JSON.stringify(w.map((x) => x.to)));
    await runOverdueSignNotices(sqlite, new Date(later.getTime() + 7 * DAY));
    w = await taken();
    const annMails = w.filter((x) => x.to === ann.email);
    check("5. then both labs come in one email", annMails.length === 1 && annMails[0].html.includes("Control Lab C") && annMails[0].html.includes("Control Lab E") && annMails[0].html.includes("lab E SOP"), `${annMails.length}`);
    run("UPDATE labs SET retired_at = ? WHERE id = ?", now, E.labId);
    await runOverdueSignNotices(sqlite, new Date(later.getTime() + 14 * DAY));
    w = await taken();
    check("5. a retired lab sends nothing", !!to(ann) && !to(ann)!.html.includes("Control Lab E") && !to(E as any));
    mailFails = true;
    const outage = await runOverdueSignNotices(sqlite, new Date(later.getTime() + 21 * DAY));
    mailFails = false;
    check("5. a mail outage is counted and not sent again inside the week", outage.failed > 0 && outage.sent === 0 && (await runOverdueSignNotices(sqlite, new Date(later.getTime() + 22 * DAY))).sent === 0 && /outage/.test(one("SELECT error FROM policy_sign_notices WHERE user_id = ? ORDER BY id DESC LIMIT 1", ann.userId).error));
    check("5. every row names its lab, and no support account was ever emailed", one("SELECT COUNT(*) AS n FROM policy_sign_notices WHERE lab_id IS NULL").n === 0 && one("SELECT COUNT(*) AS n FROM policy_sign_notices WHERE user_id = ?", support.userId).n === 0);
  } catch (err: any) {
    console.error("TEST CRASHED", err);
    failures++;
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
}

main();
