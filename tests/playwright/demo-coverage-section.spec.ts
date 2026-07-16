// tests/playwright/demo-coverage-section.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaCheck Coverage section added to
// the PUBLIC demo (/demo/compliance). The demo is unauthenticated, so this drives
// the real page: loads /demo/compliance, and on the default VeritaCheck tab
// asserts the "Coverage: what your VeritaMap requires..." block renders with its
// summary tiles. Gated behind PW_DEMO_COVERAGE so CI stays compile-only (the demo
// content only exists once this PR is deployed); run it manually against prod.
//
// Env: PW_BASE (default production www), PW_DEMO_COVERAGE=1 to actually run.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Public demo — VeritaCheck Coverage section", () => {
  test("Coverage block renders on /demo/compliance", async ({ page }) => {
    if (!process.env.PW_DEMO_COVERAGE) {
      test.skip(true, "Set PW_DEMO_COVERAGE=1 to run against a deployed demo.");
      return;
    }
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "domcontentloaded" });
    // Default tab is VeritaCheck; the Coverage block heading must appear.
    await expect(page.getByText("what your VeritaMap requires versus what you have")).toBeVisible({ timeout: 20000 });
    // And at least one of the summary tiles.
    await expect(page.getByText("Method comparisons").first()).toBeVisible();
  });
});
