// tests/playwright/tea-seo.spec.ts
//
// Gate 3 receipt + regression guard for the 2026-06-14 CLIA TEa SEO pass:
// shortened title (no misleading year), synced description, and a per-route
// Article JSON-LD injected server-side by server/static.ts alongside the
// site-wide @graph in index.html.
//
// Run: npx playwright test tea-seo

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const URL = `${BASE}/resources/clia-tea-what-lab-directors-dont-know`;

test.describe("CLIA TEa page: SEO metadata + Article schema", () => {
  test("title is the shortened SEO title", async ({ page }) => {
    await page.goto(URL, { waitUntil: "networkidle" });
    expect(await page.title()).toContain("CLIA Total Allowable Error (TEa): 42 CFR §493 Guide");
  });

  test("Article JSON-LD is present and well-formed", async ({ page }) => {
    await page.goto(URL, { waitUntil: "networkidle" });
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    const article = blocks
      .map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean)
      .find((j) => j["@type"] === "Article");
    expect(article, "an Article JSON-LD block should be present").toBeTruthy();
    expect(article.headline).toContain("CLIA Allowable Error (TEa)");
    expect(article.mainEntityOfPage).toContain("/resources/clia-tea-what-lab-directors-dont-know");
  });
});
