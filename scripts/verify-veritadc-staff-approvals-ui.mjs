// scripts/verify-veritadc-staff-approvals-ui.mjs
//
// Browser receipt for staff login approvals (Michael 2026-11-04, Q155 = 1). On a local production build with a scratch DB, a made-up owner and made-up staff logins:
//   A1. A staff login named on a route sees the Approve Documents tile with a count. One on no route doesn't see the tile.
//   A2. The list shows the document and step, and opening it shows the file to read.
//   A3. A wrong password is refused on screen and the document stays in review. The right one approves it and it leaves the list.
//   A4. Rejecting asks why, and sends the document back to draft.
//   D1. Dark mode and phone width read and do not overflow.
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-staff-approvals-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const PW = ["Appr", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `apprui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: PW, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Approval Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const staffLab = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId)?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Approval Test Lab', '22D0000654', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const addStaffLogin = async (first, last) => {
  const mail = `apprui-${first.toLowerCase()}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: mail, password: PW, name: `${first} ${last}`, hipaa_acknowledged: true });
  const userId = Number(reg.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)", labId, userId, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, userId);
  const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, login_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Histotechnologist', 'active', ?, ?, ?)", staffLab, labId, ownerId, last, first, userId, now, now).lastInsertRowid);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)", ownerId, mail, userId, labId, emp);
  return { email: mail, userId, emp, name: `${first} ${last}` };
};
const vera = await addStaffLogin("Vera", "Named");
const otto = await addStaffLogin("Otto", "Outside");
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Director approval", requiredRole: "specific_user", specificUserId: vera.userId }, token);
const addDoc = async (title) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(`<html><body><p>Made-up procedure text for ${title}.</p></body></html>`)], { type: "text/html" }), "made-up.html");
  fd.append("title", title);
  const r = await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  const j = await r.json();
  const s = await call("POST", `${P}/documents/${j.id}/submit`, { workflowId: wf.body.id }, token);
  if (s.status !== 200) console.log("submit", s.status, JSON.stringify(s.body));
  return j.id;
};
const docA = await addDoc("Made-up microscope SOP");
const docB = await addDoc("Made-up fire plan");
const status = (id) => sql("SELECT status FROM policy_documents WHERE id = ?", id).status;

const browser = await chromium.launch();
const signIn = async (who, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", who.userId);
  const login = await call("POST", "/api/auth/login", { email: who.email, password: PW });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u));
    localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
    if (dark) localStorage.setItem("theme", "dark");
  }, [login.body.token, login.body.user, !!opts.dark]);
  await page.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
  return page;
};

// A1
const outsider = await signIn(otto);
await outsider.waitForTimeout(1500);
check("A1. someone on no route doesn't see the tile", (await outsider.getByText("Approve Documents").count()) === 0);
await outsider.context().close();
const page = await signIn(vera);
const tile = page.getByText("Approve Documents").first();
await tile.waitFor({ timeout: 15000 }).catch(() => {});
check("A1. someone named on a route sees the tile", await tile.isVisible());
await page.screenshot({ path: path.join(OUT, "approvals-tile.png") });

// A2
await tile.click();
await page.getByTestId("sp-approvals-list").waitFor({ timeout: 10000 });
const listText = await page.getByTestId("sp-approvals-list").innerText();
check("A2. the list shows the documents and the step", /Made-up microscope SOP/.test(listText) && /Made-up fire plan/.test(listText) && /Director approval/.test(listText));
await page.getByText("Made-up microscope SOP").first().click();
await page.getByTestId("sp-approvals-detail").waitFor({ timeout: 10000 });
await page.getByTestId("sp-approvals-detail-html").waitFor({ timeout: 10000 }).catch(() => {});
const readText = await page.getByTestId("sp-approvals-detail").innerText();
check("A2. opening it shows the file to read", /Made-up procedure text for Made-up microscope SOP/.test(readText));
check("A2. the signing box starts with their name", (await page.locator("#sp-approval-name").inputValue()) === vera.name);
await page.screenshot({ path: path.join(OUT, "approvals-read-and-sign.png"), fullPage: true });

// A3
await page.locator("#sp-approval-password").fill("not-the-password");
await page.getByRole("button", { name: /^Approve/ }).click();
await page.getByText(/Password incorrect/i).waitFor({ timeout: 10000 }).catch(() => {});
check("A3. a wrong password is refused on screen", await page.getByText(/Password incorrect/i).isVisible());
check("A3. and the document stays in review", status(docA) === "in_review", status(docA));
await page.locator("#sp-approval-password").fill(PW);
await page.getByRole("button", { name: /^Approve/ }).click();
await page.getByTestId("sp-approvals-list").waitFor({ timeout: 10000 });
check("A3. the right one approves it", status(docA) === "approved", status(docA));
check("A3. it says so", /Approved "Made-up microscope SOP"/.test(await page.getByTestId("sp-approvals-notice").innerText()));
await page.getByRole("button", { name: /Made-up fire plan/ }).waitFor({ timeout: 10000 });
check("A3. and it leaves the list", (await page.getByRole("button", { name: /Made-up microscope SOP/ }).count()) === 0);
const sig = sql("SELECT user_id, typed_signature, action FROM policy_signoffs WHERE document_id = ?", docA);
check("A3. the signature names the person", sig?.user_id === vera.userId && sig?.typed_signature === vera.name && sig?.action === "approved", JSON.stringify(sig));
await page.screenshot({ path: path.join(OUT, "approvals-after-signing.png") });

// A4
await page.getByText("Made-up fire plan").first().click();
await page.getByTestId("sp-approvals-detail").waitFor({ timeout: 10000 });
await page.locator("#sp-approval-password").fill(PW);
await page.getByRole("button", { name: /^Reject/ }).click();
await page.getByText(/Say why you are rejecting/i).waitFor({ timeout: 10000 }).catch(() => {});
check("A4. rejecting asks why", await page.getByText(/Say why you are rejecting/i).isVisible());
check("A4. and nothing changes until they say", status(docB) === "in_review");
await page.locator("#sp-approval-comment").fill("Made-up reason");
await page.getByRole("button", { name: /^Reject/ }).click();
await page.getByTestId("sp-approvals-list").waitFor({ timeout: 10000 });
check("A4. rejecting sends it back to draft", status(docB) === "draft", status(docB));
await page.context().close();

// D1
const docC = await addDoc("Made-up long title for a controlled document that wraps across the narrow screen");
const dark = await signIn(vera, { dark: true });
await dark.getByText("Approve Documents").first().click();
await dark.getByTestId("sp-approvals-list").waitFor({ timeout: 10000 });
check("D1. dark mode is on", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await dark.getByText(/Made-up long title/).first().click();
await dark.getByTestId("sp-approvals-detail").waitFor({ timeout: 10000 });
await dark.waitForTimeout(400);
await dark.screenshot({ path: path.join(OUT, "approvals-dark.png"), fullPage: true });
await dark.context().close();
const phone = await signIn(vera, { viewport: { width: 375, height: 800 } });
await phone.getByText("Approve Documents").first().click();
await phone.getByTestId("sp-approvals-list").waitFor({ timeout: 10000 });
await phone.getByText(/Made-up long title/).first().click();
await phone.getByTestId("sp-approvals-detail").waitFor({ timeout: 10000 });
await phone.waitForTimeout(400);
check("D1. phone width doesn't scroll sideways", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phone.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await phone.screenshot({ path: path.join(OUT, "approvals-phone.png"), fullPage: true });
await phone.context().close();
check("D1. the long-title document is still waiting", status(docC) === "in_review");

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
