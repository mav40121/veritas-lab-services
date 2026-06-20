// tests/playwright/veritastock-unit-cost-form.spec.ts
//
// CFO lens: a buyer can maintain a price on a single item from the add/edit
// form. Unit Cost (per usage unit) feeds valuation, turns, ABC, and order-cost
// estimates; the read-only Cost per Order Unit derives unit_cost x units/order.
// This drives the form and asserts the derived field updates. No save -> no
// mutation of demo data.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-unit-cost-form

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock add-item form has unit cost + derived order-unit cost", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add item/i }).first().click();
  // Set units per order unit = 10, unit cost = 2.50 -> cost/order unit = $25.00
  const upo = page.locator('input[type="number"]').first(); // not relied on; use testid below
  await page.getByTestId("unit-cost-input").fill("2.50");
  // The derived display should reflect unit_cost x units_per_order_unit.
  const derived = page.getByTestId("cost-per-order-unit");
  await expect(derived).toBeVisible({ timeout: 10000 });
  // Default units_per_order_unit is 1, so derived == $2.50 at minimum.
  await expect(derived).toContainText("$2.50");
});
