// scripts/verify-invite-link-required-ui.mjs
// Gate 3 receipt for BUG-133 (2026-11-04): a pending invite is claimed only with its own link. Run against a LOCAL server on a
// scratch database (it registers an owner, provisions a lab and reads SCRATCH_DB directly, so never point it at production). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-invite-link-required-ui.mjs
// Checks in a real browser: the sign-up form refuses an invited address and says why, instead of "Registration failed"; no account
// is made and the seat stays pending; the invite's own link still works and lands signed in as an admin; someone with no invite
// still signs up; the join page shows the server's sentence too. Light, dark and phone shots of the refusal.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Link", "chk", "77!"].join("-");
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const mail = (t) => `link-${t}-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: mail("owner"), password: PW, name: "Lab Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail("owner"), labName: "Invite Link Lab", plan: "hospital", isWarehouse: true })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
await call("POST", `/api/labs/${labId}/members`, { email: mail("admin"), role: "admin", firstName: "Made", lastName: "Admin" }, owner.token);
const seat = () => sdb.prepare("SELECT status, invite_token FROM user_seats WHERE seat_email = ?").get(mail("admin"));
const account = (t) => sdb.prepare("SELECT id FROM users WHERE lower(email) = ?").get(mail(t));
check("setup: the invite is pending", seat()?.status === "pending");

const browser = await chromium.launch();
const fillSignup = async (page, email) => {
  await page.goto(`${BASE}/login?tier=clinic`);
  await page.getByRole("tab", { name: "Create Account" }).click();
  await page.locator("input[type=email]:visible").fill(email);
  await page.locator("input[type=password]:visible").fill(PW);
  await page.locator("input:not([type]):visible, input[type=text]:visible").first().fill("Made Up Person");
  await page.locator("input[type=checkbox]:visible").first().check();
  await page.locator("button[type=submit]:visible").click();
};
const REFUSAL = "This email has a pending invitation";

const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
await fillSignup(page, mail("admin"));
await page.getByText(REFUSAL).first().waitFor({ timeout: 15000 }).catch(() => {});
check("the sign-up form says why it refused", await page.getByText(REFUSAL).first().isVisible());
check("it doesn't say Registration failed", !(await page.getByText("Registration failed").first().isVisible().catch(() => false)));
await page.screenshot({ path: `${OUT}/invite-link-required-light.png` });
check("no account was made", !account("admin"));
check("the seat is still pending", seat()?.status === "pending");

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: "dark" });
const dark = await darkCtx.newPage();
await dark.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
await fillSignup(dark, mail("admin"));
await dark.getByText(REFUSAL).first().waitFor({ timeout: 15000 }).catch(() => {});
check("dark: the refusal shows", await dark.getByText(REFUSAL).first().isVisible());
await dark.screenshot({ path: `${OUT}/invite-link-required-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
await fillSignup(phone, mail("admin"));
await phone.getByText(REFUSAL).first().waitFor({ timeout: 15000 }).catch(() => {});
check("phone: the refusal shows", await phone.getByText(REFUSAL).first().isVisible());
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await phone.screenshot({ path: `${OUT}/invite-link-required-phone.png` });

// The join page locks the invited address, and shows the server's sentence: here the link passes 30 days while the page is open.
const joinCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const join = await joinCtx.newPage();
await join.goto(`${BASE}/join?token=${seat().invite_token}`);
await join.locator("input[type=password]").first().waitFor({ timeout: 15000 });
check("the join page locks the invited address", (await join.locator("input[type=email]").getAttribute("readonly")) !== null);
await join.locator("input[type=password]").nth(0).fill(PW);
await join.locator("input[type=password]").nth(1).fill(PW);
await join.locator("input[type=checkbox]").first().check();
const invitedAt = sdb.prepare("SELECT invited_at FROM user_seats WHERE seat_email = ?").get(mail("admin")).invited_at;
sdb.prepare("UPDATE user_seats SET invited_at = ? WHERE seat_email = ?").run(new Date(Date.now() - 31 * 86400000).toISOString(), mail("admin"));
await join.locator("button[type=submit]").click();
await join.getByText("This invitation has expired").first().waitFor({ timeout: 15000 }).catch(() => {});
check("the join page shows the server's sentence", await join.getByText("This invitation has expired").first().isVisible());
sdb.prepare("UPDATE user_seats SET invited_at = ? WHERE seat_email = ?").run(invitedAt, mail("admin"));

// The link itself still works.
await join.locator("button[type=submit]").click();
await join.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});
check("the invite link signs the person up and lands inside", /dashboard/.test(join.url()), join.url());
const joined = sdb.prepare("SELECT lm.role FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? AND lower(u.email) = ?").get(labId, mail("admin"));
check("an admin invite made an admin", joined?.role === "admin", JSON.stringify(joined));
check("the seat is taken", seat()?.status === "active");

// Someone with no invite.
const plainCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const plain = await plainCtx.newPage();
await fillSignup(plain, mail("plain"));
for (let i = 0; i < 30 && !account("plain"); i++) await plain.waitForTimeout(500);
check("someone with no invite still signs up", !!account("plain"));

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
