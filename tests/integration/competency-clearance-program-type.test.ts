// tests/integration/competency-clearance-program-type.test.ts
//
// A non-technical record must not clear anyone for patient testing. A scratch run on 2026-11-06 loaded one passed Annual into a non-technical program through Bulk
// Import, and VeritaStaff moved from "Not cleared" to "Existing staff: testing before these records" with a technical annual due. Boots the REAL routes on a scratch
// database with made-up people and walks every door of that shape, plus the stored competency_type that sent older rows down the wrong branch:
//   1. Bulk Import, preview and commit, technical and waived still clear, mixed files use only the testing rows
//   2. whole-record Sign & Complete, lab-scoped and older route
//   3. the admin backfill POST /api/admin/competency/sync-clearance
//   4. GET /api/admin/competency/not-cleared-audit
//   5. duty-change events
//   6. what a new row stores, on every route that writes one
//   7. older rows holding the wrong type: the PDF, unlocking and signing again, and the Staff views
//   8. what's already on file stays as it is, and scripts/count-nontechnical-clearance.sql counts it
//   9. technical dates, pinned
// Run: npm run test:competency-clearance-program-type
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { buildCompetencyHTML } = await import("../../server/pdfReport");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `ccp-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const OWNER = await register("owner"), STAFF = await register("staff");
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Clearance Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Clearance Lab", cliaNumber: "11D7654371", accreditationBody: "CLIA_ONLY", complexity: "high" }, OWNER.token);
    const staff = async (first: string, last: string, complexity = "H", hire = "2019-03-01") => Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: complexity, performsTesting: true, hireDate: hire }, OWNER.token)).j.id);
    const program = async (name: string, type: string, extra: Record<string, unknown> = {}) => Number((await call("POST", `${L}/competency/programs`, { name, department: "Core", type, ...(type === "nontechnical" ? { checklistItems: [{ description: "Made-up item" }] } : {}), ...extra }, OWNER.token)).j.id);
    const NT = await program("Made-up Safety", "nontechnical"), EVAL = await program("Made-up Evaluation", "nontechnical", { recordKind: "evaluation" });
    const TECH = await program("Made-up Chemistry", "technical", { methodGroups: [{ name: "Made-up Group", instruments: ["Made-up Analyzer"], analytes: [] }] });
    const WAIVED = await program("Made-up Meter", "waived");
    const mgId = Number((sqlite.prepare("SELECT id FROM competency_method_groups WHERE program_id = ?").get(TECH) as any).id);
    const compOf = (staffId: number, name: string) => Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(staffId, labId) as any)?.id
      ?? sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, ?, 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(OWNER.id, labId, name, staffId, now).lastInsertRowid);
    // A record written the way it was before this fix: 'technical' stored whatever the program is.
    let oldStyleWrong = 0;
    const oldRow = (programId: number, employeeId: number, opts: { type?: string; date?: string; status?: string; locked?: number } = {}) => {
      const programType = (sqlite.prepare("SELECT type FROM competency_programs WHERE id = ?").get(programId) as any).type;
      if (programType !== "technical") oldStyleWrong++;
      const date = opts.date ?? "2026-10-28";
      return Number(sqlite.prepare(
        "INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, locked, completion_date, competency_type, created_at) VALUES (?, ?, ?, ?, 'Made Up Evaluator', ?, ?, ?, 'technical', ?)"
      ).run(programId, employeeId, opts.type ?? "annual", date, opts.status ?? "pass", opts.locked ?? 1, (opts.locked ?? 1) ? date : null, now).lastInsertRowid);
    };
    const sched = (id: number) => (sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(id) as any) ?? null;
    // A schedule row exists from the day a person is added; what matters is that nothing is on it.
    const nothingOn = (id: number) => { const s = sched(id); return !s || !(s.recorded_as || s.initial_completed_at || s.six_month_completed_at || s.first_annual_completed_at || s.last_annual_completed_at || s.six_month_due_at || s.first_annual_due_at || s.annual_due_at); };
    const audits = (id: number) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'competency_schedule' AND entity_id = ?").get(String(id)) as any).n);
    const statusOf = async (id: number) => {
      const list = (await call("GET", `${L}/staff/employees`, undefined, OWNER.token)).j as any[];
      return list.find((e) => e.id === id)?.competencyStatus;
    };

    // ── 1. Bulk Import ───────────────────────────────────────────────────────
    const uploadBulk = async (rows: string[][]) => {
      const tpl = await fetch(`${base}${L}/competency/assessments/bulk-template`, { headers: { Authorization: `Bearer ${OWNER.token}` } });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()) as any);
      const ws = wb.getWorksheet("Assessments")!;
      rows.forEach((vals, i) => vals.forEach((v, c) => { ws.getRow(i + 2).getCell(c + 1).value = v; }));
      const upload = Buffer.from(await wb.xlsx.writeBuffer());
      const post = async (path: string) => {
        const fd = new FormData(); fd.append("file", new Blob([upload]), "history.xlsx");
        const r = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${OWNER.token}` }, body: fd });
        let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
        return { s: r.status, j };
      };
      return { preview: await post(`${L}/competency/assessments/bulk-preview`), commit: await post(`${L}/competency/assessments/bulk-commit`) };
    };
    const nora = await staff("Nora", "Annual"), nell = await staff("Nell", "Initial", "H", "2026-09-01"), neil = await staff("Neil", "Sixmonth"), nia = await staff("Nia", "Reassess"), ned = await staff("Ned", "Dutychange"), eve = await staff("Eve", "Evaluation");
    const tom = await staff("Tom", "Technical"), tina = await staff("Tina", "Initial", "H", "2026-01-02"), wes = await staff("Wes", "Waived", "W"), mia = await staff("Mia", "Mixed", "H", "2026-01-02"), max = await staff("Max", "Mixed"), fay = await staff("Fay", "Failed");
    const ntOnly = [nora, nell, neil, nia, ned, eve];
    const before = await statusOf(nora);
    check("0. setup: Nora starts Not cleared, with nothing in VeritaStaff", before?.cleared === false && /Not cleared/.test(before?.label) && nothingOn(nora), JSON.stringify(before));
    const bulk = await uploadBulk([
      ["Nora Annual", "Made-up Safety", "annual", "2026-10-01", "pass", "Made Up"],
      ["Nell Initial", "Made-up Safety", "initial", "2026-10-01", "pass", "Made Up"],
      ["Neil Sixmonth", "Made-up Safety", "6month", "2026-10-01", "pass", "Made Up"],
      ["Nia Reassess", "Made-up Safety", "reassessment", "2026-10-01", "pass", "Made Up"],
      ["Ned Dutychange", "Made-up Safety", "duty_change", "2026-10-01", "pass", "Made Up"],
      ["Eve Evaluation", "Made-up Evaluation", "annual", "2026-10-01", "pass", "Made Up"],
      ["Tom Technical", "Made-up Chemistry", "annual", "2026-03-15", "pass", "Made Up"],
      ["Tina Initial", "Made-up Chemistry", "initial", "2026-02-10", "pass", "Made Up"],
      ["Wes Waived", "Made-up Meter", "initial", "2026-04-20", "pass", "Made Up"],
      ["Mia Mixed", "Made-up Chemistry", "initial", "2026-01-15", "pass", "Made Up"],
      ["Mia Mixed", "Made-up Safety", "annual", "2026-06-01", "pass", "Made Up"],
      ["Max Mixed", "Made-up Chemistry", "annual", "2025-12-01", "pass", "Made Up"],
      ["Max Mixed", "Made-up Safety", "annual", "2026-06-01", "pass", "Made Up"],
      ["Fay Failed", "Made-up Chemistry", "annual", "2026-03-15", "fail", "Made Up"],
    ]);
    const ps = bulk.preview.j.schedules || {}, cs = bulk.commit.j.schedules || {};
    const previewNames = (ps.people || []).map((p: any) => p.staffEmployeeId);
    check("1a. preview: only technical and waived rows count: Tom, Tina, Wes, Mia and Max clear", bulk.preview.s === 200 && ps.cleared === 5 && ps.noPassedCompetency === 1, JSON.stringify({ ...ps, people: undefined }));
    check("1b. preview: nobody with only non-technical rows is even listed", ntOnly.every((id) => !previewNames.includes(id)), JSON.stringify(previewNames));
    check("1c. commit: every row loads, and the same five clear", bulk.commit.s === 200 && bulk.commit.j.imported === 14 && cs.cleared === 5, JSON.stringify({ s: bulk.commit.s, imported: bulk.commit.j.imported, cleared: cs.cleared, err: bulk.commit.j.error }));
    for (const [name, id] of [["annual", nora], ["initial", nell], ["6-month", neil], ["reassessment", nia], ["duty change", ned], ["a new-hire evaluation program", eve]] as const) {
      const st = await statusOf(id as number);
      check(`1d. a non-technical ${name} record: no schedule, still Not cleared, no schedule audit row`, nothingOn(id as number) && st?.cleared === false && /Not cleared/.test(st?.label) && audits(id as number) === 0, JSON.stringify({ sched: sched(id as number), st }));
    }
    const noraRecord = sqlite.prepare("SELECT a.locked, a.status, a.competency_type, a.assessment_date FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ?").get(nora) as any;
    check("1e. the non-technical record itself is on file, signed, under its own type", noraRecord?.locked === 1 && noraRecord?.status === "pass" && noraRecord?.competency_type === "nontechnical" && noraRecord?.assessment_date === "2026-10-01", JSON.stringify(noraRecord));
    const tomSt = await statusOf(tom);
    check("1f. a technical annual still clears as Existing staff, with its annual due", sched(tom)?.recorded_as === "existing" && sched(tom)?.last_annual_completed_at === "2026-03-15" && sched(tom)?.annual_due_at === "2027-03-15" && tomSt?.cleared === true && audits(tom) === 1, JSON.stringify(sched(tom)));
    check("1g. a technical initial still clears, with the 6-month due at + 6", sched(tina)?.initial_completed_at === "2026-02-10" && sched(tina)?.six_month_due_at === "2026-08-10" && (await statusOf(tina))?.cleared === true, JSON.stringify(sched(tina)));
    check("1h. a waived initial still clears, annual from the initial", sched(wes)?.initial_completed_at === "2026-04-20" && sched(wes)?.annual_due_at === "2027-04-20" && sched(wes)?.six_month_due_at === null, JSON.stringify(sched(wes)));
    check("1i. a mixed file: a later non-technical annual doesn't make someone Existing staff or set their annual", sched(mia)?.initial_completed_at === "2026-01-15" && sched(mia)?.recorded_as === null && sched(mia)?.last_annual_completed_at === null, JSON.stringify(sched(mia)));
    check("1j. a mixed file: the clock runs from the technical date, not the later non-technical one", sched(max)?.last_annual_completed_at === "2025-12-01" && sched(max)?.annual_due_at === "2026-12-01", JSON.stringify(sched(max)));
    check("1k. a failed technical row still clears nobody", nothingOn(fay), JSON.stringify(sched(fay)));
    const tplForWords = await fetch(`${base}${L}/competency/assessments/bulk-template`, { headers: { Authorization: `Bearer ${OWNER.token}` } });
    const wordsWb = new ExcelJS.Workbook(); await wordsWb.xlsx.load(Buffer.from(await tplForWords.arrayBuffer()) as any);
    let tplWords = ""; wordsWb.eachSheet((ws: any) => ws.eachRow((r: any) => r.eachCell((c: any) => { tplWords += ` ${c.value}`; })));
    check("1l. the template says so, and no longer says any passed record clears", /in a technical or waived program counts as cleared/.test(tplWords) && /record in a non-technical program is loaded onto that program and does not change the person's VeritaStaff schedule or clearance/.test(tplWords) && !/competency in the file counts as cleared/.test(tplWords), tplWords.slice(0, 200));

    // ── 2. Whole-record Sign & Complete ──────────────────────────────────────
    const techItems = () => [1, 2, 3, 4, 5, 6].map((n) => ({
      methodNumber: n, elementNumber: n, methodGroupId: mgId, methodGroupName: "Made-up Group", passed: true,
      ...(n === 1 ? { el1SpecimenId: "S" } : n === 2 ? { el2Evidence: "E", el2Date: "2026-10-15" } : n === 3 ? { el3QcDate: "2026-10-15" } : n === 4 ? { el4DateObserved: "2026-10-15" } : n === 5 ? { el5SampleId: "P" } : { el6QuizId: "Q" }),
    }));
    const newRecord = async (programId: number, employeeId: number, assessmentType = "initial", items: any[] = [], path = `${L}/competency/assessments`) => (await call("POST", path, { programId, employeeId, assessmentType, assessmentDate: "2026-10-15", evaluatorName: "Made Up Evaluator", status: "pass", items }, OWNER.token)).j.id as number;
    const paper = { signed_on_paper_date: "2026-10-15", documentation: "Made-up paper record" };
    const signLab = (id: number, body: any = {}) => call("POST", `${L}/competency/assessments/${id}/sign`, body, OWNER.token);
    const signOld = (id: number, body: any = {}) => call("POST", `/api/competency/assessments/${id}/sign`, body, OWNER.token);
    const newHire = async (first: string, last: string, complexity = "H") => { const id = await staff(first, last, complexity, "2026-09-01"); return { id, comp: compOf(id, `${first} ${last}`) }; };
    const sLabNt = await newHire("Sam", "Labnt"), sOldNt = await newHire("Sid", "Oldnt"), sLabTech = await newHire("Sue", "Labtech"), sLabWaived = await newHire("Sal", "Labwaived", "W"), sOldTech = await newHire("Sky", "Oldtech"), sOldWaived = await newHire("Syd", "Oldwaived", "W");
    const r1 = await signLab(await newRecord(NT, sLabNt.comp), paper);
    check("2a. lab-scoped: signing a non-technical Initial saves it and clears nobody", r1.s === 200 && nothingOn(sLabNt.id) && (await statusOf(sLabNt.id))?.cleared === false && audits(sLabNt.id) === 0, `${r1.s} ${r1.text.slice(0, 120)}`);
    const r2 = await signOld(await newRecord(NT, sOldNt.comp), paper);
    check("2b. older route: the same", r2.s === 200 && nothingOn(sOldNt.id) && audits(sOldNt.id) === 0, `${r2.s} ${r2.text.slice(0, 120)}`);
    const r3 = await signLab(await newRecord(TECH, sLabTech.comp, "initial", techItems()));
    check("2c. lab-scoped: a technical Initial still clears", r3.s === 200 && !!sched(sLabTech.id)?.initial_completed_at && (await statusOf(sLabTech.id))?.cleared === true && audits(sLabTech.id) === 1, `${r3.s} ${r3.text.slice(0, 160)}`);
    const r4 = await signLab(await newRecord(WAIVED, sLabWaived.comp), paper);
    check("2d. lab-scoped: a waived Initial still clears", r4.s === 200 && sched(sLabWaived.id)?.initial_completed_at === "2026-10-15", `${r4.s} ${r4.text.slice(0, 120)}`);
    const r5 = await signOld(await newRecord(TECH, sOldTech.comp), paper);
    check("2e. older route: a technical Initial still clears", r5.s === 200 && sched(sOldTech.id)?.initial_completed_at === "2026-10-15", `${r5.s} ${r5.text.slice(0, 120)}`);
    const r6 = await signOld(await newRecord(WAIVED, sOldWaived.comp), paper);
    check("2f. older route: a waived Initial still clears", r6.s === 200 && sched(sOldWaived.id)?.initial_completed_at === "2026-10-15", `${r6.s} ${r6.text.slice(0, 120)}`);

    // ── 3. The admin backfill ────────────────────────────────────────────────
    const bNt = await newHire("Bea", "Backfillnt"), bTech = await newHire("Bo", "Backfilltech"), bWaived = await newHire("Bix", "Backfillwaived", "W"), bBoth = await newHire("Bay", "Backfillboth");
    oldRow(NT, bNt.comp, { type: "initial", date: "2026-10-20" });
    oldRow(TECH, bTech.comp, { type: "initial", date: "2026-10-21" });
    oldRow(WAIVED, bWaived.comp, { type: "initial", date: "2026-10-22" });
    oldRow(NT, bBoth.comp, { type: "initial", date: "2026-09-15" }); oldRow(TECH, bBoth.comp, { type: "initial", date: "2026-10-23" });
    const dry = await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [labId] });
    const rowOf = (res: any, id: number) => (res.j.results || []).find((r: any) => r.staffEmployeeId === id);
    check("3a. dry run: a non-technical Initial isn't a candidate at all", dry.s === 200 && !rowOf(dry, bNt.id), JSON.stringify(rowOf(dry, bNt.id)));
    check("3b. dry run: technical and waived Initials still are", rowOf(dry, bTech.id)?.outcome === "cleared" && rowOf(dry, bWaived.id)?.outcome === "cleared", JSON.stringify([rowOf(dry, bTech.id), rowOf(dry, bWaived.id)]));
    check("3c. with both, the technical date is used even though the non-technical one is earlier", rowOf(dry, bBoth.id)?.initialDate === "2026-10-23", JSON.stringify(rowOf(dry, bBoth.id)));
    const run = await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [labId], dryRun: false });
    check("3d. a real run writes the technical person and leaves the non-technical one alone", run.s === 200 && sched(bTech.id)?.initial_completed_at === "2026-10-21" && nothingOn(bNt.id), JSON.stringify(sched(bNt.id)));

    // ── 4. The not-cleared audit ─────────────────────────────────────────────
    const aNt = await newHire("Ada", "Auditnt"), aTech = await newHire("Abe", "Audittech");
    oldRow(NT, aNt.comp, { date: "2026-10-05" }); oldRow(TECH, aTech.comp, { type: "annual", date: "2026-10-05" });
    const audit = await fetch(`${base}/api/admin/competency/not-cleared-audit`, { headers: { "x-admin-secret": ADMIN } }).then((r) => r.json()) as any;
    const auditLab = (audit.labs || []).find((l: any) => l.labId === labId);
    const auditRow = (id: number) => auditLab?.people.find((p: any) => p.staffEmployeeId === id);
    check("4a. someone with only a non-technical record has no passed competency on file", auditRow(aNt.id)?.passedOnFile === 0 && auditRow(aNt.id)?.latestPassed === null, JSON.stringify(auditRow(aNt.id)));
    check("4b. someone with a technical record still does", auditRow(aTech.id)?.passedOnFile === 1 && auditRow(aTech.id)?.latestPassed?.date === "2026-10-05", JSON.stringify(auditRow(aTech.id)));

    // ── 5. Duty-change events ────────────────────────────────────────────────
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [{ name: "Made-up Analyzer", category: "Chemistry", tests: [{ analyte: "Sodium", specialty: "Routine Chemistry", complexity: "HIGH", active: 1 }] }] });
    const inst = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ?").get(mapId) as any).id);
    const event = (staffId: number) => Number(sqlite.prepare("INSERT INTO staff_duty_change_events (lab_id, employee_id, instrument_id, detected_at) VALUES (?, ?, ?, ?)").run(labId, staffId, inst, "2026-09-01").lastInsertRowid);
    const dNt = await newHire("Dot", "Dutynt"), dTech = await newHire("Dan", "Dutytech"), dWaived = await newHire("Dee", "Dutywaived", "W"), dEval = await newHire("Dov", "Dutyeval");
    const evNt = event(dNt.id), evTech = event(dTech.id), evWaived = event(dWaived.id), evEval = event(dEval.id);
    oldRow(NT, dNt.comp, { type: "duty_change", date: "2026-10-01" }); oldRow(EVAL, dEval.comp, { type: "duty_change", date: "2026-10-01" });
    const techDuty = oldRow(TECH, dTech.comp, { type: "duty_change", date: "2026-10-01" }); oldRow(WAIVED, dWaived.comp, { type: "duty_change", date: "2026-10-01" });
    const openList = await call("GET", `${L}/staff/duty-change-events`, undefined, OWNER.token);
    const stillOpen = (id: number) => (openList.j as any[]).some((e) => e.id === id);
    const evRow = (id: number) => sqlite.prepare("SELECT resolved_at, resolved_assessment_id, resolution_type FROM staff_duty_change_events WHERE id = ?").get(id) as any;
    check("5a. a non-technical Duty Change record leaves an analyzer's reevaluation open", openList.s === 200 && stillOpen(evNt) && evRow(evNt).resolved_at === null, JSON.stringify(evRow(evNt)));
    check("5b. so does one on a new-hire evaluation program", stillOpen(evEval) && evRow(evEval).resolved_at === null, JSON.stringify(evRow(evEval)));
    check("5c. a technical one still closes it", !stillOpen(evTech) && evRow(evTech).resolved_assessment_id === techDuty && evRow(evTech).resolution_type === "assessment", JSON.stringify(evRow(evTech)));
    check("5d. so does a waived one", !stillOpen(evWaived) && !!evRow(evWaived).resolved_at, JSON.stringify(evRow(evWaived)));
    const closedOld = await newHire("Dru", "Dutyold");
    const closedOldNt = oldRow(NT, closedOld.comp, { type: "duty_change", date: "2026-10-01" });
    const evClosed = event(closedOld.id);
    sqlite.prepare("UPDATE staff_duty_change_events SET resolved_at = ?, resolved_assessment_id = ?, resolution_type = 'assessment' WHERE id = ?").run("2026-10-02T00:00:00.000Z", closedOldNt, evClosed);
    await call("GET", `${L}/staff/duty-change-events`, undefined, OWNER.token);
    check("5e. an event a non-technical record already closed stays closed", evRow(evClosed).resolved_assessment_id === closedOldNt && !!evRow(evClosed).resolved_at, JSON.stringify(evRow(evClosed)));

    // ── 6. What a new row stores ─────────────────────────────────────────────
    const storedType = (id: number) => (sqlite.prepare("SELECT competency_type FROM competency_assessments WHERE id = ?").get(id) as any)?.competency_type;
    const nw = await newHire("Nat", "Newrows");
    const cohort = async (programId: number, employeeId: number, date: string) => (await call("POST", `${L}/competency/assessments/cohort-commit`, { programId, employeeIds: [employeeId], assessmentType: "annual", assessmentDate: date, status: "pass", evaluatorName: "Made Up Evaluator" }, OWNER.token));
    const cNt = await cohort(NT, nw.comp, "2026-08-01"), cW = await cohort(WAIVED, nw.comp, "2026-08-02");
    check("6a. Cohort Sign-off stores the program's type", cNt.s === 200 && storedType(cNt.j.assessmentIds[0]) === "nontechnical" && cW.s === 200 && storedType(cW.j.assessmentIds[0]) === "waived", `${cNt.text.slice(0, 120)} ${cW.text.slice(0, 120)}`);
    check("6b. Bulk Import stores the program's type, for each program in one file", (sqlite.prepare("SELECT a.competency_type AS t FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? ORDER BY a.assessment_date").all(mia) as any[]).map((r) => r.t).join() === "technical,nontechnical" && (sqlite.prepare("SELECT a.competency_type AS t FROM competency_assessments a JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ?").get(wes) as any).t === "waived");
    const post = (path: string, body: any) => call("POST", path, { employeeId: nw.comp, assessmentType: "annual", assessmentDate: "2026-08-03", evaluatorName: "Made Up", status: "pass", items: [], ...body }, OWNER.token);
    const pOmit = await post(`${L}/competency/assessments`, { programId: NT }), pLie = await post(`${L}/competency/assessments`, { programId: NT, competencyType: "technical" }), pTech = await post(`${L}/competency/assessments`, { programId: TECH, competencyType: "nontechnical" });
    check("6c. lab-scoped POST: the program decides, whatever is sent or left out", storedType(pOmit.j.id) === "nontechnical" && storedType(pLie.j.id) === "nontechnical" && storedType(pTech.j.id) === "technical", JSON.stringify([storedType(pOmit.j.id), storedType(pLie.j.id), storedType(pTech.j.id)]));
    const qOmit = await post("/api/competency/assessments", { programId: NT }), qLie = await post("/api/competency/assessments", { programId: NT, competencyType: "technical" });
    check("6d. older POST: the same", storedType(qOmit.j.id) === "nontechnical" && storedType(qLie.j.id) === "nontechnical", `${qOmit.s} ${qLie.s}`);

    // ── 7. Older rows holding the wrong type ─────────────────────────────────
    const printRow = (id: number) => sqlite.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type, p.record_kind as program_record_kind, e.name as employee_name, e.title as employee_title
         FROM competency_assessments a JOIN competency_programs p ON a.program_id = p.id JOIN competency_employees e ON a.employee_id = e.id WHERE a.id = ?`
    ).get(id);
    const html = (id: number) => buildCompetencyHTML({ assessment: printRow(id), items: [], methodGroups: [], checklistItems: [], labName: "Made-up Clearance Lab", quizResults: [], cliaNumber: "11D7654371" } as any);
    const oldPerson = await newHire("Ora", "Oldrow");
    const oldNt = oldRow(NT, oldPerson.comp, { date: "2026-07-01" }), oldW = oldRow(WAIVED, oldPerson.comp, { date: "2026-07-02" }), oldEval = oldRow(EVAL, oldPerson.comp, { type: "30day", date: "2026-07-03" }), oldT = oldRow(TECH, oldPerson.comp, { date: "2026-07-04" });
    const ntHtml = html(oldNt), wHtml = html(oldW), evalHtml = html(oldEval), tHtml = html(oldT);
    check("7a. the PDF: an older non-technical row prints as non-technical, with its checklist section and no six elements", /Non-Technical Competency Assessment/.test(ntHtml) && !/Technical Competency Assessment<\/div>/.test(ntHtml.replace(/Non-Technical Competency Assessment/g, "")) && /Non-Technical Competency Checklist/.test(ntHtml) && !/Element 1/.test(ntHtml), ntHtml.slice(0, 200));
    check("7b. the PDF: with no checklist rows it says so, the way a technical record does", />No data recorded<\/td>/.test(ntHtml) && />No data recorded<\/td>/.test(wHtml), "");
    check("7c. the PDF: an older waived row prints as waived", /Waived Testing Competency Assessment/.test(wHtml) && /2 of 4 Methods Required/.test(wHtml));
    check("7d. the PDF: an older row on a new-hire evaluation program prints as an evaluation", /New-Hire Evaluation/.test(evalHtml) && /New-Hire Evaluation Checklist/.test(evalHtml) && !/Technical Competency Assessment/.test(evalHtml));
    check("7e. the PDF: a technical row prints as it always did", /Technical Competency Assessment/.test(tHtml) && !/Non-Technical Competency Assessment/.test(tHtml) && /No data recorded/.test(tHtml));
    const blankStub = buildCompetencyHTML({ assessment: { id: 0, competency_type: "nontechnical", program_name: "Made-up Safety", department: "Core", employee_name: "", assessment_date: "", status: "pass" }, items: [], methodGroups: [], checklistItems: [{ label: "A", description: "Made-up item" }], labName: "Made-up", quizResults: [], blank: true } as any);
    check("7f. the PDF: the blank worksheet, which sends no program_type, still prints its own type", /Non-Technical Competency Assessment/.test(blankStub) && /Made-up item/.test(blankStub) && !/No data recorded/.test(blankStub));
    const blankOf = (competency_type: string) => buildCompetencyHTML({ assessment: { id: 0, competency_type, program_name: "Made-up", department: "Core", employee_name: "", assessment_date: "", status: "pass" }, items: [], methodGroups: [], checklistItems: [], labName: "Made-up", quizResults: [], blank: true } as any);
    check("7f2. the PDF: a technical and a waived blank worksheet too", /Technical Competency Assessment/.test(blankOf("technical")) && !/Non-Technical Competency Assessment/.test(blankOf("technical")) && /Waived Testing Competency Assessment/.test(blankOf("waived")));

    const reopen = oldRow(NT, oldPerson.comp, { date: "2026-07-05" });
    const unlocked = await call("POST", `${L}/competency/assessments/${reopen}/unlock`, {}, OWNER.token);
    const resigned = await signLab(reopen);
    check("7g. an older non-technical Cohort or Bulk row can be unlocked and signed again: the technical gate used to refuse it for good", unlocked.s === 200 && resigned.s === 200, `${unlocked.s} ${resigned.s} ${resigned.text.slice(0, 160)}`);
    check("7h. the stored value on that row isn't rewritten", storedType(reopen) === "technical");
    const oldTechEmpty = oldRow(TECH, oldPerson.comp, { date: "2026-07-06", locked: 0 });
    const gate = await signLab(oldTechEmpty);
    check("7i. the gate still holds for a real technical record with nothing entered", gate.s === 409 && /incomplete/.test(gate.j.error), `${gate.s} ${gate.text.slice(0, 120)}`);

    const staffPerson = await newHire("Ann", "Portal");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, STAFF.id, now, now, now);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{\"mode\":\"view_all\"}', ?, ?, 'staff_portal', ?)")
      .run(OWNER.id, STAFF.email, STAFF.id, now, now, `ccp-${stamp}`, labId, staffPerson.id);
    const portalRow = oldRow(NT, staffPerson.comp, { date: "2026-07-07", locked: 0 });
    sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, item_label, nt_item_label, nt_item_description, passed) VALUES (?, 1, 'A', 'A', 'Made-up item', 1)").run(portalRow);
    const portalQ = `employee_id=${staffPerson.id}`;
    const portalList = await call("GET", `/api/staff-portal-session/competencies?${portalQ}`, undefined, STAFF.token);
    const portalOne = await call("GET", `/api/staff-portal-session/competencies/${portalRow}?${portalQ}`, undefined, STAFF.token);
    check("7j. My sign-offs tells a Staff login it's non-technical", (portalList.j.competencies || []).find((c: any) => c.assessment_id === portalRow)?.competency_type === "nontechnical" && portalOne.j.competency_type === "nontechnical", `${portalList.s} ${portalOne.s} ${portalOne.text.slice(0, 120)}`);
    check("7j2. and offers no technical rows to fill in on it", Array.isArray(portalOne.j.items) && portalOne.j.items.length === 0, JSON.stringify(portalOne.j.items));
    const stored = sqlite.prepare("SELECT * FROM competency_assessments WHERE id = ?").get(portalRow) as any;
    const expectHash = createHash("sha256").update(JSON.stringify({ id: stored.id, program_id: stored.program_id, employee_id: stored.employee_id, assessment_type: stored.assessment_type, assessment_date: stored.assessment_date, evaluator_name: stored.evaluator_name, evaluator_title: stored.evaluator_title, competency_type: "technical", status: stored.status, remediation_plan: stored.remediation_plan }), "utf8").digest("hex");
    check("7k. the content hash still reads the stored row, so a signature already on file still matches", portalOne.j.content_hash === expectHash, `${portalOne.j.content_hash} vs ${expectHash}`);
    const portalPut = await call("PUT", `/api/staff-portal-session/competencies/${portalRow}`, { employee_id: staffPerson.id, items: [] }, STAFF.token);
    check("7l. a Staff login has no details to add to it", portalPut.s === 409 && /no details for you to add/.test(portalPut.j.error), `${portalPut.s} ${portalPut.text.slice(0, 120)}`);

    // ── 8. What's already on file stays, and the count finds it ──────────────
    const pre = async (first: string, last: string) => { const id = await staff(first, last); return { id, comp: compOf(id, `${first} ${last}`) }; };
    const label = (id: number, name: string, how: string) => sqlite.prepare("INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, created_at) VALUES (?, ?, 'veritastaff', 'create', 'competency_schedule', ?, ?, ?)").run(OWNER.id, OWNER.id, String(id), `${name} (${how})`, now);
    const fill = (id: number, cols: Record<string, string | null>) => {
      const names = Object.keys(cols);
      const done = sqlite.prepare(`UPDATE staff_competency_schedules SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE employee_id = ?`).run(...names.map((n) => cols[n]), id);
      if (done.changes !== 1) throw new Error(`no schedule row for ${id}`);
    };
    const pia = await pre("Pia", "Importonly"), sol = await pre("Sol", "Signedonly"), quinn = await pre("Quinn", "Importboth"), rae = await pre("Rae", "Labentered"), tia = await pre("Tia", "Sameday");
    oldRow(NT, tia.comp, { date: "2026-10-28" }); oldRow(TECH, tia.comp, { date: "2026-10-28" }); // the date is held by a technical record too, so her clock isn't wrong
    fill(tia.id, { recorded_as: "existing", last_annual_completed_at: "2026-10-28", annual_due_at: "2027-10-28" }); label(tia.id, "Tia Sameday", "from historical import");
    oldRow(NT, pia.comp, { date: "2026-10-28" });
    fill(pia.id, { recorded_as: "existing", last_annual_completed_at: "2026-10-28", annual_due_at: "2027-10-28" }); label(pia.id, "Pia Importonly", "from historical import");
    oldRow(NT, sol.comp, { type: "initial", date: "2026-10-29" });
    fill(sol.id, { initial_completed_at: "2026-10-29", six_month_due_at: "2027-04-29" }); label(sol.id, "Sol Signedonly", "initial from VeritaComp record");
    oldRow(NT, quinn.comp, { date: "2026-10-28" }); oldRow(TECH, quinn.comp, { date: "2025-10-28" });
    fill(quinn.id, { recorded_as: "existing", last_annual_completed_at: "2026-10-28", annual_due_at: "2027-10-28" }); label(quinn.id, "Quinn Importboth", "from historical import");
    oldRow(NT, rae.comp, { date: "2026-10-28" });
    fill(rae.id, { recorded_as: "existing", last_annual_completed_at: "2026-10-28", annual_due_at: "2027-10-28" }); // the lab's own entry: no import row in the audit log
    const held = JSON.stringify([pia, sol, quinn, rae].map((p) => sched(p.id)));
    // Everything that could move them runs again.
    await call("POST", "/api/admin/competency/sync-clearance", { secret: ADMIN, labIds: [labId], dryRun: false });
    await call("GET", `${L}/staff/duty-change-events`, undefined, OWNER.token);
    await call("GET", `${L}/competency/owed`, undefined, OWNER.token);
    await uploadBulk([["Pia Importonly", "Made-up Safety", "annual", "2026-11-01", "pass", "Made Up"]]);
    const piaSt = await statusOf(pia.id);
    check("8a. someone a non-technical import already cleared stays as they are: their status doesn't move at deploy", piaSt?.cleared === true && /Existing staff/.test(piaSt?.label), JSON.stringify(piaSt));
    check("8b. no stored schedule moved, whatever ran", JSON.stringify([pia, sol, quinn, rae].map((p) => sched(p.id))) === held, JSON.stringify(sched(pia.id)));
    // Added after the last read of the list, so they're still open: one a technical record would close on that read, and one with only a technical record.
    const both = await newHire("Dax", "Dutyboth"), techOnly = await newHire("Dio", "Dutytechonly");
    event(both.id); oldRow(NT, both.comp, { type: "duty_change", date: "2026-10-01" }); oldRow(TECH, both.comp, { type: "duty_change", date: "2026-10-01" });
    event(techOnly.id); oldRow(TECH, techOnly.comp, { type: "duty_change", date: "2026-10-01" });
    const early = await newHire("Dag", "Dutyearly");
    event(early.id); oldRow(NT, early.comp, { type: "duty_change", date: "2026-08-01" }); // dated before the event, so it never matched
    const counts = sqlite.prepare(readFileSync("scripts/count-nontechnical-clearance.sql", "utf8")).get() as any;
    check("8c. the count finds Pia and Sol as cleared on non-technical only, in one lab", counts.people_cleared_on_nontechnical_only === 2 && counts.labs_with_people_cleared_on_nontechnical_only === 1, JSON.stringify(counts));
    check("8d. the count finds Quinn, whose clock runs from a non-technical date", counts.people_with_clock_from_nontechnical_date === 1, JSON.stringify(counts));
    check("8e. the count finds the one duty-change event a non-technical record closed", counts.duty_change_events_closed_by_nontechnical === 1, JSON.stringify(counts));
    check("8f. the count finds each older row with the wrong stored type, and no new one", counts.records_with_stored_type_not_the_programs === oldStyleWrong, `${JSON.stringify(counts)} vs ${oldStyleWrong}`);
    check("8f2. the count finds the two events that now stay open, Dot's and Dov's, and not one a technical record would close or one dated before the event", counts.open_duty_change_events_nontechnical_would_have_closed === 2, JSON.stringify(counts));
    const countKeys = Object.keys(counts).sort().join();
    check("8g. the count gives numbers only: no name and no lab id", countKeys === "duty_change_events_closed_by_nontechnical,labs_with_people_cleared_on_nontechnical_only,open_duty_change_events_nontechnical_would_have_closed,people_cleared_on_nontechnical_only,people_with_clock_from_nontechnical_date,records_with_stored_type_not_the_programs" && Object.values(counts).every((v) => typeof v === "number"), countKeys);

    // ── 9. Technical dates, pinned ───────────────────────────────────────────
    check("9. 42 CFR 493.1451(b)(9) and 493.1413(b)(9) dates: initial + 6, annual + 12, and waived annual from the initial, all as before", sched(tina)?.six_month_due_at === "2026-08-10" && sched(tom)?.annual_due_at === "2027-03-15" && sched(wes)?.annual_due_at === "2027-04-20");
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
