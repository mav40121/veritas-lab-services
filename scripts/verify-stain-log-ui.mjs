// scripts/verify-stain-log-ui.mjs
//
// Browser receipt for the VeritaMaintain stain log (Michael Q178 = 1, 2026-11-06). On a local production build with a scratch DB, made-up people, made-up instruments and made-up lots:
//   S1. the VeritaMaintain card opens the log; an instrument with no rows says so; rows are set up in the dialog and take the lab's order
//   S2. Record today: a stain change refuses with no lot; with one, the code lands in today's cell, the initials row fills, and the lot shows on the row
//   S3. a past month: codes in the right cells, a short daily row in amber, a Problem and an expired lot in red, the findings by date
//   S4. clicking a cell opens that date, shows what's on file, and a void needs a reason, takes it off the grid and keeps it on the record
//   S5. the manual log: no specimen number anywhere, a problem needs its action, a labeled MRN or specimen number is refused in plain words, a good stain lands in the list
//   S6. the monthly review: the stain log's problems and the manual log are on it, each links to the log, a designee signs, the log reads the review, a later entry shows as added after
//   S7. the Excel report carries the stain log's sheets
//   S8. print: only the print area shows, black on white in dark mode too, landscape; grid and manual log both
//   S9. a Staff login records, can't set up, and reads a coworker's initials but not their name
//   S10. VeritaDC: Use the blank ROSE form fills the upload as a Form, it uploads as a draft, it opens, and it downloads
//   D1. dark mode and phone width read and don't overflow
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-stain-log-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const JSZip = require("jszip");
const { PDFDocument } = require("pdf-lib");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Stain", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `stainui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Stain Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '99D0000123' WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const addPerson = async (tag, name, kind) => {
  const e = `stainui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  if (kind === "editor") {
    sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`, ownerId, e, id, now, now, `stainui-${tag}-${stamp}`, labId);
  } else {
    const staffLab = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId)?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Stain Test Lab', '99D0000123', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
    const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)", staffLab, labId, ownerId, name.split(" ")[1], name.split(" ")[0], now, now).lastInsertRowid);
    sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`, ownerId, e, id, labId, emp, now, now);
  }
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { id, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token };
};
const gs = await addPerson("gs", "Gale Supervisor", "editor");
const sam = await addPerson("sam", "Sam Stafford", "staff");
const zora = await addPerson("zora", "Zora Quillfeather", "staff");
sql(`INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, created_at, updated_at) VALUES (?, ?, 'Gale Supervisor', 'general_supervisor', 'high', '{"equipment_record_review":true}', 'active', ?, ?)`, labId, gs.id, now, now);

const L = `/api/labs/${labId}`;
const S = `${L}/stain-log`;
const stainer = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up autostainer", location: "Histology bench 2", serial_number: "MU-100", next_due_date: "2030-01-01" }, token)).body.id;
sql("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", stainer);

const today = (await call("GET", S, undefined, token)).body.today;
const thisMonth = today.slice(0, 7);
const [ty, tm] = thisMonth.split("-").map(Number);
const month = new Date(Date.UTC(ty, tm - 2, 1)).toISOString().slice(0, 7);
const dayOf = (d) => `${month}-${String(d).padStart(2, "0")}`;

const browser = await chromium.launch();
const openAs = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [tk, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const toastSaid = async (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
const countEntries = () => sql("SELECT COUNT(*) AS n FROM stain_log_entries WHERE lab_id = ?", labId).n;
const LOG = `/labs/${labId}/equipment-app/stain-log`;

// ── S1. Open it and set up rows ──
const ownerPage = await openAs(token, `/labs/${labId}/equipment-app`);
await ownerPage.getByTestId("stain-log-panel").scrollIntoViewIfNeeded();
await ownerPage.getByTestId("stain-log-panel").screenshot({ path: `${OUT}/stain-panel-empty.png` });
await ownerPage.getByTestId("stain-panel-open").click();
await ownerPage.getByTestId("stain-log-page").waitFor({ timeout: 15000 });
check("S1. the card opens the stain log", ownerPage.url().includes("/equipment-app/stain-log"), ownerPage.url());
check("S1. the printed page doesn't show on screen", !(await ownerPage.getByTestId("stain-print-area").isVisible()));
await ownerPage.getByTestId("stain-no-rows").waitFor({ timeout: 15000 });
check("S1. an instrument with no rows says so", /No rows yet/.test(await ownerPage.getByTestId("stain-no-rows").innerText()));
await ownerPage.getByTestId("stain-setup").click();
const addRowUi = async (name, kind, frequency, code) => {
  await ownerPage.getByTestId("stain-row-name").fill(name);
  await ownerPage.getByTestId("stain-row-kind").selectOption(kind);
  await ownerPage.getByTestId("stain-row-frequency").selectOption(frequency);
  if (code) await ownerPage.getByTestId("stain-row-code").selectOption(code);
  await ownerPage.getByTestId("stain-row-save").click();
  await ownerPage.getByTestId("stain-setup-rows").getByText(name, { exact: false }).first().waitFor({ timeout: 8000 });
};
await addRowUi("Hematoxylin", "stain", "monthly", "D");
await addRowUi("Eosin", "stain", "as_needed");
await addRowUi("Water", "solution", "daily", "C");
await addRowUi("Xylene substitute", "stain", "daily", "R");
await addRowUi("Wipe spills", "check", "daily");
await addRowUi("Slide quality", "check", "daily");
const rowId = (name) => sql("SELECT id FROM stain_log_rows WHERE lab_id = ? AND name = ?", labId, name).id;
const R = { hema: rowId("Hematoxylin"), eosin: rowId("Eosin"), water: rowId("Water"), xylene: rowId("Xylene substitute"), spills: rowId("Wipe spills"), quality: rowId("Slide quality") };
sql("UPDATE stain_log_rows SET created_at = '2026-01-01T00:00:00.000Z' WHERE lab_id = ?", labId);
for (let i = 0; i < 5; i += 1) {
  await ownerPage.getByTestId(`stain-up-${R.quality}`).click();
  await ownerPage.waitForTimeout(250);
}
const firstRow = await ownerPage.getByTestId("stain-setup-rows").locator("li").first().innerText();
check("S1. rows take the lab's order", /Slide quality/.test(firstRow), firstRow);
await ownerPage.screenshot({ path: `${OUT}/stain-setup.png` });
await ownerPage.getByTestId("stain-setup-done").click();
await ownerPage.getByTestId("stain-grid").waitFor({ timeout: 10000 });
const firstGridRow = await ownerPage.getByTestId("stain-grid").locator("tbody tr").first().innerText();
check("S1. the grid follows that order", /Slide quality/.test(firstGridRow), firstGridRow.slice(0, 40));

// ── S2. Record today ──
await ownerPage.getByTestId("stain-record").click();
await ownerPage.getByTestId("stain-initials").fill("ro");
await ownerPage.getByTestId(`stain-code-${R.quality}-OK`).click();
await ownerPage.getByTestId(`stain-code-${R.hema}-C`).click();
await ownerPage.getByTestId(`stain-lot-input-${R.hema}`).waitFor();
await ownerPage.screenshot({ path: `${OUT}/stain-record.png` });
await ownerPage.getByTestId("stain-save").click();
check("S2. a stain change with no lot is refused", await toastSaid(ownerPage, "needs the lot number") && countEntries() === 0, String(countEntries()));
await ownerPage.getByTestId(`stain-lot-input-${R.hema}`).fill("MADE-LOT-9");
await ownerPage.getByTestId(`stain-exp-input-${R.hema}`).fill("2028-03-01");
await ownerPage.getByTestId("stain-save").click();
await ownerPage.getByTestId("stain-record-dialog").waitFor({ state: "detached", timeout: 10000 });
await ownerPage.waitForTimeout(600);
const todayDay = Number(today.slice(8, 10));
check("S2. the code lands in today's cell", (await ownerPage.getByTestId(`stain-cell-${R.hema}-${todayDay}`).innerText()).trim() === "C", await ownerPage.getByTestId(`stain-cell-${R.hema}-${todayDay}`).innerText());
check("S2. a check shows its mark", (await ownerPage.getByTestId(`stain-cell-${R.quality}-${todayDay}`).innerText()).trim() === "✓");
check("S2. the initials row fills, upper case", (await ownerPage.getByTestId(`stain-initials-${todayDay}`).innerText()).trim() === "RO");
check("S2. the row shows its lot", /Lot MADE-LOT-9, exp 2028-03-01/.test(await ownerPage.getByTestId(`stain-lot-${R.hema}`).innerText()));

// ── Made-up month, entered the way a lab would ──
const day = (d, items, initials = "MU", tk = token) => call("POST", `${S}/${stainer}/entries`, { log_date: dayOf(d), initials, items }, tk);
const weekdays = Array.from({ length: 28 }, (_, i) => i + 1).filter((d) => { const w = new Date(`${dayOf(d)}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6; });
const dHema = weekdays[0], dEosin = weekdays[2], dNoWater = weekdays[5], dProblem = weekdays[7], dLate = weekdays[9];
for (const d of weekdays) {
  const items = [{ row_id: R.spills, codes: ["OK"] }, { row_id: R.xylene, codes: ["R"] }];
  if (d !== dNoWater) items.push({ row_id: R.water, codes: ["C"] });
  items.push(d === dProblem ? { row_id: R.quality, codes: ["PROBLEM"], corrective_action: "Pale nuclei. Filtered the hematoxylin and re-stained; no impact on patient testing." } : { row_id: R.quality, codes: ["OK"] });
  if (d === dHema) items.push({ row_id: R.hema, codes: ["D", "C"], lot_number: "HX-1042", expiration_date: "2027-08-31" });
  if (d === dEosin) items.push({ row_id: R.eosin, codes: ["C"], lot_number: "EO-77", expiration_date: dayOf(1), corrective_action: "Lot found expired at the end of the shift; replaced with a current lot the same day." });
  if (d === weekdays[4]) items.push({ row_id: R.eosin, codes: ["C"], lot_number: "EO-81", expiration_date: "2027-11-30" });
  if (d === weekdays[6]) items.push({ row_id: R.hema, codes: ["F"] }, { row_id: R.eosin, codes: ["TO"] });
  const r = await day(d, items, d % 2 ? "MU" : "AB");
  if (r.status !== 201) { check(`seed day ${d}`, false, JSON.stringify(r.body)); }
}
const manual = (body, tk = token) => call("POST", `${S}/manual`, { initials: "MU", ...body }, tk);
await manual({ log_date: dayOf(weekdays[1]), specimen_type: "Frozen section", result: "good" });
await manual({ log_date: dayOf(weekdays[3]), specimen_type: "Touch preparation", result: "good", test_slide: true, comments: "Test slide before the day's cases." });
await manual({ log_date: dayOf(weekdays[8]), specimen_type: "Frozen section", result: "problem", comments: "Faint eosin. Replaced the eosin and re-stained." });
// Entered on the day, as a lab would; one day entered five days late, so the review's note has something to say.
sql("UPDATE stain_log_entries SET created_at = log_date || 'T12:00:00.000Z' WHERE lab_id = ? AND substr(log_date, 1, 7) = ?", labId, month);
sql("UPDATE stain_manual_entries SET created_at = log_date || 'T12:00:00.000Z' WHERE lab_id = ? AND substr(log_date, 1, 7) = ?", labId, month);
sql("UPDATE stain_log_entries SET created_at = ? WHERE lab_id = ? AND log_date = ?", new Date(Date.parse(`${dayOf(dLate)}T12:00:00Z`) + 5 * 86400000).toISOString(), labId, dayOf(dLate));

