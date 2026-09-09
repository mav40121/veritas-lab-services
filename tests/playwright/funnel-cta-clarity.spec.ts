// tests/playwright/funnel-cta-clarity.spec.ts
//
// Conversion-funnel guards for the CTA-clarity pass:
//  1. /register opens the Create Account tab (not Sign In), so a "Try Free" click
//     lands on the signup form rather than a login wall. Proven by the register-
//     only "Full Name" field being visible.
//  2. The landing hero has a single clear primary (the no-login demo -> /demo) and
//     a commit CTA "Try VeritaCheck Free" that goes to /register (the real free
//     trial), not the /veritacheck marketing page.
//
// Public pages, no auth. Env: PW_BASE (default prod www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Conversion funnel — CTA clarity", () => {
  test("/register opens the Create Account tab straight to the signup form", async ({ page }) => {
    await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    // The Create Account tab must be the active one (was Sign In before this pass).
    await expect(
      page.locator('[role="tab"][data-state="active"]'),
      "the active tab on /register should be Create Account"
    ).toHaveText(/create account/i);
    // The signup FORM is the first step now (no forced lab-type wizard): the
    // name/email/password fields and the free-account framing are visible.
    await expect(page.getByText("Full Name", { exact: false }).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/two free studies/i).first()).toBeVisible();
    // The plan picker is opt-in, not forced.
    await expect(page.getByText(/help me choose/i).first()).toBeVisible();
  });

  test("landing hero: Explore -> /demo, Try VeritaCheck Free -> /register", async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const explore = page.getByRole("link", { name: /Explore VeritaAssure/i }).first();
    await expect(explore).toHaveAttribute("href", "/demo");
    const tryFree = page.getByRole("link", { name: /Try VeritaCheck.*Free/i }).first();
    await expect(tryFree).toHaveAttribute("href", "/register");
    // The old "no login required" promise is preserved as trust microcopy.
    await expect(page.getByText(/no login required/i).first()).toBeVisible();
  });

  test("/veritacheck anonymous hero: Launch -> /register, demo -> /demo/compliance, sign-in kept", async ({ page }) => {
    // The VeritaCheck product page for a logged-out prospect must offer a clean
    // path into the trial, not two buttons that both dead-end at the Sign In
    // wall. Primary "Launch VeritaCheck" now reaches /register (the real free
    // trial, two study credits); a genuine no-login demo replaces the duplicate;
    // sign-in stays available for returning users.
    await page.goto(`${BASE}/veritacheck`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const launch = page.getByRole("link", { name: /Launch VeritaCheck/i }).first();
    await expect(launch).toHaveAttribute("href", "/register");
    const demo = page.getByRole("link", { name: /See the live demo/i }).first();
    await expect(demo).toHaveAttribute("href", "/demo/compliance");
    // Returning-user sign-in path preserved.
    const signin = page.getByRole("link", { name: /^Sign in$/i }).first();
    await expect(signin).toHaveAttribute("href", "/login");
    // The free-trial hook is now visible on the hero.
    await expect(page.getByText(/two studies included/i).first()).toBeVisible();
  });
});
