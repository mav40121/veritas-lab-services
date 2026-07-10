// tests/playwright/pricing-no-stale-display-prices.spec.ts
//
// Gate 3 step 8 guard for the stale-display-price cleanup (2026-07-10). The public
// /pricing page is the canonical tier-price display; this asserts it shows the
// MEDIUM prices and none of the retired 2025 amounts. Public page, so it runs live
// against PW_BASE with no auth.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Pricing surfaces show MEDIUM prices, not the retired 2025 amounts", () => {
  test("/pricing shows $999 / $2,125 / $4,995 and no stale $499 / $1,999", async ({ page }) => {
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();

    // Current MEDIUM tier prices are present.
    expect(body).toContain("999");     // Clinic
    expect(body).toContain("2,125");   // Community
    expect(body).toContain("4,995");   // Hospital

    // Retired 2025 tier prices must not appear as tier prices.
    expect(body).not.toContain("$499/yr");
    expect(body).not.toContain("$1,999/yr");
  });
});
