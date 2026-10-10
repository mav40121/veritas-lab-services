// scripts/verify-safety-advisor-label.mjs
// Gate 3 browser receipt for BUG-020 (Sampson, Natalie Lamb 2026-10-09: "How can I change the safety stock days?
// I tried to make it match the lead time, but it kept autocorrecting to something else."). Her three edited items
// all hold 2 days, exactly what the Safety Stock Advisor's "Apply" button produces for a 5 or 7 day lead time at its
// defaults. The button now says what it does ("Use 2 days").
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and adds one item):
//   PW_BASE=http://localhost:5152 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-safety-advisor-label.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5152", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (m, p, b, t, lab) => { const r = await fetch(BASE + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: b ? JSON.stringify(b) : undefined }); return r.json().catch(() => ({})); };
let failures = 0;
const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); if (!ok) failures++; };

const email = `ssadv-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "SS Advisor", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "SS Advisor Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, subscription_status = 'active' WHERE id = ?").run(labId);
sdb.close();
await call("POST", `/api/labs/${labId}/inventory`, { item_name: "ACTM reagent", department: "Chemistry", category: "Reagent", quantity_on_hand: 5, unit: "each", burn_rate: 2, lead_time_days: 7, safety_stock_days: 3, desired_days_of_stock: 30 }, token, labId);
const saved = async () => { const j = await call("GET", `/api/labs/${labId}/inventory`, null, token, labId); return (Array.isArray(j) ? j : j.items || []).find((x) => x.item_name === "ACTM reagent"); };

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  const open = async () => {
    await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
    if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.getByText("ACTM reagent").first().click();
    await page.getByTestId("safety-stock-input").waitFor({ timeout: 15000 });
  };
  await open();
  const safety = page.getByTestId("safety-stock-input"), btn = page.getByTestId("apply-safety-days");
  await safety.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("7"); await page.keyboard.press("Tab");
  const label = (await btn.innerText()).trim();
  check(`${mode}: the advisor button says what it does ("Use 2 days"), not "Apply"`, label === "Use 2 days", label);
  check(`${mode}: the typed 7 stays in the field`, (await safety.inputValue()) === "7", await safety.inputValue());
  await btn.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/bug020_advisor_${mode}.png` });
  await page.getByRole("button", { name: "Save Changes" }).click();
  await page.waitForTimeout(1200);
  check(`${mode}: Save Changes keeps 7`, (await saved())?.safety_stock_days === 7, String((await saved())?.safety_stock_days));
  await open();
  await page.getByTestId("apply-safety-days").click();
  check(`${mode}: "Use 2 days" sets the field to 2 (the suggestion), as its label says`, (await page.getByTestId("safety-stock-input").inputValue()) === "2");
  await page.keyboard.press("Escape");
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
