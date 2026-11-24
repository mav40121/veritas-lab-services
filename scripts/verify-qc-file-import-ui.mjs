// scripts/verify-qc-file-import-ui.mjs
//
// Browser receipt for VeritaQC's file import and sigma metric (B12, 2026-11-24). On a local production build with a scratch DB, made-up people,
// analyzers, lots and results:
//   R1. upload a CSV: its columns and first rows show; a file with a patient column is refused by naming it
//   R2. match the columns, save the mapping, preview: the three counts, each row's reason, and what a late or signed-month row means
//   R3. choose what a name means; the preview runs again and the row is ready
//   R4. import after a confirm that names the counts; the import opens with the corrective actions its rejections need; file one
//   R5. the run on VeritaQC and in Review & Sign-off says where it came from, and that it was added after the review
//   R6. the same file again: nothing is ready. A file that changed between preview and import is refused and previewed again.
//   R7. a second file with the saved mapping, and a wide Excel file
//   R8. take an import back: which stay and why, the reason, then the list says so
//   R9. the sigma metric: not enough to compute, then a number with its formula and inputs, no color by value; a peer mean
//   R10. a view-only seat and a Staff login get no button and a note; phone width doesn't overflow
// Screenshots b12_*.png, light and dark. Run: PW_BASE=http://localhost:5212 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-qc-file-import-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Import", "Ui", "77!"].join("-"), stamp = Date.now(), now = new Date().toISOString();

