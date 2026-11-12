// server/veritaqaAdminLoad.ts
//
// Admin load for VeritaQA (Michael 2026-11-12, Q304 = 1): put a client's quality-indicator plan into its VeritaQA, the same
// way the other client loads work (a dry run reads; apply writes). First use: SCAHC's 2027 QA/QI plan for San Carlos
// (lab 2) and Bylas (lab 6), drafted as QUAL.001 and an indicator workbook.
//
// VeritaQA keeps its data per owner account (server/veritabench.ts: accountId = req.ownerUserId ?? req.userId), not per
// lab, so the load names the owner account and the labs it expects that account to own. A wrong account id is refused
// before anything is read or written, so one customer's plan can never land in another customer's account.
//
// What a load does: adds each department and indicator that isn't there yet (matched by name), and adds the written PI
// plan if the account has no active one. What it never does: change or delete a department, indicator, monthly result
// or plan the account already has, enter monthly results, or send email. Safe to rerun: what's already there is skipped.
//
//   GET  /api/admin/veritaqa/accounts/:ownerUserId/summary   counts and names only; writes nothing
//   POST /api/admin/veritaqa/accounts/:ownerUserId/load      body: VeritaQaLoad below; apply: false is a dry run

import { db } from "./db";

export const VERITAQA_LOAD_LIMITS = { departments: 60, metricsPerDepartment: 60, text: 6000, name: 200 };
const UNITS = new Set(["%", "count", "minutes", "hours", "days", "ratio", "per 1,000", "rate"]);
const DIRECTIONS = new Set(["lower_is_better", "higher_is_better"]);
const PLAN_FIELDS = ["program_scope", "measurement_methods", "analysis_methods", "remediation_methods", "monitor_sustain_methods"] as const;

export type VeritaQaMetric = {
  name: string;
  unit: string;
  direction: "lower_is_better" | "higher_is_better";
  benchmark_green: number | null;
  benchmark_yellow?: number | null;
  benchmark_red?: number | null;
  measurement_methodology?: string | null;
  is_tat?: boolean;
  tat_start_event?: string | null;
  tat_end_event?: string | null;
  tat_threshold_minutes?: number | null;
};
export type VeritaQaLoad = {
  expectedLabIds: number[];
  apply: boolean;
  departments: { name: string; metrics: VeritaQaMetric[] }[];
  plan?: { title: string; effective_year: number } & Partial<Record<(typeof PLAN_FIELDS)[number], string>>;
};

const isText = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const optText = (v: unknown, max: number) => v == null || (typeof v === "string" && v.length <= max);
const optNum = (v: unknown) => v == null || (typeof v === "number" && Number.isFinite(v));

