// tests/integration/veritaqa-all-departments.test.ts
//
// STANDING integration test for VeritaQA's All departments choice (Michael 2026-11-12, "in qa, we need an option to
// 'see all' instead of only by department"). GET /api/pi/metrics, /api/pi/entries and /api/pi/dashboard take
// department_id=all:
//   1. "all" is exactly each department's own list put together, in the department list's order (sort_order, then id),
//      so the All view can't show a metric no department shows, or leave one out.
//   2. The dashboard's "all" leaves out an inactive metric, as a department's dashboard does, and each metric's
//      computed values are the same as in its own department's dashboard.
//   3. Entries for "all" are every department's entries for that year, and no other year's.
//   4. Another account's departments and metrics never appear, and a metric pointing at a department that isn't the
//      account's isn't in "all" (it is in no department's list either).
//   5. One department reads as it did, and a missing department_id is still 400.
//   6. The reads change no VeritaQA row and write no audit row (the access log, record_views, records reads by design).
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritaqa-all-departments

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`);
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
  const PW = ["Qa", "All", "77!"].join("-");
  const stamp = Date.now();

  const call = async (p: string, opts: { token?: string; lab?: number } = {}) => {
    const r = await fetch(base + p, {
      headers: {
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.lab ? { "X-Active-Lab-Id": String(opts.lab) } : {}),
      },
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: json };
  };
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);
  // record_views is left out on purpose: every signed-in read of a lab's data is logged there (server/recordViews.ts).
  const tables = ["pi_departments", "pi_metrics", "pi_entries", "pi_plan", "audit_log"];
  const counts = () => tables.map((t) => { try { return n(`SELECT COUNT(*) AS n FROM ${t}`); } catch { return -1; } }).join(",");

  const register = async (tag: string) => {
    const email = `qaall-${tag}-${stamp}@example.com`;
    const r = await fetch(base + "/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PW, name: `Made Up ${tag}`, hipaa_acknowledged: true }),
    }).then((x) => x.json());
    return { email, id: Number(r.user?.id), token: r.token as string };
  };
  const provision = async (ownerEmail: string, labName: string) => {
    const r = await fetch(base + "/api/admin/provision-demo-lab", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: ADMIN, ownerEmail, labName, plan: "hospital", isWarehouse: true }),
    }).then((x) => x.json());
    return r.labId as number;
  };

  const owner = await register("owner");
  const lab = await provision(owner.email, "Made Up Main Lab");
  const other = await register("other");
  const otherLab = await provision(other.email, "Made Up Other Lab");

  // Made-up rows. The owner's departments are listed out of id order (Bylas sort_order 0, San Carlos 1), so the order
  // test means something; San Carlos holds an inactive metric; one metric points at the other account's department.
  const now = new Date().toISOString();
  const dept = (account: number, name: string, sort: number) =>
    Number(sqlite.prepare("INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)").run(account, name, sort, now).lastInsertRowid);
  const metric = (deptId: number, account: number, name: string, sort: number, active = 1, green = 5) =>
    Number(sqlite.prepare("INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, sort_order, active, created_at) VALUES (?, ?, ?, '%', 'lower_is_better', ?, ?, ?, ?)").run(deptId, account, name, green, sort, active, now).lastInsertRowid);
  const entry = (metricId: number, account: number, year: number, month: number, value: number) =>
    sqlite.prepare("INSERT INTO pi_entries (metric_id, account_id, year, month, value, volume) VALUES (?, ?, ?, ?, ?, 100)").run(metricId, account, year, month, value);

  const sanCarlos = dept(owner.id, "San Carlos: Chemistry", 1);
  const bylas = dept(owner.id, "Bylas: Hematology", 0);
  const scA = metric(sanCarlos, owner.id, "Hemolysis rate", 1);
  const scB = metric(sanCarlos, owner.id, "Redraws", 0);
  const scOff = metric(sanCarlos, owner.id, "Retired indicator", 2, 0);
  const byA = metric(bylas, owner.id, "Clotted CBCs", 0, 1, 2);
  const otherDept = dept(other.id, "Other Dept", 0);
  const otherMetric = metric(otherDept, other.id, "Other metric", 0);
  const stray = metric(otherDept, owner.id, "Points at another account's department", 0);
  entry(scA, owner.id, 2026, 1, 4.1); entry(scA, owner.id, 2026, 2, 6.2); entry(scA, owner.id, 2025, 12, 3.3);
  entry(scB, owner.id, 2026, 1, 1.0);
  entry(scOff, owner.id, 2026, 1, 9.9);
  entry(byA, owner.id, 2026, 3, 1.5); entry(byA, owner.id, 2025, 6, 2.5);
  entry(otherMetric, other.id, 2026, 1, 7.7);
  entry(stray, owner.id, 2026, 1, 8.8);

  const as = { token: owner.token, lab };
  const ids = (rows: any) => (Array.isArray(rows) ? rows.map((r: any) => r.id ?? r.metric?.id) : []);
  try {
    const before = counts();

    // 1. Metrics.
    const depts = await call("/api/pi/departments", as);
    const deptOrder = ids(depts.body);
    check("0. the department list is in sort_order: Bylas, then San Carlos", JSON.stringify(deptOrder) === JSON.stringify([bylas, sanCarlos]), JSON.stringify(deptOrder));
    const perDept: number[] = [];
    for (const d of deptOrder) perDept.push(...ids((await call(`/api/pi/metrics?department_id=${d}`, as)).body));
    const all = await call("/api/pi/metrics?department_id=all", as);
    check("1. metrics for all = each department's list put together, in the department list's order",
      all.status === 200 && JSON.stringify(ids(all.body)) === JSON.stringify(perDept) && JSON.stringify(perDept) === JSON.stringify([byA, scB, scA, scOff]),
      `${all.status} all=${JSON.stringify(ids(all.body))} perDept=${JSON.stringify(perDept)}`);

    // 2. Dashboard.
    const dashPer: any[] = [];
    for (const d of deptOrder) dashPer.push(...((await call(`/api/pi/dashboard?year=2026&department_id=${d}`, as)).body.metrics || []));
    const dashAll = await call("/api/pi/dashboard?year=2026&department_id=all", as);
    const dm = dashAll.body.metrics || [];
    check("2. the dashboard for all = each department's dashboard put together, inactive left out",
      dashAll.status === 200 && JSON.stringify(ids(dm)) === JSON.stringify([byA, scB, scA]), `${dashAll.status} ${JSON.stringify(ids(dm))}`);
    check("2. ... with each metric's computed values the same as on its own department's dashboard", JSON.stringify(dm) === JSON.stringify(dashPer));
    const hemo = dm.find((x: any) => x.metric.id === scA);
    check("2. ... e.g. Hemolysis rate: Feb 6.2 is current and red, YTD 5.15, prior year 3.3",
      hemo && hemo.currentValue === 6.2 && hemo.currentStatus === "red" && Math.abs(hemo.ytdAvg - 5.15) < 1e-9 && hemo.pyAvg === 3.3, JSON.stringify(hemo).slice(0, 300));

    // 3. Entries.
    const entPer: number[] = [];
    for (const d of deptOrder) entPer.push(...ids((await call(`/api/pi/entries?year=2026&department_id=${d}`, as)).body));
    const entAll = await call("/api/pi/entries?year=2026&department_id=all", as);
    const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
    check("3. entries for all = every department's 2026 entries", entAll.status === 200 && JSON.stringify(sorted(ids(entAll.body))) === JSON.stringify(sorted(entPer)) && entPer.length === 5,
      `${entAll.status} all=${JSON.stringify(sorted(ids(entAll.body)))} per=${JSON.stringify(sorted(entPer))}`);
    check("3. ... and no other year's", (entAll.body as any[]).every((e) => e.year === 2026));

    // 4. Other accounts.
    const allIds = ids(all.body);
    check("4. another account's metric isn't in the owner's all", !allIds.includes(otherMetric));
    check("4. a metric pointing at a department that isn't the account's isn't in all", !allIds.includes(stray) && !(entAll.body as any[]).some((e) => e.metric_id === stray));
    const theirs = await call("/api/pi/metrics?department_id=all", { token: other.token, lab: otherLab });
    check("4. the other account's all is only its own metric", theirs.status === 200 && JSON.stringify(ids(theirs.body)) === JSON.stringify([otherMetric]), JSON.stringify(theirs.body).slice(0, 200));

    // 5. One department, and the 400.
    const one = await call(`/api/pi/metrics?department_id=${sanCarlos}`, as);
    check("5. one department still lists its own metrics, inactive included, by sort_order", JSON.stringify(ids(one.body)) === JSON.stringify([scB, scA, scOff]), JSON.stringify(ids(one.body)));
    const none = await call("/api/pi/metrics", as);
    const noneDash = await call("/api/pi/dashboard?year=2026", as);
    check("5. a missing department_id is still 400", none.status === 400 && noneDash.status === 400, `${none.status} ${noneDash.status}`);

    // 6. No writes.
    check("6. the reads change no VeritaQA row and write no audit row", counts() === before, `${before} -> ${counts()}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
