// tests/playwright/veritastock-route-lockdown.spec.ts
//
// The VeritaStock deployment is a VeritaStock-ONLY product: VeritaAssure
// marketing/module routes (/demo, /veritacheck, /pricing, ...) redirect to the
// VeritaStock landing and never render the lab-compliance site. The lab
// deployment (veritaslabservices.com) keeps all of those routes.
//
// Run stock:  PW_BASE=https://www.veritastock.com        npx playwright test veritastock-route-lockdown
// Run lab:    PW_BASE=https://www.veritaslabservices.com npx playwright test veritastock-route-lockdown

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const isStock = /veritastock\.com/i.test(BASE);

test.describe("VeritaStock route lockdown", () => {
  test("VeritaAssure routes redirect to the VeritaStock landing", async ({ page }) => {
    test.skip(!isStock, "run against PW_BASE=https://www.veritastock.com");
    for (const path of ["/demo", "/veritacheck", "/pricing"]) {
      await page.goto(`${BASE}${path}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.getByText(/Experience VeritaAssure/i)).toHaveCount(0);
      await expect(page.getByText(/Clinical Laboratory Consulting/i)).toHaveCount(0);
      await expect(page.getByText(/Multi-Location Inventory/i).first()).toBeVisible({ timeout: 15000 });
    }
  });

  test("lab host keeps the VeritaAssure routes", async ({ page }) => {
    test.skip(isStock, "lab-host only");
    await page.goto(`${BASE}/demo`);
    await expect(page.getByText(/Experience VeritaAssure/i)).toBeVisible({ timeout: 15000 });
  });
});
