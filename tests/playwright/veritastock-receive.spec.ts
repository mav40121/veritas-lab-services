// tests/playwright/veritastock-receive.spec.ts
//
// Materials-management lens: the receiving half of the replenishment loop. An
// item with stock on order shows a Receive action that moves the inbound qty
// into on-hand (dedicated /receive endpoint, never a partial PUT). This seeds a
// probe item with on-order via API, drives the Receive button, asserts on-hand
// increased, then deletes the probe so demo data stays clean.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-receive

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock Receive moves on-order into on-hand", async ({ page, request }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  // Seed a probe item with on-order via the API.
  const created = await request.post(`${BASE}/api/labs/2/inventory`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    data: { item_name: "ZZ_RECEIVE_SPEC", category: "Reagent", department: "Core Lab", quantity_on_hand: 5, usage_unit: "test", on_order_qty: 20 },
  });
  const id = (await created.json()).id as number;
  try {
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    await page.getByTestId(`button-receive-${id}`).click();
    await page.getByTestId("receive-confirm").click();
    await page.waitForTimeout(1500);
    // Re-fetch the item: on-hand should now be 25, on-order 0.
    const after = await request.get(`${BASE}/api/labs/2/inventory`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await after.json();
    const items = Array.isArray(body) ? body : body.items;
    const it = items.find((x: any) => x.id === id);
    expect(it.quantity_on_hand).toBe(25);
    expect(it.on_order_qty).toBe(0);
  } finally {
    await request.delete(`${BASE}/api/inventory/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }
});
