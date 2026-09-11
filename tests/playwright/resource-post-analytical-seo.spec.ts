// tests/playwright/resource-post-analytical-seo.spec.ts
//
// SSR SEO guard for the Post-Analytical ("The Last Mile") resource article,
// published 2026-09-10. Same class of protection as the PT article guard: the
// article renders client-side, but its server-injected <title> must be its own,
// not the generic VeritaAssure shell (a missing seoMetadataMap entry serves the
// shell and drops the page from the sitemap). useSEO fixes the tab title only
// after client JS, so a browser test would pass on a broken page; this checks
// the raw-HTML (SSR) layer.
//
// Public, no auth. Runs in the BLOCKING public gate against a fresh local build.

import { test, expect } from "@playwright/test";

test.describe("Post-Analytical resource article: server-injected SEO title", () => {
  test("SSR title is the article's own, not the generic shell", async ({ request }) => {
    const res = await request.get("/resources/post-analytical-critical-values-corrected-reports");
    expect(res.ok(), "route responds 2xx").toBeTruthy();
    const html = await res.text();
    const m = html.match(/<title>([^<]*)<\/title>/i);
    expect(m, "HTML has a <title>").toBeTruthy();
    const title = (m ? m[1] : "").trim();
    expect(title, `SSR title should be the Post-Analytical article title (got: ${title})`).toContain("Post-Analytical Last Mile");
    expect(title, "SSR title must not be the generic VeritaAssure shell").not.toMatch(/^VeritaAssure/i);
  });
});
