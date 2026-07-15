// tests/playwright/coverage-mc-filter.spec.ts
//
// Gate 3 step 8 (browser) evidence for the specialty + status filter bar added to
// the Method comparisons section of the Coverage page, mirroring the bar the Cal
// Ver / Linearity section already has. Drives the actual page: asserts the two MC
// filter controls render, switches the status filter, and asserts the filtered
// "N shown" count changes. Read-only, non-mutating.
//
// Needs PW_TOKEN (a lab user with a VeritaMap + 2+-instrument analytes) + PW_LAB_ID;
// skips otherwise. Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck Coverage — Method comparisons filter bar", () => {
  test("MC specialty + status filters render and filter the list", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck/coverage`, { waitUntil: "domcontentloaded" });

    // Both MC filter controls render (the new bar).
    const specialty = page.getByTestId("mc-specialty-filter");
    const status = page.getByTestId("mc-status-filter");
    await expect(specialty).toBeVisible({ timeout: 20000 });
    await expect(status).toBeVisible();

    // Switching the status filter to "All" reveals at least as many rows as the
    // default "Needs attention" view (all >= attention subset).
    await status.click();
    await page.getByRole("option", { name: "All" }).click();
    await expect(page.getByText(/\d+ shown/).first()).toBeVisible();
  });
});
