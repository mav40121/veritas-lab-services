// scripts/verify-invite-names-ui.mjs
// Gate 3 receipt for bug 2 (2026-10-09: "Why do only staff members get a first
// and last name? that feels like a hold over from the kiosk."). Run against a
// LOCAL server on a scratch database (it registers an owner, provisions a lab and
// reads SCRATCH_DB directly, so never point it at production). Usage:
//   PW_BASE=http://localhost:5144 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-invite-names-ui.mjs
// Checks, as the owner in a real browser: the name fields show for Admin and
// Medical Director (not only Staff); Send stays disabled until both names are
// filled; an admin invite keeps the name (pending row, invite lookup, join page
// pre-fill); a medical-director invite stores the director's name; a staff
// invite still works. Light + dark shots of the form and the pending row.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5144", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const ownerEmail = `names-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Lab Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Invite Names Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);
// A paying owner's account plan is set by Stripe; a fresh test owner is on
// "free" (1 seat), which would refuse every invite (the seat cap still reads the
// owner's account plan; bug 4 fixes that separately).
sdb.prepare("UPDATE users SET plan = 'hospital' WHERE email = ?").run(ownerEmail);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, owner.token]);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [owner.token, me]);
await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
const role = page.getByTestId("invite-role-select");
await role.waitFor({ timeout: 20000 });

async function invite(roleValue, email, first, last) {
  await role.selectOption(roleValue);
  await page.locator("#invite-email, input[type=email]").first().fill(email);
  await page.getByTestId("invite-first-name").fill(first);
  await page.getByTestId("invite-last-name").fill(last);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /\/(members|staff-portal-invites)$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 15000 }),
    page.getByTestId("invite-send-btn").click(),
  ]);
  if (!resp.ok()) console.log(`  invite ${roleValue} -> HTTP ${resp.status()} ${(await resp.text()).slice(0, 200)}`);
  await page.waitForTimeout(800);
}

// 1. Admin role: name fields present; Send disabled without names.
await role.selectOption("admin");
check("admin role shows First and Last name", await page.getByTestId("invite-first-name").isVisible() && await page.getByTestId("invite-last-name").isVisible());
await page.locator("#invite-email, input[type=email]").first().fill(`admin-${stamp}@example.com`);
check("Send is disabled until both names are filled", await page.getByTestId("invite-send-btn").isDisabled());
await page.screenshot({ path: `${OUT}/invite_names_form_light.png`, fullPage: false });
await invite("admin", `admin-${stamp}@example.com`, "Brandy", "Morgan");
const adminSeat = sdb.prepare("SELECT invite_token, invitee_name FROM user_seats WHERE seat_email = ?").get(`admin-${stamp}@example.com`);
check("admin invite stored the name", adminSeat && adminSeat.invitee_name === "Brandy Morgan", JSON.stringify(adminSeat && adminSeat.invitee_name));
const pendingNames = await page.getByTestId("pending-invitee-name").allInnerTexts();
check("pending-invite row shows the name", pendingNames.some((t) => t.includes("Brandy Morgan")), JSON.stringify(pendingNames));
const lookup = await call("GET", `/api/seats/invite/${adminSeat.invite_token}`);
check("invite lookup returns the name", lookup.inviteeName === "Brandy Morgan", JSON.stringify(lookup));

// 2. Medical Director role: the name lands on the lab's director record.
await invite("medical_director", `md-${stamp}@example.com`, "Chris", "Gilles");
const lab = sdb.prepare("SELECT medical_director_email, medical_director_name FROM labs WHERE id = ?").get(labId);
check("medical-director invite stores the director's name", lab.medical_director_email === `md-${stamp}@example.com` && lab.medical_director_name === "Chris Gilles", JSON.stringify(lab));

// 3. Staff role still works and keeps the name.
await invite("staff", `staff-${stamp}@example.com`, "Addison", "Timmins");
const staffSeat = sdb.prepare("SELECT invitee_name FROM user_seats WHERE seat_email = ?").get(`staff-${stamp}@example.com`);
check("staff invite still works and keeps the name", staffSeat && staffSeat.invitee_name === "Addison Timmins", JSON.stringify(staffSeat));
await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
await page.getByTestId("pending-invitee-name").first().waitFor({ timeout: 15000 });
const table = page.locator("table").filter({ hasText: "Pending invitation" }).first();
await table.screenshot({ path: `${OUT}/invite_names_pending_light.png` });
await page.evaluate(() => document.documentElement.classList.add("dark"));
await table.screenshot({ path: `${OUT}/invite_names_pending_dark.png` });

// 4. The join page pre-fills the name for the admin invitee (fresh, signed-out context).
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const join = await ctx.newPage();
await join.goto(`${BASE}/join?token=${adminSeat.invite_token}`, { waitUntil: "networkidle" });
const nameVal = await join.locator("input#name, input[name=name], input[placeholder*='name' i]").first().inputValue();
check("join page pre-fills the invitee's name", nameVal === "Brandy Morgan", nameVal);
await ctx.close();

await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
