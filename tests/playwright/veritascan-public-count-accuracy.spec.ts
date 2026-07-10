// tests/playwright/veritascan-public-count-accuracy.spec.ts
//
// Gate 3 step 8 evidence for the VeritaScan item-count accuracy fix (scorecard #1,
// 2026-07-10). /veritascan is a PUBLIC marketing page (no auth), so this runs live
// against PW_BASE with no token. It asserts the page advertises the real count
// (173), no longer shows the stale 168, and renders the app's real domain taxonomy
// rather than the old mismatched one.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaScan public page advertises the real item count and domains", () => {
  test("shows 173, not 168, with the real domain names", async ({ page }) => {
    await page.goto(`${BASE}/veritascan`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();

    // The real count is present; the stale count is gone.
    expect(body).toContain("173");
    expect(body).not.toContain("168 compliance");
    expect(body).not.toContain("168 Items");
    expect(body).not.toContain("168 Compliance Items");

    // The real domain taxonomy renders; the stale taxonomy does not.
    expect(body).toContain("Quality Systems & QC");
    expect(body).toContain("Leadership & Governance");
    expect(body).not.toContain("Lab Administration");
    expect(body).not.toContain("Procedure Manual");
  });
});
