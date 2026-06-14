// tests/playwright/homepage-mobile-no-overflow.spec.ts
//
// Gate 3 receipt + permanent regression guard for the 2026-06-14 homepage
// mobile-overflow fix.
//
// Bug: at 390px the homepage scrolled horizontally 136px. A headless DOM walk
// pinned the sole non-clipped page-widener to the Training-section CTA button
// ("Read: How VeritaAssure Trains the Next Generation of Lab Leaders"). It
// inherits the shadcn button base `whitespace-nowrap`, so the long label could
// not wrap and rendered the <a> ~510px wide, forcing the document to 526px.
// Fix lets that button wrap (h-auto, max-w-full, whitespace-normal), bounding
// it to its container.
//
// This spec also confirms the no-PHI trust block (shipped in the same PR)
// renders on the homepage.
//
// Same shape as navbar-no-overflow.spec.ts: measures
// scrollWidth - clientWidth against the live homepage; logged-out, no creds.
//
// Run: npx playwright test homepage-mobile-no-overflow
//      PW_BASE=http://localhost:5000 npx playwright test homepage-mobile-no-overflow

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Homepage: no horizontal overflow at mobile widths", () => {
  // 360 (small Android), 390 (iPhone 12/13/14 — where the LinkedIn leads land),
  // 414 (iPhone Plus). 390 is the width the 136px overflow was measured at.
  for (const width of [360, 390, 414]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test("no-PHI trust block renders", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await expect(page.getByText("We never store PHI. By design.")).toBeVisible();
  });
});
