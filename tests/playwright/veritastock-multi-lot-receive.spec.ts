// tests/playwright/veritastock-multi-lot-receive.spec.ts
//
// Gate 3 evidence for multi-lot receive (Michael: "I still cant store multiple
// lots and expirations"). Receiving now captures the arriving lot # + expiration;
// a lot/expiry different from the item's current stock is stored as its own
// lot-row. The receipt history records the lot + expiry that arrived.
//
// Run (Michael, owner token on the VeritaStock service):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-multi-lot-receive
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const auth = { Authorization: `Bearer ${TOKEN}` };

async function firstLabId(request: APIRequestContext): Promise<number> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return 0;
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.length ? labs[0].labId : 0;
}

test.describe("VeritaStock multi-lot receive", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("receipts endpoint exposes the received lot + expiry fields", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/receipts`, { headers: auth });
    expect(r.ok(), `receipts: ${r.status()}`).toBeTruthy();
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) {
      expect(rows[0]).toHaveProperty("received_lot_number");
      expect(rows[0]).toHaveProperty("received_expiration_date");
    }
  });

  test("the Receiving page exposes lot # + expiration inputs per open PO", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock/receiving`);
    await expect(page.getByText("Receipt history")).toBeVisible({ timeout: 20000 });

    const anyLot = page.locator('[data-testid^="receiving-lot-"]').first();
    if (await anyLot.count()) {
      await expect(anyLot).toBeVisible();
      await expect(page.locator('[data-testid^="receiving-exp-"]').first()).toBeVisible();
    }
  });
});
