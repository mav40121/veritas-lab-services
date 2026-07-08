// tests/playwright/coverage-mc-sort.spec.ts
//
// Gate 3 step 8 (browser) evidence for the sortable Method-comparisons table on
// the VeritaCheck Coverage page. The table previously rendered a fixed order
// (gaps first); now each column header (Analyte / Instruments / Study / Verdict)
// is clickable to sort, click again to reverse — matching the Cal Ver table.
//
// Drives the actual page: clicks the Analyte header ascending, records the first
// row, clicks again (descending), and asserts the first row changed. Non-mutating.
// Needs PW_TOKEN (a lab user with VeritaCheck) + PW_LAB_ID; skips otherwise.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck Coverage — Method comparisons sort", () => {
  test("MC headers sort and reverse", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck/coverage`, { waitUntil: "domcontentloaded" });

    // All four MC sort headers render with the distinct cov-mc-sort- prefix.
    const analyteHdr = page.getByTestId("cov-mc-sort-analyte");
    await expect(analyteHdr).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("cov-mc-sort-instruments")).toBeVisible();
    await expect(page.getByTestId("cov-mc-sort-study")).toBeVisible();
    await expect(page.getByTestId("cov-mc-sort-verdict")).toBeVisible();

    // Scope to the MC table (the one that contains the MC sort headers).
    const mcTable = page.locator("table").filter({ has: page.getByTestId("cov-mc-sort-analyte") });
    const firstAnalyte = () => mcTable.locator("tbody tr td").first().innerText();

    // Ascending: first analyte should be an early-alphabet entry (BASO# at San Carlos).
    await analyteHdr.click();
    const asc = (await firstAnalyte()).trim();
    // Descending: clicking again reverses; the first row must change.
    await analyteHdr.click();
    const desc = (await firstAnalyte()).trim();
    expect(asc.length).toBeGreaterThan(0);
    expect(desc).not.toBe(asc);
  });
});
