// tests/playwright/veritacheck-passthreshold-persist.spec.ts
//
// Gate 3 step 8 for the 2026-08-27 "pass threshold blanks out" fix. In a
// method-comparison study with assay type Semi-Quantitative, selecting a pass
// threshold used to blank out immediately (the controlled Select value did not
// string-match the padded option). This drives the real flow and asserts the
// chosen value sticks.
//
// PW_TOKEN-gated. Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaCheck semi-quantitative pass threshold persists", () => {
  test("selecting a pass threshold sticks and does not blank out", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck`);

    const newStudy = page.getByRole("button", { name: /New Study/i });
    if (await newStudy.count()) await newStudy.first().click();

    // The Assay Type selector only appears for method comparison, so pick that first.
    await page.getByTestId("select-study-type").click();
    await page.getByRole("option", { name: /Correlation|Method Comparison/i }).first().click();

    // Assay type: Semi-Quantitative.
    await page.getByTestId("select-assay-type").click();
    await page.getByRole("option", { name: /Semi-Quantitative/i }).first().click();

    // Pass threshold: choose 80% and confirm it persists (the regression).
    const thr = page.getByTestId("select-semi-pass-threshold");
    await expect(thr).toBeVisible({ timeout: 15000 });
    await thr.click();
    await page.getByRole("option", { name: "80%" }).first().click();
    await expect(thr).toContainText("80%");
  });
});
