// tests/playwright/marketing-conference-polish.spec.ts
//
// Guards for the pre-conference marketing polish (2026-09-10):
//  1. Homepage hero leads with the software identity (Software Suite badge before
//     the Consulting badge) and shows a product-preview card so a visitor sees
//     what the software does above the fold.
//  2. Pricing page surfaces the plan prices right below the hero: the tier cards
//     now appear ABOVE the payment-methods logistics band, which was moved down.
//
// Public pages, no auth. Runs against prod (PW_BASE); the assertions reflect the
// deployed state, so they pass once this ships.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Pre-conference marketing polish", () => {
  test("homepage hero: software-first badges + product preview card", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    // Product-preview card copy is present (desktop card).
    await expect(page.getByText(/Survey-ready compliance, in one view/i).first()).toBeVisible();
    // Software-first: the "Software Suite" badge sits before "Consulting".
    const sw = await page.getByText("Software Suite", { exact: true }).first().boundingBox();
    const cons = await page.getByText("Consulting", { exact: true }).first().boundingBox();
    expect(sw && cons, "both hero badges present").toBeTruthy();
    expect((sw!.x), "Software Suite badge is left of Consulting").toBeLessThan(cons!.x + 5);
  });

  test("pricing: plan prices sit above the payment-methods band", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const clinic = await page.getByText("Clinic", { exact: true }).first().boundingBox();
    const payment = await page.getByText(/We accept credit cards/i).first().boundingBox();
    expect(clinic && payment, "tier + payment band both present").toBeTruthy();
    expect(clinic!.y, "a plan tier appears above the payment-methods band").toBeLessThan(payment!.y);
  });
});
