// tests/playwright/copy-hygiene-emdash.spec.ts
//
// Gate 3 step 8 evidence for the em-dash copy-hygiene cleanup (2026-07-09, SEO
// agent package item 3). CLAUDE.md Section 3 bans em dashes in public-facing
// copy. Removed live em dashes from the precision-interpretation article's
// reference list + its ANOVA lede, and from the /demo/cprt and /demo/qc useSEO
// titles. The {val || "-"} empty-value placeholders and code comments were left
// alone by design.
//
// Drives a real browser to the three public routes and asserts the corrected,
// customer-visible copy carries no em dash.
//
// Env: PW_BASE (default prod www). Skips (compile-only) in CI when PW_RUN unset.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const EM_DASH = "—";

test.describe("Copy hygiene: no em dashes in the cleaned public copy", () => {
  test("precision article reference labels use colons, not em dashes", async ({ page }) => {
    if (!process.env.PW_RUN) {
      test.skip(true, "PW_RUN not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/resources/precision-verification-report-interpretation-guide`, { waitUntil: "networkidle" });
    // The reference block should now read "CLSI EP15-A3: User Verification ..." etc.
    await expect(page.getByText(/CLSI EP15-A3: User Verification of Precision/)).toBeVisible();
    const refText = await page.getByText(/Association for Diagnostic and Laboratory Medicine/).textContent();
    expect(refText || "").not.toContain(EM_DASH);
  });

  test("/demo/cprt and /demo/qc titles carry no em dash", async ({ page }) => {
    if (!process.env.PW_RUN) {
      test.skip(true, "PW_RUN not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/demo/cprt`, { waitUntil: "networkidle" });
    expect(await page.title()).not.toContain(EM_DASH);
    expect(await page.title()).toMatch(/CPRT Demo: Cost Per Reportable Test/);

    await page.goto(`${BASE}/demo/qc`, { waitUntil: "networkidle" });
    expect(await page.title()).not.toContain(EM_DASH);
    expect(await page.title()).toMatch(/Demo: Westgard QC/);
  });
});
