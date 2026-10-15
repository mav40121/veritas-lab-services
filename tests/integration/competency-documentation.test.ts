// tests/integration/competency-documentation.test.ts
//
// Receipt for the competency documentation fields (Michael Q74 = 1, plan part B, 2026-10-11). The rule:
// orientation/training is completed and documented first; the initial competency comes before patient
// testing (42 CFR 493.1445(e)(12) / 493.1407(e)(11)) with no deadline from hire; the clock starts at the
// initial (6-month at initial + 6, 1st annual at initial + 12, then annually). Existing staff were already
// testing before the lab kept these records: the lab enters their most recent competency.
// Boots the REAL routes on a scratch DB, lab-scoped, and proves:
//   1. a new hire's initial dated before training -> 400, nothing saved
//   2. a new hire's initial with no training date -> 400
//   3. training link must be http(s) -> 400
//   4. full new-hire record saves: training fields stored, 6-month = initial + 6, 1st annual = initial + 12
//      (a late 6-month does not move it); audit log row with before/after
//   5. a save that omits the documentation fields keeps them (older callers cannot wipe them)
//   6. the employee payload carries the server's reading: new hire cleared on the initial date
//   7. existing staff with only the last annual: not flagged for a missing initial, cleared as existing staff,
//      next due = annual; and the dashboard tile does not count them overdue
//   8. a new hire with no initial past hire + 90 is still overdue on the dashboard tile (unchanged rule)
// Run (from bash): DB_PATH=.tmp-cdoc.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-documentation.test.ts
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
  const email = `cdoc-${Date.now()}@example.com`;
  const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Comp Doc Owner", hipaa_acknowledged: true })).j;
  const token = reg.token as string;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Comp Doc Lab", plan: "hospital" })).j.labId as number;
  const L = `/api/labs/${labId}`;
  sqlite.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId); // the lab is TJC-accredited
  const labSetup = await call("POST", `${L}/staff/lab`, { labName: "Comp Doc Lab", cliaNumber: "11D7777777", accreditationBody: "TJC", complexity: "high" }, token);
  if (labSetup.s !== 200) console.log("staff lab setup:", labSetup.s, JSON.stringify(labSetup.j).slice(0, 300));
  const mkEmp = async (first: string, hireDate: string) => (await call("POST", `${L}/staff/employees`, { lastName: "Doc", firstName: first, highestComplexity: "high", performsTesting: true, hireDate }, token)).j;
  const nh = await mkEmp("Nora", "2026-01-05");
  const ex = await mkEmp("Eli", "2012-06-01");
  const late = await mkEmp("Lane", "2026-01-05");
  check("fixture: lab + 3 testing employees", !!nh?.id && !!ex?.id && !!late?.id, JSON.stringify({ nh: nh?.id, ex: ex?.id, late: late?.id }));
  const row = (id: number) => sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(id) as any;
  const P = (id: number) => `${L}/staff/competency/${id}`;

  const r1 = await call("PUT", P(nh.id), { recordedAs: "new_hire", trainingCompletedAt: "2026-04-10", initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor" }, token);
  check("1. new hire: initial dated before training -> 400, nothing saved", r1.s === 400 && /before orientation\/training/.test(r1.j.error || "") && !row(nh.id)?.initial_completed_at, `${r1.s} ${r1.j.error}`);
  const r2 = await call("PUT", P(nh.id), { recordedAs: "new_hire", initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor" }, token);
  check("2. new hire: initial with no training date -> 400", r2.s === 400 && /orientation\/training was completed/.test(r2.j.error || ""), `${r2.s} ${r2.j.error}`);
  const r3 = await call("PUT", P(nh.id), { recordedAs: "new_hire", trainingCompletedAt: "2026-03-20", trainingRecordUrl: "file://share/training.pdf" }, token);
  check("3. training link must be http(s) -> 400", r3.s === 400 && /http/.test(r3.j.error || ""), `${r3.s} ${r3.j.error}`);

  const auditBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'competency_schedule' AND entity_id = ?").get(String(nh.id)) as any).n;
  const r4 = await call("PUT", P(nh.id), {
    recordedAs: "new_hire", trainingCompletedAt: "2026-03-20", trainingDocumentedBy: "J. Trainer", trainingRecordUrl: "https://example.sharepoint.com/training/nora.pdf",
    initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor", sixMonthCompletedAt: "2026-10-20", sixMonthSignedBy: "T. Supervisor",
  }, token);
  const s4 = row(nh.id);
  check("4a. full new-hire record saves with training fields", r4.s === 200 && s4.recorded_as === "new_hire" && s4.training_completed_at === "2026-03-20" && s4.training_documented_by === "J. Trainer" && /sharepoint/.test(s4.training_record_url), JSON.stringify(r4.j).slice(0, 200));
  check("4b. 6-month due = initial + 6 (2026-10-06); 1st annual = initial + 12 (2027-04-06) despite the late 6-month", s4.six_month_due_at === "2026-10-06" && s4.first_annual_due_at === "2027-04-06", `six=${s4.six_month_due_at} fa=${s4.first_annual_due_at}`);
  const audits = sqlite.prepare("SELECT action, before_json, after_json FROM audit_log WHERE entity_type = 'competency_schedule' AND entity_id = ? ORDER BY id").all(String(nh.id)) as any[];
  const lastAudit = audits[audits.length - 1];
  check("4c. audit log row with before/after (training date and initial recorded)", audits.length === auditBefore + 1 && /training_completed_at/.test(lastAudit?.after_json || "") && /2026-04-06/.test(lastAudit?.after_json || ""), JSON.stringify(lastAudit).slice(0, 260));

  // An older caller that sends only the milestone fields must not wipe the documentation fields.
  const r5 = await call("PUT", P(nh.id), { initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor", sixMonthCompletedAt: "2026-10-20", sixMonthSignedBy: "T. Supervisor", notes: "reviewed" }, token);
  const s5 = row(nh.id);
  check("5. a save without the documentation fields keeps them", r5.s === 200 && s5.recorded_as === "new_hire" && s5.training_completed_at === "2026-03-20" && s5.training_documented_by === "J. Trainer" && s5.notes === "reviewed", JSON.stringify({ ra: s5.recorded_as, tc: s5.training_completed_at }));

  const g6 = (await call("GET", `${L}/staff/employees/${nh.id}`, undefined, token)).j;
  check("6. employee payload: new hire cleared on the initial date, next due = 1st annual", g6?.competencyStatus?.cleared === true && /2026-04-06/.test(g6.competencyStatus.label) && g6.competencyStatus.nextDue === "2027-04-06", JSON.stringify(g6?.competencyStatus));

  const r7 = await call("PUT", P(ex.id), { recordedAs: "existing", lastAnnualCompletedAt: "2026-03-01", lastAnnualSignedBy: "T. Supervisor" }, token);
  const g7 = (await call("GET", `${L}/staff/employees/${ex.id}`, undefined, token)).j;
  check("7a. existing staff with only the last annual: cleared as existing staff, next due = annual 2027-03-01", r7.s === 200 && g7?.competencyStatus?.cleared === true && /Existing staff/.test(g7.competencyStatus.label) && g7.competencyStatus.nextDue === "2027-03-01" && !/Initial/.test(g7.competencyStatus.reason), JSON.stringify(g7?.competencyStatus));
  // Back-date the third employee's roster entry so hire + 90 / added + 90 have passed, with no initial.
  sqlite.prepare("UPDATE staff_employees SET created_at = ? WHERE id = ?").run("2026-01-05T12:00:00.000Z", late.id);
  const dash = (await call("GET", `${L}/competency/dashboard-stats`, undefined, token)).j;
  const overdue: number[] = dash?.overdueIds ?? [];
  check("7b. dashboard tile does not count the existing staff member overdue", !overdue.includes(ex.id), JSON.stringify(dash).slice(0, 240));
  check("8. a new hire with no initial past hire + 90 is still overdue on the tile", overdue.includes(late.id), JSON.stringify(overdue));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