// Returns the first problem with a load body, or null when it's well formed.
export function veritaQaLoadProblem(body: any): string | null {
  const L = VERITAQA_LOAD_LIMITS;
  if (!body || typeof body !== "object") return "Send a JSON body.";
  if (typeof body.apply !== "boolean") return "apply must be true or false.";
  if (!Array.isArray(body.expectedLabIds) || body.expectedLabIds.length === 0 || !body.expectedLabIds.every((n: unknown) => Number.isInteger(n) && (n as number) > 0))
    return "expectedLabIds must list the labs this account owns.";
  if (!Array.isArray(body.departments) || body.departments.length === 0 || body.departments.length > L.departments) return `departments must hold 1 to ${L.departments} departments.`;
  const deptNames = new Set<string>();
  for (const [i, d] of body.departments.entries()) {
    if (!d || !isText(d.name, L.name)) return `Department ${i + 1} needs a name.`;
    const key = String(d.name).trim().toLowerCase();
    if (deptNames.has(key)) return `Department "${d.name}" is listed twice.`;
    deptNames.add(key);
    if (!Array.isArray(d.metrics) || d.metrics.length === 0 || d.metrics.length > L.metricsPerDepartment) return `Department "${d.name}" must hold 1 to ${L.metricsPerDepartment} indicators.`;
    const metricNames = new Set<string>();
    for (const [j, m] of d.metrics.entries()) {
      const where = `Department "${d.name}", indicator ${j + 1}`;
      if (!m || !isText(m.name, L.name)) return `${where} needs a name.`;
      const mk = String(m.name).trim().toLowerCase();
      if (metricNames.has(mk)) return `${where}: "${m.name}" is listed twice.`;
      metricNames.add(mk);
      if (!UNITS.has(m.unit)) return `${where}: unit must be one of ${Array.from(UNITS).join(", ")}.`;
      if (!DIRECTIONS.has(m.direction)) return `${where}: direction must be lower_is_better or higher_is_better.`;
      if (typeof m.benchmark_green !== "number" || !Number.isFinite(m.benchmark_green)) return `${where}: benchmark_green (the goal) must be a number.`;
      if (!optNum(m.benchmark_yellow) || !optNum(m.benchmark_red) || !optNum(m.tat_threshold_minutes)) return `${where}: benchmarks and the TAT threshold must be numbers.`;
      if (!optText(m.measurement_methodology, L.text) || !optText(m.tat_start_event, L.name) || !optText(m.tat_end_event, L.name)) return `${where}: a text field is too long.`;
      if (m.is_tat != null && typeof m.is_tat !== "boolean") return `${where}: is_tat must be true or false.`;
    }
  }
  if (body.plan != null) {
    const p = body.plan;
    if (!isText(p.title, L.name)) return "plan.title is required.";
    if (!Number.isInteger(p.effective_year) || p.effective_year < 2020 || p.effective_year > 2100) return "plan.effective_year must be a year.";
    for (const f of PLAN_FIELDS) if (!optText(p[f], L.text)) return `plan.${f} is too long.`;
  }
  return null;
}

