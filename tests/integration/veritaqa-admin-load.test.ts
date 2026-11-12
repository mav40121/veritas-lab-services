// tests/integration/veritaqa-admin-load.test.ts
//
// STANDING integration test for the VeritaQA admin load (Michael 2026-11-12, Q304 = 1; SCAHC's 2027 QA/QI plan):
//   1. Both routes are guarded (no header, or the secret only in the query, is 403), and a bad or unknown account is 400 / 404.
//   2. A body that isn't well formed is 400 BAD_LOAD and writes nothing (no goal, an unknown unit, a department listed twice).
//   3. An account that doesn't own every lab named is 409 LAB_MISMATCH and writes nothing, so a plan can't land in another customer.
//   4. A dry run reports what it would add and writes nothing (every VeritaQA table and audit_log).
//   5. Apply adds the departments, indicators (goal, unit, direction, method, TAT fields) and the PI plan to that account only,
//      with one audit_log row; the module's own screen routes (GET /api/pi/departments, /api/pi/metrics, /api/pi/plan) show them.
//   6. A rerun adds nothing.
//   7. What the account already had is never changed: an existing indicator keeps its goal and its monthly result, an existing
//      active plan is left alone, and another account's rows don't move.
//   8. The summary route gives counts and names, and writes nothing.
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritaqa-admin-load

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
  const PW = ["Qa", "Load", "77!"].join("-");
  const stamp = Date.now();

  const call = async (method: string, p: string, body?: unknown, opts: { token?: string; secret?: string | null; lab?: number } = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.secret ? { "x-admin-secret": opts.secret } : {}),
        ...(opts.lab ? { "X-Active-Lab-Id": String(opts.lab) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: json };
  };
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as any).n);
  const tables = ["pi_departments", "pi_metrics", "pi_entries", "pi_plan", "pi_plan_priority", "pi_plan_review", "audit_log"];
  const counts = () => tables.map((t) => n(`SELECT COUNT(*) AS n FROM ${t}`)).join(",");

  const register = async (tag: string) => {
    const email = `qaload-${tag}-${stamp}@example.com`;
    const r = await call("POST", "/api/auth/register", { email, password: PW, name: `Made Up ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body.user?.id), token: r.body.token as string };
  };
  const provision = async (ownerEmail: string, labName: string) =>
    (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName, plan: "hospital", isWarehouse: true })).body.labId as number;

  const owner = await register("owner");
  const labA = await provision(owner.email, "Made Up Main Lab");
  const labB = await provision(owner.email, "Made Up Clinic Lab");
  const other = await register("other");
  const otherLab = await provision(other.email, "Made Up Other Lab");

  // What each account already has: the owner a Chemistry department with one indicator and a monthly result, plus an
  // active plan in a second check below; the other account a department and indicator of its own.
  const now = new Date().toISOString();
  const deptChem = Number(sqlite.prepare("INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, 'San Carlos: Chemistry', 0, 1, ?)").run(owner.id, now).lastInsertRowid);
  const metricOld = Number(sqlite.prepare("INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, sort_order, active, created_at) VALUES (?, ?, 'Hemolyzed specimens rejected', '%', 'lower_is_better', 5, 0, 1, ?)").run(deptChem, owner.id, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO pi_entries (metric_id, account_id, year, month, value, volume) VALUES (?, ?, 2026, 10, 1.7, 400)").run(metricOld, owner.id);
  const otherDept = Number(sqlite.prepare("INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, 'Other Dept', 0, 1, ?)").run(other.id, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, sort_order, active, created_at) VALUES (?, ?, 'Other metric', '%', 'lower_is_better', 9, 0, 1, ?)").run(otherDept, other.id, now);
  const otherRows = () => `${n("SELECT COUNT(*) AS n FROM pi_departments WHERE account_id = ?", other.id)},${n("SELECT COUNT(*) AS n FROM pi_metrics WHERE account_id = ?", other.id)},${n("SELECT COUNT(*) AS n FROM pi_plan WHERE account_id = ?", other.id)}`;
  const otherBefore = otherRows();

  const load = (apply: boolean, extra: Record<string, unknown> = {}) => ({
    apply,
    expectedLabIds: [labA, labB],
    departments: [
      { name: "San Carlos: Chemistry", metrics: [
        { name: "Hemolyzed specimens rejected", unit: "%", direction: "lower_is_better", benchmark_green: 2, measurement_methodology: "New goal that must not replace the old one." },
        { name: "STAT potassium turnaround, received to verified", unit: "%", direction: "higher_is_better", benchmark_green: 90, measurement_methodology: "Meditech TAT report. Goal: at least 90% within 45 minutes.", is_tat: true, tat_start_event: "Received in lab", tat_end_event: "Result verified", tat_threshold_minutes: 45 },
      ] },
      { name: "Bylas: General Laboratory", metrics: [
        { name: "Labeling errors found at receipt", unit: "per 1,000", direction: "lower_is_better", benchmark_green: 1, measurement_methodology: "Rejection log." },
        { name: "Critical values called with read-back documented", unit: "%", direction: "higher_is_better", benchmark_green: 100 },
      ] },
    ],
    plan: { title: "QUAL.001 Quality Management and Performance Improvement (QA/QI) Plan", effective_year: 2027, program_scope: "Both sites.", measurement_methods: "Monthly.", analysis_methods: "Quarterly.", remediation_methods: "Action plan.", monitor_sustain_methods: "Three months." },
    ...extra,
  });
  const P = `/api/admin/veritaqa/accounts/${owner.id}`;

  try {
    // 1. Guards.
    const noHdr = await call("POST", `${P}/load`, load(false));
    const qOnly = await fetch(`${base}${P}/summary?secret=${encodeURIComponent(ADMIN)}`);
    check("1. load refuses without the admin header", noHdr.status === 403, String(noHdr.status));
    check("1. summary refuses with the secret only in the query", qOnly.status === 403, String(qOnly.status));
    const bad = await call("GET", "/api/admin/veritaqa/accounts/abc/summary", undefined, { secret: ADMIN });
    const unknown = await call("POST", "/api/admin/veritaqa/accounts/99999999/load", load(false), { secret: ADMIN });
    check("1. a bad account id is 400 and an unknown one 404", bad.status === 400 && unknown.status === 404, `${bad.status} ${unknown.status}`);

    // 2. Bad bodies write nothing.
    const before2 = counts();
    const noGoal = await call("POST", `${P}/load`, { ...load(true), departments: [{ name: "X", metrics: [{ name: "Y", unit: "%", direction: "lower_is_better" }] }] }, { secret: ADMIN });
    const badUnit = await call("POST", `${P}/load`, { ...load(true), departments: [{ name: "X", metrics: [{ name: "Y", unit: "furlongs", direction: "lower_is_better", benchmark_green: 1 }] }] }, { secret: ADMIN });
    const twice = await call("POST", `${P}/load`, { ...load(true), departments: [{ name: "X", metrics: [{ name: "Y", unit: "%", direction: "lower_is_better", benchmark_green: 1 }] }, { name: " x ", metrics: [{ name: "Z", unit: "%", direction: "lower_is_better", benchmark_green: 1 }] }] }, { secret: ADMIN });
    const noApply = await call("POST", `${P}/load`, { ...load(true), apply: "yes" }, { secret: ADMIN });
    check("2. no goal, an unknown unit, a department twice and a non-boolean apply are each 400 BAD_LOAD",
      [noGoal, badUnit, twice, noApply].every((r) => r.status === 400 && r.body.code === "BAD_LOAD"), [noGoal, badUnit, twice, noApply].map((r) => `${r.status}:${r.body.code}`).join(" "));
    check("2. ... and write nothing", counts() === before2, `${before2} -> ${counts()}`);

    // 3. Wrong account.
    const before3 = counts();
    const wrong = await call("POST", `${P}/load`, load(true, { expectedLabIds: [labA, otherLab] }), { secret: ADMIN });
    check("3. an account that doesn't own every lab named is 409 LAB_MISMATCH", wrong.status === 409 && wrong.body.code === "LAB_MISMATCH" && JSON.stringify(wrong.body.notOwned) === JSON.stringify([otherLab]), JSON.stringify(wrong.body));
    check("3. ... and writes nothing", counts() === before3, `${before3} -> ${counts()}`);

    // 4. Dry run.
    const before4 = counts();
    const dry = await call("POST", `${P}/load`, load(false), { secret: ADMIN });
    check("4. a dry run reports 1 new department, 3 new indicators, 1 existing of each and the plan",
      dry.status === 200 && dry.body.applied === false && dry.body.departmentsAdded === 1 && dry.body.departmentsExisting === 1 && dry.body.metricsAdded === 3 && dry.body.metricsExisting === 1 && dry.body.planAdded === true && dry.body.planExisting === false,
      JSON.stringify(dry.body));
    check("4. ... and writes nothing", counts() === before4, `${before4} -> ${counts()}`);

    // 5. Apply.
    const real = await call("POST", `${P}/load`, load(true), { secret: ADMIN });
    check("5. apply adds what the dry run said", real.status === 200 && real.body.applied === true && real.body.departmentsAdded === 1 && real.body.metricsAdded === 3 && real.body.planAdded === true, JSON.stringify(real.body));
    const tat = sqlite.prepare("SELECT * FROM pi_metrics WHERE account_id = ? AND name LIKE 'STAT potassium%'").get(owner.id) as any;
    check("5. an indicator keeps its goal, unit, direction, method and TAT fields, on the owner's account",
      tat && tat.benchmark_green === 90 && tat.unit === "%" && tat.direction === "higher_is_better" && tat.is_tat === 1 && tat.tat_threshold_minutes === 45 && tat.tat_start_event === "Received in lab" && tat.department_id === deptChem && /Meditech TAT/.test(tat.measurement_methodology) && tat.benchmark_yellow == null,
      JSON.stringify(tat));
    const bylas = sqlite.prepare("SELECT id FROM pi_departments WHERE account_id = ? AND name = 'Bylas: General Laboratory'").get(owner.id) as any;
    check("5. the new department holds its two indicators", !!bylas && n("SELECT COUNT(*) AS n FROM pi_metrics WHERE department_id = ?", bylas?.id) === 2);
    const plan = sqlite.prepare("SELECT * FROM pi_plan WHERE account_id = ?").all(owner.id) as any[];
    check("5. one active PI plan with its title, year and text", plan.length === 1 && plan[0].status === "active" && plan[0].effective_year === 2027 && plan[0].program_scope === "Both sites." && plan[0].monitor_sustain_methods === "Three months.", JSON.stringify(plan));
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE module = 'veritaqa' AND action = 'admin_load' AND owner_user_id = ?").all(owner.id) as any[];
    check("5. one audit_log row with the counts", audit.length === 1 && /"metricsAdded":3/.test(audit[0].after_json || ""), JSON.stringify(audit));
    const screenMetrics = async (lab: number) => {
      const depts = await call("GET", "/api/pi/departments", undefined, { token: owner.token, lab });
      let total = 0;
      for (const d of Array.isArray(depts.body) ? depts.body : []) {
        const m = await call("GET", `/api/pi/metrics?department_id=${d.id}`, undefined, { token: owner.token, lab });
        if (m.status === 200 && Array.isArray(m.body)) total += m.body.length;
      }
      return { status: depts.status, departments: Array.isArray(depts.body) ? depts.body.length : -1, metrics: total };
    };
    const fromA = await screenMetrics(labA);
    check("5. the module's own routes show both departments and all four indicators", fromA.status === 200 && fromA.departments === 2 && fromA.metrics === 4, JSON.stringify(fromA));
    const fromB = await screenMetrics(labB);
    check("5. ... from the account's other lab too (VeritaQA is per account)", fromB.status === 200 && fromB.departments === 2 && fromB.metrics === 4, JSON.stringify(fromB));

    // 6. Rerun.
    const before6 = counts();
    const again = await call("POST", `${P}/load`, load(true), { secret: ADMIN });
    check("6. a rerun adds nothing", again.status === 200 && again.body.departmentsAdded === 0 && again.body.metricsAdded === 0 && again.body.planAdded === false && again.body.planExisting === true, JSON.stringify(again.body));
    check("6. ... except its own audit row", counts().split(",").slice(0, 6).join(",") === before6.split(",").slice(0, 6).join(","), `${before6} -> ${counts()}`);

    // 7. Nothing already there changes.
    const old = sqlite.prepare("SELECT benchmark_green, measurement_methodology FROM pi_metrics WHERE id = ?").get(metricOld) as any;
    check("7. an existing indicator keeps its goal and method", old.benchmark_green === 5 && old.measurement_methodology == null, JSON.stringify(old));
    check("7. ... and its monthly result", n("SELECT COUNT(*) AS n FROM pi_entries WHERE metric_id = ? AND value = 1.7 AND volume = 400", metricOld) === 1);
    check("7. another account's rows don't move", otherRows() === otherBefore, `${otherBefore} -> ${otherRows()}`);
    sqlite.prepare("INSERT INTO pi_plan (account_id, title, effective_year, status, program_scope) VALUES (?, 'Their own plan', 2026, 'active', 'Theirs.')").run(other.id);
    const otherLoad = await call("POST", `/api/admin/veritaqa/accounts/${other.id}/load`, load(true, { expectedLabIds: [otherLab] }), { secret: ADMIN });
    const theirPlan = sqlite.prepare("SELECT title, program_scope FROM pi_plan WHERE account_id = ?").all(other.id) as any[];
    check("7. an account with an active plan keeps it (planExisting, no second plan)",
      otherLoad.status === 200 && otherLoad.body.planAdded === false && otherLoad.body.planExisting === true && theirPlan.length === 1 && theirPlan[0].program_scope === "Theirs.", JSON.stringify(otherLoad.body));

    // 8. Summary.
    const before8 = counts();
    const sum = await call("GET", `${P}/summary`, undefined, { secret: ADMIN });
    check("8. summary gives the labs, counts and names", sum.status === 200 && JSON.stringify(sum.body.labs) === JSON.stringify([labA, labB]) && sum.body.departmentCount === 2 && sum.body.metricCount === 4 && sum.body.entryCount === 1 && sum.body.plans?.length === 1, JSON.stringify(sum.body).slice(0, 300));
    check("8. ... no email addresses", !/@/.test(JSON.stringify(sum.body)));
    check("8. ... and writes nothing", counts() === before8, `${before8} -> ${counts()}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
