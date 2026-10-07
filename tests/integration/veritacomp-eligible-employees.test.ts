// tests/integration/veritacomp-eligible-employees.test.ts
//
// Receipt for parking-lot #59 (2026-10-07, Michael's Option 2). The legacy
// "New Technical Assessment" dialog read competency_employees (empty for labs
// that onboard staff through VeritaStaff) and said "No active employees" even
// when roster members were assigned the program's instruments. The new
// GET /api/labs/:labId/competency/programs/:id/eligible-employees returns the
// lab's active VeritaStaff employees assigned to the program's instruments,
// auto-bridged into competency_employees. Boots the REAL routes on a scratch DB
// and proves:
//   1. an active staff member assigned to the program's instrument is returned,
//      with a competency_employees bridge row created for them
//   2. an active staff member assigned to a DIFFERENT instrument is excluded
//   3. an inactive staff member assigned to the instrument is excluded
//   4. a second call is idempotent (same bridge id, no duplicate row)
//   5. a program with no method groups falls back to any-instrument matching
//   6. another lab cannot read it (403/404 through the lab scope)
//
// Run (Windows, from bash): DB_PATH=.tmp-elig.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritacomp-eligible-employees.test.ts
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
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  // Two labs: the one under test and a stranger.
  const mkLab = async (tag: string) => {
    const email = `elig-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `Elig ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Elig Lab ${tag}`, plan: "hospital", isWarehouse: true }));
    return { token: reg.token as string, labId: prov.labId as number, userId: reg.user?.id ?? reg.userId };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));

  // A map with two instruments on lab A (fixture, own rows; no lab data touched).
  const ownerA = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(A.labId) as any)?.owner_user_id;
  const now = new Date().toISOString();
  const mapCols = (sqlite.prepare("PRAGMA table_info(veritamap_maps)").all() as any[]).map((c) => c.name);
  const mapId = Number((mapCols.includes("lab_id")
    ? sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, 'Elig Map', ?, ?)").run(ownerA, A.labId, now, now)
    : sqlite.prepare("INSERT INTO veritamap_maps (user_id, name, created_at, updated_at) VALUES (?, 'Elig Map', ?, ?)").run(ownerA, now, now)).lastInsertRowid);
  const insInst = sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, 'Primary', 'Chemistry', ?)");
  const instX = { id: Number(insInst.run(mapId, "Siemens Atellica CH 930", now).lastInsertRowid), instrument_name: "Siemens Atellica CH 930" };
  const instY = { id: Number(insInst.run(mapId, "Sysmex XN-1000", now).lastInsertRowid), instrument_name: "Sysmex XN-1000" };
  check("fixture: map with two instruments on lab A", instX.id > 0 && instY.id > 0, `map=${mapId}`);

  // Staff: Alecia (active, assigned X), Bob (active, assigned Y only), Cara (inactive, assigned X)
  const insStaff = sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const alecia = Number(insStaff.run(A.labId, ownerA, "Lillico-Perry", "Alecia", "MLS", "active", now, now).lastInsertRowid);
  const bob = Number(insStaff.run(A.labId, ownerA, "Benchman", "Bob", "MLT", "active", now, now).lastInsertRowid);
  const cara = Number(insStaff.run(A.labId, ownerA, "Former", "Cara", "MLS", "inactive", now, now).lastInsertRowid);
  const insAssign = sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)");
  insAssign.run(alecia, instX.id, now); insAssign.run(bob, instY.id, now); insAssign.run(cara, instX.id, now);

  // Technical program whose only method group names instrument X.
  const prog = await j(await call("POST", `/api/labs/${A.labId}/competency/programs`, {
    name: "Chemistry Analyzer Competency", department: "Chemistry", type: "technical", mapId: null,
    methodGroups: [{ name: `Chemistry - ${instX.instrument_name}`, instruments: [instX.instrument_name], analytes: ["Sodium", "Potassium"] }],
  }, A.token));
  check("program created", !!prog.id, JSON.stringify(prog).slice(0, 120));

  const compBefore = (sqlite.prepare("SELECT COUNT(*) c FROM competency_employees WHERE lab_id = ?").get(A.labId) as any).c;
  const r1 = await call("GET", `/api/labs/${A.labId}/competency/programs/${prog.id}/eligible-employees`, undefined, A.token);
  const e1 = await j(r1);
  check("eligible-employees answers 200", r1.status === 200, `status=${r1.status} ${JSON.stringify(e1).slice(0, 160)}`);
  const names1 = (e1.employees || []).map((e: any) => e.name);
  check("Alecia (active, assigned the program's instrument) is returned", names1.includes("Alecia Lillico-Perry"), JSON.stringify(names1));
  check("Bob (assigned a different instrument) is excluded", !names1.includes("Bob Benchman"), JSON.stringify(names1));
  check("Cara (inactive) is excluded", !names1.includes("Cara Former"), JSON.stringify(names1));
  check("matched by the program's instruments", e1.matchedBy === "program-instruments" && (e1.instruments || []).length === 1, JSON.stringify({ matchedBy: e1.matchedBy, instruments: e1.instruments }));
  const compAfter = (sqlite.prepare("SELECT COUNT(*) c FROM competency_employees WHERE lab_id = ?").get(A.labId) as any).c;
  check("exactly one competency_employees bridge row created", compAfter === compBefore + 1, `before=${compBefore} after=${compAfter}`);
  const bridge = sqlite.prepare("SELECT id, user_id, lab_id, status, staff_employee_id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(alecia, A.labId) as any;
  check("bridge row carries lab, owner user id, active status, staff link", !!bridge && bridge.user_id === ownerA && bridge.status === "active", JSON.stringify(bridge));
  const aleciaRow = (e1.employees || []).find((e: any) => e.name === "Alecia Lillico-Perry");
  check("returned id IS the bridge id (usable as assessment employee_id)", aleciaRow?.id === bridge?.id, `returned=${aleciaRow?.id} bridge=${bridge?.id}`);

  // Idempotent
  const e2 = await j(await call("GET", `/api/labs/${A.labId}/competency/programs/${prog.id}/eligible-employees`, undefined, A.token));
  const compAgain = (sqlite.prepare("SELECT COUNT(*) c FROM competency_employees WHERE lab_id = ?").get(A.labId) as any).c;
  check("second call: same id, no duplicate bridge row", (e2.employees || [])[0]?.id === bridge?.id && compAgain === compAfter, `count=${compAgain}`);

  // No-method-group program: falls back to any assigned, active staff (Alecia + Bob)
  const prog2 = await j(await call("POST", `/api/labs/${A.labId}/competency/programs`, { name: "Blank program", department: "Chemistry", type: "technical", mapId: null, methodGroups: [] }, A.token));
  const e3 = await j(await call("GET", `/api/labs/${A.labId}/competency/programs/${prog2.id}/eligible-employees`, undefined, A.token));
  const names3 = (e3.employees || []).map((e: any) => e.name).sort();
  check("no method groups: any-instrument fallback returns the two active assigned staff", e3.matchedBy === "any-instrument" && names3.join("|") === "Alecia Lillico-Perry|Bob Benchman", JSON.stringify(names3));

  // Lab B cannot read lab A's program
  const rb = await call("GET", `/api/labs/${A.labId}/competency/programs/${prog.id}/eligible-employees`, undefined, B.token);
  check("another lab's token is refused (403/404)", rb.status === 403 || rb.status === 404, `status=${rb.status}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
