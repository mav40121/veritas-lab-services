// tests/playwright/resource-article-cfr-citations.spec.ts
//
// Gate 3 step 8 evidence for the resource-article CFR citation fixes.
// A fact-check found two live citation errors on public article pages:
//   1. VeritaCheck-validation cited 42 CFR 493.1251 (Procedure manual) for
//      "establish and verify performance"; correct section is 493.1253.
//   2. CPRT had the director-responsibility complexity labels swapped:
//      493.1407 is moderate-complexity, 493.1445 is high-complexity.
// This asserts the corrected text is live and the wrong text is gone.
//
// Public pages, no auth. Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Resource-article CFR citations are correct", () => {
  test("VeritaCheck-validation cites 493.1253, not 493.1251", async ({ page }) => {
    await page.goto(`${BASE}/resources/how-to-validate-veritacheck-clia`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(body).toContain("493.1253");
    expect(body).not.toContain("493.1251");
  });

  test("CPRT labels 493.1407 moderate and 493.1445 high", async ({ page }) => {
    await page.goto(`${BASE}/resources/cost-per-reportable-test-four-layer-framework`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    // The corrected pairing must be present.
    expect(body).toContain("493.1407 (moderate-complexity testing)");
    expect(body).toContain("493.1445 (high-complexity testing)");
    // The swapped pairing must be gone.
    expect(body).not.toContain("493.1407 (high-complexity testing)");
  });
});
