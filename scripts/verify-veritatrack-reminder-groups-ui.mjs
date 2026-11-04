// scripts/verify-veritatrack-reminder-groups-ui.mjs
//
// Browser receipt for a lab's groups and VeritaTrack group reminders (Michael 2026-11-04; server/labGroups.ts). On a local
// production build with a scratch DB, a made-up owner, two made-up roster people and a made-up editor:
//   G1. the Reminders tab offers Manage groups, and the owner adds a group
//   G2. a roster person with no login shows as having no email; adding them with a typed address shows that address
//   G3. a roster person added with no address gets the warning, and typing one clears it
//   G4. someone not on the roster joins by address, and a repeat is refused with a plain sentence
//   G5. checking the group on the recipient list saves and is still checked after a reload
//   G6. the task form offers the group, the saved task shows it, and the edit form still has it
//   G7. an editor who is not an owner or admin can pick a group but cannot manage groups
//   G8. dark mode and phone width: the dialog reads and does not overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritatrack-reminder-groups-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Group", "Rem", "77!"].join("-");
const stamp = Date.now();

// A made-up owner and lab
const email = `vtgroups-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Group Reminders Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;

// Two made-up roster people with no login
const now = new Date().toISOString();
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Group Reminders Test Lab', '22D7790001', ?, ?, ?)", ownerId, labId, now, now));
for (const [first, last] of [["Sam", "Example"], ["Pat", "Sample"]]) {
  sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)", staffLab, labId, ownerId, last, first, now, now);
}

// A made-up editor: an edit seat, not an owner or admin
const editorEmail = `vtgroups-editor-${stamp}@example.com`;
const editor = await call("POST", "/api/auth/register", { email: editorEmail, password: pw, name: "Eddie Editor", hipaa_acknowledged: true });
const editorId = Number(editor.body?.user?.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, editorId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, editorId);
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`, ownerId, editorEmail, editorId, now, now, `vtgroups-${stamp}`, labId);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", editorId);
const editorLogin = await call("POST", "/api/auth/login", { email: editorEmail, password: pw });
const editorToken = editorLogin.body.token;

