// tests/integration/study-notes.test.ts
//
// STANDING integration test for VeritaCheck study notes (2026-10-26, Michael: "a notes section where users can
// input their own notes to refer back to later"; routes /api/labs/:labId/studies/:id/notes, table study_notes).
// Asserts: any member who can open the study reads its notes; writers add them, view-only members cannot; another
// customer can neither read nor add; a note can be added to a signed study and leaves the study itself unchanged;
// adds and removals are in the audit trail; only the author or a lab owner or admin removes a note, which stays
// as a tombstone; deleting the study deletes its notes.
//
// Boots the REAL Express routes against a throwaway SQLite DB and drives real HTTP. Made-up rows only.
// Run: npm run test:study-notes

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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;

  const req = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {};
    try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const PW = ["Sn", "base", "7x!"].join("-");
  const register = async (tag: string) => {
    const email = `it-notes-${tag}-${Date.now()}@example.com`;
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body?.user?.id) };
  };
  const signIn = async (u: { id: number; email: string }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.id);
    return (await req("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const makeStudy = (labId: number, ownerId: number, name: string) => Number(sqlite.prepare(
    `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
     VALUES (?, ?, ?, 'Analyzer A', 'IT Analyst', '2026-10-26', 'cal_ver', 0.1, '[]', '["Analyzer A"]', 'completed', datetime('now'))`
  ).run(ownerId, labId, name).lastInsertRowid);

  try {
    const G = await register("owner");
    const E = await register("editor");
    const V = await register("viewer");
    const O = await register("other-owner");
    const g1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: G.email, labName: "IT Notes Lab", plan: "hospital" })).body?.labId);
    const o1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: O.email, labName: "IT Other Customer", plan: "hospital" })).body?.labId);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: g1, email: E.email, role: "staff", permissionsMode: "edit_all" });
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: g1, email: V.email, role: "staff" });
    const gTok = await signIn(G), eTok = await signIn(E), vTok = await signIn(V), oTok = await signIn(O);
    const s1 = makeStudy(g1, G.id, "IT Glucose");
    const s2 = makeStudy(g1, G.id, "IT Sodium");
    const sOther = makeStudy(o1, O.id, "IT Other Potassium");
    check("0. labs and studies made", g1 > 0 && o1 > 0 && s1 > 0 && sOther > 0, JSON.stringify([g1, o1, s1, sOther]));
    const url = (lab: number, study: number) => `/api/labs/${lab}/studies/${study}/notes`;

    // 1) Reading.
    const empty = await req("GET", url(g1, s1), undefined, gTok);
    check("1a. a study with no notes returns an empty list", empty.status === 200 && Array.isArray(empty.body?.notes) && empty.body.notes.length === 0, `status=${empty.status}`);
    check("1b. a view-only member can read the notes", (await req("GET", url(g1, s1), undefined, vTok)).status === 200);
    check("1c. signed out is refused", (await req("GET", url(g1, s1))).status === 401);

    // 2) Adding.
    const add = await req("POST", url(g1, s1), { body: "  Reran level 3 after recalibration; see maintenance log.  " }, eTok);
    const n1 = add.body?.note;
    check("2a. an editor adds a note (trimmed, named, removable by its author)", add.status === 201 && n1?.body === "Reran level 3 after recalibration; see maintenance log." && n1?.author_name === "IT editor" && n1?.can_delete === true, `status=${add.status} ${JSON.stringify(n1)}`);
    check("2b. an empty note is refused", (await req("POST", url(g1, s1), { body: "   " }, eTok)).status === 400);
    check("2c. a note over 5000 characters is refused", (await req("POST", url(g1, s1), { body: "x".repeat(5001) }, eTok)).status === 400);
    const vAdd = await req("POST", url(g1, s1), { body: "viewer note" }, vTok);
    check("2d. a view-only member cannot add a note", vAdd.status === 403, `status=${vAdd.status}`);
    const gAdd = await req("POST", url(g1, s1), { body: "Owner note: accepted at the 10/26 huddle." }, gTok);
    check("2e. the owner adds a note", gAdd.status === 201);
    const list = (await req("GET", url(g1, s1), undefined, vTok)).body?.notes || [];
    check("2f. notes list oldest first and only for this study", list.length === 2 && list[0].id === n1?.id && list[1].id === gAdd.body?.note?.id, JSON.stringify(list.map((n: any) => n.id)));
    check("2g. the view-only member sees no remove option", list.every((n: any) => n.can_delete === false));
    check("2h. another study's notes are separate", ((await req("GET", url(g1, s2), undefined, gTok)).body?.notes || []).length === 0);

    // 3) Another customer.
    const oRead = await req("GET", url(g1, s1), undefined, oTok);
    const oAdd = await req("POST", url(g1, s1), { body: "intruder" }, oTok);
    check("3a. another customer cannot read or add notes in this lab", oRead.status === 403 && oAdd.status === 403, `read=${oRead.status} add=${oAdd.status}`);
    const cross = await req("GET", url(g1, sOther), undefined, gTok);
    const crossAdd = await req("POST", url(g1, sOther), { body: "wrong lab" }, gTok);
    check("3b. another customer's study cannot be reached through this lab's address", cross.status === 404 && crossAdd.status === 404, `read=${cross.status} add=${crossAdd.status}`);

    // 4) A signed study takes notes without changing.
    const origState = (sqlite.prepare("SELECT lifecycle_state FROM studies WHERE id = ?").get(s2) as any).lifecycle_state;
    sqlite.prepare("UPDATE studies SET lifecycle_state = 'finalized' WHERE id = ?").run(s2);
    const beforeRow = JSON.stringify(sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(s2));
    const signedAdd = await req("POST", url(g1, s2), { body: "Note after sign-off." }, eTok);
    const afterRow = JSON.stringify(sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(s2));
    check("4. a note can be added to a signed study, and the study row is unchanged", signedAdd.status === 201 && beforeRow === afterRow, `status=${signedAdd.status}`);

    // 5) Audit trail.
    const audits = sqlite.prepare("SELECT action, entity_id, user_id FROM audit_log WHERE entity_type = 'study_note' ORDER BY id").all() as any[];
    check("5. each add is in the audit trail with its author", audits.filter((a) => a.action === "create").length === 3 && audits.some((a) => Number(a.entity_id) === n1?.id && a.user_id === E.id), JSON.stringify(audits));

    // 6) Removing.
    const gNoteId = gAdd.body?.note?.id;
    check("6a. a view-only member cannot remove a note", (await req("DELETE", `${url(g1, s1)}/${n1?.id}`, undefined, vTok)).status === 403);
    const eDelOwner = await req("DELETE", `${url(g1, s1)}/${gNoteId}`, undefined, eTok);
    check("6b. an editor cannot remove someone else's note", eDelOwner.status === 403, `status=${eDelOwner.status}`);
    const gDel = await req("DELETE", `${url(g1, s1)}/${n1?.id}`, undefined, gTok);
    check("6c. the lab owner removes the editor's note", gDel.status === 200, `status=${gDel.status} ${JSON.stringify(gDel.body)}`);
    const after = (await req("GET", url(g1, s1), undefined, eTok)).body?.notes || [];
    const tomb = after.find((n: any) => n.id === n1?.id);
    check("6d. the removed note stays as a tombstone with its text withheld", after.length === 2 && tomb?.body === null && !!tomb?.deleted_at && tomb?.can_delete === false, JSON.stringify(tomb));
    check("6e. removing it again says it is already removed", (await req("DELETE", `${url(g1, s1)}/${n1?.id}`, undefined, gTok)).status === 409);
    check("6f. a note id from another study is not found", (await req("DELETE", `${url(g1, s2)}/${gNoteId}`, undefined, gTok)).status === 404);
    check("6g. the removal is in the audit trail", (sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'study_note' AND action = 'delete' AND user_id = ?").get(G.id) as any).c === 1);

    // 7) Deleting the study deletes its notes.
    sqlite.prepare("UPDATE studies SET lifecycle_state = ? WHERE id = ?").run(origState, s2);
    const delStudy = await req("DELETE", `/api/labs/${g1}/studies/${s2}`, undefined, gTok);
    const left = (sqlite.prepare("SELECT COUNT(*) AS c FROM study_notes WHERE study_id = ?").get(s2) as any).c;
    check("7. deleting a study deletes its notes", delStudy.status === 200 && left === 0, `status=${delStudy.status} left=${left}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
