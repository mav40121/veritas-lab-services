// tests/playwright/veritastock-expiry-value.spec.ts
//
// CFO lens: the Expiring tile shows the dollar value at risk of write-off, not
// just a count of near-expiry items. Guards that the "$ at risk" line renders.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-expiry-value

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock Expiring tile shows dollar value at risk", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/at risk/i).first()).toBeVisible({ timeout: 15000 });
});
