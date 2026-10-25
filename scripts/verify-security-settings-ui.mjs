// scripts/verify-security-settings-ui.mjs
// Gate 3 browser receipt for system security settings (Michael Q27 = 1, 2026-10-25; server/securityPolicy.ts).
// Run against a LOCAL server on a scratch database (it registers accounts and provisions a lab, so never point it at
// production):
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-security-settings-ui.mjs
// Light: the owner turns on all six settings from Account settings (password asked first) and they persist after a
// reload; a member locked out by 3 wrong passwords appears on the Members page and "Turn back on" clears it; a member
// whose password is older than the limit changes it at sign-in and lands signed in; the idle timer shows its one-minute
// warning and then signs the browser out to the sign-in page, which says why; a session the server ended for
// inactivity shows the same message. Dark: the settings card renders.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const pw = (tag) => ["Sq", String(stamp).slice(-5), tag].join("-") + "!"; // throwaway, scratch database only
const ownerEmail = `sec-ui-owner-${stamp}@example.com`, memberEmail = `sec-ui-member-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: pw("o"), name: "Security Owner", hipaa_acknowledged: true })).body;
const member = (await call("POST", "/api/auth/register", { email: memberEmail, password: pw("m"), name: "Morgan Member", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Security Lab", plan: "hospital" })).body.labId;
await call("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId, email: memberEmail, role: "staff" });
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(ownerEmail, memberEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const signOutAll = (email) => sdb.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email);
check("scratch accounts and lab", !!owner.token && !!member.token && labId > 0, JSON.stringify({ labId }));

const browser = await chromium.launch();
async function signedIn(token, user, mode = "light") {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, m]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem("theme", m); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [token, user, mode]);
  return page;
}

// 1) Owner: Account settings card, save with password, persists; dark render.
{
  const page = await signedIn(owner.token, owner.user);
  await page.goto(`${BASE}/labs/${labId}/account/settings`, { waitUntil: "networkidle" });
  const card = page.getByTestId("security-settings-card");
  await card.waitFor({ timeout: 20000 });
  const text = (await card.innerText()).replace(/\s+/g, " ");
  check("1a. the owner sees 'Security settings for your system' covering their lab", /Security settings for your system/.test(text) && /Security Lab/.test(text) && /Everything is off until you turn it on/.test(text), text.slice(0, 220));
  await page.getByTestId("sec-idleMinutes").selectOption("15");
  await page.getByTestId("sec-passwordExpiryDays").selectOption("180");
  await page.getByTestId("sec-passwordHistory").selectOption("4");
  await page.getByTestId("sec-lockoutAttempts").selectOption("3");
  await page.getByTestId("sec-inactiveDays").selectOption("90");
  await page.getByTestId("sec-requireSymbol").check();
  check("1b. saving asks for the current password first", await page.getByTestId("sec-save").isDisabled());
  await page.locator("#sec-password").fill(pw("o"));
  await card.screenshot({ path: `${OUT}/security_settings_card_light.png` });
  await page.getByTestId("sec-save").click();
  await page.getByText("Security settings saved").first().waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("security-settings-card").waitFor({ timeout: 20000 });
  const vals = await Promise.all(["sec-idleMinutes", "sec-passwordExpiryDays", "sec-passwordHistory", "sec-lockoutAttempts", "sec-inactiveDays"].map((t) => page.getByTestId(t).inputValue()));
  check("1c. after a reload the six settings are on", vals.join(",") === "15,180,4,3,90" && (await page.getByTestId("sec-requireSymbol").isChecked()), vals.join(","));
  await page.close();
  const dark = await signedIn(owner.token, owner.user, "dark");
  await dark.goto(`${BASE}/labs/${labId}/account/settings`, { waitUntil: "networkidle" });
  await dark.evaluate(() => document.documentElement.classList.add("dark"));
  await dark.getByTestId("security-settings-card").waitFor({ timeout: 20000 });
  await dark.getByTestId("security-settings-card").screenshot({ path: `${OUT}/security_settings_card_dark.png` });
  check("1d. dark: the card renders", true);
  await dark.close();
}

// 2) Lockout: 3 wrong passwords lock the member; the owner turns them back on from the Members page.
{
  signOutAll(memberEmail);
  for (let i = 0; i < 3; i++) await call("POST", "/api/auth/login", { email: memberEmail, password: "Wrong-Pass-9!" });
  const locked = await call("POST", "/api/auth/login", { email: memberEmail, password: pw("m") });
  check("2a. the member is locked after 3 wrong passwords", locked.status === 423, `status=${locked.status}`);
  const page = await signedIn(owner.token, owner.user);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  const card = page.getByTestId("account-status-card");
  await card.waitFor({ timeout: 20000 });
  const text = (await card.innerText()).replace(/\s+/g, " ");
  check("2b. the Members page lists the member as locked", /Morgan Member/.test(text) && /locked after wrong passwords/.test(text), text.slice(0, 200));
  await card.screenshot({ path: `${OUT}/account_status_card.png` });
  await page.getByRole("button", { name: "Turn back on" }).click();
  await page.getByText("can sign in again").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check("2c. after Turn back on the card clears", (await page.getByTestId("account-status-card").count()) === 0);
  await page.close();
}

// 3) Password expiry at sign-in, through the real sign-in page.
{
  signOutAll(memberEmail);
  sdb.prepare("UPDATE users SET password_changed_at = ? WHERE email = ?").run(new Date(Date.now() - 200 * 86400000).toISOString(), memberEmail);
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('input[type="email"]').first().fill(memberEmail);
  await page.getByTestId("login-password").fill(pw("m"));
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  const step = page.getByTestId("password-expired-step");
  await step.waitFor({ timeout: 15000 });
  const stepText = (await step.innerText()).replace(/\s+/g, " ");
  check("3a. sign-in shows 'Your password has expired' with the 180-day reason", /Your password has expired/.test(stepText) && /every 180 days/.test(stepText), stepText.slice(0, 200));
  await step.screenshot({ path: `${OUT}/password_expired_step.png` });
  await page.locator("#expired-new").fill(pw("m"));
  await page.locator("#expired-confirm").fill(pw("m"));
  await page.getByRole("button", { name: "Set new password and sign in" }).click();
  await page.getByText("Choose a new password, not your current one.").waitFor({ timeout: 10000 });
  check("3b. reusing the current password is refused on screen", true);
  await page.locator("#expired-new").fill(pw("m2"));
  await page.locator("#expired-confirm").fill(pw("m2"));
  await page.getByRole("button", { name: "Set new password and sign in" }).click();
  await page.waitForURL(/dashboard|veritastock|labs\//, { timeout: 20000 });
  check("3c. a new password finishes sign-in", !/login/.test(page.url()), page.url());
  await page.close();
}

// 4) Idle: the browser timer warns, then signs out; the sign-in page says why.
{
  signOutAll(memberEmail);
  const li = await call("POST", "/api/auth/login", { email: memberEmail, password: pw("m2") });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.clock.install();
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [li.body.token, li.body.user]);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.clock.fastForward("14:10");
  const warn = page.getByTestId("idle-warning");
  await warn.waitFor({ timeout: 15000 });
  const warnText = (await warn.innerText()).replace(/\s+/g, " ");
  check("4a. at 14 minutes idle the one-minute warning appears", /signed out in \d+ seconds/.test(warnText), warnText);
  await page.screenshot({ path: `${OUT}/idle_warning.png` });
  await page.clock.fastForward("01:10");
  await page.waitForURL(/\/login\?reason=idle/, { timeout: 20000 });
  const notice = page.getByTestId("login-notice");
  await notice.waitFor({ timeout: 10000 });
  const nt = await notice.innerText();
  check("4b. after 15 minutes the browser is signed out and the sign-in page says why", /signed out after 15 minutes without activity/.test(nt), nt);
  await page.screenshot({ path: `${OUT}/idle_signed_out.png` });
  const ended = await call("GET", "/api/auth/me", undefined, li.body.token);
  check("4c. that session no longer works on the server", ended.status === 401, `status=${ended.status}`);
  await page.close();
}

// 5) A session the server ended for inactivity (closed laptop) shows the same message on the next page load.
{
  signOutAll(memberEmail);
  const li = await call("POST", "/api/auth/login", { email: memberEmail, password: pw("m2") });
  sdb.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ?").run(new Date(Date.now() - 30 * 60000).toISOString(), li.body.session_token);
  const page = await signedIn(li.body.token, li.body.user);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/login\?reason=idle/, { timeout: 20000 });
  const nt = await page.getByTestId("login-notice").innerText();
  check("5. a server-ended idle session lands on sign-in with the reason", /signed out after 15 minutes without activity/.test(nt), nt);
  await page.close();
}

await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
