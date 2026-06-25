// tests/playwright/seo-resources-citations.spec.ts
//
// Gate 3 step 8 receipt + regression test for the resources SEO PR:
//   A. TEa page title rewrite (client/src/pages/ArticleTeaPage.tsx +
//      server/seo-metadata.ts) for CTR, year-intent title.
//   B. EP26 reagent-lot CFR citation fix (client/src/lib/faqContent.ts +
//      client/src/pages/ArticleEP26Page.tsx). The reagent-lot-change trigger is
//      42 CFR 493.1255(b)(3)(i) with control testing under 493.1256, not 493.1253
//      (which governs initial performance-spec verification). Verified vs Cornell LII.
//
// Public marketing pages, no auth. These are text-only changes (no new interactive
// element), so this spec is the browser exercise: it asserts the rendered title and
// the corrected citation, and that the off-point 493.1253 is gone from the EP26 page.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test seo-resources-citations

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Resources SEO text", () => {
  test("TEa page carries the rewritten year-intent title", async ({ page }) => {
    await page.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`);
    await expect(page).toHaveTitle(/Total Allowable Error \(TEa\): 2026 Limits by Specialty/i, {
      timeout: 15000,
    });
  });

  test("EP26 page cites the on-point reagent-lot sections and not 493.1253", async ({ page }) => {
    await page.goto(`${BASE}/resources/ep26-reagent-lot-verification`);
    await expect(
      page.getByRole("heading", { name: /EP26 Reagent Lot Verification/i })
    ).toBeVisible({ timeout: 15000 });
    // The corrected citation appears in the article body (and the FAQ block).
    await expect(page.getByText(/493\.1255\(b\)\(3\)\(i\)/).first()).toBeVisible();
    await expect(page.getByText(/493\.1256/).first()).toBeVisible();
    // The off-point section is gone from this page.
    await expect(page.getByText("493.1253")).toHaveCount(0);
  });
});
