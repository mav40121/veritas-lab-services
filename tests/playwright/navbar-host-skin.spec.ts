// tests/playwright/navbar-host-skin.spec.ts
//
// Gate 3 receipt for the host-aware NavBar chrome (client/src/components/NavBar.tsx).
// The skin keys on the served hostname, so the assertion forks on PW_BASE:
//   - default lab host (veritaslabservices.com): the lab-compliance brand
//     tagline must still render (proves the host-skin did NOT break the default).
//   - a veritastock.com host: the VeritaStock inventory tagline renders and the
//     lab-compliance tagline is gone.
//
// Run default:  PW_BASE=https://www.veritaslabservices.com npx playwright test navbar-host-skin
// Run skin:     PW_BASE=https://www.veritastock.com        npx playwright test navbar-host-skin

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const isStockHost = /veritastock\.com/i.test(BASE);

test.describe("NavBar host-aware chrome", () => {
  test("brand and nav match the served host", async ({ page }) => {
    await page.goto(`${BASE}/`);
    if (isStockHost) {
      await expect(page.getByText(/Multi-Location Inventory/i).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Clinical Laboratory Consulting/i)).toHaveCount(0);
      // Root route serves the VeritaStock landing, not the lab homepage.
      await expect(page.getByRole("heading", { name: /Know what you have, everywhere/i })).toBeVisible();
      await expect(page.getByText(/Nobody taught you the compliance/i)).toHaveCount(0);
    } else {
      // Default lab host stays the full compliance chrome.
      await expect(page.getByText(/Clinical Laboratory Consulting/i).first()).toBeVisible({ timeout: 15000 });
    }
  });
});
