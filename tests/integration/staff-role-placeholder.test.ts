// tests/integration/staff-role-placeholder.test.ts
//
// Parking lot #98 (Michael 2026-11-22, BUG-044 follow-up): ticking TC or TS on the VeritaStaff employee form keeps a
// row with no specialty, and the form sends it with every save, so it was stored again beside the real specialties.
// Every write of an employee's roles now passes through withoutPlaceholderRoles (server/cms209Roles.ts). Boots the REAL
// routes on a scratch DB with made-up people and proves:
//   1. create (lab-scoped and legacy): a TC with a specialty stores no empty TC row; a TS with nothing chosen keeps its
//      one empty row; other roles are untouched
//   2. update (lab-scoped and legacy): re-saving with the empty row drops it; removing every specialty keeps the empty
//      row, so the role stays
//   3. the entire-lab flag counts as a specialty (its empty partner is dropped)
//   4. the CMS 209 readiness gaps are the same as before for these people (the reader already skipped the row)
// Run: npm run test:staff-role-placeholder
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
  const call = async (method: string, path: string, body: unknown, token?: string, headers: Record<string, string> = {}) => {
    const h: Record<string, string> = { "Content-Type": "application/json", ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };

  try {
    const email = `srp-owner-${stamp}@example.test`;
    const token = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Made Up Owner", hipaa_acknowledged: true })).j.token as string;
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Roles Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    const H = { "X-Active-Lab-Id": String(labId) };
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Roles Lab", cliaNumber: "11D7654398", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
    const rolesOf = (id: number) => (sqlite.prepare("SELECT role, specialty_number AS n, all_specialties AS a FROM staff_roles WHERE employee_id = ? ORDER BY role, specialty_number").all(id) as any[])
      .map((r) => `${r.role}:${r.n ?? "-"}${r.a ? ":all" : ""}`).join(",");
    const person = { title: "Made-up Tech", highestComplexity: "H", performsTesting: true, hireDate: "2019-03-01" };
    // What the form sends after ticking TC and choosing specialty 1, ticking TS and choosing nothing, and ticking GS.
    const formRoles = [{ role: "TC", specialtyNumber: null }, { role: "TC", specialtyNumber: 1 }, { role: "TS", specialtyNumber: null }, { role: "GS", specialtyNumber: null }];

    // 1. create, lab-scoped and legacy
    const a = await call("POST", `${L}/staff/employees`, { ...person, lastName: "Alpha", firstName: "Made", roles: formRoles }, token);
    const aId = Number(a.j.id);
    check("1a. lab-scoped create: no empty TC beside TC 1; TS keeps its one empty row; GS kept", a.s < 300 && rolesOf(aId) === "GS:-,TC:1,TS:-", `${a.s} ${rolesOf(aId)}`);
    const b = await call("POST", `/api/staff/employees`, { ...person, lastName: "Bravo", firstName: "Made", roles: formRoles }, token, H);
    const bId = Number(b.j.id ?? b.j.employee?.id);
    check("1b. legacy create: the same rows", b.s < 300 && rolesOf(bId) === "GS:-,TC:1,TS:-", `${b.s} ${rolesOf(bId)} ${b.text.slice(0, 120)}`);

    // 2. update: the old rows (with the empty TC) saved straight to the table, as rows saved before this fix are
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, (SELECT lab_id FROM staff_employees WHERE id = ?), 'TC', NULL)").run(aId, aId);
    check("2a. setup: employee A now holds an empty TC beside TC 1, as before the fix", rolesOf(aId) === "GS:-,TC:-,TC:1,TS:-", rolesOf(aId));
    const u1 = await call("PUT", `${L}/staff/employees/${aId}`, { ...person, lastName: "Alpha", firstName: "Made", roles: [...formRoles, { role: "TC", specialtyNumber: 7 }] }, token);
    check("2b. lab-scoped update re-saving the empty TC drops it; TC 1 and 7 stored", u1.s < 300 && rolesOf(aId) === "GS:-,TC:1,TC:7,TS:-", `${u1.s} ${rolesOf(aId)}`);
    const u2 = await call("PUT", `${L}/staff/employees/${aId}`, { ...person, lastName: "Alpha", firstName: "Made", roles: [{ role: "TC", specialtyNumber: null }, { role: "GS", specialtyNumber: null }] }, token);
    check("2c. every TC specialty removed: the empty TC row stays, so TC is still held", u2.s < 300 && rolesOf(aId) === "GS:-,TC:-", `${u2.s} ${rolesOf(aId)}`);
    const u3 = await call("PUT", `/api/staff/employees/${bId}`, { ...person, lastName: "Bravo", firstName: "Made", roles: [{ role: "TS", specialtyNumber: null }, { role: "TS", specialtyNumber: 3 }] }, token, H);
    check("2d. legacy update: empty TS dropped beside TS 3", u3.s < 300 && rolesOf(bId) === "TS:3", `${u3.s} ${rolesOf(bId)} ${u3.text.slice(0, 120)}`);

    // 3. entire-lab flag
    const c = await call("POST", `${L}/staff/employees`, { ...person, lastName: "Charlie", firstName: "Made", roles: [{ role: "TS", specialtyNumber: null }, { role: "TS", specialtyNumber: null, allSpecialties: true }] }, token);
    const cId = Number(c.j.id);
    check("3. an entire-lab TS drops its empty partner and keeps the flag row", c.s < 300 && rolesOf(cId) === "TS:-:all", `${c.s} ${rolesOf(cId)}`);

    // 4. the 209 readiness read is unchanged in kind: A (TC with nothing chosen) is a gap, B and C are not
    const ready = await call("GET", `${L}/staff/cms209-readiness`, undefined, token);
    const gaps = JSON.stringify(ready.j);
    check("4. CMS 209 readiness answers and still names Alpha's TC with no specialty", ready.s === 200 && /Alpha/.test(gaps) && !/Bravo/.test(gaps), `${ready.s} ${gaps.slice(0, 300)}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
