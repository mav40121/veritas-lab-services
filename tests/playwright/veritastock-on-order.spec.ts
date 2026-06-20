// tests/playwright/veritastock-on-order.spec.ts
//
// Materials-management lens: on-order / in-transit tracking. The item form
// takes an On Order quantity + expected arrival, and shows the live inventory
// position (on hand + on order). Drives the form and asserts the position note
// appears. No save -> no mutation of demo data.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-on-order

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock add-item form has on-order qty + inventory position note", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add item/i }).first().click();
  await page.getByTestId("on-order-qty-input").fill("12");
  // The live inventory-position note appears once on-order > 0.
  await expect(page.getByTestId("inventory-position-note")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("inventory-position-note")).toContainText(/position/i);
});
