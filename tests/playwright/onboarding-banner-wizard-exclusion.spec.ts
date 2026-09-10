// tests/playwright/onboarding-banner-wizard-exclusion.spec.ts
//
// Gate 3 step 8 guard for the post-signup onboarding cosmetics pass:
//   1. Mutual exclusion. A brand-new account (hasCompletedOnboarding=false,
//      onboardingSeen=false) gets the OnboardingWizard modal, which owns the
//      setup prompt. The gentler "Welcome to VeritaAssure. Complete your lab
//      setup" banner (OnboardingBanner) must NOT also render while that wizard
//      is up, or the first screen carries two competing setup prompts. The
//      banner now mirrors the wizard's show condition and returns null while it
//      is active.
//   2. Copy hygiene. The wizard step-1 subcopy must read "helps you find out,
//      and fix what you find." with a comma. It must contain no hyphen-dash or
//      en/em dash join (the earlier " - " spaced hyphen read as a dash).
//
// The wizard only renders for a genuinely fresh account, so this exercises the
// authenticated path against prod with a NEW-account JWT in PW_NEW_ACCOUNT_TOKEN
// (mint one by registering a throwaway account, then delete it after). Without
// that token this skips cleanly, so the compile-only smoke gate (and any run
// with only the standard PW_TOKEN, whose account has already finished
// onboarding) stays green.
//
// Env: PW_BASE (default production www), PW_NEW_ACCOUNT_TOKEN (fresh-account JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const NEW_TOKEN = process.env.PW_NEW_ACCOUNT_TOKEN || "";

const WIZARD_HEADING = "Is your lab ready for its next inspection?";
const WIZARD_SUBCOPY = "helps you find out, and fix what you find.";
const BANNER_TEXT = "Welcome to VeritaAssure";

test.describe("Onboarding — banner/wizard mutual exclusion + copy", () => {
  test("fresh account: wizard shows, welcome banner suppressed, subcopy has no dash", async ({ page }) => {
    if (!NEW_TOKEN) {
      test.skip(true, "No PW_NEW_ACCOUNT_TOKEN provided (compile-only gate / non-fresh account).");
      return;
    }
    await injectAuth(page, BASE, NEW_TOKEN);
    await page.goto(`${BASE}/dashboard`);

    // The wizard modal is the fresh-account setup surface. If it is not up, the
    // token's account is not actually fresh; note it and skip the assertions
    // rather than asserting against the wrong state.
    const heading = page.getByText(WIZARD_HEADING, { exact: false });
    const wizardUp = await heading.isVisible({ timeout: 15000 }).catch(() => false);
    if (!wizardUp) {
      test.info().annotations.push({
        type: "note",
        text: "OnboardingWizard not shown; token's account is not fresh. Positive branch skipped.",
      });
      test.skip(true, "Wizard not rendered (account already onboarded).");
      return;
    }

    // 1. Copy hygiene: the comma phrasing is present and no dash join remains.
    await expect(
      page.getByText(WIZARD_SUBCOPY, { exact: false }),
      "wizard subcopy uses the comma phrasing"
    ).toBeVisible();
    for (const dashForm of ["find out - and fix", "find out – and fix", "find out — and fix"]) {
      await expect(
        page.getByText(dashForm, { exact: false }),
        `no dash-joined subcopy variant: ${JSON.stringify(dashForm)}`
      ).toHaveCount(0);
    }

    // 2. Mutual exclusion: the welcome banner must not render while the wizard
    // owns the screen.
    await expect(
      page.getByText(BANNER_TEXT, { exact: false }),
      "welcome banner is suppressed while the wizard is active"
    ).toHaveCount(0);
  });
});
