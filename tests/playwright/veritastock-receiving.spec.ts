// tests/playwright/veritastock-receiving.spec.ts
//
// PR 2 of receiving lifecycle: the dedicated Receiving screen lists every open
// PO for the location with its order-placed date and ETA, receives them in one
// place, and shows a receipt history. Verifies navigation, the open-PO list,
// and a full receive round trip (create throwaway PO -> receive in the UI ->
// it leaves the open list and appears in receipt history -> cleanup).
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-receiving

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("Receiving screen lists open POs with placed date and a receipt history", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByTestId("receiving-button").click();
  await expect(page).toHaveURL(/veritastock\/receiving/);
  await page.waitForTimeout(2000);
  // The seeded open PO (blood culture bottle set) shows with an Order Placed date.
  const row = page.locator("tr", { hasText: /Blood culture bottle set/i }).first();
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(row).toContainText(/\d{4}-\d{2}-\d{2}/); // placed/expected dates present
  await expect(page.getByText(/Receipt history/i)).toBeVisible();
});

test("receiving an open PO records it and moves it out of the open list", async ({ page, request }) => {
  test.skip(!BASE, "needs PW_BASE");
  const login = await (await request.post(`${BASE}/api/demo/login`, { data: {} })).json();
  const auth = { Authorization: `Bearer ${login.token}` };
  const placedDate = new Date(Date.now() - 9 * 86400000).toISOString().slice(0, 10);
  const create = await request.post(`${BASE}/api/labs/2/inventory`, {
    headers: auth,
    data: {
      item_name: "PW Receiving Probe", category: "Supply", department: "Materials Management",
      quantity_on_hand: 0, usage_unit: "each", order_unit: "each", units_per_order_unit: 1,
      lead_time_days: 7, on_order_qty: 30, on_order_placed_date: placedDate,
    },
  });
  const item = await create.json();
  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
    await page.getByTestId("launch-demo").click();
    await page.waitForTimeout(4000);
    await page.goto(`${BASE}/labs/2/veritastock/receiving`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const recvBtn = page.getByTestId(`receiving-receive-${item.id}`);
    await expect(recvBtn).toBeVisible({ timeout: 15000 });
    await recvBtn.click();
    await page.waitForTimeout(2500);
    // It leaves the open-PO list...
    await expect(page.getByTestId(`receiving-row-${item.id}`)).toHaveCount(0);
    // ...and shows in receipt history.
    await expect(page.locator("tr", { hasText: /PW Receiving Probe/i }).first()).toBeVisible({ timeout: 10000 });
  } finally {
    await request.delete(`${BASE}/api/inventory/${item.id}`, { headers: auth });
  }
});