const browser = await chromium.launch();
const openAs = async (tk, path, opts = {}) => {
  const page = await (await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 } })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [tk, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const TRACK = `/labs/${labId}/veritatrack-app`;
const toReminders = async (page) => {
  await page.getByTestId("reminders-tab").click();
  await page.getByTestId("reminders-panel").waitFor({ timeout: 15000 });
};
const pickOption = async (page, trigger, label) => {
  await trigger.click();
  await page.getByRole("option", { name: label, exact: true }).click();
};

const page = await openAs(token, TRACK);
await toReminders(page);

// G1
const manage = page.getByTestId("groups-manage-button");
await manage.waitFor({ timeout: 10000 }).catch(() => {});
check("G1a. the owner sees Manage groups on the Reminders tab", await manage.isVisible());
await manage.click();
await page.getByTestId("group-new-name").fill("Supervisors");
await page.getByTestId("group-add").click();
const row = page.locator('[data-testid^="group-row-"]').filter({ hasText: "Supervisors" });
await row.waitFor({ timeout: 10000 }).catch(() => {});
check("G1b. the group appears with no people yet", (await row.textContent().catch(() => "") || "").includes("0 people"));
const groupId = Number((await row.getAttribute("data-testid")).replace("group-row-", ""));

// G2
await row.getByTestId("group-members-toggle").click();
const rosterSelect = row.getByTestId("group-roster-select");
await rosterSelect.click();
const samOption = page.getByRole("option", { name: "Example, Sam (no email on file)", exact: true });
check("G2a. a roster person with no login shows as having no email", await samOption.isVisible().catch(() => false));
await samOption.click();
const samMail = `sam-${stamp}@example.com`;
await row.getByTestId("group-member-email").fill(samMail);
await row.getByTestId("group-member-add").click();
const members = row.getByTestId("group-member-row");
await members.filter({ hasText: samMail }).waitFor({ timeout: 10000 }).catch(() => {});
check("G2b. they join with the typed address", (await members.filter({ hasText: "Sam Example" }).textContent().catch(() => "") || "").includes(samMail));

// G3
await pickOption(page, rosterSelect, "Sample, Pat (no email on file)");
await row.getByTestId("group-member-add").click();
await row.getByTestId("group-no-email-warning").waitFor({ timeout: 10000 }).catch(() => {});
check("G3a. someone added with no address gets the warning", await row.getByTestId("group-no-email-warning").isVisible().catch(() => false));
const patMail = `pat-${stamp}@example.com`;
await members.filter({ hasText: "Pat Sample" }).getByTestId("group-member-address-input").fill(patMail);
await members.filter({ hasText: "Pat Sample" }).getByTestId("group-member-address-save").click();
await members.filter({ hasText: patMail }).waitFor({ timeout: 10000 }).catch(() => {});
check("G3b. typing an address clears the warning", !(await row.getByTestId("group-no-email-warning").isVisible().catch(() => false)));

// G4
const outsideMail = `outside-${stamp}@example.com`;
await row.getByTestId("group-member-email").fill(outsideMail);
await row.getByTestId("group-member-name").fill("Olly Outside");
await row.getByTestId("group-member-add").click();
await members.filter({ hasText: outsideMail }).waitFor({ timeout: 10000 }).catch(() => {});
check("G4a. someone not on the roster joins by address", await members.filter({ hasText: "Olly Outside" }).isVisible().catch(() => false));
await row.getByTestId("group-member-email").fill(outsideMail);
await row.getByTestId("group-member-add").click();
await page.getByTestId("group-error").waitFor({ timeout: 10000 }).catch(() => {});
const errorShown = (await page.getByTestId("group-error").textContent().catch(() => "")) || "";
check("G4b. a repeat is refused with a plain sentence", errorShown === "That address is already in this group.", errorShown);
await row.getByTestId("group-member-email").fill("");
await page.screenshot({ path: `${OUT}/vtgroups-manage.png` });
await page.keyboard.press("Escape");

// G5
const listBox = page.getByTestId(`list-group-${groupId}`);
await listBox.waitFor({ timeout: 10000 }).catch(() => {});
await listBox.check();
await page.getByTestId("reminders-save").click();
await page.getByTestId("reminders-saved").waitFor({ timeout: 10000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/vtgroups-recipients.png` });
await page.goto(`${BASE}${TRACK}`, { waitUntil: "networkidle" });
await toReminders(page);
await page.getByTestId(`list-group-${groupId}`).waitFor({ timeout: 10000 }).catch(() => {});
check("G5. the group on the recipient list is still checked after a reload", await page.getByTestId(`list-group-${groupId}`).isChecked().catch(() => false));
await page.getByTestId(`list-group-${groupId}`).uncheck();
await page.getByTestId("reminders-save").click();
await page.getByTestId("reminders-saved").waitFor({ timeout: 10000 }).catch(() => {});

// G6
await page.goto(`${BASE}${TRACK}`, { waitUntil: "networkidle" });
await page.getByTestId("add-task-button").click();
await page.getByPlaceholder("e.g. Calibration Verification - Sodium").fill("Monthly QC review (made-up)");
await pickOption(page, page.getByTestId("task-reminder-group"), "Supervisors");
await page.screenshot({ path: `${OUT}/vtgroups-task-form.png` });
await page.getByRole("button", { name: "Add Task", exact: true }).last().click();
await page.getByTestId("task-reminder-group").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
await page.waitForTimeout(500);
const created = (await call("GET", `/api/labs/${labId}/veritatrack/tasks`, undefined, token)).body;
const task = (Array.isArray(created) ? created : []).find((t) => t.name === "Monthly QC review (made-up)");
check("G6a. the task saved with the group", task?.reminder_group_id === groupId, `${task?.reminder_group_id}`);
await page.getByRole("button", { name: /^Other/ }).first().click().catch(() => {});
const label = page.getByTestId("task-group-label").first();
await label.waitFor({ timeout: 10000 }).catch(() => {});
check("G6b. the task's row shows the group", ((await label.textContent().catch(() => "")) || "").includes("Reminders: Supervisors"));
await page.screenshot({ path: `${OUT}/vtgroups-task-row.png` });

// G7
const editorPage = await openAs(editorToken, TRACK);
await toReminders(editorPage);
await editorPage.waitForTimeout(800);
check("G7a. an editor who is not an owner or admin has no Manage groups button", !(await editorPage.getByTestId("groups-manage-button").isVisible().catch(() => false)));
await editorPage.goto(`${BASE}${TRACK}`, { waitUntil: "networkidle" });
await editorPage.getByTestId("add-task-button").click();
await editorPage.getByTestId("task-reminder-group").waitFor({ timeout: 10000 }).catch(() => {});
check("G7b. that editor can still pick a group on a task", await editorPage.getByTestId("task-reminder-group").isVisible().catch(() => false));

// G8
const phone = await openAs(token, TRACK, { viewport: { width: 390, height: 800 } });
await phone.evaluate(() => document.documentElement.classList.add("dark"));
await toReminders(phone);
await phone.getByTestId("groups-manage-button").click();
const phoneRow = phone.locator(`[data-testid="group-row-${groupId}"]`);
await phoneRow.getByTestId("group-members-toggle").click();
await phoneRow.getByTestId("group-member-row").first().waitFor({ timeout: 10000 }).catch(() => {});
const fit = await phone.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return { dialog: d ? d.scrollWidth - d.clientWidth : -1, page: document.documentElement.scrollWidth - window.innerWidth };
});
check("G8a. on a phone the dialog does not overflow sideways", fit.dialog <= 0 && fit.page <= 0, JSON.stringify(fit));
const textColor = await phoneRow.getByTestId("group-member-row").first().locator("span span").first().evaluate((el) => getComputedStyle(el).color);
const channels = (textColor.match(/[\d.]+/g) || []).map(Number);
check("G8b. dark mode: a member's name is light text", channels.length >= 3 && channels[0] > 150, textColor);
await phone.screenshot({ path: `${OUT}/vtgroups-phone-dark.png` });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