// ── S3. The past month ──
await ownerPage.getByTestId("stain-prev").click();
await ownerPage.getByTestId("stain-month").filter({ hasText: month }).waitFor({ timeout: 8000 });
await ownerPage.getByTestId(`stain-cell-${R.hema}-${dHema}`).waitFor({ timeout: 10000 });
await ownerPage.waitForTimeout(500);
check("S3. Previous moves to the last month and Next comes back", (await ownerPage.getByTestId("stain-next").isEnabled()) && (await ownerPage.getByTestId("stain-month").innerText()) === month);
await ownerPage.goto(`${BASE}${LOG}?instrument=${stainer}&month=${month}`, { waitUntil: "networkidle" });
await ownerPage.getByTestId(`stain-cell-${R.hema}-${dHema}`).waitFor({ timeout: 15000 });
await ownerPage.waitForTimeout(300);
const cellText = async (r, d) => (await ownerPage.getByTestId(`stain-cell-${r}-${d}`).innerText()).trim().replace(/\s+/g, " ");
check("S3. two codes on one day show together", await cellText(R.hema, dHema) === "D C", await cellText(R.hema, dHema));
check("S3. a top-off shows as TO", await cellText(R.eosin, weekdays[6]) === "TO", await cellText(R.eosin, weekdays[6]));
check("S3. rotate shows as R", await cellText(R.xylene, weekdays[0]) === "R");
const cls = async (r, d) => (await ownerPage.getByTestId(`stain-cell-${r}-${d}`).locator("xpath=ancestor::td[1]").getAttribute("class")) || "";
check("S3. a short daily row shows amber", /amber/.test(await cls(R.water, dNoWater)), await cls(R.water, dNoWater));
check("S3. a Problem shows red", /red/.test(await cls(R.quality, dProblem)) && await cellText(R.quality, dProblem) === "!", await cls(R.quality, dProblem));
check("S3. an expired lot shows red", /red/.test(await cls(R.eosin, dEosin)));
check("S3. a day the instrument wasn't used isn't amber", !/amber/.test(await cls(R.water, Math.max(...Array.from({ length: 28 }, (_, i) => i + 1).filter((d) => !weekdays.includes(d))))));
const findings = await ownerPage.getByTestId("stain-findings").innerText();
check("S3. the findings name the short day", new RegExp(`Water: 1 day in use with no C recorded: \\d+/${dNoWater}`).test(findings), findings.slice(0, 200));
check("S3. and the quiet days are a note", /days with nothing on the stain log/.test(findings));
const details = await ownerPage.getByTestId("stain-details").innerText();
check("S3. lots and corrective actions are listed", /HX-1042/.test(details) && /EO-77/.test(details) && /\(expired\)/.test(details) && /Pale nuclei/.test(details), details.slice(0, 160));
await ownerPage.getByTestId("stain-grid-card").screenshot({ path: `${OUT}/stain-grid.png` });

