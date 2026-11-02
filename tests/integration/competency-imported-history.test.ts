// tests/integration/competency-imported-history.test.ts
//
// BUG-120 (Michael Q92 = 1, 2026-11-02): Bulk Import history (and older program-form or cohort records) sat in a named
// technical program with no per-analyzer detail, so VeritaStaff cleared a person brought over while the VeritaComp
// person page still showed the Initial as due (reproduced on a scratch DB). A locked, passed Initial / 6-month / Annual in
// a named technical program now counts as imported history for each analyzer the program names and the person runs, in
// the person page and in the shared clock (register, reminders, roster status, dashboard). Scratch DB, made-up people.
// This pins:
//   P. the import preview warns on a row whose technical program names no analyzers (and still imports it)
//   1. person page: the newest imported Annual drives the clock (next Annual due a year later, signed current), shown as
//      imported from the program; the older Initial is kept as earlier history; a failed record never counts
//   2. the shared clock (loadLabMethodClocks) gives the same answer, and VeritaStaff and VeritaComp now agree
//   3. a program that names no analyzers counts nothing (the person still shows the Initial as due)
//   4. a live per-method sign-off wins over imported history
//   5. a program-form record in a named technical program (locked, pass) counts the same way
// Run: npm run test:competency-imported-history

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { loadLabMethodClocks } = await import("../../server/competencyMethodClock");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  try {
    const email = `it-imported-${Date.now()}@example.com`;
    const tk = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "IT Imported History", hipaa_acknowledged: true })).j.token as string;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Imported Lab", plan: "hospital" })).j.labId as number;
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Imported Lab", cliaNumber: "11D7654387", accreditationBody: "CLIA_ONLY", complexity: "high" }, tk);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
      { name: "Chem Box", category: "Chemistry", tests: [{ analyte: "Sodium", specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 }] },
      { name: "Coag Unit", category: "Coagulation", tests: [{ analyte: "PT", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
    ] });
    const inst = (n: string) => Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(n, mapId) as any)?.id);
    const HEMO = inst("Hemo Counter"), CHEM = inst("Chem Box"), COAG = inst("Coag Unit");
    const now = new Date().toISOString();
    const mk = async (first: string, last: string, hireDate: string, instId: number) => {
      const id = Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate }, tk)).j.id);
      sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(id, instId, now);
      return id;
    };
    const robin = await mk("Robin", "Lane", "2015-03-01", HEMO);
    const sam = await mk("Sam", "Ortiz", "2016-06-01", CHEM);
    const ana = await mk("Ana", "Reyes", "2014-01-06", HEMO);
    const cole = await mk("Cole", "Park", "2017-02-01", COAG);
    const prog = async (body: any) => Number((await call("POST", `${L}/competency/programs`, body, tk)).j.id);
    const hemoP = await prog({ name: "Hematology Competency", department: "Hematology", type: "technical", methodGroups: [{ name: "Hemo Counter", instruments: ["Hemo Counter"], analytes: ["WBC"] }] });
    const chemP = await prog({ name: "Chemistry Old", department: "Chemistry", type: "technical" });
    const coagP = await prog({ name: "Coagulation Competency", department: "Coagulation", type: "technical", methodGroups: [{ name: "Coag Unit", instruments: ["Coag Unit"], analytes: ["PT"] }] });
    // Ana already has a live per-method Initial on the Hemo Counter (signed 2026-10-20 on her page).
    sqlite.prepare(`INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, determination, created_at)
      VALUES (?, ?, ?, 'initial', '2026-10-20', 'Kit Vance', 'TC', 'pass', ?)`).run(labId, ana, HEMO, now);
    check("0. fixture: three analyzers, four techs, a program naming the Hemo Counter, one naming nothing, Ana signed live",
      HEMO > 0 && CHEM > 0 && COAG > 0 && robin > 0 && sam > 0 && ana > 0 && cole > 0 && hemoP > 0 && chemP > 0 && coagP > 0);

    const tpl = await fetch(`${base}${L}/competency/assessments/bulk-template`, { headers: { Authorization: `Bearer ${tk}` } });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()) as any);
    const ws = wb.getWorksheet("Assessments")!;
    const rows = [
      ["Robin Lane", "Hematology Competency", "initial", "2015-04-01", "pass", "Kit Vance"],
      ["Robin Lane", "Hematology Competency", "annual", "2024-03-12", "fail", "Kit Vance"],
      ["Robin Lane", "Hematology Competency", "annual", "2026-03-15", "pass", "Kit Vance"],
      ["Sam Ortiz", "Chemistry Old", "annual", "2026-02-01", "pass", "Kit Vance"],
      ["Ana Reyes", "Hematology Competency", "annual", "2026-04-01", "pass", "Kit Vance"],
    ];
    rows.forEach((vals, i) => vals.forEach((v, c) => { ws.getRow(i + 2).getCell(c + 1).value = v; }));
    const upload = Buffer.from(await wb.xlsx.writeBuffer());
    const post = async (p: string) => {
      const fd = new FormData(); fd.append("file", new Blob([upload]), "history.xlsx");
      const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${tk}` }, body: fd });
      let j: any = {}; try { j = await r.json(); } catch {}
      return { s: r.status, j };
    };
    const prev = await post(`${L}/competency/assessments/bulk-preview`);
    const samRow = (prev.j.rows || []).find((r: any) => r.parsed?.employeeName === "Sam Ortiz");
    const warn = (samRow?.issues || []).find((i: any) => i.severity === "warning" && /names no analyzers/.test(i.message));
    const robinRows = (prev.j.rows || []).filter((r: any) => r.parsed?.employeeName === "Robin Lane");
    check("P. preview warns on Sam's row (Chemistry Old names no analyzers), Robin's rows carry no such warning, no errors",
      prev.s === 200 && !!warn && prev.j.summary?.error === 0 && robinRows.every((r: any) => !(r.issues || []).some((i: any) => /names no analyzers/.test(i.message))),
      `${prev.s} ${JSON.stringify(prev.j.summary)} ${warn?.message || ""}`);
    const commit = await post(`${L}/competency/assessments/bulk-commit`);
    check("P2. commit imports all five rows (the warned row too)", commit.s === 200 && commit.j.imported === 5, `${commit.s} ${commit.j.imported} ${commit.j.error || ""}`);

    const view = async (staffId: number, instId: number) => {
      const v = (await call("GET", `${L}/competency/employee/${staffId}`, undefined, tk)).j;
      return (v.testSystems || []).find((t: any) => t.instrumentId === instId) || null;
    };
    // 1. Robin
    const r1 = await view(robin, HEMO);
    const last1 = r1?.lastSignoff;
    check("1a. Robin: the 2026-03-15 Annual drives the clock, shown as imported from Hematology Competency",
      last1?.milestone === "annual" && last1?.signedDate === "2026-03-15" && last1?.imported === true && last1?.importedFrom === "Hematology Competency" && last1?.signerName === "Kit Vance",
      JSON.stringify(last1));
    check("1b. Robin: next Annual due 2027-03-15, signed current, not overdue",
      r1?.nextMilestone === "annual" && r1?.nextDue?.targetDate === "2027-03-15" && r1?.signedCurrent === true && r1?.overdue === false,
      JSON.stringify({ next: r1?.nextMilestone, due: r1?.nextDue, cur: r1?.signedCurrent, over: r1?.overdue }));
    check("1c. Robin: the 2015 Initial is kept as earlier history and the failed 2024 Annual never counts",
      (r1?.signoffs || []).length === 2 && r1.signoffs[1].milestone === "initial" && r1.signoffs[1].signedDate === "2015-04-01"
        && !(r1.signoffs || []).some((s: any) => s.signedDate === "2024-03-12"),
      JSON.stringify((r1?.signoffs || []).map((s: any) => `${s.milestone} ${s.signedDate}`)));

    // 2. the shared clock and VeritaStaff agree
    const clocks = loadLabMethodClocks(sqlite, labId, new Date().toISOString().slice(0, 10));
    const rc = (clocks.get(robin) || []).find((m) => m.methodId === HEMO);
    const roster = (await fetch(`${base}${L}/staff/employees`, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json())) as any[];
    const st = roster.find((e) => e.id === robin)?.competencyStatus;
    check("2. shared clock: Robin's Hemo Counter is signed, next Annual 2027-03-15; VeritaStaff shows Robin cleared",
      rc?.signed === true && rc?.clock.nextMilestone === "annual" && rc?.clock.nextDue?.targetDate === "2027-03-15" && rc?.clock.overdue === false && st?.cleared === true,
      JSON.stringify({ rc: rc && { signed: rc.signed, next: rc.clock.nextMilestone, due: rc.clock.nextDue }, st }));

    // 3. Sam: a program that names no analyzers counts nothing
    const s3 = await view(sam, CHEM);
    const sc = (clocks.get(sam) || []).find((m) => m.methodId === CHEM);
    check("3. Sam (Chemistry Old names no analyzers): still the Initial due, no sign-off, in the view and the shared clock",
      (s3?.signoffs || []).length === 0 && s3?.nextMilestone === "initial" && s3?.signedCurrent === false && sc?.signed === false && sc?.clock.nextMilestone === "initial",
      JSON.stringify({ n: s3?.signoffs?.length, next: s3?.nextMilestone, sc: sc && { signed: sc.signed, next: sc.clock.nextMilestone } }));

    // 4. Ana: her live sign-off wins over the imported Annual
    const a4 = await view(ana, HEMO);
    const ac = (clocks.get(ana) || []).find((m) => m.methodId === HEMO);
    check("4. Ana: the live 2026-10-20 Initial wins over the imported 2026-04-01 Annual (next is the 6-month), view and shared clock",
      a4?.lastSignoff?.milestone === "initial" && a4?.lastSignoff?.signedDate === "2026-10-20" && !a4?.lastSignoff?.imported && (a4?.signoffs || []).length === 1
        && a4?.nextMilestone === "six_month" && ac?.clock.nextMilestone === "six_month",
      JSON.stringify({ last: a4?.lastSignoff && `${a4.lastSignoff.milestone} ${a4.lastSignoff.signedDate}`, next: a4?.nextMilestone, ac: ac?.clock.nextMilestone }));

    // 5. a program-form record (locked, pass) in a named technical program counts the same way
    const coleComp = Number(((await call("GET", `${L}/competency/programs/${coagP}/eligible-employees`, undefined, tk)).j.employees || []).find((e: any) => e.staff_employee_id === cole)?.id);
    sqlite.prepare(`INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials,
      competency_type, status, remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at, locked, completion_date)
      VALUES (?, ?, 'annual', '2026-06-10', 'Kit Vance', 'Technical Consultant', 'KV', 'technical', 'pass', '', 1, 1, ?, 1, '2026-06-10T15:30:00.000Z')`).run(coagP, coleComp, now);
    const c5 = await view(cole, COAG);
    check("5. Cole: a signed program-form Annual (2026-06-10) counts as imported history; next Annual 2027-06-10",
      c5?.lastSignoff?.imported === true && c5?.lastSignoff?.signedDate === "2026-06-10" && c5?.nextMilestone === "annual" && c5?.nextDue?.targetDate === "2027-06-10",
      JSON.stringify({ last: c5?.lastSignoff, next: c5?.nextMilestone, due: c5?.nextDue }));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
