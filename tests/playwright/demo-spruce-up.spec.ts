// tests/playwright/demo-spruce-up.spec.ts
//
// Gate 3 step 8 (browser) evidence for the demo spruce-up pass on the PUBLIC
// /demo/compliance page. The demo is unauthenticated, so this drives the real
// page:
//   - VeritaCheck tab: the standalone "CUMSUM Trackers" section is removed
//     (CUMSUM is a study type, never its own module/section).
//   - Sticky banner says "generated data", not "real data" (no-PHI brand posture).
//   - VeritaMap tab no longer claims Mayo Clinic Laboratories auto-populates
//     reference ranges / critical values / AMR (VeritaMap rules; removed 2026-07-10).
// Gated behind PW_DEMO_SPRUCE so CI stays compile-only (the new copy only exists
// once this PR is deployed); run it manually against prod.
//
// Env: PW_BASE (default production www), PW_DEMO_SPRUCE=1 to actually run.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Public demo spruce-up", () => {
  test("CUMSUM section removed, banner + VeritaMap copy corrected", async ({ page }) => {
    if (!process.env.PW_DEMO_SPRUCE) {
      test.skip(true, "Set PW_DEMO_SPRUCE=1 to run against a deployed demo.");
      return;
    }
    await page.goto(`${BASE}/demo/compliance`, { waitUntil: "domcontentloaded" });

    // Sticky banner: no "real data".
    await expect(page.getByText("live, generated data")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("real data", { exact: false })).toHaveCount(0);

    // Default VeritaCheck tab: the standalone CUMSUM Trackers section is gone.
    await expect(page.getByText("CUMSUM Trackers")).toHaveCount(0);

    // VeritaMap tab: no Mayo auto-populate claim.
    await page.getByRole("button", { name: /VeritaMap/ }).click();
    await expect(page.getByText("Mayo", { exact: false })).toHaveCount(0);
  });
});
