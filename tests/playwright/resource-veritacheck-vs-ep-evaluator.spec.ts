// tests/playwright/resource-veritacheck-vs-ep-evaluator.spec.ts
//
// Gate 3 step 8 browser evidence + standing guard for the comparison page at
// /resources/veritacheck-vs-ep-evaluator. The page renders client-side, so a
// curl sees only the noscript shell; only a real browser load proves the hero,
// Key Takeaways, comparison table, trademark footer, FAQ, and JSON-LD render.
// Gated behind PW_EPEVAL_COMPARE so CI stays compile-only; run against prod
// after deploy:
//   PW_EPEVAL_COMPARE=1 PW_BASE=https://www.veritaslabservices.com \
//     npx playwright test tests/playwright/resource-veritacheck-vs-ep-evaluator.spec.ts

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SLUG = "/resources/veritacheck-vs-ep-evaluator";

test.describe("VeritaCheck vs EP Evaluator comparison page", () => {
  test.beforeEach(() => {
    if (!process.env.PW_EPEVAL_COMPARE) test.skip(true, "Set PW_EPEVAL_COMPARE=1 to run against a deployed build.");
  });

  test("hero, comparison, trademark footer, and FAQ render", async ({ page }) => {
    await page.goto(`${BASE}${SLUG}`, { waitUntil: "networkidle" });
    const body = await page.evaluate(() => document.body.innerText);

    expect(body, "H1").toContain("VeritaCheck vs EP Evaluator");
    expect(body, "shared-studies takeaway").toContain("Both run the core CLSI verification studies");
    expect(body, "whole-menu claim (Legal wording)").toContain("does not provide a whole-menu coverage view");
    expect(body, "comparison table cell").toContain("About 30 statistical modules");
    expect(body, "trademark footer").toContain("trademarks of Data Innovations, LLC");
    expect(body, "FAQ question").toContain("Is VeritaCheck an alternative to EP Evaluator?");

    // Guardrail: the cleared claims only (no disallowed CLSI/report negative).
    expect(body, "no 'lacks CLSI' claim").not.toContain("lacks CLSI");

    // Copy hygiene: no em dashes on a public page.
    expect(body, "no em dash").not.toContain("—");
  });

  test("Article + FAQPage + BreadcrumbList JSON-LD are present", async ({ page }) => {
    await page.goto(`${BASE}${SLUG}`, { waitUntil: "networkidle" });
    const types = await page.$$eval('script[type="application/ld+json"]', (nodes) => {
      const out: string[] = [];
      for (const n of nodes) {
        try {
          const j = JSON.parse(n.textContent || "{}");
          const arr = Array.isArray(j) ? j : (j["@graph"] ? j["@graph"] : [j]);
          for (const node of arr) if (node && node["@type"]) out.push(String(node["@type"]));
        } catch {}
      }
      return out;
    });
    expect(types, "Article node").toContain("Article");
    expect(types, "FAQPage node").toContain("FAQPage");
    expect(types, "BreadcrumbList node").toContain("BreadcrumbList");
  });
});
