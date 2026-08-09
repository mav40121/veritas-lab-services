// Regression smoke for the LAB site (veritaslabservices.com) after the
// same-origin API_BASE change. Public pages only (no creds). Confirms:
// VeritaAssure renders, no VeritaStock flag leak, no failed same-origin /api
// calls, no CORS/console errors.
import { chromium } from "@playwright/test";
const BASE = process.env.LAB_BASE || "https://www.veritaslabservices.com";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const fails = [], errs = [];
page.on("requestfailed", (r) => { if (/\/api\//.test(r.url())) fails.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`); });
page.on("response", (r) => { if (/\/api\//.test(r.url()) && r.status() >= 400) fails.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("console", (m) => { if (m.type() === "error" && /CORS|Access-Control|Failed to fetch/i.test(m.text())) errs.push(m.text()); });

let bad = 0;
for (const [path, expect] of [["/", /VeritaAssure|compliance|mastering the science/i], ["/pricing", /Clinic|Community|Hospital|pricing|plan/i], ["/demo", /VeritaAssure|demo|Experience/i]]) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const body = await page.evaluate(() => document.body.innerText).catch(() => "");
  const flagged = await page.evaluate(() => window.__STOCK_DEPLOYMENT__ === true).catch(() => false);
  const ok = expect.test(body) && !flagged && !/Multi-Location Inventory/i.test(body.slice(0, 200));
  if (!ok) bad++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${path}  flag=${flagged} content=${expect.test(body)}`);
}
console.log("--- failed same-origin /api calls:", fails.length);
fails.slice(0, 8).forEach((f) => console.log("   ", f));
console.log("--- CORS/fetch console errors:", errs.length);
errs.slice(0, 5).forEach((e) => console.log("   ", e));
console.log(bad === 0 && fails.length === 0 ? "LAB REGRESSION: CLEAN" : "LAB REGRESSION: REVIEW");
await browser.close();
