// tests/playwright/tea-rule-designation.spec.ts
//
// Gate 3 receipt + regression guard for the 2026-06-14 CLIA TEa rule-designation
// fix (PR #762). The TEa content called the proficiency-testing acceptable-
// performance rule the "2025 CLIA Final Rule" — a rule that does not exist by
// that name. Corrected to its real designation: CMS-3355-F (effective July 11,
// 2024; lab implementation January 1, 2025). NOTE this is NOT CMS-3326-F, the
// separate personnel/histocompatibility/sanctions rule effective Dec 28, 2024.
//
// Asserts the corrected designation is present and the misnomer is gone on the
// two customer-facing TEa pages. Logged-out, no creds.
//
// Run: npx playwright test tea-rule-designation

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const PAGES = [
  "/resources/clia-tea-what-lab-directors-dont-know",
  "/resources/clia-tea-lookup",
];

test.describe("TEa pages: correct CLIA rule designation (CMS-3355-F)", () => {
  for (const path of PAGES) {
    test(`${path} cites CMS-3355-F, not the "2025 CLIA Final Rule" misnomer`, async ({ page }) => {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const body = await page.locator("body").innerText();
      expect(body).toContain("CMS-3355-F");
      expect(body).not.toContain("2025 CLIA Final Rule");
    });
  }
});
