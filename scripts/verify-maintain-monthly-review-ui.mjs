// scripts/verify-maintain-monthly-review-ui.mjs
//
// Browser receipt for the VeritaMaintain monthly record review (Michael 2026-11-04, Q161 = 1). On a local production build with a scratch DB, a made-up owner, a made-up General
// Supervisor with a signed Letter of Delegation, a made-up editor with none, and made-up records for last month:
//   R1. the panel opens on last month with each record and what the records show; a short day and overdue PM read as problems
//   R2. someone with no authority sees the records, is told why they can't sign, and has no way to sign
//   R3. the Letter of Delegation form offers this duty
//   R4. signing a record with a problem asks for the corrective action; a wrong password is refused in plain words
//   R5. the signed row shows who, as what and the action, and the count moves
//   R6. a reading added afterward shows as added after the review
//   R7. the Excel report downloads with the review and the records
//   D1. dark mode and phone width read and do not overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-maintain-monthly-review-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Review", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `reviewui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Review Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const addEditor = async (tag, name) => {
  const e = `reviewui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`, ownerId, e, id, now, now, `reviewui-${tag}-${stamp}`, labId);
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { id, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token };
};
const gs = await addEditor("gs", "Gale Supervisor");
const editor = await addEditor("editor", "Eddie Editor");
sql(`INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, created_at, updated_at) VALUES (?, ?, 'Gale Supervisor', 'general_supervisor', 'high', '{"equipment_record_review":true}', 'active', ?, ?)`, labId, gs.id, now, now);

// Made-up records for last month
const today = new Date();
const lastMonthDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
const month = lastMonthDate.toISOString().slice(0, 7);
const days = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate();
const L = `/api/labs/${labId}`;
const stainer = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up autostainer", location: "Histology", pm_interval_days: 180, next_due_date: `${month}-02` }, token)).body.id;
await call("POST", `${L}/equipment/${stainer}/events`, { event_type: "solution_change", event_date: `${month}-03`, performed_by: "MU", notes: "Changed: Hematoxylin, eosin" }, token);
const fridge = (await call("POST", `${L}/temp-logs/units`, { name: "Made-up refrigerator", location: "Histology", min_value: 2, max_value: 8, readings_per_day: 1 }, token)).body.id;
sql("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", stainer);
sql("UPDATE temp_log_units SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", fridge);
for (let d = 1; d <= days; d += 1) {
  if (d === 10) continue;
  const day = `${month}-${String(d).padStart(2, "0")}`;
  sql("INSERT INTO temp_log_readings (lab_id, unit_id, reading_date, reading_time, value, in_range, initials, created_at) VALUES (?, ?, ?, '08:00', 4, 1, 'MU', ?)", labId, fridge, day, `${day}T12:00:00.000Z`);
}

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
const PAGE = `/labs/${labId}/equipment-app`;
const openPanel = async (page) => {
  await page.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("review-table").waitFor({ timeout: 15000 });
};

// No authority
{
  const page = await openAs(editor.token, PAGE);
  await openPanel(page);
  check("R2. someone with no authority sees the records", (await page.getByTestId("review-table").innerText()).includes("Made-up refrigerator"));
  check("R2. and is told why they can't sign", /named in a signed Letter of Delegation/.test(await page.getByTestId("review-cant-sign").innerText()));
  check("R2. and has no way to sign", await page.getByTestId("review-open-sign").count() === 0 && await page.getByTestId(`review-pick-temp_unit-${fridge}`).count() === 0);
  await page.context().close();
}

// The Letter of Delegation offers the duty
{
  const cat = await call("GET", `${L}/director-delegations/catalog`, undefined, token);
  const items = cat.body.catalog || [];
  check("R3. the Letter of Delegation offers this duty to a General Supervisor", items.some((i) => i.key === "equipment_record_review" && i.positions.includes("general_supervisor") && i.gate === "equipment_record_review"), `HTTP ${cat.status} ${items.length}`);
}

// The General Supervisor signs
{
  const page = await openAs(gs.token, PAGE);
  await openPanel(page);
  check("R1. the panel opens on last month", (await page.getByTestId("review-month").innerText()) === month, await page.getByTestId("review-month").innerText());
  const table = await page.getByTestId("review-table").innerText();
  check("R1. a short day reads as a problem, by date", /1 day short of a reading: \d+\/10/.test(table), table.slice(0, 160));
  check("R1. overdue PM reads as a problem", /PM was due/.test(table));
  check("R1. the solution change is counted", /1 solution change/.test(table));
  await page.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/review-month.png` });
  await page.getByTestId("review-open-sign").click();
  check("R4. the dialog says who is signing as what", /Designee, General Supervisor/.test(await page.getByRole("dialog").innerText()));
  await page.getByTestId("review-problems").waitFor();
  await page.getByTestId("review-name").fill("Gale Supervisor");
  await page.getByTestId("review-password").fill(pw);
  await page.getByTestId("review-sign").click();
  await page.waitForTimeout(500);
  check("R4. a problem without a corrective action is refused", !sql("SELECT id FROM maintain_record_reviews WHERE lab_id = ?", labId) && await page.getByRole("dialog").isVisible());
  await page.getByTestId("review-action").fill("Reminded staff of the daily check; contents were within range the next morning. PM booked.");
  await page.getByTestId("review-password").fill("wrong-password");
  await page.getByTestId("review-sign").click();
  const refused = await page.getByText("Password incorrect", { exact: false }).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("R4. a wrong password is refused in plain words", refused && !sql("SELECT id FROM maintain_record_reviews WHERE lab_id = ?", labId));
  await page.getByTestId("review-password").fill(pw);
  await page.screenshot({ path: `${OUT}/review-sign.png` });
  await page.getByTestId("review-sign").click();
  await page.waitForTimeout(1200);
  const count = await page.getByTestId("review-count").innerText();
  check("R5. the count moves", new RegExp(`2 of 2 records reviewed for ${month}`).test(count), count);
  const row = await page.getByTestId(`review-row-temp_unit-${fridge}`).innerText();
  check("R5. the row shows who, as what and the action", /Gale Supervisor, Designee, General Supervisor/.test(row) && /Corrective action: Reminded staff/.test(row), row.slice(0, 120));
  check("R5. no way to sign it twice", await page.getByTestId("review-open-sign").count() === 0);

  await call("POST", `${L}/temp-logs/units/${fridge}/readings`, { reading_date: `${month}-10`, value: 4, initials: "MU" }, token);
  await page.reload({ waitUntil: "networkidle" });
  await openPanel(page);
  check("R6. a reading added afterward shows as added after the review", /1 added after this review was signed/.test(await page.getByTestId(`review-after-temp_unit-${fridge}`).innerText()));
  await page.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/review-signed.png` });

  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("review-report").click()]);
  const file = `${OUT}/review-report.xlsx`;
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  check("R7. the report downloads with the review and the records", wb.worksheets.map((w) => w.name).join("|") === "About|Monthly Review|Temperature Readings|Equipment Entries", wb.worksheets.map((w) => w.name).join("|"));
  await page.context().close();
}

// Dark mode and phone width
{
  const dark = await openAs(gs.token, PAGE, { dark: true });
  await openPanel(dark);
  await dark.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/review-dark.png` });
  check("D1. dark mode: the page does not overflow", await dark.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await dark.context().close();
  const phone = await openAs(gs.token, PAGE, { viewport: { width: 390, height: 844 } });
  await openPanel(phone);
  await phone.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/review-phone.png` });
  check("D1. phone width: the page does not overflow", await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await phone.context().close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
