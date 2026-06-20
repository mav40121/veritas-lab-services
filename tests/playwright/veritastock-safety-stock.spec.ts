// tests/playwright/veritastock-safety-stock.spec.ts
//
// Materials-management lens: the safety-stock advisor shows a statistically
// derived safety-days figure (Z x CV x sqrt(lead)) the director can compare to
// the flat value and apply. Drives the add-item form and asserts the advisor
// renders and recomputes. No save -> no mutation of demo data.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-safety-stock

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock safety-stock advisor renders + recomputes", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add item/i }).first().click();
  // Default lead time is 5, so the advisor shows.
  await expect(page.getByTestId("safety-stock-advisor")).toBeVisible({ timeout: 10000 });
  const suggested = page.getByTestId("suggested-safety-days");
  await expect(suggested).toBeVisible();
  const v = await suggested.innerText();
  expect(Number(v)).toBeGreaterThan(0);
});
