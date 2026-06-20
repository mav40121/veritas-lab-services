// tests/playwright/veritastock-layout.spec.ts
//
// Layout polish: the action toolbar wraps instead of overflowing the screen, and
// the inventory table headers stay pinned when the body scrolls. Uses the public
// demo login.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-layout

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("inventory table headers are sticky", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await expect(page).toHaveURL(/veritastock/);
  const pos = await page.locator("thead th").first().evaluate((el) => getComputedStyle(el).position);
  expect(pos).toBe("sticky");
});
