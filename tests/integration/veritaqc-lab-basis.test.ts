// tests/integration/veritaqc-lab-basis.test.ts
//
// Receipt for the VeritaQC evaluation basis (2026-10-08, MedStar). The client's
// rule (Mike Hiltunen): the Levey-Jennings chart and the Westgard rules use the
// same numbers; a lot uses the manufacturer's published values until it has
// enough runs, then the lab's own. Boots the REAL routes on a scratch DB and
// proves, through the HTTP API a tech's browser uses:
//   1. runs 1-20 are judged on the manufacturer mean/SD; run 21 on the lab's
//      own mean/SD from the first 20, and the lot locks it
//   2. GET /qc/lots hands the chart the same basis the rules used
//   3. /qc/line measures each point against that basis
//   4. owner re-establish: all_runs, manual, auto; bad input is refused
//   5. admin re-score: dry run reports the before/after and writes nothing;
//      commit supersedes (never deletes) the old flag, the corrective action
//      still points at it, readers no longer show it, and every re-scored run
//      carries the basis that judged it
//   6. monthly PDF HTML: chart and narrative use the basis; the manufacturer
//      mean and range are reference lines
//
// Run (Windows, from bash): DB_PATH=.tmp-vqb.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritaqc-lab-basis.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

async function main() {
  const { registerRoutes } = await import("../../server/routes");
  const { buildMonthlyReviewHTML } = await import("../../server/pdfQCMonthly");
  const Database = (globalThis as any).require("better-sqlite3");
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const email = `vqb-${Date.now()}@example.com`;
  const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: "VQB Owner", hipaa_acknowledged: true }));
  const token = reg.token as string;
  const labId = Number((await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "VQB Lab", plan: "hospital" }))).labId);
  const L = `/api/labs/${labId}/qc`;
  const lotRes = await j(await call("POST", `${L}/control-lots`, {
    analyte: "PSA (FREND B)", level: "Level 1", lot_number: "6361A26001", manufacturer: "NanoEntek",
    mfr_mean: 1.29, mfr_sd: 0.35, mfr_range_low: 0.59, mfr_range_high: 1.99,
  }, token));
  const lotId = Number(lotRes?.lot?.id ?? lotRes?.id);
  check("setup: lab and control lot created through the routes", labId > 0 && lotId > 0, JSON.stringify({ labId, lotId }));

  // Plymouth shape: the lab runs about 1.08; the insert says 1.29.
  const offs = [-0.12, 0.05, 0.1, -0.04, 0.0, -0.09, 0.13, 0.02, -0.06, 0.08, -0.11, 0.04, 0.07, -0.03, -0.08, 0.11, 0.01, -0.05, 0.09, -0.1, 0.03];
  const vals = offs.map((o) => Number((1.08 + o).toFixed(3)));
  const posted: any[] = [];
  for (let i = 0; i < vals.length; i++) {
    const r = await j(await call("POST", `${L}/results`, { control_lot_id: lotId, result_value: vals[i], result_date: `2026-06-${String(i + 1).padStart(2, "0")}` }, token));
    posted.push(r);
  }
  const f20 = vals.slice(0, 20);
  const m20 = f20.reduce((a, b) => a + b, 0) / 20;
  const s20 = Math.sqrt(f20.reduce((s, x) => s + (x - m20) ** 2, 0) / 19);

  // 1
  check("1a. runs 1-20 judged on the manufacturer mean/SD (1.29 / 0.35)",
    posted.slice(0, 20).every((p) => p?.basis?.source === "manufacturer" && p.basis.mean === 1.29 && p.basis.sd === 0.35),
    `sources=${posted.slice(0, 20).map((p) => p?.basis?.source?.[0]).join("")}`);
  check("1b. run 21 judged on the lab's own mean/SD from the first 20",
    posted[20]?.basis?.source === "established" && near(posted[20].basis.mean, m20) && near(posted[20].basis.sd, s20),
    `basis=${JSON.stringify(posted[20]?.basis)}`);
  check("1c. on the manufacturer basis the low-running lab trips 10-x by run 10",
    (posted[9]?.violations || []).some((v: any) => v.rule_code === "10-x"),
    JSON.stringify((posted[9]?.violations || []).map((v: any) => v.rule_code)));

  // 2
  const lots = await j(await call("GET", `${L}/lots`, undefined, token));
  const lot = (lots.lots || []).find((l: any) => l.id === lotId);
  check("2. GET /qc/lots gives the chart the locked lab basis (persisted, n 20)",
    lot?.basis?.source === "established" && lot.basis.persisted === true && lot.basis.n === 20 && near(lot.basis.mean, m20) && near(lot.basis.sd, s20),
    lot?.basis?.label);

  // 3
  const line = await j(await call("GET", `${L}/line?analyte=${encodeURIComponent("PSA (FREND B)")}&level=${encodeURIComponent("Level 1")}`, undefined, token));
  const pt = (line.points || [])[3];
  check("3. /qc/line SDI = (value - lab mean) / lab SD",
    !!pt && near(pt.sdi, (pt.result_value - m20) / s20, 1e-9) && near(pt.basis_mean, m20),
    pt ? `sdi=${pt.sdi.toFixed(3)} value=${pt.result_value}` : "no points");

  // 4
  const eAll = await j(await call("POST", `${L}/control-lots/${lotId}/establish`, { mode: "all_runs" }, token));
  const m21 = vals.reduce((a, b) => a + b, 0) / vals.length;
  const eMan = await j(await call("POST", `${L}/control-lots/${lotId}/establish`, { mode: "manual", mean: 1.1, sd: 0.09 }, token));
  const eBad = await call("POST", `${L}/control-lots/${lotId}/establish`, { mode: "manual", mean: 1.1, sd: 0 }, token);
  const eMode = await call("POST", `${L}/control-lots/${lotId}/establish`, { mode: "running" }, token);
  const eAuto = await j(await call("POST", `${L}/control-lots/${lotId}/establish`, { mode: "auto" }, token));
  check("4. re-establish: all_runs (21 runs), manual, auto; sd 0 and an unknown mode refused",
    near(eAll?.basis?.mean, m21) && eAll.basis.n === 21 && eAll.basis.label.includes("from 21 runs")
    && eMan?.basis?.mean === 1.1 && eMan.basis.label.includes("entered by the lab")
    && eBad.status === 400 && eMode.status === 400
    && eAuto?.basis?.persisted === false && near(eAuto.basis.mean, m20),
    `${eAll?.basis?.label} | ${eMan?.basis?.label} | ${eAuto?.basis?.label}`);

  // 5. simulate a flag the old engine stored (a 1-3s on run 5) with a CA on it
  const dbPath = process.env.DB_PATH || ".tmp-vqb.db";
  const raw = new Database(dbPath);
  const run5 = posted[4].result_id;
  const fakeV = Number(raw.prepare("INSERT INTO qc_rule_violations (qc_result_id, rule_code, severity, detail, related_result_ids, evaluated_at) VALUES (?, '1-3s', 'rejection', 'old basis', ?, '2026-06-05')").run(run5, JSON.stringify([run5])).lastInsertRowid);
  const ca = await j(await call("POST", `${L}/corrective-actions`, { qc_result_id: run5, qc_rule_violation_id: fakeV, action_taken: "Reran control, in range" }, token));
  const countRows = () => (raw.prepare("SELECT COUNT(*) AS n FROM qc_rule_violations WHERE qc_result_id IN (SELECT id FROM qc_results WHERE lab_id = ?)").get(labId) as any).n;
  const rowsBefore = countRows();
  const dry = await j(await call("POST", "/api/admin/qc/rescore", { secret: ADMIN, labIds: [labId], since: "2026-06-01" }));
  const dryLot = dry?.report?.[0]?.lots?.find((l: any) => l.lotId === lotId);
  const dryRun5 = dryLot?.changes?.find((c: any) => c.result_id === run5);
  check("5a. dry run reports run 5 before [1-3s] after [] and writes nothing",
    dry?.dryRun === true && !!dryRun5 && dryRun5.before.includes("1-3s") && !dryRun5.after.includes("1-3s") && countRows() === rowsBefore,
    JSON.stringify(dryRun5));
  const commit = await j(await call("POST", "/api/admin/qc/rescore", { secret: ADMIN, labIds: [labId], since: "2026-06-01", dryRun: false }));
  const old = raw.prepare("SELECT superseded_at FROM qc_rule_violations WHERE id = ?").get(fakeV) as any;
  const caRow = raw.prepare("SELECT qc_rule_violation_id FROM qc_corrective_actions WHERE id = ?").get(Number(ca?.corrective_action_id ?? 0)) as any;
  const results = await j(await call("GET", `${L}/results?control_lot_id=${lotId}&limit=50`, undefined, token));
  const r5 = (results.results || []).find((r: any) => r.id === run5);
  const stamped = raw.prepare("SELECT COUNT(*) AS n FROM qc_results WHERE control_lot_id = ? AND basis_source IS NOT NULL").get(lotId) as any;
  check("5b. commit: old flag superseded not deleted, CA still points at it, results no longer show it",
    commit?.dryRun === false && !!old?.superseded_at && caRow?.qc_rule_violation_id === fakeV && !!r5 && !(r5.violations || []).some((v: any) => v.rule_code === "1-3s"),
    JSON.stringify({ superseded: old?.superseded_at, caViolation: caRow?.qc_rule_violation_id, r5: (r5?.violations || []).map((v: any) => v.rule_code) }));
  check("5c. every re-scored run carries the basis that judged it", stamped.n === vals.length, `${stamped.n} of ${vals.length}`);
  raw.close();

  // 6. monthly PDF HTML
  const html = buildMonthlyReviewHTML({
    lab: { id: labId, lab_name: "VQB Lab", clia_number: null },
    lot: { id: lotId, analyte: "PSA (FREND B)", level: "Level 1", lot_number: "6361A26001", manufacturer: "NanoEntek", mfr_mean: 1.29, mfr_sd: 0.35, mfr_sd_interval: 2, mfr_range_low: 0.59, mfr_range_high: 1.99 },
    basis: { mean: m20, sd: s20, source: "established", label: lot.basis.label },
    periodYear: 2026, periodMonth: 6,
    results: vals.map((v, i) => ({ id: i + 1, result_value: v, result_date: `2026-06-${String(i + 1).padStart(2, "0")}`, run_time: null, instrument: null, accepted_for_reporting: 1, violations: [], corrective_actions: [] })),
    baselineMean: m21, baselineSD: s20, reviewerName: "Test", reviewerTitle: "Medical director or designee", reviewerDate: "2026-10-08", attestationAcknowledged: false,
  } as any);
  check("6. PDF: narrative names the lab basis and the manufacturer reference; chart draws the Mfr mean line",
    html.includes(lot.basis.label) && html.includes("shown on the chart for reference") && html.includes("Mfr mean") && !html.includes("programmed mean"),
    "");

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
