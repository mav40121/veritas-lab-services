// tests/integration/competency-annual-month.test.ts
//
// BUG-202 and BUG-203 (Redington, 2026-11-25). The lab's annual competency month (Michael Q157 = 1) moves a repeat annual earlier, never later.
// An annual signed 11/24/2026 in a December lab read due again 12/31/2026, and on the person's own VeritaStaff record a date the month had moved
// earlier read as already done, so it showed a year late. Boots the REAL routes on a scratch DB and proves, on the real clock:
//   1. a method's annual signed a week ago, in a lab whose month ends this month or next, is due 12 months after it was signed: the person page
//      and the register's By Method sheet say so, and it isn't in the due-soon lists
//   2. an annual whose date is four months past the lab month still moves into it, with the natural date beside it
//   3. the 6-month and the first annual never move
//   4. VeritaStaff's stored annual date follows the same rule on save and when the setting changes
//   5. a stored date the month moved earlier is the date read, not a year after it (BUG-203); an early annual on a row never figured again still
//      reads next year's
//   6. the admin re-figure: refused without the header secret, reads only by default, writes the changed rows once with an audit row, and a
//      second run changes nothing
// Run: npm run test:competency-annual-month
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { addMonthsIso, addDaysIso, competencyDueColumns } = await import("../../server/competencySchedule");
  const { deriveCompetencyStatus } = await import("../../server/competencyReminders");
  const { labToday, labTimeZoneById } = await import("../../server/dateLocal");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const pw = ["Test", "pass", "123"].join("");
  const email = `cam-${Date.now()}@example.test`;
  const T = (await call("POST", "/api/auth/register", { email, password: pw, name: "Annual Owner", hipaa_acknowledged: true })).j.token;
  const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Annual Month Lab", plan: "hospital" })).j.labId);
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Annual Month Lab", cliaNumber: "11D7654322", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).j.id;
  const t = (analyte: string, specialty: string, complexity: string) => ({ analyte, specialty, complexity, active: 1 });
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
    { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] },
    { name: "Roche cobas c 311", category: "Chemistry", tests: [t("Glucose", "General Chemistry", "MODERATE")] },
  ] });
  const inst = Object.fromEntries((sqlite.prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId) as any[]).map((r) => [r.instrument_name, r.id]));
  const CHEM = inst["Beckman Coulter AU5800"], C311 = inst["Roche cobas c 311"];
  const emp = async (firstName: string, lastName: string, extra: any = {}) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, title: "MLS", performsTesting: true, highestComplexity: "M", hireDate: "2019-12-01", ...extra }, T)).j.id;
  const pat = await emp("Pat", "Alpha"), quinn = await emp("Quinn", "Beta"), lee = await emp("Lee", "Delta"), max = await emp("Max", "Early");
  const jordan = await emp("Jordan", "Rivera", { roles: [{ role: "TC", specialtyNumber: 7 }] });
  for (const e of [pat, quinn]) await call("PUT", `${L}/staff/employees/${e}/instruments`, { instrumentIds: [CHEM, C311] }, T);
  check("0. a lab, two methods, four people and a signer", [labId, CHEM, C311, pat, quinn, lee, max, jordan].every(Boolean), JSON.stringify({ T: !!T, labId, mapId, CHEM, C311, pat, jordan }));

  const today = labToday(labTimeZoneById(sqlite, labId));
  const signedOn = addDaysIso(today, -7);
  const monthOf = (iso: string) => Number(iso.slice(5, 7));
  const endOfMonth = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), monthOf(iso), 0)).toISOString().slice(0, 10);
  // The lab's month: next month, so the end of it is three to nine weeks off and a week-old annual is never already in it.
  const month = monthOf(addMonthsIso(`${today.slice(0, 7)}-01`, 1));
  const set = (m: number | null) => call("PUT", `${L}/competency/annual-month`, { month: m }, T);
  check("0. the month is set", (await set(month)).s === 200, String(month));

  const els = [
    { num: 1, specimenId: "S-1", observerInitials: "JR", passed: true }, { num: 2, evidence: "Critical called", date: today, passed: true },
    { num: 3, qcDate: today, passed: true }, { num: 4, dateObserved: today, observerInitials: "JR", passed: true },
    { num: 5, sampleType: "PT", sampleId: "PT-1", acceptable: true, passed: true }, { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
  ];
  const sign = async (e: number, i: number, milestone: string, signedDate: string) => {
    await call("PUT", `${L}/competency/employee/${e}/test-system/${i}`, { elements: els }, T);
    return call("POST", `${L}/competency/employee/${e}/test-system/${i}/sign`, { fromPaper: true, paperLocation: "Made-up binder", signerStaffEmployeeId: jordan, milestone, signedDate, documentation: "Paper record in the competency binder" }, T);
  };
  const tsOf = async (e: number, i: number) => ((await call("GET", `${L}/competency/employee/${e}`, undefined, T)).j.testSystems || []).find((x: any) => x.instrumentId === i) || {};

  // 1. Signed a week ago; the lab's month ends within nine weeks
  const s1 = await sign(pat, CHEM, "annual", signedOn);
  const chem = await tsOf(pat, CHEM);
  const twelve = addMonthsIso(signedOn, 12);
  check("1. the annual was signed", s1.s === 200, `${s1.s} ${s1.j?.error || ""}`);
  check("1. the person page: due 12 months after it was signed, not at the end of the coming month", chem.nextMilestone === "annual" && chem.nextDue?.targetDate === twelve && chem.nextDue?.latest === twelve && !chem.nextDue?.naturalTargetDate, JSON.stringify(chem.nextDue));
  const register = async () => {
    const r = await fetch(`${base}${L}/staff/competency-register.xlsx`, { headers: { Authorization: `Bearer ${T}` } });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
    const ws = wb.getWorksheet("By Method")!;
    const head = (ws.getRow(1).values as any[]).slice(1).map(String);
    const ymd = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
    const out: any[] = [];
    for (let i = 2; i <= ws.rowCount; i++) out.push(Object.fromEntries(head.map((h, k) => [h, ymd(ws.getRow(i).getCell(k + 1).value)])));
    return out;
  };
  const row = (await register()).find((r) => /^Alpha/.test(r.Name) && /AU5800/.test(r.Method));
  check("1. the register's By Method row: next due in 12 months, Current", row?.["Last sign-off"] === `Annual, ${signedOn}` && row?.["Next due"] === twelve && row?.["Latest allowed"] === twelve && row?.Status === "Current", JSON.stringify(row));

  // 2. A date four months past the lab month still moves into it
  const s2 = await sign(quinn, CHEM, "annual", addMonthsIso(`${today.slice(0, 5)}${String(month).padStart(2, "0")}-15`, month > monthOf(today) ? -8 : 4));
  const q = await tsOf(quinn, CHEM);
  check("2. an annual four months past the month moves into it, with its own date beside it", s2.s === 200 && monthOf(q.nextDue?.targetDate || "") === month && q.nextDue?.targetDate === endOfMonth(q.nextDue?.targetDate || "") && q.nextDue?.naturalTargetDate > q.nextDue?.targetDate && q.nextDue?.annualMonth === month, `${s2.s} ${JSON.stringify(q.nextDue)}`);
  check("2. the latest allowed moves with it", q.nextDue?.latest === q.nextDue?.targetDate, String(q.nextDue?.latest));

  // 3. Year one
  await sign(quinn, C311, "initial", signedOn);
  const c = await tsOf(quinn, C311);
  check("3. a 6-month never moves", c.nextMilestone === "six_month" && c.nextDue?.targetDate === addMonthsIso(signedOn, 6) && !c.nextDue?.naturalTargetDate, JSON.stringify(c.nextDue));

  // 4. VeritaStaff's stored date
  const stored = (e: number) => (sqlite.prepare("SELECT annual_due_at FROM staff_competency_schedules WHERE employee_id = ?").get(e) as any)?.annual_due_at;
  const save = (e: number, body: any) => call("PUT", `${L}/staff/competency/${e}`, { recordedAs: "existing", ...body }, T);
  await save(lee, { lastAnnualCompletedAt: signedOn });
  check("4. a save stores 12 months after the annual", stored(lee) === twelve, String(stored(lee)));
  await set(null);
  check("4. the month turned off: the same date", stored(lee) === twelve, String(stored(lee)));
  await set(month);
  check("4. the month turned on again: the same date", stored(lee) === twelve, String(stored(lee)));

  // 5. What the VeritaStaff record reads
  const status = (last: string, due: string) => deriveCompetencyStatus({ recorded_as: "existing", last_annual_completed_at: last, annual_due_at: due }, new Date(`${today}T00:00:00Z`)).nextDue;
  const movedLast = addMonthsIso(today, -7), natural = addMonthsIso(movedLast, 12);
  const moved = competencyDueColumns({ accreditor: "CAP", highestComplexity: "M", annualMonth: monthOf(addMonthsIso(natural, -2)) }, { lastAnnualCompletedAt: movedLast }).annual_due_at!;
  check("5. a date the month moved about two months earlier is the date read", moved < natural && status(movedLast, moved) === moved, `last ${movedLast}, stored ${moved}, read ${status(movedLast, moved)}`);
  const six = addMonthsIso(today, 5);
  check("5. a date moved exactly six months earlier is the date read", status(addMonthsIso(six, -6), six) === six, String(status(addMonthsIso(six, -6), six)));
  check("5. twelve months after the annual is the date read", status(signedOn, twelve) === twelve, String(status(signedOn, twelve)));
  let pairs = 0, movedPairs = 0, misread = "";
  for (let k = 0; k < 800; k++) {
    const last = addDaysIso("2026-07-01", k);
    for (let m = 1; m <= 12; m++) {
      const due = competencyDueColumns({ accreditor: "CAP", highestComplexity: "M", annualMonth: m }, { lastAnnualCompletedAt: last }).annual_due_at!;
      pairs++; if (due !== addMonthsIso(last, 12)) movedPairs++;
      if (status(last, due) !== due) misread = misread || `${last} month ${m}: stored ${due}, read ${status(last, due)}`;
    }
  }
  check(`5. every stored date reads as itself (${pairs} date and month pairs, ${movedPairs} moved)`, !misread && movedPairs > 4000, misread);
  const old = addDaysIso(today, 30);
  check("5. an annual done early on a date never figured again: next year's", status(signedOn, old) === addDaysIso(old, 365), String(status(signedOn, old)));
  check("5. an annual done 13 months before a date on file: that date", status(addMonthsIso(old, -13), old) === old, String(status(addMonthsIso(old, -13), old)));

  // 6. The admin re-figure
  const wrong = endOfMonth(addMonthsIso(`${today.slice(0, 7)}-01`, 1));
  sqlite.prepare("UPDATE staff_competency_schedules SET annual_due_at = ? WHERE employee_id = ?").run(wrong, lee);
  await save(max, { lastAnnualCompletedAt: addDaysIso(today, -40) });
  const R = "/api/admin/competency/annual-month-refigure";
  check("6. refused without the secret", (await call("POST", R, {})).s === 403);
  check("6. refused with the secret in the body only", (await call("POST", R, { secret: ADMIN, apply: true })).s === 403 && stored(lee) === wrong);
  const dry = await call("POST", R, {}, undefined, { "x-admin-secret": ADMIN });
  const mine = (x: any) => (x.j.labs || []).find((l: any) => l.labId === labId);
  check("6. reads only by default, and names the one row that would change", dry.s === 200 && dry.j.applied === false && mine(dry)?.changes.length === 1 && mine(dry).changes[0].employeeId === lee && mine(dry).changes[0].after === twelve && stored(lee) === wrong, JSON.stringify(mine(dry)));
  check("6. no names in the answer", !/Delta|Lee|Alpha|Early/.test(JSON.stringify(dry.j)));
  const audits = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'competency_annual_month' AND entity_id = ? AND entity_label LIKE 'Annual due dates figured again%'").get(String(labId)) as any).n;
  const n0 = audits();
  const go = await call("POST", R, { apply: true }, undefined, { "x-admin-secret": ADMIN });
  check("6. applied: the row holds 12 months after the annual, one audit row", go.s === 200 && go.j.applied === true && stored(lee) === twelve && audits() === n0 + 1, `${stored(lee)} audits ${audits() - n0}`);
  const again = await call("POST", R, { apply: true }, undefined, { "x-admin-secret": ADMIN });
  check("6. a second run changes nothing and writes no audit row", mine(again)?.changes.length === 0 && audits() === n0 + 1);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
