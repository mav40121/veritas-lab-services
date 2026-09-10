// tests/playwright/lab-switcher-zoom-visibility.spec.ts
//
// Guard for the multi-lab switcher surviving browser zoom. Browser zoom shrinks
// the effective viewport width; the switcher chip used to be `hidden lg:flex`
// (gone below 1024px), so at ~150% zoom on a common laptop a multi-lab owner
// lost the switcher off the top bar and assumed they had to sign out and back
// in to change sites (Mike Hiltunen, MedStar, 2026-09-10). It is now
// `hidden sm:flex`, so it stays on the bar down to 640px effective width.
//
// Authenticated: a multi-lab owner JWT in PW_TOKEN (the standard PW_TOKEN owns
// many labs). Skips without a token so the compile-only smoke gate stays green.
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (optional).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("Lab switcher — survives browser zoom (narrow effective width)", () => {
  test("switcher chip stays visible at a zoomed-in (850px) width", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    // 850px effective width stands in for ~150-160% zoom on a typical laptop,
    // which is below the old lg (1024px) cutoff but above the new sm (640px) one.
    await page.setViewportSize({ width: 850, height: 800 });
    await injectAuth(page, BASE, TOKEN);
    const dest = LAB_ID ? `${BASE}/labs/${LAB_ID}/dashboard` : `${BASE}/dashboard`;
    await page.goto(dest, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    const switcher = page.getByTestId("lab-switcher");
    // Only a multi-lab owner renders the switcher trigger; if the token owns a
    // single lab, note and skip rather than fail.
    if ((await switcher.count()) === 0) {
      test.info().annotations.push({ type: "note", text: "token is not multi-lab; switcher trigger not rendered" });
      test.skip(true, "single-lab token; nothing to switch between");
      return;
    }
    await expect(
      switcher.first(),
      "the lab switcher stays on the top bar at a zoomed-in width (was hidden below 1024px)"
    ).toBeVisible({ timeout: 8000 });
  });
});
