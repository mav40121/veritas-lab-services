// tests/integration/competency-method-history.test.ts
//
// STANDING integration test for the rebuilt VeritaComp bulk import (Michael 2026-11-04, Q164 = 1): a person, a method and a last date, no programs.
//   T. The template is filled in with each testing person and their methods, one row for a method group, none for a method already signed here. About is sheet 1, the lab is
//      named in three layers, only the three input columns are unlocked, and Annual is filled in except for someone hired in the last year.
//   P. Preview: blank rows are left out, every bad row is named, it shows what each date will set, and it saves nothing.
//   C. Commit: the date sets the due date with no program, the same on the person page and the shared clock, and fills the VeritaStaff schedule. A group counts once. Any error
//      blocks everything. The same file twice loads nothing new.
//   S. A live sign-off wins over a loaded date, and a later file skips a method signed since.
//   W. Another lab's file, another lab's user and a read-only lab are all refused, and the older template gets a clear message.
//   R. A wrong date can be taken back, and the due date returns to what it was.
//   E. The table is on the export-all list and boot adds its columns.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:competency-method-history

import http from "node:http";
import express from "express";
import ExcelJS from "exceljs";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Hist", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const stamp = Date.now();
    const mkLab = async (tag: string) => {
      const email = `hist-${tag}-${stamp}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
      const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `History Lab ${tag}`, plan: "hospital", isWarehouse: true });
      const labId = prov.body.labId as number;
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(tag === "a" ? "22D0000999" : "22D0000998", labId);
      const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any)?.id
        ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'History Lab', '22D0000999', ?, ?, ?)").run(userId, labId, now, now).lastInsertRowid);
      const L = `/api/labs/${labId}`;
      const map = await call("POST", `${L}/veritamap/maps`, { name: `Core ${tag}` }, reg.body.token);
      const addEmp = (first: string, last: string, hire: string | null, testing = 1) => Number(sqlite.prepare(
        "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'MLT(ASCP)', ?, ?, 'active', ?, ?)"
      ).run(staffLab, labId, userId, last, first, hire, testing, now, now).lastInsertRowid);
      const addInst = async (name: string, serial: string, complexity: string) => {
        await call("POST", `${L}/veritamap/maps/${map.body.id}/instruments`, { instrument_name: name, role: "Primary", category: "Chemistry", serial_number: serial }, reg.body.token);
        const id = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND serial_number = ?").get(map.body.id, serial) as any).id);
        await call("PUT", `${L}/veritamap/maps/${map.body.id}/instruments/${id}/tests`, { tests: [{ analyte: `Made-up ${serial}`, specialty: "General Chemistry", complexity, active: 1 }] }, reg.body.token);
        return id;
      };
      const assign = (emp: number, inst: number) => sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(emp, inst, now, userId);
      return { email, token: reg.body.token as string, labId, userId, L, addEmp, addInst, assign };
    };
    const A = await mkLab("a");
    const B = await mkLab("b");
    const H = `${A.L}/competency/method-history`;

    const chem = await A.addInst("Made-up chemistry analyzer", "CHEM1", "MODERATE");
    const heme1 = await A.addInst("Made-up heme one", "HEME1", "HIGH");
    const heme2 = await A.addInst("Made-up heme two", "HEME2", "HIGH");
    const poc = await A.addInst("Made-up POC meter", "POC1", "WAIVED");

    {
      const g = Number(sqlite.prepare("INSERT INTO competency_instrument_groups (lab_id, name, created_at, updated_at) VALUES (?, 'Made-up heme group', ?, ?)").run(A.labId, now, now).lastInsertRowid);
      for (const i of [heme1, heme2]) sqlite.prepare("INSERT INTO competency_instrument_group_members (lab_id, group_id, instrument_id, created_at) VALUES (?, ?, ?, ?)").run(A.labId, g, i, now);
    }
    const ann = A.addEmp("Ann", "Longtime", "2015-03-02");
    const bea = A.addEmp("Bea", "Newhire", daysAgo(100));
    const cal = A.addEmp("Cal", "Signed", "2016-01-04");
    const dee = A.addEmp("Dee", "Nomethods", "2017-01-04");
    A.addEmp("Eve", "Nottesting", "2018-01-04", 0);
    for (const [e, i] of [[ann, chem], [ann, heme1], [ann, heme2], [ann, poc], [bea, chem], [cal, chem]] as const) A.assign(e, i);
    const bStaff = B.addEmp("Bo", "Otherlab", "2015-01-05");
    const bInst = await B.addInst("Made-up other analyzer", "OTHER1", "MODERATE");
    B.assign(bStaff, bInst);
    const signoffAt = (emp: number, inst: number, date: string) => sqlite.prepare(
      "INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, complexity, determination, created_at) VALUES (?, ?, ?, 'annual', ?, 'Made Up', 'TC', 'MODERATE', 'pass', ?)"
    ).run(A.labId, emp, inst, date, now);
    signoffAt(cal, chem, daysAgo(30));

    const download = async (L: string, token: string) => {
      const r = await fetch(`${base}${L}/competency/method-history/template.xlsx`, { headers: { Authorization: `Bearer ${token}` } });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
      return { status: r.status, wb };
    };
    const toBuffer = async (wb: any) => Buffer.from(await wb.xlsx.writeBuffer());
    const post = async (path: string, buf: Buffer, token = A.token, H2 = H) => {
      const fd = new FormData();
      fd.append("file", new Blob([buf as any]), "filled.xlsx");
      const r = await fetch(`${base}${H2}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    const rowFor = (ws: any, emp: number, method: number) => {
      for (let n = 2; n <= ws.rowCount; n += 1) if (Number(ws.getRow(n).getCell(10).value) === emp && Number(ws.getRow(n).getCell(11).value) === method) return ws.getRow(n);
      return null;
    };
    const fill = (row: any, date: any, type: any, evaluator: any) => { row.getCell(7).value = date; if (type !== undefined) row.getCell(8).value = type; row.getCell(9).value = evaluator; };

    // T. The template
    const { status: tStatus, wb } = await download(A.L, A.token);
    const ws = wb.getWorksheet("Past Competencies")!;
    check("T. the template downloads", tStatus === 200);
    check("T. About is the first sheet", wb.worksheets[0].name === "About", wb.worksheets.map((s) => s.name).join("|"));
    check("T. the lab is named on About", /Prepared for: History Lab a\s+CLIA: 22D0000999/.test(String(wb.worksheets[0].getCell("A2").value)), String(wb.worksheets[0].getCell("A2").value));
    check("T. and in the page header and footer", /History Lab a/.test(String((ws as any).headerFooter?.oddHeader)) && /History Lab a/.test(String((ws as any).headerFooter?.oddFooter)));
    const lead = Math.min(heme1, heme2);
    check("T. each person's method has a row", !!rowFor(ws, ann, chem) && !!rowFor(ws, ann, poc) && !!rowFor(ws, bea, chem));
    check("T. a method group is one row", !!rowFor(ws, ann, lead) && !rowFor(ws, ann, Math.max(heme1, heme2)));
    check("T. the group reads by its name", String(rowFor(ws, ann, lead)?.getCell(3).value) === "Made-up heme group", String(rowFor(ws, ann, lead)?.getCell(3).value));
    check("T. a method signed here is left out", !rowFor(ws, cal, chem));
    check("T. someone not testing is left out", ![...Array(ws.rowCount).keys()].some((i) => /Nottesting/.test(String(ws.getRow(i + 1).getCell(1).value))));
    check("T. no other lab's person is listed", ![...Array(ws.rowCount).keys()].some((i) => Number(ws.getRow(i + 1).getCell(10).value) === bStaff));
    check("T. Annual is filled in for longtime staff", rowFor(ws, ann, chem)?.getCell(8).value === "Annual");
    check("T. Type is blank for a hire in the last year", !rowFor(ws, bea, chem)?.getCell(8).value);
    check("T. it says nothing is on file", rowFor(ws, ann, chem)?.getCell(6).value === "Nothing on file");
    const r0 = rowFor(ws, ann, chem)!;
    check("T. only the three input columns are unlocked", [7, 8, 9].every((c) => r0.getCell(c).protection?.locked === false) && [1, 2, 3, 4, 5, 6, 10, 11].every((c) => r0.getCell(c).protection?.locked !== false));
    check("T. the keys are hidden", ws.getColumn(10).hidden === true && ws.getColumn(11).hidden === true);
    const sum = await call("GET", `${H}/summary`, undefined, A.token);
    check("T. the window says who is listed and who has no methods", sum.body.peopleListed === 2 && sum.body.methods === 4 && sum.body.peopleWithoutMethods.length === 1 && sum.body.peopleWithoutMethods.some((n: string) => /Nomethods/.test(n)), JSON.stringify(sum.body));

    // P. Preview
    const countHist = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_method_history WHERE lab_id = ? AND removed_at IS NULL").get(A.labId) as any).n as number;
    const blankOnly = await post("preview", await toBuffer(wb));
    check("P. an untouched template has nothing to load", blankOnly.status === 200 && blankOnly.body.summary.total === 0 && blankOnly.body.summary.blank === 4, JSON.stringify(blankOnly.body.summary));
    const lastYear = daysAgo(200);
    const fresh = async () => (await download(A.L, A.token)).wb;
    const good = await fresh();
    const gs = good.getWorksheet("Past Competencies")!;
    fill(rowFor(gs, ann, chem), new Date(`${lastYear}T00:00:00Z`), undefined, "Made Up Evaluator");
    fill(rowFor(gs, ann, lead), lastYear, "Annual", "Made Up Evaluator");
    fill(rowFor(gs, bea, chem), new Date(`${daysAgo(50)}T00:00:00Z`), "Initial", "Made Up Evaluator");
    const goodBuf = await toBuffer(good);
    const pv = await post("preview", goodBuf);
    const pr = (emp: string) => pv.body.rows?.find((r: any) => r.person.startsWith(emp));
    check("P. the rows come back, and blanks are counted", pv.status === 200 && pv.body.summary.ok === 3 && pv.body.summary.blank === 1, JSON.stringify(pv.body.summary));
    const expectedAnnual = `${Number(lastYear.slice(0, 4)) + 1}${lastYear.slice(4)}`;
    const annRow = pv.body.rows?.find((r: any) => r.person.startsWith("Longtime") && r.method === "Made-up chemistry analyzer");
    check("P. a date shows what it will set", annRow?.sets?.label === "Annual" && annRow?.sets?.targetDate === expectedAnnual, JSON.stringify(annRow?.sets));
    check("P. an Initial shows the 6-month next", pr("Newhire")?.sets?.label === "6-month", JSON.stringify(pr("Newhire")?.sets));
    check("P. a preview saves nothing", countHist() === 0, String(countHist()));

    const bad = await fresh();
    const bs = bad.getWorksheet("Past Competencies")!;
    fill(rowFor(bs, ann, chem), new Date(`${daysAgo(-30)}T00:00:00Z`), undefined, "Made Up");
    fill(rowFor(bs, ann, lead), "not a date", "Annual", "Made Up");
    fill(rowFor(bs, ann, poc), lastYear, "6-month", "Made Up");
    fill(rowFor(bs, bea, chem), lastYear, null, "");
    const pb = await post("preview", await toBuffer(bad));
    const issue = (re: RegExp) => (pb.body.rows || []).some((r: any) => r.status === "error" && r.issues.some((i: string) => re.test(i)));
    check("P. a future date is named", issue(/in the future/));
    check("P. something that isn't a date is named", issue(/isn't a date/));
    check("P. a 6-month on waived testing is named", issue(/Waived testing has no 6-month/));
    check("P. a missing type is named", issue(/Pick Initial, 6-month or Annual/));
    check("P. a missing evaluator is named", issue(/who evaluated/));
    const before = await post("commit", await toBuffer(bad));
    check("C. any error blocks everything", before.status === 400 && before.body.errorRows.length === 4 && countHist() === 0, JSON.stringify(before.body.message));
    const earlyHire = await fresh();
    fill(rowFor(earlyHire.getWorksheet("Past Competencies")!, bea, chem), daysAgo(150), "Initial", "Made Up");
    const pe = await post("preview", await toBuffer(earlyHire));
    check("P. a date before the hire date is flagged but allowed", pe.body.summary.warning === 1 && /before the hire date/.test(pe.body.rows[0].issues[0]), JSON.stringify(pe.body.rows?.[0]?.issues));

    // C. Commit
    const clocks = async () => {
      const { loadLabMethodClocks } = await import("../../server/competencyMethodClock");
      return loadLabMethodClocks(sqlite, A.labId, today);
    };
    const c0 = (await clocks()).get(ann)!.find((m) => m.methodId === chem)!;
    check("C. before the import the Initial shows as due", c0.signed === false && c0.clock.nextMilestone === "initial", c0.clock.nextMilestone);
    const done = await post("commit", goodBuf);
    check("C. the dates load", done.status === 200 && done.body.imported === 3 && done.body.skipped === 0, JSON.stringify(done.body));
    const c1 = (await clocks()).get(ann)!.find((m) => m.methodId === chem)!;
    check("C. the date sets the due date, with no program", c1.signed === true && c1.clock.nextMilestone === "annual" && c1.clock.nextDue?.targetDate === expectedAnnual && !sqlite.prepare("SELECT 1 FROM competency_programs WHERE lab_id = ? AND type = 'technical' AND COALESCE(is_implicit, 0) = 0").get(A.labId), JSON.stringify(c1.clock.nextDue));
    const staffChem = await call("GET", `${A.L}/competency/employee/${ann}`, undefined, A.token);
    const page = (staffChem.body.testSystems || []).find((t: any) => t.instrumentId === chem || t.id === chem);
    check("C. the person page agrees", page?.nextDue?.targetDate === expectedAnnual && page?.lastSignoff?.imported === true && page?.lastSignoff?.signerName === "Made Up Evaluator" && !!page?.lastSignoff?.historyId, JSON.stringify({ s: staffChem.status, keys: Object.keys(staffChem.body).slice(0, 12), d: page?.nextDue, l: page?.lastSignoff?.importedFrom }));
    check("C. it isn't recorded as a sign-off", !sqlite.prepare("SELECT 1 FROM competency_method_signoffs WHERE lab_id = ? AND staff_employee_id = ? AND instrument_id = ?").get(A.labId, ann, chem));
    const members = sqlite.prepare("SELECT instrument_id, group_history_id FROM competency_method_history WHERE lab_id = ? AND staff_employee_id = ? AND instrument_id IN (?, ?) ORDER BY id").all(A.labId, ann, heme1, heme2) as any[];
    check("C. a group writes a row for each analyzer", members.length === 2 && members[0].group_history_id == null && members[1].group_history_id != null, JSON.stringify(members));
    const groupClock = (await clocks()).get(ann)!.filter((m) => m.methodId === lead);
    check("C. and reads as one method, once", groupClock.length === 1 && groupClock[0].clock.nextDue?.targetDate === expectedAnnual, JSON.stringify(groupClock.map((g) => g.clock.nextDue)));
    const groupPage = (staffChem.body.testSystems || []).find((t: any) => t.instrumentId === lead || t.id === lead);
    check("C. the person page lists a group's date once", (groupPage?.signoffs || []).filter((x: any) => x.imported).length === 1, JSON.stringify((groupPage?.signoffs || []).map((x: any) => x.signedDate)));
    const sched = sqlite.prepare("SELECT recorded_as, last_annual_completed_at FROM staff_competency_schedules WHERE employee_id = ?").get(ann) as any;
    check("C. it fills the VeritaStaff schedule", sched?.recorded_as === "existing" && sched?.last_annual_completed_at === lastYear, JSON.stringify(sched));
    const audit = sqlite.prepare("SELECT action, entity_type FROM audit_log WHERE entity_type = 'method_history_import' ORDER BY id DESC LIMIT 1").get() as any;
    check("C. it is in the audit log", audit?.action === "create", JSON.stringify(audit));
    const before2 = countHist();
    const again = await post("commit", goodBuf);
    check("C. the same file twice loads nothing new", again.status === 200 && again.body.imported === 0 && again.body.skipped === 3 && countHist() === before2, JSON.stringify(again.body));
    const onFile = rowFor((await fresh()).getWorksheet("Past Competencies")!, ann, chem)?.getCell(6).value;
    check("C. a fresh template says what is on file", /^Annual \d\d\/\d\d\/\d{4}$/.test(String(onFile)), String(onFile));

    // S. A live sign-off wins
    const newer = daysAgo(10);
    signoffAt(ann, chem, newer);
    const c2 = (await clocks()).get(ann)!.find((m) => m.methodId === chem)!;
    check("S. a live sign-off wins over a loaded date", c2.clock.lastPass?.signedDate === newer, JSON.stringify(c2.clock.lastPass));
    // A different date, so this row can only be skipped because the method is signed, not because the date is already on file.
    rowFor(gs, ann, chem).getCell(7).value = daysAgo(300);
    const skip = await post("preview", await toBuffer(good));
    const skipped = skip.body.rows.find((r: any) => r.method === "Made-up chemistry analyzer" && r.person.startsWith("Longtime"));
    check("S. a later file skips a method signed since", skipped?.status === "skip" && /Already signed/.test(skipped?.issues?.[0] || ""), JSON.stringify(skipped?.issues));

    // W. Walls
    const other = await download(B.L, B.token);
    const os = other.wb.getWorksheet("Past Competencies")!;
    fill(rowFor(os, bStaff, bInst), lastYear, "Annual", "Made Up");
    const cross = await post("commit", await toBuffer(other.wb));
    check("W. another lab's file is refused and names nobody", cross.status === 400 && cross.body.errorRows.length === 1 && /doesn't match this lab/.test(cross.body.errorRows[0].issues[0]) && !/Otherlab/.test(JSON.stringify(cross.body)), JSON.stringify(cross.body.errorRows));
    check("W. another lab's owner can't read the template", (await fetch(`${base}${H}/template.xlsx`, { headers: { Authorization: `Bearer ${B.token}` } })).status === 403);
    check("W. or load into this lab", (await post("commit", goodBuf, B.token)).status === 403);
    const notAssigned = await fresh();
    const naSheet = notAssigned.getWorksheet("Past Competencies")!;
    const beaRow = rowFor(naSheet, bea, chem)!;
    fill(beaRow, lastYear, "Annual", "Made Up");
    sqlite.prepare("DELETE FROM staff_employee_instruments WHERE employee_id = ? AND instrument_id = ?").run(bea, chem);
    const unassigned = await post("preview", await toBuffer(notAssigned));
    check("W. a method taken off a person since the download is refused", unassigned.body.rows.some((r: any) => r.status === "error" && /doesn't match/.test(r.issues[0])));
    A.assign(bea, chem);
    const oldWb = new ExcelJS.Workbook();
    oldWb.addWorksheet("Assessments").addRow(["Employee Name"]);
    const oldT = await post("preview", await toBuffer(oldWb));
    check("W. the older template gets a clear message", oldT.status === 400 && /isn't the current template/.test(oldT.body.fatal), JSON.stringify(oldT.body));

    // R. Taking one back
    const pending = (sqlite.prepare("SELECT id FROM competency_method_history WHERE lab_id = ? AND staff_employee_id = ? AND instrument_id = ?").get(A.labId, ann, lead) as any).id as number;
    check("R. another lab can't remove it", (await call("DELETE", `${H}/${pending}`, undefined, B.token)).status === 403 && (await call("DELETE", `${B.L}/competency/method-history/${pending}`, undefined, B.token)).status === 404);
    const removed = await call("DELETE", `${H}/${pending}`, undefined, A.token);
    check("R. it can be taken back", removed.status === 200, `HTTP ${removed.status}`);
    const c3 = (await clocks()).get(ann)!.find((m) => m.methodId === lead)!;
    check("R. the due date returns to what it was", c3.signed === false && c3.clock.nextMilestone === "initial", JSON.stringify(c3.clock.nextMilestone));
    check("R. the whole group comes off, and the rows are kept", (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_method_history WHERE lab_id = ? AND staff_employee_id = ? AND removed_at IS NOT NULL").get(A.labId, ann) as any).n === 2);
    check("R. the template lists it as nothing on file again", rowFor((await fresh()).getWorksheet("Past Competencies")!, ann, lead)?.getCell(6).value === "Nothing on file");

    // Read-only lab last: it blocks the rest
    sqlite.prepare("UPDATE labs SET subscription_status = 'expired', subscription_expires_at = '2020-01-01' WHERE id = ?").run(A.labId);
    sqlite.prepare("UPDATE users SET subscription_status = 'expired', subscription_expires_at = '2020-01-01' WHERE id = ?").run(A.userId);
    check("W. a read-only lab can't load dates", (await post("commit", goodBuf)).status === 403);

    // E.
    const { default: fs } = await import("node:fs");
    check("E. the table is on the export-all list", /competency_method_history: lab\("VeritaComp"\)/.test(fs.readFileSync("server/exportAllTables.ts", "utf8")));
    const cols = (sqlite.prepare("PRAGMA table_info(competency_method_history)").all() as any[]).map((c) => c.name);
    check("E. boot adds its columns", ["lab_id", "staff_employee_id", "instrument_id", "milestone", "completed_date", "evaluator_name", "group_history_id", "removed_at"].every((c) => cols.includes(c)));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
