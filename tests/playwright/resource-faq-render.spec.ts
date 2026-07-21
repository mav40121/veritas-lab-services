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
  { path: "/resources/cost-per-reportable-test-four-layer-framework", firstQ: "What is cost per reportable test (CPRT)?" },
  { path: "/resources/manual-logs-why-most-labs-should-stop", firstQ: "Why do laboratories use manual logs?" },
  // Batch 5
  { path: "/resources/verifying-reference-intervals", firstQ: "Does CLIA require laboratories to establish reference intervals, or only verify them?" },
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

    // The honest-content guarantee, asserted rather than assumed: every question
    // in the FAQPage node must actually be visible on the page. A FAQPage whose
    // Q&A is not rendered is the policy violation faqContent.ts exists to prevent,
    // and the heading check above cannot catch a partial render.
    test(`${path} renders EVERY question in its FAQPage node`, async ({ page }) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

      const questions = await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
          const parsed = JSON.parse(s.textContent || "{}");
          const graph = parsed["@graph"];
          const blocks = Array.isArray(graph) ? graph : [parsed];
          for (const b of blocks) {
            if ((b as any)?.["@type"] === "FAQPage" && Array.isArray((b as any).mainEntity)) {
              for (const q of (b as any).mainEntity) if (q?.name) out.push(q.name);
            }
          }
        });
        return out;
      });

      expect(questions.length, `${path} has a FAQPage node with questions`).toBeGreaterThan(0);
      const body = await page.evaluate(() => document.body.innerText);
      for (const q of questions) {
        expect(body, `schema question is visible on the page: "${q.slice(0, 60)}"`).toContain(q);
      }
    });
  }
});
