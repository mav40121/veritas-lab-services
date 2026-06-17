// tests/playwright/ep26-article.spec.ts
//
// Gate 3 step 8 receipt for the EP26 reagent lot verification cornerstone
// article (client/src/pages/ArticleEP26Page.tsx, route
// /resources/ep26-reagent-lot-verification). Public page, no auth. Confirms the
// client-rendered hero, the protocol section, the FAQ block, and the VeritaCheck
// CTA render on the deployed site.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test ep26-article

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("EP26 reagent lot verification article", () => {
  test("renders hero, protocol, FAQ, and the VeritaCheck CTA", async ({ page }) => {
    await page.goto(`${BASE}/resources/ep26-reagent-lot-verification`);
    await expect(
      page.getByRole("heading", { name: /EP26 Reagent Lot Verification/i })
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/The EP26 protocol, step by step/i)).toBeVisible();
    await expect(page.getByText(/Is reagent lot verification required by CLIA/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Run a Free Study/i }).first()).toBeVisible();
  });
});
