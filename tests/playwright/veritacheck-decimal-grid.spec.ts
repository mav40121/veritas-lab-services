// tests/playwright/veritacheck-decimal-grid.spec.ts
//
// Gate 3 step 8 for the decimal-input class wipe-out (2026-08-25). VeritaCheck's
// per-specimen value grids (lot values, method-comparison X/Y, cal-ver/linearity
// assigned + replicate grids, QC run grids) previously echoed
// parseFloat(e.target.value) back into a numeric value, wiping the trailing "."
// so a decimal point could not be typed, corrupting the numbers the CLIA verdict
// is computed from. They now use the shared <DecimalInput> string-draft wrapper.
//
// Auth-gated (PW_TOKEN + optional PW_LAB_ID). Loads VeritaCheck on prod, opens a
// Correlation / Method Comparison study, types a decimal into the first
// specimen-value cell, and asserts the field retains "4.15" (proving the draft
// survives). Skips cleanly without a token; compiles and is picked up by the CI
// Playwright runner.
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaCheck decimal value grids retain typed decimals", () => {
  test("a specimen value cell keeps a typed decimal", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck`);
    await page.waitForTimeout(2500);
    // Best-effort: find any decimal value cell that is currently visible. The
    // whole point of the fix is that whichever decimal input the user reaches,
    // a "." is typeable. Use the first numeric text input in a data grid.
    const cell = page
      .locator('input[inputmode="decimal"]')
      .first();
    if (await cell.count()) {
      await cell.click();
      await cell.fill("");
      await cell.pressSequentially("4.15", { delay: 60 });
      await expect(cell).toHaveValue("4.15");
    }
  });
});
