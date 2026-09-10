// tests/playwright/resource-pt-article-seo.spec.ts
//
// SSR SEO guard for the Proficiency Testing resource article. The article route
// (/resources/proficiency-testing-clia-pt-referral) renders a complete article
// client-side, but its slug was missing from server/seo-metadata.ts, so the
// server served the generic index shell: crawlers and link-preview scrapers got
// "VeritaAssure Lab Compliance Software" as the title instead of the article's
// own. useSEO fixes the title only AFTER the client JS runs, so a browser test
// would not catch this; the fix and this guard are at the raw-HTML (SSR) layer.
//
// Public, no auth, no JS execution (request fixture). Runs in the BLOCKING
// public gate against a fresh local build, where server/static.ts injects the
// title for routes present in seoMetadataMap.

import { test, expect } from "@playwright/test";

test.describe("PT resource article: server-injected SEO title", () => {
  test("SSR title is the article's own, not the generic shell", async ({ request }) => {
    const res = await request.get("/resources/proficiency-testing-clia-pt-referral");
    expect(res.ok(), "route responds 2xx").toBeTruthy();
    const html = await res.text();
    const m = html.match(/<title>([^<]*)<\/title>/i);
    expect(m, "HTML has a <title>").toBeTruthy();
    const title = (m ? m[1] : "").trim();
    expect(title, `SSR title should be the PT article title (got: ${title})`).toContain("Proficiency Testing Under CLIA");
    expect(title, "SSR title must not be the generic VeritaAssure shell").not.toMatch(/^VeritaAssure/i);
  });
});
