// tests/playwright/resource-internal-links.spec.ts
//
// Gate 3 step 8 for the SEO Item D internal-linking cluster: contextual in-body
// links were added on the first natural occurrence of an anchor phrase (skipping
// anchors already linked or absent). Asserts each source page renders a link to
// its target route.
//
// Run: npx playwright test resource-internal-links

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const LINKS: { path: string; href: string }[] = [
  { path: "/resources/precision-verification-report-interpretation-guide", href: "/resources/calibration-verification-requirements-clia" },
  { path: "/resources/tjc-laboratory-inspection-checklist-preparation", href: "/resources/calibration-verification-requirements-clia" },
  { path: "/resources/how-to-perform-method-comparison-study", href: "/resources/clia-tea-what-lab-directors-dont-know" },
];

test.describe("resource pages carry contextual internal links", () => {
  for (const { path, href } of LINKS) {
    test(`${path} links to ${href}`, async ({ page }) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
    });
  }
});
