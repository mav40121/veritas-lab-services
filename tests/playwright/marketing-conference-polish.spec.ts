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
    // Scope to the hero section so the nav's "Clinical Laboratory Consulting"
    // tagline does not confuse the badge check.
    const hero = page.locator("section").filter({ hasText: "mastering the science" }).first();
    const heroText = await hero.innerText();
    // #3: the product-preview card renders in the hero.
    expect(heroText, "hero shows the product-preview card").toContain("Survey-ready compliance");
    // #2: software identity leads -- the Software Suite badge precedes Consulting.
    const iSoftware = heroText.indexOf("Software Suite");
    const iConsulting = heroText.indexOf("Consulting");
    expect(iSoftware, "Software Suite badge present in hero").toBeGreaterThanOrEqual(0);
    expect(iConsulting, "Consulting badge follows Software Suite").toBeGreaterThan(iSoftware);
  });

  test("pricing: plan prices sit above the payment-methods band", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/pricing`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const clinic = await page.getByText("Clinic", { exact: true }).first().boundingBox();
    const payment = await page.getByText(/We accept credit cards/i).first().boundingBox();
    const founding = await page.getByText(/Founding Lab Program/i).first().boundingBox();
    expect(clinic && payment && founding, "tier, payment band, and founding-lab all present").toBeTruthy();
    expect(clinic!.y, "a plan tier appears above the payment-methods band").toBeLessThan(payment!.y);
    // Raw prices come before the founding-cohort upsell.
    expect(clinic!.y, "the plan tiers appear above the Founding Lab offer").toBeLessThan(founding!.y);
  });
});
