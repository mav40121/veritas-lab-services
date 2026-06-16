// tests/playwright/hospital-inventory-landing.spec.ts
//
// Gate 3 step 8 receipt for the standalone hospital-inventory marketing page
// (client/src/pages/HospitalInventoryPage.tsx, route /hospital-inventory).
// Public page, no auth. Confirms the client-rendered hero, the multi-location
// section, and the demo CTA actually render on the deployed site.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test hospital-inventory-landing

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Hospital inventory landing page", () => {
  test("renders hero, multi-location section, and demo CTA", async ({ page }) => {
    await page.goto(`${BASE}/hospital-inventory`);
    await expect(
      page.getByRole("heading", { name: /Hospital inventory control/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/One warehouse, every stockroom/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Book a demo/i }).first()).toBeVisible();
  });
});
