// tests/playwright/custom-dual-criterion-tea.spec.ts
//
// Gate 3 step 8 (browser) evidence for the custom DUAL-CRITERION TEa feature.
//
// The custom (lab-defined) TEa entry on the study-create page now offers an
// optional absolute floor + unit alongside the percent goal, evaluated as
// "pass if within the greater of the two". This is needed for low-count
// analytes (eos/baso). This spec drives the actual page: it checks the
// "Use custom TEa" box and asserts the new absolute-floor + unit inputs render
// and accept input, and that the "Active TEa" summary reflects the dual rule.
//
// Non-mutating by default (no study is saved), so it stays safe in the
// compile-only prod CI gate. Needs PW_TOKEN (a lab user with VeritaCheck) and
// PW_LAB_ID; skips otherwise.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck custom dual-criterion TEa", () => {
  test("custom TEa exposes absolute floor + unit and reflects the dual rule", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "domcontentloaded" });

    // The custom-TEa checkbox lives in the Acceptance Criterion card. Check it.
    const customBox = page.locator("#use-custom-tea");
    await expect(customBox).toBeVisible({ timeout: 15000 });
    await customBox.click();

    // Percent input + the NEW absolute-floor + unit inputs must all render.
    await expect(page.getByTestId("custom-tea-percent")).toBeVisible();
    const absFloor = page.getByTestId("custom-tea-abs-floor");
    const absUnit = page.getByTestId("custom-tea-abs-unit");
    await expect(absFloor).toBeVisible();
    await expect(absUnit).toBeVisible();

    // Entering a floor WITHOUT a unit surfaces the units reminder.
    await absFloor.fill("0.1");
    await expect(page.getByTestId("custom-tea-unit-warn")).toBeVisible();

    // Adding a unit clears the reminder and the Active TEa line shows "or ± ...".
    await absUnit.fill("x10^9/L");
    await expect(page.getByTestId("custom-tea-unit-warn")).toBeHidden();
    await expect(page.getByText(/Active TEa:/i)).toContainText(/or ±\s*0\.1/);
  });
});
