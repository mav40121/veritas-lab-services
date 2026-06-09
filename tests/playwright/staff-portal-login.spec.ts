// tests/playwright/staff-portal-login.spec.ts
//
// Gate 3 step 8 for the Staff Portal login page (task #131, 2026-06-08).
// Asserts the login screen renders with the CLIA + PIN inputs, the
// Submit button gates on valid input, and the API endpoint exists
// (probes /api/staff-portal-login with an obviously-invalid PIN and
// expects 400 or 401, never 5xx).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Staff Portal login surface", () => {
  test("login form renders with CLIA and PIN inputs", async ({ page }) => {
    await page.goto(`${BASE}/staff-access`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Staff Portal/i).first()).toBeVisible({ timeout: 10000 });
    const cliaInput = page.getByTestId("sp-login-clia");
    const pinInput = page.getByTestId("sp-login-pin");
    const submit = page.getByTestId("sp-login-submit");
    await expect(cliaInput).toBeVisible();
    await expect(pinInput).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();

    await cliaInput.fill("99D9999999");
    await pinInput.fill("123456");
    await expect(submit).toBeEnabled();
  });

  test("API endpoint exists and rejects invalid credentials cleanly", async ({ request }) => {
    const r = await request.post(`${BASE}/api/staff-portal-login`, {
      data: { clia: "99D9999999", pin: "000000" },
    });
    // 400 (missing fields), 401 (bad creds), 423 (locked) all acceptable.
    // 5xx would mean the endpoint is broken.
    expect([400, 401, 423]).toContain(r.status());
  });
});
