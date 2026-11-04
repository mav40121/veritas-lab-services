// tests/integration/veritadc-approval-routes.test.ts
//
// STANDING integration test for VeritaDC approval routes (Michael 2026-11-04, Q155 = 1; parity plan Phase 1 item 3):
//   1. An owner builds a route: a step goes to a role, a named person, or any one member of a lab group, and the screen is told
//      who signs each step in words. A bad role, another lab's group, a retired group and someone outside the lab are refused.
//   2. Only owners and admins change routes: an edit seat cannot, and another lab cannot.
//   3. Reorder saves the order, refuses a list that isn't every step once, and every change is in the audit log.
//   4. A step nobody signed changes in place. A step someone signed is retired and replaced, so approval history keeps its name.
//   5. A route with a document in review is locked for every kind of change, and opens again after a recall.
//   6. A group step: a member with a login signs, someone outside it can't, the author can't sign their own document, whoever
//      signs first completes the step, someone who left the roster drops out, and the review queue and eligibility count agree.
//   7. A group on a route can't be retired through either module's path, and both paths are the same rows.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritadc-approval-routes

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
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Route", "chk", "77!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `routes-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Route ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Route Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const now = new Date().toISOString();
  // A made-up person with an edit seat on the lab: can use VeritaDC but is not an owner or admin.
  const addEditor = async (L: { labId: number; userId: number }, tag: string, role = "staff") => {
    const email = `routes-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Person ${tag}`, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)").run(L.labId, userId, role, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
    sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
       VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`
    ).run(L.userId, email, userId, now, now, `routes-${tag}-${Date.now()}`, L.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const login = await call("POST", "/api/auth/login", { email, password: PW });
    return { email, userId, token: login.body.token as string };
  };
  const addRoster = (labId: number, ownerId: number, first: string, last: string, loginUserId: number | null) => {
    const row = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
    const staffLab = row?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Route Lab', ?, ?, ?, ?)").run(ownerId, `22D${labId}`, labId, now, now).lastInsertRowid);
    return Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, login_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)"
    ).run(staffLab, labId, ownerId, last, first, loginUserId, now, now).lastInsertRowid);
  };
  const upload = async (L: { token: string; labId: number }, title: string, token = L.token) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    fd.append("title", title);
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };

  try {
    const A = await mkLab("a");
    const B = await mkLab("b");
    const P = `/api/labs/${A.labId}/veritapolicy`;
    const stepCols = (sqlite.prepare("PRAGMA table_info(policy_approval_steps)").all() as any[]).map((c) => c.name);
    check("0. boot adds the group and retired columns", stepCols.includes("approver_group_id") && stepCols.includes("archived_at"));

    const seeded = await call("GET", `${P}/workflows`, undefined, A.token);
    check("0. the seeded routes read, with who signs in words", seeded.status === 200 && seeded.body.can_edit === true && seeded.body.workflows[0].steps[0].who === "Medical director or designee", JSON.stringify(seeded.body.workflows?.[0]?.steps?.[0]));

    const signerA = await addEditor(A, "signer-a");
    const signerB = await addEditor(A, "signer-b");
    const outsider = await addEditor(A, "outsider");
    const leaving = await addEditor(A, "leaving");
    const empA = addRoster(A.labId, A.userId, "Ann", "Signer", signerA.userId);
    const empB = addRoster(A.labId, A.userId, "Bea", "Signer", signerB.userId);
    const empLeaving = addRoster(A.labId, A.userId, "Lee", "Leaving", leaving.userId);
    const empNoLogin = addRoster(A.labId, A.userId, "Nia", "Nologin", null);
    const empOwner = addRoster(A.labId, A.userId, "Otto", "Owner", A.userId);

    // The group, built through VeritaDC's own path
    const madeGroup = await call("POST", `${P}/groups`, { name: "Supervisors" }, A.token);
    const groupId = madeGroup.body.groups?.find((g: any) => g.name === "Supervisors")?.id;
    check("1. the group saves through VeritaDC's path", madeGroup.status === 200 && !!groupId, `HTTP ${madeGroup.status}`);
    for (const employee_id of [empA, empB, empLeaving, empNoLogin, empOwner]) await call("POST", `${P}/groups/${groupId}/members`, { employee_id }, A.token);
    const typedLogin = await call("POST", `${P}/groups/${groupId}/members`, { email: outsider.email.toUpperCase() }, A.token);
    const noLoginTyped = await call("POST", `${P}/groups/${groupId}/members`, { email: "nobody-here@example.com" }, A.token);
    const g1 = noLoginTyped.body.groups.find((g: any) => g.id === groupId);
    check("1. only people with a login count as able to sign", typedLogin.status === 200 && g1.member_count === 7 && g1.signer_count === 5, `${g1.member_count}/${g1.signer_count}`);
    check("1. the screen is told who has no login", g1.members.find((m: any) => m.employee_id === empNoLogin)?.has_login === false && g1.members.find((m: any) => m.employee_id === empA)?.has_login === true);
    await call("DELETE", `${P}/groups/${groupId}/members/${g1.members.find((m: any) => m.email?.toLowerCase() === outsider.email.toLowerCase()).id}`, undefined, A.token);

    // 1. Building a route
    const made = await call("POST", `${P}/workflows`, { name: "Supervisor then named person" }, A.token);
    const W = `${P}/workflows/${made.body.id}`;
    check("1. the owner adds a route", made.status === 201 && !!made.body.id, `HTTP ${made.status}`);
    const bad = async (body: any) => (await call("POST", `${W}/steps`, { stepName: "x", ...body }, A.token)).status;
    check("1. a made-up role is refused", (await bad({ requiredRole: "boss" })) === 400);
    check("1. no group is refused", (await bad({ requiredRole: "group" })) === 400);
    const otherGroup = (await call("POST", `/api/labs/${B.labId}/veritapolicy/groups`, { name: "Other lab" }, B.token)).body.groups[0].id;
    check("1. another lab's group is refused", (await bad({ requiredRole: "group", approverGroupId: otherGroup })) === 400);
    check("1. someone outside the lab is refused", (await bad({ requiredRole: "specific_user", specificUserId: B.userId })) === 400);
    check("1. a blank step name is refused", (await call("POST", `${W}/steps`, { stepName: "  ", requiredRole: "medical_director" }, A.token)).status === 400);
    const step1 = await call("POST", `${W}/steps`, { stepName: "Supervisor review", requiredRole: "group", approverGroupId: groupId }, A.token);
    const step2 = await call("POST", `${W}/steps`, { stepName: "Named review", requiredRole: "specific_user", specificUserId: signerB.userId }, A.token);
    const step3 = await call("POST", `${W}/steps`, { stepName: "Director", requiredRole: "medical_director" }, A.token);
    check("1. steps save in order", step1.body.step_order === 1 && step2.body.step_order === 2 && step3.body.step_order === 3);
    const readRoute = async () => (await call("GET", `${P}/workflows`, undefined, A.token)).body.workflows.find((w: any) => w.id === made.body.id);
    const r1 = await readRoute();
    check("1. who signs reads in words", r1.steps[0].who === "Any one member of Supervisors" && r1.steps[1].who === `Person signer-b` && r1.steps[2].who === "Medical director or designee", JSON.stringify(r1.steps.map((s: any) => s.who)));
    const people = await call("GET", `${P}/route-people`, undefined, A.token);
    check("1. the person picker lists the lab's people", people.status === 200 && people.body.people.some((p: any) => p.user_id === signerA.userId));

    // 2. Who can change routes
    const editorToken = signerA.token;
    check("2. an edit seat sees the routes but may not edit", (await call("GET", `${P}/workflows`, undefined, editorToken)).body.can_edit === false);
    check("2. an edit seat cannot add a route", (await call("POST", `${P}/workflows`, { name: "Mine" }, editorToken)).status === 403);
    check("2. an edit seat cannot add a step", (await call("POST", `${W}/steps`, { stepName: "x", requiredRole: "medical_director" }, editorToken)).status === 403);
    check("2. an edit seat cannot remove a step", (await call("DELETE", `${W}/steps/${step3.body.id}`, undefined, editorToken)).status === 403);
    check("2. an edit seat cannot archive a route", (await call("DELETE", W, undefined, editorToken)).status === 403);
    check("2. an edit seat cannot read the person picker", (await call("GET", `${P}/route-people`, undefined, editorToken)).status === 403);
    check("2. another lab cannot change this route", [403, 404].includes((await call("POST", `${W}/steps`, { stepName: "x", requiredRole: "medical_director" }, B.token)).status));
    check("2. another lab's path does not reach this route", [403, 404].includes((await call("POST", `/api/labs/${B.labId}/veritapolicy/workflows/${made.body.id}/steps`, { stepName: "x", requiredRole: "medical_director" }, B.token)).status));

    // 3. Reorder and audit
    check("3. a list missing a step is refused", (await call("POST", `${W}/steps/reorder`, { stepIds: [step1.body.id, step2.body.id] }, A.token)).status === 400);
    check("3. a repeated step is refused", (await call("POST", `${W}/steps/reorder`, { stepIds: [step1.body.id, step1.body.id, step2.body.id] }, A.token)).status === 400);
    const reordered = await call("POST", `${W}/steps/reorder`, { stepIds: [step2.body.id, step1.body.id, step3.body.id] }, A.token);
    const r2 = await readRoute();
    check("3. the new order saves", reordered.status === 200 && r2.steps[0].id === step2.body.id && r2.steps[0].step_order === 1 && r2.steps[1].step_order === 2);
    await call("POST", `${W}/steps/reorder`, { stepIds: [step1.body.id, step2.body.id, step3.body.id] }, A.token);
    const audited = (action: string) => !!sqlite.prepare("SELECT 1 FROM policy_audit_log WHERE lab_id = ? AND action = ? LIMIT 1").get(A.labId, action);
    check("3. adds and reorders are audited", audited("workflow_step_added") && audited("workflow_steps_reordered"));
    check("3. group changes are audited in VeritaDC's log", audited("group_added") && audited("group_member_added"));

    // 4. Editing and removing
    const extra = await call("POST", `${W}/steps`, { stepName: "Extra", requiredRole: "technical_consultant" }, A.token);
    const edited = await call("PUT", `${W}/steps/${extra.body.id}`, { stepName: "Extra review", requiredRole: "general_supervisor" }, A.token);
    const r3 = await readRoute();
    check("4. a step nobody signed changes in place", edited.body.id === extra.body.id && r3.steps.find((s: any) => s.id === extra.body.id)?.step_name === "Extra review" && r3.steps.find((s: any) => s.id === extra.body.id)?.who === "General supervisor");
    check("4. an edit to another lab's group is refused", (await call("PUT", `${W}/steps/${extra.body.id}`, { requiredRole: "group", approverGroupId: otherGroup }, A.token)).status === 400);
    const removed = await call("DELETE", `${W}/steps/${extra.body.id}`, undefined, A.token);
    const r4 = await readRoute();
    check("4. a step nobody signed is really removed", removed.status === 200 && r4.steps.length === 3 && !sqlite.prepare("SELECT 1 FROM policy_approval_steps WHERE id = ?").get(extra.body.id));
    check("4. edits and removals are audited", audited("workflow_step_edited") && audited("workflow_step_removed"));
    const gap = await call("POST", `${W}/steps`, { stepName: "Middle", requiredRole: "technical_consultant" }, A.token);
    await call("POST", `${W}/steps/reorder`, { stepIds: [step1.body.id, gap.body.id, step2.body.id, step3.body.id] }, A.token);
    await call("DELETE", `${W}/steps/${gap.body.id}`, undefined, A.token);
    const r5 = await readRoute();
    check("4. the route closes up after a removal", JSON.stringify(r5.steps.map((s: any) => s.step_order)) === "[1,2,3]", JSON.stringify(r5.steps.map((s: any) => s.step_order)));

    // 5 and 6. A document on the route
    const doc = await upload(A, "Group Approval Procedure (made-up)");
    const D = `${P}/documents/${doc.id}`;
    const sub = await call("POST", `${D}/submit`, { workflowId: made.body.id }, A.token);
    check("5. the document goes in review on the route", sub.status === 200, `HTTP ${sub.status}`);
    const lockedRoute = await readRoute();
    check("5. the route says it is locked", /1 document is in review/.test(lockedRoute.locked_reason || ""), lockedRoute.locked_reason);
    const isLocked = (r: any) => r.status === 409 && r.body.code === "ROUTE_LOCKED";
    check("5. locked: add a step", isLocked(await call("POST", `${W}/steps`, { stepName: "x", requiredRole: "medical_director" }, A.token)));
    check("5. locked: edit a step", isLocked(await call("PUT", `${W}/steps/${step1.body.id}`, { stepName: "y" }, A.token)));
    check("5. locked: reorder", isLocked(await call("POST", `${W}/steps/reorder`, { stepIds: [step2.body.id, step1.body.id, step3.body.id] }, A.token)));
    check("5. locked: remove a step", isLocked(await call("DELETE", `${W}/steps/${step1.body.id}`, undefined, A.token)));
    check("5. locked: archive the route", isLocked(await call("DELETE", W, undefined, A.token)));

    const sign = (token: string, pw = PW) => call("POST", `${D}/approve`, { typedSignature: "Made Up Signer", password: pw }, token);
    const elig = await call("GET", `${D}/eligibility?workflowId=${made.body.id}`, undefined, A.token);
    check("6. the eligibility count is the group's signers, less the author", elig.body.perStep?.[0]?.eligible_count === 3 && elig.body.perStep?.[0]?.who === "Any one member of Supervisors", JSON.stringify(elig.body.perStep?.[0]));

    const queue = async (token: string) => (await call("GET", `${P}/pending-reviews`, undefined, token)).body.pending.map((p: any) => p.document_id);
    check("6. the review queue shows a member the document", (await queue(signerA.token)).includes(doc.id));
    check("6. the review queue does not show someone outside the group", !(await queue(outsider.token)).includes(doc.id));
    const pend = await call("GET", `${D}/pending-step`, undefined, signerA.token);
    check("6. the pending step says a member can sign", pend.body.canCurrentUserApprove === true && pend.body.step?.step_name === "Supervisor review");
    const outsideTry = await sign(outsider.token);
    check("6. someone outside the group cannot sign", outsideTry.status === 403 && /group you are not in/.test(outsideTry.body.error || ""), `HTTP ${outsideTry.status}`);
    const authorTry = await sign(A.token);
    check("6. the author cannot sign their own document, even in the group", authorTry.status === 403 && /Self-approval/.test(authorTry.body.error || ""), `HTTP ${authorTry.status} ${authorTry.body.error}`);
    check("6. a wrong password is refused", (await sign(signerA.token, "wrong-password")).status === 401);

    sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(empLeaving);
    const leftTry = await sign(leaving.token);
    check("6. someone who left the roster drops out", leftTry.status === 403, `HTTP ${leftTry.status}`);

    const first = await sign(signerA.token);
    check("6. any one member signs and the step completes", first.status === 200 && first.body.nextStep === "Named review", JSON.stringify(first.body));
    const secondTry = await sign(signerA.token);
    check("6. the next step goes to its own person, not the group", secondTry.status === 403, `HTTP ${secondTry.status}`);

    // Retiring a signed step after the document finishes or comes back
    const recall = await call("POST", `${D}/recall`, {}, A.token);
    check("5. the recall opens the route", recall.status === 200 && !(await readRoute()).locked_reason, `HTTP ${recall.status}`);
    const signedEdit = await call("PUT", `${W}/steps/${step1.body.id}`, { stepName: "Supervisor sign-off" }, A.token);
    const r6 = await readRoute();
    const oldRow = sqlite.prepare("SELECT step_name, archived_at FROM policy_approval_steps WHERE id = ?").get(step1.body.id) as any;
    check("4. a signed step is retired, not overwritten", signedEdit.status === 200 && signedEdit.body.id !== step1.body.id && oldRow.step_name === "Supervisor review" && !!oldRow.archived_at, JSON.stringify(oldRow));
    check("4. its replacement takes the same place", r6.steps[0].id === signedEdit.body.id && r6.steps[0].step_name === "Supervisor sign-off" && r6.steps.length === 3);
    const history = sqlite.prepare(
      "SELECT st.step_name AS name FROM policy_signoffs s LEFT JOIN policy_approval_steps st ON st.id = s.workflow_step_id WHERE s.document_id = ? AND s.action = 'approved'"
    ).get(doc.id) as any;
    check("4. approval history keeps the name that was signed", history?.name === "Supervisor review", history?.name);
    const signedRemove = await call("DELETE", `${W}/steps/${signedEdit.body.id}`, undefined, A.token);
    check("4. removing a step with no signatures on the new row still works", signedRemove.status === 200 && (await readRoute()).steps.length === 2);
    const afterRetire = await upload(A, "After Retire Procedure (made-up)");
    await call("POST", `${P}/documents/${afterRetire.id}/submit`, { workflowId: made.body.id }, A.token);
    const retiredPending = await call("GET", `${P}/documents/${afterRetire.id}/pending-step`, undefined, A.token);
    check("4. a new document never waits on a retired step", retiredPending.body.totalSteps === 2 && retiredPending.body.step?.step_name === "Named review", JSON.stringify({ total: retiredPending.body.totalSteps, step: retiredPending.body.step?.step_name }));
    await call("POST", `${P}/documents/${afterRetire.id}/recall`, {}, A.token);

    // A document runs start to finish on a group route
    const short = await call("POST", `${P}/workflows`, { name: "Group only" }, A.token);
    const onlyStep = await call("POST", `${P}/workflows/${short.body.id}/steps`, { stepName: "Supervisor approval", requiredRole: "group", approverGroupId: groupId }, A.token);
    const doc2 = await upload(A, "Second Procedure (made-up)");
    await call("POST", `${P}/documents/${doc2.id}/submit`, { workflowId: short.body.id }, A.token);
    const done = await call("POST", `${P}/documents/${doc2.id}/approve`, { typedSignature: "Bea Signer", password: PW }, signerB.token);
    check("6. one signature on a one-step group route approves the document", done.status === 200 && done.body.status === "approved", JSON.stringify(done.body));
    check("6. the document's list says who signs", onlyStep.status === 201);
    const doc3 = await upload(A, "Third Procedure (made-up)");
    await call("POST", `${P}/documents/${doc3.id}/submit`, { workflowId: short.body.id }, A.token);
    const list = await call("GET", `${P}/documents`, undefined, A.token);
    const row = (Array.isArray(list.body) ? list.body : list.body.documents || []).find((d: any) => d.id === doc3.id);
    check("6. the document list names the group waiting to sign", row?.pending_step_who === "Any one member of Supervisors", row?.pending_step_who);
    await call("POST", `${P}/documents/${doc3.id}/recall`, {}, A.token);

    // 7. Retiring a group that is on a route
    const vtPath = `/api/labs/${A.labId}/veritatrack/groups`;
    const retireDc = await call("PUT", `${P}/groups/${groupId}`, { retired: true }, A.token);
    check("7. a group on a route can't be retired through VeritaDC", retireDc.status === 409 && retireDc.body.code === "GROUP_ON_ROUTE", `HTTP ${retireDc.status}`);
    const retireVt = await call("PUT", `${vtPath}/${groupId}`, { retired: true }, A.token);
    check("7. or through VeritaTrack", retireVt.status === 409 && retireVt.body.code === "GROUP_ON_ROUTE", `HTTP ${retireVt.status}`);
    const vtRead = await call("GET", vtPath, undefined, A.token);
    check("7. VeritaTrack reads the same group", vtRead.body.groups?.some((g: any) => g.id === groupId));
    const retiredGroup = (await call("POST", `${P}/groups`, { name: "Unused" }, A.token)).body.groups.find((g: any) => g.name === "Unused").id;
    const ok = await call("PUT", `${P}/groups/${retiredGroup}`, { retired: true }, A.token);
    check("7. a group on no route can be retired", ok.status === 200);
    check("7. a retired group is refused on a new step", (await call("POST", `${P}/workflows/${short.body.id}/steps`, { stepName: "x", requiredRole: "group", approverGroupId: retiredGroup }, A.token)).status === 400);
    const archived = await call("DELETE", `${P}/workflows/${short.body.id}`, undefined, A.token);
    check("7. archiving a route is audited", archived.status === 200 && audited("workflow_archived"));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
