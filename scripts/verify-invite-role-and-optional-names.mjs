// scripts/verify-invite-role-and-optional-names.mjs
// Michael 2026-10-22: "when I invite someone to an admin seat, after they accept they are falling into a staff seat, not an
// admin seat" (Tim Uicker, lab 21), and "we should be able to invite without the first and last name, they just get
// prompted to fill those in on acceptance". LOCAL server + scratch DB only (registers users, provisions a lab).
// API cases:
//   A admin invite to a NEW email with no names -> seat keeps invite_role 'admin'; pending list says admin; accept -> admin
//   B staff (writer) invite to a new email -> accept -> staff
//   C admin invite to an EXISTING account -> admin membership at once (unchanged path)
//   D reissued admin invite -> accept with the new link -> admin
//   E an invite saved before this fix (invite_role NULL) -> accept -> staff (back-compat, documented)
//   F Medical Director invite, no names -> accept -> staff seat + lab's medical director email
//   G read-and-sign Staff invite without names -> still refused (it creates the VeritaStaff roster entry)
// Browser (Members page): Admin with blank names -> Send invite enabled + hint; pending row shows the Admin chip;
//   read-and-sign Staff with blank names -> Send invite disabled. Light and dark screenshots.
// Usage: PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-invite-role-and-optional-names.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const T = Date.now();
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { ...j, http: r.status };  // http last: several responses carry their own 'status' field
};
const db = () => new Database(process.env.SCRATCH_DB);
const q1 = (sql, ...a) => { const d = db(); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const run = (sql, ...a) => { const d = db(); try { return d.prepare(sql).run(...a); } finally { d.close(); } };
const register = (email, name, inviteToken) => call("POST", "/api/auth/register", { email, password: "Testpass123", name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
const roleOf = (labId, email) => q1("SELECT lm.role FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? AND lower(u.email) = ? AND lm.status = 'active'", labId, email.toLowerCase())?.role;
const seat = (labId, email) => q1("SELECT id, invite_token, invite_role, invitee_name, status FROM user_seats WHERE lab_id = ? AND seat_email = ? ORDER BY id DESC", labId, email.toLowerCase());

// owner + lab
const ownerEmail = `inv-owner-${T}@example.com`;
const owner = await register(ownerEmail, "Invite Owner");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Invite Role Lab", plan: "hospital" })).labId;
run("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", ownerEmail);
run("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
check("scratch owner and lab", !!owner.token && !!labId, `lab ${labId}`);
const invite = (email, role, names = {}) => call("POST", `/api/labs/${labId}/members`, { email, role, seatType: "active", ...names }, owner.token, labId);

// A
const a = `inv-admin-${T}@example.com`;
const ra = await invite(a, "admin");
const sa = seat(labId, a);
check("A. admin invite with no names is accepted by the server", ra.http === 200 && ra.ok === true, JSON.stringify(ra).slice(0, 120));
check("A. seat keeps invite_role 'admin' and no name", sa?.invite_role === "admin" && sa?.invitee_name == null, JSON.stringify(sa));
const members1 = await call("GET", `/api/labs/${labId}/members`, undefined, owner.token, labId);
const pa = (members1.pendingInvites || []).find((p) => p.seat_email === a);
check("A. pending list reports invite_role admin", pa?.invite_role === "admin", JSON.stringify(pa || {}).slice(0, 160));
const ua = await register(a, "Ada Admin", sa.invite_token);
check("A. invitee signs up with the link", !!ua.token, JSON.stringify(ua).slice(0, 120));
check("A. membership after accepting is ADMIN (was staff before the fix)", roleOf(labId, a) === "admin", roleOf(labId, a));

// B
const b = `inv-staff-${T}@example.com`;
await invite(b, "staff", { firstName: "Sam", lastName: "Staff" });
await register(b, "Sam Staff", seat(labId, b).invite_token);
check("B. staff (writer) invite -> staff after accepting", roleOf(labId, b) === "staff", roleOf(labId, b));

// C
const c = `inv-existing-${T}@example.com`;
await register(c, "Existing Person");
const rc = await invite(c, "admin");
check("C. admin invite to an existing account -> admin at once (unchanged)", rc.http === 200 && roleOf(labId, c) === "admin", `${rc.http} ${roleOf(labId, c)}`);

// D
const dmail = `inv-reissue-${T}@example.com`;
await invite(dmail, "admin");
const sd = seat(labId, dmail);
const rd = await call("POST", `/api/labs/${labId}/seat-invites/${sd.id}/reissue`, {}, owner.token, labId);
check("D. reissue gives a new link and keeps invite_role admin", rd.ok === true && rd.inviteToken !== sd.invite_token && seat(labId, dmail).invite_role === "admin");
await register(dmail, "Reissued Admin", rd.inviteToken);
check("D. accepting the reissued link -> admin", roleOf(labId, dmail) === "admin", roleOf(labId, dmail));

// E
const e = `inv-legacy-${T}@example.com`;
await invite(e, "admin");
run("UPDATE user_seats SET invite_role = NULL WHERE seat_email = ? AND lab_id = ?", e, labId);
await register(e, "Legacy Invite", seat(labId, e).invite_token);
check("E. an invite saved before the fix (no stored role) -> staff, promote by hand", roleOf(labId, e) === "staff", roleOf(labId, e));

// F
const f = `inv-md-${T}@example.com`;
const rf = await invite(f, "medical_director");
await register(f, "Morgan Director", seat(labId, f).invite_token);
const mdEmail = q1("SELECT medical_director_email AS m FROM labs WHERE id = ?", labId)?.m;
check("F. Medical Director invite with no names -> writer seat (staff role) + lab medical director", rf.http === 200 && roleOf(labId, f) === "staff" && mdEmail === f, `${rf.http} ${roleOf(labId, f)} ${mdEmail}`);

// G
const rg = await call("POST", `/api/labs/${labId}/staff-portal-invites`, { email: `inv-rs-${T}@example.com` }, owner.token, labId);
check("G. read-and-sign Staff invite without names is still refused (roster needs a name)", rg.http === 400, `${rg.http} ${rg.error || ""}`);

// ---------- browser ----------
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([bse, t]) => { const r = await fetch(`${bse}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, owner.token]);
await page.evaluate(([t, u, lab]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [owner.token, me, labId]);
await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
const send = page.getByTestId("invite-send-btn");
await send.waitFor({ timeout: 20000 });
const ui = `inv-ui-${T}@example.com`;
await page.getByTestId("invite-role-select").selectOption("staff");
await page.locator("#invite-email").fill(`inv-ui-rs-${T}@example.com`);
check("Browser: read-and-sign Staff with blank names -> Send invite disabled", await send.isDisabled());
await page.getByTestId("invite-role-select").selectOption("admin");
await page.locator("#invite-email").fill(ui);
check("Browser: Admin with blank names -> Send invite enabled", await send.isEnabled());
check("Browser: the 'they enter their name when they accept' hint shows for Admin", await page.getByTestId("invite-names-optional-hint").isVisible());
const firstLabel = (await page.locator("label[for='invite-first']").innerText()).trim();
check("Browser: name fields are marked optional for Admin", /optional/i.test(firstLabel), firstLabel);
await page.locator("#invite-email").scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -260));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/invite_admin_form_light.png` });  // Admin selected, names blank, Send enabled, hint showing
await send.click();
await page.waitForTimeout(2500);
const row = page.getByTestId("pending-invite-row").filter({ hasText: ui });
check("Browser: the new pending row shows the Admin chip", await row.getByTestId("pending-invite-role").isVisible().catch(() => false));
await row.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -200));
await page.screenshot({ path: `${OUT}/invite_admin_pending_light.png` });
await page.evaluate(() => document.documentElement.classList.add("dark"));
await row.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -200));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/invite_admin_pending_dark.png` });
check("Browser: the invited seat was saved as admin", seat(labId, ui)?.invite_role === "admin");
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
