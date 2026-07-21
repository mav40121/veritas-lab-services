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

const CORNERSTONE = "/resources/tjc-laboratory-inspection-what-to-expect";

const LINKS: { path: string; href: string }[] = [
  { path: "/resources/precision-verification-report-interpretation-guide", href: "/resources/calibration-verification-requirements-clia" },
  { path: "/resources/how-to-perform-method-comparison-study", href: "/resources/clia-tea-what-lab-directors-dont-know" },
  // Mock-inspection cornerstone cluster: three contextual links out of the
  // cornerstone, one link into it from each of the four hub-feeder articles.
  { path: CORNERSTONE, href: "/resources/quality-control-testing-into-compliance" },
  { path: CORNERSTONE, href: "/resources/clia-calibration-verification-method-comparison" },
  { path: CORNERSTONE, href: "/resources/verifying-reference-intervals" },
  { path: "/resources/quality-control-testing-into-compliance", href: CORNERSTONE },
  { path: "/resources/clia-calibration-verification-method-comparison", href: CORNERSTONE },
  { path: "/resources/verifying-reference-intervals", href: CORNERSTONE },
  { path: "/resources/ep26-reagent-lot-verification", href: CORNERSTONE },
];

test.describe("resource pages carry contextual internal links", () => {
  for (const { path, href } of LINKS) {
    test(`${path} links to ${href}`, async ({ page }) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await expect(page.locator(`a[href="${href}"]`).first()).toBeVisible();
    });
  }
});
