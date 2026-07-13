// tests/playwright/veritabench-copy.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaBench copy fixes.
//
//   #2  the public /demo/operations productivity calculator no longer presents a
//       fabricated "$X/yr in labor savings" figure or its orphan hourly-rate input.
//       The honest hours/FTE gap and the per-test metric remain.
//
// Runs credential-free (the demo page is public).
//
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaBench demo calculator copy", () => {
  test("the public productivity calculator carries no dollar-savings claim (#2)", async ({ page }) => {
    await page.goto(`${BASE}/demo/operations`, { waitUntil: "domcontentloaded" });
    // The calculator renders (honest metric label present).
    await expect(page.getByText(/productive hours per billable test/i).first()).toBeVisible({ timeout: 15000 });

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("labor savings");
    expect(body).not.toContain("savings potential");
    // The orphan hourly-rate input is gone.
    expect(body).not.toContain("average hourly labor rate");
  });
});
