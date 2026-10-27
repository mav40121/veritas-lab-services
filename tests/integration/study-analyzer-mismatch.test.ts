// tests/integration/study-analyzer-mismatch.test.ts
//
// Receipt for BUG-085 (Michael Q18 = 1, 2026-10-27). Demo method comparisons #505/#506 listed analyzers that do not
// appear in their data: the study list showed a stale PASS and the study page computed FAIL from empty columns.
// Boots the REAL routes on a scratch DB with made-up studies and proves:
//   1. computeStudyResults marks a study whose listed analyzers have no values "not evaluable" (with both name lists),
//      and leaves a matching study alone
//   2. /api/generate-pdf refuses a not-evaluable study (400 with the reason); buildStudyPdf throws the same reason,
//      which the records export lists as "not included"
//   3. POST /api/admin/veritacheck/align-study-analyzers: refuses a lab that is not a demo lab (403); the dry run plans
//      the change and writes nothing; the real run sets the list to the data's analyzers, recomputes the status, writes
//      an audit row, and skips a matching study and a study with a director's verdict override
//   4. after the repair the page computes a real verdict that agrees with the stored status
// Run (from bash): DB_PATH=.tmp-sam.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/study-analyzer-mismatch.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const { buildStudyPdf } = await import("../../server/studyPdf");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const stamp = Date.now();
  const mk = async (tag: string) => {
    const email = `sam-${tag}-${stamp}@example.com`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `SAM ${tag}`, hipaa_acknowledged: true })).j;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `SAM Lab ${tag}`, plan: "hospital" })).j.labId as number;
    return { token: reg.token as string, userId: reg.user?.id as number, labId };
  };
  const demo = await mk("demo"), real = await mk("real");
  await call("POST", "/api/admin/update-lab", { secret: ADMIN, labId: demo.labId, isDemo: true });

  const points = [80, 100, 120, 140, 160].map((v, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Ortho VITROS 5600": v, "Roche Cobas c503": v * 1.02 } }));
  const insert = (labId: number, userId: number, name: string, instruments: string[], extra: Record<string, any> = {}) => Number(sqlite.prepare(
    `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lifecycle_state, tea_is_percentage, verdict_override_justification)
     VALUES (?, ?, ?, 'Chemistry', 'Demo Analyst', '2026-05-29', 'method_comparison', 0.1, ?, ?, 'pass', ?, 'finalized', 1, ?)`
  ).run(userId, labId, name, JSON.stringify(points), JSON.stringify(instruments), new Date().toISOString(), extra.override ?? null).lastInsertRowid);
  const mismatched = insert(demo.labId, demo.userId, "Sodium Method Comparison Demo", ["Ortho 5600 Primary", "Ortho 5600 Backup", "Ortho VITROS XT 7600 (Sully)"]);
  const matching = insert(demo.labId, demo.userId, "Sodium Matching", ["Ortho VITROS 5600", "Roche Cobas c503"]);
  const overridden = insert(demo.labId, demo.userId, "Sodium Overridden", ["Analyzer X", "Analyzer Y"], { override: "Director reviewed" });
  const realStudy = insert(real.labId, real.userId, "Sodium Real Lab", ["Analyzer X", "Analyzer Y"]);
  const rowOf = (id: number) => sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id) as any;
  const toClient = (r: any) => ({ id: r.id, testName: r.test_name, studyType: r.study_type, date: r.date, instrument: r.instrument, analyst: r.analyst,
    cliaAllowableError: r.clia_allowable_error, dataPoints: r.data_points, instruments: r.instruments, status: r.status, teaIsPercentage: r.tea_is_percentage } as any);

  const bad = computeStudyResults(toClient(rowOf(mismatched))) as any;
  const good = computeStudyResults(toClient(rowOf(matching))) as any;
  check("1a. listed analyzers absent from the data -> not evaluable, with both name lists and a plain reason",
    !!bad.notEvaluable && bad.notEvaluable.listed.length === 3 && JSON.stringify(bad.notEvaluable.inData) === JSON.stringify(["Ortho VITROS 5600", "Roche Cobas c503"]) && /^Not evaluable/.test(bad.summary),
    JSON.stringify(bad.notEvaluable));
  check("1b. a study whose list matches its data is evaluated normally (no not-evaluable flag, PASS)", !good.notEvaluable && good.overallPass === true, String(good.overallPass));

  const pdf = await call("POST", "/api/generate-pdf", { study: toClient(rowOf(mismatched)), results: bad }, demo.token);
  check("2a. /api/generate-pdf refuses a not-evaluable study with the reason", pdf.s === 400 && /Not evaluable/.test(pdf.j.error || ""), `${pdf.s} ${pdf.j.error}`);
  let thrown = "";
  try { await buildStudyPdf(sqlite, rowOf(mismatched), { lab_name: "SAM Lab demo" }, { name: "Owner" }); } catch (e: any) { thrown = e?.message || String(e); }
  check("2b. buildStudyPdf (records export) throws the same reason instead of printing a FAIL", /Not evaluable/.test(thrown), thrown.slice(0, 120));

  const route = (labId: number, ids: number[], dryRun?: boolean) => call("POST", "/api/admin/veritacheck/align-study-analyzers", { secret: ADMIN, labId, studyIds: ids, ...(dryRun === undefined ? {} : { dryRun }) });
  const refused = await route(real.labId, [realStudy], false);
  check("3a. a lab that is not a demo lab is refused (403) and its study is unchanged", refused.s === 403 && rowOf(realStudy).instruments === JSON.stringify(["Analyzer X", "Analyzer Y"]), `${refused.s} ${refused.j.error}`);
  const before = rowOf(mismatched).instruments;
  const dry = await route(demo.labId, [mismatched, matching, overridden]);
  check("3b. dry run by default: plans the change and writes nothing",
    dry.s === 200 && dry.j.dryRun === true && dry.j.results[0].action === "would update" && rowOf(mismatched).instruments === before, JSON.stringify(dry.j.results?.[0]));
  const auditsBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'study' AND entity_id = ?").get(String(mismatched)) as any).n;
  const run = await route(demo.labId, [mismatched, matching, overridden], false);
  const fixed = rowOf(mismatched);
  const auditsAfter = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'study' AND entity_id = ?").get(String(mismatched)) as any).n;
  check("3c. real run: list set to the data's analyzers (values untouched), status recomputed, audit row written",
    run.s === 200 && fixed.instruments === JSON.stringify(["Ortho VITROS 5600", "Roche Cobas c503"]) && fixed.data_points === JSON.stringify(points) && fixed.status === "pass" && auditsAfter === auditsBefore + 1,
    JSON.stringify({ s: run.s, instruments: fixed.instruments, status: fixed.status, audits: [auditsBefore, auditsAfter] }));
  const reasons = Object.fromEntries((run.j.results || []).map((r: any) => [r.studyId, r.reason || r.action]));
  check("3d. a matching study and a director-overridden study are skipped",
    /already matches/.test(reasons[matching] || "") && /overrode/.test(reasons[overridden] || "") && rowOf(overridden).instruments === JSON.stringify(["Analyzer X", "Analyzer Y"]), JSON.stringify(reasons));

  const after = computeStudyResults(toClient(fixed)) as any;
  check("4. after the repair the page computes a real verdict that agrees with the stored status", !after.notEvaluable && (after.overallPass ? "pass" : "fail") === fixed.status, `${after.overallPass} vs ${fixed.status}`);

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
