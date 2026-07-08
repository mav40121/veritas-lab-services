// tests/playwright/navbar-breakpoint.spec.ts
//
// The full horizontal navbar was collapsing to the hamburger below 1560px, which
// hid it on most laptops. The breakpoint was lowered to 1536 (with the bar
// tightened to fit), so a standard 1536px laptop shows the full nav, not the
// hamburger. This spec asserts the boundary on the public homepage (no auth
// needed): at 1536 the desktop links show and the hamburger is hidden; at 1440
// it's the hamburger.
//
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Navbar responsive breakpoint (1536)", () => {
  test("full nav at 1536, hamburger below", async ({ page }) => {
    // At 1536: the desktop nav renders and the hamburger is not shown.
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "Consulting", exact: true })).toBeVisible();
    await expect(page.getByTestId("nav-hamburger")).toBeHidden();
    // The header must not overflow its own width (no wrap / horizontal scroll).
    const overflow1536 = await page.evaluate(() => {
      const h = document.querySelector("header .w-full.px-4") as HTMLElement;
      return h ? h.scrollWidth - h.clientWidth : 0;
    });
    expect(overflow1536).toBeLessThanOrEqual(1);

    // At 1440: the desktop nav collapses to the hamburger.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByTestId("nav-hamburger")).toBeVisible();
    await expect(page.getByRole("link", { name: "Consulting", exact: true })).toBeHidden();
  });
});
