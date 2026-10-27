// tests/playwright/homepage-module-count.spec.ts
//
// Gate 3 step 8 for the homepage stat tile (2026-10-27): it read "17 Software Modules" after the suite grew to
// eighteen (12 compliance + 6 operations, CLAUDE.md copy rules). Public page, no sign-in, so it runs against a local
// build or production.
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test homepage-module-count

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test("the homepage stat tile counts 18 software modules", async ({ page }) => {
  await page.goto(`${BASE}/`);
  const label = page.getByText("Software Modules", { exact: true }).first();
  await expect(label).toBeVisible({ timeout: 15000 });
  const tile = label.locator("xpath=..");
  await expect(tile).toContainText("18");
  await expect(tile).not.toContainText("17");
});
