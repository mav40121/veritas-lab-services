// tests/playwright/veritaassure-policy-card-copy.spec.ts
//
// The public /veritaassure page previously described VeritaPolicy as a
// "TJC Policy Compliance Tracker" that "Tracks all 88 TJC-required laboratory
// policies." VeritaPolicy is CLIA-grounded (42 CFR 493) and crosswalks each
// policy to TJC and CAP (COLA and AABB being verified, BUG-191). This spec asserts the card no longer
// implies TJC-only scope.
//
// Env: PW_BASE (default production www). No auth required; this is a public page.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaAssure page - VeritaDC card (formerly VeritaPolicy)", () => {
  test("VeritaDC card reflects document control + CLIA multi-accreditor scope", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`);
    const body = page.locator("body");
    await expect(body).not.toContainText("TJC Policy Compliance Tracker");
    await expect(body).not.toContainText("88 TJC-required");
    await expect(body).toContainText("VeritaDC");
    await expect(body).toContainText("Formerly VeritaPolicy");
    await expect(body).toContainText("Policy and Document Control");
    await expect(body).toContainText("CLIA (42 CFR 493)");
    // BUG-191 (2026-11-27): our COLA and AABB citations read "being verified" until checked against the source standards.
    await expect(body).toContainText("COLA and AABB citations are being verified");
  });

  test("page does not render retired tier prices (dead PRICING const removed)", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`);
    const body = page.locator("body");
    // The page links out to /pricing and renders no inline prices. These
    // retired tier numbers must never surface here.
    for (const stale of ["$499/yr", "$1,999/yr", "$2,999/yr"]) {
      await expect(body).not.toContainText(stale);
    }
  });
});
