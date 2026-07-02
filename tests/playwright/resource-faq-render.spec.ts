// tests/playwright/resource-faq-render.spec.ts
//
// Gate 3 step 8 for the SEO Item A Layer 2 change: 7 resource pages now render a
// visible "Frequently Asked Questions" section sourced from the single-source
// client/src/lib/faqContent.ts (the same arrays that build the FAQPage JSON-LD).
// Asserts the heading and the first question render on the live page, so the
// visible content matches the structured data (Google FAQ / honest-content).
//
// Run: npx playwright test resource-faq-render
//      PW_BASE=http://127.0.0.1:4173 npx playwright test resource-faq-render

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const ROUTES: { path: string; firstQ: string }[] = [
  { path: "/resources/clia-tea-lookup", firstQ: "What is CLIA total allowable error (TEa)?" },
  { path: "/resources/calibration-verification-requirements-clia", firstQ: "How often is calibration verification required under CLIA?" },
  { path: "/resources/how-to-perform-method-comparison-study", firstQ: "When is a method comparison study required?" },
  { path: "/resources/precision-verification-report-interpretation-guide", firstQ: "Why is precision verification required?" },
  { path: "/resources/tjc-laboratory-inspection-checklist-preparation", firstQ: "How does a TJC laboratory survey work?" },
  { path: "/resources/cost-per-reportable-test-four-layer-framework", firstQ: "What is cost per reportable test (CPRT)?" },
  { path: "/resources/manual-logs-why-most-labs-should-stop", firstQ: "Why do laboratories use manual logs?" },
];

test.describe("resource pages render a visible FAQ section matching the schema", () => {
  for (const { path, firstQ } of ROUTES) {
    test(`${path} shows Frequently Asked Questions + first question`, async ({ page }) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      await expect(
        page.getByRole("heading", { name: "Frequently Asked Questions" }),
      ).toBeVisible();
      await expect(page.getByText(firstQ, { exact: false }).first()).toBeVisible();
    });
  }
});
