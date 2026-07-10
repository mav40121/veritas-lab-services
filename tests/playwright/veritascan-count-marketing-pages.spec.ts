// tests/playwright/veritascan-count-marketing-pages.spec.ts
//
// Gate 3 step 8 evidence for the VeritaScan count sweep (2026-07-10). The first
// count fix (#982) missed several public marketing pages that also advertised the
// stale "168". These are all PUBLIC (no auth), so this runs live against PW_BASE
// and asserts none of them still show a 168 item-count.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const PAGES = ["/veritaassure", "/roadmap", "/book", "/demo/compliance"];

test.describe("VeritaScan count is 173 (not 168) across public marketing pages", () => {
  for (const route of PAGES) {
    test(`${route} shows no stale 168 item-count`, async ({ page }) => {
      await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body).not.toContain("168 compliance");
      expect(body).not.toContain("168-item");
      expect(body).not.toContain("168 items");
      expect(body).not.toContain("168 standards");
    });
  }
});
