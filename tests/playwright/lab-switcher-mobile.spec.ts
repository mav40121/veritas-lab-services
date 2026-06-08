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
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT with 2+ memberships

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Mobile lab switcher", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the hamburger drawer and shows the Switch lab section", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed page load");
      return;
    }
    await context.addInitScript(([tok]) => {
      try { window.localStorage.setItem("token", tok); } catch {}
    }, [TOKEN]);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

    // The hamburger is a Button with the Menu icon. It only renders
    // below the lg breakpoint, which our 390px viewport is.
    const hamburger = page.locator("button.lg\\:hidden").first();
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    // The "Switch lab" section header should appear when the user has
    // 2+ memberships. Single-membership accounts get a null render and
    // the label never appears; gate the assertion on a probe.
    const labSection = page.getByText(/Switch lab/i);
    const memberships = await page.evaluate(async () => {
      const r = await fetch("/api/labs/me", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
      if (!r.ok) return [];
      return r.json();
    });
    if (!Array.isArray(memberships) || memberships.length < 2) {
      test.skip(true, "Account has fewer than 2 memberships; switcher is correctly hidden");
      return;
    }
    await expect(labSection).toBeVisible({ timeout: 4000 });
  });
});
