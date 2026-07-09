// tests/playwright/study-guide-manual-diff.spec.ts
//
// Gate 3 step 8 (browser) evidence for adding the Manual Differential (Rümke /
// CLSI H20) study type to the public Study Guide page (/study-guide). The guide
// documents the study types VeritaCheck supports; it previously said "ten" and
// omitted the Rümke manual-differential study shipped this cycle.
//
// The Study Guide is a public, unauthenticated page, so no token is needed. The
// drive is gated behind PW_SG_DRIVE so playwright-smoke stays compile-only in CI
// (no false green, no network) and runs for real locally / on prod.
//
// Env: PW_BASE (default production www), PW_SG_DRIVE (unset in CI).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Study Guide: Manual Differential (Rümke) study type", () => {
  test("guide lists the Manual Differential study type", async ({ page }) => {
    if (!process.env.PW_SG_DRIVE) {
      test.skip(true, "PW_SG_DRIVE not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/study-guide`, { waitUntil: "networkidle" });

    // Hero now says eleven study types (was ten before manual_diff).
    await expect(page.getByText(/eleven study types supported by VeritaCheck/i)).toBeVisible();

    // At-a-glance table row + detailed card both surface the Rümke study.
    const rumke = page.getByText(/Manual Differential \(R.mke/i);
    await expect(rumke.first()).toBeVisible();

    // The card cites CLSI H20 and 42 CFR §493.1281.
    await expect(page.getByText(/CLSI H20/i).first()).toBeVisible();
    await expect(page.getByText(/§493\.1281/).first()).toBeVisible();
  });
});
