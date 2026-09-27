// tests/playwright/lab-switcher-mobile.spec.ts
//
// Gate 3 step 8 for the mobile lab-switcher add (2026-06-08).
// Reproduces the iPhone Safari report: "on mobile I can't switch my
// lab." Drives a mobile viewport in headless Chromium, opens the
// hamburger drawer, asserts the "Switch lab" section renders for a
// 2+ membership user.
//
// Real-device verification still belongs to Michael (iOS Safari has
// quirks Chromium doesn't surface), but a smoke test here catches
// the build-time / mount class of regression cheaply.
//
// 2026-09-26 repair: the spec had rotted against the current NavBar.
//   - Auth was seeded under localStorage "token"; the app reads
//     "veritas_token" (+ "veritas_user"). Now uses injectAuth like every
//     other authed spec, so the page actually loads logged in.
//   - The hamburger selector was `button.lg:hidden`; the NavBar collapses
//     at min-[1536px], and the button already carries data-testid
//     "nav-hamburger". Target that instead.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT with 2+ memberships

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Mobile lab switcher", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the hamburger drawer and shows the Switch lab section", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed page load");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    // The hamburger renders below the min-[1536px] breakpoint, which our
    // 390px viewport is. It carries data-testid="nav-hamburger".
    const hamburger = page.locator('[data-testid="nav-hamburger"]').first();
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // "Switch lab" appears only when the user has 2+ memberships. A single-
    // membership account renders null and the label never appears; gate the
    // assertion on a probe using the correct token key.
    const memberships = await page.evaluate(async () => {
      const t = localStorage.getItem("veritas_token");
      const r = await fetch("/api/labs/me", { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return [];
      return r.json();
    });
    if (!Array.isArray(memberships) || memberships.length < 2) {
      test.skip(true, "Account has fewer than 2 memberships; switcher is correctly hidden");
      return;
    }

    // The desktop switcher's "Switch lab" header lives inside a Radix dropdown
    // that only mounts when open, so after opening the drawer the only match is
    // the mobile LabSwitcherMobile section.
    await expect(page.getByText(/Switch lab/i).first()).toBeVisible({ timeout: 5000 });
  });
});
