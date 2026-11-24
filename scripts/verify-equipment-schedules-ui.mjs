// scripts/verify-equipment-schedules-ui.mjs
//
// Browser receipt for VeritaMaintain schedules and checklists (B10, 2026-11-24). On a local production build with a scratch DB, made-up people and made-up instruments:
//   S1. the PM interval shows as the first schedule; add a daily one with its SOP; the SOP opens at its approved version
//   S2. set its checklist (a check, a value with limits); it is version 1
//   S3. a Staff login gets Due now, answers it: a failed step asks for its corrective action; saved, it is due tomorrow and off Due now
//   S4. edit the checklist: version 2; what was done still shows version 1's steps; the history shows the answers
//   S5. Log maintenance: an entry completes the PM and another schedule; the one with a checklist can't be ticked
//   S6. end a schedule with a reason
//   S7. the review email switch, with who it would reach
//   S8. the monthly review shows the days with no record
//   S9. a Staff login gets Complete and no setup; phone width doesn't overflow
// Screenshots b910_schedules_*.png, b910_checklist_*.png, b910_complete_*.png, b910_review_*.png, light and dark.
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> POLICY_STORAGE_ROOT=<dir> node scripts/verify-equipment-schedules-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Sched", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `schui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Schedule Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const L = `/api/labs/${labId}`;
const person = async (tag, name) => {
  const e = `schui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1, email_verification_pending = 0 WHERE id = ?", labId, id);
  return { id, email: e };
};
const sam = await person("staff", "Sam Stafford");
const staffLab = Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Schedule Test Lab', '99D0000125', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Stafford', 'Sam', 'active', ?, ?)", staffLab, labId, ownerId, now, now).lastInsertRowid);
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`, ownerId, sam.email, sam.id, labId, emp, now, now);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", sam.id);
const staffToken = (await call("POST", "/api/auth/login", { email: sam.email, password: pw })).body.token;
const md = await person("md", "Morgan Director");
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'active')`, ownerId, md.email, md.id, now, now, `schui-md-${stamp}`, labId);
sql("UPDATE labs SET medical_director_email = ? WHERE id = ?", md.email, labId);
const rel = `${labId}/ui-sop/v1/document.txt`;
const abs = path.join(process.env.POLICY_STORAGE_ROOT, rel);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, "Made-up daily maintenance SOP, approved version.");
const manual = Number(sql("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Chemistry')", labId).lastInsertRowid);
const doc = Number(sql("INSERT INTO policy_documents (lab_id, manual_id, title, owner_user_id, status, doc_number) VALUES (?, ?, 'Daily maintenance', ?, 'approved', 'CH 14')", labId, manual, ownerId).lastInsertRowid);
const ver = Number(sql("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, 1, ?, 'txt', 48, ?, ?)", doc, rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"), ownerId).lastInsertRowid);
sql("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?", ver, ver, doc);
const id = (await call("POST", `${L}/equipment`, { instrument_name: "Made-up 500 analyzer", pm_interval_days: 90, next_due_date: "2030-01-01", location: "Bench 1" }, token)).body.id;
sql("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", id);

const browser = await chromium.launch();
const openAs = async (tk, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [tk, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
// A toast on screen takes the first Escape, so close by the dialog's own button.
const closeTop = async (p) => { await p.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).click(); await p.waitForTimeout(350); };
const PAGE = `/labs/${labId}/equipment-app`;

try {
  const page = await openAs(token, PAGE);
  // ── S1 ──
  await page.getByTestId(`equip-schedules-open-${id}`).click();
  const first = sql("SELECT id FROM equipment_schedules WHERE equipment_id = ? AND is_primary = 1", id).id;
  await page.getByTestId(`schedule-${first}`).waitFor({ timeout: 8000 });
  const ft = await page.getByTestId(`schedule-${first}`).innerText();
  check("S1. the PM interval is the first schedule", /Preventive maintenance/.test(ft) && /Every 90 days/.test(ft) && /next due 2030-01-01/.test(ft) && /PM date/.test(ft), ft);
  await page.getByTestId("schedule-add").click();
  await page.getByTestId("sf-name").fill("Daily maintenance");
  await page.getByTestId("sf-type").selectOption("function_check");
  check("S1. a daily schedule starts today", (await page.getByTestId("sf-due").inputValue()).length === 10 && (await page.getByTestId("sf-frequency").inputValue()) === "daily");
  await page.getByTestId("sf-sop-open").click();
  await page.getByTestId(`sf-sop-doc-${doc}`).click();
  await page.getByTestId("sf-save").click();
  await page.getByText("Added Daily maintenance").first().waitFor({ timeout: 8000 });
  const daily = sql("SELECT id, next_due_date, sop_document_id FROM equipment_schedules WHERE equipment_id = ? AND frequency = 'daily'", id);
  check("S1. it is saved with its SOP", daily.sop_document_id === doc, JSON.stringify(daily));
  await page.getByTestId("schedule-add").click();
  await page.getByTestId("sf-name").fill("Weekly clean");
  await page.getByTestId("sf-type").selectOption("service");
  await page.getByTestId("sf-frequency").selectOption("weekly");
  await page.getByTestId("sf-recipients").fill("bench@example.com");
  await page.getByTestId("sf-save").click();
  await page.waitForTimeout(900);
  const weekly = sql("SELECT id, recipients_json FROM equipment_schedules WHERE equipment_id = ? AND frequency = 'weekly'", id);
  check("S1. another, with its own reminder list", /bench@example\.com/.test(weekly.recipients_json));
  await page.getByTestId(`schedule-sop-${daily.id}`).click();
  check("S1. the SOP opens at its approved version", await page.frameLocator('[data-testid="approved-document-frame"]').getByText("Made-up daily maintenance SOP, approved version.").waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await closeTop(page);

  // ── S2 ──
  await page.getByTestId(`schedule-checklist-${daily.id}`).click();
  await page.getByTestId("cl-add").click();
  await page.getByTestId("cl-text-1").fill("Wipe the sample probe");
  await page.getByTestId("cl-add").click();
  await page.getByTestId("cl-text-2").fill("Reagent compartment temperature");
  await page.getByTestId("cl-kind-2").selectOption("value");
  await page.getByTestId("cl-min-2").fill("9");
  await page.getByTestId("cl-max-2").fill("2");
  await page.getByTestId("cl-save").click();
  await page.waitForTimeout(300);
  check("S2. crossed limits are refused", await page.getByTestId("checklist-form").isVisible());
  await page.getByTestId("cl-min-2").fill("2");
  await page.getByTestId("cl-max-2").fill("8");
  await page.getByTestId("cl-unit-2").fill("°C");
  await page.getByTestId("cl-add").click();
  await page.getByTestId("cl-text-3").fill("Empty the waste");
  await page.waitForTimeout(300);
  await page.getByTestId("checklist-form").screenshot({ path: `${OUT}/b910_checklist_light.png` });
  await page.getByTestId("cl-save").click();
  await page.getByText("Checklist version 1 saved").first().waitFor({ timeout: 8000 });
  check("S2. it is version 1 with three steps", /3 steps, version 1/.test(await page.getByTestId(`schedule-${daily.id}`).innerText()));
  await page.getByTestId("schedules-dialog").screenshot({ path: `${OUT}/b910_schedules_light.png` });

  // ── S3 ── a Staff login
  const sp = await openAs(staffToken, PAGE);
  await sp.getByTestId(`due-now-${daily.id}`).waitFor({ timeout: 10000 });
  check("S3. Due now lists it for a Staff login", /Daily maintenance/.test(await sp.getByTestId(`due-now-${daily.id}`).innerText()));
  await sp.getByTestId(`due-now-complete-${daily.id}`).click();
  await sp.getByTestId("complete-steps").waitFor({ timeout: 8000 });
  await sp.getByTestId("step-1-pass").check();
  await sp.getByTestId("step-2-value").fill("11");
  check("S3. a value outside its limits says so and asks for the corrective action", /Outside its limits/.test(await sp.getByTestId("step-2").innerText()) && await sp.getByTestId("step-2-action").isVisible());
  await sp.getByTestId("complete-save").click();
  await sp.waitForTimeout(500);
  check("S3. it isn't saved without it", !sql("SELECT id FROM equipment_schedule_completions WHERE schedule_id = ?", daily.id) && await sp.getByTestId("complete-dialog").isVisible());
  await sp.getByTestId("step-2-action").fill("Moved the reagents to the second cooler and called service");
  await sp.getByTestId("step-3-na").check();
  await sp.getByTestId("complete-dialog").screenshot({ path: `${OUT}/b910_complete_light.png` });
  await sp.getByTestId("complete-save").click();
  await sp.getByText("Daily maintenance completed").first().waitFor({ timeout: 8000 });
  const c = sql("SELECT * FROM equipment_schedule_completions WHERE schedule_id = ?", daily.id);
  check("S3. it records who, the version and the failed step", c.completed_by_name === "Sam Stafford" && c.checklist_version_no === 1 && c.failed_steps === 1 && c.step_count === 3, JSON.stringify(c));
  await sp.waitForTimeout(700);
  check("S3. done, it is off Due now", (await sp.getByTestId(`due-now-${daily.id}`).count()) === 0 && sql("SELECT next_due_date AS d FROM equipment_schedules WHERE id = ?", daily.id).d > daily.next_due_date);
  // ── S9 ──
  await sp.getByTestId(`equip-schedules-open-${id}`).click();
  await sp.getByTestId(`schedule-complete-${daily.id}`).waitFor({ timeout: 8000 });
  check("S9. a Staff login gets Complete and no setup", (await sp.getByTestId("schedule-add").count()) === 0 && (await sp.getByTestId(`schedule-edit-${daily.id}`).count()) === 0 && (await sp.getByTestId(`schedule-checklist-${daily.id}`).count()) === 0 && (await sp.getByTestId(`schedule-end-${daily.id}`).count()) === 0 && await sp.getByTestId("review-due-email").isDisabled());

  // ── S4 ──
  await page.getByTestId(`schedule-checklist-${daily.id}`).click();
  await page.getByTestId("cl-text-1").fill("Wipe the sample probe and the reagent arm");
  await page.locator("#cl-note").fill("Reagent arm added");
  await page.getByTestId("cl-save").click();
  await page.getByText("Checklist version 2 saved").first().waitFor({ timeout: 8000 });
  await page.getByTestId(`schedule-done-${daily.id}`).click();
  const doneText = await page.getByTestId(`completion-${c.id}`).innerText();
  check("S4. what was done keeps version 1's steps", /version 1/.test(doneText) && /Wipe the sample probe\b/.test(doneText) && !/reagent arm/.test(doneText) && /Corrective action: Moved the reagents/.test(doneText), doneText);
  await closeTop(page);
  await closeTop(page);
  await page.getByTestId(`equip-history-${id}`).click();
  check("S4. the history shows the answers", await page.getByTestId(`history-completion-${c.id}`).waitFor({ timeout: 8000 }).then(async () => /Reagent compartment temperature: 11 °C/.test(await page.getByTestId(`history-completion-${c.id}`).innerText())).catch(() => false));
  await closeTop(page);

  // ── S5 ──
  await page.getByTestId(`equip-log-${id}`).click();
  await page.locator("#ev-type").click();
  await page.getByRole("option", { name: "Preventive maintenance", exact: true }).click();
  check("S5. the one with a checklist can't be ticked here", await page.getByTestId(`ev-schedule-${daily.id}`).isDisabled() && await page.getByTestId(`ev-schedule-${weekly.id}`).isEnabled());
  await page.getByTestId(`ev-schedule-${weekly.id}`).check();
  const weeklyBefore = sql("SELECT next_due_date AS d FROM equipment_schedules WHERE id = ?", weekly.id).d;
  await page.getByRole("dialog").getByRole("button", { name: "Log maintenance" }).click();
  await page.waitForTimeout(1000);
  const done = sql("SELECT COUNT(*) AS n FROM equipment_schedule_completions WHERE equipment_id = ? AND schedule_id IN (?, ?)", id, first, weekly.id).n;
  check("S5. one entry completes the PM and the weekly clean; the PM date, already later, stays", done === 2 && sql("SELECT next_due_date AS d FROM lab_equipment WHERE id = ?", id).d === "2030-01-01" && sql("SELECT next_due_date AS d FROM equipment_schedules WHERE id = ?", weekly.id).d >= weeklyBefore, `${done}`);

  // ── S6 ──
  await page.getByTestId(`equip-schedules-open-${id}`).click();
  await page.getByTestId(`schedule-end-${weekly.id}`).click();
  await page.getByTestId("end-schedule-reason").fill("Now part of the daily checklist");
  await page.getByTestId("end-schedule-confirm").click();
  await page.getByText("Schedule ended").first().waitFor({ timeout: 8000 });
  check("S6. it ends with its reason and stays on file", sql("SELECT active, end_reason FROM equipment_schedules WHERE id = ?", weekly.id).end_reason === "Now part of the daily checklist");
  await closeTop(page);

  // ── S7 ──
  check("S7. the review email is off, and says who it would reach", !(await page.getByTestId("review-due-email").isChecked()) && /1 person would be emailed/.test(await page.getByTestId("review-due-recipients").innerText()), await page.getByTestId("review-due-recipients").innerText());
  await page.getByTestId("review-due-email").click();
  await page.getByText("Review emails are on").first().waitFor({ timeout: 8000 });
  check("S7. it turns on", sql("SELECT review_due_email AS v FROM maintain_settings WHERE lab_id = ?", labId).v === 1);

  // ── S8 ── last month: the daily schedule owed a record from the 10th, and has two
  const t = (await call("GET", `${L}/stain-log`, undefined, token)).body.today;
  const [ty, tm] = t.split("-").map(Number);
  const month = new Date(Date.UTC(ty, tm - 2, 1)).toISOString().slice(0, 7);
  sql("UPDATE equipment_schedules SET starts_on = ? WHERE id = ?", `${month}-24`, daily.id);
  const list = (await call("GET", `${L}/equipment/${id}/schedules`, undefined, token)).body.schedules.find((s) => s.id === daily.id).checklist;
  for (const d of ["24", "25"]) await call("POST", `${L}/equipment/${id}/schedules/${daily.id}/complete`, { done_on: `${month}-${d}`, version_id: list.version_id, answers: list.steps.map((s) => ({ step_id: s.id, ...(s.kind === "value" ? { value: 5 } : { result: "pass" }) })) }, token);
  await page.reload({ waitUntil: "networkidle" });
  const row = page.getByTestId(`review-row-equipment-${id}`);
  await row.waitFor({ timeout: 10000 });
  const rt = await row.innerText();
  check("S8. the monthly review names the days with no record", /Daily maintenance: \d+ days? with no record: \d+\/26/.test(rt) && /Daily maintenance: 2 of \d+ days done/.test(rt), rt);
  await page.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/b910_review_light.png` });

  // ── Dark and phone ──
  sql("UPDATE equipment_schedules SET next_due_date = ? WHERE id = ?", t, daily.id);
  const dark = await openAs(token, PAGE, { dark: true });
  await dark.getByTestId(`due-now-${daily.id}`).waitFor({ timeout: 10000 });
  await dark.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await dark.getByTestId(`review-row-equipment-${id}`).waitFor({ timeout: 10000 });
  await dark.getByTestId("monthly-review-panel").screenshot({ path: `${OUT}/b910_review_dark.png` });
  await dark.getByTestId(`due-now-complete-${daily.id}`).click();
  await dark.getByTestId("complete-steps").waitFor({ timeout: 8000 });
  await dark.getByTestId("step-1-fail").check();
  await dark.getByTestId("step-2-value").fill("5");
  await dark.waitForTimeout(400);
  await dark.getByTestId("complete-dialog").screenshot({ path: `${OUT}/b910_complete_dark.png` });
  await closeTop(dark);
  await dark.getByTestId(`equip-schedules-open-${id}`).click();
  await dark.getByTestId(`schedule-checklist-${daily.id}`).waitFor({ timeout: 8000 });
  await dark.waitForTimeout(400);
  await dark.getByTestId("schedules-dialog").screenshot({ path: `${OUT}/b910_schedules_dark.png` });
  await dark.getByTestId(`schedule-checklist-${daily.id}`).click();
  await dark.getByTestId("checklist-form").waitFor({ timeout: 8000 });
  await dark.waitForTimeout(400);
  await dark.getByTestId("checklist-form").screenshot({ path: `${OUT}/b910_checklist_dark.png` });
  const phone = await openAs(token, PAGE, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId(`due-now-${daily.id}`).waitFor({ timeout: 10000 });
  const o1 = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const over = async (tid) => phone.getByTestId(tid).evaluate((el) => el.scrollWidth - el.clientWidth);
  await phone.getByTestId(`due-now-complete-${daily.id}`).click();
  await phone.getByTestId("complete-steps").waitFor({ timeout: 8000 });
  const o2 = await over("complete-dialog");
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}/b910_complete_phone.png` });
  await closeTop(phone);
  await phone.getByTestId(`equip-schedules-open-${id}`).click();
  await phone.getByTestId(`schedule-checklist-${daily.id}`).click();
  await phone.getByTestId("checklist-form").waitFor({ timeout: 8000 });
  const o3 = await over("checklist-form"), o4 = await over("schedules-dialog");
  check("S9. phone width: the page and the dialogs don't overflow", o1 <= 0 && o2 <= 0 && o3 <= 0 && o4 <= 0, `${o1} ${o2} ${o3} ${o4}`);
} catch (e) {
  check("the run finished", false, String(e?.stack || e).slice(0, 700));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