const ownerEmail = `qcui-owner-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email: ownerEmail, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "QC Import Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", ownerEmail);
sql("UPDATE labs SET is_demo = 0, time_zone = 'America/New_York' WHERE id = ?", labId);
const token = reg.body.token, ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o, L = `/api/labs/${labId}`;
const person = async (tag, name, staff) => {
  const email = `qcui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  const id = Number(r.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  if (staff) {
    const sl = Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'QC Import Test Lab', '99D0000125', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
    const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Stafford', 'Sam', 'active', ?, ?)", sl, labId, ownerId, now, now).lastInsertRowid);
    sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`, ownerId, email, id, labId, emp, now, now);
  } else {
    sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'active')`, ownerId, email, id, now, now, `qcui-${tag}-${stamp}`, labId);
  }
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return (await call("POST", "/api/auth/login", { email, password: pw })).body.token;
};
const staffToken = await person("staff", "Sam Stafford", true), viewToken = await person("view", "Vic Viewer", false);
const mapId = Number(sql("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Core lab', '[]', ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const anA = Number(sql("INSERT INTO veritamap_instruments (map_id, instrument_name, nickname, role, category, created_at) VALUES (?, 'Made-up 500', 'Analyzer A', 'Primary', 'Chemistry', ?)", mapId, now).lastInsertRowid);
Number(sql("INSERT INTO veritamap_instruments (map_id, instrument_name, nickname, role, category, created_at) VALUES (?, 'Made-up 500', 'Analyzer B', 'Backup', 'Chemistry', ?)", mapId, now).lastInsertRowid);
const lot = async (analyte, level, lot_number, mfr_mean, mfr_sd) => (await call("POST", `${L}/qc/control-lots`, { analyte, level, lot_number, mfr_mean, mfr_sd }, token)).body.lot.id;
const glu = await lot("Glucose", "Low", "45921", 100, 2), gluHi = await lot("Glucose", "High", "45922", 300, 6), na = await lot("Sodium", "Low", "45921", 140, 2);
// A run typed the ordinary way in September, whose month is then reviewed
await call("POST", `${L}/qc/results`, { control_lot_id: gluHi, result_value: 303, result_date: "2026-09-10", run_time: "08:00", map_instrument_id: anA }, token);
await call("POST", `${L}/qc/period-reviews`, { control_lot_id: gluHi, period_year: 2026, period_month: 9, attestation_acknowledged: true }, token);

const dir = path.join(OUT, "files"); fs.mkdirSync(dir, { recursive: true });
const write = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
const HEAD = "Date/Time,Analyzer,Test,Level,Lot,Result,Operator,Note";
const lines = [];
for (let i = 1; i <= 22; i++) lines.push(`10/${i}/2026 7:${String(10 + i)},Analyzer A,GLUCOSE,low,45921,${(100 + [0.4, -1.1, 0.9, -0.2, 1.3, -0.8, 0.1][i % 7]).toFixed(1)},Robin Tech,`);
lines.push("10/23/2026 7:40,Analyzer A,Glucose,Low,45921,109.2,Robin Tech,high run", "10/23/2026 7:40,Analyzer A,Glucose,Low,45921,109.2,Robin Tech,high run", "9/8/2026 7:05,Analyzer A,Glucose,High,45922,302,JT,", "10/4/2026 7:00,CHEM-2,Sodium,Low,45921,140.6,JT,", "10/5/2026 7:00,Analyzer A,Sodium,Low,45921,<1,JT,");
const f1 = write("made-up-middleware.csv", [HEAD, ...lines].join("\n"));
const f2 = write("made-up-middleware-2.csv", [HEAD, "10/24/2026 7:15,Analyzer A,Glucose,Low,45921,99.8,Robin Tech,", "10/25/2026 7:15,CHEM-2,Sodium,Low,45921,141,JT,"].join("\n"));
const fBad = write("made-up-patients.csv", "Date/Time,Analyzer,Test,Patient Name,Result\n10/1/2026,Analyzer A,Glucose,zz,100");
const wb = new ExcelJS.Workbook();
wb.addWorksheet("Cover").addRow(["Made-up export"]);
const ws = wb.addWorksheet("QC");
ws.addRow(["When", "Inst", "Test", "L1", "L2"]);
for (let i = 26; i <= 27; i++) { const r = ws.addRow([new Date(Date.UTC(2026, 9, i, 6, 30)), "Analyzer A", "Glucose", 100.2 + (i - 26) / 10, { formula: "300+1", result: 301 }]); r.getCell(1).numFmt = "m/d/yyyy h:mm"; }
const f3 = path.join(dir, "made-up-wide.xlsx"); await wb.xlsx.writeFile(f3);

const browser = await chromium.launch();
const openAs = async (tk, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1200, height: 1000 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [tk, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const vis = (loc, ms = 10000) => loc.first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
const PAGE = `/labs/${labId}/veritaqc-app/import`;
const counts = async (page) => { const n = async (o) => Number((await page.getByTestId(`qcimport-count-${o}`).locator("div").first().innerText()).replace(/,/g, "")); return { ready: await n("ready"), duplicate: await n("duplicate"), unplaced: await n("unplaced") }; };
const preview = async (page) => { await page.getByTestId("qcimport-preview-button").click(); await page.getByTestId("qcimport-preview").waitFor({ timeout: 15000 }); await page.waitForTimeout(300); };
const top = (page) => page.evaluate(() => window.scrollTo(0, 0));
const closeDialog = async (p) => { await p.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).click(); await p.waitForTimeout(350); };
// page.waitForFunction needs eval, which the site's CSP refuses
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; for (;;) { if (await fn().catch(() => false)) return true; if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 150)); } };
const runs = () => sql("SELECT COUNT(*) AS n FROM qc_results WHERE lab_id = ?", labId).n;

