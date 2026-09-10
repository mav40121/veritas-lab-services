// tests/playwright/navbar-zoom-controls.spec.ts
//
// Guard for the logged-in top-bar controls surviving browser zoom. The whole
// nav used to be gated at min-[1536px], so at ~110% zoom on a 1536px monitor
// (effective ~1396px) the entire bar collapsed into the hamburger, stripping the
// account menu and Run a Study (Michael Veri, 2026-09-10). The wide marketing
// links still collapse below 1536px, but the app controls a logged-in user needs
// (lab switcher at sm/640, account menu + Run a Study at lg/1024) now stay on the
// bar through normal zoom.
//
// Authenticated: PW_TOKEN (any logged-in user). Skips without it so the
// compile-only smoke gate stays green. Env: PW_BASE, PW_TOKEN, PW_LAB_ID (opt).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("NavBar — logged-in controls survive browser zoom", () => {
  test("at ~110% width (1396px) Run a Study stays on the bar", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    // 1396px ~= 110% zoom on a 1536px monitor: below the old 1536 cutoff, above
    // the new lg (1024) one.
    await page.setViewportSize({ width: 1396, height: 760 });
    await injectAuth(page, BASE, TOKEN);
    const dest = LAB_ID ? `${BASE}/labs/${LAB_ID}/dashboard` : `${BASE}/dashboard`;
    await page.goto(dest, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);

    await expect(
      page.getByRole("link", { name: /Run a Study/i }).first(),
      "Run a Study stays on the top bar at a zoomed-in width (was collapsed below 1536px)"
    ).toBeVisible({ timeout: 8000 });
  });
});
