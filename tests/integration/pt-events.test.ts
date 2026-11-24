// tests/integration/pt-events.test.ts
//
// STANDING integration test for VeritaPT events (B11, 2026-11-24; server/ptEvents.ts, shared/ptEvents.ts).
//   1. The event list: grouping, program, department, dates, filters, sort, the Excel export, recording and editing a result.
//   2. Result status: ungraded and its reason, the laboratory's own evaluation, and the two-of-three flags with their full history,
//      which an ungraded result never moves.
//   3. The review of a whole event: what it saw, what it links to (never opened by itself), the laboratory director or designee
//      review, and an event changed since.
//   4. Bias and trend: the numbers worked out on the server, "no peer data" where there is none, and the two review flags.
//   5. The period report: on screen, as Excel and as a PDF, with the compliance digest's numbers unchanged.
//   6. Into the method-by-method competency record: events the person tested, for the method's analytes; it marks nothing.
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

  // ── 3. The review of an event ─────────────────────────────────────────────
  const detail = async (id: number, who: any = EDITOR) => (await call(who, "GET", P(`events/${id}`))).j;
  const review = (who: any, d: any, body: any = {}, lab = A) => call(who, "POST", P("event-reviews", lab), { result_id: d.event.id, review_token: d.review_token, notes: "", corrective_action_ids: [], finding_ids: [], ...body });
  const okRow = (await rec(EDITOR, { enrollment_id: hemeProg, event_id: "H-1", analyte: "Hemoglobin", pass_fail: "pass", your_result: 13.9 })).j.id;
  const okRow2 = (await rec(EDITOR, { enrollment_id: hemeProg, event_id: "H-1", analyte: "Platelets" })).j.id;
  let d = await detail(okRow);
  check("3a. a new event reads not reviewed, and waits while a result is not yet graded", d.event.review.state === "not_reviewed" && d.event.counts.not_graded === 1 && (await review(EDITOR, d)).j?.code === "NOT_GRADED");
  await call(EDITOR, "PUT", P(`results/${okRow2}`), { pass_fail: "pass" });
  d = await detail(okRow);
  check("3b. it needs no link when everything is acceptable", d.needs_link === false && d.options.corrective_actions.length === 0);
  for (const [who, u2] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of another module", SCAN_ONLY], ["another customer", OTHER], ["Veritas support", SUPPORT]] as const) {
    const r = await review(u2, d);
    check(`3c. ${who} can't record a review`, r.s === 403 && (u2 !== SUPPORT || r.j?.code === "VLS_SUPPORT_CANNOT_SIGN"), `${r.s} ${r.text.slice(0, 100)}`);
  }
  check("3d. another lab can't review it", (await review(OTHER, d, {}, X)).s === 404 && one("SELECT COUNT(*) AS n FROM pt_event_reviews").n === 0);
  const rv = await review(EDITOR, d, { notes: "Made-up notes" });
  d = await detail(okRow);
  check("3e. recorded: notes, who and when; the event and the list read reviewed", rv.s === 201 && d.event.review.state === "reviewed" && d.reviews[0].notes === "Made-up notes" && d.reviews[0].reviewed_by_name === "Ed Editor" && !!d.reviews[0].reviewed_at && (await eventNamed("H-1")).review.state === "reviewed");
  const ra = w.audits("pt_event_review", rv.j.id);
  check("3f. one audit row holding what the review saw", ra.length === 1 && ra[0].user_id === EDITOR.id && JSON.parse(JSON.parse(ra[0].after_json).results_json).length === 2);
  check("3g. it opened nothing", one("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n === 0 && one("SELECT COUNT(*) AS n FROM pt_corrective_actions WHERE lab_id = ?", A).n === 0);

  // Director or designee
  const dir = (who: any, id: number, lab = A) => call(who, "POST", P(`event-reviews/${id}/director-review`, lab), {});
  for (const [who, u3] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of another module", SCAN_ONLY], ["another customer", OTHER], ["Veritas support", SUPPORT]] as const) {
    const r = await dir(u3, rv.j.id);
    check(`3h. ${who} can't record the laboratory director or designee review`, r.s === 403 && (u3 !== SUPPORT || r.j?.code === "VLS_SUPPORT_CANNOT_SIGN"));
  }
  check("3i. nor another lab", (await dir(OTHER, rv.j.id, X)).s === 404 && one("SELECT director_reviewed_at FROM pt_event_reviews WHERE id = ?", rv.j.id).director_reviewed_at === null);
  const dr = await call(OWNER, "POST", P(`event-reviews/${rv.j.id}/director-review`), { director_id: 1, director_reviewed_at: "2020-01-01", director_name: "Someone Else" });
  const drow = one("SELECT * FROM pt_event_reviews WHERE id = ?", rv.j.id);
  check("3j. recorded for the person signed in at the server's time, whatever is sent", dr.s === 200 && drow.director_id === OWNER.id && drow.director_name === "Avery Owner" && drow.director_reviewed_at.slice(0, 4) !== "2020");
  check("3k. once only, with its audit row", (await dir(OWNER, rv.j.id)).j?.code === "ALREADY_REVIEWED" && w.audits("pt_event_review", rv.j.id).length === 2 && JSON.parse(w.audits("pt_event_review", rv.j.id)[1].after_json).director_id === OWNER.id);

  // Changed since
  await call(EDITOR, "PUT", P(`results/${okRow}`), { your_result: 14.2 });
  d = await detail(okRow);
  check("3l. a result changed afterwards shows on the event, and the review is kept", d.event.review.state === "changed" && d.reviews.length === 1 && (await eventNamed("H-1")).review.state === "changed");
  const second = await review(EDITOR, d, { notes: "Again" });
  check("3m. a second review goes in front; the director or designee review is not carried to it", second.s === 201 && (await detail(okRow)).reviews.map((r: any) => r.notes).join() === "Again,Made-up notes" && (await detail(okRow)).event.review.director_reviewed_at === null);
  await call(EDITOR, "PUT", P(`results/${okRow}`), { notes: "only a note" });
  await call(EDITOR, "PATCH", P(`events/${okRow}/dates`), { submitted_date: "2026-03-09" });
  check("3n. a note or a date doesn't reopen it", (await detail(okRow)).event.review.state === "reviewed");
  const stale = await detail(okRow);
  await rec(EDITOR, { enrollment_id: hemeProg, event_id: "H-1", analyte: "Hematocrit", pass_fail: "pass" });
  check("3o. a review of an event that changed under it is refused; a result added later reads as changed", (await review(EDITOR, stale)).j?.code === "EVENT_CHANGED" && (await eventNamed("H-1")).review.state === "changed" && (await dir(OWNER, second.j.id)).j?.code === "EVENT_CHANGED");

  // Links
  const bad = (await rec(EDITOR, { enrollment_id: chemProg, event_id: "L-1", analyte: "Glucose", pass_fail: "fail" })).j.id;
  const badU = (await rec(EDITOR, { enrollment_id: chemProg, event_id: "L-1", analyte: "Sodium", pass_fail: "ungraded", ungraded_reason: "educational" })).j.id;
  d = await detail(bad);
  check("3p. an unacceptable or ungraded result needs its corrective action or investigation", d.needs_link === true && (await review(EDITOR, d)).j?.code === "LINK_REQUIRED");
  const ca = Number((await call(EDITOR, "POST", "/api/veritapt/corrective-actions", { event_id: bad, corrective_action: "Made-up action", date_initiated: "2026-03-20" }, A)).j.id);
  const caOther = Number((await call(EDITOR, "POST", "/api/veritapt/corrective-actions", { event_id: okRow, corrective_action: "Another event's action", date_initiated: "2026-03-20" }, A)).j.id);
  const f1 = Number((await call(EDITOR, "POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01", standard_ref: "42 CFR 493.1253" })).j.id);
  const f2 = seed("findings", { user_id: OWNER.id, lab_id: A, accreditor: "Other", source_type: "pt_failure", pt_analyte: "Glucose", status: "open" });
  const fX = Number((await call(OTHER, "POST", `/api/labs/${X}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01", standard_ref: "42 CFR 493.1253" })).j.id);
  d = await detail(bad);
  check("3q. what can be linked: this event's corrective actions, and the lab's findings with the proficiency testing one first", d.options.corrective_actions.map((c: any) => c.id).join() === String(ca) && d.options.findings.map((x: any) => x.id).join() === `${f2},${f1}`, JSON.stringify(d.options));
  check("3r. another event's action or another lab's finding is refused", (await review(EDITOR, d, { corrective_action_ids: [caOther] })).s === 400 && (await review(EDITOR, d, { finding_ids: [fX] })).s === 400);
  const before3 = one("SELECT * FROM findings WHERE id = ?", f2), n3 = one("SELECT COUNT(*) AS n FROM findings").n;
  const linked = await review(EDITOR, d, { corrective_action_ids: [ca], finding_ids: [f2] });
  d = await detail(bad);
  check("3s. a review with its links", linked.s === 201 && d.reviews[0].corrective_actions[0].corrective_action === "Made-up action" && d.reviews[0].findings[0].id === f2);
  check("3t. linking opens, changes and closes nothing", one("SELECT COUNT(*) AS n FROM findings").n === n3 && JSON.stringify(one("SELECT * FROM findings WHERE id = ?", f2)) === JSON.stringify(before3) && one("SELECT status FROM pt_corrective_actions WHERE id = ?", ca).status === "open");
  await call(EDITOR, "POST", P(`results/${badU}/evaluations`), EV);
  check("3u. with the ungraded one evaluated acceptable and no unacceptable result, no link is needed", await (async () => { await call(EDITOR, "PUT", P(`results/${bad}`), { pass_fail: "pass" }); const x = await detail(bad); return x.needs_link === false && (await review(EDITOR, x)).s === 201; })());
  await call(EDITOR, "POST", P(`results/${badU}/evaluations`), { ...EV, conclusion: "fail" });
  check("3v. an evaluation that found it unacceptable needs one again, and shows the event as changed", (await detail(bad)).needs_link === true && (await detail(bad)).event.review.state === "changed");
  sqlite.prepare("DELETE FROM findings WHERE id = ?").run(f2);
  check("3w. a linked record no longer on file stays named on the review", (await detail(bad)).reviews[1].findings[0].id === f2 && (await detail(bad)).reviews[1].findings[0].status === null);
  check("3x. a view-only reviewer reads the review and gets nothing to link", (await detail(bad, VIEWER)).reviews.length === 2 && (await detail(bad, VIEWER)).options === null);
  check("3y. a limited Staff login's list carries no review", (await list(STAFF)).events.every((e: any) => e.review === null) && !JSON.stringify(await list(STAFF)).includes("Ed Editor"));
  check("3z. a reviewed result can't be deleted", (await call(EDITOR, "DELETE", `/api/veritapt/events/${okRow}`, undefined, A)).j?.code === "HOLDS_RECORDS");
  await review(EDITOR, await detail(bad), { corrective_action_ids: [ca] });
  const xv = rowsOf((await book((await call(EDITOR, "GET", P("events/export.xlsx"))).buf)).getWorksheet("Events"));
  check("3aa. the export carries the review", xv.some((r) => r.includes("Reviewed") && r.includes("Ed Editor")) && xv.some((r) => r.includes("Changed since review")) && xv.some((r) => r.includes("Not reviewed")));

  // ── 4. Bias and trend ─────────────────────────────────────────────────────
  const bias = async (who: any = EDITOR) => (await call(who, "GET", P("bias"))).j;
  const q = (event_id: string, event_date: string, analyte: string, your_result: number | null, peer_mean: number | null, extra: any = {}) => rec(EDITOR, { enrollment_id: chemProg, event_id, event_date, analyte, your_result, peer_mean, peer_sd: 2, pass_fail: "pass", ...extra });
  await q("Q-1", "2026-01-10", "Calcium", 9.4, 9.2, { acceptable_low: 8.2, acceptable_high: 10.2 });
  await q("Q-2", "2026-02-10", "Calcium", 9.6, 9.5);
  await q("Q-2b", "2026-02-20", "Calcium", 9.9, null);
  await q("Q-3", "2026-03-10", "Calcium", 9.1, 9.0);
  for (const [a, x] of [["Iron", 51], ["Lipase", 52], ["Uric Acid", 53]] as const) await q("Q-4", "2026-04-10", a, x, 50);
  for (const x of [49, 48, 47]) await q("Q-5", "2026-05-10", "Iron", x, 50);
  let bd = await bias();
  const ca4 = bd.analytes.find((a: any) => a.analyte === "Calcium");
  check("4a. each result's difference, percent difference and SDI come from the server", ca4.points[0].difference === 0.2 && ca4.points[0].percent === 2.17 && ca4.points[0].sdi === 0.1 && ca4.points[0].range_percent[0] === -10.87 && ca4.points[1].range_percent[0] === null, JSON.stringify(ca4.points[0]));
  check("4b. a result with no peer mean says so: nothing is zero", (() => { const p = ca4.points.find((x: any) => x.event === "Q-2b"); return p.difference === null && p.percent === null && p.sdi === null && p.side === null; })());
  check("4c. points run oldest first", ca4.points.map((p: any) => p.event).join() === "Q-1,Q-2,Q-2b,Q-3");
  check("4d. three events in a row on one side, the one without peer data left out", ca4.flags.length === 1 && ca4.flags[0].rule === "three_events" && /above the peer mean in 3 events in a row \(Q-1, 2026-01-10; Q-2, 2026-02-10; Q-3, 2026-03-10\)/.test(ca4.flags[0].text), JSON.stringify(ca4.flags));
  check("4e. one event, all its results on one side", bd.event_flags.some((f: any) => /all 3 results of Q-4 are above their peer mean/.test(f.text)));
  check("4f. one analyte's results of one event, all on one side", bd.analytes.find((a: any) => a.analyte === "Iron").flags.some((f: any) => f.rule === "same_event" && /all 3 Iron results of Q-5 are below the peer mean/.test(f.text)));
  check("4g. every flag says flag for review and none says biased or unacceptable; the rules come with it", [...bd.event_flags, ...bd.analytes.flatMap((a: any) => a.flags)].every((f: any) => /^Flag for review: /.test(f.text) && !/biased|unacceptable/i.test(f.text)) && Object.keys(bd.rules).length === 2);
  check("4h. the analyte's two-of-three history rides along", bd.analytes.find((a: any) => a.analyte === "Calcium").trend.history.length === 4);
  await q("Q-6", "2026-06-10", "Calcium", 8.9, 9.0);
  await q("Q-7", "2026-07-10", "Calcium", 9.3, 9.0);
  check("4i. a later event on the other side ends the run and keeps it on the record", (await bias()).analytes.find((a: any) => a.analyte === "Calcium").flags.length === 1);
  check("4j. a view-only reviewer reads it; a limited Staff login and another customer don't", (await call(VIEWER, "GET", P("bias"))).s === 200 && (await call(STAFF, "GET", P("bias"))).j?.code === "STAFF_OWN_ONLY" && (await call(OTHER, "GET", P("bias"))).s === 403);
  check("4k. a qualitative row (no number) isn't charted", !bd.analytes.some((a: any) => a.analyte === "Chloride"));

  // ── 5. The period report ──────────────────────────────────────────────────
  // In lab B, so its numbers are only these.
  const LB = (body: any) => seed("pt_events", { enrollment_id: bProg, user_id: OWNER.id, lab_id: B, peer_mean: null, ...body });
  sqlite.prepare("DELETE FROM pt_events WHERE lab_id = ?").run(B);
  const row5 = (event_id: string, event_date: string, analyte: string, pass_fail: string, x: any = {}) => LB({ event_id, event_date, analyte, pass_fail, ...x });
  row5("R-0", "2025-12-20", "Glucose", "fail"); // before the year
  const r1Id = row5("R-1", "2026-01-15", "Glucose", "pass", { submission_due_date: "2026-01-20", submitted_date: "2026-01-18" });
  row5("R-1", "2026-01-15", "Sodium", "pass", { submission_due_date: "2026-01-20", submitted_date: "2026-01-18" });
  row5("R-2", "2026-02-15", "Glucose", "fail", { submission_due_date: "2026-02-20", submitted_date: "2026-02-21" });
  row5("R-2", "2026-02-15", "Sodium", "ungraded", { submission_due_date: "2026-02-20", submitted_date: "2026-02-21", ungraded_reason: "no_consensus" });
  row5("R-3", "2026-03-31", "Glucose", "pass", { submission_due_date: "2026-03-30" });
  row5("R-3", "2026-03-31", "Sodium", "pending", { submission_due_date: "2026-03-30" });
  row5("R-4", "2026-04-01", "Glucose", "fail", { submission_due_date: "2099-04-20" }); // after Q1
  const report = async (period: string, who: any = OWNER, lab = B) => (await call(who, "GET", `${P("report", lab)}?period=${period}`)).j;
  let R5 = await report("2026-Q1");
  check("5a. the quarter's days and label", R5.period.start === "2026-01-01" && R5.period.end === "2026-03-31" && R5.period.label === "Q1 2026 (January to March)");
  check("5b. results by status, by event date, both ends in", R5.results.acceptable === 3 && R5.results.unacceptable === 1 && R5.results.ungraded === 1 && R5.results.not_graded === 1 && R5.results.graded === 4, JSON.stringify(R5.results));
  check("5c. the rate is acceptable over graded; ungraded and not yet graded are never in it", R5.results.acceptable_rate === 75 && (await report("2026-01")).results.acceptable_rate === 100 && (await report("2026-06")).results.acceptable_rate === null);
  check("5d. events due: on time, late, and past due with no submitted date on file", R5.due.total === 3 && R5.due.counts.on_time === 1 && R5.due.counts.late === 1 && R5.due.counts.not_recorded === 1 && R5.due.events.map((e: any) => e.event).join() === "R-1,R-2,R-3");
  check("5e. unacceptable and ungraded by analyte and by department, and they add up", R5.by_analyte.map((a: any) => `${a.name}:${a.unacceptable}:${a.ungraded}`).join() === "Glucose:1:0,Sodium:0:1" && R5.by_department.length === 1 && R5.by_department[0].name === "No department on VeritaMap" && R5.by_department[0].unacceptable === R5.results.unacceptable && R5.by_department[0].ungraded === R5.results.ungraded);
  check("5f. open reviews: an event with a status back and no review, and one with only pending results isn't one", R5.open_reviews.map((e: any) => e.event).join() === "R-1,R-2,R-3" && R5.open_evaluations === 1 && (await report("2026-01")).open_reviews.length === 1);
  const dB = (await call(OWNER, "GET", P(`events/${r1Id}`, B))).j;
  await call(OWNER, "POST", P("event-reviews", B), { result_id: r1Id, review_token: dB.review_token, corrective_action_ids: [], finding_ids: [] });
  check("5g. a reviewed event leaves the list", (await report("2026-Q1")).open_reviews.map((e: any) => e.event).join() === "R-2,R-3");
  // Glucose, graded: fail 12/20, pass 1/15, fail 2/15, pass 3/31, fail 4/1
  check("5h. two of three as of the period's last day, not as of now", (await report("2026-01")).two_of_three.map((t: any) => `${t.analyte}:${t.state}`).join() === "Glucose:WATCH" && (await report("2026-02")).two_of_three.map((t: any) => `${t.analyte}:${t.state}`).join() === "Glucose:AT-RISK" && (await report("2026-Q1")).two_of_three.map((t: any) => `${t.analyte}:${t.state}`).join() === "Glucose:WATCH" && (await report("2026")).two_of_three.map((t: any) => `${t.analyte}:${t.state}`).join() === "Glucose:AT-RISK");
  for (const bad5 of ["", "2026-13", "2026-Q5", "26", "2026-1", "soon"]) check(`5i. period "${bad5}": refused`, (await call(OWNER, "GET", `${P("report", B)}?period=${bad5}`)).s === 400);
  check("5j. a leap February ends on the 29th", (await report("2028-02")).period.end === "2028-02-29");

  // The digest: the same numbers as before, and the same as the report
  const { digestCountsForLab } = await import("../../server/digestCounts");
  const oldCount = (pf: string, s0: string, e0: string) => one(`SELECT COUNT(*) AS n FROM pt_events WHERE lab_id = ? AND pass_fail IN (${pf}) AND substr(event_date, 1, 10) BETWEEN ? AND ?`, B, s0, e0).n;
  for (const [s0, e0, per] of [["2026-02-01", "2026-02-28", "2026-02"], ["2026-03-01", "2026-03-31", "2026-03"], ["2026-01-01", "2026-03-31", "2026-Q1"]] as const) {
    const g = (digestCountsForLab as any)(sqlite, B, s0, e0);
    const pt = g.sections?.pt ?? g.pt;
    const rp = await report(per), ytd = await report("2026");
    check(`5k. the digest's VeritaPT line for ${per} is the query it had, and the report's`, pt.unacceptableInMonth === oldCount("'fail'", s0, e0) && pt.acceptableYearToDate === oldCount("'pass'", "2026-01-01", e0) && pt.gradedYearToDate === oldCount("'pass','fail'", "2026-01-01", e0) && rp.results.unacceptable === pt.unacceptableInMonth && ytd.results.graded >= pt.gradedYearToDate, JSON.stringify(pt));
  }

  // Excel and PDF
  const rx = await book((await call(OWNER, "GET", `${P("report/export.xlsx", B)}?period=2026-Q1`)).buf);
  const sum5 = Object.fromEntries(rowsOf(rx.getWorksheet("Summary")).map((r) => [r[0], r[1]]));
  check("5l. the Excel report carries the same numbers", rx.worksheets.map((s) => s.name).join() === "About,Summary,Events Due,By Analyte,By Department,Open Reviews,Two of Three" && sum5["Events due in the period"] === 3 && sum5["Acceptable rate (acceptable / graded)"] === "75.0%" && sum5["Beside the rate: ungraded"] === 1 && sum5["Beside the rate: not yet graded"] === 1 && rowsOf(rx.getWorksheet("Two of Three"))[0][0] === "Glucose", JSON.stringify(sum5));
  const tk = await call(OWNER, "GET", `${P("report/pdf", B)}?period=2026-Q1`);
  const pdf5 = await call(OWNER, "GET", `/api/pdf/${tk.j?.token}`);
  check("5m. the PDF comes through the token store", tk.s === 200 && tk.j.filename === "VeritaPT_Report_2026-Q1.pdf" && pdf5.s === 200 && pdf5.buf.subarray(0, 5).toString() === "%PDF-", tk.text.slice(0, 200));
  const { buildPtReportHTML } = await import("../../server/ptReportPdf");
  const html = buildPtReportHTML({ ...R5, by_analyte: [{ name: "<b>Glucose</b> & co", unacceptable: 1, ungraded: 0 }] }, { labName: "A <i>Lab</i>", clia: null });
  check("5n. what the lab typed is escaped; a missing CLIA says so; nothing is signed", html.includes("&lt;b&gt;Glucose&lt;/b&gt; &amp; co") && !html.includes("<i>Lab") && html.includes("CLIA: Not on file") && !/signature/i.test(html) && html.includes("laboratory director or designee") && !html.includes("\u2014"));
  check("5o. a limited Staff login, another customer and an outsider to the sister lab don't read it, on screen or as a file", await (async () => {
    const r = await Promise.all(["report", "report/export.xlsx", "report/pdf"].flatMap((x) => [call(STAFF, "GET", `${P(x)}?period=2026`), call(OTHER, "GET", `${P(x)}?period=2026`), call(EDITOR, "GET", `${P(x, B)}?period=2026`)]));
    return r.every((x) => x.s === 403) && (await call(VIEWER, "GET", `${P("report")}?period=2026`)).s === 200;
  })());

  // ── 6. Into the method-by-method competency record ────────────────────────
  seed("staff_employee_instruments", { employee_id: tess, instrument_id: chem });
  const picks = (who: any, person = tess, instrument = chem, lab = A) => call(who, "GET", `/api/labs/${lab}/competency/employee/${person}/test-system/${instrument}/pt-samples`);
  const day6 = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10), old6 = new Date(Date.now() - 800 * 86400000).toISOString().slice(0, 10);
  const c6 = async (analyte: string, x: any = {}) => Number((await rec(EDITOR, { enrollment_id: chemProg, event_id: "K-1", event_date: day6, analyte, pass_fail: "pass", your_result: 5, tested_by_employee_id: tess, ...x })).j.id);
  const kG = await c6("Glucose"), kNa = await c6("Sodium", { pass_fail: "fail" }), kK = await c6("Potassium", { pass_fail: "ungraded", ungraded_reason: "not_scored" }), kAlt = await c6("ALT");
  await c6("Hemoglobin"); await c6("Glucose", { event_id: "K-mo", tested_by_employee_id: mo }); await c6("Glucose", { event_id: "K-none", tested_by_employee_id: null }); await c6("Glucose", { event_id: "K-old", event_date: old6 });
  seed("pt_events", { enrollment_id: bProg, user_id: OWNER.id, lab_id: B, event_id: "K-B", event_date: day6, analyte: "Glucose", pass_fail: "pass", tested_by_employee_id: tess });
  const pk = (await picks(EDITOR)).j as any[];
  const mine6 = pk.filter((x) => x.eventId.startsWith("K-"));
  check("6a. only what this person tested, for this method's analytes, in this lab, in the last 18 months", mine6.map((x) => x.id).sort((a, b) => a - b).join() === [kG, kNa, kK, kAlt].sort((a, b) => a - b).join(), JSON.stringify(mine6.map((x) => [x.eventId, x.analyte])));
  check("6b. acceptable and unacceptable fill Acceptable; an ungraded one fills none", pk.find((x) => x.id === kG).suggestedAcceptable === 1 && pk.find((x) => x.id === kNa).suggestedAcceptable === 0 && pk.find((x) => x.id === kK).suggestedAcceptable === null && pk.find((x) => x.id === kK).statusLabel === "Ungraded");
  for (const [who, u6, want] of [["a Staff login", STAFF, 403], ["a view-only reviewer", VIEWER, 403], ["another customer", OTHER, 403]] as const) check(`6c. ${who}: refused`, (await picks(u6)).s === want);
  check("6d. another lab's person or analyzer isn't found", (await picks(OWNER, tess, chem, B)).s === 404 && (await picks(EDITOR, mo)).s === 404 && (await picks(EDITOR, tess, heme)).s === 404);
  // What the evaluator saves after a fill: a sample row, and nothing marked
  const before6 = one("SELECT COUNT(*) AS n FROM competency_method_signoffs").n;
  const sv = await call(EDITOR, "PUT", `/api/labs/${A}/competency/employee/${tess}/test-system/${chem}`, { elements: [{ num: 5, samples: [{ sampleType: "PT, from VeritaPT", sampleId: `K-1, Glucose, ${day6}`, acceptable: true }] }] });
  const view6 = (await call(EDITOR, "GET", `/api/labs/${A}/competency/employee/${tess}`)).j.testSystems.find((t: any) => t.instrumentId === chem);
  const el5 = view6.elements.find((e: any) => e.num === 5);
  check("6e. saved, it shows where it came from, isn't passed and signs nothing", sv.s === 200 && el5.samples[0].sampleType === "PT, from VeritaPT" && el5.samples[0].sampleId.startsWith("K-1, Glucose") && el5.passed === false && view6.signedCurrent !== true && one("SELECT COUNT(*) AS n FROM competency_method_signoffs").n === before6, JSON.stringify(el5));
  // The program record's picker: the same function, the same fields
  const prog = Number((await call(EDITOR, "POST", `/api/labs/${A}/competency/programs`, { name: "Made-up chemistry", department: "Chemistry", type: "technical" })).j?.id ?? seed("competency_programs", { user_id: OWNER.id, lab_id: A, name: "Made-up chemistry", department: "Chemistry", type: "technical" }));
  seed("competency_method_groups", { program_id: prog, name: "Chem", analytes: JSON.stringify(["Glucose"]) });
  const pp = await call(EDITOR, "GET", `/api/labs/${A}/veritacomp/programs/${prog}/pt-samples`);
  check("6f. the program record's picker answers as before, from its own lab only", pp.s === 200 && pp.j.some((x: any) => x.id === kG && x.suggestedSampleId === "K-1" && x.suggestedSampleType === "PT" && x.suggestedAcceptable === 1) && pp.j.some((x: any) => x.eventId === "K-mo") && !pp.j.some((x: any) => x.eventId === "K-B") && pp.j.every((x: any) => x.analyte === "Glucose"));

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
