// scripts/verify-veritadc-approval-routes-ui.mjs
//
// Browser receipt for VeritaDC approval routes (Michael 2026-11-04, Q155 = 1). On a local production build with a scratch DB, a
// made-up owner, an editor and roster people:
//   R1. the Approval routes dialog lists the seeded routes and says who signs each step in words
//   R2. Manage groups opens from the dialog; a roster person with no login is flagged as unable to sign
//   R3. the owner adds a route with a group step and a named-role step
//   R4. moving a step changes the order and removing one closes the route up
//   R5. changing a step saves and shows the new wording
//   R6. with a document in review the route says it is locked and its edit controls are gone
//   R7. an editor who is not an owner or admin sees the routes read-only
//   R8. phone width and dark mode: the dialog doesn't overflow and reads
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-approval-routes-ui.mjs
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
const pw = ["Route", "Scr", "77!"].join("-");
const stamp = Date.now();

const email = `routes-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Approval Routes Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;

const now = new Date().toISOString();
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Approval Routes Test Lab', '22D7790002', ?, ?, ?)", ownerId, labId, now, now));
sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Example', 'Sam', 'active', ?, ?)", staffLab, labId, ownerId, now, now);

const editorEmail = `routes-editor-${stamp}@example.com`;
const editor = await call("POST", "/api/auth/register", { email: editorEmail, password: pw, name: "Eddie Editor", hipaa_acknowledged: true });
const editorId = Number(editor.body?.user?.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, editorId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, editorId);
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`, ownerId, editorEmail, editorId, now, now, `routes-${stamp}`, labId);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", editorId);
const editorToken = (await call("POST", "/api/auth/login", { email: editorEmail, password: pw })).body.token;

const browser = await chromium.launch();
const openAs = async (tk, opts = {}) => {
  const page = await (await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 } })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [tk, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  return page;
};
const openRoutes = async (page) => {
  await page.getByTestId("approval-steps-button").waitFor({ timeout: 20000 });
  await page.getByTestId("approval-steps-button").click();
  await page.getByTestId("approval-steps-workflow").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(500); // the dialog fades in; let it finish so the screenshots and colors are the settled ones
};
const pickOption = async (page, trigger, label) => {
  await trigger.click();
  await page.getByRole("option", { name: label }).first().click();
};

const page = await openAs(token);
await openRoutes(page);

// R1
const firstWho = await page.getByTestId("route-step-who-label").first().textContent().catch(() => "");
check("R1. the routes list and say who signs in words", firstWho === "Medical director or designee", firstWho);

// R2
await page.getByTestId("groups-manage-button").click();
await page.getByTestId("group-new-name").fill("Supervisors");
await page.getByTestId("group-add").click();
const groupRow = page.locator('[data-testid^="group-row-"]').filter({ hasText: "Supervisors" });
await groupRow.waitFor({ timeout: 10000 });
await groupRow.getByTestId("group-members-toggle").click();
await groupRow.getByTestId("group-roster-select").click();
await page.getByRole("option", { name: "Example, Sam (no email on file)" }).click();
await groupRow.getByTestId("group-member-add").click();
await groupRow.getByTestId("group-member-no-login").waitFor({ timeout: 10000 }).catch(() => {});
check("R2a. a person with no login is flagged as unable to sign", await groupRow.getByTestId("group-member-no-login").isVisible().catch(() => false));
const counts = (await groupRow.getByTestId("group-counts").textContent().catch(() => "")) || "";
check("R2b. the group counts who can sign", counts.includes("1 person") && counts.includes("0 can sign"), counts.trim());
await page.screenshot({ path: `${OUT}/approval-routes-group.png` });
await page.keyboard.press("Escape");
await page.getByRole("dialog").filter({ hasText: "Approval routes" }).waitFor({ timeout: 5000 });

// R3
await page.getByTestId("route-new-name").fill("Supervisor then director");
await page.getByTestId("route-add").click();
const route = page.getByTestId("approval-steps-workflow").filter({ hasText: "Supervisor then director" });
await route.waitFor({ timeout: 10000 });
await route.getByTestId("route-step-add").click();
await route.getByTestId("route-step-name").fill("Supervisor review");
await route.getByTestId("route-step-group").click();
await page.getByRole("option", { name: /Supervisors/ }).click();
await route.getByTestId("route-step-save").click();
await route.getByTestId("route-step-row").first().waitFor({ timeout: 10000 });
await route.getByTestId("route-step-add").click();
await route.getByTestId("route-step-name").fill("Director sign-off");
await pickOption(page, route.getByTestId("route-step-who"), "Medical director or designee");
await route.getByTestId("route-step-save").click();
await route.getByTestId("route-step-row").nth(1).waitFor({ timeout: 10000 });
const labels = async () => route.getByTestId("route-step-who-label").allTextContents();
check("R3. the new route shows both steps in words", JSON.stringify(await labels()) === JSON.stringify(["Any one member of Supervisors", "Medical director or designee"]), JSON.stringify(await labels()));
await page.screenshot({ path: `${OUT}/approval-routes-built.png` });

