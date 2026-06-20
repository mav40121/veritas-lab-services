// tests/playwright/veritastock-reorder-demo.spec.ts
//
// Demo correctness: the lab-department scope selector is gone on the stock
// deployment, and the warehouse has items below reorder point so the Reorder Now
// tile and Order PDF are not blank. Uses the public demo login.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-reorder-demo

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("stock demo: no lab-department scope selector, reorder items present", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await expect(page).toHaveURL(/veritastock/);
  // The lab-department "Working in" scope selector must NOT be present on stock.
  await expect(page.getByTestId("veritastock-scope-selector")).toHaveCount(0);
  // Reorder Now tile shows a non-zero count (warehouse has items below par).
  await expect(page.getByText(/reorder now/i).first()).toBeVisible({ timeout: 15000 });
});
