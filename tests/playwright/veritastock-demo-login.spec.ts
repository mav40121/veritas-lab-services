// tests/playwright/veritastock-demo-login.spec.ts
//
// Public one-click demo login: on the VeritaStock deployment the login page shows
// a "Launch live demo" button that mints a sandbox session and drops the visitor
// straight into the inventory, no signup, no plan wall.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-demo-login

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("public demo login lands in the inventory, no plan wall", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await expect(page.getByTestId("launch-demo")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(3500);
  await expect(page).toHaveURL(/veritastock/);
  await expect(page.getByText(/requires an active subscription/i)).toHaveCount(0);
});
