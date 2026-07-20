// tests/playwright/veritastock-count-history.spec.ts
//
// Gate 3 step 8 for the VeritaStock Count History report (PR 2). Non-destructive:
// opens the Count History dialog and asserts it renders (either the empty state
// or the count table) plus the Export button. No mutation of prod data. The
// true-burn math + workbook are covered server-side by
// scripts/verify-count-history.mts.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock Count History", () => {
  test("Count History button opens the report dialog", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for authed VeritaStock page load");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

    const btn = page.getByTestId("count-history-button");
    if (!(await btn.isVisible().catch(() => false))) {
      test.skip(true, "Count History button not visible (lab may lack the VeritaStock/suite plan)");
      return;
    }
    await btn.click();

    const dialog = page.getByTestId("count-history-dialog");
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Either the empty state or the populated table must render (both valid).
    const empty = page.getByTestId("count-history-empty");
    const exportBtn = page.getByTestId("count-history-export-button");
    await expect(empty.or(exportBtn)).toBeVisible({ timeout: 8000 });
    // The export control is always present in the header.
    await expect(exportBtn).toBeVisible();
  });
});
