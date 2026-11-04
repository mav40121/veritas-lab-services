// scripts/verify-staff-roster-one-list-ui.mjs
//
// Browser receipt for one list of staff (Michael 2026-11-04, Redington). On a local production build with a scratch DB, a made-up owner and made-up roster people:
//   L1. Lab Members lists everyone on the VeritaStaff roster with who has been invited, and the filter shows the rest
//   L2. inviting from a row uses that person's card: VeritaStaff still shows one card, and the row reads Invited
//   L3. typing the name of someone on the roster in Invite a new member links to their card and says so; no second card
//   L4. typing someone new still adds them
//   L5. a second card an invite already made folds into the real one when VeritaStaff opens
//   L6. Add Employee takes an optional email and sends the invite on that new row
//   D1. dark mode and phone width read and do not overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-staff-roster-one-list-ui.mjs
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
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Roster", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `rosterui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Roster Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Roster Test Lab', '22D0000888', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const addRow = (first, last, title) => Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '2026-02-06', 1, 'active', ?, ?)", staffLab, labId, ownerId, last, first, title, now, now).lastInsertRowid);
const ann = addRow("Ann", "Signer", "MLT(ASCP)");
const bea = addRow("Bea", "Sample", "MLS(ASCP)");
addRow("Cal", "Tester", "Phlebotomist");
const syl = addRow("Syl", "Card", "MLT(ASCP)");
const activeRows = (last) => sql("SELECT COUNT(*) AS n FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND last_name = ?", labId, last).n;

const browser = await chromium.launch();
const openAs = async (path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [token, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const MEMBERS = `/labs/${labId}/members`;

{
  const page = await openAs(MEMBERS);
  await page.getByTestId("roster-staff-card").waitFor({ timeout: 15000 });
  const counts = await page.getByTestId("roster-staff-counts").innerText();
  check("L1. Lab Members lists everyone on the roster", /4 on the roster: 0 with a login, 0 invited, 4 not invited yet/.test(counts), counts);
  await page.getByTestId("roster-staff-card").screenshot({ path: `${OUT}/roster-list.png` });

  await page.getByTestId(`roster-staff-email-${ann}`).fill(`rosterui-ann-${stamp}@example.com`);
  await page.getByTestId(`roster-staff-invite-${ann}`).click();
  await page.waitForFunction((id) => !document.querySelector(`[data-testid="roster-staff-row-${id}"]`), ann, { timeout: 15000 }).catch(() => {});
  check("L2. inviting from a row uses that person's card", sql("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?", `rosterui-ann-${stamp}@example.com`)?.e === ann && activeRows("Signer") === 1);
  const after = await page.getByTestId("roster-staff-counts").innerText();
  check("L2. the count moves", /1 invited, 3 not invited yet/.test(after), after);
  await page.getByTestId("roster-staff-open-only").uncheck();
  check("L2. the row reads Invited, with the address", /Invited: rosterui-ann/.test(await page.getByTestId(`roster-staff-row-${ann}`).innerText()));
  await page.getByTestId("roster-staff-open-only").check();

  await page.locator("#invite-email").fill(`rosterui-bea-${stamp}@example.com`);
  await page.getByLabel("First name").fill("bea");
  await page.getByLabel("Last name").fill("SAMPLE");
  await page.getByRole("button", { name: /Send invite/i }).click();
  const linked = await page.getByText(/Linked to Sample, Bea on your VeritaStaff roster/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("L3. a typed name links to the card and says so", linked);
  check("L3. no second card", activeRows("Sample") === 1 && sql("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?", `rosterui-bea-${stamp}@example.com`)?.e === bea);
  await page.screenshot({ path: `${OUT}/roster-linked.png` });

  await page.locator("#invite-email").fill(`rosterui-nina-${stamp}@example.com`);
  await page.getByLabel("First name").fill("Nina");
  await page.getByLabel("Last name").fill("Newhire");
  await page.getByRole("button", { name: /Send invite/i }).click();
  await page.waitForTimeout(1200);
  check("L4. someone new still gets added", activeRows("Newhire") === 1 && !!sql("SELECT id FROM user_seats WHERE seat_email = ?", `rosterui-nina-${stamp}@example.com`));
  await page.context().close();
}

// A second card an invite already made, as Redington has now
{
  const stub = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Card', 'Syl', 'H', 0, 'active', ?, ?)", staffLab, labId, ownerId, now, now).lastInsertRowid);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, status, seat_type, lab_id, staff_employee_id, invited_at, invite_token) VALUES (?, ?, 'pending', 'staff_portal', ?, ?, ?, ?)", ownerId, `rosterui-syl-${stamp}@example.com`, labId, stub, now, `t-${stamp}`);
  const page = await openAs(`/labs/${labId}/veritastaff-app`);
  await page.getByText("Card, Syl").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const cards = await page.getByText(/^Card, Syl/).count();
  check("L5. VeritaStaff shows one card for that person", cards === 1 && activeRows("Card") === 1, `${cards} on screen`);
  check("L5. the invite moved to the real card", sql("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?", `rosterui-syl-${stamp}@example.com`)?.e === syl);
  await page.screenshot({ path: `${OUT}/roster-one-card.png` });

  await page.getByRole("button", { name: /Add Employee/i }).first().click();
  await page.getByTestId("new-employee-invite-email").waitFor({ timeout: 10000 });
  const dlg = page.getByRole("dialog");
  await dlg.locator("input").nth(0).fill("Newly");
  await dlg.locator("input").nth(1).fill("Added");
  const first = await dlg.locator("input").nth(0).inputValue();
  const lastField = await dlg.locator("input").nth(1).inputValue();
  await page.getByTestId("new-employee-invite-email").fill(`rosterui-new-${stamp}@example.com`);
  await page.getByTestId("new-employee-invite-email").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/roster-add-employee.png` });
  await dlg.getByRole("button", { name: "Add Employee" }).click();
  await page.waitForTimeout(1800);
  const newRow = sql("SELECT id FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' AND (last_name = 'Added' OR last_name = 'Newly' OR first_name = 'Added')", labId);
  const seat = sql("SELECT staff_employee_id AS e FROM user_seats WHERE seat_email = ?", `rosterui-new-${stamp}@example.com`);
  check("L6. Add Employee with an email sends the invite on that new row", !!newRow && seat?.e === newRow.id, JSON.stringify({ first, lastField, newRow, seat }));
  await page.context().close();
}

{
  const dark = await openAs(MEMBERS, { dark: true });
  await dark.getByTestId("roster-staff-card").waitFor({ timeout: 15000 });
  await dark.getByTestId("roster-staff-open-only").uncheck();
  await dark.getByTestId("roster-staff-card").screenshot({ path: `${OUT}/roster-dark.png` });
  check("D1. dark mode: the page does not overflow", await dark.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await dark.context().close();
  const phone = await openAs(MEMBERS, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId("roster-staff-card").waitFor({ timeout: 15000 });
  await phone.getByTestId("roster-staff-open-only").uncheck();
  await phone.getByTestId("roster-staff-card").screenshot({ path: `${OUT}/roster-phone.png` });
  check("D1. phone width: the page does not overflow", await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await phone.context().close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
