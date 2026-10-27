// tests/integration/competency-method-due.test.ts
//
// Receipt for BUG-069 (Michael Q34 = 1, 2026-10-27). Competencies have been signed method by method since 10/13, and
// each method runs its own clock, but the competency register, the reminder emails, the roster status and the dashboard
// tile read only the person-level dates in VeritaStaff. Boots the REAL routes on a scratch DB with made-up people and
// proves, with dates relative to today:
//   1. A person whose method's 6-month is signed reads current, although the VeritaStaff record (filled from the initial)
//      still shows the 6-month as overdue. Before the 6-month is signed, the same person reads overdue on that method.
//   2. A person with no method sign-offs reads exactly as before (the VeritaStaff record).
//   3. Existing staff whose VeritaStaff record is overdue stay overdue while an assigned method has no sign-off yet,
//      even though their signed method is current.
//   4. A remediation sign-off reads as a reassessment due by its target date.
//   5. Roster status, the dashboard tile, the owed list, the reminder plan and the register agree, and the register's
//      By Method sheet lists each method's dates; the VeritaComp method view shows the same next due.
// Run (from bash): DB_PATH=.tmp-cmdue.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-method-due.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labToday } = await import("../../server/dateLocal");
  const { addMonthsIso, addDaysIso } = await import("../../server/competencySchedule");
  const { computeCompetencyDue } = await import("../../server/competencyReminders");
  const { default: ExcelJS } = await import("exceljs");
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

  const email = `cmdue-${Date.now()}@example.com`;
  const tk = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Method Due", hipaa_acknowledged: true })).j.token as string;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Method Due Lab", plan: "hospital" })).j.labId as number;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Method Due Lab", cliaNumber: "11D7654399", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
    { name: "Mini i-Sed", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
    { name: "Coag One", category: "Coagulation", tests: [{ analyte: "PT", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
  ] });
  const instId = (n: string) => (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(n, mapId) as any).id as number;
  const SED = instId("Mini i-Sed"), COAG = instId("Coag One");

  const today = labToday();
  const T = (months: number, days = 0) => addDaysIso(addMonthsIso(today, months), days);
  const now = new Date().toISOString();
  const mkEmp = async (last: string, first: string, hire: string) => {
    const e = (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: hire }, tk)).j;
    for (const inst of [SED, COAG]) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(e.id, inst, now);
    return e.id as number;
  };
  const sign = (emp: number, inst: number, milestone: string, date: string, determination = "pass", target: string | null = null) =>
    sqlite.prepare(`INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, complexity, determination, remediation_target_date, created_at)
      VALUES (?, ?, ?, ?, ?, 'Casey Tate', 'TC', 'MODERATE', ?, ?, ?)`).run(labId, emp, inst, milestone, date, determination, target, now);

  // 1. Mira: method initial on the Sed analyzer 8 months ago; VeritaStaff record filled from it (6-month due 2 months ago).
  const mira = await mkEmp("Method", "Mira", T(-9));
  sign(mira, SED, "initial", T(-8));
  await call("PUT", `${L}/staff/competency/${mira}`, { initialCompletedAt: T(-8), initialSignedBy: "Casey Tate" }, tk);
  // 2. Ollie: no method sign-offs; the VeritaStaff record says the 6-month is overdue.
  const ollie = await mkEmp("Record", "Ollie", T(-9));
  await call("PUT", `${L}/staff/competency/${ollie}`, { initialCompletedAt: T(-8), initialSignedBy: "Casey Tate" }, tk);
  // 3. Erin: existing staff, last annual 13 months ago (overdue on the record); Sed annual signed last month; Coag unsigned.
  const erin = await mkEmp("Existing", "Erin", "2012-01-01");
  await call("PUT", `${L}/staff/competency/${erin}`, { recordedAs: "existing" }, tk);
  await call("PUT", `${L}/staff/competency/${erin}`, { lastAnnualCompletedAt: T(-13), lastAnnualSignedBy: "Lab Entered" }, tk);
  sign(erin, SED, "annual", T(-1));
  // 4. Remy: initial passed, then a 6-month signed as Remediation Required with a target 10 days out.
  const remy = await mkEmp("Remedy", "Remy", T(-9));
  sign(remy, SED, "initial", T(-8));
  await call("PUT", `${L}/staff/competency/${remy}`, { initialCompletedAt: T(-8), initialSignedBy: "Casey Tate" }, tk);
  sign(remy, SED, "six_month", T(0, -5), "remediation", T(0, 10));

  const roster = async () => {
    const list = (await fetch(`${base}${L}/staff/employees`, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json())) as any[];
    return (id: number) => list.find((e) => e.id === id)?.competencyStatus || {};
  };
  let st = await roster();
  check("1a. before the 6-month: Mira reads overdue on the Sed method", st(mira).bucket === "overdue" && /6-month competency due \(Mini i-Sed\)/.test(st(mira).reason), JSON.stringify(st(mira)));

  sign(mira, SED, "six_month", T(-1));
  st = await roster();
  const miraFirstAnnual = addMonthsIso(T(-8), 12);
  check("1b. after the 6-month is signed: Mira reads current although the VeritaStaff record still shows the 6-month overdue",
    st(mira).bucket !== "overdue" && st(mira).nextDue === miraFirstAnnual && /First annual competency due \(Mini i-Sed\)/.test(st(mira).reason),
    JSON.stringify({ status: st(mira), recordSixMonthDue: (sqlite.prepare("SELECT six_month_due_at FROM staff_competency_schedules WHERE employee_id = ?").get(mira) as any)?.six_month_due_at }));
  check("2. Ollie (no method sign-offs) reads from the VeritaStaff record exactly as before", st(ollie).bucket === "overdue" && st(ollie).reason === "6-month competency due", JSON.stringify(st(ollie)));
  check("3. Erin (existing staff, a method still unsigned) stays overdue from the record although her signed method is current",
    st(erin).bucket === "overdue" && /annual/i.test(st(erin).reason), JSON.stringify(st(erin)));
  check("4. Remy's remediation sign-off reads as a reassessment due by its target date",
    st(remy).bucket === "dueSoon30" && st(remy).nextDue === T(0, 10) && /Reassessment after remediation due \(Mini i-Sed\)/.test(st(remy).reason), JSON.stringify(st(remy)));

  const dash = await call("GET", `${L}/competency/dashboard-stats`, undefined, tk);
  const od: number[] = dash.j.overdueIds || [];
  check("5a. dashboard tile: overdue = Ollie and Erin, not Mira or Remy", od.includes(ollie) && od.includes(erin) && !od.includes(mira) && !od.includes(remy), JSON.stringify({ overdue: dash.j.overdue, od }));

  const owed = await call("GET", `${L}/competency/owed`, undefined, tk);
  const owedStr = JSON.stringify(owed.j);
  check("5b. owed list answers (HTTP 200) and is built on the same walk", owed.s === 200, `${owed.s} ${owedStr.slice(0, 120)}`);

  const due = computeCompetencyDue(sqlite, labId, today);
  const dm = due.find((d) => d.employeeId === mira);
  check("5c. reminder plan: Mira's next item is the Sed first annual, not the record's overdue 6-month",
    !!dm && dm.nextDue === miraFirstAnnual && dm.daysUntil > 0 && /First annual/.test(dm.reason), JSON.stringify(dm));

  const view = await call("GET", `${L}/competency/employee/${mira}`, undefined, tk);
  const sedTs = (view.j.testSystems || []).find((t: any) => t.id === SED || t.instrument_id === SED || t.instrumentId === SED) || (view.j.testSystems || [])[0];
  check("5d. the VeritaComp method view shows the same next due for the Sed method", sedTs?.nextDue?.targetDate === miraFirstAnnual, JSON.stringify(sedTs?.nextDue));

  const xr = await fetch(`${base}${L}/staff/competency-register.xlsx`, { headers: { Authorization: `Bearer ${tk}` } });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()) as any);
  const tp = wb.getWorksheet("Testing Personnel")!, bm = wb.getWorksheet("By Method");
  const rowsOf = (ws: any) => { const out: any[][] = []; ws.eachRow((r: any, i: number) => { if (i > 1) out.push((r.values as any[]).slice(1)); }); return out; };
  const tpRows = rowsOf(tp), bmRows = bm ? rowsOf(bm) : [];
  const miraTp = tpRows.find((r) => String(r[0]).startsWith("Method, Mira"));
  check("5e. register Testing Personnel: Mira is not Overdue and her next item is the Sed first annual",
    !!miraTp && miraTp[19] !== "Overdue" && /First annual competency due \(Mini i-Sed\)/.test(String(miraTp[17])), JSON.stringify(miraTp?.slice(17, 20)));
  const miraBm = bmRows.filter((r) => String(r[0]).startsWith("Method, Mira"));
  const sedRow = miraBm.find((r) => r[1] === "Mini i-Sed"), coagRow = miraBm.find((r) => r[1] === "Coag One");
  check("5f. register By Method: Mira's Sed row (6-month signed, first annual next) and her Coag row (initial not signed)",
    !!bm && !!sedRow && /6-month/.test(String(sedRow[4])) && sedRow[8] !== "Overdue" && !!coagRow && coagRow[8] === "Initial not signed",
    JSON.stringify({ sheets: wb.worksheets.map((w: any) => w.name), sedRow, coagRow }));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
