// tests/playwright/veritastock-order-placed-date.spec.ts
//
// PR 1 of receiving lifecycle: the Add/Edit Item form captures an order-placed
// date (auto-stamped when a quantity is entered), and /receive logs a receipt
// that records placed + received dates and the actual lead time. The receipt
// history is what lets a facility verify its programmed lead times.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-order-placed-date

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("Add Item form auto-stamps the order-placed date when a quantity is entered", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /add item/i }).first().click();
  await page.waitForTimeout(600);
  const placed = page.getByTestId("on-order-placed-input");
  await expect(placed).toBeVisible();
  await expect(placed).toHaveValue(""); // empty until a quantity is entered
  await page.getByTestId("on-order-qty-input").fill("24");
  // Entering a quantity auto-stamps today's date as the order-placed date.
  await expect(placed).not.toHaveValue("");
});

test("/receive logs a receipt with placed/received dates and actual lead time", async ({ request }) => {
  test.skip(!BASE, "needs PW_BASE");
  const login = await (await request.post(`${BASE}/api/demo/login`, { data: {} })).json();
  const auth = { Authorization: `Bearer ${login.token}` };

  // Create a throwaway on-order item with a placed date 12 days in the past.
  const placedMs = Date.now() - 12 * 86400000;
  const placedDate = new Date(placedMs).toISOString().slice(0, 10);
  const create = await request.post(`${BASE}/api/labs/2/inventory`, {
    headers: auth,
    data: {
      item_name: "PW Lead-Time Probe", category: "Supply", department: "Materials Management",
      quantity_on_hand: 0, usage_unit: "each", order_unit: "each", units_per_order_unit: 1,
      lead_time_days: 7, on_order_qty: 50, on_order_placed_date: placedDate,
    },
  });
  expect(create.ok()).toBeTruthy();
  const item = await create.json();
  try {
    const recvResp = await request.post(`${BASE}/api/inventory/${item.id}/receive`, { headers: auth, data: { received_qty: 50 } });
    expect(recvResp.ok()).toBeTruthy();
    const body = await recvResp.json();
    expect(body.receipt.order_placed_date).toBe(placedDate);
    // actual lead time must equal (received - placed) using the server's own dates.
    const expected = Math.round((Date.parse(body.receipt.received_date) - Date.parse(placedDate)) / 86400000);
    expect(body.receipt.actual_lead_time_days).toBe(expected);
    expect(body.receipt.programmed_lead_time_days).toBe(7);
  } finally {
    // Keep the demo pristine.
    await request.delete(`${BASE}/api/inventory/${item.id}`, { headers: auth });
  }
});