// ── S4. A cell opens that day; a void needs a reason ──
await ownerPage.getByTestId(`stain-cell-${R.xylene}-${weekdays[1]}`).click();
await ownerPage.getByTestId("stain-record-dialog").waitFor();
check("S4. the cell opens that date", (await ownerPage.getByTestId("stain-date").inputValue()) === dayOf(weekdays[1]));
check("S4. what's on file shows", /On file: Rotated by/.test(await ownerPage.getByTestId(`stain-existing-${R.xylene}`).innerText()));
const toVoid = sql("SELECT id FROM stain_log_entries WHERE row_id = ? AND log_date = ?", R.xylene, dayOf(weekdays[1])).id;
await ownerPage.getByTestId(`stain-void-${toVoid}`).click();
await ownerPage.getByTestId("stain-void-dialog").waitFor();
await ownerPage.getByTestId("stain-void-save").click();
check("S4. a void needs a reason", await toastSaid(ownerPage, "Enter why") && !sql("SELECT voided_at AS v FROM stain_log_entries WHERE id = ?", toVoid).v);
await ownerPage.getByTestId("stain-void-reason").fill("Recorded on the wrong instrument");
await ownerPage.screenshot({ path: `${OUT}/stain-void.png` });
await ownerPage.getByTestId("stain-void-save").click();
await ownerPage.getByTestId("stain-void-dialog").waitFor({ state: "detached", timeout: 8000 });
await ownerPage.waitForTimeout(500);
check("S4. the record dialog stays open and what's on file updates, ready to enter it right", (await ownerPage.getByTestId(`stain-existing-${R.xylene}`).count()) === 0);
await ownerPage.getByTestId("stain-record-dialog").getByRole("button", { name: "Cancel" }).click();
await ownerPage.getByTestId("stain-record-dialog").waitFor({ state: "detached", timeout: 8000 });
await ownerPage.waitForTimeout(300);
check("S4. it leaves the grid", await cellText(R.xylene, weekdays[1]) === "", await cellText(R.xylene, weekdays[1]));
check("S4. and stays on the record with the reason", /Recorded on the wrong instrument/.test(await ownerPage.getByTestId("stain-voided").innerText()));

