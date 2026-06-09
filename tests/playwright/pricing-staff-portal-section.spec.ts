// tests/playwright/pricing-staff-portal-section.spec.ts
//
// Gate 3 step 8 for the Staff Portal pricing PR (2026-06-08). Asserts
// the new Staff Portal section renders on /pricing with the three
// bands at the right prices. Visual layout is human-verified by
// Michael on prod; this spec covers the content-correctness regression
// (someone editing the band labels without updating the price).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Pricing page Staff Portal section", () => {
  test("renders the three bands with correct prices and ceilings", async ({ page }) => {
    await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Staff Portal Add-On/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/pay for who edits/i).first()).toBeVisible();

    // Small band
    await expect(page.getByText("$149", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/up to 25 staff/i).first()).toBeVisible();
    // Medium band (most popular)
    await expect(page.getByText("$399", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/up to 100 staff/i).first()).toBeVisible();
    await expect(page.getByText(/most labs/i).first()).toBeVisible();
    // Large band
    await expect(page.getByText("$799", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/up to 250 staff/i).first()).toBeVisible();

    // Above 250 routes to System tier
    await expect(page.getByText(/above 250/i).first()).toBeVisible();
  });
});
