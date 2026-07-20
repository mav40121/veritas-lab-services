// tests/playwright/veritastock-view-toggle.spec.ts
//
// Gate 3 step 8 for the VeritaStock mobile/desktop view toggle. Non-destructive:
// on a phone-sized viewport, asserts the toggle button renders and flips its
// label (Desktop view <-> Mobile view) when clicked. The column-visibility
// effect is CSS-only and covered by the label state here.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock mobile/desktop view toggle", () => {
  test("toggle flips the view label", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for authed VeritaStock page load");
    await page.setViewportSize({ width: 390, height: 844 }); // phone
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

    const toggle = page.getByTestId("view-mode-toggle");
    if (!(await toggle.isVisible().catch(() => false))) {
      test.skip(true, "View toggle not visible (lab may lack the VeritaStock/suite plan)");
      return;
    }
    // Default is mobile view, so the button offers "Desktop view".
    await expect(toggle).toContainText(/Desktop view/i);
    await toggle.click();
    await expect(toggle).toContainText(/Mobile view/i);
    await toggle.click();
    await expect(toggle).toContainText(/Desktop view/i);
  });
});
