// Gate 3 negative-branch check: the lab deployment (veritaslabservices.com)
// must NOT carry the VeritaStock flag and must still render VeritaAssure.
import { chromium } from "@playwright/test";
const BASE = process.env.VS_BASE || "https://www.veritaslabservices.com";
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => {});
const flagged = await page.evaluate(() => window.__STOCK_DEPLOYMENT__ === true).catch(() => false);
const body = (await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "")) || "";
const hasAssure = /mastering the science|Clinical Laboratory|VeritaAssure|compliance/i.test(body);
const hasStockLanding = /Multi-Location Inventory/i.test(body);
const ok = flagged === false && hasAssure && !hasStockLanding;
console.log(`[${ok ? "PASS" : "FAIL"}] lab /  flag=${flagged} assure=${hasAssure} stockLanding=${hasStockLanding}`);
await browser.close();
process.exit(ok ? 0 : 1);
