// tests/playwright/brand-images-and-price.spec.ts
// Gate 3 for the quick-wins change: the previously-missing social share image and
// favicon now exist and serve as real PNGs (they used to return the SPA HTML shell),
// and the sitewide JSON-LD "Full Suite - Clinic" offer shows the correct $999, not
// the stale $499. Passes once this change is deployed to prod.
//
// Run: npx playwright test brand-images-and-price
//      PW_BASE=http://127.0.0.1:4173 npx playwright test brand-images-and-price

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("brand images + corrected pricing schema", () => {
  for (const path of ["/og-image.png", "/favicon.png"]) {
    test(`${path} serves a real PNG`, async ({ request }) => {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
      const body = await res.body();
      // PNG magic number: 89 50 4E 47
      expect(body.subarray(0, 4).toString("hex")).toBe("89504e47");
    });
  }

  test("homepage JSON-LD Clinic offer is $999, not the stale $499", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const m = html.match(/"Full Suite - Clinic"[\s\S]{0,120}?"price":\s*"([\d.]+)"/);
    expect(m, "Full Suite - Clinic offer block not found").not.toBeNull();
    expect(m![1]).toBe("999.00");
  });
});
