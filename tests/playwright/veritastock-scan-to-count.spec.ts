// tests/playwright/veritastock-scan-to-count.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock director "Scan to count"
// button (PR #679, 2026-06-09). Confirms the two new user-auth endpoints
// gate cleanly on auth and the button mounts on the VeritaStock page when
// a director token is supplied.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock Scan to count", () => {
  test("by-barcode endpoint requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/inventory/items/by-barcode?barcode=VLS-00008332`);
    expect([401, 403]).toContain(r.status());
  });

  test("adjust endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/inventory/1/adjust`, {
      data: { new_quantity: 5 },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("authenticated by-barcode 400 on missing param", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    const r = await request.get(`${BASE}/api/inventory/items/by-barcode`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(400);
  });

  test("authenticated by-barcode 404 unknown_barcode", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    const r = await request.get(`${BASE}/api/inventory/items/by-barcode?barcode=DOES-NOT-EXIST-99999`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("unknown_barcode");
  });

  test("Scan to count button visible on VeritaStock page", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);
    await expect(page.getByTestId("open-count-workflow-button")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("open-count-workflow-button")).toHaveText(/Scan to count/i);
  });
});
