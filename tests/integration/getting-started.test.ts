// tests/integration/getting-started.test.ts
//
// Receipt for parking-lot #72 (2026-10-07): the in-app Getting Started checklist
// is scored from the lab's REAL tables; only the two Phase-5 ticks and the card
// dismissal are stored. Boots the real routes on a scratch DB and proves:
//   1. GET returns the shared 6-phase path (19 steps) with a status per step
//   2. steps the fresh lab already satisfies read done, the rest todo, and the
//      detail says what was looked at
//   3. adding real rows (staff + instrument assignment, a VeritaCheck study)
//      flips the matching steps to done on the next read; nothing is stored
//   4. removing those rows flips them back (derived, never cached)
//   5. manual tick: owner ticks p5.pdfs -> checked and counted; a derived key
//      cannot be ticked (400); dismissal is stored and reported
//   6. another lab's token is refused; the other lab's checklist is untouched
//
// Run (Windows, from bash): DB_PATH=.tmp-gs.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/getting-started.test.ts
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
  const call = (method: string, p: string, body?: unknown, token?: string) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const mkLab = async (tag: string) => {
    const email = `gs-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `GS ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `GS Lab ${tag}`, plan: "hospital", isWarehouse: true }));
    const owner = (sqlite.prepare("SELECT owner_user_id o FROM labs WHERE id = ?").get(prov.labId) as any)?.o;
    return { token: reg.token as string, labId: prov.labId as number, owner };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));
  const get = async (lab: { token: string; labId: number }) => j(await call("GET", `/api/labs/${lab.labId}/getting-started`, undefined, lab.token));
  const step = (p: any, key: string) => p.phases.flatMap((x: any) => x.steps).find((s: any) => s.key === key);

  // 1 + 2
  const g1 = await get(A);
  check("GET returns 6 phases and 19 steps with a percent", g1.phases?.length === 6 && g1.total === 19 && typeof g1.percent === "number", JSON.stringify({ phases: g1.phases?.length, total: g1.total, percent: g1.percent, done: g1.done }));
  check("p1.profile done (registered with a name)", step(g1, "p1.profile")?.status === "done", step(g1, "p1.profile")?.detail);
  check("p1.hipaa done (acknowledged at registration)", step(g1, "p1.hipaa")?.status === "done", step(g1, "p1.hipaa")?.detail);
  // The demo provisioner seeds a few roster rows, none assigned to an instrument: still todo.
  check("p2.staff todo on a fresh lab, with a plain-words detail", step(g1, "p2.staff")?.status === "todo" && /0 instrument assignment/.test(step(g1, "p2.staff")?.detail || ""), step(g1, "p2.staff")?.detail);
  check("p3.study todo on a fresh lab", step(g1, "p3.study")?.status === "todo", step(g1, "p3.study")?.detail);
  check("manual steps report kind=manual and unchecked", step(g1, "p5.pdfs")?.status === "manual" && step(g1, "p5.pdfs")?.checked === false && step(g1, "p5.readiness")?.kind === "manual");
  check("every derived step has an href into the lab", g1.phases.flatMap((x: any) => x.steps).every((s: any) => typeof s.href === "string" && s.href.length > 0));

  // 3. real rows flip steps
  const now = new Date().toISOString();
  const mapCols = (sqlite.prepare("PRAGMA table_info(veritamap_maps)").all() as any[]).map((c) => c.name);
  const mapId = Number((mapCols.includes("lab_id")
    ? sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, 'GS Map', ?, ?)").run(A.owner, A.labId, now, now)
    : sqlite.prepare("INSERT INTO veritamap_maps (user_id, name, created_at, updated_at) VALUES (?, 'GS Map', ?, ?)").run(A.owner, now, now)).lastInsertRowid);
  const inst = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, 'Siemens Atellica CH 930', 'Primary', 'Chemistry', ?)").run(mapId, now).lastInsertRowid);
  // Staff through the REAL VeritaStaff routes, with lab B's staff lab set up
  // FIRST so lab A's staff_labs.id differs from its labs.id: the first version
  // hand-wrote staff_employees.lab_id = labs.id, which is how a wrong-column
  // filter in the p2.staff derivation passed here (found 2026-10-07 by the
  // phase-B module-card receipt; same class as the #59 roster fix).
  const setupStaffLab = (L: { labId: number; token: string }, tag: string) =>
    call("POST", `/api/labs/${L.labId}/staff/lab`, { labName: `GS Lab ${tag}`, cliaNumber: tag === "A" ? "00D0000011" : "00D0000012", certificateType: "compliance", accreditationBody: "CLIA_ONLY" }, L.token);
  const sbB = (await setupStaffLab(B, "B")).status; const sbA = (await setupStaffLab(A, "A")).status;
  const staffLabA = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any;
  check("staff labs set up B then A; lab A's staff_labs.id differs from its labs.id", sbB === 200 && sbA === 200 && !!staffLabA && staffLabA.id !== A.labId, `B=${sbB} A=${sbA} staff_labs.id=${staffLabA?.id} labs.id=${A.labId}`);
  const empRes = await j(await call("POST", `/api/labs/${A.labId}/staff/employees`, { firstName: "Alecia", lastName: "Lillico-Perry", title: "MLS", hireDate: "2025-01-06" }, A.token));
  const emp = Number(empRes.id || 0);
  const asg = await call("PUT", `/api/labs/${A.labId}/staff/employees/${emp}/instruments`, { instrumentIds: [inst] }, A.token);
  check("employee created and assigned through the staff routes", emp > 0 && asg.status === 200, `emp=${emp} assign=${asg.status}`);
  const studyCols = (sqlite.prepare("PRAGMA table_info(studies)").all() as any[]).map((c) => c.name);
  const studyId = Number((studyCols.includes("lab_id")
    ? sqlite.prepare("INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at) VALUES (?, ?, 'Sodium', 'X', 'qa', '2026-10-07', 'method_comparison', 0.04, 1, '%', '[]', '[]', 'completed', ?)").run(A.owner, A.labId, now)
    : sqlite.prepare("INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at) VALUES (?, 'Sodium', 'X', 'qa', '2026-10-07', 'method_comparison', 0.04, 1, '%', '[]', '[]', 'completed', ?)").run(A.owner, now)).lastInsertRowid);
  const g2 = await get(A);
  check("after adding staff + assignment: p2.staff done", step(g2, "p2.staff")?.status === "done", step(g2, "p2.staff")?.detail);
  check("after adding a study: p3.study done", step(g2, "p3.study")?.status === "done", step(g2, "p3.study")?.detail);
  check("done count rose by at least 2", g2.done >= g1.done + 2, `before=${g1.done} after=${g2.done}`);
  check("nothing derived is stored (no onboarding rows yet)", (sqlite.prepare("SELECT COUNT(*) c FROM lab_onboarding_checks WHERE lab_id = ?").get(A.labId) as any).c === 0);

  // 4. derived means it goes back
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(studyId);
  const g3 = await get(A);
  check("study removed: p3.study back to todo (derived, not cached)", step(g3, "p3.study")?.status === "todo");

  // 5. manual ticks
  const tick = await call("POST", `/api/labs/${A.labId}/getting-started/check`, { key: "p5.pdfs", checked: true }, A.token);
  const g4 = await j(tick);
  check("owner ticks p5.pdfs: 200, checked and counted", tick.status === 200 && step(g4, "p5.pdfs")?.checked === true && g4.done === g3.done + 1, `status=${tick.status} done ${g3.done}->${g4.done}`);
  const bad = await call("POST", `/api/labs/${A.labId}/getting-started/check`, { key: "p3.study", checked: true }, A.token);
  check("a derived key cannot be ticked (400)", bad.status === 400, `status=${bad.status}`);
  const dis = await j(await call("POST", `/api/labs/${A.labId}/getting-started/check`, { key: "card.dismissed", checked: true }, A.token));
  check("dismissal stored and reported", dis.dismissed === true && (await get(A)).dismissed === true);
  const untick = await j(await call("POST", `/api/labs/${A.labId}/getting-started/check`, { key: "p5.pdfs", checked: false }, A.token));
  check("untick works", step(untick, "p5.pdfs")?.checked === false && untick.done === g3.done);

  // 6. other lab
  const rb = await call("GET", `/api/labs/${A.labId}/getting-started`, undefined, B.token);
  check("another lab's token is refused (403/404)", rb.status === 403 || rb.status === 404, `status=${rb.status}`);
  const gB = await get(B);
  check("lab B's checklist is its own (staff step still todo, not dismissed)", step(gB, "p2.staff")?.status === "todo" && gB.dismissed === false);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
