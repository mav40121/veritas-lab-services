// tests/integration/veritamap-delete-cascade.test.ts
//
// Receipt for the 2026-10-07 "Failed to delete map" on lab 3: the delete ran as
// seven separate statements with no transaction and died at the instrument
// delete on the foreign key from staff_duty_change_events, leaving a shell
// (tests gone, map + instruments left, every later click failing). The cascade
// now lives in server/veritamapDelete.ts, runs in one transaction, and clears
// the VeritaStaff rows that point at the map's instruments. Boots the REAL
// routes on a scratch DB and proves:
//   1. a map whose instrument is assigned to a staff member and tracked by a
//      duty-change event deletes with 200, nothing dangling, the employee kept
//   2. a map that is still referenced by something else answers 409 naming the
//      blocker, and stays WHOLE (tests and instruments intact, no shell)
//   3. once the blocker is gone the same map deletes with 200
//   4. the legacy user-scoped route uses the same cascade
//   5. another lab's token cannot delete the map (403/404)
//
// Run (Windows, from bash): DB_PATH=.tmp-mapdel.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-delete-cascade.test.ts
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

  const mkLab = async (tag: string) => {
    const email = `mapdel-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `MapDel ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `MapDel Lab ${tag}`, plan: "hospital", isWarehouse: true }));
    const owner = (sqlite.prepare("SELECT owner_user_id o FROM labs WHERE id = ?").get(prov.labId) as any)?.o;
    return { token: reg.token as string, labId: prov.labId as number, owner };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));
  const fkOn = (sqlite.prepare("PRAGMA foreign_keys").get() as any)?.foreign_keys;
  check("foreign keys are enforced on this connection (as in production)", fkOn === 1, `foreign_keys=${fkOn}`);

  const now = new Date().toISOString();
  const mapCols = (sqlite.prepare("PRAGMA table_info(veritamap_maps)").all() as any[]).map((c) => c.name);
  const mkMap = (name: string) => Number((mapCols.includes("lab_id")
    ? sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(A.owner, A.labId, name, now, now)
    : sqlite.prepare("INSERT INTO veritamap_maps (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(A.owner, name, now, now)).lastInsertRowid);
  const mkInst = (mapId: number, name: string) => Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, 'Primary', 'Chemistry', ?)").run(mapId, name, now).lastInsertRowid);
  const mkTest = (mapId: number, instId: number, analyte: string) => {
    sqlite.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, updated_at) VALUES (?, ?, 'Chemistry', 'MODERATE', 1, ?)").run(mapId, analyte, now);
    sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'Chemistry', 'MODERATE', 1)").run(instId, mapId, analyte);
  };
  const count = (sql: string, ...args: any[]) => (sqlite.prepare(sql).get(...args) as any).c as number;
  const mapState = (mapId: number) => ({
    maps: count("SELECT COUNT(*) c FROM veritamap_maps WHERE id = ?", mapId),
    instruments: count("SELECT COUNT(*) c FROM veritamap_instruments WHERE map_id = ?", mapId),
    tests: count("SELECT COUNT(*) c FROM veritamap_tests WHERE map_id = ?", mapId),
    instrument_tests: count("SELECT COUNT(*) c FROM veritamap_instrument_tests WHERE map_id = ?", mapId),
    assignments: count("SELECT COUNT(*) c FROM staff_employee_instruments WHERE instrument_id IN (SELECT id FROM veritamap_instruments WHERE map_id = ?)", mapId),
    duty_events: count("SELECT COUNT(*) c FROM staff_duty_change_events WHERE instrument_id IN (SELECT id FROM veritamap_instruments WHERE map_id = ?)", mapId),
  });

  // 1. The production shape: an instrument that is assigned to a staff member and duty-tracked.
  const m1 = mkMap("Angie Test");
  const i1 = mkInst(m1, "Siemens Atellica CH 930"), i2 = mkInst(m1, "Sysmex XN-1000");
  mkTest(m1, i1, "Sodium"); mkTest(m1, i2, "Hemoglobin");
  const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, 'Lillico-Perry', 'Alecia', 'MLS', 'active', ?, ?)").run(A.labId, A.owner, now, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, i1, now);
  sqlite.prepare("INSERT INTO staff_duty_change_events (lab_id, employee_id, instrument_id, detected_at) VALUES (?, ?, ?, ?)").run(A.labId, emp, i1, now);
  const before1 = mapState(m1);
  check("fixture: map with 2 instruments, 2 tests, 1 assignment, 1 duty event", before1.instruments === 2 && before1.tests === 2 && before1.assignments === 1 && before1.duty_events === 1, JSON.stringify(before1));
  const r1 = await call("DELETE", `/api/labs/${A.labId}/veritamap/maps/${m1}`, undefined, A.token);
  const b1 = await j(r1);
  check("duty-tracked map deletes with 200", r1.status === 200 && b1.ok === true, `status=${r1.status} ${JSON.stringify(b1).slice(0, 200)}`);
  check("counts report the VeritaStaff rows cleared", b1.counts?.duty_change_events === 1 && b1.counts?.staff_assignments === 1 && b1.counts?.instruments === 2 && b1.counts?.tests === 2, JSON.stringify(b1.counts));
  const after1 = mapState(m1);
  check("nothing dangling: map, instruments, tests, assignments, events all gone", Object.values(after1).every((v) => v === 0), JSON.stringify(after1));
  check("the staff employee herself is untouched", count("SELECT COUNT(*) c FROM staff_employees WHERE id = ?", emp) === 1);

  // 2. Atomicity: a blocker nobody anticipated -> 409 naming it, map stays whole.
  const m2 = mkMap("VP's Test menu");
  const i3 = mkInst(m2, "Roche cobas c 503");
  mkTest(m2, i3, "Glucose");
  sqlite.exec("CREATE TABLE IF NOT EXISTS zz_test_fk_block (id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_id INTEGER NOT NULL REFERENCES veritamap_instruments(id))");
  sqlite.prepare("INSERT INTO zz_test_fk_block (instrument_id) VALUES (?)").run(i3);
  const r2 = await call("DELETE", `/api/labs/${A.labId}/veritamap/maps/${m2}`, undefined, A.token);
  const b2 = await j(r2);
  check("blocked delete answers 409, not 500", r2.status === 409, `status=${r2.status} ${JSON.stringify(b2).slice(0, 200)}`);
  check("409 names the blocking table and row count", /zz_test_fk_block \(1\)/.test(b2.error || ""), b2.error);
  const after2 = mapState(m2);
  check("blocked map stays WHOLE (no shell): 1 instrument, 1 test, 1 instrument_test still there", after2.maps === 1 && after2.instruments === 1 && after2.tests === 1 && after2.instrument_tests === 1, JSON.stringify(after2));

  // 3. Blocker removed -> deletes.
  sqlite.prepare("DELETE FROM zz_test_fk_block WHERE instrument_id = ?").run(i3);
  const r3 = await call("DELETE", `/api/labs/${A.labId}/veritamap/maps/${m2}`, undefined, A.token);
  check("same map deletes with 200 once the blocker is gone", r3.status === 200 && Object.values(mapState(m2)).every((v) => v === 0), `status=${r3.status} ${JSON.stringify(mapState(m2))}`);

  // 4. Legacy user-scoped route shares the cascade.
  const m3 = mkMap("FGH Map");
  const i4 = mkInst(m3, "Abbott ARCHITECT c4000");
  mkTest(m3, i4, "Potassium");
  sqlite.prepare("INSERT INTO staff_duty_change_events (lab_id, employee_id, instrument_id, detected_at) VALUES (?, ?, ?, ?)").run(A.labId, emp, i4, now);
  const r4 = await call("DELETE", `/api/veritamap/maps/${m3}`, undefined, A.token);
  check("legacy route: duty-tracked map deletes with 200 and leaves nothing", r4.status === 200 && Object.values(mapState(m3)).every((v) => v === 0), `status=${r4.status} ${JSON.stringify(mapState(m3))}`);

  // 5. Another lab cannot delete lab A's map.
  const m4 = mkMap("Sanford Test");
  mkInst(m4, "Beckman AU480");
  const r5 = await call("DELETE", `/api/labs/${A.labId}/veritamap/maps/${m4}`, undefined, B.token);
  check("another lab's token is refused (403/404) and the map is untouched", (r5.status === 403 || r5.status === 404) && mapState(m4).maps === 1, `status=${r5.status}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
