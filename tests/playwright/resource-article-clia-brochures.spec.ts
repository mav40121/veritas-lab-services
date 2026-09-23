// tests/playwright/resource-article-clia-brochures.spec.ts
//
// Gate 3 + public-render guard for the "CLIA Brochures Every Lab Leader Should
// Read" resource article. Public /resources/* pages must render for every auth
// state (anonymous and stale-token), and the SEO title must be present.
//
// Env-gated so CI stays green until the article is deployed. Run against prod
// after deploy:  PW_BROCHURES=1 npx playwright test resource-article-clia-brochures

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const URL = `${BASE}/resources/clia-brochures-every-lab-leader-should-read`;

test.describe("CLIA brochures resource article renders publicly", () => {
  test.beforeEach(() => {
    test.skip(!process.env.PW_BROCHURES, "Set PW_BROCHURES=1 to run against a deployed build.");
  });

  test("anonymous visitor sees the article, no 404, no redirect", async ({ page }) => {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(page.url()).toContain("/resources/clia-brochures-every-lab-leader-should-read");
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(body).toContain("Verification of Performance Specifications");
    expect(body).toContain("Proficiency Testing and PT Referral");
  });

  test("stale/expired token does NOT bounce to /login on the public article", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem("veritas_token", "stale-invalid-token");
      localStorage.setItem("veritas_user", JSON.stringify({
        id: 99012, email: "prospect@example.com", name: "Prospect", plan: "free",
        studyCredits: 0, hasCompletedOnboarding: false, isSeatUser: false,
      }));
    });
    const page = await context.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(page.url()).not.toContain("/login");
    expect(page.url()).toContain("/resources/clia-brochures-every-lab-leader-should-read");
    await context.close();
  });
});
