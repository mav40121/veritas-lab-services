// scripts/verify-veritapt-events-ui.mjs
//
// Browser receipt for VeritaPT events, reviews, bias and trend, and the period report (B11, 2026-11-24; server/ptEvents.ts and
// its neighbours). On a local production build with a scratch DB: made-up people, programs and numbers only.
//   U1. the Events tab: every event, filters, sort, the Excel export
//   U2. Record PT Event: an ungraded result needs its reason; it shows as an evaluation still open
//   U3. the laboratory's own evaluation closes it
//   U4. the review needs its link, takes it, and the laboratory director or designee review is recorded once
//   U5. an edited result shows the event as changed since its review
//   U6. the program's report: attached, listed, downloaded
//   U7. Bias and trend: the chart, both measures, "no peer data", the flags and their rules
//   U8. the period report: tiles, PDF, Excel
//   U9. the trend banner lists every flagged analyte and opens a full history
//   U10. Fill from VeritaPT on the method-by-method competency record: filled, named, not marked
//   U11. a Staff login sees the event list alone; a view-only reviewer reads and edits nothing
//   U12. dark mode and phone width: no sideways scroll of the page
// Run: PW_BASE=http://localhost:5711 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritapt-events-ui.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token, lab) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const withDb = (fn) => { const db = new Database(process.env.SCRATCH_DB); db.pragma("foreign_keys = OFF"); try { return fn(db); } finally { db.close(); } };
const sql = (q, ...a) => withDb((db) => (/^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid));
const insert = (table, values) => withDb((db) => {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /INT|REAL/i.test(c.type) ? 0 : "x";
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
});
const pw = ["Pt", "Events", "77!"].join("-");
const stamp = Date.now();
const register = async (tag, name) => {
  const email = `ptev-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, name, token: r.body.token, id: sql("SELECT id FROM users WHERE email = ?", email).id };
};
const member = (lab, u, role = "staff") => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))", lab, u.id, role);

// Made-up people, a lab, its analyzers, programs and results on the scratch DB only
const owner = await register("owner", "Avery Owner"), editor = await register("editor", "Ed Editor"), staff = await register("staff", "Stef Staff"), viewer = await register("viewer", "Vic Viewer");
const A = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Alder Creek Lab", plan: "hospital" })).body.labId;
sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = 'Alder Creek Lab', clia_number = ?, is_demo = 0, plan = 'hospital', subscription_status = 'active' WHERE id = ?", `22D${String(stamp).slice(-7)}`, A);
member(A, editor); member(A, staff); member(A, viewer);
const staffLab = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", A)?.id ?? insert("staff_labs", { user_id: owner.id, tier2_lab_id: A, lab_name: "Alder Creek Lab" });
const person = (first, last, x = {}) => insert("staff_employees", { user_id: owner.id, lab_id: staffLab, tier2_lab_id: A, first_name: first, last_name: last, status: "active", performs_testing: 1, ...x });
const tess = person("Tess", "Tester", { title: "MLS" }), stefRow = person("Stef", "Staff");
const seat = (u, type, perms, roster = null) => insert("user_seats", { owner_user_id: owner.id, seat_email: u.email, seat_user_id: u.id, status: "active", permissions: JSON.stringify(perms), invite_token: `ptev-${stamp}-${u.id}`, lab_id: A, seat_type: type, staff_employee_id: roster, accepted_at: new Date().toISOString() });
seat(editor, "active", { mode: "edit_all" }); seat(staff, "staff_portal", {}, stefRow); seat(viewer, "view_only", { mode: "view_all" });
const map = insert("veritamap_maps", { lab_id: A, user_id: owner.id, name: "Main lab" });
const inst = (name, category) => insert("veritamap_instruments", { map_id: map, instrument_name: name, category });
const chem = inst("Chemix 900", "Chemistry"), heme = inst("Hemix 40", "Hematology");
for (const [i, a] of [[chem, "Glucose"], [chem, "Sodium"], [chem, "Potassium"], [chem, "Calcium"], [heme, "Hemoglobin"], [heme, "Platelets"]]) {
  insert("veritamap_instrument_tests", { instrument_id: i, map_id: map, analyte: a, active: 1, complexity: "MODERATE", specialty: i === chem ? "Chemistry" : "Hematology" });
  insert("veritamap_tests", { map_id: map, analyte: a, active: 1, complexity: "MODERATE", specialty: i === chem ? "Chemistry" : "Hematology" });
}
insert("staff_employee_instruments", { employee_id: tess, instrument_id: chem });
const program = async (vendor, program_name, pt_category) => (await call("POST", `/api/labs/${A}/pt/enrollments`, { vendor, program_name, pt_category, year_enrolled: 2026 }, editor.token)).body.id;
const pChem = await program("API", "Chemistry Core", "General Chemistry"), pHeme = await program("Other", "Hematology Basic", "Hematology");
const rec = async (body) => (await call("POST", `/api/labs/${A}/pt/results`, body, editor.token)).body;
// The last 18 months, so the competency picker offers them
const back = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const D = [back(320), back(200), back(90)];
let firstGlucose = null;
for (const [i, code] of ["2026-A", "2026-B", "2026-C"].entries()) {
  for (const [analyte, x, mean, sd] of [["Glucose", 98 + i * 3, 95 + i, 3], ["Sodium", 139 + (i === 1 ? 4 : 0), 140, 1.4], ["Potassium", 4.1, i === 1 ? null : 4.0, 0.08], ["Calcium", 9.3 + i * 0.1, 9.2, 0.15]]) {
    const r = await rec({ enrollment_id: pChem, event_id: code, event_name: `Chemistry event ${code.slice(-1)}`, event_date: D[i], analyte, your_result: x, peer_mean: mean, peer_sd: sd, peer_n: 140, acceptable_low: mean == null ? null : Math.round((mean - 4 * sd) * 100) / 100, acceptable_high: mean == null ? null : Math.round((mean + 4 * sd) * 100) / 100, pass_fail: analyte === "Sodium" && i === 1 ? "fail" : "pass", tested_by_employee_id: tess, submission_due_date: D[i], submitted_date: i === 2 ? null : D[i] });
    if (analyte === "Glucose" && i === 0) firstGlucose = r.id;
  }
}
const hId = (await rec({ enrollment_id: pHeme, event_id: "H-1", event_date: back(60), analyte: "Hemoglobin", your_result: 14.1, peer_mean: 14.0, peer_sd: 0.2, pass_fail: "pass" })).id;
await rec({ enrollment_id: pHeme, event_id: "H-2", event_date: back(5), analyte: "Hemoglobin", submission_due_date: back(-12) });
for (let i = 0; i < 10; i++) await rec({ enrollment_id: pHeme, event_id: "H-1", event_date: back(60), analyte: `Extra analyte ${i + 1}`, pass_fail: "fail" });
const finding = (await call("POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: back(80), finding_number: "PT-7", standard_ref: "42 CFR 493.1236(a)", description: "Made-up: sodium investigation" }, editor.token)).body.id;

const browser = await chromium.launch();
const openAs = async (who, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 1000 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page error", false, String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, u, l, dark]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem("theme", dark ? "dark" : "light"); }, [who.token, me, A, opts.colorScheme === "dark"]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  if (opts.colorScheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
const tid = (id) => `[data-testid="${id}"]`;
const text = async (page, s) => (await page.locator(s).first().innerText()).replace(/\s+/g, " ").trim();
const until = async (fn, ms = 10000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 150)); } return false; };
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const APP = `/labs/${A}/veritapt/app`;
const tab = async (page, name) => { await page.waitForSelector(tid("pt-tabs"), { timeout: 30000 }); if (name) { await page.click(tid(`pt-tab-${name}`)); } };
const shot = async (page, name, sel) => { if (sel) await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `b11_${name}.png`) }); };
const download = async (page, click) => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), click()]); const f = await d.path(); return { name: d.suggestedFilename(), bytes: fs.readFileSync(f) }; };

// U1
let page = await openAs(editor, APP);
await tab(page, "events");
await page.waitForSelector(tid("pt-event-row"));
const rows = () => page.locator(tid("pt-event-row"));
check("U1. one row per event of every program", (await rows().count()) === 5, String(await rows().count()));
check("U1. a row names its program, analytes, department and statuses", /API Chemistry Core 2026/.test(await rows().last().innerText()) && /Calcium, Glucose, Potassium, Sodium/.test(await rows().last().innerText()) && /Chemistry/.test(await rows().last().innerText()) && /4 Acceptable/.test(await rows().last().innerText()) && /Not reviewed/.test(await rows().last().innerText()));
await shot(page, "events_light", tid("pt-events"));
await page.selectOption(tid("pt-filter-status"), "unacceptable");
check("U1. filter by status", await until(async () => (await rows().count()) === 2));
await page.selectOption(tid("pt-filter-status"), ""); await page.selectOption(tid("pt-filter-department"), "Hematology");
check("U1. filter by department", await until(async () => (await rows().count()) === 2));
await page.selectOption(tid("pt-filter-department"), ""); await page.selectOption(tid("pt-filter-analyte"), "Sodium");
check("U1. filter by analyte", await until(async () => (await rows().count()) === 3) && (await text(page, tid("pt-events-count"))) === "3 of 5 events");
const xl = await download(page, () => page.click(tid("pt-events-export")));
check("U1. the export downloads", /^VeritaPT_Events_.*\.xlsx$/.test(xl.name) && xl.bytes.subarray(0, 2).toString() === "PK");
await page.selectOption(tid("pt-filter-analyte"), ""); await page.click(tid("pt-sort-date"));
check("U1. the date column sorts oldest first", await until(async () => /2026-A/.test(await rows().first().innerText())));

// U2
await page.getByRole("button", { name: "Record PT Event" }).click();
await page.waitForSelector(tid("pt-result-dialog"));
await page.selectOption(tid("pt-result-enrollment_id"), String(pChem));
await page.fill(tid("pt-result-event_id"), "2026-D"); await page.fill(tid("pt-result-analyte"), "Sodium"); await page.fill(tid("pt-result-your_result"), "141");
await page.selectOption(tid("pt-result-status"), "ungraded");
await page.click(tid("pt-result-save"));
check("U2. an ungraded result asks why", await until(async () => /Say why the result was not graded/.test(await text(page, tid("pt-error")))));
await page.selectOption(tid("pt-result-reason"), "no_consensus");
await page.click(tid("pt-result-save"));
check("U2. saved, the list shows it ungraded with its evaluation open", await until(async () => (await rows().count()) === 6 && (await page.locator(tid("pt-open-evaluations")).count()) === 1));
check("U2. and the screen stayed on the Events tab", (await page.locator(tid("pt-events")).count()) === 1);

// U3
const openEvent = async (p, label) => { await p.locator(tid("pt-event-row"), { hasText: label }).locator("button").first().click(); await p.waitForSelector(tid("pt-event-dialog")); await p.waitForSelector(tid("pt-review")); };
await openEvent(page, "2026-D");
check("U3. it says why, and that the evaluation is open", /Lack of consensus/.test(await text(page, tid("pt-ungraded"))) && (await page.locator(tid("pt-evaluation-open")).count()) === 1);
await page.locator(`${tid("pt-ungraded")} button`).first().click();
await page.selectOption(tid("pt-evaluation-method"), "split_sample_external"); await page.fill(tid("pt-evaluation-criteria"), "Within the laboratory's own 4 mmol/L"); await page.fill(tid("pt-evaluation-summary"), "Two split samples, 140 and 141, both within"); await page.selectOption(tid("pt-evaluation-conclusion"), "pass");
await page.click(tid("pt-evaluation-save"));
check("U3. recorded: conclusion, what it was compared against, who and when", await until(async () => /Acceptable, .*Split sample, external reference lab; Within the laboratory's own 4 mmol\/L.*Recorded by Ed Editor on /.test(await text(page, tid("pt-evaluation")))) && (await page.locator(tid("pt-evaluation-open")).count()) === 0);
await page.keyboard.press("Escape");

// U4
await page.waitForSelector(tid("pt-event-dialog"), { state: "detached" });
await openEvent(page, "2026-B");
await page.click(tid("pt-review-start"));
check("U4. an unacceptable result needs its link", (await page.locator(tid("pt-review-needs-link")).count()) === 1);
await page.fill(tid("pt-review-notes"), "Sodium high on event B. Calibration drift found.");
await page.click(tid("pt-review-save"));
check("U4. without one it is refused, in words", await until(async () => /Link its corrective action or investigation/.test(await text(page, `${tid("pt-review-form")} ${tid("pt-error")}`))));
await page.check(tid(`pt-review-finding-${finding}`));
await page.click(tid("pt-review-save"));
check("U4. recorded with its link", await until(async () => /Reviewed by Ed Editor/.test(await text(page, tid("pt-review"))) && /Finding PT-7/.test(await text(page, tid("pt-review")))));
check("U4. the finding is unchanged", sql("SELECT status FROM findings WHERE id = ?", finding).status === "open" && sql("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n === 1);
await page.click(tid("pt-director-review"));
await page.getByRole("button", { name: "Record my review" }).click();
check("U4. the laboratory director or designee review names who", await until(async () => /Laboratory director or designee review: Ed Editor/.test(await text(page, tid("pt-director-reviewed")))) && (await page.locator(tid("pt-director-review")).count()) === 0);
await shot(page, "event_light");
await page.locator(tid("pt-review")).scrollIntoViewIfNeeded();
await shot(page, "event_review_light");

// U5
await page.locator(`${tid("pt-event-dialog")} tr`, { hasText: "Sodium" }).locator("button").click();
await page.waitForSelector(tid("pt-result-dialog"));
check("U5. the form opens on what is on file", (await page.inputValue(tid("pt-result-your_result"))) === "143" && (await page.inputValue(tid("pt-result-event_id"))) === "2026-B" && (await page.inputValue(tid("pt-result-enrollment_id"))) === String(pChem));
await page.fill(tid("pt-result-your_result"), "144"); await page.click(tid("pt-result-save"));
check("U5. the event reads changed since review, the review kept", await until(async () => (await page.locator(`${tid("pt-event-dialog")} ${tid("pt-review-changed")}`).count()) === 1) && /Reviewed by Ed Editor/.test(await text(page, tid("pt-review"))));

// U6
check("U6. the screen says what the file may carry and that it isn't read", /sample ids/.test(await text(page, tid("pt-document-phi"))) && /doesn't read these files/.test(await text(page, tid("pt-document-phi"))));
const { PDFDocument } = require("pdf-lib");
const doc = await PDFDocument.create(); doc.addPage([300, 300]); const bytes = Buffer.from(await doc.save());
await page.setInputFiles(tid("pt-document-input"), { name: "Program report B.pdf", mimeType: "application/pdf", buffer: bytes });
check("U6. attached and listed", await until(async () => /Program report B\.pdf .*attached .* by Ed Editor/.test(await text(page, tid("pt-documents")))));
const got = await download(page, () => page.getByRole("button", { name: "Download" }).click());
check("U6. it downloads as it went in", got.name === "Program report B.pdf" && got.bytes.equals(bytes));
await page.setInputFiles(tid("pt-document-input"), { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Made-up") });
check("U6. anything else is refused, in words", await until(async () => /Attach a PDF or an image/.test(await text(page, `${tid("pt-documents")} ${tid("pt-error")}`))));
await page.keyboard.press("Escape");

// U7
await tab(page, "bias");
await page.waitForSelector(tid("pt-bias"));
const rules = await text(page, tid("pt-bias-rules"));
check("U7. each flag's rule is on the screen, and a flag isn't a finding", /same side of its peer mean, three results or more/.test(rules) && /three events in a row/.test(rules) && /isn't a finding about the method/.test(rules));
check("U7. the flags say flag for review", (await page.locator(tid("pt-bias-flag")).count()) > 0 && (await page.locator(tid("pt-bias-flag")).allInnerTexts()).every((t) => t.trim().startsWith("Flag for review:")));
await page.selectOption(tid("pt-bias-analyte"), "Glucose");
await page.waitForSelector(`${tid("pt-bias-chart")} svg`);
check("U7. the chart draws a dot per result and the program's range behind it", (await page.locator(`${tid("pt-bias-chart")} .recharts-line-dot`).count()) === 3 && (await page.locator(`${tid("pt-bias-chart")} .recharts-bar-rectangle`).count()) === 3);
const g0 = await text(page, tid(`pt-bias-row-${firstGlucose}`));
check("U7. the table has the same numbers: +3, +3.16%, +1.00", / \+3 \+3\.16% \+1\.00 /.test(` ${g0} `), g0);
await page.locator(`${tid("pt-bias-chart")} .recharts-line-dot`).first().hover();
check("U7. the tooltip reads the percent difference", await until(async () => /\+3\.16%/.test(await text(page, ".recharts-tooltip-wrapper"))));
await shot(page, "bias_light", tid("pt-bias-chart"));
await page.click(tid("pt-bias-sdi"));
check("U7. one measure at a time: SDI", await until(async () => (await page.getAttribute(tid("pt-bias-sdi"), "aria-pressed")) === "true" && /SDI/.test(await text(page, "h3, .text-base.font-semibold >> nth=1"))));
await page.selectOption(tid("pt-bias-analyte"), "Potassium");
check("U7. a result with no peer mean reads no peer data, never zero, and has no dot", await until(async () => (await page.locator(`${tid("pt-bias-table")} tbody tr`, { hasText: "2026-B" }).innerText()).split("no peer data").length === 5 && (await page.locator(`${tid("pt-bias-chart")} .recharts-line-dot`).count()) === 2));

check("U7. every analyte's trend history is there, flagged or not", (await page.locator(`${tid("pt-bias-trends")} ${tid("pt-trend-all")}`).innerText()) === "Show the 4 other analytes, all OK" && await (async () => { await page.click(`${tid("pt-bias-trends")} ${tid("pt-trend-all")}`); await page.click(`${tid("pt-bias-trends")} ${tid("pt-trend-Calcium")}`); return until(async () => (await page.locator(`${tid("pt-bias-trends")} ${tid("pt-trend-history-Calcium")} tbody tr`).count()) === 3); })());

// U8
await tab(page, "report");
await page.waitForSelector(tid("pt-report-tiles"));
await page.selectOption(tid("pt-report-kind"), "year"); await page.selectOption(tid("pt-report-year"), D[2].slice(0, 4));
await page.waitForSelector(tid("pt-report-tiles"));
check("U8. the rate and what sits beside it", await until(async () => /acceptable of \d+ graded\. Beside it, not counted in the rate: 1 ungraded, 1 not yet graded/.test(await text(page, tid("pt-report-rate-words")))));
check("U8. the sections are there", (await page.locator(`${tid("pt-report-due")}, ${tid("pt-report-analyte")}, ${tid("pt-report-department")}, ${tid("pt-report-open")}, ${tid("pt-report-trends")}`).count()) === 5 && /Sodium/.test(await text(page, tid("pt-report-analyte"))));
await shot(page, "report_light", tid("pt-report"));
const pdf = await download(page, () => page.click(tid("pt-report-pdf")));
check("U8. the PDF downloads", pdf.name === `VeritaPT_Report_${D[2].slice(0, 4)}.pdf` && pdf.bytes.subarray(0, 5).toString() === "%PDF-");
fs.writeFileSync(path.join(OUT, "b11_report.pdf"), pdf.bytes);
const rx = await download(page, () => page.click(tid("pt-report-excel")));
check("U8. the Excel file downloads", rx.name === `VeritaPT_Report_${D[2].slice(0, 4)}.xlsx` && rx.bytes.subarray(0, 2).toString() === "PK");

// U9
const flagged = await page.locator(`${tid("pt-trend-list")} > ul`).first().locator("li").count();
check("U9. the banner lists every flagged analyte, not eight", flagged === 11, String(flagged));
await page.click(tid("pt-trend-Sodium"));
check("U9. an analyte opens its full history with the flag after each event", await until(async () => (await page.locator(`${tid("pt-trend-history-Sodium")} tbody tr`).count()) === 4 && /Ungraded, not counted/.test(await text(page, tid("pt-trend-history-Sodium")))));

// U10
page = await openAs(editor, `/labs/${A}/veritacomp-app/employee/${tess}`);
await page.waitForSelector(tid("element-5-fill-pt"), { timeout: 30000 });
await page.click(tid("element-5-fill-pt"));
await page.waitForSelector(`${tid("pt-sample-picker")} tbody tr`);
check("U10. it offers what this person tested for this method's analytes", (await page.locator(`${tid("pt-sample-picker")} tbody tr`).count()) === 12 && !/Hemoglobin/.test(await text(page, tid("pt-sample-picker"))));
await page.locator(`${tid("pt-sample-picker")} tbody tr`, { hasText: "Glucose" }).last().getByRole("button", { name: "Select" }).click();
check("U10. filled, and it says where it came from", await until(async () => (await page.inputValue(tid("element-5-sampleType-0"))) === "PT, from VeritaPT™" && (await page.inputValue(tid("element-5-sampleId-0"))) === `2026-A, Chemistry event A, Glucose, ${D[0]}` && (await page.isChecked(tid("element-5-acceptable-0")))));
check("U10. the element isn't marked", !(await page.isChecked(tid("element-5-pass"))));
await page.locator(tid("element-5")).scrollIntoViewIfNeeded();
await shot(page, "competency_light", tid("element-5"));
await page.click(tid("save-test-system"));
check("U10. saved, it is still unmarked and unsigned", await until(() => sql("SELECT COUNT(*) AS n FROM competency_assessment_items WHERE el5_sample_type = 'PT, from VeritaPT™' AND passed = 0").n === 1) && sql("SELECT COUNT(*) AS n FROM competency_method_signoffs WHERE lab_id = ?", A).n === 0);

// U11
page = await openAs(staff, APP);
await tab(page, "events");
await page.waitForSelector(tid("pt-event-row"));
check("U11. a Staff login sees Coverage and Events only, with no export, no event screen and no review", (await page.locator(`${tid("pt-tabs")} [role="tab"]`).count()) === 2 && (await page.locator(tid("pt-events-export")).count()) === 0 && (await page.locator('[data-testid^="pt-event-open-"]').count()) === 0 && (await page.locator('[data-testid^="pt-review-"]').count()) === 0);
page = await openAs(viewer, APP);
await tab(page, "events");
await page.waitForSelector(tid("pt-event-row"));
await openEvent(page, "2026-B");
check("U11. a view-only reviewer reads the review and is offered nothing to change", /Reviewed by Ed Editor/.test(await text(page, tid("pt-review"))) && (await page.locator(`${tid("pt-review-start")}, ${tid("pt-review-again")}, ${tid("pt-document-add")}, ${tid("pt-event-add-result")}, ${tid("pt-event-dates-save")}, [data-testid^="pt-result-edit-"]`).count()) === 0 && (await page.locator(`${tid("pt-documents")} ${'[data-testid^="pt-document-get-"]'}`).count()) === 1);

// U12
const dark = { colorScheme: "dark" };
page = await openAs(editor, APP, dark);
await tab(page, "events"); await page.waitForSelector(tid("pt-event-row"));
check("U12. dark mode is on", await page.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(page, "events_dark", tid("pt-events"));
await openEvent(page, "2026-B"); await shot(page, "event_dark");
await page.keyboard.press("Escape"); await page.waitForSelector(tid("pt-event-dialog"), { state: "detached" });
await tab(page, "bias"); await page.selectOption(tid("pt-bias-analyte"), "Glucose"); await page.waitForSelector(`${tid("pt-bias-chart")} svg`); await shot(page, "bias_dark", tid("pt-bias-chart"));
const ink = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="pt-bias-chart"] .recharts-line-curve')).stroke);
check("U12. the line has its own dark color", ink !== "rgb(1, 105, 111)", ink);
await tab(page, "report"); await page.waitForSelector(tid("pt-report-tiles")); await shot(page, "report_dark", tid("pt-report"));
page = await openAs(editor, `/labs/${A}/veritacomp-app/employee/${tess}`, dark);
await page.waitForSelector(tid("element-5-fill-pt"), { timeout: 30000 }); await shot(page, "competency_dark", tid("element-5"));
const phone = { viewport: { width: 390, height: 844 } };
page = await openAs(editor, APP, phone);
for (const name of ["events", "bias", "report"]) {
  await tab(page, name);
  await page.waitForSelector(tid(name === "events" ? "pt-event-row" : name === "bias" ? "pt-bias" : "pt-report-tiles"));
  if (name === "bias") { await page.selectOption(tid("pt-bias-analyte"), "Glucose"); await page.waitForSelector(`${tid("pt-bias-chart")} svg`); }
  check(`U12. ${name} at phone width: the page doesn't scroll sideways`, (await sideways(page)) <= 0, String(await sideways(page)));
  if (name === "bias") await shot(page, "bias_phone", tid("pt-bias-chart"));
}
await tab(page, "events"); await openEvent(page, "2026-B");
check("U12. the event screen fits a phone", (await page.locator(tid("pt-event-dialog")).evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1 && (await sideways(page)) <= 0, String(await page.locator(tid("pt-event-dialog")).evaluate((el) => el.scrollWidth - el.clientWidth)));
await shot(page, "event_phone");
void hId;

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
