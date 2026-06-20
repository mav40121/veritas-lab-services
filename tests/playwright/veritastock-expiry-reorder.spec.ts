// tests/playwright/veritastock-expiry-reorder.spec.ts
//
// Expiry-aware reordering: an item with sufficient quantity on the shelf but a
// short-dated lot must surface in Reorder Now ("Expiring lot") because the
// stock will expire before it can be consumed at the current burn rate. The
// warehouse glucometer test strips are the demo hero (6000 on hand, ~46 days of
// nominal supply, well above par, but the lot expires in ~14 days).
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-expiry-reorder

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("stock demo: short-dated lot flags Reorder Now despite sufficient quantity", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");

  // API truth: the warehouse strips are above par by quantity but flagged for
  // reorder by expiry.
  const login = await (await fetch(`${BASE}/api/demo/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  const items = await (await fetch(`${BASE}/api/labs/2/inventory`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  const strip = (items as any[]).find((i) => /glucometer test strip/i.test(i.item_name));
  expect(strip, "warehouse glucometer strips present").toBeTruthy();
  expect(strip.inventory_position).toBeGreaterThan(strip.reorder_point); // sufficient quantity on hand
  expect(strip.effective_position).toBeLessThanOrEqual(strip.reorder_point); // but not enough usable before expiry
  expect(strip.needs_reorder).toBe(true);
  expect(strip.expiry_driven_reorder).toBe(true);
  expect(strip.reorder_reason).toBe("Expiring lot");

  // UI truth: the row shows Reorder Now and the Expiring lot pill.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const row = page.locator("tr", { hasText: /Glucometer test strips/i }).first();
  await expect(row).toContainText(/Reorder Now/i);
  await expect(row).toContainText(/Expiring lot/i);
});
