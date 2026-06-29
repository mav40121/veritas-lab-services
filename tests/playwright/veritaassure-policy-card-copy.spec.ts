// tests/playwright/veritaassure-policy-card-copy.spec.ts
//
// The public /veritaassure page previously described VeritaPolicy as a
// "TJC Policy Compliance Tracker" that "Tracks all 88 TJC-required laboratory
// policies." VeritaPolicy is CLIA-grounded (42 CFR 493) and crosswalks each
// policy to CAP, COLA, TJC, and AABB. This spec asserts the card no longer
// implies TJC-only scope.
//
// Env: PW_BASE (default production www). No auth required; this is a public page.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaAssure page — VeritaPolicy card is not TJC-only", () => {
  test("VeritaPolicy card reflects CLIA + multi-accreditor scope", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`);
    const body = page.locator("body");
    await expect(body).not.toContainText("TJC Policy Compliance Tracker");
    await expect(body).not.toContainText("88 TJC-required");
    await expect(body).toContainText("CLIA and Accreditor Policy Tracker");
    await expect(body).toContainText("CAP, COLA, TJC, or AABB");
  });
});
