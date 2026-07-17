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
  // Batch 3
  { route: "/veritatrack",  id: "#veritatrack",  name: "VeritaTrack",  blockText: "replaces the binders and clipboards" },
  { route: "/veritapt",     id: "#veritapt",     name: "VeritaPT",     blockText: "tracks proficiency testing enrollment, survey results, and corrective actions" },
  { route: "/veritalab",    id: "#veritalab",    name: "VeritaLab",    blockText: "centralized storage for a laboratory's accreditation certificates" },
  { route: "/veritastock",  id: "#veritastock",  name: "VeritaStock",  blockText: "burn-rate par levels, lead-time-aware reorder alerts" },
];

// Batch 4. Two hub pages, neither of them a PRODUCTS row:
//   /veritaassure IS the suite, so (a) its node correctly has no isPartOf and
//     (b) its url is the site ROOT, not /veritaassure. A PRODUCTS row would
//     assert url === ".../veritaassure" and fail on a correct page.
//   /operations has no node at all: prerender only, hub not product.
const SUITE = {
  route: "/veritaassure",
  id: "#veritaassure",
  name: "VeritaAssure",
  url: "https://www.veritaslabservices.com/",
  features: 10,
  blockText: "unites performance verification, inspection readiness, test menu mapping",
};
const HUB = {
  route: "/operations",
  name: "Operations",
  blockText: "The operations stream of the VeritaAssure",
};

// /veritabench is absent on purpose, and NOT because VeritaBench is missing:
// VeritaBench's page is /calculator, which has shipped a block since batch 1.
// /veritabench is a legacy slug rendering VeritaPace (h1, useSEO title and hero
// all say VeritaPace), so no VeritaBench identity belongs there. See
// scripts/verify-seo-product-prerender.mjs Case 4b, which pins both halves.

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

test.describe("SEO hub pages: the suite node and the operations hub", () => {
  test.beforeEach(() => {
    if (!process.env.PW_SEO_SCHEMA) test.skip(true, "Set PW_SEO_SCHEMA=1 to run against a deployed build.");
  });

  const parseGraph = (page: any) =>
    page.evaluate(() => {
      const out: any[] = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
        const parsed = JSON.parse(s.textContent || "{}");
        const graph = parsed["@graph"];
        if (Array.isArray(graph)) out.push(...graph);
        else out.push(parsed);
      });
      return out;
    });

  test(`${SUITE.route}: suite node carries a ${SUITE.features}-entry featureList and no isPartOf`, async ({ page }) => {
    await page.goto(`${BASE}${SUITE.route}`, { waitUntil: "domcontentloaded" });
    const nodes = await parseGraph(page);

    const node = nodes.find((n: any) => typeof n["@id"] === "string" && n["@id"].endsWith(SUITE.id));
    expect(node, `${SUITE.name} node present in the parsed graph`).toBeTruthy();
    expect(node["@type"]).toBe("SoftwareApplication");
    expect(node.featureList.length, `${SUITE.name} featureList entry count`).toBe(SUITE.features);
    // It IS the suite: the ten product nodes are isPartOf it, so it is isPartOf
    // nothing. "Add isPartOf like its siblings" is the obvious wrong edit here.
    expect(node.isPartOf, `${SUITE.name} has no isPartOf`).toBeUndefined();
    // Its url is the site root, unlike every product node.
    expect(node.url).toBe(SUITE.url);
  });

  test(`${SUITE.route}: the ten product nodes are still intact alongside it`, async ({ page }) => {
    // The control pattern that proved batch 3 added nodes without disturbing the
    // existing ones. Batch 4 edits this same graph, so it earns the same check.
    await page.goto(`${BASE}${SUITE.route}`, { waitUntil: "domcontentloaded" });
    const nodes = await parseGraph(page);
    const apps = nodes.filter((n: any) => n["@type"] === "SoftwareApplication");
    expect(apps.length, "ten product nodes plus the suite node").toBe(PRODUCTS.length + 1);
    for (const p of PRODUCTS) {
      const n = nodes.find((x: any) => typeof x["@id"] === "string" && x["@id"].endsWith(p.id));
      expect(n, `${p.name} node survived the batch-4 edit`).toBeTruthy();
      expect(n.featureList.length, `${p.name} featureList survived`).toBeGreaterThan(0);
    }
  });

  for (const p of [SUITE, HUB]) {
    test(`${p.route}: feature block is real text on the page`, async ({ page }) => {
      await page.goto(`${BASE}${p.route}`, { waitUntil: "domcontentloaded" });
      const body = await page.evaluate(() => document.body.innerText);
      expect(body, `${p.route} body contains the block copy`).toContain(p.blockText);
    });
  }

  test(`${HUB.route}: hub stays out of the graph (no #operations node)`, async ({ page }) => {
    await page.goto(`${BASE}${HUB.route}`, { waitUntil: "domcontentloaded" });
    const nodes = await parseGraph(page);
    const hub = nodes.find((n: any) => typeof n["@id"] === "string" && n["@id"].endsWith("#operations"));
    expect(hub, "/operations is a hub, not a product: prerender only").toBeUndefined();
  });
});
