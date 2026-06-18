// scripts/verify-veritastock-skin.mjs
//
// Live skin check for the veritastock.com host-aware chrome
// (client/src/components/NavBar.tsx). Forces www.veritastock.com to resolve to
// the Railway edge IP via Chromium's --host-resolver-rules so it works even when
// the local/system DNS cache still points at the old GoDaddy record. Asserts the
// VeritaStock-skinned brand ("Multi-Location Inventory") renders and the lab
// brand ("Clinical Laboratory Consulting") is gone, and saves a screenshot.
//
// Run: EDGE_IP=69.46.46.76 node scripts/verify-veritastock-skin.mjs

import { chromium } from "@playwright/test";

const EDGE_IP = process.env.EDGE_IP || "69.46.46.76";
const URL = "https://www.veritastock.com/";
const SHOT = process.env.SHOT || "veritastock-skin.png";

const browser = await chromium.launch({
  args: [`--host-resolver-rules=MAP www.veritastock.com ${EDGE_IP}, MAP veritastock.com ${EDGE_IP}`],
});

let result = { ok: false };
try {
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "load", timeout: 30000 });
  // Give the SPA a moment to render the NavBar.
  await page.waitForTimeout(2500);
  const stock = await page.getByText(/Multi-Location Inventory/i).count().catch(() => 0);
  const lab = await page.getByText(/Clinical Laboratory Consulting/i).count().catch(() => 0);
  const landing = await page.getByText(/Know what you have, everywhere/i).count().catch(() => 0);
  const labHero = await page.getByText(/Nobody taught you the compliance/i).count().catch(() => 0);
  const title = await page.title().catch(() => "");
  await page.screenshot({ path: SHOT, fullPage: false }).catch(() => {});
  result = {
    ok: stock > 0 && lab === 0 && landing > 0 && labHero === 0,
    stockBrandCount: stock, labBrandCount: lab, landingHeroCount: landing, labHeroCount: labHero,
    title, screenshot: SHOT,
  };
} catch (e) {
  result = { ok: false, error: String(e && e.message ? e.message : e) };
} finally {
  await browser.close();
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
