// tests/playwright/pricing-vc-unlimited-no-trial.spec.ts
//
// Gate 3 receipt for the 2026-06-19 trial-policy change: the 14-day free trial
// was dropped on VeritaCheck Unlimited (veritacheck_only) so a single study
// can't be run during a trial and the sub cancelled before the first charge,
// dodging the $25/study fee. Server change lives in server/routes.ts
// (trial_period_days gated on priceType !== "veritacheck_only"); this guards the
// matching public copy on /pricing.
//
// 2026-10-14 (Michael, Q195 = 1, #1634): suite labs are set up by our team after
// a short call, so the page no longer advertises a self-serve 14-day trial at all.
// The suite subhead and cards say "Set up with our team on a short call", and the
// VeritaCheck Unlimited card footer stopped claiming the trial it has not had since
// 6/19 (every annual card shared one "14-day free trial" footer until then).
//
// Public page, no auth needed. Run: PW_BASE=https://www.veritaslabservices.com \
//   npx playwright test pricing-vc-unlimited-no-trial

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Pricing: no self-serve trial claims; suite plans are set up with our team", () => {
  test("copy reflects staff-led suite setup and no VeritaCheck Unlimited trial", async ({ page }) => {
    await page.goto(`${BASE}/pricing`);
    // VeritaCheck Unlimited tile does not claim a trial.
    await expect(
      page.getByText("Single user. Method verification suite only. First-year discount auto-applied at checkout."),
    ).toBeVisible({ timeout: 15000 });
    // The subhead and the three suite cards say the lab is set up with our team.
    await expect(page.getByText(/Suite plans are set up with our team on a short call/i)).toBeVisible();
    await expect(page.getByText(/^Set up with our team on a short call/)).toHaveCount(3);
    // No 14-day free trial claim anywhere on the page.
    await expect(page.getByText(/14-day free trial/i)).toHaveCount(0);
  });
});
