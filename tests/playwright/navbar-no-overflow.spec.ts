// tests/playwright/navbar-no-overflow.spec.ts
//
// Gate 3 receipt for the 2026-06-12 NavBar root-cause fix.
//
// Recurring bug ("top bar shifted right", reported and symptom-patched
// multiple times): the header inner container was max-w-7xl (1280px,
// centered) but the logged-in content (menu + long lab-name LabSwitcher +
// bell + theme + account button) exceeds 1280px. The centered box overflowed
// right: narrow windows cut the account button off-screen; wide windows
// showed a dead gap left of the logo. Fix: full-width container.
//
// Asserts at two desktop widths:
//   1. the page does not scroll horizontally (no right overflow), and
//   2. the logo sits near the left edge (no dead gap).
//
// Logged-in run (exercises the wide LabSwitcher) needs PW_TOKEN + PW_LAB_ID;
// the logged-out assertion runs without creds.
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test navbar-no-overflow

// 2026-06-13 update: browser QA found #733 only fixed the overflow at wide
// widths. The logged-in bar (8 marketing links + lab switcher + user menu +
// Run a Study) measures ~1539px on prod with the longest lab name, so
// 1280/1366 laptops overflowed. First fix collapsed the bar to the hamburger
// below 1450px, but prod QA at the exact boundary then showed the FULL bar
// still overflowed 89px at 1450-1538 (it appears before there is room for it,
// pushing "Run a Study" off-screen). Final fix: breakpoint = 1560px
// (min-[1560px]: variant), comfortably above the bar's 1539px intrinsic width.
// This spec checks 1500 — a width where the old 1450 breakpoint showed the
// full bar but it did not fit — and injects the FULL auth (token + user) so
// the logged-in bar actually renders, instead of the gated state a token-only
// injection produced.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

async function assertNoOverflowAndLeftLogo(page: any) {
  // No horizontal scroll: content fits the viewport.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Logo anchored near the left edge (px-4/px-6 padding, not a 200px+ gap).
  const logo = page.locator("header a[href='/']").first();
  const box = await logo.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThan(60);
}

test.describe("NavBar full-width: no right overflow, no left dead gap", () => {
  // 1280/1366: the laptop widths #733's first fix still overflowed at.
  // 1500: between the bar's 1539px width and the 1560px breakpoint — the old
  // 1450 breakpoint showed the full bar here and it overflowed 89px; the
  // 1560 breakpoint keeps it collapsed, so it must be clean.
  for (const width of [1280, 1366, 1500, 1920]) {
    test(`logged-out at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${BASE}/`);
      await assertNoOverflowAndLeftLogo(page);
    });

    test(`logged-in (wide LabSwitcher) at ${width}px`, async ({ page }) => {
      test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
      await page.setViewportSize({ width, height: 900 });
      // injectAuth seeds BOTH veritas_token and veritas_user so the full
      // logged-in bar (lab switcher + user menu + Run a Study) renders; a
      // token-only injection leaves the bar in its gated/minimal state and
      // would never reproduce the overflow this guards against.
      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/account/settings`);
      await assertNoOverflowAndLeftLogo(page);
      // The account button must be fully inside the viewport (the narrow-
      // window symptom was it being pushed off-screen right).
      const account = page.locator("header button", { hasText: /Michael|Account/ }).last();
      if (await account.count()) {
        const b = await account.boundingBox();
        if (b) expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    });
  }
});
