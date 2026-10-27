// tests/integration/staff-clearance-sync.test.ts
//
// Receipt for Michael Q19 = 1 (2026-10-27). Production had 150 testing staff reading "Not cleared": 4 with a passed
// initial signed in VeritaComp that never reached VeritaStaff, and 145 loaded rosters with no marking. Boots the REAL
// routes on a scratch DB with made-up people and proves:
//   1. a passed INITIAL per-method sign-off in VeritaComp clears a new hire in VeritaStaff (initial date, signer,
//      6-month due), written to the audit log
//   2. it leaves Existing staff alone (no first-year clock) and leaves a person with other dates entered alone
//   3. POST /api/admin/competency/sync-clearance: the dry run lists a person whose signed initial never reached
//      VeritaStaff and writes nothing; the real run clears them; a second run reports already cleared; an initial dated
//      before the hire date clears no one (before_hire), and with initials on both sides of the hire date the earliest
//      one after hire is used (Michael Q26 = 1)
//   4. POST /api/labs/:labId/staff/competency/recorded-as marks only unmarked people (a lab's New hire marking is kept;
//      another lab's person is not touched); the marked person reads cleared as existing staff
//   5. the roster import: the template carries the optional "Recorded as" column; uploading Existing staff / New hire /
//      an unknown value sets the first two and warns on the third; an older template without the column still uploads
// Run (from bash): DB_PATH=.tmp-csync.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/staff-clearance-sync.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
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
  const stamp = Date.now();
  const mkLab = async (tag: string, clia: string) => {
    const email = `csync-${tag}-${stamp}@example.com`;
    const tk = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `CSync ${tag}`, hipaa_acknowledged: true })).j.token as string;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `CSync ${tag}`, plan: "hospital" })).j.labId as number;
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: `CSync ${tag}`, cliaNumber: clia, accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
    return { tk, labId, L };
  };
  const A = await mkLab("a", "11D7654381"), B = await mkLab("b", "11D7654382");
  const { tk, L } = A;
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
    { name: "Mini i-Sed", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
  ] });
  const SED = (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Mini i-Sed' AND map_id = ?").get(mapId) as any).id;
  const now = new Date().toISOString(); const today = now.slice(0, 10);
  const mkEmp = async (lab: typeof A, last: string, first: string, hire: string, assign = true) => {
    const e = (await call("POST", `${lab.L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: hire }, lab.tk)).j;
    if (assign) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(e.id, SED, now);
    return e.id as number;
  };
  const newHire = await mkEmp(A, "Hire", "Nina", "2026-09-01");
  const existing = await mkEmp(A, "Long", "Evan", "2012-01-01");
  const dated = await mkEmp(A, "Dated", "Dana", "2015-01-01");
  const tc = (await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, tk)).j.id;
  await call("PUT", `${L}/staff/competency/${existing}`, { recordedAs: "existing" }, tk);
  await call("PUT", `${L}/staff/competency/${dated}`, { lastAnnualCompletedAt: "2026-02-01", lastAnnualSignedBy: "Lab Entered" }, tk);
  const sched = (id: number) => sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(id) as any;
  const els = [
    { num: 1, specimenId: "S-100", observerInitials: "CT", passed: true },
    { num: 2, evidence: "LIS result review", date: today, passed: true },
    { num: 3, qcDate: today, passed: true },
    { num: 4, dateObserved: today, observerInitials: "CT", passed: true },
    { num: 5, sampleType: "PT", sampleId: "PT-1", acceptable: true, passed: true },
    { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
  ];
  const signInitial = async (emp: number) => {
    const put = await call("PUT", `${L}/competency/employee/${emp}/test-system/${SED}`, { elements: els }, tk);
    const sign = await call("POST", `${L}/competency/employee/${emp}/test-system/${SED}/sign`, { signerStaffEmployeeId: tc, signerInitials: "CT", milestone: "initial" }, tk);
    return { put: put.s, sign: sign.s, err: sign.j.error };
  };
  check("fixture: lab, moderate i-Sed, three people, a TC signer", !!SED && !!newHire && !!existing && !!dated && !!tc);

  const s1 = await signInitial(newHire);
  const nh = sched(newHire);
  const audit1 = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'competency_schedule' AND entity_id = ? AND entity_label LIKE '%initial from VeritaComp sign-off%'").get(String(newHire)) as any).n;
  check("1. a passed initial sign-off clears the new hire in VeritaStaff (date, signer, 6-month due), audit-logged",
    s1.sign === 200 && nh?.initial_completed_at === today && /Tate/.test(nh?.initial_signed_by || "") && !!nh?.six_month_due_at && audit1 === 1,
    JSON.stringify({ s1, initial: nh?.initial_completed_at, by: nh?.initial_signed_by, six: nh?.six_month_due_at, audit1 }));

  const s2a = await signInitial(existing); const ex = sched(existing);
  const s2b = await signInitial(dated); const dt = sched(dated);
  check("2. existing staff and a person with other dates entered are left alone", s2a.sign === 200 && s2b.sign === 200 && !ex.initial_completed_at && !ex.six_month_due_at && !dt.initial_completed_at && dt.last_annual_completed_at === "2026-02-01",
    JSON.stringify({ s2a, s2b, ex: ex.initial_completed_at, dt: dt.initial_completed_at }));

  // A person whose signed initial predates the hook: a locked, passed initial on a VeritaComp record, nothing in VeritaStaff.
  const old = await mkEmp(A, "Before", "Bea", "2026-05-01", false);
  const prog = (await call("POST", `${L}/competency/programs`, { name: "Hematology", type: "technical" }, tk)).j.id;
  const ce = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, staff_employee_id, name, title, status, created_at) VALUES (1, ?, ?, 'Bea Before', '', 'active', ?)").run(A.labId, old, now).lastInsertRowid);
  sqlite.prepare(`INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at, locked, completion_date)
    VALUES (?, ?, 'initial', '2026-06-20', 'R. Supervisor', '', '', 'technical', 'pass', '', 0, 0, ?, 1, '2026-06-20')`).run(prog, ce, now);
  // Michael Q26 = 1: an initial dated before the hire date is never used. Gail's only initial predates her hire (left
  // alone, reported before_hire); Hal has one before and one after his hire, and the one after wins.
  const compEmp = (staffId: number, nm: string) =>
    Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, staff_employee_id, name, title, status, created_at) VALUES (1, ?, ?, ?, '', 'active', ?)").run(A.labId, staffId, nm, now).lastInsertRowid);
  const addInitial = (c: number, date: string) =>
    sqlite.prepare(`INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at, locked, completion_date)
      VALUES (?, ?, 'initial', ?, 'R. Supervisor', '', '', 'technical', 'pass', '', 0, 0, ?, 1, ?)`).run(prog, c, date, now, date);
  const preHire = await mkEmp(A, "Prehire", "Gail", "2026-08-27", false);
  addInitial(compEmp(preHire, "Gail Prehire"), "2026-06-20");
  const bothSides = await mkEmp(A, "Both", "Hal", "2026-08-27", false);
  const halComp = compEmp(bothSides, "Hal Both");
  addInitial(halComp, "2026-06-20");
  addInitial(halComp, "2026-09-15");
  const dry = await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [A.labId] });
  const dryRow = (dry.j.results || []).find((r: any) => r.staffEmployeeId === old);
  check("3a. backfill dry run lists the person and writes nothing", dry.s === 200 && dry.j.dryRun === true && dryRow?.outcome === "cleared" && dryRow?.initialDate === "2026-06-20" && !sched(old)?.initial_completed_at,
    JSON.stringify({ s: dry.s, dryRow, counts: { c: dry.j.wouldClearOrCleared, a: dry.j.alreadyCleared } }));
  const run = await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [A.labId], dryRun: false });
  const again = await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [A.labId], dryRun: false });
  check("3b. real run clears them; a second run reports already cleared",
    run.s === 200 && sched(old)?.initial_completed_at === "2026-06-20" && (again.j.results || []).find((r: any) => r.staffEmployeeId === old)?.outcome === "already_cleared",
    JSON.stringify({ after: sched(old)?.initial_completed_at, again: (again.j.results || []).find((r: any) => r.staffEmployeeId === old)?.outcome }));
  const rowOf = (res: any, id: number) => (res.j.results || []).find((r: any) => r.staffEmployeeId === id);
  check("3c. an initial dated before the hire date clears no one: dry run and real run report before_hire, VeritaStaff stays empty",
    rowOf(dry, preHire)?.outcome === "before_hire" && rowOf(run, preHire)?.outcome === "before_hire" && run.j.beforeHire >= 1 && !sched(preHire)?.initial_completed_at,
    JSON.stringify({ dry: rowOf(dry, preHire), run: rowOf(run, preHire), beforeHire: run.j.beforeHire, sched: sched(preHire)?.initial_completed_at ?? null }));
  check("3d. with initials on both sides of the hire date, the earliest one after hire is used",
    rowOf(run, bothSides)?.outcome === "cleared" && sched(bothSides)?.initial_completed_at === "2026-09-15",
    JSON.stringify({ run: rowOf(run, bothSides), sched: sched(bothSides)?.initial_completed_at ?? null }));

  const unmarked1 = await mkEmp(A, "Roster", "Rae", "2010-01-01", false);
  const unmarked2 = await mkEmp(A, "Roster", "Ray", "2011-01-01", false);
  const labMarkedNew = await mkEmp(A, "Roster", "Rio", "2026-10-01", false);
  await call("PUT", `${L}/staff/competency/${labMarkedNew}`, { recordedAs: "new_hire" }, tk);
  const otherLab = await mkEmp(B, "Other", "Oz", "2010-01-01", false);
  const bulk = await call("POST", `${L}/staff/competency/recorded-as`, { employeeIds: [unmarked1, unmarked2, labMarkedNew, otherLab], recordedAs: "existing" }, tk);
  const roster = (await fetch(`${base}${L}/staff/employees`, { headers: { Authorization: `Bearer ${tk}` } }).then((r) => r.json())) as any[];
  const st = (id: number) => roster.find((e) => e.id === id)?.competencyStatus;
  check("4a. bulk marking changes only the unmarked people; the lab's New hire is kept; another lab's person is not found",
    bulk.s === 200 && bulk.j.changed === 2 && bulk.j.kept === 1 && bulk.j.notFound === 1 && sched(labMarkedNew).recorded_as === "new_hire" && !sched(otherLab)?.recorded_as,
    JSON.stringify(bulk.j));
  check("4b. a marked person reads cleared as existing staff", st(unmarked1)?.cleared === true && /Existing staff/.test(st(unmarked1)?.label || ""), JSON.stringify(st(unmarked1)));
  const bad = await call("POST", `${L}/staff/competency/recorded-as`, { employeeIds: [unmarked1], recordedAs: "maybe" }, tk);
  check("4c. an unknown marking is refused (400)", bad.s === 400, String(bad.s));

  const tpl = await fetch(`${base}${L}/staff/employees/template`, { headers: { Authorization: `Bearer ${tk}` } });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()) as any);
  const ros = wb.getWorksheet("Roster")!;
  const hdr20 = String(ros.getRow(1).getCell(20).value || "");
  const rowVals = (last: string, first: string, rec: string) => [null, last, first, "", "MLT(ASCP)", "2015-04-01", "", "M", "Yes", "", "", "", "", "", "Yes", "", "", "No", "No", rec];
  [rowVals("Import", "Ivy", "Existing staff"), rowVals("Import", "Ian", "New hire"), rowVals("Import", "Ike", "sometimes")]
    .forEach((vals, i) => vals.forEach((v, c) => { ros.getRow(i + 2).getCell(c + 1).value = v as any; }));
  for (let r = 5; r <= ros.rowCount; r++) ros.getRow(r).values = [];
  const upload = async (buf: Buffer, path: string) => {
    const fd = new FormData(); fd.append("file", new Blob([buf]), "roster.xlsx");
    const r = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${tk}` }, body: fd });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const prev = await upload(buf, `${L}/staff/employees/bulk-preview`);
  const warn = (prev.j.rows || []).find((r: any) => r.parsed?.firstName === "Ike")?.issues?.some((i: any) => /Recorded as/.test(i.message));
  const com = await upload(buf, `${L}/staff/employees/bulk-commit`);
  const idOf = (first: string) => (sqlite.prepare("SELECT id FROM staff_employees WHERE last_name = 'Import' AND first_name = ? AND tier2_lab_id = ?").get(first, A.labId) as any)?.id;
  check("5a. the template carries the optional Recorded as column, and an unknown value is a warning",
    /Recorded as/.test(hdr20) && prev.s === 200 && !!warn, JSON.stringify({ hdr20, s: prev.s, warn }));
  check("5b. import sets Existing staff and New hire; the unknown value is left blank",
    com.s === 200 && sched(idOf("Ivy"))?.recorded_as === "existing" && sched(idOf("Ian"))?.recorded_as === "new_hire" && !sched(idOf("Ike"))?.recorded_as,
    JSON.stringify({ s: com.s, ivy: sched(idOf("Ivy"))?.recorded_as, ian: sched(idOf("Ian"))?.recorded_as, ike: sched(idOf("Ike"))?.recorded_as, err: com.j.error }));
  // An older template: the same file with column 20 removed entirely.
  ros.spliceColumns(20, 1);
  ros.getRow(2).getCell(3).value = "Ola"; ros.getRow(3).getCell(3).value = "Oli"; ros.getRow(4).getCell(3).value = "Oni";
  const oldPrev = await upload(Buffer.from(await wb.xlsx.writeBuffer()), `${L}/staff/employees/bulk-preview`);
  check("5c. an older template without the column still uploads", oldPrev.s === 200 && !oldPrev.j.fatal && (oldPrev.j.rows || []).length === 3, JSON.stringify({ s: oldPrev.s, fatal: oldPrev.j.fatal }));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
