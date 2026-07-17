// tests/playwright/seo-product-schema.spec.ts
//
// Gate 3 step 8 (browser) evidence for the SEO/GEO product-page work.
//
// This PR ships no clickable element: the change is a <script type="application/
// ld+json"> block in <head> plus server-rendered prose inside #root. So the
// classic step-8 rationale (click timing, popups, blob downloads, redirects)
// does not apply. What DOES need a browser is the thing a verify script cannot
// see: whether the whole @graph actually parses once the page is served and the
// app has hydrated. The graph lives in ONE script tag, so a single malformed
// node does not degrade gracefully, it takes every other node with it, and the
// page still looks perfectly fine to a human.
//
// Two properties asserted per product page:
//   1. the SoftwareApplication node for that product is present in the LIVE DOM
//      and its featureList is a non-empty array (parsed, not string-matched),
//   2. the server-rendered feature block is real text on the page.
//
// The raw pre-JS HTML (what a crawler without JS sees) is checked separately by
// `curl -A Googlebot`, which is the primary receipt. This is the hydrated-DOM
// counterpart: both must hold.
//
// Gated behind PW_SEO_SCHEMA so CI stays compile-only; the content only exists
// once this PR is deployed. Run against prod after deploy.
//
// Env: PW_BASE (default production www), PW_SEO_SCHEMA=1 to actually run.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const PRODUCTS = [
  { route: "/veritapolicy", id: "#veritapolicy", name: "VeritaPolicy", blockText: "pre-loads every policy requirement your accreditor expects" },
  { route: "/veritastaff",  id: "#veritastaff",  name: "VeritaStaff",  blockText: "staff roster, CLIA role assignments, competency scheduling" },
  { route: "/veritacheck",  id: "#veritacheck",  name: "VeritaCheck",  blockText: "performance-verification module" },
  { route: "/veritascan",   id: "#veritascan",   name: "VeritaScan",   blockText: "self-inspection and compliance audit tool" },
  { route: "/veritamap",    id: "#veritamap",    name: "VeritaMap",    blockText: "master regulatory map" },
  { route: "/veritacomp",   id: "#veritacomp",   name: "VeritaComp",   blockText: "competency assessment across all three types" },
];

test.describe("SEO product pages: schema graph + server-rendered feature block", () => {
  test.beforeEach(() => {
    if (!process.env.PW_SEO_SCHEMA) test.skip(true, "Set PW_SEO_SCHEMA=1 to run against a deployed build.");
  });

  for (const p of PRODUCTS) {
    test(`${p.route}: ${p.name} SoftwareApplication node has a featureList`, async ({ page }) => {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded" });

      // Parse every ld+json block on the page the way a crawler would. If the
      // graph is malformed this throws here rather than silently finding nothing.
      const nodes = await page.evaluate(() => {
        const out: any[] = [];
        document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
          const parsed = JSON.parse(s.textContent || "{}");
          const graph = parsed["@graph"];
          if (Array.isArray(graph)) out.push(...graph);
          else out.push(parsed);
        });
        return out;
      });

      const node = nodes.find((n: any) => typeof n["@id"] === "string" && n["@id"].endsWith(p.id));
      expect(node, `${p.name} node ${p.id} present in the parsed graph`).toBeTruthy();
      expect(node["@type"]).toBe("SoftwareApplication");
      expect(Array.isArray(node.featureList), `${p.name} featureList is an array`).toBe(true);
      expect(node.featureList.length, `${p.name} featureList is non-empty`).toBeGreaterThan(0);
      expect(node.url).toBe(`https://www.veritaslabservices.com${p.route}`);
    });

    test(`${p.route}: feature block is real text on the page`, async ({ page }) => {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded" });
      const body = await page.evaluate(() => document.body.innerText);
      expect(body, `${p.route} body contains the feature block copy`).toContain(p.blockText);
    });
  }
});
