// tests/playwright/tea-pages-mobile-no-overflow.spec.ts
//
// Gate 3 receipt + permanent regression guard for the 2026-06-14 TEa-pages
// mobile fix. A headless sweep of all public routes at 390px found two more
// instances of the same horizontal-overflow class already fixed on the homepage
// and VeritaCheck:
//   - /resources/clia-tea-what-lab-directors-dont-know  (+19px): the
//     "Search All … Analytes" CTA inherited the shadcn button base
//     `whitespace-nowrap`, so its long label could not wrap. Fixed with
//     whitespace-normal h-auto max-w-full text-center (same fix as the homepage
//     Training CTA).
//   - /resources/clia-tea-lookup  (+102px): each result row's TEa value cell was
//     `text-right shrink-0`; a long criteria string (e.g. CK-MB) refused to
//     shrink at mobile width and pushed the row past the viewport. Fixed by
//     stacking the row on mobile (flex-col) and scoping text-right/shrink-0 to
//     sm:+ so the desktop layout is unchanged.
//
// The same PR also corrected stale "76+ analytes" copy to the live count, which
// is now derived from teaData.length so it never goes stale again.
//
// Asserts (logged-out, no creds): no horizontal scroll at three mobile widths,
// the live analyte count renders, and the "76+" misnomer is gone.
//
// Run: npx playwright test tea-pages-mobile-no-overflow
//      PW_BASE=http://127.0.0.1:4173 npx playwright test tea-pages-mobile-no-overflow

import { test, expect } from "@playwright/test";
import { teaData } from "../../client/src/lib/cliaTeaData";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const PAGES = [
  "/resources/clia-tea-what-lab-directors-dont-know",
  "/resources/clia-tea-lookup",
];

test.describe("TEa pages: no horizontal overflow at mobile widths", () => {
  for (const path of PAGES) {
    for (const width of [360, 390, 414]) {
      test(`${path} has no horizontal scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test(`${path} shows the live analyte count, not the stale "76+"`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body).toContain(`${teaData.length}`);
      expect(body).not.toContain("76+");
    });
  }
});
