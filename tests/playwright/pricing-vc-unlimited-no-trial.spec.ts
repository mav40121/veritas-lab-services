// tests/playwright/pricing-vc-unlimited-no-trial.spec.ts
//
// Gate 3 receipt for the 2026-06-19 trial-policy change: the 14-day free trial
// was dropped on VeritaCheck Unlimited (veritacheck_only) so a single study
// can't be run during a trial and the sub cancelled before the first charge,
// dodging the $25/study fee. Suite plans keep the trial. Server change lives in
// server/routes.ts (trial_period_days gated on priceType !== "veritacheck_only");
// this guards the matching public copy on /pricing.
//
// Public page, no auth needed. Run: PW_BASE=https://www.veritaslabservices.com \
//   npx playwright test pricing-vc-unlimited-no-trial

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Pricing: VeritaCheck Unlimited has no trial; suite plans do", () => {
  test("copy reflects suite-only trial", async ({ page }) => {
    await page.goto(`${BASE}/pricing`);
    // VeritaCheck Unlimited tile no longer claims a trial.
    await expect(
      page.getByText("Single user. Method verification suite only. First-year discount auto-applied at checkout."),
    ).toBeVisible({ timeout: 15000 });
    // The general subhead is scoped to suite plans, not "all plans".
    await expect(page.getByText(/Multi-seat suite plans include a 14-day free trial/i)).toBeVisible();
    // The old blanket "All subscription plans include a 14-day free trial" claim is gone.
    await expect(page.getByText(/All subscription plans include a 14-day free trial/i)).toHaveCount(0);
  });
});