// R4
await route.getByTestId("route-step-down").first().click();
await page.waitForTimeout(700);
check("R4a. moving a step changes the order", (await labels())[0] === "Medical director or designee", JSON.stringify(await labels()));
await route.getByTestId("route-step-up").nth(1).click();
await page.waitForTimeout(700);
await route.getByTestId("route-step-add").click();
await route.getByTestId("route-step-name").fill("Extra step");
await pickOption(page, route.getByTestId("route-step-who"), "General supervisor");
await route.getByTestId("route-step-save").click();
await route.getByTestId("route-step-row").nth(2).waitFor({ timeout: 10000 });
await route.getByTestId("route-step-remove").nth(2).click();
await page.waitForTimeout(700);
check("R4b. removing a step closes the route up", (await route.getByTestId("route-step-row").count()) === 2);

// R5
await route.getByTestId("route-step-edit").first().click();
await route.getByTestId("route-step-name").fill("Supervisor sign-off");
await route.getByTestId("route-step-save").click();
await page.waitForTimeout(700);
check("R5. changing a step saves", ((await route.getByTestId("route-step-row").first().textContent()) || "").includes("Supervisor sign-off"));

// R6
const fd = new FormData();
fd.append("file", new Blob([Buffer.from("Made-up procedure text\n")], { type: "text/plain" }), "made-up.txt");
fd.append("title", "Routes Procedure (made-up)");
const doc = await (await fetch(`${BASE}/api/labs/${labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
const workflows = (await call("GET", `/api/labs/${labId}/veritapolicy/workflows`, undefined, token)).body.workflows;
const wf = workflows.find((w) => w.name === "Supervisor then director");
const submitted = await call("POST", `/api/labs/${labId}/veritapolicy/documents/${doc.id}/submit`, { workflowId: wf.id }, token);
check("R6a. a document goes in review on the route", submitted.status === 200, `HTTP ${submitted.status}`);
await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
await openRoutes(page);
const lockedRoute = page.getByTestId("approval-steps-workflow").filter({ hasText: "Supervisor then director" });
await lockedRoute.getByTestId("route-locked").waitFor({ timeout: 10000 }).catch(() => {});
check("R6b. the route says it is locked", ((await lockedRoute.getByTestId("route-locked").textContent().catch(() => "")) || "").includes("1 document is in review"));
check("R6c. its edit controls are gone", (await lockedRoute.getByTestId("route-step-add").count()) === 0 && (await lockedRoute.getByTestId("route-step-edit").count()) === 0);
await page.screenshot({ path: `${OUT}/approval-routes-locked.png` });

// R7
const editorPage = await openAs(editorToken);
await openRoutes(editorPage);
check("R7a. an editor sees that only an owner or admin can change routes", await editorPage.getByTestId("route-read-only").isVisible().catch(() => false));
check("R7b. an editor has no controls to change a route", (await editorPage.getByTestId("route-step-add").count()) === 0 && (await editorPage.getByTestId("route-add").count()) === 0 && (await editorPage.getByTestId("groups-manage-button").count()) === 0);

// R8
const phone = await openAs(token, { viewport: { width: 390, height: 800 } });
await phone.evaluate(() => document.documentElement.classList.add("dark"));
await openRoutes(phone);
const fit = await phone.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return { dialog: d ? d.scrollWidth - d.clientWidth : -1, page: document.documentElement.scrollWidth - window.innerWidth };
});
check("R8a. on a phone the dialog doesn't overflow sideways", fit.dialog <= 0 && fit.page <= 0, JSON.stringify(fit));
const color = await phone.getByTestId("route-step-who-label").first().evaluate((el) => getComputedStyle(el).color);
const channels = (color.match(/[\d.]+/g) || []).map(Number);
check("R8b. dark mode: who signs is readable", channels.length >= 3 && channels[0] > 110, color);
await phone.screenshot({ path: `${OUT}/approval-routes-phone-dark.png` });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
