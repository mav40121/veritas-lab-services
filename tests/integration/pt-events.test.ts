// tests/integration/pt-events.test.ts
//
// STANDING integration test for VeritaPT events (B11, 2026-11-24; server/ptEvents.ts, shared/ptEvents.ts).
//   1. The event list: grouping, program, department, dates, filters, sort, the Excel export, recording and editing a result.
//   2. Result status: ungraded and its reason, the laboratory's own evaluation, and the two-of-three flags with their full history,
//      which an ungraded result never moves.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up people, programs and numbers only). Run: npm run test:pt-events
import { inspectionWorld } from "./inspectionFixture";

async function main() {
  const w = await inspectionWorld("ptev");
  const { A, B, X, call, check, one, all, seed, sqlite } = w;
  const { OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, SUPPORT } = w;
  const { default: ExcelJS } = await import("exceljs");
  const P = (rest: string, lab = A) => `/api/labs/${lab}/pt/${rest}`;
  const book = async (buf: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any); return wb; };
  // A data sheet's rows below its heading row (the About sheet alone carries the license band).
  const rowsOf = (ws: any) => { const out: any[][] = []; ws.eachRow((r: any, n: number) => { if (n > 1) out.push((r.values as any[]).slice(1)); }); return out; };

  // Lab A's analyzers, roster and programs
  const map = seed("veritamap_maps", { lab_id: A, user_id: OWNER.id, name: "Made-up map" });
  const inst = (name: string, category: string) => seed("veritamap_instruments", { map_id: map, instrument_name: name, category });
  const chem = inst("Chemix 900", "Chemistry"), heme = inst("Hemix 40", "Hematology");
  const test = (instrument: number, analyte: string, active = 1) => seed("veritamap_instrument_tests", { instrument_id: instrument, map_id: map, analyte, active, complexity: "MODERATE" });
  for (const a of ["Glucose", "Sodium", "Potassium", "Alanine Aminotransferase (ALT)"]) test(chem, a);
  test(heme, "Hemoglobin"); test(heme, "Retired Assay", 0);
  const tess = w.roster("Tess", "Tester"), mo = w.roster("Mo", "Member");
  const v2 = (lab: number, name: string, vendor = "API", year = 2026) => seed("pt_enrollments_v2", { user_id: lab === X ? OTHER.id : OWNER.id, lab_id: lab, vendor, program_name: name, pt_category: "General Chemistry", year_enrolled: year });
  const chemProg = v2(A, "Chemistry Core"), hemeProg = v2(A, "Hematology Basic", "WSLH"), bProg = v2(B, "Lab B Program"), xProg = v2(X, "Lab X Program");
  const rec = (who: any, body: any, lab = A) => call(who, "POST", P("results", lab), { event_date: "2026-03-02", ...body });
  const list = async (who: any = EDITOR, lab = A) => (await call(who, "GET", P("events", lab))).j;
  const eventNamed = async (name: string, who: any = EDITOR) => (await list(who)).events.find((e: any) => e.name === name);

  // ── 1. The event list ─────────────────────────────────────────────────────
  const g1 = await rec(EDITOR, { enrollment_id: chemProg, event_id: "2026-A", analyte: "Glucose", your_result: 98, peer_mean: 95, peer_sd: 3, acceptable_low: 85, acceptable_high: 105, pass_fail: "pass", tested_by_employee_id: tess, submission_due_date: "2026-03-10" });
  check("1a. recording a result from the lab-scoped route", g1.s === 201 && g1.j.lab_id === A && g1.j.sdi === 1 && g1.j.user_id === OWNER.id && g1.j.tested_by_employee_id === tess, g1.text.slice(0, 200));
  await rec(EDITOR, { enrollment_id: chemProg, event_id: "2026-a ", analyte: "Sodium", your_result: 139, pass_fail: "fail", event_date: "2026-03-03", submission_due_date: "2026-03-10" });
  await rec(EDITOR, { enrollment_id: chemProg, analyte: "Potassium", event_date: "2026-06-01" });
  await rec(EDITOR, { enrollment_id: hemeProg, event_id: "2026-A", analyte: "Hemoglobin", event_date: "2026-03-02", pass_fail: "pass", your_result: 14.1 });
  await rec(EDITOR, { enrollment_id: chemProg, event_id: "2026-A", analyte: "ALT", event_date: "2025-03-02", pass_fail: "pass" });
  let L = await list();
  check("1b. results of one program sharing a code are one event; another program, another year and a bare date are their own", L.events.length === 4, JSON.stringify(L.events.map((e: any) => [e.name, e.program, e.results.length])));
  const eA = L.events.find((e: any) => e.program_key === `v2|${chemProg}` && e.event_date === "2026-03-02");
  check("1c. the event names its program, analytes, departments and counts by status", eA?.program === "API Chemistry Core 2026" && eA.analytes.join() === "Glucose,Sodium" && eA.departments.join() === "Chemistry" && eA.counts.acceptable === 1 && eA.counts.unacceptable === 1, JSON.stringify(eA));
  check("1d. a department is the VeritaMap analyzer's, by its name or its CLIA name; none reads as none", L.events.find((e: any) => e.analytes[0] === "ALT")?.departments[0] === "Chemistry" && L.events.find((e: any) => e.analytes[0] === "Hemoglobin")?.departments[0] === "Hematology");
  check("1e. it lists every enrolled program for the filter, with events or not", L.programs.map((p: any) => p.label).sort().join("|") === "API Chemistry Core 2026|WSLH Hematology Basic 2026", JSON.stringify(L.programs));
  check("1f. the tester's name is read from this lab's roster", eA.results.find((r: any) => r.analyte === "Glucose").tested_by === "Tess Tester");

  // The older store: pt_enrollments rows, one per analyte, whose ids can be the same numbers
  const old = seed("pt_enrollments", { id: chemProg, user_id: OWNER.id, lab_id: A, analyte: "Vancomycin", specialty: "Chemistry", pt_provider: "CAP", program_code: "TDM-1", enrollment_year: 2026, enrollment_date: "2026-01-01" });
  const oldRow = seed("pt_events", { enrollment_id: old, user_id: OWNER.id, lab_id: A, event_id: "T-1", event_date: "2026-02-01", analyte: "Vancomycin", pass_fail: "pass" });
  const lost = seed("pt_events", { enrollment_id: 987654, user_id: OWNER.id, lab_id: A, event_id: "Lost", event_date: "2026-02-02", analyte: "Glucose", pass_fail: "pending" });
  L = await list();
  check("1g. an older analyte enrollment is told from a program with the same id by its analyte", old === chemProg && (await eventNamed("T-1"))?.program === "CAP TDM-1 2026" && L.events.find((e: any) => e.program_key === `v2|${chemProg}` && e.event_date === "2026-03-02")?.program === "API Chemistry Core 2026");
  check("1h. an enrollment no longer on file says so", (await eventNamed("Lost"))?.program === "Program not on file");
  sqlite.prepare("DELETE FROM pt_events WHERE id IN (?, ?)").run(oldRow, lost);

  // Dates
  check("1i. a due date with no submitted date is never late; past due it says no submitted date is on file", eA.due_date === "2026-03-10" && eA.submitted_date === null && eA.submission === "not_recorded");
  check("1j. one date for every result of the event", (await call(EDITOR, "PATCH", P(`events/${eA.id}/dates`), { submitted_date: "2026-03-09" })).s === 200 && (await list()).events.find((e: any) => e.key === eA.key).submission === "on_time" && all("SELECT submitted_date FROM pt_events WHERE lab_id = ? AND lower(trim(event_id)) = '2026-a' AND event_date LIKE '2026%' AND enrollment_id = ?", A, chemProg).every((r) => r.submitted_date === "2026-03-09"));
  await call(EDITOR, "PATCH", P(`events/${eA.id}/dates`), { submitted_date: "2026-03-11" });
  check("1k. a submitted date after the due date is late", (await list()).events.find((e: any) => e.key === eA.key).submission === "late");
  check("1l. a bad date or none is refused", (await call(EDITOR, "PATCH", P(`events/${eA.id}/dates`), { submitted_date: "soon" })).s === 400 && (await call(EDITOR, "PATCH", P(`events/${eA.id}/dates`), {})).s === 400);

  // Editing
  const gid = g1.j.id;
  const up = await call(EDITOR, "PUT", P(`results/${gid}`), { your_result: 101 });
  check("1m. an edit changes what it names, works out the SDI again and keeps the rest", up.s === 200 && up.j.your_result === 101 && up.j.sdi === 2 && up.j.pass_fail === "pass" && up.j.submitted_date === "2026-03-11" && up.j.tested_by_employee_id === tess);
  const clr = await call(EDITOR, "PUT", P(`results/${gid}`), { peer_mean: null });
  check("1n. without a peer mean there is no SDI, never zero", clr.j.sdi === null && clr.j.peer_mean === null);
  await call(EDITOR, "PUT", P(`results/${gid}`), { your_result: 98, peer_mean: 95 });
  for (const [what, body] of [["a status that isn't one", { pass_fail: "maybe" }], ["a result that isn't a number", { your_result: "high" }], ["a low above its high", { acceptable_low: 9, acceptable_high: 3 }], ["no analyte", { analyte: " " }], ["a date that isn't one", { event_date: "3/2/26" }]] as const) {
    const r = await call(EDITOR, "PUT", P(`results/${gid}`), body);
    check(`1o. ${what}: refused`, r.s === 400 && !!r.j?.error, `${r.s} ${r.text.slice(0, 120)}`);
  }
  check("1p. another lab's program or person is refused", (await rec(EDITOR, { enrollment_id: xProg, analyte: "Glucose" })).s === 400 && (await rec(EDITOR, { enrollment_id: bProg, analyte: "Glucose" })).s === 400 && (await rec(EDITOR, { enrollment_id: chemProg, analyte: "Glucose", tested_by_employee_id: 99999 })).s === 400);
  const au = w.audits("pt_result", gid);
  check("1q. each write has an audit row: who, before and after", au[0].action === "create" && au[0].module === "veritapt" && au[0].user_id === EDITOR.id && au[0].owner_user_id === OWNER.id && JSON.parse(au.find((a) => /: dates$/.test(a.entity_label)).after_json).submitted_date === "2026-03-09" && JSON.parse(au.filter((a) => a.action === "update" && !/: dates$/.test(a.entity_label))[0].before_json).your_result === 98 && JSON.parse(au[au.length - 1].after_json).peer_mean === 95);

  // The Excel export is the list
  const xl = await call(EDITOR, "GET", P("events/export.xlsx"));
  let wb = await book(xl.buf);
  check("1r. the export opens on About and holds one row per event and per result", xl.s === 200 && wb.worksheets.map((s) => s.name).join() === "About,Events,Results" && rowsOf(wb.getWorksheet("Events")).length === 4 && rowsOf(wb.getWorksheet("Results")).length === 5);
  const labRow = one("SELECT lab_name, clia_number FROM labs WHERE id = ?", A);
  check("1s. the lab's name is on About and in every header and footer, and every sheet is protected", JSON.stringify(wb.getWorksheet("About")!.getColumn(1).values).includes(labRow.lab_name) && wb.worksheets.every((s: any) => s.headerFooter.oddHeader.includes(labRow.lab_name) && s.headerFooter.oddFooter.includes(labRow.lab_name) && s.headerFooter.oddFooter.length <= 255 && s.sheetProtection?.sheet));
  wb = await book((await call(VIEWER, "GET", `${P("events/export.xlsx")}?department=Hematology`)).buf);
  check("1t. filters cut the export the way they cut the list", rowsOf(wb.getWorksheet("Events")).length === 1 && rowsOf(wb.getWorksheet("Results"))[0][2] === "Hemoglobin");
  for (const [q, n] of [["analyte=Sodium", 1], ["status=unacceptable", 1], ["status=not_graded", 1], [`program=${encodeURIComponent(`v2|${chemProg}`)}`, 3], ["from=2026-03-01&to=2026-03-31", 2]] as const) {
    const b = await book((await call(EDITOR, "GET", `${P("events/export.xlsx")}?${q}`)).buf);
    check(`1u. ${q}: ${n}`, rowsOf(b.getWorksheet("Events")).length === n);
  }
  wb = await book((await call(EDITOR, "GET", `${P("events/export.xlsx")}?sort=event&dir=desc`)).buf);
  const names = rowsOf(wb.getWorksheet("Events")).map((r) => r[0]);
  check("1v. and sort it", names.join() === names.slice().sort((a: string, b: string) => b.toLowerCase().localeCompare(a.toLowerCase())).join());

  // Who
  const before = one("SELECT COUNT(*) AS n FROM pt_events").n;
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of another module", SCAN_ONLY], ["another customer", OTHER]] as const) {
    const r = await Promise.all([rec(u, { enrollment_id: chemProg, analyte: "Glucose" }), call(u, "PUT", P(`results/${gid}`), { your_result: 1 }), call(u, "PATCH", P(`events/${eA.id}/dates`), { submitted_date: "2026-03-01" })]);
    check(`1w. ${who} can't record, edit or date an event`, r.every((x) => x.s === 403), r.map((x) => x.s).join());
  }
  check("1x. and nothing was written", one("SELECT COUNT(*) AS n FROM pt_events").n === before && one("SELECT your_result FROM pt_events WHERE id = ?", gid).your_result === 98);
  check("1y. another customer reads nothing here, and a result of theirs isn't found from here", (await call(OTHER, "GET", P("events"))).s === 403 && (await call(OTHER, "GET", P(`events/${eA.id}`))).s === 403 && (await call(OTHER, "GET", P(`events/${eA.id}`, X))).s === 404 && (await call(OTHER, "PUT", P(`results/${gid}`, X), { your_result: 1 })).s === 404);
  const bRow = seed("pt_events", { enrollment_id: bProg, user_id: OWNER.id, lab_id: B, event_id: "B-1", event_date: "2026-03-02", analyte: "Glucose", pass_fail: "fail" });
  check("1z. a sister lab's event is not this lab's", !(await list()).events.some((e: any) => e.name === "B-1") && (await call(EDITOR, "GET", P(`events/${bRow}`))).s === 404 && (await call(EDITOR, "GET", P("events", B))).s === 403);
  const s = await list(STAFF);
  check("1aa. a limited Staff login reads the same results, no coworker's name, no event screen and no export", s.own_only === true && s.can_edit === false && s.events.length === 4 && !JSON.stringify(s).includes("Tess") && (await call(STAFF, "GET", P(`events/${eA.id}`))).j?.code === "STAFF_OWN_ONLY" && (await call(STAFF, "GET", P("events/export.xlsx"))).j?.code === "STAFF_OWN_ONLY");
  check("1bb. signed out: refused", (await call(null, "GET", P("events"))).s === 401);
  check("1cc. a view-only reviewer reads it and is told it can't edit", (await list(VIEWER)).can_edit === false && (await list(EDITOR)).can_edit === true);
  check("1dd. the older routes answer as before", (await call(EDITOR, "GET", "/api/veritapt/events", undefined, A)).j.length === 5 && (await call(EDITOR, "POST", "/api/veritapt/events", { enrollment_id: hemeProg, event_date: "2026-03-02", event_id: "2026-A", analyte: "Platelets", pass_fail: "pass" }, A)).s === 200);

  // ── 2. Result status ──────────────────────────────────────────────────────
  // The flag rule as GET /api/veritapt/trends had it before this change, worked out here from the rows.
  const oldTrends = () => {
    const by: Record<string, any[]> = {};
    for (const e of all("SELECT analyte, event_date, pass_fail FROM pt_events WHERE lab_id = ? AND pass_fail IN ('pass', 'fail') ORDER BY analyte ASC, event_date DESC", A)) (by[e.analyte] ||= []).push(e);
    return Object.keys(by).map((a) => { const n = by[a].slice(0, 3).filter((e) => e.pass_fail === "fail").length; return `${a}:${n >= 2 ? "AT-RISK" : n === 1 ? "WATCH" : "OK"}:${n}`; }).sort().join("|");
  };
  const trends = async (who: any = EDITOR) => (await call(who, "GET", "/api/veritapt/trends", undefined, A)).j;
  const newTrends = async () => (await trends()).trends.map((t: any) => `${t.analyte}:${t.state}:${t.fails_in_last_3}`).sort().join("|");
  const dateOf = (n: number) => `2026-0${n}-15`;
  for (const [n, pf] of [[1, "fail"], [2, "pass"], [3, "fail"], [4, "pass"], [5, "pass"]] as const) await rec(EDITOR, { enrollment_id: chemProg, event_id: `C-${n}`, analyte: "Chloride", event_date: dateOf(n), pass_fail: pf });
  const flags0 = await newTrends(), sum0 = (await call(EDITOR, "GET", "/api/veritapt/summary", undefined, A)).j;
  check("2a. the flags read as they did", flags0 === oldTrends() && flags0.includes("Chloride:WATCH:1"), flags0);
  const ungradedIds: number[] = [];
  for (let i = 0; i < 3; i++) ungradedIds.push((await rec(EDITOR, { enrollment_id: chemProg, event_id: `C-U${i}`, analyte: "Chloride", event_date: `2026-06-1${i}`, pass_fail: "ungraded", ungraded_reason: "no_consensus" })).j?.id);
  check("2b. three ungraded results move no flag, no pass rate and no open corrective action", (await newTrends()) === flags0 && oldTrends() === flags0 && (await call(EDITOR, "GET", "/api/veritapt/summary", undefined, A)).j.passRate === sum0.passRate);
  const cl = (await trends()).trends.find((t: any) => t.analyte === "Chloride");
  check("2c. the full history is there, newest first, with the flag each graded result left and none for an ungraded one", cl.history.map((h: any) => `${h.pass_fail}:${h.state}`).join() === "ungraded:null,ungraded:null,ungraded:null,pass:WATCH,pass:WATCH,fail:AT-RISK,pass:WATCH,fail:WATCH", JSON.stringify(cl.history));
  check("2d. every flagged analyte is in the answer, not eight", await (async () => {
    for (let i = 0; i < 10; i++) seed("pt_events", { enrollment_id: hemeProg, user_id: OWNER.id, lab_id: A, event_id: "F", event_date: "2026-04-01", analyte: `Made-up ${i}`, pass_fail: "fail" });
    const t = await trends();
    const ok = t.trends.filter((x: any) => x.state !== "OK").length === t.counts.WATCH + t.counts.AT_RISK && t.counts.WATCH >= 11 && (await newTrends()) === oldTrends();
    sqlite.prepare("DELETE FROM pt_events WHERE lab_id = ? AND analyte LIKE 'Made-up %'").run(A);
    return ok;
  })());

  // The reason
  for (const [what, body, code] of [["no reason", { pass_fail: "ungraded" }, "UNGRADED_REASON_REQUIRED"], ["a reason that isn't one", { pass_fail: "ungraded", ungraded_reason: "lost" }, "UNGRADED_REASON_REQUIRED"], ["other with no words", { pass_fail: "ungraded", ungraded_reason: "other" }, "UNGRADED_REASON_REQUIRED"]] as const) {
    const r = await rec(EDITOR, { enrollment_id: chemProg, analyte: "Chloride", ...body });
    const o = await call(EDITOR, "POST", "/api/veritapt/events", { enrollment_id: chemProg, event_date: "2026-03-02", analyte: "Chloride", ...body }, A);
    check(`2e. ungraded with ${what}: refused on both routes`, r.s === 400 && r.j?.code === code && o.s === 400 && o.j?.code === code);
  }
  const uOld = await call(EDITOR, "POST", "/api/veritapt/events", { enrollment_id: chemProg, event_date: "2026-07-02", event_id: "C-O", analyte: "Chloride", pass_fail: "ungraded", ungraded_reason: "other", ungraded_reason_text: "Vial arrived broken" }, A);
  check("2f. the older route stores the reason too, and clears it with the status", uOld.s === 200 && uOld.j.ungraded_reason === "other" && uOld.j.ungraded_reason_text === "Vial arrived broken" && (await call(EDITOR, "PUT", `/api/veritapt/events/${uOld.j.id}`, { pass_fail: "pass" }, A)).j.ungraded_reason === null);
  const u = ungradedIds[0];
  const ev = async () => (await call(EDITOR, "GET", P(`events/${u}`))).j.event;
  check("2g. it is open until the laboratory records its own evaluation", (await ev()).open_evaluations === 1 && (await ev()).results[0].evaluation_open === true && (await ev()).results[0].status === "ungraded");

  // The evaluation
  const EV = { method: "split_sample_external", acceptance_criteria: "Within the laboratory's own limit of 5 mmol/L", result_summary: "Two splits, both within", conclusion: "pass", performed_date: "2026-06-20" };
  const evaluate = (who: any, id: number, body: any = EV, lab = A) => call(who, "POST", P(`results/${id}/evaluations`, lab), body);
  for (const [what, body] of [["no method", { ...EV, method: "" }], ["a method that isn't on the list", { ...EV, method: "guess" }], ["other undescribed", { ...EV, method: "other" }], ["no criteria", { ...EV, acceptance_criteria: " " }], ["no conclusion", { ...EV, conclusion: "" }], ["a conclusion that isn't one", { ...EV, conclusion: "fine" }], ["no date", { ...EV, performed_date: "" }], ["a date ahead", { ...EV, performed_date: "2099-01-01" }]] as const) {
    check(`2h. an evaluation with ${what}: refused`, (await evaluate(EDITOR, u, body)).s === 400);
  }
  for (const [who, p] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of another module", SCAN_ONLY], ["another customer", OTHER], ["Veritas support", SUPPORT]] as const) {
    const r = await evaluate(p, u);
    check(`2i. ${who} can't record one`, r.s === 403 && (p !== SUPPORT || r.j?.code === "VLS_SUPPORT_CANNOT_SIGN"), `${r.s} ${r.text.slice(0, 120)}`);
  }
  check("2j. another lab's result isn't found, and a graded one doesn't take one", (await evaluate(OTHER, u, EV, X)).s === 404 && (await evaluate(EDITOR, g1.j.id)).j?.code === "NOT_UNGRADED" && one("SELECT COUNT(*) AS n FROM pt_event_evaluations").n === 0);
  const flags1 = await newTrends();
  const done = await evaluate(EDITOR, u);
  const r1 = (await ev()).results[0];
  check("2k. recorded: what it was compared against, the conclusion, who and when", done.s === 201 && r1.evaluation_open === false && r1.evaluations[0].method === EV.method && r1.evaluations[0].acceptance_criteria === EV.acceptance_criteria && r1.evaluations[0].conclusion === "pass" && r1.evaluations[0].recorded_by_name === "Ed Editor" && !!r1.evaluations[0].recorded_at && r1.evaluations[0].performed_date === "2026-06-20");
  check("2l. it closes the evaluation and changes no status or flag", r1.status === "ungraded" && (await newTrends()) === flags1 && (await ev()).open_evaluations === 0);
  check("2m. one audit row, by who recorded it", w.audits("pt_evaluation", done.j.id).length === 1 && w.audits("pt_evaluation", done.j.id)[0].user_id === EDITOR.id && JSON.parse(w.audits("pt_evaluation", done.j.id)[0].before_json).ungraded_reason === "no_consensus");
  await evaluate(OWNER, u, { ...EV, conclusion: "fail" });
  check("2n. a second one is added in front, the first kept", (await ev()).results[0].evaluations.map((x: any) => x.conclusion).join() === "fail,pass");
  check("2o. a limited Staff login reads the status and no evaluation", await (async () => { const j = await list(STAFF); const row = j.events.flatMap((e: any) => e.results).find((r: any) => r.id === u); return row.status === "ungraded" && row.evaluations.length === 0 && !JSON.stringify(j).includes("Two splits"); })());
  check("2p. a result holding one can't be deleted, nor its enrollment", (await call(EDITOR, "DELETE", `/api/veritapt/events/${u}`, undefined, A)).j?.code === "HOLDS_RECORDS" && (await call(EDITOR, "DELETE", `/api/veritapt/enrollments/${old}`, undefined, A)).j?.code === "HOLDS_RECORDS" && !!one("SELECT id FROM pt_events WHERE id = ?", u) && (await call(EDITOR, "DELETE", `/api/veritapt/events/${ungradedIds[2]}`, undefined, A)).s === 200);
  const xr = await book((await call(EDITOR, "GET", `${P("events/export.xlsx")}?status=ungraded`)).buf);
  check("2q. the export says why and what the laboratory concluded, or that it is open", rowsOf(xr.getWorksheet("Results")).some((r) => r.includes("Lack of consensus") && r.some((c) => String(c).startsWith("Unacceptable on 2026-06-20. Split sample"))) && rowsOf(xr.getWorksheet("Results")).some((r) => r.includes("Open")));
  check("2r. the reminders still read only pending results", one("SELECT COUNT(*) AS n FROM pt_events WHERE lab_id = ? AND pass_fail = 'pending' AND id = ?", A, u).n === 0);
  void mo;

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