export function loadVeritaQa(sqlite: any, ownerUserId: number, input: VeritaQaLoad) {
  const owner = sqlite.prepare("SELECT id FROM users WHERE id = ?").get(ownerUserId);
  if (!owner) return { status: 404, body: { error: "That account doesn't exist.", code: "ACCOUNT_NOT_FOUND" } };
  const owned = new Set<number>((sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ?").all(ownerUserId) as { id: number }[]).map((r) => r.id));
  const notOwned = input.expectedLabIds.filter((id) => !owned.has(id));
  if (notOwned.length) return { status: 409, body: { error: "This account doesn't own every lab named in the load.", code: "LAB_MISMATCH", notOwned } };

  const findDept = sqlite.prepare("SELECT id FROM pi_departments WHERE account_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1");
  const findMetric = sqlite.prepare("SELECT id FROM pi_metrics WHERE department_id = ? AND lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1");
  const maxDeptOrder = (sqlite.prepare("SELECT COALESCE(MAX(sort_order), -1) AS n FROM pi_departments WHERE account_id = ?").get(ownerUserId) as { n: number }).n;
  const activePlan = sqlite.prepare("SELECT id FROM pi_plan WHERE account_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1").get(ownerUserId) as { id: number } | undefined;

  const insDept = sqlite.prepare("INSERT INTO pi_departments (account_id, name, sort_order, active, created_at) VALUES (?, ?, ?, 1, ?)");
  const insMetric = sqlite.prepare(
    `INSERT INTO pi_metrics (department_id, account_id, name, unit, direction, benchmark_green, benchmark_yellow, benchmark_red, sort_order, active,
                             measurement_methodology, is_tat, tat_start_event, tat_end_event, tat_threshold_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`
  );
  const insPlan = sqlite.prepare(
    `INSERT INTO pi_plan (account_id, title, effective_year, status, program_scope, measurement_methods, analysis_methods, remediation_methods,
                          monitor_sustain_methods, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`
  );

  const summary = { departmentsAdded: 0, departmentsExisting: 0, metricsAdded: 0, metricsExisting: 0, planAdded: false, planExisting: !!activePlan };
  const now = new Date().toISOString();
  const run = () => {
    input.departments.forEach((d, di) => {
      const existing = findDept.get(ownerUserId, d.name) as { id: number } | undefined;
      let deptId: number | null = existing?.id ?? null;
      if (existing) summary.departmentsExisting++;
      else {
        summary.departmentsAdded++;
        if (input.apply) deptId = Number(insDept.run(ownerUserId, d.name.trim(), maxDeptOrder + 1 + di, now).lastInsertRowid);
      }
      d.metrics.forEach((m, mi) => {
        if (deptId != null && findMetric.get(deptId, m.name)) { summary.metricsExisting++; return; }
        summary.metricsAdded++;
        if (!input.apply || deptId == null) return;
        insMetric.run(deptId, ownerUserId, m.name.trim(), m.unit, m.direction, m.benchmark_green, m.benchmark_yellow ?? null, m.benchmark_red ?? null, mi,
          m.measurement_methodology ?? null, m.is_tat ? 1 : 0, m.tat_start_event ?? null, m.tat_end_event ?? null, m.tat_threshold_minutes ?? null, now);
      });
    });
    if (input.plan && !activePlan) {
      summary.planAdded = true;
      if (input.apply) {
        const p = input.plan;
        insPlan.run(ownerUserId, p.title.trim(), p.effective_year, p.program_scope ?? null, p.measurement_methods ?? null, p.analysis_methods ?? null,
          p.remediation_methods ?? null, p.monitor_sustain_methods ?? null, now, now);
      }
    }
    if (input.apply) {
      sqlite.prepare(
        `INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, after_json, created_at)
         VALUES (0, ?, 'veritaqa', 'admin_load', 'pi_plan_load', ?, ?, ?, ?)`
      ).run(ownerUserId, String(ownerUserId), "Quality indicator plan loaded by Veritas Lab Services", JSON.stringify({ ...summary, labs: input.expectedLabIds }), now);
    }
  };
  if (input.apply) sqlite.transaction(run)(); else run();
  return { status: 200, body: { ok: true, applied: input.apply, ownerUserId, labs: input.expectedLabIds, ...summary } };
}

export function veritaQaSummary(sqlite: any, ownerUserId: number) {
  const owner = sqlite.prepare("SELECT id FROM users WHERE id = ?").get(ownerUserId);
  if (!owner) return null;
  const departments = sqlite.prepare(
    `SELECT d.id, d.name, d.active, (SELECT COUNT(*) FROM pi_metrics m WHERE m.department_id = d.id) AS metrics
       FROM pi_departments d WHERE d.account_id = ? ORDER BY d.sort_order, d.id`
  ).all(ownerUserId);
  const metrics = (sqlite.prepare("SELECT COUNT(*) AS n FROM pi_metrics WHERE account_id = ?").get(ownerUserId) as { n: number }).n;
  const entries = (sqlite.prepare("SELECT COUNT(*) AS n FROM pi_entries WHERE account_id = ?").get(ownerUserId) as { n: number }).n;
  const plans = sqlite.prepare("SELECT id, title, effective_year, status FROM pi_plan WHERE account_id = ? ORDER BY id").all(ownerUserId);
  const labs = (sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ? ORDER BY id").all(ownerUserId) as { id: number }[]).map((r) => r.id);
  return { ownerUserId, labs, departmentCount: departments.length, metricCount: metrics, entryCount: entries, departments, plans };
}

export function registerVeritaQaAdminLoadRoutes(app: any, deps: { adminSecret: string | undefined }) {
  const sqlite = () => (db as any).$client;
  const adminOnly = (req: any, res: any, next: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!deps.adminSecret || !secret || secret !== deps.adminSecret) return res.status(403).json({ error: "Forbidden" });
    next();
  };
  const ownerId = (req: any) => {
    const n = Number(req.params.ownerUserId);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  app.get("/api/admin/veritaqa/accounts/:ownerUserId/summary", adminOnly, (req: any, res: any) => {
    const id = ownerId(req);
    if (id == null) return res.status(400).json({ error: "ownerUserId required" });
    const out = veritaQaSummary(sqlite(), id);
    if (!out) return res.status(404).json({ error: "Account not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(out);
  });

  app.post("/api/admin/veritaqa/accounts/:ownerUserId/load", adminOnly, (req: any, res: any) => {
    const id = ownerId(req);
    if (id == null) return res.status(400).json({ error: "ownerUserId required" });
    const problem = veritaQaLoadProblem(req.body);
    if (problem) return res.status(400).json({ error: problem, code: "BAD_LOAD" });
    const out = loadVeritaQa(sqlite(), id, req.body as VeritaQaLoad);
    res.status(out.status).json(out.body);
  });
}
