// tests/playwright/veritacheck-mobile-no-overflow.spec.ts
//
// Gate 3 receipt + permanent regression guard for the 2026-06-14 VeritaCheck
// mobile-overflow pass.
//
// Bug: at 390px the public /veritacheck page scrolled horizontally 327px. A
// headless DOM walk found three non-clipped page-wideners, all in
// VeritaCheckPage.tsx:
//   1. the "Study Guide: Which study do I need?" pill-link (inline-flex, no wrap)
//   2. the segmented study-type tab bar (4 nowrap pills, ~592px wide)
//   3. the action-button row (Save Draft + Run Study & Generate Report)
// Fixes: the row wrappers stack on mobile (flex-col sm:flex-row), the tab bar
// scrolls horizontally (max-w-full overflow-x-auto), the link wraps
// (max-w-full flex-wrap), and the action buttons stack full-width on mobile.
//
// Same shape as homepage-mobile-no-overflow.spec.ts: measures
// scrollWidth - clientWidth against the live page; logged-out, no creds.
//
// Run: npx playwright test veritacheck-mobile-no-overflow

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaCheck: no horizontal overflow at mobile widths", () => {
  for (const width of [360, 390, 414]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/veritacheck`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
