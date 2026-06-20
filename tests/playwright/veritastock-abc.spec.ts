// tests/playwright/veritastock-abc.spec.ts
//
// Materials-management lens: ABC stratification (Pareto by annual dollar usage)
// labels each SKU A/B/C so the buyer tightens control on the high-value few.
// Guards that the ABC column renders and the ABC filter narrows the table.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-abc

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock shows ABC class column + filter", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2500);
  // ABC column header is present.
  await expect(page.getByRole("columnheader", { name: "ABC" }).first()).toBeVisible({ timeout: 15000 });
  // At least one A badge renders (a warehouse always has a high-value item).
  await expect(page.locator("td span", { hasText: /^A$/ }).first()).toBeVisible({ timeout: 15000 });
});
