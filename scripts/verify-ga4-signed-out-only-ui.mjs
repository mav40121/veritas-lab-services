// scripts/verify-ga4-signed-out-only-ui.mjs
//
// Browser receipt: Google Analytics runs for signed-out visitors on the public site only, never inside the logged-in
// app (2026-10-19, Michael: customer security schedules bar tracking code on their workforce, e.g. Lifepoint IPS
// III.6). LOCAL production build + scratch DB only. Checks:
//   1. signed out, public page: gtag.js loads and the opt-out flag is off
//   2. signed in, app page: gtag.js never loads, no request to any Google analytics host, opt-out flag on
//   3. a tab that loaded GA signed out, then signs in: the opt-out flag turns on and nothing more is sent
//   4. no Content-Security-Policy violations
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-ga4-signed-out-only-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT, GA = "G-M3TB43ZX4E";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const isGoogle = (u) => /googletagmanager\.com|google-analytics\.com|analytics\.google\.com|www\.google\.com\/g\/collect/.test(u);

const PW = ["Zq", "ga4", "7x!"].join("-");
const email = `ga4-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id, token = reg.body?.token, user = reg.body?.user;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
check("0. QA owner and lab on the scratch DB", !!uid && !!token && !!lab);

const browser = await chromium.launch();
const csp = [];
const watch = (page, bucket) => {
  page.on("request", (r) => { if (isGoogle(r.url())) bucket.push(r.url()); });
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
};
const state = (page) => page.evaluate((ga) => ({ tag: !!document.getElementById("ga4-gtag"), off: window[`ga-disable-${ga}`] === true, gtag: typeof window.gtag }), GA);

// 1) signed out
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs = []; watch(page, reqs);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const s = await state(page);
  check("1a. signed out on the home page: gtag.js loads and collection is on", s.tag && !s.off && s.gtag === "function", JSON.stringify(s));
  check("1b. signed out: the browser asked Google for gtag.js", reqs.some((u) => u.includes("googletagmanager.com/gtag/js")), `${reqs.length} Google request(s)`);
  await ctx.close();
}

// 2) signed in
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs = []; watch(page, reqs);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  // Sign in before the app reads anything: the token is set, then the app reloads signed in.
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  const ctx2 = await browser.newContext({ storageState: await ctx.storageState() }); await ctx.close();
  const p2 = await ctx2.newPage(); const reqs2 = []; watch(p2, reqs2);
  for (const path of [`/labs/${lab}/dashboard`, `/labs/${lab}/veritacomp-app`, "/"]) {
    await p2.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await p2.waitForTimeout(1000);
  }
  const s = await state(p2);
  check("2a. signed in: gtag.js never loads and collection is off", !s.tag && s.off, JSON.stringify(s));
  check("2b. signed in: no request to any Google analytics host across three pages", reqs2.length === 0, reqs2.slice(0, 2).join(" | "));
  await ctx2.close();
}

// 3) GA loaded signed out on the sign-in page, then the person signs in through the real form (same tab)
{
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs = []; watch(page, reqs);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const pre = await state(page);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const onLogin = await state(page);
  check("3x. on the sign-in page (still signed out) GA is not loaded", !onLogin.tag, JSON.stringify(onLogin));
  await page.locator('input[type="email"]').first().fill(email);
  await page.getByTestId("login-password").fill(PW);
  const before = 0;
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  // The test account already holds the session its registration opened; the single-session guard asks first.
  const force = page.getByRole("button", { name: "Force Logout Other Device" });
  if (await force.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false)) await force.click();
  await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const s = await state(page);
  const collectAfter = reqs.filter((u) => /collect/.test(u) && !/dl=http%3A%2F%2Flocalhost%3A5197%2F(&|$)/.test(u) && /dl=http%3A%2F%2Flocalhost(%3A5197)?%2F(login|labs)/.test(u));
  await page.screenshot({ path: `${OUT}/ga4-after-signin.png` });
  check("3a. signed out on the home page, GA was loaded first", pre.tag && !pre.off, JSON.stringify(pre));
  check("3b. after signing in through the form (left /login), collection is switched off", s.off && !/\/login/.test(page.url()), `${page.url().replace(BASE, "")} ${JSON.stringify(s)}`);
  check("3c. no page_view or event sent after sign-in", collectAfter.length === 0, collectAfter.slice(0, 2).join(" | "));
  await ctx.close();
}

check("4. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