// ── S5. Manual log ──
await ownerPage.getByTestId("stain-view").selectOption("manual");
await ownerPage.getByTestId("manual-table").waitFor({ timeout: 10000 });
const mt = await ownerPage.getByTestId("manual-table").innerText();
check("S5. the month's manual stains list", /Frozen section/.test(mt) && /Touch preparation/.test(mt) && /Problem/.test(mt), mt.slice(0, 140));
await ownerPage.getByTestId("manual-add").click();
await ownerPage.getByTestId("manual-dialog").waitFor();
const dlg = await ownerPage.getByTestId("manual-dialog").innerText();
const dlgFields = await ownerPage.getByTestId("manual-dialog").locator("label").allInnerTexts();
check("S5. no specimen number field, and the box says not to enter one", !dlgFields.some((t) => /specimen\s*(#|no|number|id)|accession/i.test(t)) && /specimen or accession number/.test(dlg), dlgFields.join(" | "));
await ownerPage.getByTestId("manual-initials").fill("mu");
await ownerPage.getByTestId("manual-type").fill("Frozen section");
await ownerPage.getByTestId("manual-result-problem").click();
const before = sql("SELECT COUNT(*) AS n FROM stain_manual_entries WHERE lab_id = ?", labId).n;
await ownerPage.getByTestId("manual-save").click();
check("S5. a problem needs the corrective action", await toastSaid(ownerPage, "needs the corrective action") && sql("SELECT COUNT(*) AS n FROM stain_manual_entries WHERE lab_id = ?", labId).n === before);
await ownerPage.getByTestId("manual-comments").fill("Specimen # S26-1234 re-stained");
await ownerPage.getByTestId("manual-save").click();
check("S5. a specimen number is refused in plain words", await toastSaid(ownerPage, "stain log never holds") && sql("SELECT COUNT(*) AS n FROM stain_manual_entries WHERE lab_id = ?", labId).n === before);
await ownerPage.screenshot({ path: `${OUT}/stain-manual-phi.png` });
await ownerPage.getByTestId("manual-comments").fill("MRN: 00482913");
await ownerPage.getByTestId("manual-save").click();
await ownerPage.waitForTimeout(600);
check("S5. a labeled MRN is refused", sql("SELECT COUNT(*) AS n FROM stain_manual_entries WHERE lab_id = ?", labId).n === before);
await ownerPage.getByTestId("manual-comments").fill("Pale. Re-stained after replacing the hematoxylin.");
await ownerPage.getByTestId("manual-save").click();
await ownerPage.getByTestId("manual-dialog").waitFor({ state: "detached", timeout: 8000 });
await ownerPage.waitForTimeout(600);
check("S5. with the action it lands in the list", /Pale\. Re-stained after replacing/.test(await ownerPage.getByTestId("manual-table").innerText()) && !JSON.stringify(sql("SELECT comments AS c FROM stain_manual_entries WHERE lab_id = ? ORDER BY id DESC LIMIT 1", labId)).includes("S26"));
await ownerPage.getByTestId("manual-card").screenshot({ path: `${OUT}/stain-manual.png` });

// ── S6. The monthly review ──
{
  const page = await openAs(gs.token, `/labs/${labId}/equipment-app`);
  await page.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("review-table").waitFor({ timeout: 15000 });
  const row = () => page.getByTestId(`review-row-equipment-${stainer}`).innerText();
  check("S6. the review opens on last month", (await page.getByTestId("review-month").innerText()) === month);
  check("S6. the stain log's problem is on the instrument's row", /Water: 1 day in use with no C recorded/.test(await row()), (await row()).slice(0, 200));
  const manualRow = page.getByTestId(`review-row-stain_manual-${labId}`);
  check("S6. the manual log is its own record", /Manual stain log/.test(await manualRow.innerText()) && /manual stains/.test(await manualRow.innerText()), (await manualRow.innerText()).slice(0, 120));
  check("S6. each links to its log", (await page.getByTestId(`review-stain-link-equipment-${stainer}`).getAttribute("href")).includes(`stain-log?instrument=${stainer}&month=${month}`) && (await page.getByTestId(`review-stain-link-stain_manual-${labId}`).getAttribute("href")).includes("view=manual"));
  await page.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/stain-review.png` });
  await page.getByTestId("review-open-sign").click();
  await page.getByTestId("review-problems").waitFor();
  await page.getByTestId("review-action").fill("Reminded staff of the daily water change. Hematoxylin and eosin lots checked; no impact on patient testing.");
  await page.getByTestId("review-name").fill("Gale Supervisor");
  await page.getByTestId("review-password").fill(pw);
  await page.getByTestId("review-sign").click();
  await page.waitForTimeout(1500);
  check("S6. a designee signs, and the rows read reviewed", /Gale Supervisor, Designee, General Supervisor/.test(await row()) && /Gale Supervisor/.test(await manualRow.innerText()), (await row()).slice(-120));

  await page.getByTestId(`review-stain-link-equipment-${stainer}`).click();
  await page.getByTestId("stain-review-line").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check("S6. the link opens that month's log", (await page.getByTestId("stain-month").innerText()) === month);
  check("S6. the log reads the review", /Reviewed .* by Gale Supervisor/.test(await page.getByTestId("stain-review-line").innerText()), await page.getByTestId("stain-review-line").innerText());
  await page.waitForTimeout(50);
  await day(weekdays[10], [{ row_id: R.hema, codes: ["F"] }], "MU");
  await page.goto(`${BASE}/labs/${labId}/equipment-app`, { waitUntil: "networkidle" });
  await page.getByTestId("review-table").waitFor({ timeout: 15000 });
  check("S6. an entry added after shows as added after the review", /1 added after this review was signed/.test(await page.getByTestId(`review-after-equipment-${stainer}`).innerText()));
  await page.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/stain-review-signed.png` });

  // S7. The report
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("review-report").click()]);
  const file = `${OUT}/stain-review-report.xlsx`;
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  check("S7. the report carries the stain log's sheets", wb.worksheets.map((w) => w.name).join("|") === "About|Monthly Review|Temperature Readings|Equipment Entries|Stain Log|Manual Stain Log", wb.worksheets.map((w) => w.name).join("|"));
  const texts = []; wb.getWorksheet("Stain Log").eachRow((r) => texts.push((r.values || []).join("|")));
  check("S7. with the lot on the change", texts.some((t) => t.includes("HX-1042") && t.includes("2027-08-31")));
  check("S7. and the void with its reason", texts.some((t) => t.includes("Recorded on the wrong instrument")));
  fs.rmSync(file, { force: true });
  await page.context().close();
}

