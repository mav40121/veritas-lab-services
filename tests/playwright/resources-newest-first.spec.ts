// tests/playwright/resources-newest-first.spec.ts
//
// Gate 3 step 8 receipt for the Resources page newest-first ordering
// (client/src/pages/ResourcesPage.tsx). Confirms the newest article (the June
// QC "testing into compliance" post) renders as the lead and sits physically
// above an older article (the May CPRT post) on the page.
//
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test resources-newest-first

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Resources page ordering", () => {
  test("newest article is the lead and sits above older ones", async ({ page }) => {
    await page.goto(`${BASE}/resources`, { waitUntil: "domcontentloaded" });

    const newest = page.getByText(/When Quality Control Stops Working/i);
    const older = page.getByText(/What Your Tests Actually Cost/i);

    await expect(newest).toBeVisible({ timeout: 20000 });
    await expect(older).toBeVisible();

    const newestBox = await newest.boundingBox();
    const olderBox = await older.boundingBox();
    expect(newestBox).not.toBeNull();
    expect(olderBox).not.toBeNull();
    // Newest must be physically higher on the page (smaller y) than the older one.
    expect(newestBox!.y).toBeLessThan(olderBox!.y);
  });
});
