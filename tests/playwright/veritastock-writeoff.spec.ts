// tests/playwright/veritastock-writeoff.spec.ts
//
// Materials-management lens: low-friction waste capture. A write-off is a reason
// code on a disposal a tech already does. This seeds a probe item, drives the
// Write off button + dialog (reason Expired, full qty), asserts on-hand drops to
// zero, then deletes the probe so demo data stays clean.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-writeoff

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock write-off records waste and reduces on-hand", async ({ page, request }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  const created = await request.post(`${BASE}/api/labs/2/inventory`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    data: { item_name: "ZZ_WRITEOFF_SPEC", category: "Reagent", department: "Core Lab", quantity_on_hand: 8, usage_unit: "test", unit_cost: 5 },
  });
  const id = (await created.json()).id as number;
  try {
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    await page.getByTestId(`button-writeoff-${id}`).click();
    await expect(page.getByTestId("writeoff-value")).toBeVisible({ timeout: 10000 });
    await page.getByTestId("writeoff-confirm").click();
    await page.waitForTimeout(1500);
    const after = await request.get(`${BASE}/api/labs/2/inventory`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await after.json();
    const items = Array.isArray(body) ? body : body.items;
    const it = items.find((x: any) => x.id === id);
    expect(it.quantity_on_hand).toBe(0);
  } finally {
    await request.delete(`${BASE}/api/inventory/${id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  }
});
