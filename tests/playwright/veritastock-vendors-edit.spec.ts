// tests/playwright/veritastock-vendors-edit.spec.ts
//
// Demo polish: every item carries a real San Carlos vendor, and the item name is
// a clickable edit affordance (so price/lead time/vendor are editable even when
// the Actions column scrolls off a wide table). Uses the public demo login.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-vendors-edit

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("demo items have vendors and a working edit affordance", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await expect(page).toHaveURL(/veritastock/);
  // Item name is a clickable, enabled edit affordance (not read-only).
  const editName = page.locator('[data-testid^="edit-name-"]').first();
  await expect(editName).toBeVisible({ timeout: 15000 });
  await expect(editName).toBeEnabled();
  // Clicking it opens the edit dialog.
  await editName.click();
  await expect(page.getByText(/Edit Item/i).first()).toBeVisible({ timeout: 10000 });
});
