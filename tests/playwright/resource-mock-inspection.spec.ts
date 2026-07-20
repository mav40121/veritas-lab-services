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

  test("author authority entity + Article graph connections resolve", async ({ page }) => {
    await page.goto(`${BASE}${SLUG}`, { waitUntil: "networkidle" });
    // Flatten every JSON-LD node on the page into one id->node map. JSON.parse the
    // whole graph, never grep: one bad comma would break the block silently.
    const { byId, article, breadcrumb } = await page.$$eval('script[type="application/ld+json"]', (nodes) => {
      const all: any[] = [];
      for (const n of nodes) {
        try {
          const j = JSON.parse(n.textContent || "{}");
          const arr = Array.isArray(j) ? j : (j["@graph"] ? j["@graph"] : [j]);
          for (const node of arr) if (node && typeof node === "object") all.push(node);
        } catch {}
      }
      const byId: Record<string, any> = {};
      for (const n of all) if (n["@id"]) byId[n["@id"]] = n;
      return {
        byId,
        article: all.find((n) => n["@type"] === "Article") || null,
        breadcrumb: all.find((n) => n["@type"] === "BreadcrumbList") || null,
      };
    });

    // 1. Author authority entity resolves and carries expertise signals.
    const authorId = article?.author?.["@id"];
    expect(authorId, "Article.author is an @id ref").toContain("#michael-veri");
    const person = byId[authorId];
    expect(person, "author @id resolves to a node").toBeTruthy();
    expect(person["@type"]).toBe("Person");
    expect(Array.isArray(person.sameAs) && person.sameAs.some((s: string) => s.includes("linkedin.com/in/michael-veri"))).toBe(true);
    expect((person.knowsAbout || []).length, "knowsAbout").toBeGreaterThanOrEqual(4);
    expect((person.hasCredential || []).length, "hasCredential").toBeGreaterThanOrEqual(4);

    // 2. Article.about references two DefinedTerm ids that both resolve.
    const aboutIds = (article.about || []).map((a: any) => a["@id"]);
    expect(aboutIds.length, "Article.about has two terms").toBe(2);
    for (const id of aboutIds) {
      expect(byId[id], `about ${id} resolves`).toBeTruthy();
      expect(byId[id]["@type"]).toBe("DefinedTerm");
    }

    // 3. mentions point only at the two products the article touches.
    const mentionIds = (article.mentions || []).map((m: any) => m["@id"]);
    expect(mentionIds.some((i: string) => i.includes("#veritascan"))).toBe(true);
    expect(mentionIds.some((i: string) => i.includes("#veritacheck"))).toBe(true);

    // 4. BreadcrumbList parses with three positions.
    expect(breadcrumb, "BreadcrumbList present").toBeTruthy();
    expect((breadcrumb.itemListElement || []).length).toBe(3);
  });
});
