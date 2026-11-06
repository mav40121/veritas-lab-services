// tests/integration/competency-nontechnical-frequency.test.ts
//
// Michael 2026-11-04, "The sites shoudl be able to set frequency", go Q216 = 1, 2026-11-06. A lab sets how often non-technical competency
// comes due; only its owner or an admin can change it; blank keeps today's behavior, where a non-technical record has no due date. Boots
// the REAL routes on a scratch database with made-up people. Proves:
//   - blank: no due date on any read, nothing in the reminder emails;
//   - who may change it, and that a save writes that one column and no record;
//   - the due dates, from the last signed, passing record, with everything that stays out left out;
//   - reminders follow it, and clearing it puts the emails back exactly;
//   - technical timing (42 CFR 493.1451(b)(9), 493.1413(b)(9)) reads the same at every setting, on every reader, with the dates pinned;
//   - lab scope, sister labs, and a Staff login's own rows only.
// Run: npm run test:competency-nontechnical-frequency
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Every date below is fixed. Reads through a route use the real day, so a route check uses dates that stay on one side of it for years.
const PINNED = "2026-11-06";

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { computeCompetencyDue, planCompetencyReminders, readCompetencyReminderConfig, runCompetencyReminders } = await import("../../server/competencyReminders");
  const { nontechnicalDueForLab } = await import("../../server/competencyNontechnicalDue");
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
  const call = async (method: string, path: string, body: unknown, token?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `ntf-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const OWNER = await register("owner"), OTHER = await register("other"), ADMINUSER = await register("admin"), ORGADMIN = await register("orgadmin"), SUPPORT = await register("support");
    const EDITOR = await register("editor"), VIEWER = await register("viewer"), ANN = await register("ann"), COMPEDIT = await register("compedit"), NOLINK = await register("nolink"), MEMBER = await register("member");
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const labId = await provision(OWNER.email, "Made-up Frequency Lab"), sister = await provision(OWNER.email, "Made-up Sister Lab"), lab2 = await provision(OTHER.email, "Made-up Other Lab");
    const L = `/api/labs/${labId}`, LS = `/api/labs/${sister}`, L2 = `/api/labs/${lab2}`;
    const FREQ = `${L}/competency/nontechnical-frequency`, DUE = `${L}/competency/nontechnical-due`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Frequency Lab", cliaNumber: "11D7654381", accreditationBody: "CLIA_ONLY", complexity: "high" }, OWNER.token);
    await call("POST", `${L2}/staff/lab`, { labName: "Made-up Other Lab", cliaNumber: "11D7654382", accreditationBody: "CLIA_ONLY", complexity: "high" }, OTHER.token);
    const person = async (last: string, first: string, opts: { testing?: boolean; lab?: string; token?: string } = {}) => Number((await call("POST", `${opts.lab ?? L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "H", performsTesting: opts.testing !== false, hireDate: "2019-03-01" }, opts.token ?? OWNER.token)).j.id);
    const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)`).run(lab, userId, role, now, now, now);
    const seat = (lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(OWNER.id, u.email, u.id, now, now, perms, `ntf-${u.id}-${lab}-${stamp}`, lab, type, rosterId);
    const comp = (lab: number, ownerId: number, staffId: number | null, name: string, status = "active") => Number(
      sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, ?, 'Made-up Tech', '2019-03-01', ?, ?, ?)").run(ownerId, lab, name, status, staffId, now).lastInsertRowid);
    const mkProgram = async (name: string, type: string, extra: Record<string, unknown> = {}, lab = L, token = OWNER.token) => {
      const r = await call("POST", `${lab}/competency/programs`, { name, department: "Core", type, ...(type === "nontechnical" ? { checklistItems: [{ description: "Made-up item" }] } : {}), ...extra }, token);
      return Number(r.j.id);
    };
    // A signed record, written the way each route leaves it. paper = signed back-dated; done = completion_date (a timestamp from Sign, a date from Bulk Import or Cohort).
    const record = (programId: number, employeeId: number, opts: { type?: string; status?: string; locked?: number; date?: string; done?: string | null; paper?: string | null } = {}) => Number(sqlite.prepare(
      `INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, locked, completion_date, signed_on_paper_date, competency_type, created_at)
       VALUES (?, ?, ?, ?, 'Made Up Evaluator', ?, ?, ?, ?, 'nontechnical', ?)`
    ).run(programId, employeeId, opts.type ?? "annual", opts.date ?? "2020-01-01", opts.status ?? "pass", opts.locked ?? 1, opts.done === undefined ? opts.date ?? "2020-01-01" : opts.done, opts.paper ?? null, now).lastInsertRowid);

    // People. Each stands for one branch; the dates are in the checks below.
    const annStaff = await person("Self", "Ann"), benStaff = await person("Reyes", "Ben"), caraStaff = await person("Ng", "Cara"), deeStaff = await person("Ortiz", "Dee");
    const eliStaff = await person("Unsigned", "Eli"), fayStaff = await person("Notapp", "Fay"), gusStaff = await person("Gone", "Gus"), hanaStaff = await person("Left", "Hana");
    const ivyStaff = await person("Elsewhere", "Ivy"), jonStaff = await person("Cohort", "Jon"), kimStaff = await person("Paper", "Kim"), leeStaff = await person("Clerk", "Lee", { testing: false });
    const miaStaff = await person("Two", "Mia"), tessStaff = await person("Technical", "Tess"), noahStaff = await person("Failed", "Noah");
    const nedStaff = await person("OtherLab", "Ned", { lab: L2, token: OTHER.token });
    const annC = comp(labId, OWNER.id, annStaff, "Ann Self"), benC = comp(labId, OWNER.id, benStaff, "Ben Reyes"), caraC = comp(labId, OWNER.id, caraStaff, "Cara Ng"), deeC = comp(labId, OWNER.id, deeStaff, "Dee Ortiz");
    const eliC = comp(labId, OWNER.id, eliStaff, "Eli Unsigned"), fayC = comp(labId, OWNER.id, fayStaff, "Fay Notapp"), gusC = comp(labId, OWNER.id, gusStaff, "Gus Gone", "inactive"), hanaC = comp(labId, OWNER.id, hanaStaff, "Hana Left");
    const ivyC = comp(labId, OWNER.id, ivyStaff, "Ivy Elsewhere"), jonC = comp(labId, OWNER.id, jonStaff, "Jon Cohort"), kimC = comp(labId, OWNER.id, kimStaff, "Kim Paper"), leeC = comp(labId, OWNER.id, leeStaff, "Lee Clerk");
    const miaC = comp(labId, OWNER.id, miaStaff, "Mia Two"), tessC = comp(labId, OWNER.id, tessStaff, "Tess Technical"), noahC = comp(labId, OWNER.id, noahStaff, "Noah Failed");
    const unlinkedC = comp(labId, OWNER.id, null, "Una Unlinked"), nedC = comp(lab2, OTHER.id, nedStaff, "Ned OtherLab");
    await call("PUT", `${L}/staff/employees/${hanaStaff}`, { status: "inactive" }, OWNER.token);
    sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(hanaStaff);

    const safety = await mkProgram("Made-up Safety", "nontechnical"), lis = await mkProgram("Made-up LIS", "nontechnical");
    const techProg = await mkProgram("Made-up Technical", "technical"), waivedProg = await mkProgram("Made-up Waived", "waived");
    const evalProg = await mkProgram("Made-up Evaluation", "nontechnical", { recordKind: "evaluation" });
    const otherProg = await mkProgram("Made-up Other Lab Safety", "nontechnical", {}, L2, OTHER.token);
    check("0. setup: a lab, a sister lab, another owner's lab, and programs of every type", [labId, sister, lab2, safety, lis, techProg, waivedProg, evalProg, otherProg].every((n) => n > 0));

    record(safety, annC, { paper: "2024-12-15", done: "2026-11-01T15:00:00.000Z", date: "2024-12-01" });                 // signed back-dated: the paper date counts
    record(safety, benC, { date: "2024-02-29" });                                                                         // leap day, date-only completion
    record(safety, caraC, { date: "2023-01-10" }); record(safety, caraC, { date: "2026-01-10" });                         // two passes: the last counts
    record(safety, deeC, { date: "2026-01-10" }); record(safety, deeC, { date: "2026-06-01", status: "remediation" });    // then remediation
    record(safety, noahC, { date: "2026-06-01", status: "fail" });                                                        // a fail and no pass at all
    record(safety, eliC, { date: "2024-01-01", locked: 0, done: null });                                                  // never signed
    record(safety, fayC, { date: "2024-01-01" }); sqlite.prepare("INSERT INTO competency_program_not_applicable (program_id, employee_id, marked_at) VALUES (?, ?, ?)").run(safety, fayC, now);
    record(safety, gusC, { date: "2024-01-01" }); record(safety, hanaC, { date: "2024-01-01" });                          // inactive in VeritaComp; inactive in VeritaStaff
    record(evalProg, ivyC, { type: "30day", date: "2024-01-01" }); record(techProg, ivyC, { date: "2024-01-01" }); record(waivedProg, ivyC, { date: "2024-01-01" });
    record(safety, kimC, { date: "2026-01-20", done: "2026-02-02T03:30:00.000Z" });                                       // signed the evening of 2/1 in the lab's zone, 2/2 in UTC
    record(lis, leeC, { date: "2025-06-15" });                                                                            // doesn't test patients
    record(safety, miaC, { date: "2024-03-01" }); record(lis, miaC, { date: "2025-03-01" });                              // two programs, two dates
    record(safety, tessC, { date: "2020-06-01" });                                                                        // a technical person, long overdue here
    record(safety, unlinkedC, { date: "2025-11-20" });                                                                    // not linked to VeritaStaff
    record(safety, nedC, { date: "2024-01-01" });                                                                         // another lab's person on this lab's program
    record(otherProg, nedC, { date: "2024-01-01" });

    // Technical timing, pinned to known dates. Sign-offs on a CLIA-only lab: the target is the due date, with no tolerance.
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Made-up Moderate", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
      { name: "Made-up High", category: "Chemistry", tests: [{ analyte: "Sodium", specialty: "Routine Chemistry", complexity: "HIGH", active: 1 }] },
      { name: "Made-up Established", category: "Coagulation", tests: [{ analyte: "PT", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
      { name: "Made-up Waived Device", category: "Point of Care", tests: [{ analyte: "Glucose", specialty: "Routine Chemistry", complexity: "WAIVED", active: 1 }] },
    ] });
    const inst = (n: string) => (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(n, mapId) as any).id as number;
    const MOD = inst("Made-up Moderate"), HIGH = inst("Made-up High"), EST = inst("Made-up Established"), WAIVEDDEV = inst("Made-up Waived Device");
    for (const i of [MOD, HIGH, EST, WAIVEDDEV]) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tessStaff, i, now);
    const sign = (i: number, milestone: string, date: string, complexity: string) => sqlite.prepare(
      `INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, complexity, determination, created_at) VALUES (?, ?, ?, ?, ?, 'Casey Tate', 'TS', ?, 'pass', ?)`
    ).run(labId, tessStaff, i, milestone, date, complexity, now);
    sign(MOD, "initial", "2026-05-15", "MODERATE");
    sign(HIGH, "initial", "2025-09-10", "HIGH"); sign(HIGH, "six_month", "2026-03-20", "HIGH");
    sign(EST, "initial", "2024-01-05", "MODERATE"); sign(EST, "six_month", "2024-07-05", "MODERATE"); sign(EST, "first_annual", "2025-01-05", "MODERATE"); sign(EST, "annual", "2026-02-01", "MODERATE");
    sign(WAIVEDDEV, "initial", "2026-03-01", "WAIVED");
    await call("PUT", `${L}/staff/competency/${tessStaff}`, { initialCompletedAt: "2024-01-05", initialSignedBy: "Casey Tate" }, OWNER.token);

    // What the technical readers say, and the rows behind them, from a real register and every route that reports a due date.
    const registerRows = async () => {
      const xr = await fetch(`${base}${L}/staff/competency-register.xlsx`, { headers: { Authorization: `Bearer ${OWNER.token}` } });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()) as any);
      const rows = (name: string) => { const out: any[] = []; wb.getWorksheet(name)?.eachRow((r: any) => out.push(r.values)); return out; };
      return { people: rows("Testing Personnel"), byMethod: rows("By Method") };
    };
    const technicalSnapshot = async () => JSON.stringify({
      due: computeCompetencyDue(sqlite, labId, PINNED),
      roster: (await call("GET", `${L}/staff/employees`, undefined, OWNER.token)).j,
      owed: (await call("GET", `${L}/competency/owed`, undefined, OWNER.token)).j,
      dash: (await call("GET", `${L}/competency/dashboard-stats`, undefined, OWNER.token)).j,
      person: (await call("GET", `${L}/competency/employee/${tessStaff}`, undefined, OWNER.token)).j.testSystems,
      register: await registerRows(),
      schedules: sqlite.prepare("SELECT * FROM staff_competency_schedules ORDER BY employee_id").all(),
      signoffs: sqlite.prepare("SELECT * FROM competency_method_signoffs ORDER BY id").all(),
    });
    const records = () => JSON.stringify(["competency_assessments", "competency_assessment_items", "competency_programs", "competency_employees", "competency_checklist_items", "competency_program_not_applicable", "competency_method_signoffs", "staff_competency_schedules", "staff_employees", "staff_labs"]
      .map((t) => sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
    const labRow = (id = labId) => { const { competency_nontechnical_months, updated_at, ...rest } = sqlite.prepare("SELECT * FROM labs WHERE id = ?").get(id) as any; return JSON.stringify(rest); };
    const setting = (id = labId) => (sqlite.prepare("SELECT competency_nontechnical_months AS m FROM labs WHERE id = ?").get(id) as any).m;
    const reminderCfg = { ...readCompetencyReminderConfig(sqlite, labId), enabled: true, lead_days: 60, supervisor_recipients: [{ email: "made-up-supervisor@example.test" }], escalation_recipients: [{ email: "made-up-director@example.test" }] };
    const plan = (today = PINNED) => planCompetencyReminders(sqlite, labId, reminderCfg, today);
    const planText = () => JSON.stringify(plan().map((p) => ({ kind: p.kind, subject: p.subject, text: p.text, html: p.html, items: p.items, keys: p.newlyOverdueKeys ?? null })));
    const technicalItems = () => JSON.stringify(plan().map((p) => p.items.filter((i) => !/Non-technical|after remediation due \(Made-up (Safety|LIS)\)/.test(i.reason))));

    // ── Blank: today's behavior ──────────────────────────────────────────────
    const cols = (sqlite.prepare("PRAGMA table_info(labs)").all() as any[]).find((c) => c.name === "competency_nontechnical_months");
    check("1a. the column is on labs and holds nothing on a new lab", !!cols && setting() === null && setting(sister) === null);
    const blankGet = await call("GET", FREQ, undefined, OWNER.token);
    check("1b. an owner reads blank, and can change it", blankGet.s === 200 && blankGet.j.months === null && blankGet.j.canEdit === true, blankGet.text);
    const blankDue = await call("GET", DUE, undefined, OWNER.token);
    check("1c. blank: no due date for anyone, whatever is on file", blankDue.s === 200 && blankDue.j.months === null && blankDue.j.items.length === 0 && blankDue.j.counts.total === 0, blankDue.text);
    check("1d. blank: the engine returns nothing even with old passing records on file", nontechnicalDueForLab(sqlite, labId, PINNED).length === 0);
    const blankPlan = planText();
    check("1e. blank: no reminder email carries a non-technical line", !/Non-technical|Made-up Safety|Made-up LIS/.test(blankPlan), blankPlan.slice(0, 200));
    const technicalBlank = await technicalSnapshot();
    const recordsBlank = records(), labBlank = labRow(), technicalPlanBlank = technicalItems();
    const snap = JSON.parse(technicalBlank);
    const tessInSnap = snap.roster.find?.((e: any) => e.id === tessStaff);
    check("1f. the technical picture holds real answers, so comparing it later means something",
      snap.due.some((d: any) => d.employeeId === tessStaff) && !!tessInSnap?.competencyStatus?.nextDue && snap.owed.employees?.some((e: any) => e.employeeId === tessStaff) && typeof snap.dash.overdue === "number"
      && snap.person?.length === 4 && snap.register.byMethod.length >= 5 && snap.register.people.length >= 5 && snap.schedules.length >= 1 && snap.signoffs.length === 8,
      technicalBlank.slice(0, 300));
    const technicalLine = "First annual competency due (Made-up High)";
    check("1g. the technical line is in the emails, so comparing them later means something too", plan().every((p) => p.items.some((i) => i.reason === technicalLine)), technicalPlanBlank.slice(0, 300));

    // ── Who may change it ────────────────────────────────────────────────────
    member(labId, ADMINUSER.id, "admin");
    member(labId, EDITOR.id); seat(labId, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labId, VIEWER.id); seat(labId, VIEWER, "view_only", '{"mode":"view_all"}', null);
    member(labId, ANN.id); seat(labId, ANN, "staff_portal", '{"mode":"view_all"}', annStaff);
    member(labId, COMPEDIT.id); seat(labId, COMPEDIT, "staff_portal", '{"mode":"view_all","overrides":{"veritacomp":"edit"}}', benStaff);
    member(labId, NOLINK.id); seat(labId, NOLINK, "staff_portal", '{"mode":"view_all"}', null);
    member(labId, MEMBER.id);
    for (const [name, u] of [["an editor with edit on everything", EDITOR], ["a view-only seat", VIEWER], ["a Staff login", ANN], ["a Staff seat with edit on VeritaComp", COMPEDIT], ["a Staff seat with no roster link", NOLINK], ["a member with no seat", MEMBER], ["another lab's owner", OTHER]] as const) {
      const r = await call("PUT", FREQ, { months: 24 }, u.token);
      check(`2a. ${name} can't change it, and nothing changes`, r.s === 403 && setting() === null, `${r.s} ${r.text.slice(0, 120)}`);
    }
    const editorRead = await call("GET", FREQ, undefined, EDITOR.token);
    check("2b. an editor can see it and is told they can't change it", editorRead.s === 200 && editorRead.j.months === null && editorRead.j.canEdit === false, editorRead.text);
    const refusedCode = await call("PUT", FREQ, { months: 24 }, EDITOR.token);
    check("2c. the refusal names the rule, in plain words", refusedCode.j.code === "OWNER_OR_ADMIN_ONLY" && /owner or an admin/.test(refusedCode.j.error), refusedCode.text);
    const staffRead = await call("GET", FREQ, undefined, ANN.token);
    check("2d. a Staff login can see the setting, with no names and no way to change it", staffRead.s === 200 && staffRead.j.canEdit === false && Object.keys(staffRead.j).sort().join() === "canEdit,months", staffRead.text);
    const signedOut = await call("PUT", FREQ, { months: 24 }, undefined);
    check("2e. signed out: refused, and nothing changes", signedOut.s === 401 && setting() === null, `${signedOut.s}`);
    const signedOutRead = await call("GET", DUE, undefined, undefined);
    check("2f. signed out: the due list is refused too", signedOutRead.s === 401, `${signedOutRead.s}`);
    for (const bad of [18, 0, -12, 240, 24.5, "abc", "0", true, [24], { m: 24 }]) {
      const r = await call("PUT", FREQ, { months: bad }, OWNER.token);
      check(`2g. ${JSON.stringify(bad)} is refused`, r.s === 400 && r.j.code === "BAD_FREQUENCY" && setting() === null, `${r.s} ${r.text.slice(0, 100)}`);
    }
    const noValue = await call("PUT", FREQ, {}, OWNER.token);
    check("2h. a save that leaves the value out is refused, so it can't clear the setting by accident", noValue.s === 400, `${noValue.s}`);

    const ownerSave = await call("PUT", FREQ, { months: 24 }, OWNER.token);
    check("3a. the owner sets every 24 months", ownerSave.s === 200 && ownerSave.j.months === 24 && setting() === 24, ownerSave.text);
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'competency_nontechnical_frequency' ORDER BY id DESC LIMIT 1").get() as any;
    check("3b. the change is audited, before and after", !!audit && JSON.parse(audit.before_json || "{}").competency_nontechnical_months === null && JSON.parse(audit.after_json || "{}").competency_nontechnical_months === 24 && /Every 24 months/.test(audit.entity_label), JSON.stringify(audit));
    check("3c. a save rewrites no record and nothing else on the lab", records() === recordsBlank && labRow() === labBlank);
    const adminSave = await call("PUT", FREQ, { months: "36" }, ADMINUSER.token);
    check("3d. a lab admin can change it", adminSave.s === 200 && adminSave.j.months === 36 && setting() === 36, adminSave.text);
    const orgId = Number(sqlite.prepare("INSERT INTO organizations (name) VALUES ('Made-up System')").run().lastInsertRowid);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(orgId, labId);
    sqlite.prepare("INSERT INTO organization_members (organization_id, user_id, org_role, status) VALUES (?, ?, 'org_admin', 'active')").run(orgId, ORGADMIN.id);
    const orgSave = await call("PUT", FREQ, { months: 12 }, ORGADMIN.token);
    check("3e. an org admin can change it", orgSave.s === 200 && setting() === 12, orgSave.text);
    sqlite.prepare("UPDATE labs SET organization_id = NULL WHERE id = ?").run(labId);
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(SUPPORT.id);
    const supportSave = await call("PUT", FREQ, { months: 24 }, SUPPORT.token);
    check("3f. Veritas support, with the lab's support access on, reaches it as an admin", supportSave.s === 200 && setting() === 24, supportSave.text);
    const expired = new Date(Date.now() - 30 * 86400000).toISOString();
    const subBefore = (sqlite.prepare("SELECT subscription_expires_at AS e FROM labs WHERE id = ?").get(labId) as any).e;
    sqlite.prepare("UPDATE labs SET subscription_expires_at = ? WHERE id = ?").run(expired, labId);
    const lapsed = await call("PUT", FREQ, { months: 12 }, OWNER.token);
    check("3g. a lapsed lab can read it and can't change it", lapsed.s === 403 && lapsed.j.code === "SUBSCRIPTION_EXPIRED_READ_ONLY" && setting() === 24 && (await call("GET", FREQ, undefined, OWNER.token)).j.months === 24, lapsed.text);
    sqlite.prepare("UPDATE labs SET subscription_expires_at = ? WHERE id = ?").run(subBefore, labId);
    const planBefore = (sqlite.prepare("SELECT plan FROM labs WHERE id = ?").get(labId) as any).plan;
    sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(labId);
    const noPlan = await Promise.all([call("GET", FREQ, undefined, OWNER.token), call("GET", DUE, undefined, OWNER.token), call("PUT", FREQ, { months: 12 }, OWNER.token)]);
    check("3h. a plan without VeritaComp gets none of the three routes", noPlan.every((r) => r.s === 403) && setting() === 24, noPlan.map((r) => r.s).join());
    sqlite.prepare("UPDATE labs SET plan = ? WHERE id = ?").run(planBefore, labId);

    // ── The dates ────────────────────────────────────────────────────────────
    const dueAt = (months: number, today = PINNED) => { sqlite.prepare("UPDATE labs SET competency_nontechnical_months = ? WHERE id = ?").run(months, labId); return nontechnicalDueForLab(sqlite, labId, today); };
    const item = (list: any[], c: number, program = safety) => list.find((i) => i.employeeId === c && i.programId === program);
    const at24 = dueAt(24);
    check("4a. from the paper date when signed back-dated, not the day it was entered", item(at24, annC)?.nextDue === "2026-12-15" && item(at24, annC)?.bucket === "dueSoon90" && item(at24, annC)?.lastPassDate === "2024-12-15", JSON.stringify(item(at24, annC)));
    check("4b. a leap day clamps to the end of February, and that date has passed", item(at24, benC)?.nextDue === "2026-02-28" && item(at24, benC)?.bucket === "overdue" && item(at24, benC)?.daysUntil === -251, JSON.stringify(item(at24, benC)));
    check("4c. the last passing record counts, not an earlier one", item(at24, caraC)?.nextDue === "2028-01-10" && item(at24, caraC)?.bucket === "compliant", JSON.stringify(item(at24, caraC)));
    check("4d. remediation as the newest record: due again now, the last pass kept on the row", item(at24, deeC)?.remediationOpen === true && item(at24, deeC)?.nextDue === PINNED && item(at24, deeC)?.lastPassDate === "2026-01-10" && /Reassessment after remediation due \(Made-up Safety\)/.test(item(at24, deeC)?.reason), JSON.stringify(item(at24, deeC)));
    check("4e. a fail with no pass at all reads the same way", item(at24, noahC)?.remediationOpen === true && item(at24, noahC)?.lastPassDate === null, JSON.stringify(item(at24, noahC)));
    check("4f. signed by timestamp: the lab's own day counts, not UTC's", item(at24, kimC)?.lastPassDate === "2026-02-01" && item(at24, kimC)?.nextDue === "2028-02-01", JSON.stringify(item(at24, kimC)));
    check("4g. someone who doesn't test patients still comes due", item(at24, leeC, lis)?.nextDue === "2027-06-15", JSON.stringify(item(at24, leeC, lis)));
    check("4h. two programs, two dates", item(at24, miaC)?.nextDue === "2026-03-01" && item(at24, miaC, lis)?.nextDue === "2027-03-01", JSON.stringify([item(at24, miaC), item(at24, miaC, lis)]));
    check("4i. someone not linked to VeritaStaff comes due under their VeritaComp name", item(at24, unlinkedC)?.name === "Una Unlinked" && item(at24, unlinkedC)?.staffEmployeeId === null && item(at24, unlinkedC)?.nextDue === "2027-11-20", JSON.stringify(item(at24, unlinkedC)));
    check("4j. a linked person reads under their VeritaStaff name and title", item(at24, benC)?.name === "Ben Reyes" && item(at24, benC)?.title === "Made-up Tech", JSON.stringify(item(at24, benC)));
    check("4k. never signed: no date", !item(at24, eliC));
    check("4l. marked Not applicable on the program: no date", !item(at24, fayC));
    check("4m. inactive in VeritaComp: no date", !item(at24, gusC));
    check("4n. inactive in VeritaStaff: no date", !item(at24, hanaC));
    check("4o. a new-hire evaluation, a technical program and a waived program: no date", !at24.some((i) => [evalProg, techProg, waivedProg].includes(i.programId)) && !at24.some((i) => i.employeeId === ivyC));
    check("4p. another lab's person on this lab's program, and another lab's program: no date", !item(at24, nedC) && !at24.some((i) => i.programId === otherProg));
    check("4q. the list runs from most overdue to latest", at24.every((x, n) => n === 0 || at24[n - 1].daysUntil <= x.daysUntil), JSON.stringify(at24.map((i) => i.daysUntil)));
    check("4r. the same person's dates move with the setting", item(dueAt(12), benC)?.nextDue === "2025-02-28" && item(dueAt(36), benC)?.nextDue === "2027-02-28" && item(dueAt(36), benC)?.bucket === "compliant");
    check("4s. due on the day itself isn't overdue; the day after is", item(dueAt(24, "2026-02-28"), benC)?.bucket === "dueSoon30" && item(dueAt(24, "2026-03-01"), benC)?.bucket === "overdue");
    sqlite.prepare("UPDATE staff_labs SET competency_annual_month = 10 WHERE tier2_lab_id = ?").run(labId);
    check("4t. the lab's annual competency month doesn't move these dates", item(dueAt(24), benC)?.nextDue === "2026-02-28" && item(dueAt(24), annC)?.nextDue === "2026-12-15");
    sqlite.prepare("UPDATE staff_labs SET competency_annual_month = NULL WHERE tier2_lab_id = ?").run(labId);
    dueAt(24);

    // A real sign and a real cohort, end to end.
    const newRec = await call("POST", `${L}/competency/assessments`, { programId: safety, employeeId: eliC, assessmentType: "reassessment", assessmentDate: "2026-01-01", evaluatorName: "Made Up Evaluator", competencyType: "nontechnical", status: "pass", items: [{ itemLabel: "A", itemDescription: "Made-up item", ntItemLabel: "A", ntItemDescription: "Made-up item", ntDateMet: "2026-01-01", passed: true }] }, OWNER.token);
    const newId = newRec.j.id ?? newRec.j.assessment?.id;
    const beforeSign = nontechnicalDueForLab(sqlite, labId, PINNED).some((i) => i.employeeId === eliC);
    const signed = await call("POST", `${L}/competency/assessments/${newId}/sign`, { signed_on_paper_date: "2026-01-05", documentation: "Made-up paper record" }, OWNER.token);
    const afterSign = item(nontechnicalDueForLab(sqlite, labId, PINNED), eliC);
    check("5a. a record saved but not signed has no date; signing it starts the clock from the signed date", !beforeSign && signed.s === 200 && afterSign?.lastPassDate === "2026-01-05" && afterSign?.nextDue === "2028-01-05", `${newRec.s} ${signed.s} ${JSON.stringify(afterSign)}`);
    const cohort = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: safety, employeeIds: [jonC], assessmentType: "annual", assessmentDate: "2025-08-08", status: "pass", evaluatorName: "Made Up Evaluator" }, OWNER.token);
    const jon = item(nontechnicalDueForLab(sqlite, labId, PINNED), jonC);
    check("5b. a record from Cohort Sign-off counts", cohort.s === 200 && jon?.nextDue === "2027-08-08", `${cohort.s} ${cohort.text.slice(0, 120)} ${JSON.stringify(jon)}`);
    // An older Bulk Import or Cohort row can hold 'technical' on a non-technical program. The program's type decides, however the row got there.
    const olderRow = record(lis, jonC, { date: "2025-09-09" });
    sqlite.prepare("UPDATE competency_assessments SET competency_type = 'technical' WHERE id = ?").run(olderRow);
    check("5b2. a row storing 'technical' on a non-technical program still counts", item(nontechnicalDueForLab(sqlite, labId, PINNED), jonC, lis)?.nextDue === "2027-09-09", JSON.stringify(item(nontechnicalDueForLab(sqlite, labId, PINNED), jonC, lis)));
    // Signing a person's next record clears the overdue. Taken back afterward so the checks below read Ben as overdue.
    record(safety, benC, { date: "2026-10-01" });
    const benAfter = item(nontechnicalDueForLab(sqlite, labId, PINNED), benC);
    check("5c. a new passing record ends the overdue and starts the next date", benAfter?.bucket === "compliant" && benAfter?.nextDue === "2028-10-01", JSON.stringify(benAfter));
    sqlite.prepare("DELETE FROM competency_assessments WHERE employee_id = ? AND assessment_date = '2026-10-01'").run(benC);

    // ── Through the route ────────────────────────────────────────────────────
    const apiDue = await call("GET", DUE, undefined, OWNER.token);
    const apiBen = apiDue.j.items?.find((i: any) => i.employeeId === benC);
    check("6a. the route reads the same engine for the lab's own day", apiDue.s === 200 && apiDue.j.months === 24 && apiBen?.nextDue === "2026-02-28" && apiBen?.bucket === "overdue" && apiDue.j.counts.total === apiDue.j.items.length, apiDue.text.slice(0, 200));
    const editorDue = await call("GET", DUE, undefined, EDITOR.token);
    check("6b. an editor sees the lab's list", editorDue.s === 200 && editorDue.j.items.length === apiDue.j.items.length, `${editorDue.s}`);
    const annDue = await call("GET", DUE, undefined, ANN.token);
    check("6c. a Staff login sees only their own rows", annDue.s === 200 && annDue.j.items.length === 1 && annDue.j.items[0].name === "Ann Self" && !/Ben Reyes|Cara Ng|Dee Ortiz|Tess|Reyes/.test(annDue.text) && annDue.j.counts.total === 1, annDue.text.slice(0, 200));
    const nolinkDue = await call("GET", DUE, undefined, NOLINK.token);
    check("6d. a Staff seat with no roster link sees nobody", nolinkDue.s === 200 && nolinkDue.j.items.length === 0, nolinkDue.text.slice(0, 200));
    const compEditDue = await call("GET", DUE, undefined, COMPEDIT.token);
    check("6e. a Staff seat with edit on VeritaComp keeps the list, as everywhere in VeritaComp, and still can't change the setting", compEditDue.j.items?.length === apiDue.j.items.length && (await call("PUT", FREQ, { months: 12 }, COMPEDIT.token)).s === 403 && setting() === 24, `${compEditDue.j.items?.length}`);

    // ── Reminders ────────────────────────────────────────────────────────────
    const [digest, escalation, monthly] = plan();
    check("7a. the digest lists who's overdue and who's coming due", digest.items.some((i) => i.name === "Ben Reyes" && i.reason === "Non-technical competency due (Made-up Safety)") && !digest.items.some((i) => i.name === "Cara Ng"), JSON.stringify(digest.items.map((i) => i.name)));
    check("7b. the digest's words say what's due and when", /Ben Reyes, Made-up Tech: Non-technical competency due \(Made-up Safety\), overdue by 251 days \(due 2026-02-28\)/.test(digest.text), digest.text.slice(0, 400));
    check("7c. someone overdue on non-technical competency goes to the director", escalation.items.some((i) => i.name === "Ben Reyes") && (escalation.newlyOverdueKeys || []).some((k) => /Non-technical competency due \(Made-up Safety\)/.test(k)) && escalation.send === true, JSON.stringify(escalation.newlyOverdueKeys));
    check("7d. the monthly report places them by date", monthly.items.some((i) => i.name === "Ann Self" && i.daysUntil === 39) && /Due in 31 to 60 days[^]*Ann Self/.test(monthly.text), monthly.text.slice(0, 300));
    check("7e. a person inactive or Not applicable stays out of every email", !plan().some((p) => p.items.some((i) => /Fay|Gus|Hana|Eli Unsigned/.test(i.name) && /Non-technical/.test(i.reason))));
    const dry = await runCompetencyReminders({ labId, dryRun: true, todayIso: PINNED });
    check("7f. the nightly run plans the same lines and sends nothing on a dry run", dry.emailsSent === 0 && JSON.stringify(dry.plans).includes("Non-technical competency due (Made-up Safety)"), JSON.stringify(dry).slice(0, 200));
    const preview = await call("GET", `${L}/competency/reminder-preview`, undefined, OWNER.token);
    check("7g. the settings preview shows them too", preview.s === 200 && preview.text.includes("Non-technical competency due (Made-up Safety)"), preview.text.slice(0, 200));
    check("7h. technical lines in the emails don't change at any setting", plan().every((p) => p.items.some((i) => i.reason === technicalLine)) && technicalItems() === technicalPlanBlank && [12, 36].every((m) => { dueAt(m); return technicalItems() === technicalPlanBlank; }), technicalItems().slice(0, 300));
    dueAt(24);

    // ── Technical timing doesn't change, at any setting ──────────────────────
    const tess = (await call("GET", `${L}/competency/employee/${tessStaff}`, undefined, OWNER.token)).j.testSystems as any[];
    const ts = (i: number) => tess.find((t) => t.id === i || t.instrument_id === i || t.instrumentId === i);
    check("8a. 42 CFR 493.1413(b)(9): initial 2026-05-15, the 6-month is due 2026-11-15", ts(MOD)?.nextMilestone === "six_month" && ts(MOD)?.nextDue?.targetDate === "2026-11-15", JSON.stringify(ts(MOD)?.nextDue));
    check("8b. 42 CFR 493.1451(b)(9): the 1st annual stays at initial + 12, 2026-09-10, whatever day the 6-month was done", ts(HIGH)?.nextMilestone === "first_annual" && ts(HIGH)?.nextDue?.targetDate === "2026-09-10", JSON.stringify(ts(HIGH)?.nextDue));
    check("8c. annual thereafter: annual 2026-02-01, next due 2027-02-01", ts(EST)?.nextMilestone === "annual" && ts(EST)?.nextDue?.targetDate === "2027-02-01", JSON.stringify(ts(EST)?.nextDue));
    check("8d. waived: annual from the initial, 2027-03-01, with no 6-month", ts(WAIVEDDEV)?.nextMilestone === "annual" && ts(WAIVEDDEV)?.nextDue?.targetDate === "2027-03-01", JSON.stringify(ts(WAIVEDDEV)?.nextDue));
    const recordsBeforeSaves = records();
    for (const m of [12, 24, 36]) {
      const saved = await call("PUT", FREQ, { months: m }, OWNER.token);
      const same = await technicalSnapshot();
      check(`8e. at every ${m} months, every technical reader answers exactly as at blank: roster, owed, dashboard, method view, register, reminder list, schedules, sign-offs`, saved.s === 200 && same === technicalBlank, same === technicalBlank ? "" : `lengths ${same.length} vs ${technicalBlank.length}`);
    }
    const tessNt = item(nontechnicalDueForLab(sqlite, labId, PINNED), tessC);
    check("8f. the same person is overdue on non-technical competency while their technical dates stand", tessNt?.bucket === "overdue");
    check("8g. saves at every setting rewrote no record", records() === recordsBeforeSaves && JSON.parse(records())[0].length > 10);

    // ── Clear it ─────────────────────────────────────────────────────────────
    const cleared = await call("PUT", FREQ, { months: null }, OWNER.token);
    check("9a. clearing it answers blank", cleared.s === 200 && cleared.j.months === null && setting() === null, cleared.text);
    const clearedDue = await call("GET", DUE, undefined, OWNER.token);
    check("9b. cleared: no due dates again", clearedDue.j.items.length === 0 && nontechnicalDueForLab(sqlite, labId, PINNED).length === 0, clearedDue.text.slice(0, 200));
    check("9c. cleared: technical readers answer exactly as they did", (await technicalSnapshot()) === technicalBlank);
    const clearedPlan = planText();
    check("9d. cleared: the reminder emails go back to the very same text", clearedPlan === blankPlan, `${clearedPlan.length} vs ${blankPlan.length}`);
    const emptyString = await call("PUT", FREQ, { months: "" }, OWNER.token);
    check("9e. an empty value clears it too", emptyString.s === 200 && emptyString.j.months === null, emptyString.text);
    sqlite.prepare("UPDATE labs SET competency_nontechnical_months = 18 WHERE id = ?").run(labId);
    check("9f. a stored value that isn't one of the choices reads as blank, not a due date", nontechnicalDueForLab(sqlite, labId, PINNED).length === 0 && (await call("GET", FREQ, undefined, OWNER.token)).j.months === null);
    sqlite.prepare("UPDATE labs SET competency_nontechnical_months = NULL WHERE id = ?").run(labId);

    // ── Lab scope and sister labs ────────────────────────────────────────────
    await call("PUT", FREQ, { months: 24 }, OWNER.token);
    check("10a. the setting belongs to one lab: the owner's sister lab stays blank", setting(sister) === null && (await call("GET", `${LS}/competency/nontechnical-frequency`, undefined, OWNER.token)).j.months === null);
    const editorSister = await Promise.all([call("GET", `${LS}/competency/nontechnical-frequency`, undefined, EDITOR.token), call("GET", `${LS}/competency/nontechnical-due`, undefined, EDITOR.token), call("PUT", `${LS}/competency/nontechnical-frequency`, { months: 12 }, EDITOR.token)]);
    check("10b. a seat in this lab doesn't reach the sister lab, read or write", editorSister.every((r) => r.s === 403) && setting(sister) === null, editorSister.map((r) => r.s).join());
    const adminSister = await call("PUT", `${LS}/competency/nontechnical-frequency`, { months: 12 }, ADMINUSER.token);
    check("10c. an admin of this lab isn't an admin of the sister lab", adminSister.s === 403 && setting(sister) === null, `${adminSister.s}`);
    const activeHeader = await fetch(`${base}${FREQ}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${EDITOR.token}`, "X-Active-Lab-Id": String(sister) }, body: JSON.stringify({ months: 12 }) });
    check("10d. naming a lab in the header gets nobody further", activeHeader.status === 403 && setting() === 24 && setting(sister) === null, `${activeHeader.status}`);
    const otherReads = await Promise.all([call("GET", FREQ, undefined, OTHER.token), call("GET", DUE, undefined, OTHER.token)]);
    check("10e. another owner reads nothing in this lab", otherReads.every((r) => r.s === 403) && !otherReads.some((r) => /Reyes/.test(r.text)), otherReads.map((r) => r.s).join());
    await call("PUT", `${L2}/competency/nontechnical-frequency`, { months: 12 }, OTHER.token);
    const otherDue = await call("GET", `${L2}/competency/nontechnical-due`, undefined, OTHER.token);
    check("10f. the other lab's list holds only its own program and people", otherDue.s === 200 && otherDue.j.items.length === 1 && otherDue.j.items[0].programId === otherProg && otherDue.j.items[0].name === "Ned OtherLab" && setting(lab2) === 12 && setting() === 24, otherDue.text.slice(0, 200));
    check("10g. a Staff login in this lab can't read the sister lab's list", (await call("GET", `${LS}/competency/nontechnical-due`, undefined, ANN.token)).s === 403);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
