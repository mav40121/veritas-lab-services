// tests/integration/staff-duty-change-setup.test.ts
//
// Receipt for BUG-024 (Michael Q72/Q74 = 1, 2026-10-11). 42 CFR §493.1413(b)(9) / §493.1451(b)(9) require
// reevaluation before reporting when test methodology or instrumentation CHANGES; a person's first recorded test
// systems (existing duties entered at setup, or a new hire's first duties covered by training and the initial
// competency) are not a change. Boots the REAL routes on a scratch DB and proves:
//   1. per-employee save, first time: 0 duty-change events; the baseline is set
//   2. a second per-employee save inside the setup session (24 h) adding a test system: still 0 events
//   3. after the setup session (baseline back-dated 2 days), adding a test system raises 1 event
//   4. unchanged assignments keep their original created_at (no delete-all / insert-all)
//   5. per-instrument save for a person with no assignments: 0 events; after the setup session: 1 event
//   6. GET duty-change-events lists the 2 open items
//   7. close without a reason -> 400; another lab's token -> 403/404; nothing changes
//   8. close with a reason -> 200, item gone from the list; stored as not_a_change with reason and who
//   9. admin close-setup: dry run counts a legacy setup event (logged at the person's first assignment) and writes
//      nothing; the real run closes it as 'setup' and leaves the later (real) event open
// Run (Windows, from bash): DB_PATH=.tmp-dcs.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/staff-duty-change-setup.test.ts
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
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const mkLab = async (tag: string) => {
    const email = `dcs-${tag}-${Date.now()}@example.com`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: `DCS ${tag}`, hipaa_acknowledged: true })).j;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `DCS Lab ${tag}`, plan: "hospital" })).j.labId;
    return { token: reg.token as string, labId: labId as number, userId: Number(reg.user?.id ?? reg.userId ?? 0) };
  };
  const A = await mkLab("A"), B = await mkLab("B");
  const L = `/api/labs/${A.labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "DCS Lab A", cliaNumber: "11D1234567", accreditationBody: "CLIA_ONLY", complexity: "high" }, A.token);
  const map = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, A.token)).j;
  const inst: number[] = [];
  for (const n of ["Analyzer One", "Analyzer Two", "Analyzer Three", "Analyzer Four"]) inst.push((await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: n, role: "Primary", category: "Chemistry" }, A.token)).j.id);
  const mkEmp = async (first: string) => (await call("POST", `${L}/staff/employees`, { lastName: "Tester", firstName: first, highestComplexity: "high", performsTesting: true, hireDate: "2019-03-01" }, A.token)).j;
  const e1 = await mkEmp("Avery"), e2 = await mkEmp("Blake");
  check("fixture: lab, map with 4 test systems, 2 employees", inst.every(Boolean) && !!e1?.id && !!e2?.id, JSON.stringify({ inst, e1: e1?.id, e2: e2?.id }));
  const events = (emp: number) => (sqlite.prepare("SELECT * FROM staff_duty_change_events WHERE employee_id = ? ORDER BY id").all(emp) as any[]);
  const baseline = (emp: number) => (sqlite.prepare("SELECT duties_baseline_at FROM staff_employees WHERE id = ?").get(emp) as any)?.duties_baseline_at;
  const backdate = (emp: number, days: number) => {
    const t = new Date(Date.now() - days * 86400000).toISOString();
    sqlite.prepare("UPDATE staff_employees SET duties_baseline_at = ? WHERE id = ?").run(t, emp);
    sqlite.prepare("UPDATE staff_employee_instruments SET created_at = ? WHERE employee_id = ?").run(t, emp);
    return t;
  };

  const r1 = await call("PUT", `${L}/staff/employees/${e1.id}/instruments`, { instrumentIds: [inst[0], inst[1]] }, A.token);
  check("1. first per-employee save: 0 events, baseline set", r1.s === 200 && r1.j.dutyChangeEventsCreated === 0 && r1.j.setupSession === true && events(e1.id).length === 0 && !!baseline(e1.id), JSON.stringify({ s: r1.s, j: r1.j, base: baseline(e1.id) }));
  const r2 = await call("PUT", `${L}/staff/employees/${e1.id}/instruments`, { instrumentIds: [inst[0], inst[1], inst[2]] }, A.token);
  check("2. addition inside the setup session: still 0 events", r2.s === 200 && r2.j.dutyChangeEventsCreated === 0 && events(e1.id).length === 0, JSON.stringify(r2.j));
  const old = backdate(e1.id, 2);
  const r3 = await call("PUT", `${L}/staff/employees/${e1.id}/instruments`, { instrumentIds: [inst[0], inst[1], inst[2], inst[3]] }, A.token);
  check("3. addition after the setup session: 1 event (Analyzer Four)", r3.s === 200 && r3.j.dutyChangeEventsCreated === 1 && events(e1.id).length === 1 && events(e1.id)[0].instrument_id === inst[3], JSON.stringify(r3.j));
  const kept = sqlite.prepare("SELECT instrument_id, created_at FROM staff_employee_instruments WHERE employee_id = ? ORDER BY instrument_id").all(e1.id) as any[];
  check("4. unchanged assignments keep their original date", kept.filter((k) => k.instrument_id !== inst[3]).every((k) => k.created_at === old) && kept.find((k) => k.instrument_id === inst[3])?.created_at !== old, JSON.stringify(kept.map((k) => [k.instrument_id, k.created_at.slice(0, 16)])));

  const r5a = await call("PUT", `${L}/staff/instruments/${inst[0]}/employees`, { employeeIds: [e1.id, e2.id] }, A.token);
  const after5a = events(e2.id).length;
  backdate(e2.id, 2);
  const r5b = await call("PUT", `${L}/staff/instruments/${inst[1]}/employees`, { employeeIds: [e1.id, e2.id] }, A.token);
  check("5. per-instrument: first assignment 0 events; after the setup session 1 event", r5a.s === 200 && r5a.j.dutyChangeEventsCreated === 0 && after5a === 0 && r5b.s === 200 && r5b.j.dutyChangeEventsCreated === 1 && events(e2.id).length === 1, JSON.stringify({ a: r5a.j, b: r5b.j }));

  const list = (await call("GET", `${L}/staff/duty-change-events`, undefined, A.token)).j;
  check("6. list shows the 2 open items", Array.isArray(list) && list.length === 2, JSON.stringify(Array.isArray(list) ? list.map((x: any) => [x.employeeName, x.instrumentName]) : list));

  const ev1 = events(e1.id)[0].id;
  const noReason = await call("POST", `${L}/staff/duty-change-events/close`, { eventIds: [ev1] }, A.token);
  const otherLab = await call("POST", `${L}/staff/duty-change-events/close`, { eventIds: [ev1], reason: "x" }, B.token);
  check("7. close without a reason 400; another lab's token refused; still open", noReason.s === 400 && (otherLab.s === 403 || otherLab.s === 404) && !events(e1.id)[0].resolved_at, `noReason=${noReason.s} otherLab=${otherLab.s}`);
  const reason = "Already performed this test system; it was missing from the record";
  const ok = await call("POST", `${L}/staff/duty-change-events/close`, { eventIds: [ev1], reason }, A.token);
  const row = events(e1.id)[0];
  const list2 = (await call("GET", `${L}/staff/duty-change-events`, undefined, A.token)).j;
  check("8. close with a reason: 200; stored as not_a_change with reason and who; gone from the list", ok.s === 200 && ok.j.closed === 1 && !!row.resolved_at && row.resolution_type === "not_a_change" && row.resolution_reason === reason && Number(row.resolved_by_user_id) === A.userId && list2.length === 1,
    JSON.stringify({ s: ok.s, j: ok.j, row: { t: row.resolution_type, r: row.resolution_reason, by: row.resolved_by_user_id }, left: list2.length }));

  // 9. A legacy setup event: the old rule logged one at the person's first assignment. Simulate it on a fresh
  // employee with no baseline: assignment + event at the same instant 3 days ago.
  const e3 = await mkEmp("Casey");
  const t3 = new Date(Date.now() - 3 * 86400000).toISOString();
  sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(e3.id, inst[0], t3);
  sqlite.prepare("INSERT INTO staff_duty_change_events (lab_id, employee_id, instrument_id, detected_at) VALUES (?, ?, ?, ?)").run(A.labId, e3.id, inst[0], t3);
  const dry = (await call("POST", "/api/admin/staff/duty-change-events/close-setup", { secret: ADMIN, labIds: [A.labId] })).j;
  const dryLab = (dry.labs || []).find((x: any) => x.labId === A.labId);
  const stillOpen = !events(e3.id)[0].resolved_at;
  const run = (await call("POST", "/api/admin/staff/duty-change-events/close-setup", { secret: ADMIN, labIds: [A.labId], dryRun: false })).j;
  const e3row = events(e3.id)[0], e2row = events(e2.id)[0];
  check("9. close-setup: dry run counts 1 setup + 1 later and writes nothing; run closes the setup one only",
    dry.dryRun === true && dryLab?.setupEvents === 1 && dryLab?.laterEvents === 1 && stillOpen && run.dryRun === false && e3row.resolution_type === "setup" && !!e3row.resolved_at && !e2row.resolved_at && baseline(e3.id) === t3,
    JSON.stringify({ dry: dryLab, run: run.totals, e3: e3row.resolution_type, e2open: !e2row.resolved_at, base3: baseline(e3.id) === t3 }));

  // 10. Compliance score: only real duty changes count. Open now: e2's real event (1); closed as not_a_change (e1)
  // and setup (e3) are excluded, so the signal is 0 of 1 resolved = 0%; once e2's is closed as not a change too,
  // nothing real remains and the signal reads 100.
  const sig = async () => { const j = (await call("GET", `${L}/compliance/score`, undefined, A.token)).j; return JSON.stringify(j).match(/"(?:dutyChange[A-Za-z]*|signalE|dutyChangeEventsResolved)"\s*:\s*(\{[^}]*\}|[0-9]+)/)?.[0] ?? JSON.stringify(j).slice(0, 300); };
  const before10 = await sig();
  await call("POST", `${L}/staff/duty-change-events/close`, { eventIds: [events(e2.id)[0].id], reason: "Recorded at setup: existing duty" }, A.token);
  const after10 = await sig();
  check("10. compliance score counts only real duty changes (0% with one open real item, 100% once none remain)", /\b0\b/.test(before10) && /\b100\b/.test(after10), `before ${before10} | after ${after10}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
