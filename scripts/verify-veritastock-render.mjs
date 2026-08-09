// Gate 3 browser render check for the dedicated VeritaStock Railway deployment.
// Confirms the raw *.up.railway.app URL paints VeritaStock (not VeritaAssure)
// and that VeritaAssure marketing routes lock down to the VeritaStock landing.
import { chromium } from "@playwright/test";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";

const browser = await chromium.launch();
const page = await browser.newPage();
let fail = 0;

async function check(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
  const flagged = await page.evaluate(() => window.__STOCK_DEPLOYMENT__ === true).catch(() => false);
  const body = (await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "")) || "";
  const hasAssure = /You spent years mastering the science|Clinical Laboratory Consulting/i.test(body);
  const hasStock = /Multi-Location Inventory|VeritaStock/i.test(body);
  const ok = flagged === true && !hasAssure && hasStock;
  if (!ok) fail++;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${path}  flag=${flagged} assure=${hasAssure} stock=${hasStock}`);
}

for (const p of ["/", "/demo", "/veritacheck", "/pricing"]) {
  await check(p);
}

await browser.close();
console.log(fail === 0 ? "ALL PASS" : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
