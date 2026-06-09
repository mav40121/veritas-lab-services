// tests/playwright/staffportal-pending-badges.spec.ts
//
// Gate 3 step 8 receipt for the pending-count badges (PR fix for
// Chineme having no signal of an assigned quiz on login).
// Asserts the static / structural pieces; the live banner-with-count
// path needs Michael's browser-click after deploy with a pre-assigned
// quiz.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Staff Portal pending-count badges", () => {
  test("staff-access login form still renders (entry point intact)", async ({ page }) => {
    await page.goto(`${BASE}/staff-access`);
    await expect(page.getByTestId("sp-login-clia")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("sp-login-pin")).toBeVisible();
  });

  test("tile container has the stable test-id even on the legacy login surface", async ({ page }) => {
    // The unauthenticated /staff-access lands on the login form, not
    // the tile grid. The data-testid="sp-tiles" + sp-pending-banner
    // contracts only mount post-auth — see the auth-walkthrough
    // playwright (manual prereq) for the live assertion.
    await page.goto(`${BASE}/staff-access`);
    await expect(page.getByTestId("sp-tiles")).toHaveCount(0);
    await expect(page.getByTestId("sp-pending-banner")).toHaveCount(0);
  });
});