// ── S8. Print ──
const printCheck = async (page, name, expect, wantPages = 1) => {
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: 1056, height: 816 });
  const area = page.getByTestId("stain-print-area");
  const shown = await area.isVisible();
  const text = await area.innerText();
  const screenHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".no-print")).display === "none");
  const colors = await page.evaluate(() => {
    const seen = [...document.querySelectorAll("#compliance-print-area, #compliance-print-area *")].map((el) => { const c = getComputedStyle(el); return `${c.color}|${c.visibility}`; });
    return [...new Set(seen)];
  });
  check(`S8. ${name}: the print area shows and the screen doesn't`, shown && screenHidden, `${shown} ${screenHidden}`);
  check(`S8. ${name}: every piece of it reads black`, colors.length === 1 && colors[0] === "rgb(0, 0, 0)|visible", JSON.stringify(colors));
  check(`S8. ${name}: it holds what it should`, expect.every((re) => re.test(text)), text.slice(0, 240));
  await page.screenshot({ path: `${OUT}/stain-print-${name}.png` });
  const pdf = await page.pdf({ path: `${OUT}/stain-print-${name}.pdf`, preferCSSPageSize: true, printBackground: true });
  const raw = pdf.toString("latin1");
  const parsed = await PDFDocument.load(pdf);
  const pages = parsed.getPageCount();
  const size = parsed.getPage(0).getSize();
  check(`S8. ${name}: it prints landscape, on ${wantPages === "many" ? "more than one page" : `${wantPages} page`}, with no blank page after it`, size.width > size.height && (wantPages === "many" ? pages > 1 && pages <= 4 : pages === wantPages), `${size.width}x${size.height} ${pages} pages`);
};
{
  const page = await openAs(token, `${LOG}?instrument=${stainer}&month=${month}`);
  await page.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await printCheck(page, "grid", [/Stain log: Made-up autostainer/, new RegExp(`Month: ${month}`), /Stain Test Lab/, /CLIA: 99D0000123/, /HX-1042/, /D = Dumped/, /Monthly review: Reviewed/, /Voided entries/, /Water: 1 day in use/, /VeritaMaintain™/]);
  await page.context().close();
  const dark = await openAs(token, `${LOG}?instrument=${stainer}&month=${month}`, { dark: true });
  await dark.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await printCheck(dark, "grid-dark", [/Stain log: Made-up autostainer/]);
  await dark.context().close();
  const man = await openAs(token, `${LOG}?view=manual&month=${month}`);
  await man.getByTestId("manual-table").waitFor({ timeout: 15000 });
  await printCheck(man, "manual", [/Manual stain log/, /Frozen section/, /no specimen numbers/, /Monthly review: Reviewed/]);
  await man.context().close();
  // A long month runs onto more pages and nothing is cut off.
  const older = new Date(Date.UTC(ty, tm - 3, 1)).toISOString().slice(0, 7);
  for (let i = 1; i <= 60; i += 1) await manual({ log_date: `${older}-${String((i % 27) + 1).padStart(2, "0")}`, specimen_type: `Frozen section ${i}`, result: "good", comments: i === 60 ? "Last made-up line" : "" });
  const longLog = await openAs(token, `${LOG}?view=manual&month=${older}`);
  await longLog.getByTestId("manual-table").waitFor({ timeout: 15000 });
  await printCheck(longLog, "manual-long", [/Last made-up line/, /Frozen section 1\b/], "many");
  await longLog.context().close();
  const clicked = await openAs(token, `${LOG}?instrument=${stainer}&month=${month}`);
  await clicked.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await clicked.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
  await clicked.getByTestId("stain-print").click();
  check("S8. the Print button prints", await clicked.evaluate(() => window.__printed === 1));
  await clicked.context().close();
}

