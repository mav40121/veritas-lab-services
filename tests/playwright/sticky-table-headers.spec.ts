// tests/playwright/sticky-table-headers.spec.ts
//
// Gate 3 evidence for the site-wide "freeze the column header" fix. Chineme
// (San Carlos) reported that on the coverage map's Cal/Ver list the column
// headers scrolled out of view. The fix makes every long data table a bounded
// scroll box (max-h + overflow-auto on the wrapper) with sticky header cells
// (position: sticky; top: 0), so the header stays visible while the rows scroll.
//
// This asserts the data table on a given page has sticky header cells and that
// the header stays pinned to the top of its scroll box after scrolling.
//
// Auth-gated so CI stays compile-only. Run against a deployed build:
//   PW_TOKEN=<owner/seat token> PW_PATH=/veritamap-app/<mapId> \
//     npx playwright test sticky-table-headers

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PATH = process.env.PW_PATH || ""; // e.g. /veritamap-app/12 (a lab's coverage map)

test.describe("Sticky data-table headers (freeze panes)", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !PATH, "Set PW_TOKEN and PW_PATH (a logged-in data-table page).");
  });

  test("header cells are sticky and stay pinned while the body scrolls", async ({ page }) => {
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });

    const th = page.locator("table thead th").first();
    await expect(th).toBeVisible();

    // Core fix: header cells are position: sticky, pinned to top.
    const pos = await th.evaluate((el) => getComputedStyle(el).position);
    expect(pos).toBe("sticky");
    const top = await th.evaluate((el) => getComputedStyle(el).top);
    expect(top).toBe("0px");

    // After scrolling the nearest scroll box, the header top stays at (or above)
    // the box top rather than scrolling away.
    const stillPinned = await th.evaluate((el) => {
      let box: HTMLElement | null = el.closest("table")?.parentElement ?? null;
      while (box && getComputedStyle(box).overflowY === "visible") box = box.parentElement;
      if (!box) return true;
      box.scrollTop = box.scrollHeight; // scroll to bottom
      const thTop = el.getBoundingClientRect().top;
      const boxTop = box.getBoundingClientRect().top;
      return thTop <= boxTop + 2; // header pinned within ~2px of the box top
    });
    expect(stillPinned).toBeTruthy();
  });
});
