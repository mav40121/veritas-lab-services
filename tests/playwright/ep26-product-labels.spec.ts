// tests/playwright/ep26-product-labels.spec.ts
//
// Gate 3 step 8 receipt for the EP26 product-label edition correction
// (branch fix/ep26-edition-product-labels). The public Study Guide is the
// customer-facing surface that names the standard, so it is the cheapest
// place to prove the retired CLSI EP26-A designation is gone and the current
// CLSI EP26 designation renders. Also satisfies the gate3-ui-evidence CI gate
// for the client/src/pages changes in this PR.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test ep26-product-labels

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("EP26 product-label edition currency", () => {
  test("Study Guide names current CLSI EP26 and never the retired EP26-A", async ({ page }) => {
    await page.goto(`${BASE}/study-guide`);
    // Current designation is present (label line + comparison-table row).
    await expect(page.getByText(/CLSI EP26/).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Reagent Lot Verification \(EP26\)/i).first()).toBeVisible();
    // The retired first-edition designation must not appear anywhere on the page.
    await expect(page.getByText(/EP26-A/)).toHaveCount(0);
  });
});
