// tests/integration/competency-import-existing-staff.test.ts
//
// Receipt for Michael Q12 = 1 (2026-10-27). Staff moved over from another system arrive with competencies from
// their old method. The historical import (VeritaComp Bulk Import) loaded those records but left each person's
// VeritaStaff schedule empty, so they read "Not cleared for patient testing" and then Overdue 90 days after being
// added. Boots the REAL routes on a scratch DB with made-up people and proves:
//   P. the preview reports what will happen to each person and writes nothing
//   C. the commit imports the rows and returns the same outcome summary
//   1. Ava (two passed annuals, an old initial): Existing staff, Most recent annual = the latest, annual due a year
//      later, cleared, not overdue; one competency_employees row even though she has three rows (duplicate fix)
//   2. Ben (orientation only): unchanged, not cleared
//   3. Cal (the lab marked New hire): left as the lab set it
//   4. Dee (lab already entered a last annual, no marking): marked Existing staff, her date kept (not overwritten)
//   5. Eve (first year, passed initial): initial recorded, 6-month due at initial + 6, cleared
//   6. Fay (only a failed annual): unchanged, not cleared
//   7. each changed schedule is audit-logged as coming from the historical import
//   8. the roster payload the VeritaStaff pages read shows the new clearance
//   9. a person on another lab is never touched (lab guard)
//  10. GET /api/admin/competency/not-cleared-audit: refuses without the admin header; before the import lab A has 6
//      people not cleared, after it 3 (Ben, Cal, Fay); only Cal (marked New hire by the lab, with a passed annual in
//      the file) shows a passed competency on file, the conflict the lab should look at; it writes nothing
// Run (from bash): DB_PATH=.tmp-cimport.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-import-existing-staff.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { applyImportedSchedules } = await import("../../server/competencyImportSchedule");
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
  const mkLab = async (tag: string) => {
    const email = `cimp-${tag}-${stamp}@example.com`;
    const token = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Import ${tag}`, hipaa_acknowledged: true })).j.token as string;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Import Lab ${tag}`, plan: "hospital" })).j.labId as number;
    sqlite.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: `Import Lab ${tag}`, cliaNumber: tag === "a" ? "11D7000001" : "11D7000002", accreditationBody: "TJC", complexity: "high" }, token);
    return { token, labId, L };
  };
  const A = await mkLab("a"), B = await mkLab("b");
  const mkEmp = async (lab: typeof A, first: string, hireDate: string) =>
    (await call("POST", `${lab.L}/staff/employees`, { lastName: "Mover", firstName: first, highestComplexity: "high", performsTesting: true, hireDate }, lab.token)).j;
  const ava = await mkEmp(A, "Ava", "2010-03-01"), ben = await mkEmp(A, "Ben", "2026-10-01"), cal = await mkEmp(A, "Cal", "2026-09-15");
  const dee = await mkEmp(A, "Dee", "2015-01-01"), eve = await mkEmp(A, "Eve", "2026-04-01"), fay = await mkEmp(A, "Fay", "2019-05-05");
  const other = await mkEmp(B, "Oto", "2011-01-01");
  const prog = await call("POST", `${A.L}/competency/programs`, { name: "Chemistry Analyzers", type: "technical" }, A.token);
  // The lab's own entries before the import: Cal is marked New hire; Dee has a last annual but no marking.
  const calPut = await call("PUT", `${A.L}/staff/competency/${cal.id}`, { recordedAs: "new_hire", trainingCompletedAt: "2026-09-20" }, A.token);
  const deePut = await call("PUT", `${A.L}/staff/competency/${dee.id}`, { lastAnnualCompletedAt: "2026-02-01", lastAnnualSignedBy: "Lab Entered" }, A.token);
  check("fixture: two labs, six people, a program, the lab's own entries for Cal and Dee",
    [ava, ben, cal, dee, eve, fay, other].every((e) => e?.id) && prog.s === 200 && calPut.s === 200 && deePut.s === 200,
    JSON.stringify({ prog: prog.s, cal: calPut.s, dee: deePut.s }));
  const sched = (id: number) => sqlite.prepare("SELECT * FROM staff_competency_schedules WHERE employee_id = ?").get(id) as any;
  const deeBefore = sched(dee.id);
  const audit = async () => {
    const r = await fetch(`${base}/api/admin/competency/not-cleared-audit`, { headers: { "x-admin-secret": ADMIN } });
    const j: any = await r.json();
    return { s: r.status, j, a: (j.labs || []).find((l: any) => l.labId === A.labId) };
  };
  const schedCount = () => (sqlite.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(COALESCE(recorded_as,'')) + LENGTH(COALESCE(last_annual_completed_at,''))), 0) AS sig FROM staff_competency_schedules").get() as any);
  const noHeader = await fetch(`${base}/api/admin/competency/not-cleared-audit`);
  const sigBefore = JSON.stringify(schedCount());
  const auditBefore = await audit();
  const sigAfterAudit = JSON.stringify(schedCount());

  // Fill the template's Assessments sheet.
  const tpl = await fetch(`${base}${A.L}/competency/assessments/bulk-template`, { headers: { Authorization: `Bearer ${A.token}` } });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()) as any);
  const ws = wb.getWorksheet("Assessments")!;
  const rows: string[][] = [
    ["Ava Mover", "Chemistry Analyzers", "annual", "2024-06-01", "pass", "Old Eval"],
    ["Ava Mover", "Chemistry Analyzers", "annual", "2026-03-15", "pass", "New Eval"],
    ["Ava Mover", "Chemistry Analyzers", "initial", "2010-04-01", "pass", "First Eval"],
    ["Ben Mover", "Chemistry Analyzers", "orientation", "2026-10-05", "pass", "Trainer"],
    ["Cal Mover", "Chemistry Analyzers", "annual", "2025-08-01", "pass", "Eval"],
    ["Dee Mover", "Chemistry Analyzers", "annual", "2025-12-01", "pass", "Eval"],
    ["Eve Mover", "Chemistry Analyzers", "initial", "2026-05-01", "pass", "Init Eval"],
    ["Fay Mover", "Chemistry Analyzers", "annual", "2026-01-10", "fail", "Eval"],
  ];
  rows.forEach((vals, i) => vals.forEach((v, c) => { ws.getRow(i + 2).getCell(c + 1).value = v; }));
  const upload = Buffer.from(await wb.xlsx.writeBuffer());
  const post = async (path: string) => {
    const fd = new FormData(); fd.append("file", new Blob([upload]), "history.xlsx");
    const r = await fetch(base + path, { method: "POST", headers: { Authorization: `Bearer ${A.token}` }, body: fd });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };

  const prev = await post(`${A.L}/competency/assessments/bulk-preview`);
  const ps = prev.j.schedules || {};
  check("P. preview: 3 cleared (Ava, Dee, Eve), 1 left New hire (Cal), 2 with no passed competency (Ben, Fay); nothing written",
    prev.s === 200 && prev.j.summary?.error === 0 && ps.cleared === 3 && ps.leftNewHire === 1 && ps.noPassedCompetency === 2 && ps.alreadyCleared === 0
      && !sched(ava.id)?.last_annual_completed_at && !sched(eve.id)?.initial_completed_at,
    JSON.stringify({ s: prev.s, summary: prev.j.summary, ps: { ...ps, people: undefined } }));

  const commit = await post(`${A.L}/competency/assessments/bulk-commit`);
  const cs = commit.j.schedules || {};
  check("C. commit: 8 rows imported, same outcome summary", commit.s === 200 && commit.j.imported === 8 && cs.cleared === 3 && cs.leftNewHire === 1 && cs.noPassedCompetency === 2,
    JSON.stringify({ s: commit.s, imported: commit.j.imported, cs: { ...cs, people: undefined }, err: commit.j.error }));

  const roster = (await fetch(`${base}${A.L}/staff/employees`, { headers: { Authorization: `Bearer ${A.token}` } }).then((r) => r.json())) as any[];
  const st = (id: number) => roster.find((e) => e.id === id)?.competencyStatus;
  const sAva = sched(ava.id);
  const avaComp = (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_employees WHERE staff_employee_id = ?").get(ava.id) as any).n;
  check("1a. Ava: Existing staff, Most recent annual 2026-03-15 (New Eval), annual due 2027-03-15, initial/6-month left blank",
    sAva?.recorded_as === "existing" && sAva.last_annual_completed_at === "2026-03-15" && sAva.last_annual_signed_by === "New Eval" && sAva.annual_due_at === "2027-03-15" && !sAva.initial_completed_at && !sAva.six_month_due_at,
    JSON.stringify(sAva));
  check("1b. Ava: cleared for patient testing and not overdue", st(ava.id)?.cleared === true && st(ava.id)?.bucket !== "overdue", JSON.stringify(st(ava.id)));
  check("1c. Ava: one competency_employees row for her three import rows (duplicate stub fix)", avaComp === 1, `rows=${avaComp}`);
  check("2. Ben (orientation only): no completion date, not cleared", !sched(ben.id)?.initial_completed_at && !sched(ben.id)?.recorded_as && st(ben.id)?.cleared === false, JSON.stringify(st(ben.id)));
  const sCal = sched(cal.id);
  check("3. Cal (lab marked New hire): left as the lab set it, not cleared", sCal?.recorded_as === "new_hire" && !sCal.last_annual_completed_at && st(cal.id)?.cleared === false, JSON.stringify(sCal));
  const sDee = sched(dee.id);
  check("4. Dee: marked Existing staff; her lab-entered annual (2026-02-01) kept, not overwritten by the import's 2025-12-01",
    deeBefore?.recorded_as == null && sDee?.recorded_as === "existing" && sDee.last_annual_completed_at === "2026-02-01" && sDee.last_annual_signed_by === "Lab Entered" && sDee.annual_due_at === deeBefore.annual_due_at && st(dee.id)?.cleared === true,
    JSON.stringify({ before: deeBefore?.recorded_as, after: sDee?.recorded_as, last: sDee?.last_annual_completed_at }));
  const sEve = sched(eve.id);
  check("5. Eve (first year): initial 2026-05-01, 6-month due 2026-11-01, marking unchanged, cleared",
    sEve?.initial_completed_at === "2026-05-01" && sEve.initial_signed_by === "Init Eval" && sEve.six_month_due_at === "2026-11-01" && sEve.recorded_as == null && st(eve.id)?.cleared === true,
    JSON.stringify(sEve));
  check("6. Fay (only a failed annual): unchanged, not cleared", !sched(fay.id)?.last_annual_completed_at && st(fay.id)?.cleared === false, JSON.stringify(st(fay.id)));
  const audits = sqlite.prepare("SELECT entity_id, entity_label FROM audit_log WHERE entity_type = 'competency_schedule' AND entity_label LIKE '%(from historical import)'").all() as any[];
  const auditIds = audits.map((a) => Number(a.entity_id)).sort((x, y) => x - y);
  check("7. audit log: one schedule entry each for Ava, Dee and Eve, marked as from the historical import",
    JSON.stringify(auditIds) === JSON.stringify([ava.id, dee.id, eve.id].sort((x, y) => x - y)), JSON.stringify(audits));
  check("8. roster payload: Ava reads 'Existing staff', Eve reads cleared on her initial",
    /Existing staff/.test(st(ava.id)?.label || "") && /Cleared 2026-05-01/.test(st(eve.id)?.label || ""), `${st(ava.id)?.label} | ${st(eve.id)?.label}`);

  const auditAfter = await audit();
  const afterNames = (auditAfter.a?.people || []).map((p: any) => p.name).sort();
  check("10a. not-cleared audit refuses without the admin header", noHeader.status === 403, String(noHeader.status));
  check("10b. audit before the import: lab A has 6 testing staff, all 6 not cleared; it wrote nothing",
    auditBefore.s === 200 && auditBefore.a?.testingStaff === 6 && auditBefore.a?.notCleared === 6 && sigAfterAudit === sigBefore,
    JSON.stringify({ s: auditBefore.s, testing: auditBefore.a?.testingStaff, nc: auditBefore.a?.notCleared }));
  const onFile = Object.fromEntries((auditAfter.a?.people || []).map((p: any) => [p.name, p.passedOnFile]));
  check("10c. audit after the import: 3 not cleared (Ben, Cal, Fay); only Cal (lab-marked New hire) has a passed competency on file",
    auditAfter.a?.notCleared === 3 && JSON.stringify(afterNames) === JSON.stringify(["Ben Mover", "Cal Mover", "Fay Mover"])
      && onFile["Ben Mover"] === 0 && onFile["Cal Mover"] === 1 && onFile["Fay Mover"] === 0,
    JSON.stringify(auditAfter.a?.people));

  const otherBefore = JSON.stringify(sched(other.id));
  const guard = applyImportedSchedules(sqlite, new Map([[other.id, [{ assessmentType: "annual", assessmentDate: "2026-01-01", status: "pass", evaluatorName: "X" }]]]), { dryRun: false, labId: A.labId });
  check("9. lab guard: a person on another lab is skipped and their schedule is untouched", guard.length === 0 && JSON.stringify(sched(other.id)) === otherBefore, JSON.stringify(guard));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
