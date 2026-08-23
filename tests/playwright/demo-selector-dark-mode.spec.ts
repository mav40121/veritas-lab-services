// tests/playwright/demo-selector-dark-mode.spec.ts
//
// Gate 3 step 8 (browser) evidence for the /demo (DemoSelectorPage) dark-mode
// fix. The page was built with hardcoded light inline hex, so in dark mode the
// two hero cards rendered white against the theme-aware (dark) SampleReports
// section and footer. The fix swaps the hardcoded neutrals for theme CSS
// variables. This spec loads /demo under both color schemes and asserts the
// "Compliance Demo" card's computed background follows the theme: dark in dark
// mode (not white), light in light mode.
//
// Public page: no auth. Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

function channels(rgb: string): number[] {
  const m = rgb.match(/\d+/g);
  return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
}

async function cardBg(page: import("@playwright/test").Page): Promise<string> {
  const card = page.locator('[role="button"]').filter({ hasText: "Compliance Demo" }).first();
  await expect(card).toBeVisible();
  return card.evaluate((el) => getComputedStyle(el).backgroundColor);
}

test.describe("/demo selector follows the theme in dark mode", () => {
  test("Compliance Demo card is dark under colorScheme dark", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    expect((await page.textContent("body")) || "").not.toContain("404 Page Not Found");

    const bg = await cardBg(page);
    const [r, g, b] = channels(bg);
    // Dark card token is ~rgb(19,24,33). The bug rendered pure white.
    expect(bg, `card bg in dark mode was ${bg}`).not.toBe("rgb(255, 255, 255)");
    expect(r + g + b, `card bg ${bg} should be dark`).toBeLessThan(240);
    await ctx.close();
  });

  test("Compliance Demo card is light under colorScheme light", async ({ browser }) => {
    const ctx = await browser.newContext({ colorScheme: "light" });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const bg = await cardBg(page);
    const [r, g, b] = channels(bg);
    // Light card token is white / near-white.
    expect(r + g + b, `card bg ${bg} should be light`).toBeGreaterThan(720);
    await ctx.close();
  });
});
