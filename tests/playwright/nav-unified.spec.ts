// tests/playwright/nav-unified.spec.ts
//
// Gate 3 browser evidence + standing guard for the unified VeritaAssure nav.
// Compliance and Operations modules were merged into ONE menu: flat on desktop
// (a single "VeritaAssure" dropdown listing all seventeen modules, no separate
// "Operations" top-level entry), collapsible-grouped on mobile (one
// "VeritaAssure" section with Compliance / Operations sub-headers).
//
// Gated behind PW_NAV so CI stays compile-only; run against prod after deploy:
//   PW_NAV=1 npx playwright test nav-unified

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Unified VeritaAssure nav", () => {
  test.beforeEach(() => {
    if (!process.env.PW_NAV) test.skip(true, "Set PW_NAV=1 to run against a deployed build.");
  });

  test("desktop: one flat VeritaAssure menu holds compliance AND operations modules", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 }); // desktop nav shows at >=1536px
    await page.goto(BASE, { waitUntil: "networkidle" });

    // No standalone top-level "Operations" nav entry any more.
    const topNav = page.locator("header nav").first();
    await expect(topNav.getByRole("button", { name: /^Operations$/ })).toHaveCount(0);

    // Open the single VeritaAssure menu.
    await topNav.getByRole("button", { name: /VeritaAssure/ }).click();

    // Overview link + a compliance module + an operations module all live here.
    await expect(page.getByRole("menuitem", { name: /All Modules Overview/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /VeritaCheck/ })).toBeVisible();   // compliance
    await expect(page.getByRole("menuitem", { name: /VeritaStock/ })).toBeVisible();   // operations
    await expect(page.getByRole("menuitem", { name: /VeritaOps/ })).toBeVisible();     // operations
    await expect(page.getByRole("menuitem", { name: /VeritaResponse/ })).toBeVisible();// was missing before
  });

  test("mobile: one grouped VeritaAssure section with Compliance/Operations sub-headers", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(BASE, { waitUntil: "networkidle" });

    await page.getByTestId("nav-hamburger").click();
    const banner = page.getByRole("banner"); // scope to the nav header, not page CTAs
    // No separate top-level Operations group toggle.
    await expect(banner.getByRole("button", { name: /^Operations$/ })).toHaveCount(0);

    // Expand the unified VeritaAssure group.
    await banner.getByRole("button", { name: /VeritaAssure/ }).click();

    // Both stream sub-headers and one module from each stream are present.
    await expect(banner.getByText("Compliance", { exact: true })).toBeVisible();
    await expect(banner.getByText("Operations", { exact: true })).toBeVisible();
    await expect(banner.getByRole("link", { name: "VeritaCheck™", exact: true })).toBeVisible();  // compliance
    await expect(banner.getByRole("link", { name: "VeritaStock™", exact: true })).toBeVisible();  // operations
  });
});
