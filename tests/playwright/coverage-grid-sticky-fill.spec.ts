// tests/playwright/coverage-grid-sticky-fill.spec.ts
//
// Gate 3 evidence for making the VeritaMap coverage grid fill the viewport.
// The grid wrapper is `sticky top-16 max-h-[calc(100vh-5rem)] overflow-auto`, so
// after the user scrolls past the how-to card and intelligence banner the grid
// sticks below the navbar and fills the screen with the header pinned, instead
// of sitting low under the chrome and running off the bottom.
//
// Auth-gated so CI stays compile-only. Run against a deployed build:
//   PW_TOKEN=<owner/seat token> PW_MAP_ID=<mapId> \
//     npx playwright test coverage-grid-sticky-fill

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_ID = process.env.PW_MAP_ID || "";

test.describe("VeritaMap coverage grid — viewport-filling sticky header", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !MAP_ID, "Set PW_TOKEN and PW_MAP_ID.");
  });

  test("grid wrapper is sticky and its header pins near the top after scrolling", async ({ page }) => {
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritamap-app/${MAP_ID}`, { waitUntil: "networkidle" });
    await page.waitForSelector("table thead th", { timeout: 20000 });

    // The table's wrapper is position: sticky.
    const wrapperPos = await page.evaluate(() => {
      const t = document.querySelector("table");
      const w = t?.parentElement;
      return w ? getComputedStyle(w).position : "";
    });
    expect(wrapperPos).toBe("sticky");

    // After scrolling down past the chrome, the header sits in the top portion
    // of the viewport (not stuck low off the bottom).
    await page.evaluate(() => window.scrollTo(0, 700));
    await page.waitForTimeout(200);
    const thTop = await page.locator("table thead th").first().evaluate((el) => el.getBoundingClientRect().top);
    expect(thTop).toBeGreaterThanOrEqual(0);
    expect(thTop).toBeLessThan(window.innerHeight * 0.4);
  });
});
