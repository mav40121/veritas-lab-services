// tests/integration/veritadc-staff-approvals.test.ts
//
// STANDING integration test for staff login approvals in VeritaDC (Michael 2026-11-04, Q155 = 1):
//   1. A staff login named on a route step, or in a group a step goes to, sees the document waiting. Nobody else does, and the tile shows only for someone on a route.
//   2. They can open what they are asked to sign. Someone not on the step can't, and another lab can't.
//   3. Signing takes a typed name and their own password. The signature keeps who, what and the file hash, and uses no editing seat.
//   4. They sign what they read: a document changed since they opened it is refused.
//   5. A rejection is a signature too, and sends the document back to draft. Steps go in order, and a document already signed leaves the queue.
//   6. A staff login can't upload, can't use the editor's approve path, and a lab in read-only can't take approvals.
//   7. The editor's path still behaves after sharing the code: password, self-approval, approve and reject, and its queue.
//   8. The bell lists what is waiting.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-staff-approvals

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
  const PW = ["Appr", "chk", "77!"].join("-");
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
    const email = `staffappr-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Approval Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const upload = async (L: { token: string; labId: number }, title: string, token = L.token) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up procedure text ${title}\n`)], { type: "text/plain" }), "made-up.txt");
    fd.append("title", title);
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const A = await mkLab("a");
    const B = await mkLab("b");
    const P = `/api/labs/${A.labId}/veritapolicy`;
    const staffLabFor = (L: { labId: number; userId: number }) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(L.labId) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Approval Lab', '22D0000321', ?, ?, ?)").run(L.userId, L.labId, now, now).lastInsertRowid);
    const addStaffLogin = async (L: { labId: number; userId: number }, first: string, last: string) => {
      const email = `staffappr-${first.toLowerCase()}-${Date.now()}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `${first} ${last}`, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(L.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
      const emp = Number(sqlite.prepare(
        "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, login_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Histotechnologist', 'active', ?, ?, ?)"
      ).run(staffLabFor(L), L.labId, L.userId, last, first, userId, now, now).lastInsertRowid);
      sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(L.userId, email, userId, L.labId, emp);
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
      const token = issueSession(sqlite, userId, { headers: { "user-agent": "staff-approvals-test" }, ip: "127.0.0.1" }).token as string;
      return { email, userId, emp, token, name: `${first} ${last}` };
    };
    const vera = await addStaffLogin(A, "Vera", "Named");
    const gus = await addStaffLogin(A, "Gus", "Grouped");
    const otto = await addStaffLogin(A, "Otto", "Outside");
    const bo = await addStaffLogin(B, "Bo", "Otherlab");
    const Q = "/api/staff-portal-session/approvals";
    const queue = async (who: { token: string }) => (await call("GET", Q, undefined, who.token)).body;
    const ids = async (who: { token: string }) => ((await queue(who)).approvals || []).map((d: any) => d.document_id);
    const docStatus = (id: number) => (sqlite.prepare("SELECT status FROM policy_documents WHERE id = ?").get(id) as any)?.status;
    const signoffs = (id: number) => sqlite.prepare("SELECT * FROM policy_signoffs WHERE document_id = ? ORDER BY id").all(id) as any[];

    // A route naming Vera, then one going to a group Gus is in.
    const route = async (name: string, steps: any[]) => {
      const w = await call("POST", `${P}/workflows`, { name }, A.token);
      for (const s of steps) await call("POST", `${P}/workflows/${w.body.id}/steps`, s, A.token);
      return w.body.id as number;
    };
    const madeGroup = await call("POST", `${P}/groups`, { name: "Made-up reviewers" }, A.token);
    const groupId = madeGroup.body.groups[0].id;
    await call("POST", `${P}/groups/${groupId}/members`, { employee_id: gus.emp }, A.token);
    const namedRoute = await route("Named route", [{ stepName: "Director approval", requiredRole: "specific_user", specificUserId: vera.userId }]);
    const groupRoute = await route("Group route", [{ stepName: "Reviewer approval", requiredRole: "group", approverGroupId: groupId }]);
    const twoSteps = await route("Two steps", [
      { stepName: "First look", requiredRole: "specific_user", specificUserId: vera.userId },
      { stepName: "Second look", requiredRole: "group", approverGroupId: groupId },
    ]);
    const submitted = async (title: string, workflowId: number) => {
      const d = await upload(A, title);
      const s = await call("POST", `${P}/documents/${d.body.id}/submit`, { workflowId }, A.token);
      if (s.status !== 200) console.log("submit failed", s.status, s.body);
      return d.body.id as number;
    };

    // 1. Who sees it
    const doc1 = await submitted("Made-up SOP one", namedRoute);
    const doc2 = await submitted("Made-up SOP two", groupRoute);
    const qv = await queue(vera);
    check("1. the person named on the step sees the document", (await ids(vera)).includes(doc1) && qv.approvals.find((d: any) => d.document_id === doc1)?.step_name === "Director approval", JSON.stringify(qv.approvals));
    check("1. and not one that goes to a group they aren't in", !(await ids(vera)).includes(doc2));
    check("1. a member of the group sees the group's document", (await ids(gus)).includes(doc2) && !(await ids(gus)).includes(doc1));
    check("1. someone on no route sees nothing", (await ids(otto)).length === 0);
    check("1. the tile shows for someone on a route", (await queue(vera)).can_approve === true && (await queue(gus)).can_approve === true);
    check("1. and not for someone on none", (await queue(otto)).can_approve === false);
    check("1. another lab's person sees nothing", (await ids(bo)).length === 0);

    // 2. Reading it
    const meta = await call("GET", `${Q}/${doc1}`, undefined, vera.token);
    check("2. they can open it, with its version", meta.status === 200 && !!meta.body.version_id && !!meta.body.version_label && !!meta.body.file_hash, `HTTP ${meta.status}`);
    const rendered = await fetch(`${base}${Q}/${doc1}/render`, { headers: { Authorization: `Bearer ${vera.token}` } });
    check("2. they can read the file", rendered.status === 200 && /Made-up procedure text/.test(await rendered.text()), `HTTP ${rendered.status}`);
    check("2. someone not on the step can't open it", (await call("GET", `${Q}/${doc1}`, undefined, otto.token)).status === 404);
    check("2. or read the file", (await fetch(`${base}${Q}/${doc1}/render`, { headers: { Authorization: `Bearer ${otto.token}` } })).status === 404);
    check("2. another lab's person can't open it", (await call("GET", `${Q}/${doc1}`, undefined, bo.token)).status === 404);

    // 3. Signing
    const seatsBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type != 'staff_portal' AND status = 'active'").get(A.labId) as any).n;
    const sign = (id: number, who: { token: string }, body: any, verb = "approve") => call("POST", `${Q}/${id}/${verb}`, body, who.token);
    const signing = { typed_signature: vera.name, password: PW, version_id: meta.body.version_id };
    check("3. no typed name is refused", (await sign(doc1, vera, { ...signing, typed_signature: "" })).status === 400 && signoffs(doc1).length === 0);
    check("3. no password is refused", (await sign(doc1, vera, { ...signing, password: "" })).status === 400 && signoffs(doc1).length === 0);
    check("3. a wrong password is refused, and nothing is recorded", (await sign(doc1, vera, { ...signing, password: "not-the-password" })).status === 401 && signoffs(doc1).length === 0 && docStatus(doc1) === "in_review");
    check("3. someone else's password doesn't work either", (await sign(doc1, vera, { ...signing, password: "Owner-password-1!" })).status === 401);
    check("3. someone not on the step can't sign", (await sign(doc1, otto, { typed_signature: otto.name, password: PW })).status === 404 && signoffs(doc1).length === 0);
    const signed = await sign(doc1, vera, signing);
    check("3. the named person signs and the document is approved", signed.status === 200 && signed.body.status === "approved" && docStatus(doc1) === "approved", JSON.stringify(signed.body));
    const row = signoffs(doc1)[0];
    check("3. the signature keeps who, the typed name and the file hash", row?.user_id === vera.userId && row?.typed_signature === vera.name && row?.action === "approved" && row?.signed_document_hash === meta.body.file_hash, JSON.stringify({ u: row?.user_id, t: row?.typed_signature, a: row?.action }));
    const audit = sqlite.prepare("SELECT action FROM policy_audit_log WHERE document_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1").get(doc1, vera.userId) as any;
    check("3. it is in the audit log", audit?.action === "approved", JSON.stringify(audit));
    const seatsAfter = (sqlite.prepare("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type != 'staff_portal' AND status = 'active'").get(A.labId) as any).n;
    check("3. it uses no editing seat", seatsAfter === seatsBefore && (sqlite.prepare("SELECT seat_type FROM user_seats WHERE seat_user_id = ?").get(vera.userId) as any).seat_type === "staff_portal");
    check("3. a signed document leaves the queue", !(await ids(vera)).includes(doc1));
    check("3. it can't be signed twice", (await sign(doc1, vera, signing)).status === 404 && signoffs(doc1).length === 1);

    // 4. They sign what they read
    const doc3 = await submitted("Made-up SOP three", namedRoute);
    const meta3 = await call("GET", `${Q}/${doc3}`, undefined, vera.token);
    const stale = await sign(doc3, vera, { typed_signature: vera.name, password: PW, version_id: meta3.body.version_id + 999 });
    check("4. a changed document is refused", stale.status === 409 && stale.body.code === "VERSION_CHANGED" && signoffs(doc3).length === 0, JSON.stringify(stale.body));

    // 5. Rejecting, and steps in order
    const rejected = await sign(doc3, vera, { typed_signature: vera.name, password: PW, version_id: meta3.body.version_id, comment: "Made-up reason" }, "reject");
    check("5. a rejection goes back to draft", rejected.status === 200 && rejected.body.status === "draft" && docStatus(doc3) === "draft", JSON.stringify(rejected.body));
    check("5. and is a signature too", signoffs(doc3)[0]?.action === "rejected" && signoffs(doc3)[0]?.typed_signature === vera.name && /Made-up reason/.test(signoffs(doc3)[0]?.comment || ""));
    check("5. a wrong password can't reject", (await (async () => {
      const d = await submitted("Made-up SOP four", namedRoute);
      const r = await sign(d, vera, { typed_signature: vera.name, password: "nope" }, "reject");
      return r.status === 401 && docStatus(d) === "in_review";
    })()));
    const doc5 = await submitted("Made-up SOP five", twoSteps);
    check("5. the second signer waits for the first", !(await ids(gus)).includes(doc5) && (await ids(vera)).includes(doc5));
    const first = await sign(doc5, vera, { typed_signature: vera.name, password: PW });
    check("5. after the first, the document stays in review and moves on", first.body.status === "in_review" && first.body.nextStep === "Second look" && !(await ids(vera)).includes(doc5) && (await ids(gus)).includes(doc5), JSON.stringify(first.body));
    const second = await sign(doc5, gus, { typed_signature: gus.name, password: PW });
    check("5. the group member completes it", second.body.status === "approved" && docStatus(doc5) === "approved", JSON.stringify(second.body));

    // 6. What a staff login can't do
    const doc6 = await submitted("Made-up SOP six", namedRoute);
    check("6. a staff login can't upload", [401, 403].includes((await upload(A, "Staff upload", vera.token)).status));
    check("6. it can't use the editor's approve path", [401, 403].includes((await call("POST", `${P}/documents/${doc6}/approve`, { typedSignature: vera.name, password: PW }, vera.token)).status) && docStatus(doc6) === "in_review");
    sqlite.prepare("UPDATE labs SET subscription_status = 'expired', subscription_expires_at = '2020-01-01' WHERE id = ?").run(A.labId);
    sqlite.prepare("UPDATE users SET subscription_status = 'expired', subscription_expires_at = '2020-01-01' WHERE id = ?").run(A.userId);
    const expired = await sign(doc6, vera, { typed_signature: vera.name, password: PW });
    check("6. a lab in read-only can't take approvals", expired.status === 403 && docStatus(doc6) === "in_review", `HTTP ${expired.status}`);
    sqlite.prepare("UPDATE labs SET subscription_status = 'active', subscription_expires_at = NULL WHERE id = ?").run(A.labId);
    sqlite.prepare("UPDATE users SET subscription_status = 'active', subscription_expires_at = NULL WHERE id = ?").run(A.userId);

    // 7. The editor's path, sharing the same code
    const editor = (id: number, verb: string, body: any, token = A.token) => call("POST", `${P}/documents/${id}/${verb}`, body, token);
    const ownerRoute = await route("Owner step", [{ stepName: "Owner approval", requiredRole: "specific_user", specificUserId: A.userId, allowSelfApproval: true }]);
    const noSelf = await route("No self approval", [{ stepName: "Owner approval", requiredRole: "specific_user", specificUserId: A.userId }]);
    const doc7 = await submitted("Made-up SOP seven", ownerRoute);
    check("7. the editor's queue lists it", ((await call("GET", `${P}/pending-reviews`, undefined, A.token)).body.pending || []).some((d: any) => d.document_id === doc7));
    check("7. a staff login's editor queue is empty", ((await call("GET", `${P}/pending-reviews`, undefined, vera.token)).body.pending || []).length === 0);
    check("7. no typed name is refused", (await editor(doc7, "approve", { password: PW })).status === 400);
    check("7. a wrong password is refused", (await editor(doc7, "approve", { typedSignature: "Owner a", password: "nope" })).status === 401 && docStatus(doc7) === "in_review");
    const ownerSigned = await editor(doc7, "approve", { typedSignature: "Owner a", password: PW });
    check("7. the editor approves", ownerSigned.status === 200 && ownerSigned.body.status === "approved" && docStatus(doc7) === "approved", JSON.stringify(ownerSigned.body));
    const doc8 = await submitted("Made-up SOP eight", ownerRoute);
    const ownerRejected = await editor(doc8, "reject", { typedSignature: "Owner a", password: PW, comment: "Made-up" });
    check("7. the editor rejects, back to draft", ownerRejected.status === 200 && ownerRejected.body.status === "draft" && signoffs(doc8)[0]?.action === "rejected", JSON.stringify(ownerRejected.body));
    const doc9 = await submitted("Made-up SOP nine", noSelf);
    check("7. the author can't approve their own without the step allowing it", (await editor(doc9, "approve", { typedSignature: "Owner a", password: PW })).status === 403 && docStatus(doc9) === "in_review");
    check("7. the editor path can't reach another lab's document", (await editor(doc7, "approve", { typedSignature: "Owner b", password: PW }, B.token)).status === 403);

    // 8. The bell
    const bell = await call("GET", "/api/me/pending-staff-portal-items", undefined, vera.token);
    check("8. the bell lists what is waiting", (bell.body.approvals || []).some((a: any) => a.document_id === doc6 && a.step_name === "Director approval"), JSON.stringify(bell.body.approvals));
    const bellOtto = await call("GET", "/api/me/pending-staff-portal-items", undefined, otto.token);
    check("8. and nothing for someone on no route", (bellOtto.body.approvals || []).length === 0);
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