// ── S9. A Staff login ──
{
  await day(weekdays[11], [{ row_id: R.eosin, codes: ["F"] }], "ZQ", zora.token);
  await manual({ log_date: dayOf(weekdays[11]), specimen_type: "Frozen section", result: "good", initials: "ZQ" }, zora.token);
  const page = await openAs(sam.token, `${LOG}?instrument=${stainer}&month=${thisMonth}`);
  await page.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  check("S9. a Staff login opens the log", true);
  check("S9. and has no way to set up rows", await page.getByTestId("stain-setup").count() === 0);
  await page.getByTestId("stain-record").click();
  await page.getByTestId("stain-initials").fill("ss");
  await page.getByTestId(`stain-code-${R.spills}-OK`).click();
  await page.getByTestId("stain-save").click();
  await page.getByTestId("stain-record-dialog").waitFor({ state: "detached", timeout: 10000 });
  await page.waitForTimeout(600);
  check("S9. and records", (await page.getByTestId(`stain-cell-${R.spills}-${todayDay}`).innerText()).trim() === "✓");
  await page.goto(`${BASE}${LOG}?instrument=${stainer}&month=${month}`, { waitUntil: "networkidle" });
  await page.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const html = await page.content();
  const respText = await page.evaluate(async ([u, t]) => (await fetch(u, { headers: { Authorization: `Bearer ${t}` } })).text(), [`${S}/${stainer}?month=${month}`, sam.token]);
  check("S9. a coworker's initials show", html.includes("ZQ"));
  check("S9. their name doesn't, on the page or in what it was sent", !html.includes("Quillfeather") && !respText.includes("Quillfeather"));
  await page.getByTestId("stain-grid-card").screenshot({ path: `${OUT}/stain-grid-staff.png` });
  await page.getByTestId(`stain-cell-${R.eosin}-${weekdays[11]}`).click();
  await page.getByTestId("stain-record-dialog").waitFor();
  await page.getByTestId(`stain-existing-${R.eosin}`).waitFor();
  check("S9. a coworker's entry shows on file, with no way to void it", /On file: Filtered by ZQ/.test(await page.getByTestId(`stain-existing-${R.eosin}`).innerText()) && await page.getByTestId(`stain-void-${sql("SELECT id FROM stain_log_entries WHERE recorded_by_user_id = ?", zora.id).id}`).count() === 0);
  await page.getByTestId("stain-record-dialog").getByRole("button", { name: "Cancel" }).click();
  await page.goto(`${BASE}${LOG}?instrument=${stainer}&month=${thisMonth}`, { waitUntil: "networkidle" });
  await page.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await page.getByTestId(`stain-cell-${R.spills}-${todayDay}`).click();
  await page.getByTestId("stain-record-dialog").waitFor();
  check("S9. their own entry they can void", await page.getByTestId(`stain-void-${sql("SELECT id FROM stain_log_entries WHERE recorded_by_user_id = ? ORDER BY id DESC LIMIT 1", sam.id).id}`).count() === 1);
  await page.context().close();
}

