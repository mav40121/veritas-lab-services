// tests/playwright/qc-resource-page.spec.ts
//
// Gate 3 step 8 receipt for the QC "testing into compliance" resource page
// (client/src/pages/ArticleQCTestingIntoCompliancePage.tsx + its route, index,
// and seo-metadata JSON-LD). Public page, no auth. Confirms the article H1, the
// Key Takeaways box, the sigma table, and the FAQ render at the slug, so the
// code-split route resolves and the page is not a blank/404.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test qc-resource-page

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("QC testing-into-compliance resource page", () => {
  test("renders the article, key takeaways, sigma table, and FAQ", async ({ page }) => {
    await page.goto(`${BASE}/resources/quality-control-testing-into-compliance`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(/When Quality Control Stops Working/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Key takeaways/i)).toBeVisible();
    await expect(page.getByText(/Method sigma/i)).toBeVisible();
    await expect(page.getByText(/Frequently Asked Questions/i)).toBeVisible();
    await expect(page.getByText(/Is it acceptable to repeat a control until it passes/i)).toBeVisible();
  });
});
