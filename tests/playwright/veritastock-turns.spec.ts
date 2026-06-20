// tests/playwright/veritastock-turns.spec.ts
//
// CFO lens: the $ on Hand tile also reports inventory turns and value-weighted
// days-on-hand, so the director sees not just how much capital is on the shelf
// but how fast it turns. Guards that the turns line renders.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-turns

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock $ on Hand tile shows turns + days on hand", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/4/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/turns\/yr/i).first()).toBeVisible({ timeout: 15000 });
});
