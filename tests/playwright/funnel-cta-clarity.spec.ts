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
  test("/register defaults to the Create Account (signup) tab", async ({ page }) => {
    await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    // The register form has a "Full Name" field that the login form does not.
    await expect(
      page.getByText("Full Name", { exact: false }).first(),
      "register tab (Full Name field) should be active on /register"
    ).toBeVisible({ timeout: 8000 });
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
});
