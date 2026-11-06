// tests/integration/competency-program-delete.test.ts
//
// Michael 2026-11-06, Q184 = 1: deleting a VeritaComp program that holds competency records is refused with 409 and the count, on the
// lab-scoped route and the older unscoped one, the way a quiz with results is refused. An empty program still deletes, along with its
// setup. Boots the REAL routes on a scratch DB with made-up people. Every refusal also checks that nothing was removed.
// Run: npm run test:competency-program-delete
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body: unknown, token?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `cpd-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };
  const count = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);

  try {
    const OWNER = await register("owner"), OTHER = await register("other"), STAFF = await register("staff"), EDITOR = await register("editor");
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const labId = await provision(OWNER.email, "Made-up Delete Lab"), lab2 = await provision(OTHER.email, "Made-up Other Lab");
    const L = `/api/labs/${labId}`, L2 = `/api/labs/${lab2}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Delete Lab", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const person = async (last: string, first: string) => Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const annStaffId = await person("Self", "Ann"), benStaffId = await person("Reyes", "Ben");
    const member = (userId: number, role = "staff") => sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)`).run(labId, userId, role, now, now, now);
    const seat = (u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(OWNER.id, u.email, u.id, now, now, perms, `cpd-${u.id}-${stamp}`, labId, type, rosterId);
    member(STAFF.id); seat(STAFF, "staff_portal", '{"mode":"view_all"}', annStaffId);
    member(EDITOR.id); seat(EDITOR, "active", '{"mode":"edit_all"}', null);

    const compOf = (staffId: number) => Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(staffId, labId) as any)?.id ?? 0);
    const mkProgram = async (name: string) => {
      const r = await call("POST", `${L}/competency/programs`, { name, department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, OWNER.token);
      return Number(r.j.id);
    };
    // A person only reaches VeritaComp through New Assessment's bridge; seed the row the way the bridge does if it isn't there yet.
    const ensureComp = (staffId: number, name: string) => compOf(staffId) || Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, ?, 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(OWNER.id, labId, name, staffId, now).lastInsertRowid);
    const annComp = ensureComp(annStaffId, "Ann Self"), benComp = ensureComp(benStaffId, "Ben Reyes");
    const addAssessment = (programId: number, employeeId: number, status = "completed") => Number(sqlite.prepare(
      "INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, created_at) VALUES (?, ?, 'annual', '2026-10-15', 'Made Up Evaluator', ?, ?)"
    ).run(programId, employeeId, status, now).lastInsertRowid);
    const addItem = (assessmentId: number, methodGroupId: number | null = null) => sqlite.prepare(
      "INSERT INTO competency_assessment_items (assessment_id, method_number, method_group_id, item_label, passed) VALUES (?, 1, ?, 'Made-up item', 1)"
    ).run(assessmentId, methodGroupId);
    const addGroup = (programId: number, name: string) => Number(sqlite.prepare(
      "INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, ?, '[]', '[]')"
    ).run(programId, name).lastInsertRowid);
    const programExists = (id: number) => count("SELECT COUNT(*) AS n FROM competency_programs WHERE id = ?", id) === 1;
    const assessmentsOf = (id: number) => count("SELECT COUNT(*) AS n FROM competency_assessments WHERE program_id = ?", id);
    const itemsOf = (id: number) => count("SELECT COUNT(*) AS n FROM competency_assessment_items WHERE assessment_id IN (SELECT id FROM competency_assessments WHERE program_id = ?)", id);
    const routes = (id: number): Array<[string, string]> => [["lab-scoped route", `${L}/competency/programs/${id}`], ["older route", `/api/competency/programs/${id}`]];
    check("0. setup: two labs, a Staff login, an editor, two people in VeritaComp", labId > 0 && lab2 > 0 && annComp > 0 && benComp > 0);

    // ── An empty program still deletes, with its setup ───────────────────────
    for (const [label, pathOf] of [["lab-scoped route", (id: number) => `${L}/competency/programs/${id}`], ["older route", (id: number) => `/api/competency/programs/${id}`]] as const) {
      const empty = await mkProgram(`Empty ${label}`);
      addGroup(empty, "Made-up group");
      sqlite.prepare("INSERT INTO competency_program_not_applicable (program_id, employee_id, marked_at) VALUES (?, ?, ?)").run(empty, annComp, now);
      const setupBefore = count("SELECT COUNT(*) AS n FROM competency_checklist_items WHERE program_id = ?", empty);
      const del = await call("DELETE", pathOf(empty), undefined, OWNER.token);
      check(`1a. ${label}: an empty program deletes`, del.s === 200 && del.j.ok === true && !programExists(empty), `${del.s} ${del.text.slice(0, 120)}`);
      check(`1b. ${label}: its method groups, checklist items and Not applicable rows go with it`, setupBefore === 1
        && count("SELECT COUNT(*) AS n FROM competency_method_groups WHERE program_id = ?", empty) === 0
        && count("SELECT COUNT(*) AS n FROM competency_checklist_items WHERE program_id = ?", empty) === 0
        && count("SELECT COUNT(*) AS n FROM competency_program_not_applicable WHERE program_id = ?", empty) === 0);
    }
    const editorEmpty = await mkProgram("Empty, editor");
    const editorDel = await call("DELETE", `${L}/competency/programs/${editorEmpty}`, undefined, EDITOR.token);
    check("1c. an editor deletes an empty program too", editorDel.s === 200 && !programExists(editorEmpty), `${editorDel.s}`);

    // ── A program holding records is refused, on both routes ─────────────────
    const full = await mkProgram("Holds records");
    const fullGroup = addGroup(full, "Made-up group");
    const a1 = addAssessment(full, annComp), a2 = addAssessment(full, benComp);
    addItem(a1, fullGroup); addItem(a1); addItem(a2);
    for (const [label, url] of routes(full)) {
      const r = await call("DELETE", url, undefined, OWNER.token);
      check(`2a. ${label}: refused with 409 and the counts`, r.s === 409 && r.j.code === "PROGRAM_HOLDS_RECORDS" && r.j.record_count === 2 && r.j.assessment_count === 2 && r.j.item_count === 3, `${r.s} ${r.text.slice(0, 200)}`);
      check(`2b. ${label}: says how many, in plain words, with no em dash`, /holds 2 competency records\./.test(r.j.error) && /can't be deleted by deleting the program/.test(r.j.error) && !r.j.error.includes("—"), r.j.error);
      check(`2c. ${label}: nothing was removed`, programExists(full) && assessmentsOf(full) === 2 && itemsOf(full) === 3 && count("SELECT COUNT(*) AS n FROM competency_method_groups WHERE program_id = ?", full) === 1 && count("SELECT COUNT(*) AS n FROM competency_checklist_items WHERE program_id = ?", full) === 1);
    }
    const editorFull = await call("DELETE", `${L}/competency/programs/${full}`, undefined, EDITOR.token);
    check("2d. an editor is refused the same way", editorFull.s === 409 && programExists(full), `${editorFull.s}`);

    const one = await mkProgram("Holds one record");
    const oneA = addAssessment(one, annComp);
    const oneR = await call("DELETE", `${L}/competency/programs/${one}`, undefined, OWNER.token);
    check("3a. one assessment with no items is enough, and the words are singular", oneR.s === 409 && oneR.j.record_count === 1 && oneR.j.item_count === 0 && /holds 1 competency record\./.test(oneR.j.error) && programExists(one), `${oneR.s} ${oneR.j.error}`);

    const draft = await mkProgram("Holds a draft");
    addAssessment(draft, annComp, "in_progress");
    const draftR = await call("DELETE", `${L}/competency/programs/${draft}`, undefined, OWNER.token);
    check("3b. any status counts: an unsigned record is a record too", draftR.s === 409 && programExists(draft), `${draftR.s}`);

    // An item on another program's assessment that points at this program's method group. Removing the group would detach it.
    const groupOnly = await mkProgram("Group in use elsewhere");
    const usedGroup = addGroup(groupOnly, "Group in use");
    const hostItemCount = itemsOf(full);
    addItem(a2, usedGroup);
    for (const [label, url] of routes(groupOnly)) {
      const r = await call("DELETE", url, undefined, OWNER.token);
      check(`3c. ${label}: no assessments of its own, but an item points at its method group: refused with the item count`, r.s === 409 && r.j.record_count === 1 && r.j.assessment_count === 0 && r.j.item_count === 1 && /holds 1 competency record\./.test(r.j.error), `${r.s} ${r.text.slice(0, 200)}`);
    }
    check("3d. the group and the item are still there", programExists(groupOnly) && count("SELECT COUNT(*) AS n FROM competency_method_groups WHERE id = ?", usedGroup) === 1 && itemsOf(full) === hostItemCount + 1);

    // ── Who can learn the count ──────────────────────────────────────────────
    const noCount = (r: { text: string }) => !/record_count|assessment_count|item_count|holds/.test(r.text);
    const foreignLab = await call("DELETE", `${L2}/competency/programs/${full}`, undefined, OTHER.token);
    check("4a. another lab's owner, on their own lab's URL: 404, no count", foreignLab.s === 404 && noCount(foreignLab) && programExists(full), `${foreignLab.s}`);
    const foreignOld = await call("DELETE", `/api/competency/programs/${full}`, undefined, OTHER.token);
    check("4b. another lab's owner, on the older route: 404, no count", foreignOld.s === 404 && noCount(foreignOld) && programExists(full), `${foreignOld.s}`);
    const staffDel = await call("DELETE", `${L}/competency/programs/${full}`, undefined, STAFF.token);
    check("4c. a Staff login: 403, no count", staffDel.s === 403 && noCount(staffDel) && programExists(full), `${staffDel.s}`);
    const staffEmpty = await mkProgram("Empty, Staff login tries");
    const staffEmptyDel = await call("DELETE", `${L}/competency/programs/${staffEmpty}`, undefined, STAFF.token);
    check("4d. a Staff login can't delete an empty program either", staffEmptyDel.s === 403 && programExists(staffEmpty), `${staffEmptyDel.s}`);
    const noSignIn = await call("DELETE", `${L}/competency/programs/${full}`, undefined);
    check("4e. no sign-in: 401, no count", noSignIn.s === 401 && noCount(noSignIn) && programExists(full), `${noSignIn.s}`);

    // ── Once the records are gone the program can go ─────────────────────────
    const removed = await call("DELETE", `${L}/competency/assessments/${oneA}`, undefined, OWNER.token);
    const afterRemoved = await call("DELETE", `${L}/competency/programs/${one}`, undefined, OWNER.token);
    check("5. the refusal isn't sticky: with its one record removed on its own route, the program deletes", removed.s === 200 && afterRemoved.s === 200 && !programExists(one), `${removed.s}/${afterRemoved.s}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
