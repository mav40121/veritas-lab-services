// tests/playwright/veritastock-expiry-tile.spec.ts
//
// Gate 3 receipt for the expiration-parse fix (VeritaStockPage getExpirationStatus
// + the EXPIRING <60D tile). Demo seeds write a full ISO timestamp to
// expiration_date; the old `new Date(exp + "T00:00:00")` made that an Invalid
// Date, so the Expiration column read "OK" and the tile read 0 for every seeded
// item. parseExpiration() slices to the date part first. This drives the live
// single-site demo (a short-dated cell-culture-media item, ~11 days) and asserts
// the row now shows a near-expiry badge.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     PW_LAB=2 npx playwright test veritastock-expiry-tile
//
// Skips (compile-only in CI) when PW_BASE/PW_TOKEN are not provided.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "2";
const ready = () => !!(BASE && TOKEN);

test.describe("VeritaStock expiration parse (near-expiry surfaces)", () => {
  test("a short-dated seeded item shows a near-expiry badge (not OK)", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1800);

    // The seeded cell-culture-media lot is ~11 days out. With the fix its
    // Expiration column reads a near-expiry badge; before the fix it read "OK".
    // At least one near-expiry badge must be present in the grid.
    const nearExpiry = page.getByText(/^<(30|60|90)d$/).first();
    await expect(nearExpiry).toBeVisible();
  });
});
