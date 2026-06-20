// tests/playwright/veritastock-leadtime-drift.spec.ts
//
// PR 3 of receiving lifecycle: the lead-time drift flag. When an item's actual
// lead time (from receipt history) consistently differs from the programmed
// lead time, the Receiving screen flags it (slower = stockout risk, faster =
// over-buffered) and offers a one-click "update to actual". The demo seeds
// warehouse respiratory cartridges slow (21d programmed, ~28d actual) and EDTA
// tubes fast (12d programmed, ~7d actual).
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-leadtime-drift

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("Receiving screen flags lead-time drift, both directions", async ({ page, request }) => {
  test.skip(!BASE, "needs PW_BASE");

  // API truth.
  const login = await (await request.post(`${BASE}/api/demo/login`, { data: {} })).json();
  const flags = await (await request.get(`${BASE}/api/labs/2/veritastock/lead-time-flags`, { headers: { Authorization: `Bearer ${login.token}` } })).json();
  const resp = (flags as any[]).find((f) => /respiratory/i.test(f.item_name));
  const edta = (flags as any[]).find((f) => /EDTA/i.test(f.item_name));
  expect(resp, "respiratory cartridge flagged").toBeTruthy();
  expect(resp.direction).toBe("slower");
  expect(resp.programmed_lead_time_days).toBe(21);
  expect(resp.avg_actual_lead_time_days).toBeGreaterThan(21);
  expect(edta, "EDTA flagged").toBeTruthy();
  expect(edta.direction).toBe("faster");

  // UI truth.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await page.goto(`${BASE}/labs/2/veritastock/receiving`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const panel = page.getByTestId("leadtime-drift-panel");
  await expect(panel).toBeVisible({ timeout: 15000 });
  await expect(panel).toContainText(/stockout risk/i);
  await expect(panel).toContainText(/over-buffered/i);
});

test("apply endpoint updates programmed lead time and recomputes reorder point", async ({ request }) => {
  test.skip(!BASE, "needs PW_BASE");
  const login = await (await request.post(`${BASE}/api/demo/login`, { data: {} })).json();
  const auth = { Authorization: `Bearer ${login.token}` };
  const create = await request.post(`${BASE}/api/labs/2/inventory`, {
    headers: auth,
    data: { item_name: "PW LeadTime Apply Probe", category: "Supply", department: "Materials Management", quantity_on_hand: 0, usage_unit: "each", burn_rate: 2, lead_time_days: 10, safety_stock_days: 0 },
  });
  const item = await create.json();
  try {
    const res = await request.post(`${BASE}/api/inventory/${item.id}/lead-time`, { headers: auth, data: { lead_time_days: 19 } });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.item.lead_time_days).toBe(19);
    // reorder_point = burn (2) * (lead 19 + safety 0) = 38.
    expect(body.item.reorder_point).toBe(38);
  } finally {
    await request.delete(`${BASE}/api/inventory/${item.id}`, { headers: auth });
  }
});
