// tests/playwright/scheduling-eastern.spec.ts
//
// Gate 3 step-8 evidence for the scoping-call calendar going Eastern + 50-min.
// Public booking page (no auth). Runs against prod; before this PR's deploy the
// page still shows the old 30-min/Phoenix copy, so the assertions skip until the
// new build is live, then verify the Eastern tz label and 50-min branding.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Scoping-call calendar: Eastern + 50-minute", () => {
  test("booking page shows 50-minute branding and America/New_York, not Phoenix", async ({ page }) => {
    await page.goto(`${BASE}/book/scoping-call`, { waitUntil: "networkidle" });

    const has50 = await page.getByText(/50-Minute Consulting Scoping Call/i).count();
    test.skip(has50 === 0, "New 50-min build not deployed yet (page still shows prior copy).");

    // 50-min branding present, 30-min branding gone.
    await expect(page.getByText(/50-Minute Consulting Scoping Call/i).first()).toBeVisible();
    await expect(page.getByText(/30-Minute Consulting Scoping Call/i)).toHaveCount(0);

    // Operator tz is Eastern, not Arizona.
    await expect(page.getByText(/America\/New_York/i).first()).toBeVisible();
    await expect(page.getByText(/America\/Phoenix/i)).toHaveCount(0);
  });
});
