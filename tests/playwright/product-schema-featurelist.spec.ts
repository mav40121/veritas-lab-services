// tests/playwright/product-schema-featurelist.spec.ts
//
// Gate 3 step 8 evidence for the product-page SEO build (2026-07-10). /veritascan,
// /veritamap, /veritacomp gained a SoftwareApplication node with a featureList in
// the site-wide JSON-LD, plus a server-rendered crawlable feature block (checked
// separately by scripts/verify-product-feature-blocks.mjs BASE=... curl mode).
//
// Drives a real browser to each page and asserts the product's SoftwareApplication
// node with its featureList is present in the page's JSON-LD graph. Public routes.
//
// Env: PW_BASE (default prod www). Skips (compile-only) in CI when PW_RUN unset.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const CASES = [
  { route: "/veritascan", id: "#veritascan", feature: "168 compliance questions across 10 laboratory domains" },
  { route: "/veritamap", id: "#veritamap", feature: "Filter by specialty and sort by complexity" },
  { route: "/veritacomp", id: "#veritacomp", feature: "Six-method matrix for technical competency" },
];

test.describe("Product pages: SoftwareApplication featureList in schema", () => {
  for (const c of CASES) {
    test(`${c.route} JSON-LD carries the ${c.id} featureList`, async ({ page }) => {
      if (!process.env.PW_RUN) {
        test.skip(true, "PW_RUN not set (compile-only gate run).");
        return;
      }
      await page.goto(`${BASE}${c.route}`, { waitUntil: "domcontentloaded" });
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      const graph = blocks.flatMap((b) => {
        try { const j = JSON.parse(b); return j["@graph"] || [j]; } catch { return []; }
      });
      const node = graph.find((n) => n["@id"] && String(n["@id"]).endsWith(c.id));
      expect(node, `SoftwareApplication ${c.id} node present`).toBeTruthy();
      expect(node.featureList, "featureList present").toContain(c.feature);
    });
  }
});