// ── S10. ROSE in VeritaDC ──
{
  const page = await openAs(token, `/labs/${labId}/veritapolicy-app/my-policies`);
  await page.getByRole("button", { name: /Upload/ }).first().click();
  await page.getByTestId("upload-rose-form").waitFor({ timeout: 10000 });
  await page.getByTestId("upload-rose-form").click();
  await page.getByText("Rapid_On_Site_Evaluation_Blank_Form.docx", { exact: false }).first().waitFor({ timeout: 10000 });
  const dialogText = await page.getByRole("dialog").innerText();
  check("S10. the button fills the upload", /Rapid_On_Site_Evaluation_Blank_Form\.docx/.test(dialogText));
  check("S10. with the title", (await page.getByRole("dialog").locator("input").nth(1).inputValue()).startsWith("Rapid On-Site Evaluation"));
  check("S10. as a Form", /Form/.test(await page.getByTestId("upload-doc-type").innerText()), await page.getByTestId("upload-doc-type").innerText());
  await page.screenshot({ path: `${OUT}/stain-rose-upload.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByText("Rapid On-Site Evaluation (ROSE)", { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const doc = sql("SELECT id, status, doc_type, title FROM policy_documents WHERE lab_id = ? ORDER BY id DESC LIMIT 1", labId);
  check("S10. it uploads as a draft Form", doc?.doc_type === "form" && doc?.status === "draft" && /ROSE/.test(doc?.title), JSON.stringify(doc));
  await page.screenshot({ path: `${OUT}/stain-rose-list.png` });
  await page.getByRole("button", { name: "View" }).first().click();
  await page.getByText("First site", { exact: false }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const shownText = await page.getByRole("dialog").innerText();
  check("S10. it opens in VeritaDC, blank, with its sites and codes", /First site/.test(shownText) && /Third site/.test(shownText) && /88172/.test(shownText) && /Patient ID label/.test(shownText), shownText.slice(0, 200));
  await page.screenshot({ path: `${OUT}/stain-rose-view.png`, fullPage: false });
  const dl = await fetch(`${BASE}${L}/veritapolicy/documents/${doc.id}/download`, { headers: { Authorization: `Bearer ${token}` } });
  const buf = Buffer.from(await dl.arrayBuffer());
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string");
  check("S10. it downloads to print, with this lab's name", dl.status === 200 && xml.includes("Stain Test Lab") && xml.includes("99D0000123"));
  fs.writeFileSync(`${OUT}/rose-blank-form.docx`, buf);
  await page.context().close();
}

// ── D1. Dark and phone ──
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
{
  const dark = await openAs(token, `${LOG}?instrument=${stainer}&month=${month}`, { dark: true });
  await dark.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await dark.waitForTimeout(400);
  await dark.getByTestId("stain-grid-card").screenshot({ path: `${OUT}/stain-grid-dark.png` });
  check("D1. dark: the grid page doesn't overflow", await noOverflow(dark));
  await dark.getByTestId(`stain-cell-${R.hema}-${dHema}`).click();
  await dark.getByTestId("stain-record-dialog").waitFor();
  await dark.waitForTimeout(300);
  await dark.screenshot({ path: `${OUT}/stain-record-dark.png` });
  await dark.keyboard.press("Escape");
  await dark.getByTestId("stain-record-dialog").waitFor({ state: "detached", timeout: 8000 });
  await dark.getByTestId("stain-view").selectOption("manual");
  await dark.getByTestId("manual-table").waitFor({ timeout: 10000 });
  await dark.waitForTimeout(400);
  await dark.getByTestId("manual-card").screenshot({ path: `${OUT}/stain-manual-dark.png` });
  await dark.context().close();

  const phone = await openAs(token, `${LOG}?instrument=${stainer}&month=${month}`, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId("stain-grid").waitFor({ timeout: 15000 });
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}/stain-grid-phone.png` });
  check("D1. phone: the grid scrolls inside its box, and the page doesn't overflow", await noOverflow(phone) && await phone.getByTestId("stain-grid-wrap").evaluate((el) => el.scrollWidth > el.clientWidth));
  const sticky = await phone.getByTestId(`stain-row-${R.quality}`).locator("th").evaluate((el) => getComputedStyle(el).position);
  check("D1. phone: the row names stay put while it scrolls", sticky === "sticky", sticky);
  await phone.getByTestId("stain-record").click();
  await phone.getByTestId("stain-record-dialog").waitFor();
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${OUT}/stain-record-phone.png` });
  check("D1. phone: the record dialog fits the width", await phone.getByTestId("stain-record-dialog").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await phone.keyboard.press("Escape");
  await phone.getByTestId("stain-record-dialog").waitFor({ state: "detached", timeout: 8000 });
  await phone.getByTestId("stain-view").selectOption("manual");
  await phone.getByTestId("manual-table").waitFor({ timeout: 10000 });
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${OUT}/stain-manual-phone.png` });
  check("D1. phone: the manual log doesn't overflow", await noOverflow(phone));
  await phone.context().close();
}

// The address without the lab in it, which the lab switcher lands on, finds the lab
await ownerPage.goto(`${BASE}/equipment-app/stain-log`, { waitUntil: "networkidle" });
await ownerPage.getByTestId("stain-log-page").waitFor({ timeout: 15000 });
check("D2. the stain log's plain address finds the lab", ownerPage.url().includes(`/labs/${labId}/equipment-app/stain-log`) || await ownerPage.getByTestId("stain-grid").count() > 0, ownerPage.url());

// The VeritaMaintain card, now with a log on it
await ownerPage.goto(`${BASE}/labs/${labId}/equipment-app`, { waitUntil: "networkidle" });
await ownerPage.getByTestId("stain-panel-table").waitFor({ timeout: 15000 });
check("D2. the card lists the instrument and the manual log", /Made-up autostainer/.test(await ownerPage.getByTestId("stain-panel-table").innerText()) && /Manual stain log/.test(await ownerPage.getByTestId("stain-panel-table").innerText()));
await ownerPage.getByTestId("stain-log-panel").screenshot({ path: `${OUT}/stain-panel.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
