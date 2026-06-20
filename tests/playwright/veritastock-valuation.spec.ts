// tests/playwright/veritastock-valuation.spec.ts
//
// CFO lens: VeritaStock values inventory in dollars. A "$ on Hand" summary tile
// (sum of quantity x unit cost) and a Unit Cost column are present once items
// carry a unit_cost. Guards that the tile renders.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-valuation

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock shows the $ on Hand valuation tile", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/\$ on Hand/i).first()).toBeVisible({ timeout: 15000 });
});
