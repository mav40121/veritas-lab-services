// tests/playwright/public-article-stale-token.spec.ts
//
// Regression for the 2026-08-24 newsletter incident: the "Read the guide" link
// in the Lab Director's Briefing points at a PUBLIC resource article, but
// recipients holding a stale/expired trial-account token were hard-redirected
// to /login by the global 401 handler (client/src/lib/queryClient.ts), and
// not-onboarded logged-in visitors got the onboarding wizard overlaid
// (OnboardingGuard in client/src/App.tsx). Both read as a forced sign-up on
// public content. The fix: isPublicMarketingPath() suppresses the /login
// bounce, the wizard, and the subscription/onboarding banners on public routes.
//
// Public pages must render for EVERY auth state. Env: PW_BASE (default prod www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ARTICLE = `${BASE}/resources/proficiency-testing-clia-pt-referral`;

test.describe("Public resource article renders regardless of auth state", () => {
  test("anonymous visitor sees the article, no redirect", async ({ page }) => {
    await page.goto(ARTICLE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(page.url()).toContain("/resources/proficiency-testing-clia-pt-referral");
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(body).toContain("Proficiency Testing");
  });

  test("stale/expired token does NOT bounce to /login on a public article", async ({ browser }) => {
    const context = await browser.newContext();
    // Simulate a recipient who once made a trial account: a stale token plus a
    // not-onboarded user snapshot. Before the fix this redirected to /login
    // (401 handler) or overlaid the onboarding wizard.
    await context.addInitScript(() => {
      localStorage.setItem("veritas_token", "stale-invalid-token");
      localStorage.setItem(
        "veritas_user",
        JSON.stringify({
          id: 99011,
          email: "prospect@example.com",
          name: "Prospect",
          plan: "free",
          studyCredits: 0,
          hasCompletedOnboarding: false,
          isSeatUser: false,
        }),
      );
    });
    const page = await context.newPage();
    await page.goto(ARTICLE, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(page.url()).not.toContain("/login");
    expect(page.url()).toContain("/resources/proficiency-testing-clia-pt-referral");
    const body = (await page.textContent("body")) || "";
    expect(body).toContain("Proficiency Testing");
    await context.close();
  });
});
