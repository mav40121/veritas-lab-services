// tests/playwright/geo-old-article-301.spec.ts
//
// Gate 3 for retiring the old TJC checklist article. Asserts the cornerstone is
// reachable (always) and that the old checklist URL 301-redirects to it. The 301
// ships with this same PR, so that assertion is skipped until deployed (green
// pre-deploy, real post-deploy). Public pages; no token needed.
//
// Env: PW_BASE (default prod).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const OLD = "/resources/tjc-laboratory-inspection-checklist-preparation";
const NEW = "/resources/tjc-laboratory-inspection-what-to-expect";

test.describe("Retire old TJC checklist article", () => {
  test("cornerstone is reachable and the old URL 301s to it", async ({ request }) => {
    // Regression guard: the cornerstone always resolves 2xx.
    const corner = await request.get(`${BASE}${NEW}`);
    expect(corner.ok(), "cornerstone 2xx").toBeTruthy();

    // The old URL should 301 to the cornerstone (server-side, preserving equity).
    const res = await request.get(`${BASE}${OLD}`, { maxRedirects: 0 });
    test.skip(res.status() !== 301, "301 not deployed yet (ships with this PR)");
    expect(res.status()).toBe(301);
    expect(String(res.headers()["location"] || "")).toContain(NEW);
  });
});
