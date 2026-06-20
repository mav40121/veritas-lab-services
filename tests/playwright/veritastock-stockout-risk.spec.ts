// tests/playwright/veritastock-stockout-risk.spec.ts
//
// CFO / materials-management view: VeritaStock surfaces a "Stockout Risk" count
// (items whose days-of-supply is at or below their replenishment lead time, so
// they run out before a reorder can arrive) as a summary tile and a status
// filter. This guards that the tile renders.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-stockout-risk

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock shows the Stockout Risk summary tile", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  // Main Lab has items whose runway is shorter than their (long, rural) lead time.
  await page.goto(`${BASE}/labs/4/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/Stockout Risk/i).first()).toBeVisible({ timeout: 15000 });
});
