// tests/playwright/veritascan-library-export.spec.ts
//
// Wave A1.4 happy-path: Export button on the Document Library page
// triggers a download. The endpoint returns a valid xlsx with the
// expected Content-Type header.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaScan Wave A1.4 — library xlsx export", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
    }, TOKEN);
  });

  test("Export button visible on Document Library page", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritascan`);
    const exportBtn = page.getByTestId("button-export-library");
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toContainText(/Export/);
  });

  test("Export endpoint returns valid xlsx with documented headers", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/export.xlsx`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toMatch(/spreadsheetml/);
    expect(r.headers()["content-disposition"]).toMatch(/attachment/);
    const buf = await r.body();
    expect(buf.length).toBeGreaterThan(4096);
    // xlsx is a zip
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
  });
});
