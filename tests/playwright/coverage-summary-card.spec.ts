// tests/playwright/coverage-summary-card.spec.ts
//
// Gate 3 step 8 (browser) evidence for the Coverage summary card promoted to the
// top of the VeritaCheck dashboard. The card (map requires vs. studies on file)
// replaced a buried toolbar button; it must render on the dashboard and its
// "Open Coverage" CTA must navigate to the full Coverage page.
//
// Drives the actual dashboard: asserts the card + CTA render, clicks the CTA,
// and asserts the URL lands on /veritacheck/coverage. Non-mutating, read-only.
// Needs PW_TOKEN (a lab user with a VeritaMap) + PW_LAB_ID; skips otherwise.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck Coverage — dashboard summary card", () => {
  test("card renders and its CTA opens the Coverage page", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/dashboard`, { waitUntil: "domcontentloaded" });

    // The card self-hides until the lab has a map; lab 2 has one, so it renders.
    const card = page.getByTestId("card-coverage-summary");
    await expect(card).toBeVisible({ timeout: 20000 });

    // The card carries the live scope line and the two gap stats.
    await expect(card).toContainText("What your VeritaMap requires");

    // The CTA navigates to the full Coverage page.
    const cta = page.getByTestId("button-open-coverage");
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/veritacheck\/coverage/, { timeout: 15000 });
  });
});
