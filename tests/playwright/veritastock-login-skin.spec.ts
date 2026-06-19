// tests/playwright/veritastock-login-skin.spec.ts
//
// Gate 3 receipt: the veritastock.com login/signup page is a self-contained
// VeritaStock account flow, NOT the VeritaAssure lab-compliance signup (no plan
// tiers, no CLIA, no lab-type steps). The lab host keeps the full flow.
//
// Run stock:  PW_BASE=https://www.veritastock.com        npx playwright test veritastock-login-skin
// Run lab:    PW_BASE=https://www.veritaslabservices.com npx playwright test veritastock-login-skin

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const isStock = /veritastock\.com/i.test(BASE);

test.describe("VeritaStock host login/signup skin", () => {
  test("stock host signup is clean VeritaStock (no plan tiers or CLIA)", async ({ page }) => {
    test.skip(!isStock, "run against PW_BASE=https://www.veritastock.com");
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole("heading", { name: /VeritaStock/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/VeritaAssure.{0,4}Account/i)).toHaveCount(0);
    await page.getByRole("tab", { name: /Create Account/i }).click();
    await expect(page.getByText(/inventory management only/i)).toBeVisible();
    for (const banned of [/Choose your plan/i, /CLIA number required/i, /What type of lab/i, /\$499\/yr/i]) {
      await expect(page.getByText(banned)).toHaveCount(0);
    }
  });

  test("lab host signup still shows the VeritaAssure flow", async ({ page }) => {
    test.skip(isStock, "lab-host only");
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole("heading", { name: /VeritaAssure/i })).toBeVisible({ timeout: 15000 });
  });
});
