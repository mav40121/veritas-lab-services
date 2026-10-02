// tests/playwright/seo-brand-entity-aliases.spec.ts
//
// SEO cluster reinforcement: the VeritaAssure brand entity in the site-wide
// JSON-LD @graph must alias the contested commercial queries, and the VeritaScan
// prerender body must carry "laboratory inspection readiness software".
//
// Fetches the RAW SSR HTML (no JS) so this tests what crawlers actually get, and
// parses the @graph for real (a malformed node silently drops the whole block, so
// a string grep is not enough). Env-gated on PW_BASE like the other SEO specs;
// skips without it so the compile-only smoke gate stays green.

import { test, expect, request as pwRequest } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test.describe("SEO brand-entity aliases + inspection-readiness term", () => {
  test("VeritaAssure node aliases the category terms; VeritaScan body has the query", async () => {
    if (!BASE) {
      test.skip(true, "Needs PW_BASE (the deployed/preview origin).");
      return;
    }
    const ctx = await pwRequest.newContext({ extraHTTPHeaders: { "User-Agent": "Googlebot" } });

    // Homepage graph: parse the @graph and read the VeritaAssure node's alternateName.
    const homeHtml = await (await ctx.get(`${BASE}/`)).text();
    const blocks = [...homeHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    let aliases: unknown = null;
    for (const b of blocks) {
      try {
        const j = JSON.parse(b.replace(/\\u003c/g, "<"));
        if (j["@graph"]) {
          const va = j["@graph"].find((n: any) => typeof n["@id"] === "string" && n["@id"].endsWith("#veritaassure"));
          if (va) aliases = va.alternateName;
        }
      } catch { /* a broken block fails the assertion below */ }
    }
    const aliasText = JSON.stringify(aliases).toLowerCase();
    expect(aliasText).toContain("lab compliance software");
    expect(aliasText).toContain("laboratory compliance platform");
    expect(aliasText).toContain("laboratory inspection readiness software");

    // VeritaScan prerender body carries the inspection-readiness query term.
    const vsHtml = await (await ctx.get(`${BASE}/veritascan`)).text();
    expect(vsHtml.toLowerCase()).toContain("laboratory inspection readiness software");

    await ctx.dispose();
  });
});
