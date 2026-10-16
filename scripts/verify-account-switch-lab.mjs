// scripts/verify-account-switch-lab.mjs
//
// Browser receipt for BUG-063 and the Trust page sign-in update. LOCAL server + scratch DB only.
//   1. Account A is signed in with its own lab remembered. WITHOUT signing out, account B signs in
//      on the sign-in page. B must land on B's lab, not A's (before the fix: /labs/<A's lab>/...).
//   2. The Trust page describes two-factor sign-in and single sign-on (light and dark).
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-account-switch-lab.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const stamp = Date.now();
const PW = ["Zq", "switch", "7x!"].join("-");
const mk = async (tag, labName) => {
  const email = `switch-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Switch ${tag.toUpperCase()}`, hipaa_acknowledged: true });
  const lab = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" });
  const id = reg.body?.user?.id, labId = lab.body?.labId;
  scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(id); });
  return { email, id, labId, user: reg.body?.user };
};
const A = await mk("a", "Account A Lab (QA)");
const B = await mk("b", "Account B Lab (QA)");
check("0. two accounts, each with its own lab, on the scratch DB", !!A.labId && !!B.labId && A.labId !== B.labId, JSON.stringify({ a: A.labId, b: B.labId }));

const browser = await chromium.launch();
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  // A signs in normally and works in A's lab.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(A.email);
  await page.getByTestId("login-password").fill(PW);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
  await page.evaluate((l) => localStorage.setItem("veritas_active_lab_id", String(l)), A.labId);
  await page.goto(`${BASE}/labs/${A.labId}/dashboard`, { waitUntil: "networkidle" });
  check("1a. account A is working in its own lab", page.url().includes(`/labs/${A.labId}/`), page.url());
  // B signs in on the same browser WITHOUT A signing out.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(B.email);
  await page.getByTestId("login-password").fill(PW);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const remembered = await page.evaluate(() => localStorage.getItem("veritas_active_lab_id"));
  check("1b. account B does not open at account A's lab", !page.url().includes(`/labs/${A.labId}/`) && remembered !== String(A.labId), `${page.url()} remembered=${remembered}`);
  check("1c. account B lands on its dashboard", /\/dashboard/.test(page.url()), page.url());
  await ctx.close();
}
for (const scheme of ["light", "dark"]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })).newPage();
  await page.goto(`${BASE}/trust`, { waitUntil: "networkidle" });
  const sec = page.locator("section", { hasText: "3. How Your Data Is Protected" });
  const t = await sec.innerText();
  check(`2. [${scheme}] Trust page section 3 describes two-factor sign-in and single sign-on`, t.includes("Two-factor sign-in") && t.includes("Single sign-on") && t.includes("Microsoft Entra") && !/snapshot/i.test(await page.locator("body").innerText()), t.replace(/\s+/g, " ").slice(0, 120));
  await sec.screenshot({ path: `${OUT}/trust-section3-signin-${scheme}.png` });
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
