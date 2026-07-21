// tests/playwright/veritastock-mobile-header.spec.ts
//
// Gate 3 step 8 for the VeritaStock director-page header mobile fix. On a phone
// viewport the header used to be a non-stacking flex row: the title block ate the
// left half and the 16 action buttons (incl. Count History / Count Sheet / Scan
// Mode / Scan to count) were squeezed into a thin right-hand column, one per row,
// with the left half of the screen empty (San Carlos, mobile). The fix stacks the
// header vertically on mobile so the buttons wrap full-width below the title.
//
// This asserts the stacked behavior on a 390px viewport: the first action button
// sits BELOW the title block (not beside it) and starts near the left edge (using
// the full width, not crammed to the right). Guarded on PW_TOKEN so it is green
// pre-deploy / in a no-secret CI run and asserts for real against prod when a
// token is present.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock mobile header does not cram buttons into a right column", () => {
  test("action buttons stack full-width below the title on a phone", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for authed VeritaStock page load");
    await page.setViewportSize({ width: 390, height: 844 }); // phone
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

    const title = page.locator("h1", { hasText: "VeritaStock" }).first();
    const firstBtn = page.getByTestId("incoming-transfers-button");
    if (!(await firstBtn.isVisible().catch(() => false))) {
      test.skip(true, "VeritaStock header not visible (lab may lack the suite plan)");
      return;
    }
    const titleBox = await title.boundingBox();
    const btnBox = await firstBtn.boundingBox();
    expect(titleBox, "title box").toBeTruthy();
    expect(btnBox, "first button box").toBeTruthy();

    // Stacked: the button row sits below the title block, not beside it.
    expect(btnBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height - 2);
    // Uses the full width: the button cluster starts near the left edge, not
    // squeezed into a right-hand column (the old broken layout started ~250px in).
    expect(btnBox!.x).toBeLessThan(160);
    // Nothing runs off the right edge of the 390px phone screen.
    expect(btnBox!.x + btnBox!.width).toBeLessThanOrEqual(390 + 1);
  });
});
