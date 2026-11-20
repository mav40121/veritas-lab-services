// tests/integration/effectiveness-measured.test.ts
//
// STANDING integration test for measured effectiveness monitoring on VeritaResponse findings (Lifepoint ask, Michael
// 2026-11-19; shared/effectivenessMeasure.ts):
//   1. Generate with no body still makes 30/60/90 and leaves the plan alone; a schedule and a plan can be sent; an
//      unknown schedule or a bad plan is refused with nothing written.
//   2. With a target, a checkpoint's counts decide its result (at or above the target: effective; below: not effective,
//      which reopens a closed finding), whatever status was sent; bad counts are refused.
//   3. Without a target, counts are stored and the sent status decides, as before.
//   4. The plan can be changed later; recorded checkpoints keep their result. Another lab can't reach the checkpoints.
//   5. The shared rule's edges: 899 of 1,000 against 90% is below; the summary line.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:effectiveness-measured

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { measuredStatus, complianceRate, monitoringSummary, parseMonitoringPlan, scheduleIntervals } from "../../shared/effectivenessMeasure";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const PW = ["Mo", "nit", "7x!"].join("-");
  const call = async (token: string, labId: number, method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const owner = async (tag: string) => {
    const email = `it-monitor-${tag}-${Date.now()}@example.com`;
    const reg = await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, name: `IT Monitor ${tag}`, hipaa_acknowledged: true }) }).then((r) => r.json());
    const labId = Number((await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: `IT Monitor Lab ${tag}`, plan: "hospital" }) }).then((r) => r.json())).labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(Number(reg.user?.id));
    const token = (await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW }) }).then((r) => r.json())).token as string;
    return { labId, token };
  };
  const finding = (id: number) => sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(id) as any;
  const checks = (id: number) => sqlite.prepare("SELECT * FROM finding_effectiveness_checks WHERE finding_id = ? ORDER BY interval_days").all(id) as any[];

  try {
    const A = await owner("a");
    const B = await owner("b");
    check("0. two labs made", A.labId > 0 && B.labId > 0 && !!A.token && !!B.token);
    const mk = async () => Number((await call(A.token, A.labId, "POST", `/api/labs/${A.labId}/findings`, { accreditor: "CMS", anchor_date: "2026-09-01", description: "Made-up: temperature log gaps", corrective_action: "Made-up: weekend reader", completion_date: "2026-10-01" })).body?.id);
    const f1 = await mk(), f2 = await mk(), f3 = await mk();
    sqlite.prepare("UPDATE findings SET completion_date = '2026-10-01' WHERE id IN (?, ?, ?)").run(f1, f2, f3);
    const L = `/api/labs/${A.labId}/findings`;

    // 1. Generate
    const plain = await call(A.token, A.labId, "POST", `${L}/${f1}/effectiveness-checks/generate`);
    check("1a. no body: 30/60/90 as before, plan left empty", plain.status === 200 && checks(f1).map((c) => c.interval_days).join(",") === "30,60,90" && finding(f1).monitor_target_pct === null && finding(f1).monitor_measure === null, JSON.stringify({ s: plain.status, i: checks(f1).map((c) => c.interval_days) }));
    const bad = await call(A.token, A.labId, "POST", `${L}/${f2}/effectiveness-checks/generate`, { schedule: "weekly-forever" });
    check("1b. an unknown schedule is refused, nothing made", bad.status === 400 && bad.body?.code === "SCHEDULE_UNKNOWN" && checks(f2).length === 0, JSON.stringify(bad.body));
    for (const t of [0, 101, 9.5, "ninety"]) {
      const r = await call(A.token, A.labId, "POST", `${L}/${f2}/effectiveness-checks/generate`, { schedule: "monthly-4", target_pct: t });
      check(`1c. target ${JSON.stringify(t)} refused, nothing made`, r.status === 400 && r.body?.code === "PLAN_INVALID" && checks(f2).length === 0 && finding(f2).monitor_target_pct === null, JSON.stringify(r.body));
    }
    const gen = await call(A.token, A.labId, "POST", `${L}/${f2}/effectiveness-checks/generate`, { schedule: "monthly-4", measure: "  Temperature logs with every reading recorded ", target_pct: 90, sample: 30 });
    const d2 = checks(f2);
    check("1d. monthly for 4 months: 30/60/90/120 days from the completion date", gen.status === 200 && d2.map((c) => c.interval_days).join(",") === "30,60,90,120" && d2[3].due_date === "2027-01-29", JSON.stringify(d2.map((c) => [c.interval_days, c.due_date])));
    check("1e. the plan is stored (measure trimmed) and returned", finding(f2).monitor_measure === "Temperature logs with every reading recorded" && finding(f2).monitor_target_pct === 90 && finding(f2).monitor_sample === 30 && gen.body?.finding?.monitor_target_pct === 90);

    // 2. With a target
    const c30 = d2[0], c60 = d2[1], c90 = d2[2];
    const meets = await call(A.token, A.labId, "PUT", `${L}/${f2}/effectiveness-checks/${c30.id}`, { status: "not_effective", audited_count: 30, compliant_count: 27, outcome_note: "Made-up: 27 of 30" });
    const r30 = checks(f2)[0];
    check("2a. 27 of 30 meets a 90% target: effective, though not_effective was sent", meets.status === 200 && r30.status === "effective" && r30.audited_count === 30 && r30.compliant_count === 27 && meets.body?.reopened === false, JSON.stringify({ s: meets.status, r: r30 }));
    sqlite.prepare("UPDATE findings SET status = 'closed' WHERE id = ?").run(f2);
    const below = await call(A.token, A.labId, "PUT", `${L}/${f2}/effectiveness-checks/${c60.id}`, { status: "effective", audited_count: 30, compliant_count: 26 });
    check("2b. 26 of 30 is below 90%: not effective, and the closed finding reopens", below.status === 200 && checks(f2)[1].status === "not_effective" && below.body?.reopened === true && finding(f2).status === "drafting", JSON.stringify({ s: below.status, b: below.body, st: finding(f2).status }));
    for (const [a, c, why] of [[30, 31, "compliant above audited"], [0, 0, "nothing audited"], [30, -1, "negative"], [30, 2.5, "fraction"]] as const) {
      const r = await call(A.token, A.labId, "PUT", `${L}/${f2}/effectiveness-checks/${c90.id}`, { audited_count: a, compliant_count: c });
      check(`2c. ${why} is refused, the checkpoint stays pending`, r.status === 400 && r.body?.code === "COUNTS_INVALID" && checks(f2)[2].status === "pending", JSON.stringify(r.body));
    }
    const hist = sqlite.prepare("SELECT payload FROM finding_history WHERE finding_id = ? AND event = 'effectiveness_failed' ORDER BY id DESC").get(f2) as any;
    check("2d. the history records the counts and the target", /"audited":30/.test(hist?.payload || "") && /"compliant":26/.test(hist?.payload || "") && /"target_pct":90/.test(hist?.payload || ""), String(hist?.payload));

    // 3. Without a target
    const g3 = await call(A.token, A.labId, "POST", `${L}/${f3}/effectiveness-checks/generate`, { schedule: "30-60-90", measure: "Made-up audit" });
    const n30 = checks(f3)[0];
    const noStatus = await call(A.token, A.labId, "PUT", `${L}/${f3}/effectiveness-checks/${n30.id}`, { audited_count: 10, compliant_count: 5 });
    check("3a. no target and no status: refused as before", g3.status === 200 && noStatus.status === 400 && checks(f3)[0].status === "pending", JSON.stringify(noStatus.body));
    const byHand = await call(A.token, A.labId, "PUT", `${L}/${f3}/effectiveness-checks/${n30.id}`, { status: "effective", audited_count: 10, compliant_count: 5 });
    check("3b. no target: the sent status decides and the counts are kept", byHand.status === 200 && checks(f3)[0].status === "effective" && checks(f3)[0].compliant_count === 5);
    const old = await call(A.token, A.labId, "PUT", `${L}/${f3}/effectiveness-checks/${checks(f3)[1].id}`, { status: "effective", outcome_note: "Made-up" });
    check("3c. a record with no counts works as before and stores none", old.status === 200 && checks(f3)[1].status === "effective" && checks(f3)[1].audited_count === null);

    // 4. Plan edits and reach
    const edit = await call(A.token, A.labId, "PUT", `${L}/${f2}/effectiveness-plan`, { measure: "Made-up: all logs", target_pct: 95, sample: 40 });
    check("4a. the plan changes; recorded checkpoints keep their result", edit.status === 200 && finding(f2).monitor_target_pct === 95 && checks(f2)[0].status === "effective" && checks(f2)[1].status === "not_effective");
    const badEdit = await call(A.token, A.labId, "PUT", `${L}/${f2}/effectiveness-plan`, { target_pct: 200 });
    check("4b. a bad plan edit is refused and changes nothing", badEdit.status === 400 && finding(f2).monitor_target_pct === 95);
    const cross = await call(B.token, B.labId, "PUT", `/api/labs/${B.labId}/findings/${f2}/effectiveness-checks/${c90.id}`, { audited_count: 30, compliant_count: 30 });
    const crossRead = await call(B.token, B.labId, "GET", `/api/labs/${B.labId}/findings/${f2}/effectiveness-checks`);
    const crossPlan = await call(B.token, B.labId, "PUT", `/api/labs/${B.labId}/findings/${f2}/effectiveness-plan`, { target_pct: 10 });
    check("4c. another lab can't read, record or change the plan", cross.status === 404 && crossRead.status === 404 && crossPlan.status === 404 && checks(f2)[2].status === "pending" && finding(f2).monitor_target_pct === 95, JSON.stringify([cross.status, crossRead.status, crossPlan.status]));

    // 5. The shared rule
    check("5a. 900 of 1,000 meets 90%; 899 of 1,000 is below", measuredStatus(1000, 900, 90) === "effective" && measuredStatus(1000, 899, 90) === "not_effective");
    check("5b. 100% target needs every one", measuredStatus(30, 30, 100) === "effective" && measuredStatus(30, 29, 100) === "not_effective");
    check("5c. rate to one decimal", complianceRate(30, 26) === 86.7 && complianceRate(3, 3) === 100);
    check("5d. schedules", JSON.stringify(scheduleIntervals("monthly-6")) === "[30,60,90,120,150,180]" && scheduleIntervals("x") === null);
    check("5e. a blank plan is allowed", parseMonitoringPlan({ measure: "", target_pct: "", sample: null }).ok === true);
    const s = monitoringSummary([{ status: "effective" }, { status: "not_effective" }, { status: "pending" }], 90);
    check("5f. summary line", s === "2 of 3 checkpoints recorded; 1 below the 90% target." && monitoringSummary([{ status: "effective" }, { status: "effective" }], 90) === "Monitoring complete: all 2 checkpoints met the 90% target.", s);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
