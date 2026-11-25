// tests/integration/qc-voided-runs.test.ts
//
// STANDING integration test for BUG-198 (2026-11-24): a run voided by hand still drew on the span-all-lots chart, sat in the daily feed as if it
// stood, was counted by readiness and the analyzer's trail, and went into a VeritaCheck import. A voided run stays on file and shows only where
// it is marked voided; counts, charts and other modules leave it out. No stored verdict and no signed review changes.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Uses nothing that isn't on main, so it runs there and fails.
// Run: npm run test:qc-voided-runs

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { computeLabReadiness } from "../../server/labReadiness";
import { digestCountsForLab } from "../../server/digestCounts";
import { typeReportHTMLForTest } from "../../server/pdfReport";

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
  const PW = ["Void", "run", "88!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const email = `qcvoided-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Voided Owner", hipaa_acknowledged: true });
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "Voided Runs Lab", plan: "hospital" })).body.labId);
    const token = reg.body.token as string, userId = Number(reg.body.user?.id);
    const L = `/api/labs/${labId}`, now = new Date().toISOString();
    const map = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Core lab', '[]', ?, ?)").run(userId, labId, now, now).lastInsertRowid);
    const an = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, nickname, role, category, created_at) VALUES (?, 'Made-up 500', 'Analyzer A', 'Primary', 'Chemistry', ?)").run(map, now).lastInsertRowid);
    const lot = (await call("POST", `${L}/qc/control-lots`, { analyte: "Glucose", level: "Low", lot_number: "V1", mfr_mean: 100, mfr_sd: 2 }, token)).body.lot.id;
    const run = async (value: number, date: string, instrument = "Analyzer A") => (await call("POST", `${L}/qc/results`, { control_lot_id: lot, result_value: value, result_date: date, ...(instrument === "Analyzer A" ? { map_instrument_id: an } : { instrument }) }, token)).body.result_id as number;
    const stands = await run(101, "2026-09-01"), bad = await run(120, "2026-09-02"), badCa = await run(119, "2026-09-03"), only = await run(99, "2026-09-04", "Bench");
    const standsToo = await run(99.5, "2026-09-05"), reject = await run(118, "2026-09-06");
    const ca = (await call("POST", `${L}/qc/corrective-actions`, { qc_result_id: badCa, action_taken: "Reran the control" }, token)).body.corrective_action_id;
    await call("POST", `${L}/qc/period-reviews`, { control_lot_id: lot, period_year: 2026, period_month: 9, attestation_acknowledged: true }, token);
    const verdicts = () => JSON.stringify([sqlite.prepare("SELECT id, result_value, basis_mean, basis_sd, basis_source, accepted_for_reporting FROM qc_results WHERE lab_id = ? ORDER BY id").all(labId), sqlite.prepare("SELECT v.* FROM qc_rule_violations v JOIN qc_results r ON r.id = v.qc_result_id WHERE r.lab_id = ? ORDER BY v.id").all(labId), sqlite.prepare("SELECT * FROM qc_period_reviews WHERE lab_id = ?").all(labId)]);
    const was = verdicts();
    const missing = () => (computeLabReadiness(sqlite, labId) as any).modules.find((m: any) => m.key === "qc").overdue as number;
    const owedBefore = missing();
    const rejectionsOn = (id: number) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_violations WHERE qc_result_id = ? AND severity = 'rejection' AND superseded_at IS NULL").get(id) as any).n);
    for (const id of [bad, badCa, only]) check(`0. run ${id} voided by hand`, (await call("POST", `${L}/qc/results/${id}/void`, { reason: "Mis-keyed" }, token)).status === 200);
    const voided = [bad, badCa, only], standing = [stands, standsToo, reject];

    // 1. The chart across lots
    const line = (await call("GET", `${L}/qc/line?analyte=Glucose&level=Low`, undefined, token)).body.points.map((p: any) => p.id);
    check("1. the span-all-lots chart draws the runs that stand and no voided one", standing.every((i) => line.includes(i)) && !voided.some((i) => line.includes(i)), line);

    // 2. The daily feed
    const feed = async (status: string) => (await call("GET", `${L}/qc/recent?since=2026-09-01&until=2026-09-30&status=${status}&limit=100`, undefined, token)).body.results as any[];
    const all = await feed("any"), withRule = await feed("with_violation"), owed = await feed("missing_ca");
    check("2. the two lists of what needs attention hold no voided run", !withRule.some((r) => voided.includes(r.id)) && !owed.some((r) => voided.includes(r.id)) && owed.some((r) => r.id === reject), [withRule.map((r) => r.id), owed.map((r) => r.id)]);
    check("2. under All results a voided run says it is voided and why, so it shows only marked", all.filter((r) => voided.includes(r.id)).every((r) => !!r.voided_at && r.void_reason === "Mis-keyed") && all.filter((r) => standing.includes(r.id)).every((r) => r.voided_at === null), all.map((r) => [r.id, r.voided_at]));
    check("2. ... and a corrective action on one is still there to close out", (await call("POST", `${L}/qc/corrective-actions/${ca}/resolve`, { resolution_notes: "The run was mis-keyed" }, token)).status === 200 && all.find((r) => r.id === badCa)?.corrective_actions.length === 1);

    // 3. Readiness, and the digest, which already left them out
    check("3. readiness owes no corrective action for a voided run", missing() === owedBefore - rejectionsOn(bad) && missing() > 0, [owedBefore, missing(), rejectionsOn(bad)]);
    const d = digestCountsForLab(sqlite, labId, "2026-09-01", "2026-09-30") as any;
    check("3. the digest and the feed agree", d.qc.withoutCorrectiveAction === owed.length && d.qc.rejectedRunsInMonth === withRule.filter((r) => r.violations.some((v: any) => v.severity === "rejection")).length, d.qc);

    // 4. The VeritaCheck import
    const cand = (await call("GET", `${L}/qc/import-candidates?analyte=Glucose`, undefined, token)).body;
    check("4. a VeritaCheck import counts only runs that stand, and offers no analyzer whose runs are all voided", cand.levels[0].result_count === standing.length && JSON.stringify(cand.instrument_options) === '["Analyzer A"]', cand);
    const prev = (await call("POST", `${L}/qc/import-preview`, { analyte: "Glucose", control_lot_id: lot, subsample_strategy: "all" }, token)).body;
    check("4. ... and brings in no voided value", JSON.stringify([...prev.import_source.result_ids].sort()) === JSON.stringify([...standing].sort()) && !prev.levels[0].values.some((v: any) => [120, 119, 99].includes(v)), prev.import_source.result_ids);
    const bulk = (await call("GET", `${L}/qc/import-analyte-bulk-candidates?analyte=Glucose`, undefined, token)).body;
    const cells = bulk.levels.flatMap((l: any) => l.instruments);
    check("4. ... nor does the bulk import", cells.length === 1 && cells[0].result_count === standing.length && !cells[0].replicate_values.some((v: number) => [120, 119, 99].includes(v)), cells);

    // 5. The analyzer's trail: marked in the timeline, out of the run counts
    const trail = (await call("GET", `${L}/instruments/${an}/trail?days=3650`, undefined, token)).body;
    check("5. the analyzer's trail marks a voided run and leaves it out of the run counts", trail.failures.filter((f: any) => voided.includes(f.id)).every((f: any) => !!f.voided_at) && trail.failures.some((f: any) => f.id === bad)
      && trail.summary.runs === standing.length && trail.summary.runs_with_flags === trail.failures.filter((f: any) => !f.voided_at).length && trail.summary.rejections === trail.failures.filter((f: any) => !f.voided_at && f.has_rejection).length && trail.summary.rejections_without_action === 1 && trail.summary.corrective_actions === 1, trail.summary);

    // 6. The getting-started checklist, and the QC event report
    const gs = await call("GET", `${L}/getting-started`, undefined, token);
    check("6. the getting-started checklist counts the runs that stand", gs.status === 200 && JSON.stringify(gs.body).includes(`"${standing.length} QC result(s) entered."`), gs.status);
    const html = typeReportHTMLForTest({ finding: { id: 1, source_type: "qc_escalation", finding_number: "QC-1-3s", type_data: "{}" }, user: { cliaLabName: "Voided Runs Lab" }, qc: { analyte: "Glucose", level: "Low", lot_number: "V1", result_value: 120, result_date: "2026-09-02", voided_at: now } } as any);
    check("6. a QC event report of a voided run says the run was voided", html.includes("120, 2026-09-02, run voided"));

    check("7. no stored verdict and no signed review changed", verdicts().replace(/\s/g, "") === was.replace(/\s/g, ""));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