try {
  const app = await openAs(token, `/labs/${labId}/veritaqc-app`);
  check("R0. VeritaQC has Import results and Sigma metric for an editor", await vis(app.getByTestId("veritaqc-import-link")) && await vis(app.getByTestId("veritaqc-sigma-link")));
  await app.getByTestId("veritaqc-import-link").click();
  await app.getByTestId("qcimport-file").waitFor({ timeout: 10000 });
  const page = app;

  // ── R1 ──
  await page.getByTestId("qcimport-file").setInputFiles(fBad);
  await vis(page.getByTestId("qcimport-problem"));
  check("R1. a file with a patient column is refused by naming it, and nothing of it shows", /"Patient Name" looks like patient information/.test(await page.getByTestId("qcimport-problem").innerText()) && !(await page.getByTestId("qcimport-mapping").count()));
  await page.getByTestId("qcimport-file").setInputFiles(f1);
  await page.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  check("R1. a CSV's columns and first rows show, with how many rows it holds", /27 rows under the headings/.test(await page.getByTestId("qcimport-read").innerText()) && await vis(page.locator("th", { hasText: "Date/Time" })), await page.getByTestId("qcimport-read").innerText());
  check("R1. the file's name stays in the box", /made-up-middleware\.csv$/.test(await page.getByTestId("qcimport-file").inputValue()));
  check("R1. a column is already chosen only where its heading is the field's own name", (await page.getByTestId("qcimport-analyte").inputValue()) === "Test" && (await page.getByTestId("qcimport-value").inputValue()) === "Result" && (await page.getByTestId("qcimport-comment").inputValue()) === "Note");
  await top(page);
  await page.screenshot({ path: `${OUT}/b12_mapping_light.png`, fullPage: true });

  // ── R2 ──
  await page.getByTestId("qcimport-lot").selectOption("");
  await page.getByTestId("qcimport-preview-button").click();
  await vis(page.getByTestId("qcimport-problem"));
  check("R2. a field still to choose is named and nothing is previewed", /control lot/.test(await page.getByTestId("qcimport-problem").innerText()));
  await page.getByTestId("qcimport-lot").selectOption("Lot");
  await page.getByTestId("qcimport-mapping-name").fill("Chemistry middleware");
  await page.getByTestId("qcimport-mapping-save").click();
  check("R2. the mapping is saved for the lab under its name", await vis(page.getByTestId("qcimport-mappings").getByText("Chemistry middleware")));
  const was = runs();
  await preview(page);
  const c1 = await counts(page);
  check("R2. the preview counts every row, and stores nothing", c1.ready === 24 && c1.duplicate === 1 && c1.unplaced === 2 && runs() === was, c1);
  const notes = await page.getByTestId("qcimport-notes").innerText();
  check("R2. it says a row is dated before a run on file, and that one lands in a signed month", /1 row is dated before a run already on file/.test(notes) && /2026-09 for Glucose High, lot 45922, whose review Riley Owner signed/.test(notes) && /keep the verdict/.test(notes), notes);
  await page.getByTestId("qcimport-count-unplaced").click();
  const un = await page.getByTestId("qcimport-rows").innerText();
  check("R2. each row that can't be placed says why", /"CHEM-2" isn't one this lab has/.test(un) && /"<1" isn't a number/.test(un), un);
  await page.waitForTimeout(6000); // the toast leaves
  await top(page);
  await page.screenshot({ path: `${OUT}/b12_preview_light.png`, fullPage: true });

  // ── R3 ──
  const pick = page.getByTestId("qcimport-pick-instrument-chem-2");
  const opts = await pick.locator("option").allInnerTexts();
  check("R3. the name is offered as a choice of this lab's analyzers, none chosen", (await pick.inputValue()) === "" && opts.some((o) => /Analyzer B/.test(o)) && opts.some((o) => /keep a name/.test(o)), opts);
  await pick.selectOption({ label: opts.find((o) => /Analyzer B/.test(o)) });
  await page.getByTestId("qcimport-names-save").click();
  await until(async () => (await counts(page)).ready === 25);
  const c2 = await counts(page);
  check("R3. the choice is remembered and the row is ready", c2.ready === 25 && c2.unplaced === 1 && !(await page.getByTestId("qcimport-names").count()), c2);

  // ── R4 ──
  await page.getByTestId("qcimport-import").click();
  const conf = await page.getByTestId("qcimport-confirm").innerText();
  check("R4. the confirm names the counts", /Import 25 results\?/.test(conf) && /1 duplicate and 1 that can't be placed will be left out/.test(conf), conf);
  await page.getByTestId("qcimport-confirm").screenshot({ path: `${OUT}/b12_confirm_light.png` });
  await page.getByTestId("qcimport-confirm-go").click();
  await page.getByTestId("import-dialog").waitFor({ timeout: 15000 });
  await page.getByTestId("import-summary").waitFor({ timeout: 8000 });
  check("R4. 25 results are stored and the import opens", runs() === was + 25 && /25 results stored, 1 duplicate and 1 that couldn't be placed left out\. Mapping: Chemistry middleware\./.test(await page.getByTestId("import-summary").innerText()));
  const need = page.getByTestId("import-needs-ca");
  check("R4. a run that fired a rejection asks for its corrective action", await vis(need) && /1-3s/.test(await need.innerText()) && /109\.2/.test(await need.innerText()));
  await page.waitForTimeout(6000); // the toast leaves
  await page.getByTestId("import-dialog").screenshot({ path: `${OUT}/b12_import_light.png` });
  const rej = sql("SELECT r.id FROM qc_results r WHERE r.lab_id = ? AND r.result_value = 109.2 AND r.import_id IS NOT NULL", labId).id;
  await page.getByTestId(`import-ca-text-${rej}`).fill("Reran the control, in range");
  await page.getByTestId(`import-ca-file-${rej}`).click();
  await until(async () => !(await page.getByTestId("import-needs-ca").count()));
  check("R4. it is filed there, by the module's own corrective action", sql("SELECT action_taken AS a FROM qc_corrective_actions WHERE qc_result_id = ?", rej)?.a === "Reran the control, in range" && !(await page.getByTestId("import-needs-ca").count()));
  await closeDialog(page);

  // ── R5 ──
  const qc = await openAs(token, `/labs/${labId}/veritaqc-app`);
  await qc.getByTestId("run-imported").first().waitFor({ timeout: 10000 }).catch(() => {});
  if (!(await qc.getByTestId("run-imported").count())) { await qc.getByTestId("qc-control-line").click(); await qc.getByRole("option", { name: /Glucose · Low/ }).click(); await vis(qc.getByTestId("run-imported")); }
  check("R5. a run says its file, row, who imported it and the operator the file names", /Imported from made-up-middleware\.csv, row \d+, by Riley Owner\.\s+Operator in the file: Robin Tech\./.test(await qc.getByTestId("run-imported").first().innerText()), await qc.getByTestId("run-imported").first().innerText());
  await qc.getByTestId("run-imported").first().scrollIntoViewIfNeeded();
  await qc.screenshot({ path: `${OUT}/b12_runs_light.png` });
  const recent = (await call("GET", `${L}/qc/recent?since=2026-09-01&until=2026-09-30`, undefined, token)).body.results;
  check("R5. a run put in a signed month is marked, the typed one before the review isn't", recent.filter((r) => r.added_after_review).length === 1 && recent.length === 2, recent.map((r) => [r.result_date, r.added_after_review]));
  const rv = await openAs(token, `/labs/${labId}/veritaqc-app/review`);
  await rv.waitForTimeout(800);
  const monthSel = rv.locator("button[role=combobox]");
  for (let i = 0; i < await monthSel.count(); i++) if (/November|December|October/.test(await monthSel.nth(i).innerText())) { await monthSel.nth(i).click(); await rv.getByRole("option", { name: "September" }).click(); break; }
  check("R5. Review & Sign-off shows it too", await vis(rv.getByTestId("run-after-review"), 8000));
  await rv.getByTestId("run-after-review").first().scrollIntoViewIfNeeded().catch(() => {});
  await rv.screenshot({ path: `${OUT}/b12_review_light.png` });

  // ── R6 ──
  await page.getByTestId("qcimport-file").setInputFiles(f1);
  await page.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  await preview(page);
  const c3 = await counts(page);
  check("R6. the same file again: nothing is ready and Import is off", c3.ready === 0 && c3.duplicate === 26 && await page.getByTestId("qcimport-import").isDisabled(), c3);

  // ── R7 ──
  await page.getByTestId("qcimport-file").setInputFiles(f2);
  await page.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  await page.getByTestId("qcimport-saved").selectOption({ label: "Chemistry middleware" });
  await page.waitForTimeout(800);
  await preview(page);
  const c4 = await counts(page);
  check("R7. the next file uses the saved mapping and the remembered name: nothing to choose", c4.ready === 2 && c4.unplaced === 0 && !(await page.getByTestId("qcimport-names").count()), c4);
  // Someone records one of those runs by hand between the preview and the import
  await call("POST", `${L}/qc/results`, { control_lot_id: glu, result_value: 99.8, result_date: "2026-10-24", run_time: "07:15", map_instrument_id: anA }, token);
  const r0 = runs();
  await page.getByTestId("qcimport-import").click();
  await page.getByTestId("qcimport-confirm-go").click();
  await vis(page.getByTestId("qcimport-problem"));
  await until(async () => (await counts(page)).duplicate === 1);
  check("R6. counts that changed since the preview: refused, nothing stored, previewed again", /counts have changed/.test(await page.getByTestId("qcimport-problem").innerText()) && runs() === r0 && (await counts(page)).duplicate === 1);
  await page.getByTestId("qcimport-file").setInputFiles(f3);
  await page.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  await page.getByTestId("qcimport-sheet").selectOption("QC");
  await page.waitForTimeout(900);
  await page.getByTestId("qcimport-layout-wide").check();
  await page.getByTestId("qcimport-date").selectOption("When");
  await page.getByTestId("qcimport-instrument").selectOption("Inst");
  await page.getByTestId("qcimport-valuecol-l1").check();
  await page.getByTestId("qcimport-valuecol-l2").check();
  await page.getByTestId("qcimport-fill-level").click();
  await page.getByTestId("qcimport-valuecol-l1-level").fill("Low");
  await page.getByTestId("qcimport-valuecol-l2-level").fill("High");
  await page.getByTestId("qcimport-valuecol-l1-lot").fill("45921");
  await page.getByTestId("qcimport-valuecol-l2-lot").fill("45922");
  await page.getByTestId("qcimport-layout-wide").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/b12_wide_light.png` });
  await preview(page);
  const c5 = await counts(page);
  const wideRows = await page.getByTestId("qcimport-rows").innerText();
  check("R7. a wide Excel file: a run per level, Excel's own dates and formula values", c5.ready === 4 && /2026-10-26 06:30/.test(wideRows) && /301/.test(wideRows), [c5, wideRows]);
  await page.getByTestId("qcimport-import").click();
  await page.getByTestId("qcimport-confirm-go").click();
  await page.getByTestId("import-dialog").waitFor({ timeout: 15000 });
  await closeDialog(page);

  // ── R8 ──
  const imp1 = sql("SELECT id FROM qc_file_imports WHERE lab_id = ? AND file_name = 'made-up-middleware.csv'", labId).id;
  await page.getByTestId(`import-open-${imp1}`).click();
  await page.getByTestId("import-undo-open").click();
  const undo = await page.getByTestId("import-undo").innerText();
  check("R8. taking it back says how many runs would be voided and which stay, and why", /24 runs will be voided/.test(undo) && /1 run stays/.test(undo) && /It has a corrective action/.test(undo) && await page.getByTestId("import-undo-confirm").isDisabled(), undo);
  await page.getByTestId("import-undo-reason").fill("The wrong export");
  await page.waitForTimeout(6000);
  await page.getByTestId("import-undo").scrollIntoViewIfNeeded();
  await page.getByTestId("import-dialog").screenshot({ path: `${OUT}/b12_undo_light.png` });
  await page.getByTestId("import-undo-confirm").click();
  check("R8. it is taken back with who and why, and the rows are kept", await vis(page.getByTestId("import-undone")) && /Taken back by Riley Owner .*The wrong export \(24 runs voided\)/.test(await page.getByTestId("import-undone").innerText()) && sql("SELECT COUNT(*) AS n FROM qc_results WHERE import_id = ? AND voided_at IS NOT NULL", imp1).n === 24);
  await closeDialog(page);
  check("R8. the list says so", /Taken back: 24 runs voided/.test(await page.getByTestId(`import-${imp1}`).innerText()));

  // ── R9 ──
  for (let i = 0; i < 21; i++) await call("POST", `${L}/qc/results`, { control_lot_id: na, result_value: 140 + [0.5, -0.5, 1, -1, 0][i % 5] + 0.4, result_date: `2026-10-${String(i + 1).padStart(2, "0")}`, map_instrument_id: anA }, token);
  const sg = await openAs(token, `/labs/${labId}/veritaqc-app/sigma`);
  await sg.getByTestId("sigma-formula").waitFor({ timeout: 10000 });
  check("R9. the formula is on the screen", (await sg.getByTestId("sigma-formula").innerText()).includes("Sigma = (allowable error % - bias %) / CV %"));
  check("R9. with no allowable error: not enough to compute, and what is missing", /Not enough to compute[\s\S]*Missing: an allowable error for this test/.test(await sg.getByTestId(`sigma-value-${na}`).innerText()));
  await sg.getByTestId("sigma-set-Sodium").click();
  await sg.getByTestId("sigma-kind-preset").check();
  await sg.getByTestId("sigma-preset").selectOption({ index: 1 });
  await sg.getByTestId("sigma-allowable-dialog").screenshot({ path: `${OUT}/b12_sigma_set_light.png` });
  await sg.getByTestId("sigma-save").click();
  await sg.getByTestId(`sigma-math-${na}`).waitFor({ timeout: 10000 });
  const val = await sg.getByTestId(`sigma-value-${na}`).innerText(), math = await sg.getByTestId(`sigma-math-${na}`).innerText();
  const m = /\(([\d.]+) - ([\d.]+)\) \/ ([\d.]+) = (-?[\d.]+)/.exec(math);
  check("R9. the number, its arithmetic and its inputs show (4 mmol/L at 140 is 2.86%)", !!m && m[1] === "2.86" && m[4] === val.trim() && Math.abs((Number(m[1]) - Number(m[2])) / Number(m[3]) - Number(m[4])) < 0.06 && /4 mmol\/L at a target of 140 is 2\.86%/.test(await sg.getByTestId(`sigma-lot-${na}`).innerText()), { val, math });
  await sg.getByTestId("sigma-set-Glucose").click();
  await sg.getByTestId("sigma-kind-percent").check();
  await sg.getByTestId("sigma-value").fill("0.5");
  await sg.getByTestId("sigma-save").click();
  await sg.getByTestId(`sigma-math-${gluHi}`).waitFor({ timeout: 10000 }).catch(() => {});
  const colorOf = (id) => sg.getByTestId(`sigma-value-${id}`).locator("div").first().evaluate((e) => getComputedStyle(e).color);
  check("R9. a number of any size has the same color, and few runs are said", (await colorOf(na)) === (await colorOf(gluHi)) && /from \d+ runs/.test(await sg.getByTestId(`sigma-value-${gluHi}`).innerText()), await sg.getByTestId(`sigma-value-${gluHi}`).innerText());
  await sg.getByTestId(`sigma-peer-${na}`).click();
  await sg.getByTestId("sigma-peer-value").fill("140.4");
  await sg.getByTestId("sigma-peer-note").fill("Made-up peer report, October 2026");
  await sg.getByTestId("sigma-peer-save").click();
  await vis(sg.getByText("Peer mean 140.4 (Made-up peer report, October 2026)"));
  check("R9. a peer mean the lab enters is the target", /Peer mean 140\.4/.test(await sg.getByTestId(`sigma-lot-${na}`).innerText()));
  await sg.waitForTimeout(6000);
  await top(sg);
  await sg.screenshot({ path: `${OUT}/b12_sigma_light.png`, fullPage: true });
  const body = (await sg.locator("body").innerText()).toLowerCase();
  check("R9. no grading words on the page", !/world.class|excellent|\bgood\b|marginal|\bpoor\b|unacceptable/.test(body));

  // ── R10 ──
  for (const [who, tk] of [["a view-only seat", viewToken], ["a Staff login", staffToken]]) {
    const p = await openAs(tk, `/labs/${labId}/veritaqc-app`);
    await p.getByText("Log a QC result").first().waitFor({ timeout: 10000 }).catch(() => {});
    const none = !(await p.getByTestId("veritaqc-import-link").count()) && !(await p.getByTestId("veritaqc-sigma-link").count());
    await p.goto(`${BASE}${PAGE}`, { waitUntil: "networkidle" });
    check(`R10. ${who} gets no button, and a note instead of an upload`, none && await vis(p.getByTestId("qcimport-no-edit")) && !(await p.getByTestId("qcimport-file").count()));
    await p.context().close();
  }
  for (const [p, name] of [[PAGE, "import"], [`/labs/${labId}/veritaqc-app/sigma`, "sigma"]]) {
    const ph = await openAs(token, p, { viewport: { width: 375, height: 812 } });
    if (name === "import") { await ph.getByTestId("qcimport-file").setInputFiles(f2); await ph.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 }); await preview(ph); } else await ph.getByTestId("sigma-formula").waitFor({ timeout: 10000 });
    const over = await ph.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`R10. phone width doesn't overflow: ${name}`, over <= 1, `overflow ${over}`);
    await top(ph);
    await ph.screenshot({ path: `${OUT}/b12_${name}_phone.png`, fullPage: true });
    await ph.context().close();
  }
  // Dark
  const dk = await openAs(token, PAGE, { dark: true });
  await dk.getByTestId("qcimport-file").setInputFiles(f1);
  await dk.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  await top(dk);
  await dk.screenshot({ path: `${OUT}/b12_mapping_dark.png`, fullPage: true });
  await preview(dk);
  await dk.getByTestId("qcimport-count-unplaced").click();
  await top(dk);
  await dk.waitForTimeout(400);
  await dk.screenshot({ path: `${OUT}/b12_preview_dark.png`, fullPage: true });
  await dk.getByTestId("qcimport-count-ready").click();
  await dk.getByTestId("qcimport-import").click();
  await dk.getByTestId("qcimport-confirm").screenshot({ path: `${OUT}/b12_confirm_dark.png` });
  await dk.getByTestId("qcimport-confirm").getByRole("button", { name: "Cancel" }).click();
  await dk.waitForTimeout(350);
  const imp3 = sql("SELECT id FROM qc_file_imports WHERE lab_id = ? AND file_name = 'made-up-wide.xlsx'", labId).id;
  await dk.getByTestId(`import-open-${imp1}`).click();
  await dk.getByTestId("import-undone").waitFor({ timeout: 8000 });
  await dk.getByTestId("import-dialog").screenshot({ path: `${OUT}/b12_import_dark.png` });
  await closeDialog(dk);
  await dk.getByTestId(`import-open-${imp3}`).click();
  await dk.getByTestId("import-undo-open").click();
  await dk.getByTestId("import-undo-reason").fill("The wrong export");
  await dk.getByTestId("import-dialog").screenshot({ path: `${OUT}/b12_undo_dark.png` });
  await closeDialog(dk);
  await dk.getByTestId("qcimport-file").setInputFiles(f3);
  await dk.getByTestId("qcimport-mapping").waitFor({ timeout: 10000 });
  await dk.getByTestId("qcimport-sheet").selectOption("QC");
  await dk.waitForTimeout(900);
  await dk.getByTestId("qcimport-layout-wide").check();
  await dk.getByTestId("qcimport-valuecol-l1").check();
  await dk.getByTestId("qcimport-layout-wide").scrollIntoViewIfNeeded();
  await dk.screenshot({ path: `${OUT}/b12_wide_dark.png` });
  const ds = await openAs(token, `/labs/${labId}/veritaqc-app/sigma`, { dark: true });
  await ds.getByTestId("sigma-formula").waitFor({ timeout: 10000 });
  await ds.waitForTimeout(400);
  await ds.screenshot({ path: `${OUT}/b12_sigma_dark.png`, fullPage: true });
  await ds.getByTestId("sigma-set-Glucose").click();
  await ds.getByTestId("sigma-allowable-dialog").screenshot({ path: `${OUT}/b12_sigma_set_dark.png` });
  const dq = await openAs(token, `/labs/${labId}/veritaqc-app`, { dark: true });
  await dq.getByTestId("qc-control-line").click();
  await dq.getByRole("option", { name: /Glucose · Low/ }).click();
  await vis(dq.getByTestId("run-imported"));
  await dq.getByTestId("run-imported").first().scrollIntoViewIfNeeded();
  await dq.screenshot({ path: `${OUT}/b12_runs_dark.png` });
  const dr = await openAs(token, `/labs/${labId}/veritaqc-app/review`, { dark: true });
  await dr.waitForTimeout(800);
  const ms = dr.locator("button[role=combobox]");
  for (let i = 0; i < await ms.count(); i++) if (/November|December|October/.test(await ms.nth(i).innerText())) { await ms.nth(i).click(); await dr.getByRole("option", { name: "October" }).click(); break; }
  await vis(dr.getByTestId("run-imported"));
  await dr.getByTestId("run-imported").first().scrollIntoViewIfNeeded().catch(() => {});
  await dr.screenshot({ path: `${OUT}/b12_review_dark.png` });
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
