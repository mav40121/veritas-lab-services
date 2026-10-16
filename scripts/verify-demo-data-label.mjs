// scripts/verify-demo-data-label.mjs
//
// Browser receipt for the VeritaCheck "Load Demo Data" label (Michael 2026-10-16: change "Milford
// creatinine calibration verification example" to "Demo Creatinine Data"; the old label named a
// client lab). LOCAL server + scratch DB, or production with PW_TOKEN for a sandbox owner.
//   1. New study, Data Entry tab: the label reads "Demo Creatinine Data" and "Milford" is nowhere on the page
//   2. light and dark
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-demo-data-label.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const PW = ["Zq", "demo", "7x!"].join("-");
const email = `demo-label-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
const d = new Database(process.env.SCRATCH_DB);
d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id);
d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
d.close();
check("0. QA owner and lab on the scratch DB", !!lab && !!reg.body?.token);

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })).newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritacheck`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Data Entry" }).click();
  const label = page.getByText("Demo Creatinine Data", { exact: true });
  await label.waitFor({ timeout: 15000 });
  const body = await page.locator("body").innerText();
  check(`1. [${scheme}] the Load Demo Data label reads "Demo Creatinine Data" and no "Milford" is on the page`, (await label.count()) === 1 && !/milford/i.test(body));
  const row = page.locator("div", { has: page.getByRole("button", { name: "Load Demo Data" }) }).last();
  await row.screenshot({ path: `${OUT}/demo-data-label-${scheme}.png` });
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
