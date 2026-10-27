// tests/integration/competency-signed-delete.test.ts
//
// Receipt for BUG-070 (2026-10-27): a signed competency assessment could be deleted. DELETE
// /api/labs/:labId/competency/assessments/:id (and the legacy /api/competency/assessments/:id) checked access and that
// the record existed, then hard-deleted it. Now a locked (signed) assessment, or one a per-method sign-off rests on, is
// refused with 409 and kept; an unsigned draft still deletes; after the owner's logged unlock, the record can be deleted.
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:competency-signed-delete
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const email = `comp-del-${Date.now()}@example.com`;
  const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Testpass123", name: "Comp Delete Owner", hipaa_acknowledged: true }) }));
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "Comp Delete Lab", plan: "hospital" }) }))).labId);
  const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const token = reg.token as string;
  const now = new Date().toISOString();
  const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, created_at, updated_at) VALUES (?, ?, 'Tech', 'Made-Up', ?, ?)").run(labId, userId, now, now).lastInsertRowid);
  const compEmp = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, created_at) VALUES (?, 'Made-Up Tech', ?)").run(userId, now).lastInsertRowid);
  const prog = Number(sqlite.prepare("INSERT INTO competency_programs (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, 'Chemistry Technical', ?, ?)").run(userId, labId, now, now).lastInsertRowid);
  const mkAssess = (locked: number) => Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_date, locked, created_at) VALUES (?, ?, '2026-10-01', ?, ?)").run(prog, compEmp, locked, now).lastInsertRowid);
  const exists = (id: number) => !!sqlite.prepare("SELECT 1 FROM competency_assessments WHERE id = ?").get(id);
  const del = (id: number, legacy = false) => fetch(base + (legacy ? `/api/competency/assessments/${id}` : `/api/labs/${labId}/competency/assessments/${id}`), {
    method: "DELETE", headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) } });

  check("0. setup", labId > 0 && userId > 0 && prog > 0 && emp > 0);

  const signed = mkAssess(1);
  const r1 = await del(signed);
  const b1 = await j(r1);
  check("1. a signed (locked) assessment is refused (409) and kept", r1.status === 409 && b1.code === "ASSESSMENT_SIGNED" && exists(signed), `status=${r1.status} ${b1.error ?? ""}`);
  const r1b = await del(signed, true);
  check("1b. the legacy delete route refuses it too", r1b.status === 409 && exists(signed), `status=${r1b.status}`);

  const methodSigned = mkAssess(0);
  sqlite.prepare("INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, assessment_id, milestone, signed_date, signer_name, signer_role, created_at) VALUES (?, ?, 1, ?, 'initial', '2026-10-02', 'Made-Up Signer', 'TC', ?)").run(labId, emp, methodSigned, now);
  const r2 = await del(methodSigned);
  check("2. an assessment a method sign-off rests on is refused (409) and kept", r2.status === 409 && exists(methodSigned), `status=${r2.status} ${(await j(r2)).error ?? ""}`);

  const draft = mkAssess(0);
  const r3 = await del(draft);
  check("3. an unsigned draft still deletes", r3.status === 200 && !exists(draft), `status=${r3.status}`);

  const unlock = await fetch(base + `/api/labs/${labId}/competency/assessments/${signed}/unlock`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId), "Content-Type": "application/json" }, body: "{}" });
  const r4 = await del(signed);
  check("4. after the owner's logged unlock, it can be deleted", unlock.status === 200 && r4.status === 200 && !exists(signed), `unlock=${unlock.status} delete=${r4.status}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
