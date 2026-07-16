// tests/playwright/demo-coverage-table.spec.ts
//
// Gate 3 step 8 (browser) evidence for the diversified demo Coverage table. The
// table samples covered method-comparison rows across the menu (not the
// alphabetical-first, which were all blood bank), so it should render a spread of
// specialties plus the real gaps. Public page, so this drives the real demo.
// Gated behind PW_DEMO_COVERAGE so CI stays compile-only; run against a deployed demo.
//
// Env: PW_BASE (default production www), PW_DEMO_COVERAGE=1 to actually run.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Public demo Coverage table diversity", () => {
  test("table shows both a Covered and a Missing correlation row", async ({ page }) => {
    if (!process.env.PW_DEMO_COVERAGE) {
      test.skip(true, "Set PW_DEMO_COVERAGE=1 to run against a deployed demo.");
      return;
    }
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "domcontentloaded" });
    // The Coverage block heading anchors us to the section.
    await expect(page.getByText("what your VeritaMap requires versus what you have")).toBeVisible({ timeout: 20000 });
    // The sampled table shows the credible mix: at least one Covered and one Missing badge.
    await expect(page.getByText("Covered").first()).toBeVisible();
    await expect(page.getByText("Missing").first()).toBeVisible();
  });
});
