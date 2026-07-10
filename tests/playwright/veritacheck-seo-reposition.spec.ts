// tests/playwright/veritacheck-seo-reposition.spec.ts
//
// Gate 3 step 8 evidence for the VeritaCheck SEO/GEO repositioning (2026-07-09,
// SEO agent package item 1). The client-side useSEO title/description on
// /veritacheck was reframed from "EP evaluation" to the performance-verification
// module of the VeritaAssure compliance platform. The server-rendered crawlable
// feature block + SoftwareApplication featureList are checked separately by
// scripts/verify-veritacheck-seo.mjs (BASE=... live curl mode).
//
// Drives a real browser to /veritacheck and asserts the repositioned document
// title is applied client-side and the page renders. Public route, no auth.
//
// Env: PW_BASE (default prod www). Skips (compile-only) in CI when PW_RUN unset.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaCheck: SEO repositioning renders", () => {
  test("the /veritacheck document title reflects the performance-verification reposition", async ({ page }) => {
    if (!process.env.PW_RUN) {
      test.skip(true, "PW_RUN not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/veritacheck`, { waitUntil: "networkidle" });

    // useSEO sets the title client-side after hydration.
    await expect(page).toHaveTitle(/Performance Verification \| CLIA Calibration Verification and Method Comparison/);

    // The repositioned meta description should no longer reference "EP studies".
    const desc = await page.locator('meta[name="description"]').getAttribute("content");
    expect(desc || "").toContain("Calibration Verification / Linearity");
    expect(desc || "").not.toMatch(/Run EP studies/);
  });
});
