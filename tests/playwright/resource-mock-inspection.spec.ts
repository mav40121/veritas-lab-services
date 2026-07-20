// tests/playwright/resource-mock-inspection.spec.ts
//
// Gate 3 browser evidence + standing guard for the mock-inspection cornerstone
// article at /resources/tjc-laboratory-inspection-what-to-expect. The page
// renders client-side, so a curl sees only the noscript shell; only a real
// browser load proves the article, FAQ, and JSON-LD render. Gated behind
// PW_MOCK_INSPECTION so CI stays compile-only; run against prod after deploy.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SLUG = "/resources/tjc-laboratory-inspection-what-to-expect";

test.describe("Mock-inspection cornerstone article", () => {
  test.beforeEach(() => {
    if (!process.env.PW_MOCK_INSPECTION) test.skip(true, "Set PW_MOCK_INSPECTION=1 to run against a deployed build.");
  });

  test("article, phases, and FAQ render", async ({ page }) => {
    await page.goto(`${BASE}${SLUG}`, { waitUntil: "networkidle" });
    const body = await page.evaluate(() => document.body.innerText);

    expect(body, "H1").toContain("The Anatomy of a Joint Commission Laboratory Survey");
    expect(body, "thesis").toContain("fail it in private");
    expect(body, "phase content").toContain("Phase 5: Tracers");
    expect(body, "insider beat").toContain("second handoff");
    expect(body, "interval ceiling phrasing").toContain("six months plus twenty days");
    expect(body, "FAQ question").toContain("What is tracer methodology in a laboratory survey?");

    // Copy hygiene: no em dashes on a public page.
    expect(body, "no em dash").not.toContain("—");
  });

  test("Article + FAQPage + HowTo + DefinedTerm JSON-LD are present", async ({ page }) => {
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
    expect(types, "HowTo node").toContain("HowTo");
    expect(types, "DefinedTerm node").toContain("DefinedTerm");
  });
});
