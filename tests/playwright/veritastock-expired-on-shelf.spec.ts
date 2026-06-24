// tests/playwright/veritastock-expired-on-shelf.spec.ts
//
// Gate 3 evidence for the expired-on-shelf cross-location alert. Customer
// promise (Michael): if a product expired while still on the shelf, there is an
// alert for every location that holds that product. The main VeritaStock page
// now fetches GET /veritastock/expired-on-shelf (enterprise-group scoped) and
// renders a red banner listing each expired product + the locations holding it.
//
// Run (Michael, owner token on the VeritaStock service):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-expired-on-shelf
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

test.describe("VeritaStock expired-on-shelf alert", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("the endpoint returns products grouped by location", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/expired-on-shelf`, { headers: auth });
    expect(r.ok(), `expired-on-shelf: ${r.status()}`).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.items)).toBeTruthy();
    expect(Array.isArray(body.products)).toBeTruthy();
    expect(typeof body.total).toBe("number");
    // Every returned item is genuinely past expiry with stock on hand.
    const today = new Date().toISOString().slice(0, 10);
    for (const it of body.items) {
      expect(it.expiration_date < today).toBeTruthy();
      expect(it.quantity_on_hand > 0).toBeTruthy();
    }
    // Each product groups one-or-more locations.
    for (const p of body.products) {
      expect(Array.isArray(p.locations) && p.locations.length > 0).toBeTruthy();
    }
  });

  test("the banner appears on the main page when there is expired stock", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/expired-on-shelf`, { headers: auth });
    const body = r.ok() ? await r.json() : { total: 0 };
    test.skip((body.total || 0) === 0, "no expired-on-shelf stock right now");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock`);
    await expect(page.getByTestId("expired-on-shelf-banner")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("expired-product-row").first()).toBeVisible();
  });
});
