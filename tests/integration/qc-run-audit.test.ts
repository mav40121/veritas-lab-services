// tests/integration/qc-run-audit.test.ts
//
// STANDING integration test for BUG-199 (2026-11-24): a QC run typed on VeritaQC, and a run voided, wrote no audit row. Each now writes the
// module's ordinary one: who, when, what it was before and after. What the routes answer is unchanged, and a refused request writes none.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Uses nothing that isn't on main, so it runs there and fails.
// Run: npm run test:qc-run-audit

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail: unknown = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const PW = ["Audit", "run", "88!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const now = new Date().toISOString();
  const person = async (tag: string, name: string) => {
    const email = `qcaudit-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    return { email, token: reg.body.token as string, userId: Number(reg.body.user?.id) };
  };
  const rows = (entity: string, id: number) => sqlite.prepare("SELECT * FROM audit_log WHERE module = 'veritaqc' AND entity_type = ? AND entity_id = ? ORDER BY id").all(entity, String(id)) as any[];
  const total = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'veritaqc' AND entity_type IN ('qc_result', 'qc_result.void')").get() as any).n);
  try {
    const owner = await person("owner", "Audit Owner");
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: owner.email, labName: "Run Audit Lab", plan: "hospital" })).body.labId);
    const L = `/api/labs/${labId}`;
    const tech = await person("tech", "Terry Tech");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(labId, tech.userId, now, now, now);
    const lot = (await call("POST", `${L}/qc/control-lots`, { analyte: "Glucose", level: "Low", lot_number: "A1", mfr_mean: 100, mfr_sd: 2 }, owner.token)).body.lot.id;

    // 1. A typed run
    const r = await call("POST", `${L}/qc/results`, { control_lot_id: lot, result_value: 108.5, result_date: "2026-09-01", run_time: "07:15", instrument: "Analyzer A", comment: "first of the day" }, tech.token);
    const id = r.body.result_id as number;
    const [a, ...more] = rows("qc_result", id);
    const after = a ? JSON.parse(a.after_json) : {};
    check("1. a typed run writes one audit row", !!a && more.length === 0, rows("qc_result", id).length);
    check("1. ... saying who, for which laboratory's owner, and when", a?.action === "create" && a?.user_id === tech.userId && a?.owner_user_id === owner.userId && !!a?.created_at && a?.before_json === null, a);
    check("1. ... what was recorded, and the rules it fired", after.result_value === 108.5 && after.result_date === "2026-09-01" && after.run_time === "07:15" && after.instrument === "Analyzer A" && after.control_lot_id === lot && after.lab_id === labId && after.comment === "first of the day"
      && JSON.stringify(after.rules_fired) === JSON.stringify(r.body.violations.map((v: any) => v.rule_code)) && after.requires_corrective_action === true && after.basis_source === "manufacturer", after);
    check("1. ... named so a person can read it", a?.entity_label === "Glucose Low lot A1: 108.5 on 2026-09-01", a?.entity_label);
    check("1. the answer is the one it gave before", JSON.stringify(Object.keys(r.body).sort()) === '["basis","ok","requires_corrective_action","result_id","settings_used","violations"]');

    // 2. Voided
    const ca = (await call("POST", `${L}/qc/corrective-actions`, { qc_result_id: id, action_taken: "Reran the control" }, tech.token)).body.corrective_action_id;
    const esc = await call("POST", `${L}/qc/corrective-actions/${ca}/escalate-to-response`, {}, owner.token);
    const v = await call("POST", `${L}/qc/results/${id}/void`, { reason: "Wrong control lot" }, owner.token);
    const [w, ...again] = rows("qc_result.void", id);
    const vb = w ? JSON.parse(w.before_json) : {}, va = w ? JSON.parse(w.after_json) : {};
    check("2. a void writes one audit row, by whoever voided it", v.status === 200 && !!w && again.length === 0 && w.action === "update" && w.user_id === owner.userId && w.owner_user_id === owner.userId && w.entity_label === "Glucose Low lot A1: 108.5 on 2026-09-01", w);
    check("2. ... with the run before, and after with when, by whom and why", vb.voided_at === null && vb.result_value === 108.5 && vb.lab_id === labId && !!va.voided_at && va.void_reason === "Wrong control lot" && va.voided_by_user_id === owner.userId && va.result_value === 108.5, [vb, va]);
    check("2. ... and what became of a finding from that run", esc.status === 200 && JSON.stringify(va.findings) === JSON.stringify(v.body.findings) && v.body.findings.length === 1, va.findings);
    check("2. the answer is the one it gave before", JSON.stringify(Object.keys(v.body).sort()) === '["findings","id","ok"]');

    // 3. Nothing for what didn't happen
    const n = total();
    await call("POST", `${L}/qc/results`, { control_lot_id: lot, result_value: "abc", result_date: "2026-09-02" }, tech.token);
    await call("POST", `${L}/qc/results`, { control_lot_id: 999999, result_value: 5, result_date: "2026-09-02" }, tech.token);
    await call("POST", `${L}/qc/results/${id}/void`, { reason: "Again" }, owner.token);
    await call("POST", `${L}/qc/results/${id}/void`, { reason: "No edit" }, tech.token);
    const stranger = await person("stranger", "Sam Stranger");
    await call("POST", `${L}/qc/results`, { control_lot_id: lot, result_value: 100, result_date: "2026-09-02" }, stranger.token);
    check("3. a refused run or void writes none", n === 2 && total() === n, [n, total()]);

    // 4. A Veritas support login's run says so
    const support = await person("support", "Vera Support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support.userId);
    sqlite.prepare("UPDATE labs SET vls_support_access = 1 WHERE id = ?").run(labId);
    const s = await call("POST", `${L}/qc/results`, { control_lot_id: lot, result_value: 100.2, result_date: "2026-09-03" }, support.token);
    check("4. a row a Veritas support login causes is stamped as theirs", s.status !== 200 || rows("qc_result", s.body.result_id)[0]?.acting_as === "vls_support", s.status);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
